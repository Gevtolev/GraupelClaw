import { describe, it, expect } from "vitest";
import { dmSessionKey, teamSessionKey } from "./session-keys";
import { projectBrand } from "@/lib/project-brand";

describe("dmSessionKey", () => {
  it("returns conversationId unchanged when it already has the agent session prefix", () => {
    const cid = "agent:a1:graupelclaw:abc-123";
    expect(dmSessionKey("a1", cid)).toBe(cid);
  });

  it("builds a fresh key when conversationId does not carry the prefix", () => {
    expect(dmSessionKey("a1", "abc-123")).toBe(
      `agent:a1:${projectBrand.sessionNamespace}:abc-123`,
    );
  });

  it("does not re-wrap a key that carries a different agent's prefix", () => {
    const cid = "agent:other:graupelclaw:abc-123";
    expect(dmSessionKey("a1", cid)).toBe(
      `agent:a1:${projectBrand.sessionNamespace}:${cid}`,
    );
  });
});

describe("teamSessionKey", () => {
  it("builds a namespaced team session key", () => {
    expect(teamSessionKey("a1", "team-1", "c-1")).toBe(
      `agent:a1:${projectBrand.sessionNamespace}:team:team-1:c-1`,
    );
  });
});
