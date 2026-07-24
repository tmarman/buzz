import assert from "node:assert/strict";
import test from "node:test";

import {
  isVoxelboxAgentJoined,
  remoteAgentProjectNames,
  remoteAgentProvenanceLabel,
} from "./RemoteAgentsSection.tsx";

const REMOTE_PUBKEY = "a".repeat(64);

test("remote agent provenance uses the published agent type", () => {
  assert.equal(remoteAgentProvenanceLabel("voxelbox"), "Remote · Voxelbox");
  assert.equal(
    remoteAgentProvenanceLabel("cloud_provider"),
    "Remote · Cloud Provider",
  );
  assert.equal(remoteAgentProvenanceLabel("agent"), "Remote");
  assert.equal(remoteAgentProvenanceLabel(""), "Remote");
});

test("remote agent projects include declared and observed participation", () => {
  const projects = [
    {
      id: `b:${"declared"}`,
      dtag: "declared",
      name: "Declared",
      description: "",
      cloneUrls: [],
      webUrl: null,
      owner: "b".repeat(64),
      contributors: [REMOTE_PUBKEY.toUpperCase()],
      createdAt: 1,
      projectChannelId: null,
      status: "open",
      defaultBranch: "main",
      repoAddress: `30617:${"b".repeat(64)}:declared`,
    },
    {
      id: `c:${"observed"}`,
      dtag: "observed",
      name: "Observed",
      description: "",
      cloneUrls: [],
      webUrl: null,
      owner: "c".repeat(64),
      contributors: [],
      createdAt: 2,
      projectChannelId: null,
      status: "open",
      defaultBranch: "main",
      repoAddress: `30617:${"c".repeat(64)}:observed`,
    },
    {
      id: `d:${"unrelated"}`,
      dtag: "unrelated",
      name: "Unrelated",
      description: "",
      cloneUrls: [],
      webUrl: null,
      owner: "d".repeat(64),
      contributors: [],
      createdAt: 3,
      projectChannelId: null,
      status: "open",
      defaultBranch: "main",
      repoAddress: `30617:${"d".repeat(64)}:unrelated`,
    },
  ];
  const summaries = {
    [projects[1].repoAddress]: {
      repoAddress: projects[1].repoAddress,
      issueCount: 0,
      prCount: 0,
      commitCount: 1,
      activityCount: 1,
      updatedAt: 2,
      participantPubkeys: [REMOTE_PUBKEY],
      latestCommit: null,
      activityByDay: {},
    },
  };

  assert.deepEqual(
    remoteAgentProjectNames(REMOTE_PUBKEY, projects, summaries),
    ["Declared", "Observed"],
  );
});

test("Voxelbox participation is verified by public key with a legacy name fallback", () => {
  const relayAgents = [
    {
      pubkey: "b".repeat(64),
      name: "Smithy",
      agentType: "managed",
      channels: [],
      channelIds: [],
      capabilities: [],
      status: "online",
      respondTo: null,
      respondToAllowlist: [],
    },
  ];
  const base = {
    name: "smithy",
    agentType: "workspace-steward",
    description: "Tools forge",
    org: "voxelbox-ai",
    avatarUrl: null,
    hasVoice: false,
    voiceDescription: "",
    identityReady: true,
  };

  assert.equal(
    isVoxelboxAgentJoined({ ...base, publicKey: "b".repeat(64) }, relayAgents),
    true,
  );
  assert.equal(
    isVoxelboxAgentJoined({ ...base, publicKey: "c".repeat(64) }, relayAgents),
    false,
  );
  assert.equal(
    isVoxelboxAgentJoined({ ...base, publicKey: null }, [
      { ...relayAgents[0], agentType: "voxelbox" },
    ]),
    true,
  );
});
