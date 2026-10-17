import { describe, it, expect } from "bun:test";
import { describeStatus, friendlyError, type Overview } from "../src/lib/status";
import { relativeTime, splitPath } from "../src/lib/format";
import {
  renderPopover,
  renderPopoverList,
  renderConflictList,
  renderSettings,
  renderPopoverSettings,
  renderSetup,
  renderDesktopApp,
  renderDesktopLoadError,
  renderSmartRoutingView,
  renderRouteDecisionCard,
  friendlyReviewReason,
  renderRoutesSection,
  renderReviewQueueSection,
  shortPath,
  renderAccountPanel,
  renderGoogleButton,
  type AccountViewModel,
  accountDeviceRows,
  SETTINGS_TABS,
  modelOptionsHtml,
} from "../src/lib/views";
import { MIN_ACCOUNT_PASSWORD, deviceMeta, validateCreateAccount, validateNewPassword, validateSignIn } from "../src/lib/account";
import { categorizeFile } from "../src/lib/icons";
import { validateSetupStep, PROVIDERS, providerLabel, type SetupValues } from "../src/lib/setup";
import { changeKeyStore, keyStoreKind, resolveConflict, withBusy } from "../src/lib/actions";
import { captureFormState, restoreFormState, isFieldDirty, type FieldLike, type PanelLike } from "../src/lib/formstate";
import { mockInvoke, accountStatus, accountCreate, accountSignIn, accountGoogleSignIn, accountSignOut, accountDevices, accountRemoveDevice, accountChangePassword } from "../src/lib/ipc";
import type { AccountDevice, AccountStatus, ActivityItem, AiConfigResponse, RoutesOverview, RouteEditorState, ReviewItem, ConflictItem, NasTaxonomyScan, NasTransferRecord, RecentFile, RouteDecision, SyncActivity, VaultStatus } from "../src/lib/types";

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
    const html = renderPopover({ overview: base, recent, now: NOW, tab: "recent" });
    expect(html).toContain("Recently edited");
    expect(html).toContain("Q3 budget.xlsx");
    expect(html).toContain("Edited in Work");
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
    expect(html).not.toContain('id="popover-search"');
  });

  it("explains the empty recent list", () => {
    expect(renderPopover({ overview: base, recent: [], now: NOW })).toContain("will show up here");
    expect(renderPopover({ overview: base, recent: [], now: NOW, tab: "recent" })).toContain("will show up here");
  });

  it("escapes file names", () => {
    const html = renderPopover({
      overview: base,
      recent: [{ path: "<img src=x>.txt", name: "<img src=x>.txt", folder: "", modified_ms: NOW }],
      now: NOW,
      tab: "recent",
    });
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img");
  });

  const act = (over: Partial<ActivityItem>): ActivityItem => ({
    path: "Photos/IMG_1.jpeg",
    name: "IMG_1.jpeg",
    folder: "Photos",
    kind: "upload",
    status: "done",
    size: 4_400_000,
    started_ms: NOW - 3 * 60_000,
    finished_ms: NOW - 2 * 60_000,
    ...over,
  });

  it("shows files syncing right now with direction, size and a progress bar, like Dropbox", () => {
    const activity: SyncActivity = {
      active: [act({ status: "active", finished_ms: null }), act({ path: "Home/Lease.pdf", name: "Lease.pdf", folder: "Home", kind: "download", status: "active", size: 1_200_000, finished_ms: null })],
      recent: [act({})],
    };
    const html = renderPopover({ overview: { ...base, syncing: true, pending: 2 }, recent, activity, now: NOW });
    expect(html).toContain("Syncing now");
    expect(html).toContain('class="section-count">2<');
    expect(html).toContain("Uploading · 4.2 MB");
    expect(html).toContain("Downloading · 1.1 MB");
    expect(html.match(/class="act-progress"/g)?.length).toBe(2);
    expect(html).toContain("Earlier");
    expect(html).toContain("Uploaded to Photos · 2 min ago");
    expect(html).not.toMatch(DEV_DETAIL);
  });

  it("describes finished work in plain words, including drop-folder moves and failures", () => {
    const activity: SyncActivity = {
      active: [],
      recent: [
        act({ kind: "moved", path: "/Volumes/HomeNAS/Backups/Sites/site.tar.gz", name: "site.tar.gz", folder: "/Volumes/HomeNAS/Backups/Sites" }),
        act({ kind: "download", path: "Work/Plan.docx", name: "Plan.docx", folder: "Work" }),
        act({ kind: "delete_remote", path: "Old.pdf", name: "Old.pdf", folder: "", size: null }),
        act({ kind: "upload", status: "failed", path: "Scans/r.tiff", name: "r.tiff", folder: "Scans" }),
      ],
    };
    const html = renderPopover({ overview: base, recent, activity, now: NOW });
    expect(html).toContain("Recent activity");
    expect(html).toContain("Moved to Backups/Sites");
    expect(html).toContain("Downloaded to Work");
    expect(html).toContain("Deleted, removed from your other devices");
    expect(html).toContain("Upload failed, will retry");
    // Deleted files can't be opened or revealed.
    expect(html).toMatch(/data-path="Old\.pdf"[^>]*disabled/);
    expect(html).not.toContain('data-action="reveal-activity" data-path="Old.pdf"');
    expect(html).toContain('data-action="reveal-activity" data-path="/Volumes/HomeNAS/Backups/Sites/site.tar.gz"');
  });

  it("filters the list with the search box", () => {
    const activity: SyncActivity = { active: [], recent: [act({}), act({ path: "Work/Plan.docx", name: "Plan.docx", folder: "Work" })] };
    const list = renderPopoverList({ overview: base, recent, activity, now: NOW, query: "plan" });
    expect(list).toContain("Plan.docx");
    expect(list).not.toContain("IMG_1.jpeg");
    expect(renderPopoverList({ overview: base, recent, activity, now: NOW, query: "zzz" })).toContain('No files match "zzz"');
  });

  it("has a Dropbox-style header, tabs and a gear menu with Preferences and Quit", () => {
    const closed = renderPopover({ overview: base, recent, now: NOW });
    expect(closed).toContain('id="open-app-btn"');
    expect(closed).toContain('id="popover-search"');
    expect(closed).toMatch(/class="pop-tab active"[^>]*data-popover-tab="activity"/);
    expect(closed).not.toContain('id="popover-menu"');
    const open = renderPopover({ overview: base, recent, now: NOW, menuOpen: true });
    for (const id of ["menu-preferences", "menu-open-app", "menu-pause", "menu-quit"]) expect(open).toContain(`id="${id}"`);
    expect(open).toContain("Quit RenegadeBox");
    expect(open).toMatch(/id="settings-btn"[^>]*aria-expanded="true"/);
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
    expect(html).not.toContain('data-tab="ai"');
    expect(html).toContain('id="tab-panel-general"');
    expect(html).toContain('id="tab-panel-storage"');
    expect(html).toContain('id="tab-panel-security"');
    expect(html).toContain('id="tab-panel-ignored"');
    expect(html).not.toContain('id="tab-panel-ai"');
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

describe("file categorization", () => {
  it("categorizes file extensions accurately", () => {
    expect(categorizeFile("photo.png")).toBe("images");
    expect(categorizeFile("avatar.jpg")).toBe("images");
    expect(categorizeFile("main.rs")).toBe("code");
    expect(categorizeFile("app.tsx")).toBe("code");
    expect(categorizeFile("archive.zip")).toBe("archives");
    expect(categorizeFile("bundle.tar.gz")).toBe("archives");
    expect(categorizeFile("report.pdf")).toBe("documents");
    expect(categorizeFile("notes.txt")).toBe("documents");
  });
});

describe("desktop app layout and polish", () => {
  const sampleRecent: RecentFile[] = [
    { path: "Finance/Tax_Return.pdf", name: "Tax_Return.pdf", folder: "Finance", modified_ms: NOW - 60_000 },
    { path: "Photos/Family.jpg", name: "Family.jpg", folder: "Photos", modified_ms: NOW - 120_000 },
    { path: "src/main.rs", name: "main.rs", folder: "src", modified_ms: NOW - 180_000 },
    { path: "backup.zip", name: "backup.zip", folder: "", modified_ms: NOW - 240_000 },
  ];

  it("renders wide layout with search bar, keyboard badges, and category pills", () => {
    const html = renderDesktopApp({
      activeTab: "files",
      overview: base,
      recent: sampleRecent,
      conflicts: [],
      settings: { status, autostart: true, ignored: [] },
      theme: "dark",
      now: NOW,
    });

    expect(html).toContain('id="file-search-input"');
    expect(html).toContain("⌘F");
    expect(html).toContain("⌘1");
    expect(html).toContain("⌘2");
    expect(html).toContain("⌘3");
    expect(html).toContain("⌘4");
    expect(html).toContain("storage-meter-track");
    expect(html).toContain("data-action=\"copy-path\"");
    expect(html).toContain("Double-click to open");
    expect(html).toContain('data-cat="documents"');
    expect(html).toContain('data-cat="images"');
    expect(html).toContain('data-cat="code"');
    expect(html).toContain('data-cat="archives"');
  });

  it("filters files dynamically based on search query", () => {
    const html = renderDesktopApp({
      activeTab: "files",
      overview: base,
      recent: sampleRecent,
      conflicts: [],
      settings: { status, autostart: true, ignored: [] },
      theme: "light",
      searchQuery: "Tax",
      now: NOW,
    });

    expect(html).toContain("Tax_Return.pdf");
    expect(html).not.toContain("Family.jpg");
    expect(html).not.toContain("main.rs");
  });

  it("filters files by category pills", () => {
    const html = renderDesktopApp({
      activeTab: "files",
      overview: base,
      recent: sampleRecent,
      conflicts: [],
      settings: { status, autostart: true, ignored: [] },
      theme: "dark",
      activeCategory: "code",
      now: NOW,
    });

    expect(html).toContain("main.rs");
    expect(html).not.toContain("Tax_Return.pdf");
    expect(html).not.toContain("Family.jpg");
    expect(html).not.toContain("backup.zip");
  });

  it("shows pulsing storage bar when sync is active", () => {
    const html = renderDesktopApp({
      activeTab: "files",
      overview: { ...base, syncing: true, pending: 3 },
      recent: sampleRecent,
      conflicts: [],
      settings: { status: { ...status, total_bytes: 1024 * 1024 * 5 }, autostart: true, ignored: [] },
      theme: "system",
      now: NOW,
    });

    expect(html).toContain("storage-meter-fill pulsing");
  });

  it("has no notification switches that the app can't honor", () => {
    const html = renderSettings({ status, autostart: true, ignored: [] });
    expect(html).not.toContain("notify-conflicts-toggle");
    expect(html).not.toContain("notify-sync-toggle");
    expect(html).not.toContain("Alert on sync completion");
  });

  it("keeps the chosen settings sub-tab across re-renders", () => {
    for (const tab of ["general", "storage", "security", "ignored"] as const) {
      const html = renderDesktopApp({
        activeTab: "settings",
        overview: base,
        recent: [],
        conflicts: [],
        settings: { status, autostart: true, ignored: [] },
        settingsTab: tab,
        theme: "system",
        now: NOW,
      });
      expect(html).toMatch(new RegExp(`class="tab-btn active" data-tab="${tab}"`));
      expect(html).toMatch(new RegExp(`class="tab-panel active" data-panel="${tab}"`));
      expect((html.match(/class="tab-btn active"/g) ?? []).length).toBe(1);
    }
  });

  it("shows an error with Retry instead of made-up settings when the first load fails", () => {
    const html = renderDesktopLoadError("Your storage provider didn't accept your access keys.");
    expect(html).toContain('id="desktop-retry-btn"');
    expect(html).toContain("didn't accept your access keys");
    for (const invented of ["renegadebox-vault", "us-east-1", "System keychain"]) expect(html).not.toContain(invented);
  });
});

describe("smart routing and NAS organization", () => {
  const sampleRules = [
    "Invoices and receipts go to Finance/Invoices",
    "Tax returns (W-2, 1099) go to Finance/Taxes",
    "Photos and camera media go to Media/Photos",
  ];

  it("renders smart routing dashboard with NAS target and discovered folders", () => {
    const html = renderSmartRoutingView({
      aiConfig: {
        enabled: true,
        model: "google/gemini-2.0-flash-001",
        smb_target: "/Volumes/home",
        rules: sampleRules.join("\n"),
        auto_route: true,
        has_api_key: true,
      },
      rules: sampleRules,
      discoveredDirs: ["Finance/Invoices", "Finance/Taxes", "Media/Photos", "Work/Projects"],
    });

    expect(html).toContain("Destination Folder");
    expect(html).toContain("/Volumes/home");
    expect(html).toContain("Scan Folders &amp; Suggest Rules");
    expect(html).toContain("4 Folders Discovered");
    expect(html).toContain("Finance/Invoices");
    expect(html).toContain("Explain Your Organization");
    expect(html).toContain("Translate to Rules");
    expect(html).toContain("Active Rules");
    expect(html).toContain("Finance/Taxes");
    expect(html).toContain("Drop a file here to inspect routing");
    expect(html).toContain("AI Engine &amp; Model Provider Settings");
    expect(html).toContain("How the AI is used:");
    expect(html).toContain("What is sent to the AI:");
    expect(html).not.toContain("Synology NAS");
    expect(html).toContain("OpenRouter");
    expect(html).toContain('data-role-select="webdev"');
    expect(html).toContain('data-role-select="agency"');
    expect(html).toContain("SpinupWP");
    expect(html).toContain("WP Engine");
    expect(html).toContain("Pressable");
  });

  it("renders agency role with invoice and contract presets", () => {
    const html = renderSmartRoutingView({
      activeRole: "agency",
      rules: [],
      discoveredDirs: [],
    });

    expect(html).toContain("Freelance &amp; Agency");
    expect(html).toContain("+ Invoices");
    expect(html).toContain("+ Contracts");
    expect(html).toContain("+ Taxes");
  });

  it("renders xAI Grok provider and models when configured", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      aiConfig: {
        enabled: true,
        provider: "xai",
        model: "grok-4.20-non-reasoning",
        smb_target: "/Volumes/home",
        rules: "",
        auto_route: false,
        has_api_key: true,
        has_grok_key: true,
        has_openrouter_key: false,
      },
    });

    expect(html).toContain('<option value="xai" selected>Grok, with your own xAI key (recommended)</option>');
    expect(html).toContain('<option value="grok-4.20-non-reasoning" selected>');
    expect(html).toContain("grok-build-0.1");
    expect(html).not.toContain("grok-2-mini");
    expect(html).toContain("routing-grok-key-input");
    // Plain steps for getting your own key, and the data-sharing trade-off.
    expect(html).toContain("Get your own Grok key");
    expect(html).toContain("console.x.ai");
    expect(html).toContain("Create API Key");
    expect(html).toContain("data sharing");
  });

  it("offers Grok only through your own xAI key, never through OpenRouter", () => {
    const html = renderSmartRoutingView({ aiConfig: { enabled: true, provider: "openrouter", model: "", smb_target: "/Volumes/home", rules: "", auto_route: false, has_api_key: true } });
    expect(html).not.toContain("x-ai/grok");
    expect(html).not.toContain("via OpenRouter");
    expect(html).not.toContain("TypeWhisper");
    expect(html).not.toContain("Keychain service");
    expect(modelOptionsHtml("openrouter")).not.toContain("grok");
    expect(modelOptionsHtml("xai")).not.toMatch(/value="[^"]*\//);
  });

  it("puts Grok first and picks it when nothing is configured", () => {
    const html = renderSmartRoutingView({ aiConfig: null });
    expect(html.indexOf('value="xai"')).toBeLessThan(html.indexOf('value="openrouter"'));
    expect(html).toContain('<option value="xai" selected>');
    // A saved model from the other provider falls back to this provider's first model.
    expect(modelOptionsHtml("xai", "google/gemini-2.5-flash-lite")).toContain('<option value="grok-4.20-non-reasoning" selected>');
    expect(modelOptionsHtml("xai", "grok-4.3")).toContain('<option value="grok-4.3" selected>');
  });

  it("defaults OpenRouter to a current model, not a retired one", () => {
    const html = renderSmartRoutingView({ aiConfig: { enabled: true, provider: "openrouter", model: "", smb_target: "/Volumes/home", rules: "", auto_route: false, has_api_key: true } });
    expect(html).toContain('<option value="google/gemini-2.5-flash-lite" selected>');
    expect(html).not.toContain("gemini-2.0-flash");
  });

  it("renders top-level AI cost quick bar with provider and live metrics", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      aiConfig: { enabled: true, provider: "openrouter", model: "google/gemini-2.0-flash-001", smb_target: "/Volumes/home", rules: "", auto_route: false, has_api_key: true },
      aiUsage: {
        totalCostUsd: 0.0425,
        totalTokens: 12500,
        totalPromptTokens: 10000,
        totalCompletionTokens: 2500,
        totalRequests: 8,
        byOperation: [],
        byModel: [],
        recentEntries: [],
      },
    });

    expect(html).toContain("AI usage");
    expect(html).not.toContain("AI Engine Activity");
    expect(html).toContain("$0.0425");
    expect(html).toContain("12,500");
    expect(html).toContain("8");
    expect(html).toContain("routing-jump-ledger-btn");
  });

  it("paginates large rules lists and filters rules via search query", () => {
    // Generate 100 sample rules to test pagination
    const testRules = Array.from({ length: 100 }, (_, i) => `*.ext${i} files go to Folder${i}`);
    
    // Page 1 should show first 15 rules and pagination controls
    const htmlPage1 = renderSmartRoutingView({
      activeRole: "webdev",
      rules: testRules,
      rulesPage: 1,
    });

    expect(htmlPage1).toContain("rules-pagination-bar");
    expect(htmlPage1).toContain("Page 1 of 7");
    expect(htmlPage1).toContain("Showing <strong>1–15</strong> of <strong>100</strong> rules");
    expect(htmlPage1).toContain("*.ext0 files");
    expect(htmlPage1).toContain("*.ext14 files");
    expect(htmlPage1).not.toContain("*.ext15 files"); // Sliced off from page 1

    // Search filter should narrow results
    const htmlSearch = renderSmartRoutingView({
      activeRole: "webdev",
      rules: testRules,
      rulesSearch: "ext42",
    });

    expect(htmlSearch).toContain("*.ext42 files");
    expect(htmlSearch).not.toContain("*.ext0 files");
  });

  it("renders detected hosting drive banner when available", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      aiConfig: { enabled: true, model: "google/gemini-2.0-flash-001", smb_target: "/Volumes/home", rules: "", auto_route: false, has_api_key: false },
      detectedVolume: "/Volumes/HomeNAS/Website Backups",
    });

    expect(html).toContain("Detected Hosting Volume");
    expect(html).toContain("/Volumes/HomeNAS/Website Backups");
    expect(html).toContain("Set as Destination");
  });

  it("renders route decision card with confidence, destination pill, and explanation", () => {
    const decision: RouteDecision = {
      destination_folder: "Finance/Invoices",
      suggested_filename: "Invoice_ACME_Oct2026.pdf",
      confidence: 0.94,
      explanation: "Contains invoice number and payment breakdown matching Finance/Invoices.",
    };

    const html = renderRouteDecisionCard(decision);

    expect(html).toContain("decision-card");
    expect(html).toContain("Invoice_ACME_Oct2026.pdf");
    expect(html).toContain("94% Confidence");
    expect(html).toContain("Finance/Invoices");
    expect(html).toContain("Contains invoice number and payment breakdown");
  });

  it("renders smart routing view inside desktop app when routing tab is active", () => {
    const html = renderDesktopApp({
      activeTab: "routing",
      overview: base,
      recent: [],
      conflicts: [],
      settings: { status, autostart: true, ignored: [] },
      theme: "dark",
      now: NOW,
      aiConfig: {
        enabled: true,
        model: "google/gemini-2.0-flash-001",
        smb_target: "/Volumes/home",
        rules: sampleRules.join("\n"),
        auto_route: false,
        has_api_key: true,
      },
      smartRules: sampleRules,
      discoveredDirs: ["Finance/Invoices"],
    });

    expect(html).toContain("Smart Routing");
    expect(html).toContain("Destination Folder");
    expect(html).toContain("Rules-first file routing to any destination folder");
    expect(html).toContain("Active Rules");
    expect(html).toContain("routing-drop-zone");
  });

  it("supports multi-role enable/disable toggles and per-role rules count", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev", "agency"],
      roleRules: {
        webdev: ["*.sql.gz go to Backups/Databases", "Pressable backups go to Backups/Pressable"],
        agency: ["Invoices go to Finance/Invoices"],
        creative: ["RAW footage go to Studio/Footage"],
        personal: ["Family photos go to Archive/Photos"],
      },
      discoveredDirs: [],
    });

    // Check switches exist for all roles
    expect(html).toContain('data-role-toggle="webdev"');
    expect(html).toContain('data-role-toggle="agency"');
    expect(html).toContain('data-role-toggle="creative"');
    expect(html).toContain('data-role-toggle="personal"');

    // Both webdev and agency are enabled
    expect(html).toContain("Active (2 rules)");
    expect(html).toContain("Active (1 rules)");
    expect(html).toContain("Turned Off");

    // Global summary across enabled roles
    expect(html).toContain("3 total rules active");
    expect(html).toContain("across 2 enabled roles");
  });

  it("renders AI Optimize & Verify box when verification result is provided", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev"],
      aiVerification: {
        originalInput: "put all spinup wp stuff in hosting folder",
        optimizedRule: "SpinupWP backups go to Hosting/SpinupWP",
        matchedDestination: "Hosting/SpinupWP",
        confidence: 0.97,
        sampleTestFile: "spinup-backup-db.sql.gz",
      },
      discoveredDirs: [],
    });

    expect(html).toContain("AI Verified &amp; Formatted");
    expect(html).toContain("97% confidence");
    expect(html).toContain("Hosting/SpinupWP");
    expect(html).toContain("spinup-backup-db.sql.gz");
    expect(html).toContain("routing-apply-verified-btn");
    expect(html).toContain("routing-dismiss-verified-btn");
  });

  it("renders inline rule editing form when editingRuleIndex is specified", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev"],
      editingRuleIndex: 0,
      roleRules: {
        webdev: ["Pressable backups go to Backups/Pressable"],
        agency: [],
        creative: [],
        personal: [],
      },
      discoveredDirs: [],
    });

    expect(html).toContain('class="rule-card editing"');
    expect(html).toContain('id="rule-edit-input-0"');
    expect(html).toContain("AI Refine");
    expect(html).toContain("Save Rule");
    expect(html).toContain("Cancel");
  });

  it("renders AI API Usage & Cost Analytics with operation breakdown and ledger", () => {
    const customUsage = {
      totalRequests: 42,
      totalPromptTokens: 25000,
      totalCompletionTokens: 8000,
      totalTokens: 33000,
      totalCostUsd: 0.0084,
      byOperation: [
        {
          operation: "rule_translation",
          label: "Rule Optimization & Verify",
          requests: 22,
          totalTokens: 18000,
          estimatedCostUsd: 0.0048,
          percentageOfTotal: 54.5,
        },
        {
          operation: "suggest_rules",
          label: "NAS Taxonomy Scan",
          requests: 12,
          totalTokens: 10000,
          estimatedCostUsd: 0.0024,
          percentageOfTotal: 30.3,
        },
        {
          operation: "file_routing",
          label: "Live File Auto-Routing",
          requests: 8,
          totalTokens: 5000,
          estimatedCostUsd: 0.0012,
          percentageOfTotal: 15.2,
        },
      ],
      byModel: [
        {
          model: "google/gemini-2.0-flash-001",
          requests: 42,
          totalTokens: 33000,
          estimatedCostUsd: 0.0084,
          percentageOfTotal: 100.0,
        },
      ],
      recentEntries: [
        {
          id: "req-test-1",
          timestamp: Date.now() - 30000,
          operation: "rule_translation",
          operationLabel: "Rule Optimization",
          model: "google/gemini-2.0-flash-001",
          promptTokens: 400,
          completionTokens: 120,
          totalTokens: 520,
          estimatedCostUsd: 0.000095,
          summary: "Optimized Pressable backups rule",
        },
      ],
    };

    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev"],
      aiUsage: customUsage,
    });

    // Check header and controls
    expect(html).toContain("AI API Usage &amp; Cost Analytics");
    expect(html).toContain("Live Ledger");
    expect(html).toContain("ai-usage-clear-btn");
    expect(html).toContain("ai-usage-refresh-btn");

    // Check top level metrics
    expect(html).toContain("$0.0084 USD");
    expect(html).toContain("33,000");
    expect(html).toContain("42");

    // Check API Operation Breakdown (separate breakdown so user knows which API uses more)
    expect(html).toContain("API Operation Breakdown");
    expect(html).toContain("Comparing token volume and cost across individual AI capabilities");
    expect(html).toContain("Rule Optimization &amp; Verify");
    expect(html).toContain("54.5%");
    expect(html).toContain("NAS Taxonomy Scan");
    expect(html).toContain("30.3%");
    expect(html).toContain("Live File Auto-Routing");
    expect(html).toContain("15.2%");

    // Check model chips
    expect(html).toContain("google/gemini-2.0-flash-001");

    // Check ledger table
    expect(html).toContain("ledger-table");
    expect(html).toContain("Optimized Pressable backups rule");
    expect(html).toContain("520");
  });

  it("renders NAS Local Staging Ingest drop folder and controls", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev"],
      aiConfig: {
        enabled: true,
        model: "openai/gpt-4o-mini",
        smb_target: "/Volumes/home",
        nas_ingest_folder: "/Users/me/RenegadeBox/To NAS",
        rules: null,
        auto_route: true,
        has_api_key: true,
      },
      nasStagingStatus: {
        ingest_folder: "/Users/me/RenegadeBox/To NAS",
        pending_count: 2,
        pending_files: ["pressable_backup.sql.gz", "spinupwp_archive.tar.gz"],
        nas_accessible: true,
        smb_target: "/Volumes/home",
      },
    });

    expect(html).toContain("Drop Folder");
    expect(html).toContain("Rules are checked first");
    expect(html).toContain("_Needs Review");
    expect(html).toContain("/Users/me/RenegadeBox/To NAS");
    expect(html).toContain("nas-open-staging-btn");
    expect(html).toContain("nas-change-staging-btn");
    expect(html).toContain("nas-process-now-btn");
    expect(html).toContain("2 waiting");
  });

  it("defaults dropped files to moving into the destination folder, with auto-processing on", () => {
    const html = renderSmartRoutingView({
      aiConfig: { enabled: true, model: "", smb_target: "/Volumes/home", rules: null, auto_route: true, has_api_key: true },
      nasStagingStatus: { ingest_folder: "/x/To NAS", pending_count: 0, pending_files: [], nas_accessible: true, smb_target: "/Volumes/home" },
    });
    expect(html).toMatch(/id="routing-mode-move" class="mode-option active"/);
    expect(html).not.toMatch(/id="routing-mode-organize" class="mode-option active"/);
    expect(html).toContain("moved to /Volumes/home");
    expect(html).toMatch(/id="drop-auto-toggle"[^>]*checked/);
    expect(html).not.toContain("Destination not reachable");
  });

  it("offers keeping sorted files inside the drop folder", () => {
    const html = renderSmartRoutingView({
      aiConfig: { enabled: true, model: "", smb_target: "/Volumes/home", rules: null, auto_route: false, routing_mode: "organize", has_api_key: true },
      nasStagingStatus: { ingest_folder: "/x/To NAS", pending_count: 0, pending_files: [], nas_accessible: false, smb_target: "/Volumes/home" },
    });
    expect(html).toMatch(/id="routing-mode-organize" class="mode-option active"/);
    expect(html).toContain("inside this drop folder");
    expect(html).not.toContain("Destination not reachable");
    expect(html).not.toMatch(/id="drop-auto-toggle"[^>]*checked/);
  });

  it("warns when the destination is not mounted in move mode", () => {
    const html = renderSmartRoutingView({
      aiConfig: { enabled: true, model: "", smb_target: "/Volumes/home", rules: null, auto_route: true, has_api_key: true },
      nasStagingStatus: { ingest_folder: "/x/To NAS", pending_count: 1, pending_files: ["a.zip"], nas_accessible: false, smb_target: "/Volumes/home" },
    });
    expect(html).toContain("Destination not reachable");
  });

  it("renders NAS Transfer History & Relocation Log with move and revert actions", () => {
    const sampleTransfers: NasTransferRecord[] = [
      {
        id: "nas-tx-100",
        timestamp: NOW - 60_000,
        filename: "client-backup-2026-10-15.tar.gz",
        source_path: "/Users/me/RenegadeBox/To NAS/client-backup-2026-10-15.tar.gz",
        destination_path: "/Volumes/home/Websites/Backups/Pressable/client-backup-2026-10-15.tar.gz",
        destination_folder: "Websites/Backups/Pressable",
        rule_matched: "Pressable Backups",
        file_size_bytes: 104857600,
        status: "completed",
      },
      {
        id: "nas-tx-101",
        timestamp: NOW - 120_000,
        filename: "unexpected_dump.sql",
        source_path: "/Users/me/RenegadeBox/To NAS/unexpected_dump.sql",
        destination_path: "/Volumes/home/Misc/unexpected_dump.sql",
        destination_folder: "Misc",
        rule_matched: "Catch-All",
        file_size_bytes: 20971520,
        status: "relocated",
      },
    ];

    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev"],
      nasTransfers: sampleTransfers,
    });

    // Check section header and actions
    expect(html).toContain("Transfer history");
    expect(html).not.toContain("Relocation Log");
    expect(html).toContain("nas-refresh-transfers-btn");
    expect(html).toContain("nas-clear-transfers-btn");

    // Check files rendered in table
    expect(html).toContain("client-backup-2026-10-15.tar.gz");
    expect(html).toContain("unexpected_dump.sql");
    expect(html).toContain("Pressable Backups");
    expect(html).toContain("Websites/Backups/Pressable");
    expect(html).toContain("Moved");
    expect(html).toContain("Relocated");

    // Check interactive buttons
    expect(html).toContain('data-reveal-nas-path="/Volumes/home/Websites/Backups/Pressable/client-backup-2026-10-15.tar.gz"');
    expect(html).toContain('data-relocate-id="nas-tx-100"');
    expect(html).toContain('data-revert-id="nas-tx-100"');
  });

  it("hides Move To for files routed into the vault", () => {
    const html = renderSmartRoutingView({
      nasTransfers: [
        {
          id: "vault-tx-1",
          timestamp: NOW,
          filename: "beach.jpg",
          source_path: "/x/beach.jpg",
          destination_path: "/Users/me/RenegadeBox/Family Photos/beach.jpg",
          destination_folder: "vault:Family Photos",
          rule_matched: "Family photos go to vault:Family Photos",
          file_size_bytes: 1000,
          status: "completed",
        },
      ],
    });
    expect(html).toContain('data-revert-id="vault-tx-1"');
    expect(html).not.toContain('data-relocate-id="vault-tx-1"');
  });

  it("shows no fake usage or transfer data when nothing has been recorded", () => {
    const html = renderSmartRoutingView({ aiUsage: null, nasTransfers: [] });
    expect(html).toContain("No API activity recorded yet.");
    expect(html).toContain("No files moved yet.");
    expect(html).not.toContain("tx-sample");
    expect(html).not.toContain("backup_lamp_production_spinup");
    expect(html).toContain("$0.0000 USD");
  });

  it("labels provider-reported vs estimated costs and excluded legacy entries", () => {
    const html = renderSmartRoutingView({
      aiUsage: {
        totalRequests: 3,
        totalPromptTokens: 3000,
        totalCompletionTokens: 300,
        totalTokens: 3300,
        totalCostUsd: 0.0006,
        providerReportedRequests: 2,
        estimatedRequests: 1,
        legacyExcluded: 4,
        byOperation: [],
        byModel: [],
        recentEntries: [
          { id: "a", timestamp: NOW, operation: "file_routing", operationLabel: "Live File Routing", model: "google/gemini-2.5-flash-lite", promptTokens: 1000, completionTokens: 100, totalTokens: 1100, estimatedCostUsd: 0.0002, summary: "provider row", costSource: "provider" },
          { id: "b", timestamp: NOW, operation: "file_routing", operationLabel: "Live File Routing", model: "grok-4.20-non-reasoning", promptTokens: 1000, completionTokens: 100, totalTokens: 1100, estimatedCostUsd: 0.0015, summary: "estimated row", costSource: "estimate" },
        ],
      },
    });
    expect(html).toContain("Total Cost (provider-reported + estimated)");
    expect(html).toContain("2 of 3 costs reported by the provider");
    expect(html).toContain("4 older placeholder entries are excluded");
    expect(html).toContain("$0.0015 est.");
  });

  it("renders the review queue and AI rule suggestions", () => {
    const html = renderSmartRoutingView({
      reviewQueue: [
        { id: "rv1", timestamp: NOW, filename: "scan_0042.tiff", path: "/d/_Needs Review/scan_0042.tiff", suggested_folder: "Media/Scans", confidence: 0.55, reason: "low_confidence", explanation: "unclear", file_size_bytes: 1000 },
      ],
      ruleSuggestions: [
        { id: "sg1", timestamp: NOW, rule: "*.blend go to Design/3D Models", example_file: "chair.blend", destination: "Design/3D Models" },
      ],
    });
    expect(html).toContain("scan_0042.tiff");
    expect(html).toContain('id="review-folder-rv1"');
    expect(html).toContain('data-review-id="rv1"');
    expect(html).toContain("*.blend go to Design/3D Models");
    expect(html).toContain('data-suggestion-id="sg1"');
  });

  it("shows review reasons in plain words without raw paths or OS error codes", () => {
    const raw = "Move failed: source kept at /Users/me/RenegadeBox/To NAS/a.sql.gz: copying to /Volumes/HomeNAS/Backups/.a.sql.gz.rbox-partial: Permission denied (os error 13)";
    expect(friendlyReviewReason(raw)).toBe("Copy to the destination was refused (permission denied)");
    const html = renderSmartRoutingView({
      reviewQueue: [{ id: "rv9", timestamp: NOW, filename: "a.sql.gz", path: "/d/a.sql.gz", suggested_folder: "Backups", confidence: null, reason: raw, explanation: null, file_size_bytes: 10 }],
    });
    expect(html).toContain("Copy to the destination was refused");
    expect(html).not.toContain("<table class=\"ledger-table\">\n          <thead><tr><th>File</th><th>Why</th>");
    expect(html).toContain('class="review-list"');
  });

  it("renders a local rule check instead of a fake AI confidence", () => {
    const html = renderSmartRoutingView({
      ruleCheck: {
        rule: "*.blend go to Design/3D Models",
        parses: true,
        trigger: "*.blend",
        destination: "Design/3D Models",
        is_vault: false,
        vault_enabled: false,
        destination_safe: true,
        destination_exists: false,
        sample_file: "example.blend",
        sample_matches: true,
        shadowed_by: "files go to Unsorted",
        problems: [],
      },
      ruleCheckCanApply: true,
    });
    expect(html).toContain("*.blend go to Design/3D Models");
    expect(html).toContain("files go to Unsorted");
    expect(html).toContain("routing-apply-verified-btn");
    expect(html).not.toContain("98% Accuracy");
  });

  it("never shows an invented confidence score", () => {
    const html = renderSmartRoutingView({
      activeRole: "webdev",
      enabledRoles: ["webdev"],
      aiVerification: { originalInput: "x", optimizedRule: "*.zip go to Backups", matchedDestination: "Backups", confidence: 0, sampleTestFile: null },
      discoveredDirs: [],
    } as any);
    expect(html).toContain("AI Verified &amp; Formatted");
    expect(html).not.toContain("ai-confidence-badge");
  });

  it("shows vault opt-in controls and the undo button when snapshots exist", () => {
    const html = renderSmartRoutingView({
      aiConfig: { enabled: true, model: "", smb_target: "/Volumes/home", rules: "", auto_route: false, has_api_key: false, vault_routing_enabled: true, vault_max_file_mb: 250, rules_backup_count: 2 },
    });
    expect(html).toContain('id="routing-vault-toggle" class="switch" type="checkbox" role="switch" checked');
    expect(html).toContain('value="250"');
    expect(html).toContain("the AI never chooses the vault");
    expect(html).toContain('id="rules-undo-btn"');
  });

  it("offers a Needs Review folder toggle and Move all for waiting files", () => {
    const review = [1, 2].map((n) => ({
      id: `rv-${n}`, timestamp: 0, filename: `backup-${n}.sql.gz`, path: `/drop/backup-${n}.sql.gz`,
      suggested_folder: "Backups From Spinup", confidence: null, reason: "Move failed", explanation: null, file_size_bytes: 10,
    }));
    const on = renderSmartRoutingView({
      aiConfig: { enabled: true, model: "", smb_target: "/Volumes/home", rules: "", auto_route: true, has_api_key: true },
      reviewQueue: review,
    });
    expect(on).toContain('id="review-folder-toggle" class="switch" type="checkbox" role="switch" checked');
    expect(on).toContain("Move all (2)");
    expect(on).toContain("inside your drop folder");
    const off = renderSmartRoutingView({
      aiConfig: { enabled: true, model: "", smb_target: "/Volumes/home", rules: "", auto_route: true, has_api_key: true, use_review_folder: false },
      reviewQueue: review,
    });
    expect(off).not.toContain('id="review-folder-toggle" class="switch" type="checkbox" role="switch" checked');
    expect(off).toContain("still in your drop folder");
    expect(off).toContain("stays in the drop folder");
  });
});



describe("multiple routes", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;
  const overview = (): Promise<RoutesOverview> => mockInvoke<RoutesOverview>("get_routes", undefined, "ok");

  it("lists every route as a clickable row with no edit or delete buttons in the list", async () => {
    const ov = await overview();
    const html = renderRoutesSection(ov);
    expect(html).toContain('id="routes-card"');
    expect(html).toContain('id="route-new-btn"');
    expect(html.indexOf("To NAS")).toBeLessThan(html.indexOf("Photography"));
    expect(html).toContain('data-route-open="main"');
    expect(html).toContain('data-route-open="photography"');
    expect(html).not.toContain("Set up below");
    expect(html).not.toContain("data-route-edit");
    expect(html).not.toContain("data-route-delete");
    // The main route cannot be turned off from the list; others can.
    expect(html).not.toContain('data-route-enable="main"');
    expect(html).toContain('data-route-enable="photography"');
    expect(html).toContain("Copy, keep originals");
    // Unplugged destination: the route waits and Sort now is off.
    expect(html).toContain("Waiting for destination");
    expect(html).toMatch(/data-route-run="photography"[^>]*disabled/);
    // No route is singled out, and automatic routes say how often they run.
    expect(html).not.toContain("route-tag");
    expect(html).not.toContain("Run now");
    expect(html).toContain("Checks for new files every 15 seconds");
    expect(html).toMatch(/class="btn tiny subtle route-run-btn"[^>]*data-route-run="main"[^>]*title="This route already checks every 15 seconds/);
    expect(html).not.toMatch(DEV_DETAIL);
    expect(html).not.toMatch(EMOJI);
  });

  it("home shows the cost, the routes and AI settings, but not the main route's setup", async () => {
    const ov = await overview();
    const html = renderSmartRoutingView({ routesOverview: ov });
    expect(html).toContain('data-routing-page="home"');
    expect(html).toContain("ai-quick-cost-strip");
    expect(html).toContain('id="routes-card"');
    expect(html).toContain("routing-config-card");
    expect(html).not.toContain("routing-role-card");
    expect(html).not.toContain('id="nas-process-now-btn"');
    expect(html).not.toContain("routing-drop-zone");
    expect(html).not.toContain('id="ai-usage-ledger-card"');
    expect(html).not.toContain('id="route-back-btn"');
    expect(html).toContain('aria-expanded="false"');

    const withLedger = renderSmartRoutingView({ routesOverview: ov, showRoutingLedger: true });
    expect(withLedger).toContain('id="ai-usage-ledger-card"');
    expect(withLedger).toContain("Hide Ledger");

    // Without route data from the engine, everything stays on one page as before.
    const single = renderSmartRoutingView({});
    expect(single).toContain('data-routing-page="single"');
    expect(single).toContain("routing-role-card");
    expect(single).toContain('id="ai-usage-ledger-card"');
  });

  it("the main route page has its setup, a way back, and only its own review items", async () => {
    const ov = await overview();
    const item: ReviewItem = {
      id: "rv-main",
      timestamp: 0,
      filename: "invoice-main.pdf",
      path: "/Users/x/RenegadeBox/To NAS/invoice-main.pdf",
      suggested_folder: null,
      confidence: null,
      reason: "No rule matched and AI routing is turned off",
      explanation: null,
      file_size_bytes: 1000,
      route_id: null,
    };
    const photo = { ...item, id: "rv-photo", filename: "IMG_0042.CR3", path: "/Users/x/Photo Inbox/IMG_0042.CR3", route_id: "photography" };
    const html = renderSmartRoutingView({ routesOverview: ov, selectedRouteId: "main", reviewQueue: [item, photo] });
    expect(html).toContain('data-routing-page="main"');
    expect(html).toContain('id="route-back-btn"');
    expect(html).toContain("routing-role-card");
    expect(html).toContain('id="nas-process-now-btn"');
    // One Sort now button on this page: the one on the drop folder card.
    expect(html).not.toContain("data-route-run");
    expect(html).toContain("Sort now");
    expect(html).toContain("invoice-main.pdf");
    expect(html).not.toContain("IMG_0042.CR3");
    expect(html).not.toContain('id="routes-card"');
    expect(html).not.toContain("routing-config-card");

    // A route's own page: settings, Delete, and its own review items.
    const ed: RouteEditorState = { draft: JSON.parse(JSON.stringify(ov.routes[1]!.config)), isNew: false };
    const page = renderSmartRoutingView({ routesOverview: ov, routeEditor: ed, selectedRouteId: "photography", reviewQueue: [item, photo] });
    expect(page).toContain('data-routing-page="editor"');
    expect(page).toContain('id="route-back-btn"');
    expect(page).toContain('id="route-editor"');
    expect(page).toContain('data-route-delete="photography"');
    expect(page).toContain("IMG_0042.CR3");
    expect(page).not.toContain("invoice-main.pdf");
    expect(page).not.toContain("routing-role-card");
    expect(page).not.toContain('id="routes-card"');
    expect(page).not.toMatch(EMOJI);
  });

  it("editor offers templates for new routes and hides the destination in organize mode", async () => {
    const ov = await overview();
    const draft = { ...ov.routes[1]!.config, id: "", name: "", template: "photography" };
    const ed: RouteEditorState = { draft, isNew: true };
    const html = renderSmartRoutingView({ routesOverview: ov, routeEditor: ed });
    expect(html).toContain('id="route-editor"');
    expect(html).toContain('data-route-template="photography"');
    expect(html).toContain('data-route-template="blank"');
    expect(html).toContain('id="route-destination"');
    expect(html).toContain("{source_folder}");
    expect(html).not.toContain('id="route-new-btn"');
    // New routes have nothing to delete yet.
    expect(html).not.toContain("data-route-delete");
    // Copy routes never move originals into a review folder.
    expect(html).toMatch(/id="route-review-folder"[^>]*disabled/);

    const organize = renderSmartRoutingView({ routesOverview: ov, routeEditor: { draft: { ...draft, mode: "organize" }, isNew: false, error: "Choose a source folder." } });
    expect(organize).not.toContain('id="route-destination"');
    expect(organize).not.toContain("data-route-template");
    expect(organize).toContain("Choose a source folder.");
    expect(organize).not.toMatch(EMOJI);
  });

  it("the mock save validates input", async () => {
    const ov = await overview();
    await expect(mockInvoke("save_route", { route: { ...ov.routes[1]!.config, id: "", name: " " } }, "ok")).rejects.toThrow("name");
    const saved = await mockInvoke<{ id: string }>("save_route", { route: { ...ov.routes[1]!.config, id: "", name: "Client Work" } }, "ok");
    expect(saved.id).toBe("client-work");
    await mockInvoke("delete_route", { routeId: "client-work" }, "ok");
    expect((await overview()).routes.some((r) => r.config.id === "client-work")).toBe(false);
  });

  it("review rows name the route a file came from", () => {
    const item: ReviewItem = {
      id: "rv-1",
      timestamp: 0,
      filename: "IMG_0001.CR3",
      path: "/Users/x/Photo Inbox/IMG_0001.CR3",
      suggested_folder: null,
      confidence: null,
      reason: "No rule matched and AI routing is turned off",
      explanation: null,
      file_size_bytes: 1000,
      route_id: "photography",
    };
    expect(renderReviewQueueSection([item], true, { photography: "Photography" })).toContain("Photography");
    expect(renderReviewQueueSection([{ ...item, route_id: "gone" }], true, {})).toContain("Deleted route");
    expect(shortPath("/Users/me/Photo Inbox")).toBe("~/Photo Inbox");
  });
});

describe("background refreshes keep in-progress input", () => {
  // Minimal stand-ins for DOM fields: enough for the capture/restore logic.
  const field = (id: string, value: string, defaultValue = value, extra: Partial<FieldLike> = {}): FieldLike => ({ id, tagName: "INPUT", type: "text", value, defaultValue, ...extra });

  it("only captures fields the person changed or is typing in", () => {
    const key = field("routing-api-key-input", "sk-or-123", "", { type: "password" });
    const untouched = field("device-name-input", "My-MBP");
    const focused = field("rules-search-input", "zip", "zip", { selectionStart: 2, selectionEnd: 3 });
    const state = captureFormState([key, untouched, focused], focused);
    expect(state.fields.map((f) => f.id)).toEqual(["routing-api-key-input", "rules-search-input"]);
    expect(state.fields[1]).toMatchObject({ focused: true, dirty: false, selectionStart: 2, selectionEnd: 3 });
  });

  it("puts typed values, focus and caret back after the re-render", () => {
    const before = [
      field("routing-api-key-input", "sk-or-123", "", { type: "password" }),
      { id: "routing-explainer-input", tagName: "TEXTAREA", value: "zip files go to Backups", defaultValue: "" } as FieldLike,
      field("review-folder-abc", "Clients/Acme", ""),
    ];
    const explainer = before[1]!;
    explainer.selectionStart = 4;
    explainer.selectionEnd = 4;
    const state = captureFormState(before, explainer);

    // Fresh render: server values, nothing typed.
    let focusedId = "";
    let caret: number[] = [];
    const after: Record<string, FieldLike> = {
      "routing-api-key-input": field("routing-api-key-input", "", "", { type: "password" }),
      "routing-explainer-input": {
        id: "routing-explainer-input",
        tagName: "TEXTAREA",
        value: "",
        defaultValue: "",
        focus: () => (focusedId = "routing-explainer-input"),
        setSelectionRange: (a, b) => (caret = [a, b]),
      },
      "review-folder-abc": field("review-folder-abc", "", ""),
    };
    restoreFormState(state, (id) => after[id] ?? null);

    expect(after["routing-api-key-input"]!.value).toBe("sk-or-123");
    expect(after["routing-explainer-input"]!.value).toBe("zip files go to Backups");
    expect(after["review-folder-abc"]!.value).toBe("Clients/Acme");
    expect(focusedId).toBe("routing-explainer-input");
    expect(caret).toEqual([4, 4]);
  });

  it("keeps changed checkboxes, radios and selects, and open confirm boxes", () => {
    const radioFile = field("key-store-file", "file", "file", { type: "radio", checked: true, defaultChecked: false });
    const select = { id: "routing-model-select", tagName: "SELECT", value: "openai/gpt-4o-mini", options: [{ selected: false, defaultSelected: true }, { selected: true, defaultSelected: false }] } as FieldLike;
    expect(isFieldDirty(radioFile)).toBe(true);
    expect(isFieldDirty(select)).toBe(true);
    const confirm: PanelLike = { id: "key-store-confirm", hidden: false };
    const state = captureFormState([radioFile, select], null, [confirm, { id: "other", hidden: true }]);
    expect(state.openPanels).toEqual(["key-store-confirm"]);

    const freshRadio = field("key-store-file", "file", "file", { type: "radio", checked: false, defaultChecked: false });
    const freshSelect = { ...select, value: "google/gemini-2.5-flash-lite" } as FieldLike;
    const freshConfirm: PanelLike = { id: "key-store-confirm", hidden: true };
    restoreFormState(
      state,
      (id) => (id === "key-store-file" ? freshRadio : id === "routing-model-select" ? freshSelect : null),
      (id) => (id === "key-store-confirm" ? freshConfirm : null),
    );
    expect(freshRadio.checked).toBe(true);
    expect(freshSelect.value).toBe("openai/gpt-4o-mini");
    expect(freshConfirm.hidden).toBe(false);
  });

  it("skips file pickers and fields without ids", () => {
    const state = captureFormState([field("routing-file-picker", "C:\\fakepath\\a.zip", "", { type: "file" }), field("", "typed", "")], null);
    expect(state.fields).toEqual([]);
  });
});

describe("busy flag", () => {
  it("is cleared when the action fails, so the window doesn't lock up", async () => {
    const state = { busy: false };
    let sawBusy = false;
    await expect(
      withBusy(state, async () => {
        sawBusy = state.busy;
        throw new Error("network down");
      }),
    ).rejects.toThrow("network down");
    expect(sawBusy).toBe(true);
    expect(state.busy).toBe(false);
  });

  it("returns the action's result and clears the flag on success", async () => {
    const state = { busy: false };
    expect(await withBusy(state, async () => 42)).toBe(42);
    expect(state.busy).toBe(false);
  });

  it("a failed conflict resolution surfaces the error instead of hanging", async () => {
    const state = { busy: false };
    const failing = (async () => {
      throw "resolve failed";
    }) as any;
    const item = { path: "a.txt", local_copy: null, remote_copy: null, detected_ms: NOW } as unknown as ConflictItem;
    await expect(withBusy(state, () => resolveConflict(failing, item, "keep_local" as any))).rejects.toBe("resolve failed");
    expect(state.busy).toBe(false);
  });
});

describe("accounts", () => {
  const signedOut: AccountStatus = { signed_in: false, email: null, server: "https://app.renegadebox.com", device_ready: true };
  const signedIn: AccountStatus = { signed_in: true, email: "you@example.com", server: "https://app.renegadebox.com", device_ready: true };
  const iso = (ago: number) => new Date(NOW - ago).toISOString();
  const devices: AccountDevice[] = [
    { id: "7f3a9c21-0000-4000-8000-00000000aaaa", name: "Studio Mac mini", platform: "macos", client_version: "0.1.0", last_seen_at: iso(9 * 86_400_000), created_at: iso(60 * 86_400_000), current: false },
    { id: "68a3c8a0-c930-4984-bc66-079164e213f6", name: "My-MBP", platform: "macos", client_version: "0.1.0", last_seen_at: iso(0), created_at: iso(30 * 86_400_000), current: true },
    { id: "2b1e44d0-0000-4000-8000-00000000bbbb", name: "My-iMac", platform: "macos", client_version: "0.1.0", last_seen_at: iso(3 * 3_600_000), created_at: iso(20 * 86_400_000), current: false },
  ];
  /** Visible words only: tags and attributes stripped. */
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const JARGON = /\btoken|\bkdf\b|\bhash|\bbundle|\bdevices?\b|\bpirate/i;

  it("adds an Account tab to Settings, wherever the tabs render", () => {
    expect(SETTINGS_TABS).toContain("account");
    const html = renderSettings({ status, autostart: true, ignored: [] });
    expect(html).toContain('data-tab="account"');
    expect(html).toContain('id="tab-panel-account"');
    expect(html).toContain("Loading your account…");
    const desk = renderDesktopApp({
      activeTab: "settings",
      settingsTab: "account",
      overview: base,
      recent: [],
      conflicts: [],
      settings: { status, autostart: true, ignored: [], account: { status: signedOut, devices: null } },
      theme: "system",
      now: NOW,
    });
    expect(desk).toMatch(/class="tab-btn active" data-tab="account"/);
    expect(desk).toMatch(/id="tab-panel-account" class="tab-panel active"/);
    expect(desk).toContain("Create an account");
  });

  it("offers create and sign in when signed out", () => {
    const html = renderAccountPanel({ status: signedOut, devices: null });
    for (const s of ["Create an account", "Sign in on any other Mac and it sets itself up from this one.", "Already have an account? Sign in", "At least 12 characters"]) {
      expect(html).toContain(s);
    }
    for (const id of ["account-create-email", "account-create-password", "account-create-confirm", "account-create-btn", "account-signin-email", "account-signin-password", "account-signin-btn"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toMatch(/id="account-create-email"[^>]*disabled/);
    expect(html).not.toContain("Signed in as");
    expect(text(html)).not.toMatch(JARGON);
  });

  it("explains that an account needs storage set up first", () => {
    const html = renderAccountPanel({ status: { ...signedOut, device_ready: false }, devices: null });
    expect(html).toContain("Set up your storage first");
    expect(html).toMatch(/id="account-create-email"[^>]*disabled/);
    expect(html).toMatch(/id="account-create-btn"[^>]*disabled/);
  });

  it("shows the email, Macs, password change and sign out when signed in", () => {
    const html = renderAccountPanel({ status: signedIn, devices, now: NOW });
    expect(html).toContain("Signed in as <strong>you@example.com</strong>");
    // This Mac first, then most recently seen.
    const order = ["My-MBP", "My-iMac", "Studio Mac mini"].map((n) => html.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text(html)).toContain("My-MBP This Mac");
    expect(html).toContain("Last seen 3 hours ago");
    expect(html).toContain("Last seen on Oct 6");
    // Remove only for the other Macs, each with a closed inline confirm that survives re-renders.
    expect(html.match(/data-remove-device=/g)?.length).toBe(2);
    expect(html).not.toContain('data-remove-device="0"');
    expect(html).toMatch(/id="account-remove-confirm-1" class="confirm[^"]*" data-keep-open hidden/);
    expect(html).toContain("Remove My-iMac from your account?");
    expect(html).toContain("Your other Macs stay signed in.");
    expect(html).toContain('id="account-new-password"');
    expect(html).toContain('id="account-new-password-confirm"');
    expect(html).toMatch(/id="account-signout-confirm" class="confirm" data-keep-open hidden/);
    expect(html).toContain("Sign out of your account on this Mac? Your files keep syncing.");
    expect(html).not.toContain("Create an account");
    expect(html).not.toMatch(DEV_DETAIL); // no ids in the page
    expect(text(html)).not.toMatch(JARGON);
  });

  it("escapes what the server sends", () => {
    const html = renderAccountPanel({ status: { ...signedIn, email: "<b>x</b>@example.com" }, devices: [{ ...devices[2]!, name: "<img src=x>" }], now: NOW });
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;img src=x&gt;");
  });

  it("loads the Mac list quietly, and says so when it can't", () => {
    expect(renderAccountPanel({ status: signedIn, devices: null, devicesLoading: true })).toContain("Loading your Macs…");
    const failed = renderAccountPanel({ status: signedIn, devices: null, devicesError: "Couldn't load your Macs. Check your internet connection." });
    expect(failed).toMatch(/class="field-hint account-quiet-error"[^>]*>Couldn't load your Macs\. Check your internet connection\./);
    expect(failed).toContain('id="account-password-form"'); // the rest of the tab still works offline
  });

  it("keeps the busy label and messages on the form they belong to", () => {
    const signing = renderAccountPanel({ status: signedOut, devices: null, action: "signin" });
    expect(signing).toMatch(/id="account-signin-btn"[^>]*disabled[^>]*>Signing in…/);
    expect(signing).toMatch(/id="account-create-btn"[^>]*disabled/);
    const removing = renderAccountPanel({ status: signedIn, devices, action: "remove", removingIndex: 1, now: NOW });
    expect(removing).toMatch(/data-remove-device="1" disabled>Removing…/);
    const err = renderAccountPanel({ status: signedOut, devices: null, message: { slot: "create", text: "That email already has an account.", error: true } });
    expect(err).toMatch(/id="account-create-message" class="inline-message error"[^>]*>That email already has an account\./);
    expect(err).toMatch(/id="account-signin-message" class="inline-message" role="status"><\/p>/);
    const ok = renderAccountPanel({ status: signedIn, devices, message: { slot: "password", text: "Password changed.", error: false }, now: NOW });
    expect(ok).toMatch(/id="account-password-message" class="inline-message" role="status">Password changed\./);
  });

  it("maps a row back to the right Mac", () => {
    expect(accountDeviceRows(devices).map((d) => d.name)).toEqual(["My-MBP", "My-iMac", "Studio Mac mini"]);
    expect(accountDeviceRows(null)).toEqual([]);
  });

  it("describes when each Mac was last seen", () => {
    expect(deviceMeta(devices[1]!, NOW)).toBe("This Mac");
    expect(deviceMeta(devices[2]!, NOW)).toBe("Last seen 3 hours ago");
    expect(deviceMeta({ ...devices[2]!, last_seen_at: iso(30_000) }, NOW)).toBe("Last seen just now");
    expect(deviceMeta({ ...devices[2]!, last_seen_at: iso(30 * 3_600_000) }, NOW)).toBe("Last seen yesterday");
    expect(deviceMeta({ ...devices[2]!, last_seen_at: null }, NOW)).toBe("Not seen yet");
    expect(deviceMeta({ ...devices[2]!, last_seen_at: "garbage" }, NOW)).toBe("Not seen yet");
  });

  it("validates sign in, new accounts and new passwords with plain messages", () => {
    expect(MIN_ACCOUNT_PASSWORD).toBe(12);
    expect(validateSignIn("", "pw")).toBe("Enter your email address.");
    expect(validateSignIn("jordan", "pw")).toBe("Enter a valid email address.");
    expect(validateSignIn("you@example.com", "")).toBe("Enter your password.");
    expect(validateSignIn(" you@example.com ", "short")).toBeNull(); // a short password just won't match
    expect(validateCreateAccount("nope@", "correct horse battery", "correct horse battery")).toBe("Enter a valid email address.");
    expect(validateCreateAccount("you@example.com", "", "")).toBe("Enter a password.");
    expect(validateCreateAccount("you@example.com", "elevenchars", "elevenchars")).toBe("Your password needs at least 12 characters.");
    expect(validateCreateAccount("you@example.com", "correct horse battery", "correct horse batterx")).toBe("The two passwords don't match.");
    expect(validateCreateAccount("you@example.com", "correct horse battery", "correct horse battery")).toBeNull();
    expect(validateNewPassword("twelve chars", "twelve chars")).toBeNull();
    // Counts characters, not UTF-16 units.
    expect(validateNewPassword("ééééééééééé", "ééééééééééé")).toMatch(/12 characters/);
  });

  it("passes arguments the way Tauri expects", async () => {
    const calls: [string, unknown][] = [];
    const fake = async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return null as T;
    };
    await accountStatus(fake);
    await accountCreate({ email: "a@example.com", password: "correct horse battery" }, fake);
    await accountSignIn({ email: "a@example.com", password: "correct horse battery" }, fake);
    await accountSignIn({ email: "a@example.com", password: "correct horse battery", folder: "~/Files" }, fake);
    await accountSignOut(fake);
    await accountDevices(fake);
    await accountRemoveDevice("abc", fake);
    await accountChangePassword("a new long password", fake);
    expect(calls).toEqual([
      ["account_status", undefined],
      ["account_create", { payload: { email: "a@example.com", password: "correct horse battery" } }],
      ["account_sign_in", { payload: { email: "a@example.com", password: "correct horse battery" } }],
      ["account_sign_in", { payload: { email: "a@example.com", password: "correct horse battery", folder: "~/Files" } }],
      ["account_sign_out", undefined],
      ["account_devices", undefined],
      ["account_remove_device", { deviceId: "abc" }],
      ["account_change_password", { password: "a new long password" }],
    ]);
  });

  it("previews the whole account flow in the browser", async () => {
    expect((await mockInvoke<AccountStatus>("account_status", undefined, "setup")).device_ready).toBe(false);
    await expect(mockInvoke("account_create", { payload: { email: "a@example.com", password: "correct horse battery" } }, "setup")).rejects.toMatch(/storage/);
    const st = await mockInvoke<AccountStatus>("account_create", { payload: { email: "a@example.com", password: "correct horse battery" } }, "ok");
    expect(st).toMatchObject({ signed_in: true, email: "a@example.com" });
    const list = await mockInvoke<AccountDevice[]>("account_devices", undefined, "ok");
    expect(list.filter((d) => d.current).length).toBe(1);
    const other = list.find((d) => !d.current)!;
    await mockInvoke("account_remove_device", { deviceId: other.id }, "ok");
    expect((await mockInvoke<AccountDevice[]>("account_devices", undefined, "ok")).some((d) => d.id === other.id)).toBe(false);
    await expect(mockInvoke("account_change_password", { password: "short" }, "ok")).rejects.toMatch(/12 characters/);
    expect((await mockInvoke<AccountStatus>("account_sign_out", undefined, "ok")).signed_in).toBe(false);
  });
});

describe("setup: sign in first", () => {
  it("opens on Sign in, with storage setup as the second choice", () => {
    const html = renderSetup();
    expect(html).toContain("Sign in to RenegadeBox");
    expect(html).toMatch(/id="signin-panel" class="signin">/);
    expect(html).toMatch(/id="setup-wizard" class="setup-wizard" hidden/);
    expect(html).toContain('id="signin-email"');
    expect(html).toContain('id="signin-password"');
    expect(html).toMatch(/id="signin-btn"[^>]*>Sign in</);
    expect(html).toContain("Set up new storage instead");
    expect(html).toContain("Your password never leaves this Mac. It unlocks your saved setup, so you don't have to enter your storage details again.");
    expect(html).toContain("New to RenegadeBox? Set up your storage first, then create your account in Settings.");
    expect(html).toContain('id="signin-error"');
    // Sign in comes before the storage steps.
    expect(html.indexOf('id="signin-form"')).toBeLessThan(html.indexOf('id="setup-form"'));
    expect(html).not.toMatch(DEV_DETAIL);
  });

  it("keeps the storage wizard intact, and opens on it when reconnecting", () => {
    const html = renderSetup("wizard");
    expect(html).toContain("Set up RenegadeBox");
    expect(html).toMatch(/id="signin-panel" class="signin" hidden/);
    expect(html).toMatch(/id="setup-wizard" class="setup-wizard">/);
    for (const id of ["setup-bucket", "setup-access-key", "setup-passphrase", "setup-folder", "setup-next", "setup-back", "setup-signin-instead"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("accounts: Google sign-in", () => {
  const signedOut: AccountStatus = { signed_in: false, email: null, server: "https://app.renegadebox.com", device_ready: true, provider: null };
  const google: AccountStatus = { signed_in: true, email: "you@example.com", server: "https://app.renegadebox.com", device_ready: true, provider: "google" };
  const devices: AccountDevice[] = [
    { id: "68a3c8a0-c930-4984-bc66-079164e213f6", name: "My-MBP", platform: "macos", client_version: "0.1.0", last_seen_at: new Date(NOW).toISOString(), created_at: null, current: true },
    { id: "2b1e44d0-0000-4000-8000-00000000bbbb", name: "My-iMac", platform: "macos", client_version: "0.1.0", last_seen_at: new Date(NOW - 3_600_000).toISOString(), created_at: null, current: false },
  ];
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("draws a plain Continue with Google button, and a waiting line with Cancel", () => {
    const idle = renderGoogleButton({ id: "g", waiting: false, cancelId: "c" });
    expect(idle).toMatch(/<button id="g" class="btn google-btn" type="button">/);
    expect(idle).toContain("<svg");
    expect(text(idle).trim()).toBe("Continue with Google");
    expect(idle).not.toContain('id="c"');
    const waiting = renderGoogleButton({ id: "g", waiting: true, cancelId: "c" });
    expect(waiting).toContain("Finish signing in in your browser…");
    expect(waiting).toMatch(/<button id="c" class="link-btn" type="button">Cancel<\/button>/);
    expect(waiting).not.toContain('id="g"');
  });

  it("makes Google the main action in Settings when signed out, with password forms collapsed", () => {
    const html = renderAccountPanel({ status: signedOut, devices: null });
    expect(html).toContain("Sign in with Google here first. After that, any Mac you sign in on sets itself up from this one.");
    expect(html).toContain('id="account-google-btn"');
    expect(html.indexOf('id="account-google-btn"')).toBeLessThan(html.indexOf('id="account-create-form"'));
    expect(html).toMatch(/id="account-password-toggle"[^>]*>Use email and password instead</);
    expect(html).toMatch(/id="account-password-forms" data-keep-open hidden/);
  });

  it("opens the password forms when asked, or when one of them is busy or has something to say", () => {
    const open = (m: Partial<AccountViewModel>) => /id="account-password-forms" data-keep-open>/.test(renderAccountPanel({ status: signedOut, devices: null, ...m }));
    expect(open({})).toBe(false);
    expect(open({ showPasswordForms: true })).toBe(true);
    expect(open({ action: "signin" })).toBe(true);
    expect(open({ message: { slot: "create", text: "That email already has an account.", error: true } })).toBe(true);
    expect(open({ message: { slot: "google", text: "Google sign-in was cancelled.", error: true } })).toBe(false);
    expect(renderAccountPanel({ status: signedOut, devices: null, showPasswordForms: true })).toMatch(/id="account-password-toggle"[^>]*hidden/);
  });

  it("shows the waiting state in Settings while the browser is open", () => {
    const html = renderAccountPanel({ status: signedOut, devices: null, action: "google" });
    expect(html).toContain("Finish signing in in your browser…");
    expect(html).toContain('id="account-google-cancel"');
    expect(html).not.toContain('id="account-google-btn"');
    expect(html).toMatch(/id="account-create-btn"[^>]*disabled/);
    const failed = renderAccountPanel({ status: signedOut, devices: null, message: { slot: "google", text: "Google didn't finish signing you in.", error: true } });
    expect(failed).toMatch(/id="account-google-message" class="inline-message error"[^>]*>Google didn't finish signing you in\./);
  });

  it("signed in with Google: names the provider and has no password to change", () => {
    const html = renderAccountPanel({ status: google, devices, now: NOW });
    expect(html).toContain("Signed in with Google as <strong>you@example.com</strong>");
    expect(html).not.toContain("Change password");
    expect(html).not.toContain('id="account-password-form"');
    expect(html).toContain("My-iMac");
    expect(html).toContain('data-remove-device="1"');
    expect(html).toContain('id="account-signout-btn"');
    const pw = renderAccountPanel({ status: { ...google, provider: "password" }, devices, now: NOW });
    expect(pw).toContain("Signed in as <strong>");
    expect(pw).toContain("Change password");
  });

  it("puts Continue with Google first in the setup window, email and password behind a link", () => {
    const html = renderSetup();
    expect(html).toContain('id="signin-google-btn"');
    expect(html).toMatch(/id="signin-google-waiting" hidden/);
    expect(html).toContain('id="signin-google-cancel"');
    expect(html).toContain("RenegadeBox opens Google in your browser. Once you've signed in, this Mac sets itself up from your account.");
    expect(html).toMatch(/id="signin-email-toggle"[^>]*>Use email and password instead</);
    expect(html).toMatch(/<form id="signin-form" class="signin-email-form" novalidate hidden>/);
    expect(html.indexOf('id="signin-google-btn"')).toBeLessThan(html.indexOf('id="signin-form"'));
    expect(html).toContain("Set up new storage instead");
    expect(html).not.toMatch(DEV_DETAIL);
  });

  it("calls account_google_sign_in the way Tauri expects, and previews it", async () => {
    const calls: [string, unknown][] = [];
    const fake = async <T,>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return null as T;
    };
    await accountGoogleSignIn(undefined, fake);
    await accountGoogleSignIn("~/Files", fake);
    expect(calls).toEqual([
      ["account_google_sign_in", { payload: null }],
      ["account_google_sign_in", { payload: { folder: "~/Files" } }],
    ]);
    const st = await mockInvoke<AccountStatus>("account_google_sign_in", { payload: null }, "setup");
    expect(st).toMatchObject({ signed_in: true, provider: "google" });
    expect((await mockInvoke<AccountStatus>("account_status", undefined, "ok")).provider).toBe("google");
    expect((await mockInvoke<AccountStatus>("account_sign_out", undefined, "ok")).provider).toBeNull();
  });
});
