// RenegadeBox desktop UI. One page, three views chosen by ?view=:
//   popover (default) - the small window under the menu-bar icon
//   settings          - opened on demand from the popover or tray menu
//   setup             - first run, or "Reconnect…" in Settings
// Without Tauri (a normal browser) it runs on sample data; see lib/ipc.ts.
import { invoke, hasTauri, MOCK_SCENARIOS, mockScenarioFromUrl, type MockScenario } from "./lib/ipc";
import { renderPopover, renderConflictList, renderSettings, renderPopoverSettings, renderSetup, type SettingsModel } from "./lib/views";
import { friendlyError, type Overview } from "./lib/status";
import { changeKeyStore, keyStoreKind, resolveConflict } from "./lib/actions";
import { PROVIDERS, SETUP_STEPS, MIN_PASSPHRASE, validateSetupStep, setupErrorStep, type ProviderId, type SetupValues } from "./lib/setup";
import type { ConflictItem, RecentFile, Resolution, VaultStatus } from "./lib/types";

type View = "popover" | "settings" | "setup";

function currentView(): View {
  const v = new URLSearchParams(location.search).get("view") ?? location.hash.replace("#", "");
  return v === "settings" || v === "setup" ? v : "popover";
}

const root = () => document.getElementById("app")!;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

async function onBackendEvents(names: string[], handler: () => void) {
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
  const [status, autostart, ignored] = await Promise.all([
    invoke<VaultStatus>("get_vault_status"),
    invoke<boolean>("is_autostart_enabled").catch(() => false),
    invoke<string[]>("get_ignored_patterns").catch(() => [] as string[]),
  ]);
  root().innerHTML = renderSettings({ status, autostart, ignored });
  bindSettings(status);

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

function bindSettings(status: VaultStatus) {
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
  $("add-finder-btn")?.addEventListener("click", async () => {
    try {
      await invoke("add_to_finder_favorites");
      flash("device-name-message", "Added to Finder sidebar.");
    } catch {
      await invoke("open_sync_folder");
    }
  });

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
    MOCK_SCENARIOS.map((s) => link(`?view=popover&state=${s}`, labels[s], view === "popover" && scenario === s)).join("") +
    link("?view=settings", "Settings", view === "settings") +
    link("?view=setup", "Setup", view === "setup");
  document.body.prepend(bar);
}

function init() {
  const view = currentView();
  document.body.classList.add(`view-${view}`);
  if (!hasTauri()) mountPreviewBar(view, mockScenarioFromUrl());
  if (view === "settings") initSettings();
  else if (view === "setup") initSetup();
  else initPopover();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
