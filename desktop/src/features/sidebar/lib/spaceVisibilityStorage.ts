const STORAGE_KEY_PREFIX = "buzz-hidden-voxelbox-spaces.v1";

export const SPACE_VISIBILITY_CHANGE_EVENT =
  "buzz:voxelbox-space-visibility-change";

type SpaceVisibilityStore = {
  version: 1;
  hiddenSpaceIds: string[];
};

const DEFAULT_STORE: SpaceVisibilityStore = Object.freeze({
  version: 1,
  hiddenSpaceIds: [],
});

export function storageKey(pubkey: string): string {
  return `${STORAGE_KEY_PREFIX}:${pubkey}`;
}

export function parseSpaceVisibilityPayload(
  value: unknown,
): SpaceVisibilityStore | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  if (source.version !== 1 || !Array.isArray(source.hiddenSpaceIds)) {
    return null;
  }
  return {
    version: 1,
    hiddenSpaceIds: [
      ...new Set(
        source.hiddenSpaceIds.flatMap((spaceId) =>
          typeof spaceId === "string" && spaceId.trim() ? [spaceId.trim()] : [],
        ),
      ),
    ].sort(),
  };
}

function readStore(pubkey: string): SpaceVisibilityStore {
  if (!pubkey || typeof window === "undefined") return DEFAULT_STORE;
  try {
    const raw = window.localStorage.getItem(storageKey(pubkey));
    if (!raw) return DEFAULT_STORE;
    return parseSpaceVisibilityPayload(JSON.parse(raw)) ?? DEFAULT_STORE;
  } catch {
    return DEFAULT_STORE;
  }
}

function writeStore(pubkey: string, store: SpaceVisibilityStore): boolean {
  if (!pubkey || typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(storageKey(pubkey), JSON.stringify(store));
    window.dispatchEvent?.(new CustomEvent(SPACE_VISIBILITY_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function getHiddenSpaceIds(pubkey: string): string[] {
  return [...readStore(pubkey).hiddenSpaceIds];
}

export function getHiddenSpaceIdsSnapshot(pubkey: string): string {
  return JSON.stringify(readStore(pubkey).hiddenSpaceIds);
}

export function setSpaceHidden(
  pubkey: string,
  spaceId: string,
  hidden: boolean,
): boolean {
  const normalized = spaceId.trim();
  if (!normalized) return false;
  const hiddenSpaceIds = new Set(readStore(pubkey).hiddenSpaceIds);
  if (hidden) {
    hiddenSpaceIds.add(normalized);
  } else {
    hiddenSpaceIds.delete(normalized);
  }
  return writeStore(pubkey, {
    version: 1,
    hiddenSpaceIds: [...hiddenSpaceIds].sort(),
  });
}

export function restoreAllSpaces(pubkey: string): boolean {
  return writeStore(pubkey, { version: 1, hiddenSpaceIds: [] });
}

export function subscribeSpaceVisibility(listener: () => void): () => void {
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
  window.addEventListener(SPACE_VISIBILITY_CHANGE_EVENT, onLocalChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SPACE_VISIBILITY_CHANGE_EVENT, onLocalChange);
    window.removeEventListener("storage", onStorage);
  };
}
