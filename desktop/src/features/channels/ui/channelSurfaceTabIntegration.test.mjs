import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Integration wiring for Track E (picker → storage → channel app tab).
//
// The red baselines cover each seam in isolation (pure resolve, presentational
// picker, presentational pane). This suite exercises the REAL wiring end to end
// through the shipped modules: the picker's storage write, the storage change
// signal, the tab's allowlist resolve, and the pane render — including the
// stale-allowlist fix (a clear must drop the frame) and the discovery gate
// (only discovered surfaces reach a live iframe).
import {
  addChannelSurface,
  getChannelSurfaces,
  removeChannelSurface,
  subscribeChannelSurface,
} from "@/features/sidebar/lib/channelSurfaceStorage";
import { fetchInstalledSurfaces } from "@/features/surfaces/lib/surfaceDiscovery";
import { ChannelSurfacePane } from "./ChannelSurfacePane.tsx";
import { resolveChannelSurfaceTabs } from "./useChannelSurfaceTab.ts";

const PUBKEY = "a".repeat(64);
const CHANNEL = "chan-1";
const descriptor = (name) => ({
  name,
  space: "global",
  description: "",
  ownerAgent: "",
});
const DISCOVERY = [descriptor("agency"), descriptor("notebook")];

// EventTarget-backed window so the storage change event fires listeners — this
// is what makes the tab recompute reactively (what useSyncExternalStore does in
// the real hook).
function installReactiveWindow() {
  const store = new Map();
  const ls = {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
  const win = new EventTarget();
  win.localStorage = ls;
  globalThis.window = win;
  globalThis.localStorage = ls;
}

// Mirrors the reactive read useChannelSurfaceTab performs: recompute the tab
// state from the (re-read) mapping on every storage change signal.
function mountTab(discovery) {
  let state =
    resolveChannelSurfaceTabs(
      getChannelSurfaces(PUBKEY, CHANNEL),
      discovery,
    )[0] ?? null;
  const unsub = subscribeChannelSurface(() => {
    state =
      resolveChannelSurfaceTabs(
        getChannelSurfaces(PUBKEY, CHANNEL),
        discovery,
      )[0] ?? null;
  });
  return {
    get state() {
      return state;
    },
    unsub,
  };
}

const paneHtml = (state) =>
  state
    ? renderToStaticMarkup(React.createElement(ChannelSurfacePane, { state }))
    : "";

test("picker select → storage write → tab shows the sandboxed frame", () => {
  installReactiveWindow();
  const tab = mountTab(DISCOVERY);
  assert.equal(tab.state, null, "no tab before any mapping");

  // The exact call ChannelSurfacePickerSection.handleSelect makes.
  addChannelSurface(PUBKEY, CHANNEL, "agency");

  assert.deepEqual(tab.state, {
    descriptor: descriptor("agency"),
    mode: "frame",
    surface: "agency",
  });
  const html = paneHtml(tab.state);
  assert.ok(html.includes("<iframe"), "frame mode renders an iframe");
  assert.ok(
    html.includes('src="http://localhost:1337/surfaces/agency/"'),
    "iframe points at the mapped surface URL",
  );
  assert.match(html, /sandbox="[^"]*allow-scripts[^"]*"/);
  tab.unsub();
});

test("picker clear → tab drops the frame (stale-allowlist fix)", () => {
  installReactiveWindow();
  addChannelSurface(PUBKEY, CHANNEL, "agency");
  const tab = mountTab(DISCOVERY);
  assert.equal(tab.state.mode, "frame", "frame present before clear");

  // The exact call ChannelSurfacePickerSection.handleClear makes.
  removeChannelSurface(PUBKEY, CHANNEL, "agency");

  assert.equal(tab.state, null);
  assert.ok(
    !paneHtml(tab.state).includes("<iframe"),
    "a cleared mapping must not leave a live iframe",
  );
  tab.unsub();
});

test("discovery stub gates iframe rendering: only discovered surfaces get a frame", async () => {
  installReactiveWindow();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ name: "agency" }]), { status: 200 });
  try {
    const installed = await fetchInstalledSurfaces();
    assert.deepEqual(installed, ["agency"]);

    const descriptors = installed.map(descriptor);
    const discovered = resolveChannelSurfaceTabs(["agency"], descriptors)[0];
    assert.equal(discovered.mode, "frame");
    assert.ok(paneHtml(discovered).includes("<iframe"));

    const undiscovered = resolveChannelSurfaceTabs(
      ["notebook"],
      descriptors,
    )[0];
    assert.equal(undiscovered.mode, "empty");
    assert.ok(
      !paneHtml(undiscovered).includes("<iframe"),
      "a surface absent from discovery must never reach a live iframe",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remapping to a different surface reactively swaps the frame URL", () => {
  installReactiveWindow();
  addChannelSurface(PUBKEY, CHANNEL, "agency");
  const tab = mountTab(DISCOVERY);
  assert.ok(paneHtml(tab.state).includes("/surfaces/agency/"));

  removeChannelSurface(PUBKEY, CHANNEL, "agency");
  addChannelSurface(PUBKEY, CHANNEL, "notebook");
  assert.equal(tab.state.surface, "notebook");
  assert.ok(paneHtml(tab.state).includes("/surfaces/notebook/"));
  tab.unsub();
});
