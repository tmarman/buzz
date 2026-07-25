import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauri";

export type AgencyRuntimeConfig = {
  baseUrl: string;
};

export const DEFAULT_AGENCY_RUNTIME_CONFIG: AgencyRuntimeConfig = {
  baseUrl: "http://localhost:1337",
};

export const AGENCY_RUNTIME_CONFIG_QUERY_KEY = [
  "agency-runtime-config",
] as const;

export async function fetchAgencyRuntimeConfig(): Promise<AgencyRuntimeConfig> {
  if (!isTauri()) return DEFAULT_AGENCY_RUNTIME_CONFIG;
  return invokeTauri<AgencyRuntimeConfig>("get_agency_runtime_config");
}

export async function saveAgencyRuntimeConfig(
  config: AgencyRuntimeConfig,
): Promise<AgencyRuntimeConfig> {
  if (!isTauri()) {
    throw new Error("Agency runtime settings require the native app.");
  }
  return invokeTauri<AgencyRuntimeConfig>("set_agency_runtime_config", {
    config,
  });
}

export function agencyRuntimeEndpoint(
  config: AgencyRuntimeConfig,
  path: string,
): string {
  return `${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
