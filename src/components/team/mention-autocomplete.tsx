"use client";

import React, { useEffect, useRef } from "react";
import type { Agent } from "@/types";
import { cn } from "@/lib/utils";
import { getAgentAvatarUrl, isEmojiAvatar } from "@/lib/avatar";

export interface MentionCandidate {
  agent: Agent;
}

interface Props {
  candidates: MentionCandidate[];
  query: string;
  onSelect: (agent: Agent) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

export function MentionAutocomplete({ candidates, query, onSelect, onClose, anchorRect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const filtered = candidates.filter(c =>
    c.agent.name.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [onClose]);

  if (!anchorRect || filtered.length === 0) return null;

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
                  src={c.agent.avatar || getAgentAvatarUrl(c.agent.id)}
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
