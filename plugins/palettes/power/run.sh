#!/usr/bin/env bash

# Was a data.json of systemd commands, which meant the palette could only ever
# exist on Linux. The rows are the same six ideas on either platform; only the
# command differs, so it is generated rather than stored.

row() { # id, name, desc, icon_rc, icon_xdg, cmd, keywords, [confirm]
  jq -cn --arg id "$1" --arg name "$2" --arg desc "$3" --arg rc "$4" --arg xdg "$5" \
         --arg cmd "$6" --argjson kw "$7" --arg confirm "${8:-}" '
    { id: $id, name: $name, subtitle: $desc, cmd: $cmd, keywords: $kw,
      icon_rc: $rc, icon_xdg: $xdg }
    # Anything that ends the session asks first; the rest are one keystroke.
    + (if $confirm == "" then {} else {
        actions: [{
          id: "run", title: $name, action: "cmd", key: "cmd",
          style: "destructive", confirm: $confirm, primary: true
        }]
      } end)'
}

list() {
  if [[ "$OSTYPE" == darwin* ]]; then
    row lock "Lock Screen" "Lock and require password" Lock system-lock-screen \
      'osascript -e '"'"'tell application "System Events" to keystroke "q" using {command down, control down}'"'"'' \
      '["screen","secure","away","afk"]'
    row display "Sleep Display" "Turn the screen off" Moon system-suspend \
      "pmset displaysleepnow" '["screen","off","dim"]'
    row sleep "Sleep" "Sleep the machine" Moon system-suspend \
      "pmset sleepnow" '["suspend","pause","standby","nap"]'
    row screensaver "Screen Saver" "Start the screen saver" Stars preferences-desktop-theme \
      "open -a ScreenSaverEngine" '["idle","lock"]'
    row reboot "Restart" "Restart the machine" ArrowClockwise system-reboot \
      'osascript -e '"'"'tell application "System Events" to restart'"'"'' \
      '["reboot","reset"]' "Restart now?"
    row shutdown "Shut Down" "Power off the machine" Power system-shutdown \
      'osascript -e '"'"'tell application "System Events" to shut down'"'"'' \
      '["poweroff","halt","off"]' "Shut down now?"
    row logout "Log Out" "End the session" Logout system-log-out \
      'osascript -e '"'"'tell application "System Events" to log out'"'"'' \
      '["signout","exit"]' "Log out now?"
  else
    row lock "Lock Screen" "Lock and require password" Lock system-lock-screen \
      "loginctl lock-session" '["screen","secure","away","afk"]'
    row suspend "Suspend" "Sleep to RAM" Moon system-suspend \
      "systemctl suspend" '["sleep","pause","standby","nap"]'
    row hibernate "Hibernate" "Sleep to disk" Moon system-hibernate \
      "systemctl hibernate" '["sleep","disk"]'
    row reboot "Reboot" "Restart the system" ArrowClockwise system-reboot \
      "systemctl reboot" '["restart","reset"]' "Reboot now?"
    row shutdown "Shut Down" "Power off the system" Power system-shutdown \
      "systemctl poweroff" '["poweroff","halt","off"]' "Shut down now?"
    row logout "Log Out" "End the session" Logout system-log-out \
      "loginctl terminate-user $USER" '["signout","exit"]' "Log out now?"
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
