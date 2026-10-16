// Pure HTML renderers for each screen. No DOM access here, so they can be tested with bun.
import { escapeHtml as esc, relativeTime, formatBytes } from "./format";
import { fileIcon, icons, categorizeFile, type FileCategory } from "./icons";
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
  notifyConflicts?: boolean;
  notifySync?: boolean;
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

export function renderSettings(
  { status, autostart, ignored, notifyConflicts = true, notifySync = false }: SettingsModel,
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
          <button class="tab-btn${isTab("storage") ? " active" : ""}" data-tab="storage" role="tab" type="button">${icons.box(16)}<span>Storage</span></button>
          <button class="tab-btn${isTab("security") ? " active" : ""}" data-tab="security" role="tab" type="button">${icons.lock(16)}<span>Security</span></button>
          <button class="tab-btn${isTab("ignored") ? " active" : ""}" data-tab="ignored" role="tab" type="button">${icons.doc(16)}<span>Ignored</span></button>
          <button class="tab-btn${isTab("ai") ? " active" : ""}" data-tab="ai" role="tab" type="button">${icons.sparkles(16)}<span>Smart Routing</span></button>
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
          <div class="field" style="margin-top: 14px;">
            <span class="field-label">Notifications</span>
            <span class="field-hint">Control system alerts for sync activity and file conflicts.</span>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
              <label class="switch-row compact">
                <span>
                  <span class="field-label" style="font-size:12px;">Alert on file conflicts</span>
                  <span class="field-hint">Show a desktop notification when concurrent edits conflict.</span>
                </span>
                <input id="notify-conflicts-toggle" class="switch" type="checkbox" role="switch"${notifyConflicts !== false ? " checked" : ""} />
              </label>
              <label class="switch-row compact">
                <span>
                  <span class="field-label" style="font-size:12px;">Alert on sync completion</span>
                  <span class="field-hint">Show a notification when large sync batches finish.</span>
                </span>
                <input id="notify-sync-toggle" class="switch" type="checkbox" role="switch"${notifySync ? " checked" : ""} />
              </label>
            </div>
          </div>
        </section>
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

      <div id="tab-panel-ai" class="tab-panel${isTab("ai") ? " active" : ""}" data-panel="ai">
        <!-- Master Feature Card -->
        <div class="feature-hero-card">
          <div class="feature-hero-content">
            <div class="feature-hero-icon">${icons.sparkles(20)}</div>
            <div class="feature-hero-text">
              <div class="feature-hero-title-row">
                <span class="feature-hero-title">Smart Synology & SMB Routing</span>
                <span id="ai-status-pill" class="status-pill idle">Off</span>
              </div>
              <p class="feature-hero-desc">Analyze incoming files with OpenRouter AI and automatically organize them into your Synology NAS folders.</p>
            </div>
          </div>
          <div class="feature-hero-action">
            <input id="ai-enabled-toggle" class="switch" type="checkbox" role="switch" />
          </div>
        </div>

        <!-- Detailed configuration: revealed only when enabled -->
        <div id="ai-config-details" class="settings-subsections" hidden>
          <!-- Card 1: Storage Destination -->
          <section class="settings-card">
            <div class="card-header">
              <h3 class="card-title">${icons.folder(15)}<span>Synology NAS Destination</span></h3>
            </div>
            <div class="card-body">
              <p class="field-hint">The mounted SMB share on this Mac where organized files are saved.</p>
              
              <div class="destination-picker-row">
                <div class="destination-display">
                  <span class="folder-glyph">${icons.folder(16)}</span>
                  <input id="ai-smb-target-input" type="text" placeholder="/Volumes/home or /Volumes/data" spellcheck="false" />
                </div>
                <div class="destination-actions">
                  <button id="ai-choose-folder-btn" class="btn" type="button">Choose…</button>
                  <button id="ai-scan-btn" class="btn" type="button" title="Index NAS folders for AI routing">Scan</button>
                </div>
              </div>

              <div id="ai-volume-picker-container" class="volume-quick-select" hidden>
                <span>Quick select:</span>
                <select id="ai-volume-select" class="select-inline"></select>
              </div>

              <div id="ai-scan-results" class="scan-summary-badge" role="status"></div>
            </div>
          </section>

          <!-- Card 2: AI Intelligence & OpenRouter -->
          <section class="settings-card">
            <div class="card-header">
              <h3 class="card-title">${icons.sparkles(15)}<span>AI Intelligence (OpenRouter)</span></h3>
            </div>
            <div class="card-body">
              <div class="form-grid">
                <label class="field" style="margin-bottom:0;">
                  <span class="field-label">AI Model</span>
                  <select id="ai-model-select" class="select-field">
                    <option value="google/gemini-2.0-flash-001">Google Gemini 2.0 Flash (Fastest, low cost)</option>
                    <option value="anthropic/claude-3.5-haiku">Anthropic Claude 3.5 Haiku (High accuracy)</option>
                    <option value="openai/gpt-4o-mini">OpenAI GPT-4o Mini</option>
                  </select>
                  <span class="field-hint">Used to evaluate lightweight file snippets (<2KB) and match rules.</span>
                </label>

                <label class="field" style="margin-bottom:0;">
                  <div class="label-with-badge">
                    <span class="field-label">OpenRouter API Key</span>
                    <span id="ai-key-status" class="keychain-badge">Not configured</span>
                  </div>
                  <div class="password-field-wrapper">
                    <input id="ai-api-key-input" type="password" placeholder="sk-or-v1-..." autocomplete="off" spellcheck="false" />
                    <button id="ai-key-toggle-btn" class="icon-btn-inline" type="button">Show</button>
                  </div>
                  <span class="field-hint">Protected by macOS Keychain. Never stored in plain text.</span>
                </label>
              </div>
            </div>
          </section>

          <!-- Card 3: Organization Rules -->
          <section class="settings-card">
            <div class="card-header">
              <h3 class="card-title">${icons.doc(15)}<span>Organization Rules</span></h3>
            </div>
            <div class="card-body">
              <p class="field-hint">Click a preset chip to add common rules, or type custom instructions:</p>
              <div class="rule-chips-row">
                <button type="button" class="rule-chip" data-rule="Invoices and receipts go to Finance/Invoices">+ Invoices</button>
                <button type="button" class="rule-chip" data-rule="Tax documents (W-2, 1099) go to Finance/Taxes">+ Taxes</button>
                <button type="button" class="rule-chip" data-rule="Photos and family media go to Media/Photos">+ Photos</button>
                <button type="button" class="rule-chip" data-rule="Contracts and client proposals go to Work/Contracts">+ Contracts</button>
              </div>
              <textarea id="ai-rules-input" rows="3" spellcheck="false" placeholder="Invoices and receipts go to Finance/Invoices&#10;Tax documents go to Finance/Taxes&#10;Photos go to Media/Photos"></textarea>
            </div>
          </section>

          <!-- Card 4: Automation Behavior -->
          <section class="settings-card">
            <div class="card-body">
              <label class="switch-row compact">
                <div class="switch-text">
                  <span class="field-label">Move files automatically</span>
                  <span class="field-hint">When off, files stay in your inbox and suggested destinations appear in the menu-bar popover.</span>
                </div>
                <input id="ai-auto-route-toggle" class="switch" type="checkbox" role="switch" />
              </label>
            </div>
          </section>

          <!-- Test Simulator Drawer -->
          <div id="ai-test-result" class="test-drawer" hidden>
            <div class="test-drawer-header">
              <span>Routing Simulation</span>
              <button id="ai-test-close-btn" class="icon-btn-inline" type="button" style="position:static;">Dismiss</button>
            </div>
            <div id="ai-test-output" class="test-drawer-body"></div>
          </div>

          <!-- Actions Dock -->
          <div class="settings-action-bar">
            <div class="action-bar-left">
              <button id="ai-save-btn" class="btn primary" type="button">Save AI Settings</button>
              <button id="ai-test-btn" class="btn" type="button">Test Route</button>
            </div>
            <span id="ai-save-message" class="inline-message" role="status"></span>
          </div>
        </div>
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
}

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
          <p class="desktop-subtitle">Synology NAS volume detection and AI-assisted file categorization</p>
        </div>
      </header>
      <div class="desktop-content-body">
        <div class="desktop-settings-container">
          ${renderSettings(settings, "ai", true)}
        </div>
      </div>`;
  } else if (activeTab === "settings") {
    mainContent = `
      <header class="desktop-content-header" data-tauri-drag-region>
        <div class="desktop-title-area" data-tauri-drag-region>
          <h1 class="desktop-title">Settings</h1>
          <p class="desktop-subtitle">Preferences, storage, security, notifications, and smart routing</p>
        </div>
      </header>
      <div class="desktop-content-body">
        <div class="desktop-settings-container">
          ${renderSettings(settings, "general", true)}
        </div>
      </div>`;
  }

  return `
    <div class="desktop-layout">
      <aside class="desktop-sidebar">
        <div class="desktop-sidebar-top">
          <div class="brand-header" data-tauri-drag-region>
            <div class="brand-info" data-tauri-drag-region>
              <span class="brand-icon">${icons.box(20)}</span>
              <div class="brand-details" data-tauri-drag-region>
                <span class="brand-title">RenegadeBox</span>
                <div class="sidebar-status-pill ${statusClass}" title="${esc(st.title)}${st.detail ? ` - ${esc(st.detail)}` : ""}">
                  <span class="dot"></span>
                  <span class="status-pill-text">${esc(st.title)}</span>
                </div>
              </div>
            </div>
          </div>
          <nav class="sidebar-nav">
            ${navHtml}
          </nav>
        </div>

        <div class="desktop-sidebar-bottom">
          <div class="storage-card">
            <div class="storage-card-header">
              <span>Vault Storage</span>
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

