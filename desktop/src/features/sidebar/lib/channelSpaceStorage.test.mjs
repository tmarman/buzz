import assert from "node:assert/strict";
import test from "node:test";

import {
  clearChannelSpace,
  getChannelSpace,
  setChannelSpace,
} from "./channelSpaceStorage.ts";

function installLocalStorage() {
  const store = new Map();
  const localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  globalThis.window = { localStorage };
  globalThis.localStorage = localStorage;
}

test("channel Space association round-trips and clears", () => {
  installLocalStorage();
  const pubkey = "a".repeat(64);

  assert.equal(setChannelSpace(pubkey, "channel-1", " voxelbox-ai "), true);
  assert.equal(getChannelSpace(pubkey, "channel-1"), "voxelbox-ai");
  assert.equal(clearChannelSpace(pubkey, "channel-1"), true);
  assert.equal(getChannelSpace(pubkey, "channel-1"), undefined);
});
