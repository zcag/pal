// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // linuxdeploy's GTK hook exports GDK_BACKEND=x11 inside an AppImage
    // (tauri-apps/tauri#8541), which puts pal under Xwayland on a Wayland
    // session: class `Pal`, no compositor placement, the X11 hotkey path.
    // Native Wayland works with the bundled GTK (notes/linux.md), so prefer
    // it; PAL_GDK_BACKEND wins for anyone who needs the x11 path back.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPDIR").is_some() && std::env::var_os("WAYLAND_DISPLAY").is_some() {
        let backend = std::env::var("PAL_GDK_BACKEND").unwrap_or_else(|_| "wayland,x11".into());
        std::env::set_var("GDK_BACKEND", backend);
    }
    pal_lib::run()
}
