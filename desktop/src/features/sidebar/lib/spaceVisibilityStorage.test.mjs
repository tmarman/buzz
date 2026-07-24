import assert from "node:assert/strict";
import test from "node:test";

import {
  getHiddenSpaceIds,
  getHiddenSpaceIdsSnapshot,
  parseSpaceVisibilityPayload,
  restoreAllSpaces,
  setSpaceHidden,
  storageKey,
} from "./spaceVisibilityStorage.ts";

function installLocalStorage() {
  const store = new Map();
  const localStorage = {
    get length() {
      return store.size;
    },
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => store.set(key, value),
  };
  globalThis.window ??= {};
  globalThis.window.localStorage = localStorage;
  globalThis.window.dispatchEvent = () => true;
  globalThis.localStorage = localStorage;
  return localStorage;
}

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);

test("visibility preferences are isolated per pubkey", () => {
  installLocalStorage();
  setSpaceHidden(PUBKEY_A, "voxelbox-ai", true);
  assert.deepEqual(getHiddenSpaceIds(PUBKEY_A), ["voxelbox-ai"]);
  assert.deepEqual(getHiddenSpaceIds(PUBKEY_B), []);
  assert.notEqual(storageKey(PUBKEY_A), storageKey(PUBKEY_B));
});

test("hide is idempotent and restore removes one Space", () => {
  installLocalStorage();
  setSpaceHidden(PUBKEY_A, "sotto", true);
  setSpaceHidden(PUBKEY_A, "sotto", true);
  setSpaceHidden(PUBKEY_A, "voxelbox-ai", true);
  setSpaceHidden(PUBKEY_A, "sotto", false);
  assert.deepEqual(getHiddenSpaceIds(PUBKEY_A), ["voxelbox-ai"]);
});

test("restore all makes every discovered Space visible again", () => {
  installLocalStorage();
  setSpaceHidden(PUBKEY_A, "global", true);
  setSpaceHidden(PUBKEY_A, "sotto", true);
  restoreAllSpaces(PUBKEY_A);
  assert.equal(getHiddenSpaceIdsSnapshot(PUBKEY_A), "[]");
});

test("parsing drops invalid and duplicate Space IDs", () => {
  assert.deepEqual(
    parseSpaceVisibilityPayload({
      version: 1,
      hiddenSpaceIds: [" sotto ", "", "sotto", 42, "global"],
    }),
    { version: 1, hiddenSpaceIds: ["global", "sotto"] },
  );
  assert.equal(
    parseSpaceVisibilityPayload({ version: 2, hiddenSpaceIds: [] }),
    null,
  );
});

test("malformed storage fails open with every Space visible", () => {
  const localStorage = installLocalStorage();
  localStorage.setItem(storageKey(PUBKEY_A), "{ nope");
  assert.deepEqual(getHiddenSpaceIds(PUBKEY_A), []);
});
