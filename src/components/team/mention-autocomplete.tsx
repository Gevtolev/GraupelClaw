"use client";

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Users } from "lucide-react";
import type { Agent } from "@/types";
import { cn } from "@/lib/utils";
import { getAgentAvatarUrl, isEmojiAvatar, isImageAvatar } from "@/lib/avatar";

export interface MentionCandidate {
  agent: Agent;
}

export const MENTION_ALL = "__mention_all__";

export interface MentionAutocompleteHandle {
  moveUp: () => void;
  moveDown: () => void;
  /** Commit the currently-active item. Returns true if a selection was made. */
  commitActive: () => boolean;
}

interface Props {
  candidates: MentionCandidate[];
  query: string;
  onSelect: (agent: Agent | typeof MENTION_ALL) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

type Item = { kind: "all" } | { kind: "agent"; agent: Agent };

export const MentionAutocomplete = forwardRef<MentionAutocompleteHandle, Props>(function MentionAutocomplete(
  { candidates, query, onSelect, onClose, anchorRect },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  const q = query.toLowerCase();
  const filtered = candidates.filter(c => c.agent.name.toLowerCase().includes(q));
  const showAll = candidates.length > 1 && (q === "" || "all".startsWith(q));

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (showAll) out.push({ kind: "all" });
    for (const c of filtered) out.push({ kind: "agent", agent: c.agent });
    return out;
  }, [filtered, showAll]);

  const [activeIdx, setActiveIdx] = useState(0);
  // Reset selection to first item whenever the filtered list changes shape.
  useEffect(() => {
    setActiveIdx(0);
  }, [items.length, query]);

  function commitItem(item: Item) {
    if (item.kind === "all") onSelect(MENTION_ALL);
    else onSelect(item.agent);
  }

  useImperativeHandle(forwardedRef, () => ({
    moveUp() {
      setActiveIdx(i => (items.length === 0 ? 0 : (i - 1 + items.length) % items.length));
    },
    moveDown() {
      setActiveIdx(i => (items.length === 0 ? 0 : (i + 1) % items.length));
    },
    commitActive() {
      const item = items[activeIdx];
      if (!item) return false;
      commitItem(item);
      return true;
    },
  }), [items, activeIdx]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  if (!anchorRect || items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="fixed z-50 w-64 rounded-md border bg-background shadow-md"
      style={{
        top: anchorRect.top - 8,
        left: anchorRect.left,
        transform: "translateY(-100%)",
      }}
    >
      <ul className="max-h-48 overflow-y-auto p-1">
        {items.map((item, idx) => {
          const isActive = idx === activeIdx;
          const rowClass = cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            isActive ? "bg-accent" : "hover:bg-accent",
          );
          if (item.kind === "all") {
            return (
              <li key="__all">
                <button
                  onClick={() => commitItem(item)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={rowClass}
                >
                  <span className="h-5 w-5 rounded-full bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
                    <Users className="h-3 w-3 text-primary" />
                  </span>
                  <span className="font-medium">all</span>
                  <span className="text-xs text-muted-foreground ml-auto">notify everyone</span>
                </button>
              </li>
            );
          }
          const a = item.agent;
          return (
            <li key={a.id}>
              <button
                onClick={() => commitItem(item)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={rowClass}
              >
                {isEmojiAvatar(a.avatar) ? (
                  <span className="h-5 w-5 flex items-center justify-center text-sm">{a.avatar}</span>
                ) : (
                  <img
                    src={isImageAvatar(a.avatar) ? a.avatar : getAgentAvatarUrl(a.id, a.specialty)}
                    alt={a.name}
                    className="h-5 w-5 rounded-full bg-muted object-cover"
                  />
                )}
                <span>{a.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});
