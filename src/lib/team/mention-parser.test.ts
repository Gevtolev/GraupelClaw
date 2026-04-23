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

  it("does not match plain @name without markdown link syntax", () => {
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
});
