//! Smart Synology NAS & SMB file routing powered by OpenRouter.ai.
//!
//! Analyzes incoming files (metadata and lightweight text snippets) and routes
//! them into the appropriate destination directory on an SMB share or local NAS mount
//! based on user-defined organizational rules and discovered NAS folder taxonomy.

use std::path::{Path, PathBuf};
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};

pub const DEFAULT_AI_MODEL: &str = "google/gemini-2.0-flash-001";
pub const OPENROUTER_API_URL: &str = "https://openrouter.ai/api/v1/chat/completions";

/// Configuration for the AI-assisted Synology/SMB file router.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AiRouterConfig {
    /// Whether the smart router is active.
    #[serde(default)]
    pub enabled: bool,
    /// OpenRouter model identifier (e.g. google/gemini-2.0-flash-001, anthropic/claude-3.5-haiku).
    #[serde(default = "default_model")]
    pub model: String,
    /// Destination SMB share path or mount point (e.g. "/Volumes/Synology/Files").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub smb_target: Option<String>,
    /// User's natural language instructions describing how directories are organized.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rules: Option<String>,
    /// If true, automatically move/copy files; if false, suggest routes without moving.
    #[serde(default)]
    pub auto_route: bool,
}

fn default_model() -> String {
    DEFAULT_AI_MODEL.to_string()
}

impl Default for AiRouterConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            model: default_model(),
            smb_target: None,
            rules: None,
            auto_route: false,
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
}

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
    if current_depth >= max_depth {
        return Ok(());
    }
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return Ok(()), // Skip unreadable or permission-denied directories
    };

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !file_type.is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        // Ignore hidden and system/NAS specific folders
        if name.starts_with('.')
            || name.starts_with('@')      // Synology thumbnails & metadata (@eaDir)
            || name.starts_with('#')      // Synology recycle bins (#recycle)
            || name.eq_ignore_ascii_case("node_modules")
            || name.eq_ignore_ascii_case("target")
            || name.eq_ignore_ascii_case("$RECYCLE.BIN")
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

/// Prompt and call OpenRouter to determine the best target directory and filename.
pub async fn query_openrouter_route(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    meta: &FileMetadata,
    available_directories: &[String],
    user_rules: &str,
) -> Result<RouteDecision> {
    if api_key.trim().is_empty() {
        bail!("OpenRouter API key is required");
    }

    let dirs_json = serde_json::to_string(available_directories)?;
    let snippet_str = meta.text_snippet.as_deref().unwrap_or("None available");

    let system_prompt = "You are an automated file organization assistant for a user's Synology NAS.\n\
        Your job is to examine an incoming file (name, type, size, and content preview) and route it into the most appropriate destination directory from the user's available directory list.\n\
        Strictly follow the user's organizational rules.\n\
        You must reply with valid JSON only, using this exact schema:\n\
        {\n  \
          \"destination_folder\": \"string (path from available list or logical subfolder)\",\n  \
          \"suggested_filename\": \"string (clean, descriptive filename preserving original extension)\",\n  \
          \"confidence\": number (0.0 to 1.0),\n  \
          \"explanation\": \"string (brief reason for this decision)\"\n\
        }";

    let user_message = format!(
        "File to organize:\n\
        - Filename: {}\n\
        - Extension: {}\n\
        - Size: {} bytes\n\
        - Content Preview:\n{}\n\n\
        Available NAS Directories:\n{}\n\n\
        User Organization Rules:\n{}\n\n\
        Decide the best destination folder and return the JSON object.",
        meta.filename,
        meta.extension.as_deref().unwrap_or("none"),
        meta.size_bytes,
        snippet_str,
        dirs_json,
        if user_rules.trim().is_empty() { "Organize logically by topic, file type, or date." } else { user_rules }
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

    let resp = client
        .post(OPENROUTER_API_URL)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("HTTP-Referer", "https://renegadebox.com")
        .header("X-Title", "RenegadeBox Synology AI")
        .json(&body)
        .send()
        .await
        .context("sending request to OpenRouter")?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_text = resp.text().await.unwrap_or_default();
        bail!("OpenRouter API error (status {status}): {err_text}");
    }

    let resp_json: serde_json::Value = resp.json().await.context("parsing OpenRouter JSON response")?;
    let content = resp_json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow!("missing message content in OpenRouter response"))?;

    parse_route_decision(content, &meta.filename)
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
    }

    let parsed: RawDecision = serde_json::from_str(&json_str)
        .with_context(|| format!("parsing JSON decision from model: {json_str}"))?;

    let destination_folder = parsed
        .destination_folder
        .map(|d| d.trim_matches(|c| c == '/' || c == '\\').to_string())
        .unwrap_or_else(|| "Unsorted".to_string());

    let suggested_filename = parsed
        .suggested_filename
        .map(|f| f.trim().to_string())
        .filter(|f| !f.is_empty())
        .unwrap_or_else(|| fallback_name.to_string());

    let confidence = parsed.confidence.unwrap_or(0.8).clamp(0.0, 1.0);
    let explanation = parsed
        .explanation
        .unwrap_or_else(|| "Routed based on file pattern".to_string());

    Ok(RouteDecision {
        destination_folder,
        suggested_filename,
        confidence,
        explanation,
    })
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

    let target_dir = smb_root.join(&decision.destination_folder);
    std::fs::create_dir_all(&target_dir)
        .with_context(|| format!("creating destination directory {}", target_dir.display()))?;

    let destination_file = pick_free_path(&target_dir, &decision.suggested_filename);

    if move_file {
        // Attempt rename, or copy + remove across filesystem boundaries
        if std::fs::rename(source, &destination_file).is_err() {
            std::fs::copy(source, &destination_file)?;
            let _ = std::fs::remove_file(source);
        }
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
    let meta = extract_metadata(file_path, 2048)
        .with_context(|| format!("extracting metadata from {}", file_path.display()))?;
    let available_dirs = scan_nas_taxonomy(smb_root, 3)
        .unwrap_or_else(|_| vec!["Documents".to_string(), "Media/Photos".to_string(), "Work/Invoices".to_string(), "Unsorted".to_string()]);
    let client = reqwest::Client::new();
    query_openrouter_route(&client, api_key, model, &meta, &available_dirs, user_rules).await
}

/// Avoid overwriting existing files by appending " (1)", " (2)" before the extension.
fn pick_free_path(dir: &Path, filename: &str) -> PathBuf {
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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

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
}
