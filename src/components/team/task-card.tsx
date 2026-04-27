"use client";

import { Link2, Lock } from "lucide-react";
import type { TeamTask } from "@/lib/team/team-tasks/types";
import { cn } from "@/lib/utils";
import { getAgentAvatarUrl, isEmojiAvatar, isImageAvatar } from "@/lib/avatar";
import type { Agent } from "@/types";
import { STATUS_BORDER, TaskStatusIcon } from "./task-status-icon";

interface TaskCardProps {
  task: TeamTask;
  agent?: Agent;
  onOpen: (task: TeamTask) => void;
}

const PRIORITY_CLASSES: Record<TeamTask["priority"], string> = {
  P0: "bg-red-500/15 text-red-600 dark:text-red-400 ring-red-500/30",
  P1: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30",
  P2: "bg-muted text-muted-foreground ring-border",
};

export function TaskCard({ task, agent, onOpen }: TaskCardProps) {
  const isAgentOwned = task.createdBy === "agent" || task.createdBy === "tl";
  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cn(
        "group block w-full rounded-lg border bg-card p-3 text-left",
        "hover:bg-muted/40 transition-colors focus-visible:ring-2 focus-visible:ring-primary",
        "border-b-2",
        STATUS_BORDER[task.status],
      )}
      aria-label={`${task.title}, ${task.status}, assigned to ${task.assigneeName ?? task.assignee}, priority ${task.priority}`}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1",
            PRIORITY_CLASSES[task.priority],
          )}
        >
          {task.priority}
        </span>
        <TaskStatusIcon status={task.status} />
        <span className="flex-1 text-sm leading-snug line-clamp-2 break-words">
          {task.title}
        </span>
        {isAgentOwned && (
          <Lock
            className="h-3.5 w-3.5 text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            aria-label="Managed by agent"
          />
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {agent ? (
          isEmojiAvatar(agent.avatar) ? (
            <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-sm">
              {agent.avatar}
            </span>
          ) : (
            <img
              src={isImageAvatar(agent.avatar) ? agent.avatar : getAgentAvatarUrl(agent.id, agent.specialty)}
              alt={agent.name}
              className="h-6 w-6 rounded-full bg-muted object-cover"
            />
          )
        ) : (
          <span className="h-6 w-6 rounded-full bg-muted" />
        )}
        <span className="text-xs text-muted-foreground truncate">
          {task.assigneeName ?? agent?.name ?? task.assignee}
        </span>
        {task.dependencies.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Link2 className="h-3 w-3" />
            {task.dependencies.length}
          </span>
        )}
      </div>
      {task.status === "blocked" && task.blockedReason && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400 line-clamp-2">
          {task.blockedReason}
        </p>
      )}
    </button>
  );
}
