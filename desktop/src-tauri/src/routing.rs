//! Runs smart routes. Each route watches one source folder and sorts what lands there into
//! its own destination with its own rules, folder layout and mode (move, copy or organize).
//! The original drop folder is the route "main"; see `renegadebox_engine::routes`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use renegadebox_engine::ai;
use renegadebox_engine::config::{Config, Profile};
use renegadebox_engine::routes::{self, RouteConfig, RouteTemplate, MAIN_ROUTE_ID};

use crate::commands::{
    add_rule_suggestion, get_effective_ai_credentials, is_partial_download, json_store_lock, load_review_items, new_id,
    profile_file, read_json_or_default, record_ai_usage, record_nas_transfer, review_plan, run_blocking, send_to_review,
    unix_ms, update_review_items, write_json, AiCredentials, IngestPlan, NasTransferRecord,
};

/// One routing pass at a time; the watcher and "Run now" could otherwise pick up the same file.
fn routing_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

pub fn all_routes(cfg: &Config) -> Vec<RouteConfig> {
    routes::effective_routes(&cfg.ai, &cfg.folder)
}

/// The route a review item or transfer belongs to. Missing id means the main drop folder.
pub fn route_for(cfg: &Config, id: Option<&str>) -> Result<RouteConfig, String> {
    let id = id.unwrap_or(MAIN_ROUTE_ID);
    all_routes(cfg)
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "The route for this file was deleted.".to_string())
}

fn file_name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

// ---------------------------------------------------------------- copy-mode ledger

/// Copy routes leave the original in place, so they remember which versions they already
/// handled. Keys are "path|size|mtime", so an edited file is picked up again.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct StoredSeen {
    routes: HashMap<String, Vec<String>>,
    /// Files the user dismissed from review, per route, in every mode. Same keys as `routes`.
    #[serde(default)]
    dismissed: HashMap<String, Vec<String>>,
}

const SEEN_CAP: usize = 100_000;

fn load_stored_seen() -> StoredSeen {
    profile_file("route_seen.json").map(|p| read_json_or_default(&p)).unwrap_or_default()
}

fn load_seen(route_id: &str) -> HashSet<String> {
    load_stored_seen().routes.get(route_id).map(|v| v.iter().cloned().collect()).unwrap_or_default()
}

fn load_dismissed(route_id: &str) -> HashSet<String> {
    load_stored_seen().dismissed.get(route_id).map(|v| v.iter().cloned().collect()).unwrap_or_default()
}

/// Load the ledger, change it and save it under the shared JSON store lock.
fn update_seen(f: impl FnOnce(&mut StoredSeen) -> bool) {
    let Ok(p) = profile_file("route_seen.json") else { return };
    let _guard = json_store_lock();
    let mut stored: StoredSeen = read_json_or_default(&p);
    if f(&mut stored) {
        write_json(&p, &stored);
    }
}

fn push_capped(list: &mut Vec<String>, keys: &[String]) {
    list.extend(keys.iter().cloned());
    if list.len() > SEEN_CAP {
        let drop = list.len() - SEEN_CAP;
        list.drain(..drop);
    }
}

pub(crate) fn mark_seen(route_id: &str, keys: &[String]) {
    if keys.is_empty() {
        return;
    }
    update_seen(|s| {
        push_capped(s.routes.entry(route_id.to_string()).or_default(), keys);
        true
    });
}

fn forget_route(route_id: &str) {
    update_seen(|s| {
        let a = s.routes.remove(route_id).is_some();
        let b = s.dismissed.remove(route_id).is_some();
        a || b
    });
}

/// Remember a file the user dismissed from review so no route picks it up again
/// (and no new AI call is made for it) until it changes.
pub(crate) fn mark_dismissed(route_id: &str, path: &Path) {
    if let Some(k) = routes::seen_key(path) {
        update_seen(|s| {
            push_capped(s.dismissed.entry(route_id.to_string()).or_default(), &[k]);
            true
        });
    }
}

// ---------------------------------------------------------------- planning

/// Decide what to do with a file whose name matched one of the route's rules.
fn plan_for_rule(cfg: &Config, route: &RouteConfig, dest_root: &Path, dest: &str, rule: &str, size: u64) -> IngestPlan {
    if let Some(sub) = ai::parse_vault_destination(dest) {
        if !route.vault {
            return review_plan(format!("Rule '{rule}' targets the encrypted vault, but vault routing is off"));
        }
        let limit = cfg.ai.vault_max_file_mb.saturating_mul(1024 * 1024);
        if size > limit {
            return review_plan(format!("Larger than the {} MB vault limit", cfg.ai.vault_max_file_mb));
        }
        let Some(folder) = ai::sanitize_relative_folder(sub) else {
            return review_plan(format!("Rule '{rule}' has an unsafe vault folder"));
        };
        if routes::path_within(&cfg.folder.join(&folder), &route.source_path()) {
            return review_plan("Vault folder is inside the source folder, which would loop");
        }
        return IngestPlan::Move { root: cfg.folder.clone(), folder, label: format!("Rule: {rule}"), vault: true };
    }
    match ai::sanitize_relative_folder(dest) {
        Some(folder) => IngestPlan::Move { root: dest_root.to_path_buf(), folder, label: format!("Rule: {rule}"), vault: false },
        None => review_plan(format!("Rule '{rule}' has an unsafe destination")),
    }
}

/// AI credentials for one routing pass, read from the key store at most once, and only
/// when a file actually needs the AI.
pub(crate) struct AiSession<'a> {
    profile: &'a Profile,
    cfg: &'a Config,
    /// Explicit "Run now": a keychain read that failed earlier this session may be retried.
    retry: bool,
    creds: Option<Result<AiCredentials, String>>,
}

impl<'a> AiSession<'a> {
    pub(crate) fn new(profile: &'a Profile, cfg: &'a Config, retry: bool) -> Self {
        Self { profile, cfg, retry, creds: None }
    }

    fn credentials(&mut self) -> Result<&AiCredentials, &str> {
        let (profile, cfg, retry) = (self.profile, self.cfg, self.retry);
        self.creds
            .get_or_insert_with(|| get_effective_ai_credentials(profile, cfg, retry))
            .as_ref()
            .map_err(String::as_str)
    }
}

/// Rules first, then the route's folder layout, then the AI, otherwise review.
#[allow(clippy::too_many_arguments)]
async fn plan_file(
    cfg: &Config,
    ai_session: &mut AiSession<'_>,
    route: &RouteConfig,
    path: &Path,
    filename: &str,
    source_folder: Option<String>,
    size: u64,
    dest_root: &Path,
) -> IngestPlan {
    if let Some((_, dest, rule)) = ai::match_rule_with_index(filename, &route.rules) {
        let dest = if routes::has_tokens(&dest) {
            routes::expand_tokens(&dest, &routes::file_context(path, source_folder, routes::needs_date(&dest)))
        } else {
            dest
        };
        return plan_for_rule(cfg, route, dest_root, &dest, &rule, size);
    }

    if let Some(layout) = route.layout.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        let folder = routes::expand_tokens(layout, &routes::file_context(path, source_folder, routes::needs_date(layout)));
        return match ai::sanitize_relative_folder(&folder) {
            Some(folder) => IngestPlan::Move { root: dest_root.to_path_buf(), folder, label: format!("Layout: {layout}"), vault: false },
            None => review_plan("The folder layout produced an empty folder name"),
        };
    }

    // File names and contents go to the provider only with both switches on.
    if !(cfg.ai.enabled && route.ai) {
        return review_plan("No rule matched and AI routing is turned off");
    }
    let (key, provider, model) = match ai_session.credentials() {
        Ok(c) => c.clone(),
        Err(e) => return review_plan(format!("No rule matched and the AI key is not available: {e}")),
    };
    let rules_text = route.rules.join("\n");
    match ai::route_file_with_provider(&provider, &key, &model, path, dest_root, &rules_text).await {
        Ok((decision, usage)) => {
            let label = if !route.is_main() {
                format!("Route: {}", route.name)
            } else if provider == "xai" {
                "Drop Folder Routing (Grok)".to_string()
            } else {
                "Drop Folder Routing".to_string()
            };
            record_ai_usage(
                "file_routing",
                &label,
                &model,
                &usage,
                &format!("{} -> {} ({:.0}%)", filename, decision.destination_folder, decision.confidence * 100.0),
            );
            // Suggestions are added to the main rules list, so only learn from the main route.
            if route.is_main()
                && let Some(r) = &decision.suggested_rule {
                    add_rule_suggestion(r, filename, &route.rules);
                }
            if decision.confidence < ai::REVIEW_CONFIDENCE_THRESHOLD {
                IngestPlan::Review {
                    reason: format!("AI was only {:.0}% sure", decision.confidence * 100.0),
                    suggested: Some(decision.destination_folder),
                    confidence: Some(decision.confidence),
                    explanation: Some(decision.explanation),
                }
            } else {
                IngestPlan::Move {
                    root: dest_root.to_path_buf(),
                    folder: decision.destination_folder,
                    label: format!("AI ({:.0}%, {model}): {}", decision.confidence * 100.0, decision.explanation),
                    vault: false,
                }
            }
        }
        Err(e) => review_plan(format!("AI call failed: {e}")),
    }
}

// ---------------------------------------------------------------- running routes

/// Run every enabled route (or only `only`). `manual` ignores each route's auto switch.
pub async fn process_routes(cfg: &Config, profile: &Profile, only: Option<&str>, manual: bool) -> Result<Vec<NasTransferRecord>, String> {
    let _guard = routing_lock().lock().await;
    let all = all_routes(cfg);
    let problems = routes::validate_routes(&all);
    let waiting: HashSet<String> = load_review_items().into_iter().map(|i| i.path).collect();
    // Resolved lazily and shared by every route in this pass: at most one key store read.
    let mut ai_session = AiSession::new(profile, cfg, manual);
    let mut out = Vec::new();
    for route in &all {
        if only.is_some_and(|id| id != route.id) {
            continue;
        }
        if !route.enabled || (!manual && !route.auto) {
            continue;
        }
        // The main drop folder keeps its original behavior; extra routes must be valid to run.
        if !route.is_main() {
            let mine: Vec<&str> = problems.iter().filter(|p| p.route_id == route.id).map(|p| p.message.as_str()).collect();
            if !mine.is_empty() {
                if only.is_some() {
                    return Err(mine.join(" "));
                }
                continue;
            }
        }
        out.extend(process_route(cfg, &mut ai_session, route, &waiting).await);
    }
    Ok(out)
}

/// What a file already sorted for a photo means for its sidecars (.xmp and friends).
type Followed = HashMap<(PathBuf, String), (PathBuf, String, String, bool)>;

async fn process_route(cfg: &Config, ai_session: &mut AiSession<'_>, route: &RouteConfig, waiting: &HashSet<String>) -> Vec<NasTransferRecord> {
    let source = route.source_path();
    let Some(dest_root) = route.destination_root() else { return Vec::new() };

    if !source.is_dir() {
        // Drives and shares under /Volumes are never created; the route waits for them.
        if !RouteConfig::on_removable(&source) {
            let _ = std::fs::create_dir_all(&source);
        }
        return Vec::new();
    }
    if !route.organize_in_place() && !dest_root.is_dir() {
        // Files wait in the source while the destination is unplugged or unmounted.
        // Extra routes with a local destination get it created.
        if route.is_main() || RouteConfig::on_removable(&dest_root) || std::fs::create_dir_all(&dest_root).is_err() {
            return Vec::new();
        }
    }

    let copy = route.copy_mode();
    // Never move originals off a card or shared folder just because they need review.
    let use_folder = route.use_review_folder && !copy;
    let route_id = Some(route.id.clone());
    let seen = if copy { load_seen(&route.id) } else { HashSet::new() };
    let dismissed = load_dismissed(&route.id);

    let scan = route.scan_subfolders && !route.organize_in_place();
    let mut files = routes::collect_source_files(&source, scan, is_partial_download);
    files.retain(|f| !waiting.contains(&f.path.to_string_lossy().to_string()));
    // Photos before sidecars, so each sidecar can follow its photo (stable sort keeps name order).
    files.sort_by_key(|f| routes::is_sidecar(&file_name_of(&f.path)));

    let mut followed: Followed = HashMap::new();
    let mut new_seen: Vec<String> = Vec::new();
    let mut records = Vec::new();

    for f in files {
        let path = f.path.clone();
        let filename = file_name_of(&path);
        let key = if copy || !dismissed.is_empty() { routes::seen_key(&path) } else { None };
        if key.as_ref().is_some_and(|k| seen.contains(k) || dismissed.contains(k)) {
            continue;
        }
        let key = if copy { key } else { None };
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let sidecar = routes::is_sidecar(&filename);
        let group = routes::sidecar_key(&path);

        let plan = match followed.get(&group).filter(|_| sidecar) {
            Some((root, folder, label, vault)) => IngestPlan::Move {
                root: root.clone(),
                folder: folder.clone(),
                label: format!("{label} (with its photo)"),
                vault: *vault,
            },
            None => plan_file(cfg, ai_session, route, &path, &filename, f.source_folder.clone(), size, &dest_root).await,
        };

        match plan {
            IngestPlan::Move { root, folder, label, vault } => {
                if !sidecar {
                    followed.insert(group, (root.clone(), folder.clone(), label.clone(), vault));
                }

                // Already at the destination?
                if route.skip_duplicates {
                    let existing = root.join(&folder).join(&filename);
                    if existing.is_file() && routes::same_size_and_mtime(&path, &existing) {
                        if copy {
                            new_seen.extend(key.clone());
                            flush_seen(&route.id, &mut new_seen, false);
                            continue;
                        }
                        // Move mode: delete the original only after a byte-for-byte match.
                        let (a, b) = (path.clone(), existing.clone());
                        let same = tauri::async_runtime::spawn_blocking(move || routes::files_identical(&a, &b).unwrap_or(false))
                            .await
                            .unwrap_or(false);
                        if same && std::fs::remove_file(&path).is_ok() {
                            let rec = transfer(&filename, &path, &existing, &folder, vault, "Already at destination (identical copy), original removed".into(), size, &route_id);
                            record_nas_transfer(rec.clone());
                            records.push(rec);
                            continue;
                        }
                    }
                }

                let target_dir = match ai::create_contained_dir(&root, &folder) {
                    Ok(d) => d,
                    Err(e) => {
                        send_to_review(&source, &path, &filename, size, format!("Could not create folder: {e}"), Some(folder), None, None, use_folder, route_id.clone());
                        continue;
                    }
                };
                let dest_file = ai::pick_free_path(&target_dir, &filename);
                // Copies to a NAS can take minutes; keep them off the async workers.
                let (src_p, dest_p) = (path.clone(), dest_file.clone());
                let result = tauri::async_runtime::spawn_blocking(move || {
                    if copy {
                        ai::copy_file_verified(&src_p, &dest_p).map(|_| true).map_err(|e| format!("{e:#}"))
                    } else {
                        ai::move_file_verified(&src_p, &dest_p).map_err(|e| format!("{e:#}"))
                    }
                })
                .await
                .unwrap_or_else(|e| Err(format!("background task failed: {e}")));

                match result {
                    Ok(source_removed) => {
                        let label = if copy {
                            format!("{label} (copied, original kept)")
                        } else if source_removed {
                            label
                        } else {
                            format!("{label} (copied and verified, but the original could not be deleted)")
                        };
                        let rec = transfer(&filename, &path, &dest_file, &folder, vault, label, size, &route_id);
                        record_nas_transfer(rec.clone());
                        records.push(rec);
                        new_seen.extend(key);
                    }
                    Err(e) => {
                        // Send to review so a failing copy does not trigger a new AI call every pass.
                        send_to_review(&source, &path, &filename, size, format!("Move failed: {e}"), Some(folder), None, None, use_folder, route_id.clone());
                    }
                }
            }
            IngestPlan::Review { reason, suggested, confidence, explanation } => {
                send_to_review(&source, &path, &filename, size, reason, suggested, confidence, explanation, use_folder, route_id.clone());
            }
        }
        flush_seen(&route.id, &mut new_seen, false);
    }
    flush_seen(&route.id, &mut new_seen, true);
    records
}

/// Write the copy ledger in batches so a long import does not rewrite it for every file.
fn flush_seen(route_id: &str, pending: &mut Vec<String>, force: bool) {
    if pending.len() >= 25 || (force && !pending.is_empty()) {
        mark_seen(route_id, pending);
        pending.clear();
    }
}

#[allow(clippy::too_many_arguments)]
fn transfer(
    filename: &str,
    src: &Path,
    dest: &Path,
    folder: &str,
    vault: bool,
    label: String,
    size: u64,
    route_id: &Option<String>,
) -> NasTransferRecord {
    NasTransferRecord {
        id: new_id("tx"),
        timestamp: unix_ms(),
        filename: filename.to_string(),
        source_path: src.to_string_lossy().to_string(),
        destination_path: dest.to_string_lossy().to_string(),
        destination_folder: if vault { format!("vault:{folder}") } else { folder.to_string() },
        rule_matched: label,
        file_size_bytes: size,
        status: "completed".to_string(),
        route_id: route_id.clone(),
    }
}

// ---------------------------------------------------------------- commands

#[derive(Serialize, Clone, Debug)]
pub struct RouteStatus {
    pub config: RouteConfig,
    pub is_main: bool,
    pub source_exists: bool,
    pub destination_reachable: bool,
    pub pending_count: usize,
    pub review_count: usize,
    pub problems: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct RoutesOverview {
    pub routes: Vec<RouteStatus>,
    pub templates: Vec<RouteTemplate>,
}

fn overview(cfg: &Config) -> RoutesOverview {
    let all = all_routes(cfg);
    let problems = routes::validate_routes(&all);
    let review = load_review_items();
    let statuses = all
        .iter()
        .map(|r| {
            let source = r.source_path();
            let source_exists = source.is_dir();
            let destination_reachable = r.destination_root().is_some_and(|d| d.is_dir());
            let pending_count = if source_exists {
                let mut seen = if r.copy_mode() { load_seen(&r.id) } else { HashSet::new() };
                seen.extend(load_dismissed(&r.id));
                let waiting: HashSet<&str> = review.iter().map(|i| i.path.as_str()).collect();
                routes::collect_source_files(&source, r.scan_subfolders && !r.organize_in_place(), is_partial_download)
                    .iter()
                    .filter(|f| !waiting.contains(f.path.to_string_lossy().as_ref()))
                    .filter(|f| seen.is_empty() || !routes::seen_key(&f.path).is_some_and(|k| seen.contains(&k)))
                    .count()
            } else {
                0
            };
            let review_count = review.iter().filter(|i| i.route_id.as_deref().unwrap_or(MAIN_ROUTE_ID) == r.id).count();
            RouteStatus {
                config: r.clone(),
                is_main: r.is_main(),
                source_exists,
                destination_reachable,
                pending_count,
                review_count,
                problems: problems.iter().filter(|p| p.route_id == r.id).map(|p| p.message.clone()).collect(),
            }
        })
        .collect();
    RoutesOverview { routes: statuses, templates: routes::route_templates() }
}

#[tauri::command]
pub async fn get_routes() -> Result<RoutesOverview, String> {
    run_blocking(|| {
        let profile = Profile::locate().map_err(|e| e.to_string())?;
        let cfg = profile.load().map_err(|e| e.to_string())?;
        Ok(overview(&cfg))
    })
    .await
}

/// Tidy what the editor sent: trimmed paths, no blank rules, empty layout means none.
fn clean_route(mut r: RouteConfig) -> RouteConfig {
    r.name = r.name.trim().to_string();
    r.source = r.source.trim().trim_end_matches('/').to_string();
    r.destination = r.destination.trim().trim_end_matches('/').to_string();
    r.rules = r.rules.iter().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    r.layout = r.layout.map(|l| l.trim().trim_matches('/').to_string()).filter(|l| !l.is_empty());
    if r.organize_in_place() {
        r.destination.clear();
    }
    r
}

/// Both the lexical path and, when it exists, the resolved one (symlinks, `..`).
fn path_forms(p: &Path) -> Vec<PathBuf> {
    let mut v = vec![p.to_path_buf()];
    if let Ok(c) = p.canonicalize()
        && c != p {
            v.push(c);
        }
    v
}

/// A route source is emptied by the route. It must not be `/`, the home folder (or above
/// it), or overlap the sync folder; the only exception is the root-level "To NAS" drop
/// folder inside the sync folder.
fn check_route_source(cfg: &Config, source: &Path) -> Result<(), String> {
    if !source.is_absolute() {
        return Ok(()); // validate_routes reports a missing source folder.
    }
    let sources = path_forms(source);
    if sources.iter().any(|s| s.parent().is_none()) {
        return Err("The source folder can not be the whole disk.".to_string());
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from)
        && sources.iter().any(|s| path_forms(&home).iter().any(|h| routes::path_within(h, s))) {
            return Err("The source folder can not be your home folder or a folder that contains it.".to_string());
        }
    let vaults = path_forms(&cfg.folder);
    let drop_folders: Vec<PathBuf> = vaults.iter().map(|v| v.join("To NAS")).collect();
    for s in &sources {
        if drop_folders.iter().any(|d| routes::path_within(s, d)) {
            continue;
        }
        if vaults.iter().any(|v| routes::path_within(s, v) || routes::path_within(v, s)) {
            return Err(
                "The source folder overlaps your RenegadeBox folder, so the route would move synced files. Use the 'To NAS' folder or a folder outside RenegadeBox."
                    .to_string(),
            );
        }
    }
    Ok(())
}

/// Add or update an extra route. Rejected when it would clash with any other route.
pub fn save_route_in(cfg: &mut Config, route: RouteConfig) -> Result<RouteConfig, String> {
    if route.is_main() {
        return Err("The main drop folder is set up in the settings below.".to_string());
    }
    let mut route = clean_route(route);
    check_route_source(cfg, &route.source_path())?;
    let before = routes::validate_routes(&all_routes(cfg));
    if route.id.trim().is_empty() {
        route.id = routes::make_route_id(&route.name, &all_routes(cfg));
    }
    match cfg.ai.routes.iter_mut().find(|r| r.id == route.id) {
        Some(existing) => *existing = route.clone(),
        None => cfg.ai.routes.push(route.clone()),
    }
    let after = routes::validate_routes(&all_routes(cfg));
    let new_problems: Vec<String> = after
        .iter()
        .filter(|p| p.route_id == route.id || !before.contains(p))
        .map(|p| p.message.clone())
        .collect();
    if !new_problems.is_empty() {
        return Err(new_problems.join(" "));
    }
    Ok(route)
}

#[tauri::command]
pub async fn save_route(route: RouteConfig) -> Result<RouteConfig, String> {
    run_blocking(move || {
        let profile = Profile::locate().map_err(|e| e.to_string())?;
        let mut cfg = profile.load().map_err(|e| e.to_string())?;
        let saved = save_route_in(&mut cfg, route)?;
        profile.save(&cfg).map_err(|e| format!("Failed to save config: {e}"))?;
        let source = saved.source_path();
        if !source.exists() && !RouteConfig::on_removable(&source) {
            std::fs::create_dir_all(&source).map_err(|e| format!("Saved, but could not create the source folder: {e}"))?;
        }
        Ok(saved)
    })
    .await
}

#[tauri::command]
pub async fn delete_route(route_id: String) -> Result<(), String> {
    run_blocking(move || {
        if route_id == MAIN_ROUTE_ID {
            return Err("The main drop folder cannot be deleted.".to_string());
        }
        let profile = Profile::locate().map_err(|e| e.to_string())?;
        let mut cfg = profile.load().map_err(|e| e.to_string())?;
        let before = cfg.ai.routes.len();
        cfg.ai.routes.retain(|r| r.id != route_id);
        if cfg.ai.routes.len() == before {
            return Err("Route not found.".to_string());
        }
        profile.save(&cfg).map_err(|e| format!("Failed to save config: {e}"))?;
        forget_route(&route_id);
        // Files stay where they are; only the list entries go.
        update_review_items(|items| items.retain(|i| i.route_id.as_deref() != Some(route_id.as_str())));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn run_route_now(route_id: String) -> Result<Vec<NasTransferRecord>, String> {
    let profile = Profile::locate().map_err(|e| e.to_string())?;
    let cfg = profile.load().map_err(|e| e.to_string())?;
    if !all_routes(&cfg).iter().any(|r| r.id == route_id) {
        return Err("Route not found.".to_string());
    }
    process_routes(&cfg, &profile, Some(&route_id), true).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(id: &str, src: &Path, dest: &Path, mode: &str) -> RouteConfig {
        RouteConfig {
            id: id.into(),
            name: id.into(),
            enabled: true,
            source: src.to_string_lossy().to_string(),
            destination: dest.to_string_lossy().to_string(),
            mode: mode.into(),
            auto: true,
            ai: false,
            use_review_folder: true,
            scan_subfolders: true,
            skip_duplicates: true,
            vault: false,
            rules: vec![],
            layout: None,
            template: None,
        }
    }

    fn files_under(dir: &Path) -> Vec<String> {
        fn walk(base: &Path, dir: &Path, out: &mut Vec<String>) {
            for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(base, &p, out);
                } else {
                    out.push(p.strip_prefix(base).unwrap().to_string_lossy().to_string());
                }
            }
        }
        let mut out = Vec::new();
        walk(dir, dir, &mut out);
        out.sort();
        out
    }

    /// One test so RBOX_HOME (process-wide) is only set once.
    #[tokio::test]
    async fn routes_copy_move_sidecars_and_duplicates() {
        let root = std::env::temp_dir().join(format!("rbox-routes-{}", uuid::Uuid::new_v4()));
        let home = root.join("profile");
        std::fs::create_dir_all(&home).unwrap();
        // SAFETY: only this test touches RBOX_HOME in this crate.
        unsafe { std::env::set_var("RBOX_HOME", &home) };
        let profile = Profile::locate().unwrap();
        let mut cfg = Config {
            folder: root.join("RenegadeBox"),
            bucket: String::new(),
            region: String::new(),
            endpoint: None,
            access_key_id: String::new(),
            device_id: String::new(),
            device_name: String::new(),
            key_store: renegadebox_engine::config::KeyStoreKind::InsecureFile,
            vault_pin: String::new(),
            hub_url: None,
            ai: Default::default(),
            account: None,
        };
        // Main route has no destination, so it does nothing.
        cfg.ai.auto_route = true;

        // Copy route: photos from a "card" into dated shoot folders, sidecars follow.
        let card = root.join("card");
        let shoots = root.join("shoots");
        std::fs::create_dir_all(card.join("Smith Wedding")).unwrap();
        std::fs::write(card.join("Smith Wedding/IMG_1.CR2"), b"raw").unwrap();
        std::fs::write(card.join("Smith Wedding/IMG_1.xmp"), b"side").unwrap();
        std::fs::write(card.join("clip.mov"), b"video").unwrap();
        let mut photo = route("photos", &card, &shoots, routes::MODE_COPY);
        photo.layout = Some("Shoots/{source_folder}".into());
        photo.rules = vec!["*.mov go to Video".into()];
        cfg.ai.routes = vec![photo.clone()];

        let first = process_routes(&cfg, &profile, None, false).await.unwrap();
        assert_eq!(first.len(), 3, "{first:?}");
        assert_eq!(files_under(&shoots), vec!["Shoots/Smith Wedding/IMG_1.CR2", "Shoots/Smith Wedding/IMG_1.xmp", "Video/clip.mov"]);
        assert!(card.join("Smith Wedding/IMG_1.CR2").exists(), "copy mode keeps originals");
        assert!(first.iter().all(|r| r.route_id.as_deref() == Some("photos")));

        // Second pass: nothing new is copied.
        let second = process_routes(&cfg, &profile, None, false).await.unwrap();
        assert!(second.is_empty(), "{second:?}");

        // Forgetting the ledger still skips files already at the destination.
        forget_route("photos");
        let third = process_routes(&cfg, &profile, None, false).await.unwrap();
        assert!(third.is_empty(), "{third:?}");
        assert_eq!(files_under(&shoots).len(), 3);

        // Move route: identical duplicate removes the original; a different file is kept with a new name.
        let inbox = root.join("inbox");
        let docs = root.join("docs");
        std::fs::create_dir_all(&inbox).unwrap();
        std::fs::create_dir_all(docs.join("Finance")).unwrap();
        std::fs::write(inbox.join("invoice-1.pdf"), b"same").unwrap();
        ai::copy_data_only(&inbox.join("invoice-1.pdf"), &docs.join("Finance/invoice-1.pdf")).unwrap();
        std::fs::write(inbox.join("invoice-2.pdf"), b"new").unwrap();
        std::fs::write(inbox.join("random.bin"), b"?").unwrap();
        let mut mover = route("docs", &inbox, &docs, routes::MODE_MOVE);
        mover.rules = vec!["invoice go to Finance".into()];
        mover.scan_subfolders = false;
        cfg.ai.routes = vec![photo, mover];

        let moved = process_routes(&cfg, &profile, Some("docs"), true).await.unwrap();
        assert_eq!(moved.len(), 2, "{moved:?}");
        assert!(moved.iter().any(|r| r.rule_matched.starts_with("Already at destination")));
        assert_eq!(files_under(&docs), vec!["Finance/invoice-1.pdf", "Finance/invoice-2.pdf"]);
        // No rule, no AI: goes to review inside the route's own source.
        assert!(inbox.join("_Needs Review/random.bin").exists());
        let review = load_review_items();
        assert!(review.iter().any(|i| i.filename == "random.bin" && i.route_id.as_deref() == Some("docs")));

        // A route whose source sits inside another route's destination is refused.
        let mut bad = route("bad", &shoots.join("Video"), &root.join("x"), routes::MODE_MOVE);
        bad.id = String::new();
        bad.name = "Bad".into();
        assert!(save_route_in(&mut cfg, bad).unwrap_err().contains("bounce"));
        assert!(save_route_in(&mut cfg, route("main", &inbox, &docs, routes::MODE_MOVE)).is_err());

        // Sources that overlap the sync folder, or the whole disk, are refused.
        std::fs::create_dir_all(cfg.folder.join("Work")).unwrap();
        for src in [cfg.folder.clone(), cfg.folder.join("Work"), root.clone(), PathBuf::from("/")] {
            let mut r = route("", &src, &root.join("elsewhere"), routes::MODE_MOVE);
            r.name = "Overlap".into();
            assert!(save_route_in(&mut cfg, r).is_err(), "{} should be refused", src.display());
        }

        // A route with AI on still makes no AI call while the global AI switch is off, and a
        // dismissed file that stays in place is not picked up again.
        let loose = root.join("loose");
        std::fs::create_dir_all(&loose).unwrap();
        std::fs::write(loose.join("mystery.dat"), b"?").unwrap();
        let mut keep = route("loose", &loose, &root.join("sorted"), routes::MODE_MOVE);
        keep.ai = true;
        keep.use_review_folder = false;
        cfg.ai.enabled = false;
        cfg.ai.routes = vec![keep];
        assert!(process_routes(&cfg, &profile, Some("loose"), true).await.unwrap().is_empty());
        let item = load_review_items().into_iter().find(|i| i.filename == "mystery.dat").unwrap();
        assert!(item.reason.contains("AI routing is turned off"), "{}", item.reason);
        assert!(loose.join("mystery.dat").exists(), "left in place without a review folder");
        crate::commands::dismiss_review_item(item.id.clone()).await.unwrap();
        process_routes(&cfg, &profile, Some("loose"), true).await.unwrap();
        assert!(!load_review_items().iter().any(|i| i.filename == "mystery.dat"), "dismissed file came back");

        unsafe { std::env::remove_var("RBOX_HOME") };
        let _ = std::fs::remove_dir_all(&root);
    }
}
