export type RemoteAgencyAgent = {
  id: string;
  name: string;
  description: string | null;
  recordUrl: string | null;
  recordRevision: string | null;
  a2aEndpoint: string | null;
  agentCardUrl: string | null;
  capabilities: string[];
};

export type RemoteAgencySurface = {
  id: string;
  name: string;
  surfaceType: string | null;
  locator: string | null;
};

export type RemoteAgencySpace = {
  id: string;
  name: string;
  description: string | null;
  surfaces: RemoteAgencySurface[];
};

export type RemoteAgencyDescriptor = {
  sourceUrl: string;
  agencyId: string;
  name: string;
  description: string | null;
  agents: RemoteAgencyAgent[];
  spaces: RemoteAgencySpace[];
  protocols: string[];
  capabilities: string[];
};

export type RemoteAgencyBinding = {
  communityId: string;
  communityRelayUrl: string;
  sourceUrl: string;
  agencyId: string;
  agencyName: string;
  agentIds: string[];
  spaceIds: string[];
  channelIds: string[];
  spaceBindings: RemoteAgencySpaceBinding[];
  proxies: RemoteAgencyProxy[];
  joinedAt: string;
};

export type RemoteAgencySpaceBinding = {
  spaceId: string;
  spaceName: string;
  channelId: string;
};

export type RemoteAgencyProxy = {
  agentId: string;
  pubkey: string;
  channelId: string;
  spaceId: string | null;
  recordUrl: string;
  recordRevision: string | null;
  recordCid: string | null;
  recordVerification:
    | "operator-reviewed-local"
    | "tls-only"
    | "domain-jwks"
    | "directory-sigstore"
    | null;
};
