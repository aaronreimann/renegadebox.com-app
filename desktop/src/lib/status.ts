import { plural } from "./format";

/** Mirrors `SyncOverview` in commands.rs. */
export interface Overview {
  initialized: boolean;
  paused: boolean;
  syncing: boolean;
  /** Local changes not yet sent to storage. */
  pending: number;
  conflicts: number;
  /** Raw error from the last sync attempt, or null when the last attempt worked. */
  error: string | null;
}

export type StatusKind = "ok" | "syncing" | "paused" | "attention" | "error" | "setup";

export interface StatusLine {
  kind: StatusKind;
  title: string;
  detail: string | null;
}

export function describeStatus(o: Overview): StatusLine {
  if (!o.initialized) {
    return { kind: "setup", title: "Not set up yet", detail: "Connect your storage to start syncing." };
  }
  if (o.conflicts > 0) {
    const title = o.conflicts === 1 ? "1 file needs your attention" : `${o.conflicts} files need your attention`;
    return { kind: "attention", title, detail: "Two versions were saved at the same time." };
  }
  if (o.paused) {
    return {
      kind: "paused",
      title: "Paused",
      detail: o.pending > 0 ? `${plural(o.pending, "change", "changes")} will sync when you resume.` : "Changes will sync when you resume.",
    };
  }
  if (o.error) {
    return { kind: "error", title: friendlyError(o.error), detail: "RenegadeBox will keep trying." };
  }
  if (o.syncing || o.pending > 0) {
    const title = o.pending > 0 ? `Syncing ${plural(o.pending, "file", "files")}…` : "Syncing…";
    return { kind: "syncing", title, detail: null };
  }
  return { kind: "ok", title: "Up to date", detail: "Your files are safely synced." };
}

export const SYNC_FALLBACK = "Something went wrong while syncing. RenegadeBox will keep trying.";

/** Turn an engine/storage error into one sentence a non-expert can act on. */
export function friendlyError(raw: string, fallback: string = SYNC_FALLBACK): string {
  const e = raw.toLowerCase();
  if (e.includes("wrong passphrase")) {
    return "That passphrase doesn't match the one this storage was set up with.";
  }
  if (e.includes("changed since this device was set up")) {
    return "Your storage's passphrase settings changed. If you didn't change your passphrase, choose Reconnect in Settings.";
  }
  if (/invalidaccesskeyid|signaturedoesnotmatch|accessdenied|forbidden|\b403\b/.test(e)) {
    return "Your storage provider didn't accept your access keys. Check them with Reconnect in Settings.";
  }
  if (e.includes("nosuchbucket")) {
    return "Couldn't find that bucket. Check the bucket name with your storage provider.";
  }
  if (e.includes("keychain")) {
    return "RenegadeBox couldn't read its keys from the system keychain. Choose Reconnect in Settings.";
  }
  if (e.includes("sync folder") && e.includes("missing")) {
    return "Your RenegadeBox folder is missing. Is it on a drive that isn't plugged in?";
  }
  if (/dispatch|connect|timed out|timeout|dns|network|unreachable|io error|broken pipe/.test(e)) {
    return "Can't reach your storage — check your internet connection";
  }
  return fallback;
}
