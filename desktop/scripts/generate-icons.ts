// Regenerates the app and tray icons.
//   bun run icons
// Writes the 1024px source and tray template images, then lets the Tauri CLI
// derive every platform size (icns, ico, Windows/Android/iOS PNGs) from the source.
import { join } from "node:path";
import { encodePng, renderAppIcon, renderTrayGlyph, traySize } from "./icon-art";

const ICONS = join(import.meta.dir, "..", "src-tauri", "icons");

await Bun.write(join(ICONS, "tray-icon.png"), encodePng(renderTrayGlyph(traySize(1)), traySize(1)));
await Bun.write(join(ICONS, "tray-icon@2x.png"), encodePng(renderTrayGlyph(traySize(2)), traySize(2)));

const source = join(ICONS, "icon-source.png");
await Bun.write(source, encodePng(renderAppIcon(1024), 1024));

const proc = Bun.spawnSync(["bun", "x", "tauri", "icon", source, "-o", ICONS], {
  cwd: join(import.meta.dir, ".."),
  stdout: "inherit",
  stderr: "inherit",
});
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);
await Bun.file(source).delete();
console.log("Icons written to", ICONS);
