"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type { Company, ChatEventPayload, ConnectionStatus } from "@/types";
import {
  createCompany as dbCreateCompany,
  updateCompany as dbUpdateCompany,
} from "@/lib/db";
import { RuntimeClient } from "@/lib/runtime";
import { gatewayReducer, initialGatewayState } from "./reducer";
import type { GatewayState, GatewayAction } from "./types";

export type GatewayChatEventHandler = (payload: ChatEventPayload) => void;

export interface GatewayStoreValue {
  state: GatewayState;
  dispatch: React.Dispatch<GatewayAction>;
  getState: () => GatewayState;
  clientRef: React.MutableRefObject<RuntimeClient | null>;
  registerChatEventHandler: (fn: GatewayChatEventHandler | null) => void;
  connect: () => void;
  disconnect: () => void;
  createCompany: (
    name: string,
    gatewayUrl: string,
    gatewayToken: string,
    description?: string,
  ) => Promise<Company>;
  updateCompany: (id: string, updates: Partial<Company>) => Promise<void>;
  restartGateway: () => Promise<void>;
}

const GatewayContext = createContext<GatewayStoreValue | null>(null);

export function GatewayProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(gatewayReducer, initialGatewayState);
  const stateRef = useRef(state);
  stateRef.current = state;

  const clientRef = useRef<RuntimeClient | null>(null);
  const chatEventHandlerRef = useRef<GatewayChatEventHandler | null>(null);

  const getState = useCallback(() => stateRef.current, []);
  const registerChatEventHandler = useCallback(
    (fn: GatewayChatEventHandler | null) => {
      chatEventHandlerRef.current = fn;
    },
    [],
  );

  const connect = useCallback(() => {
    const current = stateRef.current;
    const company = current.companies.find(c => c.id === current.activeCompanyId);
    if (!company?.gatewayUrl || !company?.gatewayToken) return;

    if (clientRef.current) {
      clientRef.current.destroy();
    }

    const client = new RuntimeClient();
    clientRef.current = client;

    const runtimeConfig = {
      type: company.runtimeType || ("openclaw" as const),
      baseUrl: company.gatewayUrl
        .replace(/^ws:\/\//, "http://")
        .replace(/^wss:\/\//, "https://"),
      apiKey: company.gatewayToken,
      model: company.model,
      headers: company.customHeaders ? JSON.parse(company.customHeaders) : undefined,
    };

    client.configure(runtimeConfig, {
      onConnectionStatus: (status: ConnectionStatus) => {
        dispatch({ type: "SET_CONNECTION_STATUS", status });
      },
      onChatEvent: (payload: ChatEventPayload) => {
        chatEventHandlerRef.current?.(payload);
      },
      onError: () => {},
    });

    client.connect();
  }, []);

  const disconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.destroy();
      clientRef.current = null;
    }
    dispatch({ type: "SET_CONNECTION_STATUS", status: "disconnected" });
  }, []);

  const createCompany = useCallback(
    async (name: string, gatewayUrl: string, gatewayToken: string, description?: string) => {
      const now = Date.now();
      const company: Company = {
        id: uuidv4(),
        name,
        description,
        runtimeType: "openclaw",
        gatewayUrl,
        gatewayToken,
        createdAt: now,
        updatedAt: now,
      };
      await dbCreateCompany(company);
      dispatch({ type: "ADD_COMPANY", company });
      return company;
    },
    [],
  );

  const updateCompany = useCallback(
    async (id: string, updates: Partial<Company>) => {
      await dbUpdateCompany(id, updates);
      dispatch({ type: "UPDATE_COMPANY", id, updates });

      const current = stateRef.current;
      const needsReconnect =
        (updates.gatewayUrl ||
          updates.gatewayToken ||
          updates.runtimeType ||
          updates.model ||
          updates.customHeaders) &&
        current.activeCompanyId === id;
      if (needsReconnect) {
        setTimeout(() => connect(), 100);
      }
    },
    [connect],
  );

  const restartGateway = useCallback(async () => {
    try {
      await fetch("/api/gateway/restart", { method: "POST" });
      disconnect();
      setTimeout(() => connect(), 2000);
    } catch {
      // Failed to restart
    }
  }, [connect, disconnect]);

  // Self-auto-connect: subscribe ONLY to gateway's own state (spec §5.3 铁律)
  useEffect(() => {
    if (!state.initialized) return;
    const company = state.companies.find(c => c.id === state.activeCompanyId);
    if (company?.gatewayUrl && company?.gatewayToken) {
      connect();
    }
  }, [state.initialized, state.activeCompanyId, connect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = null;
      }
    };
  }, []);

  const value = useMemo<GatewayStoreValue>(
    () => ({
      state,
      dispatch,
      getState,
      clientRef,
      registerChatEventHandler,
      connect,
      disconnect,
      createCompany,
      updateCompany,
      restartGateway,
    }),
    [state, getState, registerChatEventHandler, connect, disconnect, createCompany, updateCompany, restartGateway],
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}

export function useGatewayStore(): GatewayStoreValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error("useGatewayStore must be used within GatewayProvider");
  return ctx;
}
