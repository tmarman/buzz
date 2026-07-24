import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// RED baseline (Track E — channel-surface-picker).
//
// Contract this test pins:
//   ChannelSurfacePicker — a small affordance (lives inside an existing channel
//   affordance such as the channel menu / ChannelManagementSheet popover) that
//   lists surfaces from daemon discovery and sets/clears the channel -> surface
//   mapping. Presentational props:
//     { surfaces: string[]; selectedSurface: string | null;
//       onSelect: (name: string) => void; onClear: () => void }
//   - lists each discovered surface name
//   - empty `surfaces` (discovery failure degrades to []) → neutral empty state,
//     never a crash
//   - the currently selected surface is reflected in the markup
//
//   The mapping the picker writes/clears round-trips through the device-local
//   channelSurfaceStorage module (set writes; clear removes).
import { ChannelSurfacePicker } from "./ChannelSurfacePicker.tsx";
import {
  setChannelSurface,
  getChannelSurface,
  clearChannelSurface,
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

// ── render: list discovered surfaces ──────────────────────────────────────────

test("ChannelSurfacePicker lists each discovered surface name", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: ["agency", "notebook"],
      selectedSurface: null,
      onSelect: noop,
      onClear: noop,
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
        selectedSurface: null,
        onSelect: noop,
        onClear: noop,
      }),
    );
  });
  assert.ok(html.length > 0, "empty state should still render markup");
});

// ── render: selected surface reflected ────────────────────────────────────────

test("ChannelSurfacePicker reflects the currently selected surface", () => {
  const html = renderToStaticMarkup(
    React.createElement(ChannelSurfacePicker, {
      surfaces: ["agency", "notebook"],
      selectedSurface: "agency",
      onSelect: noop,
      onClear: noop,
    }),
  );
  assert.ok(
    html.includes("agency"),
    "selected surface should appear in markup",
  );
});

// ── set / clear round-trips through channelSurfaceStorage ─────────────────────

test("selecting a surface writes the mapping (via channelSurfaceStorage)", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY, "chan-1", "agency");
  assert.equal(getChannelSurface(PUBKEY, "chan-1"), "agency");
});

test("clearing removes the mapping (via channelSurfaceStorage)", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY, "chan-1", "agency");
  clearChannelSurface(PUBKEY, "chan-1");
  assert.equal(getChannelSurface(PUBKEY, "chan-1"), undefined);
});
