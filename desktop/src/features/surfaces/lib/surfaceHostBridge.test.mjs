import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSurfaceHostContext,
  buildSurfaceHostTheme,
  isSurfaceReadyMessage,
  postSurfaceHostContext,
} from "./surfaceHostBridge.ts";

test("buildSurfaceHostTheme normalizes Buzz HSL tokens for portable CSS", () => {
  const values = new Map([
    ["--background", "232 23.4% 18.43%"],
    ["--foreground", "227 68.25% 87.65%"],
    ["--primary", "#c6a0f6"],
    ["--radius", "0.625rem"],
    ["font-family", "Inter Variable"],
  ]);
  const message = buildSurfaceHostTheme(
    (name) => values.get(name) ?? "",
    "dark",
  );

  assert.equal(message.type, "agency.surface.theme");
  assert.equal(message.protocol, "agency.ui.v1");
  assert.equal(message.colorScheme, "dark");
  assert.equal(message.tokens.background, "hsl(232 23.4% 18.43%)");
  assert.equal(message.tokens.foreground, "hsl(227 68.25% 87.65%)");
  assert.equal(message.tokens.primary, "#c6a0f6");
  assert.equal(message.tokens.radius, "0.625rem");
  assert.equal(message.tokens.fontBody, "Inter Variable");
});

test("buildSurfaceHostContext omits unavailable identifiers and pins capabilities", () => {
  assert.deepEqual(
    buildSurfaceHostContext({
      embedded: true,
      space: "voxelbox-ai",
      channelId: "channel-1",
    }),
    {
      type: "agency.surface.context",
      protocol: "agency.ui.v1",
      host: "buzz",
      embedded: true,
      space: "voxelbox-ai",
      channelId: "channel-1",
      capabilities: ["host.theme"],
    },
  );
});

test("ready message validation and context delivery fail closed", () => {
  assert.equal(
    isSurfaceReadyMessage({
      type: "agency.surface.ready",
      protocol: "agency.ui.v1",
    }),
    true,
  );
  assert.equal(
    isSurfaceReadyMessage({
      type: "agency.surface.ready",
      protocol: "agency.ui.v2",
    }),
    false,
  );

  const sent = [];
  const frame = {
    contentWindow: {
      postMessage(message, origin) {
        sent.push({ message, origin });
      },
    },
  };
  const context = buildSurfaceHostContext({ embedded: false });
  postSurfaceHostContext(frame, context);
  assert.deepEqual(sent, [
    {
      message: context,
      origin: "http://localhost:1337",
    },
  ]);
});
