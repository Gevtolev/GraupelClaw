"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ListTodo, Plus, X } from "lucide-react";
import type { TeamTask, TaskStatus } from "@/lib/team/team-tasks/types";
import type { Agent, AgentTeam } from "@/types";
import { useChatStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { TaskCard } from "./task-card";
import { TaskDetailDrawer } from "./task-detail-drawer";
import { CreateTaskDialog } from "./task-create-dialog";

interface TaskPanelProps {
  open: boolean;
  onClose: () => void;
  team: AgentTeam;
  conversationId: string;
  teamMembers: Agent[];
}

const COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "completed", label: "Done" },
];

export function TaskPanel({
  open,
  onClose,
  team,
  conversationId,
  teamMembers,
}: TaskPanelProps) {
  const chatStore = useChatStore();
  const tasks = chatStore.state.teamTasks[conversationId] ?? [];

  const [filter, setFilter] = useState<Set<string>>(new Set());
  const [activeTask, setActiveTask] = useState<TeamTask | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  const workspaceRoot = team.workspaceRoot;

  // Active panel polls every 3s for fresh tasks.
  useEffect(() => {
    if (!open || !workspaceRoot) return;
    let cancelled = false;
    async function tick() {
      try {
        const params = new URLSearchParams({ workspaceRoot: workspaceRoot!, conversationId });
        const res = await fetch(`/api/team-tasks?${params}`);
        if (!res.ok) return;
        const data = (await res.json()) as { tasks: TeamTask[] };
        if (cancelled) return;
        chatStore.dispatch({
          type: "SET_TEAM_TASKS",
          conversationId,
          tasks: data.tasks,
        });
      } catch {
        /* swallow — keep stale tasks visible */
      }
    }
    void tick();
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => {
      if (!document.hidden) void tick();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, workspaceRoot, conversationId, chatStore]);

  const filtered = useMemo(() => {
    if (filter.size === 0) return tasks;
    return tasks.filter((t) => filter.has(t.assignee));
  }, [tasks, filter]);

  const grouped = useMemo(() => {
    const out: Record<TaskStatus, TeamTask[]> = {
      pending: [],
      in_progress: [],
      completed: [],
      blocked: [],
      failed: [],
    };
    for (const t of filtered) out[t.status].push(t);
    return out;
  }, [filtered]);

  const hidden = useMemo(() => {
    if (filter.size === 0) return { pending: 0, in_progress: 0, blocked: 0, completed: 0, failed: 0 };
    const c: Record<TaskStatus, number> = {
      pending: 0, in_progress: 0, blocked: 0, completed: 0, failed: 0,
    };
    for (const t of tasks) if (!filter.has(t.assignee)) c[t.status] += 1;
    return c;
  }, [tasks, filter]);

  function toggleFilter(agentId: string) {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  async function createTask(input: {
    title: string;
    description?: string;
    assignee: string;
    priority: "P0" | "P1" | "P2";
  }) {
    if (!workspaceRoot) throw new Error("team workspace not configured");
    const res = await fetch("/api/team-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        workspaceRoot,
        teamId: team.id,
        conversationId,
        createdBy: "user",
        assigneeName: teamMembers.find((m) => m.id === input.assignee)?.name,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "create failed");
    chatStore.dispatch({
      type: "UPDATE_TEAM_TASK",
      conversationId,
      task: data.task,
    });
  }

  async function updateTask(taskId: string, patch: Partial<TeamTask>) {
    if (!workspaceRoot) return;
    const res = await fetch(`/api/team-tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...patch, workspaceRoot, conversationId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "update failed");
    chatStore.dispatch({
      type: "UPDATE_TEAM_TASK",
      conversationId,
      task: data.task,
    });
    setActiveTask(data.task);
  }

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-label="Task board"
        className="fixed inset-y-0 right-0 z-50 w-[480px] max-w-[90vw] sm:w-[520px] bg-background border-l shadow-xl flex flex-col"
      >
        <div className="flex items-center justify-between gap-2 p-4 border-b">
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-semibold">Tasks</h2>
            <span className="text-xs text-muted-foreground">
              ({tasks.length})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="default"
              size="sm"
              onClick={() => setCreateOpen(true)}
              disabled={!workspaceRoot}
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> New
            </Button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!workspaceRoot ? (
          <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Configure a team workspace folder in Team Settings → Workspace
            before tasks can be tracked.
          </div>
        ) : (
          <>
            {teamMembers.length > 0 && (
              <div className="px-4 py-2 border-b flex items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setFilter(new Set())}
                  className={`text-xs px-2.5 py-1 rounded-full border ${filter.size === 0 ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border"}`}
                >
                  All
                </button>
                {teamMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="checkbox"
                    aria-checked={filter.has(m.id)}
                    onClick={() => toggleFilter(m.id)}
                    title={m.name}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border shrink-0 ${filter.has(m.id) ? "bg-primary/10 text-primary border-primary/40" : "bg-muted/30 text-muted-foreground border-border"}`}
                  >
                    <span className="h-4 w-4 rounded-full bg-muted overflow-hidden inline-block" />
                    {m.name}
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <ListTodo className="h-10 w-10 text-muted-foreground/40 mb-3" />
                  <p className="text-sm font-medium">No tasks yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Tasks will appear as agents work; or create one manually.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreateOpen(true)}
                    className="mt-4"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> New task
                  </Button>
                </div>
              ) : (
                <>
                  {COLUMNS.map((col) => (
                    <div key={col.id}>
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-2">
                        <span>{col.label}</span>
                        <span className="text-[10px] font-normal">
                          ({grouped[col.id].length})
                        </span>
                      </div>
                      <div className="space-y-2">
                        {grouped[col.id].map((t) => (
                          <TaskCard
                            key={t.id}
                            task={t}
                            agent={teamMembers.find((m) => m.id === t.assignee)}
                            onOpen={setActiveTask}
                          />
                        ))}
                        {grouped[col.id].length === 0 && (
                          <p className="text-xs text-muted-foreground italic px-1">
                            none
                          </p>
                        )}
                        {hidden[col.id] > 0 && (
                          <button
                            type="button"
                            onClick={() => setFilter(new Set())}
                            className="text-[11px] text-muted-foreground hover:text-foreground px-1"
                          >
                            {hidden[col.id]} hidden — clear filter
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {grouped.failed.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowFailed((v) => !v)}
                        className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1 mb-2"
                      >
                        <ChevronRight
                          className={`h-3 w-3 transition-transform ${showFailed ? "rotate-90" : ""}`}
                        />
                        Failed ({grouped.failed.length})
                      </button>
                      {showFailed && (
                        <div className="space-y-2 opacity-60">
                          {grouped.failed.map((t) => (
                            <TaskCard
                              key={t.id}
                              task={t}
                              agent={teamMembers.find((m) => m.id === t.assignee)}
                              onOpen={setActiveTask}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <CreateTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        teamMembers={teamMembers}
        onSubmit={createTask}
      />

      <TaskDetailDrawer
        task={activeTask}
        teamMembers={teamMembers}
        onClose={() => setActiveTask(null)}
        onUpdate={updateTask}
      />
    </>
  );
}
