import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { traySize, renderTrayGlyph, renderAppIcon } from "../scripts/icon-art";

const DESKTOP = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(DESKTOP, p), "utf-8");

/** Every text file that ships with the desktop app (frontend, Rust, config). */
function shippedTextFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (["node_modules", "target", "gen"].includes(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|js|html|css|rs|json|toml|md)$/.test(name)) out.push(full);
    }
  };
  walk(join(DESKTOP, "src"));
  walk(join(DESKTOP, "src-tauri"));
  walk(join(DESKTOP, "scripts"));
  out.push(join(DESKTOP, "package.json"));
  return out;
}

describe("tone and hygiene", () => {
  const files = shippedTextFiles();

  it("scans a meaningful set of files", () => {
    const rel = files.map((f) => relative(DESKTOP, f));
    expect(rel).toContain("src/index.html");
    expect(rel).toContain("src/main.js");
    expect(rel).toContain("src-tauri/src/lib.rs");
  });

  it("has none of the old nautical theme copy", () => {
    // Words are stored reversed so this file itself stays clean for `rg`.
    const banned = ["etarip", "ytoob", "tsioh", "epahspihs", "yoha", "pihs nodnaba", "riasroc", "noellag", "erusaert", "rednulp", "gninraw mrots"]
      .map((w) => [...w].reverse().join(""));
    const themed = new RegExp(banned.join("|"), "i");
    for (const f of files) {
      const hit = readFileSync(f, "utf-8").match(themed);
      expect(hit ? `${relative(DESKTOP, f)}: ${hit[0]}` : null).toBeNull();
    }
  });

  it("has no emoji anywhere", () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B06}\u{2B07}\u{23E9}-\u{23FA}\u{FE0F}\u{200D}]/u;
    for (const f of files) {
      const hit = readFileSync(f, "utf-8").match(emoji);
      expect(hit ? `${relative(DESKTOP, f)}: ${JSON.stringify(hit[0])}` : null).toBeNull();
    }
  });

  it("ships no bitmap artwork in the frontend (icons are inline SVG)", () => {
    expect(readdirSync(join(DESKTOP, "src")).filter((n) => /\.(png|jpe?g|gif)$/i.test(n))).toEqual([]);
  });

  it("uses the system font and light/dark palettes", () => {
    const css = read("src/style.css");
    expect(css).toContain("-apple-system");
    expect(css).toContain("system-ui");
    expect(css).toContain("prefers-color-scheme: dark");
  });
});

describe("tauri configuration", () => {
  const conf = JSON.parse(read("src-tauri/tauri.conf.json"));

  it("keeps product identity and frontend build", () => {
    expect(conf.productName).toBe("RenegadeBox");
    expect(conf.identifier).toBe("com.renegadebox.desktop");
    expect(conf.build.beforeDevCommand).toContain("bun run build:frontend");
    expect(conf.build.beforeBuildCommand).toContain("bun run build:frontend");
    expect(read("src/index.html")).toContain('src="./main.js"');
    expect(existsSync(join(DESKTOP, "src/main.js"))).toBe(true);
  });

  it("declares the wide desktop window up front", () => {
    expect(conf.app.windows).toHaveLength(1);
    const w = conf.app.windows[0];
    expect(w.label).toBe("main");
    expect(w.width).toBe(1040);
    expect(w.height).toBe(700);
    expect(w.decorations).toBe(true);
    expect(w.visible).toBe(true);
    expect(w.resizable).toBe(true);
  });

  it("grants core window/event permissions to the app windows", () => {
    const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
    expect(cap.windows).toEqual(expect.arrayContaining(["main", "popover", "settings", "setup"]));
    expect(cap.permissions).toContain("core:default");
  });
});

describe("rust shell", () => {
  const lib = read("src-tauri/src/lib.rs");
  const commands = read("src-tauri/src/commands.rs");
  const cargo = read("src-tauri/Cargo.toml");

  it("runs as a menu-bar accessory with a template tray icon", () => {
    expect(lib).toContain("ActivationPolicy::Accessory");
    expect(lib).toContain("icon_as_template(true)");
    expect(lib).toContain("tray-icon@2x.png");
    expect(lib).toContain("Focused(false)");
  });

  it("keeps the tray menu small", () => {
    for (const label of ["Open RenegadeBox folder", "Pause syncing", "Resume syncing", "Settings…", "Quit RenegadeBox"]) {
      expect(lib).toContain(label);
    }
    expect(lib).not.toContain("Web Dashboard");
  });

  it("is single instance", () => {
    expect(cargo).toContain("tauri-plugin-single-instance");
    expect(lib).toContain("tauri_plugin_single_instance::init");
  });

  it("exposes the popover data commands", () => {
    for (const cmd of ["get_sync_overview", "list_recent_files", "list_conflicts", "open_settings", "open_setup", "quit_app"]) {
      expect(commands).toMatch(new RegExp(`fn ${cmd}\\b`));
      expect(lib).toContain(`commands::${cmd}`);
    }
  });

  it("removed explorer-only commands", () => {
    for (const cmd of ["delete_file", "rename_file", "create_folder", "pick_and_import_files", "get_file_history", "export_file_copy", "list_synced_files", "add_to_finder_favorites", "open_dashboard"]) {
      expect(lib).not.toContain(`commands::${cmd}`);
      expect(commands).not.toContain(`fn ${cmd}`);
    }
  });

  it("keeps the key-storage safeguards intact", () => {
    expect(commands).toContain("pub fn set_key_store(use_keychain: bool)");
    expect(commands).toContain("key_store: renegadebox_engine::config::KeyStoreKind::Keychain,");
    expect(commands).toContain("passphrase.chars().count() < 12");
  });

  it("stays quiet: notifications only for conflicts and persistent errors", () => {
    expect(commands).toContain("fn notify_user");
    const calls = commands.match(/notify_user\(/g) ?? [];
    // definition + conflict + error
    expect(calls.length).toBe(3);
  });
});

describe("icons", () => {
  it("tray glyph is a monochrome template (black + alpha only)", () => {
    for (const scale of [1, 2]) {
      const size = traySize(scale);
      const px = renderTrayGlyph(size);
      expect(px.length).toBe(size * size * 4);
      let covered = 0;
      for (let i = 0; i < px.length; i += 4) {
        expect(px[i]! + px[i + 1]! + px[i + 2]!).toBe(0);
        if (px[i + 3]! > 0) covered++;
      }
      const ratio = covered / (size * size);
      expect(ratio).toBeGreaterThan(0.15);
      expect(ratio).toBeLessThan(0.7);
    }
  });

  it("app icon is opaque in the middle and transparent in the corner", () => {
    const size = 64;
    const px = renderAppIcon(size);
    const at = (x: number, y: number) => px[(y * size + x) * 4 + 3]!;
    expect(at(0, 0)).toBe(0);
    expect(at(32, 32)).toBe(255);
  });

  it("ships generated icon files", () => {
    for (const f of ["icon.png", "32x32.png", "128x128.png", "128x128@2x.png", "icon.icns", "icon.ico", "tray-icon.png", "tray-icon@2x.png"]) {
      expect(existsSync(join(DESKTOP, "src-tauri/icons", f))).toBe(true);
    }
  });
});
