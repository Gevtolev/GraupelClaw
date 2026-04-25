import type { AgentTeam } from "@/types";
import type { RosterEntry } from "./types";

interface Self {
  agentId: string;
  name: string;
  role: "TL" | "Member";
}

export interface AssembleOpts {
  team: AgentTeam;
  roster: RosterEntry[];
  self: Self;
  groupActivity: string | null;
  userText: string;
  isDirectMention: boolean;
}

export function assembleAgentPrompt(opts: AssembleOpts): string {
  const teamContext = buildTeamContext(opts.team, opts.roster, opts.self);
  const activity = opts.groupActivity ?? "";
  const trailer = opts.isDirectMention
    ? ""
    : `\n\nYou (${opts.self.name}) were mentioned in the group conversation. Please respond to the discussion.`;
  const tail = (opts.userText + trailer).trim();

  return [teamContext, activity, tail].filter(Boolean).join("\n\n");
}

function buildTeamContext(team: AgentTeam, roster: RosterEntry[], self: Self): string {
  const tl = roster.find(r => r.role === "TL");
  const tlMention = tl ? `@${tl.name}` : "the TL";
  const rosterLines = roster
    .map(r => {
      const tag = r.role === "TL" ? " (TL)" : "";
      const youMark = r.agentId === self.agentId ? " ← You" : "";
      const desc = r.description ? ` — ${r.description}` : "";
      return `- **${r.name}**${tag}${youMark}${desc} — trigger: \`@[${r.name}](${r.agentId})\``;
    })
    .join("\n");

  const roleHeader =
    self.role === "TL"
      ? `# You are the TL (Team Leader) of "${team.name}"

**Responsibilities:**
1. Decide whether to handle the request yourself or delegate to specific members.
2. After members reply, you'll be re-engaged automatically with their answers in your group activity. Decide whether to fan out again or consolidate and respond to the user.
3. For simple questions, answer the user directly without delegating.`
      : `# You are a Member of "${team.name}"
You work for the TL. The TL prompts you when there's a task that fits your role; you reply with your result. The TL is the only person who delegates inside this team.`;

  const memberFlow = self.role === "TL"
    ? `- You are the only dispatcher. @-mention any members you need to assign concrete sub-tasks to.
- After workers finish, you'll receive their replies via group_activity and be asked to continue. Decide whether to fan out again, refine, or wrap up.
- Avoid mentioning more than ~3 members in a single turn unless the user explicitly asked for a fan-out.`
    : `- **Always reply to the TL (\`${tlMention}\`).** The TL alone routes the team — @-mentions in your reply to other members will NOT trigger them; only the TL's mentions do.
- Focus on your own contribution. You're seeing the TL's prompts and your own past replies, not other members' work, so deliver a clean stand-alone answer.
- If you need information from another member, ask the TL ("could ${tlMention} loop in <Name>?").`;

  return `<team_context>
${roleHeader}

## Team roster
${rosterLines}

## Team coordination rules
- Delegations happen via @-mentions. Preferred form is \`@[Name](agentId)\`; a bare \`@Name\` also works (the dispatcher resolves names against the roster).
- ${self.role === "TL" ? "You" : "Only the TL"} may delegate by @-mention. Worker @-mentions in replies are treated as narrative only and do not trigger dispatches.
- Don't @ yourself.
- **Do NOT use \`sessions_spawn\` to call other team members** — spawned sessions are private and the rest of the team would not see them.

## Routing
${memberFlow}
</team_context>`;
}
