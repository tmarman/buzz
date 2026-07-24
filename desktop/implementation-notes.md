# Implementation Notes — Surfaces in the Buzz Desktop Client (Track E)

Final integration pass for the surfaces feature: embedding voxelbox surfaces in
the Buzz desktop client, plus the per-channel surface mapping that lets a channel
open a chosen surface as a tab. This file is the durable record of what changed
against the spec when the parallel tracks met reality.

The feature is composed of several tracks branched off `voxelbox/agency-prototype`:

- **surface-channel-storage** — `channelSurfaceStorage.ts`: a versioned,
  device-local `localStorage` store keyed per pubkey mapping `channelId -> surface name`.
- **surface-frame-sandbox** — `SurfaceFrame.tsx`: a reusable component that renders
  the surface iframe *with* a sandbox attribute; `SurfaceScreen.tsx` refactored to use it.
- **surface-discovery** — `surfaceDiscovery.ts`: lists installable surfaces.
- **channel-surface-picker** — `ChannelSurfacePicker.tsx` / `useChannelSurfaceTab.ts`:
  the UI + hook that read/write the device-local mapping.
- **surface-integration-gates** (this track) — green the gates, write these notes,
  and verify the device-local invariant held across every track.

## Gate status

- `pnpm --dir desktop typecheck` — green. The `.mjs` RED-baseline tests reference
  not-yet-merged sibling modules, but `tsc` does not typecheck the `.mjs` test files,
  so the missing imports do not break the typecheck gate.
- `pnpm --dir desktop lint` — green (`biome lint .`, 1597 files).
- `pnpm --dir desktop check` — green after the formatting deviation below.
- `pnpm --dir desktop test` — the integration-guards suite for this track
  (`surfaceIntegrationGuards.test.mjs`) is green. Sibling tracks' RED baselines
  (`SurfaceFrame.render`, `surfaceDiscovery`, `ChannelSurfacePicker`,
  `useChannelSurfaceTab`) remain red *in this isolated worktree only* because those
  tracks' implementations live on their own branches and are not yet merged into this
  base; they go green when the orchestrator merges those branches into the integration
  branch. They are out of this track's scope (implementation-notes.md only) and are
  owned by the parallel agents on those tracks. No previously-green test regressed.

## Deviations

- **Touched two out-of-primary-scope files to green the `check` gate.** The nominal
  in-scope file for this track is `desktop/implementation-notes.md` only, but the
  integration mandate is "fix any cross-task integration breakage so all gates are
  green." Two already-merged sibling-track files failed `biome`'s formatter as
  committed:
  - `src/features/sidebar/lib/channelSurfaceStorage.ts` — `parseSurfacePayload`
    signature should collapse onto one line.
  - `src/testing/voxelboxSeed.ts` — a `systemPrompt` string literal should wrap.

  These are formatter-only, non-behavioral changes — exactly what `pnpm format`
  (the project's own sanctioned command) would apply — on files owned by no
  currently-active agent (both tracks are already merged). Applied `biome format`
  to those two files and nothing else. No logic changed.

- **Did not implement any sibling-track source.** This track deliberately did *not*
  create `SurfaceFrame.tsx`, `surfaceDiscovery.ts`, `ChannelSurfacePicker.tsx`, or
  `useChannelSurfaceTab.ts` to make their RED baselines pass — those files belong to
  parallel agents and creating them here would collide with concurrent work.

## Surprises

- **The `check` gate was already red on the base.** A surprise for an integration
  pass: `voxelbox/agency-prototype` shipped two committed files that fail
  `biome check`'s formatter. The lint gate (`biome lint`) passed while the combined
  `check` (lint + format + custom checks) did not — the failures were formatting,
  not lint rules. Worth catching earlier in each track's own gate run.
- **`node_modules` is not shared into a fresh worktree.** Had to run
  `pnpm install --frozen-lockfile` in the worktree before any gate would run; the pnpm
  content-addressable store was warm so it was fast, but the step is required.
- **The custom checks are source-oriented, not markdown-oriented.** `check:file-sizes`,
  `check:px-text`, and `check:pubkey-truncation` did not flag this new markdown notes
  file, which is the intended behavior.

## Tradeoffs

- **Applied the formatting fix here rather than deferring it to the owning tracks.**
  Alternative was to leave `check` red and report it as pre-existing. Chose to fix it
  because (a) the acceptance criteria require `check` green, (b) the change is
  mechanical and idempotent so it cannot conflict at merge time, and (c) the whole
  point of an integration pass is to leave the tree green. The cost is two files
  touched beyond the primary scope, recorded here.
- **Documented the iframe sandbox set from the pinned test contract, not from merged
  source.** `SurfaceFrame.tsx` is not yet in this base, so the exact token string is
  read from the `SurfaceFrame.render.test.mjs` contract and the security reasoning
  below, rather than copied from shipped code. The integration branch should re-verify
  the literal tokens once that track merges.

## Spec gap

- **The spec never named the exact iframe sandbox token set.** It said "sandboxed"
  and "surfaces run JS and call their own API on :1337," but left the precise tokens
  to the implementer. That is the gap this section closes (below). Feedback to the
  brief author: pin the token set explicitly next time so every track agrees.
- **The spec did not say who owns greening a gate that is already red on the shared
  base.** This pass had to infer that the integration track owns mechanical cross-task
  green-up. Worth stating in the brief.
- **The spec did not specify a fallback surface base URL.** `SURFACE_BASE_URL` is
  hardcoded to `http://localhost:1337/surfaces/`; whether that should be configurable
  per environment is unspecified. Left as-is (out of scope), flagged here.

## Iframe sandbox attribute set + rationale

**Chosen set: `sandbox="allow-scripts allow-same-origin"`** (retaining the existing
`allow="clipboard-write; microphone"` attribute).

Rationale, token by token:

- `allow-scripts` — **required**. Surfaces are voxelbox web apps that run their own
  JavaScript; without this token the framed surface renders inert. The frame test
  (`SurfaceFrame.render.test.mjs`) mandates the sandbox set *permits scripts*, so this
  token is non-negotiable.
- `allow-same-origin` — **required for the surface to function**. Surfaces call their
  own API on `http://localhost:1337`. Without `allow-same-origin`, a sandboxed iframe
  is assigned a unique *opaque* origin, which blocks credentialed `fetch`, cookies,
  `localStorage`, and IndexedDB — the surface's own API and storage would break. This
  is safe here because the surface origin (`localhost:1337`) is **different** from the
  desktop app shell's origin, so the well-known `allow-scripts` + `allow-same-origin`
  self-unsandboxing escape (which only applies when the frame is *same-origin as its
  embedder*) does not apply.
- **Deliberately omitted**: `allow-top-navigation`, `allow-popups`,
  `allow-popups-to-escape-sandbox`, `allow-modals`, `allow-forms`. Surfaces have no
  need to navigate the host app, spawn popups, or drive top-level navigation; leaving
  these off keeps the blast radius minimal. If a future surface needs forms or popups,
  add the narrowest token then, not pre-emptively.

The `allow` attribute (`clipboard-write; microphone`) is orthogonal to `sandbox` — it
governs Permissions-Policy delegation (clipboard, mic), not the sandbox flags — and is
retained unchanged so existing surface capabilities do not regress.

## Device-local constraint — verified

The channel→surface mapping is **device-local only**, by design. Verified across the
whole branch:

- **No `*Sync.ts` companion was added.** There is intentionally no
  `channelSurfaceSync.ts` (contrast its siblings `channelStarsSync.ts`,
  `channelMutesSync.ts`, `channelSectionsSync.ts`, `channelSortSync.ts`, which *do*
  sync). `git diff` against the base shows no `*Sync.tsx?` file added by this feature,
  and `surfaceIntegrationGuards.test.mjs` enforces that no `*Surface*Sync.ts` exists
  under `src`. The mapping lives solely in `channelSurfaceStorage.ts` on top of
  `window.localStorage`, keyed per pubkey.
- **No new Nostr kind was introduced.** The feature publishes no Nostr event —
  no `signEvent`, no relay publish, no new `kind` literal anywhere in the diff. This
  is the explicit reason the mapping is device-local: the relay whitelists event kinds
  and would reject a new one, so per-device `localStorage` is the correct home for this
  preference rather than a synced Nostr record.

Both halves of the device-local invariant (no sync file, no new kind) hold across every
track merged into this branch.
