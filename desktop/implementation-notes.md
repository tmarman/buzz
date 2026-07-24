# Implementation Notes — Surfaces in the Buzz Desktop Client (Track E)

Durable record of the Track E consolidation pass: five parallel branches merged
into one integration branch, their adversarial-review findings fixed, and the
whole thing greened against every red baseline. Embeds voxelbox surfaces in the
Buzz desktop client and lets a channel open a chosen surface as an in-channel app
tab.

## What the tracks are

Branched off `voxelbox/agency-prototype` and merged in dependency order:

1. **surface-discovery-allowlist** — `surfaceDiscovery.ts`:
   `fetchInstalledSurfaces()` GETs the daemon manifest and resolves surface
   `name`s; `isSurfaceAllowed()` is the pure allowlist filter. Any failure
   degrades to `[]`, never throws.
2. **surface-frame-sandbox** — `SurfaceFrame.tsx`: the single reusable, sandboxed
   surface iframe; `SurfaceScreen.tsx` refactored to render it.
3. **channel-app-tab** — `useChannelSurfaceTab.ts` (`resolveChannelSurfaceTab` +
   the wiring hook) and `ChannelSurfacePane.tsx`: the channel-header app tab and
   its allowlist-gated body.
4. **channel-surface-picker** — `ChannelSurfacePicker.tsx`: the affordance in the
   channel management sheet that sets/clears the channel→surface mapping.
5. **surface-integration-gates** — these notes + the device-local guard test.

The device-local mapping store (`channelSurfaceStorage.ts`) landed earlier on the
base.

## Iframe sandbox attribute set + rationale

**Chosen set: `sandbox="allow-scripts allow-same-origin"`** (retaining
`allow="clipboard-write; microphone"`). Defined once in `SurfaceFrame.tsx` and
exported (`SURFACE_SANDBOX`); `ChannelSurfacePane` renders `SurfaceFrame` so there
is exactly one sandbox set in the tree.

- `allow-scripts` — required. Surfaces are voxelbox web apps that run their own
  JS; without it the frame is inert.
- `allow-same-origin` — required for a surface to reach its OWN API on
  `http://localhost:1337`. A sandboxed frame without it is assigned an opaque
  origin, which breaks credentialed fetch, cookies, and storage. Safe here
  because the surface origin (`:1337`) is DIFFERENT from the desktop shell's
  origin, so the well-known `allow-scripts` + `allow-same-origin` self-unsandbox
  escape (which only applies when the frame is same-origin as its embedder) does
  not apply. This origin-authority tradeoff is documented PRD policy.
- **Deliberately withheld**: `allow-popups` and `allow-popups-to-escape-sandbox`
  (a surface must never spawn a window that escapes this policy — this was the
  security finding), `allow-top-navigation(-*)` (never navigate the host shell
  out from under the user), and `allow-forms` / `allow-modals` / `allow-downloads`
  (no shipped surface demonstrably needs native form submission, blocking
  dialogs, or downloads; `allow-scripts` covers app I/O via fetch). Least
  privilege: add the narrowest token later when a concrete surface needs it, not
  pre-emptively.

`surfaceFrameSandbox.test.mjs` pins this set (asserts scripts + same-origin
present, popups/escape/top-navigation absent) so it cannot silently regress.

## Allowlist gate (never a raw iframe)

`resolveChannelSurfaceTab(mappedSurface, installedSurfaces)` is the pure decision:
no mapping → no tab; mapping present AND in discovery → `mode: "frame"`; mapping
present but ABSENT from discovery → `mode: "empty"` (neutral empty state, NO
iframe). A mapped name that daemon discovery doesn't vouch for can therefore never
reach a live iframe. Discovery failure degrades to `[]`, so a dead daemon simply
shows the empty state.

## Stale-allowlist fix (review finding)

The bug: the picker (writer) and the channel app tab (reader) are separate
components. The tab read the mapping through a `useMemo` keyed only on
`[pubkey, channelId]`, and `localStorage` writes are not reactive, so clearing a
mapping in the picker (same channel still open) left a stale surface frame mounted
— the frame persisted after the mapping was gone. The native `storage` event does
not fire in the tab that made the write, so it could not close the gap.

The fix, modeled on `selfProfileStorage.ts`:

- `channelSurfaceStorage.ts` dispatches a `CHANNEL_SURFACE_CHANGE_EVENT` on every
  successful set/clear and exposes `subscribeChannelSurface(listener)` (same-doc
  change event + cross-tab `storage` event; returns an unsubscribe). The dispatch
  is guarded so it never throws where `window` has no event surface (SSR, and the
  `window = {}` test doubles).
- `useChannelSurfaceTab` reads the mapping via `React.useSyncExternalStore(
  subscribeChannelSurface, …)`, so a picker set/clear reactively flips the tab
  between frame / empty / none — no stale iframe. It also re-validates discovery
  whenever the mapping changes (not only on mount), so the allowlist result the
  frame is gated on is fresh at the moment a surface is opened.
- `ChannelSurfacePickerSection` reads its own selection through the same
  subscription, so a clear made elsewhere reflects in the picker too.

Coverage: `channelSurfaceStorage.reactivity.test.mjs` pins the event mechanism
(fires on set/clear, re-read sees the change, unsubscribe stops it, no-op clear
does not notify, guarded dispatch never throws). `channelSurfaceTabIntegration.
test.mjs` exercises the real wiring end to end: picker write → change signal →
tab resolve → pane render shows the frame; clear → tab drops the frame; a
discovery stub gates the iframe; remapping swaps the frame URL.

## Device-local constraint — verified

The channel→surface mapping is **device-local** only. Verified across every merged
track: **no `*Surface*Sync.ts` companion** was added (contrast the syncing
siblings `channelStarsSync` / `channelMutesSync` / `channelSectionsSync` /
`channelSortSync`), and **no new Nostr kind / event** was introduced — the feature
publishes nothing to a relay. The mapping lives solely in `channelSurfaceStorage`
on `window.localStorage`, keyed per pubkey. `surfaceIntegrationGuards.test.mjs`
enforces that no `*Surface*Sync.ts` exists under `src`. Reason it stays local: the
relay whitelists event kinds and would reject a new one, so per-device
`localStorage` is the correct home for this preference.

## Deviations (from the individual branches, applied during consolidation)

- **`ChannelSurfacePane` now renders the shared `SurfaceFrame`** instead of its own
  inlined iframe + sandbox string. The app-tab branch inlined a copy because
  `SurfaceFrame` did not yet exist on that branch; post-merge it does, so the copy
  (and its divergent, looser sandbox set) was removed. One sandbox set now, not
  three.
- **Discovery is sourced from the shared `fetchInstalledSurfaces`** everywhere.
  The picker and the tab hook each shipped their own inline `fetch` of the `:1337`
  manifest; both were replaced with imports of `surfaceDiscovery.ts`. Three copies
  of the discovery fetch collapsed to one.
- **Sandbox set narrowed** from the frame branch's
  `allow-scripts allow-same-origin allow-forms allow-popups
  allow-popups-to-escape-sandbox allow-modals allow-downloads` to
  `allow-scripts allow-same-origin` (see rationale above). The two branches
  actually disagreed on the set in their own notes; the minimal set wins.
- **Removed committed `.pnpm-store/v11/*` SQLite binaries** that rode in on the
  discovery branch, and added a root-level `.pnpm-store/` gitignore rule (the
  `desktop/.gitignore` already had one; the repo root did not).

## Surprises

- **Two branches were cut from the red baseline `ce6e8de9`, before the storage
  file existed**, so their diffs against the current base appear to *delete*
  `channelSurfaceStorage.ts`. A 3-way merge does not delete it (the file was added
  on the base side only, unchanged on the branch side) — verified the file
  survived each merge. A naive `diff`-driven read would have flagged a phantom
  regression.
- **The two branches' notes documented contradictory sandbox sets.** The app-tab
  branch listed the broad set; the integration-gates branch had already argued for
  minimal `allow-scripts allow-same-origin`. The consolidation reconciled them to
  the minimal set.
- **`ChannelScreen.tsx` sits under a file-size ratchet override**, not the raw
  1000-line gate. The app-tab wiring ratcheted the override to 992 (still under
  1000); the feature's logic lives in the hook + pane, not `ChannelScreen`. The
  checker counts `wc -l + 1` (it counts the trailing newline segment).
- **A fresh worktree has no `node_modules`.** `pnpm install` was required before
  any gate would run.

## Tradeoffs

- **Discovery re-fetches on every mapping change**, not on a live daemon
  subscription. This makes the allowlist fresh whenever a surface is opened
  (bounded, deterministic, testable) without a polling loop. The residual edge —
  a surface uninstalled from the daemon *while the same mapping stays open* —
  is not observed live; opening/remapping re-validates. Acceptable for a
  device-local preference; a push channel would be over-engineering here.
- **Kept `allow-modals` / `allow-forms` / `allow-downloads` OFF** rather than
  grandfathering the frame branch's broader set. Costs a future surface a
  follow-up token grant if it genuinely needs one; buys a minimal blast radius
  now. Least privilege chosen deliberately over convenience.
- **The app tab is an in-view body swap in `ChannelScreen`, not a TanStack
  route.** Routes are plugin-generated via `routes.ts`/`routeTree.gen.ts` and only
  regenerate on dev-server restart, so an in-view swap is both lighter and more
  correct. Activation state is ephemeral (resets on channel change) — the
  device-local store is the only persisted state.

## Spec gaps (feedback to the brief author)

- **The brief never pinned the exact sandbox token set** — only "sandboxed" and
  "surfaces run JS and call their own API on :1337." That ambiguity is exactly why
  the parallel branches diverged (one broad, one minimal). Pin the token set
  explicitly next time.
- **The brief did not say the mapping needed a same-document reactive signal.**
  The device-local store looked sufficient in isolation, but the picker/tab split
  makes non-reactive reads a real staleness bug. Call out cross-component reactive
  reads when a store is written by one component and read by another.
- **No fallback/config for the surface base URL.** `http://localhost:1337/
  surfaces/` is hardcoded; whether it should be environment-configurable is
  unspecified. Left as-is, flagged here.

## Cross-review log

- **Adversarial review (codex) caught**: (1) the committed `.pnpm-store/v11/*`
  SQLite binaries with no root gitignore rule; (2) the `SurfaceFrame` sandbox
  granting `allow-popups-to-escape-sandbox` (frame-escape) plus `allow-popups`;
  (3) the stale-allowlist bug — the channel surface iframe persisting after the
  mapping was cleared or after discovery no longer listed the surface; (4) the
  picker/app-tab tests being presentational-only, with no integration coverage of
  the real picker→storage→tab wiring. All four fixed and covered by tests in this
  pass.
