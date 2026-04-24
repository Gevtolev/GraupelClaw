import { NextRequest, NextResponse } from "next/server";
import { connectGatewayWs } from "@/lib/gateway-ws";

interface AgentInfo {
  id: string;
  name: string;
  avatar?: string;
  emoji?: string;
}

export async function POST(req: NextRequest) {
  const { gatewayUrl, gatewayToken } = await req.json();
  if (!gatewayUrl || !gatewayToken) {
    return NextResponse.json({ error: "Missing gatewayUrl or gatewayToken" }, { status: 400 });
  }

  try {
    const conn = await connectGatewayWs({ gatewayUrl, gatewayToken });

    try {
      const result = await conn.call("agents.list", {});
      if (!result.ok) {
        return NextResponse.json({ error: result.error?.message || "Failed to fetch agents" }, { status: 502 });
      }

      const payload = result.payload || {};
      const agentsList = (payload.agents || payload.list || []) as Array<{
        id: string;
        name?: string;
        identity?: { name?: string; emoji?: string; avatar?: string; avatarUrl?: string };
      }>;
      const defaultId = payload.defaultId as string | undefined;

      // Fetch full identity for each agent (merges config + IDENTITY.md)
      const agents: AgentInfo[] = await Promise.all(
        agentsList.map(async (a) => {
          // If agents.list already has identity.name, use it
          if (a.identity?.name) {
            return {
              id: a.id,
              name: a.identity.name,
              avatar: a.identity.avatarUrl || a.identity.avatar,
              emoji: a.identity.emoji,
            };
          }
          // Otherwise call agent.identity.get for full resolution (reads IDENTITY.md)
          try {
            const identityResult = await conn.call("agent.identity.get", { agentId: a.id });
            if (identityResult.ok && identityResult.payload) {
              const p = identityResult.payload;
              const identityName = p.name as string;
              const isDefault = !identityName || identityName === "Assistant";
              return {
                id: a.id,
                name: isDefault ? (a.name || a.id) : identityName,
                avatar: (p.avatar as string) || undefined,
                emoji: (p.emoji as string) || undefined,
              };
            }
          } catch {
            // Fall through to default
          }
          return { id: a.id, name: a.name || a.id };
        })
      );

      // If no real agents found but there's a defaultId, use it
      if (agents.length === 0 && defaultId) {
        try {
          const identityResult = await conn.call("agent.identity.get", { agentId: defaultId });
          if (identityResult.ok && identityResult.payload) {
            const p = identityResult.payload;
            agents.push({
              id: defaultId,
              name: (p.name as string) || defaultId,
              avatar: (p.avatar as string) || undefined,
              emoji: (p.emoji as string) || undefined,
            });
          } else {
            agents.push({ id: defaultId, name: defaultId });
          }
        } catch {
          agents.push({ id: defaultId, name: defaultId });
        }
      }

      return NextResponse.json({ agents, defaultId });
    } finally {
      conn.close();
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
