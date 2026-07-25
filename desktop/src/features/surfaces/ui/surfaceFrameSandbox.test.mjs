import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Sandbox-hardening guard (Track E — surface-frame-sandbox review finding).
//
// The adversarial review flagged the frame sandbox granting
// `allow-popups-to-escape-sandbox` (a surface could spawn a window that escapes
// the whole policy) and `allow-popups`. This suite pins the hardened set so it
// cannot silently regress, and proves the in-channel pane reuses that single
// source rather than carrying its own copy.
import { ChannelSurfacePane } from "@/features/channels/ui/ChannelSurfacePane";
import { SURFACE_SANDBOX, SurfaceFrame } from "./SurfaceFrame.tsx";

function renderSurface(element) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: queryClient }, element),
  );
}

test("sandbox permits scripts and same-origin (surfaces need both)", () => {
  assert.match(SURFACE_SANDBOX, /\ballow-scripts\b/);
  assert.match(SURFACE_SANDBOX, /\ballow-same-origin\b/);
});

test("sandbox withholds popup + frame-escape + top-navigation tokens", () => {
  // /allow-popups/ matches both allow-popups and allow-popups-to-escape-sandbox.
  assert.doesNotMatch(
    SURFACE_SANDBOX,
    /allow-popups/,
    "must not grant popups or popup-escape",
  );
  assert.doesNotMatch(
    SURFACE_SANDBOX,
    /allow-top-navigation/,
    "a surface must never navigate the host shell",
  );
});

test("rendered SurfaceFrame carries exactly the hardened sandbox set", () => {
  const html = renderSurface(
    React.createElement(SurfaceFrame, { name: "agency" }),
  );
  assert.ok(
    html.includes(`sandbox="${SURFACE_SANDBOX}"`),
    "iframe sandbox must equal the exported hardened set",
  );
});

test("channel surface pane frame mode reuses the shared hardened sandbox", () => {
  const html = renderSurface(
    React.createElement(ChannelSurfacePane, {
      state: { showTab: true, mode: "frame", surface: "agency" },
    }),
  );
  assert.ok(
    html.includes(`sandbox="${SURFACE_SANDBOX}"`),
    "pane must render the shared SurfaceFrame sandbox set (single source)",
  );
  assert.ok(
    !html.includes("allow-popups"),
    "pane frame must not carry a divergent, looser sandbox",
  );
});
