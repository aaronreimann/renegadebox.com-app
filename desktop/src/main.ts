// RenegadeBox desktop UI.
import { invoke, hasTauri, MOCK_SCENARIOS, mockScenarioFromUrl, type MockScenario } from "./lib/ipc";
import {
  renderPopover,
  renderConflictList,
  renderSettings,
  renderPopoverSettings,
  renderSetup,
  renderDesktopApp,
  type SettingsModel,
  type DesktopTab,
} from "./lib/views";
import { friendlyError, type Overview } from "./lib/status";
import { changeKeyStore, keyStoreKind, resolveConflict } from "./lib/actions";
import { PROVIDERS, SETUP_STEPS, MIN_PASSPHRASE, validateSetupStep, setupErrorStep, type ProviderId, type SetupValues } from "./lib/setup";
import { getTheme, setTheme, applyTheme, type Theme } from "./lib/theme";
import type { AiConfigResponse, ConflictItem, MountedVolume, NasTaxonomyScan, RecentFile, Resolution, RouteDecision, VaultStatus } from "./lib/types";

type View = "desktop" | "popover" | "settings" | "setup";

function currentView(): View {
  const v = new URLSearchParams(location.search).get("view") ?? location.hash.replace("#", "");
  if (v === "settings" || v === "setup" || v === "popover") return v;
  return "desktop";
}

const root = () => document.getElementById("app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

async function onBackendEvents(names: string[], handler: (event?: any) => void) {
  if (!hasTauri()) return;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    for (const n of names) await listen(n, handler);
  } catch (err) {
    console.warn("[RenegadeBox] could not subscribe to events", err);
  }
}

// ---------------------------------------------------------------- popover

const popover = {
  overview: null as Overview | null,
  recent: [] as RecentFile[],
  conflicts: [] as ConflictItem[],
  settingsModel: null as SettingsModel | null,
  showConflicts: false,
  showSettings: false,
  busy: false,
};

async function refreshPopover() {
  try {
    const [overview, recent] = await Promise.all([
      invoke<Overview>("get_sync_overview"),
      invoke<RecentFile[]>("list_recent_files", { limit: 10 }),
    ]);
    popover.overview = overview;
    popover.recent = recent;
    popover.conflicts = overview.conflicts > 0 || popover.showConflicts ? await invoke<ConflictItem[]>("list_conflicts") : [];
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
      invoke<VaultStatus>("get_vault_status"),
      invoke<boolean>("is_autostart_enabled").catch(() => false),
      invoke<string[]>("get_ignored_patterns").catch(() => [] as string[]),
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
  if (!popover.overview) return;
  root().innerHTML = popover.showConflicts
    ? renderConflictList({ conflicts: popover.conflicts, now: Date.now() })
    : renderPopover({ overview: popover.overview, recent: popover.recent, now: Date.now() });
}

async function onPopoverClick(ev: MouseEvent) {
  const target = (ev.target as HTMLElement).closest<HTMLElement>("button");
  if (!target || popover.busy) return;
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
      await invoke("open_settings");
      renderPopoverView();
    } else if (target.id === "settings-open-folder-btn") {
      await invoke("open_sync_folder");
    } else if (target.dataset.resolution) {
      const item = popover.conflicts[index];
      if (!item) return;
      popover.busy = true;
      target.closest(".conflict")?.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await resolveConflict(invoke, item, target.dataset.resolution as Resolution);
      popover.busy = false;
      await refreshPopover();
      if (popover.conflicts.length === 0) {
        popover.showConflicts = false;
        renderPopoverView();
      }
    } else if (target.dataset.action === "open") {
      const f = popover.recent[index];
      if (f) await invoke("open_file", { path: f.path });
    } else if (target.dataset.action === "reveal") {
      const f = popover.recent[index];
      if (f) await invoke("reveal_in_finder", { path: f.path });
    } else if (target.id === "open-folder-btn") {
      await invoke("open_sync_folder");
    } else if (target.id === "pause-btn") {
      await invoke(popover.overview?.paused ? "resume_sync" : "pause_sync");
      await refreshPopover();
    } else if (target.id === "start-setup-btn") {
      await invoke("open_setup");
    }
  } catch (err) {
    popover.busy = false;
    showPopoverNotice(errText(err));
  }
}

function showPopoverNotice(raw: string) {
  const body = document.querySelector(".popover-body");
  if (!body) return;
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
        void invoke("hide_popover");
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      void invoke("open_settings");
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void invoke("open_sync_folder");
    }
  });
  window.addEventListener("focus", () => void refreshPopover());
  let pending: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void refreshPopover(), 150);
  };
  void onBackendEvents(["status-changed", "vault-changed", "sync-started", "sync-finished", "sync-paused", "sync-resumed"], soon);
  setInterval(renderPopoverView, 30_000); // keep "2 min ago" honest
  void refreshPopover();
}

// ---------------------------------------------------------------- settings

async function loadSettings() {
  const [status, autostart, ignored, aiConfig] = await Promise.all([
    invoke<VaultStatus>("get_vault_status"),
    invoke<boolean>("is_autostart_enabled").catch(() => false),
    invoke<string[]>("get_ignored_patterns").catch(() => [] as string[]),
    invoke<AiConfigResponse>("get_ai_config").catch(() => ({
      enabled: false,
      model: "google/gemini-2.0-flash-001",
      smb_target: null,
      rules: null,
      auto_route: false,
      has_api_key: false,
    })),
  ]);
  root().innerHTML = renderSettings({ status, autostart, ignored });
  bindSettings(status, aiConfig);

  // Tab switching in settings window
  document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`[data-panel="${tab}"]`)?.classList.add("active");
    });
  });
}

function flash(id: string, text: string, isError = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function bindSettings(status: VaultStatus, aiConfig?: AiConfigResponse) {
  let keyStore = keyStoreKind(status.key_store);
  const radio = (v: string) => document.querySelector<HTMLInputElement>(`input[name="key-store"][value="${v}"]`)!;
  const confirmBox = $("key-store-confirm")!;
  const restore = () => (radio(keyStore).checked = true);

  const moveKeys = async (useKeychain: boolean) => {
    flash("key-store-message", "Moving your keys…");
    try {
      await changeKeyStore(invoke, useKeychain);
      keyStore = useKeychain ? "keychain" : "file";
      flash(
        "key-store-message",
        useKeychain ? "Your keys are now in the system keychain." : "Your keys are now in an unprotected file on this Mac.",
      );
    } catch (err) {
      restore();
      flash("key-store-message", `Couldn't move your keys. ${friendlyError(errText(err), "Please try again.")}`, true);
    }
  };

  document.querySelectorAll<HTMLInputElement>('input[name="key-store"]').forEach((input) =>
    input.addEventListener("change", () => {
      if (input.value === keyStore) return;
      if (input.value === "file") {
        confirmBox.hidden = false; // ask first; never weaken key storage on a single click
      } else {
        confirmBox.hidden = true;
        void moveKeys(true);
      }
    }),
  );
  $("key-store-cancel")!.addEventListener("click", () => {
    confirmBox.hidden = true;
    restore();
  });
  $("key-store-confirm-btn")!.addEventListener("click", () => {
    confirmBox.hidden = true;
    void moveKeys(false);
  });

  $("device-name-save")!.addEventListener("click", async () => {
    const name = $<HTMLInputElement>("device-name-input")!.value.trim();
    if (!name) return flash("device-name-message", "Enter a name for this Mac.", true);
    try {
      await invoke("update_vault_config", { payload: { device_name: name } });
      flash("device-name-message", "Saved.");
    } catch (err) {
      flash("device-name-message", errText(err), true);
    }
  });

  $<HTMLInputElement>("autostart-toggle")!.addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    try {
      input.checked = await invoke<boolean>("set_autostart_enabled", { enabled: input.checked });
    } catch {
      input.checked = !input.checked;
    }
  });

  // Theme selector in settings
  document.querySelectorAll<HTMLButtonElement>("#general-theme-switcher .theme-btn").forEach((btn) => {
    const t = btn.dataset.theme as Theme;
    if (t === getTheme()) btn.classList.add("active");
    btn.addEventListener("click", () => {
      const chosen = btn.dataset.theme as Theme;
      if (chosen) {
        setTheme(chosen);
        document.querySelectorAll<HTMLButtonElement>(".theme-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.theme === chosen);
        });
      }
    });
  });

  $("ignored-save")!.addEventListener("click", async () => {
    const patterns = $<HTMLTextAreaElement>("ignored-input")!
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    try {
      await invoke("save_ignored_patterns", { patterns });
      flash("ignored-message", "Saved.");
    } catch (err) {
      flash("ignored-message", errText(err), true);
    }
  });

  $("settings-open-folder-btn")?.addEventListener("click", () => void invoke("open_sync_folder"));
  $("finder-extension-btn")?.addEventListener("click", () => void invoke("open_finder_extensions"));
  $("add-finder-btn")?.addEventListener("click", async () => {
    try {
      await invoke("add_to_finder_favorites");
      flash("device-name-message", "Added to Finder sidebar.");
    } catch {
      await invoke("open_sync_folder");
    }
  });

  // AI & NAS Routing controls
  // AI & NAS Routing controls
  const aiEnabledToggle = $<HTMLInputElement>("ai-enabled-toggle");
  if (aiEnabledToggle && aiConfig) {
    aiEnabledToggle.checked = aiConfig.enabled;
    const configDetails = $("ai-config-details");
    const statusPill = $("ai-status-pill");
    const smbTargetInput = $<HTMLInputElement>("ai-smb-target-input");
    if (smbTargetInput) smbTargetInput.value = aiConfig.smb_target ?? "";
    const modelSelect = $<HTMLSelectElement>("ai-model-select");
    if (modelSelect) modelSelect.value = aiConfig.model || "google/gemini-2.0-flash-001";
    const rulesInput = $<HTMLTextAreaElement>("ai-rules-input");
    if (rulesInput) rulesInput.value = aiConfig.rules ?? "";
    const autoRouteToggle = $<HTMLInputElement>("ai-auto-route-toggle");
    if (autoRouteToggle) autoRouteToggle.checked = aiConfig.auto_route;

    const apiKeyStatus = $("ai-key-status");
    const apiKeyInput = $<HTMLInputElement>("ai-api-key-input");
    let hasApiKey = aiConfig.has_api_key;

    const updatePill = () => {
      if (!statusPill) return;
      if (!aiEnabledToggle.checked) {
        statusPill.textContent = "Off";
        statusPill.className = "status-pill idle";
      } else if (!hasApiKey || !smbTargetInput?.value.trim()) {
        statusPill.textContent = "Setup needed";
        statusPill.className = "status-pill warning";
      } else {
        statusPill.textContent = "Active";
        statusPill.className = "status-pill active";
      }
    };

    if (configDetails) configDetails.hidden = !aiConfig.enabled;

    if (hasApiKey) {
      if (apiKeyStatus) {
        apiKeyStatus.textContent = "● Saved in Keychain";
        apiKeyStatus.classList.add("configured");
      }
      if (apiKeyInput) apiKeyInput.placeholder = "•••••••••••••••• (Leave blank to keep current key)";
    } else {
      if (apiKeyStatus) {
        apiKeyStatus.textContent = "Not configured";
        apiKeyStatus.classList.remove("configured");
      }
    }
    updatePill();

    // Toggle master switch
    aiEnabledToggle.addEventListener("change", () => {
      if (configDetails) configDetails.hidden = !aiEnabledToggle.checked;
      updatePill();
    });

    // Native macOS folder picker
    $("ai-choose-folder-btn")?.addEventListener("click", async () => {
      try {
        const chosen = await invoke<string | null>("choose_folder");
        if (chosen && smbTargetInput) {
          smbTargetInput.value = chosen;
          updatePill();
          triggerScan(chosen);
        }
      } catch (err) {
        flash("ai-save-message", `Could not open folder picker: ${errText(err)}`, true);
      }
    });

    // Detected mounted volumes under /Volumes
    void (async () => {
      try {
        const volumes = await invoke<MountedVolume[]>("list_detected_volumes");
        const container = $("ai-volume-picker-container");
        const select = $<HTMLSelectElement>("ai-volume-select");
        if (container && select && volumes && volumes.length > 0) {
          container.hidden = false;
          select.innerHTML = `<option value="">Choose detected volume…</option>` +
            volumes.map((v) => `<option value="${v.path}">${v.name} (${v.path})</option>`).join("");
          select.addEventListener("change", () => {
            if (select.value && smbTargetInput) {
              smbTargetInput.value = select.value;
              updatePill();
              triggerScan(select.value);
            }
          });
        }
      } catch {
        // Silently skip if volume detection fails
      }
    })();

    // Show/hide API key toggle
    $("ai-key-toggle-btn")?.addEventListener("click", () => {
      const btn = $("ai-key-toggle-btn");
      if (!apiKeyInput || !btn) return;
      if (apiKeyInput.type === "password") {
        apiKeyInput.type = "text";
        btn.textContent = "Hide";
      } else {
        apiKeyInput.type = "password";
        btn.textContent = "Show";
      }
    });

    // Rule preset chips
    document.querySelectorAll<HTMLButtonElement>(".rule-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const rule = chip.dataset.rule;
        if (!rule || !rulesInput) return;
        const current = rulesInput.value.trim();
        rulesInput.value = current ? `${current}\n${rule}` : rule;
        rulesInput.focus();
      });
    });

    const triggerScan = async (path: string) => {
      const scanResults = $("ai-scan-results");
      if (!path) {
        if (scanResults) scanResults.textContent = "Enter or choose an SMB share path above.";
        return;
      }
      if (scanResults) scanResults.textContent = "Scanning directories…";
      try {
        const scan = await invoke<NasTaxonomyScan>("scan_nas_directories", { path });
        if (scanResults) {
          if (scan.directories.length === 0) {
            scanResults.textContent = "No subdirectories found under this share path.";
          } else {
            const preview = scan.directories.slice(0, 4).join(", ");
            const more = scan.directories.length > 4 ? ` +${scan.directories.length - 4} more` : "";
            scanResults.textContent = `Found ${scan.directories.length} folders: ${preview}${more}`;
          }
        }
      } catch (err) {
        if (scanResults) scanResults.textContent = `Scan failed: ${errText(err)}`;
      }
    };

    $("ai-scan-btn")?.addEventListener("click", () => {
      const path = smbTargetInput?.value.trim() ?? "";
      triggerScan(path);
    });

    $("ai-save-btn")?.addEventListener("click", async () => {
      const enabled = aiEnabledToggle.checked;
      const smb_target = smbTargetInput?.value.trim() || null;
      const api_key = apiKeyInput?.value.trim() || null;
      const model = modelSelect?.value || "google/gemini-2.0-flash-001";
      const rules = rulesInput?.value.trim() || null;
      const auto_route = autoRouteToggle ? autoRouteToggle.checked : false;

      flash("ai-save-message", "Saving…");
      try {
        await invoke("save_ai_config", {
          payload: { enabled, model, smb_target, rules, auto_route, api_key },
        });
        flash("ai-save-message", "Saved.");
        if (api_key) {
          hasApiKey = true;
          if (apiKeyInput) {
            apiKeyInput.value = "";
            apiKeyInput.placeholder = "•••••••••••••••• (Leave blank to keep saved key)";
          }
          if (apiKeyStatus) {
            apiKeyStatus.textContent = "● Saved in Keychain";
            apiKeyStatus.classList.add("configured");
          }
        }
        updatePill();
      } catch (err) {
        flash("ai-save-message", errText(err), true);
      }
    });

    $("ai-test-btn")?.addEventListener("click", async () => {
      const output = $("ai-test-output");
      const resultBox = $("ai-test-result");
      if (!output || !resultBox) return;

      resultBox.hidden = false;
      output.textContent = "Analyzing sample file with OpenRouter…";
      try {
        const recent = await invoke<RecentFile[]>("list_recent_files", { limit: 1 }).catch(() => []);
        const samplePath = recent[0]?.path || "Finance/Sample_Invoice_2026.pdf";
        const decision = await invoke<RouteDecision>("test_ai_routing", { samplePath });
        output.innerHTML = `<strong>Destination:</strong> ${decision.destination_folder}<br/>` +
          `<strong>Suggested Name:</strong> ${decision.suggested_filename}<br/>` +
          `<strong>Confidence:</strong> ${(decision.confidence * 100).toFixed(0)}%<br/>` +
          `<strong>Reasoning:</strong> ${decision.explanation}`;
      } catch (err) {
        output.textContent = `Test failed: ${errText(err)}`;
      }
    });

    $("ai-test-close-btn")?.addEventListener("click", () => {
      const resultBox = $("ai-test-result");
      if (resultBox) resultBox.hidden = true;
    });
  }

  $("reconnect-btn")!.addEventListener("click", () => void invoke("open_setup"));
  $("quit-btn")!.addEventListener("click", () => void invoke("quit_app"));
}

function initSettings() {
  document.title = "RenegadeBox Settings";
  loadSettings().catch((err) => {
    root().innerHTML = `<main class="settings"><p class="form-error">${friendlyError(errText(err), "Settings couldn't be loaded.")}</p></main>`;
  });
}

// ---------------------------------------------------------------- setup

function initSetup() {
  document.title = "Set up RenegadeBox";
  root().innerHTML = renderSetup();
  let step = 1;
  let provider: ProviderId = "aws";
  let finished = false;

  const input = (id: string) => $<HTMLInputElement>(id)!;
  const values = (): SetupValues => ({
    provider,
    endpoint: input("setup-endpoint").value.trim(),
    bucket: input("setup-bucket").value.trim(),
    region: input("setup-region").value.trim(),
    access_key_id: input("setup-access-key").value.trim(),
    secret_access_key: input("setup-secret").value.trim(),
    passphrase: input("setup-passphrase").value,
    passphrase_confirm: input("setup-passphrase-confirm").value,
    folder: input("setup-folder").value.trim(),
    device_name: input("setup-device-name").value.trim(),
  });
  const setError = (msg: string) => ($("setup-error")!.textContent = msg);

  const choose = (id: ProviderId) => {
    provider = id;
    const p = PROVIDERS.find((x) => x.id === id)!;
    document.querySelectorAll<HTMLButtonElement>(".preset").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.provider === id)));
    input("setup-region").value = p.region;
    input("setup-endpoint").value = p.endpoint;
    $("setup-endpoint-hint")!.textContent = p.endpointHint;
  };

  const show = (s: number | "done") => {
    document.querySelectorAll<HTMLElement>(".step").forEach((el) => (el.hidden = el.dataset.step !== String(s)));
    document.querySelectorAll<HTMLElement>("[data-step-dot]").forEach((el) => {
      const n = Number(el.dataset.stepDot);
      el.classList.toggle("active", s !== "done" && n === s);
      el.classList.toggle("done", s === "done" || n < (s as number));
    });
    $("setup-back")!.hidden = s === "done" || s === 1;
    $("setup-next")!.textContent = s === "done" ? "Done" : s === SETUP_STEPS ? "Set up RenegadeBox" : "Continue";
    setError("");
    if (typeof s === "number") step = s;
    document.querySelector<HTMLInputElement>(`.step[data-step="${s}"] input:not([type=radio])`)?.focus();
  };

  const meter = () => {
    const v = values();
    const left = MIN_PASSPHRASE - [...v.passphrase].length;
    $("passphrase-meter")!.textContent =
      v.passphrase.length === 0
        ? ""
        : left > 0
          ? `${left} more character${left === 1 ? "" : "s"} needed.`
          : v.passphrase_confirm && v.passphrase_confirm !== v.passphrase
            ? "The two passphrases don't match yet."
            : "Long enough.";
  };
  input("setup-passphrase").addEventListener("input", meter);
  input("setup-passphrase-confirm").addEventListener("input", meter);

  document.querySelectorAll<HTMLButtonElement>(".preset").forEach((b) => b.addEventListener("click", () => choose(b.dataset.provider as ProviderId)));
  $("setup-back")!.addEventListener("click", () => show(Math.max(1, step - 1)));

  $("setup-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (finished) return void invoke("close_window");
    const v = values();
    const problem = validateSetupStep(step, v);
    if (problem) return setError(problem);
    if (step < SETUP_STEPS) return show(step + 1);

    const next = $<HTMLButtonElement>("setup-next")!;
    const back = $<HTMLButtonElement>("setup-back")!;
    next.disabled = back.disabled = true;
    next.textContent = "Connecting to your storage…";
    try {
      await invoke<VaultStatus>("setup_vault", {
        payload: {
          folder: v.folder,
          bucket: v.bucket,
          region: v.region,
          endpoint: v.endpoint || null,
          access_key_id: v.access_key_id,
          secret_access_key: v.secret_access_key,
          passphrase: v.passphrase,
          device_name: v.device_name || null,
          hub_url: null,
        },
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

// ---------------------------------------------------------------- desktop app

const desktop = {
  activeTab: "files" as DesktopTab,
  overview: null as Overview | null,
  recent: [] as RecentFile[],
  conflicts: [] as ConflictItem[],
  settingsModel: null as SettingsModel | null,
  aiConfig: undefined as AiConfigResponse | undefined,
  theme: getTheme(),
  busy: false,
};

async function refreshDesktop() {
  try {
    const [overview, recent, status, autostart, ignored, aiConfig] = await Promise.all([
      invoke<Overview>("get_sync_overview"),
      invoke<RecentFile[]>("list_recent_files", { limit: 25 }),
      invoke<VaultStatus>("get_vault_status"),
      invoke<boolean>("is_autostart_enabled").catch(() => false),
      invoke<string[]>("get_ignored_patterns").catch(() => [] as string[]),
      invoke<AiConfigResponse>("get_ai_config").catch(() => undefined),
    ]);
    desktop.overview = overview;
    desktop.recent = recent;
    desktop.settingsModel = { status, autostart, ignored };
    desktop.aiConfig = aiConfig;
    desktop.conflicts = overview.conflicts > 0 || desktop.activeTab === "conflicts" ? await invoke<ConflictItem[]>("list_conflicts") : [];
  } catch (err) {
    desktop.overview = { initialized: true, paused: false, syncing: false, pending: 0, conflicts: 0, error: errText(err) };
    if (!desktop.settingsModel) {
      desktop.settingsModel = {
        status: {
          initialized: true,
          folder: "~/RenegadeBox",
          bucket: "renegadebox-vault",
          region: "us-east-1",
          endpoint: null,
          device_id: null,
          device_name: "Mac",
          hub_url: null,
          key_store: "System keychain",
          total_files: 0,
          pending_changes: 0,
          total_bytes: 0,
        },
        autostart: false,
        ignored: [".DS_Store"],
      };
    }
  }
  desktop.theme = getTheme();
  renderDesktopView();
}

function renderDesktopView() {
  if (!desktop.overview || !desktop.settingsModel) return;
  root().innerHTML = renderDesktopApp({
    activeTab: desktop.activeTab,
    overview: desktop.overview,
    recent: desktop.recent,
    conflicts: desktop.conflicts,
    settings: desktop.settingsModel,
    theme: desktop.theme,
    now: Date.now(),
  });
  bindDesktopEvents();
}

function bindDesktopEvents() {
  if (!desktop.settingsModel) return;

  // Sidebar navigation tabs
  document.querySelectorAll<HTMLButtonElement>("[data-desktop-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.desktopTab as DesktopTab;
      if (tab && desktop.activeTab !== tab) {
        desktop.activeTab = tab;
        renderDesktopView();
      }
    });
  });

  // Theme switchers (sidebar footer & General settings)
  document.querySelectorAll<HTMLButtonElement>(".theme-btn").forEach((btn) => {
    const t = btn.dataset.theme as Theme;
    if (t === desktop.theme) btn.classList.add("active");
    btn.addEventListener("click", () => {
      const chosen = btn.dataset.theme as Theme;
      if (chosen) {
        setTheme(chosen);
        desktop.theme = chosen;
        document.querySelectorAll<HTMLButtonElement>(".theme-btn").forEach((b) => {
          b.classList.toggle("active", b.dataset.theme === chosen);
        });
      }
    });
  });

  // Folder actions
  $("sidebar-folder-btn")?.addEventListener("click", () => void invoke("open_sync_folder"));
  $("open-folder-btn")?.addEventListener("click", () => void invoke("open_sync_folder"));
  $("start-setup-btn")?.addEventListener("click", () => void invoke("open_setup"));

  // Pause actions
  const togglePause = async () => {
    if (!desktop.overview || desktop.busy) return;
    desktop.busy = true;
    try {
      if (desktop.overview.paused) {
        await invoke("resume_sync");
      } else {
        await invoke("pause_sync");
      }
      await refreshDesktop();
    } catch (e) {
      console.error(e);
    } finally {
      desktop.busy = false;
    }
  };
  $("sidebar-pause-btn")?.addEventListener("click", togglePause);
  $("pause-btn")?.addEventListener("click", togglePause);

  // File open & reveal
  document.querySelectorAll<HTMLButtonElement>("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const f = desktop.recent[idx];
      if (f) void invoke("open_file", { path: f.path });
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-action='reveal']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      const f = desktop.recent[idx];
      if (f) void invoke("reveal_in_finder", { path: f.path });
    });
  });

  // Conflict resolutions
  document.querySelectorAll<HTMLButtonElement>("[data-resolution]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const item = desktop.conflicts[idx];
      if (!item || desktop.busy) return;
      desktop.busy = true;
      btn.closest(".conflict")?.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await resolveConflict(invoke, item, btn.dataset.resolution as Resolution);
      desktop.busy = false;
      await refreshDesktop();
    });
  });

  // If on settings or routing tab, bind the settings form & sub-tabs
  if (desktop.activeTab === "settings" || desktop.activeTab === "routing") {
    bindSettings(desktop.settingsModel.status, desktop.aiConfig);

    // Sub-tab switching inside settings
    document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.querySelector(`[data-panel="${tab}"]`)?.classList.add("active");
      });
    });
  }
}

function initDesktop() {
  document.title = "RenegadeBox";
  applyTheme();
  void refreshDesktop();
  void onBackendEvents(
    ["vault-changed", "sync-started", "sync-finished", "status-changed", "sync-paused", "sync-resumed"],
    () => void refreshDesktop(),
  );
  void onBackendEvents(["navigate-tab"], (event: any) => {
    const tab = (event?.payload ?? event) as DesktopTab;
    if (tab && ["files", "conflicts", "routing", "settings"].includes(tab)) {
      desktop.activeTab = tab;
      renderDesktopView();
    }
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      desktop.activeTab = "settings";
      renderDesktopView();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void invoke("open_sync_folder");
    }
  });
}

// ---------------------------------------------------------------- browser preview

function mountPreviewBar(view: View, scenario: MockScenario) {
  document.body.classList.add("preview", `preview-${view}`);
  const labels: Record<MockScenario, string> = {
    ok: "Up to date",
    syncing: "Syncing",
    paused: "Paused",
    conflicts: "Needs attention",
    error: "Error",
    setup: "Not set up",
  };
  const link = (href: string, text: string, active: boolean) => `<a href="${href}"${active ? ' aria-current="page"' : ""}>${text}</a>`;
  const bar = document.createElement("nav");
  bar.className = "preview-bar";
  bar.innerHTML =
    `<span class="preview-label">Preview</span>` +
    link("?view=desktop", "Desktop Window", view === "desktop") +
    MOCK_SCENARIOS.map((s) => link(`?view=desktop&state=${s}`, labels[s], view === "desktop" && scenario === s)).join("") +
    link("?view=settings", "Settings", view === "settings") +
    link("?view=setup", "Setup", view === "setup");
  document.body.prepend(bar);
}

function init() {
  applyTheme();
  const view = currentView();
  document.body.classList.add(`view-${view}`);
  if (!hasTauri()) mountPreviewBar(view, mockScenarioFromUrl());
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

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

