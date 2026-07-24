import assert from "node:assert/strict";
import test from "node:test";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// RED baseline (Track E — surface-integration-gates).
//
// Encodes the whole-change acceptance criteria that are filesystem-verifiable:
//   - desktop/implementation-notes.md exists and records the integration pass
//     (deviations / surprises / tradeoffs / spec gaps).
//   - it documents the chosen iframe sandbox attribute set + rationale.
//   - the device-local constraint held: NO *Surface*Sync.ts companion and no
//     new Nostr kind were introduced (the notes must confirm this, and no
//     surface-sync source file may exist).
//
// (typecheck / lint / check / test all passing is verified by running the
// gates themselves; this file guards the durable artifacts.)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = path.resolve(__dirname, "../../../..");
const SRC_ROOT = path.join(DESKTOP_ROOT, "src");
const NOTES_PATH = path.join(DESKTOP_ROOT, "implementation-notes.md");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function readNotes() {
  return fs.readFileSync(NOTES_PATH, "utf8").toLowerCase();
}

// ── implementation-notes.md ───────────────────────────────────────────────────

test("implementation-notes.md exists", () => {
  assert.ok(
    fs.existsSync(NOTES_PATH),
    "desktop/implementation-notes.md must exist",
  );
});

test("implementation-notes.md records deviations / surprises / tradeoffs / spec gaps", () => {
  const notes = readNotes();
  assert.match(notes, /deviation/, "notes should record deviations");
  assert.match(notes, /surprise/, "notes should record surprises");
  assert.match(notes, /tradeoff/, "notes should record tradeoffs");
  assert.match(notes, /spec gap/, "notes should record spec gaps");
});

test("implementation-notes.md documents the chosen iframe sandbox set + rationale", () => {
  const notes = readNotes();
  assert.match(
    notes,
    /sandbox/,
    "notes must document the sandbox attribute set",
  );
  assert.match(
    notes,
    /allow-scripts/,
    "notes must name the chosen sandbox tokens",
  );
});

test("implementation-notes.md confirms the device-local constraint (no *Sync, no new kind)", () => {
  const notes = readNotes();
  assert.match(
    notes,
    /device-local/,
    "notes must state the device-local constraint",
  );
  assert.match(
    notes,
    /sync/,
    "notes must confirm no *Sync companion was added",
  );
  assert.match(notes, /kind/, "notes must confirm no new Nostr kind was added");
});

// ── device-local: no surface-sync source file may exist ───────────────────────

test("no channelSurfaceSync.ts (or any *Surface*Sync.ts) exists under src", () => {
  const offenders = walk(SRC_ROOT).filter((file) =>
    /Surface.*Sync\.tsx?$/.test(path.basename(file)),
  );
  assert.deepEqual(
    offenders,
    [],
    `surface mapping is device-local; found sync file(s): ${offenders.join(", ")}`,
  );
});
