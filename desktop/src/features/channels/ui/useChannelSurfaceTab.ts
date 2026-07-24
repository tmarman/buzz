import * as React from "react";

import {
  getChannelSpace,
  subscribeChannelSpace,
} from "@/features/sidebar/lib/channelSpaceStorage";
import {
  getChannelSurfaces,
  subscribeChannelSurface,
} from "@/features/sidebar/lib/channelSurfaceStorage";
import {
  fetchInstalledSurfaceDescriptors,
  type InstalledSurfaceDescriptor,
} from "@/features/surfaces/lib/surfaceDiscovery";

export type ChannelSurfaceTabState =
  | {
      mode: "frame";
      surface: string;
      descriptor: InstalledSurfaceDescriptor;
      executionScope: "global" | `space:${string}`;
    }
  | { mode: "empty"; surface: string; descriptor: null };

/**
 * Resolve all ordered channel app tabs against daemon discovery.
 *
 * Pinned-but-unavailable names remain visible as neutral empty tabs, but only a
 * descriptor returned by native daemon discovery can reach SurfaceFrame.
 */
export function resolveChannelSurfaceTabs(
  mappedSurfaces: readonly string[],
  installedSurfaces: readonly InstalledSurfaceDescriptor[],
  selectedSpace: string | null = null,
): ChannelSurfaceTabState[] {
  const installedByName = new Map(
    installedSurfaces
      .filter(
        (surface) =>
          surface.space === "global" || surface.space === selectedSpace,
      )
      .map((surface) => [surface.name, surface]),
  );
  const executionScope = selectedSpace
    ? (`space:${selectedSpace}` as const)
    : ("global" as const);
  return mappedSurfaces.map((surface) => {
    const descriptor = installedByName.get(surface);
    return descriptor
      ? { mode: "frame" as const, surface, descriptor, executionScope }
      : { mode: "empty" as const, surface, descriptor: null };
  });
}

export type ChannelSurfaceTabHandle = {
  tabs: ChannelSurfaceTabState[];
  activeSurface: string | null;
  activeState: ChannelSurfaceTabState | null;
  isAppActive: boolean;
  space: string | null;
  activate: (surface: string) => void;
  deactivate: () => void;
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
  const [installedSurfaces, setInstalledSurfaces] = React.useState<
    InstalledSurfaceDescriptor[]
  >([]);
  const [activeSurface, setActiveSurface] = React.useState<string | null>(null);

  // Reactive read of the mapping. useSyncExternalStore re-reads whenever the
  // storage module reports a set/clear, so clearing the mapping (in the picker)
  // flips the tab to its empty/none state instead of stranding a live iframe.
  const getMappedSurfacesSerialized = React.useCallback((): string => {
    if (!pubkey || !channelId) return "[]";
    return JSON.stringify(getChannelSurfaces(pubkey, channelId));
  }, [pubkey, channelId]);
  const mappedSurfacesSerialized = React.useSyncExternalStore(
    subscribeChannelSurface,
    getMappedSurfacesSerialized,
    getMappedSurfacesSerialized,
  );
  const mappedSurfaces = React.useMemo(
    () => JSON.parse(mappedSurfacesSerialized) as string[],
    [mappedSurfacesSerialized],
  );
  const getSelectedSpace = React.useCallback((): string | null => {
    if (!pubkey || !channelId) return null;
    return getChannelSpace(pubkey, channelId) ?? null;
  }, [pubkey, channelId]);
  const selectedSpace = React.useSyncExternalStore(
    subscribeChannelSpace,
    getSelectedSpace,
    getSelectedSpace,
  );

  // Re-validate the allowlist whenever the mapping changes (and on mount). Any
  // discovery failure degrades to [] so the allowlist gate falls through to the
  // empty state rather than throwing into render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mappedSurfaces is the intended re-fetch trigger (fresh allowlist when tabs change), not a value read in the effect body.
  React.useEffect(() => {
    let cancelled = false;
    const scope = selectedSpace
      ? (`space:${selectedSpace}` as const)
      : ("global" as const);
    void fetchInstalledSurfaceDescriptors(scope).then((descriptors) => {
      if (!cancelled) setInstalledSurfaces(descriptors);
    });
    return () => {
      cancelled = true;
    };
  }, [mappedSurfaces, selectedSpace]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset activation exactly when the active channel changes.
  React.useEffect(() => {
    setActiveSurface(null);
  }, [channelId]);

  const tabs = React.useMemo(
    () =>
      resolveChannelSurfaceTabs(
        mappedSurfaces,
        installedSurfaces,
        selectedSpace,
      ),
    [mappedSurfaces, installedSurfaces, selectedSpace],
  );

  const activeState = tabs.find((tab) => tab.surface === activeSurface) ?? null;

  React.useEffect(() => {
    if (activeSurface && !activeState) {
      setActiveSurface(null);
    }
  }, [activeState, activeSurface]);

  const activate = React.useCallback(
    (surface: string) => setActiveSurface(surface),
    [],
  );
  const deactivate = React.useCallback(() => setActiveSurface(null), []);

  return {
    tabs,
    activeSurface,
    activeState,
    isAppActive: activeState !== null,
    space: selectedSpace,
    activate,
    deactivate,
  };
}
