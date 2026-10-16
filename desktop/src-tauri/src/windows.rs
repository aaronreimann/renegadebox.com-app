//! Window management for the menu-bar app: the tray popover plus the on-demand
//! Settings and Setup windows. Only the popover is declared in tauri.conf.json.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Manager, PhysicalPosition, Rect, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const POPOVER: &str = "popover";
pub const SETTINGS: &str = "settings";
pub const SETUP: &str = "setup";

const POPOVER_WIDTH: f64 = 360.0;
const GAP: f64 = 6.0;
const MARGIN: f64 = 8.0;

/// Remembers where the tray icon is and when the popover last hid itself,
/// so a click on the tray icon that also blurs the popover doesn't reopen it.
#[derive(Default)]
pub struct PopoverState {
    anchor: Mutex<Option<PhysicalPosition<f64>>>,
    last_hidden: Mutex<Option<Instant>>,
}

/// Physical point the popover should hang from: horizontally centred under the tray icon.
fn anchor_from_rect<R: Runtime>(app: &AppHandle<R>, click: PhysicalPosition<f64>, rect: Rect) -> PhysicalPosition<f64> {
    let scale = app
        .monitor_from_point(click.x, click.y)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    PhysicalPosition::new(pos.x + size.width / 2.0, pos.y + size.height)
}

/// Top-right of the primary screen, just under the menu bar. Used when we have no tray click yet.
fn fallback_anchor<R: Runtime>(app: &AppHandle<R>) -> Option<PhysicalPosition<f64>> {
    let m = app.primary_monitor().ok().flatten()?;
    let s = m.scale_factor();
    let p = m.position();
    let size = m.size();
    Some(PhysicalPosition::new(
        p.x as f64 + size.width as f64 - (POPOVER_WIDTH / 2.0 + 16.0) * s,
        p.y as f64 + 30.0 * s,
    ))
}

fn place_popover<R: Runtime>(app: &AppHandle<R>, win: &WebviewWindow<R>, anchor: PhysicalPosition<f64>) {
    let Some(monitor) = app.monitor_from_point(anchor.x, anchor.y).ok().flatten() else {
        return;
    };
    let s = monitor.scale_factor();
    let width = POPOVER_WIDTH * s;
    let left = monitor.position().x as f64 + MARGIN * s;
    let right = monitor.position().x as f64 + monitor.size().width as f64 - width - MARGIN * s;
    let x = (anchor.x - width / 2.0).clamp(left, right.max(left));
    let y = anchor.y + GAP * s;
    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

pub fn show_popover<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = app.get_webview_window(POPOVER) else { return };
    let state = app.state::<PopoverState>();
    let anchor = (*state.anchor.lock().unwrap()).or_else(|| fallback_anchor(app));
    if let Some(a) = anchor {
        place_popover(app, &win, a);
    }
    let _ = win.show();
    let _ = win.set_focus();
}

pub fn hide_popover<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(POPOVER) {
        let _ = win.hide();
        *app.state::<PopoverState>().last_hidden.lock().unwrap() = Some(Instant::now());
    }
}

/// Left click on the tray icon.
pub fn toggle_popover<R: Runtime>(app: &AppHandle<R>, click: PhysicalPosition<f64>, rect: Rect) {
    let Some(win) = app.get_webview_window(POPOVER) else { return };
    let state = app.state::<PopoverState>();
    *state.anchor.lock().unwrap() = Some(anchor_from_rect(app, click, rect));

    if win.is_visible().unwrap_or(false) {
        hide_popover(app);
        return;
    }
    // The same click may already have hidden the popover through a focus loss.
    let just_hidden = state
        .last_hidden
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(250));
    if !just_hidden {
        show_popover(app);
    }
}

fn open_window<R: Runtime>(app: &AppHandle<R>, label: &str, title: &str, view: &str, size: (f64, f64)) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return;
    }
    let url = WebviewUrl::App(format!("index.html?view={view}").into());
    match WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(size.0, size.1)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .center()
        .focused(true)
        .build()
    {
        Ok(win) => {
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[Windows] could not open {label}: {e}"),
    }
}

pub fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    hide_popover(app);
    open_window(app, SETTINGS, "RenegadeBox Settings", "settings", (480.0, 640.0));
}

pub fn open_setup<R: Runtime>(app: &AppHandle<R>) {
    hide_popover(app);
    open_window(app, SETUP, "Set up RenegadeBox", "setup", (520.0, 640.0));
}
