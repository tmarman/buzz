import * as React from "react";

import {
  getChannelSurface,
  subscribeChannelSurface,
} from "@/features/sidebar/lib/channelSurfaceStorage";
import { fetchInstalledSurfaces } from "@/features/surfaces/lib/surfaceDiscovery";

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

/**
 * Wires the app tab into a channel screen: reads the device-local channel ->
 * surface mapping REACTIVELY (so a picker set/clear updates the tab without a
 * remount), discovers installed surfaces (allowlist), and tracks whether the app
 * tab is currently activated (body swapped to the SurfaceFrame). Activation
 * resets whenever the active channel changes.
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

  // Reactive read of the mapping. useSyncExternalStore re-reads whenever the
  // storage module reports a set/clear, so clearing the mapping (in the picker)
  // flips the tab to its empty/none state instead of stranding a live iframe.
  const getMappedSurface = React.useCallback((): string | null => {
    if (!pubkey || !channelId) return null;
    return getChannelSurface(pubkey, channelId) ?? null;
  }, [pubkey, channelId]);
  const mappedSurface = React.useSyncExternalStore(
    subscribeChannelSurface,
    getMappedSurface,
    getMappedSurface,
  );

  // Re-validate the allowlist whenever the mapping changes (and on mount). Any
  // discovery failure degrades to [] so the allowlist gate falls through to the
  // empty state rather than throwing into render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mappedSurface is the intended re-fetch trigger (fresh allowlist when a surface is opened/remapped), not a value read in the effect body.
  React.useEffect(() => {
    let cancelled = false;
    void fetchInstalledSurfaces().then((names) => {
      if (!cancelled) setInstalledSurfaces(names);
    });
    return () => {
      cancelled = true;
    };
  }, [mappedSurface]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset activation exactly when the active channel changes.
  React.useEffect(() => {
    setActive(false);
  }, [channelId]);

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
