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
1. Decide whether to handle the request yourself or delegate to other agents.
2. Coordinate work and consolidate results.
3. For simple questions, answer directly without delegating.`
      : `# You are a Member of "${team.name}"
The TL coordinates the team. You respond when @mentioned.`;

  return `<team_context>
${roleHeader}

## Team roster
${rosterLines}

## Team coordination rules
- Delegate inside the team **only** by @-mentioning the target member. The
  preferred form is \`@[Name](agentId)\`, but a bare \`@Name\` works too —
  the dispatcher resolves the name against the roster.
- Use a mention only when assigning a new concrete task; don't @ yourself.
- **Do NOT use \`sessions_spawn\` to call other team members.** Spawned
  sub-sessions live outside the team conversation, so other members would
  never see the exchange. Stick to @-mentions for team-internal work;
  reserve \`sessions_spawn\` for one-off helpers that don't belong in the
  group log.
</team_context>`;
}
