import type { ConflictItem, Invoke, Resolution } from "./types";

export type KeyStoreKind = "keychain" | "file";

/** The Rust side labels the store "System keychain" or "Unprotected file (…)". */
export function keyStoreKind(label: string | null | undefined): KeyStoreKind {
  return label && label.toLowerCase().startsWith("unprotected") ? "file" : "keychain";
}

/** Move this device's secrets. Only ever called from an explicit user choice in Settings. */
export function changeKeyStore(invoke: Invoke, useKeychain: boolean): Promise<string> {
  return invoke<string>("set_key_store", { useKeychain });
}

export function resolveConflict(invoke: Invoke, item: ConflictItem, resolution: Resolution): Promise<void> {
  return invoke<void>("resolve_conflict", { path: item.path, resolution });
}

/** Marks `state` busy for the duration of `fn` and always clears it, even when `fn` throws. */
export async function withBusy<T>(state: { busy: boolean }, fn: () => Promise<T>): Promise<T> {
  state.busy = true;
  try {
    return await fn();
  } finally {
    state.busy = false;
  }
}
