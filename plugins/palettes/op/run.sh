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

  # Get vault filter from config (optional)
  vault=$(cfg '.vault // empty')
  vault_arg=""
  [[ -n "$vault" ]] && vault_arg="--vault=$vault"

  # List items
  op item list --format=json $vault_arg | jq -c '.[] | {
    id: .id,
    name: .title,
    desc: (.additional_information // .category),
    icon: (
      if .category == "LOGIN" then "dialog-password"
      elif .category == "CREDIT_CARD" then "payment-card"
      elif .category == "IDENTITY" then "contact-new"
      elif .category == "SECURE_NOTE" then "text-x-generic"
      elif .category == "SSH_KEY" then "dialog-password"
      elif .category == "API_CREDENTIAL" then "dialog-password"
      else "dialog-password"
      end
    )
  }'
}

pick() {
  item=$(cat)
  id=$(echo "$item" | jq -r '.id')

  if [[ "$id" == "signin" ]]; then
    echo "Run: eval \$(op signin)" >&2
    exit 0
  fi

  # Get the field to copy (default: password)
  field=$(cfg '.field // "password"')

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
