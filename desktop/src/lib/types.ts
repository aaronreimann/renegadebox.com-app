// Shapes returned by the Rust commands in src-tauri/src/commands.rs.

export interface VaultStatus {
  initialized: boolean;
  folder: string | null;
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  device_id: string | null;
  device_name: string | null;
  hub_url: string | null;
  key_store: string | null;
  total_files: number;
  pending_changes: number;
  total_bytes: number;
}

export interface RecentFile {
  /** Path relative to the RenegadeBox folder. */
  path: string;
  name: string;
  /** Parent folder relative to the RenegadeBox folder ("" for the top level). */
  folder: string;
  modified_ms: number;
}

export interface ConflictItem {
  /** Path of the conflicted copy, relative to the RenegadeBox folder. Never rendered. */
  path: string;
  original_name: string;
  folder: string;
  /** Device that saved the other version, when known. */
  device: string | null;
  modified_ms: number;
}

export type Resolution = "keep_both" | "keep_conflicted" | "keep_local";

export interface AiConfigResponse {
  enabled: boolean;
  model: string;
  smb_target: string | null;
  rules: string | null;
  auto_route: boolean;
  has_api_key: boolean;
}

export interface AiConfigUpdate {
  enabled: boolean;
  model: string;
  smb_target: string | null;
  rules: string | null;
  auto_route: boolean;
  api_key?: string | null;
}

export interface NasTaxonomyScan {
  root: string;
  directories: string[];
}

export interface RouteDecision {
  destination_folder: string;
  suggested_filename: string;
  confidence: number;
  explanation: string;
}

export interface MountedVolume {
  name: string;
  path: string;
}

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
