import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";

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
  postSurfaceHostSession,
  postSurfaceHostTheme,
} from "@/features/surfaces/lib/surfaceHostBridge";
import { invokeTauri } from "@/shared/api/tauri";

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
export const SURFACE_SESSION_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

export function shouldRetrySurfaceSession(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Surface session response was invalid/i.test(message)) return false;
  const status = message.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
  return status ? Number(status) >= 500 || Number(status) === 429 : true;
}

export type SurfaceScope = "global" | `space:${string}`;

export function buildSurfaceUrl({
  baseUrl = DEFAULT_AGENCY_RUNTIME_CONFIG.baseUrl,
  embedded = false,
  name,
  route,
  scope = "global",
}: {
  baseUrl?: string;
  embedded?: boolean;
  name: string;
  route?: string;
  scope?: SurfaceScope;
}) {
  const runtimeUrl = new URL(baseUrl);
  let url: URL;
  try {
    const candidate = route ? new URL(route, runtimeUrl) : null;
    url =
      candidate &&
      candidate.origin === runtimeUrl.origin &&
      candidate.pathname.startsWith("/surfaces/")
        ? candidate
        : new URL(
            agencyRuntimeEndpoint(
              { baseUrl },
              `/surfaces/${encodeURIComponent(name)}/`,
            ),
          );
  } catch {
    url = new URL(
      agencyRuntimeEndpoint(
        { baseUrl },
        `/surfaces/${encodeURIComponent(name)}/`,
      ),
    );
  }
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
  agencyId,
  name,
  route,
  projectRef,
  sessionActions = [],
  surfaceId,
  scope = "global",
}: {
  embedded?: boolean;
  channelId?: string;
  communityId?: string;
  agencyId?: string;
  name: string;
  route?: string;
  projectRef?: string;
  sessionActions?: string[];
  surfaceId?: string;
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
    route,
    scope,
  });
  const space = scope.startsWith("space:")
    ? scope.slice("space:".length)
    : undefined;
  const surfaceIdentity = JSON.stringify({
    src,
    agencyId: agencyId ?? "",
    surfaceId: surfaceId ?? name,
    space: space ?? "",
    projectRef: projectRef ?? "",
    actions: sessionActions,
  });
  const hostContext = React.useMemo(
    () =>
      buildSurfaceHostContext({
        agencyId,
        channelId,
        communityId,
        embedded,
        projectRef,
        surfaceId: surfaceId ?? name,
        space,
      }),
    [
      agencyId,
      channelId,
      communityId,
      embedded,
      projectRef,
      space,
      surfaceId,
      name,
    ],
  );
  const [session, setSession] = React.useState<{
    identity: string;
    token: string;
    expiresAt?: string;
    actions: string[];
  } | null>(null);
  // A same-origin iframe keeps its Window object while navigating between
  // surfaces. Keep readiness tied to the exact navigation/session identity so
  // a token minted for a new surface cannot be sent to the previous document.
  const readyRef = React.useRef<{
    identity: string;
    src: string;
    loaded: boolean;
    ready: boolean;
  }>({
    identity: surfaceIdentity,
    src,
    loaded: false,
    ready: false,
  });
  // This runs during render, before React mutates the iframe's src or starts
  // the session-mint effect for the new identity.
  if (readyRef.current.identity !== surfaceIdentity) {
    readyRef.current = {
      identity: surfaceIdentity,
      src,
      loaded: false,
      ready: false,
    };
  }

  React.useEffect(() => {
    setSession(null);
    if (!isTauri() || sessionActions.length === 0) return;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryIndex = 0;
    const mintSession = () => {
      void invokeTauri<{
        token: string;
        expiresAt?: string;
        actions: string[];
      }>("mint_surface_session", {
        request: {
          agencyId: agencyId ?? "",
          surfaceId: surfaceId ?? name,
          space,
          projectRef,
          actions: sessionActions,
        },
      })
        .then((value) => {
          if (!cancelled) {
            setSession({ identity: surfaceIdentity, ...value });
          }
        })
        .catch((error: unknown) => {
          const delay = SURFACE_SESSION_RETRY_DELAYS_MS[retryIndex];
          if (
            cancelled ||
            delay === undefined ||
            !shouldRetrySurfaceSession(error)
          ) {
            // A provider may require enrollment/auth not available to the
            // shell; keep the mounted surface read-only rather than exposing
            // credentials or repeatedly challenging a policy decision.
            return;
          }
          retryIndex += 1;
          retryTimer = setTimeout(mintSession, delay);
        });
    };
    mintSession();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
    };
  }, [
    agencyId,
    name,
    projectRef,
    sessionActions,
    space,
    surfaceId,
    surfaceIdentity,
  ]);

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
        !isSurfaceReadyMessage(event.data) ||
        (session !== null && session.identity !== surfaceIdentity) ||
        readyRef.current.identity !== surfaceIdentity ||
        readyRef.current.src !== src ||
        !readyRef.current.loaded
      ) {
        return;
      }
      postSurfaceHostContext(frame, hostContext, runtimeOrigin);
      postSurfaceHostTheme(frame, runtimeOrigin);
      if (session) {
        postSurfaceHostSession(
          frame,
          {
            type: "agency.surface.session",
            protocol: "agency.ui.v1",
            token: session.token,
            ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
            actions: session.actions,
          },
          runtimeOrigin,
        );
      }
      readyRef.current.ready = true;
    }

    window.addEventListener("message", handleSurfaceReady);
    return () => window.removeEventListener("message", handleSurfaceReady);
  }, [hostContext, runtimeOrigin, session, src, surfaceIdentity]);

  React.useEffect(() => {
    if (
      !session ||
      session.identity !== surfaceIdentity ||
      readyRef.current.identity !== surfaceIdentity ||
      readyRef.current.src !== src ||
      !readyRef.current.loaded ||
      !readyRef.current.ready
    ) {
      return;
    }
    postSurfaceHostSession(
      frameRef.current,
      {
        type: "agency.surface.session",
        protocol: "agency.ui.v1",
        token: session.token,
        ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
        actions: session.actions,
      },
      runtimeOrigin,
    );
  }, [runtimeOrigin, session, src, surfaceIdentity]);

  return (
    <iframe
      allow="clipboard-write; microphone"
      className="min-h-0 w-full flex-1 border-0"
      onLoad={(event) => {
        const frame = event.currentTarget;
        if (
          frameRef.current !== frame ||
          frame.src !== src ||
          readyRef.current.identity !== surfaceIdentity ||
          readyRef.current.src !== src
        ) {
          return;
        }
        readyRef.current.loaded = true;
        readyRef.current.ready = false;
        postSurfaceHostTheme(frameRef.current, runtimeOrigin);
      }}
      key={surfaceIdentity}
      ref={frameRef}
      sandbox={SURFACE_SANDBOX}
      src={src}
      title={name}
    />
  );
}
