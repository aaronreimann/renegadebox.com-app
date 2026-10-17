import Cocoa
import FinderSync
import SQLite3

// SQLite must copy bound strings: the NSString buffers are temporaries.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// The real home directory. The extension is sandboxed, so homeDirectoryForCurrentUser
/// points at its container instead.
private func realHome() -> URL {
    if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
        return URL(fileURLWithPath: String(cString: dir))
    }
    return FileManager.default.homeDirectoryForCurrentUser
}

@objc(RenegadeBoxFinderSync)
class FinderSync: FIFinderSync {

    private var myFolderURL: URL
    private var dbPath: String

    override init() {
        // Sync folder from the top-level `folder = "..."` in ~/.renegadebox/config.toml, else ~/RenegadeBox.
        let home = realHome()
        var folder = home.appendingPathComponent("RenegadeBox")

        let configPath = home.appendingPathComponent(".renegadebox/config.toml").path
        if let content = try? String(contentsOfFile: configPath, encoding: .utf8) {
            for line in content.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("[") { break } // top-level keys only
                if trimmed.hasPrefix("folder =") || trimmed.hasPrefix("folder=") {
                    let parts = trimmed.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                    if parts.count == 2 {
                        let pathStr = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"'\n\r\t "))
                        folder = URL(fileURLWithPath: (pathStr as NSString).expandingTildeInPath)
                    }
                    break
                }
            }
        }

        self.myFolderURL = folder
        self.dbPath = home.appendingPathComponent(".renegadebox/state.db").path
        super.init()

        FIFinderSyncController.default().directoryURLs = [self.myFolderURL]
        self.setupBadges()
    }

    private func setupBadges() {
        let controller = FIFinderSyncController.default()

        if let syncedImg = badgeImage(symbolName: "checkmark.circle.fill", color: .systemGreen) {
            controller.setBadgeImage(syncedImg, label: "Up to date", forBadgeIdentifier: "synced")
        }
        if let syncingImg = badgeImage(symbolName: "arrow.triangle.2.circlepath.circle.fill", color: .systemBlue) {
            controller.setBadgeImage(syncingImg, label: "Syncing", forBadgeIdentifier: "syncing")
        }
        if let conflictImg = badgeImage(symbolName: "exclamationmark.triangle.fill", color: .systemOrange) {
            controller.setBadgeImage(conflictImg, label: "Conflict", forBadgeIdentifier: "conflict")
        }
    }

    private func badgeImage(symbolName: String, color: NSColor) -> NSImage? {
        let size = NSSize(width: 16, height: 16)
        let image = NSImage(size: size, flipped: false) { rect in
            let config = NSImage.SymbolConfiguration(paletteColors: [color])
            if let symbol = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil)?.withSymbolConfiguration(config) {
                symbol.draw(in: rect)
                return true
            }
            return false
        }
        return image
    }

    // MARK: - Badge Management

    override func requestBadgeIdentifier(for url: URL) {
        guard let relative = relativePath(for: url) else { return }

        if relative.contains(" (conflicted copy ") {
            FIFinderSyncController.default().setBadgeIdentifier("conflict", for: url)
            return
        }

        // "" clears the badge: shown when the state is unknown rather than claiming "Up to date".
        FIFinderSyncController.default().setBadgeIdentifier(queryBadge(relative: relative), for: url)
    }

    /// Path relative to the sync folder ("" for the folder itself), or nil when outside it.
    private func relativePath(for url: URL) -> String? {
        let rootPath = myFolderURL.standardizedFileURL.path
        let filePath = url.standardizedFileURL.path

        if filePath == rootPath { return "" }
        if filePath.hasPrefix(rootPath + "/") {
            return String(filePath.dropFirst(rootPath.count + 1)).precomposedStringWithCanonicalMapping
        }
        return nil
    }

    private func queryBadge(relative: String) -> String {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            sqlite3_close(db)
            return ""
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 200)

        // A file the engine tracks.
        if !relative.isEmpty {
            var stmt: OpaquePointer?
            if sqlite3_prepare_v2(db, "SELECT synced_hash IS local_hash FROM files WHERE path = ? LIMIT 1;", -1, &stmt, nil) == SQLITE_OK {
                defer { sqlite3_finalize(stmt) }
                sqlite3_bind_text(stmt, 1, relative, -1, SQLITE_TRANSIENT)
                if sqlite3_step(stmt) == SQLITE_ROW {
                    return sqlite3_column_int(stmt, 0) == 1 ? "synced" : "syncing"
                }
            }
        }

        // A folder: dirty or conflicted if any file under it is. Range scan on the primary key
        // ('0' sorts right after '/'), so no LIKE escaping is needed.
        let lower = relative.isEmpty ? "" : relative + "/"
        let upper = relative.isEmpty ? "\u{10FFFF}" : relative + "0"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, """
            SELECT COUNT(*),
                   COALESCE(SUM(synced_hash IS NOT local_hash), 0),
                   COALESCE(SUM(instr(path, ' (conflicted copy ') > 0), 0)
            FROM files WHERE path >= ? AND path < ?;
            """, -1, &stmt, nil) == SQLITE_OK else { return "" }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, lower, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, upper, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return "" }

        let total = sqlite3_column_int64(stmt, 0)
        if total == 0 { return relative.isEmpty ? "synced" : "" } // empty root, or not tracked yet
        if sqlite3_column_int64(stmt, 2) > 0 { return "conflict" }
        return sqlite3_column_int64(stmt, 1) > 0 ? "syncing" : "synced"
    }

    // MARK: - Contextual Menus & Actions

    override var toolbarItemName: String {
        return "RenegadeBox"
    }

    override var toolbarItemToolTip: String {
        return "RenegadeBox"
    }

    override var toolbarItemImage: NSImage {
        return NSImage(systemSymbolName: "shippingbox", accessibilityDescription: "RenegadeBox") ?? NSImage()
    }

    // No "Sync Now": the sandbox cannot launch rbox, and a second process reading the vault
    // secrets would cost a Keychain prompt. The app syncs on every change anyway.
    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        let menu = NSMenu(title: "")
        menu.addItem(NSMenuItem(title: "Open RenegadeBox", action: #selector(openRenegadeBoxApp(_:)), keyEquivalent: ""))
        if menuKind == .contextualMenuForItems {
            menu.addItem(NSMenuItem(title: "Copy Relative Path", action: #selector(copyRelativePath(_:)), keyEquivalent: ""))
        }
        return menu
    }

    @objc func openRenegadeBoxApp(_ sender: AnyObject?) {
        let workspace = NSWorkspace.shared
        let appUrl = workspace.urlForApplication(withBundleIdentifier: "com.renegadebox.desktop")
            ?? realHome().appendingPathComponent("Applications/RenegadeBox.app")
        workspace.openApplication(at: appUrl, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
    }

    @objc func copyRelativePath(_ sender: AnyObject?) {
        guard let target = FIFinderSyncController.default().selectedItemURLs()?.first,
              let rel = relativePath(for: target), !rel.isEmpty else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(rel, forType: .string)
    }
}
