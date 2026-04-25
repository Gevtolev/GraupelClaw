import type { Message } from "@/types";
import { parseMentions } from "./mention-parser";
import { buildGroupActivity } from "./group-activity";
import { assembleAgentPrompt } from "./prompt-assembler";
import { resolveTlAgentId } from "./resolve-tl";
import { isRecentLoop } from "./loop-detector";
import type {
  CascadeContext,
  DispatchOpts,
  DispatchReply,
  RosterEntry,
} from "./types";

export async function dispatchTeamMessage(opts: DispatchOpts): Promise<void> {
  const maxHops = opts.maxHops ?? 8;
  const ctx: CascadeContext = {
    teamId: opts.team.id,
    conversationId: opts.conversationId,
    rootUserMessageId: opts.rootUserMessageId,
    hop: 0,
    maxHops,
    activatedEdges: [],
  };

  const validIds = new Set(opts.team.agentIds);
  const tlId = resolveTlAgentId(opts.team);
  const nameToId = buildNameToId(opts);
  const userMentions = parseMentions(opts.userContent, validIds, nameToId);

  let currentTargets: string[] =
    userMentions.length > 0
      ? userMentions.map(m => m.agentId)
      : tlId
      ? [tlId]
      : [];
  let isUserHop = true;
  // True once any hop has dispatched the TL — used to decide whether to auto
  // re-engage the TL after a worker fan-out. If the user directly @-ed
  // workers and bypassed the TL, we respect that and don't pull TL in.
  let tlEverDispatched = tlId !== undefined && currentTargets.includes(tlId);

  console.debug(
    "[team-dispatcher] start conv", ctx.conversationId,
    "tlId:", tlId,
    "userMentions:", userMentions.map(m => m.agentId),
    "initialTargets:", currentTargets,
  );
  while (currentTargets.length > 0 && ctx.hop < ctx.maxHops) {
    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    console.debug("[team-dispatcher] dispatching hop", ctx.hop, "to", currentTargets, "isUserHop:", isUserHop);
    const replies = await Promise.all(
      currentTargets.map(agentId =>
        dispatchOne({ agentId, ctx, opts, isUserHop }),
      ),
    );

    ctx.hop += 1;
    isUserHop = false;

    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    const nextTargets: string[] = [];
    const seen = new Set<string>();
    let loopDetected = false;
    let workerReplied = false;

    for (const reply of replies) {
      if (!reply) {
        console.debug("[team-dispatcher] hop", ctx.hop, "got null reply (sendToAgent failed or no message saved)");
        continue;
      }
      // Hub-and-spoke routing: only the TL's mentions form next-hop dispatches.
      // A worker's reply may contain @-mentions for narrative purposes (e.g.,
      // "I synced with @Luna already") but those don't trigger another hop.
      // Workers report up to the TL; the TL decides who to delegate to next.
      const fromIsTl = tlId !== undefined && reply.fromAgentId === tlId;
      if (!fromIsTl) workerReplied = true;
      const mentions = fromIsTl ? parseMentions(reply.content, validIds, nameToId) : [];
      console.debug(
        "[team-dispatcher] hop", ctx.hop,
        "parsed", mentions.length, "mentions from", reply.fromAgentId,
        fromIsTl ? "(TL)" : "(worker — mentions ignored for routing)",
        "(content len:", reply.content.length, ")",
        mentions.map(m => `@${m.name}(${m.agentId})`).join(" "),
      );
      for (const m of mentions) {
        if (m.agentId === reply.fromAgentId) continue;
        if (isRecentLoop(ctx.activatedEdges, reply.fromAgentId, m.agentId)) {
          loopDetected = true;
          continue;
        }
        if (seen.has(m.agentId)) continue;
        seen.add(m.agentId);
        nextTargets.push(m.agentId);
        ctx.activatedEdges.push({ from: reply.fromAgentId, to: m.agentId });
      }
    }

    // After a worker fan-out completes, auto re-engage the TL so it can read
    // the workers' replies (via group_activity) and decide whether to fan
    // out again or wrap up. The TL's own self-mention filter prevents an
    // infinite TL→TL chain; if the TL has nothing more to delegate it will
    // simply respond and the cascade ends naturally.
    if (
      !loopDetected &&
      nextTargets.length === 0 &&
      workerReplied &&
      tlId !== undefined &&
      tlEverDispatched &&
      !currentTargets.includes(tlId)
    ) {
      nextTargets.push(tlId);
      // Edge bookkeeping: model the auto re-engage as worker→TL so the loop
      // detector still tracks the cascade shape.
      for (const reply of replies) {
        if (reply && reply.fromAgentId !== tlId) {
          ctx.activatedEdges.push({ from: reply.fromAgentId, to: tlId });
        }
      }
      console.debug("[team-dispatcher] hop", ctx.hop, "auto re-engaging TL", tlId);
    }

    console.debug(
      "[team-dispatcher] hop", ctx.hop, "→", ctx.hop + 1,
      "nextTargets:", nextTargets,
      "loopDetected:", loopDetected,
    );

    if (loopDetected) {
      opts.onCascadeStopped?.({ reason: "loop", hop: ctx.hop });
      return;
    }

    if (tlId !== undefined && nextTargets.includes(tlId)) {
      tlEverDispatched = true;
    }
    currentTargets = nextTargets;
  }

  if (ctx.hop >= ctx.maxHops && currentTargets.length > 0) {
    opts.onCascadeStopped?.({ reason: "max_hops", hop: ctx.hop });
  }
}

interface DispatchOneArgs {
  agentId: string;
  ctx: CascadeContext;
  opts: DispatchOpts;
  isUserHop: boolean;
}

async function dispatchOne(args: DispatchOneArgs): Promise<DispatchReply | null> {
  const { agentId, ctx, opts, isUserHop } = args;
  const state = opts.getState();
  const team = state.teams.find(t => t.id === opts.team.id) ?? opts.team;

  if (!team.agentIds.includes(agentId)) return null;

  const teamMessages = state.messages.filter(
    (m: Message) =>
      m.targetType === "team" &&
      m.targetId === team.id &&
      m.conversationId === ctx.conversationId,
  );

  const tlId = resolveTlAgentId(team);
  const lastSelfTs = lastSpeakTs(teamMessages, agentId);
  const triggerTs = Date.now();
  const nameMap = new Map<string, string>();
  for (const a of state.agents) nameMap.set(a.id, a.name);

  // Workers see an isolated slice of group activity: only the TL's prompts and
  // their own replies. Other members' work stays out of their context so we
  // don't compound noise across parallel fan-out. The TL keeps full visibility
  // (everyone's messages + the user) so it can orchestrate.
  const isTlSelf = agentId === tlId;
  const visibleMessages = isTlSelf
    ? teamMessages
    : teamMessages.filter(m =>
        m.role === "user" || m.agentId === tlId || m.agentId === agentId,
      );
  const groupActivity = buildGroupActivity(visibleMessages, lastSelfTs, triggerTs, nameMap);
  const selfAgent = state.agents.find(a => a.id === agentId);
  const selfName = selfAgent?.name ?? agentId;
  const self = {
    agentId,
    name: selfName,
    role: (agentId === tlId ? "TL" : "Member") as "TL" | "Member",
  };

  // Skip orphan ids (agents removed from gateway but still in team.agentIds) so
  // the TL prompt never instructs them to @-mention non-existent members.
  const roster: RosterEntry[] = team.agentIds.flatMap(id => {
    const a = state.agents.find(x => x.id === id);
    if (!a) return [];
    return [{
      agentId: id,
      name: a.name,
      description: a.description,
      role: (id === tlId ? "TL" : "Member") as "TL" | "Member",
    }];
  });

  const userMentions = parseMentions(
    isUserHop ? opts.userContent : "",
    new Set(team.agentIds),
  );
  const isDirectMention = isUserHop && userMentions.some(m => m.agentId === agentId);

  const prompt = assembleAgentPrompt({
    team,
    roster,
    self,
    groupActivity,
    userText: isUserHop ? opts.userContent : "",
    isDirectMention,
  });

  const sessionKey = opts.buildSessionKey(agentId, team.id, ctx.conversationId);
  const attachments = isUserHop ? opts.attachments : undefined;

  return opts.sendToAgent(agentId, sessionKey, prompt, attachments);
}

function lastSpeakTs(messages: Message[], agentId: string): number | null {
  let max: number | null = null;
  for (const m of messages) {
    if (m.role === "assistant" && m.agentId === agentId) {
      if (max === null || m.createdAt > max) max = m.createdAt;
    }
  }
  return max;
}

// Build a case-insensitive name → id map covering only the agents that
// actually belong to this team. The parser uses this to resolve bare
// `@Name` references back to a structured mention.
function buildNameToId(opts: DispatchOpts): Map<string, string> {
  const out = new Map<string, string>();
  const teamIds = new Set(opts.team.agentIds);
  const state = opts.getState();
  for (const a of state.agents) {
    if (!teamIds.has(a.id)) continue;
    if (!a.name) continue;
    out.set(a.name.toLowerCase(), a.id);
  }
  return out;
}
