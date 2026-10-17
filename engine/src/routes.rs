//! Multiple smart routes: each route watches one source folder and sorts what lands there
//! into its own destination with its own rules. The original single drop-folder setup is
//! exposed as the route with id `main`, built from the legacy `[ai]` fields, so existing
//! configs keep working unchanged.

use crate::ai::{AiRouterConfig, ROUTING_MODE_ORGANIZE};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

/// Id of the route built from the legacy single drop-folder settings.
pub const MAIN_ROUTE_ID: &str = "main";

pub const MODE_MOVE: &str = "move";
/// Copy into the destination and leave the original (SD cards, shared folders).
pub const MODE_COPY: &str = "copy";
/// Sort into subfolders of the source itself.
pub const MODE_ORGANIZE: &str = "organize";

/// Sidecar files follow the photo or video they belong to (same name, same folder).
pub const SIDECAR_EXTENSIONS: &[&str] = &["xmp", "aae", "thm", "pp3", "dop", "on1", "acr"];

/// How deep `scan_subfolders` looks (enough for SD cards: DCIM/100CANON/IMG_0001.CR3).
pub const MAX_SCAN_DEPTH: usize = 4;

fn default_true() -> bool {
    true
}

fn default_mode() -> String {
    MODE_MOVE.to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RouteConfig {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Folder this route watches. Absolute path.
    pub source: String,
    /// Where sorted files go. Absolute path. Ignored in organize mode.
    #[serde(default)]
    pub destination: String,
    /// "move", "copy" or "organize".
    #[serde(default = "default_mode")]
    pub mode: String,
    /// Process automatically as files arrive; otherwise only on "Run now".
    #[serde(default = "default_true")]
    pub auto: bool,
    /// Ask the AI when no rule or layout applies. Off unless the user turns it on: it sends
    /// the file name and the start of the file to the AI provider.
    #[serde(default)]
    pub ai: bool,
    /// Move unsortable files into `_Needs Review` (true) or leave them in place (false).
    #[serde(default = "default_true")]
    pub use_review_folder: bool,
    /// Also pick up files inside subfolders of the source (up to MAX_SCAN_DEPTH).
    #[serde(default)]
    pub scan_subfolders: bool,
    /// Skip files that are already at the destination (same name, size and modified time).
    #[serde(default = "default_true")]
    pub skip_duplicates: bool,
    /// Allow rules with a `vault:` destination for this route.
    #[serde(default)]
    pub vault: bool,
    /// Rules like "*.CR3 go to Photos/{year}/{date}". Tokens are allowed in destinations.
    #[serde(default)]
    pub rules: Vec<String>,
    /// Folder pattern used when no rule matches, before asking the AI. e.g. "{year}/{date}".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    /// Template this route was created from (for display only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

impl RouteConfig {
    pub fn is_main(&self) -> bool {
        self.id == MAIN_ROUTE_ID
    }

    pub fn organize_in_place(&self) -> bool {
        self.mode == MODE_ORGANIZE
    }

    pub fn copy_mode(&self) -> bool {
        self.mode == MODE_COPY
    }

    pub fn source_path(&self) -> PathBuf {
        PathBuf::from(self.source.trim())
    }

    /// Root that sorted files are written under: the destination, or the source in organize mode.
    pub fn destination_root(&self) -> Option<PathBuf> {
        if self.organize_in_place() {
            return Some(self.source_path());
        }
        let d = self.destination.trim();
        if d.is_empty() { None } else { Some(PathBuf::from(d)) }
    }

    /// Paths under /Volumes belong to drives and shares that may be unplugged or unmounted.
    /// They are never created by the app; the route just waits until they come back.
    pub fn on_removable(path: &Path) -> bool {
        path.starts_with("/Volumes")
    }
}

/// The legacy single drop-folder setup as a route.
pub fn main_route(ai: &AiRouterConfig, vault_folder: &Path) -> RouteConfig {
    let source = ai
        .nas_ingest_folder
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| vault_folder.join("To NAS"));
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Drop folder".to_string());
    RouteConfig {
        id: MAIN_ROUTE_ID.to_string(),
        name,
        enabled: true,
        source: source.to_string_lossy().to_string(),
        destination: ai.smb_target.clone().unwrap_or_default(),
        mode: if ai.routing_mode == ROUTING_MODE_ORGANIZE { MODE_ORGANIZE } else { MODE_MOVE }.to_string(),
        auto: ai.auto_route,
        ai: ai.enabled,
        use_review_folder: ai.use_review_folder,
        scan_subfolders: false,
        // The original drop folder renames on name clashes instead of skipping.
        skip_duplicates: false,
        vault: ai.vault_routing_enabled,
        rules: ai
            .rules
            .as_deref()
            .unwrap_or("")
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect(),
        layout: None,
        template: None,
    }
}

/// Every route: the main one first, then the extra routes from `[[ai.routes]]`.
pub fn effective_routes(ai: &AiRouterConfig, vault_folder: &Path) -> Vec<RouteConfig> {
    let mut out = vec![main_route(ai, vault_folder)];
    out.extend(ai.routes.iter().filter(|r| !r.is_main()).cloned());
    out
}

pub fn find_route(ai: &AiRouterConfig, vault_folder: &Path, id: Option<&str>) -> RouteConfig {
    let id = id.unwrap_or(MAIN_ROUTE_ID);
    effective_routes(ai, vault_folder)
        .into_iter()
        .find(|r| r.id == id)
        .unwrap_or_else(|| main_route(ai, vault_folder))
}

// ---------------------------------------------------------------- validation

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RouteProblem {
    pub route_id: String,
    pub message: String,
}

/// Lowercased components without trailing separators; macOS volumes are case-insensitive.
fn norm(p: &Path) -> Vec<String> {
    p.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_lowercase()),
            Component::RootDir => Some("/".to_string()),
            _ => None,
        })
        .collect()
}

/// True if `inner` is `outer` or inside it.
pub fn path_within(inner: &Path, outer: &Path) -> bool {
    let (i, o) = (norm(inner), norm(outer));
    !o.is_empty() && i.len() >= o.len() && i[..o.len()] == o[..]
}

/// Problems that would make routes fight over files or feed into each other.
pub fn validate_routes(routes: &[RouteConfig]) -> Vec<RouteProblem> {
    let mut problems = Vec::new();
    let mut push = |id: &str, msg: String| problems.push(RouteProblem { route_id: id.to_string(), message: msg });

    for r in routes {
        if r.name.trim().is_empty() {
            push(&r.id, "Give this route a name.".into());
        }
        let src = r.source_path();
        if !src.is_absolute() {
            push(&r.id, "Choose a source folder.".into());
            continue;
        }
        let has_parent_ref = |p: &Path| p.components().any(|c| matches!(c, Component::ParentDir));
        if has_parent_ref(&src) || r.destination_root().is_some_and(|d| has_parent_ref(&d)) {
            push(&r.id, "Folder paths cannot contain \"..\". Choose the folder directly.".into());
            continue;
        }
        if ![MODE_MOVE, MODE_COPY, MODE_ORGANIZE].contains(&r.mode.as_str()) {
            push(&r.id, format!("Unknown mode '{}'.", r.mode));
        }
        match r.destination_root() {
            None => push(&r.id, "Choose a destination folder.".into()),
            Some(d) if !d.is_absolute() => push(&r.id, "Choose a destination folder.".into()),
            Some(d) if !r.organize_in_place() => {
                if path_within(&d, &src) {
                    push(&r.id, "The destination is inside the source folder, so files would be picked up again.".into());
                } else if path_within(&src, &d) {
                    push(&r.id, "The source folder is inside the destination.".into());
                }
            }
            _ => {}
        }
        if let Some(layout) = &r.layout {
            let unknown = unknown_tokens(layout);
            if !unknown.is_empty() {
                push(&r.id, format!("Unknown folder token(s): {}", unknown.join(", ")));
            }
        }
        for rule in &r.rules {
            if let Some((_, dest)) = crate::ai::parse_rule(rule) {
                let unknown = unknown_tokens(&dest);
                if !unknown.is_empty() {
                    push(&r.id, format!("Rule '{rule}' uses unknown token(s): {}", unknown.join(", ")));
                }
            }
        }
    }

    for (i, a) in routes.iter().enumerate() {
        let a_src = a.source_path();
        if !a_src.is_absolute() {
            continue;
        }
        for (j, b) in routes.iter().enumerate() {
            if i == j {
                continue;
            }
            let b_src = b.source_path();
            if j > i && b_src.is_absolute() && (path_within(&a_src, &b_src) || path_within(&b_src, &a_src)) {
                push(&b.id, format!("Its source folder overlaps with the route '{}'. Each folder can belong to one route.", a.name));
            }
            if let Some(b_dest) = b.destination_root()
                && !b.organize_in_place() && b_dest.is_absolute() && path_within(&a_src, &b_dest) {
                    push(&a.id, format!("Its source folder is inside the destination of '{}', so files would bounce between routes.", b.name));
                }
        }
    }
    problems
}

/// Ids are short and filesystem-safe; based on the name, unique among `existing`.
pub fn make_route_id(name: &str, existing: &[RouteConfig]) -> String {
    let base: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base = if base.is_empty() || base == MAIN_ROUTE_ID { "route".to_string() } else { base.chars().take(40).collect() };
    let mut id = base.clone();
    let mut n = 2;
    while existing.iter().any(|r| r.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

// ---------------------------------------------------------------- templates

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RouteTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    pub mode: String,
    pub scan_subfolders: bool,
    pub layout: Option<String>,
    pub rules: Vec<String>,
}

pub fn route_templates() -> Vec<RouteTemplate> {
    let t = |id: &str, name: &str, description: &str, mode: &str, scan: bool, layout: Option<&str>, rules: &[&str]| RouteTemplate {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        mode: mode.into(),
        scan_subfolders: scan,
        layout: layout.map(Into::into),
        rules: rules.iter().map(|s| s.to_string()).collect(),
    };
    vec![
        t(
            "photography",
            "Photography",
            "Shoots filed by the date they were taken. Drop into a subfolder named after the client to file it under that client. RAW, JPEG and sidecar files stay together.",
            MODE_COPY,
            true,
            Some("Shoots/{year}/{date} {source_folder}"),
            &[
                "*.mp4, *.mov, *.mts go to Video/{year}/{date} {source_folder}",
                "*.psd, *.tif, *.tiff go to Edits/{year}/{source_folder}",
            ],
        ),
        t(
            "website-backups",
            "Website Backups",
            "Hosting backups and database dumps filed by host.",
            MODE_MOVE,
            false,
            None,
            &[
                "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup",
                "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine",
                "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable",
                "*.wpress go to Local Sites & Exports",
            ],
        ),
        t(
            "documents",
            "Documents",
            "Invoices, statements and PDFs filed by year.",
            MODE_MOVE,
            false,
            Some("Documents/{year}"),
            &[
                "invoice, receipt go to Finance/Invoices/{year}",
                "statement go to Finance/Statements/{year}",
                "contract, agreement go to Contracts",
            ],
        ),
        t(
            "family-photos",
            "Family Photos",
            "Phone and camera photos filed by year and month.",
            MODE_MOVE,
            true,
            Some("Photos/{year}/{year}-{month}"),
            &["*.mp4, *.mov go to Videos/{year}"],
        ),
        t("blank", "Blank", "Start from scratch with your own rules.", MODE_MOVE, false, None, &[]),
    ]
}

// ---------------------------------------------------------------- folder tokens

/// Facts about one file used to fill in folder tokens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileContext {
    /// Capture date from EXIF when available, otherwise the modified date.
    pub date: NaiveDate,
    pub ext: String,
    /// First subfolder of the source the file was found in (e.g. a client name).
    pub source_folder: Option<String>,
}

const TOKENS: &[&str] = &["year", "month", "month_name", "day", "date", "ext", "source_folder"];
const DATE_TOKENS: &[&str] = &["year", "month", "month_name", "day", "date"];

fn token_names(template: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else { break };
        out.push(after[..end].trim().to_string());
        rest = &after[end + 1..];
    }
    out
}

fn canonical_token(name: &str) -> String {
    let n = name.trim().to_lowercase();
    n.strip_prefix("taken:").map(str::to_string).unwrap_or(n)
}

pub fn unknown_tokens(template: &str) -> Vec<String> {
    token_names(template)
        .into_iter()
        .filter(|t| !TOKENS.contains(&canonical_token(t).as_str()))
        .collect()
}

pub fn has_tokens(template: &str) -> bool {
    !token_names(template).is_empty()
}

/// True when filling `template` needs the file's date (so EXIF is only read when useful).
pub fn needs_date(template: &str) -> bool {
    token_names(template).iter().any(|t| DATE_TOKENS.contains(&canonical_token(t).as_str()))
}

const MONTH_NAMES: [&str; 12] = [
    "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
];

/// Fill in `{year}`, `{month}`, `{month_name}`, `{day}`, `{date}`, `{ext}` and `{source_folder}`
/// (also accepted with a `taken:` prefix). Unknown tokens are left as written. Empty values
/// collapse cleanly, so "Shoots/{date} {source_folder}" becomes "Shoots/2026-10-17" when the
/// file was not in a subfolder.
pub fn expand_tokens(template: &str, ctx: &FileContext) -> String {
    let mut out = String::with_capacity(template.len() + 16);
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let raw = &after[..end];
        let value = match canonical_token(raw).as_str() {
            "year" => format!("{:04}", ctx.date.year()),
            "month" => format!("{:02}", ctx.date.month()),
            "month_name" => MONTH_NAMES[(ctx.date.month0()) as usize].to_string(),
            "day" => format!("{:02}", ctx.date.day()),
            "date" => ctx.date.format("%Y-%m-%d").to_string(),
            "ext" => if ctx.ext.is_empty() { "other".to_string() } else { ctx.ext.clone() },
            "source_folder" => ctx.source_folder.clone().unwrap_or_default(),
            _ => format!("{{{raw}}}"),
        };
        out.push_str(&value);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    // Tidy each folder name: collapse runs of spaces and trim spaces and dashes left by empty tokens.
    out.split('/')
        .map(|part| {
            let squeezed = part.split_whitespace().collect::<Vec<_>>().join(" ");
            squeezed.trim_matches(|c: char| c == ' ' || c == '-').to_string()
        })
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn file_extension(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

pub fn is_sidecar(name: &str) -> bool {
    SIDECAR_EXTENSIONS.contains(&file_extension(name).as_str())
}

/// Group key for a photo and its sidecars: parent folder plus lowercased name without extension.
pub fn sidecar_key(path: &Path) -> (PathBuf, String) {
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    (parent, stem)
}

/// Build the token context for a file. EXIF is only read when `want_date_from_exif`.
pub fn file_context(path: &Path, source_folder: Option<String>, want_date_from_exif: bool) -> FileContext {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let exif = if want_date_from_exif { exif_capture_date(path) } else { None };
    let date = exif.unwrap_or_else(|| {
        std::fs::metadata(path)
            .and_then(|m| m.modified())
            .map(|t| chrono::DateTime::<chrono::Local>::from(t).date_naive())
            .unwrap_or_else(|_| chrono::Local::now().date_naive())
    });
    FileContext { date, ext: file_extension(&name), source_folder }
}

// ---------------------------------------------------------------- EXIF capture date

/// Read the capture date (DateTimeOriginal, else DateTime) from JPEG files and TIFF-based
/// RAW files (CR2, NEF, ARW, DNG, ORF, RW2, PEF, TIFF). Returns None for anything else
/// (HEIC, CR3, video), and the caller falls back to the modified date.
pub fn exif_capture_date(path: &Path) -> Option<NaiveDate> {
    use std::io::Read;
    let mut buf = Vec::with_capacity(256 * 1024);
    std::fs::File::open(path).ok()?.take(256 * 1024).read_to_end(&mut buf).ok()?;
    let tiff = if buf.starts_with(&[0xFF, 0xD8]) { jpeg_exif_block(&buf)? } else { &buf[..] };
    tiff_capture_date(tiff)
}

fn jpeg_exif_block(buf: &[u8]) -> Option<&[u8]> {
    let mut i = 2;
    while i + 4 <= buf.len() {
        if buf[i] != 0xFF {
            return None;
        }
        let marker = buf[i + 1];
        if marker == 0xD9 || marker == 0xDA {
            return None; // end of image / start of scan: no EXIF before the image data
        }
        let len = u16::from_be_bytes([buf[i + 2], buf[i + 3]]) as usize;
        let start = i + 4;
        let end = (i + 2 + len).min(buf.len());
        if marker == 0xE1 && end > start + 6 && &buf[start..start + 6] == b"Exif\0\0" {
            return Some(&buf[start + 6..end]);
        }
        if len < 2 {
            return None;
        }
        i += 2 + len;
    }
    None
}

fn tiff_capture_date(t: &[u8]) -> Option<NaiveDate> {
    if t.len() < 8 {
        return None;
    }
    let le = match &t[..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |o: usize| -> Option<u16> {
        let b = t.get(o..o + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let u32_at = |o: usize| -> Option<u32> {
        let b = t.get(o..o + 4)?;
        Some(if le { u32::from_le_bytes([b[0], b[1], b[2], b[3]]) } else { u32::from_be_bytes([b[0], b[1], b[2], b[3]]) })
    };
    // Returns (tag -> (type, count, value_or_offset)) lookups for one IFD.
    let find = |ifd: usize, want: u16| -> Option<(u16, u32, u32)> {
        let n = u16_at(ifd)? as usize;
        for k in 0..n.min(512) {
            let e = ifd + 2 + k * 12;
            if u16_at(e)? == want {
                return Some((u16_at(e + 2)?, u32_at(e + 4)?, u32_at(e + 8)?));
            }
        }
        None
    };
    let ascii_date = |(typ, count, off): (u16, u32, u32)| -> Option<NaiveDate> {
        if typ != 2 || count < 10 {
            return None;
        }
        let s = t.get(off as usize..off as usize + 10)?;
        let s = std::str::from_utf8(s).ok()?;
        let d = NaiveDate::parse_from_str(s, "%Y:%m:%d").ok()?;
        // Cameras with an unset clock write 0000:00:00 or 1970; treat those as unknown.
        (d.year() >= 1990).then_some(d)
    };
    let ifd0 = u32_at(4)? as usize;
    if let Some((_, _, exif_off)) = find(ifd0, 0x8769)
        && let Some(d) = find(exif_off as usize, 0x9003).and_then(ascii_date) {
            return Some(d);
        }
    find(ifd0, 0x0132).and_then(ascii_date)
}

// ---------------------------------------------------------------- source scanning & duplicates

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SourceFile {
    pub path: PathBuf,
    /// First subfolder below the source, if the file was found in one.
    pub source_folder: Option<String>,
}

/// List files waiting in `source`. Folders whose names start with `.` or `_` (such as
/// `_Needs Review`) are never entered. `skip_file` filters partial downloads and the like.
pub fn collect_source_files(source: &Path, scan_subfolders: bool, skip_file: impl Fn(&str) -> bool) -> Vec<SourceFile> {
    let depth = if scan_subfolders { MAX_SCAN_DEPTH } else { 1 };
    let mut out = Vec::new();
    let walker = walkdir::WalkDir::new(source).min_depth(1).max_depth(depth).sort_by_file_name().into_iter();
    for entry in walker.filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        !(e.depth() > 0 && e.file_type().is_dir() && (name.starts_with('.') || name.starts_with('_')))
    }) {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if skip_file(&name) {
            continue;
        }
        let source_folder = entry
            .path()
            .strip_prefix(source)
            .ok()
            .and_then(|rel| {
                let mut comps = rel.components();
                let first = comps.next()?;
                comps.next()?; // only when there is at least one more component (the file)
                Some(first.as_os_str().to_string_lossy().to_string())
            });
        out.push(SourceFile { path: entry.path().to_path_buf(), source_folder });
    }
    out
}

/// Cheap check: same size and a modified time within 2 seconds (SMB rounds times).
pub fn same_size_and_mtime(a: &Path, b: &Path) -> bool {
    let (Ok(ma), Ok(mb)) = (std::fs::metadata(a), std::fs::metadata(b)) else { return false };
    if ma.len() != mb.len() {
        return false;
    }
    match (ma.modified(), mb.modified()) {
        (Ok(ta), Ok(tb)) => {
            let diff = if ta > tb { ta.duration_since(tb) } else { tb.duration_since(ta) };
            diff.map(|d| d.as_secs() <= 2).unwrap_or(false)
        }
        _ => false,
    }
}

/// Full byte-by-byte comparison. Used before deleting a source whose copy already exists.
pub fn files_identical(a: &Path, b: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    if std::fs::metadata(a)?.len() != std::fs::metadata(b)?.len() {
        return Ok(false);
    }
    let (mut fa, mut fb) = (std::fs::File::open(a)?, std::fs::File::open(b)?);
    let (mut ba, mut bb) = (vec![0u8; 1 << 20], vec![0u8; 1 << 20]);
    loop {
        let na = read_full(&mut fa, &mut ba)?;
        let nb = read_full(&mut fb, &mut bb)?;
        if na != nb || ba[..na] != bb[..nb] {
            return Ok(false);
        }
        if na == 0 {
            return Ok(true);
        }
    }

    fn read_full(f: &mut std::fs::File, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut n = 0;
        while n < buf.len() {
            match f.read(&mut buf[n..])? {
                0 => break,
                k => n += k,
            }
        }
        Ok(n)
    }
}

/// Key that identifies one version of a source file, used to remember what copy mode
/// already handled (the original stays in place, so it would otherwise be copied again).
pub fn seen_key(path: &Path) -> Option<String> {
    let m = std::fs::metadata(path).ok()?;
    let mtime = m.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(format!("{}|{}|{}", path.display(), m.len(), mtime))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn route(id: &str, src: &str, dest: &str, mode: &str) -> RouteConfig {
        RouteConfig {
            id: id.into(),
            name: id.into(),
            enabled: true,
            source: src.into(),
            destination: dest.into(),
            mode: mode.into(),
            auto: true,
            ai: false,
            use_review_folder: true,
            scan_subfolders: false,
            skip_duplicates: true,
            vault: false,
            rules: vec![],
            layout: None,
            template: None,
        }
    }

    #[test]
    fn main_route_mirrors_legacy_settings() {
        let ai = AiRouterConfig {
            smb_target: Some("/Volumes/HomeNAS".into()),
            rules: Some("a go to A\n\n b go to B ".into()),
            auto_route: false,
            ..Default::default()
        };
        let r = main_route(&ai, Path::new("/Users/x/RenegadeBox"));
        assert_eq!(r.id, MAIN_ROUTE_ID);
        assert_eq!(r.source, "/Users/x/RenegadeBox/To NAS");
        assert_eq!(r.name, "To NAS");
        assert_eq!(r.destination, "/Volumes/HomeNAS");
        assert_eq!(r.rules, vec!["a go to A", "b go to B"]);
        assert!(!r.auto);
        assert!(!r.skip_duplicates);
        assert_eq!(effective_routes(&ai, Path::new("/Users/x/RenegadeBox")).len(), 1);
    }

    #[test]
    fn old_configs_without_routes_still_parse() {
        let ai: AiRouterConfig = toml::from_str("enabled = true\nsmb_target = \"/Volumes/A\"\n").unwrap();
        assert!(ai.routes.is_empty());
        let with: AiRouterConfig = toml::from_str(
            "[[routes]]\nid = \"photos\"\nname = \"Photos\"\nsource = \"/Users/x/Photo Inbox\"\ndestination = \"/Volumes/PhotoNAS\"\nmode = \"copy\"\n",
        )
        .unwrap();
        assert_eq!(with.routes.len(), 1);
        assert!(with.routes[0].auto && with.routes[0].skip_duplicates && with.routes[0].enabled);
    }

    #[test]
    fn validation_catches_overlaps_and_loops() {
        let ok = vec![
            route("main", "/Users/x/RenegadeBox/To NAS", "/Volumes/HomeNAS", MODE_MOVE),
            route("photos", "/Users/x/Photo Inbox", "/Volumes/PhotoNAS", MODE_COPY),
        ];
        assert!(validate_routes(&ok).is_empty(), "{:?}", validate_routes(&ok));

        let shared = vec![
            route("a", "/Users/x/Inbox", "/Volumes/A", MODE_MOVE),
            route("b", "/Users/x/inbox/Sub", "/Volumes/B", MODE_MOVE),
        ];
        assert!(validate_routes(&shared).iter().any(|p| p.route_id == "b" && p.message.contains("overlaps")));

        let looped = vec![
            route("a", "/Users/x/Inbox", "/Volumes/A", MODE_MOVE),
            route("b", "/Volumes/A/Incoming", "/Volumes/B", MODE_MOVE),
        ];
        assert!(validate_routes(&looped).iter().any(|p| p.route_id == "b" && p.message.contains("bounce")));

        let self_loop = vec![route("a", "/Users/x/Inbox", "/Users/x/Inbox/Sorted", MODE_MOVE)];
        assert!(!validate_routes(&self_loop).is_empty());

        let organize = vec![route("a", "/Users/x/Inbox", "", MODE_ORGANIZE)];
        assert!(validate_routes(&organize).is_empty());

        let mut bad_layout = route("a", "/Users/x/Inbox", "/Volumes/A", MODE_MOVE);
        bad_layout.layout = Some("{year}/{client}".into());
        assert!(validate_routes(&[bad_layout]).iter().any(|p| p.message.contains("client")));
    }

    #[test]
    fn tokens_expand_and_collapse_empty_values() {
        let ctx = FileContext { date: NaiveDate::from_ymd_opt(2026, 10, 17).unwrap(), ext: "cr2".into(), source_folder: Some("Smith Wedding".into()) };
        assert_eq!(expand_tokens("Shoots/{year}/{date} {source_folder}", &ctx), "Shoots/2026/2026-10-17 Smith Wedding");
        assert_eq!(expand_tokens("{taken:year}/{month_name}/{ext}", &ctx), "2026/October/cr2");
        let none = FileContext { source_folder: None, ..ctx.clone() };
        assert_eq!(expand_tokens("Shoots/{year}/{date} {source_folder}", &none), "Shoots/2026/2026-10-17");
        assert_eq!(expand_tokens("Clients/{source_folder}/Raw", &none), "Clients/Raw");
        assert_eq!(unknown_tokens("{year}/{client}"), vec!["client"]);
        assert!(needs_date("A/{taken:date}") && !needs_date("A/{source_folder}"));
    }

    #[test]
    fn reads_exif_date_from_jpeg_and_tiff() {
        // Minimal little-endian TIFF with IFD0 -> Exif IFD -> DateTimeOriginal.
        let mut t = Vec::new();
        t.extend_from_slice(b"II*\0");
        t.extend_from_slice(&8u32.to_le_bytes());
        // IFD0 at 8: one entry (ExifIFD pointer) -> 26
        t.extend_from_slice(&1u16.to_le_bytes());
        t.extend_from_slice(&0x8769u16.to_le_bytes());
        t.extend_from_slice(&4u16.to_le_bytes());
        t.extend_from_slice(&1u32.to_le_bytes());
        t.extend_from_slice(&26u32.to_le_bytes());
        t.extend_from_slice(&0u32.to_le_bytes());
        // Exif IFD at 26: one entry DateTimeOriginal ASCII count 20 at offset 44
        t.extend_from_slice(&1u16.to_le_bytes());
        t.extend_from_slice(&0x9003u16.to_le_bytes());
        t.extend_from_slice(&2u16.to_le_bytes());
        t.extend_from_slice(&20u32.to_le_bytes());
        t.extend_from_slice(&44u32.to_le_bytes());
        t.extend_from_slice(&0u32.to_le_bytes());
        t.extend_from_slice(b"2019:07:04 10:11:12\0");
        let want = NaiveDate::from_ymd_opt(2019, 7, 4).unwrap();
        assert_eq!(tiff_capture_date(&t), Some(want));

        let dir = tempdir().unwrap();
        let raw = dir.path().join("a.dng");
        std::fs::write(&raw, &t).unwrap();
        assert_eq!(exif_capture_date(&raw), Some(want));

        let mut jpg = vec![0xFF, 0xD8, 0xFF, 0xE1];
        jpg.extend_from_slice(&((t.len() + 8) as u16).to_be_bytes());
        jpg.extend_from_slice(b"Exif\0\0");
        jpg.extend_from_slice(&t);
        jpg.extend_from_slice(&[0xFF, 0xD9]);
        let jp = dir.path().join("a.jpg");
        std::fs::write(&jp, &jpg).unwrap();
        assert_eq!(exif_capture_date(&jp), Some(want));

        let txt = dir.path().join("a.txt");
        std::fs::write(&txt, b"hello").unwrap();
        assert_eq!(exif_capture_date(&txt), None);
        // Falls back to the modified date.
        assert_eq!(file_context(&txt, None, true).date, chrono::Local::now().date_naive());
    }

    #[test]
    fn scanning_skips_review_and_hidden_folders_and_reports_client_folder() {
        let dir = tempdir().unwrap();
        let s = dir.path();
        std::fs::create_dir_all(s.join("Smith Wedding/raw")).unwrap();
        std::fs::create_dir_all(s.join("_Needs Review")).unwrap();
        std::fs::create_dir_all(s.join(".hidden")).unwrap();
        std::fs::write(s.join("top.jpg"), b"1").unwrap();
        std::fs::write(s.join("Smith Wedding/a.cr2"), b"1").unwrap();
        std::fs::write(s.join("Smith Wedding/raw/b.cr2"), b"1").unwrap();
        std::fs::write(s.join("_Needs Review/c.jpg"), b"1").unwrap();
        std::fs::write(s.join(".hidden/d.jpg"), b"1").unwrap();
        std::fs::write(s.join("e.part"), b"1").unwrap();

        let flat = collect_source_files(s, false, |n| n.ends_with(".part"));
        assert_eq!(flat.len(), 1);
        assert_eq!(flat[0].source_folder, None);

        let deep = collect_source_files(s, true, |n| n.ends_with(".part"));
        let names: Vec<_> = deep.iter().map(|f| (f.path.file_name().unwrap().to_string_lossy().to_string(), f.source_folder.clone())).collect();
        assert!(names.contains(&("a.cr2".into(), Some("Smith Wedding".into()))));
        assert!(names.contains(&("b.cr2".into(), Some("Smith Wedding".into()))));
        assert!(names.contains(&("top.jpg".into(), None)));
        assert_eq!(names.len(), 3);
    }

    #[test]
    fn duplicate_checks() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a");
        let b = dir.path().join("b");
        std::fs::write(&a, b"same bytes").unwrap();
        crate::ai::copy_data_only(&a, &b).unwrap();
        assert!(same_size_and_mtime(&a, &b));
        assert!(files_identical(&a, &b).unwrap());
        std::fs::write(&b, b"diff bytes").unwrap();
        assert!(!files_identical(&a, &b).unwrap());
        assert!(is_sidecar("IMG_1.XMP") && !is_sidecar("IMG_1.CR2"));
        assert_eq!(sidecar_key(Path::new("/x/IMG_1.CR2")), sidecar_key(Path::new("/x/img_1.xmp")));
    }

    #[test]
    fn ids_are_unique_and_safe() {
        let existing = vec![route("photography", "/a", "/b", MODE_MOVE)];
        assert_eq!(make_route_id("Photography", &existing), "photography-2");
        assert_eq!(make_route_id("Client Work / 2026!", &[]), "client-work-2026");
        assert_eq!(make_route_id("Main", &[]), "route");
    }

    #[test]
    fn routes_round_trip_through_config_toml() {
        #[derive(Serialize, Deserialize)]
        struct Wrapper {
            folder: String,
            ai: AiRouterConfig,
        }
        let mut r = route("photos", "/Users/x/Photo Inbox", "/Volumes/PhotoNAS", MODE_COPY);
        r.rules = vec!["*.mov go to Video/{year}".into()];
        r.layout = Some("Shoots/{year}/{date} {source_folder}".into());
        let ai = AiRouterConfig { rules: Some("a go to A".into()), routes: vec![r], ..Default::default() };
        let text = toml::to_string(&Wrapper { folder: "/Users/x/RenegadeBox".into(), ai: ai.clone() }).unwrap();
        assert!(text.contains("[[ai.routes]]"), "{text}");
        let back: Wrapper = toml::from_str(&text).unwrap();
        assert_eq!(back.ai.routes, ai.routes);
        assert_eq!(back.ai.rules, ai.rules);
    }

    #[test]
    fn extra_routes_default_to_no_ai() {
        let r: RouteConfig = toml::from_str("id = \"r\"\nname = \"Docs\"\nsource = \"/Users/x/Docs\"\ndestination = \"/Volumes/A\"\n").unwrap();
        assert!(!r.ai);
    }

    #[test]
    fn parent_dir_paths_are_rejected() {
        let r = route("r", "/Volumes/A/../../Users/x/Inbox", "/Volumes/A", MODE_MOVE);
        assert!(!validate_routes(&[r]).is_empty());
    }
}
