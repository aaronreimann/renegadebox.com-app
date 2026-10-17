// RenegadeBox desktop UI.
import {
  invoke,
  hasTauri,
  MOCK_SCENARIOS,
  mockScenarioFromUrl,
  type MockScenario,
  accountStatus,
  accountCreate,
  accountSignIn,
  accountGoogleSignIn,
  accountSignOut,
  accountDevices,
  accountRemoveDevice,
  accountChangePassword,
} from "./lib/ipc";
import {
  renderPopover,
  renderConflictList,
  renderPopoverSettings,
  renderSetup,
  renderDesktopApp,
  renderRouteDecisionCard,
  renderDesktopLoadError,
  type SettingsModel,
  type SettingsTab,
  SETTINGS_TABS,
  type DesktopTab,
  type RoutingRole,
  ROUTING_ROLES,
  DEFAULT_ROLE_RULES,
  renderPopoverList,
  type PopoverTab,
  type AccountAction,
  type AccountMessageSlot,
  type AccountViewModel,
  type SetupMode,
  accountDeviceRows,
  AI_MODELS,
  modelOptionsHtml,
} from "./lib/views";
import { validateCreateAccount, validateNewPassword, validateSignIn } from "./lib/account";
import { friendlyError, type Overview } from "./lib/status";
import { changeKeyStore, keyStoreKind, resolveConflict, withBusy } from "./lib/actions";
import { PROVIDERS, SETUP_STEPS, MIN_PASSPHRASE, validateSetupStep, setupErrorStep, type ProviderId, type SetupValues } from "./lib/setup";
import { getTheme, setTheme, applyTheme, type Theme } from "./lib/theme";
import { icons, type FileCategory } from "./lib/icons";
import { captureFormState, restoreFormState, type FieldLike, type FormState, type PanelLike } from "./lib/formstate";
import type { AccountStatus, AiConfigResponse, AiUsageSummary, AiVerificationResult, ConflictItem, MountedVolume, NasStagingStatus, NasTransferRecord, RecentFile, Resolution, ReviewItem, RouteConfig, RouteDecision, RouteEditorState, RoutesOverview, RuleCheck, RuleSuggestion, SyncActivity, VaultStatus } from "./lib/types";

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
  activity: undefined as SyncActivity | undefined,
  tab: "activity" as PopoverTab,
  query: "",
  menuOpen: false,
  conflicts: [] as ConflictItem[],
  settingsModel: null as SettingsModel | null,
  showConflicts: false,
  showSettings: false,
  busy: false,
};

async function refreshPopover() {
  try {
    const [overview, recent, activity] = await Promise.all([
      invoke<Overview>("get_sync_overview"),
      invoke<RecentFile[]>("list_recent_files", { limit: 25 }),
      invoke<SyncActivity>("get_sync_activity").catch(() => undefined),
    ]);
    popover.overview = overview;
    popover.recent = recent;
    popover.activity = activity;
    popover.conflicts = overview.conflicts > 0 || popover.showConflicts ? await invoke<ConflictItem[]>("list_conflicts") : [];
  } catch (err) {
    popover.overview = { initialized: true, paused: false, syncing: false, pending: 0, conflicts: 0, error: errText(err) };
  }
  renderPopoverLive();
}

/** Background re-render. Leaves the settings form alone so nothing being typed there is wiped. */
function renderPopoverLive() {
  if (popover.showSettings) return;
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

function popoverModel() {
  return {
    overview: popover.overview!,
    recent: popover.recent,
    activity: popover.activity,
    tab: popover.tab,
    query: popover.query,
    menuOpen: popover.menuOpen,
    now: Date.now(),
  };
}

function renderPopoverView() {
  if (popover.showSettings && popover.settingsModel) {
    root().innerHTML = renderPopoverSettings(popover.settingsModel);
    bindSettings(popover.settingsModel.status);
    return;
  }
  if (!popover.overview) return;
  if (popover.showConflicts) {
    root().innerHTML = renderConflictList({ conflicts: popover.conflicts, now: Date.now() });
    return;
  }
  // Keep the search box (and its caret) alive across live updates: only swap the parts that change.
  const search = $<HTMLInputElement>("popover-search");
  if (search && document.activeElement === search) {
    const list = $("popover-list");
    if (list) list.innerHTML = renderPopoverList(popoverModel());
    const footer = document.querySelector(".pop-status");
    const fresh = document.createElement("div");
    fresh.innerHTML = renderPopover(popoverModel());
    const freshFooter = fresh.querySelector(".pop-status");
    if (footer && freshFooter) footer.replaceWith(freshFooter);
    return;
  }
  const scroll = $("popover-list")?.scrollTop ?? 0;
  root().innerHTML = renderPopover(popoverModel());
  const list = $("popover-list");
  if (list) list.scrollTop = scroll;
}

function activityPath(path: string | undefined): string | null {
  if (!path) return null;
  const all = [...(popover.activity?.active ?? []), ...(popover.activity?.recent ?? [])];
  return all.some((a) => a.path === path) ? path : null;
}

async function onPopoverClick(ev: MouseEvent) {
  const target = (ev.target as HTMLElement).closest<HTMLElement>("button");
  // Any click outside the gear menu closes it.
  if (popover.menuOpen && (!target || (target.id !== "settings-btn" && !target.closest("#popover-menu")))) {
    popover.menuOpen = false;
    renderPopoverView();
    if (!target) return;
  }
  if (!target || popover.busy) return;
  const index = Number(target.dataset.index);

  try {
    if (target.dataset.popoverTab) {
      popover.tab = target.dataset.popoverTab as PopoverTab;
      renderPopoverView();
    } else if (target.id === "settings-btn") {
      popover.menuOpen = !popover.menuOpen;
      renderPopoverView();
    } else if (target.id === "menu-open-app" || target.id === "open-app-btn") {
      popover.menuOpen = false;
      await invoke("open_main_window");
    } else if (target.id === "menu-quit") {
      await invoke("quit_app");
    } else if (target.id === "menu-pause") {
      popover.menuOpen = false;
      await invoke(popover.overview?.paused ? "resume_sync" : "pause_sync");
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
      await invoke("open_settings");
      renderPopoverView();
    } else if (target.dataset.resolution) {
      const item = popover.conflicts[index];
      if (!item) return;
      target.closest(".conflict")?.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await withBusy(popover, () => resolveConflict(invoke, item, target.dataset.resolution as Resolution));
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
      if (f) await invoke("open_file", { path: f.path });
    } else if (target.dataset.action === "reveal") {
      const f = popover.recent[index];
      if (f) await invoke("reveal_in_finder", { path: f.path });
    } else if (target.dataset.action === "open-activity") {
      const p = activityPath(target.dataset.path);
      if (p) await invoke("open_file", { path: p });
    } else if (target.dataset.action === "reveal-activity") {
      const p = activityPath(target.dataset.path);
      if (p) await invoke("reveal_in_finder", { path: p });
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
  root().addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.id !== "popover-search") return;
    popover.query = el.value;
    const list = $("popover-list");
    if (list) list.innerHTML = renderPopoverList(popoverModel());
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
        void invoke("hide_popover");
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      void invoke("open_settings");
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      void invoke("open_sync_folder");
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      $<HTMLInputElement>("popover-search")?.focus();
    }
  });
  window.addEventListener("focus", () => void refreshPopover());
  let pending: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => void refreshPopover(), 150);
  };
  void onBackendEvents(
    ["status-changed", "vault-changed", "sync-started", "sync-finished", "sync-paused", "sync-resumed", "sync-activity", "nas-transfer-occurred"],
    soon,
  );
  setInterval(renderPopoverLive, 30_000); // keep "2 min ago" honest
  void refreshPopover();
}

// ---------------------------------------------------------------- settings

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
      flash("device-name-message", "Added to the Finder sidebar.");
    } catch (err) {
      flash("device-name-message", `Couldn't add the folder to the Finder sidebar. ${friendlyError(errText(err), "Please try again.")}`, true);
    }
  });

  $("reconnect-btn")!.addEventListener("click", () => void invoke("open_setup"));
  $("quit-btn")!.addEventListener("click", () => void invoke("quit_app"));
}

// ---------------------------------------------------------------- account (Settings tab)

/** New sign-in state from account_status. The device list belongs to one account, so drop it when that changes. */
function setAccountStatus(next: AccountStatus | null) {
  const a = desktop.account;
  if (!next) return; // keep the last known state; account_status only fails if the profile is unreadable
  if (a.status?.signed_in !== next.signed_in || a.status?.email !== next.email) {
    a.devices = null;
    a.devicesError = null;
  }
  a.status = next;
}

function renderAccountChange(clearForms = false) {
  if (desktop.activeTab === "settings") renderDesktopView({ preserveInput: !clearForms });
}

async function loadAccountDevices() {
  const a = desktop.account;
  if (!a.status?.signed_in || a.devicesLoading) return;
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

/**
 * Runs one account action with its button busy. `fn` returns a success line for `slot`, or "" for none.
 * Typed values are kept when it fails and cleared when it succeeds (they are passwords).
 */
async function runAccountAction(action: AccountAction, slot: AccountMessageSlot, fn: () => Promise<string>) {
  const a = desktop.account;
  if (a.busy) return;
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

/**
 * Continue with Google from Settings. Not run through withBusy: Cancel has to free the tab while
 * the backend call is still waiting on the browser.
 */
async function googleSignInFromSettings() {
  const a = desktop.account;
  if (a.action) return;
  const attempt = ++a.googleAttempt;
  a.action = "google";
  a.message = null;
  renderAccountChange();
  try {
    setAccountStatus(await accountGoogleSignIn());
    showToast("Signed in with Google. Any Mac you sign in on now sets itself up from this one.", 5000);
    if (attempt !== a.googleAttempt) return renderAccountChange();
  } catch (err) {
    if (attempt !== a.googleAttempt) return; // cancelled: stay quiet
    a.message = { slot: "google", text: errText(err), error: true };
  }
  a.action = null;
  renderAccountChange();
}

function accountProblem(slot: AccountMessageSlot, text: string) {
  desktop.account.message = { slot, text, error: true };
  renderAccountChange();
}

function bindAccount() {
  const a = desktop.account;
  const value = (id: string) => $<HTMLInputElement>(id)?.value ?? "";

  // Load the device list lazily, the first time the Account tab is on screen.
  if (desktop.settingsTab === "account" && a.status?.signed_in && a.devices === null && !a.devicesLoading && !a.devicesError) {
    void loadAccountDevices();
  }

  $("account-google-btn")?.addEventListener("click", () => void googleSignInFromSettings());
  $("account-google-cancel")?.addEventListener("click", () => {
    // Back to idle. The backend call times out on its own; if the person still finishes,
    // account-changed brings the signed-in state in.
    a.googleAttempt++;
    a.action = null;
    a.message = null;
    renderAccountChange();
  });
  $("account-password-toggle")?.addEventListener("click", () => {
    a.showPasswordForms = true;
    renderAccountChange();
    $<HTMLInputElement>("account-create-email:not([disabled])")?.focus();
  });

  $("account-create-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const email = value("account-create-email").trim();
    const password = value("account-create-password");
    const problem = validateCreateAccount(email, password, value("account-create-confirm"));
    if (problem) return accountProblem("create", problem);
    void runAccountAction("create", "create", async () => {
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
    if (problem) return accountProblem("signin", problem);
    void runAccountAction("signin", "signin", async () => {
      setAccountStatus(await accountSignIn({ email, password }));
      showToast("This Mac is now linked to your account.", 4000);
      return "";
    });
  });

  $("account-password-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const password = value("account-new-password");
    const problem = validateNewPassword(password, value("account-new-password-confirm"));
    if (problem) return accountProblem("password", problem);
    void runAccountAction("password", "password", async () => {
      await accountChangePassword(password);
      return "Password changed. Your other Macs stay signed in.";
    });
  });

  const signoutConfirm = $("account-signout-confirm");
  $("account-signout-btn")?.addEventListener("click", () => signoutConfirm && (signoutConfirm.hidden = false));
  $("account-signout-cancel")?.addEventListener("click", () => signoutConfirm && (signoutConfirm.hidden = true));
  $("account-signout-confirm-btn")?.addEventListener("click", () => {
    if (signoutConfirm) signoutConfirm.hidden = true;
    void runAccountAction("signout", "signout", async () => {
      setAccountStatus(await accountSignOut());
      showToast("Signed out. Your files keep syncing.", 4000);
      return "";
    });
  });

  // Remove another Mac, after an inline confirm.
  const confirmFor = (i: string) => $(`account-remove-confirm-${i}`);
  document.querySelectorAll<HTMLButtonElement>("[data-remove-device]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const box = confirmFor(btn.dataset.removeDevice!);
      if (box) box.hidden = false;
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-remove-cancel]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const box = confirmFor(btn.dataset.removeCancel!);
      if (box) box.hidden = true;
    }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-remove-confirm]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.removeConfirm);
      const device = accountDeviceRows(a.devices)[index];
      const box = confirmFor(String(index));
      if (box) box.hidden = true;
      if (!device || device.current) return;
      a.removingIndex = index;
      void runAccountAction("remove", "devices", async () => {
        await accountRemoveDevice(device.id);
        a.devices = (a.devices ?? []).filter((d) => d.id !== device.id);
        return `${device.name} was removed from your account.`;
      });
    }),
  );
}

// ---------------------------------------------------------------- setup

const SETUP_TITLES: Record<SetupMode, string> = { signin: "Sign in to RenegadeBox", wizard: "Set up RenegadeBox" };

/** A new Mac opens on Sign in. A Mac that already has storage (Reconnect…) opens on the storage steps. */
function initSetup() {
  document.title = SETUP_TITLES.signin;
  void accountStatus()
    .then((s): SetupMode => (s.device_ready ? "wizard" : "signin"))
    .catch((): SetupMode => "signin")
    .then(startSetup);
}

function startSetup(mode: SetupMode) {
  document.title = SETUP_TITLES[mode];
  root().innerHTML = renderSetup(mode);
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
    $("setup-signin-instead")!.hidden = s !== 1;
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

  // Sign in first; "Set up new storage instead" opens the wizard above unchanged.
  const showPanel = (m: SetupMode) => {
    $("signin-panel")!.hidden = m !== "signin";
    $("setup-wizard")!.hidden = m !== "wizard";
    $("setup-title")!.textContent = SETUP_TITLES[m];
    document.title = SETUP_TITLES[m];
    if (m === "wizard") show(1);
    else $<HTMLButtonElement>("signin-google-btn")?.focus();
  };
  $("signin-use-storage")!.addEventListener("click", () => showPanel("wizard"));
  $("setup-signin-instead")!.addEventListener("click", () => showPanel("signin"));

  // Same ending as the storage wizard: the "You're all set" step, then Done closes the window.
  const finishSignedIn = () => {
    finished = true;
    $("signin-panel")!.hidden = true;
    $("setup-wizard")!.hidden = false;
    document.querySelector<HTMLElement>(".steps")!.hidden = true;
    show("done");
  };

  // Continue with Google: the browser does the work while this window waits (up to 10 minutes).
  // Cancel only returns to idle; the backend call times out on its own.
  let googleAttempt = 0;
  const googleWaiting = (on: boolean) => {
    $("signin-google-idle")!.hidden = on;
    $("signin-google-waiting")!.hidden = !on;
    for (const id of ["signin-email-toggle", "signin-use-storage", "signin-btn"]) {
      const b = $<HTMLButtonElement>(id);
      if (b) b.disabled = on;
    }
  };
  $("signin-google-btn")!.addEventListener("click", async () => {
    const attempt = ++googleAttempt;
    $("signin-google-error")!.textContent = "";
    googleWaiting(true);
    try {
      await accountGoogleSignIn();
      finishSignedIn(); // even after Cancel: the person finished in the browser, so this Mac is set up
    } catch (err) {
      if (attempt === googleAttempt) $("signin-google-error")!.textContent = errText(err);
    } finally {
      if (attempt === googleAttempt) googleWaiting(false);
    }
  });
  $("signin-google-cancel")!.addEventListener("click", () => {
    googleAttempt++;
    googleWaiting(false);
  });
  $("signin-email-toggle")!.addEventListener("click", (e) => {
    const toggle = e.currentTarget as HTMLButtonElement;
    toggle.hidden = true;
    toggle.setAttribute("aria-expanded", "true");
    $("signin-form")!.hidden = false;
    input("signin-email").focus();
  });

  let signingIn = false;
  $("signin-form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (signingIn) return;
    const email = input("signin-email").value.trim();
    const password = input("signin-password").value;
    const signinError = $("signin-error")!;
    const problem = validateSignIn(email, password);
    if (problem) return void (signinError.textContent = problem);
    signinError.textContent = "";

    const btn = $<HTMLButtonElement>("signin-btn")!;
    const controls = [btn, $<HTMLButtonElement>("signin-use-storage")!, $<HTMLButtonElement>("signin-google-btn")!, input("signin-email"), input("signin-password")];
    signingIn = true;
    controls.forEach((c) => (c.disabled = true));
    btn.textContent = "Signing in…"; // the password is stretched on this Mac, which takes a few seconds
    try {
      await accountSignIn({ email, password });
      finishSignedIn();
    } catch (err) {
      signinError.textContent = errText(err);
      input("signin-password").focus();
    } finally {
      signingIn = false;
      controls.forEach((c) => (c.disabled = false));
      btn.textContent = "Sign in";
    }
  });

  choose(provider);
  show(1); // in sign-in mode this prepares the hidden wizard
  if (mode === "signin") $<HTMLButtonElement>("signin-google-btn")?.focus();
}

// ---------------------------------------------------------------- desktop app

const desktop = {
  activeTab: "files" as DesktopTab,
  overview: null as Overview | null,
  recent: [] as RecentFile[],
  conflicts: [] as ConflictItem[],
  settingsModel: null as SettingsModel | null,
  aiConfig: undefined as AiConfigResponse | undefined,
  smartRules: [] as string[],
  discoveredDirs: [] as string[],
  routingTestResult: null as RouteDecision | null,
  activeRole: (typeof localStorage !== "undefined" ? (localStorage.getItem("renegadebox-routing-role") as RoutingRole) || "webdev" : "webdev") as RoutingRole,
  enabledRoles: (typeof localStorage !== "undefined"
    ? (() => {
        try {
          const raw = localStorage.getItem("renegadebox-enabled-roles");
          const parsed = raw ? JSON.parse(raw) : null;
          return Array.isArray(parsed) && parsed.length > 0 ? (parsed as RoutingRole[]) : ["webdev" as RoutingRole];
        } catch {
          return ["webdev" as RoutingRole];
        }
      })()
    : ["webdev" as RoutingRole]) as RoutingRole[],
  roleRules: (typeof localStorage !== "undefined"
    ? (() => {
        try {
          const raw = localStorage.getItem("renegadebox-role-rules");
          if (!raw) return { ...DEFAULT_ROLE_RULES };
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object") return { ...DEFAULT_ROLE_RULES };
          const clean: Record<string, string[]> = {};
          for (const role of ROUTING_ROLES) {
            const list = Array.isArray(parsed[role.id]) ? parsed[role.id] : DEFAULT_ROLE_RULES[role.id];
            let rulesList = (Array.isArray(list) ? list : []).map((item: any) => {
              if (typeof item === "string") return item;
              if (item && typeof item === "object") {
                if ("rule" in item) return String(item.rule);
                if ("text" in item) return String(item.text);
              }
              return String(item || "");
            }).filter((s) => s.trim().length > 0);

            if (rulesList.length === 0) {
              rulesList = [...(DEFAULT_ROLE_RULES[role.id] || [])];
            }
            clean[role.id] = rulesList;
          }
          return clean as Record<RoutingRole, string[]>;
        } catch {
          return { ...DEFAULT_ROLE_RULES };
        }
      })()
    : { ...DEFAULT_ROLE_RULES }) as Record<RoutingRole, string[]>,
  editingRuleIndex: null as number | null,
  aiVerification: null as AiVerificationResult | null,
  aiUsage: null as AiUsageSummary | null,
  nasTransfers: [] as NasTransferRecord[],
  nasStagingStatus: null as NasStagingStatus | null,
  reviewQueue: [] as ReviewItem[],
  ruleSuggestions: [] as RuleSuggestion[],
  ruleCheck: null as RuleCheck | null,
  ruleCheckCanApply: false,
  routesOverview: null as RoutesOverview | null,
  routeEditor: null as RouteEditorState | null,
  pendingDeleteRouteId: null as string | null,
  /** Smart Routing page: null is the routes list, "main" is the main route's page. Other routes open in the editor. */
  selectedRouteId: null as string | null,
  showRoutingLedger: false,
  detectedVolume: null as string | null,
  rulesLoadedFromConfig: false,
  rulesPage: 1,
  rulesSearch: "",
  theme: getTheme(),
  searchQuery: "",
  activeCategory: "all" as FileCategory,
  /** Settings sub-tab on screen, so a background refresh keeps the person where they were. */
  settingsTab: "general" as SettingsTab,
  /** Set when the very first load failed; the window shows an error with Retry instead of made-up values. */
  loadError: null as string | null,
  busy: false,
  /** Account tab state. Kept here so busy buttons and messages survive background re-renders. */
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
    /** Bumped by Cancel, so a Google sign-in that was given up on doesn't touch the screen when it ends. */
    googleAttempt: 0,
  } as AccountViewModel & { busy: boolean; googleAttempt: number },
};

function isBloatRule(rule: string): boolean {
  const lower = rule.toLowerCase().trim();
  return lower.startsWith("files matching ") || /\bgo\s+to\s+unsorted\s*$/.test(lower);
}

/** Persists role rules to the app config. The backend snapshots the previous rules first, so every save is undoable. */
async function persistRoleRules(): Promise<boolean> {
  try {
    await invoke<string>("save_routing_rules", {
      roleRules: desktop.roleRules,
      enabledRoles: desktop.enabledRoles,
      role_rules: desktop.roleRules,
      enabled_roles: desktop.enabledRoles,
    });
    const hadUndo = (desktop.aiConfig?.rules_backup_count ?? 0) > 0;
    const cfg = await invoke<AiConfigResponse>("get_ai_config").catch(() => undefined);
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
    } catch {
      // storage unavailable
    }
  }
}

function saveRoleRulesToStorage() {
  saveRoleRulesToLocalOnly();
  void persistRoleRules();
}

/** The human name for a workflow, for messages. Never show the raw id. */
function roleLabel(id: RoutingRole): string {
  return ROUTING_ROLES.find((r) => r.id === id)?.title ?? "this workflow";
}

function computeAggregateRules(): string[] {
  const set = new Set<string>();
  const safeEnabled = Array.isArray(desktop.enabledRoles) ? desktop.enabledRoles : ["webdev" as RoutingRole];
  for (const roleId of safeEnabled) {
    const list = desktop.roleRules?.[roleId] || DEFAULT_ROLE_RULES[roleId] || [];
    if (Array.isArray(list)) {
      for (const r of list) {
        const str = typeof r === "string" ? r : (r && typeof r === "object" && "rule" in r ? String((r as any).rule) : String(r || ""));
        if (str && str.trim()) set.add(str.trim());
      }
    }
  }
  return Array.from(set);
}

let toastTimer: any = null;
function showToast(msg: string, durationMs = 2200) {
  const t = $("desktop-toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, durationMs);
}

/** `background`: triggered by a backend event rather than by the person, so in-progress input is kept. */
async function refreshDesktop(opts: { background?: boolean } = {}) {
  try {
    const [overview, recent, status, autostart, ignored, aiConfig, aiUsage, nasTransfers, nasStagingStatus, reviewQueue, ruleSuggestions, routesOverview, account] = await Promise.all([
      invoke<Overview>("get_sync_overview"),
      invoke<RecentFile[]>("list_recent_files", { limit: 25 }),
      invoke<VaultStatus>("get_vault_status"),
      invoke<boolean>("is_autostart_enabled").catch(() => false),
      invoke<string[]>("get_ignored_patterns").catch(() => [] as string[]),
      invoke<AiConfigResponse>("get_ai_config").catch(() => undefined),
      invoke<AiUsageSummary>("get_ai_usage").catch(() => null),
      invoke<NasTransferRecord[]>("get_nas_transfers").catch(() => [] as NasTransferRecord[]),
      invoke<NasStagingStatus>("get_nas_staging_status").catch(() => null),
      invoke<ReviewItem[]>("get_review_queue").catch(() => [] as ReviewItem[]),
      invoke<RuleSuggestion[]>("get_rule_suggestions").catch(() => [] as RuleSuggestion[]),
      invoke<RoutesOverview>("get_routes").catch(() => null),
      accountStatus().catch(() => null),
    ]);
    setAccountStatus(account);
    desktop.overview = overview;
    desktop.recent = recent;
    desktop.settingsModel = { status, autostart, ignored };
    desktop.aiConfig = aiConfig;
    desktop.reviewQueue = Array.isArray(reviewQueue) ? reviewQueue : [];
    desktop.ruleSuggestions = Array.isArray(ruleSuggestions) ? ruleSuggestions : [];
    if (routesOverview) desktop.routesOverview = routesOverview;
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
      const vols = await invoke<MountedVolume[]>("list_detected_volumes").catch(() => [] as MountedVolume[]);
      if (vols.length > 0) desktop.detectedVolume = vols[0].path;
    }
    if (desktop.smartRules.length === 0) {
      desktop.smartRules = computeAggregateRules();
    }
    if (aiConfig && !desktop.rulesLoadedFromConfig) {
      desktop.rulesLoadedFromConfig = true;
      const cfgRoles = aiConfig.role_rules;
      if (cfgRoles && Object.keys(cfgRoles).length > 0) {
        // Config is the source of truth once it holds role rules.
        const merged: Record<string, string[]> = { ...DEFAULT_ROLE_RULES };
        for (const role of ROUTING_ROLES) {
          const list = cfgRoles[role.id];
          if (Array.isArray(list)) merged[role.id] = list.filter((s) => typeof s === "string" && s.trim().length > 0);
        }
        desktop.roleRules = merged as Record<RoutingRole, string[]>;
        const validRoles = (aiConfig.enabled_roles || []).filter((r) => ROUTING_ROLES.some((x) => x.id === r)) as RoutingRole[];
        if (validRoles.length > 0) desktop.enabledRoles = validRoles;
      } else {
        // One-time migration: copy the rules that used to live only in localStorage into the config.
        await persistRoleRules();
        let bloatCount = 0;
        for (const role of ROUTING_ROLES) {
          const list = desktop.roleRules[role.id] || [];
          const kept = list.filter((r) => !isBloatRule(r));
          bloatCount += list.length - kept.length;
          desktop.roleRules[role.id] = kept.length > 0 ? kept : [...(DEFAULT_ROLE_RULES[role.id] || [])];
        }
        if (bloatCount > 0 && (await persistRoleRules())) {
          setTimeout(() => showToast(`Removed ${bloatCount.toLocaleString()} auto-generated rules. "Undo Last Rules Change" restores them.`, 6000), 300);
        }
        saveRoleRulesToLocalOnly();
      }
      desktop.smartRules = computeAggregateRules();
    }
    desktop.conflicts = overview.conflicts > 0 || desktop.activeTab === "conflicts" ? await invoke<ConflictItem[]>("list_conflicts") : [];
    desktop.loadError = null;
  } catch (err) {
    desktop.overview = { initialized: true, paused: false, syncing: false, pending: 0, conflicts: 0, error: errText(err) };
    // Keep showing the last real settings if we have them; otherwise show an error, never invented values.
    if (!desktop.settingsModel) desktop.loadError = friendlyError(errText(err), "Please try again.");
  }
  desktop.theme = getTheme();
  renderDesktopView({ preserveInput: opts.background === true });
}

const FORM_FIELDS = "input[id], textarea[id], select[id]";
const KEEP_OPEN = "[data-keep-open][id]";

/** Snapshot changed/focused fields and open confirm boxes before a background re-render. */
function captureDesktopForm(): FormState {
  const fields = Array.from(document.querySelectorAll<HTMLInputElement>(FORM_FIELDS)) as unknown as FieldLike[];
  const panels = Array.from(document.querySelectorAll<HTMLElement>(KEEP_OPEN)) as PanelLike[];
  return captureFormState(fields, document.activeElement, panels);
}

function restoreDesktopForm(state: FormState) {
  restoreFormState(
    state,
    (id) => {
      const el = document.getElementById(id);
      return el && el.matches(FORM_FIELDS) ? (el as unknown as FieldLike) : null;
    },
    (id) => {
      const el = document.getElementById(id);
      return el && el.matches(KEEP_OPEN) ? el : null;
    },
  );
}

function renderDesktopLoadErrorView(message: string) {
  root().innerHTML = renderDesktopLoadError(message);
  $("desktop-retry-btn")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = "Retrying…";
    void refreshDesktop();
  });
}

function renderDesktopView(opts: { preserveInput?: boolean } = {}) {
  if (!desktop.settingsModel) {
    if (desktop.loadError) renderDesktopLoadErrorView(desktop.loadError);
    return;
  }
  if (!desktop.overview) return;
  // Background refreshes re-render everything; keep the focus and scroll. Editor fields
  // update the route draft as they change (see bindRouteEvents), so nothing typed is lost.
  const active = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  const focusId = active?.id && active.id.startsWith("route-") ? active.id : null;
  const selStart = focusId && "selectionStart" in active! ? active!.selectionStart : null;
  const selEnd = focusId && "selectionEnd" in active! ? active!.selectionEnd : null;
  const body = document.querySelector<HTMLElement>(".desktop-content-body");
  const prevPage = body?.dataset.page;
  const scroll = body?.scrollTop ?? 0;
  const page = desktopPageKey();
  // Background refreshes keep whatever the person has typed (API keys, rules, folder names) on the same page.
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
      showRoutingLedger: desktop.showRoutingLedger,
    });
    const newBody = document.querySelector<HTMLElement>(".desktop-content-body");
    if (newBody) {
      newBody.dataset.tab = desktop.activeTab;
      newBody.dataset.page = page;
      // Same page: keep the scroll position. A different page starts at the top.
      if (prevPage === page) newBody.scrollTop = scroll;
    }
    if (formState) {
      restoreDesktopForm(formState);
    } else if (focusId) {
      const el = document.getElementById(focusId) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) {
        el.focus({ preventScroll: true });
        if (selStart !== null && selEnd !== null) {
          try {
            el.setSelectionRange(selStart, selEnd);
          } catch {
            // selects and checkboxes have no selection
          }
        }
      }
    }
    bindDesktopEvents();
  } catch (err) {
    console.error("[RenegadeBox] renderDesktopView error:", err);
    showToast(`Something went wrong showing this page. ${errText(err)}`, 4000);
  }
}

// ---------------------------------------------------------------- routes

/** Identifies the page on screen, so scroll is kept within a page and reset between pages. */
function desktopPageKey(): string {
  if (desktop.activeTab !== "routing") return desktop.activeTab;
  if (desktop.routeEditor) return `routing:edit:${desktop.routeEditor.draft.id || "new"}`;
  return `routing:${desktop.selectedRouteId ?? "home"}`;
}

/** Back to the routes list. */
function showRoutesHome() {
  desktop.routeEditor = null;
  desktop.selectedRouteId = null;
  desktop.pendingDeleteRouteId = null;
  renderDesktopView();
}

function blankRoute(): RouteConfig {
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
    template: "blank",
  };
}

/** Copy the editor's current field values into the draft. Rules keep blank lines while typing. */
function captureRouteDraft() {
  const ed = desktop.routeEditor;
  if (!ed || !$("route-editor")) return;
  const d = ed.draft;
  const text = (id: string) => ($(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null)?.value;
  const flag = (id: string, set: (v: boolean) => void) => {
    const el = $<HTMLInputElement>(id);
    if (el && !el.disabled) set(el.checked);
  };
  d.name = text("route-name") ?? d.name;
  d.mode = text("route-mode") ?? d.mode;
  d.source = text("route-source") ?? d.source;
  d.destination = text("route-destination") ?? d.destination;
  const layout = text("route-layout");
  if (layout !== undefined) d.layout = layout || null;
  const rules = text("route-rules");
  if (rules !== undefined) d.rules = rules.split("\n");
  flag("route-auto", (v) => (d.auto = v));
  flag("route-ai", (v) => (d.ai = v));
  flag("route-subfolders", (v) => (d.scan_subfolders = v));
  flag("route-skip-dupes", (v) => (d.skip_duplicates = v));
  flag("route-review-folder", (v) => (d.use_review_folder = v));
  flag("route-vault", (v) => (d.vault = v));
}

async function reloadRoutes() {
  const ov = await invoke<RoutesOverview>("get_routes").catch(() => null);
  if (ov) desktop.routesOverview = ov;
}

function openRouteEditor(draft: RouteConfig, isNew: boolean) {
  desktop.routeEditor = { draft, isNew, error: null };
  desktop.selectedRouteId = isNew ? null : draft.id;
  desktop.pendingDeleteRouteId = null;
  renderDesktopView();
  if (isNew) $<HTMLInputElement>("route-name")?.focus({ preventScroll: true });
}

function bindRouteEvents() {
  $("route-new-btn")?.addEventListener("click", () => openRouteEditor(blankRoute(), true));
  $("route-back-btn")?.addEventListener("click", showRoutesHome);
  $("route-editor")?.addEventListener("input", captureRouteDraft);
  $("route-editor")?.addEventListener("change", captureRouteDraft);

  // The main route keeps its full setup page; other routes open straight into their settings.
  document.querySelectorAll<HTMLButtonElement>("[data-route-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.routeOpen || "";
      const r = desktop.routesOverview?.routes.find((x) => x.config.id === id);
      if (!r) return;
      if (r.is_main) {
        desktop.routeEditor = null;
        desktop.selectedRouteId = "main";
        renderDesktopView();
      } else {
        openRouteEditor(JSON.parse(JSON.stringify(r.config)) as RouteConfig, false);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-route-template]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ed = desktop.routeEditor;
      const t = desktop.routesOverview?.templates.find((x) => x.id === btn.dataset.routeTemplate);
      if (!ed || !t) return;
      captureRouteDraft();
      const d = ed.draft;
      const templateNames = (desktop.routesOverview?.templates ?? []).map((x) => x.name);
      if (!d.name.trim() || templateNames.includes(d.name.trim())) d.name = t.id === "blank" ? "" : t.name;
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

  const browse = (buttonId: string, inputId: string) =>
    $(buttonId)?.addEventListener("click", async () => {
      try {
        const chosen = await invoke<string | null>("choose_folder");
        const input = $<HTMLInputElement>(inputId);
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
    if (!ed) return;
    captureRouteDraft();
    const route: RouteConfig = {
      ...ed.draft,
      rules: ed.draft.rules.map((r) => r.trim()).filter(Boolean),
      layout: (ed.draft.layout || "").trim() || null,
    };
    ed.saving = true;
    ed.error = null;
    renderDesktopView();
    try {
      const saved = await invoke<RouteConfig>("save_route", { route });
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

  // Two clicks to delete: the first turns the button into a confirmation.
  document.querySelectorAll<HTMLButtonElement>("[data-route-delete]").forEach((btn) => {
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
        await invoke("delete_route", { routeId, route_id: routeId });
        if (desktop.routeEditor?.draft.id === routeId) desktop.routeEditor = null;
        if (desktop.selectedRouteId === routeId) desktop.selectedRouteId = null;
        await reloadRoutes();
        showToast("Route deleted. No files were touched.");
      } catch (err) {
        showToast(`Could not delete: ${errText(err)}`, 4000);
      }
      renderDesktopView();
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-route-enable]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const r = desktop.routesOverview?.routes.find((x) => x.config.id === cb.dataset.routeEnable);
      if (!r) return;
      try {
        await invoke<RouteConfig>("save_route", { route: { ...r.config, enabled: cb.checked } });
        await reloadRoutes();
        showToast(cb.checked ? `"${r.config.name}" is on` : `"${r.config.name}" is off`);
      } catch (err) {
        cb.checked = !cb.checked;
        showToast(`Could not change the route: ${errText(err)}`, 5000);
      }
      renderDesktopView();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-route-run]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const routeId = btn.dataset.routeRun || "";
      btn.disabled = true;
      btn.textContent = "Sorting...";
      try {
        const moved = await invoke<NasTransferRecord[]>("run_route_now", { routeId, route_id: routeId });
        showToast(moved.length ? `Sorted ${moved.length} file${moved.length === 1 ? "" : "s"}` : "Nothing new to sort", 3000);
      } catch (err) {
        showToast(`Could not run the route: ${errText(err)}`, 5000);
      }
      await refreshDesktop();
    });
  });
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

  // Search input & clearing
  const searchInput = $<HTMLInputElement>("file-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      desktop.searchQuery = searchInput.value;
      renderDesktopView();
      const nextInput = $<HTMLInputElement>("file-search-input");
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
    $<HTMLInputElement>("file-search-input")?.focus();
  });

  $("clear-search-btn")?.addEventListener("click", () => {
    desktop.searchQuery = "";
    desktop.activeCategory = "all";
    renderDesktopView();
  });

  // Category filter pills
  document.querySelectorAll<HTMLButtonElement>(".cat-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cat = btn.dataset.cat as FileCategory;
      if (cat && desktop.activeCategory !== cat) {
        desktop.activeCategory = cat;
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
        showToast("Sync resumed");
      } else {
        await invoke("pause_sync");
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

  // File open, reveal, copy-path, and double-click
  document.querySelectorAll<HTMLTableRowElement>("tr.file-table-row").forEach((row) => {
    row.addEventListener("dblclick", () => {
      const idx = Number(row.dataset.index);
      const f = desktop.recent[idx];
      if (f) void invoke("open_file", { path: f.path });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='open']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      const f = desktop.recent[idx];
      if (f) void invoke("open_file", { path: f.path });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='reveal']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.index);
      const f = desktop.recent[idx];
      if (f) void invoke("reveal_in_finder", { path: f.path });
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-action='copy-path']").forEach((btn) => {
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

  // Conflict resolutions
  document.querySelectorAll<HTMLButtonElement>("[data-resolution]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = Number(btn.dataset.index);
      const item = desktop.conflicts[idx];
      if (!item || desktop.busy) return;
      btn.closest(".conflict")?.querySelectorAll("button").forEach((b) => (b.disabled = true));
      try {
        await withBusy(desktop, () => resolveConflict(invoke, item, btn.dataset.resolution as Resolution));
      } catch (err) {
        showToast(`Couldn't resolve the conflict. ${friendlyError(errText(err), "Please try again.")}`, 5000);
      }
      await refreshDesktop();
    });
  });

  // If on routing tab, bind smart routing and simulator
  if (desktop.activeTab === "routing") {
    bindSmartRoutingEvents();
  } else if (desktop.activeTab === "settings") {
    bindSettings(desktop.settingsModel.status);
    bindAccount();

    // Sub-tab switching inside settings. The choice lives in app state so refreshes keep it.
    document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (SETTINGS_TABS.includes(tab as SettingsTab)) desktop.settingsTab = tab as SettingsTab;
        if (tab === "account") {
          // Fresh device list each time the tab opens; a failed load gets another try here.
          desktop.account.devicesError = null;
          void loadAccountDevices();
        }
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        document.querySelector(`[data-panel="${tab}"]`)?.classList.add("active");
      });
    });
  }
}

/** Save the routing destination to the app config. Needs the real config loaded so nothing else is overwritten. */
async function saveDestination(path: string): Promise<boolean> {
  const cfg = desktop.aiConfig;
  if (!cfg) {
    showToast("Smart Routing settings haven't loaded yet. Try again in a moment.", 4000);
    return false;
  }
  try {
    await invoke("save_ai_config", {
      payload: {
        enabled: cfg.enabled,
        provider: cfg.provider ?? null,
        model: cfg.model,
        smb_target: path,
        rules: null,
        auto_route: cfg.auto_route,
        api_key: null,
      },
    });
    cfg.smb_target = path;
    return true;
  } catch (err) {
    showToast(`Couldn't save the destination folder. ${errText(err)}`, 5000);
    return false;
  }
}

function bindSmartRoutingEvents() {

  // Role enable/disable toggle switches
  document.querySelectorAll<HTMLInputElement>(".role-toggle-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      e.stopPropagation();
      const roleId = cb.dataset.roleToggle as RoutingRole;
      if (!roleId) return;
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

  // Role selector cards (click anywhere on card except toggle switch to focus & edit its rules)
  document.querySelectorAll<HTMLElement>("[data-role-select]").forEach((card) => {
    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".toggle-switch")) return;
      const role = card.dataset.roleSelect as RoutingRole;
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

  // Use detected drive shortcut
  $("routing-use-detected-btn")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("routing-use-detected-btn");
    const drivePath = btn?.dataset.drivePath || desktop.detectedVolume;
    if (drivePath && (await saveDestination(drivePath))) {
      showToast(`Destination set to ${drivePath}`);
      renderDesktopView();
    }
  });

  // Load all role presets into current role
  $("routing-load-all-role-btn")?.addEventListener("click", () => {
    const roleConfig = ROUTING_ROLES.find((r) => r.id === desktop.activeRole);
    if (!roleConfig) return;
    if (!desktop.roleRules[desktop.activeRole]) {
      desktop.roleRules[desktop.activeRole] = [...(DEFAULT_ROLE_RULES[desktop.activeRole] || [])];
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

  // 1. Browse / Change Destination Folder
  $("routing-browse-btn")?.addEventListener("click", async () => {
    try {
      let chosen: string | null = null;
      try {
        chosen = await invoke<string | null>("choose_folder");
      } catch {
        chosen = await invoke<string | null>("pick_sync_folder").catch(() => null);
      }
      if (chosen && (await saveDestination(chosen))) {
        showToast(`Destination set to ${chosen}`);
        renderDesktopView();
      }
    } catch (e) {
      showToast(`Couldn't open the folder picker. ${errText(e)}`);
      console.warn("Browse folder error:", e);
    }
  });

  // 2. Scan NAS & Suggest Rules
  $("routing-scan-btn")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("routing-scan-btn");
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
      let dirs: string[] = [];
      try {
        const scanRes = await invoke<any>("scan_nas_directories", { targetPath, target_path: targetPath });
        dirs = Array.isArray(scanRes) ? scanRes : scanRes?.directories || [];
      } catch (e) {
        console.warn("[RenegadeBox] folder scan failed", e);
      }
      if (dirs.length > 0) {
        desktop.discoveredDirs = dirs;
      }

      const suggested = await invoke<string[]>("suggest_rules_from_nas", { targetPath, target_path: targetPath });
      if (!desktop.roleRules[desktop.activeRole]) {
        desktop.roleRules[desktop.activeRole] = [...(DEFAULT_ROLE_RULES[desktop.activeRole] || [])];
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
      void invoke<AiUsageSummary>("get_ai_usage").then((u) => {
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

  // 3. Quick preset chips
  document.querySelectorAll<HTMLButtonElement>(".preset-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const preset = chip.dataset.preset;
      const textarea = $<HTMLTextAreaElement>("routing-explainer-input");
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

  // 4. AI Optimize & Verify Rule
  $("routing-ai-optimize-btn")?.addEventListener("click", async () => {
    const input = $<HTMLTextAreaElement>("routing-explainer-input");
    const rawText = input?.value.trim();
    if (!rawText) {
      showToast("Please type a rule pattern or description first");
      input?.focus();
      return;
    }

    const btn = $<HTMLButtonElement>("routing-ai-optimize-btn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${icons.sync(13)}<span>AI Optimizing…</span>`;
    }

    try {
      const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
      const newRules = await invoke<string[]>("translate_rules", {
        explanation: rawText,
        targetPath,
        target_path: targetPath,
      });

      const optimized = newRules[0] || rawText;
      const check = await invoke<RuleCheck>("check_rule", { rule: optimized, sampleFile: null, sample_file: null });
      desktop.aiVerification = null;
      desktop.ruleCheck = check;
      desktop.ruleCheckCanApply = true;

      showToast(check.parses ? "Rule formatted. Review the local check below before adding it." : "The AI output is not a valid rule. Edit it and try again.");
      renderDesktopView();
      void invoke<AiUsageSummary>("get_ai_usage").then((u) => {
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

  // Apply Verified Rule
  $("routing-apply-verified-btn")?.addEventListener("click", () => {
    const ruleToAdd = desktop.ruleCheck?.rule || desktop.aiVerification?.optimizedRule;
    if (!ruleToAdd) return;
    if (!desktop.roleRules[desktop.activeRole]) {
      desktop.roleRules[desktop.activeRole] = [...(DEFAULT_ROLE_RULES[desktop.activeRole] || [])];
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
    const input = $<HTMLTextAreaElement>("routing-explainer-input");
    if (input) input.value = "";
    saveRoleRulesToStorage();
    showToast(`Rule added to ${roleLabel(desktop.activeRole)}`);
    renderDesktopView();
  });

  // Dismiss Verified Rule
  $("routing-dismiss-verified-btn")?.addEventListener("click", () => {
    desktop.aiVerification = null;
    desktop.ruleCheck = null;
    desktop.ruleCheckCanApply = false;
    renderDesktopView();
  });

  // Direct Add Rule
  $("routing-add-rule-btn")?.addEventListener("click", () => {
    const input = $<HTMLTextAreaElement>("routing-explainer-input");
    const raw = input?.value.trim();
    if (!raw) {
      showToast("Please enter a rule to add");
      input?.focus();
      return;
    }
    const finalRule = raw.toLowerCase().includes("go to") ? raw : `${raw} go to Backups`;
    if (!desktop.roleRules[desktop.activeRole]) {
      desktop.roleRules[desktop.activeRole] = [...(DEFAULT_ROLE_RULES[desktop.activeRole] || [])];
    }
    if (!desktop.roleRules[desktop.activeRole].includes(finalRule)) {
      desktop.roleRules[desktop.activeRole].push(finalRule);
    }
    if (!desktop.enabledRoles.includes(desktop.activeRole)) {
      desktop.enabledRoles.push(desktop.activeRole);
    }
    desktop.smartRules = computeAggregateRules();
    if (input) input.value = "";
    saveRoleRulesToStorage();
    showToast("Rule added to workflow");
    renderDesktopView();
  });

  // Reset Role to Defaults
  $("routing-reset-role-btn")?.addEventListener("click", () => {
    desktop.roleRules[desktop.activeRole] = [...(DEFAULT_ROLE_RULES[desktop.activeRole] || [])];
    desktop.smartRules = computeAggregateRules();
    saveRoleRulesToStorage();
    showToast(`Reset ${roleLabel(desktop.activeRole)} to its default rules`);
    renderDesktopView();
  });

  // 5. Translate multiple rules from explanation
  $("routing-translate-btn")?.addEventListener("click", async () => {
    const input = $<HTMLTextAreaElement>("routing-explainer-input");
    const explanation = input?.value.trim();
    if (!explanation) {
      showToast("Please describe your organization first");
      input?.focus();
      return;
    }
    const btn = $<HTMLButtonElement>("routing-translate-btn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${icons.sync(13)}<span>Translating…</span>`;
    }
    try {
      const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
      const newRules = await invoke<string[]>("translate_rules", {
        explanation,
        targetPath,
        target_path: targetPath,
      });
      if (!desktop.roleRules[desktop.activeRole]) {
        desktop.roleRules[desktop.activeRole] = [...(DEFAULT_ROLE_RULES[desktop.activeRole] || [])];
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
      if (input) input.value = "";
      showToast(`Generated ${newRules.length} rules for ${roleLabel(desktop.activeRole)}`);
      renderDesktopView();
      void invoke<AiUsageSummary>("get_ai_usage").then((u) => {
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

  // 6. Per-Rule Inline Editing
  document.querySelectorAll<HTMLButtonElement>(".rule-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.editIdx);
      if (!isNaN(idx)) {
        desktop.editingRuleIndex = idx;
        renderDesktopView();
        $<HTMLInputElement>(`rule-edit-input-${idx}`)?.focus();
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".rule-cancel-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      desktop.editingRuleIndex = null;
      renderDesktopView();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".rule-save-edit-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.saveEdit);
      const input = $<HTMLInputElement>(`rule-edit-input-${idx}`);
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

  document.querySelectorAll<HTMLButtonElement>(".rule-ai-optimize-edit-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.editIdx);
      const input = $<HTMLInputElement>(`rule-edit-input-${idx}`);
      const val = input?.value.trim();
      if (!val) return;
      btn.disabled = true;
      btn.innerHTML = `${icons.sync(12)}<span>Refining…</span>`;
      try {
        const targetPath = desktop.aiConfig?.routing_root || desktop.aiConfig?.smb_target || "";
        const res = await invoke<string[]>("translate_rules", {
          explanation: val,
          targetPath,
          target_path: targetPath,
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

  document.querySelectorAll<HTMLButtonElement>(".rule-ai-verify-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.verifyIdx);
      const ruleText = desktop.roleRules[desktop.activeRole]?.[idx];
      if (!ruleText) return;
      try {
        const check = await invoke<RuleCheck>("check_rule", { rule: ruleText, sampleFile: null, sample_file: null });
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

  // Delete Rule from current role
  document.querySelectorAll<HTMLButtonElement>("[data-del-rule]").forEach((btn) => {
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

  // Jump to AI Ledger
  $("routing-jump-ledger-btn")?.addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    // Routes home keeps the ledger hidden until asked for; the single-page layout just scrolls to it.
    if (btn.hasAttribute("aria-expanded")) {
      desktop.showRoutingLedger = !desktop.showRoutingLedger;
      renderDesktopView();
      if (!desktop.showRoutingLedger) return;
    }
    document.getElementById("ai-usage-ledger-card")?.scrollIntoView({ behavior: "smooth" });
  });

  // Rules Search Filter
  const rulesSearchInput = $<HTMLInputElement>("rules-search-input");
  if (rulesSearchInput) {
    rulesSearchInput.addEventListener("input", () => {
      desktop.rulesSearch = rulesSearchInput.value;
      desktop.rulesPage = 1;
      renderDesktopView();
      const updated = $<HTMLInputElement>("rules-search-input");
      if (updated) {
        updated.focus();
        updated.setSelectionRange(updated.value.length, updated.value.length);
      }
    });
  }

  // Rules Pagination
  document.querySelectorAll<HTMLButtonElement>(".rules-page-prev, .rules-page-next").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.dataset.targetPage);
      if (!isNaN(target) && target >= 1) {
        desktop.rulesPage = target;
        renderDesktopView();
      }
    });
  });

  // Prune Bloated Auto-Generated Rules (all roles; the backend snapshot makes it undoable)
  $("rules-prune-bloat-btn")?.addEventListener("click", async () => {
    let removed = 0;
    for (const role of ROUTING_ROLES) {
      const list = desktop.roleRules[role.id] || [];
      const kept = list.filter((r) => !isBloatRule(r));
      removed += list.length - kept.length;
      desktop.roleRules[role.id] = kept.length > 0 ? kept : [...(DEFAULT_ROLE_RULES[role.id] || [])];
    }
    desktop.smartRules = computeAggregateRules();
    desktop.rulesPage = 1;
    saveRoleRulesToLocalOnly();
    if (await persistRoleRules()) {
      showToast(`Pruned ${removed.toLocaleString()} rules (Undo available)`, 3500);
    }
    renderDesktopView();
  });

  // Undo the last rules change (restores the previous snapshot from the config backup)
  $("rules-undo-btn")?.addEventListener("click", async () => {
    try {
      const cfg = await invoke<AiConfigResponse>("undo_rules_change");
      desktop.aiConfig = cfg;
      const restored: Record<string, string[]> = { ...DEFAULT_ROLE_RULES };
      for (const role of ROUTING_ROLES) {
        const list = cfg.role_rules?.[role.id];
        if (Array.isArray(list)) restored[role.id] = list;
      }
      desktop.roleRules = restored as Record<RoutingRole, string[]>;
      const validRoles = (cfg.enabled_roles || []).filter((r) => ROUTING_ROLES.some((x) => x.id === r)) as RoutingRole[];
      if (validRoles.length > 0) desktop.enabledRoles = validRoles;
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

  // Review queue: approve into a folder, or dismiss
  document.querySelectorAll<HTMLButtonElement>(".review-approve-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = btn.dataset.reviewId;
      if (!itemId) return;
      const folder = $<HTMLInputElement>(`review-folder-${itemId}`)?.value.trim() || null;
      btn.disabled = true;
      try {
        const rec = await invoke<NasTransferRecord>("approve_review_item", { itemId, item_id: itemId, folder });
        showToast(`Moved to ${rec.destination_folder}`);
        await refreshDesktop();
      } catch (err) {
        showToast(`Could not move file: ${errText(err)}`, 4000);
        btn.disabled = false;
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".review-dismiss-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const itemId = btn.dataset.reviewId;
      if (!itemId) return;
      try {
        await invoke("dismiss_review_item", { itemId, item_id: itemId });
        showToast("Removed from the review list (the file was not moved)");
        await refreshDesktop();
      } catch (err) {
        showToast(`Couldn't remove the item from the review list. ${errText(err)}`, 4000);
      }
    });
  });

  // Move every review item that has a folder filled in, one at a time.
  $<HTMLButtonElement>("review-move-all-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    // Read every folder up front: a refresh during the moves rebuilds these inputs.
    const folders = new Map<string, string>();
    for (const b of document.querySelectorAll<HTMLButtonElement>(".review-approve-btn")) {
      const itemId = b.dataset.reviewId || "";
      const folder = itemId ? $<HTMLInputElement>(`review-folder-${itemId}`)?.value.trim() : "";
      if (itemId && folder) folders.set(itemId, folder);
    }
    let moved = 0;
    let firstError = "";
    for (const [itemId, folder] of folders) {
      try {
        await invoke<NasTransferRecord>("approve_review_item", { itemId, item_id: itemId, folder });
        moved += 1;
      } catch (err) {
        if (!firstError) firstError = errText(err);
      }
    }
    showToast(firstError ? `Moved ${moved}. Some failed: ${firstError}` : `Moved ${moved} file${moved === 1 ? "" : "s"}`, firstError ? 6000 : 3000);
    await refreshDesktop();
  });

  // AI rule suggestions: accept adds the rule to the active role, dismiss drops it
  document.querySelectorAll<HTMLButtonElement>(".suggestion-accept-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const suggestionId = btn.dataset.suggestionId;
      const rule = btn.dataset.suggestionRule;
      if (!suggestionId || !rule) return;
      const role = desktop.activeRole;
      const prevRules = desktop.roleRules[role] ? [...desktop.roleRules[role]] : undefined;
      const prevEnabled = [...desktop.enabledRoles];
      if (!desktop.roleRules[role]) desktop.roleRules[role] = [...(DEFAULT_ROLE_RULES[role] || [])];
      if (!desktop.roleRules[role].includes(rule)) desktop.roleRules[role].push(rule);
      if (!desktop.enabledRoles.includes(role)) desktop.enabledRoles.push(role);
      desktop.smartRules = computeAggregateRules();
      btn.disabled = true;
      if (!(await persistRoleRules())) {
        // persistRoleRules already showed the error; undo the in-memory change so the screen matches the config.
        if (prevRules) desktop.roleRules[role] = prevRules;
        else delete (desktop.roleRules as Partial<Record<RoutingRole, string[]>>)[role];
        desktop.enabledRoles = prevEnabled;
        desktop.smartRules = computeAggregateRules();
        btn.disabled = false;
        return;
      }
      saveRoleRulesToLocalOnly();
      await invoke("dismiss_rule_suggestion", { suggestionId, suggestion_id: suggestionId }).catch(() => {});
      desktop.ruleSuggestions = desktop.ruleSuggestions.filter((s) => s.id !== suggestionId);
      showToast(`Rule added to ${roleLabel(role)}`);
      renderDesktopView();
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".suggestion-dismiss-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const suggestionId = btn.dataset.suggestionId;
      if (!suggestionId) return;
      await invoke("dismiss_rule_suggestion", { suggestionId, suggestion_id: suggestionId }).catch(() => {});
      desktop.ruleSuggestions = desktop.ruleSuggestions.filter((s) => s.id !== suggestionId);
      renderDesktopView();
    });
  });

  // 7. Save Rules to the app config (snapshotted for undo)
  $("routing-save-rules-btn")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("routing-save-rules-btn");
    if (btn) btn.disabled = true;
    try {
      saveRoleRulesToLocalOnly();
      if (await persistRoleRules()) {
        showToast("All rules saved");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // 8. Test / File Drop Simulator
  const runFileEvaluation = async (fileName: string) => {
    showToast(`Evaluating "${fileName}" against rules…`, 2500);
    try {
      const decision = await invoke<RouteDecision>("test_ai_routing", {
        sampleFile: fileName,
        sample_file: fileName,
        samplePath: fileName,
      });
      desktop.routingTestResult = decision;
      const drawer = $("routing-result-drawer");
      if (drawer) {
        drawer.hidden = false;
        drawer.innerHTML = renderRouteDecisionCard(decision);
      }
      showToast(`Routed to "${decision.destination_folder}" (${Math.round(decision.confidence * 100)}% confidence)`);
      void invoke<AiUsageSummary>("get_ai_usage").then((u) => {
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
      const dt = (e as DragEvent).dataTransfer;
      if (dt && dt.files && dt.files.length > 0) {
        const file = dt.files[0];
        runFileEvaluation(file.name);
      }
    });

    $("routing-select-file-btn")?.addEventListener("click", () => {
      $<HTMLInputElement>("routing-file-picker")?.click();
    });

    $("routing-file-picker")?.addEventListener("change", (e) => {
      const input = e.target as HTMLInputElement;
      if (input.files && input.files.length > 0) {
        runFileEvaluation(input.files[0].name);
      }
    });
  }

  // 9. Collapsible Settings Drawer
  $("routing-provider-select")?.addEventListener("change", (e) => {
    const sel = (e.target as HTMLSelectElement).value;
    const modelSelect = $<HTMLSelectElement>("routing-model-select");
    const openrouterField = $("routing-openrouter-key-field");
    const grokField = $("routing-grok-key-field");

    if (modelSelect) modelSelect.innerHTML = modelOptionsHtml(sel);
    if (openrouterField) openrouterField.style.display = sel === "xai" ? "none" : "";
    if (grokField) grokField.style.display = sel === "xai" ? "" : "none";
  });

  $("routing-key-toggle-btn")?.addEventListener("click", () => {
    const input = $<HTMLInputElement>("routing-api-key-input");
    const btn = $<HTMLButtonElement>("routing-key-toggle-btn");
    if (!input || !btn) return;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  $("routing-grok-key-toggle-btn")?.addEventListener("click", () => {
    const input = $<HTMLInputElement>("routing-grok-key-input");
    const btn = $<HTMLButtonElement>("routing-grok-key-toggle-btn");
    if (!input || !btn) return;
    if (input.type === "password") {
      input.type = "text";
      btn.textContent = "Hide";
    } else {
      input.type = "password";
      btn.textContent = "Show";
    }
  });

  // Drop folder behavior: move to destination (default) or organize in place, and auto-process on/off.
  const saveDropBehavior = async (changes: { routing_mode?: "move" | "organize"; auto_route?: boolean; use_review_folder?: boolean }) => {
    const cfg = desktop.aiConfig;
    try {
      await invoke("save_ai_config", {
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
          use_review_folder: changes.use_review_folder ?? null,
        },
      });
      const fresh = await invoke<AiConfigResponse>("get_ai_config").catch(() => undefined);
      if (fresh) desktop.aiConfig = fresh;
      return true;
    } catch (err) {
      showToast(`Could not save: ${errText(err)}`, 4000);
      return false;
    }
  };

  document.querySelectorAll<HTMLButtonElement>("[data-routing-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.routingMode === "organize" ? "organize" : "move";
      if ((desktop.aiConfig?.routing_mode || "move") === mode) return;
      if (await saveDropBehavior({ routing_mode: mode })) {
        showToast(mode === "organize" ? "Dropped files will be organized inside the drop folder" : "Dropped files will be moved to the destination folder", 3000);
        renderDesktopView();
      }
    });
  });

  $<HTMLInputElement>("drop-auto-toggle")?.addEventListener("change", async (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (await saveDropBehavior({ auto_route: on })) {
      showToast(on ? "Dropped files will be processed automatically" : "Files will wait until you click Sort now", 3000);
      renderDesktopView();
    }
  });

  $<HTMLInputElement>("review-folder-toggle")?.addEventListener("change", async (e) => {
    const on = (e.target as HTMLInputElement).checked;
    if (await saveDropBehavior({ use_review_folder: on })) {
      showToast(on ? "Files that cannot be sorted will go to _Needs Review" : "Files that cannot be sorted will stay where you dropped them", 3000);
      renderDesktopView();
    }
  });

  $("routing-save-config-btn")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("routing-save-config-btn");
    if (btn) btn.disabled = true;
    try {
      const provider = $<HTMLSelectElement>("routing-provider-select")?.value || "xai";
      const model = $<HTMLSelectElement>("routing-model-select")?.value || AI_MODELS[provider === "openrouter" ? "openrouter" : "xai"][0]![0];
      const openRouterInput = $<HTMLInputElement>("routing-api-key-input");
      const grokInput = $<HTMLInputElement>("routing-grok-key-input");
      const autoRoute = $<HTMLInputElement>("drop-auto-toggle")?.checked ?? desktop.aiConfig?.auto_route ?? true;
      const vaultRouting = $<HTMLInputElement>("routing-vault-toggle")?.checked ?? false;
      const vaultMaxRaw = Number($<HTMLInputElement>("routing-vault-max-mb")?.value);
      const vaultMaxMb = Number.isFinite(vaultMaxRaw) && vaultMaxRaw >= 1 ? Math.round(vaultMaxRaw) : null;
      const openRouterKey = openRouterInput?.value.trim() || null;
      const grokKey = grokInput?.value.trim() || null;

      await invoke("save_ai_config", {
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
          vault_max_file_mb: vaultMaxMb,
        },
      });
      if (desktop.aiConfig) {
        desktop.aiConfig.provider = provider;
        desktop.aiConfig.model = model;
        desktop.aiConfig.auto_route = autoRoute;
        desktop.aiConfig.vault_routing_enabled = vaultRouting;
        if (vaultMaxMb) desktop.aiConfig.vault_max_file_mb = vaultMaxMb;
        if (openRouterKey) {
          desktop.aiConfig.has_openrouter_key = true;
          if (provider === "openrouter") desktop.aiConfig.has_api_key = true;
          if (openRouterInput) openRouterInput.value = "";
        }
        if (grokKey) {
          desktop.aiConfig.has_grok_key = true;
          if (provider === "xai") desktop.aiConfig.has_api_key = true;
          if (grokInput) grokInput.value = "";
        }
      }
      showToast("AI settings saved");
      renderDesktopView();
    } catch (err) {
      showToast(`Couldn't save the AI settings. ${errText(err)}`, 5000);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // 10. AI Usage Ledger actions (Refresh & Clear)
  $("ai-usage-refresh-btn")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("ai-usage-refresh-btn");
    if (btn) btn.disabled = true;
    try {
      const usage = await invoke<AiUsageSummary>("get_ai_usage");
      desktop.aiUsage = usage;
      showToast("AI API usage ledger refreshed");
      renderDesktopView();
    } catch (err) {
      showToast(`Could not refresh usage: ${errText(err)}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $("ai-usage-clear-btn")?.addEventListener("click", async () => {
    const btn = $<HTMLButtonElement>("ai-usage-clear-btn");
    if (btn) btn.disabled = true;
    try {
      const emptyUsage = await invoke<AiUsageSummary>("clear_ai_usage");
      desktop.aiUsage = emptyUsage;
      showToast("AI API usage ledger cleared");
      renderDesktopView();
    } catch (err) {
      showToast(`Could not clear usage: ${errText(err)}`);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // 11. NAS Staging Ingest actions
  $("nas-open-staging-btn")?.addEventListener("click", async () => {
    const folder = desktop.aiConfig?.nas_ingest_folder || desktop.nasStagingStatus?.ingest_folder;
    if (folder) {
      try {
        await invoke("reveal_in_finder", { path: folder });
      } catch (err) {
        showToast(`Could not open staging folder: ${errText(err)}`);
      }
    }
  });

  $("nas-change-staging-btn")?.addEventListener("click", async () => {
    try {
      const chosen = await invoke<string | null>("choose_folder").catch(() => null);
      if (chosen) {
        if (desktop.aiConfig) {
          desktop.aiConfig.nas_ingest_folder = chosen;
          await invoke("save_ai_config", {
            payload: {
              enabled: desktop.aiConfig.enabled,
              model: desktop.aiConfig.model,
              smb_target: null,
              nas_ingest_folder: chosen,
              rules: null,
              auto_route: desktop.aiConfig.auto_route,
            },
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
    const btn = $<HTMLButtonElement>("nas-process-now-btn");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${icons.sync(13)}<span>Processing…</span>`;
    }
    try {
      const reviewBefore = desktop.reviewQueue.length;
      const moved = await invoke<NasTransferRecord[]>("process_nas_ingest");
      await refreshDesktop();
      const sentToReview = Math.max(0, desktop.reviewQueue.length - reviewBefore);
      const parts: string[] = [];
      if (moved.length > 0) parts.push(`Moved ${moved.length} file${moved.length === 1 ? "" : "s"} to the destination folder`);
      if (sentToReview > 0) parts.push(`${sentToReview} sent to _Needs Review`);
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

  // 12. NAS Transfer Log row actions (Reveal, Relocate, Revert)
  document.querySelectorAll<HTMLButtonElement>("[data-reveal-nas-path]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const path = btn.dataset.revealNasPath;
      if (path) {
        try {
          await invoke("reveal_in_finder", { path });
        } catch (err) {
          showToast(`Could not reveal file: ${errText(err)}`);
        }
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-relocate-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.relocateId;
      const currentFolder = btn.dataset.relocateFolder || "Backups";
      const fileName = btn.dataset.relocateFile || "file";
      const newFolder = prompt(`New folder inside the destination for "${fileName}":`, currentFolder);
      if (newFolder && newFolder.trim() && newFolder.trim() !== currentFolder) {
        try {
          const updated = await invoke<NasTransferRecord>("relocate_nas_transfer", {
            transferId: id,
            newFolder: newFolder.trim(),
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

  document.querySelectorAll<HTMLButtonElement>("[data-revert-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.revertId;
      const fileName = btn.dataset.revertFile || "file";
      try {
        await invoke("revert_nas_transfer_to_staging", { transferId: id });
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
      await invoke("clear_nas_transfers");
      desktop.nasTransfers = [];
      showToast("Transfer log cleared");
      renderDesktopView();
    } catch (err) {
      showToast(`Could not clear log: ${errText(err)}`);
    }
  });

  $("nas-refresh-transfers-btn")?.addEventListener("click", async () => {
    try {
      const transfers = await invoke<NasTransferRecord[]>("get_nas_transfers");
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
  void refreshDesktop();
  void onBackendEvents(
    ["vault-changed", "account-changed", "sync-started", "sync-finished", "status-changed", "sync-paused", "sync-resumed", "nas-transfer-occurred"],
    () => void refreshDesktop({ background: true }),
  );
  void onBackendEvents(["navigate-tab"], (event: any) => {
    const tab = (event?.payload ?? event) as DesktopTab;
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
        const input = $<HTMLInputElement>("file-search-input");
        if (input) {
          input.focus();
          input.select();
        }
      } else if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        void refreshDesktop();
      } else if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        void invoke("open_sync_folder");
      }
    } else if (e.key === "Escape") {
      if (desktop.searchQuery) {
        desktop.searchQuery = "";
        renderDesktopView();
      }
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
    link("?view=desktop", "Desktop Window", view === "desktop" && desktop.activeTab !== "routing" && desktop.activeTab !== "settings") +
    link("?view=desktop&tab=routing", "Smart Routing", view === "desktop" && desktop.activeTab === "routing") +
    MOCK_SCENARIOS.map((s) => link(`?view=desktop&state=${s}`, labels[s], view === "desktop" && scenario === s)).join("") +
    link("?view=settings", "Settings", view === "settings") +
    link("?view=setup&state=setup", "Setup", view === "setup");
  document.body.prepend(bar);
}

function init() {
  applyTheme();
  const view = currentView();
  document.body.classList.add(`view-${view}`);
  const urlTab = new URLSearchParams(location.search).get("tab") as DesktopTab | null;
  if (urlTab && ["files", "conflicts", "routing", "settings"].includes(urlTab)) {
    desktop.activeTab = urlTab;
  }
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

