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
  version: 3;
  channels: Record<string, string[]>;
  initializedChannels: string[];
};

export const DEFAULT_STORE: ChannelSurfaceStore = Object.freeze({
  version: 3,
  channels: {},
  initializedChannels: [],
});

export function storageKey(pubkey: string): string {
  return `${STORAGE_KEY_PREFIX}:${pubkey}`;
}

export function parseSurfacePayload(json: unknown): ChannelSurfaceStore | null {
  if (typeof json !== "object" || json === null) return null;
  const obj = json as Record<string, unknown>;
  if (obj.version !== 1 && obj.version !== 2 && obj.version !== 3) return null;
  if (
    typeof obj.channels !== "object" ||
    obj.channels === null ||
    Array.isArray(obj.channels)
  ) {
    return DEFAULT_STORE;
  }

  const channels = Object.fromEntries(
    Object.entries(obj.channels as Record<string, unknown>).flatMap(
      ([channelId, value]) => {
        const surfaces =
          typeof value === "string"
            ? [value]
            : Array.isArray(value)
              ? value.filter(
                  (surface): surface is string => typeof surface === "string",
                )
              : [];
        const normalized = [
          ...new Set(surfaces.map((surface) => surface.trim()).filter(Boolean)),
        ];
        return normalized.length > 0 ? [[channelId, normalized]] : [];
      },
    ),
  );
  const initializedChannels =
    obj.version === 3 && Array.isArray(obj.initializedChannels)
      ? [
          ...new Set(
            obj.initializedChannels.filter(
              (channelId): channelId is string =>
                typeof channelId === "string" && channelId.trim().length > 0,
            ),
          ),
        ]
      : Object.keys(channels);
  return { version: 3, channels, initializedChannels };
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
  return getChannelSurfaces(pubkey, channelId)[0];
}

export function getChannelSurfaces(
  pubkey: string,
  channelId: string,
): string[] {
  const channels = readChannelSurfaceStore(pubkey).channels;
  return Object.hasOwn(channels, channelId) ? [...channels[channelId]] : [];
}

/** Legacy single-selection setter. Replaces the channel's pinned tabs. */
export function setChannelSurface(
  pubkey: string,
  channelId: string,
  surfaceName: string,
): boolean {
  const store = readChannelSurfaceStore(pubkey);
  return writeChannelSurfaceStore(pubkey, {
    version: 3,
    channels: { ...store.channels, [channelId]: [surfaceName] },
    initializedChannels: [
      ...new Set([...store.initializedChannels, channelId]),
    ],
  });
}

/**
 * Applies Space-provided defaults once. A channel remains initialized even
 * after the user removes every tab, so defaults never fight explicit choices.
 */
export function initializeChannelSurfaces(
  pubkey: string,
  channelId: string,
  surfaceNames: readonly string[],
): boolean {
  const store = readChannelSurfaceStore(pubkey);
  if (store.initializedChannels.includes(channelId)) return true;
  const names = [
    ...new Set(surfaceNames.map((name) => name.trim()).filter(Boolean)),
  ];
  return writeChannelSurfaceStore(pubkey, {
    version: 3,
    channels:
      names.length > 0
        ? { ...store.channels, [channelId]: names }
        : store.channels,
    initializedChannels: [...store.initializedChannels, channelId],
  });
}

export function addChannelSurface(
  pubkey: string,
  channelId: string,
  surfaceName: string,
): boolean {
  const name = surfaceName.trim();
  if (!name) return false;
  const store = readChannelSurfaceStore(pubkey);
  const current = store.channels[channelId] ?? [];
  if (current.includes(name)) return true;
  return writeChannelSurfaceStore(pubkey, {
    version: 3,
    channels: { ...store.channels, [channelId]: [...current, name] },
    initializedChannels: [
      ...new Set([...store.initializedChannels, channelId]),
    ],
  });
}

export function removeChannelSurface(
  pubkey: string,
  channelId: string,
  surfaceName: string,
): boolean {
  const store = readChannelSurfaceStore(pubkey);
  const current = store.channels[channelId] ?? [];
  const next = current.filter((name) => name !== surfaceName);
  if (next.length === current.length) return true;
  if (next.length === 0) {
    const { [channelId]: _, ...channels } = store.channels;
    return writeChannelSurfaceStore(pubkey, {
      version: 3,
      channels,
      initializedChannels: store.initializedChannels,
    });
  }
  return writeChannelSurfaceStore(pubkey, {
    version: 3,
    channels: { ...store.channels, [channelId]: next },
    initializedChannels: store.initializedChannels,
  });
}

export function clearChannelSurface(
  pubkey: string,
  channelId: string,
): boolean {
  const store = readChannelSurfaceStore(pubkey);
  if (!Object.hasOwn(store.channels, channelId)) return true;
  const { [channelId]: _, ...channels } = store.channels;
  return writeChannelSurfaceStore(pubkey, {
    version: 3,
    channels,
    initializedChannels: store.initializedChannels,
  });
}
