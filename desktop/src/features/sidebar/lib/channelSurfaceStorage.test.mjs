import assert from "node:assert/strict";
import test from "node:test";

// RED baseline (Track E — surface-channel-storage).
//
// Contract this test pins for the not-yet-written module:
//   channelSurfaceStorage.ts — a versioned, device-local localStorage store
//   keyed per pubkey, mapping channelId -> surface name (string). Modeled on
//   its siblings (channelStarsStorage / channelMutesStorage / channelSections).
//
//   Exports under test:
//     storageKey(pubkey): string                              // `${PREFIX}:${pubkey}`
//     parseSurfacePayload(json: unknown): Store | null        // mirrors parseStarPayload
//     getChannelSurface(pubkey, channelId): string | undefined
//     setChannelSurface(pubkey, channelId, surfaceName): boolean
//     clearChannelSurface(pubkey, channelId): boolean
//
//   Store shape: { version: 1, channels: Record<string, string> }
//   Device-local ONLY — there is intentionally NO channelSurfaceSync.ts and no
//   Nostr kind (the relay whitelists kinds and would reject it).
import {
  storageKey,
  parseSurfacePayload,
  getChannelSurface,
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

test("parseSurfacePayload: valid payload returns store", () => {
  const result = parseSurfacePayload({
    version: 1,
    channels: { "chan-1": "agency", "chan-2": "notebook" },
  });
  assert.deepEqual(result, {
    version: 1,
    channels: { "chan-1": "agency", "chan-2": "notebook" },
  });
});

test("parseSurfacePayload: missing version returns null", () => {
  assert.equal(parseSurfacePayload({ channels: { "chan-1": "agency" } }), null);
});

test("parseSurfacePayload: wrong version returns null", () => {
  assert.equal(
    parseSurfacePayload({ version: 2, channels: { "chan-1": "agency" } }),
    null,
  );
});

test("parseSurfacePayload: null / non-object input returns null", () => {
  assert.equal(parseSurfacePayload(null), null);
  assert.equal(parseSurfacePayload("string"), null);
  assert.equal(parseSurfacePayload(42), null);
  assert.equal(parseSurfacePayload(true), null);
});

test("parseSurfacePayload: non-string channel values are dropped", () => {
  const result = parseSurfacePayload({
    version: 1,
    channels: {
      valid: "agency",
      "num-value": 7,
      "obj-value": { name: "agency" },
      "null-value": null,
      "bool-value": true,
    },
  });
  assert.deepEqual(result, { version: 1, channels: { valid: "agency" } });
});

test("parseSurfacePayload: empty channels returns store with empty channels", () => {
  assert.deepEqual(parseSurfacePayload({ version: 1, channels: {} }), {
    version: 1,
    channels: {},
  });
});

test("parseSurfacePayload: version 1 with no channels key returns empty channels", () => {
  assert.deepEqual(parseSurfacePayload({ version: 1 }), {
    version: 1,
    channels: {},
  });
});
