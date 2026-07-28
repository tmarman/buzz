export type RemoteAgencyAgent = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  recordUrl: string | null;
  recordRevision: string | null;
  a2aEndpoint: string | null;
  agentCardUrl: string | null;
  capabilities: string[];
};

export type RemoteAgencyDescriptor = {
  sourceUrl: string;
  agencyId: string;
  name: string;
  description: string | null;
  agents: RemoteAgencyAgent[];
  protocols: string[];
  capabilities: string[];
};

export type RemoteAgencyBinding = {
  sourceUrl: string;
  agencyId: string;
  name: string | null;
  description: string | null;
  agentIds: string[];
  channelIds: string[];
  proxies: RemoteAgencyProxy[];
  joinedAt: string;
};

export type RemoteAgencyProxy = {
  agentId: string;
  pubkey: string;
  channelId: string;
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
