import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { Overview } from "./status";
import type { AccountCredentials, AccountDevice, AccountProvider, AccountSignInPayload, AccountStatus, ActivityItem, AiConfigResponse, AiConfigUpdate, AiUsageSummary, ConflictItem, MountedVolume, NasStagingStatus, NasTaxonomyScan, NasTransferRecord, RecentFile, ReviewItem, RouteConfig, RouteDecision, RoutesOverview, RouteTemplate, RuleCheck, RuleSuggestion, SyncActivity, VaultStatus, Invoke } from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export function hasTauri(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

/** Sample scenarios for previewing the UI in a normal browser (`?state=…`). */
export type MockScenario = "ok" | "syncing" | "paused" | "conflicts" | "error" | "setup";
export const MOCK_SCENARIOS: MockScenario[] = ["ok", "syncing", "paused", "conflicts", "error", "setup"];

export function mockScenarioFromUrl(): MockScenario {
  if (typeof location === "undefined") return "ok";
  const s = new URLSearchParams(location.search).get("state") as MockScenario | null;
  return s && MOCK_SCENARIOS.includes(s) ? s : "ok";
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (hasTauri()) return tauriInvoke<T>(cmd, args);
  return mockInvoke<T>(cmd, args, mockScenarioFromUrl());
}

// ---------------------------------------------------------------- account
// Typed wrappers for src-tauri/src/account.rs. Tauri camel-cases Rust argument names
// (device_id -> deviceId); payload fields keep their snake_case names. Errors arrive as
// ready-to-show sentences.

/** Reads config only, so it is safe to call on every render. */
export function accountStatus(call: Invoke = invoke): Promise<AccountStatus> {
  return call<AccountStatus>("account_status");
}

/** Creates an account from this Mac's existing storage setup. */
export function accountCreate(payload: AccountCredentials, call: Invoke = invoke): Promise<AccountStatus> {
  return call<AccountStatus>("account_create", { payload: { email: payload.email, password: payload.password } });
}

/** Signs in. Sets up a new Mac from the account, or links one already set up with the same storage. */
export function accountSignIn(payload: AccountSignInPayload, call: Invoke = invoke): Promise<AccountStatus> {
  const body: Record<string, unknown> = { email: payload.email, password: payload.password };
  if (payload.folder) body.folder = payload.folder;
  return call<AccountStatus>("account_sign_in", { payload: body });
}

/**
 * Sign in with Google. Opens the browser and waits until the person finishes there (up to 10 minutes).
 * Creates the account from this Mac the first time, or sets up a new Mac from the account.
 */
export function accountGoogleSignIn(folder?: string | null, call: Invoke = invoke): Promise<AccountStatus> {
  return call<AccountStatus>("account_google_sign_in", { payload: folder ? { folder } : null });
}

export function accountSignOut(call: Invoke = invoke): Promise<AccountStatus> {
  return call<AccountStatus>("account_sign_out");
}

export function accountDevices(call: Invoke = invoke): Promise<AccountDevice[]> {
  return call<AccountDevice[]>("account_devices");
}

export function accountRemoveDevice(deviceId: string, call: Invoke = invoke): Promise<void> {
  return call<void>("account_remove_device", { deviceId });
}

export function accountChangePassword(password: string, call: Invoke = invoke): Promise<void> {
  return call<void>("account_change_password", { password });
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function sampleRecent(now: number): RecentFile[] {
  const f = (path: string, ago: number): RecentFile => {
    const i = path.lastIndexOf("/");
    return { path, name: i < 0 ? path : path.slice(i + 1), folder: i < 0 ? "" : path.slice(0, i), modified_ms: now - ago };
  };
  return [
    f("Work/Q3 budget.xlsx", 2 * MIN),
    f("Work/Client proposal - Hartley.docx", 14 * MIN),
    f("Home/Kitchen remodel quote.pdf", 52 * MIN),
    f("Photos/2026/IMG_2041.jpeg", 3 * HOUR),
    f("Photos/2026/IMG_2040.jpeg", 3 * HOUR + 2 * MIN),
    f("Notes.txt", 5 * HOUR),
    f("Home/Insurance/Policy renewal 2026.pdf", 26 * HOUR),
    f("Work/Invoices/Invoice 1042.pdf", 2 * DAY),
    f("Shabbat menu.docx", 4 * DAY),
    f("Taxes/2025 return.pdf", 12 * DAY),
  ];
}

function sampleActivity(now: number, scenario: MockScenario): SyncActivity {
  const item = (path: string, kind: ActivityItem["kind"], status: ActivityItem["status"], size: number | null, ago: number): ActivityItem => {
    const i = path.lastIndexOf("/");
    return {
      path,
      name: i < 0 ? path : path.slice(i + 1),
      folder: i < 0 ? "" : path.slice(0, i),
      kind,
      status,
      size,
      started_ms: now - ago - 4_000,
      finished_ms: status === "active" ? null : now - ago,
      destination: kind === "moved" ? path : null,
    };
  };
  const active =
    scenario === "syncing"
      ? [
          item("Photos/2026/IMG_2045.jpeg", "upload", "active", 4_400_000, 0),
          item("Work/Site walkthrough.mov", "upload", "active", 812_000_000, 0),
          item("Home/Lease signed.pdf", "download", "active", 1_200_000, 0),
        ]
      : [];
  return {
    active,
    recent: [
      item("Work/Q3 budget.xlsx", "upload", "done", 48_000, 2 * MIN),
      item("/Volumes/HomeNAS/Backups/Pressable/pressable_backup.sql.gz", "moved", "done", 220_000_000, 6 * MIN),
      item("Work/Client proposal - Hartley.docx", "download", "done", 310_000, 14 * MIN),
      item("Photos/2026/IMG_2041.jpeg", "upload", "done", 3_900_000, 3 * HOUR),
      item("Home/Old quote.pdf", "delete_remote", "done", null, 4 * HOUR),
      item("Taxes/Scans/receipt-0412.tiff", "upload", "failed", 18_000_000, 5 * HOUR),
    ],
  };
}

const SAMPLE_CONFLICTS = (now: number): ConflictItem[] => [
  {
    path: "Work/Q3 budget (conflicted copy from My-iMac 2026-10-15 9f3a12bc).xlsx",
    original_name: "Q3 budget.xlsx",
    folder: "Work",
    device: "My-iMac",
    modified_ms: now - 6 * MIN,
  },
  {
    path: "Notes (conflicted copy from My-iMac 2026-10-15 47de0a91).txt",
    original_name: "Notes.txt",
    folder: "",
    device: "My-iMac",
    modified_ms: now - 40 * MIN,
  },
];

let mockPaused: boolean | null = null;
let mockKeyStore = "System keychain";
let mockAutostart = true;
let mockAiConfig: AiConfigResponse = {
  enabled: false,
  provider: "openrouter",
  model: "google/gemini-2.5-flash-lite",
  smb_target: "/Volumes/home",
  rules: "Invoices and receipts go to Finance/Invoices\nPhotos and media go to Media/Photos",
  auto_route: true,
  routing_mode: "move",
  routing_root: "/Volumes/home",
  has_api_key: true,
  has_openrouter_key: true,
  has_grok_key: false,
  role_rules: {},
  enabled_roles: ["webdev"],
  vault_routing_enabled: false,
  use_review_folder: true,
  vault_max_file_mb: 500,
  vault_folder: "/Users/me/RenegadeBox",
  rules_backup_count: 0,
  ingest_warning: null,
};
let mockRulesBackups: Array<Record<string, string[]>> = [];
let mockAccountEmail: string | null = null;
let mockAccountProvider: AccountProvider | null = null;
let mockAccountDevices: AccountDevice[] = [];
const MOCK_ACCOUNT_SERVER = "https://app.renegadebox.com";

function mockSignedInDevices(now: number): AccountDevice[] {
  const iso = (ago: number) => new Date(now - ago).toISOString();
  return [
    { id: "mac-this", name: "My-MacBook-Pro", platform: "macos", client_version: "0.1.0", last_seen_at: iso(0), created_at: iso(30 * DAY), current: true },
    { id: "mac-imac", name: "My-iMac", platform: "macos", client_version: "0.1.0", last_seen_at: iso(3 * HOUR), created_at: iso(20 * DAY), current: false },
    { id: "mac-studio", name: "Studio Mac mini", platform: "macos", client_version: "0.1.0", last_seen_at: iso(9 * DAY), created_at: iso(60 * DAY), current: false },
  ];
}

function mockAccountStatus(initialized: boolean): AccountStatus {
  return { signed_in: mockAccountEmail !== null, email: mockAccountEmail, server: MOCK_ACCOUNT_SERVER, device_ready: initialized, provider: mockAccountEmail === null ? null : mockAccountProvider };
}

const mockDelay = <T,>(ms: number, fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, ms));
let mockReviewQueue: ReviewItem[] = [
  {
    id: "rv-preview-1",
    timestamp: Date.now() - 300_000,
    filename: "scan_0042.tiff",
    path: "/Users/me/RenegadeBox/To NAS/_Needs Review/scan_0042.tiff",
    suggested_folder: "Media/Scans",
    confidence: 0.55,
    reason: "AI was only 55% sure",
    explanation: "Looks like a scanned document, but the content is unclear.",
    file_size_bytes: 8_400_000,
  },
  {
    id: "rv-preview-2",
    timestamp: Date.now() - 600_000,
    filename: "2026-10-05-14-06-39-beaverbuilderforge.sql.gz",
    path: "/Users/me/RenegadeBox/To NAS/_Needs Review/2026-10-05-14-06-39-beaverbuilderforge.sql.gz",
    suggested_folder: "Backups From Spinup",
    confidence: null,
    reason: "Move failed: source kept at /Users/me/RenegadeBox/To NAS/2026-10-05-14-06-39-beaverbuilderforge.sql.gz: Permission denied (os error 13)",
    explanation: null,
    file_size_bytes: 91_501,
  },
];
let mockSuggestions: RuleSuggestion[] = [
  {
    id: "sg-preview-1",
    timestamp: Date.now() - 600_000,
    rule: "*.blend go to Design/3D Models",
    example_file: "chair_v3.blend",
    destination: "Design/3D Models",
  },
];

const MOCK_ROUTE_TEMPLATES: RouteTemplate[] = [
  {
    id: "photography",
    name: "Photography",
    description: "Shoots filed by the date they were taken. Drop into a subfolder named after the client to file it under that client. RAW, JPEG and sidecar files stay together.",
    mode: "copy",
    scan_subfolders: true,
    layout: "Shoots/{year}/{date} {source_folder}",
    rules: ["*.mp4, *.mov, *.mts go to Video/{year}/{date} {source_folder}", "*.psd, *.tif, *.tiff go to Edits/{year}/{source_folder}"],
  },
  {
    id: "website-backups",
    name: "Website Backups",
    description: "Hosting backups and database dumps filed by host.",
    mode: "move",
    scan_subfolders: false,
    layout: null,
    rules: ["SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup", "*.wpress go to Local Sites & Exports"],
  },
  {
    id: "documents",
    name: "Documents",
    description: "Invoices, statements and PDFs filed by year.",
    mode: "move",
    scan_subfolders: false,
    layout: "Documents/{year}",
    rules: ["invoice, receipt go to Finance/Invoices/{year}", "statement go to Finance/Statements/{year}", "contract, agreement go to Contracts"],
  },
  {
    id: "family-photos",
    name: "Family Photos",
    description: "Phone and camera photos filed by year and month.",
    mode: "move",
    scan_subfolders: true,
    layout: "Photos/{year}/{year}-{month}",
    rules: ["*.mp4, *.mov go to Videos/{year}"],
  },
  { id: "blank", name: "Blank", description: "Start from scratch with your own rules.", mode: "move", scan_subfolders: false, layout: null, rules: [] },
];

let mockRoutes: RouteConfig[] = [
  {
    id: "photography",
    name: "Photography",
    enabled: true,
    source: "/Users/me/Photo Inbox",
    destination: "/Volumes/PhotoNAS",
    mode: "copy",
    auto: true,
    ai: false,
    use_review_folder: true,
    scan_subfolders: true,
    skip_duplicates: true,
    vault: false,
    rules: MOCK_ROUTE_TEMPLATES[0]!.rules,
    layout: MOCK_ROUTE_TEMPLATES[0]!.layout,
    template: "photography",
  },
];

function mockRoutesOverview(): RoutesOverview {
  const main: RouteConfig = {
    id: "main",
    name: "To NAS",
    enabled: true,
    source: "/Users/me/RenegadeBox/To NAS",
    destination: mockAiConfig.smb_target || "",
    mode: mockAiConfig.routing_mode === "organize" ? "organize" : "move",
    auto: mockAiConfig.auto_route,
    ai: mockAiConfig.enabled,
    use_review_folder: mockAiConfig.use_review_folder ?? true,
    scan_subfolders: false,
    skip_duplicates: false,
    vault: mockAiConfig.vault_routing_enabled ?? false,
    rules: (mockAiConfig.rules || "").split("\n").filter((l) => l.trim()),
    layout: null,
    template: null,
  };
  return {
    routes: [
      { config: main, is_main: true, source_exists: true, destination_reachable: true, pending_count: 0, review_count: mockReviewQueue.length, problems: [] },
      ...mockRoutes.map((r) => ({
        config: r,
        is_main: false,
        source_exists: true,
        destination_reachable: !r.destination.startsWith("/Volumes/PhotoNAS"),
        pending_count: r.id === "photography" ? 14 : 0,
        review_count: 0,
        problems: [],
      })),
    ],
    templates: MOCK_ROUTE_TEMPLATES,
  };
}

export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> | undefined, scenario: MockScenario): Promise<T> {
  const now = Date.now();
  const initialized = scenario !== "setup";
  const out = ((): unknown => {
    switch (cmd) {
      case "get_sync_overview": {
        const paused = mockPaused ?? scenario === "paused";
        const o: Overview = {
          initialized,
          paused,
          syncing: scenario === "syncing",
          pending: scenario === "syncing" ? 3 : scenario === "paused" ? 2 : 0,
          conflicts: scenario === "conflicts" ? 2 : 0,
          error: scenario === "error" ? "LIST rb/journal/: dispatch failure: io error: Connection refused" : null,
        };
        return o;
      }
      case "get_vault_status": {
        const s: VaultStatus = {
          initialized,
          folder: initialized ? "/Users/me/RenegadeBox" : null,
          bucket: initialized ? "my-files" : null,
          region: initialized ? "us-east-1" : null,
          endpoint: initialized ? "https://s3.wasabisys.com" : null,
          device_id: initialized ? "68a3c8a0-c930-4984-bc66-079164e213f6" : null,
          device_name: initialized ? "My-MacBook-Pro" : null,
          hub_url: null,
          key_store: initialized ? mockKeyStore : null,
          total_files: 214,
          pending_changes: 0,
          total_bytes: 1_843_200_000,
        };
        return s;
      }
      case "list_recent_files":
        return initialized ? sampleRecent(now).slice(0, Number(args?.limit ?? 10)) : [];
      case "get_sync_activity":
        return initialized ? sampleActivity(now, scenario) : { active: [], recent: [] };
      case "list_conflicts":
        return scenario === "conflicts" ? SAMPLE_CONFLICTS(now) : [];
      case "pause_sync":
        mockPaused = true;
        return true;
      case "resume_sync":
        mockPaused = false;
        return false;
      case "is_sync_paused":
        return mockPaused ?? scenario === "paused";
      case "is_autostart_enabled":
        return mockAutostart;
      case "set_autostart_enabled":
        mockAutostart = Boolean(args?.enabled);
        return mockAutostart;
      case "set_key_store":
        mockKeyStore = args?.useKeychain ? "System keychain" : "Unprotected file (readable by any app running as you)";
        return args?.useKeychain ? "System keychain" : "Unprotected file";
      case "get_ignored_patterns":
        return [".DS_Store", "Thumbs.db", "*.tmp", ".git/", "node_modules/"];
      case "add_to_finder_favorites":
        return "Opened folder in Finder";
      case "setup_vault":
        return new Promise((resolve) => setTimeout(() => resolve({ initialized: true }), 900));
      case "get_ai_config":
        return mockAiConfig;
      case "save_ai_config": {
        const payload = args?.payload as AiConfigUpdate | undefined;
        if (payload) {
          const hasOpenRouter = Boolean(payload.openrouter_api_key || payload.api_key || mockAiConfig.has_openrouter_key);
          const hasGrok = Boolean(payload.grok_api_key || mockAiConfig.has_grok_key);
          const provider = payload.provider || mockAiConfig.provider || "openrouter";
          mockAiConfig = {
            ...mockAiConfig,
            enabled: payload.enabled,
            provider,
            model: payload.model,
            smb_target: payload.smb_target ?? mockAiConfig.smb_target,
            nas_ingest_folder: payload.nas_ingest_folder ?? mockAiConfig.nas_ingest_folder,
            rules: payload.rules ?? mockAiConfig.rules,
            auto_route: payload.auto_route,
            routing_mode: payload.routing_mode ?? mockAiConfig.routing_mode,
            has_api_key: provider === "xai" ? hasGrok : hasOpenRouter,
            has_openrouter_key: hasOpenRouter,
            has_grok_key: hasGrok,
            vault_routing_enabled: payload.vault_routing_enabled ?? mockAiConfig.vault_routing_enabled,
            vault_max_file_mb: payload.vault_max_file_mb ?? mockAiConfig.vault_max_file_mb,
            use_review_folder: payload.use_review_folder ?? mockAiConfig.use_review_folder,
          };
        }
        return true as T;
      }
      case "scan_nas_directories": {
        const scan: NasTaxonomyScan = {
          root: (args?.path as string) || "/Volumes/home",
          directories: [
            "Finance",
            "Finance/Invoices",
            "Finance/Taxes",
            "Media",
            "Media/Photos",
            "Media/Videos",
            "Work",
            "Work/Projects",
            "Work/Proposals",
          ],
        };
        return scan;
      }
      case "suggest_rules_from_nas": {
        return [
          "Invoices, receipts, and bills go to Finance/Invoices",
          "Tax documents (W-2, 1099) go to Finance/Taxes",
          "Photos and camera media go to Media/Photos",
          "Client proposals and agreements go to Work/Proposals",
          "Code projects and archives go to Work/Projects",
        ];
      }
      case "translate_rules": {
        const exp = ((args?.explanation as string) || "").toLowerCase();
        if (exp.includes("spinup")) {
          return ["SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup"];
        }
        if (exp.includes("pressable")) {
          return ["Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable"];
        }
        if (exp.includes("wp engine") || exp.includes("wpengine")) {
          return ["WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine"];
        }
        if (exp.includes("cpanel")) {
          return ["cPanel website backups (backup-*.tar.gz) go to Backups From cPanel"];
        }
        if (exp.includes("backup")) {
          return [
            "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup",
            "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine",
            "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable",
            "cPanel website backups (backup-*.tar.gz) go to Backups From cPanel",
          ];
        }
        if (exp.includes("tax")) {
          return [
            "Tax returns, W-2s, and 1099 statements go to Finance/Taxes",
            "General invoices and bills go to Finance/Invoices",
            "Work documents go to Work/Projects",
          ];
        }
        return [
          "Invoices and accounting documents go to Finance/Invoices",
          "Photos, graphics, and video media go to Media/Photos",
          "Client contracts and agreements go to Work/Proposals",
        ];
      }
      case "test_ai_routing": {
        const decision: RouteDecision = {
          destination_folder: "Finance/Invoices",
          suggested_filename: "Invoice_ACME_Oct2026.pdf",
          confidence: 0.95,
          explanation: "Contains invoice headers and payment terms matching Finance/Invoices rule.",
        };
        return decision;
      }
      case "choose_folder":
      case "pick_sync_folder":
        return "/Volumes/HomeNAS/Website Backups";
      case "open_finder_extensions":
        return null;
      case "list_detected_volumes": {
        const vols: MountedVolume[] = [
          { name: "Synology (home)", path: "/Volumes/home" },
          { name: "Synology (data)", path: "/Volumes/data" },
        ];
        return vols;
      }
      case "get_ai_usage": {
        const summary: AiUsageSummary = {
          totalRequests: 21,
          totalPromptTokens: 8450,
          totalCompletionTokens: 2620,
          totalTokens: 11070,
          totalCostUsd: 0.00289,
          byOperation: [
            {
              operation: "rule_translation",
              label: "Rule Optimization & Verify",
              requests: 10,
              totalTokens: 5240,
              estimatedCostUsd: 0.00138,
              percentageOfTotal: 47.3,
            },
            {
              operation: "suggest_rules",
              label: "NAS Taxonomy Scan",
              requests: 6,
              totalTokens: 3510,
              estimatedCostUsd: 0.00091,
              percentageOfTotal: 31.7,
            },
            {
              operation: "file_routing",
              label: "Live File Auto-Routing",
              requests: 5,
              totalTokens: 2320,
              estimatedCostUsd: 0.0006,
              percentageOfTotal: 21.0,
            },
          ],
          byModel: [
            {
              model: "google/gemini-2.5-flash-lite",
              requests: 18,
              totalTokens: 9450,
              estimatedCostUsd: 0.00234,
              percentageOfTotal: 85.4,
            },
            {
              model: "anthropic/claude-haiku-4.5",
              requests: 3,
              totalTokens: 1620,
              estimatedCostUsd: 0.00055,
              percentageOfTotal: 14.6,
            },
          ],
          recentEntries: [
            {
              id: "req-1",
              timestamp: Date.now() - 45000,
              operation: "rule_translation",
              operationLabel: "Rule Optimization",
              model: "google/gemini-2.5-flash-lite",
              promptTokens: 380,
              completionTokens: 110,
              totalTokens: 490,
              estimatedCostUsd: 0.000082,
              summary: "Optimized: SpinupWP backups go to Backups/SpinupWP",
            },
            {
              id: "req-2",
              timestamp: Date.now() - 140000,
              operation: "suggest_rules",
              operationLabel: "NAS Taxonomy Scan",
              model: "google/gemini-2.5-flash-lite",
              promptTokens: 620,
              completionTokens: 240,
              totalTokens: 860,
              estimatedCostUsd: 0.000158,
              summary: "Discovered HomeNAS taxonomy (6 folders)",
            },
            {
              id: "req-3",
              timestamp: Date.now() - 420000,
              operation: "file_routing",
              operationLabel: "Live File Routing",
              model: "google/gemini-2.5-flash-lite",
              promptTokens: 290,
              completionTokens: 85,
              totalTokens: 375,
              estimatedCostUsd: 0.000063,
              summary: "Routed backup_db.sql.gz -> Backups/Databases",
            },
            {
              id: "req-4",
              timestamp: Date.now() - 950000,
              operation: "rule_translation",
              operationLabel: "Rule Optimization",
              model: "google/gemini-2.5-flash-lite",
              promptTokens: 340,
              completionTokens: 95,
              totalTokens: 435,
              estimatedCostUsd: 0.000072,
              summary: "Optimized: Pressable backups go to Backups/Pressable",
            },
          ],
        };
        return summary;
      }
      case "clear_ai_usage":
        return null;
      case "get_nas_transfers": {
        const transfers: NasTransferRecord[] = [
          {
            id: "tx-sample-1",
            timestamp: Date.now() - 120_000,
            filename: "backup_lamp_production_spinup.sql.gz",
            source_path: "~/RenegadeBox/To NAS/backup_lamp_production_spinup.sql.gz",
            destination_path: "/Volumes/home/Website Backups/SpinupWP/backup_lamp_production_spinup.sql.gz",
            destination_folder: "Website Backups/SpinupWP",
            rule_matched: "SpinupWP backups go to Website Backups/SpinupWP",
            file_size_bytes: 42_850_100,
            status: "completed",
          },
          {
            id: "tx-sample-2",
            timestamp: Date.now() - 360_000,
            filename: "pressable_export_oct2026.zip",
            source_path: "~/RenegadeBox/To NAS/pressable_export_oct2026.zip",
            destination_path: "/Volumes/home/Website Backups/Pressable/pressable_export_oct2026.zip",
            destination_folder: "Website Backups/Pressable",
            rule_matched: "Pressable backups go to Website Backups/Pressable",
            file_size_bytes: 18_420_000,
            status: "completed",
          },
        ];
        return transfers;
      }
      case "clear_nas_transfers":
        return null;
      case "relocate_nas_transfer": {
        const id = args?.transferId as string || "tx-sample-1";
        const newFolder = (args?.newFolder as string) || "Website Backups/Relocated";
        const rec: NasTransferRecord = {
          id,
          timestamp: Date.now(),
          filename: "backup_lamp_production_spinup.sql.gz",
          source_path: "~/RenegadeBox/To NAS/backup_lamp_production_spinup.sql.gz",
          destination_path: `/Volumes/home/${newFolder}/backup_lamp_production_spinup.sql.gz`,
          destination_folder: newFolder,
          rule_matched: "Manual user relocation",
          file_size_bytes: 42_850_100,
          status: "relocated",
        };
        return rec;
      }
      case "revert_nas_transfer_to_staging": {
        const id = args?.transferId as string || "tx-sample-1";
        const rec: NasTransferRecord = {
          id,
          timestamp: Date.now(),
          filename: "backup_lamp_production_spinup.sql.gz",
          source_path: "~/RenegadeBox/To NAS/backup_lamp_production_spinup.sql.gz",
          destination_path: "/Volumes/home/Website Backups/SpinupWP/backup_lamp_production_spinup.sql.gz",
          destination_folder: "Website Backups/SpinupWP",
          rule_matched: "Reverted to staging",
          file_size_bytes: 42_850_100,
          status: "reverted",
        };
        return rec;
      }
      case "get_nas_staging_status": {
        const status: NasStagingStatus = {
          ingest_folder: "/Users/me/RenegadeBox/To NAS",
          pending_count: 0,
          pending_files: [],
          nas_accessible: true,
          smb_target: "/Volumes/home",
        };
        return status;
      }
      case "process_nas_ingest": {
        return [];
      }
      case "get_review_queue":
        return mockReviewQueue;
      case "get_routes":
        return mockRoutesOverview();
      case "save_route": {
        const route = { ...(args?.route as RouteConfig) };
        if (!route.name?.trim()) throw new Error("Give this route a name.");
        if (!route.source?.startsWith("/")) throw new Error("Choose a source folder.");
        if (route.mode !== "organize" && !route.destination?.startsWith("/")) throw new Error("Choose a destination folder.");
        if (!route.id) route.id = route.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "route";
        mockRoutes = mockRoutes.some((r) => r.id === route.id) ? mockRoutes.map((r) => (r.id === route.id ? route : r)) : [...mockRoutes, route];
        return route;
      }
      case "delete_route":
        mockRoutes = mockRoutes.filter((r) => r.id !== args?.routeId);
        return null;
      case "run_route_now":
        return [];
      case "approve_review_item": {
        const itemId = (args?.itemId as string) || "";
        const item = mockReviewQueue.find((i) => i.id === itemId);
        mockReviewQueue = mockReviewQueue.filter((i) => i.id !== itemId);
        const folder = (args?.folder as string) || item?.suggested_folder || "Unsorted";
        const rec: NasTransferRecord = {
          id: `tx-preview-${now}`,
          timestamp: now,
          filename: item?.filename || "file",
          source_path: item?.path || "",
          destination_path: `/Volumes/home/${folder}/${item?.filename || "file"}`,
          destination_folder: folder,
          rule_matched: "Approved from review",
          file_size_bytes: item?.file_size_bytes || 0,
          status: "completed",
        };
        return rec;
      }
      case "dismiss_review_item":
        mockReviewQueue = mockReviewQueue.filter((i) => i.id !== args?.itemId);
        return null;
      case "get_rule_suggestions":
        return mockSuggestions;
      case "dismiss_rule_suggestion":
        mockSuggestions = mockSuggestions.filter((s) => s.id !== args?.suggestionId);
        return null;
      case "check_rule": {
        const rule = String(args?.rule || "");
        const parts = rule.split(/\s+go\s+to\s+/i);
        const parses = parts.length === 2 && Boolean(parts[0]?.trim()) && Boolean(parts[1]?.trim());
        const destination = parts[1]?.trim() || "";
        const check: RuleCheck = {
          rule,
          parses,
          trigger: parts[0]?.trim() || "",
          destination,
          is_vault: destination.startsWith("vault:"),
          vault_enabled: Boolean(mockAiConfig.vault_routing_enabled),
          destination_safe: !destination.includes(".."),
          destination_exists: null,
          sample_file: "",
          sample_matches: parses,
          shadowed_by: null,
          problems: parses ? [] : ["Rules must look like \"<pattern> go to <folder>\"."],
        };
        return check;
      }
      case "save_routing_rules": {
        const roleRules = (args?.roleRules as Record<string, string[]>) || {};
        mockRulesBackups.push(mockAiConfig.role_rules || {});
        mockAiConfig = {
          ...mockAiConfig,
          role_rules: roleRules,
          enabled_roles: (args?.enabledRoles as string[]) || mockAiConfig.enabled_roles,
          rules_backup_count: mockRulesBackups.length,
        };
        return "saved";
      }
      case "undo_rules_change": {
        const prev = mockRulesBackups.pop();
        if (!prev) throw new Error("No earlier rules to restore");
        mockAiConfig = { ...mockAiConfig, role_rules: prev, rules_backup_count: mockRulesBackups.length };
        return mockAiConfig;
      }
      case "account_status":
        return mockAccountStatus(initialized);
      case "account_create":
      case "account_sign_in": {
        const p = (args?.payload ?? {}) as { email?: string; password?: string };
        return mockDelay(cmd === "account_sign_in" ? 1500 : 1200, () => {
          if (cmd === "account_create" && !initialized) throw "Set up your storage on this Mac first, then create your account.";
          if (cmd === "account_sign_in" && (p.password ?? "").length < 12) throw "That email and password don't match an account.";
          mockAccountEmail = (p.email ?? "").trim();
          mockAccountProvider = "password";
          mockAccountDevices = mockSignedInDevices(now);
          return mockAccountStatus(true);
        });
      }
      case "account_google_sign_in":
        // The real command waits on the browser; the preview pretends the person finished after a moment.
        return mockDelay(2500, () => {
          mockAccountEmail = "you@example.com";
          mockAccountProvider = "google";
          mockAccountDevices = mockSignedInDevices(now);
          return mockAccountStatus(true);
        });
      case "account_sign_out":
        mockAccountEmail = null;
        mockAccountDevices = [];
        return mockAccountStatus(initialized);
      case "account_devices":
        if (mockAccountEmail === null) throw "This Mac isn't signed in to an account.";
        return mockDelay(400, () => mockAccountDevices);
      case "account_remove_device":
        mockAccountDevices = mockAccountDevices.filter((d) => d.id !== args?.deviceId);
        return null;
      case "account_change_password":
        if (String(args?.password ?? "").length < 12) throw "Passwords need at least 12 characters.";
        return mockDelay(1200, () => null);
      default:
        // open_file, reveal_in_finder, open_sync_folder, open_settings, … are no-ops in the browser.
        console.info(`[preview] ${cmd}`, args ?? "");
        return null;
    }
  })();
  return (await out) as T;
}
