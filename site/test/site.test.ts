import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dir, "../dist");

describe("RenegadeBox Marketing & Documentation Site", () => {
  it("generates the landing page with valid SEO and key sections", () => {
    const indexPath = join(DIST_DIR, "index.html");
    expect(existsSync(indexPath)).toBe(true);

    const html = readFileSync(indexPath, "utf-8");
    expect(html).toContain("RenegadeBox — Zero-Knowledge S3 Folder Sync");
    expect(html).toContain("Own Your Cloud.");
    expect(html).toContain("Trust No One.");
    expect(html).toContain("Interactive S3 Provider Setup Wizard");
    expect(html).toContain("Stop Paying a 500% SaaS Markup");
    expect(html).toContain("Command-Line Quickstart");
    expect(html).toContain("What S3 and the Hub Never See");
  });

  it("generates all documentation pages with navigation links", () => {
    const docs = [
      { path: "docs/index.html", title: "RenegadeBox Documentation" },
      { path: "docs/quickstart/index.html", title: "Quickstart Guide" },
      { path: "docs/architecture/index.html", title: "Zero-Knowledge Architecture" },
      { path: "docs/providers/index.html", title: "Storage Provider Configuration" },
      { path: "docs/cli/index.html", title: "CLI Command Reference" },
    ];

    for (const doc of docs) {
      const fullPath = join(DIST_DIR, doc.path);
      expect(existsSync(fullPath)).toBe(true);

      const html = readFileSync(fullPath, "utf-8");
      expect(html).toContain(doc.title);
      expect(html).toContain("Quickstart Guide");
      expect(html).toContain("Zero-Knowledge Architecture");
      expect(html).toContain("Storage Providers");
      expect(html).toContain("CLI Command Reference");
    }
  });

  it("includes client-side interactive scripts in the bundle", () => {
    const indexPath = join(DIST_DIR, "index.html");
    const html = readFileSync(indexPath, "utf-8");
    expect(html).toContain("_astro/index.astro_astro_type_script");
  });
});
