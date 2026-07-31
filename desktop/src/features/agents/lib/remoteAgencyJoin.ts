import type {
  RemoteAgencyAgent,
  RemoteAgencyBinding,
  RemoteAgencyDescriptor,
  RemoteAgencyProxy,
} from "@/shared/api/remoteAgencyTypes";
import type { CreateManagedAgentInput } from "@/shared/api/types";

export const REMOTE_AGENCY_AGENT_NAME_PREFIX =
  "Remote Agency · proxied by Buzz · ";

export function isRemoteAgencyManagedAgent(agent: { name: string }): boolean {
  return agent.name.startsWith(REMOTE_AGENCY_AGENT_NAME_PREFIX);
}

function normalizedLoopbackHost(hostname: string): string | null {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
    ? normalized
    : null;
}

function equivalentLoopbackAgencySource(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    if (
      !normalizedLoopbackHost(leftUrl.hostname) ||
      !normalizedLoopbackHost(rightUrl.hostname)
    ) {
      return false;
    }
    return (
      leftUrl.protocol === rightUrl.protocol &&
      leftUrl.port === rightUrl.port &&
      leftUrl.pathname === rightUrl.pathname &&
      leftUrl.search === rightUrl.search &&
      leftUrl.hash === rightUrl.hash &&
      leftUrl.username === rightUrl.username &&
      leftUrl.password === rightUrl.password
    );
  } catch {
    return false;
  }
}

export function findRemoteAgencyBinding(
  bindings: RemoteAgencyBinding[],
  descriptor: RemoteAgencyDescriptor,
): RemoteAgencyBinding | undefined {
  const matchingAgency = bindings.filter(
    (binding) => binding.agencyId === descriptor.agencyId,
  );
  return (
    matchingAgency.find(
      (binding) => binding.sourceUrl === descriptor.sourceUrl,
    ) ??
    matchingAgency.find((binding) =>
      equivalentLoopbackAgencySource(binding.sourceUrl, descriptor.sourceUrl),
    )
  );
}

/**
 * Build the exact adapter input for a reviewed Remote Agency participant.
 * The adapter requires a public Agent Record and an explicitly reviewed A2A
 * endpoint. Secrets are supplied by the operator through the local Buzz
 * process environment and never enter this object.
 */
export function buildRemoteAgencyManagedAgentInput(
  descriptor: RemoteAgencyDescriptor,
  agent: RemoteAgencyAgent,
  channelId: string,
  spaceId: string | null,
): CreateManagedAgentInput {
  if (!agent.recordUrl) {
    throw new Error(
      "Remote Agent does not advertise a public OASF Agent Record",
    );
  }
  if (!agent.a2aEndpoint) {
    throw new Error("Remote Agent does not advertise a reviewed A2A endpoint");
  }
  return {
    name: `${REMOTE_AGENCY_AGENT_NAME_PREFIX}${agent.name}`,
    acpCommand: "buzz-acp",
    agentCommand: "buzz-a2a-acp",
    harnessOverride: true,
    agentArgs: [],
    envVars: {
      BUZZ_A2A_AGENT_RECORD: agent.recordUrl,
      BUZZ_A2A_BEARER_ENDPOINT: agent.a2aEndpoint,
      BUZZ_A2A_AGENCY_REF: descriptor.agencyId,
      BUZZ_A2A_AGENT_REF: agent.id,
      BUZZ_A2A_CHANNEL_REF: channelId,
      ...(spaceId ? { BUZZ_A2A_SPACE_REF: spaceId } : {}),
    },
    parallelism: 1,
    // Remote proxies are intentionally started as one community/relay pair by
    // the join flow. Global auto-start would project this connection into
    // every community configured in the app.
    spawnAfterCreate: false,
    startOnAppLaunch: false,
  };
}

export function findRemoteAgencyProxy(
  proxies: RemoteAgencyProxy[],
  agentId: string,
  channelId: string,
): RemoteAgencyProxy | undefined {
  return proxies.find(
    (proxy) => proxy.agentId === agentId && proxy.channelId === channelId,
  );
}

export function bindingFromRemoteAgencyProxies(
  descriptor: RemoteAgencyDescriptor,
  proxies: RemoteAgencyProxy[],
  community: { id: string; relayUrl: string },
  joinedAt?: string,
): RemoteAgencyBinding {
  const unique = <T>(values: T[]) => [...new Set(values)];
  const spaceByChannel = new Map<string, string>();
  for (const proxy of proxies) {
    if (!proxy.spaceId) continue;
    const existing = spaceByChannel.get(proxy.channelId);
    if (existing && existing !== proxy.spaceId) {
      throw new Error("A Buzz channel can have only one primary Space binding");
    }
    spaceByChannel.set(proxy.channelId, proxy.spaceId);
  }
  const spaceBindings = [...spaceByChannel]
    .map(([channelId, spaceId]) => ({
      channelId,
      spaceId,
      spaceName:
        descriptor.spaces.find((space) => space.id === spaceId)?.name ??
        spaceId,
    }))
    .sort((left, right) => left.channelId.localeCompare(right.channelId));
  return {
    communityId: community.id,
    communityRelayUrl: community.relayUrl,
    sourceUrl: descriptor.sourceUrl,
    agencyId: descriptor.agencyId,
    agencyName: descriptor.name,
    agentIds: unique(proxies.map((proxy) => proxy.agentId)).sort(),
    spaceIds: unique(
      proxies.flatMap((proxy) => (proxy.spaceId ? [proxy.spaceId] : [])),
    ).sort(),
    channelIds: unique(proxies.map((proxy) => proxy.channelId)).sort(),
    spaceBindings,
    proxies,
    joinedAt: joinedAt ?? new Date().toISOString(),
  };
}
