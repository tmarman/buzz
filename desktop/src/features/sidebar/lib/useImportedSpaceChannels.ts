import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import type { Channel } from "@/shared/api/types";
import {
  type ChannelSortMode,
  sortChannelsForSidebar,
} from "@/features/sidebar/lib/channelSortPreference";
import {
  getChannelSpace,
  setChannelAgencyScope,
} from "@/features/sidebar/lib/channelSpaceStorage";
import { initializeChannelSurfaces } from "@/features/sidebar/lib/channelSurfaceStorage";
import {
  getHiddenSpaceIdsSnapshot,
  subscribeSpaceVisibility,
} from "@/features/sidebar/lib/spaceVisibilityStorage";
import {
  fetchInstalledSurfaceDescriptors,
  fetchAgencySpaces,
  matchChannelToAgencySpace,
  isSurfaceEligibleForPlacement,
} from "@/features/surfaces/lib/surfaceDiscovery";

export function useImportedSpaceChannels({
  currentPubkey,
  sortMode,
  starredChannelIds,
  streamChannels,
}: {
  currentPubkey?: string;
  sortMode: ChannelSortMode;
  starredChannelIds?: ReadonlySet<string>;
  streamChannels: Channel[];
}): {
  importedSpaceChannelIds: Set<string>;
  importedSpaceChannels: Channel[];
} {
  const spacesQuery = useQuery({
    enabled: Boolean(currentPubkey),
    queryKey: ["voxelbox-spaces"],
    queryFn: fetchAgencySpaces,
    staleTime: 60_000,
  });
  const hiddenSpaceIdsSnapshot = React.useSyncExternalStore(
    subscribeSpaceVisibility,
    () => getHiddenSpaceIdsSnapshot(currentPubkey ?? ""),
    () => "[]",
  );
  const hiddenSpaceIds = React.useMemo(
    () => new Set(JSON.parse(hiddenSpaceIdsSnapshot) as string[]),
    [hiddenSpaceIdsSnapshot],
  );
  const spaceByChannelId = React.useMemo(() => {
    const imported = new Map<
      string,
      ReturnType<typeof matchChannelToAgencySpace>
    >();
    for (const channel of streamChannels) {
      const space = matchChannelToAgencySpace(
        channel.name,
        spacesQuery.data ?? [],
      );
      if (space) imported.set(channel.id, space);
    }
    return imported;
  }, [spacesQuery.data, streamChannels]);
  const importedSpaceChannelIds = React.useMemo(
    () => new Set(spaceByChannelId.keys()),
    [spaceByChannelId],
  );
  const importedSpaceChannels = React.useMemo(
    () =>
      sortChannelsForSidebar(
        streamChannels.filter((channel) => {
          const spaceId = spaceByChannelId.get(channel.id)?.name;
          return (
            spaceId !== undefined &&
            !hiddenSpaceIds.has(spaceId) &&
            !starredChannelIds?.has(channel.id)
          );
        }),
        sortMode,
      ),
    [
      hiddenSpaceIds,
      sortMode,
      spaceByChannelId,
      starredChannelIds,
      streamChannels,
    ],
  );

  React.useEffect(() => {
    if (!currentPubkey) return;
    let cancelled = false;
    void Promise.all(
      [...spaceByChannelId].map(async ([channelId, space]) => {
        if (!getChannelSpace(currentPubkey, channelId)) {
          setChannelAgencyScope(currentPubkey, channelId, {
            agencyId: space?.agencyId ?? "",
            space: space?.name ?? "",
          });
        }
        if (!space) return;
        const descriptors = await fetchInstalledSurfaceDescriptors(
          `space:${space.name}`,
        );
        if (cancelled) return;
        initializeChannelSurfaces(
          currentPubkey,
          channelId,
          descriptors
            .filter(
              (surface) =>
                space.surfaces.includes(surface.name) &&
                isSurfaceEligibleForPlacement(surface, "channel_tab", {
                  space: space.name,
                  channel: true,
                }),
            )
            .map((surface) => surface.name),
        );
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [currentPubkey, spaceByChannelId]);

  return { importedSpaceChannelIds, importedSpaceChannels };
}
