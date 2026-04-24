"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { chatReducer, initialChatState } from "./reducer";
import type { ChatSliceState, ChatAction } from "./types";

export interface ChatStoreValue {
  state: ChatSliceState;
  dispatch: React.Dispatch<ChatAction>;
  getState: () => ChatSliceState;
  pendingStreamResolvers: React.MutableRefObject<Map<string, () => void>>;
  teamAbortedRef: React.MutableRefObject<Map<string, boolean>>;
}

const ChatContext = createContext<ChatStoreValue | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const pendingStreamResolvers = useRef<Map<string, () => void>>(new Map());
  const teamAbortedRef = useRef<Map<string, boolean>>(new Map());

  const value = useMemo<ChatStoreValue>(
    () => ({ state, dispatch, getState, pendingStreamResolvers, teamAbortedRef }),
    [state, getState],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore(): ChatStoreValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatStore must be used within ChatProvider");
  return ctx;
}
