import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { Overview } from "./status";
import type { AiConfigResponse, AiConfigUpdate, ConflictItem, MountedVolume, NasTaxonomyScan, RecentFile, RouteDecision, VaultStatus } from "./types";

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
  model: "google/gemini-2.0-flash-001",
  smb_target: "/Volumes/home",
  rules: "Invoices and receipts go to Finance/Invoices\nPhotos and media go to Media/Photos",
  auto_route: true,
  has_api_key: true,
};

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
          mockAiConfig = {
            enabled: payload.enabled,
            model: payload.model,
            smb_target: payload.smb_target,
            rules: payload.rules,
            auto_route: payload.auto_route,
            has_api_key: Boolean(payload.api_key || mockAiConfig.has_api_key),
          };
        }
        return true;
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
        return "/Volumes/Synology/Files";
      case "list_detected_volumes": {
        const vols: MountedVolume[] = [
          { name: "Synology (home)", path: "/Volumes/home" },
          { name: "Synology (data)", path: "/Volumes/data" },
        ];
        return vols;
      }
      default:
        // open_file, reveal_in_finder, open_sync_folder, open_settings, … are no-ops in the browser.
        console.info(`[preview] ${cmd}`, args ?? "");
        return null;
    }
  })();
  return (await out) as T;
}
