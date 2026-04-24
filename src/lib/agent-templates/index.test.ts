import { describe, it, expect } from "vitest";
import { generateWorkspaceFiles } from "./index";
import type { AgentSpecialty } from "@/types";

const SPECIALTIES: AgentSpecialty[] = ["general", "coding", "research", "writing", "design", "product"];

describe("generateWorkspaceFiles", () => {
  it("returns SOUL.md and IDENTITY.md for every specialty", async () => {
    for (const specialty of SPECIALTIES) {
      const files = await generateWorkspaceFiles({
        name: "Nova",
        description: "Test description",
        specialty,
      });
      expect(Object.keys(files).sort()).toEqual(["IDENTITY.md", "SOUL.md"]);
      expect(files["SOUL.md"]).toBeTruthy();
      expect(files["IDENTITY.md"]).toBeTruthy();
    }
  });

  it("interpolates {{name}} in IDENTITY.md", async () => {
    const files = await generateWorkspaceFiles({
      name: "Nova",
      description: "whatever",
      specialty: "coding",
    });
    expect(files["IDENTITY.md"]).toContain("**Name**: Nova");
    expect(files["IDENTITY.md"]).not.toContain("{{name}}");
  });

  it("interpolates {{description}} into both files", async () => {
    const files = await generateWorkspaceFiles({
      name: "Nova",
      description: "UNIQUE_MARKER_9f3a",
      specialty: "coding",
    });
    expect(files["SOUL.md"]).toContain("UNIQUE_MARKER_9f3a");
    expect(files["IDENTITY.md"]).toContain("UNIQUE_MARKER_9f3a");
    expect(files["SOUL.md"]).not.toContain("{{description}}");
    expect(files["IDENTITY.md"]).not.toContain("{{description}}");
  });

  it("produces distinct SOUL.md content per specialty", async () => {
    const souls = await Promise.all(
      SPECIALTIES.map(async (s) => {
        const f = await generateWorkspaceFiles({ name: "A", description: "D", specialty: s });
        return f["SOUL.md"];
      }),
    );
    const unique = new Set(souls);
    expect(unique.size).toBe(SPECIALTIES.length);
  });

  it("produces distinct IDENTITY.md Role per specialty", async () => {
    const roles = await Promise.all(
      SPECIALTIES.map(async (s) => {
        const f = await generateWorkspaceFiles({ name: "A", description: "D", specialty: s });
        const match = f["IDENTITY.md"].match(/## Role\n(.+)/);
        return match?.[1];
      }),
    );
    expect(new Set(roles).size).toBe(SPECIALTIES.length);
  });

  it("falls back to general when specialty is invalid or undefined", async () => {
    const expected = await generateWorkspaceFiles({
      name: "A",
      description: "D",
      specialty: "general",
    });
    const undef = await generateWorkspaceFiles({
      name: "A",
      description: "D",
      specialty: undefined,
    });
    const bogus = await generateWorkspaceFiles({
      name: "A",
      description: "D",
      specialty: "nonsense",
    });
    expect(undef["SOUL.md"]).toEqual(expected["SOUL.md"]);
    expect(bogus["SOUL.md"]).toEqual(expected["SOUL.md"]);
  });

  it("embeds coding-specific core truths in coding SOUL.md", async () => {
    const files = await generateWorkspaceFiles({
      name: "A",
      description: "D",
      specialty: "coding",
    });
    expect(files["SOUL.md"]).toContain("Tests are not optional");
  });

  it("embeds research-specific core truths in research SOUL.md", async () => {
    const files = await generateWorkspaceFiles({
      name: "A",
      description: "D",
      specialty: "research",
    });
    expect(files["SOUL.md"]).toContain("Primary sources over secondary sources");
  });

  it("includes Working Modes and Boundaries in every SOUL.md", async () => {
    for (const specialty of SPECIALTIES) {
      const files = await generateWorkspaceFiles({ name: "A", description: "D", specialty });
      expect(files["SOUL.md"]).toContain("## Working Modes");
      expect(files["SOUL.md"]).toContain("## Boundaries");
      expect(files["SOUL.md"]).toContain("## Continuity");
    }
  });

  it("includes Core Capabilities and Working Methodology in every IDENTITY.md", async () => {
    for (const specialty of SPECIALTIES) {
      const files = await generateWorkspaceFiles({ name: "A", description: "D", specialty });
      expect(files["IDENTITY.md"]).toContain("## Core Capabilities");
      expect(files["IDENTITY.md"]).toContain("## Working Methodology");
    }
  });

  it("embeds specialty-specific behavioral content", async () => {
    const writing = await generateWorkspaceFiles({ name: "A", description: "D", specialty: "writing" });
    expect(writing["SOUL.md"]).toContain("Clarity beats cleverness");

    const design = await generateWorkspaceFiles({ name: "A", description: "D", specialty: "design" });
    expect(design["SOUL.md"]).toContain("Accessibility is not optional");

    const general = await generateWorkspaceFiles({ name: "A", description: "D", specialty: "general" });
    expect(general["SOUL.md"]).toContain("Do the work, not the performance");

    const product = await generateWorkspaceFiles({ name: "A", description: "D", specialty: "product" });
    expect(product["SOUL.md"]).toContain("Research first, build second");
  });
});
