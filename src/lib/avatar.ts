import type { AgentSpecialty } from "@/types";

export type AgentAvatarStyle = "elf" | "pixel" | "fantasy" | "cyber";

export const AGENT_AVATAR_STYLES: ReadonlyArray<{
  id: AgentAvatarStyle;
  label: string;
}> = [
  { id: "elf", label: "Elf" },
  { id: "pixel", label: "Pixel" },
  { id: "fantasy", label: "Fantasy" },
  { id: "cyber", label: "Cyber" },
];

const AGENT_SPECIALTIES: readonly AgentSpecialty[] = [
  "general",
  "coding",
  "research",
  "writing",
  "design",
  "product",
];

function resolveSpecialty(specialty?: string): AgentSpecialty {
  return AGENT_SPECIALTIES.includes(specialty as AgentSpecialty)
    ? (specialty as AgentSpecialty)
    : "general";
}

function stableIndex(seed: string, modulo: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

export function getAgentAvatarStyle(agentId: string): AgentAvatarStyle {
  return AGENT_AVATAR_STYLES[
    stableIndex(agentId, AGENT_AVATAR_STYLES.length)
  ].id;
}

export function getAgentAvatarUrl(
  agentId: string,
  specialty?: string,
  style?: AgentAvatarStyle,
): string {
  const avatarStyle = style ?? getAgentAvatarStyle(agentId);
  return `/avatars/${avatarStyle}/${resolveSpecialty(specialty)}.png`;
}

export function getUserAvatarUrl(seed: string = "user"): string {
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(seed)}`;
}

export function isImageAvatar(avatar?: string): boolean {
  if (!avatar) return false;
  return (
    avatar.startsWith("data:") ||
    avatar.startsWith("/") ||
    avatar.startsWith("blob:") ||
    avatar.startsWith("http://") ||
    avatar.startsWith("https://")
  );
}

export function isEmojiAvatar(avatar?: string): boolean {
  if (!avatar) return false;
  return !isImageAvatar(avatar);
}
