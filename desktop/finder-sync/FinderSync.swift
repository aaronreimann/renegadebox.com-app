import Cocoa
import FinderSync
import SQLite3

@objc(RenegadeBoxFinderSync)
class FinderSync: FIFinderSync {

    private var myFolderURL: URL
    private var dbPath: String

    override init() {
        // Resolve sync folder from ~/.renegadebox/config.toml or default to ~/RenegadeBox
        let home = FileManager.default.homeDirectoryForCurrentUser
        var folder = home.appendingPathComponent("RenegadeBox")
        
        let configPath = home.appendingPathComponent(".renegadebox/config.toml").path
        if let content = try? String(contentsOfFile: configPath, encoding: .utf8) {
            for line in content.components(separatedBy: .newlines) {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.hasPrefix("folder =") {
                    let parts = trimmed.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                    if parts.count == 2 {
                        let pathStr = parts[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"'\n\r\t "))
                        let expanded = (pathStr as NSString).expandingTildeInPath
                        folder = URL(fileURLWithPath: expanded)
                    }
                }
            }
        }

        self.myFolderURL = folder
        self.dbPath = home.appendingPathComponent(".renegadebox/state.db").path
        super.init()

        // Set monitored directory
        FIFinderSyncController.default().directoryURLs = [self.myFolderURL]

        // Register badge images
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
        let relative = relativePath(for: url)
        if relative.isEmpty {
            // Root folder
            FIFinderSyncController.default().setBadgeIdentifier("synced", for: url)
            return
        }

        if relative.contains(" (conflicted copy ") {
            FIFinderSyncController.default().setBadgeIdentifier("conflict", for: url)
            return
        }

        let badge = queryFileBadge(relative: relative)
        FIFinderSyncController.default().setBadgeIdentifier(badge, for: url)
    }

    private func relativePath(for url: URL) -> String {
        let rootPath = myFolderURL.standardizedFileURL.path
        let filePath = url.standardizedFileURL.path

        if filePath == rootPath {
            return ""
        }
        if filePath.hasPrefix(rootPath + "/") {
            let start = filePath.index(filePath.startIndex, offsetBy: rootPath.count + 1)
            return String(filePath[start...])
        }
        return ""
    }

    private func queryFileBadge(relative: String) -> String {
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            return "synced"
        }
        defer { sqlite3_close(db) }

        // 1. Direct file match
        var stmt: OpaquePointer?
        let sql = "SELECT synced_hash, local_hash FROM files WHERE path = ? LIMIT 1;"
        if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
            sqlite3_bind_text(stmt, 1, (relative as NSString).utf8String, -1, nil)
            if sqlite3_step(stmt) == SQLITE_ROW {
                let synced = sqlite3_column_text(stmt, 0).map { String(cString: $0) }
                let local = sqlite3_column_text(stmt, 1).map { String(cString: $0) }
                sqlite3_finalize(stmt)

                if let s = synced, let l = local, s == l {
                    return "synced"
                } else {
                    return "syncing"
                }
            }
            sqlite3_finalize(stmt)
        }

        // 2. Directory check: check for any dirty or conflict children
        var dirStmt: OpaquePointer?
        let prefix = relative + "/%"
        let dirSql = "SELECT 1 FROM files WHERE path LIKE ? AND (synced_hash IS NOT local_hash OR path LIKE '%(conflicted copy%') LIMIT 1;"
        if sqlite3_prepare_v2(db, dirSql, -1, &dirStmt, nil) == SQLITE_OK {
            sqlite3_bind_text(dirStmt, 1, (prefix as NSString).utf8String, -1, nil)
            if sqlite3_step(dirStmt) == SQLITE_ROW {
                sqlite3_finalize(dirStmt)
                return "syncing"
            }
            sqlite3_finalize(dirStmt)
        }

        return "synced"
    }

    // MARK: - Contextual Menus & Actions

    override var toolbarItemName: String {
        return "RenegadeBox"
    }

    override var toolbarItemToolTip: String {
        return "RenegadeBox Sync"
    }

    override var toolbarItemImage: NSImage {
        if let img = NSImage(systemSymbolName: "shippingbox.fill", accessibilityDescription: "RenegadeBox") {
            return img
        }
        return NSImage()
    }

    override func menu(for menuKind: FIMenuKind) -> NSMenu? {
        let menu = NSMenu(title: "")

        let openAppItem = NSMenuItem(title: "Open RenegadeBox", action: #selector(openRenegadeBoxApp(_:)), keyEquivalent: "")
        menu.addItem(openAppItem)

        let syncNowItem = NSMenuItem(title: "Sync Now", action: #selector(triggerSyncNow(_:)), keyEquivalent: "")
        menu.addItem(syncNowItem)

        let copyPathItem = NSMenuItem(title: "Copy Relative Path", action: #selector(copyRelativePath(_:)), keyEquivalent: "")
        menu.addItem(copyPathItem)

        return menu
    }

    @objc func openRenegadeBoxApp(_ sender: AnyObject?) {
        let appUrl = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/RenegadeBox.app")
        NSWorkspace.shared.openApplication(at: appUrl, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
    }

    @objc func triggerSyncNow(_ sender: AnyObject?) {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let rbox = home.appendingPathComponent(".local/bin/rbox").path
        let task = Process()
        task.launchPath = "/bin/sh"
        task.arguments = ["-c", "\(rbox) sync || true"]
        try? task.run()
    }

    @objc func copyRelativePath(_ sender: AnyObject?) {
        guard let target = FIFinderSyncController.default().selectedItemURLs()?.first else { return }
        let rel = relativePath(for: target)
        if !rel.isEmpty {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(rel, forType: .string)
        }
    }
}
