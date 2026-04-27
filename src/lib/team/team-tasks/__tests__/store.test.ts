import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTask, getTask, listTasks, updateTask } from "../store";

let workspace: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), "p3-tasks-"));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("team-tasks store", () => {
  it("creates a task with TASK-001 id and stores it on disk", async () => {
    const task = await createTask(workspace, "team-1", {
      title: "First",
      assignee: "agent-eva",
      conversationId: "conv-1",
    });
    expect(task.id).toBe("TASK-001");
    expect(task.status).toBe("pending");
    expect(task.priority).toBe("P1");
    expect(task.dependencies).toEqual([]);

    const file = path.join(
      workspace,
      ".team",
      "tasks",
      "conv-1",
      "TASK-001.json",
    );
    const raw = await fs.readFile(file, "utf8");
    expect(JSON.parse(raw).id).toBe("TASK-001");
  });

  it("counter increments across creates", async () => {
    const a = await createTask(workspace, "t", {
      title: "A",
      assignee: "x",
      conversationId: "c1",
    });
    const b = await createTask(workspace, "t", {
      title: "B",
      assignee: "x",
      conversationId: "c1",
    });
    const c = await createTask(workspace, "t", {
      title: "C",
      assignee: "x",
      conversationId: "c2",
    });
    expect([a.id, b.id, c.id]).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
  });

  it("counter is atomic under parallel creates", async () => {
    const tasks = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createTask(workspace, "t", {
          title: `T${i}`,
          assignee: "x",
          conversationId: "c1",
        }),
      ),
    );
    const ids = tasks.map((t) => t.id).sort();
    expect(new Set(ids).size).toBe(8); // unique
    expect(ids[0]).toBe("TASK-001");
    expect(ids[7]).toBe("TASK-008");
  });

  it("getTask returns the saved task", async () => {
    const created = await createTask(workspace, "t", {
      title: "G",
      assignee: "y",
      conversationId: "c1",
    });
    const fetched = await getTask(workspace, "c1", created.id);
    expect(fetched?.title).toBe("G");
  });

  it("getTask returns null for missing", async () => {
    const r = await getTask(workspace, "c1", "TASK-999");
    expect(r).toBeNull();
  });

  it("updateTask merges and refreshes updatedAt", async () => {
    const t = await createTask(workspace, "t", {
      title: "U",
      assignee: "y",
      conversationId: "c1",
    });
    await new Promise((r) => setTimeout(r, 5));
    const updated = await updateTask(workspace, "c1", t.id, {
      status: "in_progress",
    });
    expect(updated?.status).toBe("in_progress");
    expect(updated?.updatedAt).not.toBe(t.updatedAt);
    expect(updated?.title).toBe("U"); // unchanged fields preserved
  });

  it("updateTask returns null for missing task", async () => {
    const r = await updateTask(workspace, "c1", "TASK-999", { status: "completed" });
    expect(r).toBeNull();
  });

  it("listTasks returns all in conversation, sorted", async () => {
    await createTask(workspace, "t", {
      title: "A",
      assignee: "x",
      conversationId: "c1",
    });
    const t2 = await createTask(workspace, "t", {
      title: "B",
      assignee: "x",
      conversationId: "c1",
    });
    await updateTask(workspace, "c1", t2.id, { status: "in_progress" });
    const list = await listTasks(workspace, { conversationId: "c1" });
    expect(list[0].id).toBe(t2.id); // in_progress sorts first
    expect(list).toHaveLength(2);
  });

  it("listTasks filters by status", async () => {
    const t1 = await createTask(workspace, "t", {
      title: "A",
      assignee: "x",
      conversationId: "c1",
    });
    await createTask(workspace, "t", {
      title: "B",
      assignee: "x",
      conversationId: "c1",
    });
    await updateTask(workspace, "c1", t1.id, { status: "completed" });
    const list = await listTasks(workspace, {
      conversationId: "c1",
      status: "pending",
    });
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("B");
  });

  it("listTasks filters by assignee", async () => {
    await createTask(workspace, "t", {
      title: "A",
      assignee: "alice",
      conversationId: "c1",
    });
    await createTask(workspace, "t", {
      title: "B",
      assignee: "bob",
      conversationId: "c1",
    });
    const list = await listTasks(workspace, {
      conversationId: "c1",
      assignee: "alice",
    });
    expect(list).toHaveLength(1);
  });

  it("listTasks across all conversations when no filter", async () => {
    await createTask(workspace, "t", {
      title: "A",
      assignee: "x",
      conversationId: "c1",
    });
    await createTask(workspace, "t", {
      title: "B",
      assignee: "x",
      conversationId: "c2",
    });
    const list = await listTasks(workspace);
    expect(list).toHaveLength(2);
  });

  it("listTasks returns empty for missing tasks dir", async () => {
    const list = await listTasks(workspace, { conversationId: "nope" });
    expect(list).toEqual([]);
  });

  it("listTasks gracefully skips non-json files", async () => {
    await createTask(workspace, "t", {
      title: "A",
      assignee: "x",
      conversationId: "c1",
    });
    // Drop a stray non-json file in the conversation dir.
    await fs.writeFile(
      path.join(workspace, ".team", "tasks", "c1", "stray.txt"),
      "junk",
      "utf8",
    );
    const list = await listTasks(workspace, { conversationId: "c1" });
    expect(list).toHaveLength(1);
  });
});
