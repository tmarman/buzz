import assert from "node:assert/strict";
import test from "node:test";

import { defaultMcpAppHostContext } from "./mcpAppBridge.ts";

test("default host context identifies Buzz as a desktop host", () => {
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;
  globalThis.document = {
    documentElement: { classList: { contains: () => true } },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language: "en-US", maxTouchPoints: 0 },
  });
  globalThis.window = {
    matchMedia: () => ({ matches: true }),
  };

  const context = defaultMcpAppHostContext();
  assert.equal(context.platform, "desktop");
  assert.equal(context.theme, "dark");
  assert.equal(context.locale, "en-US");
  assert.deepEqual(context.availableDisplayModes, ["inline", "fullscreen"]);

  globalThis.document = originalDocument;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  globalThis.window = originalWindow;
});
