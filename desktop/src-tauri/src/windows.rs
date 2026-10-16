//! Window management for the RenegadeBox desktop application.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const MAIN: &str = "main";
#[allow(dead_code)]
pub const POPOVER: &str = "popover";
#[allow(dead_code)]
pub const SETTINGS: &str = "settings";
pub const SETUP: &str = "setup";

#[allow(dead_code)]
const POPOVER_WIDTH: f64 = 360.0;
#[allow(dead_code)]
const GAP: f64 = 6.0;
#[allow(dead_code)]
const MARGIN: f64 = 8.0;

/// Remembers where the tray icon is and when the window last hid itself.
#[derive(Default)]
pub struct PopoverState {
    #[allow(dead_code)]
    anchor: Mutex<Option<PhysicalPosition<f64>>>,
    last_hidden: Mutex<Option<Instant>>,
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.show();
        let _ = win.unminimize();
        #[cfg(target_os = "macos")]
        {
            let _ = win.set_always_on_top(true);
            let _ = win.set_focus();
            let _ = win.set_always_on_top(false);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = win.set_focus();
        return;
    }
    let url = WebviewUrl::App("index.html".into());
    match WebviewWindowBuilder::new(app, MAIN, url)
        .title("RenegadeBox")
        .inner_size(1040.0, 700.0)
        .min_inner_size(840.0, 560.0)
        .resizable(true)
        .center()
        .focused(true)
        .build()
    {
        Ok(win) => {
            let _ = win.show();
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[Windows] could not open {MAIN}: {e}"),
    }
}

pub fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.hide();
        *app.state::<PopoverState>().last_hidden.lock().unwrap() = Some(Instant::now());
    }
}

pub fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<PopoverState>();
    if let Some(win) = app.get_webview_window(MAIN) {
        if win.is_visible().unwrap_or(false) {
            hide_main_window(app);
            return;
        }
    }
    let just_hidden = state
        .last_hidden
        .lock()
        .unwrap()
        .is_some_and(|t| t.elapsed() < Duration::from_millis(250));
    if !just_hidden {
        show_main_window(app);
    }
}

/// Physical point the popover should hang from: horizontally centred under the tray icon.
#[allow(dead_code)]
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
#[allow(dead_code)]
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

#[allow(dead_code)]
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

#[allow(dead_code)]
pub fn show_popover<R: Runtime>(app: &AppHandle<R>) {
    show_main_window(app);
}

#[allow(dead_code)]
pub fn hide_popover<R: Runtime>(app: &AppHandle<R>) {
    hide_main_window(app);
}

#[allow(dead_code)]
pub fn toggle_popover<R: Runtime>(app: &AppHandle<R>, _click: PhysicalPosition<f64>, _rect: Rect) {
    toggle_main_window(app);
}

fn open_window<R: Runtime>(app: &AppHandle<R>, label: &str, title: &str, view: &str, size: (f64, f64)) {
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        #[cfg(target_os = "macos")]
        {
            let _ = win.set_always_on_top(true);
            let _ = win.set_focus();
            let _ = win.set_always_on_top(false);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = win.set_focus();
        return;
    }
    let url = WebviewUrl::App(format!("index.html?view={view}").into());
    match WebviewWindowBuilder::new(app, label, url)
        .title(title)
        .inner_size(size.0, size.1)
        .resizable(true)
        .center()
        .focused(true)
        .build()
    {
        Ok(win) => {
            #[cfg(target_os = "macos")]
            {
                let _ = win.set_always_on_top(true);
                let _ = win.set_focus();
                let _ = win.set_always_on_top(false);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = win.set_focus();
        }
        Err(e) => eprintln!("[Windows] could not open {label}: {e}"),
    }
}

pub fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    show_main_window(app);
    let _ = app.emit("navigate-tab", "settings");
}

pub fn open_setup<R: Runtime>(app: &AppHandle<R>) {
    open_window(app, SETUP, "Set up RenegadeBox", "setup", (560.0, 680.0));
}
