// Icons an extension can name instead of pasting a glyph.
//
// `xdg(name)` maps a freedesktop icon name (the Icon Naming Specification's
// standard names plus a few common app names) to the Nerd Font codepoint
// that draws it, from the symbols font the app bundles
// (app/src/assets/fonts). Every value is one private-use codepoint, which
// the UI renders as a glyph icon. The bundled `scripts` extension reads it
// for rows that only carry `icon_xdg`; an extension can use it directly:
// `icon: xdg("dialog-error")`. Names are Material Design glyphs
// (`md-*` in nerd-fonts/glyphnames.json); a name not in the table gives
// undefined so the caller can fall back to the palette's icon.
/** Freedesktop icon name to Nerd Font glyph, the table `xdg` reads. */
export const XDG_ICONS: Record<string, string> = {
  "accessories-calculator":    "\u{f00ec}", // md-calculator
  "accessories-text-editor":   "\u{f03eb}", // md-pencil
  "accessories-dictionary":    "\u{f14f7}", // md-book_open_variant
  "applications-development":  "\u{f0169}", // md-code_braces
  "applications-games":        "\u{f0297}", // md-gamepad_variant
  "applications-internet":     "\u{f059f}", // md-web
  "applications-multimedia":   "\u{f0381}", // md-movie
  "applications-office":       "\u{f0219}", // md-file_document
  "applications-science":      "\u{f0093}", // md-flask
  "applications-system":       "\u{f0675}", // md-application_cog
  "applications-utilities":    "\u{f1064}", // md-tools
  "appointment-new":           "\u{f00f3}", // md-calendar_plus
  "audio-card":                "\u{f04c3}", // md-speaker
  "audio-headphones":          "\u{f02cb}", // md-headphones
  "audio-speakers":            "\u{f04c3}", // md-speaker
  "audio-volume-high":         "\u{f057e}", // md-volume_high
  "audio-volume-muted":        "\u{f0581}", // md-volume_off
  "avatar-default":            "\u{f0009}", // md-account_circle
  "battery":                   "\u{f0079}", // md-battery
  "battery-caution":           "\u{f0083}", // md-battery_alert
  "bluetooth":                 "\u{f00af}", // md-bluetooth
  "bluetooth-connected":       "\u{f00b1}", // md-bluetooth_connect
  "bookmark":                  "\u{f00c0}", // md-bookmark
  "bookmark-new":              "\u{f00c0}", // md-bookmark
  "camera-photo":              "\u{f0100}", // md-camera
  "camera-web":                "\u{f05a0}", // md-webcam
  "changes-allow":             "\u{f033f}", // md-lock_open
  "changes-prevent":           "\u{f033e}", // md-lock
  "computer":                  "\u{f01c5}", // md-desktop_tower
  "dialog-error":              "\u{f0029}", // md-alert_octagon
  "dialog-information":        "\u{f02fc}", // md-information
  "dialog-password":           "\u{f0306}", // md-key
  "dialog-question":           "\u{f02d7}", // md-help_circle
  "dialog-warning":            "\u{f0026}", // md-alert
  "document-new":              "\u{f0752}", // md-file_plus
  "document-open":             "\u{f0770}", // md-folder_open
  "document-save":             "\u{f0193}", // md-content_save
  "drive-harddisk":            "\u{f02ca}", // md-harddisk
  "drive-removable-media":     "\u{f0553}", // md-usb
  "edit-clear":                "\u{f01fe}", // md-eraser
  "edit-copy":                 "\u{f018f}", // md-content_copy
  "edit-delete":               "\u{f01b4}", // md-delete
  "edit-find":                 "\u{f0349}", // md-magnify
  "edit-paste":                "\u{f0192}", // md-content_paste
  "emblem-default":            "\u{f012c}", // md-check
  "emblem-favorite":           "\u{f02d1}", // md-heart
  "emblem-important":          "\u{f0028}", // md-alert_circle
  "emblem-shared":             "\u{f0497}", // md-share_variant
  "folder":                    "\u{f024b}", // md-folder
  "folder-open":               "\u{f0770}", // md-folder_open
  "font-x-generic":            "\u{f06d6}", // md-format_font
  "go-down":                   "\u{f0045}", // md-arrow_down
  "go-home":                   "\u{f02dc}", // md-home
  "go-next":                   "\u{f0054}", // md-arrow_right
  "go-previous":               "\u{f004d}", // md-arrow_left
  "go-up":                     "\u{f005d}", // md-arrow_up
  "google-chrome":             "\u{f02af}", // md-google_chrome
  "help-about":                "\u{f02fc}", // md-information
  "help-browser":              "\u{f02d7}", // md-help_circle
  "home":                      "\u{f02dc}", // md-home
  "image-x-generic":           "\u{f02e9}", // md-image
  "input-keyboard":            "\u{f030c}", // md-keyboard
  "input-mouse":               "\u{f037d}", // md-mouse
  "internet-chat":             "\u{f0b79}", // md-chat
  "internet-mail":             "\u{f01ee}", // md-email
  "internet-web-browser":      "\u{f059f}", // md-web
  "kitty":                     "\u{f011b}", // md-cat
  "list-add":                  "\u{f0415}", // md-plus
  "list-remove":               "\u{f0374}", // md-minus
  "mail-message-new":          "\u{f01ee}", // md-email
  "mail-read":                 "\u{f01ef}", // md-email_open
  "mail-send":                 "\u{f048a}", // md-send
  "mail-unread":               "\u{f01ee}", // md-email
  "media-playback-pause":      "\u{f03e4}", // md-pause
  "media-playback-start":      "\u{f040a}", // md-play
  "media-playback-stop":       "\u{f04db}", // md-stop
  "media-skip-backward":       "\u{f04ae}", // md-skip_previous
  "media-skip-forward":        "\u{f04ad}", // md-skip_next
  "multimedia-player":         "\u{f075a}", // md-music
  "network-server":            "\u{f048b}", // md-server
  "network-wired":             "\u{f0317}", // md-lan
  "network-wireless":          "\u{f05a9}", // md-wifi
  "package-x-generic":         "\u{f03d6}", // md-package_variant
  "pda":                       "\u{f011c}", // md-cellphone
  "phone":                     "\u{f03f2}", // md-phone
  "preferences-desktop":       "\u{f0493}", // md-cog
  "preferences-desktop-theme": "\u{f03d8}", // md-palette
  "preferences-system":        "\u{f0493}", // md-cog
  "printer":                   "\u{f042a}", // md-printer
  "security-high":             "\u{f0565}", // md-shield_check
  "security-low":              "\u{f099e}", // md-shield_off
  "security-medium":           "\u{f0780}", // md-shield_half_full
  "starred":                   "\u{f04ce}", // md-star
  "system-file-manager":       "\u{f024b}", // md-folder
  "system-hibernate":          "\u{f0904}", // md-power_sleep
  "system-lock-screen":        "\u{f033e}", // md-lock
  "system-log-out":            "\u{f0343}", // md-logout
  "system-reboot":             "\u{f0709}", // md-restart
  "system-run":                "\u{f018d}", // md-console
  "system-search":             "\u{f0349}", // md-magnify
  "system-shutdown":           "\u{f0425}", // md-power
  "system-suspend":            "\u{f04b2}", // md-sleep
  "text-x-generic":            "\u{f0214}", // md-file
  "user-info":                 "\u{f0004}", // md-account
  "utilities-terminal":        "\u{f018d}", // md-console
  "video-display":             "\u{f0379}", // md-monitor
  "video-x-generic":           "\u{f0567}", // md-video
  "web-browser":               "\u{f059f}", // md-web
  "weather-clear":             "\u{f0599}", // md-weather_sunny
  "window-close":              "\u{f05ad}", // md-window_close
  "window-new":                "\u{f05af}", // md-window_maximize
  "x-office-calendar":         "\u{f00ed}", // md-calendar
  "zoom-in":                   "\u{f034b}", // md-magnify_plus
  "zoom-out":                  "\u{f034a}", // md-magnify_minus
};

/** The glyph for a freedesktop icon name, or undefined. Case-insensitive; `-symbolic` suffix is ignored. */
export const xdg = (name: unknown): string | undefined =>
  typeof name === "string" ? XDG_ICONS[name.trim().toLowerCase().replace(/-symbolic$/, "")] : undefined;
