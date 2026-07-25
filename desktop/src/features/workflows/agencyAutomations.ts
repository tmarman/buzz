import { isTauri } from "@tauri-apps/api/core";

import {
  agencyRuntimeEndpoint,
  fetchAgencyRuntimeConfig,
} from "@/features/surfaces/lib/agencyRuntime";
import { invokeTauri } from "@/shared/api/tauri";

export type AgencyAutomation = {
  id: string;
  name: string;
  description: string;
  ownerAgent: string;
  scope: string;
  enabled: boolean;
  triggers: string[];
  runMode: "thread";
  canRun: boolean;
};

function normalizeAutomation(value: unknown): AgencyAutomation | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) return null;
  const runMode =
    source.runMode === "thread" || source.run_mode === "thread"
      ? "thread"
      : "thread";
  return {
    id,
    name:
      typeof source.name === "string" && source.name.trim()
        ? source.name.trim()
        : id,
    description:
      typeof source.description === "string" ? source.description.trim() : "",
    ownerAgent:
      typeof source.ownerAgent === "string"
        ? source.ownerAgent.trim()
        : typeof source.owner_agent === "string"
          ? source.owner_agent.trim()
          : "",
    scope: typeof source.scope === "string" ? source.scope.trim() : "",
    enabled: source.enabled !== false,
    triggers: Array.isArray(source.triggers)
      ? source.triggers.flatMap((trigger) =>
          typeof trigger === "string" && trigger.trim() ? [trigger.trim()] : [],
        )
      : [],
    runMode,
    canRun: source.canRun === true || source.can_run === true,
  };
}

export async function discoverAgencyAutomations(): Promise<AgencyAutomation[]> {
  try {
    const payload = isTauri()
      ? await invokeTauri<unknown>("discover_agency_automations")
      : await fetch(
          agencyRuntimeEndpoint(
            await fetchAgencyRuntimeConfig(),
            "/api/agency/automations",
          ),
        ).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json() as Promise<unknown>;
        });
    const values = Array.isArray(payload)
      ? payload
      : typeof payload === "object" &&
          payload !== null &&
          Array.isArray((payload as Record<string, unknown>).automations)
        ? ((payload as Record<string, unknown>).automations as unknown[])
        : [];
    return values
      .flatMap((value) => {
        const automation = normalizeAutomation(value);
        return automation ? [automation] : [];
      })
      .sort((left, right) => {
        if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
        return left.name.localeCompare(right.name);
      });
  } catch {
    return [];
  }
}
