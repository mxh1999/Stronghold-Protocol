# Optional accounts and automatic saves

A small deployment extension for roughly ten players. The main game page has a **Sign in** button; guests retain
the original local preferences and import/export buttons. Signed-in players use the same game screens, with
import/export hidden and every persisted preference automatically saved to the server. There is no separate
match-history service, game-entry login gate, or change to match rules, WebSockets, or battle simulation.

## Start

Use this source checkout, the normal `npm ci` and game asset setup, and **Node >= 22.13** (`node:sqlite`).
From the repository root:

```powershell
$env:SP_ACCOUNT_ORIGIN = 'http://127.0.0.1:3000'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
node extensions/accounts/start.mjs
```

```bash
SP_ACCOUNT_ORIGIN=http://127.0.0.1:3000 HOST=127.0.0.1 PORT=3000 node extensions/accounts/start.mjs
```

Open the exact configured origin and use the main-page login button. Usernames use 3–24 ASCII letters, digits or
underscores. Passwords use 10–128 characters. Registration is open by default. The normal `npm start` remains the
upstream version with no login UI or account APIs.

| Environment variable | Default | Purpose |
|---|---|---|
| `SP_ACCOUNT_ORIGIN` | Required | Exact public HTTPS origin; HTTP allowed only on loopback for local development |
| `SP_ACCOUNT_DATA` | `extensions/accounts/var` | Persistent directory for credentials and JSON saves |
| `SP_ACCOUNT_REGISTRATION` | Open | Set `closed` to disable new registrations |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Same listener settings as the game |
| `TRUST_PROXY` | Upstream `auto` | Use `0` for direct access; configure trusted forwarding for a reverse proxy |

For public deployment, set `SP_ACCOUNT_ORIGIN=https://game.example.com` and use the existing HTTPS reverse proxy
instructions in [DEPLOY.md](../../docs/DEPLOY.md). Serve at the domain root and forward cookies, Origin and `/ws`
upgrades. Keep the raw Node port private. A service must use this extension's entry, not the stock launch script.
Use **one server process** and a local disk for each data directory.

## Data and behavior

```text
var/
  accounts.sqlite       # users and sessions only; salted password hashes, never plaintext passwords
  saves/
    <account UUID>.json # readable, unencrypted preference/statistics values
```

Each JSON file is `{ "v": 1, "revision": 1, "data": { "sp.pref.settings": { ... }, ... } }`.
The values retain upstream's existing storage/export schemas; the extension does not define a second game-data
model. The account UUID comes from the authenticated session, never a client-supplied file path.

- Every `sp.pref.*` value is covered: graphics, audio, hotkeys, language, lobby options, recent rooms, emote choices,
  operator loadout, potential/training, ownership, DIY picks, and the original statistics/history envelope.
  The player's nickname (`sp.name`) is covered too. Reconnect tokens and live match state are never uploaded.
- The first login with no server save copies the current guest preferences and statistics. Once a server save exists,
  it is authoritative on startup, even when empty. Preferences load **before** game modules initialize their stores.
- Signed-in changes use an account-specific in-memory backend, with a 600 ms debounce and automatic retry on network
  errors. Guest localStorage is not overwritten. Logout waits for pending saves and returns to the guest data.
- Import/export buttons disappear from loadout, ownership, DIY and statistics only while signed in. Reset/clear
  buttons still work and their changes are saved automatically. The statistics page describes server storage.
- The original client records results/quits and displays history; those same records are saved to JSON. No server
  Match subclass or independent settlement recording exists. A result that never reaches the client is not added
  by this extension. Game restart recovery remains upstream behavior.
- A revision check rejects stale writes from another tab/device. The status bar reports the conflict; reload to
  load the server version. It asks before discarding pending edits. Transient failures keep retrying, and this tab's
  sessionStorage retains drafts when available. Reloading another device fetches its latest server save; changes
  are not live-pushed into an already running game. Closing with pending changes shows the browser's warning.
- Logging in/out in another tab stops saving from the old tab and requests a reload. The API also verifies the
  expected account ID, preventing a stale tab from writing to a different account sharing its cookie jar.
- JSON writes use a flushed temporary file plus atomic rename. Unreadable or newer save files are reported as an
  error, never silently replaced with defaults. HTTP uploads are capped at 8 MiB plus a small envelope allowance.

Passwords use salted scrypt (`N=131072`, `r=8`, `p=1`). Sessions use random HttpOnly, SameSite=Strict cookies; HTTPS
adds Secure and the `__Host-` prefix. SQLite stores only session-token hashes. Sessions expire after seven days;
the ten newest logins remain active. Credential attempts are rate-limited and only one password calculation runs
at a time (about 128 MiB transient memory). Writes require the configured Origin and an extension request header.

The JSON files contain personal configuration and may contain teammates' nicknames in game records. Both the
database and save directory must stay outside public static mounts; startup checks this, including symlinks.
Keep backups private. Runtime files are ignored by Git. Apply appropriate Windows ACLs or Unix directory ownership.

## Backup and password reset

Stop the service and copy the **whole** `SP_ACCOUNT_DATA` directory. Back up both SQLite (and any WAL files) and
`saves/`; a database-only backup does not include user data. Restore into an empty data directory while stopped.
Keep an archived copy before manual edits or restores; preserve valid JSON and increment its revision when editing.

```bash
node extensions/accounts/admin.mjs reset-password Alice
```

The command reads the new password from hidden terminal input or stdin, never command-line arguments. Set
`SP_ACCOUNT_DATA` to the service's directory. Resetting a password invalidates every login for that account.

The previous experimental `extensions/private-server` implementation is not used or automatically migrated.
When replacing that prototype, keep its database separately; do not put it in place of `accounts.sqlite`.

## Keep upstream merges small

The optional `requestExtension` parameter touches only `server/index.js` and `server/http/routes.js`; it handles
account APIs and serves the normal HTML with its module entry pointed at the extension bootstrap. `/ws` is unchanged.
The bootstrap hydrates preferences and then imports the original `/js/main.js`, which is unchanged on disk.

`public/js/preferences.js` is a small storage interface, defaulting to localStorage. `store.js`, `ui/stats.js` and
the nickname accessors in `net.js` use it. `screens/loadout.js` and `screens/stats.js` hide file-transfer controls
when the backend is remote. All account, credential, JSON, synchronization and login UI code lives in this directory.
The browser tests are contract tests for these few upstream adapters. No Storage prototype patches, periodic scans
of localStorage, copied game UI, or changes to match results are involved.

After merging upstream, reapply missing extension translations with `node extensions/accounts/install-i18n.mjs`.
Do not install official update ZIPs over this fork; their manifests do not include the extension. Golden results
must remain unchanged for this deployment feature.

## Validate

```bash
node --test extensions/accounts/test/server.test.mjs extensions/accounts/test/storage.test.mjs
npm --prefix extensions/accounts run lint
node tools/i18n.mjs check --all --strict
node tools/i18n.mjs check --all extensions/accounts/public --strict
node --test test/docs-consistency.test.js test/docs-paths.test.js
npm run ci
```

Real browser integration:

```powershell
$env:SP_ACCOUNT_E2E = '1'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
node --test extensions/accounts/test/browser.test.mjs
```

On Linux, set the same variables with `CHROME_PATH=/usr/bin/google-chrome`. Optional `SP_ACCOUNT_SCREENSHOTS` names
an output directory. The test covers main-page registration, anonymous UI, all preference adapters, two isolated
browser sessions, stale writes, real upstream match results, JSON persistence, logout and account/guest isolation.

## Docker

Build the base image from this patched checkout, then layer the extension over it:

```bash
docker build -t stronghold-protocol .
docker build -f extensions/accounts/Dockerfile -t stronghold-accounts .
docker run -d --name stronghold-accounts --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -e SP_ACCOUNT_ORIGIN=https://game.example.com \
  -v stronghold-accounts-data:/app/account-data \
  -v "$PWD/public/assets:/app/public/assets:ro" stronghold-accounts
```

The volume includes credentials and JSON saves. Keep the upstream asset setup and proxy configuration.
