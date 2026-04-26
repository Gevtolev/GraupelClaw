#!/usr/bin/env node
/**
 * gpw — GraupelClaw team coordination CLI.
 *
 * Thin wrapper over the Next.js task API. Discovers the active team via a
 * `.team/gpw-config.json` file written by GraupelClaw on team activation.
 *
 * Discovery order for the config:
 *   1. $GPW_CONFIG (env)
 *   2. Walk up from cwd looking for `.team/gpw-config.json`
 *   3. --config <path> argument (last-wins)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

interface GpwConfig {
  schemaVersion: number;
  apiBase: string;
  graupelclawRoot: string;
  teamId: string;
  teamName: string;
  conversationId: string | null;
  agentNameById: Record<string, string>;
  workspaceRoot?: string;
}

async function loadConfig(explicit?: string): Promise<{ config: GpwConfig; workspaceRoot: string }> {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (process.env.GPW_CONFIG) candidates.push(process.env.GPW_CONFIG);

  // Walk up from cwd
  let cwd = process.cwd();
  for (let i = 0; i < 20; i++) {
    const candidate = path.join(cwd, ".team", "gpw-config.json");
    candidates.push(candidate);
    const parent = path.dirname(cwd);
    if (parent === cwd) break;
    cwd = parent;
  }

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate, "utf8");
      const config = JSON.parse(raw) as GpwConfig;
      const workspaceRoot = path.resolve(candidate, "..", "..");
      return { config, workspaceRoot };
    } catch {
      // try next
    }
  }
  throw new Error(
    "gpw: no team workspace found. Run this from within a GraupelClaw team's workspace, or pass --config <path>.",
  );
}

function resolveAssigneeId(
  config: GpwConfig,
  nameOrId: string,
): string {
  // Exact id match wins
  if (config.agentNameById[nameOrId]) return nameOrId;
  // Else try name match (case-insensitive)
  for (const [id, name] of Object.entries(config.agentNameById)) {
    if (name.toLowerCase() === nameOrId.toLowerCase()) return id;
  }
  // Fall through — server will reject if invalid
  return nameOrId;
}

async function apiCall(
  apiBase: string,
  method: "GET" | "POST" | "PATCH",
  path_: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${apiBase}${path_}`;
  const init: RequestInit = {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
  };
  if (body) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      typeof data === "object" && data && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return data;
}

interface Args {
  command: string;
  subcommand?: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { command: argv[0] ?? "", positional: [], flags: {} };
  if (!out.command) return out;
  let i = 1;
  // First arg after command may be a subcommand if it doesn't start with --
  if (argv[i] && !argv[i].startsWith("--")) {
    out.subcommand = argv[i];
    i += 1;
  }
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const flag = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out.flags[flag] = true;
        i += 1;
      } else {
        out.flags[flag] = next;
        i += 2;
      }
    } else {
      out.positional.push(a);
      i += 1;
    }
  }
  return out;
}

function flag(args: Args, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (!args.command || args.command === "--help" || args.command === "help") {
    printHelp();
    return 0;
  }
  const explicitConfig =
    typeof args.flags.config === "string" ? args.flags.config : undefined;
  const { config, workspaceRoot } = await loadConfig(explicitConfig);

  if (args.command === "task") {
    return runTask(args, config, workspaceRoot);
  }
  if (args.command === "decision") {
    // Stub for P5
    console.error("gpw: 'decision' not yet implemented in this build.");
    return 2;
  }
  if (args.command === "workspace") {
    if (args.subcommand === "path") {
      console.log(workspaceRoot);
      return 0;
    }
    console.error("gpw workspace: unknown subcommand. Try `gpw workspace path`.");
    return 2;
  }
  console.error(`gpw: unknown command '${args.command}'. Try \`gpw help\`.`);
  return 2;
}

async function runTask(args: Args, config: GpwConfig, workspaceRoot: string): Promise<number> {
  switch (args.subcommand) {
    case "create": {
      const title = flag(args, "title");
      const assigneeArg = flag(args, "assignee");
      if (!title || !assigneeArg) {
        console.error("gpw task create: --title and --assignee are required");
        return 2;
      }
      const assignee = resolveAssigneeId(config, assigneeArg);
      const priority = flag(args, "priority") ?? "P1";
      const depends = flag(args, "depends");
      const conversationId = flag(args, "conversation") ?? config.conversationId;
      if (!conversationId) {
        console.error("gpw task create: no conversation id (use --conversation or activate a team in GraupelClaw)");
        return 2;
      }
      const body = {
        workspaceRoot,
        teamId: config.teamId,
        title,
        assignee,
        assigneeName: config.agentNameById[assignee],
        priority,
        dependencies: depends ? depends.split(",").map((s) => s.trim()).filter(Boolean) : [],
        conversationId,
        createdBy: "agent",
      };
      const res = (await apiCall(config.apiBase, "POST", "/api/team-tasks", body)) as {
        task: { id: string };
      };
      console.log(`Created ${res.task.id}: ${title}`);
      return 0;
    }
    case "update": {
      const taskId = args.positional[0];
      if (!taskId) {
        console.error("gpw task update: task id required");
        return 2;
      }
      const status = flag(args, "status");
      const reason = flag(args, "reason");
      const conversationId = flag(args, "conversation") ?? config.conversationId;
      if (!conversationId) {
        console.error("gpw task update: no conversation id");
        return 2;
      }
      const body: Record<string, unknown> = {
        workspaceRoot,
        conversationId,
      };
      if (status) body.status = status;
      if (reason) {
        if (status === "blocked") body.blockedReason = reason;
        else if (status === "failed") body.failedReason = reason;
      }
      await apiCall(
        config.apiBase,
        "PATCH",
        `/api/team-tasks/${encodeURIComponent(taskId)}`,
        body,
      );
      console.log(`Updated ${taskId}${status ? ` → ${status}` : ""}`);
      return 0;
    }
    case "list": {
      const conversationId = flag(args, "conversation") ?? config.conversationId;
      const params = new URLSearchParams({ workspaceRoot });
      if (conversationId) params.set("conversationId", conversationId);
      const status = flag(args, "status");
      if (status) params.set("status", status);
      const assignee = flag(args, "assignee");
      if (assignee) params.set("assignee", resolveAssigneeId(config, assignee));
      const limit = flag(args, "limit");
      if (limit) params.set("limit", limit);
      const res = (await apiCall(
        config.apiBase,
        "GET",
        `/api/team-tasks?${params}`,
      )) as { tasks: Array<{ id: string; status: string; title: string; priority: string; assigneeName?: string }> };
      if (res.tasks.length === 0) {
        console.log("(no tasks)");
        return 0;
      }
      for (const t of res.tasks) {
        console.log(
          `${t.id} [${t.status}] ${t.title} (${t.priority})${t.assigneeName ? ` → @${t.assigneeName}` : ""}`,
        );
      }
      return 0;
    }
    case "get": {
      const taskId = args.positional[0];
      if (!taskId) {
        console.error("gpw task get: task id required");
        return 2;
      }
      const conversationId = flag(args, "conversation") ?? config.conversationId;
      if (!conversationId) {
        console.error("gpw task get: no conversation id");
        return 2;
      }
      const params = new URLSearchParams({
        workspaceRoot,
        conversationId,
      });
      const res = (await apiCall(
        config.apiBase,
        "GET",
        `/api/team-tasks/${encodeURIComponent(taskId)}?${params}`,
      )) as { task: unknown };
      console.log(JSON.stringify(res.task, null, 2));
      return 0;
    }
    default:
      console.error("gpw task: unknown subcommand. Try `gpw help`.");
      return 2;
  }
}

function printHelp(): void {
  console.log(`gpw — GraupelClaw team coordination CLI

Usage:
  gpw task create --title <t> --assignee <name|id> [--priority P0|P1|P2] [--depends TASK-001,TASK-002] [--conversation <id>]
  gpw task update <task-id> --status <pending|in_progress|completed|blocked|failed> [--reason <text>] [--conversation <id>]
  gpw task list [--status <s>] [--assignee <name|id>] [--limit N] [--conversation <id>]
  gpw task get <task-id> [--conversation <id>]
  gpw workspace path
  gpw help

Discovery:
  Reads .team/gpw-config.json from cwd up. Override with --config <path> or
  $GPW_CONFIG env var.
`);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`gpw: ${msg}`);
    process.exit(1);
  },
);
