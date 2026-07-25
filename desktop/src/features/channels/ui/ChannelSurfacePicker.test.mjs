import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// RED baseline (Track E — channel-surface-picker).
//
// Contract this test pins:
//   ChannelSurfacePicker — a small affordance (lives inside an existing channel
//   affordance such as the channel menu / ChannelManagementSheet popover) that
//   lists Space-eligible surfaces and pins/unpins channel app tabs.
//   mapping. Presentational props:
//     { surfaces: descriptor[]; spaces: summary[]; selectedSpace: string | null;
//       selectedSurfaces: string[]; onToggle; onSpaceChange }
//   - lists each discovered surface name
//   - empty `surfaces` (discovery failure degrades to []) → neutral empty state,
//     never a crash
//   - the currently selected surface is reflected in the markup
//
//   The mapping the picker writes/clears round-trips through the device-local
//   channelSurfaceStorage module (set writes; clear removes).
import { ChannelSurfacePicker } from "./ChannelSurfacePicker.tsx";
import {
  addChannelSurface,
  getChannelSurfaces,
  removeChannelSurface,
} from "../../sidebar/lib/channelSurfaceStorage.ts";

function makeLocalStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
  };
}

function installLocalStorage() {
  const ls = makeLocalStorage();
  if (typeof globalThis.window === "undefined") {
    globalThis.window = {};
  }
  globalThis.window.localStorage = ls;
  globalThis.localStorage = ls;
  return ls;
}

const PUBKEY = "a".repeat(64);
const noop = () => {};
const descriptor = (name, space = "global") => ({
  name,
  space,
  description: "",
  ownerAgent: "",
  icon: "",
  category: "",
  placements: ["channel_tab"],
  requiresContext: [],
});

// ── render: list discovered surfaces ──────────────────────────────────────────

test("ChannelSurfacePicker lists each discovered surface name", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: [descriptor("agency"), descriptor("notebook")],
      spaces: [],
      selectedSpace: null,
      selectedSurfaces: [],
      onToggle: noop,
      onSpaceChange: noop,
    }),
  );
  assert.ok(html.includes("agency"), "should list the 'agency' surface");
  assert.ok(html.includes("notebook"), "should list the 'notebook' surface");
});

// ── render: failure / empty discovery ─────────────────────────────────────────

test("ChannelSurfacePicker renders an empty state (no crash) when discovery is empty", () => {
  let html;
  assert.doesNotThrow(() => {
    html = renderToStaticMarkup(
      React.createElement(ChannelSurfacePicker, {
        surfaces: [],
        spaces: [],
        selectedSpace: null,
        selectedSurfaces: [],
        onToggle: noop,
        onSpaceChange: noop,
      }),
    );
  });
  assert.ok(html.length > 0, "empty state should still render markup");
});

// ── render: selected surface reflected ────────────────────────────────────────

test("ChannelSurfacePicker reflects the currently selected surface", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: [descriptor("agency"), descriptor("notebook")],
      spaces: [],
      selectedSpace: null,
      selectedSurfaces: ["agency"],
      onToggle: noop,
      onSpaceChange: noop,
    }),
  );
  assert.ok(
    html.includes("agency"),
    "selected surface should appear in markup",
  );
});

// ── set / clear round-trips through channelSurfaceStorage ─────────────────────

test("selecting surfaces writes ordered tabs (via channelSurfaceStorage)", () => {
  installLocalStorage();
  addChannelSurface(PUBKEY, "chan-1", "agency");
  addChannelSurface(PUBKEY, "chan-1", "notebook");
  assert.deepEqual(getChannelSurfaces(PUBKEY, "chan-1"), [
    "agency",
    "notebook",
  ]);
});

test("unpinning removes only the selected tab (via channelSurfaceStorage)", () => {
  installLocalStorage();
  addChannelSurface(PUBKEY, "chan-1", "agency");
  addChannelSurface(PUBKEY, "chan-1", "notebook");
  removeChannelSurface(PUBKEY, "chan-1", "agency");
  assert.deepEqual(getChannelSurfaces(PUBKEY, "chan-1"), ["notebook"]);
});

test("Space filtering keeps global apps and the selected Space apps", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: [
        descriptor("launcher"),
        descriptor("control", "Voxelbox"),
        descriptor("finances", "Finances"),
      ],
      spaces: [
        {
          name: "Voxelbox",
          displayName: "Voxelbox",
          description: "",
          stewards: [],
          surfaces: [],
        },
      ],
      selectedSpace: "Voxelbox",
      selectedSurfaces: [],
      onToggle: noop,
      onSpaceChange: noop,
    }),
  );
  assert.match(html, />launcher</);
  assert.match(html, />control</);
  assert.doesNotMatch(html, />finances</);
});

test("legacy apps are hidden from recommendations but remain visible when selected", () => {
  const legacy = {
    ...descriptor("control"),
    placements: [],
  };
  const hidden = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: [legacy],
      spaces: [],
      selectedSpace: null,
      selectedSurfaces: [],
      onToggle: noop,
      onSpaceChange: noop,
    }),
  );
  assert.doesNotMatch(hidden, />control</);

  const selected = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: [legacy],
      spaces: [],
      selectedSpace: null,
      selectedSurfaces: ["control"],
      onToggle: noop,
      onSpaceChange: noop,
    }),
  );
  assert.match(selected, />control</);
});
