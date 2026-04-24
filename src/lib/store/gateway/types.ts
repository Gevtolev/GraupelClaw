import type { Company, ConnectionStatus } from "@/types";

export interface GatewayState {
  companies: Company[];
  activeCompanyId: string | null;
  connectionStatus: ConnectionStatus;
  initialized: boolean;
}

export type GatewayAction =
  | { type: "SET_COMPANIES"; companies: Company[] }
  | { type: "ADD_COMPANY"; company: Company }
  | { type: "UPDATE_COMPANY"; id: string; updates: Partial<Company> }
  | { type: "REMOVE_COMPANY"; id: string }
  | { type: "SET_ACTIVE_COMPANY"; id: string | null }
  | { type: "SET_CONNECTION_STATUS"; status: ConnectionStatus }
  | { type: "SET_INITIALIZED" };
