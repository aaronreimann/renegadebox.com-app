// RenegadeBox Desktop Client Application Logic

interface VaultStatus {
  initialized: boolean;
  folder: string | null;
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  device_id: string | null;
  device_name: string | null;
  hub_url: string | null;
  key_store: string | null;
  total_files: number;
  pending_changes: number;
  total_bytes: number;
}

interface FileItem {
  path: string;
  size: number;
  status: "synced" | "pending_upload" | "conflicted" | "deleted";
  mtime_ns: number;
}

interface SyncResult {
  success: boolean;
  message: string;
  uploaded: number;
  downloaded: number;
  conflicts: number;
  failed: number;
}

// Fallback or Tauri Invoke wrapper
declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (window.__TAURI__?.core) {
    return window.__TAURI__.core.invoke<T>(cmd, args);
  }
  // Mock mode for browser preview / testing
  console.log(`[IPC Mock] ${cmd}`, args);
  if (cmd === "get_vault_status") {
    return {
      initialized: true,
      folder: "/Users/me/RenegadeBox",
      bucket: "my-box",
      region: "us-east-1",
      endpoint: "http://localhost:8333",
      device_id: "00c4a3c6-7bb6-4a3d-8349-025db24bcceb",
      device_name: "Laptop",
      hub_url: "ws://localhost:8787/ws",
      key_store: "macOS Keychain (Hardware-backed)",
      total_files: 14,
      pending_changes: 0,
      total_bytes: 42180900,
    } as unknown as T;
  }
  if (cmd === "list_synced_files") {
    return [
      { path: "Documents/Taxes-2026.pdf", size: 3421800, status: "synced", mtime_ns: Date.now() * 1000000 },
      { path: "Projects/renegadebox/spec.md", size: 18450, status: "synced", mtime_ns: Date.now() * 1000000 },
      { path: "Photos/team-offsite.jpg", size: 5214000, status: "synced", mtime_ns: Date.now() * 1000000 },
    ] as unknown as T;
  }
  if (cmd === "trigger_sync") {
    return {
      success: true,
      message: "pushed: 0 up, 0 del, 0 mv | pulled: 0 down, 0 del, 0 mv | conflicts: 0 | stale skipped: 0 | failed: 0",
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      failed: 0,
    } as unknown as T;
  }
  return {} as T;
}

let allFiles: FileItem[] = [];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function appendLog(text: string, color: string = "#94a3b8") {
  const logBox = document.getElementById("log-box");
  if (!logBox) return;
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.style.color = color;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${text}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

export async function refreshVaultStatus() {
  try {
    const status = await tauriInvoke<VaultStatus>("get_vault_status");
    
    const statFiles = document.getElementById("stat-files");
    const statStorage = document.getElementById("stat-storage");
    const statPending = document.getElementById("stat-pending");
    const statKeystore = document.getElementById("stat-keystore");
    const folderPath = document.getElementById("local-folder-path");
    const connPill = document.getElementById("connection-pill");
    const connText = document.getElementById("connection-text");

    if (statFiles) statFiles.textContent = String(status.total_files);
    if (statStorage) statStorage.textContent = formatBytes(status.total_bytes);
    if (statPending) statPending.textContent = String(status.pending_changes);
    if (statKeystore && status.key_store) statKeystore.textContent = status.key_store;
    if (folderPath && status.folder) folderPath.textContent = status.folder;

    if (connPill && connText) {
      if (status.pending_changes > 0) {
        connPill.className = "status-pill syncing";
        connText.textContent = `${status.pending_changes} Pending`;
      } else {
        connPill.className = "status-pill up-to-date";
        connText.textContent = "Up to Date";
      }
    }

    // Config tab values
    const cfgDeviceId = document.getElementById("cfg-device-id");
    const cfgDeviceName = document.getElementById("cfg-device-name");
    const cfgBucket = document.getElementById("cfg-bucket");
    const cfgRegion = document.getElementById("cfg-region");
    const cfgEndpoint = document.getElementById("cfg-endpoint");
    const cfgHub = document.getElementById("cfg-hub");

    if (cfgDeviceId) cfgDeviceId.textContent = status.device_id || "Unregistered";
    if (cfgDeviceName) cfgDeviceName.textContent = status.device_name || "Unknown";
    if (cfgBucket) cfgBucket.textContent = status.bucket || "None";
    if (cfgRegion) cfgRegion.textContent = status.region || "us-east-1";
    if (cfgEndpoint) cfgEndpoint.textContent = status.endpoint || "None (AWS standard)";
    if (cfgHub) cfgHub.textContent = status.hub_url || "Disconnected";
  } catch (err) {
    console.error("Failed to load status:", err);
  }
}

export async function refreshFilesList() {
  try {
    allFiles = await tauriInvoke<FileItem[]>("list_synced_files");
    const tabFileCount = document.getElementById("tab-file-count");
    if (tabFileCount) tabFileCount.textContent = String(allFiles.length);

    renderFilesTable(allFiles);
  } catch (err) {
    console.error("Failed to list files:", err);
  }
}

function renderFilesTable(files: FileItem[]) {
  const tbody = document.getElementById("files-tbody");
  if (!tbody) return;

  if (files.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" style="text-align: center; color: var(--text-muted); padding: 2rem;">
          No synchronized files found in this vault yet. Drag files into ~/RenegadeBox to sync!
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = files.map((file) => {
    let badgeClass = "badge-synced";
    let statusLabel = "Synced";

    if (file.status === "conflicted") {
      badgeClass = "badge-conflict";
      statusLabel = "Conflicted Copy";
    } else if (file.status === "pending_upload") {
      badgeClass = "badge-pending";
      statusLabel = "Pending Upload";
    } else if (file.status === "deleted") {
      badgeClass = "badge-pending";
      statusLabel = "Deleted Remote";
    }

    return `
      <tr>
        <td style="font-family: var(--font-mono); color: #f1f5f9; font-weight: 500;">
          ${escapeHtml(file.path)}
        </td>
        <td style="color: var(--text-secondary); white-space: nowrap;">
          ${formatBytes(file.size)}
        </td>
        <td>
          <span class="badge ${badgeClass}">${statusLabel}</span>
        </td>
      </tr>
    `;
  }).join("");
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m] || m));
}

// User Actions
export async function handleSyncNow() {
  const syncBtn = document.getElementById("sync-now-btn") as HTMLButtonElement | null;
  const connPill = document.getElementById("connection-pill");
  const connText = document.getElementById("connection-text");

  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing...";
  }
  if (connPill && connText) {
    connPill.className = "status-pill syncing";
    connText.textContent = "Syncing...";
  }

  appendLog("Starting manual sync cycle (scan -> pull -> push)...", "#38bdf8");

  try {
    const result = await tauriInvoke<SyncResult>("trigger_sync");
    if (result.success) {
      appendLog(`Sync completed successfully: ${result.message}`, "#10b981");
    } else {
      appendLog(`Sync finished with warnings/failures: ${result.message}`, "#f43f5e");
    }
  } catch (err) {
    appendLog(`Sync error: ${err}`, "#f43f5e");
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = "⟳ Sync Now";
    }
    await refreshVaultStatus();
    await refreshFilesList();
  }
}

export function initDesktopApp() {
  // Navigation Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".content-view").forEach((view) => view.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      if (targetId) {
        document.getElementById(targetId)?.classList.add("active");
      }
    });
  });

  // Action Buttons
  document.getElementById("sync-now-btn")?.addEventListener("click", handleSyncNow);
  document.getElementById("open-folder-btn")?.addEventListener("click", () => {
    tauriInvoke("open_sync_folder");
  });
  document.getElementById("open-dashboard-btn")?.addEventListener("click", () => {
    tauriInvoke("open_dashboard");
  });
  document.getElementById("refresh-files-btn")?.addEventListener("click", refreshFilesList);

  // Search Filter
  const searchInput = document.getElementById("file-search-input") as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = allFiles.filter((f) => f.path.toLowerCase().includes(q));
      renderFilesTable(filtered);
    });
  }

  // Initial fetch and auto-polling every 3 seconds
  refreshVaultStatus();
  refreshFilesList();
  setInterval(() => {
    refreshVaultStatus();
  }, 3000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDesktopApp);
} else {
  initDesktopApp();
}
