import { describe, it, expect } from "vitest";
import { isRecentLoop } from "./loop-detector";

describe("isRecentLoop", () => {
  it("returns false when chain is empty", () => {
    expect(isRecentLoop([], "a", "b")).toBe(false);
  });

  it("returns false when the reverse pair is not in the last 3 entries", () => {
    expect(isRecentLoop(["x", "y", "z"], "a", "b")).toBe(false);
  });

  it("returns true when adjacent pair b→a exists in last 3 entries", () => {
    // chain ends with "b", "a"; now a wants to @ b → forms b→a→b
    expect(isRecentLoop(["x", "b", "a"], "a", "b")).toBe(true);
  });

  it("returns true when adjacent pair b→a is in second-to-last and third-to-last of last 3", () => {
    // last 3 = ["b", "a", "z"]; from=a, to=b; check if b→a adjacent exists → yes
    expect(isRecentLoop(["b", "a", "z"], "a", "b")).toBe(true);
  });

  it("returns false when b→a is older than last 3 entries", () => {
    // chain = [b, a, z, z, z]; last 3 = [z, z, z]; no b→a there
    expect(isRecentLoop(["b", "a", "z", "z", "z"], "a", "b")).toBe(false);
  });

  it("returns false for self-loop attempt (from===to)", () => {
    expect(isRecentLoop(["a", "a"], "a", "a")).toBe(false);
  });

  it("returns false when only from exists in chain but not adjacent to to", () => {
    // chain = ["x", "y", "a"]; from="a", to="x"; last 3 = ["x","y","a"]
    // check adjacent pairs: x→y, y→a; neither is x→a (to→from), so false
    expect(isRecentLoop(["x", "y", "a"], "a", "x")).toBe(false);
  });
});
