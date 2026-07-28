import assert from "node:assert/strict";
import test from "node:test";

import {
  bindingFromRemoteAgencyProxies,
  buildRemoteAgencyManagedAgentInput,
  findRemoteAgencyBinding,
  findRemoteAgencyProxy,
  joinableRemoteAgentIds,
} from "./remoteAgencyJoin.ts";

const descriptor = {
  sourceUrl: "https://example.com/.well-known/agency.json",
  agencyId: "agency.example",
  name: "Example Agency",
  description: null,
  protocols: ["a2a"],
  capabilities: [],
  agents: [],
};

test("builds the reviewed Remote Team adapter request without secrets", () => {
  const input = buildRemoteAgencyManagedAgentInput({
    id: "agent-1",
    name: "Scout",
    description: null,
    avatarUrl: "https://example.com/agents/scout.png",
    recordUrl: "https://example.com/agents/scout.json",
    recordRevision: "r1",
    a2aEndpoint: "https://example.com/a2a/scout",
    agentCardUrl: "https://example.com/a2a/card.json",
    capabilities: ["research"],
  });
  assert.deepEqual(input.agentArgs, []);
  assert.equal(input.envVars.BUZZ_A2A_BEARER_TOKEN, undefined);
  assert.equal(
    input.envVars.BUZZ_A2A_BEARER_ENDPOINT,
    "https://example.com/a2a/scout",
  );
  assert.deepEqual(input.envVars, {
    BUZZ_A2A_AGENT_RECORD: "https://example.com/agents/scout.json",
    BUZZ_A2A_BEARER_ENDPOINT: "https://example.com/a2a/scout",
  });
  assert.equal(input.name, "Scout");
  assert.equal(input.avatarUrl, "https://example.com/agents/scout.png");
  assert.equal(input.parallelism, 1);
  assert.equal(input.startOnAppLaunch, true);
});

test("refuses a participant without a reviewed record or endpoint", () => {
  assert.throws(() =>
    buildRemoteAgencyManagedAgentInput({
      id: "agent-1",
      name: "Scout",
      description: null,
      avatarUrl: null,
      recordUrl: null,
      recordRevision: null,
      a2aEndpoint: "https://example.com/a2a/scout",
      agentCardUrl: null,
      capabilities: [],
    }),
  );
  assert.throws(() =>
    buildRemoteAgencyManagedAgentInput({
      id: "agent-1",
      name: "Scout",
      description: null,
      avatarUrl: null,
      recordUrl: "https://example.com/agents/scout.json",
      recordRevision: null,
      a2aEndpoint: null,
      agentCardUrl: null,
      capabilities: [],
    }),
  );
});

test("reuses a persisted proxy after a partial join failure", () => {
  const proxy = {
    agentId: "agent-1",
    pubkey: "a".repeat(64),
    channelId: "channel-1",
    recordUrl: "https://example.com/agents/scout.json",
    recordRevision: "r1",
  };
  const binding = bindingFromRemoteAgencyProxies(descriptor, [proxy], "joined");
  assert.equal(
    findRemoteAgencyProxy(binding.proxies, "agent-1", "channel-1"),
    proxy,
  );
  assert.deepEqual(binding.agentIds, ["agent-1"]);
  assert.deepEqual(binding.channelIds, ["channel-1"]);
  assert.equal(binding.joinedAt, "joined");
  assert.equal(binding.name, "Example Agency");
  assert.equal(binding.description, null);
});

test("selects every invokable member when previewing a remote team", () => {
  assert.deepEqual(
    joinableRemoteAgentIds({
      ...descriptor,
      agents: [
        {
          id: "ready-1",
          name: "Ready One",
          description: null,
          avatarUrl: null,
          recordUrl: "https://example.com/agents/ready-1.json",
          recordRevision: null,
          a2aEndpoint: "https://example.com/a2a/ready-1",
          agentCardUrl: null,
          capabilities: [],
        },
        {
          id: "preview-only",
          name: "Preview Only",
          description: null,
          avatarUrl: null,
          recordUrl: "https://example.com/agents/preview-only.json",
          recordRevision: null,
          a2aEndpoint: null,
          agentCardUrl: null,
          capabilities: [],
        },
        {
          id: "ready-2",
          name: "Ready Two",
          description: null,
          avatarUrl: null,
          recordUrl: "https://example.com/agents/ready-2.json",
          recordRevision: null,
          a2aEndpoint: "https://example.com/a2a/ready-2",
          agentCardUrl: null,
          capabilities: [],
        },
      ],
    }),
    ["ready-1", "ready-2"],
  );
});

test("matches a persisted Agency binding across local loopback aliases", () => {
  const binding = {
    ...bindingFromRemoteAgencyProxies(descriptor, [], "joined"),
    sourceUrl: "http://localhost:1337/.well-known/agency.json",
    agencyId: "agency.local",
  };
  const localDescriptor = {
    ...descriptor,
    sourceUrl: "http://127.0.0.1:1337/.well-known/agency.json",
    agencyId: "agency.local",
  };
  assert.equal(findRemoteAgencyBinding([binding], localDescriptor), binding);
});

test("does not migrate a binding across public hosts or Agency identities", () => {
  const binding = bindingFromRemoteAgencyProxies(descriptor, [], "joined");
  assert.equal(
    findRemoteAgencyBinding([binding], {
      ...descriptor,
      sourceUrl: "https://other.example/.well-known/agency.json",
    }),
    undefined,
  );
  assert.equal(
    findRemoteAgencyBinding(
      [
        {
          ...binding,
          sourceUrl: "http://localhost:1337/.well-known/agency.json",
        },
      ],
      {
        ...descriptor,
        sourceUrl: "http://127.0.0.1:1337/.well-known/agency.json",
        agencyId: "other-agency",
      },
    ),
    undefined,
  );
});
