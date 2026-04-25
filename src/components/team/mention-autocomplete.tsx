"use client";

import React, { useEffect, useRef } from "react";
import { Users } from "lucide-react";
import type { Agent } from "@/types";
import { cn } from "@/lib/utils";
import { getAgentAvatarUrl, isEmojiAvatar, isImageAvatar } from "@/lib/avatar";

export interface MentionCandidate {
  agent: Agent;
}

export const MENTION_ALL = "__mention_all__";

interface Props {
  candidates: MentionCandidate[];
  query: string;
  onSelect: (agent: Agent | typeof MENTION_ALL) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

export function MentionAutocomplete({ candidates, query, onSelect, onClose, anchorRect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const q = query.toLowerCase();
  const filtered = candidates.filter(c => c.agent.name.toLowerCase().includes(q));
  const showAll = candidates.length > 1 && (q === "" || "all".startsWith(q));

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  if (!anchorRect || (filtered.length === 0 && !showAll)) return null;

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
        {showAll && (
          <li>
            <button
              onClick={() => onSelect(MENTION_ALL)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
              )}
            >
              <span className="h-5 w-5 rounded-full bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center">
                <Users className="h-3 w-3 text-primary" />
              </span>
              <span className="font-medium">all</span>
              <span className="text-xs text-muted-foreground ml-auto">notify everyone</span>
            </button>
          </li>
        )}
        {filtered.map(c => (
          <li key={c.agent.id}>
            <button
              onClick={() => onSelect(c.agent)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
              )}
            >
              {isEmojiAvatar(c.agent.avatar) ? (
                <span className="h-5 w-5 flex items-center justify-center text-sm">{c.agent.avatar}</span>
              ) : (
                <img
                  src={isImageAvatar(c.agent.avatar) ? c.agent.avatar : getAgentAvatarUrl(c.agent.id)}
                  alt={c.agent.name}
                  className="h-5 w-5 rounded-full bg-muted object-cover"
                />
              )}
              <span>{c.agent.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
