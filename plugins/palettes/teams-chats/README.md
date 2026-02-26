# teams-chats

Lists your recent Microsoft Teams chats with the latest message preview.

## Auth

Token is read from `$TEAMS_TOKEN` env var, or fetched automatically via Azure CLI.

### Option 1 — Azure CLI (recommended)

Handles token refresh automatically.

```sh
az login
```

### Option 2 — Manual token (expires in ~1h)

Requires the `Chat.Read` scope — Graph Explorer doesn't include it by default.

1. Go to [Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)
2. Sign in with your Microsoft account
3. Click **Modify permissions** tab → find `Chat.Read` → click **Consent**
4. Click your avatar → **Access token** tab → copy the token
5. `export TEAMS_TOKEN=<paste token>` (add to `~/.zshenv` for persistence)
