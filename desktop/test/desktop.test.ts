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
});
