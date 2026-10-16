// node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}

// node_modules/@tauri-apps/api/core.js
var _Channel_instances;
var _Channel_onmessage;
var _Channel_nextMessageIndex;
var _Channel_pendingMessages;
var _Channel_messageEndIndex;
var _Channel_deliver;
var _Resource_rid;
var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}

class Channel {
  constructor(onmessage) {
    _Channel_instances.add(this);
    _Channel_onmessage.set(this, undefined);
    _Channel_nextMessageIndex.set(this, 0);
    _Channel_pendingMessages.set(this, []);
    _Channel_messageEndIndex.set(this, undefined);
    __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {}), "f");
    this.id = transformCallback((rawMessage) => {
      const index = rawMessage.index;
      if ("end" in rawMessage) {
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          this.cleanupCallback();
        } else {
          __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
        }
        return;
      }
      const message = rawMessage.message;
      if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
        __classPrivateFieldGet(this, _Channel_instances, "m", _Channel_deliver).call(this, message);
        __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
          const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldGet(this, _Channel_instances, "m", _Channel_deliver).call(this, message2);
          delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
        }
        if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
          this.cleanupCallback();
        }
      } else {
        __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
      }
    });
  }
  cleanupCallback() {
    window.__TAURI_INTERNALS__.unregisterCallback(this.id);
  }
  set onmessage(handler) {
    __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
  }
  get onmessage() {
    return __classPrivateFieldGet(this, _Channel_onmessage, "f");
  }
  [(_Channel_onmessage = new WeakMap, _Channel_nextMessageIndex = new WeakMap, _Channel_pendingMessages = new WeakMap, _Channel_messageEndIndex = new WeakMap, _Channel_instances = new WeakSet, _Channel_deliver = function _Channel_deliver2(message) {
    try {
      __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }, SERIALIZE_TO_IPC_FN)]() {
    return `__CHANNEL__:${this.id}`;
  }
  toJSON() {
    return this[SERIALIZE_TO_IPC_FN]();
  }
}
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
class Resource {
  get rid() {
    return __classPrivateFieldGet(this, _Resource_rid, "f");
  }
  constructor(rid) {
    _Resource_rid.set(this, undefined);
    __classPrivateFieldSet(this, _Resource_rid, rid, "f");
  }
  async close() {
    return invoke("plugin:resources|close", {
      rid: this.rid
    });
  }
  async[(_Resource_rid = new WeakMap, Symbol.asyncDispose)]() {
    await this.close();
  }
}

// src/main.ts
async function tauriInvoke(cmd, args) {
  const hasTauri = typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
  if (hasTauri) {
    try {
      return await invoke(cmd, args);
    } catch (err) {
      console.error(`[Tauri IPC Error: ${cmd}]`, err);
      throw err;
    }
  }
  console.log(`[IPC Mock] ${cmd}`, args);
  if (cmd === "get_vault_status") {
    return {
      initialized: false,
      folder: null,
      bucket: null,
      region: "us-east-1",
      endpoint: null,
      device_id: null,
      device_name: null,
      hub_url: null,
      key_store: "macOS Keychain",
      total_files: 0,
      pending_changes: 0,
      total_bytes: 0
    };
  }
  if (cmd === "list_synced_files") {
    return [];
  }
  if (cmd === "trigger_sync") {
    return {
      success: true,
      message: "Sync completed (mock mode)",
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      failed: 0
    };
  }
  return {};
}
var allFiles = [];
function formatBytes(bytes) {
  if (bytes === 0)
    return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
function appendLog(text, color = "#94a3b8") {
  const logBox = document.getElementById("log-box");
  if (!logBox)
    return;
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.style.color = color;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${text}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}
async function refreshVaultStatus() {
  try {
    const status = await tauriInvoke("get_vault_status");
    const uninitBanner = document.getElementById("uninit-banner");
    const statFiles = document.getElementById("stat-files");
    const statStorage = document.getElementById("stat-storage");
    const statPending = document.getElementById("stat-pending");
    const statKeystore = document.getElementById("stat-keystore");
    const folderPath = document.getElementById("local-folder-path");
    const connPill = document.getElementById("connection-pill");
    const connText = document.getElementById("connection-text");
    if (statFiles)
      statFiles.textContent = String(status.total_files);
    if (statStorage)
      statStorage.textContent = formatBytes(status.total_bytes);
    if (statPending)
      statPending.textContent = String(status.pending_changes);
    if (statKeystore && status.key_store)
      statKeystore.textContent = status.key_store;
    if (folderPath && status.folder)
      folderPath.textContent = status.folder;
    if (uninitBanner) {
      uninitBanner.style.display = status.initialized ? "none" : "flex";
    }
    if (connPill && connText) {
      if (!status.initialized) {
        connPill.className = "status-pill syncing";
        connText.textContent = "Setup Needed";
      } else if (status.pending_changes > 0) {
        connPill.className = "status-pill syncing";
        connText.textContent = `${status.pending_changes} Pending`;
      } else {
        connPill.className = "status-pill up-to-date";
        connText.textContent = "Up to Date";
      }
    }
    const cfgDeviceId = document.getElementById("cfg-device-id");
    const cfgDeviceName = document.getElementById("cfg-device-name");
    const cfgBucket = document.getElementById("cfg-bucket");
    const cfgRegion = document.getElementById("cfg-region");
    const cfgEndpoint = document.getElementById("cfg-endpoint");
    const cfgHub = document.getElementById("cfg-hub");
    if (cfgDeviceId)
      cfgDeviceId.textContent = status.device_id || "Unregistered (Run init to connect)";
    if (cfgDeviceName)
      cfgDeviceName.textContent = status.device_name || "Unconfigured";
    if (cfgBucket)
      cfgBucket.textContent = status.bucket || "None";
    if (cfgRegion)
      cfgRegion.textContent = status.region || "us-east-1";
    if (cfgEndpoint)
      cfgEndpoint.textContent = status.endpoint || "None (AWS standard)";
    if (cfgHub)
      cfgHub.textContent = status.hub_url || "ws://localhost:8787/ws";
  } catch (err) {
    console.error("Failed to load status:", err);
  }
}
async function refreshFilesList() {
  try {
    allFiles = await tauriInvoke("list_synced_files");
    const tabFileCount = document.getElementById("tab-file-count");
    if (tabFileCount)
      tabFileCount.textContent = String(allFiles.length);
    renderFilesTable(allFiles);
  } catch (err) {
    console.error("Failed to list files:", err);
  }
}
function renderFilesTable(files) {
  const tbody = document.getElementById("files-tbody");
  if (!tbody)
    return;
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
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[m] || m);
}
function switchTab(targetId) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const isTarget = b.getAttribute("data-tab") === targetId;
    b.classList.toggle("active", isTarget);
  });
  document.querySelectorAll(".content-view").forEach((view) => {
    view.classList.toggle("active", view.id === targetId);
  });
}
async function handleSyncNow() {
  const syncBtn = document.getElementById("sync-now-btn");
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
    const result = await tauriInvoke("trigger_sync");
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
function initDesktopApp() {
  console.log("[RenegadeBox] Initializing desktop app DOM handlers...");
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = btn.getAttribute("data-tab");
      if (targetId) {
        console.log(`[RenegadeBox] Switching tab to ${targetId}`);
        switchTab(targetId);
      }
    });
  });
  document.getElementById("setup-s3-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    switchTab("tab-settings");
  });
  document.getElementById("sync-now-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    handleSyncNow();
  });
  document.getElementById("open-folder-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    appendLog("Opening local sync folder in Finder...", "#38bdf8");
    try {
      await tauriInvoke("open_sync_folder");
    } catch (err) {
      appendLog(`Open folder error: ${err}`, "#f43f5e");
    }
  });
  document.getElementById("open-dashboard-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    appendLog("Opening Control Plane Dashboard in default browser...", "#38bdf8");
    try {
      await tauriInvoke("open_dashboard");
    } catch (err) {
      appendLog(`Open dashboard error: ${err}`, "#f43f5e");
    }
  });
  document.getElementById("refresh-files-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    appendLog("Refreshing tracked files cache...", "#38bdf8");
    await refreshFilesList();
  });
  const searchInput = document.getElementById("file-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = allFiles.filter((f) => f.path.toLowerCase().includes(q));
      renderFilesTable(filtered);
    });
  }
  refreshVaultStatus();
  refreshFilesList();
  setInterval(() => {
    refreshVaultStatus();
  }, 3000);
  appendLog("Desktop GUI active and interactive.", "#10b981");
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDesktopApp);
} else {
  initDesktopApp();
}
export {
  tauriInvoke,
  switchTab,
  renderFilesTable,
  refreshVaultStatus,
  refreshFilesList,
  initDesktopApp,
  handleSyncNow,
  formatBytes,
  appendLog
};
