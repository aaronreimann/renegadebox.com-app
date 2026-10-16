// Pure HTML renderers for each screen. No DOM access here, so they can be tested with bun.
import { escapeHtml as esc, relativeTime } from "./format";
import { fileIcon, icons } from "./icons";
import { describeStatus, type Overview, type StatusKind } from "./status";
import { keyStoreKind } from "./actions";
import { PROVIDERS, MIN_PASSPHRASE, providerLabel } from "./setup";
import type { ConflictItem, RecentFile, VaultStatus } from "./types";

const STATUS_ICON: Record<StatusKind, () => string> = {
  ok: () => icons.check(20),
  syncing: () => icons.sync(20),
  paused: () => icons.pause(20),
  attention: () => icons.alert(20),
  error: () => icons.offline(20),
  setup: () => icons.box(20),
};

export interface PopoverModel {
  overview: Overview;
  recent: RecentFile[];
  now: number;
}

export function renderPopover({ overview, recent, now }: PopoverModel): string {
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

  let body: string;
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
      <header class="popover-header">${status}</header>
      <div class="popover-body">
        ${overview.initialized ? `<h2 class="section-label">Recent</h2>` : ""}
        ${body}
      </div>
      <footer class="popover-footer">
        <button id="open-folder-btn" class="footer-btn" type="button"${overview.initialized ? "" : " disabled"}>${icons.folder()}<span>Open folder</span></button>
        <button id="pause-btn" class="footer-btn" type="button" aria-pressed="${overview.paused}"${overview.initialized ? "" : " disabled"}>${overview.paused ? icons.play() : icons.pause()}<span>${pauseLabel}</span></button>
        <button id="settings-btn" class="footer-btn icon-only" type="button" title="Settings" aria-label="Settings">${icons.gear(18)}</button>
      </footer>
    </section>`;
}

function recentRow(f: RecentFile, i: number, now: number): string {
  const where = f.folder ? f.folder.split("/").pop()! : "RenegadeBox";
  return `
    <li class="recent-row" data-index="${i}">
      <button class="recent-open" type="button" data-action="open" data-index="${i}" title="Open ${esc(f.name)}">
        <span class="file-icon">${fileIcon(f.name)}</span>
        <span class="recent-text">
          <span class="recent-name">${esc(f.name)}</span>
          <span class="recent-meta">${esc(where)} · ${esc(relativeTime(f.modified_ms, now))}</span>
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
}

export function renderSettings({ status, autostart, ignored }: SettingsModel): string {
  const kind = keyStoreKind(status.key_store);
  const row = (label: string, value: string) => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-value">${value}</span></div>`;
  return `
    <main class="settings">
      <h1 class="window-title">Settings</h1>

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
        ${row("Folder", esc(status.folder ?? "Not set up"))}
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
        ${row("Provider", esc(providerLabel(status.endpoint)))}
        ${row("Bucket", esc(status.bucket ?? "—"))}
        ${row("Region", esc(status.region ?? "—"))}
        <div class="group-actions">
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
        <textarea id="ignored-input" rows="5" spellcheck="false">${esc(ignored.join("\n"))}</textarea>
        <div class="group-actions">
          <button id="ignored-save" class="btn" type="button">Save</button>
          <span id="ignored-message" class="inline-message" role="status"></span>
        </div>
      </section>

      <footer class="settings-footer">
        <button id="quit-btn" class="btn" type="button">Quit RenegadeBox</button>
      </footer>
    </main>`;
}

export function renderSetup(): string {
  const presets = PROVIDERS.map(
    (p) => `<button class="preset" type="button" data-provider="${p.id}" aria-pressed="false">${esc(p.label)}</button>`,
  ).join("");

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
