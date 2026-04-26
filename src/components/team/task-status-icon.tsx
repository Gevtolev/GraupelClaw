"use client";

import { Ban, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "pending" | "in_progress" | "completed" | "blocked" | "failed";

const ICONS = {
  pending: Circle,
  in_progress: Loader2,
  completed: CheckCircle2,
  blocked: Ban,
  failed: XCircle,
} as const;

const COLORS: Record<Status, string> = {
  pending: "text-muted-foreground",
  in_progress: "text-blue-500",
  completed: "text-emerald-500",
  blocked: "text-amber-500",
  failed: "text-destructive",
};

export const STATUS_BORDER: Record<Status, string> = {
  pending: "border-muted-foreground/30",
  in_progress: "border-blue-500",
  completed: "border-emerald-500",
  blocked: "border-amber-500",
  failed: "border-destructive",
};

export function TaskStatusIcon({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const Icon = ICONS[status];
  return (
    <Icon
      className={cn(
        "h-4 w-4 shrink-0",
        COLORS[status],
        status === "in_progress" && "animate-spin",
        className,
      )}
      aria-hidden
    />
  );
}

export function statusLabel(s: Status): string {
  switch (s) {
    case "pending":
      return "Pending";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "blocked":
      return "Blocked";
    case "failed":
      return "Failed";
  }
}
