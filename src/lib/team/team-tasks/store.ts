import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type {
  CounterFile,
  CreateTaskInput,
  TeamTask,
  UpdateTaskInput,
} from "./types";

/**
 * Filesystem-backed task store. Each team workspace has:
 *   {workspaceRoot}/.team/tasks/_counter.json
 *   {workspaceRoot}/.team/tasks/{conversationId}/{taskId}.json
 *
 * Concurrency: a per-resource in-memory mutex serializes writes (single Next.js
 * process). Atomic write via temp-file + rename. LIST handles the read-during-
 * rename race by skipping ENOENT/SyntaxError files.
 */

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Track the lock; on completion (success OR failure), drop it so the chain
  // doesn't grow forever.
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, settled);
  try {
    return await next;
  } finally {
    if (locks.get(key) === settled) {
      locks.delete(key);
    }
  }
}

function tasksDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".team", "tasks");
}

function counterFile(workspaceRoot: string): string {
  return path.join(tasksDir(workspaceRoot), "_counter.json");
}

function conversationDir(workspaceRoot: string, conversationId: string): string {
  return path.join(tasksDir(workspaceRoot), conversationId);
}

function taskFile(
  workspaceRoot: string,
  conversationId: string,
  taskId: string,
): string {
  return path.join(conversationDir(workspaceRoot, conversationId), `${taskId}.json`);
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, target);
}

async function nextTaskNumber(workspaceRoot: string): Promise<number> {
  return withLock(`counter:${workspaceRoot}`, async () => {
    const file = counterFile(workspaceRoot);
    let counter: CounterFile;
    try {
      const raw = await fs.readFile(file, "utf8");
      counter = JSON.parse(raw) as CounterFile;
      if (typeof counter.next !== "number") {
        counter = { schemaVersion: 1, next: 1 };
      }
    } catch {
      counter = { schemaVersion: 1, next: 1 };
    }
    const num = counter.next;
    await atomicWriteJson(file, {
      schemaVersion: 1,
      next: num + 1,
    } satisfies CounterFile);
    return num;
  });
}

function formatTaskId(n: number): string {
  return `TASK-${String(n).padStart(3, "0")}`;
}

export async function createTask(
  workspaceRoot: string,
  teamId: string,
  input: CreateTaskInput,
): Promise<TeamTask> {
  const now = new Date().toISOString();
  const num = await nextTaskNumber(workspaceRoot);
  const id = formatTaskId(num);
  const task: TeamTask = {
    schemaVersion: 1,
    id,
    title: input.title,
    description: input.description,
    assignee: input.assignee,
    assigneeName: input.assigneeName,
    status: "pending",
    priority: input.priority ?? "P1",
    dependencies: input.dependencies ?? [],
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? "agent",
    conversationId: input.conversationId,
    teamId,
  };
  const target = taskFile(workspaceRoot, input.conversationId, id);
  await withLock(`task:${id}`, () => atomicWriteJson(target, task));
  return task;
}

export async function getTask(
  workspaceRoot: string,
  conversationId: string,
  taskId: string,
): Promise<TeamTask | null> {
  const file = taskFile(workspaceRoot, conversationId, taskId);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as TeamTask;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || e instanceof SyntaxError) return null;
    throw err;
  }
}

export async function updateTask(
  workspaceRoot: string,
  conversationId: string,
  taskId: string,
  patch: UpdateTaskInput,
): Promise<TeamTask | null> {
  return withLock(`task:${taskId}`, async () => {
    const file = taskFile(workspaceRoot, conversationId, taskId);
    let existing: TeamTask;
    try {
      const raw = await fs.readFile(file, "utf8");
      existing = JSON.parse(raw) as TeamTask;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT" || e instanceof SyntaxError) return null;
      throw err;
    }
    const merged: TeamTask = {
      ...existing,
      ...patch,
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    await atomicWriteJson(file, merged);
    return merged;
  });
}

export interface ListFilter {
  conversationId?: string;
  status?: TeamTask["status"];
  assignee?: string;
  limit?: number;
}

export async function listTasks(
  workspaceRoot: string,
  filter: ListFilter = {},
): Promise<TeamTask[]> {
  const root = tasksDir(workspaceRoot);
  let conversationDirs: string[];
  if (filter.conversationId) {
    conversationDirs = [conversationDir(workspaceRoot, filter.conversationId)];
  } else {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      conversationDirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => path.join(root, e.name));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }
  }

  const tasks: TeamTask[] = [];
  for (const dir of conversationDirs) {
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") continue;
      throw err;
    }
    for (const name of files) {
      if (!name.endsWith(".json") || name.startsWith("_")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), "utf8");
        const task = JSON.parse(raw) as TeamTask;
        tasks.push(task);
      } catch (err) {
        // Skip files mid-rename or with corrupt JSON. Logged once to console.
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT" || e instanceof SyntaxError) continue;
        // Genuine errors bubble up.
        throw err;
      }
    }
  }

  let result = tasks;
  if (filter.status) result = result.filter((t) => t.status === filter.status);
  if (filter.assignee)
    result = result.filter((t) => t.assignee === filter.assignee);
  // Sort: status priority asc (in_progress first), createdAt asc.
  // Caller can re-sort if needed.
  result.sort((a, b) => {
    const sp =
      STATUS_PRIORITY_INTERNAL[a.status] - STATUS_PRIORITY_INTERNAL[b.status];
    if (sp !== 0) return sp;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
  if (filter.limit && result.length > filter.limit) {
    result = result.slice(0, filter.limit);
  }
  return result;
}

const STATUS_PRIORITY_INTERNAL: Record<TeamTask["status"], number> = {
  in_progress: 0,
  blocked: 1,
  pending: 2,
  completed: 3,
  failed: 4,
};
