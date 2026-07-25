import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import {
  AGENCY_RUNTIME_CONFIG_QUERY_KEY,
  DEFAULT_AGENCY_RUNTIME_CONFIG,
  agencyRuntimeEndpoint,
  fetchAgencyRuntimeConfig,
} from "@/features/surfaces/lib/agencyRuntime";
import {
  buildSurfaceHostContext,
  isSurfaceReadyMessage,
  postSurfaceHostContext,
  postSurfaceHostTheme,
} from "@/features/surfaces/lib/surfaceHostBridge";

export const SURFACE_BASE_URL = "http://localhost:1337/surfaces/";

// Sandbox set for a first-party, locally-served surface loaded cross-origin
// from :1337. Least privilege: grant only what a surface provably needs to
// function, and add narrower tokens later if a concrete surface requires them —
// never pre-emptively.
//
//   allow-scripts      surfaces are voxelbox web apps; without it the frame is inert
//   allow-same-origin  the surface is served from the :1337 daemon and calls its OWN
//                      API there; a sandboxed frame without this token gets an opaque
//                      origin, which breaks credentialed fetch, cookies, and storage.
//                      Safe here because the surface origin (:1337) is DIFFERENT from
//                      the desktop shell's origin, so the allow-scripts +
//                      allow-same-origin self-unsandboxing escape (which only applies
//                      when the frame is same-origin as its embedder) does not apply.
//
// Deliberately withheld: allow-popups / allow-popups-to-escape-sandbox (a surface
// must never spawn an un-sandboxed window that escapes this policy),
// allow-top-navigation(-*) (a surface must never navigate the host shell out from
// under the user), and allow-forms / allow-modals / allow-downloads (no shipped
// surface demonstrably needs native form submission, blocking dialogs, or downloads;
// script-driven fetch covers app I/O). The origin-authority tradeoff of granting
// allow-same-origin to first-party surfaces is documented PRD policy.
export const SURFACE_SANDBOX = "allow-scripts allow-same-origin";

export type SurfaceScope = "global" | `space:${string}`;

export function buildSurfaceUrl({
  baseUrl = DEFAULT_AGENCY_RUNTIME_CONFIG.baseUrl,
  embedded = false,
  name,
  scope = "global",
}: {
  baseUrl?: string;
  embedded?: boolean;
  name: string;
  scope?: SurfaceScope;
}) {
  const url = new URL(
    agencyRuntimeEndpoint(
      { baseUrl },
      `/surfaces/${encodeURIComponent(name)}/`,
    ),
  );
  if (embedded) {
    url.searchParams.set("embedded", "1");
  }
  url.searchParams.set("scope", scope);
  return url.toString();
}

export function SurfaceFrame({
  embedded = false,
  channelId,
  communityId,
  name,
  projectRef,
  scope = "global",
}: {
  embedded?: boolean;
  channelId?: string;
  communityId?: string;
  name: string;
  projectRef?: string;
  scope?: SurfaceScope;
}) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const runtimeQuery = useQuery({
    queryKey: AGENCY_RUNTIME_CONFIG_QUERY_KEY,
    queryFn: fetchAgencyRuntimeConfig,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const runtime = runtimeQuery.data ?? DEFAULT_AGENCY_RUNTIME_CONFIG;
  const runtimeOrigin = new URL(runtime.baseUrl).origin;
  const src = buildSurfaceUrl({
    baseUrl: runtime.baseUrl,
    embedded,
    name,
    scope,
  });
  const space = scope.startsWith("space:")
    ? scope.slice("space:".length)
    : undefined;
  const hostContext = React.useMemo(
    () =>
      buildSurfaceHostContext({
        channelId,
        communityId,
        embedded,
        projectRef,
        space,
      }),
    [channelId, communityId, embedded, projectRef, space],
  );

  React.useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      postSurfaceHostTheme(frameRef.current, runtimeOrigin);
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, [runtimeOrigin]);

  React.useEffect(() => {
    function handleSurfaceReady(event: MessageEvent<unknown>) {
      const frame = frameRef.current;
      if (
        event.origin !== runtimeOrigin ||
        event.source !== frame?.contentWindow ||
        !isSurfaceReadyMessage(event.data)
      ) {
        return;
      }
      postSurfaceHostContext(frame, hostContext, runtimeOrigin);
      postSurfaceHostTheme(frame, runtimeOrigin);
    }

    window.addEventListener("message", handleSurfaceReady);
    return () => window.removeEventListener("message", handleSurfaceReady);
  }, [hostContext, runtimeOrigin]);

  return (
    <iframe
      allow="clipboard-write; microphone"
      className="min-h-0 w-full flex-1 border-0"
      onLoad={() => postSurfaceHostTheme(frameRef.current, runtimeOrigin)}
      ref={frameRef}
      sandbox={SURFACE_SANDBOX}
      src={src}
      title={name}
    />
  );
}
