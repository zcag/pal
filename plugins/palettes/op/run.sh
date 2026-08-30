#!/usr/bin/env bash

# 1Password palette - list and copy passwords
# Requires: op cli (https://1password.com/downloads/command-line/)

cfg() {
  echo "$_PAL_PLUGIN_CONFIG" | jq -r "$1"
}

list() {
  # Check if signed in
  if ! op account list &>/dev/null; then
    echo '{"id":"signin","name":"Sign in to 1Password (op signin)","icon":"dialog-password"}' >&2
    exit 1
  fi

  # A vault named in config is a default, not a cage - the scope dropdown
  # overrides it, and "all" means all.
  vault=$(cfg '.vault // empty')
  [[ -n "$PAL_FILTER" ]] && vault="$PAL_FILTER"
  vault_arg=""
  [[ -n "$vault" && "$vault" != "all" ]] && vault_arg="--vault=$vault"

  op item list --format=json $vault_arg | jq -c '
    def glyph: {
      LOGIN: "Key", PASSWORD: "Key", CREDIT_CARD: "CreditCard",
      IDENTITY: "Person", SECURE_NOTE: "Document", SSH_KEY: "Terminal",
      API_CREDENTIAL: "Code", DATABASE: "HardDrive", SERVER: "HardDrive",
      WIRELESS_ROUTER: "Wifi", MEMBERSHIP: "Star", BANK_ACCOUNT: "BankNote"
    }[.category] // "Lock";
    def label: (.category | ascii_downcase | gsub("_"; " "));
    .[] | {
      id: .id,
      name: .title,
      # The account the entry is for - the one thing that tells two GitHub
      # logins apart.
      subtitle: (.additional_information // ""),
      keywords: [(.urls // [] | map(.href | sub("^https?://"; "") | split("/")[0]))[]?, label],
      section: label,
      icon_rc: glyph,
      icon_xdg: "dialog-password",
      vault: .vault.name,
      accessories: [{ text: { value: .vault.name, color: "secondary" } }]
    }'
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if [[ "$id" == "signin" ]]; then
    echo "Run: eval \$(op signin)" >&2
    exit 0
  fi

  # Get the field to copy (default: password); PAL_ACTION names it when the
  # action panel asked for something else.
  field="${PAL_ACTION_FIELD:-$(cfg '.field // "password"')}"

  # Get the field value
  value=$(op item get "$id" --fields "$field" 2>/dev/null)

  if [[ -z "$value" ]]; then
    # Try username if password not found
    value=$(op item get "$id" --fields "username" 2>/dev/null)
  fi

  if [[ -n "$value" ]]; then
    # Never echo the secret as output - `copy` puts it on the clipboard and
    # answers with a hud that names the field, not the value.
    printf '%s' "$value" | pal action copy >/dev/null
    jq -cn --arg f "$field" '{hud: ("Copied " + $f), close: true}'
  else
    echo "Could not get field: $field" >&2
  fi
}

CMD=$1; shift
case "$CMD" in
  list) list ;;
  pick) pick ;;
  *) echo "Unknown command: $CMD" >&2 ;;
esac
