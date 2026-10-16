(() => {
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

  // src/lib/ipc.ts
  init_core();
  function hasTauri() {
    return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
  }
  var MOCK_SCENARIOS = ["ok", "syncing", "paused", "conflicts", "error", "setup"];
  function mockScenarioFromUrl() {
    if (typeof location === "undefined")
      return "ok";
    const s = new URLSearchParams(location.search).get("state");
    return s && MOCK_SCENARIOS.includes(s) ? s : "ok";
  }
  async function invoke2(cmd, args) {
    if (hasTauri())
      return invoke(cmd, args);
    return mockInvoke(cmd, args, mockScenarioFromUrl());
  }
  var MIN = 60000;
  var HOUR = 60 * MIN;
  var DAY = 24 * HOUR;
  function sampleRecent(now) {
    const f = (path, ago) => {
      const i = path.lastIndexOf("/");
      return { path, name: i < 0 ? path : path.slice(i + 1), folder: i < 0 ? "" : path.slice(0, i), modified_ms: now - ago };
    };
    return [
      f("Work/Q3 budget.xlsx", 2 * MIN),
      f("Work/Client proposal - Hartley.docx", 14 * MIN),
      f("Home/Kitchen remodel quote.pdf", 52 * MIN),
      f("Photos/2026/IMG_2041.jpeg", 3 * HOUR),
      f("Photos/2026/IMG_2040.jpeg", 3 * HOUR + 2 * MIN),
      f("Notes.txt", 5 * HOUR),
      f("Home/Insurance/Policy renewal 2026.pdf", 26 * HOUR),
      f("Work/Invoices/Invoice 1042.pdf", 2 * DAY),
      f("Shabbat menu.docx", 4 * DAY),
      f("Taxes/2025 return.pdf", 12 * DAY)
    ];
  }
  var SAMPLE_CONFLICTS = (now) => [
    {
      path: "Work/Q3 budget (conflicted copy from My-iMac 2026-10-15 9f3a12bc).xlsx",
      original_name: "Q3 budget.xlsx",
      folder: "Work",
      device: "My-iMac",
      modified_ms: now - 6 * MIN
    },
    {
      path: "Notes (conflicted copy from My-iMac 2026-10-15 47de0a91).txt",
      original_name: "Notes.txt",
      folder: "",
      device: "My-iMac",
      modified_ms: now - 40 * MIN
    }
  ];
  var mockPaused = null;
  var mockKeyStore = "System keychain";
  var mockAutostart = true;
  async function mockInvoke(cmd, args, scenario) {
    const now = Date.now();
    const initialized = scenario !== "setup";
    const out = (() => {
      switch (cmd) {
        case "get_sync_overview": {
          const paused = mockPaused ?? scenario === "paused";
          const o = {
            initialized,
            paused,
            syncing: scenario === "syncing",
            pending: scenario === "syncing" ? 3 : scenario === "paused" ? 2 : 0,
            conflicts: scenario === "conflicts" ? 2 : 0,
            error: scenario === "error" ? "LIST rb/journal/: dispatch failure: io error: Connection refused" : null
          };
          return o;
        }
        case "get_vault_status": {
          const s = {
            initialized,
            folder: initialized ? "/Users/me/RenegadeBox" : null,
            bucket: initialized ? "my-files" : null,
            region: initialized ? "us-east-1" : null,
            endpoint: initialized ? "https://s3.wasabisys.com" : null,
            device_id: initialized ? "68a3c8a0-c930-4984-bc66-079164e213f6" : null,
            device_name: initialized ? "My-MacBook-Pro" : null,
            hub_url: null,
            key_store: initialized ? mockKeyStore : null,
            total_files: 214,
            pending_changes: 0,
            total_bytes: 1843200000
          };
          return s;
        }
        case "list_recent_files":
          return initialized ? sampleRecent(now).slice(0, Number(args?.limit ?? 10)) : [];
        case "list_conflicts":
          return scenario === "conflicts" ? SAMPLE_CONFLICTS(now) : [];
        case "pause_sync":
          mockPaused = true;
          return true;
        case "resume_sync":
          mockPaused = false;
          return false;
        case "is_sync_paused":
          return mockPaused ?? scenario === "paused";
        case "is_autostart_enabled":
          return mockAutostart;
        case "set_autostart_enabled":
          mockAutostart = Boolean(args?.enabled);
          return mockAutostart;
        case "set_key_store":
          mockKeyStore = args?.useKeychain ? "System keychain" : "Unprotected file (readable by any app running as you)";
          return args?.useKeychain ? "System keychain" : "Unprotected file";
        case "get_ignored_patterns":
          return [".DS_Store", "Thumbs.db", "*.tmp", ".git/", "node_modules/"];
        case "add_to_finder_favorites":
          return "Opened folder in Finder";
        case "setup_vault":
          return new Promise((resolve) => setTimeout(() => resolve({ initialized: true }), 900));
        default:
          console.info(`[preview] ${cmd}`, args ?? "");
          return null;
      }
    })();
    return await out;
  }

  // src/lib/format.ts
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function relativeTime(ms, now = Date.now()) {
    const diff = Math.max(0, now - ms);
    const min = Math.floor(diff / 60000);
    if (min < 1)
      return "Just now";
    if (min < 60)
      return `${min} min ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24)
      return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days === 1)
      return "Yesterday";
    if (days < 7)
      return `${days} days ago`;
    const d = new Date(ms);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  }
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0)
      return "0 B";
    if (bytes < 1024)
      return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024)
      return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024)
      return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  }

  // src/lib/icons.ts
  var svg = (body, size = 16) => `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  var icons = {
    box: (s) => svg('<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9"/><path d="M10 13h4"/>', s),
    check: (s) => svg('<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>', s),
    sync: (s) => svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>', s),
    pause: (s) => svg('<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>', s),
    play: (s) => svg('<path d="M7 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L8.5 4.64A1 1 0 0 0 7 5.5z"/>', s),
    alert: (s) => svg('<path d="M12 3.5 2.8 19.5a1 1 0 0 0 .87 1.5h16.66a1 1 0 0 0 .87-1.5L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>', s),
    offline: (s) => svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>', s),
    folder: (s) => svg('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.3l2 2h8.7A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/>', s),
    gear: (s) => svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', s),
    file: (s) => svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>', s),
    image: (s) => svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5-8.5 8"/>', s),
    doc: (s) => svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 16.5h6"/>', s),
    sheet: (s) => svg('<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 9.5h16M4 15h16M10 9.5v11"/>', s),
    reveal: (s) => svg('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.35-4.35"/>', s),
    back: (s) => svg('<path d="m15 18-6-6 6-6"/>', s),
    chevron: (s) => svg('<path d="m9 18 6-6-6-6"/>', s),
    lock: (s) => svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', s),
    external: (s) => svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', s)
  };
  function fileIcon(name) {
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (["jpg", "jpeg", "png", "gif", "heic", "webp", "tiff", "svg"].includes(ext))
      return icons.image(18);
    if (["xls", "xlsx", "csv", "numbers"].includes(ext))
      return icons.sheet(18);
    if (["doc", "docx", "pdf", "txt", "md", "pages", "rtf"].includes(ext))
      return icons.doc(18);
    return icons.file(18);
  }

  // src/lib/status.ts
  function describeStatus(o) {
    if (!o.initialized) {
      return { kind: "setup", title: "Not set up yet", detail: "Connect your storage to start syncing." };
    }
    if (o.conflicts > 0) {
      const title = o.conflicts === 1 ? "1 file needs your attention" : `${o.conflicts} files need your attention`;
      return { kind: "attention", title, detail: "Two versions were saved at the same time." };
    }
    if (o.paused) {
      return {
        kind: "paused",
        title: "Paused",
        detail: o.pending > 0 ? `${plural(o.pending, "change", "changes")} will sync when you resume.` : "Changes will sync when you resume."
      };
    }
    if (o.error) {
      return { kind: "error", title: friendlyError(o.error), detail: "RenegadeBox will keep trying." };
    }
    if (o.syncing || o.pending > 0) {
      const title = o.pending > 0 ? `Syncing ${plural(o.pending, "file", "files")}…` : "Syncing…";
      return { kind: "syncing", title, detail: null };
    }
    return { kind: "ok", title: "Up to date", detail: "Your files are safely synced." };
  }
  var SYNC_FALLBACK = "Something went wrong while syncing. RenegadeBox will keep trying.";
  function friendlyError(raw, fallback = SYNC_FALLBACK) {
    const e = raw.toLowerCase();
    if (e.includes("wrong passphrase")) {
      return "That passphrase doesn't match the one this storage was set up with.";
    }
    if (e.includes("changed since this device was set up")) {
      return "Your storage's passphrase settings changed. If you didn't change your passphrase, choose Reconnect in Settings.";
    }
    if (/invalidaccesskeyid|signaturedoesnotmatch|accessdenied|forbidden|\b403\b/.test(e)) {
      return "Your storage provider didn't accept your access keys. Check them with Reconnect in Settings.";
    }
    if (e.includes("nosuchbucket")) {
      return "Couldn't find that bucket. Check the bucket name with your storage provider.";
    }
    if (e.includes("keychain")) {
      return "RenegadeBox couldn't read its keys from the system keychain. Choose Reconnect in Settings.";
    }
    if (e.includes("sync folder") && e.includes("missing")) {
      return "Your RenegadeBox folder is missing. Is it on a drive that isn't plugged in?";
    }
    if (/dispatch|connect|timed out|timeout|dns|network|unreachable|io error|broken pipe/.test(e)) {
      return "Can't reach your storage — check your internet connection";
    }
    return fallback;
  }

  // src/lib/actions.ts
  function keyStoreKind(label) {
    return label && label.toLowerCase().startsWith("unprotected") ? "file" : "keychain";
  }
  function changeKeyStore(invoke3, useKeychain) {
    return invoke3("set_key_store", { useKeychain });
  }
  function resolveConflict(invoke3, item, resolution) {
    return invoke3("resolve_conflict", { path: item.path, resolution });
  }

  // src/lib/setup.ts
  var PROVIDERS = [
    { id: "aws", label: "Amazon S3", region: "us-east-1", endpoint: "", endpointHint: "Leave this empty for Amazon S3." },
    {
      id: "r2",
      label: "Cloudflare R2",
      region: "auto",
      endpoint: "https://ACCOUNT_ID.r2.cloudflarestorage.com",
      endpointHint: "Replace ACCOUNT_ID with the ID shown on your Cloudflare R2 page."
    },
    { id: "wasabi", label: "Wasabi", region: "us-east-1", endpoint: "https://s3.wasabisys.com", endpointHint: "Use the address for your Wasabi region." },
    {
      id: "b2",
      label: "Backblaze B2",
      region: "us-west-004",
      endpoint: "https://s3.us-west-004.backblazeb2.com",
      endpointHint: "Shown as the S3 endpoint on your Backblaze bucket page."
    },
    {
      id: "local",
      label: "Local test server",
      region: "us-east-1",
      endpoint: "http://localhost:8333",
      endpointHint: "The test server that runs on this Mac."
    }
  ];
  function providerLabel(endpoint) {
    const ep = (endpoint ?? "").trim().toLowerCase();
    if (!ep)
      return "Amazon S3";
    if (ep.includes("localhost") || ep.includes("127.0.0.1"))
      return "Local test server";
    if (ep.includes("r2.cloudflarestorage.com"))
      return "Cloudflare R2";
    if (ep.includes("wasabisys.com"))
      return "Wasabi";
    if (ep.includes("backblazeb2.com"))
      return "Backblaze B2";
    if (ep.includes("amazonaws.com"))
      return "Amazon S3";
    try {
      return new URL(ep).host;
    } catch {
      return ep;
    }
  }
  function setupErrorStep(raw) {
    const e = raw.toLowerCase();
    if (e.includes("passphrase"))
      return 3;
    if (/access key|secret|invalidaccesskeyid|signaturedoesnotmatch|accessdenied|forbidden|keychain/.test(e))
      return 2;
    if (/bucket|region|endpoint|connect|dispatch|timed out|dns|network/.test(e))
      return 1;
    return 4;
  }
  var SETUP_STEPS = 4;
  var MIN_PASSPHRASE = 12;
  function validateSetupStep(step, v) {
    switch (step) {
      case 1:
        if (!v.bucket.trim())
          return "Enter the name of your bucket.";
        if (!v.region.trim())
          return "Enter the region. If you're not sure, use us-east-1.";
        if (v.endpoint.includes("ACCOUNT_ID"))
          return "Replace ACCOUNT_ID in the server address with your Cloudflare account ID.";
        return null;
      case 2:
        if (!v.access_key_id.trim())
          return "Enter the access key ID from your storage provider.";
        if (!v.secret_access_key.trim())
          return "Enter the secret access key from your storage provider.";
        return null;
      case 3:
        if ([...v.passphrase].length < MIN_PASSPHRASE)
          return `Your passphrase needs at least ${MIN_PASSPHRASE} characters.`;
        if (v.passphrase !== v.passphrase_confirm)
          return "The two passphrases don't match.";
        return null;
      case 4:
        if (!v.folder.trim())
          return "Choose where your RenegadeBox folder should live.";
        if (v.device_name.includes("/"))
          return "The name for this Mac can't contain a slash.";
        return null;
      default:
        return null;
    }
  }

  // src/lib/views.ts
  var STATUS_ICON = {
    ok: () => icons.check(20),
    syncing: () => icons.sync(20),
    paused: () => icons.pause(20),
    attention: () => icons.alert(20),
    error: () => icons.offline(20),
    setup: () => icons.box(20)
  };
  function renderPopover({ overview, recent, now }) {
    const st = describeStatus(overview);
    const statusInner = `
      <span class="status-icon">${STATUS_ICON[st.kind]()}</span>
      <span class="status-text">
        <span class="status-title">${escapeHtml(st.title)}</span>
        ${st.detail ? `<span class="status-detail">${escapeHtml(st.detail)}</span>` : ""}
      </span>`;
    const status = st.kind === "attention" ? `<button id="status-line" class="status status-${st.kind} status-link" type="button">${statusInner}<span id="conflicts-link" class="status-chevron">${icons.chevron(16)}</span></button>` : `<div id="status-line" class="status status-${st.kind}" role="status">${statusInner}</div>`;
    let body;
    if (!overview.initialized) {
      body = `
      <div class="empty">
        <p>RenegadeBox keeps a folder on this Mac in sync with storage you own.</p>
        <button id="start-setup-btn" class="btn primary" type="button">Set up RenegadeBox…</button>
      </div>`;
    } else if (recent.length === 0) {
      body = `<div class="empty"><p>Files you add to your RenegadeBox folder will show up here.</p></div>`;
    } else {
      body = `<ul class="recent-list">${recent.map((f, i) => recentRow(f, i, now)).join("")}</ul>`;
    }
    const pauseLabel = overview.paused ? "Resume" : "Pause";
    return `
    <section class="popover">
      <header class="popover-header">
        ${status}
        <button id="header-settings-btn" class="icon-btn" type="button" title="Settings" aria-label="Settings">${icons.gear(16)}</button>
      </header>
      <div class="popover-body">
        ${overview.initialized ? `<h2 class="section-label">Recent</h2>` : ""}
        ${body}
      </div>
      <footer class="popover-footer">
        <button id="open-folder-btn" class="footer-btn" type="button"${overview.initialized ? "" : " disabled"}>${icons.folder()}<span>Open folder</span></button>
        <button id="pause-btn" class="footer-btn" type="button" aria-pressed="${overview.paused}"${overview.initialized ? "" : " disabled"}>${overview.paused ? icons.play() : icons.pause()}<span>${pauseLabel}</span></button>
        <button id="settings-btn" class="footer-btn" type="button" title="Settings" aria-label="Settings">${icons.gear(16)}<span>Settings</span></button>
      </footer>
    </section>`;
  }
  function recentRow(f, i, now) {
    const where = f.folder ? f.folder.split("/").pop() : "RenegadeBox";
    return `
    <li class="recent-row" data-index="${i}">
      <button class="recent-open" type="button" data-action="open" data-index="${i}" title="Open ${escapeHtml(f.name)}">
        <span class="file-icon">${fileIcon(f.name)}</span>
        <span class="recent-text">
          <span class="recent-name">${escapeHtml(f.name)}</span>
          <span class="recent-meta">${escapeHtml(where)} · ${escapeHtml(relativeTime(f.modified_ms, now))}</span>
        </span>
      </button>
      <button class="reveal-btn" type="button" data-action="reveal" data-index="${i}">Show in Finder</button>
    </li>`;
  }
  function renderConflictList({ conflicts, now }) {
    const rows = conflicts.map((c, i) => {
      const who = c.device ? escapeHtml(c.device) : "Another device";
      const where = c.folder ? ` in ${escapeHtml(c.folder.split("/").pop())}` : "";
      const other = c.device ? `Use ${escapeHtml(c.device)}’s version` : "Use the other version";
      return `
      <li class="conflict" data-index="${i}">
        <div class="conflict-head">
          <span class="file-icon">${fileIcon(c.original_name)}</span>
          <span class="recent-text">
            <span class="recent-name">${escapeHtml(c.original_name)}</span>
            <span class="recent-meta">${who} saved a different version${where} · ${escapeHtml(relativeTime(c.modified_ms, now))}</span>
          </span>
        </div>
        <div class="conflict-actions">
          <button class="btn primary" type="button" data-index="${i}" data-resolution="keep_both" title="Keep both files side by side">Keep both</button>
          <button class="btn" type="button" data-index="${i}" data-resolution="keep_conflicted">${other}</button>
          <button class="btn" type="button" data-index="${i}" data-resolution="keep_local">Keep current</button>
        </div>
      </li>`;
    }).join("");
    return `
    <section class="popover">
      <header class="popover-header subpage">
        <button id="conflicts-back" class="icon-btn" type="button" aria-label="Back">${icons.back(18)}</button>
        <h1 class="subpage-title">Needs your attention</h1>
      </header>
      <div class="popover-body">
        <p class="explain">These files were changed in two places at once. RenegadeBox kept both versions so nothing was lost. Choose what to keep.</p>
        ${conflicts.length ? `<ul class="conflict-list">${rows}</ul>` : `<div class="empty"><p>All sorted. Nothing needs your attention.</p></div>`}
      </div>
    </section>`;
  }
  function renderPopoverSettings({ status, autostart, ignored }) {
    const kind = keyStoreKind(status.key_store);
    const folder = status.folder ?? "~/RenegadeBox";
    const totalSize = status.total_bytes ? ` · ${formatBytes(status.total_bytes)}` : "";
    const filesCount = status.total_files ? `${status.total_files} files${totalSize}` : "No files synced yet";
    return `
    <section class="popover">
      <header class="popover-header subpage">
        <button id="settings-back-btn" class="icon-btn" type="button" aria-label="Back">${icons.back(18)}</button>
        <h1 class="subpage-title">Settings</h1>
        <button id="settings-popout-btn" class="icon-btn" type="button" title="Open in separate window" aria-label="Open in separate window" style="margin-left: auto;">${icons.external(16)}</button>
      </header>
      <div class="popover-body settings-popover-body">
        <section class="group">
          <h2 class="group-title">This Mac</h2>
          <label class="field">
            <span class="field-label">Device name</span>
            <span class="field-row">
              <input id="device-name-input" type="text" value="${escapeHtml(status.device_name ?? "")}" maxlength="128" autocomplete="off" spellcheck="false" />
              <button id="device-name-save" class="btn" type="button">Save</button>
            </span>
            <span class="field-hint">Shown on your other devices when files change.</span>
            <span id="device-name-message" class="inline-message" role="status"></span>
          </label>
          <div class="kv">
            <span class="kv-label">Folder</span>
            <span class="kv-value" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:160px;" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
              <button id="settings-open-folder-btn" class="btn" style="padding:2px 8px; font-size:12px;" type="button">Open in Finder</button>
            </span>
          </div>
          <label class="switch-row">
            <span>
              <span class="field-label">Start at login</span>
              <span class="field-hint">Keep your files in sync without opening RenegadeBox.</span>
            </span>
            <input id="autostart-toggle" class="switch" type="checkbox" role="switch"${autostart ? " checked" : ""} />
          </label>
        </section>

        <section class="group">
          <h2 class="group-title">Storage</h2>
          <div class="kv"><span class="kv-label">Provider</span><span class="kv-value">${escapeHtml(providerLabel(status.endpoint))}</span></div>
          <div class="kv"><span class="kv-label">Bucket</span><span class="kv-value">${escapeHtml(status.bucket ?? "—")}</span></div>
          <div class="kv"><span class="kv-label">Region</span><span class="kv-value">${escapeHtml(status.region ?? "—")}</span></div>
          <div class="kv"><span class="kv-label">Storage used</span><span class="kv-value">${escapeHtml(filesCount)}</span></div>
          <div class="group-actions" style="margin-top:8px;">
            <button id="reconnect-btn" class="btn" type="button">Reconnect…</button>
            <span class="field-hint">Enter your storage details and passphrase again. Your files stay where they are.</span>
          </div>
        </section>

        <section class="group">
          <h2 class="group-title">Key storage</h2>
          <p class="field-hint">Where this Mac keeps the keys that unlock your files.</p>
          <label class="radio-row">
            <input type="radio" name="key-store" value="keychain"${kind === "keychain" ? " checked" : ""} />
            <span>
              <span class="field-label">System keychain (recommended)</span>
              <span class="field-hint">Protected by macOS. Other apps can't read it without asking.</span>
            </span>
          </label>
          <label class="radio-row">
            <input type="radio" name="key-store" value="file"${kind === "file" ? " checked" : ""} />
            <span>
              <span class="field-label">Unprotected file</span>
              <span class="field-hint warn">Not recommended — any app running as you can read it.</span>
            </span>
          </label>
          <div id="key-store-confirm" class="confirm" hidden>
            <p>Store your keys in an unprotected file? Any app running as you can read it — and anyone who can read it can open your files.</p>
            <div class="confirm-actions">
              <button id="key-store-cancel" class="btn" type="button">Cancel</button>
              <button id="key-store-confirm-btn" class="btn danger" type="button">Use unprotected file</button>
            </div>
          </div>
          <p id="key-store-message" class="inline-message" role="status"></p>
        </section>

        <section class="group">
          <h2 class="group-title">Ignored files</h2>
          <p class="field-hint">Files and folders matching these names are never synced. One per line.</p>
          <textarea id="ignored-input" rows="4" spellcheck="false">${escapeHtml(ignored.join(`
`))}</textarea>
          <div class="group-actions">
            <button id="ignored-save" class="btn" type="button">Save</button>
            <span id="ignored-message" class="inline-message" role="status"></span>
          </div>
        </section>

        <div style="padding:12px 0 8px; text-align:center;">
          <button id="quit-btn" class="btn" type="button" style="width:100%;">Quit RenegadeBox</button>
        </div>
      </div>
    </section>`;
  }
  function renderSettings({ status, autostart, ignored }) {
    const kind = keyStoreKind(status.key_store);
    const row = (label, value) => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-value">${value}</span></div>`;
    const folder = status.folder ?? "Not set up";
    const totalSize = status.total_bytes ? ` · ${formatBytes(status.total_bytes)}` : "";
    const filesCount = status.total_files ? `${status.total_files} files${totalSize}` : "No files synced yet";
    return `
    <main class="settings">
      <header class="settings-window-header">
        <h1 class="window-title">Settings</h1>
        <nav class="settings-tabs" role="tablist">
          <button class="tab-btn active" data-tab="general" role="tab" type="button">${icons.gear(16)}<span>General</span></button>
          <button class="tab-btn" data-tab="storage" role="tab" type="button">${icons.box(16)}<span>Storage</span></button>
          <button class="tab-btn" data-tab="security" role="tab" type="button">${icons.lock(16)}<span>Security</span></button>
          <button class="tab-btn" data-tab="ignored" role="tab" type="button">${icons.doc(16)}<span>Ignored</span></button>
        </nav>
      </header>

      <div id="tab-panel-general" class="tab-panel active" data-panel="general">
        <section class="group">
          <h2 class="group-title">This Mac</h2>
          <label class="field">
            <span class="field-label">Device name</span>
            <span class="field-row">
              <input id="device-name-input" type="text" value="${escapeHtml(status.device_name ?? "")}" maxlength="128" autocomplete="off" spellcheck="false" />
              <button id="device-name-save" class="btn" type="button">Save</button>
            </span>
            <span class="field-hint">Shown on your other devices when files change.</span>
            <span id="device-name-message" class="inline-message" role="status"></span>
          </label>
          <div class="kv">
            <span class="kv-label">Folder</span>
            <span class="kv-value" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span>${escapeHtml(folder)}</span>
              <span style="display:inline-flex; gap:6px;">
                <button id="settings-open-folder-btn" class="btn" style="padding:3px 8px; font-size:12px;" type="button">Open in Finder</button>
                <button id="add-finder-btn" class="btn" style="padding:3px 8px; font-size:12px;" type="button">Add to Sidebar</button>
              </span>
            </span>
          </div>
          <label class="switch-row">
            <span>
              <span class="field-label">Start at login</span>
              <span class="field-hint">Keep your files in sync without opening RenegadeBox.</span>
            </span>
            <input id="autostart-toggle" class="switch" type="checkbox" role="switch"${autostart ? " checked" : ""} />
          </label>
        </section>
      </div>

      <div id="tab-panel-storage" class="tab-panel" data-panel="storage">
        <section class="group">
          <h2 class="group-title">Storage</h2>
          ${row("Provider", escapeHtml(providerLabel(status.endpoint)))}
          ${row("Bucket", escapeHtml(status.bucket ?? "—"))}
          ${row("Region", escapeHtml(status.region ?? "—"))}
          ${row("Storage used", escapeHtml(filesCount))}
          <div class="group-actions" style="margin-top:12px;">
            <button id="reconnect-btn" class="btn" type="button">Reconnect…</button>
            <span class="field-hint">Enter your storage details and passphrase again. Your files stay where they are.</span>
          </div>
        </section>
      </div>

      <div id="tab-panel-security" class="tab-panel" data-panel="security">
        <section class="group">
          <h2 class="group-title">Key storage</h2>
          <p class="field-hint">Where this Mac keeps the keys that unlock your files.</p>
          <label class="radio-row">
            <input type="radio" name="key-store" value="keychain"${kind === "keychain" ? " checked" : ""} />
            <span>
              <span class="field-label">System keychain (recommended)</span>
              <span class="field-hint">Protected by macOS. Other apps can't read it without asking.</span>
            </span>
          </label>
          <label class="radio-row">
            <input type="radio" name="key-store" value="file"${kind === "file" ? " checked" : ""} />
            <span>
              <span class="field-label">Unprotected file</span>
              <span class="field-hint warn">Not recommended — any app running as you can read it.</span>
            </span>
          </label>
          <div id="key-store-confirm" class="confirm" hidden>
            <p>Store your keys in an unprotected file? Any app running as you can read it — and anyone who can read it can open your files.</p>
            <div class="confirm-actions">
              <button id="key-store-cancel" class="btn" type="button">Cancel</button>
              <button id="key-store-confirm-btn" class="btn danger" type="button">Use unprotected file</button>
            </div>
          </div>
          <p id="key-store-message" class="inline-message" role="status"></p>
        </section>
      </div>

      <div id="tab-panel-ignored" class="tab-panel" data-panel="ignored">
        <section class="group">
          <h2 class="group-title">Ignored files</h2>
          <p class="field-hint">Files and folders matching these names are never synced. One per line.</p>
          <textarea id="ignored-input" rows="6" spellcheck="false">${escapeHtml(ignored.join(`
`))}</textarea>
          <div class="group-actions">
            <button id="ignored-save" class="btn" type="button">Save</button>
            <span id="ignored-message" class="inline-message" role="status"></span>
          </div>
        </section>
      </div>

      <footer class="settings-footer">
        <button id="quit-btn" class="btn" type="button">Quit RenegadeBox</button>
      </footer>
    </main>`;
  }
  function renderSetup() {
    const presets = PROVIDERS.map((p) => `<button class="preset" type="button" data-provider="${p.id}" aria-pressed="false">${escapeHtml(p.label)}</button>`).join("");
    return `
    <main class="setup">
      <header class="setup-header">
        <span class="setup-logo">${icons.box(28)}</span>
        <div>
          <h1 class="window-title">Set up RenegadeBox</h1>
          <p class="field-hint">Your files are encrypted on this Mac before they leave it.</p>
        </div>
      </header>
      <ol class="steps" aria-label="Setup progress">
        <li data-step-dot="1">Storage</li><li data-step-dot="2">Keys</li><li data-step-dot="3">Passphrase</li><li data-step-dot="4">Folder</li>
      </ol>

      <form id="setup-form" novalidate>
        <section class="step" data-step="1">
          <h2 class="step-title">Where should your files be stored?</h2>
          <p class="field-hint">Pick the company you rent storage from. You'll find these details in their dashboard.</p>
          <div class="presets">${presets}</div>
          <label class="field"><span class="field-label">Bucket name</span>
            <input id="setup-bucket" name="bucket" type="text" placeholder="my-files" autocomplete="off" spellcheck="false" />
            <span class="field-hint">The storage container you created for RenegadeBox.</span></label>
          <label class="field"><span class="field-label">Region</span>
            <input id="setup-region" name="region" type="text" autocomplete="off" spellcheck="false" /></label>
          <label class="field"><span class="field-label">Server address</span>
            <input id="setup-endpoint" name="endpoint" type="text" autocomplete="off" spellcheck="false" />
            <span id="setup-endpoint-hint" class="field-hint"></span></label>
        </section>

        <section class="step" data-step="2" hidden>
          <h2 class="step-title">Connect with your access keys</h2>
          <p class="explain">Your storage provider gives you two keys when you allow an app to use your bucket: an <strong>access key ID</strong> (like a username) and a <strong>secret access key</strong> (like a password). For the local test server, type anything, e.g. dev.</p>
          <label class="field"><span class="field-label">Access key ID</span>
            <input id="setup-access-key" name="access_key_id" type="text" autocomplete="off" spellcheck="false" /></label>
          <label class="field"><span class="field-label">Secret access key</span>
            <input id="setup-secret" name="secret_access_key" type="password" autocomplete="off" />
            <span class="field-hint">Kept in the system keychain on this Mac.</span></label>
        </section>

        <section class="step" data-step="3" hidden>
          <h2 class="step-title">Choose a passphrase</h2>
          <p class="explain">Your passphrase locks your files. Use at least ${MIN_PASSPHRASE} characters — a short sentence is easy to remember and hard to guess. If you already use RenegadeBox on another device, enter the same passphrase.</p>
          <div class="warning" role="note">
            ${icons.lock(18)}
            <p><strong>Write it down and keep it somewhere safe.</strong> It can't be recovered — not by us, not by anyone. You'll need it on every new device you set up.</p>
          </div>
          <label class="field"><span class="field-label">Passphrase</span>
            <input id="setup-passphrase" name="passphrase" type="password" autocomplete="new-password" /></label>
          <label class="field"><span class="field-label">Type it again</span>
            <input id="setup-passphrase-confirm" name="passphrase_confirm" type="password" autocomplete="new-password" /></label>
          <p id="passphrase-meter" class="field-hint"></p>
        </section>

        <section class="step" data-step="4" hidden>
          <h2 class="step-title">Almost done</h2>
          <label class="field"><span class="field-label">RenegadeBox folder</span>
            <input id="setup-folder" name="folder" type="text" value="~/RenegadeBox" autocomplete="off" spellcheck="false" />
            <span class="field-hint">Anything you put in this folder is kept in sync.</span></label>
          <label class="field"><span class="field-label">Name for this Mac (optional)</span>
            <input id="setup-device-name" name="device_name" type="text" placeholder="Uses this Mac's name" autocomplete="off" spellcheck="false" /></label>
        </section>

        <section class="step" data-step="done" hidden>
          <div class="done">
            <span class="done-icon">${icons.check(40)}</span>
            <h2 class="step-title">You're all set</h2>
            <p class="explain">RenegadeBox is syncing your folder. Look for the box icon in the menu bar any time you want to check on it.</p>
          </div>
        </section>

        <p id="setup-error" class="form-error" role="alert"></p>

        <footer class="setup-footer">
          <button id="setup-back" class="btn" type="button">Back</button>
          <button id="setup-next" class="btn primary" type="submit">Continue</button>
        </footer>
      </form>
    </main>`;
  }

  // src/main.ts
  function currentView() {
    const v = new URLSearchParams(location.search).get("view") ?? location.hash.replace("#", "");
    return v === "settings" || v === "setup" ? v : "popover";
  }
  var root = () => document.getElementById("app");
  var $ = (id) => document.getElementById(id);
  var errText = (e) => typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  async function onBackendEvents(names, handler) {
    if (!hasTauri())
      return;
    try {
      const { listen: listen2 } = await Promise.resolve().then(() => (init_event(), exports_event));
      for (const n of names)
        await listen2(n, handler);
    } catch (err) {
      console.warn("[RenegadeBox] could not subscribe to events", err);
    }
  }
  var popover = {
    overview: null,
    recent: [],
    conflicts: [],
    settingsModel: null,
    showConflicts: false,
    showSettings: false,
    busy: false
  };
  async function refreshPopover() {
    try {
      const [overview, recent] = await Promise.all([
        invoke2("get_sync_overview"),
        invoke2("list_recent_files", { limit: 10 })
      ]);
      popover.overview = overview;
      popover.recent = recent;
      popover.conflicts = overview.conflicts > 0 || popover.showConflicts ? await invoke2("list_conflicts") : [];
      if (popover.showSettings) {
        await loadPopoverSettings();
      }
    } catch (err) {
      popover.overview = { initialized: true, paused: false, syncing: false, pending: 0, conflicts: 0, error: errText(err) };
    }
    renderPopoverView();
  }
  async function loadPopoverSettings() {
    try {
      const [status, autostart, ignored] = await Promise.all([
        invoke2("get_vault_status"),
        invoke2("is_autostart_enabled").catch(() => false),
        invoke2("get_ignored_patterns").catch(() => [])
      ]);
      popover.settingsModel = { status, autostart, ignored };
    } catch (err) {
      showPopoverNotice(errText(err));
    }
  }
  function renderPopoverView() {
    if (popover.showSettings && popover.settingsModel) {
      root().innerHTML = renderPopoverSettings(popover.settingsModel);
      bindSettings(popover.settingsModel.status);
      return;
    }
    if (!popover.overview)
      return;
    root().innerHTML = popover.showConflicts ? renderConflictList({ conflicts: popover.conflicts, now: Date.now() }) : renderPopover({ overview: popover.overview, recent: popover.recent, now: Date.now() });
  }
  async function onPopoverClick(ev) {
    const target = ev.target.closest("button");
    if (!target || popover.busy)
      return;
    const index = Number(target.dataset.index);
    try {
      if (target.id === "status-line" && target.classList.contains("status-link")) {
        popover.showConflicts = true;
        popover.showSettings = false;
        await refreshPopover();
      } else if (target.id === "conflicts-back") {
        popover.showConflicts = false;
        renderPopoverView();
      } else if (target.id === "settings-btn" || target.id === "header-settings-btn") {
        popover.showSettings = true;
        popover.showConflicts = false;
        await loadPopoverSettings();
        renderPopoverView();
      } else if (target.id === "settings-back-btn") {
        popover.showSettings = false;
        renderPopoverView();
      } else if (target.id === "settings-popout-btn") {
        popover.showSettings = false;
        await invoke2("open_settings");
        renderPopoverView();
      } else if (target.id === "settings-open-folder-btn") {
        await invoke2("open_sync_folder");
      } else if (target.dataset.resolution) {
        const item = popover.conflicts[index];
        if (!item)
          return;
        popover.busy = true;
        target.closest(".conflict")?.querySelectorAll("button").forEach((b) => b.disabled = true);
        await resolveConflict(invoke2, item, target.dataset.resolution);
        popover.busy = false;
        await refreshPopover();
        if (popover.conflicts.length === 0) {
          popover.showConflicts = false;
          renderPopoverView();
        }
      } else if (target.dataset.action === "open") {
        const f = popover.recent[index];
        if (f)
          await invoke2("open_file", { path: f.path });
      } else if (target.dataset.action === "reveal") {
        const f = popover.recent[index];
        if (f)
          await invoke2("reveal_in_finder", { path: f.path });
      } else if (target.id === "open-folder-btn") {
        await invoke2("open_sync_folder");
      } else if (target.id === "pause-btn") {
        await invoke2(popover.overview?.paused ? "resume_sync" : "pause_sync");
        await refreshPopover();
      } else if (target.id === "start-setup-btn") {
        await invoke2("open_setup");
      }
    } catch (err) {
      popover.busy = false;
      showPopoverNotice(errText(err));
    }
  }
  function showPopoverNotice(raw) {
    const body = document.querySelector(".popover-body");
    if (!body)
      return;
    document.querySelector(".notice")?.remove();
    const p = document.createElement("p");
    p.className = "notice";
    p.setAttribute("role", "alert");
    p.textContent = friendlyError(raw, raw);
    body.prepend(p);
  }
  function initPopover() {
    root().addEventListener("click", (e) => void onPopoverClick(e));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (popover.showSettings) {
          popover.showSettings = false;
          renderPopoverView();
        } else if (popover.showConflicts) {
          popover.showConflicts = false;
          renderPopoverView();
        } else {
          invoke2("hide_popover");
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        invoke2("open_settings");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        invoke2("open_sync_folder");
      }
    });
    window.addEventListener("focus", () => void refreshPopover());
    let pending = null;
    const soon = () => {
      if (pending)
        clearTimeout(pending);
      pending = setTimeout(() => void refreshPopover(), 150);
    };
    onBackendEvents(["status-changed", "vault-changed", "sync-started", "sync-finished", "sync-paused", "sync-resumed"], soon);
    setInterval(renderPopoverView, 30000);
    refreshPopover();
  }
  async function loadSettings() {
    const [status, autostart, ignored] = await Promise.all([
      invoke2("get_vault_status"),
      invoke2("is_autostart_enabled").catch(() => false),
      invoke2("get_ignored_patterns").catch(() => [])
    ]);
    root().innerHTML = renderSettings({ status, autostart, ignored });
    bindSettings(status);
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.querySelector(`[data-panel="${tab}"]`)?.classList.add("active");
      });
    });
  }
  function flash(id, text, isError = false) {
    const el = $(id);
    if (!el)
      return;
    el.textContent = text;
    el.classList.toggle("error", isError);
  }
  function bindSettings(status) {
    let keyStore = keyStoreKind(status.key_store);
    const radio = (v) => document.querySelector(`input[name="key-store"][value="${v}"]`);
    const confirmBox = $("key-store-confirm");
    const restore = () => radio(keyStore).checked = true;
    const moveKeys = async (useKeychain) => {
      flash("key-store-message", "Moving your keys…");
      try {
        await changeKeyStore(invoke2, useKeychain);
        keyStore = useKeychain ? "keychain" : "file";
        flash("key-store-message", useKeychain ? "Your keys are now in the system keychain." : "Your keys are now in an unprotected file on this Mac.");
      } catch (err) {
        restore();
        flash("key-store-message", `Couldn't move your keys. ${friendlyError(errText(err), "Please try again.")}`, true);
      }
    };
    document.querySelectorAll('input[name="key-store"]').forEach((input) => input.addEventListener("change", () => {
      if (input.value === keyStore)
        return;
      if (input.value === "file") {
        confirmBox.hidden = false;
      } else {
        confirmBox.hidden = true;
        moveKeys(true);
      }
    }));
    $("key-store-cancel").addEventListener("click", () => {
      confirmBox.hidden = true;
      restore();
    });
    $("key-store-confirm-btn").addEventListener("click", () => {
      confirmBox.hidden = true;
      moveKeys(false);
    });
    $("device-name-save").addEventListener("click", async () => {
      const name = $("device-name-input").value.trim();
      if (!name)
        return flash("device-name-message", "Enter a name for this Mac.", true);
      try {
        await invoke2("update_vault_config", { payload: { device_name: name } });
        flash("device-name-message", "Saved.");
      } catch (err) {
        flash("device-name-message", errText(err), true);
      }
    });
    $("autostart-toggle").addEventListener("change", async (e) => {
      const input = e.target;
      try {
        input.checked = await invoke2("set_autostart_enabled", { enabled: input.checked });
      } catch {
        input.checked = !input.checked;
      }
    });
    $("ignored-save").addEventListener("click", async () => {
      const patterns = $("ignored-input").value.split(`
`).map((l) => l.trim()).filter(Boolean);
      try {
        await invoke2("save_ignored_patterns", { patterns });
        flash("ignored-message", "Saved.");
      } catch (err) {
        flash("ignored-message", errText(err), true);
      }
    });
    $("settings-open-folder-btn")?.addEventListener("click", () => void invoke2("open_sync_folder"));
    $("add-finder-btn")?.addEventListener("click", async () => {
      try {
        await invoke2("add_to_finder_favorites");
        flash("device-name-message", "Added to Finder sidebar.");
      } catch {
        await invoke2("open_sync_folder");
      }
    });
    $("reconnect-btn").addEventListener("click", () => void invoke2("open_setup"));
    $("quit-btn").addEventListener("click", () => void invoke2("quit_app"));
  }
  function initSettings() {
    document.title = "RenegadeBox Settings";
    loadSettings().catch((err) => {
      root().innerHTML = `<main class="settings"><p class="form-error">${friendlyError(errText(err), "Settings couldn't be loaded.")}</p></main>`;
    });
  }
  function initSetup() {
    document.title = "Set up RenegadeBox";
    root().innerHTML = renderSetup();
    let step = 1;
    let provider = "aws";
    let finished = false;
    const input = (id) => $(id);
    const values = () => ({
      provider,
      endpoint: input("setup-endpoint").value.trim(),
      bucket: input("setup-bucket").value.trim(),
      region: input("setup-region").value.trim(),
      access_key_id: input("setup-access-key").value.trim(),
      secret_access_key: input("setup-secret").value.trim(),
      passphrase: input("setup-passphrase").value,
      passphrase_confirm: input("setup-passphrase-confirm").value,
      folder: input("setup-folder").value.trim(),
      device_name: input("setup-device-name").value.trim()
    });
    const setError = (msg) => $("setup-error").textContent = msg;
    const choose = (id) => {
      provider = id;
      const p = PROVIDERS.find((x) => x.id === id);
      document.querySelectorAll(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.provider === id)));
      input("setup-region").value = p.region;
      input("setup-endpoint").value = p.endpoint;
      $("setup-endpoint-hint").textContent = p.endpointHint;
    };
    const show = (s) => {
      document.querySelectorAll(".step").forEach((el) => el.hidden = el.dataset.step !== String(s));
      document.querySelectorAll("[data-step-dot]").forEach((el) => {
        const n = Number(el.dataset.stepDot);
        el.classList.toggle("active", s !== "done" && n === s);
        el.classList.toggle("done", s === "done" || n < s);
      });
      $("setup-back").hidden = s === "done" || s === 1;
      $("setup-next").textContent = s === "done" ? "Done" : s === SETUP_STEPS ? "Set up RenegadeBox" : "Continue";
      setError("");
      if (typeof s === "number")
        step = s;
      document.querySelector(`.step[data-step="${s}"] input:not([type=radio])`)?.focus();
    };
    const meter = () => {
      const v = values();
      const left = MIN_PASSPHRASE - [...v.passphrase].length;
      $("passphrase-meter").textContent = v.passphrase.length === 0 ? "" : left > 0 ? `${left} more character${left === 1 ? "" : "s"} needed.` : v.passphrase_confirm && v.passphrase_confirm !== v.passphrase ? "The two passphrases don't match yet." : "Long enough.";
    };
    input("setup-passphrase").addEventListener("input", meter);
    input("setup-passphrase-confirm").addEventListener("input", meter);
    document.querySelectorAll(".preset").forEach((b) => b.addEventListener("click", () => choose(b.dataset.provider)));
    $("setup-back").addEventListener("click", () => show(Math.max(1, step - 1)));
    $("setup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (finished)
        return void invoke2("close_window");
      const v = values();
      const problem = validateSetupStep(step, v);
      if (problem)
        return setError(problem);
      if (step < SETUP_STEPS)
        return show(step + 1);
      const next = $("setup-next");
      const back = $("setup-back");
      next.disabled = back.disabled = true;
      next.textContent = "Connecting to your storage…";
      try {
        await invoke2("setup_vault", {
          payload: {
            folder: v.folder,
            bucket: v.bucket,
            region: v.region,
            endpoint: v.endpoint || null,
            access_key_id: v.access_key_id,
            secret_access_key: v.secret_access_key,
            passphrase: v.passphrase,
            device_name: v.device_name || null,
            hub_url: null
          }
        });
        finished = true;
        show("done");
      } catch (err) {
        const raw = errText(err);
        show(setupErrorStep(raw));
        setError(friendlyError(raw, raw));
      } finally {
        next.disabled = back.disabled = false;
      }
    });
    choose(provider);
    show(1);
  }
  function mountPreviewBar(view, scenario) {
    document.body.classList.add("preview", `preview-${view}`);
    const labels = {
      ok: "Up to date",
      syncing: "Syncing",
      paused: "Paused",
      conflicts: "Needs attention",
      error: "Error",
      setup: "Not set up"
    };
    const link = (href, text, active) => `<a href="${href}"${active ? ' aria-current="page"' : ""}>${text}</a>`;
    const bar = document.createElement("nav");
    bar.className = "preview-bar";
    bar.innerHTML = `<span class="preview-label">Preview</span>` + MOCK_SCENARIOS.map((s) => link(`?view=popover&state=${s}`, labels[s], view === "popover" && scenario === s)).join("") + link("?view=settings", "Settings", view === "settings") + link("?view=setup", "Setup", view === "setup");
    document.body.prepend(bar);
  }
  function init() {
    const view = currentView();
    document.body.classList.add(`view-${view}`);
    if (!hasTauri())
      mountPreviewBar(view, mockScenarioFromUrl());
    if (view === "settings")
      initSettings();
    else if (view === "setup")
      initSetup();
    else
      initPopover();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();
})();
