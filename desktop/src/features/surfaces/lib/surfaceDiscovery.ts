const SURFACE_DISCOVERY_URL = "http://localhost:1337/surfaces/";

function hasSurfaceName(surface: unknown): surface is { name: string } {
  return (
    typeof surface === "object" &&
    surface !== null &&
    "name" in surface &&
    typeof surface.name === "string"
  );
}

/**
 * Discovers surface names exposed by the local surface host.
 *
 * Discovery is optional: an unavailable or malformed response means no
 * surfaces are available rather than an application error.
 */
export async function fetchInstalledSurfaces(): Promise<string[]> {
  try {
    const response = await fetch(SURFACE_DISCOVERY_URL);
    if (!response.ok) {
      return [];
    }

    const surfaces: unknown = await response.json();
    if (!Array.isArray(surfaces)) {
      return [];
    }

    return surfaces.flatMap((surface) =>
      hasSurfaceName(surface) ? [surface.name] : [],
    );
  } catch {
    return [];
  }
}

/** Returns whether a discovered surface name is permitted for use. */
export function isSurfaceAllowed(
  name: string,
  installedNames: readonly string[],
): boolean {
  return installedNames.includes(name);
}
