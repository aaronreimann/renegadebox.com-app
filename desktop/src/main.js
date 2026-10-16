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
      bucket: "my-renegadebox-bucket",
      region: "us-east-1",
      endpoint: "",
      device_id: "68a3c8a0-c930-4984-bc66-079164e213f6",
      device_name: "My-MBP",
      hub_url: "ws://localhost:8787/ws",
      key_store: "macOS Keychain (Hardware-backed)",
      total_files: 5,
      pending_changes: 0,
      total_bytes: 42180900
    };
  }
  if (cmd === "list_synced_files") {
    return [
      { path: "welcome.txt", size: 124, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 2, hash: "9e6db089d244e029996efe34bfc4aeff", blob_id: "825e8d97b0b87e5af6d485e2ddd27991" },
      { path: "Documents/Taxes-2026.pdf", size: 3421800, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 5, hash: "a1b2c3d4e5f60718293a", blob_id: "deadbeefcafebabe0102" },
      { path: "Projects/renegadebox/spec.md", size: 18450, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 1, hash: "5e6f7a8b9c0d1e2f3a4b", blob_id: "1234567890abcdef1234" },
      { path: "Photos/ship-flag.jpg", size: 5214000, status: "synced", mtime_ns: Date.now() * 1e6 - 86400000 * 3, hash: "aabbccddeeff00112233", blob_id: "f0f0e1e1d2d2c3c3b4b4" },
      { path: "Notes (conflicted copy My-MBP 2026-10-15).txt", size: 1024, status: "conflicted", mtime_ns: Date.now() * 1e6 - 3600000, hash: "conflict999999999999", blob_id: "conflictedblob000000" }
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
  if (cmd === "is_sync_paused") {
    return false;
  }
  if (cmd === "get_ignored_patterns") {
    return [".DS_Store", "Thumbs.db", "*.tmp", ".git/", "node_modules/"];
  }
  if (cmd === "get_file_history") {
    return [
      {
        timestamp_ms: Date.now() - 3600000,
        date_str: "Today at 22:30 UTC",
        device_name: "My-MBP",
        lamport: 42,
        size: 18450,
        hash: "5e6f7a8b9c0d1e2f3a4b",
        blob_id: "1234567890abcdef1234",
        action: "Current Head",
        is_current: true
      },
      {
        timestamp_ms: Date.now() - 86400000,
        date_str: "Yesterday at 14:15 UTC",
        device_name: "My-MBP",
        lamport: 18,
        size: 14200,
        hash: "11223344556677889900",
        blob_id: "abcdefabcdef12345678",
        action: "Initial Commit",
        is_current: false
      }
    ];
  }
  if (cmd === "is_autostart_enabled") {
    return false;
  }
  if (cmd === "set_autostart_enabled") {
    return args?.enabled ?? false;
  }
  if (cmd === "migrate_to_silent_keystore") {
    return true;
  }
  if (cmd === "add_to_finder_favorites") {
    return "Opened ~/RenegadeBox in Finder";
  }
  if (cmd === "setup_vault") {
    return {
      initialized: true,
      folder: args?.payload?.folder || "/Users/me/RenegadeBox",
      bucket: args?.payload?.bucket || "my-renegadebox-bucket",
      region: args?.payload?.region || "us-east-1",
      endpoint: args?.payload?.endpoint || null,
      device_id: "68a3c8a0-c930-4984-bc66-079164e213f6",
      device_name: args?.payload?.device_name || "My-MBP",
      hub_url: null,
      key_store: "App-Protected Private Keystore (Zero Prompts)",
      total_files: 0,
      pending_changes: 0,
      total_bytes: 0
    };
  }
  return {};
}
var allFiles = [];
var selectedFile = null;
var currentVaultStatus = null;
var isSyncPaused = false;
var currentDirectory = "";
var currentFilter = "all";
var currentSortKey = "name";
var currentSortAsc = true;
var currentViewMode = "list";
var activeNav = "files";
var starredPaths = new Set;
var navHistory = [""];
var navHistoryIndex = 0;
var activityLogs = [
  {
    id: "init-1",
    title: "Vault online & watching ~/RenegadeBox",
    subtitle: "Native macOS FSEvents active with 500ms debouncing",
    time: "Just now",
    type: "system",
    timestamp: Date.now()
  }
];
function loadStarred() {
  try {
    const raw = localStorage.getItem("rbox_starred");
    if (raw)
      starredPaths = new Set(JSON.parse(raw));
  } catch (_) {
    starredPaths = new Set;
  }
}
function saveStarred() {
  try {
    localStorage.setItem("rbox_starred", JSON.stringify(Array.from(starredPaths)));
  } catch (_) {}
}
function logActivity(title, subtitle, type = "system") {
  activityLogs.unshift({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title,
    subtitle,
    time: "Just now",
    type,
    timestamp: Date.now()
  });
  if (activityLogs.length > 50)
    activityLogs.pop();
  renderActivityFeed();
}
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
function getFilteredAndSortedFiles() {
  const searchInput = document.getElementById("search-input");
  const q = searchInput?.value.toLowerCase().trim() || "";
  let list = allFiles.slice();
  if (activeNav === "starred") {
    list = list.filter((f) => starredPaths.has(f.path));
  } else if (q.length === 0 && currentDirectory) {
    list = list.filter((f) => f.path.startsWith(`${currentDirectory}/`));
  }
  if (currentFilter === "documents") {
    list = list.filter((f) => {
      const ext = f.path.split(".").pop()?.toLowerCase() || "";
      return ["pdf", "txt", "doc", "docx", "md", "rtf", "odt"].includes(ext);
    });
  } else if (currentFilter === "media") {
    list = list.filter((f) => {
      const ext = f.path.split(".").pop()?.toLowerCase() || "";
      return ["mp4", "mov", "avi", "mkv", "jpg", "jpeg", "png", "gif", "webp", "mp3", "wav"].includes(ext);
    });
  } else if (currentFilter === "code") {
    list = list.filter((f) => {
      const ext = f.path.split(".").pop()?.toLowerCase() || "";
      return ["rs", "ts", "js", "py", "json", "toml", "html", "css", "sh", "yaml", "yml"].includes(ext);
    });
  } else if (currentFilter === "conflicted") {
    list = list.filter((f) => f.status === "conflicted");
  }
  if (q.length > 0) {
    list = list.filter((f) => f.path.toLowerCase().includes(q));
  }
  list.sort((a, b) => {
    let comp = 0;
    if (currentSortKey === "name") {
      comp = a.path.localeCompare(b.path);
    } else if (currentSortKey === "type") {
      const typeA = getFileTypeInfo(a.path).label;
      const typeB = getFileTypeInfo(b.path).label;
      comp = typeA.localeCompare(typeB);
    } else if (currentSortKey === "size") {
      comp = a.size - b.size;
    } else if (currentSortKey === "status") {
      comp = a.status.localeCompare(b.status);
    }
    return currentSortAsc ? comp : -comp;
  });
  return list;
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
            No synchronized files found
          </div>
          <div style="font-size: 0.85rem;">
            Add files or drag them into <strong>~/RenegadeBox</strong> to automatically encrypt and stash in S3.
          </div>
        </td>
      </tr>
    `;
    return;
  }
  tbody.innerHTML = files.map((file, idx) => {
    const isSelected = selectedFile?.path === file.path;
    const typeInfo = getFileTypeInfo(file.path);
    const isStarred = starredPaths.has(file.path);
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
    const displayPath = currentDirectory && file.path.startsWith(`${currentDirectory}/`) ? file.path.slice(currentDirectory.length + 1) : file.path;
    return `
      <tr class="file-row ${isSelected ? "selected" : ""}" data-idx="${idx}" data-path="${escapeHtml(file.path)}">
        <td>
          <div class="file-name-cell">
            <span class="chevron-icon" style="color: ${isStarred ? "#fbbf24" : "#cbd5e1"}; font-size: 0.9rem;" title="${isStarred ? "Starred" : "Unstarred"}">${isStarred ? "★" : "▶"}</span>
            <div class="icon-with-sync-badge">
              ${typeInfo.iconSvg}
              <div class="sync-badge-overlay ${badgeClass}">${badgeChar}</div>
            </div>
            <span class="file-title-text">${escapeHtml(displayPath)}</span>
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
      const path = row.getAttribute("data-path");
      const item = files.find((f) => f.path === path);
      if (item)
        selectFile(item);
    });
    row.addEventListener("dblclick", () => {
      const path = row.getAttribute("data-path");
      const item = files.find((f) => f.path === path);
      if (item) {
        if (item.path.includes("/")) {
          const parts = item.path.split("/");
          if (parts.length > 1 && item.size === 0) {
            enterDirectory(parts[0]);
            return;
          }
        }
        tauriInvoke("open_file", { path: item.path }).catch(() => {
          tauriInvoke("open_sync_folder");
        });
      }
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const path = row.getAttribute("data-path");
      const item = files.find((f) => f.path === path);
      if (item) {
        selectFile(item);
        showContextMenu(e.clientX, e.clientY, item);
      }
    });
  });
}
function renderFileGrid(files) {
  const grid = document.getElementById("file-grid");
  if (!grid)
    return;
  if (files.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 3rem 1rem;">
        <div style="font-size: 1.1rem; font-weight: 600; color: var(--text-dark); margin-bottom: 0.5rem;">
          No files in this view
        </div>
      </div>
    `;
    return;
  }
  grid.innerHTML = files.map((file) => {
    const isSelected = selectedFile?.path === file.path;
    const typeInfo = getFileTypeInfo(file.path);
    const isStarred = starredPaths.has(file.path);
    let badgeClass = "";
    let badgeChar = "✓";
    if (file.status === "conflicted") {
      badgeClass = "conflict";
      badgeChar = "!";
    } else if (file.status === "pending_upload") {
      badgeClass = "syncing";
      badgeChar = "⟳";
    }
    const displayPath = currentDirectory && file.path.startsWith(`${currentDirectory}/`) ? file.path.slice(currentDirectory.length + 1) : file.path;
    return `
      <div class="grid-card ${isSelected ? "selected" : ""}" data-path="${escapeHtml(file.path)}">
        <div class="grid-card-icon">
          ${typeInfo.iconSvg.replace('width="20" height="20"', 'width="42" height="42"')}
          <div class="sync-badge-overlay ${badgeClass}" style="bottom: 0; right: 0;">${badgeChar}</div>
        </div>
        <div class="grid-card-title" title="${escapeHtml(file.path)}">
          ${isStarred ? "★ " : ""}${escapeHtml(displayPath)}
        </div>
        <div class="grid-card-meta">
          ${formatBytes(file.size)}
        </div>
      </div>
    `;
  }).join("");
  grid.querySelectorAll(".grid-card").forEach((card) => {
    card.addEventListener("click", () => {
      const path = card.getAttribute("data-path");
      const item = files.find((f) => f.path === path);
      if (item)
        selectFile(item);
    });
    card.addEventListener("dblclick", () => {
      const path = card.getAttribute("data-path");
      const item = files.find((f) => f.path === path);
      if (item) {
        tauriInvoke("open_file", { path: item.path }).catch(() => {
          tauriInvoke("open_sync_folder");
        });
      }
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const path = card.getAttribute("data-path");
      const item = files.find((f) => f.path === path);
      if (item) {
        selectFile(item);
        showContextMenu(e.clientX, e.clientY, item);
      }
    });
  });
}
function renderActiveViews() {
  const filtered = getFilteredAndSortedFiles();
  const tableView = document.getElementById("table-view-container");
  const gridView = document.getElementById("file-grid");
  const activityView = document.getElementById("activity-view-container");
  if (activeNav === "activity") {
    if (tableView)
      tableView.style.display = "none";
    if (gridView)
      gridView.style.display = "none";
    if (activityView)
      activityView.style.display = "block";
    renderActivityFeed();
    return;
  }
  if (activityView)
    activityView.style.display = "none";
  if (currentViewMode === "list") {
    if (tableView)
      tableView.style.display = "block";
    if (gridView)
      gridView.style.display = "none";
    renderFileTable(filtered);
  } else {
    if (tableView)
      tableView.style.display = "none";
    if (gridView)
      gridView.style.display = "grid";
    renderFileGrid(filtered);
  }
  renderBreadcrumbs();
  const statFiles = document.getElementById("stat-files");
  if (statFiles)
    statFiles.textContent = String(filtered.length);
}
function renderBreadcrumbs() {
  const container = document.getElementById("breadcrumb-container");
  if (!container)
    return;
  if (!currentDirectory) {
    container.innerHTML = `<span class="breadcrumb-item root active" data-path="">\uD83C\uDFF4‍☠️ Vault</span>`;
    return;
  }
  const parts = currentDirectory.split("/");
  let html = `<span class="breadcrumb-item root" data-path="">\uD83C\uDFF4‍☠️ Vault</span>`;
  let accumulated = "";
  parts.forEach((p, idx) => {
    accumulated = accumulated ? `${accumulated}/${p}` : p;
    const isLast = idx === parts.length - 1;
    html += `
      <span class="breadcrumb-separator">/</span>
      <span class="breadcrumb-item ${isLast ? "active" : ""}" data-path="${escapeHtml(accumulated)}">${escapeHtml(p)}</span>
    `;
  });
  container.innerHTML = html;
  container.querySelectorAll(".breadcrumb-item").forEach((el) => {
    el.addEventListener("click", () => {
      const p = el.getAttribute("data-path") || "";
      enterDirectory(p);
    });
  });
}
function enterDirectory(dir) {
  currentDirectory = dir;
  if (navHistory[navHistoryIndex] !== dir) {
    navHistory = navHistory.slice(0, navHistoryIndex + 1);
    navHistory.push(dir);
    navHistoryIndex = navHistory.length - 1;
  }
  renderActiveViews();
}
function renderActivityFeed() {
  const stream = document.getElementById("activity-log-stream");
  if (!stream)
    return;
  if (activityLogs.length === 0) {
    stream.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 2rem;">No recent activities</div>`;
    return;
  }
  stream.innerHTML = activityLogs.map((log) => {
    let icon = "⚓";
    if (log.type === "upload")
      icon = "↑";
    if (log.type === "download")
      icon = "↓";
    if (log.type === "conflict")
      icon = "⚠️";
    return `
      <div class="activity-log-card">
        <div class="activity-log-icon">${icon}</div>
        <div class="activity-log-info">
          <div class="activity-log-title">${escapeHtml(log.title)}</div>
          <div class="activity-log-sub">${escapeHtml(log.subtitle)}</div>
        </div>
        <div class="activity-log-time">${escapeHtml(log.time)}</div>
      </div>
    `;
  }).join("");
}
function selectFile(file) {
  selectedFile = file;
  document.querySelectorAll(".file-row").forEach((row) => {
    const path = row.getAttribute("data-path");
    row.classList.toggle("selected", path === file.path);
  });
  document.querySelectorAll(".grid-card").forEach((card) => {
    const path = card.getAttribute("data-path");
    card.classList.toggle("selected", path === file.path);
  });
  const typeInfo = getFileTypeInfo(file.path);
  const nameEl = document.getElementById("inspector-file-name");
  const metaEl = document.getElementById("inspector-file-meta");
  const iconContainer = document.getElementById("inspector-icon-container");
  const s3Target = document.getElementById("inspector-s3-target");
  const hashEl = document.getElementById("inspector-hash");
  const blobEl = document.getElementById("inspector-blob-id");
  const conflictBanner = document.getElementById("inspector-conflict-banner");
  const starBtn = document.getElementById("inspector-star-btn");
  if (nameEl)
    nameEl.textContent = file.path;
  if (metaEl) {
    const sizeStr = file.size > 0 ? formatBytes(file.size) : "Folder";
    metaEl.textContent = `${sizeStr} • Verified AES-256-GCM`;
  }
  if (iconContainer) {
    iconContainer.innerHTML = typeInfo.iconSvg.replace('width="20" height="20"', 'width="56" height="56"');
  }
  if (hashEl) {
    hashEl.textContent = file.hash ? `${file.hash.slice(0, 16)}...` : "Verified SHA-256";
    hashEl.title = file.hash || "";
  }
  if (blobEl) {
    blobEl.textContent = file.blob_id ? `${file.blob_id.slice(0, 16)}...` : "Encrypted blob";
    blobEl.title = file.blob_id ? `blobs/${file.blob_id}` : "";
  }
  if (s3Target) {
    const bucket = currentVaultStatus?.bucket || "my-renegadebox-bucket";
    s3Target.textContent = file.blob_id ? `s3://${bucket}/blobs/${file.blob_id.slice(0, 12)}...` : `s3://${bucket}/${file.path}`;
    s3Target.title = file.blob_id ? `s3://${bucket}/blobs/${file.blob_id}` : "";
  }
  if (conflictBanner) {
    conflictBanner.style.display = file.status === "conflicted" ? "block" : "none";
  }
  if (starBtn) {
    const isStarred = starredPaths.has(file.path);
    starBtn.textContent = isStarred ? "★ Starred" : "⭐ Star";
  }
}
async function refreshVaultStatus() {
  try {
    const status = await tauriInvoke("get_vault_status");
    currentVaultStatus = status;
    const statStorage = document.getElementById("stat-storage");
    const statPending = document.getElementById("stat-pending");
    const sidebarBucket = document.getElementById("sidebar-bucket-name");
    const sidebarUser = document.getElementById("sidebar-user-name");
    const sidebarDevice = document.getElementById("sidebar-device-id");
    const keystoreEl = document.getElementById("inspector-keystore");
    const meterFill = document.getElementById("storage-meter-fill");
    if (statStorage)
      statStorage.textContent = formatBytes(status.total_bytes);
    if (statPending)
      statPending.textContent = String(status.pending_changes);
    if (meterFill) {
      const pct = Math.min(100, Math.max(8, Math.round(status.total_bytes / (5 * 1024 * 1024 * 1024) * 100)));
      meterFill.style.width = `${pct}%`;
    }
    if (sidebarBucket && status.bucket)
      sidebarBucket.textContent = status.bucket;
    if (sidebarUser && status.device_name)
      sidebarUser.textContent = status.device_name;
    if (sidebarDevice)
      sidebarDevice.textContent = status.device_id ? `Device: ${status.device_id.slice(0, 8)}...` : "Zero-Knowledge Sync";
    if (keystoreEl && status.key_store)
      keystoreEl.textContent = status.key_store;
    isSyncPaused = await tauriInvoke("is_sync_paused").catch(() => false);
    updatePauseUI(isSyncPaused);
  } catch (err) {
    console.error("Failed to load vault status:", err);
  }
}
function updatePauseUI(paused) {
  isSyncPaused = paused;
  const pauseBtn = document.getElementById("pause-sync-btn");
  const pausedBadge = document.getElementById("sync-paused-badge");
  const pausedIndicator = document.getElementById("toolbar-paused-indicator");
  const footerStatus = document.getElementById("footer-sync-status");
  if (pauseBtn) {
    pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
  }
  if (pausedBadge) {
    pausedBadge.style.display = paused ? "inline-block" : "none";
  }
  if (pausedIndicator) {
    pausedIndicator.style.display = paused ? "inline" : "none";
  }
  if (footerStatus) {
    footerStatus.textContent = paused ? "⏸ Sync Paused" : "✓ Connected to S3";
    footerStatus.style.color = paused ? "var(--status-pending)" : "var(--status-synced)";
  }
}
async function refreshFilesList() {
  try {
    const hasTauri = typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
    let files = await tauriInvoke("list_synced_files");
    if (!hasTauri && files.length === 0) {
      files = [
        { path: "welcome.txt", size: 124, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "Documents/Taxes-2026.pdf", size: 3421800, status: "synced", mtime_ns: Date.now() * 1e6 },
        { path: "Projects/renegadebox/spec.md", size: 18450, status: "synced", mtime_ns: Date.now() * 1e6 }
      ];
    }
    allFiles = files;
    renderActiveViews();
    if (!selectedFile && allFiles.length > 0) {
      selectFile(allFiles[0]);
    } else if (selectedFile) {
      const match = allFiles.find((f) => f.path === selectedFile?.path);
      if (match)
        selectFile(match);
    }
  } catch (err) {
    console.error("Failed to list files:", err);
  }
}
async function handleSyncNow() {
  const syncBtn = document.getElementById("sync-now-btn");
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.textContent = "⚔️ Hoisting...";
  }
  logActivity("Manual sync triggered", "Scanning local folder -> encrypting -> pushing to S3", "upload");
  try {
    const result = await tauriInvoke("trigger_sync");
    logActivity(result.success ? "⚓ Booty stashed & synced" : "⚠️ Storm warning", result.message, result.success ? "system" : "conflict");
  } catch (err) {
    logActivity("⚠️ Sync error", String(err), "conflict");
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = "⟳ Sync Now";
    }
    await refreshVaultStatus();
    await refreshFilesList();
  }
}
async function handleTogglePause() {
  try {
    if (isSyncPaused) {
      await tauriInvoke("resume_sync");
      logActivity("▶ Sync resumed", "Background file watcher and automatic S3 sync enabled", "system");
      updatePauseUI(false);
    } else {
      await tauriInvoke("pause_sync");
      logActivity("⏸ Sync paused", "Background automatic synchronization suspended", "system");
      updatePauseUI(true);
    }
  } catch (err) {
    console.error("Failed to toggle sync pause:", err);
  }
}
async function handleRenameFile(file) {
  const currentName = file.path.split("/").pop() || file.path;
  const newName = prompt(`Enter new name for "${currentName}":`, currentName);
  if (!newName || newName.trim() === currentName)
    return;
  const parts = file.path.split("/");
  parts.pop();
  const newPath = parts.length > 0 ? `${parts.join("/")}/${newName.trim()}` : newName.trim();
  try {
    await tauriInvoke("rename_file", { oldPath: file.path, newPath });
    logActivity(`\uD83C\uDFF7️ Renamed "${currentName}"`, `New path: ${newPath}`, "system");
    await refreshFilesList();
    const updated = allFiles.find((f) => f.path === newPath);
    if (updated)
      selectFile(updated);
  } catch (err) {
    alert("Could not rename file: " + err);
  }
}
async function handleDeleteFile(file) {
  const confirmDel = confirm(`Move "${file.path}" to macOS Trash?

This will also remove it from your S3 vault.`);
  if (!confirmDel)
    return;
  try {
    await tauriInvoke("delete_file", { path: file.path });
    logActivity(`\uD83D\uDDD1️ Moved to Trash`, file.path, "system");
    selectedFile = null;
    await refreshFilesList();
    await refreshVaultStatus();
  } catch (err) {
    alert("Failed to delete file: " + err);
  }
}
async function handleExportCopy(file) {
  try {
    const dst = await tauriInvoke("export_file_copy", { path: file.path });
    logActivity(`\uD83D\uDCBE Exported copy to Downloads`, dst, "download");
    alert(`File exported successfully to:
${dst}`);
  } catch (err) {
    alert("Export failed: " + err);
  }
}
function toggleStar(path) {
  if (starredPaths.has(path)) {
    starredPaths.delete(path);
  } else {
    starredPaths.add(path);
  }
  saveStarred();
  if (selectedFile?.path === path)
    selectFile(selectedFile);
  renderActiveViews();
}
var activeConflictedFile = null;
function openConflictModal(file) {
  activeConflictedFile = file;
  const modal = document.getElementById("conflict-modal");
  const fileName = document.getElementById("conflict-file-name");
  const fileDetails = document.getElementById("conflict-file-details");
  if (fileName)
    fileName.textContent = file.path;
  if (fileDetails)
    fileDetails.textContent = `Size: ${formatBytes(file.size)} • Status: Conflicted copy`;
  if (modal)
    modal.classList.add("open");
}
function closeConflictModal() {
  const modal = document.getElementById("conflict-modal");
  if (modal)
    modal.classList.remove("open");
  activeConflictedFile = null;
}
async function resolveConflict(resolution) {
  if (!activeConflictedFile)
    return;
  try {
    await tauriInvoke("resolve_conflict", { path: activeConflictedFile.path, resolution });
    logActivity(`⚔️ Resolved conflict (${resolution})`, activeConflictedFile.path, "conflict");
    closeConflictModal();
    await refreshFilesList();
    await refreshVaultStatus();
  } catch (err) {
    alert("Failed to resolve conflict: " + err);
  }
}
async function openHistoryModal(file) {
  const modal = document.getElementById("history-modal");
  const title = document.getElementById("history-file-title");
  const container = document.getElementById("history-list-container");
  if (title)
    title.textContent = file.path;
  if (modal)
    modal.classList.add("open");
  if (container) {
    container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">Fetching journal history...</div>`;
    try {
      const revisions = await tauriInvoke("get_file_history", { path: file.path });
      if (revisions.length === 0) {
        container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No recorded journal revisions for this file.</div>`;
        return;
      }
      container.innerHTML = revisions.map((rev) => `
        <div style="background: #ffffff; border: 1px solid var(--border-light); border-radius: 6px; padding: 0.75rem 1rem; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-dark); display: flex; align-items: center; gap: 0.4rem;">
              <span>${escapeHtml(rev.action)}</span>
              ${rev.is_current ? '<span style="background: #e0f2fe; color: #0284c7; font-size: 0.7rem; padding: 1px 6px; border-radius: 4px;">CURRENT</span>' : ""}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">
              Device: <strong>${escapeHtml(rev.device_name)}</strong> • Lamport Seq: #${rev.lamport}
            </div>
            <div style="font-family: var(--font-mono); font-size: 0.68rem; color: #64748b; margin-top: 2px;">
              SHA: ${escapeHtml(rev.hash.slice(0, 18))}...
            </div>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-align: right;">
            ${escapeHtml(rev.date_str)}
          </div>
        </div>
      `).join("");
    } catch (err) {
      container.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Failed to load history: ${err}</div>`;
    }
  }
}
function closeHistoryModal() {
  const modal = document.getElementById("history-modal");
  if (modal)
    modal.classList.remove("open");
}
async function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal)
    modal.classList.add("open");
  if (currentVaultStatus) {
    const devInput = document.getElementById("cfg-device-name-input");
    const bucketInput = document.getElementById("cfg-bucket-input");
    const regionInput = document.getElementById("cfg-region-input");
    const endpointInput = document.getElementById("cfg-endpoint-input");
    const hubInput = document.getElementById("cfg-hub-input");
    if (devInput && currentVaultStatus.device_name)
      devInput.value = currentVaultStatus.device_name;
    if (bucketInput && currentVaultStatus.bucket)
      bucketInput.value = currentVaultStatus.bucket;
    if (regionInput && currentVaultStatus.region)
      regionInput.value = currentVaultStatus.region;
    if (endpointInput)
      endpointInput.value = currentVaultStatus.endpoint || "";
    if (hubInput && currentVaultStatus.hub_url)
      hubInput.value = currentVaultStatus.hub_url;
  }
  try {
    const patterns = await tauriInvoke("get_ignored_patterns");
    const ignoreInput = document.getElementById("cfg-ignored-patterns-input");
    if (ignoreInput && patterns)
      ignoreInput.value = patterns.join(`
`);
  } catch (_) {}
  try {
    const autostart = await tauriInvoke("is_autostart_enabled");
    const autostartToggle = document.getElementById("cfg-autostart-toggle");
    if (autostartToggle)
      autostartToggle.checked = autostart;
  } catch (_) {}
  const keystoreDesc = document.getElementById("cfg-keystore-desc");
  const migrateBtn = document.getElementById("migrate-keystore-btn");
  const warnEl = document.getElementById("keychain-prompt-warning");
  if (currentVaultStatus?.key_store?.includes("Keychain")) {
    if (keystoreDesc)
      keystoreDesc.textContent = "macOS Keychain (Interactive Authorization)";
    if (migrateBtn)
      migrateBtn.style.display = "block";
    if (warnEl)
      warnEl.style.display = "block";
  } else {
    if (keystoreDesc)
      keystoreDesc.textContent = currentVaultStatus?.key_store || "App-Protected Private Keystore (Zero Prompts)";
    if (migrateBtn)
      migrateBtn.style.display = "none";
    if (warnEl)
      warnEl.style.display = "none";
  }
}
function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal)
    modal.classList.remove("open");
}
async function handleSaveSettings() {
  const devInput = document.getElementById("cfg-device-name-input");
  const bucketInput = document.getElementById("cfg-bucket-input");
  const regionInput = document.getElementById("cfg-region-input");
  const endpointInput = document.getElementById("cfg-endpoint-input");
  const hubInput = document.getElementById("cfg-hub-input");
  const ignoreInput = document.getElementById("cfg-ignored-patterns-input");
  try {
    await tauriInvoke("update_vault_config", {
      payload: {
        device_name: devInput?.value.trim() || undefined,
        bucket: bucketInput?.value.trim() || undefined,
        region: regionInput?.value.trim() || undefined,
        endpoint: endpointInput?.value.trim() || undefined,
        hub_url: hubInput?.value.trim() || undefined
      }
    });
    if (ignoreInput) {
      const patterns = ignoreInput.value.split(`
`).map((s) => s.trim()).filter(Boolean);
      await tauriInvoke("save_ignored_patterns", { patterns });
    }
    logActivity("⚙️ Preferences updated", "Vault configuration and ignore rules saved", "system");
    await refreshVaultStatus();
    closeSettingsModal();
    showToast("Preferences saved successfully", "success");
  } catch (err) {
    showToast("Failed to save settings: " + err, "error");
  }
}
var currentWizardStep = 1;
function openSetupWizard() {
  currentWizardStep = 1;
  showWizardStep(1);
  const errBanner = document.getElementById("wizard-error-banner");
  if (errBanner) {
    errBanner.style.display = "none";
    errBanner.textContent = "";
  }
  const modal = document.getElementById("setup-wizard-modal");
  if (modal)
    modal.classList.add("open");
}
function closeSetupWizard() {
  const modal = document.getElementById("setup-wizard-modal");
  if (modal)
    modal.classList.remove("open");
}
function showWizardStep(step) {
  currentWizardStep = step;
  const s1 = document.getElementById("wizard-step-1");
  const s2 = document.getElementById("wizard-step-2");
  const s3 = document.getElementById("wizard-step-3");
  const backBtn = document.getElementById("wizard-back-btn");
  const nextBtn = document.getElementById("wizard-next-btn");
  const indicator = document.getElementById("wizard-step-indicator");
  if (s1)
    s1.style.display = step === 1 ? "block" : "none";
  if (s2)
    s2.style.display = step === 2 ? "block" : "none";
  if (s3)
    s3.style.display = step === 3 ? "block" : "none";
  if (indicator)
    indicator.textContent = `Step ${step} of 3`;
  if (backBtn) {
    backBtn.style.visibility = step === 1 ? "hidden" : "visible";
  }
  if (nextBtn) {
    if (step === 3) {
      nextBtn.textContent = "\uD83D\uDE80 Finish Setup & Hoist Sail";
    } else {
      nextBtn.textContent = "Continue →";
    }
  }
}
function setProviderPreset(preset) {
  const buttons = document.querySelectorAll(".provider-preset-btn");
  buttons.forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === preset);
  });
  const regionInput = document.getElementById("wizard-region-input");
  const endpointInput = document.getElementById("wizard-endpoint-input");
  if (preset === "aws") {
    if (regionInput)
      regionInput.value = "us-east-1";
    if (endpointInput) {
      endpointInput.value = "";
      endpointInput.placeholder = "Leave empty for standard AWS S3";
    }
  } else if (preset === "r2") {
    if (regionInput)
      regionInput.value = "auto";
    if (endpointInput) {
      endpointInput.placeholder = "https://<account-id>.r2.cloudflarestorage.com";
      if (!endpointInput.value)
        endpointInput.value = "";
    }
  } else if (preset === "wasabi") {
    if (regionInput)
      regionInput.value = "us-east-1";
    if (endpointInput) {
      endpointInput.value = "https://s3.wasabisys.com";
    }
  } else if (preset === "minio") {
    if (regionInput)
      regionInput.value = "us-east-1";
    if (endpointInput) {
      endpointInput.value = "http://localhost:8333";
    }
  }
}
function generateRandomPassphrase() {
  const words = [
    "anchor",
    "compass",
    "galleon",
    "starlight",
    "corsair",
    "treasure",
    "horizon",
    "voyage",
    "mariner",
    "kraken",
    "caravel",
    "tempest",
    "harbor",
    "island",
    "cutlass"
  ];
  const chosen = [];
  for (let i = 0;i < 4; i++) {
    const idx = Math.floor(Math.random() * words.length);
    chosen.push(words[idx]);
  }
  const phrase = chosen.join("-") + "-" + Math.floor(100 + Math.random() * 900);
  const p1 = document.getElementById("wizard-passphrase-input");
  const p2 = document.getElementById("wizard-confirm-passphrase-input");
  if (p1)
    p1.value = phrase;
  if (p2)
    p2.value = phrase;
  showToast("\uD83C\uDFB2 Random recovery passphrase generated! Save this securely.", "success");
  return phrase;
}
async function handleSetupWizardSubmit() {
  const errBanner = document.getElementById("wizard-error-banner");
  const showError = (msg) => {
    if (errBanner) {
      errBanner.textContent = msg;
      errBanner.style.display = "block";
    } else {
      showToast(msg, "error");
    }
  };
  if (errBanner)
    errBanner.style.display = "none";
  const folder = document.getElementById("wizard-folder-input")?.value.trim() || "~/RenegadeBox";
  const deviceName = document.getElementById("wizard-device-name-input")?.value.trim();
  const bucket = document.getElementById("wizard-bucket-input")?.value.trim();
  const region = document.getElementById("wizard-region-input")?.value.trim() || "us-east-1";
  const endpoint = document.getElementById("wizard-endpoint-input")?.value.trim() || undefined;
  const accessKeyId = document.getElementById("wizard-access-key-input")?.value.trim();
  const secretKey = document.getElementById("wizard-secret-key-input")?.value.trim();
  const passphrase = document.getElementById("wizard-passphrase-input")?.value;
  const confirmPass = document.getElementById("wizard-confirm-passphrase-input")?.value;
  if (currentWizardStep === 1) {
    if (!folder)
      return showError("Please specify a sync folder location.");
    showWizardStep(2);
    return;
  }
  if (currentWizardStep === 2) {
    if (!bucket)
      return showError("Please enter an S3 bucket name.");
    if (!accessKeyId)
      return showError("Please enter your S3 Access Key ID.");
    if (!secretKey)
      return showError("Please enter your S3 Secret Access Key.");
    showWizardStep(3);
    return;
  }
  if (currentWizardStep === 3) {
    if (!passphrase || passphrase.length < 6) {
      return showError("Passphrase must be at least 6 characters long.");
    }
    if (passphrase !== confirmPass) {
      return showError("Passphrases do not match. Please re-enter.");
    }
    const nextBtn = document.getElementById("wizard-next-btn");
    const oldBtnText = nextBtn?.textContent;
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = "Setting up vault...";
    }
    try {
      const res = await tauriInvoke("setup_vault", {
        payload: {
          folder,
          bucket,
          region,
          endpoint,
          access_key_id: accessKeyId,
          secret_access_key: secretKey,
          passphrase,
          device_name: deviceName,
          hub_url: undefined
        }
      });
      currentVaultStatus = res;
      closeSetupWizard();
      showToast("\uD83C\uDF89 Encrypted vault setup complete! Zero-knowledge sync is active.", "success");
      logActivity("\uD83C\uDFF4‍☠️ Vault Initialized", `Syncing ${folder} <-> s3://${bucket}`, "system");
      await refreshVaultStatus();
      await refreshFilesList();
    } catch (err) {
      showError(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.textContent = oldBtnText || "Continue →";
      }
    }
  }
}
var contextMenuTargetFile = null;
function showContextMenu(x, y, file) {
  contextMenuTargetFile = file;
  const menu = document.getElementById("context-menu");
  if (!menu)
    return;
  const starLabel = document.getElementById("ctx-star-label");
  if (starLabel) {
    starLabel.textContent = starredPaths.has(file.path) ? "★ Unstar" : "⭐ Star";
  }
  const ctxConflict = document.getElementById("ctx-conflict");
  if (ctxConflict) {
    ctxConflict.style.display = file.status === "conflicted" ? "flex" : "none";
  }
  menu.style.left = `${Math.min(window.innerWidth - 220, x)}px`;
  menu.style.top = `${Math.min(window.innerHeight - 300, y)}px`;
  menu.style.display = "block";
}
function hideContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu)
    menu.style.display = "none";
  contextMenuTargetFile = null;
}
async function initDesktopApp() {
  console.log("[RenegadeBox] Initializing complete desktop UI...");
  loadStarred();
  document.getElementById("sync-now-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    handleSyncNow();
  });
  document.getElementById("pause-sync-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    handleTogglePause();
  });
  document.getElementById("open-folder-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await tauriInvoke("open_sync_folder");
    } catch (err) {
      console.error("Open folder error:", err);
    }
  });
  document.getElementById("upload-files-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const imported = await tauriInvoke("pick_and_import_files");
      if (imported && imported.length > 0) {
        logActivity(`⚔️ Imported ${imported.length} file(s)`, imported.join(", "), "upload");
        await refreshFilesList();
        await refreshVaultStatus();
      }
    } catch (err) {
      console.error("Upload error:", err);
    }
  });
  document.getElementById("dropzone-box")?.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      const imported = await tauriInvoke("pick_and_import_files");
      if (imported && imported.length > 0) {
        logActivity(`⚔️ Stashed ${imported.length} file(s)`, imported.join(", "), "upload");
        await refreshFilesList();
        await refreshVaultStatus();
      }
    } catch (err) {
      console.error("Dropzone upload error:", err);
    }
  });
  document.getElementById("new-folder-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const name = prompt("Enter new folder name (e.g. Loot, Documents):");
    if (name && name.trim()) {
      const folderPath = currentDirectory ? `${currentDirectory}/${name.trim()}` : name.trim();
      try {
        await tauriInvoke("create_folder", { relativePath: folderPath });
        logActivity(`\uD83D\uDCC1 Created folder`, folderPath, "system");
        await refreshFilesList();
      } catch (err) {
        alert("Could not create folder: " + err);
      }
    }
  });
  document.getElementById("inspector-open-file-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      tauriInvoke("open_file", { path: selectedFile.path });
  });
  document.getElementById("inspector-open-external")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      tauriInvoke("open_file", { path: selectedFile.path });
  });
  document.getElementById("inspector-reveal-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      tauriInvoke("reveal_in_finder", { path: selectedFile.path });
  });
  document.getElementById("action-reveal-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      tauriInvoke("reveal_in_finder", { path: selectedFile.path });
  });
  document.getElementById("inspector-rename-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      handleRenameFile(selectedFile);
  });
  document.getElementById("inspector-delete-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      handleDeleteFile(selectedFile);
  });
  document.getElementById("inspector-star-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      toggleStar(selectedFile.path);
  });
  document.getElementById("inspector-export-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      handleExportCopy(selectedFile);
  });
  document.getElementById("inspector-conflict-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      openConflictModal(selectedFile);
  });
  document.getElementById("action-history-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (selectedFile)
      openHistoryModal(selectedFile);
  });
  document.getElementById("action-link-btn")?.addEventListener("click", () => {
    if (selectedFile) {
      navigator.clipboard?.writeText(selectedFile.path);
      logActivity("Copied path", selectedFile.path, "system");
    }
  });
  document.getElementById("action-copy-blob-btn")?.addEventListener("click", () => {
    if (selectedFile?.blob_id) {
      navigator.clipboard?.writeText(selectedFile.blob_id);
      logActivity("Copied S3 Blob ID", selectedFile.blob_id, "system");
    }
  });
  const setupSortHeader = (id, key) => {
    document.getElementById(id)?.addEventListener("click", () => {
      if (currentSortKey === key) {
        currentSortAsc = !currentSortAsc;
      } else {
        currentSortKey = key;
        currentSortAsc = true;
      }
      ["name", "type", "size", "status"].forEach((k) => {
        const icon = document.getElementById(`sort-${k}-icon`);
        if (icon) {
          icon.textContent = k === currentSortKey ? currentSortAsc ? "▲" : "▼" : "";
        }
      });
      renderActiveViews();
    });
  };
  setupSortHeader("th-name", "name");
  setupSortHeader("th-type", "type");
  setupSortHeader("th-size", "size");
  setupSortHeader("th-status", "status");
  document.getElementById("view-list-btn")?.addEventListener("click", () => {
    currentViewMode = "list";
    document.getElementById("view-list-btn")?.classList.add("active");
    document.getElementById("view-grid-btn")?.classList.remove("active");
    renderActiveViews();
  });
  document.getElementById("view-grid-btn")?.addEventListener("click", () => {
    currentViewMode = "grid";
    document.getElementById("view-grid-btn")?.classList.add("active");
    document.getElementById("view-list-btn")?.classList.remove("active");
    renderActiveViews();
  });
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".filter-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = chip.getAttribute("data-filter") || "all";
      renderActiveViews();
    });
  });
  document.getElementById("nav-all-files")?.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("nav-all-files")?.classList.add("active");
    activeNav = "files";
    currentDirectory = "";
    const title = document.getElementById("view-title");
    if (title)
      title.textContent = "RenegadeBox";
    renderActiveViews();
  });
  document.getElementById("nav-starred")?.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("nav-starred")?.classList.add("active");
    activeNav = "starred";
    const title = document.getElementById("view-title");
    if (title)
      title.textContent = "Starred Files";
    renderActiveViews();
  });
  document.getElementById("nav-activity")?.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("nav-activity")?.classList.add("active");
    activeNav = "activity";
    renderActiveViews();
  });
  document.getElementById("nav-settings")?.addEventListener("click", openSettingsModal);
  document.getElementById("user-profile-btn")?.addEventListener("click", openSettingsModal);
  document.getElementById("footer-feedback-link")?.addEventListener("click", (e) => {
    e.preventDefault();
    openSettingsModal();
  });
  document.getElementById("nav-back-btn")?.addEventListener("click", () => {
    if (navHistoryIndex > 0) {
      navHistoryIndex -= 1;
      currentDirectory = navHistory[navHistoryIndex];
      renderActiveViews();
    }
  });
  document.getElementById("nav-forward-btn")?.addEventListener("click", () => {
    if (navHistoryIndex < navHistory.length - 1) {
      navHistoryIndex += 1;
      currentDirectory = navHistory[navHistoryIndex];
      renderActiveViews();
    }
  });
  document.getElementById("close-conflict-modal-btn")?.addEventListener("click", closeConflictModal);
  document.getElementById("cancel-conflict-btn")?.addEventListener("click", closeConflictModal);
  document.getElementById("resolve-keep-local-btn")?.addEventListener("click", () => resolveConflict("keep_local"));
  document.getElementById("resolve-keep-conflicted-btn")?.addEventListener("click", () => resolveConflict("keep_conflicted"));
  document.getElementById("resolve-keep-both-btn")?.addEventListener("click", () => resolveConflict("keep_both"));
  document.getElementById("close-history-modal-btn")?.addEventListener("click", closeHistoryModal);
  document.getElementById("done-history-modal-btn")?.addEventListener("click", closeHistoryModal);
  document.getElementById("close-modal-btn")?.addEventListener("click", closeSettingsModal);
  document.getElementById("modal-done-btn")?.addEventListener("click", closeSettingsModal);
  document.getElementById("save-settings-btn")?.addEventListener("click", handleSaveSettings);
  document.getElementById("modal-dashboard-btn")?.addEventListener("click", () => tauriInvoke("open_dashboard"));
  document.getElementById("cfg-autostart-toggle")?.addEventListener("change", async (e) => {
    const target = e.target;
    try {
      await tauriInvoke("set_autostart_enabled", { enabled: target.checked });
      showToast(target.checked ? "\uD83D\uDE80 RenegadeBox will start automatically on login." : "Disabled start at login.", "info");
    } catch (_) {
      showToast("Failed to update startup preferences", "error");
    }
  });
  document.getElementById("add-finder-btn")?.addEventListener("click", async () => {
    try {
      await tauriInvoke("add_to_finder_favorites");
      showToast("\uD83D\uDCC2 Opened sync folder in Finder.", "success");
    } catch (_) {
      showToast("Opened sync folder in Finder", "info");
    }
  });
  document.getElementById("migrate-keystore-btn")?.addEventListener("click", async () => {
    try {
      const ok = await tauriInvoke("migrate_to_silent_keystore");
      if (ok) {
        showToast("⚡ Successfully switched to Silent Private Keystore! Zero prompts on launch.", "success");
        await refreshVaultStatus();
        openSettingsModal();
      } else {
        showToast("Already using silent keystore.", "info");
      }
    } catch (err) {
      showToast(`Migration error: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  });
  document.getElementById("open-setup-wizard-btn")?.addEventListener("click", () => {
    closeSettingsModal();
    openSetupWizard();
  });
  document.getElementById("wizard-cancel-btn")?.addEventListener("click", closeSetupWizard);
  document.getElementById("wizard-back-btn")?.addEventListener("click", () => {
    if (currentWizardStep > 1)
      showWizardStep(currentWizardStep - 1);
  });
  document.getElementById("wizard-next-btn")?.addEventListener("click", handleSetupWizardSubmit);
  document.getElementById("wizard-generate-pass-btn")?.addEventListener("click", generateRandomPassphrase);
  document.querySelectorAll(".provider-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset)
        setProviderPreset(preset);
    });
  });
  document.getElementById("ctx-open")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      tauriInvoke("open_file", { path: contextMenuTargetFile.path });
    hideContextMenu();
  });
  document.getElementById("ctx-reveal")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      tauriInvoke("reveal_in_finder", { path: contextMenuTargetFile.path });
    hideContextMenu();
  });
  document.getElementById("ctx-rename")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      handleRenameFile(contextMenuTargetFile);
    hideContextMenu();
  });
  document.getElementById("ctx-star")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      toggleStar(contextMenuTargetFile.path);
    hideContextMenu();
  });
  document.getElementById("ctx-history")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      openHistoryModal(contextMenuTargetFile);
    hideContextMenu();
  });
  document.getElementById("ctx-conflict")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      openConflictModal(contextMenuTargetFile);
    hideContextMenu();
  });
  document.getElementById("ctx-export")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      handleExportCopy(contextMenuTargetFile);
    hideContextMenu();
  });
  document.getElementById("ctx-copy-path")?.addEventListener("click", () => {
    if (contextMenuTargetFile) {
      navigator.clipboard?.writeText(contextMenuTargetFile.path);
      logActivity("Copied path", contextMenuTargetFile.path, "system");
    }
    hideContextMenu();
  });
  document.getElementById("ctx-copy-blob")?.addEventListener("click", () => {
    if (contextMenuTargetFile?.blob_id) {
      navigator.clipboard?.writeText(contextMenuTargetFile.blob_id);
      logActivity("Copied blob ID", contextMenuTargetFile.blob_id, "system");
    }
    hideContextMenu();
  });
  document.getElementById("ctx-delete")?.addEventListener("click", () => {
    if (contextMenuTargetFile)
      handleDeleteFile(contextMenuTargetFile);
    hideContextMenu();
  });
  window.addEventListener("click", (e) => {
    const target = e.target;
    if (!target.closest("#context-menu"))
      hideContextMenu();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideContextMenu();
      closeSettingsModal();
      closeConflictModal();
      closeHistoryModal();
    }
  });
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      renderActiveViews();
    });
  }
  await refreshVaultStatus();
  if (currentVaultStatus && !currentVaultStatus.initialized) {
    openSetupWizard();
  }
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
      logActivity("⚔️ Hoisting booty to S3...", "Sync cycle started: encrypting and uploading", "upload");
      const activityTitle = document.getElementById("activity-title");
      const activityTime = document.getElementById("activity-time");
      if (activityTitle)
        activityTitle.textContent = "⚔️ Hoisting booty to S3...";
      if (activityTime)
        activityTime.textContent = "Encrypting & synchronizing with S3 pirate vault";
    });
    await listen2("sync-finished", async (event) => {
      logActivity(event.payload.success ? "⚓ Booty stashed & synced" : "⚠️ Storm warning", event.payload.message, event.payload.success ? "system" : "conflict");
      await refreshVaultStatus();
      await refreshFilesList();
    });
    await listen2("sync-paused", () => {
      updatePauseUI(true);
      logActivity("⏸ Sync paused", "Background automatic synchronization suspended", "system");
    });
    await listen2("sync-resumed", () => {
      updatePauseUI(false);
      logActivity("▶ Sync resumed", "Background file watcher and automatic S3 sync enabled", "system");
    });
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
  toggleStar,
  tauriInvoke,
  showWizardStep,
  showContextMenu,
  setProviderPreset,
  selectFile,
  resolveConflict,
  renderFileTable,
  renderFileGrid,
  renderBreadcrumbs,
  renderActivityFeed,
  renderActiveViews,
  refreshVaultStatus,
  refreshFilesList,
  openSetupWizard,
  openSettingsModal,
  openHistoryModal,
  openConflictModal,
  logActivity,
  initDesktopApp,
  hideContextMenu,
  handleTogglePause,
  handleSyncNow,
  handleSetupWizardSubmit,
  handleSaveSettings,
  handleRenameFile,
  handleExportCopy,
  handleDeleteFile,
  getFilteredAndSortedFiles,
  generateRandomPassphrase,
  formatBytes,
  escapeHtml,
  enterDirectory,
  closeSetupWizard,
  closeSettingsModal,
  closeHistoryModal,
  closeConflictModal
};
