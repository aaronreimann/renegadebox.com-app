import { describe, it, expect } from "bun:test";
import { describeStatus, friendlyError, type Overview } from "../src/lib/status";
import { relativeTime, splitPath } from "../src/lib/format";
import {
  renderPopover,
  renderConflictList,
  renderSettings,
  renderPopoverSettings,
  renderSetup,
} from "../src/lib/views";
import { validateSetupStep, PROVIDERS, providerLabel, type SetupValues } from "../src/lib/setup";
import { changeKeyStore, keyStoreKind, resolveConflict } from "../src/lib/actions";
import { mockInvoke } from "../src/lib/ipc";
import type { AiConfigResponse, ConflictItem, NasTaxonomyScan, RecentFile, RouteDecision, VaultStatus } from "../src/lib/types";

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);

const base: Overview = {
  initialized: true,
  paused: false,
  syncing: false,
  pending: 0,
  conflicts: 0,
  error: null,
};

const recent: RecentFile[] = [
  { path: "Work/Q3 budget.xlsx", name: "Q3 budget.xlsx", folder: "Work", modified_ms: NOW - 2 * 60_000 },
  { path: "notes.txt", name: "notes.txt", folder: "", modified_ms: NOW - 3 * 3_600_000 },
];

const conflicts: ConflictItem[] = [
  {
    path: "Work/report (conflicted copy from Laptop 2026-10-15 a1b2c3d4).pdf",
    original_name: "report.pdf",
    folder: "Work",
    device: "Laptop",
    modified_ms: NOW - 60_000,
  },
];

const status: VaultStatus = {
  initialized: true,
  folder: "/Users/me/RenegadeBox",
  bucket: "my-files",
  region: "us-east-1",
  endpoint: "http://localhost:8333",
  device_id: "68a3c8a0-c930-4984-bc66-079164e213f6",
  device_name: "My-MBP",
  hub_url: null,
  key_store: "System keychain",
  total_files: 12,
  pending_changes: 0,
  total_bytes: 1024,
};

// Anything that looks like a content hash, blob id, uuid fragment or engine internals.
const DEV_DETAIL = /[0-9a-f]{8,}|blob|hash|lamport|debounce|fsevents|journal|device_id/i;

describe("status line", () => {
  it("is quiet when everything is fine", () => {
    expect(describeStatus(base)).toMatchObject({ kind: "ok", title: "Up to date" });
  });
  it("counts files while syncing", () => {
    expect(describeStatus({ ...base, syncing: true, pending: 3 }).title).toBe("Syncing 3 files…");
    expect(describeStatus({ ...base, syncing: true, pending: 1 }).title).toBe("Syncing 1 file…");
    expect(describeStatus({ ...base, pending: 2 }).title).toBe("Syncing 2 files…");
    expect(describeStatus({ ...base, syncing: true, pending: 0 }).title).toBe("Syncing…");
  });
  it("shows paused", () => {
    expect(describeStatus({ ...base, paused: true, pending: 4 })).toMatchObject({ kind: "paused", title: "Paused" });
  });
  it("puts conflicts first", () => {
    expect(describeStatus({ ...base, conflicts: 2, syncing: true, pending: 4 })).toMatchObject({
      kind: "attention",
      title: "2 files need your attention",
    });
    expect(describeStatus({ ...base, conflicts: 1 }).title).toBe("1 file needs your attention");
  });
  it("speaks plain English for errors", () => {
    const s = describeStatus({ ...base, error: "LIST rb/journal/: DispatchFailure(io error: Connection refused)" });
    expect(s.kind).toBe("error");
    expect(s.title).toBe("Can't reach your storage — check your internet connection");
    expect(s.title).not.toMatch(DEV_DETAIL);
  });
  it("asks for setup when not initialized", () => {
    expect(describeStatus({ ...base, initialized: false }).kind).toBe("setup");
  });
});

describe("friendlyError", () => {
  it("maps known engine failures to plain English without jargon", () => {
    const cases: [string, RegExp][] = [
      ["Could not connect to S3 or unlock vault: wrong passphrase (or vault tampered)", /passphrase doesn't match/],
      ["HEAD rb/vault.json: InvalidAccessKeyId: The key does not exist", /didn't accept your access keys/],
      ["LIST rb/: NoSuchBucket: The specified bucket does not exist", /couldn't find that bucket/i],
      ["keychain read of s3-secret failed: User canceled", /keychain/],
      ["sync folder /Users/a/RenegadeBox is missing (unmounted drive?) — refusing to sync", /folder is missing/],
      ["something totally unexpected 0xdeadbeefcafe", /Something went wrong/],
    ];
    for (const [raw, want] of cases) {
      const msg = friendlyError(raw);
      expect(msg).toMatch(want);
      expect(msg).not.toMatch(DEV_DETAIL);
      expect(msg).not.toContain("S3");
    }
  });
});

describe("formatting", () => {
  it("uses relative times", () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe("Just now");
    expect(relativeTime(NOW - 2 * 60_000, NOW)).toBe("2 min ago");
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago");
    expect(relativeTime(NOW - 1 * 3_600_000, NOW)).toBe("1 hour ago");
    expect(relativeTime(NOW - 30 * 3_600_000, NOW)).toBe("Yesterday");
    expect(relativeTime(NOW - 4 * 86_400_000, NOW)).toBe("4 days ago");
    expect(relativeTime(Date.UTC(2026, 2, 4, 12), NOW)).toBe("Mar 4");
  });
  it("splits paths into name and folder", () => {
    expect(splitPath("a/b/c.txt")).toEqual({ name: "c.txt", folder: "a/b" });
    expect(splitPath("c.txt")).toEqual({ name: "c.txt", folder: "" });
  });
});

describe("popover", () => {
  const states: [Partial<Overview>, string][] = [
    [{}, "Up to date"],
    [{ syncing: true, pending: 3 }, "Syncing 3 files…"],
    [{ paused: true }, "Paused"],
    [{ conflicts: 2 }, "2 files need your attention"],
    [{ error: "GET x: dispatch failure: timed out" }, "Can't reach your storage"],
  ];
  for (const [patch, text] of states) {
    it(`renders "${text}"`, () => {
      const html = renderPopover({ overview: { ...base, ...patch }, recent, now: NOW });
      expect(html).toContain(text);
      expect(html).toContain('id="status-line"');
      expect(html).toContain('id="open-folder-btn"');
      expect(html).toContain('id="pause-btn"');
      expect(html).toContain('id="settings-btn"');
      expect(html).not.toMatch(DEV_DETAIL);
    });
  }

  it("shows Resume when paused and Pause otherwise", () => {
    expect(renderPopover({ overview: { ...base, paused: true }, recent, now: NOW })).toContain("Resume");
    expect(renderPopover({ overview: base, recent, now: NOW })).toContain("Pause");
  });

  it("lists recent files with folder, relative time and a Show in Finder action", () => {
    const html = renderPopover({ overview: base, recent, now: NOW });
    expect(html).toContain("Recent");
    expect(html).toContain("Q3 budget.xlsx");
    expect(html).toContain("Work");
    expect(html).toContain("2 min ago");
    expect(html).toContain("Show in Finder");
    expect(html).toContain('data-index="0"');
  });

  it("makes the conflict status clickable only when conflicts exist", () => {
    expect(renderPopover({ overview: { ...base, conflicts: 1 }, recent, now: NOW })).toContain('id="conflicts-link"');
    expect(renderPopover({ overview: base, recent, now: NOW })).not.toContain('id="conflicts-link"');
  });

  it("offers setup when not initialized", () => {
    const html = renderPopover({ overview: { ...base, initialized: false }, recent: [], now: NOW });
    expect(html).toContain('id="start-setup-btn"');
  });

  it("explains the empty recent list", () => {
    expect(renderPopover({ overview: base, recent: [], now: NOW })).toContain("will show up here");
  });

  it("escapes file names", () => {
    const html = renderPopover({
      overview: base,
      recent: [{ path: "<img src=x>.txt", name: "<img src=x>.txt", folder: "", modified_ms: NOW }],
      now: NOW,
    });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });
});

describe("conflicts", () => {
  it("renders resolve actions with Keep both as the default and no hashes", () => {
    const html = renderConflictList({ conflicts, now: NOW });
    expect(html).toContain("report.pdf");
    expect(html).toContain("Laptop");
    expect(html).not.toMatch(DEV_DETAIL);
    expect(html).not.toContain("conflicted copy");
    const keepBoth = html.indexOf('data-resolution="keep_both"');
    expect(keepBoth).toBeGreaterThan(-1);
    expect(keepBoth).toBeLessThan(html.indexOf('data-resolution="keep_conflicted"'));
    expect(keepBoth).toBeLessThan(html.indexOf('data-resolution="keep_local"'));
    expect(html).toMatch(/class="btn primary"[^>]*data-resolution="keep_both"/);
  });

  it("passes the real path to resolve_conflict", async () => {
    const calls: [string, unknown][] = [];
    const invoke = async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return undefined as T;
    };
    await resolveConflict(invoke, conflicts[0]!, "keep_both");
    expect(calls).toEqual([["resolve_conflict", { path: conflicts[0]!.path, resolution: "keep_both" }]]);
  });
});

describe("settings", () => {
  it("shows plain settings without developer details", () => {
    const html = renderSettings({ status, autostart: true, ignored: [".DS_Store", "*.tmp"] });
    for (const s of ["My-MBP", "my-files", "us-east-1", "Reconnect", "Start at login", "System keychain (recommended)", "Unprotected file", "any app running as you can read it", "Quit RenegadeBox", ".DS_Store"]) {
      expect(html).toContain(s);
    }
    expect(html).not.toMatch(DEV_DETAIL);
    expect(html).toMatch(/id="autostart-toggle"[^>]*checked/);
    expect(html).toMatch(/value="keychain"[^>]*checked/);
  });

  it("reflects the unprotected file store", () => {
    const html = renderSettings({
      status: { ...status, key_store: "Unprotected file (readable by any app running as you)" },
      autostart: false,
      ignored: [],
    });
    expect(html).toMatch(/value="file"[^>]*checked/);
    expect(html).not.toMatch(/id="autostart-toggle"[^>]*checked/);
  });

  it("keystore toggle calls set_key_store", async () => {
    const calls: [string, unknown][] = [];
    const invoke = async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return "ok" as T;
    };
    await changeKeyStore(invoke, false);
    await changeKeyStore(invoke, true);
    expect(calls).toEqual([
      ["set_key_store", { useKeychain: false }],
      ["set_key_store", { useKeychain: true }],
    ]);
  });

  it("reads the key store kind from the status label", () => {
    expect(keyStoreKind("System keychain")).toBe("keychain");
    expect(keyStoreKind("Unprotected file (readable by any app running as you)")).toBe("file");
    expect(keyStoreKind(null)).toBe("keychain");
  });

  it("names providers in plain words", () => {
    expect(providerLabel(null)).toBe("Amazon S3");
    expect(providerLabel("http://localhost:8333")).toBe("Local test server");
    expect(providerLabel("https://abc.r2.cloudflarestorage.com")).toBe("Cloudflare R2");
    expect(providerLabel("https://s3.wasabisys.com")).toBe("Wasabi");
  });

  it("organizes standalone settings with macOS-style preference tabs", () => {
    const html = renderSettings({ status, autostart: true, ignored: [".DS_Store", "*.tmp"] });
    expect(html).toContain('data-tab="general"');
    expect(html).toContain('data-tab="storage"');
    expect(html).toContain('data-tab="security"');
    expect(html).toContain('data-tab="ignored"');
    expect(html).toContain('data-tab="ai"');
    expect(html).toContain('id="tab-panel-general"');
    expect(html).toContain('id="tab-panel-storage"');
    expect(html).toContain('id="tab-panel-security"');
    expect(html).toContain('id="tab-panel-ignored"');
    expect(html).toContain('id="tab-panel-ai"');
  });

  it("renders AI & Synology routing settings tab with all controls", () => {
    const html = renderSettings({ status, autostart: true, ignored: [] });
    expect(html).toContain('id="ai-enabled-toggle"');
    expect(html).toContain('id="ai-smb-target-input"');
    expect(html).toContain('id="ai-scan-btn"');
    expect(html).toContain('id="ai-api-key-input"');
    expect(html).toContain('id="ai-model-select"');
    expect(html).toContain('id="ai-rules-input"');
    expect(html).toContain('id="ai-auto-route-toggle"');
    expect(html).toContain('id="ai-save-btn"');
    expect(html).toContain('id="ai-test-btn"');
    expect(html).toContain('id="ai-test-result"');
  });

  it("renders settings directly inside popover for quick access", () => {
    const html = renderPopoverSettings({ status, autostart: true, ignored: [".DS_Store"] });
    expect(html).toContain("id=\"settings-back-btn\"");
    expect(html).toContain("id=\"settings-popout-btn\"");
    expect(html).toContain("My-MBP");
    expect(html).toContain("Local test server");
    expect(html).toContain("id=\"autostart-toggle\"");
    expect(html).not.toMatch(DEV_DETAIL);

    const s3Html = renderPopoverSettings({ status: { ...status, endpoint: null }, autostart: false, ignored: [] });
    expect(s3Html).toContain("Amazon S3");
  });
});

describe("setup", () => {
  const good: SetupValues = {
    provider: "local",
    endpoint: "http://localhost:8333",
    bucket: "my-files",
    region: "us-east-1",
    access_key_id: "dev",
    secret_access_key: "dev",
    passphrase: "correct horse battery",
    passphrase_confirm: "correct horse battery",
    folder: "~/RenegadeBox",
    device_name: "",
  };

  it("explains keys and the passphrase in plain language", () => {
    const html = renderSetup();
    expect(html).toContain("two keys");
    expect(html).toContain("type anything, e.g. dev");
    expect(html).toContain("can't be recovered");
    expect(html).toContain("every new device");
    expect(html).toContain("at least 12 characters");
    expect(html).toContain('id="setup-passphrase-confirm"');
    for (const p of PROVIDERS) expect(html).toContain(p.label);
    expect(html).not.toMatch(DEV_DETAIL);
  });

  it("validates each step", () => {
    expect(validateSetupStep(1, { ...good, bucket: " " })).toMatch(/bucket/i);
    expect(validateSetupStep(1, good)).toBeNull();
    expect(validateSetupStep(2, { ...good, secret_access_key: "" })).toMatch(/secret/i);
    expect(validateSetupStep(2, good)).toBeNull();
    expect(validateSetupStep(3, { ...good, passphrase: "short", passphrase_confirm: "short" })).toMatch(/12 characters/);
    expect(validateSetupStep(3, { ...good, passphrase_confirm: "different passphrase" })).toMatch(/don't match/);
    expect(validateSetupStep(3, good)).toBeNull();
    expect(validateSetupStep(4, { ...good, folder: "" })).toMatch(/folder/i);
    expect(validateSetupStep(4, good)).toBeNull();
  });
});

describe("browser mock mode", () => {
  it("serves realistic sample data for every screen", async () => {
    const st = await mockInvoke<VaultStatus>("get_vault_status", undefined, "ok");
    expect(st.initialized).toBe(true);
    const files = await mockInvoke<RecentFile[]>("list_recent_files", { limit: 10 }, "ok");
    expect(files.length).toBeGreaterThanOrEqual(5);
    const c = await mockInvoke<ConflictItem[]>("list_conflicts", undefined, "conflicts");
    expect(c.length).toBeGreaterThan(0);
    const ov = await mockInvoke<Overview>("get_sync_overview", undefined, "setup");
    expect(ov.initialized).toBe(false);
    const err = await mockInvoke<Overview>("get_sync_overview", undefined, "error");
    expect(err.error).toBeTruthy();
  });

  it("handles AI and Synology commands in mock mode", async () => {
    const aiConfig = await mockInvoke<AiConfigResponse>("get_ai_config", undefined, "ok");
    expect(aiConfig).toHaveProperty("model");
    expect(aiConfig).toHaveProperty("auto_route");

    await mockInvoke<boolean>("save_ai_config", {
      payload: {
        enabled: true,
        model: "anthropic/claude-3.5-haiku",
        smb_target: "/Volumes/home",
        rules: "Invoices to Finance",
        auto_route: true,
      },
    }, "ok");

    const updated = await mockInvoke<AiConfigResponse>("get_ai_config", undefined, "ok");
    expect(updated.enabled).toBe(true);
    expect(updated.model).toBe("anthropic/claude-3.5-haiku");

    const scan = await mockInvoke<NasTaxonomyScan>("scan_nas_directories", { path: "/Volumes/home" }, "ok");
    expect(scan.directories.length).toBeGreaterThan(0);
    expect(scan.directories).toContain("Finance/Invoices");

    const route = await mockInvoke<RouteDecision>("test_ai_routing", { samplePath: "invoice.pdf" }, "ok");
    expect(route.destination_folder).toBe("Finance/Invoices");
    expect(route.confidence).toBeGreaterThan(0.5);
  });
});
