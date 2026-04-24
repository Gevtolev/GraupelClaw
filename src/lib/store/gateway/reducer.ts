import type { GatewayState, GatewayAction } from "./types";

export const initialGatewayState: GatewayState = {
  companies: [],
  activeCompanyId: null,
  connectionStatus: "disconnected",
  initialized: false,
};

export function gatewayReducer(
  state: GatewayState,
  action: GatewayAction,
): GatewayState {
  switch (action.type) {
    case "SET_COMPANIES":
      return { ...state, companies: action.companies };
    case "ADD_COMPANY":
      return { ...state, companies: [...state.companies, action.company] };
    case "UPDATE_COMPANY":
      return {
        ...state,
        companies: state.companies.map(c =>
          c.id === action.id ? { ...c, ...action.updates } : c,
        ),
      };
    case "REMOVE_COMPANY": {
      const companies = state.companies.filter(c => c.id !== action.id);
      let activeCompanyId = state.activeCompanyId;
      if (state.activeCompanyId === action.id) {
        activeCompanyId = companies[0]?.id ?? null;
      }
      return { ...state, companies, activeCompanyId };
    }
    case "SET_ACTIVE_COMPANY":
      return { ...state, activeCompanyId: action.id };
    case "SET_CONNECTION_STATUS":
      return { ...state, connectionStatus: action.status };
    case "SET_INITIALIZED":
      return { ...state, initialized: true };
    default:
      return state;
  }
}
