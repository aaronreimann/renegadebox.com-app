// Interactive Terminal & Perspective Switcher for RenegadeBox site

export function triggerTerminalSimulation() {
  const container = document.getElementById("terminal-dynamic-lines");
  const btn = document.getElementById("simulate-sync-btn") as HTMLButtonElement | null;
  if (!container || !btn) return;

  btn.disabled = true;
  btn.innerText = "Syncing...";
  container.innerHTML = "";

  const steps = [
    { text: "[21:00:10 INFO] Local file change detected: Documents/financial-projections-2026.pdf (3.8 MB)", color: "#93c5fd", delay: 200 },
    { text: "[21:00:10 DEBUG] Chunking file into 4MB AEAD blocks, deriving per-content HMAC key...", color: "#94a3b8", delay: 400 },
    { text: "[21:00:11 INFO] Encrypted with AES-256-GCM. Uploading blob rb/blobs/b4/b498e820...", color: "#6ee7b7", delay: 700 },
    { text: "[21:00:11 INFO] Sealed journal entry seq 00000000000000000008 written to S3 with If-None-Match", color: "#6ee7b7", delay: 950 },
    { text: "[21:00:11 INFO] Notified WebSocket Hub: journal_appended (zero plaintext transmitted)", color: "#38bdf8", delay: 1100 },
    { text: "[21:00:11 INFO] Hub broadcast sync_required -> Desktop MacBook (Latency: 542ms)", color: "#a855f7", delay: 1350 },
    { text: "[21:00:11 SUCCESS] Both devices converged. Zero plaintext leaked to S3 or Hub.", color: "#34d399", delay: 1600 },
  ];

  steps.forEach((step) => {
    setTimeout(() => {
      const p = document.createElement("p");
      p.style.color = step.color;
      p.innerText = step.text;
      container.appendChild(p);
      const screen = document.getElementById("terminal-screen");
      if (screen) screen.scrollTop = screen.scrollHeight;
    }, step.delay);
  });

  setTimeout(() => {
    btn.disabled = false;
    btn.innerText = "▶ Simulate Again";
  }, 1800);
}

export function switchPerspective(view: "client" | "s3" | "hub") {
  const box = document.getElementById("perspective-box");
  const tabClient = document.getElementById("tab-client");
  const tabS3 = document.getElementById("tab-s3");
  const tabHub = document.getElementById("tab-hub");
  if (!box || !tabClient || !tabS3 || !tabHub) return;

  const activeStyle = "background: rgba(56, 189, 248, 0.2); border: 1px solid var(--accent-cyan); color: #38bdf8; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;";
  const inactiveStyle = "background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-subtle); color: var(--text-secondary); padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;";

  tabClient.setAttribute("style", inactiveStyle);
  tabS3.setAttribute("style", inactiveStyle);
  tabHub.setAttribute("style", inactiveStyle);

  if (view === "client") {
    tabClient.setAttribute("style", "background: rgba(16, 185, 129, 0.2); border: 1px solid var(--border-emerald); color: #6ee7b7; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;");
    box.innerHTML = `
      <div style="color: #6ee7b7; margin-bottom: 0.5rem;">// Plaintext file on your MacBook:</div>
      <div style="color: #f8fafc; font-weight: 600;">Path: /Users/me/RenegadeBox/Documents/Taxes/2026-Receipts.pdf</div>
      <div style="color: var(--text-muted); margin-top: 0.5rem;">File size: 3,421,800 bytes</div>
      <div style="color: var(--text-muted);">Plaintext hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</div>
      <div style="color: var(--accent-emerald); margin-top: 0.75rem;">Status: Decrypted in local memory. Never transmitted over network without encryption.</div>
    `;
  } else if (view === "s3") {
    tabS3.setAttribute("style", activeStyle);
    box.innerHTML = `
      <div style="color: var(--accent-cyan); margin-bottom: 0.5rem;">// Encrypted Objects in your S3 Bucket:</div>
      <div style="color: #cbd5e1; margin-bottom: 0.35rem;"><span style="color: var(--text-muted);">Content blob:</span> s3://my-box/rb/blobs/b4/b498e820c78a0112d8a55e2f75a6c1... (AES-256-GCM ciphertext)</div>
      <div style="color: #cbd5e1; margin-bottom: 0.35rem;"><span style="color: var(--text-muted);">Journal entry:</span> s3://my-box/rb/journal/e3a04e3b-5519-460d-8401-862fa1c2c22b/00000000000000000008</div>
      <div style="color: #cbd5e1; margin-bottom: 0.35rem;"><span style="color: var(--text-muted);">Key epoch:</span> s3://my-box/rb/vault.json (Argon2id wrapped master key, m=64MB, t=3)</div>
      <div style="color: #38bdf8; margin-top: 0.75rem;">S3 Privacy Audit: 0 plaintext filenames. 0 plaintext paths. 0 unencrypted bytes.</div>
    `;
  } else if (view === "hub") {
    tabHub.setAttribute("style", "background: rgba(168, 85, 247, 0.2); border: 1px solid var(--accent-purple); color: #d8b4fe; padding: 0.5rem 1.25rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer;");
    const jsonStr = JSON.stringify({
      type: "sync_required",
      payload: {
        origin_device_id: "e3a04e3b-5519-460d-8401-862fa1c2c22b",
        seq: 8,
        object_key: "rb/journal/e3a04e3b-5519-460d-8401-862fa1c2c22b/00000000000000000008"
      }
    }, null, 2);
    box.innerHTML = `
      <div style="color: #c084fc; margin-bottom: 0.5rem;">// WebSocket relay message captured on wire:</div>
      <pre style="color: #f1f5f9; line-height: 1.5; font-size: 0.775rem;">${jsonStr}</pre>
      <div style="color: #c084fc; margin-top: 0.75rem;">Hub Privacy Audit: Sealed ciphertext only. The Hub cannot inspect what file changed.</div>
    `;
  }
}

// Attach event listeners
function initSiteInteractivity() {
  const copyBtn = document.getElementById("copy-cmd-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText("cargo install --path engine --root ~/.local");
      copyBtn.innerText = "Copied!";
      setTimeout(() => {
        copyBtn.innerText = "Copy";
      }, 2000);
    });
  }

  const simBtn = document.getElementById("simulate-sync-btn");
  if (simBtn) {
    simBtn.addEventListener("click", triggerTerminalSimulation);
  }

  document.getElementById("tab-client")?.addEventListener("click", () => switchPerspective("client"));
  document.getElementById("tab-s3")?.addEventListener("click", () => switchPerspective("s3"));
  document.getElementById("tab-hub")?.addEventListener("click", () => switchPerspective("hub"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSiteInteractivity);
} else {
  initSiteInteractivity();
}
