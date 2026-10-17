// Keeps what the person is typing alive across background re-renders.
// The desktop window rebuilds its HTML whenever the backend reports a change (a sync finished, a file
// moved). Without this, an API key being pasted or a rule being written would be wiped mid-edit.
// Only fields the person has changed (or is focused in) are captured, so fresh server values still
// show everywhere else. No direct DOM globals here, so it can be tested with plain objects.

export interface OptionLike {
  selected: boolean;
  defaultSelected: boolean;
}

/** The parts of an input, textarea or select this module reads and writes. */
export interface FieldLike {
  id: string;
  tagName: string;
  type?: string;
  value: string;
  defaultValue?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  options?: ArrayLike<OptionLike>;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  focus?: (opts?: { preventScroll?: boolean }) => void;
  setSelectionRange?: (start: number, end: number) => void;
}

/** An element whose open/closed state (the `hidden` attribute) should survive a re-render. */
export interface PanelLike {
  id: string;
  hidden: boolean;
}

export interface FieldSnapshot {
  id: string;
  value: string;
  checked?: boolean;
  focused: boolean;
  dirty: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
}

export interface FormState {
  fields: FieldSnapshot[];
  openPanels: string[];
}

const isToggle = (el: FieldLike) => el.type === "checkbox" || el.type === "radio";

/** True when the field no longer shows what was rendered: the person changed it. */
export function isFieldDirty(el: FieldLike): boolean {
  if (isToggle(el)) return el.defaultChecked !== undefined && el.checked !== el.defaultChecked;
  if (el.tagName.toUpperCase() === "SELECT") {
    const opts = el.options ? Array.from(el.options) : [];
    return opts.some((o) => o.selected !== o.defaultSelected);
  }
  return el.defaultValue !== undefined && el.value !== el.defaultValue;
}

/** Snapshot every changed or focused field that has an id. File pickers can't be restored, so they're skipped. */
export function captureFormState(fields: Iterable<FieldLike>, active: unknown, panels: Iterable<PanelLike> = []): FormState {
  const out: FieldSnapshot[] = [];
  for (const el of fields) {
    if (!el.id || el.type === "file") continue;
    const focused = el === active;
    const dirty = isFieldDirty(el);
    if (!focused && !dirty) continue;
    out.push({
      id: el.id,
      value: el.value,
      checked: isToggle(el) ? !!el.checked : undefined,
      focused,
      dirty,
      selectionStart: focused && typeof el.selectionStart === "number" ? el.selectionStart : null,
      selectionEnd: focused && typeof el.selectionEnd === "number" ? el.selectionEnd : null,
    });
  }
  const openPanels: string[] = [];
  for (const p of panels) if (p.id && !p.hidden) openPanels.push(p.id);
  return { fields: out, openPanels };
}

/** Put captured values, focus and caret back onto the freshly rendered fields with the same ids. */
export function restoreFormState(
  state: FormState,
  lookupField: (id: string) => FieldLike | null,
  lookupPanel: (id: string) => PanelLike | null = () => null,
): void {
  for (const snap of state.fields) {
    const el = lookupField(snap.id);
    if (!el) continue;
    if (snap.dirty) {
      if (isToggle(el)) el.checked = !!snap.checked;
      else el.value = snap.value;
    }
    if (snap.focused) {
      el.focus?.({ preventScroll: true });
      if (snap.selectionStart !== null && snap.selectionEnd !== null) {
        try {
          el.setSelectionRange?.(snap.selectionStart, snap.selectionEnd);
        } catch {
          // number inputs and selects have no caret
        }
      }
    }
  }
  for (const id of state.openPanels) {
    const p = lookupPanel(id);
    if (p) p.hidden = false;
  }
}
