FROM archlinux:latest

RUN pacman -Syu --noconfirm \
    xorg-server-xvfb xorg-xset xorg-setxkbmap xdotool scrot ffmpeg \
    openbox rofi fzf jq xterm gtk-update-icon-cache hicolor-icon-theme \
    ttf-firacode-nerd papirus-icon-theme

# Build icon cache so rofi can find icons
RUN gtk-update-icon-cache -f /usr/share/icons/Papirus/ 2>/dev/null || true && \
    gtk-update-icon-cache -f /usr/share/icons/hicolor/ 2>/dev/null || true

WORKDIR /work
COPY capture.sh /work/
COPY rofi-theme.rasi /work/
COPY items.jsonl /work/

# Build pal binary in a separate stage would be better,
# but for testing just copy a pre-built one
COPY pal /work/pal

RUN chmod +x /work/capture.sh /work/pal

ENTRYPOINT ["/work/capture.sh"]
