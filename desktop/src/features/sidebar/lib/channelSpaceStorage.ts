const STORAGE_KEY_PREFIX = "buzz-channel-spaces.v1";

export const CHANNEL_SPACE_CHANGE_EVENT = "buzz:channel-space-change";

export type ChannelAgencyScope = {
  agencyId: string;
  space: string;
};

type ChannelSpaceStore = {
  version: 2;
  channels: Record<string, ChannelAgencyScope>;
};

const DEFAULT_STORE: ChannelSpaceStore = Object.freeze({
  version: 2,
  channels: {},
});

function storageKey(pubkey: string): string {
  return `${STORAGE_KEY_PREFIX}:${pubkey}`;
}

function readStore(pubkey: string): ChannelSpaceStore {
  try {
    const raw = window.localStorage.getItem(storageKey(pubkey));
    if (!raw) return DEFAULT_STORE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_STORE;
    const source = parsed as Record<string, unknown>;
    if (
      (source.version !== 1 && source.version !== 2) ||
      typeof source.channels !== "object" ||
      source.channels === null ||
      Array.isArray(source.channels)
    ) {
      return DEFAULT_STORE;
    }
    const channels = Object.fromEntries(
      Object.entries(source.channels as Record<string, unknown>).flatMap(
        ([channelId, value]) => {
          if (typeof value === "string" && value.trim()) {
            return [[channelId, { agencyId: "voxelbox", space: value.trim() }]];
          }
          if (typeof value !== "object" || value === null) return [];
          const entry = value as Record<string, unknown>;
          const space =
            typeof entry.space === "string" ? entry.space.trim() : "";
          const agencyId =
            typeof entry.agencyId === "string"
              ? entry.agencyId.trim()
              : typeof entry.agency_id === "string"
                ? entry.agency_id.trim()
                : "";
          return space ? [[channelId, { agencyId, space }]] : [];
        },
      ),
    ) as Record<string, ChannelAgencyScope>;
    return { version: 2, channels };
  } catch {
    return DEFAULT_STORE;
  }
}

function writeStore(pubkey: string, store: ChannelSpaceStore): boolean {
  try {
    window.localStorage.setItem(storageKey(pubkey), JSON.stringify(store));
    window.dispatchEvent?.(new CustomEvent(CHANNEL_SPACE_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function subscribeChannelSpace(listener: () => void): () => void {
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
  window.addEventListener(CHANNEL_SPACE_CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANNEL_SPACE_CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getChannelSpace(
  pubkey: string,
  channelId: string,
): string | undefined {
  return readStore(pubkey).channels[channelId]?.space;
}

export function getChannelAgencyScope(
  pubkey: string,
  channelId: string,
): ChannelAgencyScope | undefined {
  return readStore(pubkey).channels[channelId];
}

export function setChannelSpace(
  pubkey: string,
  channelId: string,
  space: string,
): boolean {
  return setChannelAgencyScope(pubkey, channelId, {
    agencyId: "voxelbox",
    space,
  });
}

export function setChannelAgencyScope(
  pubkey: string,
  channelId: string,
  scope: ChannelAgencyScope,
): boolean {
  const normalizedSpace = scope.space.trim();
  const normalizedAgency = scope.agencyId.trim();
  if (!normalizedSpace) return clearChannelSpace(pubkey, channelId);
  const store = readStore(pubkey);
  return writeStore(pubkey, {
    version: 2,
    channels: {
      ...store.channels,
      [channelId]: { agencyId: normalizedAgency, space: normalizedSpace },
    },
  });
}

export function clearChannelSpace(pubkey: string, channelId: string): boolean {
  const store = readStore(pubkey);
  if (!Object.hasOwn(store.channels, channelId)) return true;
  const { [channelId]: _, ...channels } = store.channels;
  return writeStore(pubkey, { version: 2, channels });
}
