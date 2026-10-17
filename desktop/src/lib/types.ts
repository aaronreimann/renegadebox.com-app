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

export type ActivityKind = "upload" | "download" | "delete_remote" | "delete_local" | "rename_remote" | "rename_local" | "moved";

/** One row of the menu bar "Sync history" (mirrors src-tauri/src/activity.rs). */
export interface ActivityItem {
  /** Relative to the RenegadeBox folder, or absolute for drop-folder moves. */
  path: string;
  name: string;
  folder: string;
  kind: ActivityKind;
  status: "active" | "done" | "failed";
  size: number | null;
  started_ms: number;
  finished_ms: number | null;
  destination?: string | null;
}

export interface SyncActivity {
  active: ActivityItem[];
  recent: ActivityItem[];
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

export type AiProvider = "openrouter" | "xai";

export interface AiConfigResponse {
  enabled: boolean;
  provider?: AiProvider | string;
  model: string;
  smb_target: string | null;
  nas_ingest_folder?: string | null;
  rules: string | null;
  auto_route: boolean;
  has_api_key: boolean;
  has_openrouter_key?: boolean;
  has_grok_key?: boolean;
  role_rules?: Record<string, string[]>;
  enabled_roles?: string[];
  vault_routing_enabled?: boolean;
  use_review_folder?: boolean;
  vault_max_file_mb?: number;
  vault_folder?: string;
  rules_backup_count?: number;
  ingest_warning?: string | null;
  /** "move" (default): sort into the destination folder. "organize": sort inside the drop folder and keep files there. */
  routing_mode?: "move" | "organize" | string;
  routing_root?: string | null;
}

export interface AiConfigUpdate {
  enabled: boolean;
  provider?: AiProvider | string;
  model: string;
  smb_target: string | null;
  nas_ingest_folder?: string | null;
  rules: string | null;
  auto_route: boolean;
  api_key?: string | null;
  openrouter_api_key?: string | null;
  grok_api_key?: string | null;
  vault_routing_enabled?: boolean | null;
  use_review_folder?: boolean | null;
  vault_max_file_mb?: number | null;
  routing_mode?: "move" | "organize" | null;
}

export interface NasTransferRecord {
  id: string;
  timestamp: number;
  filename: string;
  source_path: string;
  destination_path: string;
  destination_folder: string;
  rule_matched: string;
  file_size_bytes: number;
  status: "completed" | "relocated" | "reverted";
  route_id?: string | null;
}

export type RouteMode = "move" | "copy" | "organize";

/** One smart route: a source folder sorted into its own destination with its own rules. */
export interface RouteConfig {
  id: string;
  name: string;
  enabled: boolean;
  source: string;
  destination: string;
  mode: RouteMode | string;
  auto: boolean;
  ai: boolean;
  use_review_folder: boolean;
  scan_subfolders: boolean;
  skip_duplicates: boolean;
  vault: boolean;
  rules: string[];
  layout?: string | null;
  template?: string | null;
}

export interface RouteStatus {
  config: RouteConfig;
  is_main: boolean;
  source_exists: boolean;
  destination_reachable: boolean;
  pending_count: number;
  review_count: number;
  problems: string[];
}

export interface RouteTemplate {
  id: string;
  name: string;
  description: string;
  mode: RouteMode | string;
  scan_subfolders: boolean;
  layout: string | null;
  rules: string[];
}

export interface RoutesOverview {
  routes: RouteStatus[];
  templates: RouteTemplate[];
}

/** Route being created or edited in the Smart Routing view. */
export interface RouteEditorState {
  draft: RouteConfig;
  isNew: boolean;
  error?: string | null;
  saving?: boolean;
}

export interface NasStagingStatus {
  ingest_folder: string;
  pending_count: number;
  pending_files: string[];
  nas_accessible: boolean;
  smb_target: string | null;
  review_count?: number;
}

export interface ReviewItem {
  id: string;
  timestamp: number;
  filename: string;
  path: string;
  suggested_folder: string | null;
  confidence: number | null;
  reason: string;
  explanation: string | null;
  file_size_bytes: number;
  route_id?: string | null;
}

export interface RuleSuggestion {
  id: string;
  timestamp: number;
  rule: string;
  example_file: string;
  destination: string;
}

export interface RuleCheck {
  rule: string;
  parses: boolean;
  trigger: string;
  destination: string;
  is_vault: boolean;
  vault_enabled: boolean;
  destination_safe: boolean;
  destination_exists: boolean | null;
  sample_file: string;
  sample_matches: boolean;
  shadowed_by: string | null;
  problems: string[];
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
  suggested_rule?: string | null;
}

export interface MountedVolume {
  name: string;
  path: string;
}

export interface AiVerificationResult {
  originalInput: string;
  optimizedRule: string;
  matchedDestination?: string;
  sampleTestFile?: string;
  confidence?: number;
  explanation?: string;
}

export interface AiUsageEntry {
  id: string;
  timestamp: number;
  operation: "suggest_rules" | "rule_translation" | "file_routing" | "verify_rule" | string;
  operationLabel: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  summary: string;
  /** "provider" = billed cost reported by the API, "estimate" = real tokens priced locally. */
  costSource?: "provider" | "estimate" | "unknown" | "legacy" | string;
}

export interface ApiUsageBreakdown {
  operation: string;
  label: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  percentageOfTotal: number;
}

export interface ModelUsageBreakdown {
  model: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
  percentageOfTotal: number;
}

export interface AiUsageSummary {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  byOperation: ApiUsageBreakdown[];
  byModel: ModelUsageBreakdown[];
  recentEntries: AiUsageEntry[];
  providerReportedRequests?: number;
  estimatedRequests?: number;
  legacyExcluded?: number;
}

/** RenegadeBox account link for this Mac (mirrors src-tauri/src/account.rs). */
export interface AccountStatus {
  signed_in: boolean;
  email: string | null;
  server: string;
  /** Whether this Mac has storage set up. A new account is created from it. */
  device_ready: boolean;
  /** How the account signs in. Older builds leave it out. */
  provider?: AccountProvider | null;
}

export type AccountProvider = "google" | "password";

/** One signed-in Mac on the account. Times are RFC 3339 strings. */
export interface AccountDevice {
  id: string;
  name: string;
  platform: string | null;
  client_version: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  /** True for this Mac. */
  current: boolean;
}

export interface AccountCredentials {
  email: string;
  password: string;
}

export interface AccountSignInPayload extends AccountCredentials {
  /** Where to put the RenegadeBox folder on a new Mac. Defaults to the account's saved folder. */
  folder?: string | null;
}

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

