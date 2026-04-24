"use client";

import React from "react";
import { GatewayProvider } from "./gateway/store";
import { AgentProvider } from "./agent/store";
import { SessionProvider } from "./session/store";
import { ChatProvider } from "./chat/store";
import { ActionsProvider } from "./actions-provider";

export { useGatewayStore } from "./gateway/store";
export { useAgentStore } from "./agent/store";
export { useSessionStore } from "./session/store";
export { useChatStore } from "./chat/store";
export { useActions } from "./actions-provider";

export function StoreProvider({ children }: { children: React.ReactNode }) {
  return (
    <GatewayProvider>
      <AgentProvider>
        <SessionProvider>
          <ChatProvider>
            <ActionsProvider>{children}</ActionsProvider>
          </ChatProvider>
        </SessionProvider>
      </AgentProvider>
    </GatewayProvider>
  );
}
