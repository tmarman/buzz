import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticateAgencyMessageEnvelope,
  extractAgencyMessageEnvelope,
  stripAgencyMessageEnvelope,
} from "./agencyMessageBlocks.ts";

const PUBKEY = "a".repeat(64);
const body = `Smithy wants to deploy the control surface.

\`\`\`agency:blocks
{"version":1,"issuer_pubkey":"${PUBKEY}","blocks":[{"type":"agency.approval","id":"approval-1","title":"Deploy control","summary":"Publish the current build","capability":"agency.surface.deploy","target":"space:Voxelbox/surface:control","requested_by":"smithy","owner":"tim","risk":"medium","status":"pending","expires_at":"2026-07-25T00:00:00Z"}]}
\`\`\``;

test("extractAgencyMessageEnvelope parses a bounded typed approval", () => {
  const envelope = extractAgencyMessageEnvelope(body);
  assert.equal(envelope?.version, 1);
  assert.equal(envelope?.blocks[0].type, "agency.approval");
  assert.equal(envelope?.blocks[0].capability, "agency.surface.deploy");
});

test("authenticateAgencyMessageEnvelope requires a known matching signer", () => {
  assert.ok(authenticateAgencyMessageEnvelope(body, PUBKEY, true));
  assert.equal(
    authenticateAgencyMessageEnvelope(body, "b".repeat(64), true),
    null,
  );
  assert.equal(authenticateAgencyMessageEnvelope(body, PUBKEY, false), null);
});

test("stripAgencyMessageEnvelope preserves the plaintext fallback", () => {
  assert.equal(
    stripAgencyMessageEnvelope(body),
    "Smithy wants to deploy the control surface.",
  );
});

test("unknown block types do not become renderable cards", () => {
  const unknown = `Fallback
\`\`\`agency:blocks
{"version":1,"issuer_pubkey":"${PUBKEY}","blocks":[{"type":"agency.html","html":"<script>bad()</script>"}]}
\`\`\``;
  assert.equal(extractAgencyMessageEnvelope(unknown), null);
});
