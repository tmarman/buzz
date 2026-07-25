import assert from "node:assert/strict";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The race regression mounts the real component so its effects and iframe
// message handlers run. Keep the harness deliberately small; jsdom is not a
// desktop dependency.
function installSurfaceDomShim() {
  class EventTargetShim {
    constructor() {
      this.listeners = new Map();
    }
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    removeEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        listeners.filter((candidate) => candidate !== listener),
      );
    }
    dispatchEvent(event) {
      event.target ??= this;
      event.currentTarget ??= this;
      for (const listener of this.listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    }
  }

  class NodeShim extends EventTargetShim {
    constructor(tagName, ownerDocument) {
      super();
      this.tagName = tagName.toUpperCase();
      this.nodeName = this.tagName;
      this.nodeType = 1;
      this.ownerDocument = ownerDocument;
      this.parentNode = null;
      this.children = [];
      this.childNodes = [];
      this.style = {};
      this.classList = { contains: () => false };
      this.attributes = new Map();
      this.textContent = "";
      if (tagName === "iframe") {
        this.contentWindow = new EventTargetShim();
        this.contentWindow.posted = [];
        this.contentWindow.postMessage = (message, origin) => {
          this.contentWindow.posted.push({ message, origin });
        };
      }
    }
    get firstChild() {
      return this.children[0] ?? null;
    }
    get lastChild() {
      return this.children.at(-1) ?? null;
    }
    get nextSibling() {
      return null;
    }
    appendChild(child) {
      this.children.push(child);
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    }
    insertBefore(child, before) {
      if (!before) return this.appendChild(child);
      const index = this.children.indexOf(before);
      if (index < 0) return this.appendChild(child);
      this.children.splice(index, 0, child);
      this.childNodes.splice(index, 0, child);
      child.parentNode = this;
      return child;
    }
    removeChild(child) {
      this.children = this.children.filter((candidate) => candidate !== child);
      this.childNodes = this.childNodes.filter(
        (candidate) => candidate !== child,
      );
      child.parentNode = null;
      return child;
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      this[name] = String(value);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
      delete this[name];
    }
    contains(node) {
      return (
        this === node || this.children.some((child) => child.contains(node))
      );
    }
  }

  class DocumentShim extends EventTargetShim {
    constructor() {
      super();
      this.nodeType = 9;
      this.documentElement = new NodeShim("html", this);
      this.body = new NodeShim("body", this);
      this.documentElement.appendChild(this.body);
    }
    createElement(tagName) {
      return new NodeShim(tagName, this);
    }
    createTextNode(value) {
      const node = new NodeShim("#text", this);
      node.nodeType = 3;
      node.nodeValue = value;
      return node;
    }
    createComment(value) {
      const node = new NodeShim("#comment", this);
      node.nodeType = 8;
      node.nodeValue = value;
      return node;
    }
    contains() {
      return true;
    }
  }

  const document = new DocumentShim();
  const window = new EventTargetShim();
  document.defaultView = window;
  window.document = document;
  window.Node = NodeShim;
  window.HTMLElement = NodeShim;
  window.HTMLIFrameElement = NodeShim;
  window.getComputedStyle = () => ({
    fontFamily: "Inter",
    getPropertyValue: () => "",
  });
  globalThis.document = document;
  globalThis.window = window;
  globalThis.HTMLElement = NodeShim;
  globalThis.HTMLIFrameElement = NodeShim;
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return { document, window };
}

// RED baseline (Track E — surface-frame-sandbox).
//
// Contract this test pins:
//   SurfaceFrame.tsx — a reusable component that renders the surface iframe
//   WITH a sandbox attribute (SurfaceScreen currently has only `allow`).
//     - src = http://localhost:1337/surfaces/<encodeURIComponent(name)>/?scope=global
//     - title = name
//     - carries a non-empty sandbox attribute that permits scripts
//       (surfaces run JS and call their own API on :1337)
//     - retains the existing `allow` attribute
//   SurfaceScreen.tsx is refactored to render SurfaceFrame, so the shipped
//   top-level /surfaces/$name tab keeps rendering the iframe — now sandboxed.
import {
  shouldRetrySurfaceSession,
  SurfaceFrame,
  SURFACE_SESSION_RETRY_DELAYS_MS,
} from "./SurfaceFrame.tsx";
import { SurfaceScreen } from "./SurfaceScreen.tsx";
const { createRoot } = await import("react-dom/client");

function renderSurface(element) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: queryClient }, element),
  );
}

// ── SurfaceFrame ──────────────────────────────────────────────────────────────

test("SurfaceFrame renders an iframe with a sandbox attribute permitting scripts", () => {
  const html = renderSurface(
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
  const html = renderSurface(
    React.createElement(SurfaceFrame, { name: "agency" }),
  );
  assert.match(html, /allow="[^"]+"/, "iframe must keep the allow attribute");
});

test("SurfaceFrame derives src from the name with the correct base + title", () => {
  const html = renderSurface(
    React.createElement(SurfaceFrame, { name: "agency" }),
  );
  assert.ok(
    html.includes('src="http://localhost:1337/surfaces/agency/?scope=global"'),
    "src should be the surface base URL + name",
  );
  assert.ok(html.includes('title="agency"'), "title should equal the name");
});

test("SurfaceFrame encodeURIComponent-encodes the name in the src", () => {
  const html = renderSurface(
    React.createElement(SurfaceFrame, { name: "voxelbox agency" }),
  );
  assert.ok(
    html.includes(
      'src="http://localhost:1337/surfaces/voxelbox%20agency/?scope=global"',
    ),
    "space in the name must be percent-encoded in the src",
  );
});

test("SurfaceFrame encodes embedded Space context explicitly", () => {
  const html = renderSurface(
    React.createElement(SurfaceFrame, {
      embedded: true,
      name: "portfolio",
      scope: "space:voxelbox-ai",
    }),
  );
  assert.ok(
    html.includes(
      'src="http://localhost:1337/surfaces/portfolio/?embedded=1&amp;scope=space%3Avoxelbox-ai"',
    ),
    "embedded surfaces must receive the active Space execution scope",
  );
});

test("SurfaceFrame does not deliver a newly minted token before the new frame is ready", async () => {
  const previousIsTauri = globalThis.isTauri;
  const previousWindow = globalThis.window;
  const { document, window } = installSurfaceDomShim();
  const mintRequests = [];
  globalThis.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    invoke(command, args) {
      if (command === "get_agency_runtime_config") {
        return Promise.resolve({ baseUrl: "http://localhost:1337" });
      }
      if (command === "mint_surface_session") {
        return new Promise((resolve) => {
          mintRequests.push({ args, resolve });
        });
      }
      throw new Error(`unexpected Tauri command: ${command}`);
    },
  };

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const renderFrame = (props) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(SurfaceFrame, props),
    );
  const readyFor = (frame) =>
    window.dispatchEvent({
      type: "message",
      origin: "http://localhost:1337",
      source: frame.contentWindow,
      data: { type: "agency.surface.ready", protocol: "agency.ui.v1" },
    });
  const sessionMessages = (frame) =>
    frame.contentWindow.posted.filter(
      ({ message }) => message.type === "agency.surface.session",
    );

  try {
    await React.act(async () => {
      root.render(
        renderFrame({
          name: "agency",
          projectRef: "project-a",
          sessionActions: ["surface.read"],
        }),
      );
    });
    const frameA = container.firstChild;
    assert.ok(frameA, "mount should render an iframe");
    const requestA = mintRequests.find(
      ({ args }) => args.request.projectRef === "project-a",
    );
    assert.ok(requestA, "mount should mint a session for project A");

    await React.act(async () => {
      frameA.dispatchEvent({ type: "load" });
      readyFor(frameA);
      requestA.resolve({
        token: "token-a",
        actions: ["surface.read"],
      });
    });
    assert.deepEqual(
      sessionMessages(frameA).map(({ message }) => message.token),
      ["token-a"],
    );

    await React.act(async () => {
      root.render(
        renderFrame({
          name: "control",
          projectRef: "project-b",
          sessionActions: ["surface.read"],
        }),
      );
    });
    const requestB = mintRequests.find(
      ({ args }) => args.request.projectRef === "project-b",
    );
    assert.ok(requestB, "navigation should mint a session for project B");
    const frameB = container.firstChild;
    assert.ok(frameB, "navigation should render the replacement iframe");
    assert.notEqual(
      frameB,
      frameA,
      "a new surface identity should create a fresh browsing context",
    );
    assert.deepEqual(
      sessionMessages(frameA).map(({ message }) => message.token),
      ["token-a"],
      "changing the surface identity must synchronously clear readiness",
    );

    await React.act(async () => {
      // Simulate the exact cross-navigation race: the old document queues its
      // load, then announces ready from the same origin after src changed.
      frameA.dispatchEvent({ type: "load" });
      readyFor(frameA);
    });

    await React.act(async () => {
      requestB.resolve({
        token: "token-b",
        actions: ["surface.read"],
      });
    });
    assert.deepEqual(
      sessionMessages(frameB).map(({ message }) => message.token),
      [],
      "the old same-origin document must not receive the new token",
    );
    assert.deepEqual(
      sessionMessages(frameA).map(({ message }) => message.token),
      ["token-a"],
      "the stale document must retain only its original token",
    );

    await React.act(async () => {
      frameB.dispatchEvent({ type: "load" });
      readyFor(frameB);
    });
    assert.deepEqual(
      sessionMessages(frameB).map(({ message }) => message.token),
      ["token-b"],
    );
  } finally {
    await React.act(async () => root.unmount());
    globalThis.isTauri = previousIsTauri;
    globalThis.window = previousWindow;
  }
});

test("surface sessions retry transient startup failures with bounded backoff", () => {
  assert.deepEqual(SURFACE_SESSION_RETRY_DELAYS_MS, [500, 1_500, 3_000]);
  assert.equal(
    shouldRetrySurfaceSession(new Error("connection refused")),
    true,
  );
  assert.equal(
    shouldRetrySurfaceSession(
      new Error("Surface session request failed: HTTP 503"),
    ),
    true,
  );
  assert.equal(
    shouldRetrySurfaceSession(
      new Error("Surface session request failed: HTTP 429"),
    ),
    true,
  );
});

test("surface sessions do not retry policy or contract failures", () => {
  assert.equal(
    shouldRetrySurfaceSession(
      new Error("Surface session request failed: HTTP 403"),
    ),
    false,
  );
  assert.equal(
    shouldRetrySurfaceSession(
      new Error("Surface session request failed: HTTP 404"),
    ),
    false,
  );
  assert.equal(
    shouldRetrySurfaceSession(
      new Error("Surface session response was invalid: expected token"),
    ),
    false,
  );
});

// ── SurfaceScreen refactor (no behavioral regression, now sandboxed) ──────────

test("SurfaceScreen renders the sandboxed frame with the mapped src", () => {
  const html = renderSurface(
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
    html.includes('src="http://localhost:1337/surfaces/agency/?scope=global"'),
    "top-level SurfaceScreen uses global execution scope",
  );
});
