import * as React from "react";

import { postSurfaceHostTheme } from "@/features/surfaces/lib/surfaceHostBridge";

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

export function SurfaceFrame({ name }: { name: string }) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const src = `${SURFACE_BASE_URL}${encodeURIComponent(name)}/`;

  React.useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      postSurfaceHostTheme(frameRef.current);
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <iframe
      allow="clipboard-write; microphone"
      className="min-h-0 w-full flex-1 border-0"
      onLoad={() => postSurfaceHostTheme(frameRef.current)}
      ref={frameRef}
      sandbox={SURFACE_SANDBOX}
      src={src}
      title={name}
    />
  );
}
