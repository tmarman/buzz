import assert from "node:assert/strict";
import test from "node:test";

// Reactivity contract for channelSurfaceStorage (Track E — stale-allowlist fix).
//
// localStorage writes are not reactive, and the picker (writer) and the channel
// app tab (reader) are separate components. Without an explicit same-document
// signal, clearing a mapping in the picker would leave a stale surface frame
// mounted in the channel. subscribeChannelSurface + the change event are that
// signal; this suite pins it.
import {
  clearChannelSurface,
  getChannelSurface,
  setChannelSurface,
  subscribeChannelSurface,
} from "./channelSurfaceStorage.ts";

const PUBKEY = "a".repeat(64);

// An EventTarget-backed window so the module's CustomEvent dispatch actually
// fires listeners (the plain `window = {}` doubles used elsewhere can't).
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
  return ls;
}

test("subscribeChannelSurface fires on set and the re-read sees the new mapping", () => {
  installReactiveWindow();
  const seen = [];
  const unsub = subscribeChannelSurface(() => {
    seen.push(getChannelSurface(PUBKEY, "chan-1"));
  });
  setChannelSurface(PUBKEY, "chan-1", "agency");
  assert.deepEqual(seen, ["agency"], "listener fired and re-read the write");
  unsub();
});

test("subscribeChannelSurface fires on clear and the re-read sees the mapping gone", () => {
  installReactiveWindow();
  setChannelSurface(PUBKEY, "chan-1", "agency");
  const seen = [];
  const unsub = subscribeChannelSurface(() => {
    seen.push(getChannelSurface(PUBKEY, "chan-1"));
  });
  clearChannelSurface(PUBKEY, "chan-1");
  assert.deepEqual(seen, [undefined], "listener fired and re-read the clear");
  unsub();
});

test("unsubscribe stops further notifications", () => {
  installReactiveWindow();
  let count = 0;
  const unsub = subscribeChannelSurface(() => {
    count += 1;
  });
  setChannelSurface(PUBKEY, "chan-1", "agency");
  assert.equal(count, 1);
  unsub();
  clearChannelSurface(PUBKEY, "chan-1");
  assert.equal(count, 1, "no notification after unsubscribe");
});

test("clearing an absent mapping does not notify (no spurious re-render)", () => {
  installReactiveWindow();
  let count = 0;
  const unsub = subscribeChannelSurface(() => {
    count += 1;
  });
  clearChannelSurface(PUBKEY, "never-set");
  assert.equal(count, 0, "no-op clear must not notify");
  unsub();
});

test("mutations never throw where window has no event surface (guarded dispatch)", () => {
  // The storage test doubles stub `window = {}` with no dispatchEvent; a set
  // must still succeed there rather than throw.
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
  globalThis.window = {};
  globalThis.window.localStorage = ls;
  globalThis.localStorage = ls;
  assert.doesNotThrow(() => setChannelSurface(PUBKEY, "chan-1", "agency"));
  assert.equal(getChannelSurface(PUBKEY, "chan-1"), "agency");
  // subscribe degrades to a no-op unsubscribe when addEventListener is absent.
  assert.doesNotThrow(() => {
    const unsub = subscribeChannelSurface(() => {});
    unsub();
  });
});
