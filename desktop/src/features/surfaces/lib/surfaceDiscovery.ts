import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauri";

const SURFACE_DISCOVERY_URL = "http://localhost:1337/surfaces/";
const SPACE_DISCOVERY_URL = "http://localhost:1337/api/spaces";

export type InstalledSurfaceDescriptor = {
  name: string;
  space: string;
  description: string;
  ownerAgent: string;
};

export type VoxelboxSpaceSummary = {
  name: string;
  description: string;
};

function normalizeSurfaceDescriptors(
  surfaces: unknown,
): InstalledSurfaceDescriptor[] {
  if (!Array.isArray(surfaces)) {
    return [];
  }

  return surfaces.flatMap((surface) => {
    if (typeof surface === "string") {
      const name = surface.trim();
      return name
        ? [{ name, space: "global", description: "", ownerAgent: "" }]
        : [];
    }

    if (typeof surface !== "object" || surface === null) return [];
    const source = surface as Record<string, unknown>;
    const rawName =
      typeof source.name === "string"
        ? source.name
        : typeof source.id === "string"
          ? source.id
          : "";
    const name = rawName.trim();
    if (!name) return [];

    const rawSpace =
      typeof source.space === "string"
        ? source.space
        : typeof source.org === "string"
          ? source.org
          : "";
    const space = rawSpace.trim() || "global";
    const description =
      typeof source.description === "string" ? source.description.trim() : "";
    const ownerAgent =
      typeof source.ownerAgent === "string"
        ? source.ownerAgent.trim()
        : typeof source.owner_agent === "string"
          ? source.owner_agent.trim()
          : typeof source.steward === "string"
            ? source.steward.trim()
            : "";

    return [{ name, space, description, ownerAgent }];
  });
}

/**
 * Discovers renderable surface descriptors exposed by the local surface host.
 *
 * Discovery is optional: an unavailable or malformed response means no
 * surfaces are available rather than an application error.
 */
export async function fetchInstalledSurfaceDescriptors(): Promise<
  InstalledSurfaceDescriptor[]
> {
  try {
    if (isTauri()) {
      const surfaces = await invokeTauri<unknown>("discover_local_surfaces");
      return normalizeSurfaceDescriptors(surfaces);
    }

    const response = await fetch(SURFACE_DISCOVERY_URL);
    if (!response.ok) {
      return [];
    }

    const surfaces: unknown = await response.json();
    return normalizeSurfaceDescriptors(surfaces);
  } catch {
    return [];
  }
}

/** Backward-compatible name allowlist used by the surface pane. */
export async function fetchInstalledSurfaces(): Promise<string[]> {
  return (await fetchInstalledSurfaceDescriptors()).map(
    (surface) => surface.name,
  );
}

/** Lists public Space names without retaining private daemon registry fields. */
export async function fetchVoxelboxSpaces(): Promise<VoxelboxSpaceSummary[]> {
  try {
    const spaces = isTauri()
      ? await invokeTauri<unknown>("discover_voxelbox_spaces")
      : await fetch(SPACE_DISCOVERY_URL).then(async (response) =>
          response.ok ? response.json() : [],
        );
    if (!Array.isArray(spaces)) return [];

    return spaces.flatMap((space) => {
      if (typeof space !== "object" || space === null) return [];
      const source = space as Record<string, unknown>;
      const name = typeof source.name === "string" ? source.name.trim() : "";
      if (!name) return [];
      const description =
        typeof source.description === "string" ? source.description.trim() : "";
      return [{ name, description }];
    });
  } catch {
    return [];
  }
}

/** Returns whether a discovered surface name is permitted for use. */
export function isSurfaceAllowed(
  name: string,
  installedNames: readonly string[],
): boolean {
  return installedNames.includes(name);
}
