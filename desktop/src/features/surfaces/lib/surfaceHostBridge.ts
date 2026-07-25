export const SURFACE_HOST_ORIGIN = "http://localhost:1337";
export const SURFACE_HOST_PROTOCOL = "agency.ui.v1";

export type SurfaceHostCapability =
  | "host.theme"
  | "host.open_thread"
  | "host.open_project_artifact"
  | "host.open_agent_chat"
  | "host.create_work_thread"
  | "host.compose_message";

export type SurfaceReadyMessage = {
  type: "agency.surface.ready";
  protocol: typeof SURFACE_HOST_PROTOCOL;
};

export type SurfaceHostContextMessage = {
  type: "agency.surface.context";
  protocol: typeof SURFACE_HOST_PROTOCOL;
  host: "buzz";
  agencyId?: string;
  surfaceId?: string;
  embedded: boolean;
  space?: string;
  projectRef?: string;
  channelId?: string;
  communityId?: string;
  capabilities: SurfaceHostCapability[];
};

export type SurfaceHostSessionMessage = {
  type: "agency.surface.session";
  protocol: typeof SURFACE_HOST_PROTOCOL;
  token: string;
  expiresAt?: string;
  actions: string[];
};

export type SurfaceHostThemeMessage = {
  type: "agency.surface.theme";
  protocol: typeof SURFACE_HOST_PROTOCOL;
  colorScheme: "light" | "dark";
  tokens: Record<string, string>;
};

const COLOR_TOKENS = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  border: "--border",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  ring: "--ring",
} as const;

function asColor(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.includes("(") || normalized.startsWith("#")
    ? normalized
    : `hsl(${normalized})`;
}

export function buildSurfaceHostTheme(
  readToken: (name: string) => string,
  colorScheme: "light" | "dark",
): SurfaceHostThemeMessage {
  const tokens = Object.fromEntries(
    Object.entries(COLOR_TOKENS).flatMap(([name, cssName]) => {
      const value = asColor(readToken(cssName));
      return value ? [[name, value]] : [];
    }),
  );

  const radius = readToken("--radius").trim();
  if (radius) tokens.radius = radius;
  tokens.fontBody =
    readToken("font-family").trim() ||
    '"Inter Variable", Inter, "Avenir Next", "Segoe UI", sans-serif';

  return {
    type: "agency.surface.theme",
    protocol: SURFACE_HOST_PROTOCOL,
    colorScheme,
    tokens,
  };
}

export function buildSurfaceHostContext({
  capabilities = ["host.theme"],
  agencyId,
  channelId,
  communityId,
  embedded,
  projectRef,
  surfaceId,
  space,
}: {
  capabilities?: SurfaceHostCapability[];
  agencyId?: string;
  channelId?: string;
  communityId?: string;
  embedded: boolean;
  projectRef?: string;
  surfaceId?: string;
  space?: string;
}): SurfaceHostContextMessage {
  return {
    type: "agency.surface.context",
    protocol: SURFACE_HOST_PROTOCOL,
    host: "buzz",
    embedded,
    ...(agencyId ? { agencyId } : {}),
    ...(surfaceId ? { surfaceId } : {}),
    ...(space ? { space } : {}),
    ...(projectRef ? { projectRef } : {}),
    ...(channelId ? { channelId } : {}),
    ...(communityId ? { communityId } : {}),
    capabilities,
  };
}

export function postSurfaceHostSession(
  frame: HTMLIFrameElement | null,
  session: SurfaceHostSessionMessage,
  origin: string = SURFACE_HOST_ORIGIN,
): void {
  frame?.contentWindow?.postMessage(session, origin);
}

export function isSurfaceReadyMessage(
  value: unknown,
): value is SurfaceReadyMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    message.type === "agency.surface.ready" &&
    message.protocol === SURFACE_HOST_PROTOCOL
  );
}

export function postSurfaceHostContext(
  frame: HTMLIFrameElement | null,
  context: SurfaceHostContextMessage,
  origin: string = SURFACE_HOST_ORIGIN,
): void {
  frame?.contentWindow?.postMessage(context, origin);
}

export function postSurfaceHostTheme(
  frame: HTMLIFrameElement | null,
  origin: string = SURFACE_HOST_ORIGIN,
): void {
  const target = frame?.contentWindow;
  if (!target) return;

  const rootStyles = window.getComputedStyle(document.documentElement);
  const bodyStyles = window.getComputedStyle(document.body);
  const message = buildSurfaceHostTheme(
    (name) =>
      name === "font-family"
        ? bodyStyles.fontFamily
        : rootStyles.getPropertyValue(name),
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  );
  target.postMessage(message, origin);
}
