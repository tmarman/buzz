// Voxelbox agency seed for the E2E mock bridge — DEV PROTOTYPING ONLY.
//
// Activated with `?e2e=mock&voxelbox=1`. Runs before bootstrap so main.tsx's
// `__BUZZ_E2E__ ??=` preserves this seed. Populates the mock workspace with the
// real voxelbox agency (weaver / smithy / scout) as owner-attested agents, so we
// can prototype the "remote agency" treatment against the real Buzz components.
//
// Reversible: delete this file + its call in main.tsx. Never ships in prod
// (gated on import.meta.env.DEV and the explicit ?voxelbox=1 param).

const AVATARS = {
  weaver: "/voxelbox/weaver.png",
  smithy: "/voxelbox/smithy.png",
  scout: "/voxelbox/scout.png",
} as const;

// 64-hex mock pubkeys (distinct, deterministic).
const pk = (c: string) => c.repeat(64).slice(0, 64);

export function applyVoxelboxSeedFromUrl() {
  if (!import.meta.env.DEV) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get("e2e") !== "mock") return;
  if (url.searchParams.get("voxelbox") !== "1") return;

  const personas = [
    {
      id: "voxelbox:weaver",
      displayName: "Weaver",
      avatarUrl: AVATARS.weaver,
      systemPrompt:
        "Portfolio orchestrator — connects threads across all orgs.",
      model: "opus",
    },
    {
      id: "voxelbox:smithy",
      displayName: "Smithy",
      avatarUrl: AVATARS.smithy,
      systemPrompt: "Runtime & operations — owns the platform runtime.",
      model: "codex",
    },
    {
      id: "voxelbox:scout",
      displayName: "Scout",
      avatarUrl: AVATARS.scout,
      systemPrompt: "Intelligence & research — perception layer.",
      model: "local",
    },
  ];

  const managedAgents = [
    {
      pubkey: pk("1"),
      name: "Weaver",
      avatarUrl: AVATARS.weaver,
      personaId: "voxelbox:weaver",
      status: "running",
      channelNames: ["general", "agents"],
    },
    {
      pubkey: pk("2"),
      name: "Smithy",
      avatarUrl: AVATARS.smithy,
      personaId: "voxelbox:smithy",
      status: "running",
      channelNames: ["general", "agents", "engineering"],
    },
    {
      pubkey: pk("3"),
      name: "Scout",
      avatarUrl: AVATARS.scout,
      personaId: "voxelbox:scout",
      status: "running",
      channelNames: ["general"],
    },
  ];

  const teams = [
    {
      id: "voxelbox-agency",
      name: "Voxelbox Agency",
      description: "Remote agency — brokered by the local runtime",
      personaIds: ["voxelbox:weaver", "voxelbox:smithy", "voxelbox:scout"],
    },
  ];

  const w = window as unknown as { __BUZZ_E2E__?: unknown };
  w.__BUZZ_E2E__ = { mode: "mock", mock: { personas, managedAgents, teams } };
}
