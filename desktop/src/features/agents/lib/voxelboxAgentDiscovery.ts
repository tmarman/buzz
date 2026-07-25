import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauri";
import {
  agencyRuntimeEndpoint,
  fetchAgencyRuntimeConfig,
} from "@/features/surfaces/lib/agencyRuntime";

export type VoxelboxRemoteAgent = {
  name: string;
  agentType: string;
  description: string;
  org: string;
  avatarUrl: string | null;
  hasVoice: boolean;
  voiceDescription: string;
  identityReady: boolean;
  publicKey: string | null;
};

const HIDDEN_REMOTE_AGENT_NAMES = new Set(["liquid"]);

export function shouldProjectVoxelboxAgent(name: string): boolean {
  return !HIDDEN_REMOTE_AGENT_NAMES.has(name.trim().toLowerCase());
}

function normalizeVoxelboxAgents(agents: unknown): VoxelboxRemoteAgent[] {
  if (!Array.isArray(agents)) return [];

  return agents.flatMap((agent) => {
    if (typeof agent !== "object" || agent === null) return [];

    const source = agent as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!name || !shouldProjectVoxelboxAgent(name)) return [];

    const agentType =
      typeof source.agentType === "string"
        ? source.agentType.trim()
        : typeof source.type === "string"
          ? source.type.trim()
          : "";
    const description =
      typeof source.description === "string" ? source.description.trim() : "";
    const org = typeof source.org === "string" ? source.org.trim() : "";
    const avatarUrl =
      typeof source.avatarUrl === "string" && source.avatarUrl.trim()
        ? source.avatarUrl.trim()
        : null;
    const hasVoice = source.hasVoice === true;
    const voiceDescription =
      typeof source.voiceDescription === "string"
        ? source.voiceDescription.trim()
        : "";
    const identityReady = source.identityReady === true;
    const publicKey =
      typeof source.publicKey === "string" && source.publicKey.trim()
        ? source.publicKey.trim().toLowerCase()
        : typeof source.pubkey === "string" && source.pubkey.trim()
          ? source.pubkey.trim().toLowerCase()
          : null;

    return [
      {
        name,
        agentType,
        description,
        org,
        avatarUrl,
        hasVoice,
        voiceDescription,
        identityReady,
        publicKey,
      },
    ];
  });
}

export type VoxelboxEnrollmentResult = {
  steward: string;
  npub: string;
  pubkey: string;
  state: "approved";
};

export async function importVoxelboxAgentIdentity(input: {
  steward: string;
  nsec: string;
  ownerAuthTag: string;
  replaceExisting: boolean;
}): Promise<VoxelboxEnrollmentResult> {
  if (!isTauri()) {
    throw new Error("Joining a Voxelbox agent requires the native app.");
  }
  return invokeTauri<VoxelboxEnrollmentResult>(
    "import_voxelbox_agent_identity",
    input,
  );
}

/**
 * Lists agents available from the local Voxelbox runtime.
 *
 * Native builds use the fixed-target Rust bridge to avoid CORS and to strip
 * private daemon fields. Browser development keeps the direct read fallback.
 */
export async function fetchVoxelboxRemoteAgents(): Promise<
  VoxelboxRemoteAgent[]
> {
  try {
    if (isTauri()) {
      const agents = await invokeTauri<unknown>("discover_voxelbox_agents");
      return normalizeVoxelboxAgents(agents);
    }

    const runtime = await fetchAgencyRuntimeConfig();
    const response = await fetch(
      agencyRuntimeEndpoint(runtime, "/api/stewards"),
    );
    if (!response.ok) return [];
    return normalizeVoxelboxAgents(await response.json());
  } catch {
    return [];
  }
}
