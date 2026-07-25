import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchVoxelboxSpaces } from "@/features/surfaces/lib/surfaceDiscovery";
import {
  AGENCY_RUNTIME_CONFIG_QUERY_KEY,
  DEFAULT_AGENCY_RUNTIME_CONFIG,
  fetchAgencyRuntimeConfig,
  saveAgencyRuntimeConfig,
} from "@/features/surfaces/lib/agencyRuntime";
import {
  getHiddenSpaceIdsSnapshot,
  restoreAllSpaces,
  setSpaceHidden,
  subscribeSpaceVisibility,
} from "@/features/sidebar/lib/spaceVisibilityStorage";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { SettingsOptionGroup, SettingsOptionRow } from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";

export function SpaceVisibilitySettingsCard({
  currentPubkey,
}: {
  currentPubkey?: string;
}) {
  const queryClient = useQueryClient();
  const runtimeQuery = useQuery({
    queryKey: AGENCY_RUNTIME_CONFIG_QUERY_KEY,
    queryFn: fetchAgencyRuntimeConfig,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [runtimeUrl, setRuntimeUrl] = React.useState(
    DEFAULT_AGENCY_RUNTIME_CONFIG.baseUrl,
  );
  React.useEffect(() => {
    if (runtimeQuery.data) setRuntimeUrl(runtimeQuery.data.baseUrl);
  }, [runtimeQuery.data]);
  const runtimeMutation = useMutation({
    mutationFn: () => saveAgencyRuntimeConfig({ baseUrl: runtimeUrl }),
    onSuccess: async (config) => {
      setRuntimeUrl(config.baseUrl);
      queryClient.setQueryData(AGENCY_RUNTIME_CONFIG_QUERY_KEY, config);
      await queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] !== AGENCY_RUNTIME_CONFIG_QUERY_KEY[0],
      });
    },
  });
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
        <SettingsOptionRow>
          <div className="min-w-0 flex-1">
            <label className="text-sm font-medium" htmlFor="agency-runtime-url">
              Agency runtime
            </label>
            <p className="text-sm font-normal text-muted-foreground">
              Buzz discovers Spaces, agents, apps, and work from this local
              runtime.
            </p>
            {runtimeMutation.error ? (
              <p className="mt-1 text-sm text-destructive">
                {runtimeMutation.error instanceof Error
                  ? runtimeMutation.error.message
                  : String(runtimeMutation.error)}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Input
              aria-label="Agency runtime endpoint"
              className="w-64"
              id="agency-runtime-url"
              onChange={(event) => setRuntimeUrl(event.currentTarget.value)}
              placeholder={DEFAULT_AGENCY_RUNTIME_CONFIG.baseUrl}
              spellCheck={false}
              value={runtimeUrl}
            />
            <Button
              disabled={
                runtimeMutation.isPending ||
                runtimeUrl.trim() === runtimeQuery.data?.baseUrl
              }
              onClick={() => runtimeMutation.mutate()}
              size="sm"
              type="button"
              variant="outline"
            >
              {runtimeMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </SettingsOptionRow>
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
