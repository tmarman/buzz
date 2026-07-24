const STORAGE_KEY_PREFIX = "buzz-channel-surfaces.v1";

/**
 * Dispatched on window after a set/clear mutates the channel→surface mapping.
 *
 * localStorage writes are not reactive: the picker (writer) and the channel app
 * tab (reader) are separate components, so clearing a mapping in the picker would
 * otherwise leave a stale surface frame mounted in the channel. Readers subscribe
 * via subscribeChannelSurface (below) and re-read on this event. Same-document
 * only — the native `storage` event does NOT fire in the tab that made the write.
 */
export const CHANNEL_SURFACE_CHANGE_EVENT = "buzz:channel-surface-change";

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
    notifyChannelSurfaceChange();
    return true;
  } catch {
    return false;
  }
}

// Guarded so a mutation never throws where `window` has no event surface
// (SSR, and the localStorage test doubles that stub `window = {}`).
function notifyChannelSurfaceChange(): void {
  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function"
  ) {
    window.dispatchEvent(new CustomEvent(CHANNEL_SURFACE_CHANGE_EVENT));
  }
}

/**
 * Subscribe to channel→surface mapping changes. Fires on same-document mutations
 * (via CHANNEL_SURFACE_CHANGE_EVENT) and cross-tab writes (via the native
 * `storage` event for this store's keys). Returns an unsubscribe. Designed as the
 * `subscribe` half of a React `useSyncExternalStore` pair.
 */
export function subscribeChannelSurface(listener: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function"
  ) {
    return () => {};
  }
  const onLocalChange = () => listener();
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(STORAGE_KEY_PREFIX)) {
      listener();
    }
  };
  window.addEventListener(CHANNEL_SURFACE_CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANNEL_SURFACE_CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
  };
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
