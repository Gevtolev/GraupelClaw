"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type { ChatTargetType, Conversation } from "@/types";
import {
  createConversation as dbCreateConversation,
  updateConversation as dbUpdateConversation,
} from "@/lib/db";
import { dmSessionKey } from "@/lib/store/session-keys";
import { sessionReducer, initialSessionState } from "./reducer";
import type { SessionState, SessionAction } from "./types";

export interface SessionStoreValue {
  state: SessionState;
  dispatch: React.Dispatch<SessionAction>;
  getState: () => SessionState;
  createConversation: (
    targetType: ChatTargetType,
    targetId: string,
    activeCompanyId: string | null,
  ) => Promise<string>;
  renameConversation: (id: string, title: string) => Promise<void>;
}

const SessionContext = createContext<SessionStoreValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialSessionState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const getState = useCallback(() => stateRef.current, []);

  const createConversation = useCallback(
    async (
      targetType: ChatTargetType,
      targetId: string,
      activeCompanyId: string | null,
    ): Promise<string> => {
      const now = Date.now();

      if (targetType === "agent") {
        const sessionKey = dmSessionKey(targetId, uuidv4());
        const conv: Conversation = {
          id: sessionKey,
          targetType,
          targetId,
          companyId: activeCompanyId ?? "",
          title: "New Session",
          createdAt: now,
          updatedAt: now,
          source: "native-session",
          sessionKey,
        };
        dispatch({ type: "ADD_CONVERSATION", conversation: conv });
        dispatch({ type: "SET_ACTIVE_CONVERSATION", id: conv.id });
        dispatch({ type: "SET_MESSAGES", messages: [] });
        return conv.id;
      }

      const conv: Conversation = {
        id: uuidv4(),
        targetType,
        targetId,
        companyId: activeCompanyId ?? "",
        title: "New Chat",
        createdAt: now,
        updatedAt: now,
      };
      await dbCreateConversation(conv);
      dispatch({ type: "ADD_CONVERSATION", conversation: conv });
      dispatch({ type: "SET_ACTIVE_CONVERSATION", id: conv.id });
      dispatch({ type: "SET_MESSAGES", messages: [] });
      return conv.id;
    },
    [],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    const conversation = stateRef.current.conversations.find(c => c.id === id);
    if (conversation?.source === "native-session") {
      dispatch({ type: "UPDATE_CONVERSATION", id, updates: { title } });
      return;
    }
    await dbUpdateConversation(id, { title });
    dispatch({ type: "UPDATE_CONVERSATION", id, updates: { title } });
  }, []);

  const value = useMemo<SessionStoreValue>(
    () => ({ state, dispatch, getState, createConversation, renameConversation }),
    [state, getState, createConversation, renameConversation],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStoreValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionStore must be used within SessionProvider");
  return ctx;
}
