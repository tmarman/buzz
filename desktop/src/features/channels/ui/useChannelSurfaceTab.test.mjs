import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// RED baseline (Track E — channel-app-tab).
//
// Contract this test pins for the extracted, pure decision logic that keeps
// ChannelScreen.tsx under the 1000-line gate:
//
//   resolveChannelSurfaceTab(mappedSurface, installedSurfaces) => state
//     no mapping (null/undefined/"")        -> { showTab: false, mode: "none" }
//     mapping present AND in discovery       -> { showTab: true,  mode: "frame", surface }
//     mapping present but NOT in discovery   -> { showTab: true,  mode: "empty", surface }
//
//   Rationale: the tab is offered whenever a mapping exists, but the pane body
//   is allowlist-gated — a mapped name absent from daemon discovery falls
//   through to a neutral empty state, NEVER a raw iframe.
//
//   ChannelSurfacePane({ state }) renders:
//     mode "frame" -> the sandboxed SurfaceFrame (an <iframe> at the mapped URL)
//     mode "empty" -> a neutral empty state with NO <iframe>
import { resolveChannelSurfaceTab } from "./useChannelSurfaceTab.ts";
import { ChannelSurfacePane } from "./ChannelSurfacePane.tsx";

const INSTALLED = ["agency", "notebook"];

// ── resolveChannelSurfaceTab ──────────────────────────────────────────────────

test("no mapping → no tab", () => {
  assert.deepEqual(resolveChannelSurfaceTab(null, INSTALLED), {
    showTab: false,
    mode: "none",
  });
  assert.deepEqual(resolveChannelSurfaceTab(undefined, INSTALLED), {
    showTab: false,
    mode: "none",
  });
  assert.deepEqual(resolveChannelSurfaceTab("", INSTALLED), {
    showTab: false,
    mode: "none",
  });
});

test("mapping present and in discovery → tab shows a frame", () => {
  assert.deepEqual(resolveChannelSurfaceTab("agency", INSTALLED), {
    showTab: true,
    mode: "frame",
    surface: "agency",
  });
});

test("mapping present but absent from discovery → tab shows empty state (allowlist gate)", () => {
  assert.deepEqual(resolveChannelSurfaceTab("ghost", INSTALLED), {
    showTab: true,
    mode: "empty",
    surface: "ghost",
  });
});

test("mapping present with empty discovery → empty state, never a frame", () => {
  assert.deepEqual(resolveChannelSurfaceTab("agency", []), {
    showTab: true,
    mode: "empty",
    surface: "agency",
  });
});

// ── ChannelSurfacePane render ─────────────────────────────────────────────────

test("ChannelSurfacePane renders the sandboxed frame when mode is frame", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePane, {
      state: { showTab: true, mode: "frame", surface: "agency" },
    }),
  );
  assert.ok(html.includes("<iframe"), "frame mode should render an iframe");
  assert.ok(
    html.includes('src="http://localhost:1337/surfaces/agency/"'),
    "iframe should point at the mapped surface URL",
  );
  assert.match(
    html,
    /sandbox="[^"]+"/,
    "the pane must render the sandboxed frame",
  );
});

test("ChannelSurfacePane renders a neutral empty state with NO iframe when mode is empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePane, {
      state: { showTab: true, mode: "empty", surface: "ghost" },
    }),
  );
  assert.ok(
    !html.includes("<iframe"),
    "empty mode must NOT render an iframe (allowlist enforcement)",
  );
  assert.ok(html.length > 0, "empty state should still render some markup");
});
