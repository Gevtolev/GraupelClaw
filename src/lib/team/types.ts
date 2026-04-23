export interface Mention {
  name: string;
  agentId: string;
}

export interface RosterEntry {
  agentId: string;
  name: string;
  description?: string;
  role: "TL" | "Member";
}
