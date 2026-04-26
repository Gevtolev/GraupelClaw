"use client";

import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/markdown-renderer";

interface DecisionsPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceRoot: string;
}

export function DecisionsPopover({
  open,
  onOpenChange,
  workspaceRoot,
}: DecisionsPopoverProps) {
  const [content, setContent] = useState<string>("");
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ workspaceRoot });
        const res = await fetch(`/api/team-decisions?${params}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "load failed");
          return;
        }
        setContent(data.content ?? "");
        setCount(data.sectionCount ?? 0);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, workspaceRoot]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            Team decisions
            {count > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                ({count})
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Persisted decision log at{" "}
            <code className="text-[11px]">.team/decisions.md</code> in the team
            workspace. Edit the file directly to revise.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto rounded-md border bg-muted/20 p-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !content ? (
            <p className="text-sm text-muted-foreground italic">
              No decisions yet. Hover any assistant reply and click the bookmark
              icon to record one.
            </p>
          ) : (
            <div className="text-sm">
              <MarkdownRenderer content={content} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
