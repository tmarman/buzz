import * as React from "react";

import {
  callMcpAppTool,
  prepareMcpAppView,
  releaseMcpAppView,
  type McpAppResourcePermissions,
} from "@/shared/api/tauriMcpApps";
import {
  connectMcpAppBridge,
  createMcpAppBridge,
  observeMcpAppHostContext,
  type McpAppBridgeCallbacks,
} from "@/features/mcp-apps/lib/mcpAppBridge";

const PROXY_READY_METHOD = "ui/notifications/sandbox-proxy-ready";

export type McpAppFrameProps = McpAppBridgeCallbacks & {
  serverId: string;
  resourceUri: string;
  title: string;
  initialTool?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  className?: string;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onPermissionsRequested?: (permissions: McpAppResourcePermissions) => void;
};

function waitForSandboxProxy(
  iframe: HTMLIFrameElement,
  sandboxUrl: string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("MCP App sandbox did not become ready"));
    }, 10_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("MCP App load cancelled", "AbortError"));
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source === iframe.contentWindow &&
        event.data?.method === PROXY_READY_METHOD
      ) {
        cleanup();
        resolve();
      }
    };
    window.addEventListener("message", onMessage);
    signal.addEventListener("abort", onAbort, { once: true });
    iframe.src = sandboxUrl;
  });
}

/**
 * Standards-compliant MCP App frame. The iframe loads only Buzz's trusted
 * outer proxy; untrusted resource HTML is inserted into its inner sandbox.
 */
export function McpAppFrame({
  serverId,
  resourceUri,
  title,
  initialTool,
  className,
  onReady,
  onError,
  onPermissionsRequested,
  onMessage,
  onModelContext,
  onOpenLink,
  onDisplayMode,
  onSizeChange,
}: McpAppFrameProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const abortController = new AbortController();
    let bridge: ReturnType<typeof createMcpAppBridge> | null = null;
    let disposeContext: (() => void) | null = null;
    let viewId: string | null = null;

    const start = async () => {
      try {
        setError(null);
        const prepared = await prepareMcpAppView(serverId, resourceUri);
        if (abortController.signal.aborted) return;
        viewId = prepared.viewId;
        onPermissionsRequested?.(prepared.requestedPermissions);

        bridge = createMcpAppBridge(serverId, {
          onMessage,
          onModelContext,
          onOpenLink,
          onDisplayMode,
          onSizeChange,
        });
        await waitForSandboxProxy(
          iframe,
          prepared.sandboxUrl,
          abortController.signal,
        );
        await connectMcpAppBridge(bridge, iframe);

        const initialized = new Promise<void>((resolve) => {
          const handleInitialized = () => {
            bridge?.removeEventListener("initialized", handleInitialized);
            resolve();
          };
          bridge?.addEventListener("initialized", handleInitialized);
        });
        await bridge.sendSandboxResourceReady({
          html: prepared.html,
          csp: prepared.csp,
          permissions: {},
          sandbox: "allow-scripts allow-same-origin allow-forms",
        });
        await initialized;
        if (abortController.signal.aborted) return;

        disposeContext = observeMcpAppHostContext(bridge, iframe);
        if (initialTool) {
          await bridge.sendToolInput({ arguments: initialTool.arguments });
          const result = await callMcpAppTool(
            serverId,
            initialTool.name,
            initialTool.arguments,
            "host",
          );
          await bridge.sendToolResult(result);
        }
        onReady?.();
      } catch (cause) {
        if (abortController.signal.aborted) return;
        const next =
          cause instanceof Error ? cause : new Error("MCP App failed to load");
        setError(next.message);
        onError?.(next);
      }
    };

    void start();
    return () => {
      abortController.abort();
      disposeContext?.();
      if (bridge) {
        void bridge.teardownResource({}).catch(() => undefined);
        void bridge.close();
      }
      if (viewId) void releaseMcpAppView(viewId);
      iframe.removeAttribute("src");
    };
  }, [
    initialTool,
    onDisplayMode,
    onError,
    onMessage,
    onModelContext,
    onOpenLink,
    onPermissionsRequested,
    onReady,
    onSizeChange,
    resourceUri,
    serverId,
  ]);

  return (
    <div
      className={`relative overflow-hidden ${className ?? ""}`}
      data-testid="mcp-app-frame"
    >
      <iframe
        className="h-full min-h-48 w-full border-0 bg-background"
        ref={iframeRef}
        sandbox="allow-forms allow-same-origin allow-scripts"
        title={title}
      />
      {error ? (
        <div
          className="absolute inset-0 grid place-items-center bg-background/95 p-6 text-center text-sm text-muted-foreground"
          role="alert"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
