import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCapturedTaskRequest,
  buildStartWorkRequest,
  capturedTaskTitle,
} from "./voxelboxWork.ts";

test("capturedTaskTitle produces a bounded action title", () => {
  assert.equal(
    capturedTaskTitle("## Fix the Board\nMore detail", "Tim"),
    "Fix the Board",
  );
  assert.equal(capturedTaskTitle("", "Tim"), "Follow up with Tim");
  assert.equal(capturedTaskTitle("x".repeat(140), "Tim").length, 120);
});

test("buildCapturedTaskRequest preserves Space and durable Buzz source", () => {
  const request = buildCapturedTaskRequest({
    channelId: "channel-one",
    space: "voxelbox-ai",
    message: {
      id: "event-one",
      createdAt: 1,
      author: "Tim",
      time: "now",
      body: "Ship the native Board",
      rootId: "thread-root",
      depth: 1,
    },
  });

  assert.deepEqual(request, {
    space: "voxelbox-ai",
    projectRef: "",
    sourceRef:
      "buzz://message?channel=channel-one&id=event-one&thread=thread-root",
    title: "Ship the native Board",
    description: "From Tim in Buzz\n\nShip the native Board",
  });
});

test("buildStartWorkRequest explicitly promotes the existing Buzz thread", () => {
  const request = buildStartWorkRequest({
    channelId: "channel-one",
    participantId: "user-pubkey",
    space: "voxelbox-ai",
    message: {
      id: "reply-one",
      createdAt: 1,
      author: "Tim",
      time: "now",
      body: "Take this on",
      rootId: "thread-root",
      depth: 1,
    },
  });

  assert.equal(
    request.threadRef,
    "buzz://message?channel=channel-one&id=thread-root",
  );
  assert.equal(request.participantId, "user-pubkey");
  assert.equal(request.mode, "execute");
  assert.equal(
    request.idempotencyKey,
    `buzz-work:voxelbox-ai:${request.sourceRef}:self`,
  );
});
