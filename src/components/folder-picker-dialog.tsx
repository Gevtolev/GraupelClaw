"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Home as HomeIcon,
  Loader2,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DirEntry {
  name: string;
  hasChildren: boolean;
}

export interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Path to start at. Falls back to the user's home directory. */
  defaultPath?: string;
  onSelect: (path: string) => void;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  defaultPath,
  onSelect,
}: FolderPickerDialogProps) {
  const [home, setHome] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const newInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const navigate = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/fs/list-dirs?path=${encodeURIComponent(path)}${showHidden ? "&showHidden=true" : ""}`,
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "failed to list directory");
          return;
        }
        setCurrentPath(data.path);
        setDirs(data.dirs ?? []);
        setTruncated(Boolean(data.truncated));
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed to list directory");
      } finally {
        setLoading(false);
      }
    },
    [showHidden],
  );

  // On open: fetch home + navigate to defaultPath or home.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/fs/home");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "cannot read home directory");
          setLoading(false);
          return;
        }
        setHome(data.home);
        const startAt = defaultPath || data.home;
        await navigate(startAt);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "init failed");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-fetch when toggling showHidden.
  useEffect(() => {
    if (!open || !currentPath) return;
    void navigate(currentPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  function up() {
    if (!currentPath || !home) return;
    if (currentPath === home) return;
    const parent = currentPath.replace(/\/[^/]+\/?$/, "") || "/";
    void navigate(parent);
  }

  function enter(name: string) {
    if (!currentPath) return;
    const next = currentPath.endsWith("/")
      ? currentPath + name
      : `${currentPath}/${name}`;
    void navigate(next);
  }

  function startCreate() {
    setCreating(true);
    setNewName("");
    setTimeout(() => newInputRef.current?.focus(), 50);
  }

  async function confirmCreate() {
    if (!currentPath || !newName.trim()) {
      setCreating(false);
      return;
    }
    const target = `${currentPath}/${newName.trim()}`;
    try {
      const res = await fetch("/api/fs/create-dir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: target }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "could not create folder");
        return;
      }
      setCreating(false);
      setNewName("");
      await navigate(currentPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not create folder");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (creating) return;
    if (e.key === "Backspace" && !creating && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      up();
    }
  }

  // Breadcrumb segments from currentPath.
  const segments = currentPath
    ? currentPath.split("/").filter(Boolean)
    : [];
  function clickSegment(idx: number) {
    const target = "/" + segments.slice(0, idx + 1).join("/");
    void navigate(target);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[560px] max-h-[80vh] flex flex-col"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle>Choose folder</DialogTitle>
          <DialogDescription>
            Pick or create a folder for this team&apos;s shared workspace.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm text-muted-foreground border-b pb-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => home && void navigate(home)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-muted"
            title="Home"
          >
            <HomeIcon className="h-3.5 w-3.5" />
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 opacity-50" />
              <button
                type="button"
                onClick={() => clickSegment(i)}
                className="px-1.5 py-0.5 rounded hover:bg-muted truncate max-w-[180px]"
                title={seg}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* Path display */}
        <div className="text-xs text-muted-foreground font-mono break-all px-1">
          {currentPath ?? "—"}
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto border rounded-md">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
            </div>
          ) : error ? (
            <div className="text-sm text-destructive p-4">{error}</div>
          ) : (
            <ul ref={listRef} className="divide-y">
              {creating && (
                <li className="flex items-center gap-2 px-3 py-2">
                  <FolderPlus className="h-4 w-4 text-primary" />
                  <input
                    ref={newInputRef}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void confirmCreate();
                      else if (e.key === "Escape") {
                        setCreating(false);
                        setNewName("");
                      }
                    }}
                    placeholder="new folder name"
                    className="flex-1 bg-transparent outline-none text-sm"
                  />
                </li>
              )}
              {dirs.length === 0 && !creating ? (
                <li className="text-sm text-muted-foreground p-4">
                  Empty folder.
                </li>
              ) : (
                dirs.map((d) => (
                  <li key={d.name}>
                    <button
                      type="button"
                      onClick={() => enter(d.name)}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors"
                    >
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{d.name}</span>
                    </button>
                  </li>
                ))
              )}
              {truncated && (
                <li className="text-xs text-muted-foreground p-3 italic">
                  …showing first 200 entries.
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={startCreate}
              disabled={creating || !currentPath || loading}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded hover:bg-muted disabled:opacity-50"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New folder
            </button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="h-3 w-3"
              />
              Show hidden
            </label>
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm rounded hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (currentPath) {
                onSelect(currentPath);
                onOpenChange(false);
              }
            }}
            disabled={!currentPath || loading}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            Use this folder
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
