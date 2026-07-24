export const SURFACE_HOST_ORIGIN = "http://localhost:1337";

export type SurfaceHostThemeMessage = {
  type: "agency.surface.theme";
  protocol: "agency.ui.v1";
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
    protocol: "agency.ui.v1",
    colorScheme,
    tokens,
  };
}

export function postSurfaceHostTheme(frame: HTMLIFrameElement | null): void {
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
  target.postMessage(message, SURFACE_HOST_ORIGIN);
}
