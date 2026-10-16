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

// S3 Provider Setup Wizard Logic
type ProviderType = "r2" | "s3" | "b2" | "local";
let currentProvider: ProviderType = "r2";

export function setProvider(p: ProviderType) {
  currentProvider = p;
  const btnR2 = document.getElementById("provider-btn-r2");
  const btnS3 = document.getElementById("provider-btn-s3");
  const btnB2 = document.getElementById("provider-btn-b2");
  const btnLocal = document.getElementById("provider-btn-local");
  const endpointRow = document.getElementById("wizard-endpoint-row");
  const endpointInput = document.getElementById("wizard-endpoint-input") as HTMLInputElement | null;
  const regionInput = document.getElementById("wizard-region-input") as HTMLInputElement | null;

  const activeStyle = (borderColor: string, bg: string, color: string) =>
    `background: ${bg}; border: 1px solid ${borderColor}; color: ${color}; padding: 1rem; border-radius: 0.5rem; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 0.25rem;`;
  const inactiveStyle =
    "background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-subtle); color: var(--text-secondary); padding: 1rem; border-radius: 0.5rem; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 0.25rem;";

  if (btnR2) btnR2.setAttribute("style", p === "r2" ? activeStyle("var(--accent-cyan)", "rgba(56, 189, 248, 0.15)", "#7dd3fc") : inactiveStyle);
  if (btnS3) btnS3.setAttribute("style", p === "s3" ? activeStyle("var(--accent-cyan)", "rgba(56, 189, 248, 0.15)", "#7dd3fc") : inactiveStyle);
  if (btnB2) btnB2.setAttribute("style", p === "b2" ? activeStyle("var(--accent-purple)", "rgba(168, 85, 247, 0.15)", "#d8b4fe") : inactiveStyle);
  if (btnLocal) btnLocal.setAttribute("style", p === "local" ? activeStyle("#f59e0b", "rgba(245, 158, 11, 0.15)", "#fde68a") : inactiveStyle);

  if (p === "r2") {
    if (regionInput) regionInput.value = "auto";
    if (endpointInput) endpointInput.value = "https://<account_id>.r2.cloudflarestorage.com";
    if (endpointRow) endpointRow.style.display = "block";
  } else if (p === "s3") {
    if (regionInput) regionInput.value = "us-east-1";
    if (endpointRow) endpointRow.style.display = "none";
  } else if (p === "b2") {
    if (regionInput) regionInput.value = "us-west-004";
    if (endpointInput) endpointInput.value = "https://s3.us-west-004.backblazeb2.com";
    if (endpointRow) endpointRow.style.display = "block";
  } else if (p === "local") {
    if (regionInput) regionInput.value = "us-east-1";
    if (endpointInput) endpointInput.value = "http://localhost:8333";
    if (endpointRow) endpointRow.style.display = "block";
  }

  updateWizardOutputs();
}

export function updateWizardOutputs() {
  const bucket = (document.getElementById("wizard-bucket-input") as HTMLInputElement | null)?.value.trim() || "my-renegade-vault";
  const region = (document.getElementById("wizard-region-input") as HTMLInputElement | null)?.value.trim() || "auto";
  const endpoint = (document.getElementById("wizard-endpoint-input") as HTMLInputElement | null)?.value.trim() || "";

  const cmdBox = document.getElementById("wizard-cmd-box");
  const iamBox = document.getElementById("wizard-iam-box");

  if (cmdBox) {
    let cmd = `rbox init --bucket ${bucket} --region ${region} --local-dir ~/RenegadeBox`;
    if (currentProvider !== "s3" && endpoint) {
      cmd += ` \\\n  --endpoint-url ${endpoint}`;
    }
    cmdBox.textContent = cmd;
  }

  if (iamBox) {
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RenegadeBoxEncryptedVaultAccess",
          Effect: "Allow",
          Action: [
            "s3:PutObject",
            "s3:GetObject",
            "s3:DeleteObject",
            "s3:ListBucket"
          ],
          Resource: [
            `arn:aws:s3:::${bucket}`,
            `arn:aws:s3:::${bucket}/*`
          ]
        }
      ]
    };
    iamBox.textContent = JSON.stringify(policy, null, 2);
  }
}

// Storage Cost Calculator
export function updateCostCalculator(gb: number) {
  const sizeLabel = document.getElementById("slider-size-label");
  if (sizeLabel) {
    if (gb >= 1000) {
      sizeLabel.textContent = `${gb.toLocaleString()} GB (${(gb / 1000).toFixed(1)} TB)`;
    } else {
      sizeLabel.textContent = `${gb} GB`;
    }
  }

  // Dropbox pricing
  let dropboxMonthly = 11.99;
  if (gb > 2000 && gb <= 5000) {
    dropboxMonthly = 24.99;
  } else if (gb > 5000) {
    dropboxMonthly = 24.99 + ((gb - 5000) * 0.008);
  }

  // Cloudflare R2 ($0.015/GB/mo)
  const r2Monthly = gb * 0.015;

  // Backblaze B2 ($0.006/GB/mo)
  const b2Monthly = gb * 0.006;

  const costDropbox = document.getElementById("cost-dropbox");
  const costR2 = document.getElementById("cost-r2");
  const costB2 = document.getElementById("cost-b2");
  const savingsHeadline = document.getElementById("savings-headline");

  if (costDropbox) costDropbox.textContent = `$${dropboxMonthly.toFixed(2)}`;
  if (costR2) costR2.textContent = `$${r2Monthly.toFixed(2)}`;
  if (costB2) costB2.textContent = `$${b2Monthly.toFixed(2)}`;

  if (savingsHeadline) {
    const annualDropbox = dropboxMonthly * 12;
    const annualB2 = b2Monthly * 12;
    const savings = Math.max(0, annualDropbox - annualB2);
    savingsHeadline.textContent = `Save $${savings.toFixed(2)} every year with Backblaze B2`;
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

  // Wizard providers
  document.getElementById("provider-btn-r2")?.addEventListener("click", () => setProvider("r2"));
  document.getElementById("provider-btn-s3")?.addEventListener("click", () => setProvider("s3"));
  document.getElementById("provider-btn-b2")?.addEventListener("click", () => setProvider("b2"));
  document.getElementById("provider-btn-local")?.addEventListener("click", () => setProvider("local"));

  // Wizard inputs
  document.getElementById("wizard-bucket-input")?.addEventListener("input", updateWizardOutputs);
  document.getElementById("wizard-region-input")?.addEventListener("input", updateWizardOutputs);
  document.getElementById("wizard-endpoint-input")?.addEventListener("input", updateWizardOutputs);

  // Wizard copy buttons
  const wizardCopyCmdBtn = document.getElementById("wizard-copy-cmd-btn");
  if (wizardCopyCmdBtn) {
    wizardCopyCmdBtn.addEventListener("click", () => {
      const cmd = document.getElementById("wizard-cmd-box")?.textContent || "";
      navigator.clipboard.writeText(cmd);
      wizardCopyCmdBtn.innerText = "Copied!";
      setTimeout(() => { wizardCopyCmdBtn.innerText = "Copy Command"; }, 2000);
    });
  }

  const wizardCopyIamBtn = document.getElementById("wizard-copy-iam-btn");
  if (wizardCopyIamBtn) {
    wizardCopyIamBtn.addEventListener("click", () => {
      const iam = document.getElementById("wizard-iam-box")?.textContent || "";
      navigator.clipboard.writeText(iam);
      wizardCopyIamBtn.innerText = "Copied!";
      setTimeout(() => { wizardCopyIamBtn.innerText = "Copy Policy JSON"; }, 2000);
    });
  }

  // Cost calculator slider & presets
  const slider = document.getElementById("storage-slider") as HTMLInputElement | null;
  if (slider) {
    slider.addEventListener("input", () => {
      const val = parseInt(slider.value, 10);
      updateCostCalculator(val);
      // Highlight matching preset if any
      document.querySelectorAll(".preset-btn").forEach((b) => {
        const btnVal = parseInt(b.getAttribute("data-size") || "0", 10);
        if (btnVal === val) {
          b.setAttribute("style", "background: rgba(56, 189, 248, 0.2); border: 1px solid var(--accent-cyan); color: #7dd3fc; padding: 0.35rem 0.85rem; border-radius: 0.375rem; font-size: 0.75rem; cursor: pointer;");
        } else {
          b.setAttribute("style", "background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-subtle); color: var(--text-secondary); padding: 0.35rem 0.85rem; border-radius: 0.375rem; font-size: 0.75rem; cursor: pointer;");
        }
      });
    });
  }

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const size = parseInt(btn.getAttribute("data-size") || "1000", 10);
      if (slider) slider.value = String(size);
      updateCostCalculator(size);
      document.querySelectorAll(".preset-btn").forEach((b) => {
        b.setAttribute("style", "background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-subtle); color: var(--text-secondary); padding: 0.35rem 0.85rem; border-radius: 0.375rem; font-size: 0.75rem; cursor: pointer;");
      });
      btn.setAttribute("style", "background: rgba(56, 189, 248, 0.2); border: 1px solid var(--accent-cyan); color: #7dd3fc; padding: 0.35rem 0.85rem; border-radius: 0.375rem; font-size: 0.75rem; cursor: pointer;");
    });
  });

  // Initial runs
  updateWizardOutputs();
  updateCostCalculator(1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSiteInteractivity);
} else {
  initSiteInteractivity();
}

