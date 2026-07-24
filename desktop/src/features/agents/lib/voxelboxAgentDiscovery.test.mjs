import assert from "node:assert/strict";
import test from "node:test";

import { fetchVoxelboxRemoteAgents } from "./voxelboxAgentDiscovery.ts";

test("Voxelbox browser discovery keeps only public agent summary fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          name: " weaver ",
          type: " orchestrator ",
          description: " Connects work ",
          org: " global ",
          workspace: "/private/path",
          unread_dms: 42,
        },
        { name: " " },
      ]),
      { status: 200 },
    );

  try {
    assert.deepEqual(await fetchVoxelboxRemoteAgents(), [
      {
        name: "weaver",
        agentType: "orchestrator",
        description: "Connects work",
        org: "global",
        avatarUrl: null,
        hasVoice: false,
        voiceDescription: "",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Voxelbox native discovery uses the fixed IPC command", async () => {
  const previousIsTauri = globalThis.isTauri;
  const previousWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let invokedCommand = null;

  globalThis.isTauri = true;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke(command) {
        invokedCommand = command;
        return Promise.resolve([
          {
            name: "smithy",
            agentType: "workspace-steward",
            description: "Tools forge",
            org: "voxelbox-ai",
            avatarUrl: "http://localhost:1337/api/stewards/smithy/avatar",
            hasVoice: true,
            voiceDescription: "Measured and practical",
          },
        ]);
      },
    },
  };
  globalThis.fetch = async () => {
    throw new Error("web fetch must not run inside Tauri");
  };

  try {
    assert.deepEqual(await fetchVoxelboxRemoteAgents(), [
      {
        name: "smithy",
        agentType: "workspace-steward",
        description: "Tools forge",
        org: "voxelbox-ai",
        avatarUrl: "http://localhost:1337/api/stewards/smithy/avatar",
        hasVoice: true,
        voiceDescription: "Measured and practical",
      },
    ]);
    assert.equal(invokedCommand, "discover_voxelbox_agents");
  } finally {
    globalThis.isTauri = previousIsTauri;
    globalThis.window = previousWindow;
    globalThis.fetch = originalFetch;
  }
});
