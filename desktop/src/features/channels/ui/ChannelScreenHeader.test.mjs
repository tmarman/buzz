import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { ChannelScreenHeader } from "./ChannelScreenHeader.tsx";

const ACTIVE_CHANNEL = {
  id: "maverick",
  name: "maverick",
  channelType: "stream",
  visibility: "open",
  archivedAt: null,
  isMember: false,
};

const noop = () => {};

function renderHeader(surfaceTab) {
  return renderToStaticMarkup(
    React.createElement(
      UpdaterProvider,
      null,
      React.createElement(ChannelScreenHeader, {
        activeChannel: ACTIVE_CHANNEL,
        activeChannelEphemeralDisplay: null,
        activeChannelTitle: "maverick",
        activeDmAvatarUrl: null,
        activeDmHeaderParticipants: [],
        activeDmPresenceStatus: null,
        currentPubkey: "a".repeat(64),
        onJoinChannel: async () => {},
        onManageChannel: noop,
        onToggleMembers: noop,
        surfaceTab,
      }),
    ),
  );
}

test("channel header exposes the app picker before a surface is mapped", () => {
  const html = renderHeader({
    tabs: [],
    activeSurface: null,
    activeState: null,
    isAppActive: false,
    activate: noop,
    deactivate: noop,
  });

  assert.match(html, /data-testid="channel-surface-picker-trigger"/);
  assert.match(html, /aria-label="Add channel app"/);
  assert.match(html, />Add app</);
  assert.doesNotMatch(html, /data-testid="channel-surface-tabs"/);
});

test("mapped surfaces add named tabs alongside permanent Chat", () => {
  const descriptor = {
    name: "control",
    space: "Voxelbox",
    description: "",
    ownerAgent: "weaver",
  };
  const html = renderHeader({
    tabs: [
      { mode: "frame", surface: "control", descriptor },
      { mode: "empty", surface: "flow", descriptor: null },
    ],
    activeSurface: "control",
    activeState: { mode: "frame", surface: "control", descriptor },
    isAppActive: true,
    activate: noop,
    deactivate: noop,
  });

  assert.match(html, /data-testid="channel-chat-tab"/);
  assert.match(html, /data-testid="channel-surface-tab-control"/);
  assert.match(html, /data-testid="channel-surface-tab-flow"/);
  assert.match(html, />Chat</);
  assert.match(html, />control</);
  assert.match(html, />flow</);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="Manage channel apps"/);
  assert.match(html, />Apps</);
});
