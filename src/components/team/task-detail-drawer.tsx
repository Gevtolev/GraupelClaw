"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TeamTask, TaskStatus } from "@/lib/team/team-tasks/types";
import type { Agent } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { TaskStatusIcon, statusLabel } from "./task-status-icon";

interface TaskDetailDrawerProps {
  task: TeamTask | null;
  teamMembers: Agent[];
  onClose: () => void;
  onUpdate: (taskId: string, patch: Partial<TeamTask>) => Promise<void>;
}

const STATUSES: TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "failed",
];

export function TaskDetailDrawer({
  task,
  teamMembers,
  onClose,
  onUpdate,
}: TaskDetailDrawerProps) {
  const [draft, setDraft] = useState<TeamTask | null>(task);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<TaskStatus | null>(null);

  useEffect(() => {
    setDraft(task);
    setDirty(false);
    setError(null);
    setConfirmStatus(null);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task || !draft) return null;

  const isAgentOwned = task.createdBy === "agent" || task.createdBy === "tl";

  function patch<K extends keyof TeamTask>(key: K, val: TeamTask[K]) {
    setDraft((d) => (d ? { ...d, [key]: val } : d));
    setDirty(true);
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const patchObj: Partial<TeamTask> = {
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        status: draft.status,
        blockedReason: draft.blockedReason,
        failedReason: draft.failedReason,
      };
      await onUpdate(draft.id, patchObj);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  function handleStatusClick(s: TaskStatus) {
    if (!draft) return;
    if (s === draft.status) return;
    if (isAgentOwned) {
      setConfirmStatus(s);
    } else {
      patch("status", s);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Task detail"
      className="fixed inset-y-0 right-0 z-50 w-[400px] max-w-full bg-background border-l shadow-xl flex flex-col"
    >
      <div className="flex items-start justify-between gap-2 p-4 border-b">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-mono mb-1">{task.id}</p>
          <Input
            value={draft.title}
            onChange={(e) => patch("title", e.target.value)}
            className="text-base font-semibold border-none px-0 focus-visible:ring-0"
            disabled={isAgentOwned}
          />
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <div>
          <Label className="text-xs uppercase text-muted-foreground">Status</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleStatusClick(s)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors ${draft.status === s ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border hover:bg-muted"}`}
              >
                <TaskStatusIcon status={s} className="h-3 w-3" />
                {statusLabel(s)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase text-muted-foreground">Priority</Label>
          <div className="mt-2 flex gap-1.5">
            {(["P0", "P1", "P2"] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={isAgentOwned}
                onClick={() => patch("priority", p)}
                className={`px-3 py-1 rounded text-xs font-semibold border ${draft.priority === p ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 text-muted-foreground border-border"} disabled:opacity-50`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label className="text-xs uppercase text-muted-foreground">Assignee</Label>
          <p className="mt-2 text-sm">
            {teamMembers.find((m) => m.id === draft.assignee)?.name ??
              draft.assigneeName ??
              draft.assignee}
          </p>
        </div>

        <Separator />

        <div>
          <Label className="text-xs uppercase text-muted-foreground">Description</Label>
          <textarea
            value={draft.description ?? ""}
            onChange={(e) => patch("description", e.target.value)}
            disabled={isAgentOwned}
            rows={5}
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-70"
            placeholder="No description"
          />
        </div>

        {draft.status === "blocked" && (
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Blocked reason</Label>
            <Input
              value={draft.blockedReason ?? ""}
              onChange={(e) => patch("blockedReason", e.target.value)}
              placeholder="Why is this blocked?"
              className="mt-1"
            />
          </div>
        )}

        {draft.dependencies.length > 0 && (
          <div>
            <Label className="text-xs uppercase text-muted-foreground">Depends on</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {draft.dependencies.map((d) => (
                <span
                  key={d}
                  className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            Created by <strong>{task.createdBy}</strong> on{" "}
            {new Date(task.createdAt).toLocaleString()}
          </div>
          <div>Updated {new Date(task.updatedAt).toLocaleString()}</div>
        </div>
      </div>

      <div className="border-t p-3 flex items-center justify-between gap-2">
        {error && (
          <p className="text-xs text-destructive flex-1 truncate">{error}</p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {confirmStatus && (
        <div className="absolute inset-0 bg-background/95 flex items-center justify-center z-10">
          <div className="rounded-lg border bg-card p-4 max-w-sm shadow-xl">
            <h3 className="font-semibold mb-2">Override status?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This task is being managed by an agent. Forcing status to{" "}
              <strong>{statusLabel(confirmStatus)}</strong> may diverge from
              what the agent expects.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirmStatus(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  patch("status", confirmStatus);
                  setConfirmStatus(null);
                }}
              >
                Override
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
