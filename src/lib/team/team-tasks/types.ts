export type TaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "failed";

export type TaskPriority = "P0" | "P1" | "P2";

export type TaskCreator = "user" | "tl" | "agent" | "system";

export interface TeamTask {
  schemaVersion: 1;
  /** Human-readable id like `TASK-007`. Stable per team. */
  id: string;
  title: string;
  description?: string;
  /** Agent id of the assignee. */
  assignee: string;
  /** Snapshot of assignee's display name at create time. */
  assigneeName?: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Task ids that must complete first. Advisory only — not enforced server-side. */
  dependencies: string[];
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  createdBy: TaskCreator;
  conversationId: string;
  teamId: string;
  blockedReason?: string;
  failedReason?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  assignee: string;
  assigneeName?: string;
  priority?: TaskPriority;
  dependencies?: string[];
  conversationId: string;
  createdBy?: TaskCreator;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  blockedReason?: string;
  failedReason?: string;
}

export interface CounterFile {
  schemaVersion: 1;
  next: number;
}

/**
 * Sort key for displaying active tasks in the prompt or UI.
 *  in_progress > blocked > pending > completed > failed
 *  then by createdAt asc.
 */
export const STATUS_PRIORITY: Record<TaskStatus, number> = {
  in_progress: 0,
  blocked: 1,
  pending: 2,
  completed: 3,
  failed: 4,
};
