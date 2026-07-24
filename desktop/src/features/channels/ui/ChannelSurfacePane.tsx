import { SurfaceFrame } from "@/features/surfaces/ui/SurfaceFrame";
import { channelChrome } from "@/shared/layout/chromeLayout";
import { cn } from "@/shared/lib/cn";
import type { ChannelSurfaceTabState } from "./useChannelSurfaceTab";

/**
 * Body swapped in when the channel's app tab is active.
 *
 * - mode "frame": the mapped surface is present in daemon discovery — render the
 *   shared, sandboxed SurfaceFrame at its URL (single source of the sandbox set).
 * - mode "empty" (or "none"): allowlist gate fell through — render a neutral
 *   empty state and NEVER an iframe.
 */
export function ChannelSurfacePane({
  state,
}: {
  state: ChannelSurfaceTabState;
}) {
  if (state.mode === "frame") {
    return (
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          channelChrome.contentPadding,
        )}
        data-testid="channel-surface-pane"
      >
        <SurfaceFrame
          embedded
          name={state.surface}
          scope={state.executionScope}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 px-8 pb-8 text-center text-muted-foreground",
        channelChrome.contentPadding,
      )}
      data-testid="channel-surface-empty"
    >
      <p className="font-medium text-foreground text-sm">App unavailable</p>
      <p className="max-w-sm text-sm">
        {`The “${state.surface}” app isn't installed on this device. Install it to open it here.`}
      </p>
    </div>
  );
}
