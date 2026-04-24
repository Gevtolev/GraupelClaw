import { describe, it, expect } from "vitest";
import type { Company } from "@/types";
import { gatewayReducer, initialGatewayState } from "./reducer";

function company(id: string, overrides: Partial<Company> = {}): Company {
  return {
    id,
    name: `co-${id}`,
    runtimeType: "openclaw",
    gatewayUrl: `http://example/${id}`,
    gatewayToken: "tk",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("gatewayReducer", () => {
  it("initialGatewayState has sensible defaults", () => {
    expect(initialGatewayState).toEqual({
      companies: [],
      activeCompanyId: null,
      connectionStatus: "disconnected",
      initialized: false,
    });
  });

  it("SET_COMPANIES replaces companies array", () => {
    const s = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    expect(s.companies.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("ADD_COMPANY appends", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a")],
    });
    const s2 = gatewayReducer(s1, { type: "ADD_COMPANY", company: company("b") });
    expect(s2.companies.map(c => c.id)).toEqual(["a", "b"]);
  });

  it("UPDATE_COMPANY merges updates for matching id only", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, {
      type: "UPDATE_COMPANY",
      id: "a",
      updates: { name: "renamed" },
    });
    expect(s2.companies.find(c => c.id === "a")?.name).toBe("renamed");
    expect(s2.companies.find(c => c.id === "b")?.name).toBe("co-b");
  });

  it("REMOVE_COMPANY filters out the removed company", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, { type: "REMOVE_COMPANY", id: "a" });
    expect(s2.companies.map(c => c.id)).toEqual(["b"]);
  });

  it("REMOVE_COMPANY does NOT touch agents/teams/messages (those live in other slices)", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a")],
    });
    const s2 = gatewayReducer(s1, { type: "SET_ACTIVE_COMPANY", id: "a" });
    const s3 = gatewayReducer(s2, { type: "REMOVE_COMPANY", id: "a" });
    expect(s3.activeCompanyId).toBe(null);
    expect(s3.companies).toEqual([]);
  });

  it("REMOVE_COMPANY falls back activeCompanyId to first remaining company when active was removed", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, { type: "SET_ACTIVE_COMPANY", id: "a" });
    const s3 = gatewayReducer(s2, { type: "REMOVE_COMPANY", id: "a" });
    expect(s3.activeCompanyId).toBe("b");
  });

  it("REMOVE_COMPANY leaves activeCompanyId untouched when a different company is removed", () => {
    const s1 = gatewayReducer(initialGatewayState, {
      type: "SET_COMPANIES",
      companies: [company("a"), company("b")],
    });
    const s2 = gatewayReducer(s1, { type: "SET_ACTIVE_COMPANY", id: "a" });
    const s3 = gatewayReducer(s2, { type: "REMOVE_COMPANY", id: "b" });
    expect(s3.activeCompanyId).toBe("a");
  });

  it("SET_ACTIVE_COMPANY sets only the id (cross-slice resets belong to coordinators)", () => {
    const s = gatewayReducer(initialGatewayState, { type: "SET_ACTIVE_COMPANY", id: "x" });
    expect(s.activeCompanyId).toBe("x");
  });

  it("SET_CONNECTION_STATUS updates status only", () => {
    const s = gatewayReducer(initialGatewayState, { type: "SET_CONNECTION_STATUS", status: "connected" });
    expect(s.connectionStatus).toBe("connected");
  });

  it("SET_INITIALIZED flips initialized flag", () => {
    const s = gatewayReducer(initialGatewayState, { type: "SET_INITIALIZED" });
    expect(s.initialized).toBe(true);
  });
});
