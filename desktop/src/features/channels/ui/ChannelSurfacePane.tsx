import type { ChannelSurfaceTabState } from "./useChannelSurfaceTab";

// Same origin the top-level Surfaces tab renders from (SurfaceScreen). Surfaces
// run their own JS against the daemon API on :1337, so the frame is sandboxed
// WITH allow-scripts / allow-same-origin rather than left as a bare iframe.
const SURFACE_BASE_URL = "http://localhost:1337/surfaces/";
const SURFACE_SANDBOX =
  "allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin";

/**
 * Body swapped in when the channel's app tab is active.
 *
 * - mode "frame": the mapped surface is present in daemon discovery — render the
 *   sandboxed iframe at its URL.
 * - mode "empty" (or "none"): allowlist gate fell through — render a neutral
 *   empty state and NEVER an iframe.
 */
export function ChannelSurfacePane({
  state,
}: {
  state: ChannelSurfaceTabState;
}) {
  if (state.showTab && state.mode === "frame") {
    const src = `${SURFACE_BASE_URL}${encodeURIComponent(state.surface)}/`;
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <iframe
          allow="clipboard-write; microphone"
          className="min-h-0 w-full flex-1 border-0"
          sandbox={SURFACE_SANDBOX}
          src={src}
          title={state.surface}
        />
      </div>
    );
  }

  const surfaceName = state.showTab ? state.surface : null;
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground"
      data-testid="channel-surface-empty"
    >
      <p className="font-medium text-foreground text-sm">App unavailable</p>
      <p className="max-w-sm text-sm">
        {surfaceName
          ? `The “${surfaceName}” app isn't installed on this device. Install it to open it here.`
          : "No app is mapped to this channel."}
      </p>
    </div>
  );
}
