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
  fetchInstalledSurfaceDescriptors,
  fetchInstalledSurfaces,
  fetchVoxelboxSpaces,
  isSurfaceEligibleForPlacement,
  isSurfaceAllowed,
  matchChannelToVoxelboxSpace,
} from "./surfaceDiscovery.ts";

const DISCOVERY_URL = "http://localhost:1337/surfaces/?scope=global";

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

test("fetchInstalledSurfaces trims names and drops empty manifest names", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify([
          { name: " control " },
          { name: " " },
          { name: "flow" },
        ]),
        { status: 200 },
      ),
    async () => {
      assert.deepEqual(await fetchInstalledSurfaces(), ["control", "flow"]);
    },
  );
});

test("surface descriptors normalize explicit and legacy Space scope", async () => {
  await withFetch(
    async () =>
      new Response(
        JSON.stringify([
          {
            id: " control ",
            space: " global ",
            description: " Control plane ",
          },
          { name: "scout", org: "voxelbox-ai" },
          { name: "flow" },
        ]),
        { status: 200 },
      ),
    async () => {
      assert.deepEqual(await fetchInstalledSurfaceDescriptors(), [
        {
          name: "control",
          space: "global",
          description: "Control plane",
          ownerAgent: "",
          icon: "",
          category: "",
          placements: [],
          requiresContext: [],
        },
        {
          name: "scout",
          space: "voxelbox-ai",
          description: "",
          ownerAgent: "",
          icon: "",
          category: "",
          placements: [],
          requiresContext: [],
        },
        {
          name: "flow",
          space: "global",
          description: "",
          ownerAgent: "",
          icon: "",
          category: "",
          placements: [],
          requiresContext: [],
        },
      ]);
    },
  );
});

test("surface discovery sends the requested Space scope to the daemon", async () => {
  await withFetch(
    async (url) => {
      assert.equal(
        url,
        "http://localhost:1337/surfaces/?scope=space%3Avoxelbox-ai",
      );
      return new Response(
        JSON.stringify([{ name: "portfolio", org: "voxelbox-ai" }]),
        { status: 200 },
      );
    },
    async () => {
      assert.deepEqual(
        await fetchInstalledSurfaceDescriptors("space:voxelbox-ai"),
        [
          {
            name: "portfolio",
            space: "voxelbox-ai",
            description: "",
            ownerAgent: "",
            icon: "",
            category: "",
            placements: [],
            requiresContext: [],
          },
        ],
      );
    },
  );
});

test("channel labels match canonical Space IDs or display names exactly", () => {
  const spaces = [
    {
      name: "voxelbox-ai",
      displayName: "Voxelbox",
      description: "",
      stewards: ["smithy"],
      surfaces: [],
    },
  ];
  assert.equal(
    matchChannelToVoxelboxSpace("Voxelbox", spaces)?.name,
    "voxelbox-ai",
  );
  assert.equal(
    matchChannelToVoxelboxSpace("voxelbox-ai", spaces)?.name,
    "voxelbox-ai",
  );
  assert.equal(matchChannelToVoxelboxSpace("Voxelbox chat", spaces), undefined);
});

test("fetchInstalledSurfaces uses native IPC inside Tauri", async () => {
  const previousIsTauri = globalThis.isTauri;
  const previousWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let invokedCommand = null;
  let invokedArgs = null;

  globalThis.isTauri = true;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command, args) {
        invokedCommand = command;
        invokedArgs = args;
        return Promise.resolve([
          {
            name: "control",
            space: "global",
            description: "Control plane",
            ownerAgent: "weaver",
          },
          {
            name: " flow ",
            space: "tmarman",
            description: "",
            ownerAgent: "",
          },
          {
            name: "",
            space: "global",
            description: "",
            ownerAgent: "",
          },
        ]);
      },
    },
  };
  globalThis.fetch = async () => {
    throw new Error("web fetch must not run inside Tauri");
  };

  try {
    assert.deepEqual(await fetchInstalledSurfaces(), ["control", "flow"]);
    assert.equal(invokedCommand, "discover_local_surfaces");
    assert.deepEqual(invokedArgs, { scope: "global" });
  } finally {
    globalThis.isTauri = previousIsTauri;
    globalThis.window = previousWindow;
    globalThis.fetch = originalFetch;
  }
});

test("fetchVoxelboxSpaces strips private registry fields", async () => {
  await withFetch(
    async (url) => {
      assert.equal(url, "http://localhost:1337/api/spaces");
      return new Response(
        JSON.stringify([
          {
            name: " voxelbox-ai ",
            display_name: " Voxelbox ",
            description: " Agent OS ",
            stewards: [" smithy ", "", 7],
            surfaces: [" control "],
            workspace: "/private/path",
            tools: ["private"],
          },
          { name: " " },
        ]),
        { status: 200 },
      );
    },
    async () => {
      assert.deepEqual(await fetchVoxelboxSpaces(), [
        {
          name: "voxelbox-ai",
          displayName: "Voxelbox",
          description: "Agent OS",
          stewards: ["smithy"],
          surfaces: ["control"],
        },
      ]);
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

test("surface placement requires an explicit placement and all host context", () => {
  const board = {
    name: "board",
    space: "global",
    description: "",
    ownerAgent: "smithy",
    icon: "columns-3",
    category: "work",
    placements: ["channel_tab", "project_tab"],
    requiresContext: ["space"],
  };
  assert.equal(
    isSurfaceEligibleForPlacement(board, "channel_tab", {
      channel: true,
      space: "voxelbox-ai",
    }),
    true,
  );
  assert.equal(
    isSurfaceEligibleForPlacement(board, "channel_tab", {
      channel: true,
      space: null,
    }),
    false,
  );
  assert.equal(
    isSurfaceEligibleForPlacement({ ...board, placements: [] }, "channel_tab", {
      channel: true,
      space: "voxelbox-ai",
    }),
    false,
  );
});
