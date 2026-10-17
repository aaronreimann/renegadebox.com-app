//! Smart Synology NAS & SMB file routing powered by OpenRouter.ai.
//!
//! Analyzes incoming files (metadata and lightweight text snippets) and routes
//! them into the appropriate destination directory on an SMB share or local NAS mount
//! based on user-defined organizational rules and discovered NAS folder taxonomy.

use std::path::{Path, PathBuf};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

/// Cheapest capable non-reasoning model on OpenRouter as of 2026-10 ($0.10 in / $0.40 out per 1M).
pub const DEFAULT_AI_MODEL: &str = "google/gemini-2.5-flash-lite";
/// Cheapest non-reasoning model on xAI's direct API as of 2026-10 ($1.25 in / $2.50 out per 1M).
pub const DEFAULT_GROK_MODEL: &str = "grok-4.20-non-reasoning";
pub const OPENROUTER_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
pub const XAI_API_URL: &str = "https://api.x.ai/v1/chat/completions";

/// Map retired model IDs saved in older configs to current equivalents.
pub fn normalize_model(model: &str) -> String {
    let m = model.trim();
    match m {
        "google/gemini-2.0-flash-001" | "google/gemini-2.0-flash" | "google/gemini-flash-1.5" => DEFAULT_AI_MODEL.to_string(),
        "grok-2-mini" | "grok-2" | "grok-2-latest" | "grok-beta" | "grok-3-mini" | "grok-3" => DEFAULT_GROK_MODEL.to_string(),
        "x-ai/grok-2-mini" | "x-ai/grok-2" | "x-ai/grok-3-mini" => "x-ai/grok-4.20".to_string(),
        "anthropic/claude-3.5-haiku" => "anthropic/claude-haiku-4.5".to_string(),
        "" => DEFAULT_AI_MODEL.to_string(),
        other => other.to_string(),
    }
}

/// New setups use Grok with the person's own xAI key.
fn default_provider() -> String {
    "xai".to_string()
}

/// Configuration for the AI-assisted Synology/SMB file router.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AiRouterConfig {
    /// Whether the smart router is active.
    #[serde(default)]
    pub enabled: bool,
    /// AI provider: "openrouter" or "xai"
    #[serde(default = "default_provider")]
    pub provider: String,
    /// Model identifier (e.g. google/gemini-2.0-flash-001, grok-2-mini, anthropic/claude-3.5-haiku).
    #[serde(default = "default_model")]
    pub model: String,
    /// Destination SMB share path or mount point (e.g. "/Volumes/Synology/Files").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smb_target: Option<String>,
    /// Local staging directory for incoming NAS files (e.g. "/Users/me/RenegadeBox/To NAS").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nas_ingest_folder: Option<String>,
    /// User's natural language instructions describing how directories are organized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    /// If true, files dropped in the drop folder are processed automatically; if false, only on "Process Now".
    #[serde(default = "default_true")]
    pub auto_route: bool,
    /// "move" (default): sort files into the destination folder.
    /// "organize": sort files into subfolders inside the drop folder itself and leave them there.
    #[serde(default = "default_routing_mode")]
    pub routing_mode: String,
    /// Rules grouped by role (e.g. "developer" -> [...]). Single source of truth for the UI.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub role_rules: std::collections::BTreeMap<String, Vec<String>>,
    /// Roles whose rules are active. `rules` holds the aggregate of these.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub enabled_roles: Vec<String>,
    /// Opt-in: allow rules with a `vault:<folder>` destination to move files into the
    /// encrypted vault folder (which syncs to S3). Off by default. AI never chooses this.
    #[serde(default)]
    pub vault_routing_enabled: bool,
    /// Files larger than this are sent to review instead of the vault.
    #[serde(default = "default_vault_max_file_mb")]
    pub vault_max_file_mb: u64,
    /// true (default): files that cannot be sorted are moved into a `_Needs Review` subfolder.
    /// false: they stay where they were dropped and are only listed for review.
    #[serde(default = "default_true")]
    pub use_review_folder: bool,
    /// Extra routes beyond the main drop folder (which is built from the fields above).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<crate::routes::RouteConfig>,
}

fn default_vault_max_file_mb() -> u64 {
    500
}

pub const ROUTING_MODE_MOVE: &str = "move";
pub const ROUTING_MODE_ORGANIZE: &str = "organize";

fn default_routing_mode() -> String {
    ROUTING_MODE_MOVE.to_string()
}

fn default_true() -> bool {
    true
}

impl AiRouterConfig {
    /// True when files should be sorted inside the drop folder instead of moved to the destination.
    pub fn organize_in_place(&self) -> bool {
        self.routing_mode == ROUTING_MODE_ORGANIZE
    }
}

fn default_model() -> String {
    DEFAULT_GROK_MODEL.to_string()
}

/// A model that belongs to `provider`: xAI's direct API only knows bare Grok ids, and
/// OpenRouter only knows `vendor/model` ids. A mismatch falls back to that provider's default.
pub fn model_for_provider(provider: &str, model: &str) -> String {
    let model = normalize_model(model);
    if provider.eq_ignore_ascii_case("xai") {
        if model.contains('/') || !model.to_lowercase().starts_with("grok") { DEFAULT_GROK_MODEL.to_string() } else { model }
    } else if model.contains('/') {
        model
    } else {
        DEFAULT_AI_MODEL.to_string()
    }
}

impl Default for AiRouterConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: default_provider(),
            model: default_model(),
            smb_target: None,
            nas_ingest_folder: None,
            rules: None,
            auto_route: true,
            routing_mode: default_routing_mode(),
            role_rules: Default::default(),
            enabled_roles: Vec::new(),
            vault_routing_enabled: false,
            vault_max_file_mb: default_vault_max_file_mb(),
            use_review_folder: true,
            routes: Vec::new(),
        }
    }
}

/// Lightweight metadata extracted from an incoming file to guide routing.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileMetadata {
    pub filename: String,
    pub extension: Option<String>,
    pub size_bytes: u64,
    pub text_snippet: Option<String>,
}

/// The decision produced by OpenRouter.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RouteDecision {
    /// Destination directory relative to the SMB root (e.g. "Work/Clients/Acme").
    pub destination_folder: String,
    /// Normalized or cleaned filename (e.g. "2026-10-Invoice-1042.pdf").
    pub suggested_filename: String,
    /// Confidence score between 0.0 and 1.0.
    pub confidence: f32,
    /// Plain-language reasoning for why the AI chose this destination.
    pub explanation: String,
    /// Optional reusable rule proposed by the model (e.g. "*.stl go to 3D/Models").
    /// Only kept when it parses and actually matches the original filename.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggested_rule: Option<String>,
}

/// Token usage and (when the provider reports it) real cost of a single AI call.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct AiUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    /// Cost in USD as reported by the provider. None means the provider did not report it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_usd: Option<f64>,
}

/// Raw content plus usage from a chat completion call.
#[derive(Clone, Debug)]
pub struct ChatCompletion {
    pub content: String,
    pub usage: AiUsage,
}

/// Confidence below this value sends a file to the review queue instead of moving it.
pub const REVIEW_CONFIDENCE_THRESHOLD: f32 = 0.7;
/// Maximum number of rules sent to the model per routing call.
pub const MAX_RULES_IN_PROMPT: usize = 25;
/// Maximum folder depth accepted from the model.
pub const MAX_FOLDER_DEPTH: usize = 6;

/// Result of executing or dry-running a routing decision.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RouteResult {
    pub source_path: String,
    pub destination_path: String,
    pub moved: bool,
    pub explanation: String,
}

/// Extract lightweight metadata and an initial text snippet from a local file.
/// Never reads more than `max_bytes` to keep memory and token usage low.
pub fn extract_metadata(path: &Path, max_bytes: usize) -> Result<FileMetadata> {
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let extension = path.extension().map(|e| e.to_string_lossy().to_string());
    let meta = std::fs::metadata(path).with_context(|| format!("reading metadata of {}", path.display()))?;
    let size_bytes = meta.len();

    let text_snippet = if meta.is_file() && size_bytes > 0 {
        read_text_snippet(path, max_bytes)
    } else {
        None
    };

    Ok(FileMetadata {
        filename,
        extension,
        size_bytes,
        text_snippet,
    })
}

fn read_text_snippet(path: &Path, max_bytes: usize) -> Option<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path).ok()?;
    let mut buffer = vec![0u8; max_bytes.min(4096)];
    let bytes_read = file.read(&mut buffer).ok()?;
    if bytes_read == 0 {
        return None;
    }
    buffer.truncate(bytes_read);

    // If UTF-8, sanitize control characters and return up to 2KB
    if let Ok(s) = std::str::from_utf8(&buffer) {
        let clean: String = s
            .chars()
            .filter(|c| !c.is_control() || *c == '\n' || *c == '\t' || *c == '\r')
            .take(2000)
            .collect();
        let trimmed = clean.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Recursively scan an SMB root or local folder up to `max_depth` to discover the folder taxonomy.
/// Filters out system, trash, and metadata directories (e.g. Synology `@eaDir`, `#recycle`, `.git`, `.DS_Store`).
pub fn scan_nas_taxonomy(root: &Path, max_depth: usize) -> Result<Vec<String>> {
    if !root.exists() {
        bail!("Directory {} does not exist or is not mounted", root.display());
    }
    let mut results = Vec::new();
    walk_dirs(root, root, 0, max_depth, &mut results)?;
    results.sort();
    Ok(results)
}

fn walk_dirs(base: &Path, current: &Path, current_depth: usize, max_depth: usize, out: &mut Vec<String>) -> Result<()> {
    if current_depth >= max_depth || out.len() >= 150 {
        return Ok(());
    }
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return Ok(()), // Skip unreadable or permission-denied directories
    };

    for entry in entries.flatten() {
        if out.len() >= 150 {
            break;
        }
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        // Ignore hidden and system/NAS specific folders, photo libraries, and package bundles
        if name.starts_with('.')
            || name.starts_with('@')      // Synology thumbnails & metadata (@eaDir)
            || name.starts_with('#')      // Synology recycle bins (#recycle)
            || name.eq_ignore_ascii_case("node_modules")
            || name.eq_ignore_ascii_case("target")
            || name.eq_ignore_ascii_case("$RECYCLE.BIN")
            || name.eq_ignore_ascii_case("iPhoto Library")
            || name.ends_with(".photoslibrary")
            || name.ends_with(".photolibrary")
            || name.ends_with(".app")
            || name.ends_with(".pkg")
            || name.ends_with(".framework")
        {
            continue;
        }

        let child_path = entry.path();
        if let Ok(rel) = child_path.strip_prefix(base) {
            let rel_str = rel.to_string_lossy().to_string();
            if !rel_str.is_empty() {
                out.push(rel_str);
            }
        }
        walk_dirs(base, &child_path, current_depth + 1, max_depth, out)?;
    }
    Ok(())
}

/// Infer a high-level file format category to assist the LLM when encountering novel/uncommon file types.
pub fn infer_format_category(extension: Option<&str>, filename: &str) -> &'static str {
    let ext = extension.unwrap_or("").to_lowercase();
    let lower_name = filename.to_lowercase();

    if ext == "sql" || ext == "sql.gz" || ext == "dump" || ext == "sqlite" || ext == "db" || lower_name.contains("dump") {
        "Database Backup / Export"
    } else if ext == "tar" || ext == "tar.gz" || ext == "tgz" || ext == "zip" || ext == "7z" || ext == "bz2" || ext == "wpress" || ext == "gz" || ext == "zst" {
        "Archive / Site Backup"
    } else if ext == "blend" || ext == "obj" || ext == "fbx" || ext == "stl" || ext == "dae" || ext == "gltf" || ext == "glb" || ext == "3ds" || ext == "c4d" || ext == "ma" || ext == "mb" {
        "3D Asset / Mesh / Model"
    } else if ext == "step" || ext == "stp" || ext == "iges" || ext == "igs" || ext == "dwg" || ext == "dxf" || ext == "cad" || ext == "sldprt" || ext == "sldasm" {
        "CAD / Engineering Blueprint"
    } else if ext == "psd" || ext == "ai" || ext == "sketch" || ext == "fig" || ext == "xd" || ext == "svg" || ext == "eps" || ext == "indd" || ext == "afphoto" || ext == "afdesign" {
        "Graphic Design / Vector Artwork"
    } else if ext == "raw" || ext == "cr2" || ext == "cr3" || ext == "nef" || ext == "arw" || ext == "dng" || ext == "jpg" || ext == "jpeg" || ext == "png" || ext == "webp" || ext == "heic" || ext == "tiff" {
        "Photo / Image Media"
    } else if ext == "mov" || ext == "mp4" || ext == "mkv" || ext == "avi" || ext == "webm" || ext == "m4v" || ext == "prores" || ext == "braw" || ext == "r3d" {
        "Video / Raw Footage"
    } else if ext == "wav" || ext == "mp3" || ext == "flac" || ext == "aif" || ext == "aiff" || ext == "m4a" || ext == "ogg" || ext == "aac" || ext == "mid" || ext == "midi" {
        "Audio / Stem Recording"
    } else if ext == "pdf" || ext == "doc" || ext == "docx" || ext == "pages" || ext == "rtf" || ext == "odt" || ext == "txt" || ext == "md" || ext == "markdown" {
        "Document / Text"
    } else if ext == "csv" || ext == "xlsx" || ext == "xls" || ext == "parquet" || ext == "numbers" || ext == "tsv" || ext == "feather" {
        "Spreadsheet / Tabular Data"
    } else if ext == "iso" || ext == "dmg" || ext == "img" || ext == "vmdk" || ext == "qcow2" || ext == "vdi" {
        "Disk Image / Virtual Machine Appliance"
    } else if ext == "rs" || ext == "ts" || ext == "js" || ext == "py" || ext == "go" || ext == "rb" || ext == "php" || ext == "java" || ext == "c" || ext == "cpp" || ext == "h" || ext == "json" || ext == "yaml" || ext == "yml" || ext == "toml" || ext == "xml" || ext == "ipynb" {
        "Source Code / Developer Project"
    } else {
        "File"
    }
}

/// The endpoint is chosen by the provider the user picked, never guessed from the model name:
/// the API key in hand belongs to that provider, and sending it elsewhere leaks it.
pub fn resolve_api_endpoint(provider: &str, _model: &str) -> (&'static str, &'static str) {
    if provider.eq_ignore_ascii_case("xai") {
        (XAI_API_URL, "xAI Grok")
    } else {
        (OPENROUTER_API_URL, "OpenRouter")
    }
}

/// HTTP client for AI providers. A stalled provider must not hold up file routing forever.
pub fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .context("building HTTP client")
}

pub async fn execute_chat_completion(
    client: &reqwest::Client,
    provider: &str,
    model: &str,
    api_key: &str,
    body: &serde_json::Value,
) -> Result<ChatCompletion> {
    if api_key.trim().is_empty() {
        bail!("API key is required");
    }
    let (url, provider_name) = resolve_api_endpoint(provider, model);
    // Ask OpenRouter to include the real billed cost in the response.
    let mut body = body.clone();
    if url == OPENROUTER_API_URL
        && let Some(obj) = body.as_object_mut() {
            obj.insert("usage".to_string(), serde_json::json!({ "include": true }));
        }
    let body = &body;
    let mut req = client
        .post(url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json");

    if url == OPENROUTER_API_URL {
        req = req
            .header("HTTP-Referer", "https://renegadebox.com")
            .header("X-Title", "RenegadeBox Synology AI");
    }

    let resp = req
        .json(body)
        .send()
        .await
        .with_context(|| format!("sending request to {provider_name}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        bail!("{provider_name} API error (status {status}): {err_text}");
    }

    let resp_json: serde_json::Value = resp.json().await.with_context(|| format!("parsing {provider_name} JSON response"))?;
    let content = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow!("missing message content in {provider_name} response"))?;

    Ok(ChatCompletion {
        content: content.to_string(),
        usage: parse_usage(&resp_json),
    })
}

/// Read the `usage` block of an OpenAI-compatible response.
pub fn parse_usage(resp_json: &serde_json::Value) -> AiUsage {
    let u = &resp_json["usage"];
    let cost_usd = u["cost"].as_f64().or_else(|| {
        // xAI reports cost in "ticks" of 1e-10 USD on some responses.
        u["cost_in_usd_ticks"].as_f64().map(|t| t / 10_000_000_000.0)
    });
    AiUsage {
        prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0),
        completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
        cost_usd,
    }
}

/// Pick the rules most relevant to a filename so the prompt stays small and cheap.
/// Rules are scored by extension and keyword overlap; at most `max` are returned.
pub fn select_relevant_rules(filename: &str, rules: &[String], max: usize) -> Vec<String> {
    let lower = filename.to_lowercase();
    let ext = Path::new(&lower).extension().map(|e| e.to_string_lossy().to_string());
    let tokens: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3)
        .collect();

    let mut scored: Vec<(usize, usize, &String)> = rules
        .iter()
        .enumerate()
        .filter(|(_, r)| !r.trim().is_empty())
        .filter_map(|(i, r)| {
            let rl = r.to_lowercase();
            let mut score = 0usize;
            if let Some(e) = &ext
                && (rl.contains(&format!("*.{e}")) || rl.contains(&format!(".{e} "))) {
                    score += 3;
                }
            for t in &tokens {
                if rl.contains(t) {
                    score += 1;
                }
            }
            if score > 0 { Some((score, i, r)) } else { None }
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));

    let mut out = Vec::new();
    let mut chars = 0usize;
    for (_, _, r) in scored.into_iter().take(max) {
        chars += r.len();
        if chars > 4000 {
            break;
        }
        out.push(r.trim().to_string());
    }
    out
}

/// Clean a model-proposed relative folder. Rejects `..`, strips control characters,
/// leading dots, drive colons and empty components, and caps depth and component length.
/// Returns None when nothing safe remains.
pub fn sanitize_relative_folder(raw: &str) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for comp in raw.split(['/', '\\']) {
        let cleaned: String = comp
            .chars()
            .filter(|c| !c.is_control())
            .map(|c| if c == ':' { '-' } else { c })
            .collect();
        let cleaned = cleaned.trim();
        if cleaned == ".." {
            return None;
        }
        let cleaned = cleaned.trim_start_matches('.').trim();
        if cleaned.is_empty() {
            continue;
        }
        let capped: String = cleaned.chars().take(100).collect();
        parts.push(capped.trim().to_string());
        if parts.len() >= MAX_FOLDER_DEPTH {
            break;
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

/// Clean a model-proposed filename: basename only, no hidden files, original extension kept.
pub fn sanitize_filename(suggested: &str, original: &str) -> String {
    let original_base = original
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(original)
        .to_string();
    let base = suggested.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if c == ':' { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim().to_string();
    if cleaned.is_empty() {
        return original_base;
    }
    let mut name: String = cleaned.chars().take(200).collect();
    if let Some(ext) = Path::new(&original_base).extension().map(|e| e.to_string_lossy().to_string())
        && !name.to_lowercase().ends_with(&format!(".{}", ext.to_lowercase())) {
            name = format!("{name}.{ext}");
        }
    name
}

/// If a rule destination is `vault:<subfolder>`, return the subfolder part.
pub fn parse_vault_destination(dest: &str) -> Option<&str> {
    let d = dest.trim();
    if d.get(..6).is_some_and(|p| p.eq_ignore_ascii_case("vault:")) {
        Some(d[6..].trim())
    } else {
        None
    }
}

/// Create `root/relative` and confirm the canonical result is still inside `root`
/// (protects against symlinks on the destination pointing elsewhere).
pub fn create_contained_dir(root: &Path, relative: &str) -> Result<PathBuf> {
    let mut target = root.to_path_buf();
    for c in Path::new(relative).components() {
        match c {
            std::path::Component::Normal(seg) => target.push(seg),
            std::path::Component::CurDir => continue,
            _ => bail!("refusing destination path {relative:?}"),
        }
        match std::fs::symlink_metadata(&target) {
            Ok(md) if md.file_type().is_symlink() => bail!("refusing to write through symlink {}", target.display()),
            Ok(md) if !md.is_dir() => bail!("{} exists and is not a folder", target.display()),
            Ok(_) => {}
            Err(_) => std::fs::create_dir(&target)
                .or_else(|e| if target.is_dir() { Ok(()) } else { Err(e) })
                .with_context(|| format!("creating destination directory {}", target.display()))?,
        }
    }
    let canon_root = root.canonicalize().with_context(|| format!("resolving {}", root.display()))?;
    let canon_target = target.canonicalize().with_context(|| format!("resolving {}", target.display()))?;
    if !canon_target.starts_with(&canon_root) {
        bail!("refusing to write outside destination root: {}", canon_target.display());
    }
    Ok(target)
}

/// Copy only the file contents (plus modified time), flushed to disk.
/// `std::fs::copy` on macOS also copies extended attributes such as "where from" metadata,
/// and many SMB/NAS shares reject those with "Permission denied", failing the whole copy.
pub fn copy_data_only(src: &Path, dest: &Path) -> Result<u64> {
    let mut input = std::fs::File::open(src).with_context(|| format!("opening {}", src.display()))?;
    let mut output = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(dest)
        .with_context(|| format!("creating {}", dest.display()))?;
    let n = std::io::copy(&mut input, &mut output)?;
    output.sync_all()?;
    // Best effort: some shares do not allow setting times.
    if let Ok(modified) = input.metadata().and_then(|m| m.modified()) {
        let _ = output.set_modified(modified);
    }
    Ok(n)
}

/// Move a file safely. Tries an atomic rename first. Across filesystems (e.g. to an SMB share)
/// it copies to a hidden partial file, flushes it, checks the size matches the source,
/// renames it into place and only then deletes the source. On mismatch the source is kept.
/// Returns Ok(true) if the source was removed, Ok(false) if the copy is verified but the
/// source could not be deleted.
pub fn move_file_verified(src: &Path, dest: &Path) -> Result<bool> {
    // rename() silently replaces an existing file; callers pick a free name, but re-check.
    if std::fs::symlink_metadata(dest).is_ok() {
        bail!("{} already exists; source kept at {}", dest.display(), src.display());
    }
    if std::fs::rename(src, dest).is_ok() {
        return Ok(true);
    }
    copy_file_verified(src, dest)?;
    Ok(std::fs::remove_file(src).is_ok())
}

/// Copy to a hidden partial file, flush, check the size matches, then rename into place.
/// The source is never touched. Used directly by copy-mode routes (e.g. SD card imports).
pub fn copy_file_verified(src: &Path, dest: &Path) -> Result<()> {
    let src_len = std::fs::metadata(src)
        .with_context(|| format!("reading {}", src.display()))?
        .len();
    let dest_dir = dest.parent().ok_or_else(|| anyhow!("destination has no parent"))?;
    let name = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let partial = dest_dir.join(format!(".{name}.{}.rbox-partial", uuid::Uuid::new_v4().simple()));

    let copy_result = (|| -> Result<()> {
        copy_data_only(src, &partial).with_context(|| format!("copying to {}", partial.display()))?;
        let copied_len = std::fs::metadata(&partial)?.len();
        if copied_len != src_len {
            bail!("size mismatch after copy ({copied_len} of {src_len} bytes)");
        }
        if std::fs::symlink_metadata(dest).is_ok() {
            bail!("{} already exists", dest.display());
        }
        std::fs::rename(&partial, dest).with_context(|| format!("finalizing {}", dest.display()))?;
        Ok(())
    })();

    if let Err(e) = copy_result {
        let _ = std::fs::remove_file(&partial);
        return Err(e.context(format!("source kept at {}", src.display())));
    }
    Ok(())
}

/// Prompt and call an LLM (via OpenRouter or xAI/Grok) to determine the best target directory and filename.
/// The model has full flexibility to propose new logical directories when novel formats arrive.
pub async fn query_llm_route(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: &str,
    meta: &FileMetadata,
    available_directories: &[String],
    user_rules: &str,
) -> Result<(RouteDecision, AiUsage)> {
    let dirs_json = serde_json::to_string(available_directories)?;
    let all_rules: Vec<String> = user_rules.lines().map(|l| l.to_string()).collect();
    let relevant = select_relevant_rules(&meta.filename, &all_rules, MAX_RULES_IN_PROMPT);
    let rules_text = relevant.join("\n");
    let snippet_str = meta.text_snippet.as_deref().unwrap_or("None available");
    let format_cat = infer_format_category(meta.extension.as_deref(), &meta.filename);

    let system_prompt = "You are an adaptive, intelligent file organization assistant for a user's Synology NAS.\n\
        Your job is to examine an incoming file (filename, extension, detected category, size, and content preview) and route it into the most logical destination directory on the NAS.\n\n\
        Routing Principles:\n\
        1. Explicit User Rules: If the file matches an active user rule, follow that rule.\n\
        2. Flexible & Autonomous Organization: You are NOT rigidly locked to existing rules or existing folders! If a file has a completely different format (e.g. 3D models, CAD drawings, audio stems, disk images, machine learning notebooks, raw camera footage, database dumps) that does not match an explicit rule, intelligently classify it and propose the most intuitive destination directory. You can choose an existing folder OR propose a clean new folder (e.g. '3D & CAD/Models', 'Media/Audio Stems', 'Development/Notebooks', 'System/Disk Images'). The application will automatically create any new folders on the NAS.\n\
        3. Professional Taxonomy: Keep folder paths clean, concise, and professional (typically 1 or 2 levels deep, like 'Category/Subcategory'). Avoid overly deep or redundant nesting.\n\
        4. Filename Preservation: Retain the original file extension. You may suggest a cleaner filename if the original is messy, or keep it unchanged.\n\n\
        You must reply with valid JSON only, using this exact schema:\n\
        {\n  \
          \"destination_folder\": \"string (path to existing folder or clean new folder to create)\",\n  \
          \"suggested_filename\": \"string (clean filename preserving original extension)\",\n  \
          \"confidence\": number (0.0 to 1.0),\n  \
          \"explanation\": \"string (brief reason explaining why this folder was selected or created)\",\n  \
          \"suggested_rule\": \"string or null (a short reusable rule for similar files, formatted '<keywords or *.ext> go to <folder>', e.g. '*.stl go to 3D/Models')\"\n\
        }\n\
        Use a low confidence (below 0.7) when you are guessing.";

    let user_message = format!(
        "File to organize:\n\
        - Filename: {}\n\
        - Extension: {}\n\
        - Detected Category: {}\n\
        - Size: {} bytes\n\
        - Content Preview:\n{}\n\n\
        Available NAS Directories:\n{}\n\n\
        User Organization Rules (prioritize if applicable):\n{}\n\n\
        Analyze this file and decide the best destination folder. You may select an existing folder OR propose a clean, intuitive new folder if this file represents a different format, category, or workflow. Return valid JSON only.",
        meta.filename,
        meta.extension.as_deref().unwrap_or("none"),
        format_cat,
        meta.size_bytes,
        snippet_str,
        dirs_json,
        if rules_text.trim().is_empty() { "Organize logically by topic, file type, project, or date." } else { rules_text.as_str() }
    );

    let body = serde_json::json!({
        "model": model,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message }
        ],
        "temperature": 0.1
    });

    let completion = execute_chat_completion(client, provider, model, api_key, &body).await?;
    let decision = parse_route_decision(&completion.content, &meta.filename)?;
    Ok((decision, completion.usage))
}

/// Prompt and call OpenRouter to determine the best target directory and filename.
pub async fn query_openrouter_route(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    meta: &FileMetadata,
    available_directories: &[String],
    user_rules: &str,
) -> Result<RouteDecision> {
    let provider = if !model.contains('/') && model.to_lowercase().starts_with("grok") {
        "xai"
    } else {
        "openrouter"
    };
    query_llm_route(client, provider, api_key, model, meta, available_directories, user_rules)
        .await
        .map(|(d, _)| d)
}

/// Parse and validate the raw text output from the LLM into a structured RouteDecision.
pub fn parse_route_decision(raw: &str, fallback_name: &str) -> Result<RouteDecision> {
    // Strip markdown code fences if model enclosed JSON in ```json ... ```
    let trimmed = raw.trim();
    let json_str = if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 2 && lines.first().unwrap().starts_with("```") && lines.last().unwrap().starts_with("```") {
            lines[1..lines.len() - 1].join("\n")
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    #[derive(Deserialize)]
    struct RawDecision {
        destination_folder: Option<String>,
        suggested_filename: Option<String>,
        confidence: Option<f32>,
        explanation: Option<String>,
        suggested_rule: Option<String>,
    }

    let parsed: RawDecision = serde_json::from_str(&json_str)
        .with_context(|| format!("parsing JSON decision from model: {json_str}"))?;

    // An unsafe or missing folder becomes "Unsorted" with zero confidence so it lands in review.
    let (destination_folder, folder_ok) = match parsed.destination_folder.as_deref().and_then(sanitize_relative_folder) {
        Some(f) => (f, true),
        None => ("Unsorted".to_string(), false),
    };

    let suggested_filename = sanitize_filename(parsed.suggested_filename.as_deref().unwrap_or(""), fallback_name);

    // Missing confidence is treated as uncertain, not as confident.
    let mut confidence = parsed.confidence.unwrap_or(0.5).clamp(0.0, 1.0);
    if !folder_ok {
        confidence = 0.0;
    }
    let explanation = parsed
        .explanation
        .unwrap_or_else(|| "Routed based on file pattern".to_string());

    let suggested_rule = parsed
        .suggested_rule
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty() && r.len() <= 300)
        .filter(|r| validate_suggested_rule(r, fallback_name).is_some());

    Ok(RouteDecision {
        destination_folder,
        suggested_filename,
        confidence,
        explanation,
        suggested_rule,
    })
}

/// A suggested rule is only useful if it parses, matches the file it was made for,
/// does not target the vault, and points at a safe folder. Returns the cleaned destination.
pub fn validate_suggested_rule(rule: &str, filename: &str) -> Option<String> {
    let (_, dest, _) = match_rule_with_index(filename, &[rule.to_string()])?;
    if parse_vault_destination(&dest).is_some() {
        return None;
    }
    sanitize_relative_folder(&dest)
}

/// Execute a routing decision by copying or moving the file to the target NAS directory.
pub fn execute_route(
    source: &Path,
    smb_root: &Path,
    decision: &RouteDecision,
    move_file: bool,
) -> Result<RouteResult> {
    if !source.exists() {
        bail!("Source file {} does not exist", source.display());
    }
    if !smb_root.exists() {
        bail!("Target SMB root {} does not exist or is not mounted", smb_root.display());
    }

    let folder = sanitize_relative_folder(&decision.destination_folder)
        .ok_or_else(|| anyhow!("unsafe destination folder: {}", decision.destination_folder))?;
    let target_dir = create_contained_dir(smb_root, &folder)?;

    let original = source.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let filename = sanitize_filename(&decision.suggested_filename, &original);
    let destination_file = pick_free_path(&target_dir, &filename);

    if move_file {
        move_file_verified(source, &destination_file)?;
    } else {
        std::fs::copy(source, &destination_file)?;
    }

    Ok(RouteResult {
        source_path: source.to_string_lossy().to_string(),
        destination_path: destination_file.to_string_lossy().to_string(),
        moved: move_file,
        explanation: decision.explanation.clone(),
    })
}

/// Convenience helper to route a single file using configured credentials and NAS path.
pub async fn route_file(
    api_key: &str,
    model: &str,
    file_path: &Path,
    smb_root: &Path,
    user_rules: &str,
) -> Result<RouteDecision> {
    let provider = if !model.contains('/') && model.to_lowercase().starts_with("grok") {
        "xai"
    } else {
        "openrouter"
    };
    route_file_with_provider(provider, api_key, model, file_path, smb_root, user_rules)
        .await
        .map(|(d, _)| d)
}

pub async fn route_file_with_provider(
    provider: &str,
    api_key: &str,
    model: &str,
    file_path: &Path,
    smb_root: &Path,
    user_rules: &str,
) -> Result<(RouteDecision, AiUsage)> {
    let (file, root) = (file_path.to_path_buf(), smb_root.to_path_buf());
    let (meta, available_dirs) = tokio::task::spawn_blocking(move || -> Result<_> {
        let meta = extract_metadata(&file, 2048).with_context(|| format!("extracting metadata from {}", file.display()))?;
        let dirs = scan_nas_taxonomy(&root, 3)
            .unwrap_or_else(|_| vec!["Documents".to_string(), "Media/Photos".to_string(), "Work/Invoices".to_string(), "Unsorted".to_string()]);
        Ok((meta, dirs))
    })
    .await??;
    let client = http_client()?;
    query_llm_route(&client, provider, api_key, model, &meta, &available_dirs, user_rules).await
}

/// Route using metadata only (e.g. when only a filename is known, not a readable path).
pub async fn route_metadata_with_provider(
    provider: &str,
    api_key: &str,
    model: &str,
    meta: &FileMetadata,
    smb_root: &Path,
    user_rules: &str,
) -> Result<(RouteDecision, AiUsage)> {
    let root = smb_root.to_path_buf();
    let available_dirs = tokio::task::spawn_blocking(move || scan_nas_taxonomy(&root, 3).unwrap_or_default()).await?;
    let client = http_client()?;
    query_llm_route(&client, provider, api_key, model, meta, &available_dirs, user_rules).await
}

/// Ask the LLM to analyze the NAS taxonomy and propose 4 to 6 logical sorting rules.
pub async fn suggest_rules_from_taxonomy(
    api_key: &str,
    model: &str,
    directories: &[String],
) -> Result<Vec<String>> {
    let provider = if !model.contains('/') && model.to_lowercase().starts_with("grok") {
        "xai"
    } else {
        "openrouter"
    };
    suggest_rules_from_taxonomy_with_provider(provider, api_key, model, directories)
        .await
        .map(|(r, _)| r)
}

pub async fn suggest_rules_from_taxonomy_with_provider(
    provider: &str,
    api_key: &str,
    model: &str,
    directories: &[String],
) -> Result<(Vec<String>, AiUsage)> {
    let dirs_json = serde_json::to_string(directories)?;
    let system_prompt = "You are an expert file organization assistant for Synology NAS and network storage.\n\
        Given a list of existing directories discovered on the user's NAS, generate 4 to 6 concise, practical organization rules.\n\
        Each rule should clearly describe which file types or documents belong in which discovered folder.\n\
        Rules must be in the format: '<file types or documents> go to <folder_path>'\n\
        Example: 'Invoices, receipts, and bills go to Finance/Invoices'\n\
        Respond with valid JSON only in this exact schema: { \"rules\": [\"rule 1\", \"rule 2\", ...] }";

    let user_message = format!(
        "Existing NAS Directories:\n{}\n\nGenerate 4 to 6 recommended organization rules as JSON.",
        dirs_json
    );

    let body = serde_json::json!({
        "model": model,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message }
        ],
        "temperature": 0.2
    });

    let client = http_client()?;
    let completion = execute_chat_completion(&client, provider, model, api_key, &body).await?;
    Ok((parse_rules_response(&completion.content)?, completion.usage))
}

/// Ask the LLM to translate a user's free-form natural language explanation into structured rules.
pub async fn translate_explanation_to_rules(
    api_key: &str,
    model: &str,
    explanation: &str,
    directories: &[String],
) -> Result<Vec<String>> {
    let provider = if !model.contains('/') && model.to_lowercase().starts_with("grok") {
        "xai"
    } else {
        "openrouter"
    };
    translate_explanation_to_rules_with_provider(provider, api_key, model, explanation, directories)
        .await
        .map(|(r, _)| r)
}

pub async fn translate_explanation_to_rules_with_provider(
    provider: &str,
    api_key: &str,
    model: &str,
    explanation: &str,
    directories: &[String],
) -> Result<(Vec<String>, AiUsage)> {
    if explanation.trim().is_empty() {
        bail!("Explanation cannot be empty");
    }

    let dirs_json = serde_json::to_string(directories)?;
    let system_prompt = "You are an expert file organization assistant for Synology NAS.\n\
        The user will explain how they want their files organized in plain conversational English.\n\
        Your job is to translate their explanation into 3 to 8 clean, actionable sorting rules that match their intent.\n\
        Map destinations to existing directories from the provided list whenever possible, or create logical subpaths.\n\
        Each rule must be formatted as: '<file types or patterns> go to <folder_path>'\n\
        Respond with valid JSON only in this exact schema: { \"rules\": [\"rule 1\", \"rule 2\", ...] }";

    let user_message = format!(
        "User Explanation:\n\"{}\"\n\nExisting NAS Directories:\n{}\n\nTranslate into structured rules as JSON.",
        explanation.trim(),
        dirs_json
    );

    let body = serde_json::json!({
        "model": model,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user", "content": user_message }
        ],
        "temperature": 0.2
    });

    let client = http_client()?;
    let completion = execute_chat_completion(&client, provider, model, api_key, &body).await?;
    Ok((parse_rules_response(&completion.content)?, completion.usage))
}

/// Parse raw LLM output into a clean list of rule strings.
pub fn parse_rules_response(raw: &str) -> Result<Vec<String>> {
    let trimmed = raw.trim();
    let json_str = if trimmed.starts_with("```") {
        let lines: Vec<&str> = trimmed.lines().collect();
        if lines.len() >= 2 && lines.first().unwrap().starts_with("```") && lines.last().unwrap().starts_with("```") {
            lines[1..lines.len() - 1].join("\n")
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    };

    #[derive(Deserialize)]
    struct RawRules {
        rules: Vec<String>,
    }

    if let Ok(parsed) = serde_json::from_str::<RawRules>(&json_str) {
        let clean: Vec<String> = parsed
            .rules
            .into_iter()
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
            .collect();
        if !clean.is_empty() {
            return Ok(clean);
        }
    }

    if let Ok(list) = serde_json::from_str::<Vec<String>>(&json_str) {
        let clean: Vec<String> = list
            .into_iter()
            .map(|r| r.trim().to_string())
            .filter(|r| !r.is_empty())
            .collect();
        if !clean.is_empty() {
            return Ok(clean);
        }
    }

    let lines: Vec<String> = trimmed
        .lines()
        .map(|l| {
            l.trim()
                .trim_start_matches(|c: char| c == '-' || c == '*' || c == '•' || c.is_ascii_digit() || c == '.')
                .trim()
                .to_string()
        })
        .filter(|l| !l.is_empty())
        .collect();

    if !lines.is_empty() {
        return Ok(lines);
    }

    bail!("Could not parse rules from response: {raw}")
}

/// Avoid overwriting existing files by appending " (1)", " (2)" before the extension.
pub fn pick_free_path(dir: &Path, filename: &str) -> PathBuf {
    let candidate = dir.join(filename);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, ext) = match filename.rfind('.') {
        Some(idx) if idx > 0 => (&filename[..idx], Some(&filename[idx..])),
        _ => (filename, None),
    };

    let mut counter = 1;
    loop {
        let new_name = match ext {
            Some(e) => format!("{stem} ({counter}){e}"),
            None => format!("{stem} ({counter})"),
        };
        let p = dir.join(&new_name);
        if !p.exists() {
            return p;
        }
        counter += 1;
    }
}

/// Split a rule like "Invoices go to Finance/Invoices" into (trigger, destination).
pub fn parse_rule(rule: &str) -> Option<(String, String)> {
    let rule_clean = rule.trim();
    let (trigger, dest) = if let Some((t, d)) = split_once_ignore_case(rule_clean, " go to ") {
        (t.trim(), d.trim())
    } else if let Some((t, d)) = rule_clean.split_once("->") {
        (t.trim(), d.trim())
    } else if let Some((t, d)) = split_once_ignore_case(rule_clean, " to ") {
        (t.trim(), d.trim())
    } else {
        return None;
    };
    if dest.is_empty() {
        return None;
    }
    Some((trigger.to_string(), dest.to_string()))
}

/// Match a filename against a list of rule strings like "SpinupWP backups go to Website Backups/SpinupWP".
/// Returns Option<(destination_folder, matched_rule_string)>.
pub fn match_rule_for_file(filename: &str, rules: &[String]) -> Option<(String, String)> {
    match_rule_with_index(filename, rules).map(|(_, d, r)| (d, r))
}

/// Same as `match_rule_for_file` but also returns the index of the winning rule,
/// so callers can detect rules that are shadowed by earlier ones.
pub fn match_rule_with_index(filename: &str, rules: &[String]) -> Option<(usize, String, String)> {
    let lower_name = filename.to_lowercase();
    for (idx, rule) in rules.iter().enumerate() {
        let rule_clean = rule.trim();
        if rule_clean.is_empty() {
            continue;
        }

        let Some((trigger, dest)) = parse_rule(rule_clean) else {
            continue;
        };
        let dest = dest.as_str();

        let trigger_lower = trigger.to_lowercase();

        // Check 1: Extension / glob matching (e.g. *.sql.gz, *.tar.gz, *.pdf)
        if trigger_lower.contains('*') {
            for part in trigger_lower.split(|c: char| c.is_whitespace() || c == ',' || c == ';') {
                let part = part.trim();
                if let Some(ext) = part.strip_prefix('*')
                    && lower_name.ends_with(ext) {
                        return Some((idx, dest.to_string(), rule_clean.to_string()));
                    }
            }
        }

        // Check 2: Keyword tokens from trigger
        let words: Vec<&str> = trigger_lower
            .split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
            // 3+ chars: two-letter tokens like "wp" matched far too many unrelated filenames.
            .filter(|w| w.len() >= 3)
            .filter(|w| !["files", "file", "backups", "backup", "all", "the", "and", "exports", "archive", "media", "matching", "documents", "other"].contains(w))
            .collect();

        let file_tokens: Vec<&str> = lower_name
            .split(|c: char| !c.is_alphanumeric())
            .filter(|t| t.len() >= 2)
            .collect();

        for w in &words {
            if lower_name.contains(w) {
                return Some((idx, dest.to_string(), rule_clean.to_string()));
            }
            for tok in &file_tokens {
                if tok.len() >= 4 && (w.contains(tok) || tok.contains(w)) {
                    return Some((idx, dest.to_string(), rule_clean.to_string()));
                }
            }
        }

        // Check 3: If trigger directly appears in filename
        if !trigger_lower.is_empty() && lower_name.contains(&trigger_lower) {
            return Some((idx, dest.to_string(), rule_clean.to_string()));
        }
    }
    None
}

/// ASCII-case-insensitive split. Offsets come from `s` itself, so non-ASCII text whose
/// lowercase form has a different byte length cannot cause an out-of-range slice.
fn split_once_ignore_case<'a>(s: &'a str, pat: &str) -> Option<(&'a str, &'a str)> {
    if pat.is_empty() {
        return None;
    }
    s.char_indices().find_map(|(i, _)| {
        let window = s.get(i..i + pat.len())?;
        window.eq_ignore_ascii_case(pat).then(|| (&s[..i], &s[i + pat.len()..]))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn copy_data_only_keeps_contents_and_mtime_without_xattrs() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("a.sql.gz");
        let dest = dir.path().join("b.sql.gz");
        std::fs::write(&src, b"hello backup").unwrap();
        // Tag the source with the same kind of metadata browsers add to downloads.
        #[cfg(target_os = "macos")]
        let _ = std::process::Command::new("xattr")
            .args(["-w", "com.apple.metadata:kMDItemWhereFroms", "x"])
            .arg(&src)
            .status();
        let n = copy_data_only(&src, &dest).unwrap();
        assert_eq!(n, 12);
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello backup");
        let m_src = std::fs::metadata(&src).unwrap().modified().unwrap();
        let m_dest = std::fs::metadata(&dest).unwrap().modified().unwrap();
        assert_eq!(m_src, m_dest);
        #[cfg(target_os = "macos")]
        {
            let out = std::process::Command::new("xattr").arg(&dest).output().unwrap();
            // macOS stamps new files with com.apple.provenance itself; that one is not copied.
            assert!(!String::from_utf8_lossy(&out.stdout).contains("kMDItemWhereFroms"), "xattrs were copied");
        }
    }

    #[test]
    fn parses_direct_json_decision() {
        let raw = r#"{
            "destination_folder": "Finance/Taxes/2026",
            "suggested_filename": "2026-W2-Jordan.pdf",
            "confidence": 0.95,
            "explanation": "W-2 tax form matches tax rules"
        }"#;
        let dec = parse_route_decision(raw, "original.pdf").unwrap();
        assert_eq!(dec.destination_folder, "Finance/Taxes/2026");
        assert_eq!(dec.suggested_filename, "2026-W2-Jordan.pdf");
        assert_eq!(dec.confidence, 0.95);
    }

    #[test]
    fn parses_markdown_fenced_json() {
        let raw = "```json\n{\n  \"destination_folder\": \"Work/Acme\",\n  \"suggested_filename\": \"Proposal.docx\",\n  \"confidence\": 0.88,\n  \"explanation\": \"Client contract\"\n}\n```";
        let dec = parse_route_decision(raw, "fallback.docx").unwrap();
        assert_eq!(dec.destination_folder, "Work/Acme");
        assert_eq!(dec.suggested_filename, "Proposal.docx");
        assert_eq!(dec.confidence, 0.88);
    }

    #[test]
    fn scans_nas_taxonomy_and_ignores_metadata() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        std::fs::create_dir_all(root.join("Documents/Personal")).unwrap();
        std::fs::create_dir_all(root.join("Documents/Taxes/2026")).unwrap();
        std::fs::create_dir_all(root.join("Media/Photos")).unwrap();
        std::fs::create_dir_all(root.join("@eaDir/thumbs")).unwrap(); // Synology metadata
        std::fs::create_dir_all(root.join("#recycle/deleted")).unwrap(); // Synology trash
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();

        let tax = scan_nas_taxonomy(root, 3).unwrap();
        assert!(tax.contains(&"Documents".to_string()));
        assert!(tax.contains(&"Documents/Personal".to_string()));
        assert!(tax.contains(&"Documents/Taxes".to_string()));
        assert!(tax.contains(&"Documents/Taxes/2026".to_string()));
        assert!(tax.contains(&"Media/Photos".to_string()));
        assert!(!tax.iter().any(|d| d.contains("@eaDir")));
        assert!(!tax.iter().any(|d| d.contains("#recycle")));
        assert!(!tax.iter().any(|d| d.contains(".git")));
    }

    #[test]
    fn picks_free_path_without_clobbering() {
        let dir = tempdir().unwrap();
        let target_dir = dir.path();
        std::fs::write(target_dir.join("report.pdf"), b"existing").unwrap();

        let free = pick_free_path(target_dir, "report.pdf");
        assert_eq!(free.file_name().unwrap(), "report (1).pdf");

        std::fs::write(&free, b"version 1").unwrap();
        let free2 = pick_free_path(target_dir, "report.pdf");
        assert_eq!(free2.file_name().unwrap(), "report (2).pdf");
    }

    #[test]
    fn extracts_snippet_from_text_file() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("invoice.txt");
        std::fs::write(&file_path, "INVOICE #9988\nClient: Globex Corp\nAmount: $5,000").unwrap();

        let meta = extract_metadata(&file_path, 1024).unwrap();
        assert_eq!(meta.filename, "invoice.txt");
        assert_eq!(meta.extension.as_deref(), Some("txt"));
        assert!(meta.text_snippet.unwrap().contains("Globex Corp"));
    }

    #[test]
    fn parses_rules_from_json_object() {
        let raw = r#"{
            "rules": [
                "Invoices go to Finance/Invoices",
                "Photos go to Media/Photos"
            ]
        }"#;
        let rules = parse_rules_response(raw).unwrap();
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0], "Invoices go to Finance/Invoices");
        assert_eq!(rules[1], "Photos go to Media/Photos");
    }

    #[test]
    fn parses_rules_from_markdown_fence() {
        let raw = "```json\n{\n  \"rules\": [\"Documents go to Archive\"]\n}\n```";
        let rules = parse_rules_response(raw).unwrap();
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0], "Documents go to Archive");
    }

    #[test]
    fn matches_rules_for_files() {
        let rules = vec![
            "SpinupWP backups go to Website Backups/SpinupWP".to_string(),
            "Pressable backups go to Website Backups/Pressable".to_string(),
            "WP Engine archive exports go to Website Backups/WPEngine".to_string(),
            "Client contracts and agreements (*.pdf) go to Legal/Contracts".to_string(),
        ];

        let m1 = match_rule_for_file("backup_production_spinup_lamp.sql.gz", &rules);
        assert!(m1.is_some());
        assert_eq!(m1.unwrap().0, "Website Backups/SpinupWP");

        let m2 = match_rule_for_file("pressable_export_2026.zip", &rules);
        assert!(m2.is_some());
        assert_eq!(m2.unwrap().0, "Website Backups/Pressable");

        let m3 = match_rule_for_file("Acme_Master_Services_Agreement.pdf", &rules);
        assert!(m3.is_some());
        assert_eq!(m3.unwrap().0, "Legal/Contracts");

        let m4 = match_rule_for_file("unrelated_photo.jpg", &rules);
        assert!(m4.is_none());
    }

    #[test]
    fn infers_format_categories_accurately() {
        assert_eq!(infer_format_category(Some("blend"), "character.blend"), "3D Asset / Mesh / Model");
        assert_eq!(infer_format_category(Some("step"), "rotor_assembly.step"), "CAD / Engineering Blueprint");
        assert_eq!(infer_format_category(Some("wav"), "lead_vocal_stem.wav"), "Audio / Stem Recording");
        assert_eq!(infer_format_category(Some("sql"), "production.sql"), "Database Backup / Export");
        assert_eq!(infer_format_category(Some("iso"), "ubuntu-24.04.iso"), "Disk Image / Virtual Machine Appliance");
    }

    #[test]
    fn sanitizes_folders_and_rejects_traversal() {
        assert_eq!(sanitize_relative_folder("/Finance/Taxes/"), Some("Finance/Taxes".to_string()));
        assert_eq!(sanitize_relative_folder("Work\\Clients\\Acme"), Some("Work/Clients/Acme".to_string()));
        assert_eq!(sanitize_relative_folder("../../etc"), None);
        assert_eq!(sanitize_relative_folder("Docs/../../x"), None);
        assert_eq!(sanitize_relative_folder("./.hidden/ok"), Some("hidden/ok".to_string()));
        assert_eq!(sanitize_relative_folder("C:/Windows"), Some("C-/Windows".to_string()));
        assert_eq!(sanitize_relative_folder("  //  "), None);
        assert_eq!(sanitize_relative_folder("a/b/c/d/e/f/g/h").unwrap().matches('/').count(), MAX_FOLDER_DEPTH - 1);
    }

    #[test]
    fn sanitizes_filenames_keeping_extension() {
        assert_eq!(sanitize_filename("../../evil.pdf", "orig.pdf"), "evil.pdf");
        assert_eq!(sanitize_filename("Clean Name", "orig.pdf"), "Clean Name.pdf");
        assert_eq!(sanitize_filename("", "orig.pdf"), "orig.pdf");
        assert_eq!(sanitize_filename(".bashrc", "notes.txt"), "bashrc.txt");
    }

    #[test]
    fn unsafe_model_folder_gets_zero_confidence() {
        let raw = r#"{"destination_folder":"../../Users/x","suggested_filename":"a.pdf","confidence":0.99,"explanation":"x"}"#;
        let dec = parse_route_decision(raw, "a.pdf").unwrap();
        assert_eq!(dec.destination_folder, "Unsorted");
        assert_eq!(dec.confidence, 0.0);
    }

    #[test]
    fn missing_confidence_is_below_review_threshold() {
        let raw = r#"{"destination_folder":"Docs"}"#;
        let dec = parse_route_decision(raw, "a.pdf").unwrap();
        assert!(dec.confidence < REVIEW_CONFIDENCE_THRESHOLD);
    }

    #[test]
    fn keeps_only_valid_suggested_rules() {
        let good = r#"{"destination_folder":"3D/Models","confidence":0.9,"suggested_rule":"*.stl go to 3D/Models"}"#;
        assert_eq!(parse_route_decision(good, "bracket.stl").unwrap().suggested_rule.as_deref(), Some("*.stl go to 3D/Models"));
        let no_match = r#"{"destination_folder":"3D","confidence":0.9,"suggested_rule":"*.obj go to 3D"}"#;
        assert!(parse_route_decision(no_match, "bracket.stl").unwrap().suggested_rule.is_none());
        let vault = r#"{"destination_folder":"x","confidence":0.9,"suggested_rule":"*.stl go to vault:Private"}"#;
        assert!(parse_route_decision(vault, "bracket.stl").unwrap().suggested_rule.is_none());
        let escape = r#"{"destination_folder":"x","confidence":0.9,"suggested_rule":"*.stl go to ../../tmp"}"#;
        assert!(parse_route_decision(escape, "bracket.stl").unwrap().suggested_rule.is_none());
    }

    #[test]
    fn moves_file_and_removes_source() {
        let dir = tempdir().unwrap();
        let src = dir.path().join("in.bin");
        std::fs::write(&src, vec![7u8; 4096]).unwrap();
        let dest_dir = dir.path().join("out");
        std::fs::create_dir_all(&dest_dir).unwrap();
        let dest = dest_dir.join("in.bin");
        assert!(move_file_verified(&src, &dest).unwrap());
        assert!(!src.exists());
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), 4096);
    }

    #[test]
    fn contained_dir_refuses_symlink_escape() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("root");
        let outside = dir.path().join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            assert!(create_contained_dir(&root, "link/sub").is_err());
        }
        assert!(create_contained_dir(&root, "Docs/2026").is_ok());
    }

    #[test]
    fn selects_only_relevant_rules() {
        let mut rules: Vec<String> = (0..3000).map(|i| format!("files matching project{i} go to Projects/P{i}")).collect();
        rules.push("*.pdf go to Documents/PDF".to_string());
        rules.push("Invoices go to Finance/Invoices".to_string());
        let picked = select_relevant_rules("acme_invoices_2026.pdf", &rules, MAX_RULES_IN_PROMPT);
        assert!(picked.len() <= MAX_RULES_IN_PROMPT);
        assert!(picked.contains(&"*.pdf go to Documents/PDF".to_string()));
        assert!(picked.contains(&"Invoices go to Finance/Invoices".to_string()));
        assert!(!picked.iter().any(|r| r.contains("project1 ")));
    }

    #[test]
    fn parses_provider_usage() {
        let v = serde_json::json!({"usage": {"prompt_tokens": 412, "completion_tokens": 61, "cost": 0.000123}});
        let u = parse_usage(&v);
        assert_eq!((u.prompt_tokens, u.completion_tokens), (412, 61));
        assert_eq!(u.cost_usd, Some(0.000123));
        let none = parse_usage(&serde_json::json!({}));
        assert_eq!(none, AiUsage::default());
    }

    #[test]
    fn reports_winning_rule_index_for_shadowing() {
        let rules = vec!["*.pdf go to Docs".to_string(), "Invoices go to Finance".to_string()];
        let (idx, dest, _) = match_rule_with_index("invoice_42.pdf", &rules).unwrap();
        assert_eq!((idx, dest.as_str()), (0, "Docs"));
        assert_eq!(parse_vault_destination("vault:Family Photos"), Some("Family Photos"));
        assert_eq!(parse_vault_destination("Media/Photos"), None);
    }

    #[test]
    fn resolves_api_endpoints_for_providers() {
        assert_eq!(model_for_provider("xai", "x-ai/grok-4.20"), DEFAULT_GROK_MODEL);
        assert_eq!(model_for_provider("xai", "google/gemini-2.5-flash-lite"), DEFAULT_GROK_MODEL);
        assert_eq!(model_for_provider("xai", "grok-4.3"), "grok-4.3");
        assert_eq!(model_for_provider("openrouter", "grok-4.3"), DEFAULT_AI_MODEL);
        assert_eq!(model_for_provider("openrouter", "anthropic/claude-haiku-4.5"), "anthropic/claude-haiku-4.5");
        assert_eq!(AiRouterConfig::default().provider, "xai");
        assert_eq!(AiRouterConfig::default().model, DEFAULT_GROK_MODEL);
        let (xai_url, xai_name) = resolve_api_endpoint("xai", "grok-2-mini");
        assert_eq!(xai_url, XAI_API_URL);
        assert_eq!(xai_name, "xAI Grok");

        let (openrouter_url, openrouter_name) = resolve_api_endpoint("openrouter", "google/gemini-2.0-flash-001");
        assert_eq!(openrouter_url, OPENROUTER_API_URL);
        assert_eq!(openrouter_name, "OpenRouter");
    }

    #[test]
    fn endpoint_follows_provider_not_model_name() {
        // An OpenRouter key must never be sent to xAI because the model id looks like Grok.
        assert_eq!(resolve_api_endpoint("openrouter", "grok-3").0, OPENROUTER_API_URL);
        assert_eq!(resolve_api_endpoint("openrouter", "grok-4.20-non-reasoning").0, OPENROUTER_API_URL);
        assert_eq!(resolve_api_endpoint("xai", "grok-3").0, XAI_API_URL);
    }

    #[test]
    fn non_ascii_rules_do_not_panic() {
        assert_eq!(split_once_ignore_case("İİİ go to X", " go to "), Some(("İİİ", "X")));
        assert_eq!(split_once_ignore_case("Reçus GO TO Finance", " go to "), Some(("Reçus", "Finance")));
        assert_eq!(split_once_ignore_case("no match", " go to "), None);
        assert_eq!(parse_vault_destination("Fiancé"), None);
        assert_eq!(parse_vault_destination("invoices go to Fiancé"), None);
        assert_eq!(parse_vault_destination("VAULT: Taxes"), Some("Taxes"));
    }

    #[cfg(unix)]
    #[test]
    fn contained_dir_never_creates_outside_root() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
        assert!(create_contained_dir(root.path(), "link/sub").is_err());
        assert!(!outside.path().join("sub").exists(), "created a folder through the symlink");
        assert!(create_contained_dir(root.path(), "../escape").is_err());
        assert!(create_contained_dir(root.path(), "a/b").unwrap().is_dir());
    }

    #[test]
    fn verified_move_and_copy_never_overwrite() {
        let d = tempdir().unwrap();
        let (src, dest) = (d.path().join("a.txt"), d.path().join("b.txt"));
        std::fs::write(&src, "new").unwrap();
        std::fs::write(&dest, "keep").unwrap();
        assert!(move_file_verified(&src, &dest).is_err());
        assert!(copy_file_verified(&src, &dest).is_err());
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "keep");
        assert!(src.exists());
    }
}
