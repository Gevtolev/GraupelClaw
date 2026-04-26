"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export interface MarkDecisionInput {
  title: string;
  decidedBy: string;
  context?: string;
  rationale: string;
  rejected?: string;
  affects?: string;
}

interface MarkDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill: agent name authoring the decision (or "User") */
  defaultDecidedBy: string;
  /** Optional pre-fill for rationale (typically a slice of the message). */
  defaultRationale?: string;
  defaultContext?: string;
  onSubmit: (input: MarkDecisionInput) => Promise<void> | void;
}

export function MarkDecisionDialog({
  open,
  onOpenChange,
  defaultDecidedBy,
  defaultRationale,
  defaultContext,
  onSubmit,
}: MarkDecisionDialogProps) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState(defaultContext ?? "");
  const [rationale, setRationale] = useState(defaultRationale ?? "");
  const [rejected, setRejected] = useState("");
  const [affects, setAffects] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setContext(defaultContext ?? "");
      setRationale(defaultRationale ?? "");
      setRejected("");
      setAffects("");
      setError(null);
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !rationale.trim()) {
      setError("Title and rationale are required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: title.trim(),
        decidedBy: defaultDecidedBy,
        context: context.trim() || undefined,
        rationale: rationale.trim(),
        rejected: rejected.trim() || undefined,
        affects: affects.trim() || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Mark as decision</DialogTitle>
          <DialogDescription>
            Persist this to the team&apos;s decision log so future sessions
            don&apos;t relitigate it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="d-title">Title</Label>
            <Input
              id="d-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Summarize the decision in one line"
              maxLength={200}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="d-context">Context (optional)</Label>
            <textarea
              id="d-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              maxLength={500}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="What prompted this decision?"
            />
          </div>
          <div>
            <Label htmlFor="d-rationale">Rationale</Label>
            <textarea
              id="d-rationale"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              rows={3}
              maxLength={1000}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Why this option won"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="d-rejected">Rejected (optional)</Label>
              <textarea
                id="d-rejected"
                value={rejected}
                onChange={(e) => setRejected(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="What was discarded"
              />
            </div>
            <div>
              <Label htmlFor="d-affects">Affects (optional)</Label>
              <textarea
                id="d-affects"
                value={affects}
                onChange={(e) => setAffects(e.target.value)}
                rows={2}
                className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Who/what is impacted"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Decided by: <strong>{defaultDecidedBy}</strong>
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !title.trim() || !rationale.trim()}>
              {submitting ? "Saving…" : "Save decision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
