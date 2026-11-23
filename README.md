# Kasboek

A simple, local-first budget app for Windows, macOS and Linux, with an AI assistant built in
(Claude, or any OpenAI-compatible provider, including local models). Your data stays on your computer, encrypted, and is locked to your computer and login.

> **Privacy first, also in the AI assistant**
>
> - Account and card numbers, e-mail addresses and international phone numbers (starting with + or 00) are hidden before text goes to an AI provider or to a connected app such as Claude Desktop: in chat, CSV checks, PDF reading, tips, memory notes and what you type yourself.
> - Nothing is sent without your agreement. You choose the provider, and PDF reading, "Check with …" and Overview tips each ask first and show exactly what is sent.
> - For a CSV, nothing above the header row is sent, and the assistant can't move the header up past the one Kasboek found. For a PDF, only the rows of the transaction table are sent: everything above the table and the top of every later page is left out. Overview tips send only a short rounded summary.
> - **Use the assistant** (Settings → Assistant) turns the assistant off completely: its panel, buttons, checks, AI tips and every request to an AI provider are gone, and Kasboek works fully on its own (local CSV, PDF and XML import and the local tips stay). It is a per-computer setting, and restoring a backup, export or sync join never turns it on. Claude apps connected over MCP are separate and keep their own switch.
> - Use a local model (Ollama, LM Studio, or any OpenAI-compatible server on your own computer) and everything stays on your computer.
> - Account numbers are also hidden on screen by default (`BE…1234`); hold the eye next to one to see it. The setting is switched back on after restoring a backup or export, or joining sync.
> - The assistant never types amounts into your data: Kasboek checks every amount against your data or the PDF's own text. It can never change its own permissions, settings, keys or addresses.
> - Claude Desktop and Claude Code reach Kasboek through a small helper program on this computer, with no network connection of its own; see [the helper program](#the-helper-program-kasboek-mcp) below.

See [PLAN.md](PLAN.md) for the design, the security model and what still needs testing.

## Screenshots

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/overview-dark.png"><img src="docs/screenshots/overview-light.png" alt="Kasboek Overview with income, spending, budget left, suggestions and spending by category" width="880"></picture>
</p>

<table>
  <tr>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/transactions-dark.png"><img src="docs/screenshots/transactions-light.png" alt="Kasboek Transactions page with filters for account, category and month, a saved search, totals and a list of grocery payments" width="280"></picture><br><sub>Transactions: search, filters and saved searches</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/budgets-dark.png"><img src="docs/screenshots/budgets-light.png" alt="Kasboek Budgets page with a monthly budget per category and progress bars, Dining out over its limit" width="280"></picture><br><sub>Budgets: spending against monthly limits</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/fixed-costs-dark.png"><img src="docs/screenshots/fixed-costs-light.png" alt="Kasboek Fixed costs page listing rent, energy, internet and subscriptions with paid and due status and price changes" width="280"></picture><br><sub>Fixed costs: subscriptions and bills found for you</sub></td>
  </tr>
  <tr>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/goals-dark.png"><img src="docs/screenshots/goals-light.png" alt="Kasboek Savings goals page with progress bars and the amount to set aside per month" width="280"></picture><br><sub>Savings goals</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/net-worth-dark.png"><img src="docs/screenshots/net-worth-light.png" alt="Kasboek Accounts page with a chart of net worth per month and the totals owned and owed" width="280"></picture><br><sub>Net worth over time</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/year-dark.png"><img src="docs/screenshots/year-light.png" alt="Kasboek Year page with a bar chart of income and spending per month" width="280"></picture><br><sub>Year view: months side by side</sub></td>
  </tr>
  <tr>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/import-csv-dark.png"><img src="docs/screenshots/import-csv-light.png" alt="Kasboek import preview of a CSV bank export showing detected columns, categories and one duplicate row" width="280"></picture><br><sub>CSV import preview with detected columns</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/import-pdf-dark.png"><img src="docs/screenshots/import-pdf-light.png" alt="Kasboek import preview of a PDF statement with the banner saying the amounts add up to the closing balance" width="280"></picture><br><sub>PDF statement read on your computer, with balance check</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/settings-assistant-dark.png"><img src="docs/screenshots/settings-assistant-light.png" alt="Kasboek Settings page, Assistant tab, with provider, API key, chat and CSV check models" width="280"></picture><br><sub>Settings: choose your assistant</sub></td>
  </tr>
  <tr>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/assistant-dark.png"><img src="docs/screenshots/assistant-light.png" alt="Kasboek Overview with the assistant panel open, answering how much was spent on groceries last month" width="280"></picture><br><sub>The assistant panel, next to your data</sub></td>
    <td align="center" width="33%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/lock-dark.png"><img src="docs/screenshots/lock-light.png" alt="Kasboek lock screen asking for the password" width="280"></picture><br><sub>Locked until you unlock it</sub></td>
  </tr>
</table>

<sub>The screenshots show invented people, payees and amounts. They follow your GitHub light or dark theme, and account numbers are hidden by default, as in the app. To remake them, see [scripts/screenshots](scripts/screenshots/README.md).</sub>

## What it does

- **Budget**: accounts, transactions (search, filter, edit, bulk categorise or rename, saved
  searches, split one payment over categories), categories, rules ("Supermarket → Groceries", on text,
  whole words or the counterparty's IBAN), monthly budgets, and an overview with income, spending,
  budget left, warnings and a 6-month chart; a year view per category; net worth over time with
  investments and loans; savings goals; fixed costs and subscriptions found from your transactions (if one is wrong, mark it "Not a fixed cost" and it stops counting).
  Refunds lower spending; transfers between your own accounts are paired and left out.
  Dark and light mode, eight languages, number and date formats chosen part by part.
- **Suggestions**: a card on the Overview with tips found from your own data (a price rise, a payment
  taken twice, a late or coming fixed cost, a budget nearly used up, a category that grew, an unusual
  payment). Worked out on your computer: these local tips send nothing anywhere. With an assistant set
  up, "Get tips from …" has it word the best ones as short personal tips, only when you press the button
  (see the Assistant section below). Hide a tip or mark it not useful; turn the card off, or show
  hidden tips again, in Settings → General.
- **First start**: a welcome window sets the language, number and date style, exchange rates, the
  assistant, Claude Desktop / Claude Code and update checks, then offers a short tour of the app.
- **Bank balance**: enter what your bank shows (or let a CSV balance column do it); the balance is
  counted from there, and a later balance that doesn't match shows the difference.
- **Currencies**: each account in its own currency; totals in a main currency at the rate of each
  transaction's date (ECB reference rates, on by default in the welcome window, or your own rates).
  A transfer between your accounts in different currencies is paired at that day's rate; what the
  bank kept on the conversion counts as a fee. Give an account its usual "Exchange cost (%)", or
  change the cost per transfer to the amount on your statement.
- **CSV import**: drop a bank export. Kasboek reads the CSV exports of most large banks and payment
  apps in Europe, the UK, the Americas and beyond, with headers in many languages: dates with the
  day or month first or with month names, decimal commas or points, currency signs, separate
  debit and credit columns or a debit/credit column. Anything it can't place you choose yourself,
  and "Remember this format" keeps your choice for the next file. It flags duplicates (also by
  bank reference, and "maybe imported" when the bank changed the text), applies your rules and the
  names you tidied before, and shows everything before saving. Undo per import. Export to CSV, and
  a year report as PDF.
- **PDF statements**: drop a bank statement as PDF (one with selectable text; scans and photos are
  not read). Kasboek finds the table of transactions on this computer, in a separate reader process;
  the file is not sent anywhere. It checks the rows against the opening and closing balance printed
  on the statement and says so when they don't add up (and suggests flipping the signs for a credit
  card statement). Password-protected PDFs have to be unlocked first. Reading on this computer sends
  nothing anywhere. Where no table is found, or the rows don't add up to the statement, you can
  choose "Read with …" (needs an assistant): after you agree in a dialog that shows exactly what is
  sent, only the statement's text goes to your provider, never the PDF. Account and card numbers are
  hidden and the part above the table (your name and address) is left out. The assistant points out
  which lines form each transaction and copies its date and amount; Kasboek checks that every one
  of them is really in those lines, reads each amount from the PDF's own text, and shows every row
  (the ones it can't confirm as problems) before anything is saved. Up to 40 pages, in parts of 4.
  If no assistant is set up, ask the bank for a CSV.
- **XML statements (CAMT.053)**: drop the ISO 20022 statement many European banks offer (Hello bank,
  Argenta, Keytrade, ING and others; CAMT.052 and CAMT.054 lists of entries are read too, any
  version). It is read on this computer by a small built-in reader: nothing is sent anywhere, no
  DTD or entity is ever followed (such a file is refused), and files over 20 MB or with more than
  50,000 entries are refused. Every field is read exactly as the file states it: the amount and the
  credit/debit indicator give the sign (never a guess), then booking and value date, counterparty
  name and IBAN, the payment message and the bank's reference (used to flag duplicates). A batch
  payment becomes one row per payment when their amounts add up to the entry. Entries that are not
  booked yet are left out and counted. The opening and closing balances go through the same check as
  a PDF and the closing balance is recorded after the import. A file with several accounts uses the
  statements whose IBAN matches the account you chose (give the account its IBAN); a file of one
  other account opens with a remark. An amount in another currency than the account is flagged,
  like in a CSV. Preview, duplicates, rules, "Flip signs" and undo work as for CSV.
- **Assistant**: ask questions about your money or let the assistant make changes. You choose which
  kinds of change it may make by itself and which wait for your OK (Settings → Assistant → "What
  the assistant may do by itself"), how much it reasons per model, and what it remembers between conversations
  (kept encrypted on this computer only). "Check with …" categorises a CSV, makes names readable, suggests rules and
  sorts older uncategorised transactions, showing its reasoning in the assistant panel; a monthly
  review on the Overview. Claude, Mistral, Groq,
  DeepSeek, Gemini, OpenRouter, Together, Fireworks, Ollama, LM Studio or any OpenAI-compatible server.
- **MCP**: use Kasboek from Claude Desktop or Claude Code, added with one click (welcome window or
  Settings → Assistant). Settings shows whether each app is connected now or when it last used
  Kasboek; a tray icon shows the connection and can stop it. When Claude Desktop starts Kasboek's
  connection and Kasboek isn't running, Kasboek starts in the tray, locked. Closing the window quits
  Kasboek (on a Mac it stays in the Dock until Cmd+Q); Settings → General → "Keep Kasboek running in the
  tray when I close the window" (off by default) hides it in the tray instead. Opening Kasboek from its
  shortcut or the Start menu while it runs always brings its window to the front.
- **Sync**: keep several computers in step through a cloud folder you already use, or your own
  WebDAV server (Nextcloud, ownCloud, Synology, a NAS, …); only encrypted files go there, and changes
  merge per field.
- **Same everywhere**: Windows, macOS and Linux use the same encrypted database and the same export
  format, so an export from one opens on any other (with your login).
- **Security**: password (Argon2id) or passwordless (Windows Hello / Touch ID), optional two-factor codes,
  recovery key, auto-lock. Encrypted database; the data folder can't be opened on another
  computer. Moving computers only works through an encrypted **export** that opens with your login.
- **Backups**: automatic and encrypted, after important changes and daily, kept by age (24 hours,
  30 days, a year), to a folder you choose.
- **Updates**: a button at the top when a new release is out; Kasboek downloads, checks and
  installs it. The version you run is shown at the bottom of the menu.

## Run it

**Using Kasboek needs nothing else:** the installers (MSI, DMG, AppImage, .deb) contain everything,
including the runtime Kasboek runs on (Electron, with its own built-in Node.js). Node.js is only
needed to work on Kasboek's source code.

For development: Node.js 22.12 or newer. Nothing is compiled: the encrypted database engine ships
prebuilt 64-bit binaries for Windows, macOS and Linux (x64 and ARM64).

```bash
npm install
npm run dev        # start the app with hot reload
```

## Installers (64-bit only)

| OS | Files | Architectures |
|---|---|---|
| Windows | `.msi` installer | x64, ARM64 |
| macOS | `.dmg`, one per chip | Apple Silicon (arm64), Intel (x64) |
| Linux | `.AppImage` and `.deb` | x64, ARM64 |

**Download**: the repository's **Releases** page has every installer for each version.

**Updates from the app**: Kasboek asks GitHub for the latest release at start and once a day
(switch in the welcome window and in Settings; GitHub sees the IP address, nothing else is sent).
A newer release shows an "Update to …" button at the top. The download is checked against the
SHA-256 GitHub reports for the file (or the release's `SHA256SUMS.txt`), the data is backed up to
`safety-backups`, then: on Windows, Kasboek closes and a small Kasboek window shows the
installation progress (in your language) while the MSI is installed, and Kasboek reopens by itself;
if that window can't be shown, Windows Installer's own progress dialog is used instead; if the update
can't be started at all, Kasboek stays open and shows an error (details in `updates/helper.log`); an AppImage replaces
itself; a `.deb` or `.dmg` is opened for you to finish. Only published releases count: test builds
on the Actions page are not offered.

**Publish a new version**: raise the version (`npm version patch --no-git-tag-version`, or `minor`
for new features), update `.github/release-notes.md`, commit and push. Then run the **Build
installers** workflow with “Publish as a release” ticked (or push a matching tag, `v0.13.1`). It
builds every OS on a real machine of that OS and attaches the files, with `SHA256SUMS.txt`, to a
new Release. Without “Publish as a release” it makes a test build whose files stay under the run's
Artifacts for 90 days.

Locally, each OS builds its own installers: `npm run dist:win`, `npm run dist:mac`,
`npm run dist:linux`. (The Linux packages can also be built on other systems; the `.msi` needs
Windows.)

**A white or empty window?** Some graphics drivers (notably on Windows on ARM / Snapdragon) can't
show Kasboek's window. Kasboek then draws without the graphics card: by default on Windows on ARM,
and on any computer after the graphics card failed to show it at a start (Kasboek restarts once by
itself). Settings → General → Graphics card changes it; `startup.log` in the data folder says what happened.

**Uninstalling** removes the program, its shortcuts, registry entries, caches and Kasboek's
entries in Claude Desktop and Claude Code. Your data stays, so a reinstall picks up where you left
off. To delete it too, run the same installer again, choose Remove and tick “Also delete my Kasboek data”. Sync and backup folders are never touched.

**Signing.** Without certificates, Windows SmartScreen shows “Windows protected your PC” on first
install (More info → Run anyway), and macOS shows “cannot verify the developer” (right-click the
app → Open, once). The Mac app is ad-hoc signed so it runs on Apple Silicon. To sign properly,
add `CSC_LINK` / `CSC_KEY_PASSWORD` repository secrets (Apple Developer ID, or a Windows
code-signing certificate).

## Assistant

1. In the welcome window or Settings → Assistant, choose a provider. For Claude, create an API key at
   console.anthropic.com (billed by Anthropic, separately from Claude.ai); other providers have
   their own key page, linked there. Ollama and LM Studio run on your computer and need no key.
2. Add the key. It is stored inside your encrypted data, separately per provider.
3. Claude defaults: chat with Claude Sonnet 5.5 (medium effort), CSV checks with Claude Opus 5.5
   (medium). Other providers: type a model name or load the list from the provider.

Messages, the data the assistant looks up and what it remembers go to the chosen provider (or
stay on your computer for local models). Nothing is sent until you ask. "Check with …" on a CSV
asks first, once per provider, address and model (asked again when any of them changes, or when what
is sent changes), and the dialog shows exactly what is sent: the payees and descriptions of the file
and of your uncategorised transactions, the first rows as written, your categories and rules, and
the notes the assistant remembered, all with account and card numbers shortened (IBANs and runs of
13 or more digits). The rest of the file and transactions that already have a category are not
sent. "Read with …" on a PDF statement sends
only the statement's extracted text, masked as described under PDF statements, and only after you
agree in a dialog every time (there is no "don't ask again"; it also says how many of your edited rows the reading replaces). "Get tips from …" on the Overview's
Suggestions card sends a short summary made on your computer: the kind of each finding (a price rise,
a budget over its limit, …), payee or category names (account and card numbers hidden, cut to 40
characters) and amounts rounded to whole units. Never sent: account names, balances, income, your
transactions or their descriptions. It only runs when you press the button, after you agreed once
for that provider (asked again if you switch provider or if what is sent changes), and the dialog
shows exactly what is sent. The assistant only picks and words the tips: it can't write numbers,
Kasboek fills in every amount and date from your own data and drops any tip that doesn't check out.
Tips are kept on this computer only (not synced). Text inside imported files is treated
as data from the bank, never as instructions, and saving a PDF import always waits for your OK, also
when the assistant may otherwise import by itself.

**Permissions**: "Ask first" (the default), "Smart", "Full access" or "Custom" (a choice per kind of
change). In "Smart", balances, deleting rules, new accounts, importing and the assistant's memory ask
unless you allow them; changes to more than 100 transactions always ask, except in "Full access".
Even in "Full access", saving an import read from a PDF and changes asked for through Claude Desktop
or Claude Code still ask (that last one has its own switch, "Claude Desktop and Claude Code always ask"), and the assistant can never change
settings, keys, addresses or its own permissions. Changes made without asking show in the chat.

**Memory**: say "remember that …", or add items in Settings → Assistant → "What the assistant remembers". Up to
50 short items, stored in the encrypted database, not synced and not offered to Claude apps over
MCP. Account and card numbers are refused. Switch it off to stop sending it.

**Claude Desktop / Claude Code (MCP)**: switch on “Claude Desktop & Claude Code (MCP)” in
Settings → Assistant and press “Add to Claude Desktop” or “Add to Claude Code”. It works while
Kasboek is running and unlocked; changes wait for your approval in Kasboek.

### The helper program kasboek-mcp

`kasboek-mcp` (`kasboek-mcp.exe` on Windows) is a small separate program installed next to Kasboek, in
its resources folder. Claude Desktop and Claude Code start it, and it passes their requests to Kasboek over a
local channel on this computer (a named pipe on Windows, a Unix socket elsewhere), with a token for each
session. It makes no network connection and holds no keys or database.

- **Only while Kasboek runs and is unlocked**, and only with “Claude Desktop & Claude Code (MCP)” switched on
  in Settings → Assistant. If Kasboek isn't running when Claude starts the helper, the helper starts Kasboek
  in the tray, locked, so you can unlock it.
- **What a connected app can do**: read accounts, balances, transactions, categories, budgets, goals, rules,
  recurring costs, transfers, summaries and imports, and make changes to them (categorise, split, rename,
  edit, set budgets, save an import, and similar). Every change waits for your approval in Kasboek. “Claude
  Desktop and Claude Code always ask” is on by default; if you switch it off, your usual permissions decide.
- **What it can never do**: unlock Kasboek, change settings, keys, addresses or permissions, or delete
  transactions, goals, import batches or memory notes. Account and card numbers, e-mail addresses and
  international phone numbers are hidden in what it returns.
- **Windows updates**: the helper also installs Kasboek updates. Kasboek makes its safety backup, then runs a
  copy of the helper with `--apply-update`. It waits for Kasboek to close, checks the downloaded installer's
  SHA-256, shows a small progress window, runs Windows Installer (msiexec), and starts Kasboek again. It does
  nothing else.
- **Turn it off or remove it**: the MCP switch in Settings → Assistant stops the connection; the assistant's
  own switch doesn't affect it. To remove Kasboek from the Claude apps, use “Remove from Claude Desktop” or
  “Remove from Claude Code” in the same section. Uninstalling Kasboek also removes these entries.
- **Open source**: the helper's code is in [tools/kasboek-mcp](tools/kasboek-mcp) (GPL-3.0-only), and the
  Build installers workflow builds it from that source.

## Sync

Settings → Backups & sync → Sync between computers → Choose folder (a folder your cloud app syncs),
or WebDAV server (address, user name, preferably an app password). On the other computer: Join a
sync folder (or Join through WebDAV), then your password and 2FA code (or recovery key). Kasboek writes
encrypted change files there; the key never leaves your encrypted data except inside an
encrypted snapshot. Passwordless sign-in is set up per computer.

The file formats (exports, the database, sync files) are described in
[docs/FORMATS.md](docs/FORMATS.md), for a future phone app; `src/core/portable.ts` reads them
without Node.js.

## Checks

```bash
npm run typecheck
npm test            # runs under Electron's Node, so the native module matches
npm run check:i18n  # every text key exists in en.json, and every translation matches it
npm run test:mcp    # the Go MCP helper
```

## Where your data lives

| OS | Folder |
|---|---|
| Windows | `%APPDATA%\Kasboek` |
| macOS | `~/Library/Application Support/Kasboek` |
| Linux | `~/.config/Kasboek` |

- `kasboek.db`: encrypted database
- `account.json`: login key slots, sealed by the operating system (only opens on this computer and account)
- `prefs.json`: theme, language, formats, auto-lock, graphics card, keep in the tray (nothing sensitive)
- `sync.json`: this computer's sync id and folder, when syncing
- `safety-backups/`: copies made automatically before an import and before an update
- `updates/`: a downloaded update while it installs
- `startup.log`: what happened during the last start (version, system, graphics card, steps with
  timings, whether it was the first start of this version), never your data; useful when Kasboek
  doesn't open properly or starts slowly. The start before it is kept as `startup.prev.log`.

The assistant's memory, settings that sync and everything you enter live inside `kasboek.db`.

Copying this folder to another computer does **not** work, by design. Use Settings → Backups & sync
→ Move to another computer → Export, then Import on the new computer with your password and 2FA code (or
your recovery key).

## Project layout

```
src/shared/       operation contract, types, amount/month helpers (used everywhere)
src/core/         database, migrations, account & crypto, export format, finance, CSV import,
                  assistant tool loop (no Electron; unit-tested)
src/main/         Electron main: window & security, IPC, session/lock, OS keychain,
                  Windows Hello / Touch ID, backups, sync, AI providers, MCP bridge
tools/kasboek-mcp/  the small Go helper Claude apps start for MCP
src/preload/      the small bridge exposed to the page
src/renderer/     React UI, theme tokens, i18n strings (src/renderer/src/i18n/locales)
assets/brand/     logo and icon sources;  npm run icons  regenerates build/ icons
tests/            unit tests, CSV fixtures and bank samples (tests/banks.test.ts)
```

## Adding a language

Copy `src/renderer/src/i18n/locales/en.json` to e.g. `it.json`, translate the values, add it to
`LANGUAGES` in `src/shared/languages.ts` and to the resources in `src/renderer/src/i18n/index.ts`.
A regional variant can hold only the texts that differ (see `scripts/regional-locales.py`).
`npm run check:i18n` lists missing keys and placeholder mistakes.

## License

Kasboek is free software under the [GNU General Public License v3.0 only](LICENSE) (`GPL-3.0-only`):
you may use, study, share and change it, and if you share a changed version you must do so under the
same licence, with its source. There is no warranty. Third-party components keep their own licences
(see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Copyright (C) 2026 divemost
