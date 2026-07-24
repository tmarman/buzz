import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchVoxelboxRemoteAgents,
  shouldProjectVoxelboxAgent,
} from "./voxelboxAgentDiscovery.ts";

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
        identityReady: false,
        publicKey: null,
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
            avatarUrl: "data:image/png;base64,cG5n",
            hasVoice: true,
            voiceDescription: "Measured and practical",
            identityReady: true,
            publicKey: "a".repeat(64),
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
        avatarUrl: "data:image/png;base64,cG5n",
        hasVoice: true,
        voiceDescription: "Measured and practical",
        identityReady: true,
        publicKey: "a".repeat(64),
      },
    ]);
    assert.equal(invokedCommand, "discover_voxelbox_agents");
  } finally {
    globalThis.isTauri = previousIsTauri;
    globalThis.window = previousWindow;
    globalThis.fetch = originalFetch;
  }
});

test("Liquid stays registered in Voxelbox but is not projected into Buzz", () => {
  assert.equal(shouldProjectVoxelboxAgent("liquid"), false);
  assert.equal(shouldProjectVoxelboxAgent(" Liquid "), false);
  assert.equal(shouldProjectVoxelboxAgent("smithy"), true);
});
