import { NextResponse } from "next/server";
import { connectGatewayWs } from "@/lib/gateway-ws";
import { generateWorkspaceFiles } from "@/lib/agent-templates";

export async function POST(request: Request) {
  try {
    const { agentId, name, description, specialty, gatewayUrl, gatewayToken } = await request.json();

    if (!agentId || !name) {
      return NextResponse.json({ error: "agentId and name are required" }, { status: 400 });
    }

    if (!gatewayUrl || !gatewayToken) {
      return NextResponse.json({ error: "gatewayUrl and gatewayToken are required" }, { status: 400 });
    }

    // Use a single WebSocket connection for all operations
    const conn = await connectGatewayWs({ gatewayUrl, gatewayToken });

    try {
      // Get current config
      const configRes = await conn.call("config.get", {});
      if (!configRes.ok) {
        return NextResponse.json({ error: `Failed to fetch config: ${configRes.error?.message}` }, { status: 502 });
      }

      const payload = configRes.payload || {};
      const configHash = payload.hash as string;
      let config: Record<string, unknown>;
      if (payload.parsed && typeof payload.parsed === "object") {
        config = payload.parsed as Record<string, unknown>;
      } else if (typeof payload.raw === "string") {
        try { config = JSON.parse(payload.raw as string); } catch { config = {}; }
      } else {
        config = {};
      }

      // Ensure agents.list exists
      const agents = (config.agents || {}) as Record<string, unknown>;
      if (!config.agents) config.agents = agents;
      if (!Array.isArray(agents.list)) agents.list = [];

      // Add agent if not already present
      const list = agents.list as Array<{ id: string; name: string; identity?: { name: string }; workspace: string }>;
      if (!list.find(a => a.id === agentId)) {
        list.push({
          id: agentId,
          name,
          identity: { name },
          workspace: `~/.openclaw/workspace-${agentId}`,
        });
      }

      // Write config back
      const setRes = await conn.call("config.apply", { raw: JSON.stringify(config, null, 2), baseHash: configHash });
      if (!setRes.ok) {
        return NextResponse.json({ error: `Failed to write config: ${setRes.error?.message}` }, { status: 502 });
      }

      // Write specialty-differentiated SOUL.md and IDENTITY.md only.
      // AGENTS.md, TOOLS.md, USER.md, HEARTBEAT.md are populated by OpenClaw's
      // ensureAgentWorkspace on first session use via writeFileIfMissing.
      const workspaceFiles = await generateWorkspaceFiles({
        name,
        description: description || `I am ${name}, ready to help with your tasks.`,
        specialty,
      });

      await Promise.allSettled(
        Object.entries(workspaceFiles).map(([file, content]) =>
          conn.call("agents.files.set", { agentId, name: file, content })
        )
      );

      return NextResponse.json({ ok: true });
    } finally {
      conn.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
