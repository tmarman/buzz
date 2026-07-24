import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PulseTabBar } from "./PulseTabBar.tsx";

test("Agents tab does not present roster size as a notification count", () => {
  const markup = renderToStaticMarkup(
    React.createElement(PulseTabBar, {
      activeTab: "agents",
      getPanelId: (tab) => `panel-${tab}`,
      getTabId: (tab) => `tab-${tab}`,
      onTabChange: () => {},
    }),
  );

  assert.match(markup, />Agents<\/button>/);
  assert.doesNotMatch(markup, /Agents.*rounded-full.*>\d+</);
});
