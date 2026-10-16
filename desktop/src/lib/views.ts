// Pure HTML renderers for each screen. No DOM access here, so they can be tested with bun.
import { escapeHtml as esc, relativeTime, formatBytes } from "./format";
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

export function renderSettings({ status, autostart, ignored }: SettingsModel): string {
  const kind = keyStoreKind(status.key_store);
  const row = (label: string, value: string) => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-value">${value}</span></div>`;
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
          <button class="tab-btn" data-tab="ai" role="tab" type="button">${icons.sparkles(16)}<span>AI & NAS</span></button>
        </nav>
      </header>

      <div id="tab-panel-general" class="tab-panel active" data-panel="general">
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
          <textarea id="ignored-input" rows="6" spellcheck="false">${esc(ignored.join("\n"))}</textarea>
          <div class="group-actions">
            <button id="ignored-save" class="btn" type="button">Save</button>
            <span id="ignored-message" class="inline-message" role="status"></span>
          </div>
        </section>
      </div>

      <div id="tab-panel-ai" class="tab-panel" data-panel="ai">
        <section class="group">
          <h2 class="group-title">Smart Synology & SMB Routing</h2>
          <p class="field-hint">Automatically analyze incoming files with OpenRouter AI and file them into the right folders on your Synology NAS.</p>

          <label class="switch-row" style="margin-top:12px;">
            <span>
              <span class="field-label">Enable smart file routing</span>
              <span class="field-hint">Use AI to route files into your Synology NAS directory tree.</span>
            </span>
            <input id="ai-enabled-toggle" class="switch" type="checkbox" role="switch" />
          </label>

          <label class="field" style="margin-top:14px;">
            <span class="field-label">Synology / SMB target folder</span>
            <span class="field-row">
              <input id="ai-smb-target-input" type="text" placeholder="/Volumes/Synology/Files" spellcheck="false" />
              <button id="ai-scan-btn" class="btn" type="button">Scan Folders</button>
            </span>
            <span class="field-hint">The mounted SMB share path on this Mac (e.g. /Volumes/home or /Volumes/data).</span>
            <span id="ai-scan-results" class="inline-message" style="display:block; margin-top:4px;"></span>
          </label>

          <label class="field" style="margin-top:14px;">
            <span class="field-label">OpenRouter API Key</span>
            <span class="field-row">
              <input id="ai-api-key-input" type="password" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false" />
            </span>
            <span class="field-hint">Stored securely in your macOS Keychain. Used to query OpenRouter models.</span>
            <span id="ai-key-status" class="inline-message"></span>
          </label>

          <label class="field" style="margin-top:14px;">
            <span class="field-label">AI Model</span>
            <select id="ai-model-select" class="select" style="width:100%; padding:6px 10px; border-radius:6px; border:1px solid var(--border); background:var(--bg); color:var(--text);">
              <option value="google/gemini-2.0-flash-001">Google Gemini 2.0 Flash (Fastest, lowest cost)</option>
              <option value="anthropic/claude-3.5-haiku">Anthropic Claude 3.5 Haiku (High accuracy)</option>
              <option value="openai/gpt-4o-mini">OpenAI GPT-4o Mini</option>
            </select>
          </label>

          <label class="field" style="margin-top:14px;">
            <span class="field-label">Your NAS organization rules</span>
            <textarea id="ai-rules-input" rows="4" spellcheck="false" placeholder="Describe where files belong, e.g.:&#10;Invoices and receipts go to Finance/Invoices&#10;Tax documents (W-2, 1099) go to Finance/Taxes&#10;Photos and family media go to Media/Photos&#10;Contracts and proposals go to Work/Contracts"></textarea>
            <span class="field-hint">Plain English instructions. The AI maps each file's content and name to these rules and your NAS directories.</span>
          </label>

          <label class="switch-row" style="margin-top:14px;">
            <span>
              <span class="field-label">Move files automatically</span>
              <span class="field-hint">When off, files stay in your inbox and RenegadeBox only suggests destination folders.</span>
            </span>
            <input id="ai-auto-route-toggle" class="switch" type="checkbox" role="switch" />
          </label>

          <div class="group-actions" style="margin-top:16px;">
            <button id="ai-save-btn" class="btn primary" type="button">Save AI Settings</button>
            <button id="ai-test-btn" class="btn" type="button">Test Routing</button>
            <span id="ai-save-message" class="inline-message" role="status"></span>
          </div>
          <div id="ai-test-result" class="confirm" hidden style="margin-top:12px; background:var(--bg-subtle, rgba(0,0,0,0.04)); padding:10px; border-radius:6px; font-size:12px; line-height:1.5;">
            <div id="ai-test-output"></div>
          </div>
        </section>
      </div>

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
