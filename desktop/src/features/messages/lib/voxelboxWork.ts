import { buildMessageLink } from "@/features/messages/lib/messageLink";
import { stripAgencyMessageEnvelope } from "@/features/messages/lib/agencyMessageBlocks";
import type { TimelineMessage } from "@/features/messages/types";
import { invokeTauri } from "@/shared/api/tauri";

export type CapturedVoxelboxTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  space: string;
  projectRef: string;
  sourceRef: string;
  revision: number;
};

export type CaptureBuzzMessageInput = {
  channelId: string;
  message: TimelineMessage;
  projectRef?: string;
  space: string;
};

export type StartBuzzMessageWorkInput = CaptureBuzzMessageInput & {
  participantId: string;
};

export type StartedVoxelboxWork = {
  task: CapturedVoxelboxTask;
  threadRef: string;
  dispatchId: string;
  created: boolean;
};

export function capturedTaskTitle(body: string, author: string): string {
  const content = stripAgencyMessageEnvelope(body);
  const firstLine =
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const normalized = firstLine
    .replace(/^(?:#{1,6}|>|[-*+]|\d+\.)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const fallback = author.trim()
    ? `Follow up with ${author.trim()}`
    : "Follow up from Buzz";
  const title = normalized || fallback;
  return title.length <= 120 ? title : `${title.slice(0, 119).trimEnd()}…`;
}

export function buildCapturedTaskRequest({
  channelId,
  message,
  projectRef = "",
  space,
}: CaptureBuzzMessageInput) {
  const { rootId } = getMessageThreadReference(message);
  const sourceRef = buildMessageLink({
    channelId,
    messageId: message.id,
    threadRootId: rootId,
  });
  const visibleBody = stripAgencyMessageEnvelope(message.body).trim();
  return {
    space,
    projectRef,
    sourceRef,
    title: capturedTaskTitle(visibleBody, message.author),
    description: visibleBody
      ? `From ${message.author} in Buzz\n\n${visibleBody}`
      : `From ${message.author} in Buzz`,
  };
}

export async function captureBuzzMessageAsTask(
  input: CaptureBuzzMessageInput,
): Promise<CapturedVoxelboxTask> {
  return invokeTauri<CapturedVoxelboxTask>("capture_voxelbox_task", {
    request: buildCapturedTaskRequest(input),
  });
}

export function buildStartWorkRequest(input: StartBuzzMessageWorkInput) {
  const captured = buildCapturedTaskRequest(input);
  const { rootId } = getMessageThreadReference(input.message);
  const threadRef = buildMessageLink({
    channelId: input.channelId,
    messageId: rootId ?? input.message.id,
  });
  return {
    ...captured,
    threadRef,
    idempotencyKey: `buzz-work:${input.space}:${captured.sourceRef}:self`,
    participantId: input.participantId,
    mode: "execute",
  };
}

export async function startBuzzMessageWork(
  input: StartBuzzMessageWorkInput,
): Promise<StartedVoxelboxWork> {
  return invokeTauri<StartedVoxelboxWork>("start_voxelbox_work", {
    request: buildStartWorkRequest(input),
  });
}

function getMessageThreadReference(message: TimelineMessage): {
  rootId: string | null;
} {
  if (message.rootId) return { rootId: message.rootId };
  const rootTag = message.tags?.find(
    (tag) => tag[0] === "e" && tag[3] === "root",
  );
  return { rootId: rootTag?.[1] ?? null };
}
