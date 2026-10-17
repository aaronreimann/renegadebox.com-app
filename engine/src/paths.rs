//! Sync-relative path handling: normalization, validation, ignore rules, conflict names.

use std::path::{Component, Path, PathBuf};

use anyhow::{Result, bail};
use unicode_normalization::UnicodeNormalization;

pub const TMP_PREFIX: &str = ".rbox-tmp-";

/// Relative, `/`-separated, NFC-normalized path for `abs` under `root`.
/// Returns None for paths that cannot be represented (non-UTF-8, outside root).
pub fn to_rel(root: &Path, abs: &Path) -> Option<String> {
    let rel = abs.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in rel.components() {
        match c {
            Component::Normal(s) => parts.push(s.to_str()?.nfc().collect::<String>()),
            _ => return None,
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("/")) }
}

/// Validate a relative path that came from the journal before touching the filesystem.
pub fn validate_rel(rel: &str) -> Result<()> {
    if rel.is_empty() || rel.len() > 4096 || rel.starts_with('/') || rel.contains('\\') || rel.chars().any(char::is_control) {
        bail!("invalid sync path {rel:?}");
    }
    for seg in rel.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            bail!("invalid sync path segment in {rel:?}");
        }
    }
    // Every device stores NFC; anything else would alias an existing path on macOS.
    if !unicode_normalization::is_nfc(rel) {
        bail!("sync path {rel:?} is not NFC-normalized");
    }
    Ok(())
}

/// Absolute path for a validated relative path. Refuses to traverse symlinked
/// ancestors so a remote entry can never write outside the sync root.
pub fn to_abs(root: &Path, rel: &str) -> Result<PathBuf> {
    validate_rel(rel)?;
    let mut p = root.to_path_buf();
    let segs: Vec<&str> = rel.split('/').collect();
    for (i, seg) in segs.iter().enumerate() {
        p.push(seg);
        if i + 1 < segs.len()
            && let Ok(md) = std::fs::symlink_metadata(&p)
            && md.file_type().is_symlink()
        {
            bail!("refusing to write through symlinked directory {}", p.display());
        }
    }
    Ok(p)
}

/// Files the engine never syncs.
pub fn is_ignored(name: &str) -> bool {
    name.starts_with(TMP_PREFIX)
        || name == ".DS_Store"
        || name == "Thumbs.db"
        || name == "desktop.ini"
        || name == "Icon\r"
        || name.starts_with("~$")
        || (name.starts_with(".~lock.") && name.ends_with('#'))
}

/// Top-level folders of the sync root that stay on this device: the drop folders that file
/// routing empties onto a NAS. Only the root-level name is local; a "To NAS" folder deeper in
/// the tree syncs normally. Files under these that were synced by an older build are left
/// alone (never published as deleted) — see Engine::scan.
pub const LOCAL_ONLY_ROOT_DIRS: &[&str] = &["To NAS", ".nas_staging"];

pub fn is_local_only(rel: &str) -> bool {
    let top = rel.split('/').next().unwrap_or(rel);
    LOCAL_ONLY_ROOT_DIRS.contains(&top)
}

pub fn rel_is_ignored(rel: &str) -> bool {
    rel.split('/').any(is_ignored)
}

/// `dir/report.pdf` -> `dir/report (conflicted copy from Laptop 2026-10-15 a1b2c3d4).pdf`
pub fn conflict_name(rel: &str, device_name: &str, date: &str, hash_hex: &str) -> String {
    let (dir, file) = match rel.rfind('/') {
        Some(i) => (&rel[..=i], &rel[i + 1..]),
        None => ("", rel),
    };
    let (stem, ext) = match file.rfind('.') {
        Some(i) if i > 0 => (&file[..i], &file[i..]),
        _ => (file, ""),
    };
    let device: String = device_name.chars().filter(|c| !matches!(c, '/' | '\\' | '\0')).collect();
    let short = &hash_hex[..hash_hex.len().min(8)];
    format!("{dir}{stem} (conflicted copy from {device} {date} {short}){ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_nfc_and_separators() {
        let root = Path::new("/r");
        // "é" as e + combining acute (NFD, as macOS may report it)
        let abs = Path::new("/r/Docs/cafe\u{301}.txt");
        assert_eq!(to_rel(root, abs).unwrap(), "Docs/caf\u{e9}.txt");
    }

    #[test]
    fn validate_rejects_escapes() {
        for bad in ["", "/etc/passwd", "../x", "a/../b", "a//b", "a/./b", "a\\b", "cafe\u{301}.txt", "a\nb"] {
            assert!(validate_rel(bad).is_err(), "{bad}");
        }
        assert!(validate_rel("Documents/finances.pdf").is_ok());
    }

    #[test]
    fn symlink_ancestor_refused() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
        assert!(to_abs(root.path(), "link/evil.txt").is_err());
        assert!(to_abs(root.path(), "ok/file.txt").is_ok());
    }

    #[test]
    fn ignores() {
        assert!(is_ignored(".DS_Store"));
        assert!(is_ignored(".rbox-tmp-123"));
        assert!(is_ignored("~$report.docx"));
        assert!(!is_ignored("report.docx"));
        assert!(rel_is_ignored("a/.rbox-tmp-x"));
        assert!(is_local_only("To NAS/backup.zip"));
        assert!(is_local_only(".nas_staging/x"));
        assert!(!is_local_only("Clients/To NAS/backup.zip"));
        assert!(!is_ignored("To NAS"));
    }

    #[test]
    fn conflict_names() {
        assert_eq!(
            conflict_name("dir/report.pdf", "Laptop", "2026-10-15", "a1b2c3d4e5"),
            "dir/report (conflicted copy from Laptop 2026-10-15 a1b2c3d4).pdf"
        );
        assert_eq!(conflict_name("Makefile", "PC", "2026-10-15", "ff00ff00"), "Makefile (conflicted copy from PC 2026-10-15 ff00ff00)");
        assert_eq!(conflict_name(".env", "PC", "2026-10-15", "ff00ff00"), ".env (conflicted copy from PC 2026-10-15 ff00ff00)");
    }
}
