import { normalizePubkey } from "@/shared/lib/pubkey";

const FENCE_OPEN = "```agency:blocks";
const FENCE_CLOSE = "```";
const MAX_PAYLOAD_LENGTH = 32_768;
const MAX_BLOCKS = 8;

export type AgencyApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired";

export type AgencyApprovalBlock = {
  type: "agency.approval";
  id: string;
  title: string;
  summary?: string;
  capability: string;
  target: string;
  requested_by: string;
  owner?: string;
  risk?: "low" | "medium" | "high";
  status: AgencyApprovalStatus;
  expires_at?: string;
};

export type AgencyMessageBlock = AgencyApprovalBlock;

export type AgencyMessageEnvelope = {
  version: 1;
  issuer_pubkey: string;
  blocks: AgencyMessageBlock[];
};

function boundedString(value: unknown, maximum = 512): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : undefined;
}

function parseApproval(value: unknown): AgencyApprovalBlock | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  if (source.type !== "agency.approval") return null;

  const id = boundedString(source.id, 128);
  const title = boundedString(source.title, 256);
  const capability = boundedString(source.capability, 256);
  const target = boundedString(source.target, 512);
  const requestedBy = boundedString(source.requested_by, 128);
  const status = source.status;
  if (
    !id ||
    !title ||
    !capability ||
    !target ||
    !requestedBy ||
    (status !== "pending" &&
      status !== "approved" &&
      status !== "denied" &&
      status !== "expired")
  ) {
    return null;
  }

  const risk =
    source.risk === "low" || source.risk === "medium" || source.risk === "high"
      ? source.risk
      : undefined;

  return {
    type: "agency.approval",
    id,
    title,
    capability,
    target,
    requested_by: requestedBy,
    status,
    ...(boundedString(source.summary, 1_024)
      ? { summary: boundedString(source.summary, 1_024) }
      : {}),
    ...(boundedString(source.owner, 128)
      ? { owner: boundedString(source.owner, 128) }
      : {}),
    ...(risk ? { risk } : {}),
    ...(boundedString(source.expires_at, 64)
      ? { expires_at: boundedString(source.expires_at, 64) }
      : {}),
  };
}

export function extractAgencyMessageEnvelope(
  content: string,
): AgencyMessageEnvelope | null {
  const openIndex = content.indexOf(FENCE_OPEN);
  if (openIndex === -1) return null;
  const jsonStart = content.indexOf("\n", openIndex);
  if (jsonStart === -1) return null;
  const closeIndex = content.indexOf(`\n${FENCE_CLOSE}`, jsonStart);
  if (closeIndex === -1) return null;
  const json = content.slice(jsonStart + 1, closeIndex).trim();
  if (!json || json.length > MAX_PAYLOAD_LENGTH) return null;

  try {
    const source: unknown = JSON.parse(json);
    if (typeof source !== "object" || source === null) return null;
    const object = source as Record<string, unknown>;
    const issuerPubkey = boundedString(object.issuer_pubkey, 128);
    if (
      object.version !== 1 ||
      !issuerPubkey ||
      !Array.isArray(object.blocks) ||
      object.blocks.length === 0 ||
      object.blocks.length > MAX_BLOCKS
    ) {
      return null;
    }

    const blocks = object.blocks.flatMap((block) => {
      const parsed = parseApproval(block);
      return parsed ? [parsed] : [];
    });
    if (blocks.length === 0) return null;
    return { version: 1, issuer_pubkey: issuerPubkey, blocks };
  } catch {
    return null;
  }
}

export function stripAgencyMessageEnvelope(content: string): string {
  const openIndex = content.indexOf(FENCE_OPEN);
  if (openIndex === -1) return content;
  const closeIndex = content.indexOf(`\n${FENCE_CLOSE}`, openIndex);
  if (closeIndex === -1) return content;
  const afterFence = closeIndex + `\n${FENCE_CLOSE}`.length;
  return (
    content.slice(0, openIndex).replace(/\n{2,}$/, "\n") +
    content.slice(afterFence)
  ).trim();
}

export function authenticateAgencyMessageEnvelope(
  content: string,
  signerPubkey: string | null | undefined,
  signerIsKnownAgent: boolean,
): AgencyMessageEnvelope | null {
  if (!signerPubkey || !signerIsKnownAgent) return null;
  const envelope = extractAgencyMessageEnvelope(content);
  if (!envelope) return null;
  return normalizePubkey(envelope.issuer_pubkey) ===
    normalizePubkey(signerPubkey)
    ? envelope
    : null;
}
