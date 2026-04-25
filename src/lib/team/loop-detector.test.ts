import { describe, it, expect } from "vitest";
import { isRecentLoop, type DispatchEdge } from "./loop-detector";

describe("isRecentLoop", () => {
  it("returns false when no edges have been recorded", () => {
    expect(isRecentLoop([], "a", "b")).toBe(false);
  });

  it("returns false when the reverse edge is not in the last 3 entries", () => {
    const edges: DispatchEdge[] = [
      { from: "x", to: "y" },
      { from: "y", to: "z" },
    ];
    expect(isRecentLoop(edges, "a", "b")).toBe(false);
  });

  it("returns true when the reverse edge (to→from) exists in the last 3 entries", () => {
    // recent edges contain b→a; now a wants to dispatch b → would close the loop
    const edges: DispatchEdge[] = [{ from: "b", to: "a" }];
    expect(isRecentLoop(edges, "a", "b")).toBe(true);
  });

  it("returns false when reverse edge is older than last 3 entries", () => {
    const edges: DispatchEdge[] = [
      { from: "b", to: "a" }, // the would-be loop trigger
      { from: "x", to: "y" },
      { from: "y", to: "z" },
      { from: "z", to: "w" }, // last 3 is [(x,y),(y,z),(z,w)] → b→a out of window
    ];
    expect(isRecentLoop(edges, "a", "b")).toBe(false);
  });

  it("returns false for self-loop (from===to)", () => {
    expect(isRecentLoop([{ from: "a", to: "a" }], "a", "a")).toBe(false);
  });

  it("does NOT flag parallel fan-out members as a loop", () => {
    // TL fans out to four members in one hop. After that, member Tian's
    // reply mentions @Luna. There's no Luna→Tian edge in the chain — both
    // were triggered by Slico in parallel — so this must not be a loop.
    const edges: DispatchEdge[] = [
      { from: "slico", to: "eva" },
      { from: "slico", to: "luna" },
      { from: "slico", to: "tian" },
      { from: "slico", to: "nova" },
    ];
    expect(isRecentLoop(edges, "tian", "luna")).toBe(false);
    expect(isRecentLoop(edges, "tian", "nova")).toBe(false);
    expect(isRecentLoop(edges, "luna", "tian")).toBe(false);
  });

  it("does flag a real back-edge across hops", () => {
    // Sequential A → B → A: the second back-edge is the loop.
    const edges: DispatchEdge[] = [
      { from: "a", to: "b" },
    ];
    expect(isRecentLoop(edges, "b", "a")).toBe(true);
  });
});
