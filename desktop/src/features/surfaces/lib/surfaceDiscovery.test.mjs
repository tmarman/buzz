import assert from "node:assert/strict";
import test from "node:test";

// RED baseline (Track E — surface-discovery-allowlist).
//
// Contract this test pins for the not-yet-written module:
//   surfaceDiscovery.ts
//     fetchInstalledSurfaces(): Promise<string[]>
//       GETs http://localhost:1337/surfaces/ (a JSON array of { name, ... }
//       objects) and resolves the array's `name` values. ANY failure —
//       non-ok response, fetch throw, non-array / invalid JSON — resolves to
//       [] and NEVER throws (graceful degradation).
//     isSurfaceAllowed(name: string, installedNames: string[]): boolean
//       pure allowlist filter — true only for names present in the list.
//
// Tests MUST stub global fetch and never hit the network.
import {
  fetchInstalledSurfaces,
  isSurfaceAllowed,
} from "./surfaceDiscovery.ts";

const DISCOVERY_URL = "http://localhost:1337/surfaces/";

function withFetch(handler, run) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let lastUrl;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    lastUrl = typeof url === "string" ? url : String(url);
    return handler(url, init);
  };
  return Promise.resolve(run(() => ({ calls, lastUrl }))).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

// ── fetchInstalledSurfaces: success ───────────────────────────────────────────

test("fetchInstalledSurfaces GETs the discovery endpoint and returns names", async () => {
  await withFetch(
    async (url) => {
      assert.equal(url, DISCOVERY_URL);
      return new Response(
        JSON.stringify([
          { name: "agency", title: "Agency" },
          { name: "notebook", title: "Notebook" },
        ]),
        { status: 200 },
      );
    },
    async (inspect) => {
      const names = await fetchInstalledSurfaces();
      assert.deepEqual(names, ["agency", "notebook"]);
      assert.equal(inspect().calls, 1, "fetch called exactly once");
      assert.equal(inspect().lastUrl, DISCOVERY_URL);
    },
  );
});

test("fetchInstalledSurfaces returns [] for an empty installed list", async () => {
  await withFetch(
    async () => new Response(JSON.stringify([]), { status: 200 }),
    async () => {
      assert.deepEqual(await fetchInstalledSurfaces(), []);
    },
  );
});

// ── fetchInstalledSurfaces: graceful failure ──────────────────────────────────

test("fetchInstalledSurfaces returns [] on a non-ok response (no throw)", async () => {
  await withFetch(
    async () => new Response(null, { status: 500 }),
    async () => {
      assert.deepEqual(await fetchInstalledSurfaces(), []);
    },
  );
});

test("fetchInstalledSurfaces returns [] when fetch throws (no throw)", async () => {
  await withFetch(
    async () => {
      throw new Error("network down");
    },
    async () => {
      assert.deepEqual(await fetchInstalledSurfaces(), []);
    },
  );
});

test("fetchInstalledSurfaces returns [] on malformed JSON (no throw)", async () => {
  await withFetch(
    async () => new Response("{ not json ]", { status: 200 }),
    async () => {
      assert.deepEqual(await fetchInstalledSurfaces(), []);
    },
  );
});

test("fetchInstalledSurfaces returns [] when body is not an array (no throw)", async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ name: "agency" }), { status: 200 }),
    async () => {
      assert.deepEqual(await fetchInstalledSurfaces(), []);
    },
  );
});

// ── isSurfaceAllowed ──────────────────────────────────────────────────────────

test("isSurfaceAllowed: true only for names in the discovered list", () => {
  const installed = ["agency", "notebook"];
  assert.equal(isSurfaceAllowed("agency", installed), true);
  assert.equal(isSurfaceAllowed("notebook", installed), true);
  assert.equal(isSurfaceAllowed("ghost", installed), false);
});

test("isSurfaceAllowed: empty installed list allows nothing", () => {
  assert.equal(isSurfaceAllowed("agency", []), false);
});
