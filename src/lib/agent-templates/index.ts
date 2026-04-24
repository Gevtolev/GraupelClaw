import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentSpecialty } from "@/types";

const TEMPLATES_DIR = join(process.cwd(), "src/lib/agent-templates");
const VALID_SPECIALTIES: ReadonlySet<AgentSpecialty> = new Set([
  "general",
  "coding",
  "research",
  "writing",
  "design",
  "product",
]);

function resolveSpecialty(specialty: string | undefined): AgentSpecialty {
  return specialty && VALID_SPECIALTIES.has(specialty as AgentSpecialty)
    ? (specialty as AgentSpecialty)
    : "general";
}

function interpolate(template: string, name: string, description: string): string {
  return template.replaceAll("{{name}}", name).replaceAll("{{description}}", description);
}

export interface GenerateWorkspaceFilesParams {
  name: string;
  description: string;
  specialty: string | undefined;
}

/**
 * Load specialty-specific SOUL.md and IDENTITY.md templates and interpolate
 * {{name}} / {{description}}. Only these two files differentiate by specialty;
 * AGENTS.md, TOOLS.md, USER.md, HEARTBEAT.md are left for OpenClaw's
 * ensureAgentWorkspace to populate with its official defaults.
 */
export async function generateWorkspaceFiles(
  params: GenerateWorkspaceFilesParams,
): Promise<Record<string, string>> {
  const specialty = resolveSpecialty(params.specialty);
  const [soul, identity] = await Promise.all([
    readFile(join(TEMPLATES_DIR, "soul", `${specialty}.md`), "utf-8"),
    readFile(join(TEMPLATES_DIR, "identity", `${specialty}.md`), "utf-8"),
  ]);
  return {
    "SOUL.md": interpolate(soul, params.name, params.description),
    "IDENTITY.md": interpolate(identity, params.name, params.description),
  };
}
