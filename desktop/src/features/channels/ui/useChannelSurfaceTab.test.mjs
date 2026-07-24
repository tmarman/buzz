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
import { resolveChannelSurfaceTabs } from "./useChannelSurfaceTab.ts";
import { ChannelSurfacePane } from "./ChannelSurfacePane.tsx";

const descriptor = (name) => ({
  name,
  space: "global",
  description: "",
  ownerAgent: "",
  icon: "",
  category: "",
});
const INSTALLED = [descriptor("agency"), descriptor("notebook")];

// ── resolveChannelSurfaceTab ──────────────────────────────────────────────────

test("no mapping → no app tabs", () => {
  assert.deepEqual(resolveChannelSurfaceTabs([], INSTALLED), []);
});

test("mappings preserve order and discovered tabs show frames", () => {
  assert.deepEqual(
    resolveChannelSurfaceTabs(["notebook", "agency"], INSTALLED),
    [
      {
        mode: "frame",
        surface: "notebook",
        descriptor: descriptor("notebook"),
        executionScope: "global",
      },
      {
        mode: "frame",
        surface: "agency",
        descriptor: descriptor("agency"),
        executionScope: "global",
      },
    ],
  );
});

test("global and Space-owned apps execute inside the selected Space", () => {
  const spaceApp = {
    ...descriptor("build"),
    space: "voxelbox-ai",
  };
  assert.deepEqual(
    resolveChannelSurfaceTabs(
      ["agency", "build"],
      [...INSTALLED, spaceApp],
      "voxelbox-ai",
    ),
    [
      {
        descriptor: descriptor("agency"),
        executionScope: "space:voxelbox-ai",
        mode: "frame",
        surface: "agency",
      },
      {
        descriptor: spaceApp,
        executionScope: "space:voxelbox-ai",
        mode: "frame",
        surface: "build",
      },
    ],
  );
});

test("apps owned by another Space never reach the frame allowlist", () => {
  const foreignApp = {
    ...descriptor("finances"),
    space: "finances",
  };
  assert.deepEqual(
    resolveChannelSurfaceTabs(
      ["finances"],
      [...INSTALLED, foreignApp],
      "voxelbox-ai",
    ),
    [
      {
        descriptor: null,
        mode: "empty",
        surface: "finances",
      },
    ],
  );
});

test("mapping present but absent from discovery → tab shows empty state (allowlist gate)", () => {
  assert.deepEqual(resolveChannelSurfaceTabs(["ghost"], INSTALLED), [
    {
      descriptor: null,
      mode: "empty",
      surface: "ghost",
    },
  ]);
});

test("mapping present with empty discovery → empty state, never a frame", () => {
  assert.deepEqual(resolveChannelSurfaceTabs(["agency"], []), [
    {
      descriptor: null,
      mode: "empty",
      surface: "agency",
    },
  ]);
});

test("ChannelSurfacePane renders the sandboxed frame when mode is frame", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePane, {
      state: {
        descriptor: descriptor("agency"),
        executionScope: "space:voxelbox-ai",
        mode: "frame",
        surface: "agency",
      },
    }),
  );
  assert.ok(html.includes("<iframe"), "frame mode should render an iframe");
  assert.ok(
    html.includes(
      'src="http://localhost:1337/surfaces/agency/?embedded=1&amp;scope=space%3Avoxelbox-ai"',
    ),
    "iframe should receive embedded mode and the channel Space scope",
  );
  assert.match(
    html,
    /sandbox="[^"]+"/,
    "the pane must render the sandboxed frame",
  );
  assert.ok(
    html.includes("pt-(--buzz-channel-content-top-padding,5.75rem)"),
    "surface content must clear the measured overlaid channel header",
  );
});

test("ChannelSurfacePane renders a neutral empty state with NO iframe when mode is empty", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePane, {
      state: { descriptor: null, mode: "empty", surface: "ghost" },
    }),
  );
  assert.ok(
    !html.includes("<iframe"),
    "empty mode must NOT render an iframe (allowlist enforcement)",
  );
  assert.ok(
    html.includes("pt-(--buzz-channel-content-top-padding,5.75rem)"),
    "the unavailable state must align with the framed surface viewport",
  );
  assert.ok(html.length > 0, "empty state should still render some markup");
});
