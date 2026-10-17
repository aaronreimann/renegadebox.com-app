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
  function accountStatus(call = invoke2) {
    return call("account_status");
  }
  function accountCreate(payload, call = invoke2) {
    return call("account_create", { payload: { email: payload.email, password: payload.password } });
  }
  function accountSignIn(payload, call = invoke2) {
    const body = { email: payload.email, password: payload.password };
    if (payload.folder)
      body.folder = payload.folder;
    return call("account_sign_in", { payload: body });
  }
  function accountGoogleSignIn(folder, call = invoke2) {
    return call("account_google_sign_in", { payload: folder ? { folder } : null });
  }
  function accountSignOut(call = invoke2) {
    return call("account_sign_out");
  }
  function accountDevices(call = invoke2) {
    return call("account_devices");
  }
  function accountRemoveDevice(deviceId, call = invoke2) {
    return call("account_remove_device", { deviceId });
  }
  function accountChangePassword(password, call = invoke2) {
    return call("account_change_password", { password });
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
  function sampleActivity(now, scenario) {
    const item = (path, kind, status, size, ago) => {
      const i = path.lastIndexOf("/");
      return {
        path,
        name: i < 0 ? path : path.slice(i + 1),
        folder: i < 0 ? "" : path.slice(0, i),
        kind,
        status,
        size,
        started_ms: now - ago - 4000,
        finished_ms: status === "active" ? null : now - ago,
        destination: kind === "moved" ? path : null
      };
    };
    const active = scenario === "syncing" ? [
      item("Photos/2026/IMG_2045.jpeg", "upload", "active", 4400000, 0),
      item("Work/Site walkthrough.mov", "upload", "active", 812000000, 0),
      item("Home/Lease signed.pdf", "download", "active", 1200000, 0)
    ] : [];
    return {
      active,
      recent: [
        item("Work/Q3 budget.xlsx", "upload", "done", 48000, 2 * MIN),
        item("/Volumes/HomeNAS/Backups/Pressable/pressable_backup.sql.gz", "moved", "done", 220000000, 6 * MIN),
        item("Work/Client proposal - Hartley.docx", "download", "done", 310000, 14 * MIN),
        item("Photos/2026/IMG_2041.jpeg", "upload", "done", 3900000, 3 * HOUR),
        item("Home/Old quote.pdf", "delete_remote", "done", null, 4 * HOUR),
        item("Taxes/Scans/receipt-0412.tiff", "upload", "failed", 18000000, 5 * HOUR)
      ]
    };
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
  var mockAiConfig = {
    enabled: false,
    provider: "openrouter",
    model: "google/gemini-2.5-flash-lite",
    smb_target: "/Volumes/home",
    rules: `Invoices and receipts go to Finance/Invoices
Photos and media go to Media/Photos`,
    auto_route: true,
    routing_mode: "move",
    routing_root: "/Volumes/home",
    has_api_key: true,
    has_openrouter_key: true,
    has_grok_key: false,
    role_rules: {},
    enabled_roles: ["webdev"],
    vault_routing_enabled: false,
    use_review_folder: true,
    vault_max_file_mb: 500,
    vault_folder: "/Users/me/RenegadeBox",
    rules_backup_count: 0,
    ingest_warning: null
  };
  var mockRulesBackups = [];
  var mockAccountEmail = null;
  var mockAccountProvider = null;
  var mockAccountDevices = [];
  var MOCK_ACCOUNT_SERVER = "https://app.renegadebox.com";
  function mockSignedInDevices(now) {
    const iso = (ago) => new Date(now - ago).toISOString();
    return [
      { id: "mac-this", name: "My-MacBook-Pro", platform: "macos", client_version: "0.1.0", last_seen_at: iso(0), created_at: iso(30 * DAY), current: true },
      { id: "mac-imac", name: "My-iMac", platform: "macos", client_version: "0.1.0", last_seen_at: iso(3 * HOUR), created_at: iso(20 * DAY), current: false },
      { id: "mac-studio", name: "Studio Mac mini", platform: "macos", client_version: "0.1.0", last_seen_at: iso(9 * DAY), created_at: iso(60 * DAY), current: false }
    ];
  }
  function mockAccountStatus(initialized) {
    return { signed_in: mockAccountEmail !== null, email: mockAccountEmail, server: MOCK_ACCOUNT_SERVER, device_ready: initialized, provider: mockAccountEmail === null ? null : mockAccountProvider };
  }
  var mockDelay = (ms, fn) => new Promise((resolve, reject) => setTimeout(() => {
    try {
      resolve(fn());
    } catch (e) {
      reject(e);
    }
  }, ms));
  var mockReviewQueue = [
    {
      id: "rv-preview-1",
      timestamp: Date.now() - 300000,
      filename: "scan_0042.tiff",
      path: "/Users/me/RenegadeBox/To NAS/_Needs Review/scan_0042.tiff",
      suggested_folder: "Media/Scans",
      confidence: 0.55,
      reason: "AI was only 55% sure",
      explanation: "Looks like a scanned document, but the content is unclear.",
      file_size_bytes: 8400000
    },
    {
      id: "rv-preview-2",
      timestamp: Date.now() - 600000,
      filename: "2026-10-05-14-06-39-beaverbuilderforge.sql.gz",
      path: "/Users/me/RenegadeBox/To NAS/_Needs Review/2026-10-05-14-06-39-beaverbuilderforge.sql.gz",
      suggested_folder: "Backups From Spinup",
      confidence: null,
      reason: "Move failed: source kept at /Users/me/RenegadeBox/To NAS/2026-10-05-14-06-39-beaverbuilderforge.sql.gz: Permission denied (os error 13)",
      explanation: null,
      file_size_bytes: 91501
    }
  ];
  var mockSuggestions = [
    {
      id: "sg-preview-1",
      timestamp: Date.now() - 600000,
      rule: "*.blend go to Design/3D Models",
      example_file: "chair_v3.blend",
      destination: "Design/3D Models"
    }
  ];
  var MOCK_ROUTE_TEMPLATES = [
    {
      id: "photography",
      name: "Photography",
      description: "Shoots filed by the date they were taken. Drop into a subfolder named after the client to file it under that client. RAW, JPEG and sidecar files stay together.",
      mode: "copy",
      scan_subfolders: true,
      layout: "Shoots/{year}/{date} {source_folder}",
      rules: ["*.mp4, *.mov, *.mts go to Video/{year}/{date} {source_folder}", "*.psd, *.tif, *.tiff go to Edits/{year}/{source_folder}"]
    },
    {
      id: "website-backups",
      name: "Website Backups",
      description: "Hosting backups and database dumps filed by host.",
      mode: "move",
      scan_subfolders: false,
      layout: null,
      rules: ["SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup", "*.wpress go to Local Sites & Exports"]
    },
    {
      id: "documents",
      name: "Documents",
      description: "Invoices, statements and PDFs filed by year.",
      mode: "move",
      scan_subfolders: false,
      layout: "Documents/{year}",
      rules: ["invoice, receipt go to Finance/Invoices/{year}", "statement go to Finance/Statements/{year}", "contract, agreement go to Contracts"]
    },
    {
      id: "family-photos",
      name: "Family Photos",
      description: "Phone and camera photos filed by year and month.",
      mode: "move",
      scan_subfolders: true,
      layout: "Photos/{year}/{year}-{month}",
      rules: ["*.mp4, *.mov go to Videos/{year}"]
    },
    { id: "blank", name: "Blank", description: "Start from scratch with your own rules.", mode: "move", scan_subfolders: false, layout: null, rules: [] }
  ];
  var mockRoutes = [
    {
      id: "photography",
      name: "Photography",
      enabled: true,
      source: "/Users/me/Photo Inbox",
      destination: "/Volumes/PhotoNAS",
      mode: "copy",
      auto: true,
      ai: false,
      use_review_folder: true,
      scan_subfolders: true,
      skip_duplicates: true,
      vault: false,
      rules: MOCK_ROUTE_TEMPLATES[0].rules,
      layout: MOCK_ROUTE_TEMPLATES[0].layout,
      template: "photography"
    }
  ];
  function mockRoutesOverview() {
    const main = {
      id: "main",
      name: "To NAS",
      enabled: true,
      source: "/Users/me/RenegadeBox/To NAS",
      destination: mockAiConfig.smb_target || "",
      mode: mockAiConfig.routing_mode === "organize" ? "organize" : "move",
      auto: mockAiConfig.auto_route,
      ai: mockAiConfig.enabled,
      use_review_folder: mockAiConfig.use_review_folder ?? true,
      scan_subfolders: false,
      skip_duplicates: false,
      vault: mockAiConfig.vault_routing_enabled ?? false,
      rules: (mockAiConfig.rules || "").split(`
`).filter((l) => l.trim()),
      layout: null,
      template: null
    };
    return {
      routes: [
        { config: main, is_main: true, source_exists: true, destination_reachable: true, pending_count: 0, review_count: mockReviewQueue.length, problems: [] },
        ...mockRoutes.map((r) => ({
          config: r,
          is_main: false,
          source_exists: true,
          destination_reachable: !r.destination.startsWith("/Volumes/PhotoNAS"),
          pending_count: r.id === "photography" ? 14 : 0,
          review_count: 0,
          problems: []
        }))
      ],
      templates: MOCK_ROUTE_TEMPLATES
    };
  }
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
        case "get_sync_activity":
          return initialized ? sampleActivity(now, scenario) : { active: [], recent: [] };
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
        case "get_ai_config":
          return mockAiConfig;
        case "save_ai_config": {
          const payload = args?.payload;
          if (payload) {
            const hasOpenRouter = Boolean(payload.openrouter_api_key || payload.api_key || mockAiConfig.has_openrouter_key);
            const hasGrok = Boolean(payload.grok_api_key || mockAiConfig.has_grok_key);
            const provider = payload.provider || mockAiConfig.provider || "openrouter";
            mockAiConfig = {
              ...mockAiConfig,
              enabled: payload.enabled,
              provider,
              model: payload.model,
              smb_target: payload.smb_target ?? mockAiConfig.smb_target,
              nas_ingest_folder: payload.nas_ingest_folder ?? mockAiConfig.nas_ingest_folder,
              rules: payload.rules ?? mockAiConfig.rules,
              auto_route: payload.auto_route,
              routing_mode: payload.routing_mode ?? mockAiConfig.routing_mode,
              has_api_key: provider === "xai" ? hasGrok : hasOpenRouter,
              has_openrouter_key: hasOpenRouter,
              has_grok_key: hasGrok,
              vault_routing_enabled: payload.vault_routing_enabled ?? mockAiConfig.vault_routing_enabled,
              vault_max_file_mb: payload.vault_max_file_mb ?? mockAiConfig.vault_max_file_mb,
              use_review_folder: payload.use_review_folder ?? mockAiConfig.use_review_folder
            };
          }
          return true;
        }
        case "scan_nas_directories": {
          const scan = {
            root: args?.path || "/Volumes/home",
            directories: [
              "Finance",
              "Finance/Invoices",
              "Finance/Taxes",
              "Media",
              "Media/Photos",
              "Media/Videos",
              "Work",
              "Work/Projects",
              "Work/Proposals"
            ]
          };
          return scan;
        }
        case "suggest_rules_from_nas": {
          return [
            "Invoices, receipts, and bills go to Finance/Invoices",
            "Tax documents (W-2, 1099) go to Finance/Taxes",
            "Photos and camera media go to Media/Photos",
            "Client proposals and agreements go to Work/Proposals",
            "Code projects and archives go to Work/Projects"
          ];
        }
        case "translate_rules": {
          const exp = (args?.explanation || "").toLowerCase();
          if (exp.includes("spinup")) {
            return ["SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup"];
          }
          if (exp.includes("pressable")) {
            return ["Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable"];
          }
          if (exp.includes("wp engine") || exp.includes("wpengine")) {
            return ["WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine"];
          }
          if (exp.includes("cpanel")) {
            return ["cPanel website backups (backup-*.tar.gz) go to Backups From cPanel"];
          }
          if (exp.includes("backup")) {
            return [
              "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup",
              "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine",
              "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable",
              "cPanel website backups (backup-*.tar.gz) go to Backups From cPanel"
            ];
          }
          if (exp.includes("tax")) {
            return [
              "Tax returns, W-2s, and 1099 statements go to Finance/Taxes",
              "General invoices and bills go to Finance/Invoices",
              "Work documents go to Work/Projects"
            ];
          }
          return [
            "Invoices and accounting documents go to Finance/Invoices",
            "Photos, graphics, and video media go to Media/Photos",
            "Client contracts and agreements go to Work/Proposals"
          ];
        }
        case "test_ai_routing": {
          const decision = {
            destination_folder: "Finance/Invoices",
            suggested_filename: "Invoice_ACME_Oct2026.pdf",
            confidence: 0.95,
            explanation: "Contains invoice headers and payment terms matching Finance/Invoices rule."
          };
          return decision;
        }
        case "choose_folder":
        case "pick_sync_folder":
          return "/Volumes/HomeNAS/Website Backups";
        case "open_finder_extensions":
          return null;
        case "list_detected_volumes": {
          const vols = [
            { name: "Synology (home)", path: "/Volumes/home" },
            { name: "Synology (data)", path: "/Volumes/data" }
          ];
          return vols;
        }
        case "get_ai_usage": {
          const summary = {
            totalRequests: 21,
            totalPromptTokens: 8450,
            totalCompletionTokens: 2620,
            totalTokens: 11070,
            totalCostUsd: 0.00289,
            byOperation: [
              {
                operation: "rule_translation",
                label: "Rule Optimization & Verify",
                requests: 10,
                totalTokens: 5240,
                estimatedCostUsd: 0.00138,
                percentageOfTotal: 47.3
              },
              {
                operation: "suggest_rules",
                label: "NAS Taxonomy Scan",
                requests: 6,
                totalTokens: 3510,
                estimatedCostUsd: 0.00091,
                percentageOfTotal: 31.7
              },
              {
                operation: "file_routing",
                label: "Live File Auto-Routing",
                requests: 5,
                totalTokens: 2320,
                estimatedCostUsd: 0.0006,
                percentageOfTotal: 21
              }
            ],
            byModel: [
              {
                model: "google/gemini-2.5-flash-lite",
                requests: 18,
                totalTokens: 9450,
                estimatedCostUsd: 0.00234,
                percentageOfTotal: 85.4
              },
              {
                model: "anthropic/claude-haiku-4.5",
                requests: 3,
                totalTokens: 1620,
                estimatedCostUsd: 0.00055,
                percentageOfTotal: 14.6
              }
            ],
            recentEntries: [
              {
                id: "req-1",
                timestamp: Date.now() - 45000,
                operation: "rule_translation",
                operationLabel: "Rule Optimization",
                model: "google/gemini-2.5-flash-lite",
                promptTokens: 380,
                completionTokens: 110,
                totalTokens: 490,
                estimatedCostUsd: 0.000082,
                summary: "Optimized: SpinupWP backups go to Backups/SpinupWP"
              },
              {
                id: "req-2",
                timestamp: Date.now() - 140000,
                operation: "suggest_rules",
                operationLabel: "NAS Taxonomy Scan",
                model: "google/gemini-2.5-flash-lite",
                promptTokens: 620,
                completionTokens: 240,
                totalTokens: 860,
                estimatedCostUsd: 0.000158,
                summary: "Discovered HomeNAS taxonomy (6 folders)"
              },
              {
                id: "req-3",
                timestamp: Date.now() - 420000,
                operation: "file_routing",
                operationLabel: "Live File Routing",
                model: "google/gemini-2.5-flash-lite",
                promptTokens: 290,
                completionTokens: 85,
                totalTokens: 375,
                estimatedCostUsd: 0.000063,
                summary: "Routed backup_db.sql.gz -> Backups/Databases"
              },
              {
                id: "req-4",
                timestamp: Date.now() - 950000,
                operation: "rule_translation",
                operationLabel: "Rule Optimization",
                model: "google/gemini-2.5-flash-lite",
                promptTokens: 340,
                completionTokens: 95,
                totalTokens: 435,
                estimatedCostUsd: 0.000072,
                summary: "Optimized: Pressable backups go to Backups/Pressable"
              }
            ]
          };
          return summary;
        }
        case "clear_ai_usage":
          return null;
        case "get_nas_transfers": {
          const transfers = [
            {
              id: "tx-sample-1",
              timestamp: Date.now() - 120000,
              filename: "backup_lamp_production_spinup.sql.gz",
              source_path: "~/RenegadeBox/To NAS/backup_lamp_production_spinup.sql.gz",
              destination_path: "/Volumes/home/Website Backups/SpinupWP/backup_lamp_production_spinup.sql.gz",
              destination_folder: "Website Backups/SpinupWP",
              rule_matched: "SpinupWP backups go to Website Backups/SpinupWP",
              file_size_bytes: 42850100,
              status: "completed"
            },
            {
              id: "tx-sample-2",
              timestamp: Date.now() - 360000,
              filename: "pressable_export_oct2026.zip",
              source_path: "~/RenegadeBox/To NAS/pressable_export_oct2026.zip",
              destination_path: "/Volumes/home/Website Backups/Pressable/pressable_export_oct2026.zip",
              destination_folder: "Website Backups/Pressable",
              rule_matched: "Pressable backups go to Website Backups/Pressable",
              file_size_bytes: 18420000,
              status: "completed"
            }
          ];
          return transfers;
        }
        case "clear_nas_transfers":
          return null;
        case "relocate_nas_transfer": {
          const id = args?.transferId || "tx-sample-1";
          const newFolder = args?.newFolder || "Website Backups/Relocated";
          const rec = {
            id,
            timestamp: Date.now(),
            filename: "backup_lamp_production_spinup.sql.gz",
            source_path: "~/RenegadeBox/To NAS/backup_lamp_production_spinup.sql.gz",
            destination_path: `/Volumes/home/${newFolder}/backup_lamp_production_spinup.sql.gz`,
            destination_folder: newFolder,
            rule_matched: "Manual user relocation",
            file_size_bytes: 42850100,
            status: "relocated"
          };
          return rec;
        }
        case "revert_nas_transfer_to_staging": {
          const id = args?.transferId || "tx-sample-1";
          const rec = {
            id,
            timestamp: Date.now(),
            filename: "backup_lamp_production_spinup.sql.gz",
            source_path: "~/RenegadeBox/To NAS/backup_lamp_production_spinup.sql.gz",
            destination_path: "/Volumes/home/Website Backups/SpinupWP/backup_lamp_production_spinup.sql.gz",
            destination_folder: "Website Backups/SpinupWP",
            rule_matched: "Reverted to staging",
            file_size_bytes: 42850100,
            status: "reverted"
          };
          return rec;
        }
        case "get_nas_staging_status": {
          const status = {
            ingest_folder: "/Users/me/RenegadeBox/To NAS",
            pending_count: 0,
            pending_files: [],
            nas_accessible: true,
            smb_target: "/Volumes/home"
          };
          return status;
        }
        case "process_nas_ingest": {
          return [];
        }
        case "get_review_queue":
          return mockReviewQueue;
        case "get_routes":
          return mockRoutesOverview();
        case "save_route": {
          const route = { ...args?.route };
          if (!route.name?.trim())
            throw new Error("Give this route a name.");
          if (!route.source?.startsWith("/"))
            throw new Error("Choose a source folder.");
          if (route.mode !== "organize" && !route.destination?.startsWith("/"))
            throw new Error("Choose a destination folder.");
          if (!route.id)
            route.id = route.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "route";
          mockRoutes = mockRoutes.some((r) => r.id === route.id) ? mockRoutes.map((r) => r.id === route.id ? route : r) : [...mockRoutes, route];
          return route;
        }
        case "delete_route":
          mockRoutes = mockRoutes.filter((r) => r.id !== args?.routeId);
          return null;
        case "run_route_now":
          return [];
        case "approve_review_item": {
          const itemId = args?.itemId || "";
          const item = mockReviewQueue.find((i) => i.id === itemId);
          mockReviewQueue = mockReviewQueue.filter((i) => i.id !== itemId);
          const folder = args?.folder || item?.suggested_folder || "Unsorted";
          const rec = {
            id: `tx-preview-${now}`,
            timestamp: now,
            filename: item?.filename || "file",
            source_path: item?.path || "",
            destination_path: `/Volumes/home/${folder}/${item?.filename || "file"}`,
            destination_folder: folder,
            rule_matched: "Approved from review",
            file_size_bytes: item?.file_size_bytes || 0,
            status: "completed"
          };
          return rec;
        }
        case "dismiss_review_item":
          mockReviewQueue = mockReviewQueue.filter((i) => i.id !== args?.itemId);
          return null;
        case "get_rule_suggestions":
          return mockSuggestions;
        case "dismiss_rule_suggestion":
          mockSuggestions = mockSuggestions.filter((s) => s.id !== args?.suggestionId);
          return null;
        case "check_rule": {
          const rule = String(args?.rule || "");
          const parts = rule.split(/\s+go\s+to\s+/i);
          const parses = parts.length === 2 && Boolean(parts[0]?.trim()) && Boolean(parts[1]?.trim());
          const destination = parts[1]?.trim() || "";
          const check = {
            rule,
            parses,
            trigger: parts[0]?.trim() || "",
            destination,
            is_vault: destination.startsWith("vault:"),
            vault_enabled: Boolean(mockAiConfig.vault_routing_enabled),
            destination_safe: !destination.includes(".."),
            destination_exists: null,
            sample_file: "",
            sample_matches: parses,
            shadowed_by: null,
            problems: parses ? [] : ['Rules must look like "<pattern> go to <folder>".']
          };
          return check;
        }
        case "save_routing_rules": {
          const roleRules = args?.roleRules || {};
          mockRulesBackups.push(mockAiConfig.role_rules || {});
          mockAiConfig = {
            ...mockAiConfig,
            role_rules: roleRules,
            enabled_roles: args?.enabledRoles || mockAiConfig.enabled_roles,
            rules_backup_count: mockRulesBackups.length
          };
          return "saved";
        }
        case "undo_rules_change": {
          const prev = mockRulesBackups.pop();
          if (!prev)
            throw new Error("No earlier rules to restore");
          mockAiConfig = { ...mockAiConfig, role_rules: prev, rules_backup_count: mockRulesBackups.length };
          return mockAiConfig;
        }
        case "account_status":
          return mockAccountStatus(initialized);
        case "account_create":
        case "account_sign_in": {
          const p = args?.payload ?? {};
          return mockDelay(cmd === "account_sign_in" ? 1500 : 1200, () => {
            if (cmd === "account_create" && !initialized)
              throw "Set up your storage on this Mac first, then create your account.";
            if (cmd === "account_sign_in" && (p.password ?? "").length < 12)
              throw "That email and password don't match an account.";
            mockAccountEmail = (p.email ?? "").trim();
            mockAccountProvider = "password";
            mockAccountDevices = mockSignedInDevices(now);
            return mockAccountStatus(true);
          });
        }
        case "account_google_sign_in":
          return mockDelay(2500, () => {
            mockAccountEmail = "you@example.com";
            mockAccountProvider = "google";
            mockAccountDevices = mockSignedInDevices(now);
            return mockAccountStatus(true);
          });
        case "account_sign_out":
          mockAccountEmail = null;
          mockAccountDevices = [];
          return mockAccountStatus(initialized);
        case "account_devices":
          if (mockAccountEmail === null)
            throw "This Mac isn't signed in to an account.";
          return mockDelay(400, () => mockAccountDevices);
        case "account_remove_device":
          mockAccountDevices = mockAccountDevices.filter((d) => d.id !== args?.deviceId);
          return null;
        case "account_change_password":
          if (String(args?.password ?? "").length < 12)
            throw "Passwords need at least 12 characters.";
          return mockDelay(1200, () => null);
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
  function splitPath(path) {
    const i = path.lastIndexOf("/");
    return i < 0 ? { name: path, folder: "" } : { name: path.slice(i + 1), folder: path.slice(0, i) };
  }
  function escapeHtml(s) {
    if (s == null)
      return "";
    const str = typeof s === "string" ? s : String(s);
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    gMark: (s) => svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 12H12.5"/>', s),
    user: (s) => svg('<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>', s),
    lock: (s) => svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', s),
    external: (s) => svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', s),
    sparkles: (s) => svg('<path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/>', s),
    sun: (s) => svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>', s),
    moon: (s) => svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>', s),
    monitor: (s) => svg('<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>', s),
    search: (s) => svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>', s),
    clear: (s) => svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', s),
    copy: (s) => svg('<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', s),
    code: (s) => svg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', s),
    archive: (s) => svg('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>', s),
    bell: (s) => svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', s),
    chart: (s) => svg('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>', s),
    arrowRight: (s) => svg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', s),
    undo: (s) => svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>', s),
    arrowUp: (s) => svg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>', s),
    arrowDown: (s) => svg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>', s),
    trash: (s) => svg('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/>', s),
    appWindow: (s) => svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M6.5 6.5h.01M9 6.5h.01"/>', s)
  };
  function categorizeFile(name) {
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (["jpg", "jpeg", "png", "gif", "heic", "webp", "tiff", "svg", "bmp", "ico"].includes(ext))
      return "images";
    if (["rs", "ts", "js", "jsx", "tsx", "py", "json", "html", "css", "toml", "sh", "sql", "yaml", "yml", "c", "cpp", "h"].includes(ext))
      return "code";
    if (["zip", "tar", "gz", "7z", "dmg", "rar", "pkg"].includes(ext))
      return "archives";
    return "documents";
  }
  function fileIcon(name) {
    const cat = categorizeFile(name);
    if (cat === "images")
      return icons.image(18);
    if (cat === "code")
      return icons.code(18);
    if (cat === "archives")
      return icons.archive(18);
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
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
  async function withBusy(state, fn) {
    state.busy = true;
    try {
      return await fn();
    } finally {
      state.busy = false;
    }
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

  // src/lib/account.ts
  var MIN_ACCOUNT_PASSWORD = 12;
  var length = (s) => [...s].length;
  function emailProblem(email) {
    const e = email.trim();
    if (!e)
      return "Enter your email address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      return "Enter a valid email address.";
    return null;
  }
  function validateSignIn(email, password) {
    return emailProblem(email) ?? (password ? null : "Enter your password.");
  }
  function validateNewPassword(password, confirm) {
    if (!password)
      return "Enter a password.";
    if (length(password) < MIN_ACCOUNT_PASSWORD)
      return `Your password needs at least ${MIN_ACCOUNT_PASSWORD} characters.`;
    if (password !== confirm)
      return "The two passwords don't match.";
    return null;
  }
  function validateCreateAccount(email, password, confirm) {
    return emailProblem(email) ?? validateNewPassword(password, confirm);
  }
  function deviceMeta(d, now = Date.now()) {
    if (d.current)
      return "This Mac";
    const seen = d.last_seen_at ? Date.parse(d.last_seen_at) : NaN;
    if (!Number.isFinite(seen))
      return "Not seen yet";
    const rel = relativeTime(seen, now);
    if (rel === "Just now" || rel === "Yesterday")
      return `Last seen ${rel.toLowerCase()}`;
    if (/^[A-Z][a-z]{2} \d/.test(rel))
      return `Last seen on ${rel}`;
    return `Last seen ${rel}`;
  }
  function sortDevices(devices) {
    const seen = (d) => d.last_seen_at ? Date.parse(d.last_seen_at) || 0 : 0;
    return [...devices].sort((a, b) => Number(b.current) - Number(a.current) || seen(b) - seen(a));
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
  function renderPopover(m) {
    const { overview } = m;
    const tab = m.tab ?? "activity";
    const st = describeStatus(overview);
    const statusInner = `
      <span class="status-icon">${STATUS_ICON[st.kind]()}</span>
      <span class="status-text">
        <span class="status-title">${escapeHtml(st.title)}</span>
        ${st.detail ? `<span class="status-detail">${escapeHtml(st.detail)}</span>` : ""}
      </span>`;
    const status = st.kind === "attention" ? `<button id="status-line" class="status status-${st.kind} status-link" type="button">${statusInner}<span id="conflicts-link" class="status-chevron">${icons.chevron(16)}</span></button>` : `<div id="status-line" class="status status-${st.kind}" role="status">${statusInner}</div>`;
    const pauseLabel = overview.paused ? "Resume syncing" : "Pause syncing";
    const menu = m.menuOpen ? `
      <div id="popover-menu" class="pop-menu" role="menu">
        <button id="menu-preferences" class="pop-menu-item" type="button" role="menuitem">${icons.gear(14)}<span>Preferences…</span></button>
        <button id="menu-open-app" class="pop-menu-item" type="button" role="menuitem">${icons.appWindow(14)}<span>Open RenegadeBox</span></button>
        <button id="menu-pause" class="pop-menu-item" type="button" role="menuitem"${overview.initialized ? "" : " disabled"}>${overview.paused ? icons.play(14) : icons.pause(14)}<span>${pauseLabel}</span></button>
        <div class="pop-menu-sep" role="separator"></div>
        <button id="menu-quit" class="pop-menu-item" type="button" role="menuitem"><span class="pop-menu-spacer"></span><span>Quit RenegadeBox</span></button>
      </div>` : "";
    const controls = overview.initialized ? `
      <div class="pop-search">
        <span class="pop-search-icon">${icons.search(14)}</span>
        <input id="popover-search" type="search" placeholder="Search recent files" value="${escapeHtml(m.query ?? "")}" autocomplete="off" spellcheck="false" aria-label="Search recent files" />
      </div>
      <div class="pop-tabs" role="tablist">
        <button class="pop-tab${tab === "activity" ? " active" : ""}" type="button" role="tab" aria-selected="${tab === "activity"}" data-popover-tab="activity">Sync history</button>
        <button class="pop-tab${tab === "recent" ? " active" : ""}" type="button" role="tab" aria-selected="${tab === "recent"}" data-popover-tab="recent">Recently edited</button>
      </div>` : "";
    return `
    <section class="popover">
      <header class="pop-head">
        <div class="pop-brand"><span class="pop-logo">${icons.box(18)}</span><span class="pop-title">RenegadeBox</span></div>
        <div class="pop-tools">
          <button id="open-folder-btn" class="icon-btn pop-tool" type="button" title="Open RenegadeBox folder" aria-label="Open RenegadeBox folder"${overview.initialized ? "" : " disabled"}>${icons.folder(17)}</button>
          <button id="open-app-btn" class="icon-btn pop-tool" type="button" title="Open RenegadeBox" aria-label="Open RenegadeBox">${icons.appWindow(17)}</button>
          <button id="settings-btn" class="icon-btn pop-tool${m.menuOpen ? " active" : ""}" type="button" title="Settings" aria-label="Settings" aria-haspopup="menu" aria-expanded="${Boolean(m.menuOpen)}">${icons.gear(17)}</button>
        </div>
        ${menu}
      </header>
      ${controls}
      <div id="popover-list" class="popover-body">${renderPopoverList(m)}</div>
      <footer class="pop-status">
        ${status}
        <button id="pause-btn" class="icon-btn pop-tool" type="button" aria-pressed="${overview.paused}" title="${pauseLabel}" aria-label="${pauseLabel}"${overview.initialized ? "" : " disabled"}>${overview.paused ? icons.play(15) : icons.pause(15)}</button>
      </footer>
    </section>`;
  }
  var matches = (q, ...fields) => !q || fields.some((f) => f.toLowerCase().includes(q));
  function renderPopoverList(m) {
    const { overview, now } = m;
    if (!overview.initialized) {
      return `
      <div class="empty">
        <p>RenegadeBox keeps a folder on this Mac in sync with storage you own.</p>
        <button id="start-setup-btn" class="btn primary" type="button">Set up RenegadeBox…</button>
      </div>`;
    }
    const q = (m.query ?? "").trim().toLowerCase();
    const noMatch = `<div class="empty"><p>No files match "${escapeHtml(m.query ?? "")}".</p></div>`;
    if ((m.tab ?? "activity") === "recent") {
      const rows = m.recent.map((f, i) => ({ f, i })).filter(({ f }) => matches(q, f.name, f.folder));
      if (m.recent.length === 0)
        return emptyState("Files you edit in your RenegadeBox folder will show up here.");
      if (rows.length === 0)
        return noMatch;
      return `<ul class="recent-list">${rows.map(({ f, i }) => recentRow(f, i, now)).join("")}</ul>`;
    }
    const active = (m.activity?.active ?? []).filter((a) => matches(q, a.name, a.folder));
    const done = (m.activity?.recent ?? []).filter((a) => matches(q, a.name, a.folder));
    const total = (m.activity?.active.length ?? 0) + (m.activity?.recent.length ?? 0);
    if (total === 0)
      return emptyState("Files you add to your RenegadeBox folder will show up here as they sync.");
    if (active.length + done.length === 0)
      return noMatch;
    return `
    ${active.length ? `<h2 class="section-label">Syncing now <span class="section-count">${active.length}</span></h2><ul class="recent-list">${active.map((a) => activityRow(a, now)).join("")}</ul>` : ""}
    ${done.length ? `<h2 class="section-label">${active.length ? "Earlier" : "Recent activity"}</h2><ul class="recent-list">${done.slice(0, 50).map((a) => activityRow(a, now)).join("")}</ul>` : ""}`;
  }
  function emptyState(text) {
    return `
    <div class="empty pop-empty">
      <span class="pop-empty-art">${icons.box(34)}</span>
      <p class="pop-empty-title">It's quiet in here</p>
      <p>${escapeHtml(text)}</p>
    </div>`;
  }
  function shortFolder(folder, n = 2) {
    const parts = folder.split("/").filter(Boolean);
    return parts.slice(-n).join("/") || "RenegadeBox";
  }
  function activityMeta(a, now) {
    const size = a.size ? formatBytes(a.size) : "";
    if (a.status === "active") {
      const verb = a.kind === "download" ? "Downloading" : "Uploading";
      return size ? `${verb} · ${size}` : `${verb}…`;
    }
    const when = relativeTime(a.finished_ms ?? a.started_ms, now);
    const where = a.kind === "moved" ? shortFolder(a.folder) : a.folder ? a.folder.split("/").pop() : "RenegadeBox";
    if (a.status === "failed") {
      const what = a.kind === "download" ? "Download" : a.kind === "upload" ? "Upload" : "Sync";
      return `${what} failed, will retry · ${when}`;
    }
    switch (a.kind) {
      case "upload":
        return `Uploaded to ${where} · ${when}`;
      case "download":
        return `Downloaded to ${where} · ${when}`;
      case "delete_remote":
        return `Deleted, removed from your other devices · ${when}`;
      case "delete_local":
        return `Deleted on another device · ${when}`;
      case "rename_remote":
      case "rename_local":
      case "moved":
        return `Moved to ${where} · ${when}`;
    }
  }
  function activityBadge(a) {
    if (a.status === "active")
      return a.kind === "download" ? icons.arrowDown(14) : icons.arrowUp(14);
    if (a.status === "failed")
      return icons.alert(14);
    if (a.kind === "delete_remote" || a.kind === "delete_local")
      return icons.trash(14);
    return icons.check(14);
  }
  function fileTone(name) {
    const cat = categorizeFile(name);
    if (cat === "images")
      return "img";
    if (cat === "archives")
      return "zip";
    if (cat === "code")
      return "code";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (["xls", "xlsx", "csv", "numbers"].includes(ext))
      return "sheet";
    if (ext === "pdf")
      return "pdf";
    if (["mov", "mp4", "m4v", "avi", "mkv", "mp3", "wav", "m4a"].includes(ext))
      return "media";
    if (["doc", "docx", "txt", "md", "pages", "rtf"].includes(ext))
      return "doc";
    return "file";
  }
  function activityRow(a, now) {
    const deleted = a.kind === "delete_remote" || a.kind === "delete_local";
    const path = escapeHtml(a.path);
    const label = a.status === "active" ? a.kind === "download" ? "Downloading" : "Uploading" : a.status === "failed" ? "Failed" : deleted ? "Deleted" : "Synced";
    return `
    <li class="recent-row act-row act-${a.status}">
      <button class="recent-open" type="button" data-action="open-activity" data-path="${path}" title="${deleted ? escapeHtml(a.name) : `Open ${escapeHtml(a.name)}`}"${deleted ? " disabled" : ""}>
        <span class="file-icon file-tile tone-${fileTone(a.name)}">${fileIcon(a.name)}</span>
        <span class="recent-text">
          <span class="recent-name">${escapeHtml(a.name)}</span>
          <span class="recent-meta">${escapeHtml(activityMeta(a, now))}</span>
          ${a.status === "active" ? `<span class="act-progress" role="progressbar" aria-label="${label} ${escapeHtml(a.name)}"><span></span></span>` : ""}
        </span>
        <span class="act-badge act-badge-${a.status}${deleted ? " act-badge-deleted" : ""}" title="${label}">${activityBadge(a)}</span>
      </button>
      ${deleted || a.status === "active" ? "" : `<button class="reveal-btn" type="button" data-action="reveal-activity" data-path="${path}">Show in Finder</button>`}
    </li>`;
  }
  function recentRow(f, i, now) {
    const where = f.folder ? f.folder.split("/").pop() : "RenegadeBox";
    return `
    <li class="recent-row" data-index="${i}">
      <button class="recent-open" type="button" data-action="open" data-index="${i}" title="Open ${escapeHtml(f.name)}">
        <span class="file-icon file-tile tone-${fileTone(f.name)}">${fileIcon(f.name)}</span>
        <span class="recent-text">
          <span class="recent-name">${escapeHtml(f.name)}</span>
          <span class="recent-meta">Edited in ${escapeHtml(where)} · ${escapeHtml(relativeTime(f.modified_ms, now))}</span>
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
  function renderGoogleButton(opts) {
    if (opts.waiting) {
      return `<p class="google-waiting" role="status" aria-live="polite"><span class="google-waiting-text">Finish signing in in your browser…</span> <button id="${opts.cancelId}" class="link-btn" type="button">Cancel</button></p>`;
    }
    return `<button id="${opts.id}" class="btn google-btn" type="button"${opts.disabled ? " disabled" : ""}><span class="google-mark">${icons.gMark(16)}</span><span>Continue with Google</span></button>`;
  }
  function accountDeviceRows(devices) {
    return devices ? sortDevices(devices) : [];
  }
  function accountMessage(m, slot) {
    const msg = m.message && m.message.slot === slot ? m.message : null;
    return `<p id="account-${slot}-message" class="inline-message${msg?.error ? " error" : ""}" role="status">${msg ? escapeHtml(msg.text) : ""}</p>`;
  }
  function busyButton(m, action, id, label, busyLabel, cls = "btn primary") {
    const busy = m.action === action;
    return `<button id="${id}" class="${cls}" type="submit"${m.action ? " disabled" : ""}${busy ? ' aria-busy="true"' : ""}>${busy ? busyLabel : label}</button>`;
  }
  function renderSignedOutAccount(m) {
    const ready = m.status?.device_ready ?? false;
    const passwordSlot = m.message?.slot === "create" || m.message?.slot === "signin";
    const open = m.showPasswordForms || m.action === "create" || m.action === "signin" || passwordSlot;
    return `
        <section class="group">
          <h2 class="group-title">Account</h2>
          <p class="field-hint account-lede">Sign in with Google here first. After that, any Mac you sign in on sets itself up from this one.</p>
          <div class="group-actions" style="margin-top:0;">
            ${renderGoogleButton({ id: "account-google-btn", waiting: m.action === "google", cancelId: "account-google-cancel", disabled: !!m.action && m.action !== "google" })}
          </div>
          ${accountMessage(m, "google")}
          <button id="account-password-toggle" class="link-btn account-password-toggle" type="button" aria-expanded="${open ? "true" : "false"}" aria-controls="account-password-forms"${open ? " hidden" : ""}>Use email and password instead</button>
        </section>

        <div id="account-password-forms" data-keep-open${open ? "" : " hidden"}>
        <section class="group">
          <h2 class="group-title">Create an account</h2>
          <p class="field-hint account-lede">Sign in on any other Mac and it sets itself up from this one.</p>
          ${ready ? "" : `<p class="field-hint warn">Set up your storage first, then create your account here.</p>`}
          <form id="account-create-form" class="account-form" novalidate>
            <label class="field"><span class="field-label">Email</span>
              <input id="account-create-email" type="email" autocomplete="email" spellcheck="false"${ready ? "" : " disabled"} /></label>
            <label class="field"><span class="field-label">Password</span>
              <input id="account-create-password" type="password" autocomplete="new-password"${ready ? "" : " disabled"} />
              <span class="field-hint">At least ${MIN_ACCOUNT_PASSWORD} characters. A short sentence is easy to remember.</span></label>
            <label class="field"><span class="field-label">Type it again</span>
              <input id="account-create-confirm" type="password" autocomplete="new-password"${ready ? "" : " disabled"} /></label>
            <div class="group-actions">
              ${ready ? busyButton(m, "create", "account-create-btn", "Create account", "Creating your account…") : `<button id="account-create-btn" class="btn primary" type="submit" disabled>Create account</button>`}
            </div>
            ${accountMessage(m, "create")}
          </form>
        </section>

        <section class="group account-signin-small">
          <h2 class="group-title">Already have an account? Sign in</h2>
          <form id="account-signin-form" class="account-form" novalidate>
            <div class="account-inline-fields">
              <label class="field"><span class="field-label">Email</span>
                <input id="account-signin-email" type="email" autocomplete="email" spellcheck="false" /></label>
              <label class="field"><span class="field-label">Password</span>
                <input id="account-signin-password" type="password" autocomplete="current-password" /></label>
            </div>
            <div class="group-actions">
              ${busyButton(m, "signin", "account-signin-btn", "Sign in", "Signing in…", "btn")}
              <span class="field-hint">Links this Mac to your account.</span>
            </div>
            ${accountMessage(m, "signin")}
          </form>
        </section>
        </div>`;
  }
  function renderDeviceList(m) {
    const rows = accountDeviceRows(m.devices);
    if (m.devices === null) {
      if (m.devicesError)
        return `<p class="field-hint account-quiet-error" role="status">${escapeHtml(m.devicesError)}</p>`;
      return `<p class="field-hint" role="status">Loading your Macs…</p>`;
    }
    if (rows.length === 0)
      return `<p class="field-hint">No Macs are signed in.</p>`;
    const now = m.now ?? Date.now();
    const items = rows.map((d, i) => {
      const removing = m.action === "remove" && m.removingIndex === i;
      const actions = d.current ? "" : `<button class="btn account-remove-btn" type="button" data-remove-device="${i}"${m.action ? " disabled" : ""}>${removing ? "Removing…" : "Remove"}</button>`;
      const confirm = d.current ? "" : `
            <div id="account-remove-confirm-${i}" class="confirm account-device-confirm" data-keep-open hidden>
              <p>Remove ${escapeHtml(d.name)} from your account? That Mac will be signed out. Its files stay where they are.</p>
              <div class="confirm-actions">
                <button class="btn" type="button" data-remove-cancel="${i}">Cancel</button>
                <button class="btn danger" type="button" data-remove-confirm="${i}">Remove Mac</button>
              </div>
            </div>`;
      return `
          <li class="account-device${d.current ? " current" : ""}">
            <div class="account-device-row">
              <span class="account-device-icon">${icons.monitor(16)}</span>
              <span class="account-device-text">
                <span class="account-device-name">${escapeHtml(d.name)}</span>
                <span class="field-hint">${escapeHtml(deviceMeta(d, now))}</span>
              </span>
              ${actions}
            </div>${confirm}
          </li>`;
    }).join("");
    return `<ul class="account-devices">${items}</ul>`;
  }
  function renderSignedInAccount(m) {
    const email = m.status?.email ?? "";
    const google = m.status?.provider === "google";
    return `
        <section class="group">
          <h2 class="group-title">Account</h2>
          <p class="account-signed-in">${google ? "Signed in with Google as" : "Signed in as"} <strong>${escapeHtml(email)}</strong></p>
        </section>

        <section class="group">
          <h2 class="group-title">Your Macs</h2>
          ${renderDeviceList(m)}
          ${accountMessage(m, "devices")}
        </section>

        ${google ? "" : `<section class="group">
          <h2 class="group-title">Change password</h2>
          <p class="field-hint account-lede">Your other Macs stay signed in.</p>
          <form id="account-password-form" class="account-form" novalidate>
            <label class="field"><span class="field-label">New password</span>
              <input id="account-new-password" type="password" autocomplete="new-password" />
              <span class="field-hint">At least ${MIN_ACCOUNT_PASSWORD} characters.</span></label>
            <label class="field"><span class="field-label">Type it again</span>
              <input id="account-new-password-confirm" type="password" autocomplete="new-password" /></label>
            <div class="group-actions">
              ${busyButton(m, "password", "account-password-btn", "Change password", "Changing password…", "btn")}
            </div>
            ${accountMessage(m, "password")}
          </form>
        </section>`}

        <section class="group">
          <h2 class="group-title">Sign out</h2>
          <div class="group-actions" style="margin-top:0;">
            <button id="account-signout-btn" class="btn" type="button"${m.action ? " disabled" : ""}>${m.action === "signout" ? "Signing out…" : "Sign out"}</button>
          </div>
          <div id="account-signout-confirm" class="confirm" data-keep-open hidden>
            <p>Sign out of your account on this Mac? Your files keep syncing.</p>
            <div class="confirm-actions">
              <button id="account-signout-cancel" class="btn" type="button">Cancel</button>
              <button id="account-signout-confirm-btn" class="btn danger" type="button">Sign out</button>
            </div>
          </div>
          ${accountMessage(m, "signout")}
        </section>`;
  }
  function renderAccountPanel(m) {
    if (!m || !m.status) {
      return `
        <section class="group">
          <h2 class="group-title">Account</h2>
          <p class="field-hint" role="status">Loading your account…</p>
        </section>`;
    }
    return m.status.signed_in ? renderSignedInAccount(m) : renderSignedOutAccount(m);
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
            <input id="key-store-keychain" type="radio" name="key-store" value="keychain"${kind === "keychain" ? " checked" : ""} />
            <span>
              <span class="field-label">System keychain (recommended)</span>
              <span class="field-hint">Protected by macOS. Other apps can't read it without asking.</span>
            </span>
          </label>
          <label class="radio-row">
            <input id="key-store-file" type="radio" name="key-store" value="file"${kind === "file" ? " checked" : ""} />
            <span>
              <span class="field-label">Unprotected file</span>
              <span class="field-hint warn">Not recommended — any app running as you can read it.</span>
            </span>
          </label>
          <div id="key-store-confirm" class="confirm" data-keep-open hidden>
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
  function renderSettings({ status, autostart, ignored, account }, initialTab = "general", hideHeaderTitle = false) {
    const kind = keyStoreKind(status.key_store);
    const row = (label, value) => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-value">${value}</span></div>`;
    const folder = status.folder ?? "Not set up";
    const totalSize = status.total_bytes ? ` · ${formatBytes(status.total_bytes)}` : "";
    const filesCount = status.total_files ? `${status.total_files} files${totalSize}` : "No files synced yet";
    const isTab = (t) => initialTab === t;
    return `
    <main class="settings">
      <header class="settings-window-header">
        ${hideHeaderTitle ? "" : `<h1 class="window-title">Settings</h1>`}
        <nav class="settings-tabs" role="tablist">
          <button class="tab-btn${isTab("general") ? " active" : ""}" data-tab="general" role="tab" type="button">${icons.gear(16)}<span>General</span></button>
          <button class="tab-btn${isTab("account") ? " active" : ""}" data-tab="account" role="tab" type="button">${icons.user(16)}<span>Account</span></button>
          <button class="tab-btn${isTab("storage") ? " active" : ""}" data-tab="storage" role="tab" type="button">${icons.box(16)}<span>Storage</span></button>
          <button class="tab-btn${isTab("security") ? " active" : ""}" data-tab="security" role="tab" type="button">${icons.lock(16)}<span>Security</span></button>
          <button class="tab-btn${isTab("ignored") ? " active" : ""}" data-tab="ignored" role="tab" type="button">${icons.doc(16)}<span>Ignored</span></button>
        </nav>
      </header>

      <div id="tab-panel-general" class="tab-panel${isTab("general") ? " active" : ""}" data-panel="general">
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
          <div class="kv">
            <span class="kv-label">Finder badges</span>
            <span class="kv-value" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span class="field-hint" style="margin:0;">Status badges in Finder</span>
              <button id="finder-extension-btn" class="btn" style="padding:3px 8px; font-size:12px;" type="button">Enable in macOS…</button>
            </span>
          </div>
          <label class="switch-row">
            <span>
              <span class="field-label">Start at login</span>
              <span class="field-hint">Keep your files in sync without opening RenegadeBox.</span>
            </span>
            <input id="autostart-toggle" class="switch" type="checkbox" role="switch"${autostart ? " checked" : ""} />
          </label>
          <div class="field" style="margin-top: 14px;">
            <span class="field-label">Appearance</span>
            <span class="field-hint">Choose whether RenegadeBox uses light, dark, or system appearance.</span>
            <div class="theme-switcher" style="margin-top: 6px; max-width: 280px;" id="general-theme-switcher" role="radiogroup" aria-label="Appearance Theme">
              <button class="theme-btn" data-theme="system" type="button" title="Match macOS system settings">
                ${icons.monitor(14)}<span>System</span>
              </button>
              <button class="theme-btn" data-theme="light" type="button" title="Light theme">
                ${icons.sun(14)}<span>Light</span>
              </button>
              <button class="theme-btn" data-theme="dark" type="button" title="Dark theme">
                ${icons.moon(14)}<span>Dark</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      <div id="tab-panel-account" class="tab-panel${isTab("account") ? " active" : ""}" data-panel="account">
        ${renderAccountPanel(account)}
      </div>

      <div id="tab-panel-storage" class="tab-panel${isTab("storage") ? " active" : ""}" data-panel="storage">
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

      <div id="tab-panel-security" class="tab-panel${isTab("security") ? " active" : ""}" data-panel="security">
        <section class="group">
          <h2 class="group-title">Key storage</h2>
          <p class="field-hint">Where this Mac keeps the keys that unlock your files.</p>
          <label class="radio-row">
            <input id="key-store-keychain" type="radio" name="key-store" value="keychain"${kind === "keychain" ? " checked" : ""} />
            <span>
              <span class="field-label">System keychain (recommended)</span>
              <span class="field-hint">Protected by macOS. Other apps can't read it without asking.</span>
            </span>
          </label>
          <label class="radio-row">
            <input id="key-store-file" type="radio" name="key-store" value="file"${kind === "file" ? " checked" : ""} />
            <span>
              <span class="field-label">Unprotected file</span>
              <span class="field-hint warn">Not recommended — any app running as you can read it.</span>
            </span>
          </label>
          <div id="key-store-confirm" class="confirm" data-keep-open hidden>
            <p>Store your keys in an unprotected file? Any app running as you can read it — and anyone who can read it can open your files.</p>
            <div class="confirm-actions">
              <button id="key-store-cancel" class="btn" type="button">Cancel</button>
              <button id="key-store-confirm-btn" class="btn danger" type="button">Use unprotected file</button>
            </div>
          </div>
          <p id="key-store-message" class="inline-message" role="status"></p>
        </section>
      </div>

      <div id="tab-panel-ignored" class="tab-panel${isTab("ignored") ? " active" : ""}" data-panel="ignored">
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
  function renderRouteDecisionCard(decision) {
    const confPercent = Math.round(decision.confidence * 100);
    const badgeClass = confPercent >= 80 ? "ok" : confPercent >= 60 ? "warn" : "attention";
    return `
    <div class="decision-card">
      <div class="decision-header">
        <div class="decision-file-info">
          <span class="decision-file-icon">${icons.doc(18)}</span>
          <div class="decision-file-names">
            <span class="decision-filename">${escapeHtml(decision.suggested_filename)}</span>
            <span class="decision-dest-path">${icons.folder(12)}<span>Destination: ${escapeHtml(decision.destination_folder)}</span></span>
          </div>
        </div>
        <div class="decision-badge ${badgeClass}">
          ${confPercent}% Confidence
        </div>
      </div>
      <div class="decision-body">
        <div class="decision-reason">
          <span class="reason-label">Reasoning:</span>
          <span class="reason-text">${escapeHtml(decision.explanation)}</span>
        </div>
        ${confPercent < 70 ? `<div class="decision-reason"><span class="reason-label">Would go to review:</span><span class="reason-text">Below 70% confidence, so a real drop would wait in _Needs Review instead of moving.</span></div>` : ""}
        ${decision.suggested_rule ? `<div class="decision-reason"><span class="reason-label">Suggested rule:</span><code class="reason-text">${escapeHtml(String(decision.suggested_rule))}</code></div>` : ""}
      </div>
    </div>`;
  }
  var ROUTING_ROLES = [
    {
      id: "webdev",
      title: "Web Developer & Hosting",
      badge: "Web Hosting",
      tagline: "Automate SpinupWP, WP Engine, Pressable, cPanel & SQL database backups",
      icon: (s) => icons.code(s ?? 16),
      placeholder: "e.g. Put SpinupWP tar.gz and sql.gz in Backups From Spinup, WP Engine archives in Backups From WPEngine, Pressable backups in Backups From Pressable, and cPanel in Backups From cPanel",
      recommendedFolders: ["Backups From Spinup", "Backups From WPEngine", "Backups From Pressable", "Backups From cPanel", "Backups From DigitalOcean", "Database Backups"],
      chips: [
        { label: "+ SpinupWP", preset: "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup" },
        { label: "+ WP Engine", preset: "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine" },
        { label: "+ Pressable", preset: "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable" },
        { label: "+ cPanel", preset: "cPanel website backups (backup-*.tar.gz) go to Backups From cPanel" },
        { label: "+ DigitalOcean", preset: "DigitalOcean server and database backups (*.sql.gz) go to Backups From DigitalOcean" },
        { label: "+ SQL Dumps", preset: "Raw MySQL and Postgres database dumps (*.sql, *.sql.gz) go to Database Backups" },
        { label: "+ Local WP Exports", preset: "All-in-One WP and local site exports (*.wpress, *.tar) go to Local Sites & Exports" }
      ]
    },
    {
      id: "agency",
      title: "Freelance & Agency",
      badge: "Business & Clients",
      tagline: "Organize client contracts, invoices, tax forms, and expense receipts",
      icon: (s) => icons.doc(s ?? 16),
      placeholder: "e.g. Route invoices and receipts into Finance/Invoices, client contracts into Work/Contracts, and IRS forms into Finance/Taxes",
      recommendedFolders: ["Finance/Invoices", "Work/Contracts", "Finance/Taxes", "Finance/Receipts", "Work/Deliverables"],
      chips: [
        { label: "+ Invoices", preset: "Client invoices, vendor bills, and billing statements go to Finance/Invoices" },
        { label: "+ Taxes", preset: "Tax forms (W-2, 1099, K-1) and IRS filings go to Finance/Taxes" },
        { label: "+ Contracts", preset: "Client proposals, SOWs, NDAs, and agreements go to Work/Contracts" },
        { label: "+ Receipts", preset: "Expense receipts, software subscriptions, and hardware purchases go to Finance/Receipts" },
        { label: "+ Deliverables", preset: "Client deliverables, slide decks, and final assets go to Work/Deliverables" }
      ]
    },
    {
      id: "creative",
      title: "Creative & Media Studio",
      badge: "Media Studio",
      tagline: "Sort 4K video footage, RAW photography, audio stems, and design assets",
      icon: (s) => icons.image(s ?? 16),
      placeholder: "e.g. Put camera RAWs into Media/Photos, 4K b-roll into Media/Footage, and audio stems into Media/Audio",
      recommendedFolders: ["Media/Photos", "Media/Footage", "Media/Audio", "Creative/Assets", "Creative/Projects"],
      chips: [
        { label: "+ RAW Photos", preset: "Camera RAW photos (CR3, ARW, NEF) and edits go to Media/Photos" },
        { label: "+ 4K Footage", preset: "Video footage, b-roll, and exports (MOV, MP4) go to Media/Footage" },
        { label: "+ Audio Stems", preset: "Audio recordings, podcasts, and WAV stems go to Media/Audio" },
        { label: "+ Design Files", preset: "Figma, Illustrator, and Photoshop projects (PSD, AI) go to Creative/Assets" }
      ]
    },
    {
      id: "personal",
      title: "Personal & Family Archive",
      badge: "Home & Life",
      tagline: "Preserve family photos, home deeds, medical records, and travel docs",
      icon: (s) => icons.box(s ?? 16),
      placeholder: "e.g. Sort family photos by year into Family/Photos, health records into Personal/Health, and mortgage docs into Home/Property",
      recommendedFolders: ["Family/Photos", "Personal/Health", "Home/Property", "Personal/Travel", "Personal/Finances"],
      chips: [
        { label: "+ Family Photos", preset: "Family photos and mobile uploads go to Family/Photos" },
        { label: "+ Health & Medical", preset: "Medical records, doctor charts, and lab results go to Personal/Health" },
        { label: "+ Home & Auto", preset: "Mortgage, lease, home maintenance, and car titles go to Home/Property" },
        { label: "+ Passports & Travel", preset: "Boarding passes, hotel reservations, and passports go to Personal/Travel" }
      ]
    }
  ];
  var DEFAULT_ROLE_RULES = {
    webdev: [
      "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup",
      "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine",
      "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable",
      "cPanel website backups (backup-*.tar.gz) go to Backups From cPanel",
      "DigitalOcean server and database backups (*.sql.gz) go to Backups From DigitalOcean",
      "Raw MySQL and Postgres database dumps (*.sql, *.sql.gz) go to Database Backups",
      "All-in-One WP and local site exports (*.wpress, *.tar) go to Local Sites & Exports"
    ],
    agency: [
      "Client invoices, vendor bills, and billing statements go to Finance/Invoices",
      "Tax forms (W-2, 1099, K-1) and IRS filings go to Finance/Taxes",
      "Client proposals, SOWs, NDAs, and agreements go to Work/Contracts",
      "Expense receipts, software subscriptions, and hardware purchases go to Finance/Receipts",
      "Client deliverables, slide decks, and final assets go to Work/Deliverables"
    ],
    creative: [
      "Camera RAW photos (CR3, ARW, NEF) and edits go to Media/Photos",
      "Video footage, b-roll, and exports (MOV, MP4) go to Media/Footage",
      "Audio recordings, podcasts, and WAV stems go to Media/Audio",
      "Figma, Illustrator, and Photoshop projects (PSD, AI) go to Creative/Assets"
    ],
    personal: [
      "Family photos and mobile uploads go to Family/Photos",
      "Medical records, doctor charts, and lab results go to Personal/Health",
      "Mortgage, lease, home maintenance, and car titles go to Home/Property",
      "Boarding passes, hotel reservations, and passports go to Personal/Travel"
    ]
  };
  function renderAiVerificationBox(v) {
    const parts = v.optimizedRule.split(/\s+go\s+to\s+/i);
    const trigger = parts[0]?.trim() || v.optimizedRule;
    const dest = parts[1]?.trim() || (v.matchedDestination ?? "Unsorted");
    const conf = typeof v.confidence === "number" && v.confidence > 0 ? Math.round(v.confidence * 100) : null;
    return `
    <div class="ai-verify-card">
      <div class="ai-verify-header">
        <div class="ai-verify-badge">${icons.sparkles(13)}<span>AI Verified &amp; Formatted</span></div>
        ${conf !== null ? `<span class="ai-confidence-badge">${conf}% confidence</span>` : ""}
      </div>
      <div class="ai-verify-rule-row">
        <span class="ai-verify-label">Optimized Rule:</span>
        <code class="ai-verify-code"><strong>${escapeHtml(trigger)}</strong> &rarr; <span class="ai-dest-tag">${icons.folder(11)}<span>${escapeHtml(dest)}</span></span></code>
      </div>
      ${v.sampleTestFile ? `
        <div class="ai-verify-sim">
          <span class="ai-verify-sim-icon">${icons.check(12)}</span>
          <span>Verified against test file <code>${escapeHtml(v.sampleTestFile)}</code> &rarr; routes to <strong>${escapeHtml(dest)}</strong></span>
        </div>` : ""}
      <div class="ai-verify-actions">
        <button type="button" id="routing-apply-verified-btn" class="btn small primary" data-verified-rule="${escapeHtml(v.optimizedRule)}">
          ${icons.check(12)}<span>Apply &amp; Add Rule</span>
        </button>
        <button type="button" id="routing-dismiss-verified-btn" class="btn small">Dismiss</button>
      </div>
    </div>
  `;
  }
  function renderRuleCheckBox(c, canApply) {
    const ok = c.parses && c.destination_safe && c.sample_matches && !c.shadowed_by && (!c.is_vault || c.vault_enabled);
    const existsText = c.destination_exists === null ? "Destination not reachable right now" : c.destination_exists ? "Destination folder exists" : "Destination folder will be created on first use";
    const problems = (c.problems || []).map((p) => `<li>${escapeHtml(p)}</li>`).join("");
    return `
    <div class="ai-verify-card">
      <div class="ai-verify-header">
        <div class="ai-verify-badge">${icons.check(13)}<span>Rule Check</span></div>
        <span class="ai-confidence-badge">${ok ? "Looks good" : "Needs attention"}</span>
      </div>
      <div class="ai-verify-rule-row">
        <span class="ai-verify-label">Rule:</span>
        <code class="ai-verify-code"><strong>${escapeHtml(c.trigger || c.rule)}</strong> &rarr; <span class="ai-dest-tag">${icons.folder(11)}<span>${escapeHtml(c.destination || "?")}</span></span></code>
      </div>
      <div class="ai-verify-sim">
        <span class="ai-verify-sim-icon">${c.sample_matches ? icons.check(12) : icons.alert(12)}</span>
        <span>Sample file <code>${escapeHtml(c.sample_file || "-")}</code> ${c.sample_matches ? "matches this rule" : "does not match"}${c.parses ? ` &bull; ${escapeHtml(existsText)}` : ""}${c.is_vault ? " &bull; Sends to encrypted vault (S3)" : ""}</span>
      </div>
      ${c.shadowed_by ? `<p class="field-hint" style="color: var(--warn, #f59e0b);">An earlier rule catches the sample file first: <code>${escapeHtml(c.shadowed_by)}</code>. Move this rule above it or make it more specific.</p>` : ""}
      ${problems ? `<ul class="rule-check-problems">${problems}</ul>` : ""}
      <p class="field-hint">Checked locally against your rules. No AI call, no cost.</p>
      <div class="ai-verify-actions">
        ${canApply ? `<button type="button" id="routing-apply-verified-btn" class="btn small primary" data-verified-rule="${escapeHtml(c.rule)}">${icons.check(12)}<span>Add Rule</span></button>` : ""}
        <button type="button" id="routing-dismiss-verified-btn" class="btn small">Dismiss</button>
      </div>
    </div>
  `;
  }
  function friendlyReviewReason(reason) {
    const r = (reason || "").trim();
    if (!r)
      return "Needs a decision";
    if (/^Move failed/i.test(r) || /source kept at/i.test(r)) {
      if (/permission denied|os error 13/i.test(r))
        return "Copy to the destination was refused (permission denied)";
      if (/no space|os error 28/i.test(r))
        return "Destination is out of space";
      if (/no such file|os error 2\b/i.test(r))
        return "Destination folder went missing during the copy";
      if (/size mismatch/i.test(r))
        return "Copy did not match the original, so it was not finished";
      return "Copy to the destination failed";
    }
    if (/^AI call failed/i.test(r))
      return "The AI could not be reached";
    return r.replace(/\/(?:Users|Volumes)\/[^\s:]+/g, "...").slice(0, 120);
  }
  function renderReviewQueueSection(items, useFolder = true, routeNames = {}) {
    const safe = Array.isArray(items) ? items : [];
    if (safe.length === 0)
      return "";
    const withSuggestion = safe.filter((it) => (it.suggested_folder || "").trim()).length;
    const where = useFolder ? "_Needs Review" : "the drop folder";
    const rows = safe.slice(0, 30).map((it) => {
      const conf = typeof it.confidence === "number" && !/% sure/i.test(it.reason || "") ? ` · AI ${Math.round(it.confidence * 100)}% sure` : "";
      const routeName = it.route_id && it.route_id !== "main" ? routeNames[it.route_id] || "Deleted route" : "";
      const routeTag = routeName ? ` · ${routeName}` : "";
      return `
      <li class="review-row">
        <div class="review-row-top">
          <span class="file-icon">${fileIcon(it.filename)}</span>
          <div class="review-row-text">
            <div class="review-row-name" title="${escapeHtml(it.path)}">${escapeHtml(it.filename)}</div>
            <div class="review-row-why" title="${escapeHtml(it.explanation || it.reason)}">${escapeHtml(friendlyReviewReason(it.reason))}<span class="review-row-meta"> · ${escapeHtml(formatBytes(it.file_size_bytes || 0))}${escapeHtml(conf)}${escapeHtml(routeTag)}</span></div>
          </div>
        </div>
        <div class="review-row-actions">
          <label class="review-folder-wrap" title="Folder inside the destination">
            ${icons.folder(12)}
            <input type="text" class="input-field small review-folder-input" id="review-folder-${escapeHtml(it.id)}" value="${escapeHtml(it.suggested_folder || "")}" placeholder="Folder, e.g. Documents/Misc" aria-label="Move ${escapeHtml(it.filename)} to folder" />
          </label>
          <span class="review-row-buttons">
            <button class="btn tiny primary review-approve-btn" type="button" data-review-id="${escapeHtml(it.id)}">Move</button>
            <button class="btn tiny secondary nas-reveal-btn" type="button" data-reveal-nas-path="${escapeHtml(it.path)}">Reveal</button>
            <button class="btn tiny secondary review-dismiss-btn" type="button" data-review-id="${escapeHtml(it.id)}" title="Remove from list; the file stays in ${escapeHtml(where)}">Dismiss</button>
          </span>
        </div>
      </li>`;
    }).join("");
    return `
    <section class="routing-section routing-review-card" id="routing-review-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-icon">${icons.alert(16)}</span>
          <span class="section-title">Needs Review</span>
          <span class="badge warn">${safe.length} waiting</span>
        </div>
        ${withSuggestion > 1 ? `<button type="button" id="review-move-all-btn" class="btn small primary">${icons.arrowRight(12)}<span>Move all (${withSuggestion})</span></button>` : ""}
      </div>
      <p class="field-hint" style="margin-bottom:10px;">Not moved yet. ${useFolder ? "They are in the <code>_Needs Review</code> folder inside your drop folder." : "They are still in your drop folder and will not be retried until you move or dismiss them."} Check the folder and click Move. Hover a reason for the full details.</p>
      <ul class="review-list">${rows}</ul>
      ${safe.length > 30 ? `<p class="field-hint">Showing 30 of ${safe.length}.</p>` : ""}
    </section>`;
  }
  function renderRuleSuggestionsSection(items) {
    const safe = Array.isArray(items) ? items : [];
    if (safe.length === 0)
      return "";
    const rows = safe.slice(0, 10).map((s) => `
    <div class="rule-card suggestion-card">
      <div class="rule-card-left">
        <span class="rule-icon">${icons.sparkles(14)}</span>
        <span class="rule-trigger" title="${escapeHtml(s.rule)}">${escapeHtml(s.rule)}</span>
      </div>
      <div class="rule-card-right">
        <span class="field-hint" title="Learned from this file">from ${escapeHtml(s.example_file)}</span>
        <div class="rule-actions-inline">
          <button type="button" class="btn tiny primary suggestion-accept-btn" data-suggestion-id="${escapeHtml(s.id)}" data-suggestion-rule="${escapeHtml(s.rule)}">Add Rule</button>
          <button type="button" class="btn tiny secondary suggestion-dismiss-btn" data-suggestion-id="${escapeHtml(s.id)}">Dismiss</button>
        </div>
      </div>
    </div>`).join("");
    return `
    <section class="routing-section routing-suggestions-card" id="routing-suggestions-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-icon sparkles">${icons.sparkles(16)}</span>
          <span class="section-title">Suggested Rules</span>
          <span class="count-badge">${safe.length}</span>
        </div>
      </div>
      <p class="field-hint" style="margin-bottom:10px;">The AI proposed these after placing files no rule covered. Adding one means similar files are routed locally next time, with no AI call and no cost.</p>
      <div class="rules-deck-list">${rows}</div>
    </section>`;
  }
  var EMPTY_AI_USAGE = {
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    byOperation: [],
    byModel: [],
    recentEntries: []
  };
  function renderAiUsageSection(usage) {
    const formattedCost = usage.totalCostUsd < 0.01 ? `$${usage.totalCostUsd.toFixed(4)} USD` : `$${usage.totalCostUsd.toFixed(3)} USD`;
    const providerReported = usage.providerReportedRequests ?? 0;
    const legacyExcluded = usage.legacyExcluded ?? 0;
    const costSourceNote = usage.totalRequests > 0 ? `${providerReported} of ${usage.totalRequests} costs reported by the provider; the rest are estimated from real token counts x published prices.` : "Costs come from the provider when it reports them, otherwise from real token counts x published prices.";
    const opColors = {
      rule_translation: "var(--color-accent, #3b82f6)",
      suggest_rules: "#10b981",
      file_routing: "#8b5cf6",
      verify_rule: "#f59e0b"
    };
    const byOp = Array.isArray(usage?.byOperation) ? usage.byOperation : [];
    const opBarsHtml = byOp.length > 0 ? `
      <div class="api-usage-distribution-bar">
        ${byOp.map((b) => {
      const color = opColors[b.operation] || "#6366f1";
      return `<div class="distribution-segment" style="width: ${Math.max(b.percentageOfTotal, 4)}%; background-color: ${color};" title="${escapeHtml(b.label)}: ${b.percentageOfTotal.toFixed(1)}% (${b.totalTokens.toLocaleString()} tokens)"></div>`;
    }).join("")}
      </div>` : "";
    const opCardsHtml = byOp.map((b) => {
      const color = opColors[b.operation] || "#6366f1";
      const opCost = b.estimatedCostUsd < 0.01 ? `$${b.estimatedCostUsd.toFixed(4)}` : `$${b.estimatedCostUsd.toFixed(3)}`;
      return `
      <div class="api-breakdown-row">
        <div class="api-breakdown-info">
          <div class="api-indicator-dot" style="background-color: ${color};"></div>
          <div class="api-name-col">
            <span class="api-title">${escapeHtml(b.label)}</span>
            <span class="api-subtext">${b.requests} request${b.requests === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div class="api-breakdown-stats">
          <div class="api-token-vol">${b.totalTokens.toLocaleString()} <span class="unit">tok</span></div>
          <div class="api-cost-pill">${opCost}</div>
          <div class="api-pct-badge">${b.percentageOfTotal.toFixed(1)}%</div>
        </div>
      </div>
    `;
    }).join("");
    const byModel = Array.isArray(usage?.byModel) ? usage.byModel : [];
    const modelPillsHtml = byModel.map((m) => {
      const mCost = m.estimatedCostUsd < 0.01 ? `$${m.estimatedCostUsd.toFixed(4)}` : `$${m.estimatedCostUsd.toFixed(3)}`;
      return `
      <div class="model-usage-chip">
        <span class="model-name">${escapeHtml(m.model)}</span>
        <span class="model-tokens">${m.totalTokens.toLocaleString()} tok</span>
        <span class="model-cost">${mCost}</span>
      </div>
    `;
    }).join("");
    const recentEntries = Array.isArray(usage?.recentEntries) ? usage.recentEntries : Array.isArray(usage?.recentCalls) ? usage.recentCalls : [];
    const recentRowsHtml = recentEntries.length === 0 ? `<div class="empty-ledger-state"><p>No API activity recorded yet.</p></div>` : recentEntries.slice(0, 15).map((e) => {
      const timeAgo = relativeTime(e.timestamp);
      const baseCost = e.estimatedCostUsd < 0.01 ? `$${e.estimatedCostUsd.toFixed(4)}` : `$${e.estimatedCostUsd.toFixed(3)}`;
      const costStr = e.costSource === "provider" ? baseCost : e.costSource === "legacy" ? `${baseCost} (excluded)` : `${baseCost} est.`;
      return `
          <tr class="ledger-row">
            <td class="ledger-time" title="${new Date(e.timestamp).toLocaleString()}">${escapeHtml(timeAgo)}</td>
            <td class="ledger-op"><span class="op-badge op-${escapeHtml(e.operation)}">${escapeHtml(e.operationLabel)}</span></td>
            <td class="ledger-model"><code>${escapeHtml(e.model.split("/").pop() || e.model)}</code></td>
            <td class="ledger-tokens"><strong>${e.totalTokens.toLocaleString()}</strong> <span class="split">(${e.promptTokens}+${e.completionTokens})</span></td>
            <td class="ledger-cost">${costStr}</td>
            <td class="ledger-summary" title="${escapeHtml(e.summary)}">${escapeHtml(e.summary)}</td>
          </tr>
        `;
    }).join("");
    return `
    <section class="routing-section routing-usage-card" id="ai-usage-ledger-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-icon chart">${icons.chart(16)}</span>
          <span class="section-title">AI API Usage &amp; Cost Analytics</span>
          <span class="badge ok">Live Ledger</span>
        </div>
        <div class="usage-header-actions">
          <button id="ai-usage-clear-btn" class="btn small" type="button" title="Reset API usage history">Clear Ledger</button>
          <button id="ai-usage-refresh-btn" class="btn small" type="button" title="Refresh usage data">${icons.sync(12)}<span>Refresh</span></button>
        </div>
      </div>

      <!-- Top Level Metrics Grid -->
      <div class="usage-metrics-grid">
        <div class="usage-metric-card">
          <span class="metric-label">Total Cost (provider-reported + estimated)</span>
          <span class="metric-val primary">${formattedCost}</span>
          <span class="metric-sub">${escapeHtml(costSourceNote)}</span>
        </div>
        <div class="usage-metric-card">
          <span class="metric-label">Total Tokens Billed</span>
          <span class="metric-val">${usage.totalTokens.toLocaleString()}</span>
          <span class="metric-sub">${usage.totalPromptTokens.toLocaleString()} prompt &bull; ${usage.totalCompletionTokens.toLocaleString()} comp</span>
        </div>
        <div class="usage-metric-card">
          <span class="metric-label">Total API Calls</span>
          <span class="metric-val">${usage.totalRequests}</span>
          <span class="metric-sub">Across all workflows</span>
        </div>
      </div>

      ${legacyExcluded > 0 ? `<p class="field-hint" style="margin:8px 0;">${legacyExcluded} older placeholder entr${legacyExcluded === 1 ? "y is" : "ies are"} excluded from these totals because they were not real API calls. Clear Ledger removes them.</p>` : ""}

      <!-- Breakdown by API / Operation (Which API uses more) -->
      <div class="usage-section-subtitle-wrap">
        <span class="usage-subtitle">API Operation Breakdown</span>
        <span class="field-hint">Comparing token volume and cost across individual AI capabilities</span>
      </div>

      ${opBarsHtml}

      <div class="api-breakdown-list">
        ${opCardsHtml}
      </div>

      <!-- Models Breakdown -->
      ${byModel.length > 0 ? `
        <div class="models-breakdown-bar">
          <span class="models-label">Usage by Model:</span>
          <div class="model-chips-list">
            ${modelPillsHtml}
          </div>
        </div>
      ` : ""}

      <!-- Recent Request Activity Ledger -->
      <div class="usage-ledger-wrap">
        <div class="ledger-header-row">
          <span class="ledger-title">Recent API Requests</span>
          <span class="ledger-count">${recentEntries.length} logged calls</span>
        </div>
        <div class="ledger-table-container">
          <table class="ledger-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Operation</th>
                <th>Model</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              ${recentRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;
  }
  function renderNasTransfersSection(transfers = []) {
    const safeTransfers = Array.isArray(transfers) ? transfers : [];
    const rows = safeTransfers.length === 0 ? `<tr class="ledger-row empty"><td colspan="6" class="empty-ledger-state"><p>No files moved yet. Drop files into your drop folder to start routing them to the destination folder.</p></td></tr>` : safeTransfers.slice(0, 20).map((t) => {
      if (!t)
        return "";
      const timeAgo = relativeTime(t.timestamp || Date.now());
      const sizeStr = formatBytes(t.file_size_bytes || 0);
      const statusBadge = t.status === "relocated" ? `<span class="badge warning">Relocated</span>` : t.status === "reverted" ? `<span class="badge danger">In Review</span>` : `<span class="badge ok">Moved</span>`;
      const isVault = (t.destination_folder || "").startsWith("vault:");
      const destFolder = t.destination_folder || (t.destination_path ? splitPath(t.destination_path).folder : "Backups");
      const destPath = t.destination_path || destFolder;
      const ruleMatched = t.rule_matched || "Rule Applied";
      const filename = t.filename || (t.source_path ? splitPath(t.source_path).name : "file");
      return `
          <tr class="ledger-row nas-transfer-row">
            <td class="ledger-time" title="${new Date(t.timestamp || Date.now()).toLocaleString()}">${escapeHtml(timeAgo)}</td>
            <td class="ledger-file">
              <div class="file-name-cell">
                <span class="file-icon">${fileIcon(filename)}</span>
                <span class="file-name-text" title="${escapeHtml(filename)}">${escapeHtml(filename)}</span>
                <span class="file-size-hint">${escapeHtml(sizeStr)}</span>
              </div>
            </td>
            <td class="ledger-dest">
              <span class="nas-dest-pill" title="${escapeHtml(destPath)}">${escapeHtml(destFolder)}</span>
            </td>
            <td class="ledger-rule" title="${escapeHtml(ruleMatched)}">
              <span class="rule-matched-text">${escapeHtml(ruleMatched)}</span>
            </td>
            <td class="ledger-status">${statusBadge}</td>
            <td class="ledger-actions-cell" style="text-align: right;">
              <button class="btn tiny secondary nas-reveal-btn" type="button" data-reveal-nas-path="${escapeHtml(destPath)}" title="Reveal in Finder">
                ${icons.folder(11)}<span>Reveal</span>
              </button>
              ${isVault ? "" : `<button class="btn tiny secondary nas-relocate-btn" type="button" data-relocate-id="${escapeHtml(t.id || "")}" data-relocate-file="${escapeHtml(filename)}" data-relocate-folder="${escapeHtml(destFolder)}" title="Move to another folder inside the destination">
                ${icons.arrowRight(11)}<span>Move To…</span>
              </button>`}
              <button class="btn tiny secondary nas-revert-btn" type="button" data-revert-id="${escapeHtml(t.id || "")}" data-revert-file="${escapeHtml(filename)}" title="Move file back to the _Needs Review folder">
                ${icons.undo(11)}<span>Undo</span>
              </button>
            </td>
          </tr>
        `;
    }).join("");
    return `
    <section class="routing-section routing-transfers-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-icon folder">${icons.folder(16)}</span>
          <span class="section-title">Transfer history</span>
          <span class="badge ok">${safeTransfers.length} Recorded</span>
        </div>
        <div class="usage-header-actions">
          <button id="nas-clear-transfers-btn" class="btn small" type="button" title="Clear transfer history log">Clear Log</button>
          <button id="nas-refresh-transfers-btn" class="btn small" type="button" title="Refresh transfer history">${icons.sync(12)}<span>Refresh</span></button>
        </div>
      </div>
      <p class="field-hint" style="margin-bottom: 12px;">
        Where every routed file was placed. If a file landed in the wrong place, click <strong>Move To…</strong> to relocate it inside the destination, or <strong>Undo</strong> to move it to the review folder.
      </p>

      <div class="ledger-table-wrap">
        <table class="ledger-table nas-transfers-table">
          <thead>
            <tr>
              <th style="width: 100px;">Time</th>
              <th>File</th>
              <th>Destination</th>
              <th>Rule Applied</th>
              <th style="width: 85px;">Status</th>
              <th style="width: 200px; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </section>
  `;
  }
  var ROUTE_MODE_LABEL = {
    move: "Move",
    copy: "Copy, keep originals",
    organize: "Organize in place"
  };
  var ROUTE_MODE_HINT = {
    move: "Files are moved to the destination and removed from the watched folder.",
    copy: "Files are copied and the originals stay where they are (good for SD cards). Each file is copied once.",
    organize: "Files are sorted into subfolders of the watched folder itself."
  };
  var ROUTE_TOKENS = ["{year}", "{month}", "{month_name}", "{day}", "{date}", "{ext}", "{source_folder}"];
  function shortPath(p, max = 44) {
    const s = (p || "").replace(/^\/Users\/[^/]+/, "~");
    return s.length > max ? `...${s.slice(-(max - 3))}` : s;
  }
  var ROUTE_CHECK_SECONDS = 15;
  function routeStateChip(r) {
    const c = r.config;
    if (!c.enabled)
      return `<span class="route-chip off">Off</span>`;
    if (r.problems.length > 0)
      return `<span class="route-chip warn">Needs setup</span>`;
    if (!r.source_exists)
      return `<span class="route-chip muted">Waiting for source</span>`;
    if (c.mode !== "organize" && !r.destination_reachable)
      return `<span class="route-chip muted">Waiting for destination</span>`;
    return `<span class="route-chip ok">${c.auto ? "Automatic" : "Manual"}</span>`;
  }
  function routeSchedule(c) {
    if (!c.enabled)
      return "Turned off";
    return c.auto ? `Checks for new files every ${ROUTE_CHECK_SECONDS} seconds` : "Sorts only when you click Sort now";
  }
  function routeCanRun(r) {
    const c = r.config;
    return c.enabled && r.problems.length === 0 && r.source_exists && (c.mode === "organize" || r.destination_reachable);
  }
  function routeRunButton(r) {
    const auto = r.config.enabled && r.config.auto;
    const title = auto ? `This route already checks every ${ROUTE_CHECK_SECONDS} seconds. Click to sort what is waiting right away.` : "Sort the files waiting in this route's folder now";
    return `<button class="btn tiny ${auto ? "subtle" : "secondary"} route-run-btn" type="button" data-route-run="${escapeHtml(r.config.id)}" title="${escapeHtml(title)}"${routeCanRun(r) ? "" : " disabled"}>Sort now</button>`;
  }
  function routeRow(r) {
    const c = r.config;
    const id = escapeHtml(c.id);
    const dest = c.mode === "organize" ? "subfolders of the same folder" : shortPath(c.destination) || "no destination yet";
    const meta = [
      routeSchedule(c),
      `${r.pending_count} waiting`,
      `${r.review_count} in review`,
      `${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}`,
      c.layout ? `layout ${c.layout}` : ""
    ].filter(Boolean).join(" · ");
    return `
    <li class="route-row${c.enabled ? "" : " disabled"}" data-route-row="${id}">
      <button type="button" class="route-row-main route-row-open" data-route-open="${id}" aria-label="Open route ${escapeHtml(c.name)}">
        <span class="route-row-title">
          <span class="route-name">${escapeHtml(c.name)}</span>
          <span class="route-mode">${escapeHtml(ROUTE_MODE_LABEL[c.mode] || c.mode)}</span>
          ${routeStateChip(r)}
        </span>
        <span class="route-row-path" title="${escapeHtml(c.source)} to ${escapeHtml(c.mode === "organize" ? c.source : c.destination)}">
          ${icons.folder(12)}<span>${escapeHtml(shortPath(c.source))}</span>${icons.arrowRight(11)}<span>${escapeHtml(dest)}</span>
        </span>
        <span class="route-row-meta">${escapeHtml(meta)}</span>
        ${r.problems.map((p) => `<span class="route-row-problem">${icons.alert(11)}<span>${escapeHtml(p)}</span></span>`).join("")}
      </button>
      <div class="route-row-actions">
        ${r.is_main ? "" : `<label class="drop-auto-label" title="${c.enabled ? "Turn this route off" : "Turn this route on"}"><input class="switch route-enable-toggle" type="checkbox" role="switch" data-route-enable="${id}"${c.enabled ? " checked" : ""} aria-label="Route ${escapeHtml(c.name)} on" /></label>`}
        ${routeRunButton(r)}
        <span class="route-row-chevron" aria-hidden="true">${icons.chevron(14)}</span>
      </div>
    </li>`;
  }
  function routePageBar(title, status, showRun = true) {
    return `
    <div class="route-page-bar">
      <button id="route-back-btn" class="btn small secondary route-back-btn" type="button">${icons.back(13)}<span>All routes</span></button>
      <div class="route-page-title">
        <h2 class="route-page-name">${escapeHtml(title)}</h2>
        ${status ? `<span class="route-mode">${escapeHtml(ROUTE_MODE_LABEL[status.config.mode] || status.config.mode)}</span>${routeStateChip(status)}<span class="route-page-schedule">${escapeHtml(routeSchedule(status.config))}</span>` : ""}
      </div>
      ${status && showRun ? routeRunButton(status) : ""}
    </div>`;
  }
  function routeSwitch(id, label, checked, title, disabled = false) {
    return `<label class="drop-auto-label${disabled ? " is-disabled" : ""}" title="${escapeHtml(title)}">
      <input id="${id}" class="switch" type="checkbox" role="switch"${checked ? " checked" : ""}${disabled ? " disabled" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>`;
  }
  function renderRouteEditor(editor, templates) {
    const d = editor.draft;
    const organize = d.mode === "organize";
    const copy = d.mode === "copy";
    const modeOption = (m) => `<option value="${m}"${d.mode === m ? " selected" : ""}>${escapeHtml(ROUTE_MODE_LABEL[m])}</option>`;
    const templateButtons = editor.isNew ? `<div class="route-templates" role="group" aria-label="Start from a template">
        ${templates.map((t) => `
          <button type="button" class="route-template${d.template === t.id ? " active" : ""}" data-route-template="${escapeHtml(t.id)}">
            <strong>${escapeHtml(t.name)}</strong>
            <span>${escapeHtml(t.description)}</span>
          </button>`).join("")}
      </div>` : "";
    return `
    <div class="route-editor" id="route-editor">
      <div class="route-editor-title">${editor.isNew ? "New route" : "Route settings"}</div>
      ${templateButtons}
      <div class="route-form-grid">
        <label class="route-field">
          <span class="route-field-label">Name</span>
          <input id="route-name" class="input-field small" type="text" value="${escapeHtml(d.name)}" placeholder="e.g. Photography" />
        </label>
        <label class="route-field">
          <span class="route-field-label">What it does</span>
          <select id="route-mode" class="input-field small">${["move", "copy", "organize"].map(modeOption).join("")}</select>
        </label>
        <p class="field-hint route-field wide">${escapeHtml(ROUTE_MODE_HINT[d.mode] || "")}</p>
        <div class="route-field wide">
          <span class="route-field-label">Watch this folder</span>
          <div class="route-path-input">
            <input id="route-source" class="input-field small" type="text" value="${escapeHtml(d.source)}" placeholder="/Users/you/Photo Inbox or /Volumes/EOS_DIGITAL" />
            <button id="route-source-browse" class="btn small secondary" type="button">Choose...</button>
          </div>
        </div>
        ${organize ? "" : `
        <div class="route-field wide">
          <span class="route-field-label">Send files to</span>
          <div class="route-path-input">
            <input id="route-destination" class="input-field small" type="text" value="${escapeHtml(d.destination)}" placeholder="/Volumes/PhotoNAS" />
            <button id="route-destination-browse" class="btn small secondary" type="button">Choose...</button>
          </div>
        </div>`}
        <label class="route-field wide">
          <span class="route-field-label">Folder layout when no rule matches</span>
          <input id="route-layout" class="input-field small" type="text" value="${escapeHtml(d.layout || "")}" placeholder="e.g. Shoots/{year}/{date} {source_folder}" />
          <span class="field-hint">Fill-ins: ${ROUTE_TOKENS.map((t) => `<code>${escapeHtml(t)}</code>`).join(" ")}. Dates come from when a photo was taken when the file has that, otherwise from when it was last changed. <code>{source_folder}</code> is the subfolder you dropped it in, such as a client name.</span>
        </label>
        <label class="route-field wide">
          <span class="route-field-label">Rules, one per line (checked before the layout)</span>
          <textarea id="route-rules" class="input-field small route-rules-input" rows="4" placeholder="*.mov go to Video/{year}">${escapeHtml(d.rules.join(`
`))}</textarea>
        </label>
      </div>
      <div class="drop-toggles route-toggles">
        ${routeSwitch("route-auto", "Sort automatically", d.auto, `Checks for new files every ${ROUTE_CHECK_SECONDS} seconds. When off, this route only sorts when you click Sort now.`)}
        ${routeSwitch("route-ai", "Ask AI when nothing matches", d.ai, "Uses your AI key. Without it, unmatched files go to review.")}
        ${routeSwitch("route-subfolders", "Include subfolders", d.scan_subfolders && !organize, "Also pick up files inside folders in the watched folder (needed for SD cards)", organize)}
        ${routeSwitch("route-skip-dupes", "Skip files already there", d.skip_duplicates, "Same name, size and date at the destination means it is already copied")}
        ${routeSwitch("route-review-folder", "Use _Needs Review folder", d.use_review_folder && !copy, copy ? "Copy routes never move originals, so unsorted files stay where they are" : "Move unsorted files into a _Needs Review folder inside the watched folder", copy)}
        ${routeSwitch("route-vault", "Allow vault rules", d.vault, "Let rules send files into the encrypted vault with a vault: destination")}
      </div>
      ${editor.error ? `<p class="route-editor-error" role="alert">${icons.alert(12)}<span>${escapeHtml(editor.error)}</span></p>` : ""}
      <div class="route-editor-actions">
        ${editor.isNew ? "" : `<button class="btn small secondary route-delete-btn" type="button" data-route-delete="${escapeHtml(d.id)}" title="Delete this route. Files are not touched.">${icons.trash(12)}<span>Delete route</span></button>`}
        <span class="route-editor-actions-spacer"></span>
        <button id="route-cancel-btn" class="btn small secondary" type="button">Cancel</button>
        <button id="route-save-btn" class="btn small primary" type="button"${editor.saving ? " disabled" : ""}>${editor.saving ? "Saving..." : "Save route"}</button>
      </div>
    </div>`;
  }
  function renderRoutesSection(overview) {
    if (!overview || !Array.isArray(overview.routes))
      return "";
    const routes = overview.routes;
    return `
    <section class="routing-section routes-card" id="routes-card">
      <div class="section-header">
        <div class="section-title-wrap">
          <span class="section-icon">${icons.arrowRight(16)}</span>
          <span class="section-title">Routes</span>
          <span class="route-count">${routes.length}</span>
        </div>
        <button id="route-new-btn" class="btn small primary" type="button">New route</button>
      </div>
      <p class="field-hint">Each route watches one folder and sorts it into its own destination with its own rules. If a drive is unplugged, only the route that uses it waits. Click a route to change it.</p>
      <ul class="route-list">${routes.map(routeRow).join("")}</ul>
    </section>`;
  }
  function smartRoutingPage(overview, editor, selectedRouteId) {
    if (editor)
      return "editor";
    if (!overview || !Array.isArray(overview.routes))
      return "single";
    return selectedRouteId === "main" ? "main" : "home";
  }
  function renderSmartRoutingView({
    aiConfig,
    rules = [],
    discoveredDirs = [],
    testResult = null,
    activeRole = "webdev",
    enabledRoles = ["webdev"],
    roleRules = DEFAULT_ROLE_RULES,
    detectedVolume = null,
    editingRuleIndex = null,
    aiVerification = null,
    aiUsage = null,
    nasTransfers = [],
    nasStagingStatus = null,
    rulesPage = 1,
    rulesSearch = "",
    reviewQueue = [],
    ruleSuggestions = [],
    ruleCheck = null,
    ruleCheckCanApply = false,
    routesOverview = null,
    routeEditor = null,
    selectedRouteId = null,
    showRoutingLedger = false
  }) {
    const routeNames = Object.fromEntries((routesOverview?.routes ?? []).map((r) => [r.config.id, r.config.name]));
    const page = smartRoutingPage(routesOverview, routeEditor, selectedRouteId);
    const statusFor = (id) => routesOverview?.routes.find((r) => r.config.id === id) ?? null;
    const belongsToMain = (routeId) => !routeId || routeId === "main" || !(routeId in routeNames);
    const safeReview = Array.isArray(reviewQueue) ? reviewQueue : [];
    const safeTransfers = Array.isArray(nasTransfers) ? nasTransfers : [];
    const mainReview = page === "main" ? safeReview.filter((i) => belongsToMain(i.route_id)) : safeReview;
    const mainTransfers = page === "main" ? safeTransfers.filter((t) => belongsToMain(t.route_id)) : safeTransfers;
    const editingId = routeEditor && !routeEditor.isNew ? routeEditor.draft.id : null;
    const mainStatus = statusFor("main");
    const smbTarget = aiConfig?.smb_target || "";
    const organizeMode = aiConfig?.routing_mode === "organize";
    const vaultRoutingEnabled = aiConfig?.vault_routing_enabled ?? false;
    const vaultMaxMb = aiConfig?.vault_max_file_mb ?? 500;
    const rulesBackupCount = aiConfig?.rules_backup_count ?? 0;
    const currentProvider = (aiConfig?.provider || "xai").toLowerCase();
    const hasOpenRouterKey = aiConfig?.has_openrouter_key ?? aiConfig?.has_api_key ?? false;
    const hasGrokKey = aiConfig?.has_grok_key ?? false;
    const hasKey = currentProvider === "xai" ? hasGrokKey : hasOpenRouterKey;
    const safeEnabledRoles = Array.isArray(enabledRoles) ? enabledRoles : ["webdev"];
    const safeActiveRole = activeRole && ROUTING_ROLES.some((r) => r.id === activeRole) ? activeRole : "webdev";
    const currentRole = ROUTING_ROLES.find((r) => r.id === safeActiveRole) || ROUTING_ROLES[0];
    const isCurrentRoleEnabled = safeEnabledRoles.includes(safeActiveRole);
    const safeRoleRules = roleRules && typeof roleRules === "object" ? roleRules : DEFAULT_ROLE_RULES;
    const rawRoleRules = safeRoleRules[safeActiveRole] || DEFAULT_ROLE_RULES[safeActiveRole] || [];
    const rawList = rules && rules.length > 0 && rawRoleRules === DEFAULT_ROLE_RULES[safeActiveRole] ? rules : rawRoleRules;
    const currentRoleRules = (Array.isArray(rawList) ? rawList : []).map((item) => {
      if (typeof item === "string")
        return item;
      if (item && typeof item === "object") {
        if ("rule" in item)
          return String(item.rule);
        if ("text" in item)
          return String(item.text);
        if ("name" in item)
          return String(item.name);
      }
      return String(item ?? "");
    }).filter((s) => s.trim().length > 0);
    const totalActiveRulesCount = safeEnabledRoles.reduce((acc, r) => {
      const list = safeRoleRules[r] || DEFAULT_ROLE_RULES[r] || [];
      return acc + (Array.isArray(list) ? list.length : 0);
    }, 0);
    const searchTrim = (rulesSearch || "").trim().toLowerCase();
    const indexedRules = currentRoleRules.map((r, originalIdx) => ({ r, originalIdx }));
    const filteredRules = searchTrim ? indexedRules.filter(({ r }) => r.toLowerCase().includes(searchTrim)) : indexedRules;
    const totalMatchingRules = filteredRules.length;
    const pageSize = 15;
    const totalPages = Math.max(1, Math.ceil(totalMatchingRules / pageSize));
    const currentPage = Math.min(Math.max(1, rulesPage), totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const pageRules = filteredRules.slice(startIndex, startIndex + pageSize);
    const rulesHtml = totalMatchingRules === 0 ? `<div class="rules-empty-state">
           <p>${searchTrim ? `No rules match "${escapeHtml(searchTrim)}".` : `No rules created yet for ${escapeHtml(currentRole.title)}. Scan your storage or add rules below.`}</p>
         </div>` : pageRules.map(({ r, originalIdx }) => {
      if (editingRuleIndex === originalIdx) {
        return `
                <div class="rule-card editing" data-rule-idx="${originalIdx}">
                  <div class="rule-edit-form">
                    <input type="text" class="rule-edit-input" id="rule-edit-input-${originalIdx}" value="${escapeHtml(r)}" placeholder="e.g. *.tar.gz go to Backups" />
                    <div class="rule-edit-actions">
                      <button type="button" class="btn small rule-ai-optimize-edit-btn" data-edit-idx="${originalIdx}" title="Use AI to refine and test this rule">
                        ${icons.sparkles(12)}<span>AI Refine</span>
                      </button>
                      <button type="button" class="btn small rule-cancel-edit-btn" data-cancel-edit="${originalIdx}">Cancel</button>
                      <button type="button" class="btn small primary rule-save-edit-btn" data-save-edit="${originalIdx}">Save Rule</button>
                    </div>
                  </div>
                </div>`;
      }
      const parts = r.split(/\s+go\s+to\s+/i);
      const trigger = parts[0]?.trim() || r;
      const dest = parts[1]?.trim() || "Unsorted";
      return `
              <div class="rule-card" data-rule-idx="${originalIdx}">
                <div class="rule-card-left">
                  <span class="rule-icon">${icons.doc(15)}</span>
                  <span class="rule-trigger" title="${escapeHtml(trigger)}">${escapeHtml(trigger)}</span>
                </div>
                <div class="rule-arrow">→</div>
                <div class="rule-card-right">
                  <span class="rule-dest-badge" title="${escapeHtml(dest)}">${icons.folder(12)}<span>${escapeHtml(dest)}</span></span>
                  <div class="rule-actions-inline">
                    <button type="button" class="rule-ai-verify-btn" data-verify-idx="${originalIdx}" title="Check rule locally (no AI call)">${icons.check(12)}<span>Verify</span></button>
                    <button type="button" class="rule-edit-btn" data-edit-idx="${originalIdx}" title="Edit rule text">${icons.gear(12)}<span>Edit</span></button>
                    <button type="button" class="rule-del-btn" data-del-rule="${originalIdx}" title="Delete rule">×</button>
                  </div>
                </div>
              </div>`;
    }).join("");
    if (page === "editor" && routeEditor) {
      const status = editingId ? statusFor(editingId) : null;
      return `
    <div class="smart-routing-view" data-routing-page="editor">
      ${routePageBar(routeEditor.isNew ? "New route" : status?.config.name || routeEditor.draft.name || "Route", status)}
      ${renderRouteEditor(routeEditor, Array.isArray(routesOverview?.templates) ? routesOverview.templates : [])}
      ${editingId ? renderReviewQueueSection(safeReview.filter((i) => i.route_id === editingId), routeEditor.draft.use_review_folder, routeNames) : ""}
      ${editingId ? renderNasTransfersSection(safeTransfers.filter((t) => t.route_id === editingId)) : ""}
    </div>`;
    }
    return `
    <div class="smart-routing-view" data-routing-page="${page}">
      ${page === "main" ? routePageBar(mainStatus?.config.name || "To NAS", mainStatus, false) : `
      <!-- Top-Level AI Activity & Cost Quick-Bar -->
      <div class="ai-quick-cost-strip">
        <div class="quick-cost-left">
          <span class="quick-cost-icon">${icons.sparkles(16)}</span>
          <div class="quick-cost-title-block">
            <span class="quick-cost-title">AI usage</span>
            <span class="quick-cost-sub">Provider: <strong>${currentProvider === "xai" ? "xAI Grok" : "OpenRouter"}</strong> &bull; Model: <strong>${escapeHtml(aiConfig?.model || (currentProvider === "xai" ? "grok-4.20-non-reasoning" : "google/gemini-2.5-flash-lite"))}</strong></span>
          </div>
        </div>
        <div class="quick-cost-metrics">
          <div class="quick-cost-stat">
            <span class="stat-label">Total Cost</span>
            <span class="stat-val primary">${aiUsage?.totalCostUsd ? `$${aiUsage.totalCostUsd.toFixed(4)}` : "$0.0000"}</span>
          </div>
          <div class="quick-cost-stat">
            <span class="stat-label">Billed Tokens</span>
            <span class="stat-val">${(aiUsage?.totalTokens ?? 0).toLocaleString()}</span>
          </div>
          <div class="quick-cost-stat">
            <span class="stat-label">API Requests</span>
            <span class="stat-val">${aiUsage?.totalRequests ?? 0}</span>
          </div>
        </div>
        ${page === "home" ? `<button id="routing-jump-ledger-btn" type="button" class="btn small subtle" aria-expanded="${showRoutingLedger ? "true" : "false"}" title="Show the full cost breakdown">
          <span>${showRoutingLedger ? "Hide Ledger" : "Full Ledger"}</span>
        </button>` : `<button id="routing-jump-ledger-btn" type="button" class="btn small subtle" title="Jump to full breakdown ledger">
          <span>Full Ledger &darr;</span>
        </button>`}
      </div>`}

      ${page === "home" ? renderRoutesSection(routesOverview) : ""}
      ${page === "home" && showRoutingLedger ? renderAiUsageSection(aiUsage || EMPTY_AI_USAGE) : ""}

      ${page === "home" ? "" : `
      <!-- 0. Role Selector (Multi-Role Toggles) -->
      <section class="routing-section routing-role-card">
        <div class="role-selector-header">
          <div class="role-selector-title-wrap">
            <span class="role-kicker">WORKFLOW PROFILE</span>
            <h2 class="role-selector-title">What type of work are you organizing?</h2>
          </div>
          <span class="role-selector-hint">Toggle roles on or off to activate their rules. Click any role card to view and customize its dedicated rules list.</span>
        </div>
        <div class="role-cards-grid">
          ${ROUTING_ROLES.map((r) => {
      const isEnabled = safeEnabledRoles.includes(r.id);
      const isSelected = safeActiveRole === r.id;
      const list = safeRoleRules[r.id] || DEFAULT_ROLE_RULES[r.id] || [];
      const count = Array.isArray(list) ? list.length : 0;
      return `
            <div class="role-card${isSelected ? " active selected" : ""}${isEnabled ? " role-enabled" : " role-disabled"}" data-role-select="${r.id}">
              <div class="role-card-top">
                <div class="role-card-top-left">
                  <span class="role-card-icon">${r.icon(18)}</span>
                  <span class="role-card-badge">${escapeHtml(r.badge)}</span>
                </div>
                <div class="role-card-toggle" title="${isEnabled ? "Turn off " + escapeHtml(r.title) : "Turn on " + escapeHtml(r.title)}">
                  <label class="toggle-switch small" onclick="event.stopPropagation()">
                    <input type="checkbox" class="role-toggle-checkbox" data-role-toggle="${r.id}" ${isEnabled ? "checked" : ""}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div class="role-card-title">${escapeHtml(r.title)}</div>
              <div class="role-card-desc">${escapeHtml(r.tagline)}</div>
              <div class="role-card-footer">
                <span class="role-status-badge ${isEnabled ? "on" : "off"}">
                  <span class="status-dot"></span>
                  <span>${isEnabled ? `Active (${count} rules)` : "Turned Off"}</span>
                </span>
                ${isSelected ? `<span class="role-card-indicator">${icons.check(11)}<span>Editing</span></span>` : `<span class="role-card-click-hint">Click to edit</span>`}
              </div>
            </div>`;
    }).join("")}
        </div>
      </section>

      <!-- Contextual Drive Detection Banner if available -->
      ${detectedVolume && detectedVolume !== smbTarget ? `
        <div class="detected-drive-banner">
          <div class="detected-drive-left">
            <span class="detected-icon">${icons.box(16)}</span>
            <span class="detected-text">Detected Hosting Volume: <strong>${escapeHtml(detectedVolume)}</strong></span>
          </div>
          <button id="routing-use-detected-btn" class="btn small primary" type="button" data-drive-path="${escapeHtml(detectedVolume)}">Set as Destination</button>
        </div>` : ""}

      <!-- 1. Universal Target Storage Destination Header -->
      <section class="routing-section routing-source-card">
        <div class="source-card-main">
          <div class="source-icon-wrap">
            <span class="source-icon">${icons.box(22)}</span>
          </div>
          <div class="source-info">
            <div class="source-title-row">
              <span class="source-name">Destination Folder</span>
              <span class="badge ${smbTarget ? "ok" : "warn"}">${smbTarget ? "Set" : "Not Set"}</span>
            </div>
            <div class="source-path" title="${escapeHtml(smbTarget)}">${icons.folder(13)}<span>${escapeHtml(smbTarget || "Choose a destination folder")}</span></div>
            <span class="field-hint" style="font-size:11px; color:var(--text-muted); margin-top:2px;">NAS share, external drive, or any local folder.</span>
          </div>
        </div>
        <div class="source-actions">
          <button id="routing-browse-btn" class="btn" type="button">Change Destination…</button>
          <button id="routing-scan-btn" class="btn primary" type="button">${icons.search(13)}<span>Scan Folders &amp; Suggest Rules</span></button>
        </div>
      </section>

      <!-- 2. Local Ingest Staging (Drop Folder) -->
      <section class="routing-section routing-staging-card">
        <div class="staging-card-main">
          <div class="staging-icon-wrap">
            <span class="staging-icon">${icons.folder(22)}</span>
          </div>
          <div class="staging-info">
            <div class="staging-title-row">
              <span class="staging-name">Drop Folder</span>
              <span class="badge ${(nasStagingStatus?.pending_count ?? 0) > 0 ? "warn" : "ok"}">
                ${(nasStagingStatus?.pending_count ?? 0) > 0 ? `${nasStagingStatus.pending_count} waiting` : "Ready"}
              </span>
            </div>
            <div class="staging-path" title="${escapeHtml(aiConfig?.nas_ingest_folder || "~/RenegadeBox/To NAS")}">
              <code>${escapeHtml(aiConfig?.nas_ingest_folder || "~/RenegadeBox/To NAS")}</code>
            </div>
          </div>
        </div>
        <div class="staging-actions">
          <button id="nas-open-staging-btn" class="btn" type="button" title="Open local staging folder in Finder">
            ${icons.folder(13)}<span>Open in Finder</span>
          </button>
          <button id="nas-change-staging-btn" class="btn" type="button" title="Change local staging directory">
            <span>Change Folder…</span>
          </button>
          <button id="nas-process-now-btn" class="btn ${aiConfig?.auto_route ?? true ? "" : "primary"}" type="button" title="${aiConfig?.auto_route ?? true ? `Already checks every ${ROUTE_CHECK_SECONDS} seconds. Click to sort what is waiting right away.` : "Sort the files waiting in the drop folder now"}">
            ${icons.sync(13)}<span>Sort now</span>
          </button>
        </div>
      </section>
      <div class="drop-behavior-bar">
        <div class="drop-behavior-group" role="radiogroup" aria-label="What happens to dropped files">
          <span class="drop-behavior-label">After sorting:</span>
          <button type="button" id="routing-mode-move" class="mode-option${organizeMode ? "" : " active"}" data-routing-mode="move" role="radio" aria-checked="${organizeMode ? "false" : "true"}">
            ${icons.arrowRight(12)}<span>Move to destination folder</span>
          </button>
          <button type="button" id="routing-mode-organize" class="mode-option${organizeMode ? " active" : ""}" data-routing-mode="organize" role="radio" aria-checked="${organizeMode ? "true" : "false"}">
            ${icons.folder(12)}<span>Keep in drop folder (organized)</span>
          </button>
        </div>
        <div class="drop-toggles">
        <label class="drop-auto-label" title="Checks for new files every ${ROUTE_CHECK_SECONDS} seconds. When off, files wait until you click Sort now.">
          <input id="drop-auto-toggle" class="switch" type="checkbox" role="switch"${aiConfig?.auto_route ?? true ? " checked" : ""} />
          <span>Sort automatically</span>
        </label>
        <label class="drop-auto-label" title="When off, files that cannot be sorted stay where you dropped them instead of moving into a _Needs Review subfolder">
          <input id="review-folder-toggle" class="switch" type="checkbox" role="switch"${aiConfig?.use_review_folder ?? true ? " checked" : ""} />
          <span>Use _Needs Review folder</span>
        </label>
        </div>
      </div>
      <div class="staging-hint-bar">
        <span class="staging-hint-text">
          ${organizeMode ? `Files dropped here are sorted into subfolders <strong>inside this drop folder</strong> and stay on this Mac. Nothing is moved to the destination folder.` : `Files dropped here are sorted and <strong>moved to ${escapeHtml(smbTarget || "the destination folder")}</strong>. If it is not reachable, files wait here until it is.`}
          Rules are checked first. The AI is only asked when no rule matches. Anything it is unsure about (below 70% confidence), or that fails to move, ${aiConfig?.use_review_folder ?? true ? "goes to <code>_Needs Review</code>" : "stays in the drop folder"} and is listed below for you to decide. Files are never sent to S3 unless you write a <code>vault:</code> rule and turn on vault routing.
        </span>
      </div>
      ${!organizeMode && smbTarget && nasStagingStatus && !nasStagingStatus.nas_accessible ? `<div class="staging-hint-bar" style="border-color: var(--warn, #f59e0b);"><span class="staging-hint-text"><strong>Destination not reachable:</strong> ${escapeHtml(smbTarget)} is not mounted. Dropped files will wait in the drop folder until it is.</span></div>` : ""}
      ${!organizeMode && !smbTarget ? `<div class="staging-hint-bar" style="border-color: var(--warn, #f59e0b);"><span class="staging-hint-text"><strong>No destination folder set.</strong> Choose one above, or switch to "Keep in drop folder".</span></div>` : ""}
      ${aiConfig?.ingest_warning ? `<div class="staging-hint-bar" style="border-color: var(--warn, #f59e0b);"><span class="staging-hint-text"><strong>Warning:</strong> ${escapeHtml(aiConfig.ingest_warning)}</span></div>` : ""}

      ${renderReviewQueueSection(mainReview, aiConfig?.use_review_folder ?? true, routeNames)}
      ${renderRuleSuggestionsSection(Array.isArray(ruleSuggestions) ? ruleSuggestions : [])}

      ${discoveredDirs.length > 0 ? `
        <div class="discovered-folders-bar">
          <span class="folders-label">${discoveredDirs.length} Folders Discovered:</span>
          <div class="folder-chips">
            ${discoveredDirs.slice(0, 6).map((d) => `<span class="folder-chip">${icons.folder(11)}<span>${escapeHtml(d)}</span></span>`).join("")}
            ${discoveredDirs.length > 6 ? `<span class="folder-chip more">+${discoveredDirs.length - 6} more</span>` : ""}
          </div>
        </div>` : ""}

      <!-- 2. AI Rule Generator & Role Rules Management -->
      <section class="routing-section routing-explainer-card">
        <div class="section-header">
          <div class="section-title-wrap">
            <span class="section-icon sparkles">${icons.sparkles(16)}</span>
            <span class="section-title">Explain Your Organization</span>
            <span class="role-active-pill">${currentRole.icon(13)}<span>${escapeHtml(currentRole.title)}</span></span>
            <span class="role-state-pill ${isCurrentRoleEnabled ? "on" : "off"}">
              ${isCurrentRoleEnabled ? `${icons.check(11)} Active` : "Turned Off"}
            </span>
          </div>
          <div class="rules-header-actions">
            <button id="routing-reset-role-btn" class="btn small" type="button" title="Reset ${escapeHtml(currentRole.title)} to default rules">Reset Defaults</button>
            <button id="routing-save-rules-btn" class="btn small primary" type="button">Save Rules</button>
          </div>
        </div>

        <div class="explainer-input-wrap">
          <div class="composer-prompt-row">
            <span class="field-hint">Add or edit rules for <strong>${escapeHtml(currentRole.title)}</strong>. Type in plain English, then optimize and verify with AI:</span>
          </div>
          <div class="composer-inputs-group">
            <textarea id="routing-explainer-input" rows="2" placeholder="${escapeHtml(currentRole.placeholder)}"></textarea>
            <div class="composer-action-buttons">
              <button id="routing-ai-optimize-btn" class="btn sparkles-btn" type="button" title="Use AI to format the rule, then check it locally against your other rules">
                ${icons.sparkles(13)}<span>AI Optimize &amp; Verify</span>
              </button>
              <button id="routing-add-rule-btn" class="btn primary" type="button">
                <span>+ Add Rule</span>
              </button>
            </div>
          </div>

          <!-- AI Verification Banner / Card -->
          <div id="routing-ai-verification-box" class="ai-verification-box"${ruleCheck || aiVerification ? "" : " hidden"}>
            ${ruleCheck ? renderRuleCheckBox(ruleCheck, ruleCheckCanApply) : aiVerification ? renderAiVerificationBox(aiVerification) : ""}
          </div>

          <!-- Quick Presets -->
          <div class="explainer-action-row">
            <div class="quick-preset-chips">
              <span class="chips-label">Presets:</span>
              ${currentRole.chips.map((c) => `<button type="button" class="preset-chip" data-preset="${escapeHtml(c.preset)}">${escapeHtml(c.label)}</button>`).join("")}
            </div>
            <div class="explainer-btns">
              <button id="routing-load-all-role-btn" class="btn" type="button" title="Load all preset rules for this role">Load All ${escapeHtml(currentRole.badge)}</button>
              <button id="routing-translate-btn" class="btn" type="button" title="Translate multiple rules from explanation">
                ${icons.sparkles(13)}<span>Translate to Rules</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 3. Active Rules Subdeck -->
        <div class="role-rules-subdeck">
          <div class="subdeck-header">
            <div class="section-title-wrap">
              <span class="section-icon">${icons.doc(15)}</span>
              <span class="section-title">Active Rules</span>
              <span class="count-badge">${currentRoleRules.length.toLocaleString()}</span>
            </div>
            <span class="subdeck-status-hint">
              ${isCurrentRoleEnabled ? `${icons.check(11)} Active in routing` : "Role paused — toggle ON above to activate"}
            </span>
          </div>

          <div class="rules-subdeck-search">
            <input type="search" id="rules-search-input" class="input-field small" placeholder="Filter rules by pattern, keyword, or destination..." value="${escapeHtml(rulesSearch || "")}" />
            ${currentRoleRules.length > 25 || currentRoleRules.some((r) => r.toLowerCase().startsWith("files matching ")) ? `<button type="button" id="rules-prune-bloat-btn" class="btn small subtle" title="Remove auto-generated 'files matching' and 'go to Unsorted' rules from all roles (undoable)">Prune Repetitive Rules</button>` : ""}
            ${rulesBackupCount > 0 ? `<button type="button" id="rules-undo-btn" class="btn small subtle" title="Restore the rules as they were before the last change (${rulesBackupCount} snapshot${rulesBackupCount === 1 ? "" : "s"} saved)">Undo Last Rules Change</button>` : ""}
          </div>

          <div class="rules-deck-list">
            ${rulesHtml}
          </div>

          ${totalPages > 1 ? `
          <div class="rules-pagination-bar">
            <span class="pagination-info">Showing <strong>${startIndex + 1}–${Math.min(startIndex + pageRules.length, totalMatchingRules)}</strong> of <strong>${totalMatchingRules.toLocaleString()}</strong> rules${searchTrim ? ` (filtered from ${currentRoleRules.length.toLocaleString()})` : ""}</span>
            <div class="pagination-buttons">
              <button type="button" class="btn small rules-page-prev" ${currentPage <= 1 ? "disabled" : ""} data-target-page="${currentPage - 1}">← Previous</button>
              <span class="pagination-page-indicator">Page ${currentPage} of ${totalPages}</span>
              <button type="button" class="btn small rules-page-next" ${currentPage >= totalPages ? "disabled" : ""} data-target-page="${currentPage + 1}">Next →</button>
            </div>
          </div>` : ""}

          <div class="global-routing-summary">
            <div class="summary-left">
              <span class="summary-icon">${icons.box(14)}</span>
              <span><strong>${totalActiveRulesCount.toLocaleString()} total rules active</strong> across ${safeEnabledRoles.length} enabled role${safeEnabledRoles.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. Interactive File Drop Simulator & Rule Inspector -->
      <section class="routing-section routing-simulator-card">
        <div class="section-header">
          <div class="section-title-wrap">
            <span class="section-icon">${icons.sync(16)}</span>
            <span class="section-title">Test & Rule Inspector</span>
          </div>
          <span class="field-hint">Drop any file from your Mac to preview how rules evaluate it</span>
        </div>

        <div id="routing-drop-zone" class="routing-drop-zone" tabindex="0">
          <div class="drop-zone-content">
            <span class="drop-zone-icon">${icons.sparkles(24)}</span>
            <span class="drop-zone-title">Drop a file here to inspect routing</span>
            <span class="drop-zone-subtitle">or <button id="routing-select-file-btn" class="link-btn" type="button">choose a test file</button></span>
            <input id="routing-file-picker" type="file" style="display:none;" />
          </div>
        </div>

        <!-- Live Routing Decision Result -->
        <div id="routing-result-drawer" class="routing-result-drawer"${testResult ? "" : " hidden"}>
          ${testResult ? renderRouteDecisionCard(testResult) : ""}
        </div>
      </section>
      `}

      <!-- 5. AI API Usage & Cost Analytics (Live Ledger) -->
      ${page === "single" ? renderAiUsageSection(aiUsage || EMPTY_AI_USAGE) : ""}

      <!-- 6. Transfer history -->
      ${page === "home" ? "" : renderNasTransfersSection(mainTransfers)}

      <!-- 7. Collapsible AI & Provider Configuration (shared by every route) -->
      ${page === "main" ? "" : `
      <section class="routing-section routing-config-card">
        <details class="routing-config-details">
          <summary class="routing-config-summary">
            <div class="summary-left">
              <span class="config-icon">${icons.gear(14)}</span>
              <span>AI Engine &amp; Model Provider Settings</span>
            </div>
            <div class="summary-right" style="display:flex; align-items:center; gap:8px;">
              <span class="provider-pill-badge">${currentProvider === "xai" ? "Grok" : "OpenRouter"}</span>
              <span class="keychain-status ${hasKey ? "configured" : ""}">${hasKey ? "Key Configured" : "Key Needed"}</span>
            </div>
          </summary>
          <div class="config-drawer-body">
            <!-- Dynamic Format & Auto-Directory Banner -->
            <div class="ai-flexibility-banner" style="margin-bottom: 16px; padding: 12px 14px; background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 8px; display: flex; gap: 12px; align-items: flex-start;">
              <div style="color: var(--primary); margin-top: 2px;">${icons.sparkles(16)}</div>
              <div style="font-size: 12px; line-height: 1.5; color: var(--text);">
                <strong>How the AI is used:</strong>
                Rules always run first and cost nothing. The AI is only asked about files no rule matches, including unfamiliar formats. It picks a folder inside the destination (it can propose a new subfolder, but never a path outside it) and may suggest a reusable rule for you to accept. If it is less than 70% confident, the file goes to <code>_Needs Review</code> instead.
                <br /><strong>What is sent to the AI:</strong> the filename, extension, size, the first 2 KB of text files, your destination's folder names, and up to 25 of your most relevant rules. Files going to the vault are never sent.
              </div>
            </div>

            <div class="form-grid">
              <label class="field">
                <span class="field-label">AI provider</span>
                <select id="routing-provider-select" class="select-field">
                  <option value="xai"${currentProvider === "xai" ? " selected" : ""}>Grok, with your own xAI key (recommended)</option>
                  <option value="openrouter"${currentProvider === "openrouter" ? " selected" : ""}>OpenRouter (Gemini, Claude, GPT)</option>
                </select>
                <span class="field-hint">Your key talks to the provider directly. RenegadeBox never sees your bill.</span>
              </label>

              <label class="field">
                <span class="field-label">Model</span>
                <select id="routing-model-select" class="select-field">
                  ${modelOptionsHtml(currentProvider, aiConfig?.model)}
                </select>
              </label>

              <label class="field" id="routing-openrouter-key-field"${currentProvider === "xai" ? ' style="display:none;"' : ""}>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span class="field-label">OpenRouter key</span>
                  <span class="keychain-status ${hasOpenRouterKey ? "configured" : ""}" style="font-size:10px;">${hasOpenRouterKey ? "Saved" : "Not set"}</span>
                </div>
                <div class="password-field-wrapper">
                  <input id="routing-api-key-input" type="password" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false" />
                  <button id="routing-key-toggle-btn" class="icon-btn-inline" type="button">Show</button>
                </div>
                <span class="field-hint">Create one at openrouter.ai under Keys. Stored in your Mac's keychain and shared with your other Macs through your account.</span>
              </label>

              <label class="field" id="routing-grok-key-field"${currentProvider === "openrouter" ? ' style="display:none;"' : ""}>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span class="field-label">Your xAI key</span>
                  <span class="keychain-status ${hasGrokKey ? "configured" : ""}" style="font-size:10px;">${hasGrokKey ? "Saved" : "Not set"}</span>
                </div>
                <div class="password-field-wrapper">
                  <input id="routing-grok-key-input" type="password" placeholder="xai-..." autocomplete="off" spellcheck="false" />
                  <button id="routing-grok-key-toggle-btn" class="icon-btn-inline" type="button">Show</button>
                </div>
                <div class="grok-key-guide" id="routing-grok-guide">
                  <span class="field-label">Get your own Grok key</span>
                  <ol>
                    <li>Go to <strong>console.x.ai</strong> and sign in. Your X or Google account works.</li>
                    <li>Open <strong>API Keys</strong> and click <strong>Create API Key</strong>.</li>
                    <li>Copy the key (it starts with <code>xai-</code>), paste it above and click Save AI Settings.</li>
                  </ol>
                  <span class="field-hint">xAI has offered free credits to new accounts, and monthly credits if you turn on data sharing. See <strong>Billing</strong> at console.x.ai for what your account gets. With data sharing on, xAI may use what RenegadeBox sends it: filenames and the first 2 KB of text files. Your key is stored in your Mac's keychain and shared with your other Macs through your account.</span>
                </div>
              </label>
            </div>
            <div class="switch-row" style="margin-top:14px;">
              <div class="switch-text">
                <span class="field-label">Vault routing (opt-in)</span>
                <span class="field-hint">Lets rules like <code>Family photos go to vault:Family Photos</code> move files into your encrypted vault folder${aiConfig?.vault_folder ? ` (<code>${escapeHtml(aiConfig.vault_folder)}</code>)` : ""}, which syncs to S3. Only your rules can do this; the AI never chooses the vault.</span>
              </div>
              <input id="routing-vault-toggle" class="switch" type="checkbox" role="switch"${vaultRoutingEnabled ? " checked" : ""} />
            </div>
            <label class="field" style="margin-top:10px; max-width:260px;">
              <span class="field-label">Vault max file size (MB)</span>
              <input id="routing-vault-max-mb" class="input-field small" type="number" min="1" step="1" value="${vaultMaxMb}" />
              <span class="field-hint">Larger files go to review instead of the vault.</span>
            </label>
            <div style="margin-top: 14px; display:flex; justify-content:flex-end; gap:8px;">
              <button id="routing-save-config-btn" class="btn primary small" type="button">Save AI Settings</button>
            </div>
          </div>
        </details>
      </section>
      `}
    </div>
  `;
  }
  var AI_MODELS = {
    xai: [
      ["grok-4.20-non-reasoning", "Grok 4.20 (recommended, $1.25 in / $2.50 out per 1M)"],
      ["grok-4.3", "Grok 4.3 ($1.25 / $2.50 per 1M)"],
      ["grok-build-0.1", "Grok Build 0.1 ($1 / $2 per 1M)"]
    ],
    openrouter: [
      ["google/gemini-2.5-flash-lite", "Google Gemini 2.5 Flash Lite ($0.10 / $0.40 per 1M)"],
      ["openai/gpt-4o-mini", "OpenAI GPT-4o Mini ($0.15 / $0.60 per 1M)"],
      ["google/gemini-3.1-flash-lite", "Google Gemini 3.1 Flash Lite ($0.25 / $1.50 per 1M)"],
      ["anthropic/claude-haiku-4.5", "Anthropic Claude Haiku 4.5 ($1 / $5 per 1M)"]
    ]
  };
  function modelOptionsHtml(provider, selected) {
    const list = AI_MODELS[provider === "openrouter" ? "openrouter" : "xai"];
    const pick = list.some(([id]) => id === selected) ? selected : list[0][0];
    return list.map(([id, label]) => `<option value="${escapeHtml(id)}"${id === pick ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }
  function renderSetup(mode = "signin") {
    const signin = mode === "signin";
    const presets = PROVIDERS.map((p) => `<button class="preset" type="button" data-provider="${p.id}" aria-pressed="false">${escapeHtml(p.label)}</button>`).join("");
    return `
    <main class="setup">
      <header class="setup-header">
        <span class="setup-logo">${icons.box(28)}</span>
        <div>
          <h1 id="setup-title" class="window-title">${signin ? "Sign in to RenegadeBox" : "Set up RenegadeBox"}</h1>
          <p class="field-hint">Your files are encrypted on this Mac before they leave it.</p>
        </div>
      </header>

      <section id="signin-panel" class="signin"${signin ? "" : " hidden"}>
        <div id="signin-google" class="signin-google">
          <div id="signin-google-idle">${renderGoogleButton({ id: "signin-google-btn", waiting: false, cancelId: "signin-google-cancel" })}</div>
          <div id="signin-google-waiting" hidden>${renderGoogleButton({ id: "signin-google-btn", waiting: true, cancelId: "signin-google-cancel" })}</div>
          <p id="signin-google-error" class="form-error" role="alert"></p>
          <p class="field-hint signin-note">RenegadeBox opens Google in your browser. Once you've signed in, this Mac sets itself up from your account.</p>
          <button id="signin-email-toggle" class="link-btn signin-email-toggle" type="button" aria-expanded="false" aria-controls="signin-form">Use email and password instead</button>
        </div>
        <form id="signin-form" class="signin-email-form" novalidate hidden>
          <label class="field"><span class="field-label">Email</span>
            <input id="signin-email" name="email" type="email" autocomplete="email" spellcheck="false" /></label>
          <label class="field"><span class="field-label">Password</span>
            <input id="signin-password" name="password" type="password" autocomplete="current-password" /></label>
          <p id="signin-error" class="form-error" role="alert"></p>
          <button id="signin-btn" class="btn signin-submit" type="submit">Sign in</button>
          <p class="field-hint signin-note">Your password never leaves this Mac. It unlocks your saved setup, so you don't have to enter your storage details again.</p>
        </form>
        <div class="signin-alt">
          <button id="signin-use-storage" class="btn" type="button">Set up new storage instead</button>
          <p class="field-hint">New to RenegadeBox? Set up your storage first, then create your account in Settings.</p>
        </div>
      </section>

      <div id="setup-wizard" class="setup-wizard"${signin ? " hidden" : ""}>
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
          <button id="setup-signin-instead" class="link-btn setup-signin-instead" type="button">Sign in instead</button>
          <button id="setup-back" class="btn" type="button">Back</button>
          <button id="setup-next" class="btn primary" type="submit">Continue</button>
        </footer>
      </form>
      </div>
    </main>`;
  }
  var SETTINGS_TABS = ["general", "account", "storage", "security", "ignored"];
  function renderDesktopApp({
    activeTab,
    overview,
    recent,
    conflicts,
    settings,
    theme,
    searchQuery = "",
    activeCategory = "all",
    now,
    aiConfig,
    smartRules,
    discoveredDirs,
    routingTestResult,
    activeRole = "webdev",
    enabledRoles,
    roleRules,
    detectedVolume,
    editingRuleIndex,
    aiVerification,
    aiUsage,
    nasTransfers,
    nasStagingStatus,
    rulesPage = 1,
    rulesSearch = "",
    reviewQueue = [],
    ruleSuggestions = [],
    ruleCheck = null,
    ruleCheckCanApply = false,
    routesOverview = null,
    routeEditor = null,
    selectedRouteId = null,
    showRoutingLedger = false,
    settingsTab = "general"
  }) {
    const st = describeStatus(overview);
    const pauseLabel = overview.paused ? "Resume" : "Pause";
    const totalBytes = settings.status.total_bytes ?? 0;
    const totalSize = totalBytes ? ` · ${formatBytes(totalBytes)}` : "";
    const filesCount = settings.status.total_files ? `${settings.status.total_files} files${totalSize}` : "No files synced yet";
    const storageMeterWidth = totalBytes > 0 ? Math.min(100, Math.max(12, Math.round(Math.min(100, totalBytes / (50 * 1024 * 1024) * 100)))) : 6;
    const statusClass = `status-${st.kind}`;
    const navItems = [
      { id: "files", label: "Recent Files", icon: icons.doc(16), shortcut: "⌘1", count: recent.length > 0 ? recent.length : undefined },
      { id: "conflicts", label: "Activity & Conflicts", icon: icons.sync(16), shortcut: "⌘2", count: conflicts.length > 0 ? conflicts.length : undefined, isDanger: conflicts.length > 0 },
      { id: "routing", label: "Smart Routing", icon: icons.sparkles(16), shortcut: "⌘3" },
      { id: "settings", label: "Settings", icon: icons.gear(16), shortcut: "⌘4" }
    ];
    const navHtml = navItems.map((item) => `
    <button class="sidebar-nav-item${activeTab === item.id ? " active" : ""}" type="button" data-desktop-tab="${item.id}" id="nav-tab-${item.id}">
      <span class="sidebar-nav-content">
        ${item.icon}
        <span>${escapeHtml(item.label)}</span>
      </span>
      <span class="sidebar-nav-trailing">
        ${item.count !== undefined ? `<span class="sidebar-badge${item.isDanger ? " danger" : ""}">${item.count}</span>` : ""}
        <kbd class="sidebar-kbd">${item.shortcut}</kbd>
      </span>
    </button>`).join("");
    let mainContent = "";
    if (activeTab === "files") {
      let body = "";
      if (!overview.initialized) {
        body = `
        <div class="empty">
          <p>RenegadeBox keeps a folder on this Mac in sync with storage you own.</p>
          <button id="start-setup-btn" class="btn primary" type="button">Set up RenegadeBox…</button>
        </div>`;
      } else if (recent.length === 0) {
        body = `<div class="empty"><p>Files you add to your RenegadeBox folder will show up here.</p></div>`;
      } else {
        const q = searchQuery.trim().toLowerCase();
        const currentCat = activeCategory;
        const filtered = recent.map((f, origIndex) => ({ f, origIndex })).filter(({ f }) => {
          if (currentCat !== "all" && categorizeFile(f.name) !== currentCat)
            return false;
          if (q) {
            const nameMatch = f.name.toLowerCase().includes(q);
            const folderMatch = f.folder ? f.folder.toLowerCase().includes(q) : false;
            if (!nameMatch && !folderMatch)
              return false;
          }
          return true;
        });
        if (filtered.length === 0) {
          body = `
          <div class="empty">
            <p>No files match "${escapeHtml(searchQuery || currentCat)}".</p>
            <button id="clear-search-btn" class="btn" type="button">Reset filters</button>
          </div>`;
        } else {
          const rows = filtered.map(({ f, origIndex }) => {
            const where = f.folder ? f.folder.split("/").pop() : "RenegadeBox";
            return `
            <tr class="file-table-row" data-index="${origIndex}" data-path="${escapeHtml(f.path)}" title="Double-click to open">
              <td>
                <div class="file-name-cell">
                  <span class="file-status-glyph" title="Up to date">${icons.check(13)}</span>
                  <span class="file-icon">${fileIcon(f.name)}</span>
                  <span class="file-name-text" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
                </div>
              </td>
              <td><span class="file-meta-folder">${escapeHtml(where)}</span></td>
              <td><span class="file-meta-time">${escapeHtml(relativeTime(f.modified_ms, now))}</span></td>
              <td>
                <div class="file-actions-cell">
                  <button class="btn icon-only-btn" type="button" data-action="copy-path" data-index="${origIndex}" title="Copy path to clipboard">${icons.copy(13)}</button>
                  <button class="btn" type="button" data-action="open" data-index="${origIndex}">Open</button>
                  <button class="btn" type="button" data-action="reveal" data-index="${origIndex}">Show in Finder</button>
                </div>
              </td>
            </tr>`;
          }).join("");
          body = `
          <table class="file-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Location</th>
                <th>Modified</th>
                <th style="text-align: right;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>`;
        }
      }
      mainContent = `
      <header class="desktop-content-header" data-tauri-drag-region>
        <div class="desktop-title-area" data-tauri-drag-region>
          <div style="display:flex; align-items:center; gap:8px;">
            <h1 class="desktop-title">Recent Files</h1>
            <span class="count-badge">${recent.length}</span>
          </div>
          <p class="desktop-subtitle">Files synchronized on this Mac</p>
        </div>
        <div class="desktop-header-actions">
          <button id="open-folder-btn" class="btn" type="button"${overview.initialized ? "" : " disabled"} title="Open RenegadeBox folder in Finder (⌘O)">${icons.folder()}<span>Open folder</span></button>
          <button id="pause-btn" class="btn" type="button" aria-pressed="${overview.paused}"${overview.initialized ? "" : " disabled"}>${overview.paused ? icons.play() : icons.pause()}<span>${pauseLabel}</span></button>
        </div>
      </header>

      <div class="files-toolbar">
        <div class="search-box">
          <span class="search-glyph">${icons.search(14)}</span>
          <input id="file-search-input" type="text" placeholder="Search recent files (⌘F)…" value="${escapeHtml(searchQuery)}" autocomplete="off" spellcheck="false" />
          ${searchQuery ? `<button id="file-search-clear" class="clear-search-btn" type="button" aria-label="Clear search">${icons.clear(12)}</button>` : `<kbd class="kbd-badge">⌘F</kbd>`}
        </div>
        <div class="category-pills" role="radiogroup" aria-label="Filter by file type">
          <button class="cat-pill${activeCategory === "all" ? " active" : ""}" data-cat="all" type="button">All</button>
          <button class="cat-pill${activeCategory === "documents" ? " active" : ""}" data-cat="documents" type="button">Documents</button>
          <button class="cat-pill${activeCategory === "images" ? " active" : ""}" data-cat="images" type="button">Images</button>
          <button class="cat-pill${activeCategory === "code" ? " active" : ""}" data-cat="code" type="button">Code</button>
          <button class="cat-pill${activeCategory === "archives" ? " active" : ""}" data-cat="archives" type="button">Archives</button>
        </div>
      </div>

      <div class="desktop-content-body">
        ${body}
      </div>`;
    } else if (activeTab === "conflicts") {
      let body = "";
      if (conflicts.length === 0) {
        body = `
        <div class="empty">
          <span class="done-icon" style="color:var(--ok);">${icons.check(32)}</span>
          <p style="margin-top:10px; font-weight:500;">All files are synchronized. Nothing needs your attention.</p>
        </div>`;
      } else {
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
        body = `
        <p class="explain">These files were changed in two places at once. RenegadeBox kept both versions so nothing was lost. Choose what to keep.</p>
        <ul class="conflict-list">${rows}</ul>`;
      }
      mainContent = `
      <header class="desktop-content-header" data-tauri-drag-region>
        <div class="desktop-title-area" data-tauri-drag-region>
          <div style="display:flex; align-items:center; gap:8px;">
            <h1 class="desktop-title">Activity & Conflicts</h1>
            ${conflicts.length > 0 ? `<span class="count-badge danger">${conflicts.length}</span>` : ""}
          </div>
          <p class="desktop-subtitle">Review sync conflicts and choose resolutions</p>
        </div>
      </header>
      <div class="desktop-content-body">
        ${body}
      </div>`;
    } else if (activeTab === "routing") {
      mainContent = `
      <header class="desktop-content-header" data-tauri-drag-region>
        <div class="desktop-title-area" data-tauri-drag-region>
          <h1 class="desktop-title">Smart Routing</h1>
          <p class="desktop-subtitle">Rules-first file routing to any destination folder, with AI fallback</p>
        </div>
      </header>
      <div class="desktop-content-body">
        ${renderSmartRoutingView({
        aiConfig,
        rules: smartRules,
        discoveredDirs,
        testResult: routingTestResult,
        activeRole,
        enabledRoles,
        roleRules,
        detectedVolume,
        editingRuleIndex,
        aiVerification,
        aiUsage,
        nasTransfers,
        nasStagingStatus,
        rulesPage,
        rulesSearch,
        reviewQueue,
        ruleSuggestions,
        ruleCheck,
        ruleCheckCanApply,
        routesOverview,
        routeEditor,
        selectedRouteId,
        showRoutingLedger
      })}
      </div>`;
    } else if (activeTab === "settings") {
      mainContent = `
      <header class="desktop-content-header" data-tauri-drag-region>
        <div class="desktop-title-area" data-tauri-drag-region>
          <h1 class="desktop-title">Settings</h1>
          <p class="desktop-subtitle">Preferences, account, storage, security, and ignore list</p>
        </div>
      </header>
      <div class="desktop-content-body">
        <div class="desktop-settings-container">
          ${renderSettings(settings, settingsTab, true)}
        </div>
      </div>`;
    }
    return `
    <div class="desktop-layout">
      <aside class="desktop-sidebar">
        <div class="desktop-sidebar-top">
          <div class="brand-header" data-tauri-drag-region>
            <div class="brand-info" data-tauri-drag-region>
              <span class="brand-icon">${icons.box(18)}</span>
              <span class="brand-title">RenegadeBox</span>
            </div>
          </div>
          <nav class="sidebar-nav">
            ${navHtml}
          </nav>
        </div>

        <div class="desktop-sidebar-bottom">
          <div class="storage-card">
            <div class="storage-card-header">
              <div class="storage-status ${statusClass}" title="${escapeHtml(st.title)}${st.detail ? ` - ${escapeHtml(st.detail)}` : ""}">
                <span class="dot"></span>
                <span class="storage-status-text">${escapeHtml(st.title)}</span>
              </div>
              <span class="storage-provider-pill">${escapeHtml(providerLabel(settings.status.endpoint))}</span>
            </div>
            <div class="storage-card-val" title="${escapeHtml(filesCount)}">${escapeHtml(filesCount)}</div>
            <div class="storage-meter-track" title="Storage in use">
              <div class="storage-meter-fill${overview.syncing ? " pulsing" : ""}" style="width: ${storageMeterWidth}%;"></div>
            </div>
            <div class="sidebar-quick-actions">
              <button id="sidebar-folder-btn" class="sidebar-quick-btn" type="button" title="Open RenegadeBox folder in Finder (⌘O)">
                ${icons.folder(12)}<span>Folder</span>
              </button>
              <button id="sidebar-pause-btn" class="sidebar-quick-btn" type="button" aria-pressed="${overview.paused}" title="${pauseLabel} syncing">
                ${overview.paused ? icons.play(12) : icons.pause(12)}<span>${pauseLabel}</span>
              </button>
            </div>
          </div>

          <div class="theme-switcher" id="sidebar-theme-switcher" role="radiogroup" aria-label="Appearance Theme">
            <button class="theme-btn${theme === "system" ? " active" : ""}" data-theme="system" type="button" title="System theme">
              ${icons.monitor(12)}<span>Auto</span>
            </button>
            <button class="theme-btn${theme === "light" ? " active" : ""}" data-theme="light" type="button" title="Light theme">
              ${icons.sun(12)}<span>Light</span>
            </button>
            <button class="theme-btn${theme === "dark" ? " active" : ""}" data-theme="dark" type="button" title="Dark theme">
              ${icons.moon(12)}<span>Dark</span>
            </button>
          </div>
        </div>
      </aside>

      <main class="desktop-main">
        ${mainContent}
      </main>
      <div id="desktop-toast" class="desktop-toast" role="status" aria-live="polite" hidden></div>
    </div>`;
  }
  function renderDesktopLoadError(message) {
    return `
    <main class="settings desktop-load-error">
      <div class="empty" role="alert">
        <p><strong>RenegadeBox couldn't load your settings.</strong></p>
        <p>${escapeHtml(message)}</p>
        <button id="desktop-retry-btn" class="btn primary" type="button">Retry</button>
      </div>
    </main>`;
  }

  // src/lib/theme.ts
  var STORAGE_KEY = "renegadebox-theme";
  function getTheme() {
    if (typeof localStorage === "undefined")
      return "system";
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
    return "system";
  }
  function setTheme(theme) {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, theme);
    }
    applyTheme(theme);
  }
  function applyTheme(theme) {
    const t = theme ?? getTheme();
    if (typeof document === "undefined")
      return;
    const root = document.documentElement;
    if (t === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", t);
    }
  }

  // src/lib/formstate.ts
  var isToggle = (el) => el.type === "checkbox" || el.type === "radio";
  function isFieldDirty(el) {
    if (isToggle(el))
      return el.defaultChecked !== undefined && el.checked !== el.defaultChecked;
    if (el.tagName.toUpperCase() === "SELECT") {
      const opts = el.options ? Array.from(el.options) : [];
      return opts.some((o) => o.selected !== o.defaultSelected);
    }
    return el.defaultValue !== undefined && el.value !== el.defaultValue;
  }
  function captureFormState(fields, active, panels = []) {
    const out = [];
    for (const el of fields) {
      if (!el.id || el.type === "file")
        continue;
      const focused = el === active;
      const dirty = isFieldDirty(el);
      if (!focused && !dirty)
        continue;
      out.push({
        id: el.id,
        value: el.value,
        checked: isToggle(el) ? !!el.checked : undefined,
        focused,
        dirty,
        selectionStart: focused && typeof el.selectionStart === "number" ? el.selectionStart : null,
        selectionEnd: focused && typeof el.selectionEnd === "number" ? el.selectionEnd : null
      });
    }
    const openPanels = [];
    for (const p of panels)
      if (p.id && !p.hidden)
        openPanels.push(p.id);
    return { fields: out, openPanels };
  }
  function restoreFormState(state, lookupField, lookupPanel = () => null) {
    for (const snap of state.fields) {
      const el = lookupField(snap.id);
      if (!el)
        continue;
      if (snap.dirty) {
        if (isToggle(el))
          el.checked = !!snap.checked;
        else
          el.value = snap.value;
      }
      if (snap.focused) {
        el.focus?.({ preventScroll: true });
        if (snap.selectionStart !== null && snap.selectionEnd !== null) {
          try {
            el.setSelectionRange?.(snap.selectionStart, snap.selectionEnd);
          } catch {}
        }
      }
    }
    for (const id of state.openPanels) {
      const p = lookupPanel(id);
      if (p)
        p.hidden = false;
    }
  }

  // src/main.ts
  function currentView() {
    const v = new URLSearchParams(location.search).get("view") ?? location.hash.replace("#", "");
    if (v === "settings" || v === "setup" || v === "popover")
      return v;
    return "desktop";
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
    activity: undefined,
    tab: "activity",
    query: "",
    menuOpen: false,
    conflicts: [],
    settingsModel: null,
    showConflicts: false,
    showSettings: false,
    busy: false
  };
  async function refreshPopover() {
    try {
      const [overview, recent, activity] = await Promise.all([
        invoke2("get_sync_overview"),
        invoke2("list_recent_files", { limit: 25 }),
        invoke2("get_sync_activity").catch(() => {
          return;
        })
      ]);
      popover.overview = overview;
      popover.recent = recent;
      popover.activity = activity;
      popover.conflicts = overview.conflicts > 0 || popover.showConflicts ? await invoke2("list_conflicts") : [];
    } catch (err) {
      popover.overview = { initialized: true, paused: false, syncing: false, pending: 0, conflicts: 0, error: errText(err) };
    }
    renderPopoverLive();
  }
  function renderPopoverLive() {
    if (popover.showSettings)
      return;
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
  function popoverModel() {
    return {
      overview: popover.overview,
      recent: popover.recent,
      activity: popover.activity,
      tab: popover.tab,
      query: popover.query,
      menuOpen: popover.menuOpen,
      now: Date.now()
    };
  }
  function renderPopoverView() {
    if (popover.showSettings && popover.settingsModel) {
      root().innerHTML = renderPopoverSettings(popover.settingsModel);
      bindSettings(popover.settingsModel.status);
      return;
    }
    if (!popover.overview)
      return;
    if (popover.showConflicts) {
      root().innerHTML = renderConflictList({ conflicts: popover.conflicts, now: Date.now() });
      return;
    }
    const search = $("popover-search");
    if (search && document.activeElement === search) {
      const list2 = $("popover-list");
      if (list2)
        list2.innerHTML = renderPopoverList(popoverModel());
      const footer = document.querySelector(".pop-status");
      const fresh = document.createElement("div");
      fresh.innerHTML = renderPopover(popoverModel());
      const freshFooter = fresh.querySelector(".pop-status");
      if (footer && freshFooter)
        footer.replaceWith(freshFooter);
      return;
    }
    const scroll = $("popover-list")?.scrollTop ?? 0;
    root().innerHTML = renderPopover(popoverModel());
    const list = $("popover-list");
    if (list)
      list.scrollTop = scroll;
  }
  function activityPath(path) {
    if (!path)
      return null;
    const all = [...popover.activity?.active ?? [], ...popover.activity?.recent ?? []];
    return all.some((a) => a.path === path) ? path : null;
  }
  async function onPopoverClick(ev) {
    const target = ev.target.closest("button");
    if (popover.menuOpen && (!target || target.id !== "settings-btn" && !target.closest("#popover-menu"))) {
      popover.menuOpen = false;
      renderPopoverView();
      if (!target)
        return;
    }
    if (!target || popover.busy)
      return;
    const index = Number(target.dataset.index);
    try {
      if (target.dataset.popoverTab) {
        popover.tab = target.dataset.popoverTab;
        renderPopoverView();
      } else if (target.id === "settings-btn") {
        popover.menuOpen = !popover.menuOpen;
        renderPopoverView();
      } else if (target.id === "menu-open-app" || target.id === "open-app-btn") {
        popover.menuOpen = false;
        await invoke2("open_main_window");
      } else if (target.id === "menu-quit") {
        await invoke2("quit_app");
      } else if (target.id === "menu-pause") {
        popover.menuOpen = false;
        await invoke2(popover.overview?.paused ? "resume_sync" : "pause_sync");
        await refreshPopover();
      } else if (target.id === "status-line" && target.classList.contains("status-link")) {
        popover.showConflicts = true;
        popover.showSettings = false;
        await refreshPopover();
      } else if (target.id === "conflicts-back") {
        popover.showConflicts = false;
        renderPopoverView();
      } else if (target.id === "menu-preferences") {
        popover.menuOpen = false;
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
      } else if (target.dataset.resolution) {
        const item = popover.conflicts[index];
        if (!item)
          return;
        target.closest(".conflict")?.querySelectorAll("button").forEach((b) => b.disabled = true);
        try {
          await withBusy(popover, () => resolveConflict(invoke2, item, target.dataset.resolution));
        } catch (err) {
          await refreshPopover();
          showPopoverNotice(`Couldn't resolve the conflict. ${friendlyError(errText(err), "Please try again.")}`);
          return;
        }
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
      } else if (target.dataset.action === "open-activity") {
        const p = activityPath(target.dataset.path);
        if (p)
          await invoke2("open_file", { path: p });
      } else if (target.dataset.action === "reveal-activity") {
        const p = activityPath(target.dataset.path);
        if (p)
          await invoke2("reveal_in_finder", { path: p });
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
    root().addEventListener("input", (e) => {
      const el = e.target;
      if (el.id !== "popover-search")
        return;
      popover.query = el.value;
      const list = $("popover-list");
      if (list)
        list.innerHTML = renderPopoverList(popoverModel());
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (popover.menuOpen) {
          popover.menuOpen = false;
          renderPopoverView();
        } else if (popover.query && document.activeElement?.id === "popover-search") {
          popover.query = "";
          root().innerHTML = renderPopover(popoverModel());
        } else if (popover.showSettings) {
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
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        $("popover-search")?.focus();
      }
    });
    window.addEventListener("focus", () => void refreshPopover());
    let pending = null;
    const soon = () => {
      if (pending)
        clearTimeout(pending);
      pending = setTimeout(() => void refreshPopover(), 150);
    };
    onBackendEvents(["status-changed", "vault-changed", "sync-started", "sync-finished", "sync-paused", "sync-resumed", "sync-activity", "nas-transfer-occurred"], soon);
    setInterval(renderPopoverLive, 30000);
    refreshPopover();
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
    document.querySelectorAll("#general-theme-switcher .theme-btn").forEach((btn) => {
      const t = btn.dataset.theme;
      if (t === getTheme())
        btn.classList.add("active");
      btn.addEventListener("click", () => {
        const chosen = btn.dataset.theme;
        if (chosen) {
          setTheme(chosen);
          document.querySelectorAll(".theme-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.theme === chosen);
          });
        }
      });
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
    $("finder-extension-btn")?.addEventListener("click", () => void invoke2("open_finder_extensions"));
    $("add-finder-btn")?.addEventListener("click", async () => {
      try {
        await invoke2("add_to_finder_favorites");
        flash("device-name-message", "Added to the Finder sidebar.");
      } catch (err) {
        flash("device-name-message", `Couldn't add the folder to the Finder sidebar. ${friendlyError(errText(err), "Please try again.")}`, true);
      }
    });
    $("reconnect-btn").addEventListener("click", () => void invoke2("open_setup"));
    $("quit-btn").addEventListener("click", () => void invoke2("quit_app"));
  }
  function setAccountStatus(next) {
    const a = desktop.account;
    if (!next)
      return;
    if (a.status?.signed_in !== next.signed_in || a.status?.email !== next.email) {
      a.devices = null;
      a.devicesError = null;
    }
    a.status = next;
  }
  function renderAccountChange(clearForms = false) {
    if (desktop.activeTab === "settings")
      renderDesktopView({ preserveInput: !clearForms });
  }
  async function loadAccountDevices() {
    const a = desktop.account;
    if (!a.status?.signed_in || a.devicesLoading)
      return;
    a.devicesLoading = true;
    try {
      a.devices = await accountDevices();
      a.devicesError = null;
    } catch (err) {
      a.devices = null;
      a.devicesError = `Couldn't load your Macs. ${errText(err)}`;
    } finally {
      a.devicesLoading = false;
    }
    renderAccountChange();
  }
  async function runAccountAction(action, slot, fn) {
    const a = desktop.account;
    if (a.busy)
      return;
    a.action = action;
    a.message = null;
    renderAccountChange();
    let ok = false;
    try {
      const text = await withBusy(a, fn);
      a.message = text ? { slot, text, error: false } : null;
      ok = true;
    } catch (err) {
      a.message = { slot, text: errText(err), error: true };
    } finally {
      a.action = null;
      a.removingIndex = null;
    }
    renderAccountChange(ok);
  }
  async function googleSignInFromSettings() {
    const a = desktop.account;
    if (a.action)
      return;
    const attempt = ++a.googleAttempt;
    a.action = "google";
    a.message = null;
    renderAccountChange();
    try {
      setAccountStatus(await accountGoogleSignIn());
      showToast("Signed in with Google. Any Mac you sign in on now sets itself up from this one.", 5000);
      if (attempt !== a.googleAttempt)
        return renderAccountChange();
    } catch (err) {
      if (attempt !== a.googleAttempt)
        return;
      a.message = { slot: "google", text: errText(err), error: true };
    }
    a.action = null;
    renderAccountChange();
  }
  function accountProblem(slot, text) {
    desktop.account.message = { slot, text, error: true };
    renderAccountChange();
  }
  function bindAccount() {
    const a = desktop.account;
    const value = (id) => $(id)?.value ?? "";
    if (desktop.settingsTab === "account" && a.status?.signed_in && a.devices === null && !a.devicesLoading && !a.devicesError) {
      loadAccountDevices();
    }
    $("account-google-btn")?.addEventListener("click", () => void googleSignInFromSettings());
    $("account-google-cancel")?.addEventListener("click", () => {
      a.googleAttempt++;
      a.action = null;
      a.message = null;
      renderAccountChange();
    });
    $("account-password-toggle")?.addEventListener("click", () => {
      a.showPasswordForms = true;
      renderAccountChange();
      $("account-create-email:not([disabled])")?.focus();
    });
    $("account-create-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = value("account-create-email").trim();
      const password = value("account-create-password");
      const problem = validateCreateAccount(email, password, value("account-create-confirm"));
      if (problem)
        return accountProblem("create", problem);
      runAccountAction("create", "create", async () => {
        setAccountStatus(await accountCreate({ email, password }));
        showToast("Your account is ready. Sign in on another Mac to set it up from this one.", 5000);
        return "";
      });
    });
    $("account-signin-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const email = value("account-signin-email").trim();
      const password = value("account-signin-password");
      const problem = validateSignIn(email, password);
      if (problem)
        return accountProblem("signin", problem);
      runAccountAction("signin", "signin", async () => {
        setAccountStatus(await accountSignIn({ email, password }));
        showToast("This Mac is now linked to your account.", 4000);
        return "";
      });
    });
    $("account-password-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const password = value("account-new-password");
      const problem = validateNewPassword(password, value("account-new-password-confirm"));
      if (problem)
        return accountProblem("password", problem);
      runAccountAction("password", "password", async () => {
        await accountChangePassword(password);
        return "Password changed. Your other Macs stay signed in.";
      });
    });
    const signoutConfirm = $("account-signout-confirm");
    $("account-signout-btn")?.addEventListener("click", () => signoutConfirm && (signoutConfirm.hidden = false));
    $("account-signout-cancel")?.addEventListener("click", () => signoutConfirm && (signoutConfirm.hidden = true));
    $("account-signout-confirm-btn")?.addEventListener("click", () => {
      if (signoutConfirm)
        signoutConfirm.hidden = true;
      runAccountAction("signout", "signout", async () => {
        setAccountStatus(await accountSignOut());
        showToast("Signed out. Your files keep syncing.", 4000);
        return "";
      });
    });
    const confirmFor = (i) => $(`account-remove-confirm-${i}`);
    document.querySelectorAll("[data-remove-device]").forEach((btn) => btn.addEventListener("click", () => {
      const box = confirmFor(btn.dataset.removeDevice);
      if (box)
        box.hidden = false;
    }));
    document.querySelectorAll("[data-remove-cancel]").forEach((btn) => btn.addEventListener("click", () => {
      const box = confirmFor(btn.dataset.removeCancel);
      if (box)
        box.hidden = true;
    }));
    document.querySelectorAll("[data-remove-confirm]").forEach((btn) => btn.addEventListener("click", () => {
      const index = Number(btn.dataset.removeConfirm);
      const device = accountDeviceRows(a.devices)[index];
      const box = confirmFor(String(index));
      if (box)
        box.hidden = true;
      if (!device || device.current)
        return;
      a.removingIndex = index;
      runAccountAction("remove", "devices", async () => {
        await accountRemoveDevice(device.id);
        a.devices = (a.devices ?? []).filter((d) => d.id !== device.id);
        return `${device.name} was removed from your account.`;
      });
    }));
  }
  var SETUP_TITLES = { signin: "Sign in to RenegadeBox", wizard: "Set up RenegadeBox" };
  function initSetup() {
    document.title = SETUP_TITLES.signin;
    accountStatus().then((s) => s.device_ready ? "wizard" : "signin").catch(() => "signin").then(startSetup);
  }
  function startSetup(mode) {
    document.title = SETUP_TITLES[mode];
    root().innerHTML = renderSetup(mode);
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
      $("setup-signin-instead").hidden = s !== 1;
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
    const showPanel = (m) => {
      $("signin-panel").hidden = m !== "signin";
      $("setup-wizard").hidden = m !== "wizard";
      $("setup-title").textContent = SETUP_TITLES[m];
      document.title = SETUP_TITLES[m];
      if (m === "wizard")
        show(1);
      else
        $("signin-google-btn")?.focus();
    };
    $("signin-use-storage").addEventListener("click", () => showPanel("wizard"));
    $("setup-signin-instead").addEventListener("click", () => showPanel("signin"));
    const finishSignedIn = () => {
      finished = true;
      $("signin-panel").hidden = true;
      $("setup-wizard").hidden = false;
      document.querySelector(".steps").hidden = true;
      show("done");
    };
    let googleAttempt = 0;
    const googleWaiting = (on) => {
      $("signin-google-idle").hidden = on;
      $("signin-google-waiting").hidden = !on;
      for (const id of ["signin-email-toggle", "signin-use-storage", "signin-btn"]) {
        const b = $(id);
        if (b)
          b.disabled = on;
      }
    };
    $("signin-google-btn").addEventListener("click", async () => {
      const attempt = ++googleAttempt;
      $("signin-google-error").textContent = "";
      googleWaiting(true);
      try {
        await accountGoogleSignIn();
        finishSignedIn();
      } catch (err) {
        if (attempt === googleAttempt)
          $("signin-google-error").textContent = errText(err);
      } finally {
        if (attempt === googleAttempt)
          googleWaiting(false);
      }
    });
    $("signin-google-cancel").addEventListener("click", () => {
      googleAttempt++;
      googleWaiting(false);
    });
    $("signin-email-toggle").addEventListener("click", (e) => {
      const toggle = e.currentTarget;
      toggle.hidden = true;
      toggle.setAttribute("aria-expanded", "true");
      $("signin-form").hidden = false;
      input("signin-email").focus();
    });
    let signingIn = false;
    $("signin-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (signingIn)
        return;
      const email = input("signin-email").value.trim();
      const password = input("signin-password").value;
      const signinError = $("signin-error");
      const problem = validateSignIn(email, password);
      if (problem)
        return void (signinError.textContent = problem);
      signinError.textContent = "";
      const btn = $("signin-btn");
      const controls = [btn, $("signin-use-storage"), $("signin-google-btn"), input("signin-email"), input("signin-password")];
      signingIn = true;
      controls.forEach((c) => c.disabled = true);
      btn.textContent = "Signing in…";
      try {
        await accountSignIn({ email, password });
        finishSignedIn();
      } catch (err) {
        signinError.textContent = errText(err);
        input("signin-password").focus();
      } finally {
        signingIn = false;
        controls.forEach((c) => c.disabled = false);
        btn.textContent = "Sign in";
      }
    });
    choose(provider);
    show(1);
    if (mode === "signin")
      $("signin-google-btn")?.focus();
  }
  var desktop = {
    activeTab: "files",
    overview: null,
    recent: [],
    conflicts: [],
    settingsModel: null,
    aiConfig: undefined,
    smartRules: [],
    discoveredDirs: [],
    routingTestResult: null,
    activeRole: typeof localStorage !== "undefined" ? localStorage.getItem("renegadebox-routing-role") || "webdev" : "webdev",
    enabledRoles: typeof localStorage !== "undefined" ? (() => {
      try {
        const raw = localStorage.getItem("renegadebox-enabled-roles");
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : ["webdev"];
      } catch {
        return ["webdev"];
      }
    })() : ["webdev"],
    roleRules: typeof localStorage !== "undefined" ? (() => {
      try {
        const raw = localStorage.getItem("renegadebox-role-rules");
        if (!raw)
          return { ...DEFAULT_ROLE_RULES };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
          return { ...DEFAULT_ROLE_RULES };
        const clean = {};
        for (const role of ROUTING_ROLES) {
          const list = Array.isArray(parsed[role.id]) ? parsed[role.id] : DEFAULT_ROLE_RULES[role.id];
          let rulesList = (Array.isArray(list) ? list : []).map((item) => {
            if (typeof item === "string")
              return item;
            if (item && typeof item === "object") {
              if ("rule" in item)
                return String(item.rule);
              if ("text" in item)
                return String(item.text);
            }
            return String(item || "");
          }).filter((s) => s.trim().length > 0);
          if (rulesList.length === 0) {
            rulesList = [...DEFAULT_ROLE_RULES[role.id] || []];
          }
          clean[role.id] = rulesList;
        }
        return clean;
      } catch {
        return { ...DEFAULT_ROLE_RULES };
      }
    })() : { ...DEFAULT_ROLE_RULES },
    editingRuleIndex: null,
    aiVerification: null,
    aiUsage: null,
    nasTransfers: [],
    nasStagingStatus: null,
    reviewQueue: [],
    ruleSuggestions: [],
    ruleCheck: null,
    ruleCheckCanApply: false,
    routesOverview: null,
    routeEditor: null,
    pendingDeleteRouteId: null,
    selectedRouteId: null,
    showRoutingLedger: false,
    detectedVolume: null,
    rulesLoadedFromConfig: false,
    rulesPage: 1,
    rulesSearch: "",
    theme: getTheme(),
    searchQuery: "",
    activeCategory: "all",
    settingsTab: "general",
    loadError: null,
    busy: false,
    account: {
      status: null,
      devices: null,
      devicesLoading: false,
      devicesError: null,
      action: null,
      removingIndex: null,
      message: null,
      showPasswordForms: false,
      busy: false,
      googleAttempt: 0
    }
  };
  function isBloatRule(rule) {
    const lower = rule.toLowerCase().trim();
    return lower.startsWith("files matching ") || /\bgo\s+to\s+unsorted\s*$/.test(lower);
  }
  async function persistRoleRules() {
    try {
      await invoke2("save_routing_rules", {
        roleRules: desktop.roleRules,
        enabledRoles: desktop.enabledRoles,
        role_rules: desktop.roleRules,
        enabled_roles: desktop.enabledRoles
      });
      const hadUndo = (desktop.aiConfig?.rules_backup_count ?? 0) > 0;
      const cfg = await invoke2("get_ai_config").catch(() => {
        return;
      });
      if (cfg) {
        desktop.aiConfig = cfg;
        if (!hadUndo && (cfg.rules_backup_count ?? 0) > 0 && desktop.activeTab === "routing") {
          renderDesktopView();
        }
      }
      return true;
    } catch (err) {
      showToast(`Could not save rules: ${errText(err)}`, 4000);
      return false;
    }
  }
  function saveRoleRulesToLocalOnly() {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem("renegadebox-role-rules", JSON.stringify(desktop.roleRules));
        localStorage.setItem("renegadebox-enabled-roles", JSON.stringify(desktop.enabledRoles));
        localStorage.setItem("renegadebox-routing-role", desktop.activeRole);
      } catch {}
    }
  }
  function saveRoleRulesToStorage() {
    saveRoleRulesToLocalOnly();
    persistRoleRules();
  }
  function roleLabel(id) {
    return ROUTING_ROLES.find((r) => r.id === id)?.title ?? "this workflow";
  }
  function computeAggregateRules() {
    const set = new Set;
    const safeEnabled = Array.isArray(desktop.enabledRoles) ? desktop.enabledRoles : ["webdev"];
    for (const roleId of safeEnabled) {
      const list = desktop.roleRules?.[roleId] || DEFAULT_ROLE_RULES[roleId] || [];
      if (Array.isArray(list)) {
        for (const r of list) {
          const str = typeof r === "string" ? r : r && typeof r === "object" && ("rule" in r) ? String(r.rule) : String(r || "");
          if (str && str.trim())
            set.add(str.trim());
        }
      }
    }
    return Array.from(set);
  }
  var toastTimer = null;
  function showToast(msg, durationMs = 2200) {
    const t = $("desktop-toast");
    if (!t)
      return;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, durationMs);
  }
  async function refreshDesktop(opts = {}) {
    try {
      const [overview, recent, status, autostart, ignored, aiConfig, aiUsage, nasTransfers, nasStagingStatus, reviewQueue, ruleSuggestions, routesOverview, account] = await Promise.all([
        invoke2("get_sync_overview"),
        invoke2("list_recent_files", { limit: 25 }),
        invoke2("get_vault_status"),
        invoke2("is_autostart_enabled").catch(() => false),
        invoke2("get_ignored_patterns").catch(() => []),
        invoke2("get_ai_config").catch(() => {
          return;
        }),
        invoke2("get_ai_usage").catch(() => null),
        invoke2("get_nas_transfers").catch(() => []),
        invoke2("get_nas_staging_status").catch(() => null),
        invoke2("get_review_queue").catch(() => []),
        invoke2("get_rule_suggestions").catch(() => []),
        invoke2("get_routes").catch(() => null),
        accountStatus().catch(() => null)
      ]);
      setAccountStatus(account);
      desktop.overview = overview;
      desktop.recent = recent;
      desktop.settingsModel = { status, autostart, ignored };
      desktop.aiConfig = aiConfig;
      desktop.reviewQueue = Array.isArray(reviewQueue) ? reviewQueue : [];
      desktop.ruleSuggestions = Array.isArray(ruleSuggestions) ? ruleSuggestions : [];
      if (routesOverview)
        desktop.routesOverview = routesOverview;
      if (aiUsage) {
        desktop.aiUsage = aiUsage;
      }
      if (nasTransfers) {
        desktop.nasTransfers = nasTransfers;
      }
      if (nasStagingStatus) {
        desktop.nasStagingStatus = nasStagingStatus;
      }
      if (!desktop.detectedVolume) {
        const vols = await invoke2("list_detected_volumes").catch(() => []);
        if (vols.length > 0)
          desktop.detectedVolume = vols[0].path;
      }
      if (desktop.smartRules.length === 0) {
        desktop.smartRules = computeAggregateRules();
      }
      if (aiConfig && !desktop.rulesLoadedFromConfig) {
        desktop.rulesLoadedFromConfig = true;
        const cfgRoles = aiConfig.role_rules;
        if (cfgRoles && Object.keys(cfgRoles).length > 0) {
          const merged = { ...DEFAULT_ROLE_RULES };
          for (const role of ROUTING_ROLES) {
            const list = cfgRoles[role.id];
            if (Array.isArray(list))
              merged[role.id] = list.filter((s) => typeof s === "string" && s.trim().length > 0);
          }
          desktop.roleRules = merged;
          const validRoles = (aiConfig.enabled_roles || []).filter((r) => ROUTING_ROLES.some((x) => x.id === r));
          if (validRoles.length > 0)
            desktop.enabledRoles = validRoles;
        } else {
          await persistRoleRules();
          let bloatCount = 0;
          for (const role of ROUTING_ROLES) {
            const list = desktop.roleRules[role.id] || [];
            const kept = list.filter((r) => !isBloatRule(r));
            bloatCount += list.length - kept.length;
            desktop.roleRules[role.id] = kept.length > 0 ? kept : [...DEFAULT_ROLE_RULES[role.id] || []];
          }
          if (bloatCount > 0 && await persistRoleRules()) {
            setTimeout(() => showToast(`Removed ${bloatCount.toLocaleString()} auto-generated rules. "Undo Last Rules Change" restores them.`, 6000), 300);
          }
          saveRoleRulesToLocalOnly();
        }
        desktop.smartRules = computeAggregateRules();
      }
      desktop.conflicts = overview.conflicts > 0 || desktop.activeTab === "conflicts" ? await invoke2("list_conflicts") : [];
      desktop.loadError = null;
    } catch (err) {
      desktop.overview = { initialized: true, paused: false, syncing: false, pending: 0, conflicts: 0, error: errText(err) };
      if (!desktop.settingsModel)
        desktop.loadError = friendlyError(errText(err), "Please try again.");
    }
    desktop.theme = getTheme();
    renderDesktopView({ preserveInput: opts.background === true });
  }
  var FORM_FIELDS = "input[id], textarea[id], select[id]";
  var KEEP_OPEN = "[data-keep-open][id]";
  function captureDesktopForm() {
    const fields = Array.from(document.querySelectorAll(FORM_FIELDS));
    const panels = Array.from(document.querySelectorAll(KEEP_OPEN));
    return captureFormState(fields, document.activeElement, panels);
  }
  function restoreDesktopForm(state) {
    restoreFormState(state, (id) => {
      const el = document.getElementById(id);
      return el && el.matches(FORM_FIELDS) ? el : null;
    }, (id) => {
      const el = document.getElementById(id);
      return el && el.matches(KEEP_OPEN) ? el : null;
    });
  }
  function renderDesktopLoadErrorView(message) {
    root().innerHTML = renderDesktopLoadError(message);
    $("desktop-retry-btn")?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Retrying…";
      refreshDesktop();
    });
  }
  function renderDesktopView(opts = {}) {
    if (!desktop.settingsModel) {
      if (desktop.loadError)
        renderDesktopLoadErrorView(desktop.loadError);
      return;
    }
    if (!desktop.overview)
      return;
    const active = document.activeElement;
    const focusId = active?.id && active.id.startsWith("route-") ? active.id : null;
    const selStart = focusId && "selectionStart" in active ? active.selectionStart : null;
    const selEnd = focusId && "selectionEnd" in active ? active.selectionEnd : null;
    const body = document.querySelector(".desktop-content-body");
    const prevPage = body?.dataset.page;
    const scroll = body?.scrollTop ?? 0;
    const page = desktopPageKey();
    const formState = opts.preserveInput && prevPage === page ? captureDesktopForm() : null;
    try {
      root().innerHTML = renderDesktopApp({
        activeTab: desktop.activeTab,
        overview: desktop.overview,
        recent: desktop.recent,
        conflicts: desktop.conflicts,
        settings: { ...desktop.settingsModel, account: { ...desktop.account, now: Date.now() } },
        settingsTab: desktop.settingsTab,
        theme: desktop.theme,
        searchQuery: desktop.searchQuery,
        activeCategory: desktop.activeCategory,
        now: Date.now(),
        aiConfig: desktop.aiConfig,
        smartRules: desktop.smartRules,
        discoveredDirs: desktop.discoveredDirs,
        routingTestResult: desktop.routingTestResult,
        activeRole: desktop.activeRole,
        enabledRoles: desktop.enabledRoles,
        roleRules: desktop.roleRules,
        detectedVolume: desktop.detectedVolume,
        editingRuleIndex: desktop.editingRuleIndex,
        aiVerification: desktop.aiVerification,
        aiUsage: desktop.aiUsage,
        nasTransfers: desktop.nasTransfers,
        nasStagingStatus: desktop.nasStagingStatus,
        rulesPage: desktop.rulesPage,
        rulesSearch: desktop.rulesSearch,
        reviewQueue: desktop.reviewQueue,
        ruleSuggestions: desktop.ruleSuggestions,
        ruleCheck: desktop.ruleCheck,
        ruleCheckCanApply: desktop.ruleCheckCanApply,
        routesOverview: desktop.routesOverview,
        routeEditor: desktop.routeEditor,
        selectedRouteId: desktop.selectedRouteId,
        showRoutingLedger: desktop.showRoutingLedger
      });
      const newBody = document.querySelector(".desktop-content-body");
      if (newBody) {
        newBody.dataset.tab = desktop.activeTab;
        newBody.dataset.page = page;
        if (prevPage === page)
          newBody.scrollTop = scroll;
      }
      if (formState) {
        restoreDesktopForm(formState);
      } else if (focusId) {
        const el = document.getElementById(focusId);
        if (el) {
          el.focus({ preventScroll: true });
          if (selStart !== null && selEnd !== null) {
            try {
              el.setSelectionRange(selStart, selEnd);
            } catch {}
          }
        }
      }
      bindDesktopEvents();
    } catch (err) {
      console.error("[RenegadeBox] renderDesktopView error:", err);
      showToast(`Something went wrong showing this page. ${errText(err)}`, 4000);
    }
  }
  function desktopPageKey() {
    if (desktop.activeTab !== "routing")
      return desktop.activeTab;
    if (desktop.routeEditor)
      return `routing:edit:${desktop.routeEditor.draft.id || "new"}`;
    return `routing:${desktop.selectedRouteId ?? "home"}`;
  }
  function showRoutesHome() {
    desktop.routeEditor = null;
    desktop.selectedRouteId = null;
    desktop.pendingDeleteRouteId = null;
    renderDesktopView();
  }
  function blankRoute() {
    return {
      id: "",
      name: "",
      enabled: true,
      source: "",
      destination: "",
      mode: "move",
      auto: true,
      ai: true,
      use_review_folder: true,
      scan_subfolders: false,
      skip_duplicates: true,
      vault: false,
      rules: [],
      layout: null,
      template: "blank"
    };
  }
  function captureRouteDraft() {
    const ed = desktop.routeEditor;
    if (!ed || !$("route-editor"))
      return;
    const d = ed.draft;
    const text = (id) => $(id)?.value;
    const flag = (id, set) => {
      const el = $(id);
      if (el && !el.disabled)
        set(el.checked);
    };
    d.name = text("route-name") ?? d.name;
    d.mode = text("route-mode") ?? d.mode;
    d.source = text("route-source") ?? d.source;
    d.destination = text("route-destination") ?? d.destination;
    const layout = text("route-layout");
    if (layout !== undefined)
      d.layout = layout || null;
    const rules = text("route-rules");
    if (rules !== undefined)
      d.rules = rules.split(`
`);
    flag("route-auto", (v) => d.auto = v);
    flag("route-ai", (v) => d.ai = v);
    flag("route-subfolders", (v) => d.scan_subfolders = v);
    flag("route-skip-dupes", (v) => d.skip_duplicates = v);
    flag("route-review-folder", (v) => d.use_review_folder = v);
    flag("route-vault", (v) => d.vault = v);
  }
  async function reloadRoutes() {
    const ov = await invoke2("get_routes").catch(() => null);
    if (ov)
      desktop.routesOverview = ov;
  }
  function openRouteEditor(draft, isNew) {
    desktop.routeEditor = { draft, isNew, error: null };
    desktop.selectedRouteId = isNew ? null : draft.id;
    desktop.pendingDeleteRouteId = null;
    renderDesktopView();
    if (isNew)
      $("route-name")?.focus({ preventScroll: true });
  }
  function bindRouteEvents() {
    $("route-new-btn")?.addEventListener("click", () => openRouteEditor(blankRoute(), true));
    $("route-back-btn")?.addEventListener("click", showRoutesHome);
    $("route-editor")?.addEventListener("input", captureRouteDraft);
    $("route-editor")?.addEventListener("change", captureRouteDraft);
    document.querySelectorAll("[data-route-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.routeOpen || "";
        const r = desktop.routesOverview?.routes.find((x) => x.config.id === id);
        if (!r)
          return;
        if (r.is_main) {
          desktop.routeEditor = null;
          desktop.selectedRouteId = "main";
          renderDesktopView();
        } else {
          openRouteEditor(JSON.parse(JSON.stringify(r.config)), false);
        }
      });
    });
    document.querySelectorAll("[data-route-template]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ed = desktop.routeEditor;
        const t = desktop.routesOverview?.templates.find((x) => x.id === btn.dataset.routeTemplate);
        if (!ed || !t)
          return;
        captureRouteDraft();
        const d = ed.draft;
        const templateNames = (desktop.routesOverview?.templates ?? []).map((x) => x.name);
        if (!d.name.trim() || templateNames.includes(d.name.trim()))
          d.name = t.id === "blank" ? "" : t.name;
        d.mode = t.mode;
        d.scan_subfolders = t.scan_subfolders;
        d.layout = t.layout;
        d.rules = [...t.rules];
        d.template = t.id;
        renderDesktopView();
      });
    });
    $("route-mode")?.addEventListener("change", () => {
      captureRouteDraft();
      renderDesktopView();
    });
    const browse = (buttonId, inputId) => $(buttonId)?.addEventListener("click", async () => {
      try {
        const chosen = await invoke2("choose_folder");
        const input = $(inputId);
        if (chosen && input) {
          input.value = chosen;
          captureRouteDraft();
        }
      } catch (err) {
        showToast(`Could not open the folder picker: ${errText(err)}`, 4000);
      }
    });
    browse("route-source-browse", "route-source");
    browse("route-destination-browse", "route-destination");
    $("route-cancel-btn")?.addEventListener("click", showRoutesHome);
    $("route-save-btn")?.addEventListener("click", async () => {
      const ed = desktop.routeEditor;
      if (!ed)
        return;
      captureRouteDraft();
      const route = {
        ...ed.draft,
        rules: ed.draft.rules.map((r) => r.trim()).filter(Boolean),
        layout: (ed.draft.layout || "").trim() || null
      };
      ed.saving = true;
      ed.error = null;
      renderDesktopView();
      try {
        const saved = await invoke2("save_route", { route });
        desktop.routeEditor = null;
        desktop.selectedRouteId = null;
        await reloadRoutes();
        showToast(`Route "${saved.name}" saved`);
      } catch (err) {
        if (desktop.routeEditor) {
          desktop.routeEditor.saving = false;
          desktop.routeEditor.error = errText(err);
        }
      }
      renderDesktopView();
    });
    document.querySelectorAll("[data-route-delete]").forEach((btn) => {
      const routeId = btn.dataset.routeDelete || "";
      if (desktop.pendingDeleteRouteId === routeId) {
        btn.classList.add("danger");
        btn.textContent = "Delete route?";
      }
      btn.addEventListener("click", async () => {
        if (desktop.pendingDeleteRouteId !== routeId) {
          desktop.pendingDeleteRouteId = routeId;
          renderDesktopView();
          return;
        }
        desktop.pendingDeleteRouteId = null;
        try {
          await invoke2("delete_route", { routeId, route_id: routeId });
          if (desktop.routeEditor?.draft.id === routeId)
            desktop.routeEditor = null;
          if (desktop.selectedRouteId === routeId)
            desktop.selectedRouteId = null;
          await reloadRoutes();
          showToast("Route deleted. No files were touched.");
        } catch (err) {
          showToast(`Could not delete: ${errText(err)}`, 4000);
        }
        renderDesktopView();
      });
    });
    document.querySelectorAll("[data-route-enable]").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const r = desktop.routesOverview?.routes.find((x) => x.config.id === cb.dataset.routeEnable);
        if (!r)
          return;
        try {
          await invoke2("save_route", { route: { ...r.config, enabled: cb.checked } });
          await reloadRoutes();
          showToast(cb.checked ? `"${r.config.name}" is on` : `"${r.config.name}" is off`);
        } catch (err) {
          cb.checked = !cb.checked;
          showToast(`Could not change the route: ${errText(err)}`, 5000);
        }
        renderDesktopView();
      });
    });
    document.querySelectorAll("[data-route-run]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const routeId = btn.dataset.routeRun || "";
        btn.disabled = true;
        btn.textContent = "Sorting...";
        try {
          const moved = await invoke2("run_route_now", { routeId, route_id: routeId });
          showToast(moved.length ? `Sorted ${moved.length} file${moved.length === 1 ? "" : "s"}` : "Nothing new to sort", 3000);
        } catch (err) {
          showToast(`Could not run the route: ${errText(err)}`, 5000);
        }
        await refreshDesktop();
      });
    });
  }
  function bindDesktopEvents() {
    if (!desktop.settingsModel)
      return;
    document.querySelectorAll("[data-desktop-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.desktopTab;
        if (tab && desktop.activeTab !== tab) {
          desktop.activeTab = tab;
          renderDesktopView();
        }
      });
    });
    const searchInput = $("file-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        desktop.searchQuery = searchInput.value;
        renderDesktopView();
        const nextInput = $("file-search-input");
        if (nextInput) {
          nextInput.focus();
          const len = nextInput.value.length;
          nextInput.setSelectionRange(len, len);
        }
      });
    }
    $("file-search-clear")?.addEventListener("click", () => {
      desktop.searchQuery = "";
      renderDesktopView();
      $("file-search-input")?.focus();
    });
    $("clear-search-btn")?.addEventListener("click", () => {
      desktop.searchQuery = "";
      desktop.activeCategory = "all";
      renderDesktopView();
    });
    document.querySelectorAll(".cat-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        if (cat && desktop.activeCategory !== cat) {
          desktop.activeCategory = cat;
          renderDesktopView();
        }
      });
    });
    document.querySelectorAll(".theme-btn").forEach((btn) => {
      const t = btn.dataset.theme;
      if (t === desktop.theme)
        btn.classList.add("active");
      btn.addEventListener("click", () => {
        const chosen = btn.dataset.theme;
        if (chosen) {
          setTheme(chosen);
          desktop.theme = chosen;
          document.querySelectorAll(".theme-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.theme === chosen);
          });
        }
      });
    });
    $("sidebar-folder-btn")?.addEventListener("click", () => void invoke2("open_sync_folder"));
    $("open-folder-btn")?.addEventListener("click", () => void invoke2("open_sync_folder"));
    $("start-setup-btn")?.addEventListener("click", () => void invoke2("open_setup"));
    const togglePause = async () => {
      if (!desktop.overview || desktop.busy)
        return;
      desktop.busy = true;
      try {
        if (desktop.overview.paused) {
          await invoke2("resume_sync");
          showToast("Sync resumed");
        } else {
          await invoke2("pause_sync");
          showToast("Sync paused");
        }
      } catch (err) {
        showToast(`Couldn't change sync. ${friendlyError(errText(err), "Please try again.")}`, 4000);
      } finally {
        desktop.busy = false;
      }
      await refreshDesktop();
    };
    $("sidebar-pause-btn")?.addEventListener("click", togglePause);
    $("pause-btn")?.addEventListener("click", togglePause);
    document.querySelectorAll("tr.file-table-row").forEach((row) => {
      row.addEventListener("dblclick", () => {
        const idx = Number(row.dataset.index);
        const f = desktop.recent[idx];
        if (f)
          invoke2("open_file", { path: f.path });
      });
    });
    document.querySelectorAll("[data-action='open']").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.index);
        const f = desktop.recent[idx];
        if (f)
          invoke2("open_file", { path: f.path });
      });
    });
    document.querySelectorAll("[data-action='reveal']").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.index);
        const f = desktop.recent[idx];
        if (f)
          invoke2("reveal_in_finder", { path: f.path });
      });
    });
    document.querySelectorAll("[data-action='copy-path']").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.index);
        const f = desktop.recent[idx];
        if (f) {
          const fullPath = f.folder ? `${f.folder}/${f.name}` : f.name;
          try {
            await navigator.clipboard.writeText(fullPath);
            showToast(`Copied: ${f.name}`);
          } catch {
            showToast(`Path: ${f.name}`);
          }
        }
      });
    });
    document.querySelectorAll("[data-resolution]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.index);
        const item = desktop.conflicts[idx];
        if (!item || desktop.busy)
          return;
        btn.closest(".conflict")?.querySelectorAll("button").forEach((b) => b.disabled = true);
        try {
          await withBusy(desktop, () => resolveConflict(invoke2, item, btn.dataset.resolution));
        } catch (err) {
          showToast(`Couldn't resolve the conflict. ${friendlyError(errText(err), "Please try again.")}`, 5000);
        }
        await refreshDesktop();
      });
    });
    if (desktop.activeTab === "routing") {
      bindSmartRoutingEvents();
    } else if (desktop.activeTab === "settings") {
      bindSettings(desktop.settingsModel.status);
      bindAccount();
      document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          if (SETTINGS_TABS.includes(tab))
            desktop.settingsTab = tab;
          if (tab === "account") {
            desktop.account.devicesError = null;
            loadAccountDevices();
          }
          document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
          document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
          btn.classList.add("active");
          document.querySelector(`[data-panel="${tab}"]`)?.classList.add("active");
        });
      });
    }
  }
  async function saveDestination(path) {
    const cfg = desktop.aiConfig;
    if (!cfg) {
      showToast("Smart Routing settings haven't loaded yet. Try again in a moment.", 4000);
      return false;
    }
    try {
      await invoke2("save_ai_config", {
        payload: {
          enabled: cfg.enabled,
          provider: cfg.provider ?? null,
          model: cfg.model,
          smb_target: path,
          rules: null,
          auto_route: cfg.auto_route,
          api_key: null
        }
      });
      cfg.smb_target = path;
      return true;
    } catch (err) {
      showToast(`Couldn't save the destination folder. ${errText(err)}`, 5000);
      return false;
    }
  }
  function bindSmartRoutingEvents() {
    document.querySelectorAll(".role-toggle-checkbox").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        const roleId = cb.dataset.roleToggle;
        if (!roleId)
          return;
        if (cb.checked) {
          if (!desktop.enabledRoles.includes(roleId)) {
            desktop.enabledRoles.push(roleId);
          }
          showToast(`${roleLabel(roleId)} is on`);
        } else {
          desktop.enabledRoles = desktop.enabledRoles.filter((r) => r !== roleId);
          showToast(`${roleLabel(roleId)} is off`);
        }
        desktop.smartRules = computeAggregateRules();
        saveRoleRulesToStorage();
        renderDesktopView();
      });
    });
    document.querySelectorAll("[data-role-select]").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".toggle-switch"))
          return;
        const role = card.dataset.roleSelect;
        if (role) {
          desktop.activeRole = role;
          desktop.editingRuleIndex = null;
          desktop.aiVerification = null;
          saveRoleRulesToStorage();
          showToast(`Viewing rules for ${roleLabel(role)}`);
          renderDesktopView();
        }
      });
    });
    $("routing-use-detected-btn")?.addEventListener("click", async () => {
      const btn = $("routing-use-detected-btn");
      const drivePath = btn?.dataset.drivePath || desktop.detectedVolume;
      if (drivePath && await saveDestination(drivePath)) {
        showToast(`Destination set to ${drivePath}`);
        renderDesktopView();
      }
    });
    $("routing-load-all-role-btn")?.addEventListener("click", () => {
      const roleConfig = ROUTING_ROLES.find((r) => r.id === desktop.activeRole);
      if (!roleConfig)
        return;
      if (!desktop.roleRules[desktop.activeRole]) {
        desktop.roleRules[desktop.activeRole] = [...DEFAULT_ROLE_RULES[desktop.activeRole] || []];
      }
      let added = 0;
      for (const c of roleConfig.chips) {
        if (!desktop.roleRules[desktop.activeRole].includes(c.preset)) {
          desktop.roleRules[desktop.activeRole].push(c.preset);
          added++;
        }
      }
      if (!desktop.enabledRoles.includes(desktop.activeRole)) {
        desktop.enabledRoles.push(desktop.activeRole);
      }
      desktop.smartRules = computeAggregateRules();
      saveRoleRulesToStorage();
      showToast(`Added ${added} rules to ${roleConfig.title}`);
      renderDesktopView();
    });
    $("routing-browse-btn")?.addEventListener("click", async () => {
      try {
        let chosen = null;
        try {
          chosen = await invoke2("choose_folder");
        } catch {
          chosen = await invoke2("pick_sync_folder").catch(() => null);
        }
        if (chosen && await saveDestination(chosen)) {
          showToast(`Destination set to ${chosen}`);
          renderDesktopView();
        }
      } catch (e) {
        showToast(`Couldn't open the folder picker. ${errText(e)}`);
        console.warn("Browse folder error:", e);
      }
    });
    $("routing-scan-btn")?.addEventListener("click", async () => {
      const btn = $("routing-scan-btn");
      const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
      if (!targetPath) {
        showToast("Choose a destination folder first");
        return;
      }
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${icons.sync(13)}<span>Scanning folders…</span>`;
      }
      try {
        let dirs = [];
        try {
          const scanRes = await invoke2("scan_nas_directories", { targetPath, target_path: targetPath });
          dirs = Array.isArray(scanRes) ? scanRes : scanRes?.directories || [];
        } catch (e) {
          console.warn("[RenegadeBox] folder scan failed", e);
        }
        if (dirs.length > 0) {
          desktop.discoveredDirs = dirs;
        }
        const suggested = await invoke2("suggest_rules_from_nas", { targetPath, target_path: targetPath });
        if (!desktop.roleRules[desktop.activeRole]) {
          desktop.roleRules[desktop.activeRole] = [...DEFAULT_ROLE_RULES[desktop.activeRole] || []];
        }
        let added = 0;
        for (const rule of suggested) {
          if (!desktop.roleRules[desktop.activeRole].includes(rule)) {
            desktop.roleRules[desktop.activeRole].push(rule);
            added++;
          }
        }
        desktop.smartRules = computeAggregateRules();
        saveRoleRulesToStorage();
        showToast(`Found ${dirs.length} folders, added ${added} suggested rules to ${roleLabel(desktop.activeRole)}`);
        renderDesktopView();
        invoke2("get_ai_usage").then((u) => {
          if (u) {
            desktop.aiUsage = u;
            renderDesktopView();
          }
        }).catch(() => {});
      } catch (err) {
        showToast(`Couldn't scan the destination folder. ${errText(err)}`, 4000);
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `${icons.search(13)}<span>Scan Folders &amp; Suggest Rules</span>`;
        }
      }
    });
    document.querySelectorAll(".preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const preset = chip.dataset.preset;
        const textarea = $("routing-explainer-input");
        if (textarea && preset) {
          if (textarea.value.trim()) {
            textarea.value = `${textarea.value.trim()}, ${preset}`;
          } else {
            textarea.value = preset;
          }
          textarea.focus();
        }
      });
    });
    $("routing-ai-optimize-btn")?.addEventListener("click", async () => {
      const input = $("routing-explainer-input");
      const rawText = input?.value.trim();
      if (!rawText) {
        showToast("Please type a rule pattern or description first");
        input?.focus();
        return;
      }
      const btn = $("routing-ai-optimize-btn");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${icons.sync(13)}<span>AI Optimizing…</span>`;
      }
      try {
        const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
        const newRules = await invoke2("translate_rules", {
          explanation: rawText,
          targetPath,
          target_path: targetPath
        });
        const optimized = newRules[0] || rawText;
        const check = await invoke2("check_rule", { rule: optimized, sampleFile: null, sample_file: null });
        desktop.aiVerification = null;
        desktop.ruleCheck = check;
        desktop.ruleCheckCanApply = true;
        showToast(check.parses ? "Rule formatted. Review the local check below before adding it." : "The AI output is not a valid rule. Edit it and try again.");
        renderDesktopView();
        invoke2("get_ai_usage").then((u) => {
          if (u) {
            desktop.aiUsage = u;
            renderDesktopView();
          }
        }).catch(() => {});
      } catch (err) {
        showToast(`Couldn't format the rule. ${errText(err)}`, 4000);
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `${icons.sparkles(13)}<span>AI Optimize &amp; Verify</span>`;
        }
      }
    });
    $("routing-apply-verified-btn")?.addEventListener("click", () => {
      const ruleToAdd = desktop.ruleCheck?.rule || desktop.aiVerification?.optimizedRule;
      if (!ruleToAdd)
        return;
      if (!desktop.roleRules[desktop.activeRole]) {
        desktop.roleRules[desktop.activeRole] = [...DEFAULT_ROLE_RULES[desktop.activeRole] || []];
      }
      if (!desktop.roleRules[desktop.activeRole].includes(ruleToAdd)) {
        desktop.roleRules[desktop.activeRole].push(ruleToAdd);
      }
      if (!desktop.enabledRoles.includes(desktop.activeRole)) {
        desktop.enabledRoles.push(desktop.activeRole);
      }
      desktop.smartRules = computeAggregateRules();
      desktop.aiVerification = null;
      desktop.ruleCheck = null;
      desktop.ruleCheckCanApply = false;
      const input = $("routing-explainer-input");
      if (input)
        input.value = "";
      saveRoleRulesToStorage();
      showToast(`Rule added to ${roleLabel(desktop.activeRole)}`);
      renderDesktopView();
    });
    $("routing-dismiss-verified-btn")?.addEventListener("click", () => {
      desktop.aiVerification = null;
      desktop.ruleCheck = null;
      desktop.ruleCheckCanApply = false;
      renderDesktopView();
    });
    $("routing-add-rule-btn")?.addEventListener("click", () => {
      const input = $("routing-explainer-input");
      const raw = input?.value.trim();
      if (!raw) {
        showToast("Please enter a rule to add");
        input?.focus();
        return;
      }
      const finalRule = raw.toLowerCase().includes("go to") ? raw : `${raw} go to Backups`;
      if (!desktop.roleRules[desktop.activeRole]) {
        desktop.roleRules[desktop.activeRole] = [...DEFAULT_ROLE_RULES[desktop.activeRole] || []];
      }
      if (!desktop.roleRules[desktop.activeRole].includes(finalRule)) {
        desktop.roleRules[desktop.activeRole].push(finalRule);
      }
      if (!desktop.enabledRoles.includes(desktop.activeRole)) {
        desktop.enabledRoles.push(desktop.activeRole);
      }
      desktop.smartRules = computeAggregateRules();
      if (input)
        input.value = "";
      saveRoleRulesToStorage();
      showToast("Rule added to workflow");
      renderDesktopView();
    });
    $("routing-reset-role-btn")?.addEventListener("click", () => {
      desktop.roleRules[desktop.activeRole] = [...DEFAULT_ROLE_RULES[desktop.activeRole] || []];
      desktop.smartRules = computeAggregateRules();
      saveRoleRulesToStorage();
      showToast(`Reset ${roleLabel(desktop.activeRole)} to its default rules`);
      renderDesktopView();
    });
    $("routing-translate-btn")?.addEventListener("click", async () => {
      const input = $("routing-explainer-input");
      const explanation = input?.value.trim();
      if (!explanation) {
        showToast("Please describe your organization first");
        input?.focus();
        return;
      }
      const btn = $("routing-translate-btn");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${icons.sync(13)}<span>Translating…</span>`;
      }
      try {
        const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
        const newRules = await invoke2("translate_rules", {
          explanation,
          targetPath,
          target_path: targetPath
        });
        if (!desktop.roleRules[desktop.activeRole]) {
          desktop.roleRules[desktop.activeRole] = [...DEFAULT_ROLE_RULES[desktop.activeRole] || []];
        }
        let added = 0;
        for (const r of newRules) {
          if (!desktop.roleRules[desktop.activeRole].includes(r)) {
            desktop.roleRules[desktop.activeRole].push(r);
            added++;
          }
        }
        if (!desktop.enabledRoles.includes(desktop.activeRole)) {
          desktop.enabledRoles.push(desktop.activeRole);
        }
        desktop.smartRules = computeAggregateRules();
        saveRoleRulesToStorage();
        if (input)
          input.value = "";
        showToast(`Generated ${newRules.length} rules for ${roleLabel(desktop.activeRole)}`);
        renderDesktopView();
        invoke2("get_ai_usage").then((u) => {
          if (u) {
            desktop.aiUsage = u;
            renderDesktopView();
          }
        }).catch(() => {});
      } catch (err) {
        showToast(`Couldn't turn that description into rules. ${errText(err)}`, 4000);
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `${icons.sparkles(13)}<span>Translate to Rules</span>`;
        }
      }
    });
    document.querySelectorAll(".rule-edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.editIdx);
        if (!isNaN(idx)) {
          desktop.editingRuleIndex = idx;
          renderDesktopView();
          $(`rule-edit-input-${idx}`)?.focus();
        }
      });
    });
    document.querySelectorAll(".rule-cancel-edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        desktop.editingRuleIndex = null;
        renderDesktopView();
      });
    });
    document.querySelectorAll(".rule-save-edit-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.saveEdit);
        const input = $(`rule-edit-input-${idx}`);
        const val = input?.value.trim();
        if (val && !isNaN(idx) && desktop.roleRules[desktop.activeRole]) {
          desktop.roleRules[desktop.activeRole][idx] = val;
          desktop.editingRuleIndex = null;
          desktop.smartRules = computeAggregateRules();
          saveRoleRulesToStorage();
          showToast("Rule updated");
          renderDesktopView();
        }
      });
    });
    document.querySelectorAll(".rule-ai-optimize-edit-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.editIdx);
        const input = $(`rule-edit-input-${idx}`);
        const val = input?.value.trim();
        if (!val)
          return;
        btn.disabled = true;
        btn.innerHTML = `${icons.sync(12)}<span>Refining…</span>`;
        try {
          const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
          const res = await invoke2("translate_rules", {
            explanation: val,
            targetPath,
            target_path: targetPath
          });
          if (res && res[0] && input) {
            input.value = res[0];
            showToast("AI refined rule syntax");
          }
        } catch (err) {
          showToast(`Couldn't refine the rule. ${errText(err)}`, 4000);
        } finally {
          btn.disabled = false;
          btn.innerHTML = `${icons.sparkles(12)}<span>AI Refine</span>`;
        }
      });
    });
    document.querySelectorAll(".rule-ai-verify-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.verifyIdx);
        const ruleText = desktop.roleRules[desktop.activeRole]?.[idx];
        if (!ruleText)
          return;
        try {
          const check = await invoke2("check_rule", { rule: ruleText, sampleFile: null, sample_file: null });
          desktop.aiVerification = null;
          desktop.ruleCheck = check;
          desktop.ruleCheckCanApply = false;
          renderDesktopView();
          $("routing-ai-verification-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (err) {
          showToast(`Check failed: ${errText(err)}`);
        }
      });
    });
    document.querySelectorAll("[data-del-rule]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.delRule);
        if (!isNaN(idx) && idx >= 0 && desktop.roleRules[desktop.activeRole]) {
          desktop.roleRules[desktop.activeRole].splice(idx, 1);
          desktop.smartRules = computeAggregateRules();
          saveRoleRulesToStorage();
          showToast("Rule removed from role");
          renderDesktopView();
        }
      });
    });
    $("routing-jump-ledger-btn")?.addEventListener("click", (e) => {
      const btn = e.currentTarget;
      if (btn.hasAttribute("aria-expanded")) {
        desktop.showRoutingLedger = !desktop.showRoutingLedger;
        renderDesktopView();
        if (!desktop.showRoutingLedger)
          return;
      }
      document.getElementById("ai-usage-ledger-card")?.scrollIntoView({ behavior: "smooth" });
    });
    const rulesSearchInput = $("rules-search-input");
    if (rulesSearchInput) {
      rulesSearchInput.addEventListener("input", () => {
        desktop.rulesSearch = rulesSearchInput.value;
        desktop.rulesPage = 1;
        renderDesktopView();
        const updated = $("rules-search-input");
        if (updated) {
          updated.focus();
          updated.setSelectionRange(updated.value.length, updated.value.length);
        }
      });
    }
    document.querySelectorAll(".rules-page-prev, .rules-page-next").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = Number(btn.dataset.targetPage);
        if (!isNaN(target) && target >= 1) {
          desktop.rulesPage = target;
          renderDesktopView();
        }
      });
    });
    $("rules-prune-bloat-btn")?.addEventListener("click", async () => {
      let removed = 0;
      for (const role of ROUTING_ROLES) {
        const list = desktop.roleRules[role.id] || [];
        const kept = list.filter((r) => !isBloatRule(r));
        removed += list.length - kept.length;
        desktop.roleRules[role.id] = kept.length > 0 ? kept : [...DEFAULT_ROLE_RULES[role.id] || []];
      }
      desktop.smartRules = computeAggregateRules();
      desktop.rulesPage = 1;
      saveRoleRulesToLocalOnly();
      if (await persistRoleRules()) {
        showToast(`Pruned ${removed.toLocaleString()} rules (Undo available)`, 3500);
      }
      renderDesktopView();
    });
    $("rules-undo-btn")?.addEventListener("click", async () => {
      try {
        const cfg = await invoke2("undo_rules_change");
        desktop.aiConfig = cfg;
        const restored = { ...DEFAULT_ROLE_RULES };
        for (const role of ROUTING_ROLES) {
          const list = cfg.role_rules?.[role.id];
          if (Array.isArray(list))
            restored[role.id] = list;
        }
        desktop.roleRules = restored;
        const validRoles = (cfg.enabled_roles || []).filter((r) => ROUTING_ROLES.some((x) => x.id === r));
        if (validRoles.length > 0)
          desktop.enabledRoles = validRoles;
        desktop.smartRules = computeAggregateRules();
        desktop.rulesPage = 1;
        saveRoleRulesToLocalOnly();
        showToast("Restored the previous rules");
        renderDesktopView();
      } catch (err) {
        showToast(`Undo failed: ${errText(err)}`);
      }
    });
    bindRouteEvents();
    document.querySelectorAll(".review-approve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const itemId = btn.dataset.reviewId;
        if (!itemId)
          return;
        const folder = $(`review-folder-${itemId}`)?.value.trim() || null;
        btn.disabled = true;
        try {
          const rec = await invoke2("approve_review_item", { itemId, item_id: itemId, folder });
          showToast(`Moved to ${rec.destination_folder}`);
          await refreshDesktop();
        } catch (err) {
          showToast(`Could not move file: ${errText(err)}`, 4000);
          btn.disabled = false;
        }
      });
    });
    document.querySelectorAll(".review-dismiss-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const itemId = btn.dataset.reviewId;
        if (!itemId)
          return;
        try {
          await invoke2("dismiss_review_item", { itemId, item_id: itemId });
          showToast("Removed from the review list (the file was not moved)");
          await refreshDesktop();
        } catch (err) {
          showToast(`Couldn't remove the item from the review list. ${errText(err)}`, 4000);
        }
      });
    });
    $("review-move-all-btn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const folders = new Map;
      for (const b of document.querySelectorAll(".review-approve-btn")) {
        const itemId = b.dataset.reviewId || "";
        const folder = itemId ? $(`review-folder-${itemId}`)?.value.trim() : "";
        if (itemId && folder)
          folders.set(itemId, folder);
      }
      let moved = 0;
      let firstError = "";
      for (const [itemId, folder] of folders) {
        try {
          await invoke2("approve_review_item", { itemId, item_id: itemId, folder });
          moved += 1;
        } catch (err) {
          if (!firstError)
            firstError = errText(err);
        }
      }
      showToast(firstError ? `Moved ${moved}. Some failed: ${firstError}` : `Moved ${moved} file${moved === 1 ? "" : "s"}`, firstError ? 6000 : 3000);
      await refreshDesktop();
    });
    document.querySelectorAll(".suggestion-accept-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const suggestionId = btn.dataset.suggestionId;
        const rule = btn.dataset.suggestionRule;
        if (!suggestionId || !rule)
          return;
        const role = desktop.activeRole;
        const prevRules = desktop.roleRules[role] ? [...desktop.roleRules[role]] : undefined;
        const prevEnabled = [...desktop.enabledRoles];
        if (!desktop.roleRules[role])
          desktop.roleRules[role] = [...DEFAULT_ROLE_RULES[role] || []];
        if (!desktop.roleRules[role].includes(rule))
          desktop.roleRules[role].push(rule);
        if (!desktop.enabledRoles.includes(role))
          desktop.enabledRoles.push(role);
        desktop.smartRules = computeAggregateRules();
        btn.disabled = true;
        if (!await persistRoleRules()) {
          if (prevRules)
            desktop.roleRules[role] = prevRules;
          else
            delete desktop.roleRules[role];
          desktop.enabledRoles = prevEnabled;
          desktop.smartRules = computeAggregateRules();
          btn.disabled = false;
          return;
        }
        saveRoleRulesToLocalOnly();
        await invoke2("dismiss_rule_suggestion", { suggestionId, suggestion_id: suggestionId }).catch(() => {});
        desktop.ruleSuggestions = desktop.ruleSuggestions.filter((s) => s.id !== suggestionId);
        showToast(`Rule added to ${roleLabel(role)}`);
        renderDesktopView();
      });
    });
    document.querySelectorAll(".suggestion-dismiss-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const suggestionId = btn.dataset.suggestionId;
        if (!suggestionId)
          return;
        await invoke2("dismiss_rule_suggestion", { suggestionId, suggestion_id: suggestionId }).catch(() => {});
        desktop.ruleSuggestions = desktop.ruleSuggestions.filter((s) => s.id !== suggestionId);
        renderDesktopView();
      });
    });
    $("routing-save-rules-btn")?.addEventListener("click", async () => {
      const btn = $("routing-save-rules-btn");
      if (btn)
        btn.disabled = true;
      try {
        saveRoleRulesToLocalOnly();
        if (await persistRoleRules()) {
          showToast("All rules saved");
        }
      } finally {
        if (btn)
          btn.disabled = false;
      }
    });
    const runFileEvaluation = async (fileName) => {
      showToast(`Evaluating "${fileName}" against rules…`, 2500);
      try {
        const decision = await invoke2("test_ai_routing", {
          sampleFile: fileName,
          sample_file: fileName,
          samplePath: fileName
        });
        desktop.routingTestResult = decision;
        const drawer = $("routing-result-drawer");
        if (drawer) {
          drawer.hidden = false;
          drawer.innerHTML = renderRouteDecisionCard(decision);
        }
        showToast(`Routed to "${decision.destination_folder}" (${Math.round(decision.confidence * 100)}% confidence)`);
        invoke2("get_ai_usage").then((u) => {
          if (u) {
            desktop.aiUsage = u;
            renderDesktopView();
          }
        }).catch(() => {});
      } catch (err) {
        showToast(`Couldn't test that file. ${errText(err)}`, 4000);
      }
    };
    const dropZone = $("routing-drop-zone");
    if (dropZone) {
      ["dragenter", "dragover"].forEach((ename) => {
        dropZone.addEventListener(ename, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add("drag-over");
        });
      });
      ["dragleave", "drop"].forEach((ename) => {
        dropZone.addEventListener(ename, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove("drag-over");
        });
      });
      dropZone.addEventListener("drop", (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
          const file = dt.files[0];
          runFileEvaluation(file.name);
        }
      });
      $("routing-select-file-btn")?.addEventListener("click", () => {
        $("routing-file-picker")?.click();
      });
      $("routing-file-picker")?.addEventListener("change", (e) => {
        const input = e.target;
        if (input.files && input.files.length > 0) {
          runFileEvaluation(input.files[0].name);
        }
      });
    }
    $("routing-provider-select")?.addEventListener("change", (e) => {
      const sel = e.target.value;
      const modelSelect = $("routing-model-select");
      const openrouterField = $("routing-openrouter-key-field");
      const grokField = $("routing-grok-key-field");
      if (modelSelect)
        modelSelect.innerHTML = modelOptionsHtml(sel);
      if (openrouterField)
        openrouterField.style.display = sel === "xai" ? "none" : "";
      if (grokField)
        grokField.style.display = sel === "xai" ? "" : "none";
    });
    $("routing-key-toggle-btn")?.addEventListener("click", () => {
      const input = $("routing-api-key-input");
      const btn = $("routing-key-toggle-btn");
      if (!input || !btn)
        return;
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "Hide";
      } else {
        input.type = "password";
        btn.textContent = "Show";
      }
    });
    $("routing-grok-key-toggle-btn")?.addEventListener("click", () => {
      const input = $("routing-grok-key-input");
      const btn = $("routing-grok-key-toggle-btn");
      if (!input || !btn)
        return;
      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "Hide";
      } else {
        input.type = "password";
        btn.textContent = "Show";
      }
    });
    const saveDropBehavior = async (changes) => {
      const cfg = desktop.aiConfig;
      try {
        await invoke2("save_ai_config", {
          payload: {
            enabled: cfg?.enabled ?? true,
            provider: cfg?.provider ?? null,
            model: cfg?.model ?? "",
            smb_target: null,
            nas_ingest_folder: null,
            rules: null,
            auto_route: changes.auto_route ?? cfg?.auto_route ?? true,
            api_key: null,
            openrouter_api_key: null,
            grok_api_key: null,
            routing_mode: changes.routing_mode ?? null,
            use_review_folder: changes.use_review_folder ?? null
          }
        });
        const fresh = await invoke2("get_ai_config").catch(() => {
          return;
        });
        if (fresh)
          desktop.aiConfig = fresh;
        return true;
      } catch (err) {
        showToast(`Could not save: ${errText(err)}`, 4000);
        return false;
      }
    };
    document.querySelectorAll("[data-routing-mode]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const mode = btn.dataset.routingMode === "organize" ? "organize" : "move";
        if ((desktop.aiConfig?.routing_mode || "move") === mode)
          return;
        if (await saveDropBehavior({ routing_mode: mode })) {
          showToast(mode === "organize" ? "Dropped files will be organized inside the drop folder" : "Dropped files will be moved to the destination folder", 3000);
          renderDesktopView();
        }
      });
    });
    $("drop-auto-toggle")?.addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (await saveDropBehavior({ auto_route: on })) {
        showToast(on ? "Dropped files will be processed automatically" : "Files will wait until you click Sort now", 3000);
        renderDesktopView();
      }
    });
    $("review-folder-toggle")?.addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (await saveDropBehavior({ use_review_folder: on })) {
        showToast(on ? "Files that cannot be sorted will go to _Needs Review" : "Files that cannot be sorted will stay where you dropped them", 3000);
        renderDesktopView();
      }
    });
    $("routing-save-config-btn")?.addEventListener("click", async () => {
      const btn = $("routing-save-config-btn");
      if (btn)
        btn.disabled = true;
      try {
        const provider = $("routing-provider-select")?.value || "xai";
        const model = $("routing-model-select")?.value || AI_MODELS[provider === "openrouter" ? "openrouter" : "xai"][0][0];
        const openRouterInput = $("routing-api-key-input");
        const grokInput = $("routing-grok-key-input");
        const autoRoute = $("drop-auto-toggle")?.checked ?? desktop.aiConfig?.auto_route ?? true;
        const vaultRouting = $("routing-vault-toggle")?.checked ?? false;
        const vaultMaxRaw = Number($("routing-vault-max-mb")?.value);
        const vaultMaxMb = Number.isFinite(vaultMaxRaw) && vaultMaxRaw >= 1 ? Math.round(vaultMaxRaw) : null;
        const openRouterKey = openRouterInput?.value.trim() || null;
        const grokKey = grokInput?.value.trim() || null;
        await invoke2("save_ai_config", {
          payload: {
            enabled: true,
            provider,
            model,
            smb_target: null,
            nas_ingest_folder: null,
            rules: null,
            auto_route: autoRoute,
            api_key: provider === "xai" ? grokKey : openRouterKey,
            openrouter_api_key: openRouterKey,
            grok_api_key: grokKey,
            vault_routing_enabled: vaultRouting,
            vault_max_file_mb: vaultMaxMb
          }
        });
        if (desktop.aiConfig) {
          desktop.aiConfig.provider = provider;
          desktop.aiConfig.model = model;
          desktop.aiConfig.auto_route = autoRoute;
          desktop.aiConfig.vault_routing_enabled = vaultRouting;
          if (vaultMaxMb)
            desktop.aiConfig.vault_max_file_mb = vaultMaxMb;
          if (openRouterKey) {
            desktop.aiConfig.has_openrouter_key = true;
            if (provider === "openrouter")
              desktop.aiConfig.has_api_key = true;
            if (openRouterInput)
              openRouterInput.value = "";
          }
          if (grokKey) {
            desktop.aiConfig.has_grok_key = true;
            if (provider === "xai")
              desktop.aiConfig.has_api_key = true;
            if (grokInput)
              grokInput.value = "";
          }
        }
        showToast("AI settings saved");
        renderDesktopView();
      } catch (err) {
        showToast(`Couldn't save the AI settings. ${errText(err)}`, 5000);
      } finally {
        if (btn)
          btn.disabled = false;
      }
    });
    $("ai-usage-refresh-btn")?.addEventListener("click", async () => {
      const btn = $("ai-usage-refresh-btn");
      if (btn)
        btn.disabled = true;
      try {
        const usage = await invoke2("get_ai_usage");
        desktop.aiUsage = usage;
        showToast("AI API usage ledger refreshed");
        renderDesktopView();
      } catch (err) {
        showToast(`Could not refresh usage: ${errText(err)}`);
      } finally {
        if (btn)
          btn.disabled = false;
      }
    });
    $("ai-usage-clear-btn")?.addEventListener("click", async () => {
      const btn = $("ai-usage-clear-btn");
      if (btn)
        btn.disabled = true;
      try {
        const emptyUsage = await invoke2("clear_ai_usage");
        desktop.aiUsage = emptyUsage;
        showToast("AI API usage ledger cleared");
        renderDesktopView();
      } catch (err) {
        showToast(`Could not clear usage: ${errText(err)}`);
      } finally {
        if (btn)
          btn.disabled = false;
      }
    });
    $("nas-open-staging-btn")?.addEventListener("click", async () => {
      const folder = desktop.aiConfig?.nas_ingest_folder || desktop.nasStagingStatus?.ingest_folder;
      if (folder) {
        try {
          await invoke2("reveal_in_finder", { path: folder });
        } catch (err) {
          showToast(`Could not open staging folder: ${errText(err)}`);
        }
      }
    });
    $("nas-change-staging-btn")?.addEventListener("click", async () => {
      try {
        const chosen = await invoke2("choose_folder").catch(() => null);
        if (chosen) {
          if (desktop.aiConfig) {
            desktop.aiConfig.nas_ingest_folder = chosen;
            await invoke2("save_ai_config", {
              payload: {
                enabled: desktop.aiConfig.enabled,
                model: desktop.aiConfig.model,
                smb_target: null,
                nas_ingest_folder: chosen,
                rules: null,
                auto_route: desktop.aiConfig.auto_route
              }
            });
            showToast(`Drop folder set to ${chosen}`);
            await refreshDesktop();
            renderDesktopView();
          }
        }
      } catch (err) {
        showToast(`Couldn't change the drop folder. ${errText(err)}`, 4000);
      }
    });
    $("nas-process-now-btn")?.addEventListener("click", async () => {
      const btn = $("nas-process-now-btn");
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `${icons.sync(13)}<span>Processing…</span>`;
      }
      try {
        const reviewBefore = desktop.reviewQueue.length;
        const moved = await invoke2("process_nas_ingest");
        await refreshDesktop();
        const sentToReview = Math.max(0, desktop.reviewQueue.length - reviewBefore);
        const parts = [];
        if (moved.length > 0)
          parts.push(`Moved ${moved.length} file${moved.length === 1 ? "" : "s"} to the destination folder`);
        if (sentToReview > 0)
          parts.push(`${sentToReview} sent to _Needs Review`);
        showToast(parts.length > 0 ? parts.join(", ") : "Drop folder is clear, nothing to move", 3500);
        renderDesktopView();
      } catch (err) {
        showToast(`Couldn't sort the drop folder. ${errText(err)}`, 4000);
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `${icons.sync(13)}<span>Sort now</span>`;
        }
      }
    });
    document.querySelectorAll("[data-reveal-nas-path]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const path = btn.dataset.revealNasPath;
        if (path) {
          try {
            await invoke2("reveal_in_finder", { path });
          } catch (err) {
            showToast(`Could not reveal file: ${errText(err)}`);
          }
        }
      });
    });
    document.querySelectorAll("[data-relocate-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.relocateId;
        const currentFolder = btn.dataset.relocateFolder || "Backups";
        const fileName = btn.dataset.relocateFile || "file";
        const newFolder = prompt(`New folder inside the destination for "${fileName}":`, currentFolder);
        if (newFolder && newFolder.trim() && newFolder.trim() !== currentFolder) {
          try {
            const updated = await invoke2("relocate_nas_transfer", {
              transferId: id,
              newFolder: newFolder.trim()
            });
            showToast(`Relocated "${fileName}" to ${updated.destination_folder}`);
            await refreshDesktop();
            renderDesktopView();
          } catch (err) {
            showToast(`Could not relocate file: ${errText(err)}`);
          }
        }
      });
    });
    document.querySelectorAll("[data-revert-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.revertId;
        const fileName = btn.dataset.revertFile || "file";
        try {
          await invoke2("revert_nas_transfer_to_staging", { transferId: id });
          showToast(`Moved "${fileName}" to the _Needs Review folder`);
          await refreshDesktop();
          renderDesktopView();
        } catch (err) {
          showToast(`Could not revert file: ${errText(err)}`);
        }
      });
    });
    $("nas-clear-transfers-btn")?.addEventListener("click", async () => {
      try {
        await invoke2("clear_nas_transfers");
        desktop.nasTransfers = [];
        showToast("Transfer log cleared");
        renderDesktopView();
      } catch (err) {
        showToast(`Could not clear log: ${errText(err)}`);
      }
    });
    $("nas-refresh-transfers-btn")?.addEventListener("click", async () => {
      try {
        const transfers = await invoke2("get_nas_transfers");
        desktop.nasTransfers = transfers;
        showToast("Transfer log refreshed");
        renderDesktopView();
      } catch (err) {
        showToast(`Could not refresh log: ${errText(err)}`);
      }
    });
  }
  function initDesktop() {
    document.title = "RenegadeBox";
    applyTheme();
    refreshDesktop();
    onBackendEvents(["vault-changed", "account-changed", "sync-started", "sync-finished", "status-changed", "sync-paused", "sync-resumed", "nas-transfer-occurred"], () => void refreshDesktop({ background: true }));
    onBackendEvents(["navigate-tab"], (event) => {
      const tab = event?.payload ?? event;
      if (tab && ["files", "conflicts", "routing", "settings"].includes(tab)) {
        desktop.activeTab = tab;
        renderDesktopView();
      }
    });
    document.addEventListener("keydown", (e) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl) {
        if (e.key === "1") {
          e.preventDefault();
          desktop.activeTab = "files";
          renderDesktopView();
        } else if (e.key === "2") {
          e.preventDefault();
          desktop.activeTab = "conflicts";
          renderDesktopView();
        } else if (e.key === "3") {
          e.preventDefault();
          desktop.activeTab = "routing";
          renderDesktopView();
        } else if (e.key === "4" || e.key === ",") {
          e.preventDefault();
          desktop.activeTab = "settings";
          renderDesktopView();
        } else if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          if (desktop.activeTab !== "files") {
            desktop.activeTab = "files";
            renderDesktopView();
          }
          const input = $("file-search-input");
          if (input) {
            input.focus();
            input.select();
          }
        } else if (e.key.toLowerCase() === "r") {
          e.preventDefault();
          refreshDesktop();
        } else if (e.key.toLowerCase() === "o") {
          e.preventDefault();
          invoke2("open_sync_folder");
        }
      } else if (e.key === "Escape") {
        if (desktop.searchQuery) {
          desktop.searchQuery = "";
          renderDesktopView();
        }
      }
    });
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
    bar.innerHTML = `<span class="preview-label">Preview</span>` + link("?view=desktop", "Desktop Window", view === "desktop" && desktop.activeTab !== "routing" && desktop.activeTab !== "settings") + link("?view=desktop&tab=routing", "Smart Routing", view === "desktop" && desktop.activeTab === "routing") + MOCK_SCENARIOS.map((s) => link(`?view=desktop&state=${s}`, labels[s], view === "desktop" && scenario === s)).join("") + link("?view=settings", "Settings", view === "settings") + link("?view=setup&state=setup", "Setup", view === "setup");
    document.body.prepend(bar);
  }
  function init() {
    applyTheme();
    const view = currentView();
    document.body.classList.add(`view-${view}`);
    const urlTab = new URLSearchParams(location.search).get("tab");
    if (urlTab && ["files", "conflicts", "routing", "settings"].includes(urlTab)) {
      desktop.activeTab = urlTab;
    }
    if (!hasTauri())
      mountPreviewBar(view, mockScenarioFromUrl());
    if (view === "settings") {
      desktop.activeTab = "settings";
      initDesktop();
    } else if (view === "setup") {
      initSetup();
    } else if (view === "popover") {
      initPopover();
    } else {
      initDesktop();
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else
    init();
})();
