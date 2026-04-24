import { describe, it, expect, vi } from "vitest";
import type { Agent, AgentTeam, Message } from "@/types";
import type { TeamDispatchState } from "./types";
import { dispatchTeamMessage } from "./dispatcher";

function team(agentIds: string[], tlAgentId?: string): AgentTeam {
  return { id: "t1", companyId: "c1", name: "dev", agentIds, tlAgentId, createdAt: 0 };
}

function agent(id: string, name: string): Agent {
  return { id, companyId: "c1", name, description: "", specialty: "general", createdAt: 0 };
}

function state(agents: Agent[], teams: AgentTeam[], messages: Message[] = []): TeamDispatchState {
  return { agents, teams, messages, agentIdentities: {} };
}

const buildSessionKey = (agentId: string, teamId: string, cid: string) =>
  `agent:${agentId}:${teamId}:${cid}`;

describe("dispatchTeamMessage", () => {
  it("activates only the TL when user has no @mentions", async () => {
    const t = team(["a1", "a2", "a3"], "a2");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({ fromAgentId: id, content: "ok" }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "just a question", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0]).toBe("a2");
  });

  it("activates @mentioned agents in parallel, skipping TL when user @s someone else", async () => {
    const t = team(["a1", "a2", "a3"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({ fromAgentId: id, content: "ok" }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "@[B](a2) and @[C](a3) go", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(2);
    const calledIds = sendToAgent.mock.calls.map(c => c[0]).sort();
    expect(calledIds).toEqual(["a2", "a3"]);
  });

  it("cascades: TL reply @s member → member gets dispatched at hop 2", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => {
      if (id === "a1") return { fromAgentId: "a1", content: "let @[B](a2) handle this" };
      return { fromAgentId: "a2", content: "done" };
    });

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "do X", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(2);
    expect(sendToAgent.mock.calls[0][0]).toBe("a1");
    expect(sendToAgent.mock.calls[1][0]).toBe("a2");
  });

  it("drops self-mentions in replies", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({
      fromAgentId: id,
      content: id === "a1" ? "I, @[A](a1), will handle it" : "done",
    }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "do X", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
  });

  it("stops at max_hops and invokes onCascadeStopped with max_hops reason", async () => {
    const t = team(["a1", "a2", "a3", "a4", "a5"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C"), agent("a4", "D"), agent("a5", "E")];
    const s = state(agents, [t]);
    const next: Record<string, string> = { a1: "a2", a2: "a3", a3: "a4", a4: "a5", a5: "" };
    const nextName: Record<string, string> = { a1: "B", a2: "C", a3: "D", a4: "E", a5: "" };
    const sendToAgent = vi.fn(async (id: string) => {
      const targetId = next[id];
      const content = targetId ? `@[${nextName[id]}](${targetId})` : "done";
      return { fromAgentId: id, content };
    });
    const onCascadeStopped = vi.fn();

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 3, onCascadeStopped,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(3);
    expect(onCascadeStopped).toHaveBeenCalledWith({ reason: "max_hops", hop: 3 });
  });

  it("detects recent loop and stops with loop reason", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({
      fromAgentId: id,
      content: id === "a1" ? "@[B](a2)" : "@[A](a1)",
    }));
    const onCascadeStopped = vi.fn();

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8, onCascadeStopped,
    });

    expect(onCascadeStopped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "loop" })
    );
  });

  it("respects isAborted and stops with abort reason", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    let aborted = false;
    const sendToAgent = vi.fn(async (id: string) => {
      aborted = true;
      return { fromAgentId: id, content: "@[B](a2)" };
    });
    const onCascadeStopped = vi.fn();

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => aborted, buildSessionKey, maxHops: 8, onCascadeStopped,
    });

    expect(onCascadeStopped).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "abort" })
    );
  });

  it("treats sendToAgent returning null as failure and does not cascade from it", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async () => null);

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
  });

  it("falls back to TL when user @s only invalid agent ids", async () => {
    const t = team(["a1", "a2"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => ({ fromAgentId: id, content: "ok" }));

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "@[Ghost](ghost) do X", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    expect(sendToAgent).toHaveBeenCalledTimes(1);
    expect(sendToAgent.mock.calls[0][0]).toBe("a1");
  });

  it("deduplicates targets within a single hop when multiple replies @ the same agent", async () => {
    const t = team(["a1", "a2", "a3", "a4"], "a1");
    const agents = [agent("a1", "A"), agent("a2", "B"), agent("a3", "C"), agent("a4", "D")];
    const s = state(agents, [t]);
    const sendToAgent = vi.fn(async (id: string) => {
      if (id === "a1") return { fromAgentId: "a1", content: "split: @[B](a2) @[C](a3)" };
      if (id === "a2") return { fromAgentId: "a2", content: "ping @[D](a4)" };
      if (id === "a3") return { fromAgentId: "a3", content: "also ping @[D](a4)" };
      return { fromAgentId: "a4", content: "done" };
    });

    await dispatchTeamMessage({
      team: t, conversationId: "c1", rootUserMessageId: "m1",
      userContent: "start", getState: () => s, sendToAgent,
      isAborted: () => false, buildSessionKey, maxHops: 8,
    });

    const a4Calls = sendToAgent.mock.calls.filter(c => c[0] === "a4");
    expect(a4Calls.length).toBe(1);
  });
});
