import * as React from "react";

import { getChannelSurface } from "@/features/sidebar/lib/channelSurfaceStorage";

// Discovery endpoint the daemon serves the installed-surface manifest from.
// Kept in step with SurfaceScreen's SURFACE_BASE_URL (same :1337 origin).
const SURFACE_DISCOVERY_URL = "http://localhost:1337/surfaces/";

export type ChannelSurfaceTabState =
  | { showTab: false; mode: "none" }
  | { showTab: true; mode: "frame"; surface: string }
  | { showTab: true; mode: "empty"; surface: string };

/**
 * Pure decision for the channel-header app tab.
 *
 * The tab is OFFERED whenever a channel -> surface mapping exists, but its body
 * is allowlist-gated: a mapped name absent from daemon discovery falls through
 * to a neutral empty state, NEVER a raw iframe.
 */
export function resolveChannelSurfaceTab(
  mappedSurface: string | null | undefined,
  installedSurfaces: readonly string[],
): ChannelSurfaceTabState {
  if (!mappedSurface) {
    return { showTab: false, mode: "none" };
  }
  const mode = installedSurfaces.includes(mappedSurface) ? "frame" : "empty";
  return { showTab: true, mode, surface: mappedSurface };
}

export type ChannelSurfaceTabHandle = {
  state: ChannelSurfaceTabState;
  isAppActive: boolean;
  activate: () => void;
  deactivate: () => void;
  toggle: () => void;
};

// Self-contained discovery read: GETs the installed-surface manifest and
// resolves the `name` values. ANY failure degrades to [] so the allowlist gate
// simply falls through to the empty state — it never throws into render.
async function fetchInstalledSurfaceNames(
  signal: AbortSignal,
): Promise<string[]> {
  try {
    const response = await fetch(SURFACE_DISCOVERY_URL, { signal });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return [];
    return body.flatMap((entry) =>
      entry && typeof entry === "object" && typeof entry.name === "string"
        ? [entry.name]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Wires the app tab into a channel screen: reads the device-local channel ->
 * surface mapping, discovers installed surfaces (allowlist), and tracks whether
 * the app tab is currently activated (body swapped to the SurfaceFrame).
 * Activation resets whenever the active channel changes.
 */
export function useChannelSurfaceTab({
  channelId,
  pubkey,
}: {
  channelId: string | null;
  pubkey: string | null | undefined;
}): ChannelSurfaceTabHandle {
  const [installedSurfaces, setInstalledSurfaces] = React.useState<string[]>(
    [],
  );
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchInstalledSurfaceNames(controller.signal).then((names) => {
      if (!controller.signal.aborted) setInstalledSurfaces(names);
    });
    return () => controller.abort();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset activation exactly when the active channel changes.
  React.useEffect(() => {
    setActive(false);
  }, [channelId]);

  const mappedSurface = React.useMemo(() => {
    if (!pubkey || !channelId) return null;
    return getChannelSurface(pubkey, channelId) ?? null;
  }, [pubkey, channelId]);

  const state = React.useMemo(
    () => resolveChannelSurfaceTab(mappedSurface, installedSurfaces),
    [mappedSurface, installedSurfaces],
  );

  const activate = React.useCallback(() => setActive(true), []);
  const deactivate = React.useCallback(() => setActive(false), []);
  const toggle = React.useCallback(() => setActive((value) => !value), []);

  return {
    state,
    isAppActive: active && state.showTab,
    activate,
    deactivate,
    toggle,
  };
}
