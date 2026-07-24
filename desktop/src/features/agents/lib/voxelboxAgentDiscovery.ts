import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauri";

const VOXELBOX_AGENTS_URL = "http://localhost:1337/api/stewards";

export type VoxelboxRemoteAgent = {
  name: string;
  agentType: string;
  description: string;
  org: string;
  avatarUrl: string | null;
  hasVoice: boolean;
  voiceDescription: string;
};

function normalizeVoxelboxAgents(agents: unknown): VoxelboxRemoteAgent[] {
  if (!Array.isArray(agents)) return [];

  return agents.flatMap((agent) => {
    if (typeof agent !== "object" || agent === null) return [];

    const source = agent as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!name) return [];

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

    return [
      {
        name,
        agentType,
        description,
        org,
        avatarUrl,
        hasVoice,
        voiceDescription,
      },
    ];
  });
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

    const response = await fetch(VOXELBOX_AGENTS_URL);
    if (!response.ok) return [];
    return normalizeVoxelboxAgents(await response.json());
  } catch {
    return [];
  }
}
