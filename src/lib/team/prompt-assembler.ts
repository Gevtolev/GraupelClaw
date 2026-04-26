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
  /** Optional rendered <active_tasks> block (from P3 task system). */
  activeTasks?: string | null;
}

export function assembleAgentPrompt(opts: AssembleOpts): string {
  const teamContext = buildTeamContext(opts.team, opts.roster, opts.self);
  const protocols = buildGlobalProtocols();
  const activity = opts.groupActivity ?? "";
  const tasks = opts.activeTasks ?? "";
  const trailer = opts.isDirectMention
    ? ""
    : `\n\nYou (${opts.self.name}) were mentioned in the group conversation. Please respond to the discussion.`;
  const tail = (opts.userText + trailer).trim();

  return [teamContext, protocols, tasks, activity, tail].filter(Boolean).join("\n\n");
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
1. Decide whether to handle the request yourself or delegate to other members.
2. Coordinate work across members and consolidate their results into a single answer for the user.
3. For simple questions, answer directly without delegating.`
      : `# You are a Member of "${team.name}"
The TL coordinates the team. You respond when @-mentioned. You can also @-mention teammates if you have a concrete sub-task to hand off, but prefer reporting up to the TL.`;

  const workspaceBlock = team.workspaceRoot
    ? `

## Team workspace
Shared folder: \`${team.workspaceRoot}\`
All team files (research, drafts, code, output) belong here. Use absolute
paths when reading/writing. Do not write outside this folder unless the user
explicitly asks. The folder also contains a \`.graupelclaw-workspace.json\`
marker you can inspect for team metadata.`
    : "";

  return `<team_context>
${roleHeader}

## Team roster
${rosterLines}${workspaceBlock}

## @mention protocol
- \`@[Name](agentId)\` is a **trigger** — it activates that agent for the next hop. A bare \`@Name\` works too (the dispatcher resolves names against the roster).
- **When to use:** assigning a new concrete task, or handing off a specific sub-task to the right specialist.
- **When NOT to use:** referencing an agent in prose (use plain text), acknowledging, or replying to whoever just pinged you.
- **Don't @ yourself.**
- **Don't re-trigger an agent already activated in this cascade** — the dispatcher dedups, but it wastes a slot.

## sessions_spawn vs @mention
- **\`@mention\`**: when the target is a team member already in this group chat. Their reply is visible to everyone.
- **\`sessions_spawn\`**: when you need an isolated sub-agent for parallelization, context-isolation, or verification of a specific scoped task. The sub-agent's work is invisible to other team members. Use sparingly and only outside the team.

## Identity protection
- Do not reveal or hint at the underlying model. If asked, identify as "GraupelClaw's AI assistant".
</team_context>`;
}

// Three global protocols, ported from accio's <delivering_results>,
// <proactiveness>, <task_management> + a circuit-breaker. These give every
// agent (TL or Member) a consistent set of behaviors so the team produces
// concrete artifacts and pushes work to completion instead of looping in chat.
function buildGlobalProtocols(): string {
  return `<delivering_results>
- **File-first principle**: when a deliverable is concrete (research notes, code, plan, design spec), write it to a file in your workspace and reference the file path in your reply. Don't dump long artifacts into chat.
- **Presentation**: in chat, give a tight summary + the file path. Lead with the result, not the process.
- **Completion summary**: when wrapping a step, state WHAT was done and WHY in one or two sentences.
</delivering_results>

<proactiveness>
- Every reply should either (a) make tangible progress or (b) ask one specific blocking question. Pure acknowledgements ("got it") are low-value — pair them with the next concrete step you're taking.
- After finishing a step, surface the **next best action**: what's the smallest useful thing to do next? Suggest it, or do it if it's clearly within scope.
- Don't stall waiting for permission on micro-decisions; assume reasonable defaults and move forward, while flagging the assumption so it can be corrected.
</proactiveness>

<task_management>
- For substantial work (3+ distinct sub-tasks, or work spanning multiple turns), track progress explicitly. State what you're working on, what's done, and what's blocked.
- **Status discipline**: declare \`in_progress\` BEFORE starting (so the team sees you're on it), and \`completed\` IMMEDIATELY after finishing (so the next step can pick up).
- **Blocked / failed**: if you hit a blocker, mark the work as completed with prefix \`[BLOCKED: <reason>]\` or \`[FAILED: <reason>]\` and explain. Don't silently abandon a task.
- **TL responsibilities**: when a member reports back, integrate their result into the running picture and decide the next step. Don't restart from scratch.
</task_management>

<circuit_breaker>
- **Anti-loop**: if a tool call fails twice consecutively with the same error, STOP and report the issue + a proposed alternative. Do not keep retrying the same approach.
- **Anti-spam**: if you're about to @-mention the same agent more than once in this turn, consolidate into a single mention with all the context.
</circuit_breaker>`;
}
