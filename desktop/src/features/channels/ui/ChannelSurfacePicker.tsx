import { Check, LayoutGrid } from "lucide-react";
import * as React from "react";

import {
  clearChannelSurface,
  getChannelSurface,
  setChannelSurface,
} from "@/features/sidebar/lib/channelSurfaceStorage";
import { cn } from "@/shared/lib/cn";

// Daemon surface discovery endpoint. Mirrors the allowlist source the surface
// pane gates against; any failure degrades to an empty list (no surfaces
// offered) rather than throwing.
const SURFACE_DISCOVERY_URL = "http://localhost:1337/surfaces/";

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

// Best-effort daemon discovery: resolves the `name` of each installed surface,
// degrading to [] on any failure (non-ok, throw, non-array, missing names) so
// the picker falls through to its neutral empty state.
async function discoverSurfaces(): Promise<string[]> {
  try {
    const response = await fetch(SURFACE_DISCOVERY_URL);
    if (!response.ok) {
      return [];
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) {
      return [];
    }
    return body
      .map((entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name
          : null,
      )
      .filter((name): name is string => name !== null);
  } catch {
    return [];
  }
}

type ChannelSurfacePickerSectionProps = {
  channelId: string;
  pubkey: string;
};

// Connected wrapper that lives inside the channel management popover. Sources
// surfaces from daemon discovery and reads/writes the device-local channel ->
// surface mapping through channelSurfaceStorage.
export function ChannelSurfacePickerSection({
  channelId,
  pubkey,
}: ChannelSurfacePickerSectionProps) {
  const [surfaces, setSurfaces] = React.useState<string[]>([]);
  const [selectedSurface, setSelectedSurface] = React.useState<string | null>(
    () => getChannelSurface(pubkey, channelId) ?? null,
  );

  React.useEffect(() => {
    setSelectedSurface(getChannelSurface(pubkey, channelId) ?? null);
    let active = true;
    void discoverSurfaces().then((names) => {
      if (active) {
        setSurfaces(names);
      }
    });
    return () => {
      active = false;
    };
  }, [channelId, pubkey]);

  function handleSelect(name: string) {
    setChannelSurface(pubkey, channelId, name);
    setSelectedSurface(name);
  }

  function handleClear() {
    clearChannelSurface(pubkey, channelId);
    setSelectedSurface(null);
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
