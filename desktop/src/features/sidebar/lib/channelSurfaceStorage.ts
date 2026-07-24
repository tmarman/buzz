const STORAGE_KEY_PREFIX = "buzz-channel-surfaces.v1";

export type ChannelSurfaceStore = {
  version: 1;
  channels: Record<string, string>;
};

export const DEFAULT_STORE: ChannelSurfaceStore = Object.freeze({
  version: 1,
  channels: {},
});

export function storageKey(pubkey: string): string {
  return `${STORAGE_KEY_PREFIX}:${pubkey}`;
}

export function parseSurfacePayload(json: unknown): ChannelSurfaceStore | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (obj.version !== 1) return null;
  const channels: Record<string, string> =
    typeof obj.channels === "object" &&
    obj.channels !== null &&
    !Array.isArray(obj.channels)
      ? Object.fromEntries(
          Object.entries(obj.channels as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  return { version: 1, channels };
}

function readChannelSurfaceStore(pubkey: string): ChannelSurfaceStore {
  try {
    const raw = window.localStorage.getItem(storageKey(pubkey));
    if (!raw) return DEFAULT_STORE;
    const parsed = JSON.parse(raw);
    return parseSurfacePayload(parsed) ?? DEFAULT_STORE;
  } catch {
    return DEFAULT_STORE;
  }
}

function writeChannelSurfaceStore(
  pubkey: string,
  store: ChannelSurfaceStore,
): boolean {
  try {
    window.localStorage.setItem(storageKey(pubkey), JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function getChannelSurface(
  pubkey: string,
  channelId: string,
): string | undefined {
  const channels = readChannelSurfaceStore(pubkey).channels;
  return Object.hasOwn(channels, channelId) ? channels[channelId] : undefined;
}

export function setChannelSurface(
  pubkey: string,
  channelId: string,
  surfaceName: string,
): boolean {
  const store = readChannelSurfaceStore(pubkey);
  return writeChannelSurfaceStore(pubkey, {
    version: 1,
    channels: { ...store.channels, [channelId]: surfaceName },
  });
}

export function clearChannelSurface(
  pubkey: string,
  channelId: string,
): boolean {
  const store = readChannelSurfaceStore(pubkey);
  if (!Object.hasOwn(store.channels, channelId)) return true;
  const { [channelId]: _, ...channels } = store.channels;
  return writeChannelSurfaceStore(pubkey, { version: 1, channels });
}
