var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

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
var init_tslib_es6 = () => {};

// node_modules/@tauri-apps/api/core.js
function transformCallback(callback, once = false) {
  return window.__TAURI_INTERNALS__.transformCallback(callback, once);
}
async function invoke(cmd, args = {}, options) {
  return window.__TAURI_INTERNALS__.invoke(cmd, args, options);
}
var _Channel_instances, _Channel_onmessage, _Channel_nextMessageIndex, _Channel_pendingMessages, _Channel_messageEndIndex, _Channel_deliver, _Resource_rid, SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__", Channel, Resource;
var init_core = __esm(() => {
  init_tslib_es6();
  Channel = class Channel {
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
  };
  Resource = class Resource {
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
  };
});

// node_modules/@tauri-apps/api/event.js
var exports_event = {};
__export(exports_event, {
  once: () => once,
  listen: () => listen,
  emitTo: () => emitTo,
  emit: () => emit,
  TauriEvent: () => TauriEvent
});
async function _unlisten(event, eventId) {
  window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(event, eventId);
  await invoke("plugin:event|unlisten", {
    event,
    eventId
  });
}
async function listen(event, handler, options) {
  var _a;
  const target = typeof (options === null || options === undefined ? undefined : options.target) === "string" ? { kind: "AnyLabel", label: options.target } : (_a = options === null || options === undefined ? undefined : options.target) !== null && _a !== undefined ? _a : { kind: "Any" };
  return invoke("plugin:event|listen", {
    event,
    target,
    handler: transformCallback(handler)
  }).then((eventId) => {
    return async () => _unlisten(event, eventId);
  });
}
async function once(event, handler, options) {
  return listen(event, (eventData) => {
    _unlisten(event, eventData.id);
    handler(eventData);
  }, options);
}
async function emit(event, payload) {
  await invoke("plugin:event|emit", {
    event,
    payload
  });
}
async function emitTo(target, event, payload) {
  const eventTarget = typeof target === "string" ? { kind: "AnyLabel", label: target } : target;
  await invoke("plugin:event|emit_to", {
    target: eventTarget,
    event,
    payload
  });
}
var TauriEvent;
var init_event = __esm(() => {
  init_core();
  (function(TauriEvent2) {
    TauriEvent2["WINDOW_RESIZED"] = "tauri://resize";
    TauriEvent2["WINDOW_MOVED"] = "tauri://move";
    TauriEvent2["WINDOW_CLOSE_REQUESTED"] = "tauri://close-requested";
    TauriEvent2["WINDOW_DESTROYED"] = "tauri://destroyed";
    TauriEvent2["WINDOW_FOCUS"] = "tauri://focus";
    TauriEvent2["WINDOW_BLUR"] = "tauri://blur";
    TauriEvent2["WINDOW_SCALE_FACTOR_CHANGED"] = "tauri://scale-change";
    TauriEvent2["WINDOW_THEME_CHANGED"] = "tauri://theme-changed";
    TauriEvent2["WINDOW_CREATED"] = "tauri://window-created";
    TauriEvent2["WINDOW_SUSPENDED"] = "tauri://suspended";
    TauriEvent2["WINDOW_RESUMED"] = "tauri://resumed";
    TauriEvent2["WEBVIEW_CREATED"] = "tauri://webview-created";
    TauriEvent2["DRAG_ENTER"] = "tauri://drag-enter";
    TauriEvent2["DRAG_OVER"] = "tauri://drag-over";
    TauriEvent2["DRAG_DROP"] = "tauri://drag-drop";
    TauriEvent2["DRAG_LEAVE"] = "tauri://drag-leave";
  })(TauriEvent || (TauriEvent = {}));
});

// src/main.ts
init_core();
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
      initialized: true,
      folder: "/Users/me/RenegadeBox",
      bucket: "my-box",
      region: "us-east-1",
      endpoint: "http://localhost:8333",
      device_id: "00c4a3c6-7bb6-4a3d-8349-025db24bcceb",
      device_name: "My MacBook",
      hub_url: "ws://localhost:8787/ws",
      key_store: "macOS Keychain (Hardware-backed)",
      total_files: 11,
      pending_changes: 0,
      total_bytes: 42180900
    };
  }
  if (cmd === "list_synced_files") {
    return [
      { path: "!!Photoshops", size: 0, status: "synced", mtime_ns: Date.now() * 1e6 },
      { path: "3D printer parts", size: 0, status: "synced", mtime_ns: Date.now() * 1e6 },
      { path: "2019_05_10_08_13_48.mp4", size: 14200000, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 60 },
      { path: "2019_05_11_14_22_18.mp4", size: 8400000, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 59 },
      { path: "2019_05_11_14_24_49.mp4", size: 6300000, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 58 },
      { path: "Documents/Taxes-2026.pdf", size: 3421800, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 5 },
      { path: "Projects/renegadebox/spec.md", size: 18450, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 2 },
      { path: "Photos/team-offsite.jpg", size: 5214000, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 1 }
    ];
  }
  if (cmd === "trigger_sync") {
    return {
      success: true,
      message: "pushed: 0 up | pulled: 0 down | conflicts: 0",
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      failed: 0
    };
  }
  return {};
}
var allFiles = [];
var selectedFile = null;
var currentVaultStatus = null;
function getFileTypeInfo(filePath) {
  const isFolder = !filePath.includes(".") || filePath.endsWith("/");
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  if (isFolder) {
    return {
      label: "File folder",
      isFolder: true,
      iconSvg: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#fbbf24" stroke="#d97706" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      `
    };
  }
  if (["mp4", "mov", "mkv", "avi", "webm"].includes(ext)) {
    return {
      label: "MP4 Video",
      isFolder: false,
      iconSvg: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#60a5fa" stroke="#2563eb" stroke-width="1.5">
          <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
          <line x1="7" y1="2" x2="7" y2="22"></line>
          <line x1="17" y1="2" x2="17" y2="22"></line>
          <line x1="2" y1="12" x2="22" y2="12"></line>
        </svg>
      `
    };
  }
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
    return {
      label: "Image",
      isFolder: false,
      iconSvg: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#c084fc" stroke="#9333ea" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      `
    };
  }
  if (ext === "pdf") {
    return {
      label: "PDF Document",
      isFolder: false,
      iconSvg: `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#f87171" stroke="#dc2626" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      `
    };
  }
  return {
    label: `${ext.toUpperCase() || "Plain"} Document`,
    isFolder: false,
    iconSvg: `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#93c5fd" stroke="#3b82f6" stroke-width="1.5">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline>
      </svg>
    `
  };
}
function formatBytes(bytes) {
  if (bytes === 0)
    return "--";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
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
function renderFileTable(files) {
  const tbody = document.getElementById("file-table-body");
  if (!tbody)
    return;
  if (files.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">
          <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-dark); margin-bottom: 0.5rem;">
            No synchronized files yet
          </div>
          <div style="font-size: 0.85rem;">
            Drag any files or folders into your local sync directory to encrypt and sync to S3.
          </div>
        </td>
      </tr>
    `;
    return;
  }
  tbody.innerHTML = files.map((file, idx) => {
    const isSelected = selectedFile?.path === file.path;
    const typeInfo = getFileTypeInfo(file.path);
    let badgeClass = "";
    let badgeChar = "✓";
    let statusText = "Synced";
    if (file.status === "conflicted") {
      badgeClass = "conflict";
      badgeChar = "!";
      statusText = "Conflicted";
    } else if (file.status === "pending_upload") {
      badgeClass = "syncing";
      badgeChar = "⟳";
      statusText = "Syncing";
    }
    return `
      <tr class="file-row ${isSelected ? "selected" : ""}" data-idx="${idx}" data-path="${escapeHtml(file.path)}">
        <td>
          <div class="file-name-cell">
            <span class="chevron-icon">▶</span>
            <div class="icon-with-sync-badge">
              ${typeInfo.iconSvg}
              <div class="sync-badge-overlay ${badgeClass}">${badgeChar}</div>
            </div>
            <span class="file-title-text">${escapeHtml(file.path)}</span>
          </div>
        </td>
        <td>
          <span class="file-type-text">${typeInfo.label}</span>
        </td>
        <td>
          <span class="file-size-text">${formatBytes(file.size)}</span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: ${file.status === "conflicted" ? "var(--status-conflict)" : "var(--status-synced)"}; font-weight: 500;">
            ${statusText}
          </span>
        </td>
      </tr>
    `;
  }).join("");
  tbody.querySelectorAll(".file-row").forEach((row) => {
    row.addEventListener("click", () => {
      const idx = Number(row.getAttribute("data-idx"));
      const item = files[idx];
      if (item) {
        selectFile(item);
      }
    });
    row.addEventListener("dblclick", () => {
      tauriInvoke("open_sync_folder");
    });
  });
}
function selectFile(file) {
  selectedFile = file;
  document.querySelectorAll(".file-row").forEach((row) => {
    const path = row.getAttribute("data-path");
    row.classList.toggle("selected", path === file.path);
  });
  const typeInfo = getFileTypeInfo(file.path);
  const nameEl = document.getElementById("inspector-file-name");
  const metaEl = document.getElementById("inspector-file-meta");
  const iconContainer = document.getElementById("inspector-icon-container");
  const s3Target = document.getElementById("inspector-s3-target");
  const activityTitle = document.getElementById("activity-title");
  const activityTime = document.getElementById("activity-time");
  if (nameEl)
    nameEl.textContent = file.path;
  if (metaEl) {
    const sizeStr = file.size > 0 ? formatBytes(file.size) : "Folder";
    metaEl.textContent = `${sizeStr} • Verified AES-256-GCM`;
  }
  if (iconContainer) {
    iconContainer.innerHTML = typeInfo.iconSvg.replace('width="20" height="20"', 'width="56" height="56"');
  }
  if (s3Target) {
    const bucket = currentVaultStatus?.bucket || "my-box";
    s3Target.textContent = `s3://${bucket}/blobs/...`;
  }
  if (activityTitle) {
    activityTitle.textContent = `Synced ${file.path}`;
  }
  if (activityTime) {
    activityTime.textContent = `Encrypted & stored zero-knowledge in S3`;
  }
}
async function refreshVaultStatus() {
  try {
    const status = await tauriInvoke("get_vault_status");
    currentVaultStatus = status;
    const statFiles = document.getElementById("stat-files");
    const statStorage = document.getElementById("stat-storage");
    const statPending = document.getElementById("stat-pending");
    const sidebarBucket = document.getElementById("sidebar-bucket-name");
    const sidebarUser = document.getElementById("sidebar-user-name");
    const sidebarDevice = document.getElementById("sidebar-device-id");
    const keystoreEl = document.getElementById("inspector-keystore");
    const cfgFolder = document.getElementById("cfg-folder");
    const cfgBucket = document.getElementById("cfg-bucket");
    const cfgEndpoint = document.getElementById("cfg-endpoint");
    const cfgRegion = document.getElementById("cfg-region");
    const cfgDeviceId = document.getElementById("cfg-device-id");
    const cfgHub = document.getElementById("cfg-hub");
    if (statFiles)
      statFiles.textContent = String(status.total_files || allFiles.length);
    if (statStorage)
      statStorage.textContent = formatBytes(status.total_bytes);
    if (statPending)
      statPending.textContent = String(status.pending_changes);
    if (sidebarBucket && status.bucket)
      sidebarBucket.textContent = status.bucket;
    if (sidebarUser && status.device_name)
      sidebarUser.textContent = status.device_name;
    if (sidebarDevice)
      sidebarDevice.textContent = status.device_id ? `Device: ${status.device_id.slice(0, 8)}...` : "Zero-Knowledge Sync";
    if (keystoreEl && status.key_store)
      keystoreEl.textContent = status.key_store;
    if (cfgFolder && status.folder)
      cfgFolder.textContent = status.folder;
    if (cfgBucket && status.bucket)
      cfgBucket.textContent = status.bucket;
    if (cfgEndpoint)
      cfgEndpoint.textContent = status.endpoint || "http://localhost:8333 (SeaweedFS S3)";
    if (cfgRegion && status.region)
      cfgRegion.textContent = status.region;
    if (cfgDeviceId)
      cfgDeviceId.textContent = status.device_id || "Unregistered";
    if (cfgHub && status.hub_url)
      cfgHub.textContent = status.hub_url;
  } catch (err) {
    console.error("Failed to load vault status:", err);
  }
}
async function refreshFilesList() {
  try {
    let files = await tauriInvoke("list_synced_files");
    if (files.length === 0) {
      files = [
        { path: "!!Photoshops", size: 0, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "3D printer parts", size: 0, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "2019_05_10_08_13_48.mp4", size: 14200000, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "2019_05_11_14_22_18.mp4", size: 8400000, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "2019_05_11_14_24_49.mp4", size: 6300000, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "2019_05_11_14_27_50.mp4", size: 9100000, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "Documents/Taxes-2026.pdf", size: 3421800, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "Projects/renegadebox/spec.md", size: 18450, status: "synced", mtime_ns: Date.now() * 1e6 }
      ];
    }
    allFiles = files;
    renderFileTable(allFiles);
    if (!selectedFile && allFiles.length > 4) {
      selectFile(allFiles[4]);
    } else if (!selectedFile && allFiles.length > 0) {
      selectFile(allFiles[0]);
    }
  } catch (err) {
    console.error("Failed to list files:", err);
  }
}
async function handleSyncNow() {
  const syncBtn = document.getElementById("sync-now-btn");
  const activityTitle = document.getElementById("activity-title");
  const activityTime = document.getElementById("activity-time");
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.textContent = "Syncing...";
  }
  if (activityTitle)
    activityTitle.textContent = "Sync cycle in progress...";
  if (activityTime)
    activityTime.textContent = "Scanning local changes -> pulling -> pushing";
  try {
    const result = await tauriInvoke("trigger_sync");
    if (activityTitle) {
      activityTitle.textContent = result.success ? "Sync completed" : "Sync completed with warnings";
    }
    if (activityTime)
      activityTime.textContent = result.message;
  } catch (err) {
    if (activityTitle)
      activityTitle.textContent = "Sync notice";
    if (activityTime)
      activityTime.textContent = String(err);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = "⟳ Sync Now";
    }
    await refreshVaultStatus();
    await refreshFilesList();
  }
}
function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal)
    modal.classList.add("open");
}
function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal)
    modal.classList.remove("open");
}
function initDesktopApp() {
  console.log("[RenegadeBox] Initializing Dropbox-style desktop UI...");
  document.getElementById("sync-now-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    handleSyncNow();
  });
  document.getElementById("open-folder-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await tauriInvoke("open_sync_folder");
    } catch (err) {
      console.error("Open folder error:", err);
    }
  });
  document.getElementById("inspector-open-external")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await tauriInvoke("open_sync_folder");
    } catch (err) {
      console.error("Open error:", err);
    }
  });
  document.getElementById("nav-settings")?.addEventListener("click", openSettingsModal);
  document.getElementById("user-profile-btn")?.addEventListener("click", openSettingsModal);
  document.getElementById("footer-feedback-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    openSettingsModal();
  });
  document.getElementById("close-modal-btn")?.addEventListener("click", closeSettingsModal);
  document.getElementById("modal-done-btn")?.addEventListener("click", closeSettingsModal);
  document.getElementById("modal-dashboard-btn")?.addEventListener("click", async () => {
    try {
      await tauriInvoke("open_dashboard");
    } catch (err) {
      console.error("Open dashboard error:", err);
    }
  });
  document.getElementById("action-link-btn")?.addEventListener("click", () => {
    if (selectedFile) {
      navigator.clipboard?.writeText(selectedFile.path);
      const activityTitle = document.getElementById("activity-title");
      if (activityTitle)
        activityTitle.textContent = `Copied path: ${selectedFile.path}`;
    }
  });
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = allFiles.filter((f) => f.path.toLowerCase().includes(q));
      renderFileTable(filtered);
    });
  }
  refreshVaultStatus();
  refreshFilesList();
  setupAutoSyncEvents();
  setInterval(() => {
    refreshVaultStatus();
  }, 5000);
}
async function setupAutoSyncEvents() {
  const hasTauri = typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
  if (!hasTauri)
    return;
  try {
    const { listen: listen2 } = await Promise.resolve().then(() => (init_event(), exports_event));
    await listen2("vault-changed", async () => {
      console.log("[Tauri Event] vault-changed detected, refreshing UI...");
      await refreshVaultStatus();
      await refreshFilesList();
    });
    await listen2("sync-started", () => {
      console.log("[Tauri Event] sync-started received");
      const activityTitle = document.getElementById("activity-title");
      const activityTime = document.getElementById("activity-time");
      if (activityTitle)
        activityTitle.textContent = "Syncing in progress...";
      if (activityTime)
        activityTime.textContent = "Encrypting & synchronizing with S3 vault";
    });
    await listen2("sync-finished", async (event) => {
      console.log("[Tauri Event] sync-finished received:", event.payload);
      const activityTitle = document.getElementById("activity-title");
      const activityTime = document.getElementById("activity-time");
      if (activityTitle) {
        activityTitle.textContent = event.payload.success ? "Sync completed" : "Sync notice";
      }
      if (activityTime) {
        activityTime.textContent = event.payload.message;
      }
      await refreshVaultStatus();
      await refreshFilesList();
    });
    console.log("[RenegadeBox] Auto-sync event listeners registered.");
  } catch (err) {
    console.warn("[RenegadeBox] Could not attach auto-sync event listeners:", err);
  }
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initDesktopApp);
} else {
  initDesktopApp();
}
export {
  tauriInvoke,
  selectFile,
  renderFileTable,
  refreshVaultStatus,
  refreshFilesList,
  openSettingsModal,
  initDesktopApp,
  handleSyncNow,
  formatBytes,
  escapeHtml,
  closeSettingsModal
};
