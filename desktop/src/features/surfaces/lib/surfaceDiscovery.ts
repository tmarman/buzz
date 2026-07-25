import { isTauri } from "@tauri-apps/api/core";

import { invokeTauri } from "@/shared/api/tauri";
import {
  agencyRuntimeEndpoint,
  fetchAgencyRuntimeConfig,
} from "./agencyRuntime";

export type SurfaceDiscoveryScope = "global" | `space:${string}`;
export type SurfacePlacement = "channel_tab" | "project_tab" | "standalone";

export type InstalledSurfaceDescriptor = {
  name: string;
  /** Provider identity for the runtime that owns this surface. */
  agencyId?: string;
  /** Relative render route advertised by the provider, when available. */
  route?: string;
  space: string;
  description: string;
  ownerAgent: string;
  icon: string;
  category: string;
  placements: string[];
  requiresContext: string[];
  /** Generic actions a provider may grant to this mounted surface. */
  sessionActions?: string[];
};

export type AgencySpaceSummary = {
  agencyId?: string;
  name: string;
  displayName: string;
  description: string;
  stewards: string[];
  surfaces: string[];
};

/** @deprecated Use AgencySpaceSummary; retained for existing provider adapters. */
export type VoxelboxSpaceSummary = AgencySpaceSummary;

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
        ? [
            {
              name,
              space: "global",
              description: "",
              ownerAgent: "",
              icon: "",
              category: "",
              placements: [],
              requiresContext: [],
            },
          ]
        : [];
    }

    if (typeof surface !== "object" || surface === null) return [];
    const source = surface as Record<string, unknown>;
    const render =
      typeof source.render === "object" && source.render !== null
        ? (source.render as Record<string, unknown>)
        : undefined;
    const rawName =
      typeof source.name === "string"
        ? source.name
        : typeof source.id === "string"
          ? source.id
          : typeof render?.name === "string"
            ? render.name
            : "";
    const name = rawName.trim();
    if (!name) return [];

    const rawSpace =
      typeof source.space === "string"
        ? source.space
        : typeof source.org === "string"
          ? source.org
          : typeof render?.space === "string"
            ? render.space
            : "";
    const space = rawSpace.trim() || "global";
    const agencyId =
      typeof source.agencyId === "string"
        ? source.agencyId.trim()
        : typeof source.agency_id === "string"
          ? source.agency_id.trim()
          : "";
    const route =
      typeof source.route === "string"
        ? source.route.trim()
        : typeof source.url === "string"
          ? source.url.trim()
          : typeof render?.route === "string"
            ? render.route.trim()
            : "";
    const description =
      typeof source.description === "string"
        ? source.description.trim()
        : typeof render?.description === "string"
          ? render.description.trim()
          : "";
    const ownerAgent =
      typeof source.ownerAgent === "string"
        ? source.ownerAgent.trim()
        : typeof source.owner_agent === "string"
          ? source.owner_agent.trim()
          : typeof source.steward === "string"
            ? source.steward.trim()
            : "";
    const icon =
      typeof source.icon === "string"
        ? source.icon.trim()
        : typeof render?.icon === "string"
          ? render.icon.trim()
          : "";
    const category =
      typeof source.category === "string"
        ? source.category.trim()
        : typeof render?.category === "string"
          ? render.category.trim()
          : "";
    const placements = normalizeStringList(
      source.placements ?? render?.placements,
    );
    const requiresContext = normalizeStringList(
      source.requiresContext ??
        source.requires_context ??
        render?.requires_context,
    );
    const sessionActions = normalizeStringList(
      source.sessionActions ??
        source.session_actions ??
        source.interactionActions ??
        source.interaction_actions ??
        (typeof source.session === "object" && source.session !== null
          ? (source.session as Record<string, unknown>).actions
          : undefined),
    );

    return [
      {
        name,
        ...(agencyId ? { agencyId } : {}),
        ...(route ? { route } : {}),
        space,
        description,
        ownerAgent,
        icon,
        category,
        placements,
        requiresContext,
        ...(sessionActions.length ? { sessionActions } : {}),
      },
    ];
  });
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : [],
  );
}

export function isSurfaceEligibleForPlacement(
  surface: InstalledSurfaceDescriptor,
  placement: SurfacePlacement,
  context: {
    space?: string | null;
    project?: boolean;
    channel?: boolean;
  },
): boolean {
  if (!surface.placements.includes(placement)) return false;
  return surface.requiresContext.every((requirement) => {
    switch (requirement) {
      case "space":
        return Boolean(context.space);
      case "project":
        return context.project === true;
      case "channel":
        return context.channel === true;
      default:
        return false;
    }
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
>;
export async function fetchInstalledSurfaceDescriptors(
  scope: SurfaceDiscoveryScope,
): Promise<InstalledSurfaceDescriptor[]>;
export async function fetchInstalledSurfaceDescriptors(
  scope: SurfaceDiscoveryScope = "global",
): Promise<InstalledSurfaceDescriptor[]> {
  try {
    if (isTauri()) {
      const surfaces = await invokeTauri<unknown>("discover_local_surfaces", {
        scope,
      });
      return normalizeSurfaceDescriptors(surfaces);
    }

    const runtime = await fetchAgencyRuntimeConfig();
    for (const path of ["/api/surfaces/descriptors", "/surfaces/"]) {
      try {
        const discoveryUrl = new URL(agencyRuntimeEndpoint(runtime, path));
        discoveryUrl.searchParams.set("scope", scope);
        const response = await fetch(discoveryUrl.toString());
        if (!response.ok) continue;
        const payload: unknown = await response.json();
        return normalizeSurfaceDescriptors(
          Array.isArray(payload)
            ? payload
            : typeof payload === "object" && payload !== null
              ? (payload as Record<string, unknown>).surfaces
              : [],
        );
      } catch {}
    }
    return [];
  } catch {
    return [];
  }
}

/** Backward-compatible name allowlist used by the surface pane. */
export async function fetchInstalledSurfaces(
  scope: SurfaceDiscoveryScope = "global",
): Promise<string[]> {
  return (await fetchInstalledSurfaceDescriptors(scope)).map(
    (surface) => surface.name,
  );
}

/** Lists public Space names without retaining private daemon registry fields. */
export async function fetchVoxelboxSpaces(): Promise<VoxelboxSpaceSummary[]> {
  try {
    const runtime = await fetchAgencyRuntimeConfig();
    const spaces = isTauri()
      ? await invokeTauri<unknown>("discover_voxelbox_spaces")
      : await fetchAgencySpacesFromRuntime(runtime);
    if (!Array.isArray(spaces)) return [];

    return spaces.flatMap((space) => {
      if (typeof space !== "object" || space === null) return [];
      const source = space as Record<string, unknown>;
      const canonicalId = typeof source.id === "string" ? source.id.trim() : "";
      const rawName = typeof source.name === "string" ? source.name.trim() : "";
      const name = canonicalId || rawName;
      if (!name) return [];
      const description =
        typeof source.description === "string" ? source.description.trim() : "";
      const displayName =
        typeof source.displayName === "string"
          ? source.displayName.trim()
          : typeof source.display_name === "string"
            ? source.display_name.trim()
            : canonicalId
              ? rawName
              : "";
      const stewards = Array.isArray(source.stewards)
        ? source.stewards.flatMap((steward) =>
            typeof steward === "string" && steward.trim()
              ? [steward.trim()]
              : [],
          )
        : [];
      const surfaces = Array.isArray(source.surfaces)
        ? source.surfaces.flatMap((surface) =>
            typeof surface === "string" && surface.trim()
              ? [surface.trim()]
              : [],
          )
        : [];
      const rawAgencyId =
        typeof source.agencyId === "string"
          ? source.agencyId.trim()
          : typeof source.agency_id === "string"
            ? source.agency_id.trim()
            : "";
      return [
        {
          ...(rawAgencyId ? { agencyId: rawAgencyId } : {}),
          name,
          displayName,
          description,
          stewards,
          surfaces,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function fetchAgencySpacesFromRuntime(
  runtime: Awaited<ReturnType<typeof fetchAgencyRuntimeConfig>>,
): Promise<unknown> {
  for (const path of ["/api/agency/spaces", "/api/spaces"]) {
    try {
      const response = await fetch(agencyRuntimeEndpoint(runtime, path));
      if (response.ok) return response.json();
    } catch {}
  }
  return [];
}

/** Provider-neutral Space discovery used by channel surfaces. */
export async function fetchAgencySpaces(): Promise<AgencySpaceSummary[]> {
  return fetchVoxelboxSpaces();
}

function normalizedSpaceLabel(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Matches a Buzz channel to a canonical Voxelbox Space by exact public label. */
export function matchChannelToVoxelboxSpace(
  channelName: string,
  spaces: readonly VoxelboxSpaceSummary[],
): VoxelboxSpaceSummary | undefined {
  return matchChannelToAgencySpace(channelName, spaces);
}

export function matchChannelToAgencySpace(
  channelName: string,
  spaces: readonly AgencySpaceSummary[],
): AgencySpaceSummary | undefined {
  const label = normalizedSpaceLabel(channelName);
  if (!label) return undefined;
  return spaces.find(
    (space) =>
      normalizedSpaceLabel(space.name) === label ||
      normalizedSpaceLabel(space.displayName) === label,
  );
}

/** Returns whether a discovered surface name is permitted for use. */
export function isSurfaceAllowed(
  name: string,
  installedNames: readonly string[],
): boolean {
  return installedNames.includes(name);
}
