import type { Message } from "@/types";
import { parseMentions } from "./mention-parser";
import { buildGroupActivity } from "./group-activity";
import { assembleAgentPrompt } from "./prompt-assembler";
import { resolveTlAgentId } from "./resolve-tl";
import { isRecentLoop } from "./loop-detector";
import { renderActiveTasks } from "./team-tasks/parser";
import type {
  ActiveTaskSummary,
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
  // Once-per-cascade dedup: each agent is dispatched at most once across the
  // whole cascade triggered by a single user message. Prevents the "Eva
  // answers the same prompt twice" failure mode where parallel members each
  // @-mention the same colleague.
  const everDispatched = new Set<string>(currentTargets);

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
    if (opts.onTaskEvent) {
      for (const id of currentTargets) {
        opts.onTaskEvent({
          type: "dispatch_start",
          agentId: id,
          conversationId: ctx.conversationId,
        });
      }
    }

    // Fetch fresh task snapshot for this hop (post dispatch_start so any
    // status changes have settled).
    let activeTasks: ActiveTaskSummary[] | undefined;
    if (opts.fetchActiveTasks) {
      try {
        activeTasks = await opts.fetchActiveTasks();
      } catch (e) {
        console.debug("[team-dispatcher] fetchActiveTasks failed", e);
      }
    }

    const replies = await Promise.all(
      currentTargets.map(agentId =>
        dispatchOne({ agentId, ctx, opts, isUserHop, activeTasks }),
      ),
    );

    // Emit reply_complete / reply_empty events for the task hook before we
    // parse mentions for the next-hop decision.
    if (opts.onTaskEvent) {
      for (let i = 0; i < currentTargets.length; i++) {
        const agentId = currentTargets[i];
        const reply = replies[i];
        if (!reply || !reply.content) {
          opts.onTaskEvent({
            type: "reply_empty",
            agentId,
            conversationId: ctx.conversationId,
          });
        } else {
          opts.onTaskEvent({
            type: "reply_complete",
            agentId,
            conversationId: ctx.conversationId,
            content: reply.content,
          });
        }
      }
    }

    ctx.hop += 1;
    isUserHop = false;

    if (opts.isAborted(ctx.conversationId)) {
      opts.onCascadeStopped?.({ reason: "abort", hop: ctx.hop });
      return;
    }

    const nextTargets: string[] = [];
    const seen = new Set<string>();
    let loopDetected = false;

    for (const reply of replies) {
      if (!reply) {
        console.debug("[team-dispatcher] hop", ctx.hop, "got null reply (sendToAgent failed or no message saved)");
        continue;
      }
      // Free routing (accio-style): any member's @-mention can trigger the
      // next hop. The dedup + loop detector + max_hops cap prevent runaway
      // cascades.
      const mentions = parseMentions(reply.content, validIds, nameToId);
      console.debug(
        "[team-dispatcher] hop", ctx.hop,
        "parsed", mentions.length, "mentions from", reply.fromAgentId,
        "(content len:", reply.content.length, ")",
        mentions.map(m => `@${m.name}(${m.agentId})`).join(" "),
      );
      for (const m of mentions) {
        if (m.agentId === reply.fromAgentId) continue;
        if (everDispatched.has(m.agentId)) {
          console.debug("[team-dispatcher]   skip", m.agentId, "(already dispatched in this cascade)");
          continue;
        }
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

    console.debug(
      "[team-dispatcher] hop", ctx.hop, "→", ctx.hop + 1,
      "nextTargets:", nextTargets,
      "loopDetected:", loopDetected,
    );

    if (loopDetected) {
      opts.onCascadeStopped?.({ reason: "loop", hop: ctx.hop });
      return;
    }

    for (const id of nextTargets) everDispatched.add(id);
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
  activeTasks?: ActiveTaskSummary[];
}

async function dispatchOne(args: DispatchOneArgs): Promise<DispatchReply | null> {
  const { agentId, ctx, opts, isUserHop, activeTasks } = args;
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

  // Every member sees the full team conversation (accio-style shared context).
  // This is what lets Eva build on Tian's research, Luna build on Eva's spec,
  // etc. — the value of "team" over isolated subagents.
  const groupActivity = buildGroupActivity(teamMessages, lastSelfTs, triggerTs, nameMap);
  const selfAgent = state.agents.find(a => a.id === agentId);
  const selfName = selfAgent?.name ?? agentId;
  const self = {
    agentId,
    name: selfName,
    role: (agentId === tlId ? "TL" : "Member") as "TL" | "Member",
  };

  // Skip orphan ids (agents removed from gateway but still in team.agentIds) so
  // the prompt never instructs anyone to @-mention non-existent members.
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

  // Build per-agent active-tasks block. "Mine" = tasks assigned to this
  // agent (any active status). "Other count" = team-wide active tasks where
  // I'm NOT the assignee.
  let activeTasksRendered: string | null = null;
  if (activeTasks && activeTasks.length > 0) {
    const isActive = (s: string) =>
      s === "in_progress" || s === "pending" || s === "blocked";
    const mine = activeTasks
      .filter(t => t.assignee === agentId && isActive(t.status))
      .slice(0, 10)
      .map(t => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        blockedReason: t.blockedReason,
      }));
    const otherActiveCount = activeTasks.filter(
      t => t.assignee !== agentId && isActive(t.status),
    ).length;
    activeTasksRendered = renderActiveTasks({ myTasks: mine, otherActiveCount });
  }

  const prompt = assembleAgentPrompt({
    team,
    roster,
    self,
    groupActivity,
    userText: isUserHop ? opts.userContent : "",
    isDirectMention,
    activeTasks: activeTasksRendered,
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
