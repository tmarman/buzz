import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchVoxelboxSpaces } from "@/features/surfaces/lib/surfaceDiscovery";
import {
  getHiddenSpaceIdsSnapshot,
  restoreAllSpaces,
  setSpaceHidden,
  subscribeSpaceVisibility,
} from "@/features/sidebar/lib/spaceVisibilityStorage";
import { Button } from "@/shared/ui/button";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export function SpaceVisibilitySettingsCard({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const spacesQuery = useQuery({
    enabled: Boolean(currentPubkey),
    queryKey: ["voxelbox-spaces"],
    queryFn: fetchVoxelboxSpaces,
    staleTime: 60_000,
  });
  const hiddenSnapshot = React.useSyncExternalStore(
    subscribeSpaceVisibility,
    () => getHiddenSpaceIdsSnapshot(currentPubkey ?? ""),
    () => "[]",
  );
  const hiddenSpaceIds = React.useMemo(
    () => new Set(JSON.parse(hiddenSnapshot) as string[]),
    [hiddenSnapshot],
  );
  const spaces = [...(spacesQuery.data ?? [])].sort((left, right) =>
    (left.displayName || left.name).localeCompare(
      right.displayName || right.name,
    ),
  );

  return (
    <section className="min-w-0" data-testid="settings-spaces">
      <SettingsSectionHeader
        action={
          hiddenSpaceIds.size > 0 && currentPubkey ? (
            <Button
              onClick={() => restoreAllSpaces(currentPubkey)}
              size="sm"
              type="button"
              variant="outline"
            >
              Show all
            </Button>
          ) : undefined
        }
        description="Choose which imported Voxelbox Spaces appear in the sidebar. Hiding a Space does not remove its channel, agents, or installed surfaces."
        title="Spaces"
      />

      <SettingsOptionGroup>
        {spaces.map((space) => {
          const label = space.displayName || space.name;
          const switchId = `space-visibility-${space.name}`;
          return (
            <SettingsOptionRow key={space.name}>
              <div className="min-w-0">
                <label className="text-sm font-medium" htmlFor={switchId}>
                  {label}
                </label>
                <p className="text-sm font-normal text-muted-foreground">
                  {space.description ||
                    `${space.stewards.length} steward${
                      space.stewards.length === 1 ? "" : "s"
                    } · ${space.name}`}
                </p>
              </div>
              <Switch
                checked={!hiddenSpaceIds.has(space.name)}
                data-testid={`space-visibility-toggle-${space.name}`}
                disabled={!currentPubkey}
                id={switchId}
                onCheckedChange={(visible) => {
                  if (currentPubkey) {
                    setSpaceHidden(currentPubkey, space.name, !visible);
                  }
                }}
              />
            </SettingsOptionRow>
          );
        })}
        {!spacesQuery.isLoading && spaces.length === 0 ? (
          <SettingsOptionRow>
            <p className="text-sm text-muted-foreground">
              No Voxelbox Spaces were discovered on this machine.
            </p>
          </SettingsOptionRow>
        ) : null}
      </SettingsOptionGroup>
    </section>
  );
}
