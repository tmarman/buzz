import { Check, LayoutGrid, Plus } from "lucide-react";
import * as React from "react";

import {
  addChannelSurface,
  getChannelSurfaces,
  removeChannelSurface,
  subscribeChannelSurface,
} from "@/features/sidebar/lib/channelSurfaceStorage";
import {
  clearChannelSpace,
  getChannelSpace,
  setChannelSpace,
  subscribeChannelSpace,
} from "@/features/sidebar/lib/channelSpaceStorage";
import {
  fetchInstalledSurfaceDescriptors,
  fetchVoxelboxSpaces,
  type InstalledSurfaceDescriptor,
  type VoxelboxSpaceSummary,
} from "@/features/surfaces/lib/surfaceDiscovery";
import { cn } from "@/shared/lib/cn";

type ChannelSurfacePickerProps = {
  surfaces: InstalledSurfaceDescriptor[];
  spaces: VoxelboxSpaceSummary[];
  selectedSpace: string | null;
  selectedSurfaces: readonly string[];
  onSpaceChange: (space: string | null) => void;
  onToggle: (name: string, selected: boolean) => void;
};

function SurfaceOption({
  active,
  label,
  onClick,
  testId,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40",
        active && "bg-muted/40",
      )}
      data-selected={active ? "true" : undefined}
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {label}
      </span>
      {active ? <Check className="h-4 w-4 shrink-0 text-foreground" /> : null}
    </button>
  );
}

// Presentational picker. Lists discovered surfaces and lets the caller set or
// clear the channel -> surface mapping. Empty `surfaces` (discovery failure
// degrades to []) renders a neutral empty state and never crashes.
export function ChannelSurfacePicker({
  onSpaceChange,
  onToggle,
  selectedSpace,
  selectedSurfaces,
  spaces,
  surfaces,
}: ChannelSurfacePickerProps) {
  const eligibleSurfaces = surfaces.filter(
    (surface) => surface.space === "global" || surface.space === selectedSpace,
  );

  return (
    <div className="space-y-3" data-testid="channel-surface-picker">
      <label className="block space-y-1.5">
        <span className="flex items-center justify-between px-1">
          <span className="text-xs font-medium text-foreground">Space</span>
          <span className="text-2xs text-muted-foreground">This device</span>
        </span>
        <select
          className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="channel-space-picker"
          onChange={(event) => onSpaceChange(event.target.value || null)}
          value={selectedSpace ?? ""}
        >
          <option value="">Global only</option>
          {spaces.map((space) => (
            <option key={space.name} value={space.name}>
              {space.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2 px-1">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">App tabs</span>
      </div>
      {eligibleSurfaces.length === 0 ? (
        <p
          className="rounded-2xl bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
          data-testid="channel-surface-picker-empty"
        >
          No apps are installed for this Space.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-muted/20">
          {eligibleSurfaces.map((surface) => (
            <SurfaceOption
              active={selectedSurfaces.includes(surface.name)}
              key={surface.name}
              label={surface.name}
              onClick={() =>
                onToggle(surface.name, !selectedSurfaces.includes(surface.name))
              }
              testId={`channel-surface-option-${surface.name}`}
            />
          ))}
        </div>
      )}
      <button
        className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
        disabled
        title="Available after this Space's owner joins Buzz"
        type="button"
      >
        <Plus className="h-4 w-4" />
        Build a new app with chat
      </button>
    </div>
  );
}

type ChannelSurfacePickerSectionProps = {
  channelId: string;
  pubkey: string;
};

// Connected wrapper used by both the channel header and management sheet.
// Sources surfaces from the shared daemon discovery (single source with the
// surface pane's allowlist) and reads/writes the device-local channel -> surface
// mapping through channelSurfaceStorage. The selection is read REACTIVELY so it
// reflects clears made elsewhere (e.g. the channel app tab).
export function ChannelSurfacePickerSection({
  channelId,
  pubkey,
}: ChannelSurfacePickerSectionProps) {
  const [surfaces, setSurfaces] = React.useState<InstalledSurfaceDescriptor[]>(
    [],
  );
  const [spaces, setSpaces] = React.useState<VoxelboxSpaceSummary[]>([]);

  const getSelectedSerialized = React.useCallback(
    (): string => JSON.stringify(getChannelSurfaces(pubkey, channelId)),
    [pubkey, channelId],
  );
  const selectedSerialized = React.useSyncExternalStore(
    subscribeChannelSurface,
    getSelectedSerialized,
    getSelectedSerialized,
  );
  const selectedSurfaces = React.useMemo(
    () => JSON.parse(selectedSerialized) as string[],
    [selectedSerialized],
  );

  const getSelectedSpace = React.useCallback(
    (): string | null => getChannelSpace(pubkey, channelId) ?? null,
    [pubkey, channelId],
  );
  const selectedSpace = React.useSyncExternalStore(
    subscribeChannelSpace,
    getSelectedSpace,
    getSelectedSpace,
  );

  React.useEffect(() => {
    let active = true;
    void Promise.all([
      fetchInstalledSurfaceDescriptors(),
      fetchVoxelboxSpaces(),
    ]).then(([descriptors, discoveredSpaces]) => {
      if (!active) return;
      setSurfaces(descriptors);
      setSpaces(discoveredSpaces);
    });
    return () => {
      active = false;
    };
  }, []);

  function handleToggle(name: string, selected: boolean) {
    if (selected) {
      addChannelSurface(pubkey, channelId, name);
    } else {
      removeChannelSurface(pubkey, channelId, name);
    }
  }

  function handleSpaceChange(space: string | null) {
    if (space) {
      setChannelSpace(pubkey, channelId, space);
    } else {
      clearChannelSpace(pubkey, channelId);
    }

    const eligibleNames = new Set(
      surfaces
        .filter(
          (surface) => surface.space === "global" || surface.space === space,
        )
        .map((surface) => surface.name),
    );
    for (const selected of selectedSurfaces) {
      if (!eligibleNames.has(selected)) {
        removeChannelSurface(pubkey, channelId, selected);
      }
    }
  }

  return (
    <ChannelSurfacePicker
      onSpaceChange={handleSpaceChange}
      onToggle={handleToggle}
      selectedSpace={selectedSpace}
      selectedSurfaces={selectedSurfaces}
      spaces={spaces}
      surfaces={surfaces}
    />
  );
}
