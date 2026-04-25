import { describe, it, expect } from "vitest";
import { parseMentions } from "./mention-parser";

const valid = new Set(["a1", "a2", "a3"]);

describe("parseMentions", () => {
  it("returns empty array for text with no mentions", () => {
    expect(parseMentions("hello world", valid)).toEqual([]);
  });

  it("parses a single mention", () => {
    expect(parseMentions("hi @[Alice](a1) how are you", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
    ]);
  });

  it("parses multiple mentions in one text", () => {
    expect(
      parseMentions("@[Alice](a1) and @[Bob](a2) please review", valid)
    ).toEqual([
      { name: "Alice", agentId: "a1" },
      { name: "Bob", agentId: "a2" },
    ]);
  });

  it("deduplicates same agent mentioned twice", () => {
    expect(
      parseMentions("@[Alice](a1) and @[Alice](a1) again", valid)
    ).toEqual([{ name: "Alice", agentId: "a1" }]);
  });

  it("drops mentions with invalid agent ids", () => {
    expect(parseMentions("@[Alice](a1) @[Ghost](ghost)", valid)).toEqual([
      { name: "Alice", agentId: "a1" },
    ]);
  });

  it("handles mentions across line breaks", () => {
    expect(
      parseMentions("line one\n\n@[Alice](a1)\n@[Bob](a2)", valid)
    ).toEqual([
      { name: "Alice", agentId: "a1" },
      { name: "Bob", agentId: "a2" },
    ]);
  });

  it("without a nameToId map, bare @name does NOT match (legacy behavior)", () => {
    expect(parseMentions("hey @alice and @Bob", valid)).toEqual([]);
  });

  it("does not match markdown links that are not mentions", () => {
    expect(
      parseMentions("see [docs](https://example.com) for details", valid)
    ).toEqual([]);
  });

  it("handles names containing spaces", () => {
    expect(parseMentions("@[Ecommerce Mind](a3) check this", valid)).toEqual([
      { name: "Ecommerce Mind", agentId: "a3" },
    ]);
  });

  describe("with nameToId fallback", () => {
    const nameMap = new Map([
      ["alice", "a1"],
      ["bob", "a2"],
      ["小天", "a3"],
    ]);

    it("resolves bare @Name (case-insensitive) when name is in the roster", () => {
      expect(parseMentions("hey @Alice please look", valid, nameMap)).toEqual([
        { name: "Alice", agentId: "a1" },
      ]);
    });

    it("resolves CJK names via bare @", () => {
      expect(parseMentions("@小天 你来定", valid, nameMap)).toEqual([
        { name: "小天", agentId: "a3" },
      ]);
    });

    it("falls back across structured + bare mixed forms, dedupes by id", () => {
      expect(
        parseMentions("@[Alice](a1) plus @bob and @Alice again", valid, nameMap),
      ).toEqual([
        { name: "Alice", agentId: "a1" },
        { name: "bob", agentId: "a2" },
      ]);
    });

    it("ignores @ inside emails or URLs", () => {
      expect(parseMentions("ping me at user@alice.dev", valid, nameMap)).toEqual([]);
      expect(parseMentions("see https://x.com/@bob", valid, nameMap)).toEqual([]);
    });

    it("ignores bare @ that doesn't match any roster name", () => {
      expect(parseMentions("@charlie not on the team", valid, nameMap)).toEqual([]);
    });

    it("does not double-match the leading @ of a structured mention", () => {
      // Without exclusion, the bare regex could try to match @[ which would
      // fail (not a letter). Sanity check that we still emit exactly one entry.
      expect(parseMentions("@[Alice](a1)!", valid, nameMap)).toEqual([
        { name: "Alice", agentId: "a1" },
      ]);
    });

    it("rejects glued tokens — @allowance does not match @all-style entries", () => {
      const m = new Map([["all", "a-all"], ["alice", "a1"]]);
      const validIds = new Set(["a-all", "a1"]);
      expect(parseMentions("@allowance for @alice", validIds, m)).toEqual([
        { name: "alice", agentId: "a1" },
      ]);
    });
  });
});
