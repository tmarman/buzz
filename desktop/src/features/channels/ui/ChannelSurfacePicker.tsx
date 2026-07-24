import { Check, LayoutGrid } from "lucide-react";
import * as React from "react";

import {
  clearChannelSurface,
  getChannelSurface,
  setChannelSurface,
  subscribeChannelSurface,
} from "@/features/sidebar/lib/channelSurfaceStorage";
import { fetchInstalledSurfaces } from "@/features/surfaces/lib/surfaceDiscovery";
import { cn } from "@/shared/lib/cn";

type ChannelSurfacePickerProps = {
  surfaces: string[];
  selectedSurface: string | null;
  onSelect: (name: string) => void;
  onClear: () => void;
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
  onClear,
  onSelect,
  selectedSurface,
  surfaces,
}: ChannelSurfacePickerProps) {
  return (
    <div className="space-y-2" data-testid="channel-surface-picker">
      <div className="flex items-center gap-2 px-1">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-foreground">Surface</span>
      </div>
      {surfaces.length === 0 ? (
        <p
          className="rounded-2xl bg-muted/20 px-4 py-3 text-xs text-muted-foreground"
          data-testid="channel-surface-picker-empty"
        >
          No surfaces available.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-muted/20">
          <SurfaceOption
            active={selectedSurface === null}
            label="None"
            onClick={onClear}
            testId="channel-surface-option-none"
          />
          {surfaces.map((surface) => (
            <SurfaceOption
              active={selectedSurface === surface}
              key={surface}
              label={surface}
              onClick={() => onSelect(surface)}
              testId={`channel-surface-option-${surface}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type ChannelSurfacePickerSectionProps = {
  channelId: string;
  pubkey: string;
};

// Connected wrapper that lives inside the channel management popover. Sources
// surfaces from the shared daemon discovery (single source with the surface
// pane's allowlist) and reads/writes the device-local channel -> surface
// mapping through channelSurfaceStorage. The selection is read REACTIVELY so it
// reflects clears made elsewhere (e.g. the channel app tab).
export function ChannelSurfacePickerSection({
  channelId,
  pubkey,
}: ChannelSurfacePickerSectionProps) {
  const [surfaces, setSurfaces] = React.useState<string[]>([]);

  const getSelected = React.useCallback(
    (): string | null => getChannelSurface(pubkey, channelId) ?? null,
    [pubkey, channelId],
  );
  const selectedSurface = React.useSyncExternalStore(
    subscribeChannelSurface,
    getSelected,
    getSelected,
  );

  React.useEffect(() => {
    let active = true;
    void fetchInstalledSurfaces().then((names) => {
      if (active) {
        setSurfaces(names);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  function handleSelect(name: string) {
    setChannelSurface(pubkey, channelId, name);
  }

  function handleClear() {
    clearChannelSurface(pubkey, channelId);
  }

  return (
    <ChannelSurfacePicker
      onClear={handleClear}
      onSelect={handleSelect}
      selectedSurface={selectedSurface}
      surfaces={surfaces}
    />
  );
}
