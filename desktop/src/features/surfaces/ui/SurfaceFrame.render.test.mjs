import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// RED baseline (Track E — surface-frame-sandbox).
//
// Contract this test pins:
//   SurfaceFrame.tsx — a reusable component that renders the surface iframe
//   WITH a sandbox attribute (SurfaceScreen currently has only `allow`).
//     - src = http://localhost:1337/surfaces/<encodeURIComponent(name)>/
//     - title = name
//     - carries a non-empty sandbox attribute that permits scripts
//       (surfaces run JS and call their own API on :1337)
//     - retains the existing `allow` attribute
//   SurfaceScreen.tsx is refactored to render SurfaceFrame, so the shipped
//   top-level /surfaces/$name tab keeps rendering the iframe — now sandboxed.
import { SurfaceFrame } from "./SurfaceFrame.tsx";
import { SurfaceScreen } from "./SurfaceScreen.tsx";

// ── SurfaceFrame ──────────────────────────────────────────────────────────────

test("SurfaceFrame renders an iframe with a sandbox attribute permitting scripts", () => {
  const html = renderToStaticMarkup(
    React.createElement(SurfaceFrame, { name: "agency" }),
  );
  assert.ok(html.includes("<iframe"), "should render an iframe");
  assert.match(
    html,
    /sandbox="[^"]+"/,
    "iframe must carry a sandbox attribute",
  );
  assert.match(
    html,
    /sandbox="[^"]*allow-scripts[^"]*"/,
    "sandbox set must permit scripts (surfaces run JS)",
  );
});

test("SurfaceFrame retains the allow attribute", () => {
  const html = renderToStaticMarkup(
    React.createElement(SurfaceFrame, { name: "agency" }),
  );
  assert.match(html, /allow="[^"]+"/, "iframe must keep the allow attribute");
});

test("SurfaceFrame derives src from the name with the correct base + title", () => {
  const html = renderToStaticMarkup(
    React.createElement(SurfaceFrame, { name: "agency" }),
  );
  assert.ok(
    html.includes('src="http://localhost:1337/surfaces/agency/"'),
    "src should be the surface base URL + name",
  );
  assert.ok(html.includes('title="agency"'), "title should equal the name");
});

test("SurfaceFrame encodeURIComponent-encodes the name in the src", () => {
  const html = renderToStaticMarkup(
    React.createElement(SurfaceFrame, { name: "voxelbox agency" }),
  );
  assert.ok(
    html.includes('src="http://localhost:1337/surfaces/voxelbox%20agency/"'),
    "space in the name must be percent-encoded in the src",
  );
});

// ── SurfaceScreen refactor (no behavioral regression, now sandboxed) ──────────

test("SurfaceScreen renders the sandboxed frame with the mapped src", () => {
  const html = renderToStaticMarkup(
    React.createElement(SurfaceScreen, { name: "agency" }),
  );
  assert.ok(
    html.includes("<iframe"),
    "top-level Surfaces tab still renders an iframe",
  );
  assert.match(
    html,
    /sandbox="[^"]+"/,
    "refactored SurfaceScreen must render the sandbox attribute via SurfaceFrame",
  );
  assert.ok(
    html.includes('src="http://localhost:1337/surfaces/agency/"'),
    "SurfaceScreen keeps the surface src (no regression)",
  );
});
