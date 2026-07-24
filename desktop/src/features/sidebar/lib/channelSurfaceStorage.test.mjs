import assert from "node:assert/strict";
import test from "node:test";

// RED baseline (Track E — surface-channel-storage).
//
// Contract this test pins for the not-yet-written module:
//   channelSurfaceStorage.ts — a versioned, device-local localStorage store
//   keyed per pubkey, mapping channelId -> ordered surface names. Modeled on
//   its siblings (channelStarsStorage / channelMutesStorage / channelSections).
//
//   Exports under test:
//     storageKey(pubkey): string                              // `${PREFIX}:${pubkey}`
//     parseSurfacePayload(json: unknown): Store | null        // mirrors parseStarPayload
//     getChannelSurface(pubkey, channelId): string | undefined
//     setChannelSurface(pubkey, channelId, surfaceName): boolean
//     getChannelSurfaces(pubkey, channelId): string[]
//     addChannelSurface(pubkey, channelId, surfaceName): boolean
//     removeChannelSurface(pubkey, channelId, surfaceName): boolean
//     clearChannelSurface(pubkey, channelId): boolean
//
//   Store shape: { version: 3, channels: Record<string, string[]>, initializedChannels: string[] }
//   Device-local ONLY — there is intentionally NO channelSurfaceSync.ts and no
//   Nostr kind (the relay whitelists kinds and would reject it).
import {
  addChannelSurface,
  storageKey,
  parseSurfacePayload,
  getChannelSurface,
  getChannelSurfaces,
  initializeChannelSurfaces,
  removeChannelSurface,
  setChannelSurface,
  clearChannelSurface,
} from "./channelSurfaceStorage.ts";

function makeLocalStorage() {
  const store = new Map();
  return {
    get size() {
      return store.size;
    },
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

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);

// ── storageKey ────────────────────────────────────────────────────────────────

test("storageKey: is per-pubkey (distinct pubkeys → distinct keys)", () => {
  assert.notEqual(storageKey(PUBKEY_A), storageKey(PUBKEY_B));
  assert.ok(storageKey(PUBKEY_A).includes(PUBKEY_A));
});

// ── set / get round-trip ──────────────────────────────────────────────────────

test("set then get round-trips a channel → surface mapping", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY_A, "chan-1", "agency");
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), "agency");
});

test("set supports multiple channels independently", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY_A, "chan-1", "agency");
  setChannelSurface(PUBKEY_A, "chan-2", "notebook");
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), "agency");
  assert.equal(getChannelSurface(PUBKEY_A, "chan-2"), "notebook");
});

test("set overwrites an existing channel mapping", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY_A, "chan-1", "agency");
  setChannelSurface(PUBKEY_A, "chan-1", "notebook");
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), "notebook");
});

test("add preserves ordered tabs and ignores duplicates", () => {
  installLocalStorage();
  addChannelSurface(PUBKEY_A, "chan-1", "control");
  addChannelSurface(PUBKEY_A, "chan-1", "flow");
  addChannelSurface(PUBKEY_A, "chan-1", "control");
  assert.deepEqual(getChannelSurfaces(PUBKEY_A, "chan-1"), ["control", "flow"]);
});

test("remove unpins only the selected surface", () => {
  installLocalStorage();
  addChannelSurface(PUBKEY_A, "chan-1", "control");
  addChannelSurface(PUBKEY_A, "chan-1", "flow");
  removeChannelSurface(PUBKEY_A, "chan-1", "control");
  assert.deepEqual(getChannelSurfaces(PUBKEY_A, "chan-1"), ["flow"]);
});

test("Space defaults initialize once and never fight explicit removal", () => {
  installLocalStorage();
  initializeChannelSurfaces(PUBKEY_A, "chan-1", ["home", "control"]);
  assert.deepEqual(getChannelSurfaces(PUBKEY_A, "chan-1"), ["home", "control"]);
  clearChannelSurface(PUBKEY_A, "chan-1");
  initializeChannelSurfaces(PUBKEY_A, "chan-1", ["launcher"]);
  assert.deepEqual(getChannelSurfaces(PUBKEY_A, "chan-1"), []);
});

test("get for an unknown channel returns undefined", () => {
  installLocalStorage();
  assert.equal(getChannelSurface(PUBKEY_A, "never-set"), undefined);
});

// ── clear ─────────────────────────────────────────────────────────────────────

test("clear removes only the targeted channel mapping", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY_A, "chan-1", "agency");
  setChannelSurface(PUBKEY_A, "chan-2", "notebook");
  clearChannelSurface(PUBKEY_A, "chan-1");
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), undefined);
  assert.equal(getChannelSurface(PUBKEY_A, "chan-2"), "notebook");
});

test("clear on an unknown channel does not throw", () => {
  installLocalStorage();
  assert.doesNotThrow(() => clearChannelSurface(PUBKEY_A, "never-set"));
  assert.equal(getChannelSurface(PUBKEY_A, "never-set"), undefined);
});

// ── per-pubkey isolation ──────────────────────────────────────────────────────

test("mappings for two pubkeys are isolated", () => {
  installLocalStorage();
  setChannelSurface(PUBKEY_A, "chan-1", "agency");
  assert.equal(getChannelSurface(PUBKEY_B, "chan-1"), undefined);
  setChannelSurface(PUBKEY_B, "chan-1", "notebook");
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), "agency");
  assert.equal(getChannelSurface(PUBKEY_B, "chan-1"), "notebook");
});

// ── defensive reads (no throw on corrupt storage) ─────────────────────────────

test("malformed JSON in storage → get returns undefined (no throw)", () => {
  const ls = installLocalStorage();
  ls.setItem(storageKey(PUBKEY_A), "{ not json ]");
  assert.doesNotThrow(() => getChannelSurface(PUBKEY_A, "chan-1"));
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), undefined);
});

test("wrong version in storage → get returns undefined (no throw)", () => {
  const ls = installLocalStorage();
  ls.setItem(
    storageKey(PUBKEY_A),
    JSON.stringify({ version: 999, channels: { "chan-1": "agency" } }),
  );
  assert.equal(getChannelSurface(PUBKEY_A, "chan-1"), undefined);
});

// ── parseSurfacePayload ───────────────────────────────────────────────────────

test("parseSurfacePayload: migrates a version 1 payload", () => {
  const result = parseSurfacePayload({
    version: 1,
    channels: { "chan-1": "agency", "chan-2": "notebook" },
  });
  assert.deepEqual(result, {
    version: 3,
    channels: { "chan-1": ["agency"], "chan-2": ["notebook"] },
    initializedChannels: ["chan-1", "chan-2"],
  });
});

test("parseSurfacePayload: accepts ordered version 2 tabs", () => {
  const result = parseSurfacePayload({
    version: 2,
    channels: { "chan-1": ["control", "flow", "control", " "] },
  });
  assert.deepEqual(result, {
    version: 3,
    channels: { "chan-1": ["control", "flow"] },
    initializedChannels: ["chan-1"],
  });
});

test("parseSurfacePayload: accepts version 3 initialization markers", () => {
  assert.deepEqual(
    parseSurfacePayload({
      version: 3,
      channels: {},
      initializedChannels: ["chan-1", "chan-1", " "],
    }),
    {
      version: 3,
      channels: {},
      initializedChannels: ["chan-1"],
    },
  );
});

test("parseSurfacePayload: missing version returns null", () => {
  assert.equal(parseSurfacePayload({ channels: { "chan-1": "agency" } }), null);
});

test("parseSurfacePayload: wrong version returns null", () => {
  assert.equal(
    parseSurfacePayload({ version: 4, channels: { "chan-1": ["agency"] } }),
    null,
  );
});

test("parseSurfacePayload: null / non-object input returns null", () => {
  assert.equal(parseSurfacePayload(null), null);
  assert.equal(parseSurfacePayload("string"), null);
  assert.equal(parseSurfacePayload(42), null);
  assert.equal(parseSurfacePayload(true), null);
});

test("parseSurfacePayload: invalid channel values are dropped", () => {
  const result = parseSurfacePayload({
    version: 2,
    channels: {
      valid: ["agency", 7, null],
      "num-value": 7,
      "obj-value": { name: "agency" },
      "null-value": null,
      "bool-value": true,
    },
  });
  assert.deepEqual(result, {
    version: 3,
    channels: { valid: ["agency"] },
    initializedChannels: ["valid"],
  });
});

test("parseSurfacePayload: empty channels returns store with empty channels", () => {
  assert.deepEqual(parseSurfacePayload({ version: 2, channels: {} }), {
    version: 3,
    channels: {},
    initializedChannels: [],
  });
});

test("parseSurfacePayload: version 2 with no channels key returns empty channels", () => {
  assert.deepEqual(parseSurfacePayload({ version: 2 }), {
    version: 3,
    channels: {},
    initializedChannels: [],
  });
});
