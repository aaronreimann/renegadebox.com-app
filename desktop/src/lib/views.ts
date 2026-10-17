// Pure HTML renderers for each screen. No DOM access here, so they can be tested with bun.
import { escapeHtml as esc, relativeTime, formatBytes, splitPath } from "./format";
import { fileIcon, icons, categorizeFile, type FileCategory } from "./icons";
import { describeStatus, type Overview, type StatusKind } from "./status";
import { keyStoreKind } from "./actions";
import { PROVIDERS, MIN_PASSPHRASE, providerLabel } from "./setup";
import { MIN_ACCOUNT_PASSWORD, deviceMeta, sortDevices } from "./account";
import type { AccountDevice, AccountStatus, ActivityItem, SyncActivity, ConflictItem, RecentFile, VaultStatus, AiVerificationResult, AiUsageSummary, NasTransferRecord, NasStagingStatus, AiConfigResponse, ReviewItem, RuleSuggestion, RuleCheck, RouteDecision, RouteConfig, RouteEditorState, RoutesOverview, RouteStatus, RouteTemplate } from "./types";

const STATUS_ICON: Record<StatusKind, () => string> = {
  ok: () => icons.check(20),
  syncing: () => icons.sync(20),
  paused: () => icons.pause(20),
  attention: () => icons.alert(20),
  error: () => icons.offline(20),
  setup: () => icons.box(20),
};

export type PopoverTab = "activity" | "recent";

export interface PopoverModel {
  overview: Overview;
  recent: RecentFile[];
  now: number;
  /** Live transfers and sync history. Missing means not loaded yet. */
  activity?: SyncActivity;
  tab?: PopoverTab;
  query?: string;
  menuOpen?: boolean;
}

/**
 * The menu bar dropdown, modeled on the Dropbox menu bar window: brand + quick actions on
 * top, a search box, two tabs, a scrolling file list, and the sync status pinned at the bottom.
 */
export function renderPopover(m: PopoverModel): string {
  const { overview } = m;
  const tab = m.tab ?? "activity";
  const st = describeStatus(overview);
  const statusInner = `
      <span class="status-icon">${STATUS_ICON[st.kind]()}</span>
      <span class="status-text">
        <span class="status-title">${esc(st.title)}</span>
        ${st.detail ? `<span class="status-detail">${esc(st.detail)}</span>` : ""}
      </span>`;
  const status =
    st.kind === "attention"
      ? `<button id="status-line" class="status status-${st.kind} status-link" type="button">${statusInner}<span id="conflicts-link" class="status-chevron">${icons.chevron(16)}</span></button>`
      : `<div id="status-line" class="status status-${st.kind}" role="status">${statusInner}</div>`;

  const pauseLabel = overview.paused ? "Resume syncing" : "Pause syncing";
  const menu = m.menuOpen
    ? `
      <div id="popover-menu" class="pop-menu" role="menu">
        <button id="menu-preferences" class="pop-menu-item" type="button" role="menuitem">${icons.gear(14)}<span>Preferences…</span></button>
        <button id="menu-open-app" class="pop-menu-item" type="button" role="menuitem">${icons.appWindow(14)}<span>Open RenegadeBox</span></button>
        <button id="menu-pause" class="pop-menu-item" type="button" role="menuitem"${overview.initialized ? "" : " disabled"}>${overview.paused ? icons.play(14) : icons.pause(14)}<span>${pauseLabel}</span></button>
        <div class="pop-menu-sep" role="separator"></div>
        <button id="menu-quit" class="pop-menu-item" type="button" role="menuitem"><span class="pop-menu-spacer"></span><span>Quit RenegadeBox</span></button>
      </div>`
    : "";

  const controls = overview.initialized
    ? `
      <div class="pop-search">
        <span class="pop-search-icon">${icons.search(14)}</span>
        <input id="popover-search" type="search" placeholder="Search recent files" value="${esc(m.query ?? "")}" autocomplete="off" spellcheck="false" aria-label="Search recent files" />
      </div>
      <div class="pop-tabs" role="tablist">
        <button class="pop-tab${tab === "activity" ? " active" : ""}" type="button" role="tab" aria-selected="${tab === "activity"}" data-popover-tab="activity">Sync history</button>
        <button class="pop-tab${tab === "recent" ? " active" : ""}" type="button" role="tab" aria-selected="${tab === "recent"}" data-popover-tab="recent">Recently edited</button>
      </div>`
    : "";

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

const matches = (q: string, ...fields: string[]) => !q || fields.some((f) => f.toLowerCase().includes(q));

/** Just the scrolling list, so typing in the search box can re-render it without losing focus. */
export function renderPopoverList(m: PopoverModel): string {
  const { overview, now } = m;
  if (!overview.initialized) {
    return `
      <div class="empty">
        <p>RenegadeBox keeps a folder on this Mac in sync with storage you own.</p>
        <button id="start-setup-btn" class="btn primary" type="button">Set up RenegadeBox…</button>
      </div>`;
  }
  const q = (m.query ?? "").trim().toLowerCase();
  const noMatch = `<div class="empty"><p>No files match "${esc(m.query ?? "")}".</p></div>`;

  if ((m.tab ?? "activity") === "recent") {
    const rows = m.recent.map((f, i) => ({ f, i })).filter(({ f }) => matches(q, f.name, f.folder));
    if (m.recent.length === 0) return emptyState("Files you edit in your RenegadeBox folder will show up here.");
    if (rows.length === 0) return noMatch;
    return `<ul class="recent-list">${rows.map(({ f, i }) => recentRow(f, i, now)).join("")}</ul>`;
  }

  const active = (m.activity?.active ?? []).filter((a) => matches(q, a.name, a.folder));
  const done = (m.activity?.recent ?? []).filter((a) => matches(q, a.name, a.folder));
  const total = (m.activity?.active.length ?? 0) + (m.activity?.recent.length ?? 0);
  if (total === 0) return emptyState("Files you add to your RenegadeBox folder will show up here as they sync.");
  if (active.length + done.length === 0) return noMatch;
  return `
    ${active.length ? `<h2 class="section-label">Syncing now <span class="section-count">${active.length}</span></h2><ul class="recent-list">${active.map((a) => activityRow(a, now)).join("")}</ul>` : ""}
    ${done.length ? `<h2 class="section-label">${active.length ? "Earlier" : "Recent activity"}</h2><ul class="recent-list">${done.slice(0, 50).map((a) => activityRow(a, now)).join("")}</ul>` : ""}`;
}

function emptyState(text: string): string {
  return `
    <div class="empty pop-empty">
      <span class="pop-empty-art">${icons.box(34)}</span>
      <p class="pop-empty-title">It's quiet in here</p>
      <p>${esc(text)}</p>
    </div>`;
}

/** Last `n` segments of a folder path, for destinations like /Volumes/NAS/Archives/2026. */
function shortFolder(folder: string, n = 2): string {
  const parts = folder.split("/").filter(Boolean);
  return parts.slice(-n).join("/") || "RenegadeBox";
}

export function activityMeta(a: ActivityItem, now: number): string {
  const size = a.size ? formatBytes(a.size) : "";
  if (a.status === "active") {
    const verb = a.kind === "download" ? "Downloading" : "Uploading";
    return size ? `${verb} · ${size}` : `${verb}…`;
  }
  const when = relativeTime(a.finished_ms ?? a.started_ms, now);
  const where = a.kind === "moved" ? shortFolder(a.folder) : a.folder ? a.folder.split("/").pop()! : "RenegadeBox";
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

function activityBadge(a: ActivityItem): string {
  if (a.status === "active") return a.kind === "download" ? icons.arrowDown(14) : icons.arrowUp(14);
  if (a.status === "failed") return icons.alert(14);
  if (a.kind === "delete_remote" || a.kind === "delete_local") return icons.trash(14);
  return icons.check(14);
}

/** Color family for the file tile in dropdown rows. */
function fileTone(name: string): string {
  const cat = categorizeFile(name);
  if (cat === "images") return "img";
  if (cat === "archives") return "zip";
  if (cat === "code") return "code";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (["xls", "xlsx", "csv", "numbers"].includes(ext)) return "sheet";
  if (ext === "pdf") return "pdf";
  if (["mov", "mp4", "m4v", "avi", "mkv", "mp3", "wav", "m4a"].includes(ext)) return "media";
  if (["doc", "docx", "txt", "md", "pages", "rtf"].includes(ext)) return "doc";
  return "file";
}

function activityRow(a: ActivityItem, now: number): string {
  const deleted = a.kind === "delete_remote" || a.kind === "delete_local";
  const path = esc(a.path);
  const label = a.status === "active" ? (a.kind === "download" ? "Downloading" : "Uploading") : a.status === "failed" ? "Failed" : deleted ? "Deleted" : "Synced";
  return `
    <li class="recent-row act-row act-${a.status}">
      <button class="recent-open" type="button" data-action="open-activity" data-path="${path}" title="${deleted ? esc(a.name) : `Open ${esc(a.name)}`}"${deleted ? " disabled" : ""}>
        <span class="file-icon file-tile tone-${fileTone(a.name)}">${fileIcon(a.name)}</span>
        <span class="recent-text">
          <span class="recent-name">${esc(a.name)}</span>
          <span class="recent-meta">${esc(activityMeta(a, now))}</span>
          ${a.status === "active" ? `<span class="act-progress" role="progressbar" aria-label="${label} ${esc(a.name)}"><span></span></span>` : ""}
        </span>
        <span class="act-badge act-badge-${a.status}${deleted ? " act-badge-deleted" : ""}" title="${label}">${activityBadge(a)}</span>
      </button>
      ${deleted || a.status === "active" ? "" : `<button class="reveal-btn" type="button" data-action="reveal-activity" data-path="${path}">Show in Finder</button>`}
    </li>`;
}

function recentRow(f: RecentFile, i: number, now: number): string {
  const where = f.folder ? f.folder.split("/").pop()! : "RenegadeBox";
  return `
    <li class="recent-row" data-index="${i}">
      <button class="recent-open" type="button" data-action="open" data-index="${i}" title="Open ${esc(f.name)}">
        <span class="file-icon file-tile tone-${fileTone(f.name)}">${fileIcon(f.name)}</span>
        <span class="recent-text">
          <span class="recent-name">${esc(f.name)}</span>
          <span class="recent-meta">Edited in ${esc(where)} · ${esc(relativeTime(f.modified_ms, now))}</span>
        </span>
      </button>
      <button class="reveal-btn" type="button" data-action="reveal" data-index="${i}">Show in Finder</button>
    </li>`;
}

export function renderConflictList({ conflicts, now }: { conflicts: ConflictItem[]; now: number }): string {
  const rows = conflicts
    .map((c, i) => {
      const who = c.device ? esc(c.device) : "Another device";
      const where = c.folder ? ` in ${esc(c.folder.split("/").pop()!)}` : "";
      const other = c.device ? `Use ${esc(c.device)}’s version` : "Use the other version";
      return `
      <li class="conflict" data-index="${i}">
        <div class="conflict-head">
          <span class="file-icon">${fileIcon(c.original_name)}</span>
          <span class="recent-text">
            <span class="recent-name">${esc(c.original_name)}</span>
            <span class="recent-meta">${who} saved a different version${where} · ${esc(relativeTime(c.modified_ms, now))}</span>
          </span>
        </div>
        <div class="conflict-actions">
          <button class="btn primary" type="button" data-index="${i}" data-resolution="keep_both" title="Keep both files side by side">Keep both</button>
          <button class="btn" type="button" data-index="${i}" data-resolution="keep_conflicted">${other}</button>
          <button class="btn" type="button" data-index="${i}" data-resolution="keep_local">Keep current</button>
        </div>
      </li>`;
    })
    .join("");

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

export interface SettingsModel {
  status: VaultStatus;
  autostart: boolean;
  ignored: string[];
  /** The Account tab. Left out, the tab shows a loading line. */
  account?: AccountViewModel;
}

export type AccountAction = "google" | "create" | "signin" | "password" | "signout" | "remove";

/** Where an account message is shown: next to the form it belongs to. */
export type AccountMessageSlot = "google" | "create" | "signin" | "password" | "signout" | "devices";

export interface AccountMessage {
  slot: AccountMessageSlot;
  text: string;
  error: boolean;
}

export interface AccountViewModel {
  /** null until account_status has answered. */
  status: AccountStatus | null;
  /** null until the device list has loaded. */
  devices: AccountDevice[] | null;
  devicesLoading?: boolean;
  /** Shown as a quiet line in place of the list, e.g. when offline. */
  devicesError?: string | null;
  /** The action in progress, so its button stays busy across re-renders. */
  action?: AccountAction | null;
  /** Row of the device being removed (indexes into the sorted list). */
  removingIndex?: number | null;
  message?: AccountMessage | null;
  /** Show the email and password forms. They also open by themselves while one of them is busy or has a message. */
  showPasswordForms?: boolean;
  now?: number;
}

/** The main way in: a neutral "G" button, or the waiting line with Cancel while the browser is open. */
export function renderGoogleButton(opts: { id: string; waiting: boolean; cancelId: string; disabled?: boolean }): string {
  if (opts.waiting) {
    return `<p class="google-waiting" role="status" aria-live="polite"><span class="google-waiting-text">Finish signing in in your browser…</span> <button id="${opts.cancelId}" class="link-btn" type="button">Cancel</button></p>`;
  }
  return `<button id="${opts.id}" class="btn google-btn" type="button"${opts.disabled ? " disabled" : ""}><span class="google-mark">${icons.gMark(16)}</span><span>Continue with Google</span></button>`;
}

/** Device rows in the order they are shown, so a row index maps back to a device id. */
export function accountDeviceRows(devices: AccountDevice[] | null): AccountDevice[] {
  return devices ? sortDevices(devices) : [];
}

function accountMessage(m: AccountViewModel, slot: AccountMessageSlot): string {
  const msg = m.message && m.message.slot === slot ? m.message : null;
  return `<p id="account-${slot}-message" class="inline-message${msg?.error ? " error" : ""}" role="status">${msg ? esc(msg.text) : ""}</p>`;
}

function busyButton(m: AccountViewModel, action: AccountAction, id: string, label: string, busyLabel: string, cls = "btn primary"): string {
  const busy = m.action === action;
  return `<button id="${id}" class="${cls}" type="submit"${m.action ? " disabled" : ""}${busy ? ' aria-busy="true"' : ""}>${busy ? busyLabel : label}</button>`;
}

function renderSignedOutAccount(m: AccountViewModel): string {
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

function renderDeviceList(m: AccountViewModel): string {
  const rows = accountDeviceRows(m.devices);
  if (m.devices === null) {
    if (m.devicesError) return `<p class="field-hint account-quiet-error" role="status">${esc(m.devicesError)}</p>`;
    return `<p class="field-hint" role="status">Loading your Macs…</p>`;
  }
  if (rows.length === 0) return `<p class="field-hint">No Macs are signed in.</p>`;
  const now = m.now ?? Date.now();
  const items = rows
    .map((d, i) => {
      const removing = m.action === "remove" && m.removingIndex === i;
      const actions = d.current
        ? ""
        : `<button class="btn account-remove-btn" type="button" data-remove-device="${i}"${m.action ? " disabled" : ""}>${removing ? "Removing…" : "Remove"}</button>`;
      const confirm = d.current
        ? ""
        : `
            <div id="account-remove-confirm-${i}" class="confirm account-device-confirm" data-keep-open hidden>
              <p>Remove ${esc(d.name)} from your account? That Mac will be signed out. Its files stay where they are.</p>
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
                <span class="account-device-name">${esc(d.name)}</span>
                <span class="field-hint">${esc(deviceMeta(d, now))}</span>
              </span>
              ${actions}
            </div>${confirm}
          </li>`;
    })
    .join("");
  return `<ul class="account-devices">${items}</ul>`;
}

function renderSignedInAccount(m: AccountViewModel): string {
  const email = m.status?.email ?? "";
  const google = m.status?.provider === "google";
  return `
        <section class="group">
          <h2 class="group-title">Account</h2>
          <p class="account-signed-in">${google ? "Signed in with Google as" : "Signed in as"} <strong>${esc(email)}</strong></p>
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

/** The Account tab in Settings: create or sign in when signed out, otherwise Macs, password and sign out. */
export function renderAccountPanel(m: AccountViewModel | undefined): string {
  if (!m || !m.status) {
    return `
        <section class="group">
          <h2 class="group-title">Account</h2>
          <p class="field-hint" role="status">Loading your account…</p>
        </section>`;
  }
  return m.status.signed_in ? renderSignedInAccount(m) : renderSignedOutAccount(m);
}

export function renderPopoverSettings({ status, autostart, ignored }: SettingsModel): string {
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
              <input id="device-name-input" type="text" value="${esc(status.device_name ?? "")}" maxlength="128" autocomplete="off" spellcheck="false" />
              <button id="device-name-save" class="btn" type="button">Save</button>
            </span>
            <span class="field-hint">Shown on your other devices when files change.</span>
            <span id="device-name-message" class="inline-message" role="status"></span>
          </label>
          <div class="kv">
            <span class="kv-label">Folder</span>
            <span class="kv-value" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:160px;" title="${esc(folder)}">${esc(folder)}</span>
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
          <div class="kv"><span class="kv-label">Provider</span><span class="kv-value">${esc(providerLabel(status.endpoint))}</span></div>
          <div class="kv"><span class="kv-label">Bucket</span><span class="kv-value">${esc(status.bucket ?? "—")}</span></div>
          <div class="kv"><span class="kv-label">Region</span><span class="kv-value">${esc(status.region ?? "—")}</span></div>
          <div class="kv"><span class="kv-label">Storage used</span><span class="kv-value">${esc(filesCount)}</span></div>
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
          <textarea id="ignored-input" rows="4" spellcheck="false">${esc(ignored.join("\n"))}</textarea>
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

export function renderSettings(
  { status, autostart, ignored, account }: SettingsModel,
  initialTab: string = "general",
  hideHeaderTitle: boolean = false,
): string {
  const kind = keyStoreKind(status.key_store);
  const row = (label: string, value: string) => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-value">${value}</span></div>`;
  const folder = status.folder ?? "Not set up";
  const totalSize = status.total_bytes ? ` · ${formatBytes(status.total_bytes)}` : "";
  const filesCount = status.total_files ? `${status.total_files} files${totalSize}` : "No files synced yet";

  const isTab = (t: string) => initialTab === t;

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
              <input id="device-name-input" type="text" value="${esc(status.device_name ?? "")}" maxlength="128" autocomplete="off" spellcheck="false" />
              <button id="device-name-save" class="btn" type="button">Save</button>
            </span>
            <span class="field-hint">Shown on your other devices when files change.</span>
            <span id="device-name-message" class="inline-message" role="status"></span>
          </label>
          <div class="kv">
            <span class="kv-label">Folder</span>
            <span class="kv-value" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <span>${esc(folder)}</span>
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
          ${row("Provider", esc(providerLabel(status.endpoint)))}
          ${row("Bucket", esc(status.bucket ?? "—"))}
          ${row("Region", esc(status.region ?? "—"))}
          ${row("Storage used", esc(filesCount))}
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
          <textarea id="ignored-input" rows="6" spellcheck="false">${esc(ignored.join("\n"))}</textarea>
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

export function renderRouteDecisionCard(decision: RouteDecision): string {
  const confPercent = Math.round(decision.confidence * 100);
  const badgeClass = confPercent >= 80 ? "ok" : confPercent >= 60 ? "warn" : "attention";
  return `
    <div class="decision-card">
      <div class="decision-header">
        <div class="decision-file-info">
          <span class="decision-file-icon">${icons.doc(18)}</span>
          <div class="decision-file-names">
            <span class="decision-filename">${esc(decision.suggested_filename)}</span>
            <span class="decision-dest-path">${icons.folder(12)}<span>Destination: ${esc(decision.destination_folder)}</span></span>
          </div>
        </div>
        <div class="decision-badge ${badgeClass}">
          ${confPercent}% Confidence
        </div>
      </div>
      <div class="decision-body">
        <div class="decision-reason">
          <span class="reason-label">Reasoning:</span>
          <span class="reason-text">${esc(decision.explanation)}</span>
        </div>
        ${
          confPercent < 70
            ? `<div class="decision-reason"><span class="reason-label">Would go to review:</span><span class="reason-text">Below 70% confidence, so a real drop would wait in _Needs Review instead of moving.</span></div>`
            : ""
        }
        ${
          (decision as { suggested_rule?: string | null }).suggested_rule
            ? `<div class="decision-reason"><span class="reason-label">Suggested rule:</span><code class="reason-text">${esc(String((decision as { suggested_rule?: string | null }).suggested_rule))}</code></div>`
            : ""
        }
      </div>
    </div>`;
}

export type RoutingRole = "webdev" | "agency" | "creative" | "personal";

export interface RoleConfig {
  id: RoutingRole;
  title: string;
  badge: string;
  tagline: string;
  icon: (size?: number) => string;
  placeholder: string;
  recommendedFolders: string[];
  chips: { label: string; preset: string }[];
}

export const ROUTING_ROLES: RoleConfig[] = [
  {
    id: "webdev",
    title: "Web Developer & Hosting",
    badge: "Web Hosting",
    tagline: "Automate SpinupWP, WP Engine, Pressable, cPanel & SQL database backups",
    icon: (s?: number) => icons.code(s ?? 16),
    placeholder: "e.g. Put SpinupWP tar.gz and sql.gz in Backups From Spinup, WP Engine archives in Backups From WPEngine, Pressable backups in Backups From Pressable, and cPanel in Backups From cPanel",
    recommendedFolders: ["Backups From Spinup", "Backups From WPEngine", "Backups From Pressable", "Backups From cPanel", "Backups From DigitalOcean", "Database Backups"],
    chips: [
      { label: "+ SpinupWP", preset: "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup" },
      { label: "+ WP Engine", preset: "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine" },
      { label: "+ Pressable", preset: "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable" },
      { label: "+ cPanel", preset: "cPanel website backups (backup-*.tar.gz) go to Backups From cPanel" },
      { label: "+ DigitalOcean", preset: "DigitalOcean server and database backups (*.sql.gz) go to Backups From DigitalOcean" },
      { label: "+ SQL Dumps", preset: "Raw MySQL and Postgres database dumps (*.sql, *.sql.gz) go to Database Backups" },
      { label: "+ Local WP Exports", preset: "All-in-One WP and local site exports (*.wpress, *.tar) go to Local Sites & Exports" },
    ],
  },
  {
    id: "agency",
    title: "Freelance & Agency",
    badge: "Business & Clients",
    tagline: "Organize client contracts, invoices, tax forms, and expense receipts",
    icon: (s?: number) => icons.doc(s ?? 16),
    placeholder: "e.g. Route invoices and receipts into Finance/Invoices, client contracts into Work/Contracts, and IRS forms into Finance/Taxes",
    recommendedFolders: ["Finance/Invoices", "Work/Contracts", "Finance/Taxes", "Finance/Receipts", "Work/Deliverables"],
    chips: [
      { label: "+ Invoices", preset: "Client invoices, vendor bills, and billing statements go to Finance/Invoices" },
      { label: "+ Taxes", preset: "Tax forms (W-2, 1099, K-1) and IRS filings go to Finance/Taxes" },
      { label: "+ Contracts", preset: "Client proposals, SOWs, NDAs, and agreements go to Work/Contracts" },
      { label: "+ Receipts", preset: "Expense receipts, software subscriptions, and hardware purchases go to Finance/Receipts" },
      { label: "+ Deliverables", preset: "Client deliverables, slide decks, and final assets go to Work/Deliverables" },
    ],
  },
  {
    id: "creative",
    title: "Creative & Media Studio",
    badge: "Media Studio",
    tagline: "Sort 4K video footage, RAW photography, audio stems, and design assets",
    icon: (s?: number) => icons.image(s ?? 16),
    placeholder: "e.g. Put camera RAWs into Media/Photos, 4K b-roll into Media/Footage, and audio stems into Media/Audio",
    recommendedFolders: ["Media/Photos", "Media/Footage", "Media/Audio", "Creative/Assets", "Creative/Projects"],
    chips: [
      { label: "+ RAW Photos", preset: "Camera RAW photos (CR3, ARW, NEF) and edits go to Media/Photos" },
      { label: "+ 4K Footage", preset: "Video footage, b-roll, and exports (MOV, MP4) go to Media/Footage" },
      { label: "+ Audio Stems", preset: "Audio recordings, podcasts, and WAV stems go to Media/Audio" },
      { label: "+ Design Files", preset: "Figma, Illustrator, and Photoshop projects (PSD, AI) go to Creative/Assets" },
    ],
  },
  {
    id: "personal",
    title: "Personal & Family Archive",
    badge: "Home & Life",
    tagline: "Preserve family photos, home deeds, medical records, and travel docs",
    icon: (s?: number) => icons.box(s ?? 16),
    placeholder: "e.g. Sort family photos by year into Family/Photos, health records into Personal/Health, and mortgage docs into Home/Property",
    recommendedFolders: ["Family/Photos", "Personal/Health", "Home/Property", "Personal/Travel", "Personal/Finances"],
    chips: [
      { label: "+ Family Photos", preset: "Family photos and mobile uploads go to Family/Photos" },
      { label: "+ Health & Medical", preset: "Medical records, doctor charts, and lab results go to Personal/Health" },
      { label: "+ Home & Auto", preset: "Mortgage, lease, home maintenance, and car titles go to Home/Property" },
      { label: "+ Passports & Travel", preset: "Boarding passes, hotel reservations, and passports go to Personal/Travel" },
    ],
  },
];

export const DEFAULT_ROLE_RULES: Record<RoutingRole, string[]> = {
  webdev: [
    "SpinupWP site backups (*-files.tar.gz) and database dumps (*.sql.gz) go to Backups From Spinup",
    "WP Engine site archives (site-archive-*.zip) go to Backups From WPEngine",
    "Pressable site backups (pressable-backup-*.bz2) go to Backups From Pressable",
    "cPanel website backups (backup-*.tar.gz) go to Backups From cPanel",
    "DigitalOcean server and database backups (*.sql.gz) go to Backups From DigitalOcean",
    "Raw MySQL and Postgres database dumps (*.sql, *.sql.gz) go to Database Backups",
    "All-in-One WP and local site exports (*.wpress, *.tar) go to Local Sites & Exports",
  ],
  agency: [
    "Client invoices, vendor bills, and billing statements go to Finance/Invoices",
    "Tax forms (W-2, 1099, K-1) and IRS filings go to Finance/Taxes",
    "Client proposals, SOWs, NDAs, and agreements go to Work/Contracts",
    "Expense receipts, software subscriptions, and hardware purchases go to Finance/Receipts",
    "Client deliverables, slide decks, and final assets go to Work/Deliverables",
  ],
  creative: [
    "Camera RAW photos (CR3, ARW, NEF) and edits go to Media/Photos",
    "Video footage, b-roll, and exports (MOV, MP4) go to Media/Footage",
    "Audio recordings, podcasts, and WAV stems go to Media/Audio",
    "Figma, Illustrator, and Photoshop projects (PSD, AI) go to Creative/Assets",
  ],
  personal: [
    "Family photos and mobile uploads go to Family/Photos",
    "Medical records, doctor charts, and lab results go to Personal/Health",
    "Mortgage, lease, home maintenance, and car titles go to Home/Property",
    "Boarding passes, hotel reservations, and passports go to Personal/Travel",
  ],
};

export function renderAiVerificationBox(v: AiVerificationResult): string {
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
        <code class="ai-verify-code"><strong>${esc(trigger)}</strong> &rarr; <span class="ai-dest-tag">${icons.folder(11)}<span>${esc(dest)}</span></span></code>
      </div>
      ${
        v.sampleTestFile
          ? `
        <div class="ai-verify-sim">
          <span class="ai-verify-sim-icon">${icons.check(12)}</span>
          <span>Verified against test file <code>${esc(v.sampleTestFile)}</code> &rarr; routes to <strong>${esc(dest)}</strong></span>
        </div>`
          : ""
      }
      <div class="ai-verify-actions">
        <button type="button" id="routing-apply-verified-btn" class="btn small primary" data-verified-rule="${esc(v.optimizedRule)}">
          ${icons.check(12)}<span>Apply &amp; Add Rule</span>
        </button>
        <button type="button" id="routing-dismiss-verified-btn" class="btn small">Dismiss</button>
      </div>
    </div>
  `;
}

/** Result of the local rule check (no AI call). */
export function renderRuleCheckBox(c: RuleCheck, canApply: boolean): string {
  const ok = c.parses && c.destination_safe && c.sample_matches && !c.shadowed_by && (!c.is_vault || c.vault_enabled);
  const existsText = c.destination_exists === null
    ? "Destination not reachable right now"
    : c.destination_exists
    ? "Destination folder exists"
    : "Destination folder will be created on first use";
  const problems = (c.problems || []).map((p) => `<li>${esc(p)}</li>`).join("");
  return `
    <div class="ai-verify-card">
      <div class="ai-verify-header">
        <div class="ai-verify-badge">${icons.check(13)}<span>Rule Check</span></div>
        <span class="ai-confidence-badge">${ok ? "Looks good" : "Needs attention"}</span>
      </div>
      <div class="ai-verify-rule-row">
        <span class="ai-verify-label">Rule:</span>
        <code class="ai-verify-code"><strong>${esc(c.trigger || c.rule)}</strong> &rarr; <span class="ai-dest-tag">${icons.folder(11)}<span>${esc(c.destination || "?")}</span></span></code>
      </div>
      <div class="ai-verify-sim">
        <span class="ai-verify-sim-icon">${c.sample_matches ? icons.check(12) : icons.alert(12)}</span>
        <span>Sample file <code>${esc(c.sample_file || "-")}</code> ${c.sample_matches ? "matches this rule" : "does not match"}${c.parses ? ` &bull; ${esc(existsText)}` : ""}${c.is_vault ? " &bull; Sends to encrypted vault (S3)" : ""}</span>
      </div>
      ${c.shadowed_by ? `<p class="field-hint" style="color: var(--warn, #f59e0b);">An earlier rule catches the sample file first: <code>${esc(c.shadowed_by)}</code>. Move this rule above it or make it more specific.</p>` : ""}
      ${problems ? `<ul class="rule-check-problems">${problems}</ul>` : ""}
      <p class="field-hint">Checked locally against your rules. No AI call, no cost.</p>
      <div class="ai-verify-actions">
        ${canApply ? `<button type="button" id="routing-apply-verified-btn" class="btn small primary" data-verified-rule="${esc(c.rule)}">${icons.check(12)}<span>Add Rule</span></button>` : ""}
        <button type="button" id="routing-dismiss-verified-btn" class="btn small">Dismiss</button>
      </div>
    </div>
  `;
}

/** Turn a raw review reason (which may contain OS errors and full paths) into one short line. */
export function friendlyReviewReason(reason: string): string {
  const r = (reason || "").trim();
  if (!r) return "Needs a decision";
  if (/^Move failed/i.test(r) || /source kept at/i.test(r)) {
    if (/permission denied|os error 13/i.test(r)) return "Copy to the destination was refused (permission denied)";
    if (/no space|os error 28/i.test(r)) return "Destination is out of space";
    if (/no such file|os error 2\b/i.test(r)) return "Destination folder went missing during the copy";
    if (/size mismatch/i.test(r)) return "Copy did not match the original, so it was not finished";
    return "Copy to the destination failed";
  }
  if (/^AI call failed/i.test(r)) return "The AI could not be reached";
  // Hide absolute paths in anything else.
  return r.replace(/\/(?:Users|Volumes)\/[^\s:]+/g, "...").slice(0, 120);
}

/** Files the router could not sort. Nothing in here has been moved to the destination. */
export function renderReviewQueueSection(items: ReviewItem[], useFolder = true, routeNames: Record<string, string> = {}): string {
  const safe = Array.isArray(items) ? items : [];
  if (safe.length === 0) return "";
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
            <div class="review-row-name" title="${esc(it.path)}">${esc(it.filename)}</div>
            <div class="review-row-why" title="${esc(it.explanation || it.reason)}">${esc(friendlyReviewReason(it.reason))}<span class="review-row-meta"> · ${esc(formatBytes(it.file_size_bytes || 0))}${esc(conf)}${esc(routeTag)}</span></div>
          </div>
        </div>
        <div class="review-row-actions">
          <label class="review-folder-wrap" title="Folder inside the destination">
            ${icons.folder(12)}
            <input type="text" class="input-field small review-folder-input" id="review-folder-${esc(it.id)}" value="${esc(it.suggested_folder || "")}" placeholder="Folder, e.g. Documents/Misc" aria-label="Move ${esc(it.filename)} to folder" />
          </label>
          <span class="review-row-buttons">
            <button class="btn tiny primary review-approve-btn" type="button" data-review-id="${esc(it.id)}">Move</button>
            <button class="btn tiny secondary nas-reveal-btn" type="button" data-reveal-nas-path="${esc(it.path)}">Reveal</button>
            <button class="btn tiny secondary review-dismiss-btn" type="button" data-review-id="${esc(it.id)}" title="Remove from list; the file stays in ${esc(where)}">Dismiss</button>
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

/** Reusable rules proposed by the AI after it placed a file no rule matched. */
export function renderRuleSuggestionsSection(items: RuleSuggestion[]): string {
  const safe = Array.isArray(items) ? items : [];
  if (safe.length === 0) return "";
  const rows = safe.slice(0, 10).map((s) => `
    <div class="rule-card suggestion-card">
      <div class="rule-card-left">
        <span class="rule-icon">${icons.sparkles(14)}</span>
        <span class="rule-trigger" title="${esc(s.rule)}">${esc(s.rule)}</span>
      </div>
      <div class="rule-card-right">
        <span class="field-hint" title="Learned from this file">from ${esc(s.example_file)}</span>
        <div class="rule-actions-inline">
          <button type="button" class="btn tiny primary suggestion-accept-btn" data-suggestion-id="${esc(s.id)}" data-suggestion-rule="${esc(s.rule)}">Add Rule</button>
          <button type="button" class="btn tiny secondary suggestion-dismiss-btn" data-suggestion-id="${esc(s.id)}">Dismiss</button>
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

export const EMPTY_AI_USAGE: AiUsageSummary = {
  totalRequests: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  byOperation: [],
  byModel: [],
  recentEntries: [],
};

export function renderAiUsageSection(usage: AiUsageSummary): string {
  const formattedCost = usage.totalCostUsd < 0.01 
    ? `$${usage.totalCostUsd.toFixed(4)} USD` 
    : `$${usage.totalCostUsd.toFixed(3)} USD`;
  const providerReported = usage.providerReportedRequests ?? 0;
  const legacyExcluded = usage.legacyExcluded ?? 0;
  const costSourceNote = usage.totalRequests > 0
    ? `${providerReported} of ${usage.totalRequests} costs reported by the provider; the rest are estimated from real token counts x published prices.`
    : "Costs come from the provider when it reports them, otherwise from real token counts x published prices.";

  const opColors: Record<string, string> = {
    rule_translation: "var(--color-accent, #3b82f6)",
    suggest_rules: "#10b981",
    file_routing: "#8b5cf6",
    verify_rule: "#f59e0b",
  };

  const byOp = Array.isArray(usage?.byOperation) ? usage.byOperation : [];
  const opBarsHtml = byOp.length > 0 
    ? `
      <div class="api-usage-distribution-bar">
        ${byOp.map((b) => {
          const color = opColors[b.operation] || "#6366f1";
          return `<div class="distribution-segment" style="width: ${Math.max(b.percentageOfTotal, 4)}%; background-color: ${color};" title="${esc(b.label)}: ${b.percentageOfTotal.toFixed(1)}% (${b.totalTokens.toLocaleString()} tokens)"></div>`;
        }).join("")}
      </div>`
    : "";

  const opCardsHtml = byOp.map((b) => {
    const color = opColors[b.operation] || "#6366f1";
    const opCost = b.estimatedCostUsd < 0.01 ? `$${b.estimatedCostUsd.toFixed(4)}` : `$${b.estimatedCostUsd.toFixed(3)}`;
    return `
      <div class="api-breakdown-row">
        <div class="api-breakdown-info">
          <div class="api-indicator-dot" style="background-color: ${color};"></div>
          <div class="api-name-col">
            <span class="api-title">${esc(b.label)}</span>
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
        <span class="model-name">${esc(m.model)}</span>
        <span class="model-tokens">${m.totalTokens.toLocaleString()} tok</span>
        <span class="model-cost">${mCost}</span>
      </div>
    `;
  }).join("");

  const recentEntries = Array.isArray(usage?.recentEntries)
    ? usage.recentEntries
    : (Array.isArray((usage as any)?.recentCalls) ? (usage as any).recentCalls : []);

  const recentRowsHtml = recentEntries.length === 0
    ? `<div class="empty-ledger-state"><p>No API activity recorded yet.</p></div>`
    : recentEntries.slice(0, 15).map((e: any) => {
        const timeAgo = relativeTime(e.timestamp);
        const baseCost = e.estimatedCostUsd < 0.01 ? `$${e.estimatedCostUsd.toFixed(4)}` : `$${e.estimatedCostUsd.toFixed(3)}`;
        const costStr = e.costSource === "provider" ? baseCost : e.costSource === "legacy" ? `${baseCost} (excluded)` : `${baseCost} est.`;
        return `
          <tr class="ledger-row">
            <td class="ledger-time" title="${new Date(e.timestamp).toLocaleString()}">${esc(timeAgo)}</td>
            <td class="ledger-op"><span class="op-badge op-${esc(e.operation)}">${esc(e.operationLabel)}</span></td>
            <td class="ledger-model"><code>${esc(e.model.split("/").pop() || e.model)}</code></td>
            <td class="ledger-tokens"><strong>${e.totalTokens.toLocaleString()}</strong> <span class="split">(${e.promptTokens}+${e.completionTokens})</span></td>
            <td class="ledger-cost">${costStr}</td>
            <td class="ledger-summary" title="${esc(e.summary)}">${esc(e.summary)}</td>
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
          <span class="metric-sub">${esc(costSourceNote)}</span>
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

export function renderNasTransfersSection(transfers: NasTransferRecord[] = []): string {
  const safeTransfers = Array.isArray(transfers) ? transfers : [];
  const rows = safeTransfers.length === 0
    ? `<tr class="ledger-row empty"><td colspan="6" class="empty-ledger-state"><p>No files moved yet. Drop files into your drop folder to start routing them to the destination folder.</p></td></tr>`
    : safeTransfers.slice(0, 20).map((t) => {
        if (!t) return "";
        const timeAgo = relativeTime(t.timestamp || Date.now());
        const sizeStr = formatBytes(t.file_size_bytes || 0);
        const statusBadge = t.status === "relocated"
          ? `<span class="badge warning">Relocated</span>`
          : t.status === "reverted"
          ? `<span class="badge danger">In Review</span>`
          : `<span class="badge ok">Moved</span>`;
        const isVault = (t.destination_folder || "").startsWith("vault:");
        const destFolder = t.destination_folder || (t.destination_path ? splitPath(t.destination_path).folder : "Backups");
        const destPath = t.destination_path || destFolder;
        const ruleMatched = t.rule_matched || "Rule Applied";
        const filename = t.filename || (t.source_path ? splitPath(t.source_path).name : "file");

        return `
          <tr class="ledger-row nas-transfer-row">
            <td class="ledger-time" title="${new Date(t.timestamp || Date.now()).toLocaleString()}">${esc(timeAgo)}</td>
            <td class="ledger-file">
              <div class="file-name-cell">
                <span class="file-icon">${fileIcon(filename)}</span>
                <span class="file-name-text" title="${esc(filename)}">${esc(filename)}</span>
                <span class="file-size-hint">${esc(sizeStr)}</span>
              </div>
            </td>
            <td class="ledger-dest">
              <span class="nas-dest-pill" title="${esc(destPath)}">${esc(destFolder)}</span>
            </td>
            <td class="ledger-rule" title="${esc(ruleMatched)}">
              <span class="rule-matched-text">${esc(ruleMatched)}</span>
            </td>
            <td class="ledger-status">${statusBadge}</td>
            <td class="ledger-actions-cell" style="text-align: right;">
              <button class="btn tiny secondary nas-reveal-btn" type="button" data-reveal-nas-path="${esc(destPath)}" title="Reveal in Finder">
                ${icons.folder(11)}<span>Reveal</span>
              </button>
              ${isVault ? "" : `<button class="btn tiny secondary nas-relocate-btn" type="button" data-relocate-id="${esc(t.id || "")}" data-relocate-file="${esc(filename)}" data-relocate-folder="${esc(destFolder)}" title="Move to another folder inside the destination">
                ${icons.arrowRight(11)}<span>Move To…</span>
              </button>`}
              <button class="btn tiny secondary nas-revert-btn" type="button" data-revert-id="${esc(t.id || "")}" data-revert-file="${esc(filename)}" title="Move file back to the _Needs Review folder">
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

// ---------------------------------------------------------------- multiple routes

const ROUTE_MODE_LABEL: Record<string, string> = {
  move: "Move",
  copy: "Copy, keep originals",
  organize: "Organize in place",
};

const ROUTE_MODE_HINT: Record<string, string> = {
  move: "Files are moved to the destination and removed from the watched folder.",
  copy: "Files are copied and the originals stay where they are (good for SD cards). Each file is copied once.",
  organize: "Files are sorted into subfolders of the watched folder itself.",
};

export const ROUTE_TOKENS = ["{year}", "{month}", "{month_name}", "{day}", "{date}", "{ext}", "{source_folder}"];

/** Home folder shortened to ~ and long paths trimmed from the left, for one-line display. */
export function shortPath(p: string, max = 44): string {
  const s = (p || "").replace(/^\/Users\/[^/]+/, "~");
  return s.length > max ? `...${s.slice(-(max - 3))}` : s;
}

/** How often automatic routes look for new files. Matches the background watcher's poll interval in commands.rs. */
export const ROUTE_CHECK_SECONDS = 15;

function routeStateChip(r: RouteStatus): string {
  const c = r.config;
  if (!c.enabled) return `<span class="route-chip off">Off</span>`;
  if (r.problems.length > 0) return `<span class="route-chip warn">Needs setup</span>`;
  if (!r.source_exists) return `<span class="route-chip muted">Waiting for source</span>`;
  if (c.mode !== "organize" && !r.destination_reachable) return `<span class="route-chip muted">Waiting for destination</span>`;
  return `<span class="route-chip ok">${c.auto ? "Automatic" : "Manual"}</span>`;
}

/** One plain sentence about when the route sorts files. */
function routeSchedule(c: RouteConfig): string {
  if (!c.enabled) return "Turned off";
  return c.auto ? `Checks for new files every ${ROUTE_CHECK_SECONDS} seconds` : "Sorts only when you click Sort now";
}

function routeCanRun(r: RouteStatus): boolean {
  const c = r.config;
  return c.enabled && r.problems.length === 0 && r.source_exists && (c.mode === "organize" || r.destination_reachable);
}

/** Automatic routes already run on their own, so their button is quieter and says so on hover. */
function routeRunButton(r: RouteStatus): string {
  const auto = r.config.enabled && r.config.auto;
  const title = auto
    ? `This route already checks every ${ROUTE_CHECK_SECONDS} seconds. Click to sort what is waiting right away.`
    : "Sort the files waiting in this route's folder now";
  return `<button class="btn tiny ${auto ? "subtle" : "secondary"} route-run-btn" type="button" data-route-run="${esc(r.config.id)}" title="${esc(title)}"${routeCanRun(r) ? "" : " disabled"}>Sort now</button>`;
}

/** One row in the routes list. The row itself opens the route; the switch and Sort now act in place. */
function routeRow(r: RouteStatus): string {
  const c = r.config;
  const id = esc(c.id);
  const dest = c.mode === "organize" ? "subfolders of the same folder" : shortPath(c.destination) || "no destination yet";
  const meta = [
    routeSchedule(c),
    `${r.pending_count} waiting`,
    `${r.review_count} in review`,
    `${c.rules.length} rule${c.rules.length === 1 ? "" : "s"}`,
    c.layout ? `layout ${c.layout}` : "",
  ].filter(Boolean).join(" · ");
  return `
    <li class="route-row${c.enabled ? "" : " disabled"}" data-route-row="${id}">
      <button type="button" class="route-row-main route-row-open" data-route-open="${id}" aria-label="Open route ${esc(c.name)}">
        <span class="route-row-title">
          <span class="route-name">${esc(c.name)}</span>
          <span class="route-mode">${esc(ROUTE_MODE_LABEL[c.mode] || c.mode)}</span>
          ${routeStateChip(r)}
        </span>
        <span class="route-row-path" title="${esc(c.source)} to ${esc(c.mode === "organize" ? c.source : c.destination)}">
          ${icons.folder(12)}<span>${esc(shortPath(c.source))}</span>${icons.arrowRight(11)}<span>${esc(dest)}</span>
        </span>
        <span class="route-row-meta">${esc(meta)}</span>
        ${r.problems.map((p) => `<span class="route-row-problem">${icons.alert(11)}<span>${esc(p)}</span></span>`).join("")}
      </button>
      <div class="route-row-actions">
        ${r.is_main
          ? ""
          : `<label class="drop-auto-label" title="${c.enabled ? "Turn this route off" : "Turn this route on"}"><input class="switch route-enable-toggle" type="checkbox" role="switch" data-route-enable="${id}"${c.enabled ? " checked" : ""} aria-label="Route ${esc(c.name)} on" /></label>`}
        ${routeRunButton(r)}
        <span class="route-row-chevron" aria-hidden="true">${icons.chevron(14)}</span>
      </div>
    </li>`;
}

/** Header for a single route's page: back to the list, the route's name, state and schedule. */
function routePageBar(title: string, status: RouteStatus | null, showRun = true): string {
  return `
    <div class="route-page-bar">
      <button id="route-back-btn" class="btn small secondary route-back-btn" type="button">${icons.back(13)}<span>All routes</span></button>
      <div class="route-page-title">
        <h2 class="route-page-name">${esc(title)}</h2>
        ${status ? `<span class="route-mode">${esc(ROUTE_MODE_LABEL[status.config.mode] || status.config.mode)}</span>${routeStateChip(status)}<span class="route-page-schedule">${esc(routeSchedule(status.config))}</span>` : ""}
      </div>
      ${status && showRun ? routeRunButton(status) : ""}
    </div>`;
}

function routeSwitch(id: string, label: string, checked: boolean, title: string, disabled = false): string {
  return `<label class="drop-auto-label${disabled ? " is-disabled" : ""}" title="${esc(title)}">
      <input id="${id}" class="switch" type="checkbox" role="switch"${checked ? " checked" : ""}${disabled ? " disabled" : ""} />
      <span>${esc(label)}</span>
    </label>`;
}

export function renderRouteEditor(editor: RouteEditorState, templates: RouteTemplate[]): string {
  const d = editor.draft;
  const organize = d.mode === "organize";
  const copy = d.mode === "copy";
  const modeOption = (m: string) => `<option value="${m}"${d.mode === m ? " selected" : ""}>${esc(ROUTE_MODE_LABEL[m]!)}</option>`;
  const templateButtons = editor.isNew
    ? `<div class="route-templates" role="group" aria-label="Start from a template">
        ${templates.map((t) => `
          <button type="button" class="route-template${d.template === t.id ? " active" : ""}" data-route-template="${esc(t.id)}">
            <strong>${esc(t.name)}</strong>
            <span>${esc(t.description)}</span>
          </button>`).join("")}
      </div>`
    : "";
  return `
    <div class="route-editor" id="route-editor">
      <div class="route-editor-title">${editor.isNew ? "New route" : "Route settings"}</div>
      ${templateButtons}
      <div class="route-form-grid">
        <label class="route-field">
          <span class="route-field-label">Name</span>
          <input id="route-name" class="input-field small" type="text" value="${esc(d.name)}" placeholder="e.g. Photography" />
        </label>
        <label class="route-field">
          <span class="route-field-label">What it does</span>
          <select id="route-mode" class="input-field small">${["move", "copy", "organize"].map(modeOption).join("")}</select>
        </label>
        <p class="field-hint route-field wide">${esc(ROUTE_MODE_HINT[d.mode] || "")}</p>
        <div class="route-field wide">
          <span class="route-field-label">Watch this folder</span>
          <div class="route-path-input">
            <input id="route-source" class="input-field small" type="text" value="${esc(d.source)}" placeholder="/Users/you/Photo Inbox or /Volumes/EOS_DIGITAL" />
            <button id="route-source-browse" class="btn small secondary" type="button">Choose...</button>
          </div>
        </div>
        ${organize ? "" : `
        <div class="route-field wide">
          <span class="route-field-label">Send files to</span>
          <div class="route-path-input">
            <input id="route-destination" class="input-field small" type="text" value="${esc(d.destination)}" placeholder="/Volumes/PhotoNAS" />
            <button id="route-destination-browse" class="btn small secondary" type="button">Choose...</button>
          </div>
        </div>`}
        <label class="route-field wide">
          <span class="route-field-label">Folder layout when no rule matches</span>
          <input id="route-layout" class="input-field small" type="text" value="${esc(d.layout || "")}" placeholder="e.g. Shoots/{year}/{date} {source_folder}" />
          <span class="field-hint">Fill-ins: ${ROUTE_TOKENS.map((t) => `<code>${esc(t)}</code>`).join(" ")}. Dates come from when a photo was taken when the file has that, otherwise from when it was last changed. <code>{source_folder}</code> is the subfolder you dropped it in, such as a client name.</span>
        </label>
        <label class="route-field wide">
          <span class="route-field-label">Rules, one per line (checked before the layout)</span>
          <textarea id="route-rules" class="input-field small route-rules-input" rows="4" placeholder="*.mov go to Video/{year}">${esc(d.rules.join("\n"))}</textarea>
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
      ${editor.error ? `<p class="route-editor-error" role="alert">${icons.alert(12)}<span>${esc(editor.error)}</span></p>` : ""}
      <div class="route-editor-actions">
        ${editor.isNew ? "" : `<button class="btn small secondary route-delete-btn" type="button" data-route-delete="${esc(d.id)}" title="Delete this route. Files are not touched.">${icons.trash(12)}<span>Delete route</span></button>`}
        <span class="route-editor-actions-spacer"></span>
        <button id="route-cancel-btn" class="btn small secondary" type="button">Cancel</button>
        <button id="route-save-btn" class="btn small primary" type="button"${editor.saving ? " disabled" : ""}>${editor.saving ? "Saving..." : "Save route"}</button>
      </div>
    </div>`;
}

/** Every route at a glance on the Smart Routing home page. Click a row to open that route. */
export function renderRoutesSection(overview: RoutesOverview | null): string {
  if (!overview || !Array.isArray(overview.routes)) return "";
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

/** Which Smart Routing page to show. Without route data (older engine), everything stays on one page. */
export function smartRoutingPage(
  overview: RoutesOverview | null,
  editor: RouteEditorState | null,
  selectedRouteId: string | null,
): "single" | "home" | "main" | "editor" {
  if (editor) return "editor";
  if (!overview || !Array.isArray(overview.routes)) return "single";
  return selectedRouteId === "main" ? "main" : "home";
}

export function renderSmartRoutingView({
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
  showRoutingLedger = false,
}: {
  aiConfig?: AiConfigResponse | null;
  rules?: string[];
  discoveredDirs?: string[];
  testResult?: RouteDecision | null;
  activeRole?: RoutingRole;
  enabledRoles?: RoutingRole[];
  roleRules?: Record<RoutingRole, string[]>;
  detectedVolume?: string | null;
  editingRuleIndex?: number | null;
  aiVerification?: AiVerificationResult | null;
  aiUsage?: AiUsageSummary | null;
  nasTransfers?: NasTransferRecord[];
  nasStagingStatus?: NasStagingStatus | null;
  rulesPage?: number;
  rulesSearch?: string;
  reviewQueue?: ReviewItem[];
  ruleSuggestions?: RuleSuggestion[];
  ruleCheck?: RuleCheck | null;
  ruleCheckCanApply?: boolean;
  routesOverview?: RoutesOverview | null;
  routeEditor?: RouteEditorState | null;
  /** "main" opens the main route's page; other routes open in the editor. */
  selectedRouteId?: string | null;
  showRoutingLedger?: boolean;
}): string {
  const routeNames: Record<string, string> = Object.fromEntries((routesOverview?.routes ?? []).map((r) => [r.config.id, r.config.name]));
  const page = smartRoutingPage(routesOverview, routeEditor, selectedRouteId);
  const statusFor = (id: string) => routesOverview?.routes.find((r) => r.config.id === id) ?? null;
  // Files from the main route, or from a route that no longer exists, belong on the main page.
  const belongsToMain = (routeId?: string | null) => !routeId || routeId === "main" || !(routeId in routeNames);
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
  const safeEnabledRoles = Array.isArray(enabledRoles) ? enabledRoles : ["webdev" as RoutingRole];
  const safeActiveRole = (activeRole && ROUTING_ROLES.some((r) => r.id === activeRole)) ? activeRole : ("webdev" as RoutingRole);
  const currentRole = ROUTING_ROLES.find((r) => r.id === safeActiveRole) || ROUTING_ROLES[0]!;
  const isCurrentRoleEnabled = safeEnabledRoles.includes(safeActiveRole);
  const safeRoleRules: Record<string, unknown[]> = (roleRules && typeof roleRules === "object") ? (roleRules as any) : DEFAULT_ROLE_RULES;

  const rawRoleRules = safeRoleRules[safeActiveRole] || DEFAULT_ROLE_RULES[safeActiveRole] || [];
  const rawList = (rules && rules.length > 0 && rawRoleRules === DEFAULT_ROLE_RULES[safeActiveRole])
    ? rules
    : rawRoleRules;

  const currentRoleRules: string[] = (Array.isArray(rawList) ? rawList : []).map((item: unknown) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      if ("rule" in item) return String((item as any).rule);
      if ("text" in item) return String((item as any).text);
      if ("name" in item) return String((item as any).name);
    }
    return String(item ?? "");
  }).filter((s) => s.trim().length > 0);

  const totalActiveRulesCount = safeEnabledRoles.reduce((acc, r) => {
    const list = safeRoleRules[r] || DEFAULT_ROLE_RULES[r] || [];
    return acc + (Array.isArray(list) ? list.length : 0);
  }, 0);

  const searchTrim = (rulesSearch || "").trim().toLowerCase();
  const indexedRules = currentRoleRules.map((r, originalIdx) => ({ r, originalIdx }));
  const filteredRules = searchTrim
    ? indexedRules.filter(({ r }) => r.toLowerCase().includes(searchTrim))
    : indexedRules;

  const totalMatchingRules = filteredRules.length;
  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(totalMatchingRules / pageSize));
  const currentPage = Math.min(Math.max(1, rulesPage), totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const pageRules = filteredRules.slice(startIndex, startIndex + pageSize);

  const rulesHtml =
    totalMatchingRules === 0
      ? `<div class="rules-empty-state">
           <p>${searchTrim ? `No rules match "${esc(searchTrim)}".` : `No rules created yet for ${esc(currentRole.title)}. Scan your storage or add rules below.`}</p>
         </div>`
      : pageRules
          .map(({ r, originalIdx }) => {
            if (editingRuleIndex === originalIdx) {
              return `
                <div class="rule-card editing" data-rule-idx="${originalIdx}">
                  <div class="rule-edit-form">
                    <input type="text" class="rule-edit-input" id="rule-edit-input-${originalIdx}" value="${esc(r)}" placeholder="e.g. *.tar.gz go to Backups" />
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
                  <span class="rule-trigger" title="${esc(trigger)}">${esc(trigger)}</span>
                </div>
                <div class="rule-arrow">→</div>
                <div class="rule-card-right">
                  <span class="rule-dest-badge" title="${esc(dest)}">${icons.folder(12)}<span>${esc(dest)}</span></span>
                  <div class="rule-actions-inline">
                    <button type="button" class="rule-ai-verify-btn" data-verify-idx="${originalIdx}" title="Check rule locally (no AI call)">${icons.check(12)}<span>Verify</span></button>
                    <button type="button" class="rule-edit-btn" data-edit-idx="${originalIdx}" title="Edit rule text">${icons.gear(12)}<span>Edit</span></button>
                    <button type="button" class="rule-del-btn" data-del-rule="${originalIdx}" title="Delete rule">×</button>
                  </div>
                </div>
              </div>`;
          })
          .join("");

  if (page === "editor" && routeEditor) {
    const status = editingId ? statusFor(editingId) : null;
    return `
    <div class="smart-routing-view" data-routing-page="editor">
      ${routePageBar(routeEditor.isNew ? "New route" : status?.config.name || routeEditor.draft.name || "Route", status)}
      ${renderRouteEditor(routeEditor, Array.isArray(routesOverview?.templates) ? routesOverview!.templates : [])}
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
            <span class="quick-cost-sub">Provider: <strong>${currentProvider === "xai" ? "xAI Grok" : "OpenRouter"}</strong> &bull; Model: <strong>${esc(aiConfig?.model || (currentProvider === "xai" ? "grok-4.20-non-reasoning" : "google/gemini-2.5-flash-lite"))}</strong></span>
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
        ${page === "home"
          ? `<button id="routing-jump-ledger-btn" type="button" class="btn small subtle" aria-expanded="${showRoutingLedger ? "true" : "false"}" title="Show the full cost breakdown">
          <span>${showRoutingLedger ? "Hide Ledger" : "Full Ledger"}</span>
        </button>`
          : `<button id="routing-jump-ledger-btn" type="button" class="btn small subtle" title="Jump to full breakdown ledger">
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
                  <span class="role-card-badge">${esc(r.badge)}</span>
                </div>
                <div class="role-card-toggle" title="${isEnabled ? "Turn off " + esc(r.title) : "Turn on " + esc(r.title)}">
                  <label class="toggle-switch small" onclick="event.stopPropagation()">
                    <input type="checkbox" class="role-toggle-checkbox" data-role-toggle="${r.id}" ${isEnabled ? "checked" : ""}>
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div class="role-card-title">${esc(r.title)}</div>
              <div class="role-card-desc">${esc(r.tagline)}</div>
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
      ${
        detectedVolume && detectedVolume !== smbTarget
          ? `
        <div class="detected-drive-banner">
          <div class="detected-drive-left">
            <span class="detected-icon">${icons.box(16)}</span>
            <span class="detected-text">Detected Hosting Volume: <strong>${esc(detectedVolume)}</strong></span>
          </div>
          <button id="routing-use-detected-btn" class="btn small primary" type="button" data-drive-path="${esc(detectedVolume)}">Set as Destination</button>
        </div>`
          : ""
      }

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
            <div class="source-path" title="${esc(smbTarget)}">${icons.folder(13)}<span>${esc(smbTarget || "Choose a destination folder")}</span></div>
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
                ${(nasStagingStatus?.pending_count ?? 0) > 0 ? `${nasStagingStatus!.pending_count} waiting` : "Ready"}
              </span>
            </div>
            <div class="staging-path" title="${esc(aiConfig?.nas_ingest_folder || "~/RenegadeBox/To NAS")}">
              <code>${esc(aiConfig?.nas_ingest_folder || "~/RenegadeBox/To NAS")}</code>
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
          ${organizeMode
            ? `Files dropped here are sorted into subfolders <strong>inside this drop folder</strong> and stay on this Mac. Nothing is moved to the destination folder.`
            : `Files dropped here are sorted and <strong>moved to ${esc(smbTarget || "the destination folder")}</strong>. If it is not reachable, files wait here until it is.`}
          Rules are checked first. The AI is only asked when no rule matches. Anything it is unsure about (below 70% confidence), or that fails to move, ${aiConfig?.use_review_folder ?? true ? "goes to <code>_Needs Review</code>" : "stays in the drop folder"} and is listed below for you to decide. Files are never sent to S3 unless you write a <code>vault:</code> rule and turn on vault routing.
        </span>
      </div>
      ${!organizeMode && smbTarget && nasStagingStatus && !nasStagingStatus.nas_accessible ? `<div class="staging-hint-bar" style="border-color: var(--warn, #f59e0b);"><span class="staging-hint-text"><strong>Destination not reachable:</strong> ${esc(smbTarget)} is not mounted. Dropped files will wait in the drop folder until it is.</span></div>` : ""}
      ${!organizeMode && !smbTarget ? `<div class="staging-hint-bar" style="border-color: var(--warn, #f59e0b);"><span class="staging-hint-text"><strong>No destination folder set.</strong> Choose one above, or switch to "Keep in drop folder".</span></div>` : ""}
      ${aiConfig?.ingest_warning ? `<div class="staging-hint-bar" style="border-color: var(--warn, #f59e0b);"><span class="staging-hint-text"><strong>Warning:</strong> ${esc(aiConfig.ingest_warning)}</span></div>` : ""}

      ${renderReviewQueueSection(mainReview, aiConfig?.use_review_folder ?? true, routeNames)}
      ${renderRuleSuggestionsSection(Array.isArray(ruleSuggestions) ? ruleSuggestions : [])}

      ${
        discoveredDirs.length > 0
          ? `
        <div class="discovered-folders-bar">
          <span class="folders-label">${discoveredDirs.length} Folders Discovered:</span>
          <div class="folder-chips">
            ${discoveredDirs
              .slice(0, 6)
              .map((d) => `<span class="folder-chip">${icons.folder(11)}<span>${esc(d)}</span></span>`)
              .join("")}
            ${discoveredDirs.length > 6 ? `<span class="folder-chip more">+${discoveredDirs.length - 6} more</span>` : ""}
          </div>
        </div>`
          : ""
      }

      <!-- 2. AI Rule Generator & Role Rules Management -->
      <section class="routing-section routing-explainer-card">
        <div class="section-header">
          <div class="section-title-wrap">
            <span class="section-icon sparkles">${icons.sparkles(16)}</span>
            <span class="section-title">Explain Your Organization</span>
            <span class="role-active-pill">${currentRole.icon(13)}<span>${esc(currentRole.title)}</span></span>
            <span class="role-state-pill ${isCurrentRoleEnabled ? "on" : "off"}">
              ${isCurrentRoleEnabled ? `${icons.check(11)} Active` : "Turned Off"}
            </span>
          </div>
          <div class="rules-header-actions">
            <button id="routing-reset-role-btn" class="btn small" type="button" title="Reset ${esc(currentRole.title)} to default rules">Reset Defaults</button>
            <button id="routing-save-rules-btn" class="btn small primary" type="button">Save Rules</button>
          </div>
        </div>

        <div class="explainer-input-wrap">
          <div class="composer-prompt-row">
            <span class="field-hint">Add or edit rules for <strong>${esc(currentRole.title)}</strong>. Type in plain English, then optimize and verify with AI:</span>
          </div>
          <div class="composer-inputs-group">
            <textarea id="routing-explainer-input" rows="2" placeholder="${esc(currentRole.placeholder)}"></textarea>
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
              ${currentRole.chips
                .map((c) => `<button type="button" class="preset-chip" data-preset="${esc(c.preset)}">${esc(c.label)}</button>`)
                .join("")}
            </div>
            <div class="explainer-btns">
              <button id="routing-load-all-role-btn" class="btn" type="button" title="Load all preset rules for this role">Load All ${esc(currentRole.badge)}</button>
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
            <input type="search" id="rules-search-input" class="input-field small" placeholder="Filter rules by pattern, keyword, or destination..." value="${esc(rulesSearch || "")}" />
            ${currentRoleRules.length > 25 || currentRoleRules.some((r) => r.toLowerCase().startsWith("files matching ")) ? `<button type="button" id="rules-prune-bloat-btn" class="btn small subtle" title="Remove auto-generated 'files matching' and 'go to Unsorted' rules from all roles (undoable)">Prune Repetitive Rules</button>` : ""}
            ${rulesBackupCount > 0 ? `<button type="button" id="rules-undo-btn" class="btn small subtle" title="Restore the rules as they were before the last change (${rulesBackupCount} snapshot${rulesBackupCount === 1 ? "" : "s"} saved)">Undo Last Rules Change</button>` : ""}
          </div>

          <div class="rules-deck-list">
            ${rulesHtml}
          </div>

          ${
            totalPages > 1
              ? `
          <div class="rules-pagination-bar">
            <span class="pagination-info">Showing <strong>${startIndex + 1}–${Math.min(startIndex + pageRules.length, totalMatchingRules)}</strong> of <strong>${totalMatchingRules.toLocaleString()}</strong> rules${searchTrim ? ` (filtered from ${currentRoleRules.length.toLocaleString()})` : ""}</span>
            <div class="pagination-buttons">
              <button type="button" class="btn small rules-page-prev" ${currentPage <= 1 ? "disabled" : ""} data-target-page="${currentPage - 1}">← Previous</button>
              <span class="pagination-page-indicator">Page ${currentPage} of ${totalPages}</span>
              <button type="button" class="btn small rules-page-next" ${currentPage >= totalPages ? "disabled" : ""} data-target-page="${currentPage + 1}">Next →</button>
            </div>
          </div>`
              : ""
          }

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

              <label class="field" id="routing-openrouter-key-field"${currentProvider === "xai" ? " style=\"display:none;\"" : ""}>
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

              <label class="field" id="routing-grok-key-field"${currentProvider === "openrouter" ? " style=\"display:none;\"" : ""}>
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
                <span class="field-hint">Lets rules like <code>Family photos go to vault:Family Photos</code> move files into your encrypted vault folder${aiConfig?.vault_folder ? ` (<code>${esc(aiConfig.vault_folder)}</code>)` : ""}, which syncs to S3. Only your rules can do this; the AI never chooses the vault.</span>
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

/** Models offered for each provider: [id, label]. The first is the default. */
export const AI_MODELS: Record<"xai" | "openrouter", readonly (readonly [string, string])[]> = {
  xai: [
    ["grok-4.20-non-reasoning", "Grok 4.20 (recommended, $1.25 in / $2.50 out per 1M)"],
    ["grok-4.3", "Grok 4.3 ($1.25 / $2.50 per 1M)"],
    ["grok-build-0.1", "Grok Build 0.1 ($1 / $2 per 1M)"],
  ],
  openrouter: [
    ["google/gemini-2.5-flash-lite", "Google Gemini 2.5 Flash Lite ($0.10 / $0.40 per 1M)"],
    ["openai/gpt-4o-mini", "OpenAI GPT-4o Mini ($0.15 / $0.60 per 1M)"],
    ["google/gemini-3.1-flash-lite", "Google Gemini 3.1 Flash Lite ($0.25 / $1.50 per 1M)"],
    ["anthropic/claude-haiku-4.5", "Anthropic Claude Haiku 4.5 ($1 / $5 per 1M)"],
  ],
};

export function modelOptionsHtml(provider: string, selected?: string | null): string {
  const list = AI_MODELS[provider === "openrouter" ? "openrouter" : "xai"];
  const pick = list.some(([id]) => id === selected) ? selected : list[0]![0];
  return list.map(([id, label]) => `<option value="${esc(id)}"${id === pick ? " selected" : ""}>${esc(label)}</option>`).join("");
}

/** "signin" (a new Mac) opens on Sign in; "wizard" (reconnecting a Mac already set up) opens on the storage steps. */
export type SetupMode = "signin" | "wizard";

export function renderSetup(mode: SetupMode = "signin"): string {
  const signin = mode === "signin";
  const presets = PROVIDERS.map(
    (p) => `<button class="preset" type="button" data-provider="${p.id}" aria-pressed="false">${esc(p.label)}</button>`,
  ).join("");

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

export type DesktopTab = "files" | "conflicts" | "routing" | "settings";

export interface DesktopAppModel {
  activeTab: DesktopTab;
  overview: Overview;
  recent: RecentFile[];
  conflicts: ConflictItem[];
  settings: SettingsModel;
  theme: "system" | "light" | "dark";
  searchQuery?: string;
  activeCategory?: FileCategory;
  now: number;
  aiConfig?: AiConfigResponse | null;
  smartRules?: string[];
  discoveredDirs?: string[];
  routingTestResult?: RouteDecision | null;
  activeRole?: RoutingRole;
  enabledRoles?: RoutingRole[];
  roleRules?: Record<RoutingRole, string[]>;
  detectedVolume?: string | null;
  editingRuleIndex?: number | null;
  aiVerification?: AiVerificationResult | null;
  aiUsage?: AiUsageSummary | null;
  nasTransfers?: NasTransferRecord[];
  nasStagingStatus?: NasStagingStatus | null;
  rulesPage?: number;
  rulesSearch?: string;
  reviewQueue?: ReviewItem[];
  ruleSuggestions?: RuleSuggestion[];
  ruleCheck?: RuleCheck | null;
  ruleCheckCanApply?: boolean;
  routesOverview?: RoutesOverview | null;
  routeEditor?: RouteEditorState | null;
  selectedRouteId?: string | null;
  showRoutingLedger?: boolean;
  /** Settings sub-tab on screen. Kept in app state so background refreshes don't jump back to General. */
  settingsTab?: SettingsTab;
}

export type SettingsTab = "general" | "account" | "storage" | "security" | "ignored";
export const SETTINGS_TABS: readonly SettingsTab[] = ["general", "account", "storage", "security", "ignored"];

export function renderDesktopApp({
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
  settingsTab = "general",
}: DesktopAppModel): string {
  const st = describeStatus(overview);
  const pauseLabel = overview.paused ? "Resume" : "Pause";
  const totalBytes = settings.status.total_bytes ?? 0;
  const totalSize = totalBytes ? ` · ${formatBytes(totalBytes)}` : "";
  const filesCount = settings.status.total_files ? `${settings.status.total_files} files${totalSize}` : "No files synced yet";

  // Visual storage meter percentage (5% min, logarithmic up to 100% based on file activity)
  const storageMeterWidth = totalBytes > 0 ? Math.min(100, Math.max(12, Math.round(Math.min(100, (totalBytes / (50 * 1024 * 1024)) * 100)))) : 6;

  const statusClass = `status-${st.kind}`;

  const navItems: { id: DesktopTab; label: string; icon: string; shortcut: string; count?: number; isDanger?: boolean }[] = [
    { id: "files", label: "Recent Files", icon: icons.doc(16), shortcut: "⌘1", count: recent.length > 0 ? recent.length : undefined },
    { id: "conflicts", label: "Activity & Conflicts", icon: icons.sync(16), shortcut: "⌘2", count: conflicts.length > 0 ? conflicts.length : undefined, isDanger: conflicts.length > 0 },
    { id: "routing", label: "Smart Routing", icon: icons.sparkles(16), shortcut: "⌘3" },
    { id: "settings", label: "Settings", icon: icons.gear(16), shortcut: "⌘4" },
  ];

  const navHtml = navItems
    .map(
      (item) => `
    <button class="sidebar-nav-item${activeTab === item.id ? " active" : ""}" type="button" data-desktop-tab="${item.id}" id="nav-tab-${item.id}">
      <span class="sidebar-nav-content">
        ${item.icon}
        <span>${esc(item.label)}</span>
      </span>
      <span class="sidebar-nav-trailing">
        ${item.count !== undefined ? `<span class="sidebar-badge${item.isDanger ? " danger" : ""}">${item.count}</span>` : ""}
        <kbd class="sidebar-kbd">${item.shortcut}</kbd>
      </span>
    </button>`,
    )
    .join("");

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
      const filtered = recent
        .map((f, origIndex) => ({ f, origIndex }))
        .filter(({ f }) => {
          if (currentCat !== "all" && categorizeFile(f.name) !== currentCat) return false;
          if (q) {
            const nameMatch = f.name.toLowerCase().includes(q);
            const folderMatch = f.folder ? f.folder.toLowerCase().includes(q) : false;
            if (!nameMatch && !folderMatch) return false;
          }
          return true;
        });

      if (filtered.length === 0) {
        body = `
          <div class="empty">
            <p>No files match "${esc(searchQuery || currentCat)}".</p>
            <button id="clear-search-btn" class="btn" type="button">Reset filters</button>
          </div>`;
      } else {
        const rows = filtered
          .map(({ f, origIndex }) => {
            const where = f.folder ? f.folder.split("/").pop()! : "RenegadeBox";
            return `
            <tr class="file-table-row" data-index="${origIndex}" data-path="${esc(f.path)}" title="Double-click to open">
              <td>
                <div class="file-name-cell">
                  <span class="file-status-glyph" title="Up to date">${icons.check(13)}</span>
                  <span class="file-icon">${fileIcon(f.name)}</span>
                  <span class="file-name-text" title="${esc(f.name)}">${esc(f.name)}</span>
                </div>
              </td>
              <td><span class="file-meta-folder">${esc(where)}</span></td>
              <td><span class="file-meta-time">${esc(relativeTime(f.modified_ms, now))}</span></td>
              <td>
                <div class="file-actions-cell">
                  <button class="btn icon-only-btn" type="button" data-action="copy-path" data-index="${origIndex}" title="Copy path to clipboard">${icons.copy(13)}</button>
                  <button class="btn" type="button" data-action="open" data-index="${origIndex}">Open</button>
                  <button class="btn" type="button" data-action="reveal" data-index="${origIndex}">Show in Finder</button>
                </div>
              </td>
            </tr>`;
          })
          .join("");

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
          <input id="file-search-input" type="text" placeholder="Search recent files (⌘F)…" value="${esc(searchQuery)}" autocomplete="off" spellcheck="false" />
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
      const rows = conflicts
        .map((c, i) => {
          const who = c.device ? esc(c.device) : "Another device";
          const where = c.folder ? ` in ${esc(c.folder.split("/").pop()!)}` : "";
          const other = c.device ? `Use ${esc(c.device)}’s version` : "Use the other version";
          return `
          <li class="conflict" data-index="${i}">
            <div class="conflict-head">
              <span class="file-icon">${fileIcon(c.original_name)}</span>
              <span class="recent-text">
                <span class="recent-name">${esc(c.original_name)}</span>
                <span class="recent-meta">${who} saved a different version${where} · ${esc(relativeTime(c.modified_ms, now))}</span>
              </span>
            </div>
            <div class="conflict-actions">
              <button class="btn primary" type="button" data-index="${i}" data-resolution="keep_both" title="Keep both files side by side">Keep both</button>
              <button class="btn" type="button" data-index="${i}" data-resolution="keep_conflicted">${other}</button>
              <button class="btn" type="button" data-index="${i}" data-resolution="keep_local">Keep current</button>
            </div>
          </li>`;
        })
        .join("");

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
          showRoutingLedger,
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
              <div class="storage-status ${statusClass}" title="${esc(st.title)}${st.detail ? ` - ${esc(st.detail)}` : ""}">
                <span class="dot"></span>
                <span class="storage-status-text">${esc(st.title)}</span>
              </div>
              <span class="storage-provider-pill">${esc(providerLabel(settings.status.endpoint))}</span>
            </div>
            <div class="storage-card-val" title="${esc(filesCount)}">${esc(filesCount)}</div>
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


/** Shown when the window's first load fails. Never fills in made-up storage details. */
export function renderDesktopLoadError(message: string): string {
  return `
    <main class="settings desktop-load-error">
      <div class="empty" role="alert">
        <p><strong>RenegadeBox couldn't load your settings.</strong></p>
        <p>${esc(message)}</p>
        <button id="desktop-retry-btn" class="btn primary" type="button">Retry</button>
      </div>
    </main>`;
}
