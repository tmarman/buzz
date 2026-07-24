import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import type { Channel } from "@/shared/api/types";
import {
  type ChannelSortMode,
  sortChannelsForSidebar,
} from "@/features/sidebar/lib/channelSortPreference";
import {
  getChannelSpace,
  setChannelSpace,
} from "@/features/sidebar/lib/channelSpaceStorage";
import { initializeChannelSurfaces } from "@/features/sidebar/lib/channelSurfaceStorage";
import {
  fetchInstalledSurfaceDescriptors,
  fetchVoxelboxSpaces,
  matchChannelToVoxelboxSpace,
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
    queryFn: fetchVoxelboxSpaces,
    staleTime: 60_000,
  });
  const spaceByChannelId = React.useMemo(() => {
    const imported = new Map<string, string>();
    for (const channel of streamChannels) {
      const space = matchChannelToVoxelboxSpace(
        channel.name,
        spacesQuery.data ?? [],
      );
      if (space) imported.set(channel.id, space.name);
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
        streamChannels.filter(
          (channel) =>
            importedSpaceChannelIds.has(channel.id) &&
            !starredChannelIds?.has(channel.id),
        ),
        sortMode,
      ),
    [importedSpaceChannelIds, sortMode, starredChannelIds, streamChannels],
  );

  React.useEffect(() => {
    if (!currentPubkey) return;
    let cancelled = false;
    void Promise.all(
      [...spaceByChannelId].map(async ([channelId, spaceName]) => {
        if (!getChannelSpace(currentPubkey, channelId)) {
          setChannelSpace(currentPubkey, channelId, spaceName);
        }
        const descriptors = await fetchInstalledSurfaceDescriptors(
          `space:${spaceName}`,
        );
        if (cancelled) return;
        initializeChannelSurfaces(
          currentPubkey,
          channelId,
          descriptors
            .filter(
              (surface) =>
                surface.space === spaceName ||
                (surface.space === "global" && surface.category === "core"),
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
