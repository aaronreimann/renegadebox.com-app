import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DESKTOP_DIR = join(import.meta.dir, "..");

describe("RenegadeBox Desktop GUI Application", () => {
  it("has valid Tauri v2 configuration file", () => {
    const confPath = join(DESKTOP_DIR, "src-tauri/tauri.conf.json");
    expect(existsSync(confPath)).toBe(true);

    const conf = JSON.parse(readFileSync(confPath, "utf-8"));
    expect(conf.productName).toBe("RenegadeBox");
    expect(conf.identifier).toBe("com.renegadebox.desktop");
    expect(conf.app.windows[0].title).toContain("RenegadeBox");
    expect(conf.app.windows[0].width).toBeGreaterThanOrEqual(960);
  });

  it("has valid frontend HTML and styles with dark mode tokens", () => {
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const cssPath = join(DESKTOP_DIR, "src/style.css");

    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(cssPath)).toBe(true);

    const html = readFileSync(htmlPath, "utf-8");
    expect(html).toContain("RenegadeBox");
    expect(html).toContain("Zero-Knowledge S3 Sync");
    expect(html).toContain("stat-files");
    expect(html).toContain("stat-storage");
    expect(html).toContain("stat-pending");
    expect(html).toContain("sync-now-btn");

    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("--bg-base: #07090e;");
    expect(css).toContain("--accent-cyan: #38bdf8;");
    expect(css).toContain("--font-heading: 'Montserrat'");
    expect(css).toContain("--dbx-navy: #111b36;");
    expect(css).toContain("--dbx-blue: #0061fe;");
  });

  it("has Dropbox 3-column desktop layout (navy sidebar, files table, right inspector)", () => {
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const html = readFileSync(htmlPath, "utf-8");

    // Left Sidebar (Dropbox Navy)
    expect(html).toContain('class="sidebar"');
    expect(html).toContain('id="sidebar-menu-btn"');
    expect(html).toContain('Starred folders');

    // Main Center Explorer (Dropbox White)
    expect(html).toContain('class="search-input"');
    expect(html).toContain('id="dropzone-box"');
    expect(html).toContain('id="file-table"');

    // Right Inspector Pane (Details & Encryption)
    expect(html).toContain('id="inspector-pane"');
    expect(html).toContain('id="inspector-file-name"');
    expect(html).toContain('id="inspector-s3-target"');
    expect(html).toContain('id="settings-modal"');
  });

  it("has valid Rust desktop crate linking renegadebox-engine", () => {
    const cargoPath = join(DESKTOP_DIR, "src-tauri/Cargo.toml");
    expect(existsSync(cargoPath)).toBe(true);

    const cargo = readFileSync(cargoPath, "utf-8");
    expect(cargo).toContain("name = \"renegadebox-desktop\"");
    expect(cargo).toContain("path = \"../../engine\"");
    expect(cargo).toContain("tauri = ");
  });

  it("has compiled frontend bundle and no-drag click responsiveness", () => {
    const jsPath = join(DESKTOP_DIR, "src/main.js");
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const cssPath = join(DESKTOP_DIR, "src/style.css");
    const confPath = join(DESKTOP_DIR, "src-tauri/tauri.conf.json");

    expect(existsSync(jsPath)).toBe(true);
    const html = readFileSync(htmlPath, "utf-8");
    expect(html).toContain('src="./main.js"');

    const css = readFileSync(cssPath, "utf-8");
    expect(css).toContain("-webkit-app-region: no-drag !important;");

    const conf = JSON.parse(readFileSync(confPath, "utf-8"));
    expect(conf.build.beforeDevCommand).toContain("bun run build:frontend");
    expect(conf.build.beforeBuildCommand).toContain("bun run build:frontend");
  });

  it("has generated multi-platform icon assets", () => {
    const icnsPath = join(DESKTOP_DIR, "src-tauri/icons/icon.icns");
    const pngPath = join(DESKTOP_DIR, "src-tauri/icons/32x32.png");
    expect(existsSync(icnsPath)).toBe(true);
    expect(existsSync(pngPath)).toBe(true);
  });

  it("has native auto-sync watcher and debouncer integration", () => {
    const commandsPath = join(DESKTOP_DIR, "src-tauri/src/commands.rs");
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const commands = readFileSync(commandsPath, "utf-8");
    const lib = readFileSync(libPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(commands).toContain("run_background_watcher");
    expect(commands).toContain("notify_debouncer_full::new_debouncer");
    expect(lib).toContain("WatcherHandle");
    expect(lib).toContain("run_background_watcher");
    expect(mainTs).toContain("vault-changed");
    expect(mainTs).toContain("sync-started");
    expect(mainTs).toContain("sync-finished");
  });

  it("has macOS menu bar system tray icon with quick actions and window management", () => {
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const cargoPath = join(DESKTOP_DIR, "src-tauri/Cargo.toml");

    const lib = readFileSync(libPath, "utf-8");
    const cargo = readFileSync(cargoPath, "utf-8");

    expect(cargo).toContain("tray-icon");
    expect(lib).toContain("TrayIconBuilder");
    expect(lib).toContain("Open RenegadeBox");
    expect(lib).toContain("Open Sync Folder");
    expect(lib).toContain("Status: Up to date");
    expect(lib).toContain("Sync Now");
    expect(lib).toContain("Quit RenegadeBox");
    expect(lib).toContain("CloseRequested");
    expect(lib).toContain("prevent_close");
  });

  it("has native file operations (open, reveal in finder, delete to trash, create folder, upload)", () => {
    const commandsPath = join(DESKTOP_DIR, "src-tauri/src/commands.rs");
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const commands = readFileSync(commandsPath, "utf-8");
    const lib = readFileSync(libPath, "utf-8");
    const html = readFileSync(htmlPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(commands).toContain("open_file");
    expect(commands).toContain("reveal_in_finder");
    expect(commands).toContain("delete_file");
    expect(commands).toContain("create_folder");
    expect(commands).toContain("pick_and_import_files");

    expect(lib).toContain("commands::open_file");
    expect(lib).toContain("commands::reveal_in_finder");
    expect(lib).toContain("commands::delete_file");
    expect(lib).toContain("commands::create_folder");
    expect(lib).toContain("commands::pick_and_import_files");

    expect(html).toContain("upload-files-btn");
    expect(html).toContain("new-folder-btn");
    expect(html).toContain("inspector-open-file-btn");
    expect(html).toContain("inspector-reveal-btn");
    expect(html).toContain("inspector-delete-btn");

    expect(mainTs).toContain("pick_and_import_files");
    expect(mainTs).toContain("create_folder");
    expect(mainTs).toContain("open_file");
    expect(mainTs).toContain("reveal_in_finder");
    expect(mainTs).toContain("delete_file");
  });

  it("has sync pause and resume capabilities across rust backend and frontend", () => {
    const commandsPath = join(DESKTOP_DIR, "src-tauri/src/commands.rs");
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const commands = readFileSync(commandsPath, "utf-8");
    const lib = readFileSync(libPath, "utf-8");
    const html = readFileSync(htmlPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(commands).toContain("pub fn pause_sync");
    expect(commands).toContain("pub fn resume_sync");
    expect(commands).toContain("pub fn is_sync_paused");
    expect(lib).toContain("commands::pause_sync");
    expect(lib).toContain("commands::resume_sync");
    expect(html).toContain("pause-sync-btn");
    expect(html).toContain("sync-paused-badge");
    expect(mainTs).toContain("handleTogglePause");
    expect(mainTs).toContain("sync-paused");
    expect(mainTs).toContain("sync-resumed");
  });

  it("has file renaming and conflict resolution workflows", () => {
    const commandsPath = join(DESKTOP_DIR, "src-tauri/src/commands.rs");
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const commands = readFileSync(commandsPath, "utf-8");
    const lib = readFileSync(libPath, "utf-8");
    const html = readFileSync(htmlPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(commands).toContain("pub fn rename_file");
    expect(commands).toContain("pub fn resolve_conflict");
    expect(lib).toContain("commands::rename_file");
    expect(lib).toContain("commands::resolve_conflict");
    expect(html).toContain("conflict-modal");
    expect(html).toContain("resolve-keep-local-btn");
    expect(html).toContain("resolve-keep-conflicted-btn");
    expect(html).toContain("resolve-keep-both-btn");
    expect(mainTs).toContain("handleRenameFile");
    expect(mainTs).toContain("resolveConflict");
  });

  it("has file version history and audit log inspection", () => {
    const commandsPath = join(DESKTOP_DIR, "src-tauri/src/commands.rs");
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const commands = readFileSync(commandsPath, "utf-8");
    const lib = readFileSync(libPath, "utf-8");
    const html = readFileSync(htmlPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(commands).toContain("pub async fn get_file_history");
    expect(commands).toContain("pub struct FileRevision");
    expect(lib).toContain("commands::get_file_history");
    expect(html).toContain("history-modal");
    expect(html).toContain("history-list-container");
    expect(mainTs).toContain("openHistoryModal");
  });

  it("has interactive in-app settings and ignored patterns management", () => {
    const commandsPath = join(DESKTOP_DIR, "src-tauri/src/commands.rs");
    const libPath = join(DESKTOP_DIR, "src-tauri/src/lib.rs");
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const commands = readFileSync(commandsPath, "utf-8");
    const lib = readFileSync(libPath, "utf-8");
    const html = readFileSync(htmlPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(commands).toContain("pub fn update_vault_config");
    expect(commands).toContain("pub fn get_ignored_patterns");
    expect(commands).toContain("pub fn save_ignored_patterns");
    expect(commands).toContain("pub fn export_file_copy");
    expect(lib).toContain("commands::update_vault_config");
    expect(lib).toContain("commands::get_ignored_patterns");
    expect(lib).toContain("commands::save_ignored_patterns");
    expect(lib).toContain("commands::export_file_copy");

    expect(html).toContain("cfg-device-name-input");
    expect(html).toContain("cfg-bucket-input");
    expect(html).toContain("cfg-region-input");
    expect(html).toContain("cfg-ignored-patterns-input");
    expect(html).toContain("save-settings-btn");
    expect(mainTs).toContain("handleSaveSettings");
    expect(mainTs).toContain("handleExportCopy");
  });

  it("has breadcrumbs, dual grid/list views, sortable headers, and context menu", () => {
    const htmlPath = join(DESKTOP_DIR, "src/index.html");
    const cssPath = join(DESKTOP_DIR, "src/style.css");
    const mainTsPath = join(DESKTOP_DIR, "src/main.ts");

    const html = readFileSync(htmlPath, "utf-8");
    const css = readFileSync(cssPath, "utf-8");
    const mainTs = readFileSync(mainTsPath, "utf-8");

    expect(html).toContain("breadcrumb-container");
    expect(html).toContain("view-list-btn");
    expect(html).toContain("view-grid-btn");
    expect(html).toContain("file-grid");
    expect(html).toContain("context-menu");
    expect(html).toContain("th-name");
    expect(html).toContain("th-size");

    expect(css).toContain(".breadcrumb-container");
    expect(css).toContain(".file-grid");
    expect(css).toContain(".context-menu");
    expect(css).toContain(".filter-chip");

    expect(mainTs).toContain("renderBreadcrumbs");
    expect(mainTs).toContain("renderFileGrid");
    expect(mainTs).toContain("showContextMenu");
    expect(mainTs).toContain("toggleStar");
  });
});


