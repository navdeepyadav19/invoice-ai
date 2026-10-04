# 03 · Command-line interface (`invoice-ai`)

> **Depends on:** [02-sdk.md](02-sdk.md) for all API calls, and [01-api.md](01-api.md) for API keys and OAuth.
> **Built in parallel with:** [04-mcp.md](04-mcp.md). The CLI also ships the local MCP server (`invoice-ai mcp`).

## 1. What this layer is, and what students learn

A CLI is a **TV remote for the same box**. The TV (the API) doesn't change; the remote just makes it fast to use from a terminal, a shell script or a CI job.

Students leave this module understanding:

1. **How a terminal app logs you in through a browser.** This is the OAuth device authorization grant (RFC 8628): the terminal shows a short code, you approve it in a signed-in browser, and the terminal polls until it's handed a credential. Same pattern as `gh auth login` or `vercel login`.
2. **Where credentials should live:** the OS keychain, not a plaintext dotfile, and never shell history.
3. **Two audiences for the same command:**
   - humans want tables, colours and "are you sure?"
   - scripts want `--json`, no prompts and meaningful **exit codes**
4. **Why a CLI must be *thin*.** Every business rule lives in the API; the CLI only parses flags and prints.

## 2. How it works in this repo today

- **There is no CLI.** The closest things are the `pnpm` scripts in `package.json` (`dev`, `build`, `test`), which are for developers of the app, not users of the product.
- **Existing CLIs to learn from:**
  - **Supabase CLI:** `supabase login` stores a token.
  - **Vercel CLI:** used in this repo's CD pipeline (`.github/actions/vercel-deploy/action.yml`) with a token from an environment variable, the same "env var beats stored login" precedence planned below.
- **The server half of `invoice-ai login` is built:** `POST /api/cli/device`, `POST /api/cli/token`, `DELETE /api/cli/session` (`app/api/cli/`), the browser consent page `app/(app)/cli/authorize/page.tsx`, the logic in `lib/cli-auth/`, and the `cli_device_codes` table in `db/migrations/0013_cli_device_auth.sql`.
- **The SDK from 02 does all HTTP work.** The CLI adds no fetch calls of its own.

**Show the students:** run `vercel whoami` and `gh auth status`. Both tell you *who* you are and *where* the credential came from. `invoice-ai whoami` will do the same.

## 3. Design

### 3.1 Package layout (all new)

```
packages/cli/
├── package.json        name "invoice-ai" (or "@invoice-ai/cli"), bin: { "invoice-ai": "dist/index.js" }
├── src/
│   ├── index.ts        commander program, global flags, error → exit code mapping
│   ├── commands/
│   │   ├── auth.ts     login, logout, whoami
│   │   ├── clients.ts
│   │   ├── invoices.ts
│   │   └── mcp.ts      starts the stdio MCP server from packages/mcp-tools
│   ├── auth/
│   │   ├── device.ts   start the device flow, open the browser, poll /api/cli/token
│   │   └── store.ts    env → keychain → file fallback, profiles
│   ├── output.ts       table vs --json, colours only on a TTY
│   └── confirm.ts      preview + prompt for issue / send / cancel
```

Dependencies: `commander`, `@invoice-ai/sdk`, `@napi-rs/keyring` (OS keychain), `open` (launch the browser).

### 3.2 Commands

| Command | What it does | SDK call |
|---|---|---|
| `invoice-ai login` | Browser login (device flow) | `/api/cli/device` + `/api/cli/token`, see 3.3 |
| `invoice-ai login --api-key` | Paste an API key via **stdin**, so it never ends up in shell history | — |
| `invoice-ai logout` | Revoke the key (`DELETE /api/cli/session`), then delete stored credentials for the profile | — |
| `invoice-ai whoami` | Business name, GSTIN, credential type and source | `business.get()` |
| `invoice-ai clients list [--query acme]` | Table of clients | `clients.listAll()` |
| `invoice-ai clients get <id>` | One client | `clients.get()` |
| `invoice-ai clients create --name --email --gstin --state` | Create client | `clients.create()` |
| `invoice-ai invoices list [--status sent] [--from 2026-09-01]` | Table: number, client, total, status | `invoices.listAll()` |
| `invoice-ai invoices get <id>` | Details incl. CGST/SGST/IGST split | `invoices.get()` |
| `invoice-ai invoices pdf <id> -o invoice.pdf` | Download PDF | `invoices.pdf()` |
| `invoice-ai invoices create --client <id\|name> --item "Consulting:1:2500000:18" [--due 2026-10-15]` | Create a draft (item = `description:qty:rate_paise:gst_rate`) | `invoices.createDraft()` |
| `invoice-ai invoices create --file draft.json` | Create a draft from JSON | `invoices.createDraft()` |
| `invoice-ai invoices issue <id>` | Preview → confirm → issue | `invoices.issue()` |
| `invoice-ai invoices send <id> [--to a@b.com]` | Preview → confirm → email | `invoices.send()` |
| `invoice-ai invoices mark-paid <id> [--reference UTR123]` | Mark paid | `invoices.markPaid()` |
| `invoice-ai invoices cancel <id> --reason "Duplicate"` | Preview → confirm → cancel | `invoices.cancel()` |
| `invoice-ai mcp` | Run the local MCP server over stdio (see 04) | `packages/mcp-tools` |

**Global flags:**

| Flag | Meaning |
|---|---|
| `--json` | Machine output: the raw API JSON on stdout, errors as problem+json on stderr |
| `--profile <name>` | Switch between accounts (`work`, `personal`) |
| `--base-url <url>` | Point at a preview deployment or `localhost:3000` |
| `--yes` | Skip confirmation prompts (required in non-interactive use) |
| `--idempotency-key <key>` | Reuse a key from a failed attempt to retry safely |

### 3.3 Logging in with a browser (device flow, RFC 8628)

The CLI holds no client secret, because anything shipped to users' laptops can be extracted, and it never sees a password. The terminal and the browser meet in the middle, and what the terminal ends up with is an ordinary **API key**, so everything after login is the same code path as `login --api-key`.

```
invoice-ai login
  1. POST /api/cli/device { client_name, client_os }
       → device_code (secret, kept by the CLI), user_code "WXYZ-2345",
         verification_uri_complete, interval 5, expires_in 600
  2. print the user_code, open the browser at /cli/authorize?code=WXYZ-2345
  3. user signs in to Invoice-AI (the proxy sends them to /login and back with the
     code intact), checks the code and device name, unticks any scopes, clicks Authorize
  4. meanwhile the CLI POSTs /api/cli/token { device_code } every `interval` seconds:
       authorization_pending → keep polling    slow_down → wait longer
       access_denied / expired_token / invalid_grant → stop, tell the user
  5. first poll after approval → { api_key, key_id, scopes, account }, exactly once
  6. store api_key (3.4). The key is named "CLI · <device>" in Settings → API keys
```

**Why the code is split in two:** the `user_code` is short enough to type, so it only identifies the request on the consent page, for someone already signed in; it can't fetch a credential. Polling needs the `device_code` (256 random bits), which never leaves the CLI. The database stores only `sha256(device_code)`, and the API key itself isn't created until the first successful poll, inserted as the approving user under RLS, so its plaintext exists in exactly one HTTP response.

### 3.4 Where credentials are stored

Checked in this order; the first one found wins:

1. **`INVOICE_AI_API_KEY` environment variable.** For CI and scripts, and always wins, like `VERCEL_TOKEN` in our pipeline.
2. **OS keychain** (macOS Keychain, Windows Credential Manager, libsecret) via `@napi-rs/keyring`, under service `invoice-ai`, account `<profile>`.
3. **Fallback file** `~/.config/invoice-ai/credentials.json` with permissions `0600`. Used only when no keychain is available (e.g. a headless Linux box), with a warning printed.

Non-secret settings (profiles, base URL) live in `~/.config/invoice-ai/config.json`.

`whoami` always prints **which** source was used, so "why is it using the wrong account?" has an answer.

### 3.5 UX rules

**Destructive commands confirm first.** `issue`, `send` and `cancel` print a preview, then ask:

```
Issue invoice for Acme Consulting Pvt Ltd (27AAACA1234F1Z5)
  Place of supply   Maharashtra (intra-state → CGST + SGST)
  Taxable value     ₹25,000.00
  CGST 9%           ₹2,250.00
  SGST 9%           ₹2,250.00
  Total             ₹29,500.00
This assigns a permanent GST invoice number and cannot be undone (only cancelled).
Proceed? [y/N]
```

- **No TTY and no `--yes`:** refuse and exit `2`, so a script can never hang forever on a hidden prompt.
- **Safe retry on failure.** A failed write prints its idempotency key:
  `Request failed (network). Retry safely with: invoice-ai invoices issue 7f3c… --idempotency-key 3b1e…`
- **Output:** colours and tables only when stdout is a TTY. `--json` output is stable and documented.

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | API error (4xx/5xx other than below) |
| `2` | Usage error: bad flags, or confirmation needed but no TTY |
| `3` | Authentication: not logged in, expired, or revoked |
| `4` | Rate limited (429) |

**Show the students:** `invoice-ai invoices list --json | jq '.[] | select(.status=="sent") | .total_paise' | paste -sd+ - | bc`. That's total outstanding in one line, which is exactly what a CLI is for.

## 4. Build phases

| Phase | Scope | Acceptance criteria | Teaching checkpoint |
|---|---|---|---|
| **C1: API key login + reads** | Scaffold, `login --api-key`, `whoami`, `clients list/get`, `invoices list/get/pdf`, `--json`, exit codes | `INVOICE_AI_API_KEY=… invoice-ai invoices list --json` works in a clean shell. A revoked key exits `3` | Pipe `--json` into `jq`. Show `echo $?` after success and after a bad key |
| **C2: Writes with confirmation** | `clients create`, `invoices create/issue/send/mark-paid/cancel`, previews, `--yes`, printed idempotency keys | Press Ctrl-C during `send`, re-run with the printed key, and exactly one invoice number and one email result | Show why the prompt refuses to appear in a non-TTY pipe |
| **C3: Browser login + keychain + profiles** | Device flow against `/api/cli/device` and `/api/cli/token`, keychain storage, `--profile`, `logout` | Login completes in the browser and the key appears in Settings → API keys. Denying in the browser stops the CLI with exit `3`. `logout` revokes the key server-side and removes the keychain entry | Show the keychain entry in macOS Keychain Access, then the `0600` fallback file |

## 5. Security and abuse

- **Secrets never go in argv.** `login --api-key` reads stdin, because argv shows up in `ps` and shell history.
- **Device codes:** stored only as `sha256(device_code)`, expire after 10 minutes, and are consumed by the first successful poll. `/api/cli/device` and `/api/cli/token` are rate-limited per IP.
- **The consent page shows the device name** the CLI reported, so a user who didn't run `login` can see that and deny.
- **Tokens are stored in the OS keychain.** The file fallback is `0600` and warns.
- **`--debug` output redacts** `Authorization` headers and tokens.
- **Least privilege:** the consent page pre-ticks every scope except admin-grade ones (`CLI_DEFAULT_SCOPES`; today there are none), and the user can untick any of them, e.g. leave only `*:read` for a reporting laptop.
- **Destructive commands** require confirmation or explicit `--yes`, and the CLI offers no bulk "cancel all" command.

## 6. Open decisions

- **Package name:** `invoice-ai` (short `npx invoice-ai`) vs `@invoice-ai/cli` (scoped, matches the SDK).
- **Distribution:** npm only for v1 vs also Homebrew and standalone binaries (e.g. `bun build --compile`).
- **Item syntax:** `desc:qty:rate_paise:gst` in paise is precise but unfriendly. Consider accepting rupees with an explicit `--rupees` flag.

> ### How the MCP story uses this layer
> `invoice-ai mcp` turns the CLI into the **fastest path to the north-star demo**. Add it to Claude Desktop or Claude Code as a local stdio server, and it reuses whatever credential `invoice-ai login` stored. There's no remote OAuth to set up yet. Claude can "invoice Acme and email it" on the teacher's laptop before phase M3 exists.

## 7. Five-minute demo order

1. `invoice-ai login`. The browser opens, you approve, and the terminal says "Logged in as <business>".
2. `invoice-ai whoami`: shows the credential source (keychain).
3. `invoice-ai invoices create --client "Acme" --item "Consulting:1:2500000:18"`: returns a draft id.
4. `invoice-ai invoices issue <id>`: read the GST preview aloud, type `y`, get the number.
5. `invoice-ai invoices list --json | jq`, then `echo $?` → `0`. *"Humans and scripts, same tool."*
