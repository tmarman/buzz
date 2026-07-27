import type { McpAppMessage } from "@/features/mcp-apps/lib/mcpAppBridge";

export function mcpAppMessageText(message: McpAppMessage): string | null {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [message.content];
  const text = blocks
    .flatMap((block) => {
      if (typeof block === "string") return [block];
      if (
        block &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === "text" &&
        typeof (block as Record<string, unknown>).text === "string"
      ) {
        return [(block as Record<string, unknown>).text as string];
      }
      return [];
    })
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || null;
}
