# Kasboek — plan

A simple, clean, local-first budget app for the desktop, which Claude (and later any LLM) can operate.

## Decisions

| Topic | Decision |
|---|---|
| Platform | Desktop app for Windows, macOS and Linux, **64-bit only** (x64 and ARM64); same database and export format everywhere |
| Stack | Electron + React + TypeScript (electron-vite), Tailwind CSS |
| Storage | Local only. One SQLite file, **encrypted** (SQLite3 Multiple Ciphers, ChaCha20-Poly1305), native prebuilt engine on every OS |
| Language | English UI; every string goes through i18next so more languages are a JSON file away |
| Banks | Argenta, Hello bank!, Keytrade Bank (plus a generic “other”) |
| Money | Integer cents, EUR by default, Belgian number/date formats |
| Look | Dark and light mode with a green accent; Lato (text and numbers, bundled as “Kasboek Sans”) + Playfair Display (titles and buttons, bundled as “Kasboek Display”), both SIL OFL |

Anthropic’s own typefaces are licensed, so free ones are used: Lato for text and numbers (amounts line up
with tabular figures) and Playfair Display for page titles and buttons. Both are renamed per their Reserved Font Names.

## Architecture

```
┌─────────────── Renderer (React UI) ───────────────┐
│  sandboxed, no Node access, strict CSP            │
└──────────────┬────────────────────────────────────┘
               │ window.kasboek.invoke(op, input)   (one IPC channel)
┌──────────────▼──────────── Main process ──────────┐
│  Operation registry  ← Zod-validated, audit-logged │
│    core ops (accounts, categories, budgets, …)     │──► later: Claude tools (Phase 4), MCP (Phase 5)
│    desktop ops (file dialogs, backups, keychain)   │
│  Encrypted SQLite · OS keychain · backup service   │
└────────────────────────────────────────────────────┘
```

* `src/shared/contract.ts` lists every operation with its input schema. The UI, the in-app Claude
  chat and the MCP server all go through the same list, so an AI can never do something the
  UI couldn’t, and every change is validated and written to `audit_log` with who did it
  (`user`, `assistant` or `system`).
* Operations are marked `assistant: true/false`. Desktop-only actions (file dialogs, restore,
  passwords) are never offered to an AI.

## Login, device binding and moving computers

**Signing in** (chosen at first start, changeable later)
* **Password**: the master key is unlocked with your password, hashed with **Argon2id** (128 MiB, 3 passes, 4 lanes; RFC 9106). Older scrypt slots still open and are upgraded on the next unlock.
* **Passwordless**: unlock with **Windows Hello** (face, fingerprint or PIN) or **Touch ID**.
  The master key is protected by the operating system account; Hello/Touch ID confirms it’s you.
  Password mode is stronger: passwordless doesn’t protect against malware running as you.
* **Two-factor authentication (optional, both modes)**: 6-digit codes from an authenticator app
  (Microsoft Authenticator, Google Authenticator, 1Password, …), TOTP / RFC 6238. Set up with a QR code.
* **Recovery key**: shown once at setup (write it down or print it). Unlocks if you forget the
  password or lose your phone, and is how passwordless accounts move to another computer.
* Wrong attempts slow down (increasing waits). **Auto-lock** after inactivity, when the screen
  locks or the computer sleeps. Lock now at any time.

**Key hierarchy**
```
password ─Argon2id─►┐
recovery key ─────┼─► master key M ─► vault { database key, 2FA secret }
Windows Hello ────┘        (each is a "key slot" that unwraps M)
everything above, on disk ─► sealed again by the OS (DPAPI / Keychain / keyring) = device binding
```

**Device binding: copying the data folder doesn’t work.** The account file is sealed by this
computer’s operating-system account. A copy on another computer (or another Windows user) can’t
be opened, not even with the right password. Without the password (or Hello), it can’t be
opened on this computer either.

**Moving computers / backups: the only way out**
* **Export** (Settings → Move to another computer) writes one `.kasboek` file. It contains the
  encrypted database and vault, sealed with AES-256-GCM under the master key, plus the password
  and recovery key slots, but **no device layer**.
* It only opens through **Import** in Kasboek on the new computer, with your **password and
  2FA code** (or the recovery key). There’s no other way to read it.
* **Automatic backups** use the same format and protection, so a dead laptop isn’t lost data.
  They’re made while Kasboek is unlocked, without asking for your password.
* Changing your password doesn’t change older exports: they keep opening with the password
  that was current when they were made.
* 2FA is checked by the app. The encryption itself rests on the password/recovery key and
  (locally) the device. This is the honest limit of offline 2FA.

**Hardening** (from Phase 1): context isolation, sandboxed renderer, strict CSP, no navigation or
pop-ups, all permission requests denied, one IPC channel that only accepts the app’s own page,
Electron fuses in packaged builds. While locked, the database is closed and only login
operations are accepted.

## CSV import (Phase 4–5)

1. **Parse in code**: detect encoding (UTF-8 BOM / Windows-1252), delimiter (`;` is typical in
   Belgium), header row (some exports have lines above it), decimal commas, `dd/mm/yyyy` dates.
2. **Known bank?** Match the header row against saved profiles (Argenta, Hello bank!, Keytrade).
   A match means no AI is needed.
3. **Claude checks** unknown or messy files. It sees the header and sample rows and returns a
   strict JSON **mapping plan** plus specific row fixes and category suggestions. Claude does not
   retype amounts: code applies the plan, so numbers can’t be invented and token costs stay low.
4. **Validate in code**: dates valid, amounts parse, running totals match where the bank gives a
   balance, duplicates against existing transactions (fingerprint of date + amount + counterparty + reference).
5. **Preview**: you see fixes, suspected duplicates and uncategorised rows, and approve. Only then
   is anything written.
6. The mapping is saved as a profile, so the next file from that bank imports instantly.

Belgian specifics handled: structured communication (`+++123/4567/89012+++`), BE IBANs,
own-account transfers (matched by IBAN, categorised as transfers, not spending).

**What I need from you for Phase 3:** one real CSV export from each bank. You can blank out
names and amounts; the column layout is what matters.

## Claude (Phase 5) and MCP (Phase 6)

* **In-app chat** (side panel): Claude uses the operation registry as tools. Questions are answered
  from your data; anything that changes data shows an Approve / Decline card first. Input is
  validated before you are asked. The conversation lives in memory and is cleared on lock.
* **Check with Claude** on the import screen: Claude returns a strict JSON plan (columns, row fixes,
  categories, notes). Code applies it through the same checks as a manual edit; a mapping that
  reads fewer rows than the detected one is rejected.
* **API key**: stored inside the encrypted database (so it is protected by your login and moves
  with an export), never sent to the page; requests go from the main process only.
* **Refusal fallbacks**: Opus 5.5, Sonnet 5.5 and Fable 5.2 requests use server-side fallbacks, so a
  safety-classifier decline is retried on a suitable model in the same call.
* **Assistant off switch** (`assistantEnabled`, default on, this computer only, Settings → Assistant,
  at the top): turns the whole assistant off. The page hides the panel and its toggle, the review,
  tips, check and PDF-read buttons with their consent dialogs, the Settings content (except the
  switch and the Claude apps section), the tour and welcome steps and the page context; the local
  tips and the local CSV/PDF/XML import stay. The main process refuses every assistant operation
  (`assistant.*`, `import.assist*`/`pdfAssist*`, `insights.preview/run/cancel/status`, `memory.*`,
  `summary.review` for the app's own pages) with `assistant.disabled` (`main/assistant-guard.ts`), and
  `activeProvider` / the Claude client refuse too, so no request reaches a provider. Switching it off
  cancels running jobs and clears the chat. An import or sync join never switches it on: it is not in
  `UNTRUSTED_AFTER_IMPORT`, and if it is off on this computer the restored data is written off too.
  MCP is separate (own switch, tool list unchanged).
* **MCP server**: `Kasboek --mcp` is a stdio MCP server for Claude Desktop, Claude Code or any MCP
  client. It holds no keys and opens no database: it forwards calls over a named pipe / Unix socket
  (per-start token) to the running app, which must be unlocked with MCP switched on. Changes wait
  for approval in the app.
* **Privacy audit of tool results**: results left through `compactResult` (chat and MCP) with no
  masking, so IBANs, card numbers, e-mail, phone numbers and the holder's lines above a CSV table
  could reach the AI provider. Fixed in one deep pass (`maskResult` in `assistant/tools.ts`): every
  text is run through `maskContacts` + `maskNumbers`, `iban` / `counterpartyIban` / the pattern of an
  iban rule show as `CC…1234`; `import.raw` returns `preambleLines` (a count) instead of the text;
  `settings.get` drops backup folder/file and base URLs; the 60-character shortenings of rule
  examples, recurring names and review names mask before cutting. Rules on an account number are made
  with `fromTransactionId` (filled locally); the assistant cannot pass a masked or invalid number.
  Test: `tests/assistant-masking.test.ts`.
* **Review of the 0.22.0 masking (fixed)**: one `maskPrivate(text, max?)` in `shared/iban.ts` (numbers and
  IBANs first, then e-mail and phone: the other way round the phone rule ate groups of spaced IBANs) is used
  for tool results, the PDF text, the CSV check, the page context, tips names, the memory in the system
  prompt and the typed chat message. Texts are folded first (NFKC, one space, zero-width gone, one hyphen);
  IBAN and card groups may be separated by space, dot, hyphen or slash; dates and amounts stay;
  `maskAccount` shows at most `CC…1234` (`…1234` for a local number). E-mail is a scan from each `@` with
  limits (it was quadratic) and strings are cut at 2,000 characters before masking; `maskResult` no longer
  passes a subtree deeper than 30 levels (it gives `…`). Recurring and review names stay raw in core (rules
  and searches are made from them; cut by `cutText` so no number is cut in two) and are masked in
  `compactResult` and, on screen, by `<Masked>`. Transaction rows no longer nest the eye in a button,
  the eye stops click propagation and says what it reveals; text fields show masked until focused
  (`MaskedInput`); `rules.preview` takes `fromTransactionId`; the assistant cannot move an account number
  rule to another field without a new pattern; the assistant gets no CSV row above the header found on
  opening (`headerFloor` in `core/import.ts`) and cannot remap above it; a PDF sends only table rows
  (later pages from their first transaction line); "no transaction rows found" is its own message.
  `hideAccountNumbers` is switched back ON after restoring a backup or export or joining sync (also for
  the person's own backup), like the other settings a file must not bring.
  Accepted: masked text can be guessed back by searching (the search runs on the real data and the
  assistant can see how many rows match); a CSV where no header is detected has no floor, so rows below
  the first line are visible to the assistant; a typed `+`/`00` rule means only international phone
  numbers are hidden.
* **Other LLMs later**: everything goes through the operation contract, whose input schemas are
  plain JSON Schema for tools. MCP already works with any MCP-capable client; an in-app adapter
  for another provider would replace `src/main/assistant/claude.ts`.

## Models and effort

**Building the app (Claude Code)**
* Phases 1–4 (data model, security, CSV pipeline, AI integration): **Claude Opus 5.5, effort high**.
* UI polish and small changes: Opus 5.5, effort medium.
* Fable 5.2 is stronger but about twice the price; not needed for a project this size.

**Inside the app** (switchable in Settings)

| Task | Model | Effort |
|---|---|---|
| CSV check and mapping plan | Claude Opus 5.5 | medium |
| Chat questions and commands | Claude Sonnet 5.5 | low–medium |
| Bulk categorisation (optional) | Claude Haiku 5.5 | low |

You’ll need an Anthropic API key (console.anthropic.com). It’s billed separately from a Claude.ai subscription.

## Phases

| # | Scope | Status |
|---|---|---|
| 1 | Project setup, theme, layout, encrypted DB, OS keychain, encrypted backups, i18n, accounts, app icons, packaging | Done |
| 2 | **Login & device security**: password or passwordless (Windows Hello / Touch ID), 2FA (TOTP), recovery key, lock screen, auto-lock, device binding, encrypted **export/import for moving computers**, backups moved onto login credentials | Done |
| 3 | Transactions (list, search, edit, bulk categorise), categories, rules, monthly budgets, overview with real numbers and charts | Done |
| 4 | CSV pipeline in code: encoding/delimiter/header detection, Argenta / Hello bank! / Keytrade profiles, preview, duplicates, import, undo import | Done |
| 5 | Claude: API key and model settings, chat panel with tools and confirmations, CSV assistant | Done |
| 6 | MCP server for Claude Desktop / Claude Code | Done |
| 7 | Tests with bank fixtures, polish, docs, release builds for all three OSes | Done (needs a real Windows run, see below) |

## Brand

`assets/brand/` holds the source SVGs: `icon.svg` (app icon), `icon-small.svg` (16–32 px),
`icon-light.svg`, `mark.svg` (bare mark, follows the text colour). `npm run icons` regenerates
`build/icon.ico` (Windows), `build/icon.icns` (macOS), `build/icons/*.png` (Linux) and the
window icon. The mark is a **K** whose bright upper arm stands for money in and dimmed lower
arm for money out.

## Status and what still needs a real computer

Built and tested here (Linux, automated): 31 unit tests (crypto, TOTP test vectors, key slots,
export format and tampering, budgets and summaries, CSV parsing for the three bank layouts,
import duplicates/undo, the assistant loop) and end-to-end runs of the real app for setup,
lock/unlock, 2FA, recovery, export → import on a "new computer", passwordless (simulated),
transactions, budgets, CSV import, Claude chat and CSV check (against a local mock of the API)
and MCP with a real MCP client.

Not possible to test here, please check on your machine:
1. **Windows Hello** prompt (via PowerShell / WinRT) and **Touch ID**: simulated in tests only.
2. **DPAPI device binding**: copy `%APPDATA%\Kasboek` to another PC or Windows user and confirm it
   refuses to open (the error path is tested; the real DPAPI behaviour can only be seen on Windows).
3. **Real Claude calls** with your API key (tested against a mock with the same request format).
4. **Your real bank exports**: the fixtures imitate the layouts; send one anonymised export per
   bank to confirm (the column editor and "Check with Claude" cover differences).
5. **Installers**: `.exe` (Windows x64) and the Linux AppImage/.deb (x64, ARM64) were built here;
   the `.msi` and the universal `.dmg` are built by the GitHub Actions workflow on real Windows and
   macOS machines. Unsigned until certificates are added (see README → Installers).

## Next release (backlog)

Installer feedback from testing the 0.9.0 `.msi` on Windows:

1. **Installer: choose shortcuts, and update an existing install.** Installing a new version over an
   older one must upgrade it in place (same install folder, data untouched, no duplicate entry in
   Apps & Features), for both the `.msi` (fixed UpgradeCode, MajorUpgrade) and the `.exe`.
   **Let people choose the shortcuts.** The installer creates the desktop and Start menu shortcuts
   without asking. Add two ticked-by-default checkboxes ("Desktop shortcut", "Start menu
   shortcut") on a page before installing. For the `.msi` this needs a custom WiX dialog
   (electron-builder's built-in MSI UI has no such options; `msiProjectCreated` can edit the
   generated WiX project). The NSIS `.exe` can do it with a small `include` script.
2. **Kasboek branding in the `.msi` wizard.** The setup dialogs still show WiX's default red disk
   (banner top right, large image on the welcome/finish pages). Provide our own images in
   `build/` (WiX sizes: banner 493×58, dialog 493×312, as .bmp/.png) generated from
   `assets/brand/`, and wire them in as `WixUIBannerBmp` / `WixUIDialogBmp`. Check the `.exe`
   installer's sidebar image at the same time.
3. **Launch window (splash screen).** After starting Kasboek nothing appears for a moment, so it
   isn't clear the app is opening. Show a small window immediately (logo, "Kasboek", light/dark
   theme) with a **loading animation and a progress bar** that moves through the real start-up
   steps (starting, opening your data, loading the interface), so it's visibly working. Close it
   when the main window is ready. Also look at what makes start-up slow (opening the encrypted account, the Windows
   Hello availability check, loading the UI bundle) and trim it.
4. **Account names instead of bank presets.** No fixed list of bank names: people name each
   account and its bank themselves (free text, e.g. "KBC zichtrekening"). The CSV import keeps
   recognising file layouts from their column names (Dutch, French, English, German), whichever
   bank they come from, and remembers each layout after the first import.
5. **Backups at the right moments, with tiers.** Today: one full backup a day, keeping the last N.
   Add a backup right after important changes (CSV import, restore, bulk edits) and when closing
   Kasboek, and keep them in tiers: every change for the last 24 hours, one per day for 30 days,
   one per month for 12 months. Every copy stays a complete, independent encrypted export (no
   chains of incremental pieces, which break if one piece is lost); the database is small enough
   that full copies are fast. Show the backup list with dates in Settings, with restore.
6. **Stronger password rules.** Minimum 12 characters, at least three of: lowercase, uppercase,
   digits, symbols; refused if it is on a built-in list of common/breached passwords, contains
   "kasboek", or is mostly one repeated character/sequence; a live strength meter (zxcvbn-style)
   that must reach "strong". Long passphrases (several random words) pass easily and are
   encouraged. Applies to new passwords and password changes; existing users are asked to choose
   a stronger one at their next unlock. Matters even more once sync puts encrypted data in the
   cloud, where it could be attacked offline.
7. **2FA: "Remember this computer for 30 days".** Optional tick box when entering the 2FA code.
   This computer then only asks for the password (or Windows Hello / Touch ID) for 30 days; other
   computers, imports and exports still ask for the code. The "remembered" mark is sealed by the
   OS (so it can't be copied to another computer), is cleared by changing the password, turning
   2FA off/on, or "Forget remembered computers" in Settings, and never applies to the recovery
   key flow.
8. **Sync between computers (Windows, macOS, Linux).** Done: through a cloud folder the person
   chooses, no Kasboek server. Triggers record every change; each computer writes numbered,
   AES-256-GCM encrypted change files (key inside the encrypted database), merged per field with
   hybrid-clock timestamps (later change wins, a deletion wins over edits, a note is kept when two
   computers changed the same field). Joining opens the newest snapshot (an export: password and
   2FA code, or the recovery key) and then follows the change files. Old change files are removed
   once every active computer and snapshot has them. Phone app: later.
9. **One-click MCP setup for Claude Desktop and Claude Code** (Settings → Claude).
   - *Add to Claude Desktop*: finds `claude_desktop_config.json` (Windows `%APPDATA%\Claude\`,
     macOS `~/Library/Application Support/Claude/`), shows the exact entry it will add, then adds
     or updates only `mcpServers.kasboek` and keeps everything else. Backs up the file first,
     writes atomically, and stops with an explanation (never overwrites) if the file isn't valid
     JSON. Says to restart Claude Desktop. A *Remove* button undoes it. Linux: no official Claude
     Desktop, keep the snippet. Also evaluate Claude Desktop's one-click extension format.
   - *Add to Claude Code*: if `claude` is on the PATH, runs `claude mcp add --scope user kasboek
     -- <Kasboek> --mcp` after confirmation and shows the result; otherwise keeps the copyable
     command. A *Remove* button runs `claude mcp remove kasboek`.
   - Only ever on a button press, with the change shown first.
10. **MCP on Windows (bug in 0.9.0).** Claude Desktop starts `Kasboek.exe --mcp`, which exits
    after about a second: Electron's windowed app on Windows has no usable stdin, so the stdio MCP
    connection closes. Fix: ship a small console helper `kasboek-mcp` (Go, ~5 MB, no runtime) next
    to Kasboek on every OS. It speaks MCP over stdio and forwards to the running, unlocked app over
    the existing local channel; it holds no keys and opens no database. Config points to it.
11. ~~**Import an Excel budget workbook**~~ Dropped for now, at the owner's request.
12. **Investments.** Investment accounts per broker: money paid in, portfolio value at the end of
    each month (typed in or imported), and a portfolio chart.
13. **Net worth over time.** Current accounts + savings + portfolio per month, with a chart, and the
    year-end value.
14. **Year view.** Income vs spending for all 12 months, totals per category per year, and a
    comparison of years (the overviews a yearly spreadsheet gives).
15. **Number and date format, each set separately.** Not tied to a language or country: choose
    the decimal mark (`,` or `.`), the thousands separator (`.` `,` space, `'` or none), where the
    currency symbol goes and whether it is a symbol or code, how negative amounts look, the date
    order (DMY/MDY/YMD), the date separator, and the first day of the week. Presets only fill these
    in; every option can still be changed.
16. **Accounts in different currencies.** Each account has its own currency and amounts are stored
    and shown exactly as the bank reports them. One main currency for overviews, budgets and net
    worth: other currencies are converted at the rate of the transaction's own date (net worth at
    month-end rates). Rates from the European Central Bank's free daily reference rates (only the
    public rate list is downloaded, nothing is sent), stored locally; can be switched off in favour
    of rates typed in by hand. Converted figures are marked as such, originals stay visible.
17. **More languages.** English, Dutch (Flemish), French, German, Spanish (Spain), Spanish (Latin
    America), Portuguese (Portugal), Portuguese (Brazil), Italian, Polish and Turkish; others can be
    added as one file each. Language is separate from the number and date format (item 15).
18. **Other AI providers (OpenAI-compatible).** Besides Claude, any provider with an
    OpenAI-compatible chat API: ready-made setups for Claude, Mistral, Groq, DeepSeek, Ollama,
    LM Studio, OpenRouter, Together, Fireworks and Gemini, plus a custom endpoint. Each with its
    own key (kept in the encrypted data), base URL and model. Local options (Ollama, LM Studio)
    keep everything on the computer. Tool use and confirmations work the same; providers without
    tool calling get chat without changes.
19. **Automatic release step**: GitHub returned 403 when the workflow created the release, even with
   Contents: write (most likely a tag ruleset). Find the cause so tagging a version publishes it.
20. **Uninstalling from Windows' Installed apps should let people choose what to remove.** Today
   "Uninstall" there removes the program silently and always keeps the data (the Settings route shows
   no dialogs, see `build/msi-project.cjs`, step 3b), so a person who wants everything gone has to
   know to run the installer again, choose Remove and tick "Also delete my Kasboek data". Make the
   Installed apps entry (Uninstall, or Modify) open the installer's own maintenance screen, with
   Repair and Remove, and on Remove the "Also delete my Kasboek data" choice, so the person decides
   there whether to erase everything or keep the data. Check how the `.msi` registers its
   uninstall entry (`ARPNOREMOVE`, `ARPNOMODIFY`, a custom uninstall command running
   `msiexec /i <product> ` instead of `/x`), that Repair keeps the data, and that a silent
   uninstall (`msiexec /x ... /qn`, used by updates and IT tools) still works without the dialog
   and keeps the data. Never touch sync and backup folders.
21. ~~**Fix: the recovery key check is skipped (found testing 0.15.1 on Windows, with Windows Hello).**~~
   **Fixed in 0.15.2.** Cause: a focus listener in the Setup screen refreshed the account status when
   the window regained focus after the Windows Hello prompt, which swapped the Setup screen for the
   main app before the recovery key was confirmed. The Setup flow now stays mounted until it ends.
22. **Windows Hello: keep the person's last used option (PIN or fingerprint).** Reported testing
   0.15.1: the person had used the PIN, but the Hello prompt opened on the fingerprint scanner
   instead. Wanted: the prompt starts on the option they used last. Kasboek asks through
   `UserConsentVerifier.RequestVerificationAsync` (`src/main/security/device-auth.ts`), and Windows
   decides which option that dialog shows first; the API has no setting for it, so this may not be
   possible with that call. Investigate before promising: whether the dialog already offers "More
   choices" (PIN) and whether another call (for example a `KeyCredentialManager` or the in-process
   `IUserConsentVerifierInterop` route from the long-term idea in the Windows Hello review) lets
   Windows remember the last method. If Windows cannot do it, record that here and leave it as is.
23. **Updater: the app freezes for a moment after "Install and restart".** Fixed, not released yet.
   Found by reading the code (not measured on Windows): the press first made the safety backup,
   `writeTransfer` in `src/main/transfer/service.ts`. That has no key derivation (the key is in memory),
   but `VACUUM INTO` (`snapshotEncrypted`, better-sqlite3) and the AES-GCM encoding of the whole file
   (`encodeTransfer`) run synchronously on the main process, so it cannot repaint or answer the window.
   The state only became `installing` after the backup and the helper start (up to 8 s), so nothing
   showed. Fixed: `install()` sets the new state `preparing` first ("Preparing the update..." with a
   spinner, button disabled, window not dismissible), waits 100 ms so it is drawn, and goes back to
   `ready` with the error if anything fails (`installStep` in `src/core/update.ts`). The export itself
   is still synchronous, so a short stall remains, but the window now says why. Not changed: the backup
   on quit. It is a different backup (the automatic backup folder, only when the data changed and
   automatic backups are on), so the safety copy in `safety/` can't replace it.
24. **Keep the original amount and currency of foreign payments.** Asked about card payments in a
   currency other than the account's: today the amount is stored in the account's currency and the
   foreign amount and its currency are not kept (an import only flags the row as "other currency").
   Build after the PDF import: store the original amount, currency and rate on the transaction (from
   the file's columns when the bank gives them, or typed in), show it next to the billed amount
   ("EUR 45.00 (USD 49.20)"), keep it through CSV and PDF import, sync and export, and keep the
   overviews using the billed amount in the account's currency.
25. **More statement formats for the import, after the PDF import has proven itself.** CAMT.053 (XML) is
   done, not released yet: `src/core/camt/` (own small XML reader: no DTD or entities, 20 MB and
   50,000 entries caps; reader of Stmt/Rpt/Ntfctn, any namespace version) turns the entries into the
   grid and mapping CSV uses, so mapping, duplicates, rules, Flip signs, undo and the PDF totals check
   (opening/closing balance) work unchanged; contract op `import.analyzeXml`. Sign is the file's
   CdtDbtInd as booked (RvslInd does not flip it again: a reversal of a debit is booked as CRDT);
   batches become one row per TxDtls when their amounts add up; an amount in another currency is
   flagged like in CSV (no new storage, item 24). Not done: choosing the account inside the file in the
   screen (the account is matched by IBAN, else the file is refused when it holds several), checking
   with real bank files. Still open: MT940, CODA, OFX/QIF, Excel. In this order:
   (1) CAMT.053 (ISO 20022 XML) and MT940, the standard statement exports of European banks, plus
   CODA (Belgian), structured so they read exactly: no layout guessing, opening and closing balances
   included for the same totals check as PDF; (2) OFX, QFX and QIF, the usual export of UK, US and
   Australian banks and apps; (3) Excel (.xlsx and .xls), through the same column mapping as CSV;
   (4) photos and screenshots of statements, and scanned PDFs, which need text recognition or sending
   the image to an AI after consent: only if people ask for it. Each format opens the same import
   session as CSV and PDF (preview, duplicates, remembered layouts, undo).
26. **Fixed, not released yet: the add-account window closes when you click next to it.** An accidental click on the
   dimmed background closes the dialog and everything typed so far is lost. Make the add-account
   dialog (and any other dialog with a form: edit account, bank balance, goals, rules, import
   mapping) ignore clicks on the background, so it only closes with Cancel, the close button, or
   Escape; if there are unsaved changes, ask before closing with Escape or the close button too.
   Fixed in the shared `Modal`: a click on the background no longer closes any dialog (opt-in
   `closeOnBackdrop`, used only by the sync conflicts list). Escape and the close button ask "Discard
   what you typed?" when `dirty` is set (add/edit account, goal, bank balance, net worth value).
27. **Faster start and a launch window that is visible and not blank.** Owner report: the first start
   (after an install or update) takes long before anything shows, the launch window appears late and
   blank, and a second start is faster. Investigated by reading the code and bundles (no changes yet).
   *Confirmed:* the launch window is shown before it has content (`show: true` in `src/main/splash.ts`);
   its page and script are two cold file reads from `app.asar.unpacked`; right after creating it the
   main thread runs the whole 1.7 MB app bundle synchronously (`await import('./app')`,
   `src/main/index.ts:47`), which includes a module-level `z.toJSONSchema` in `src/main/assistant/pdf.ts:32`;
   progress calls made before the page has loaded are queued, so a late splash jumps straight to the end;
   the log line "launch window shown" really means "created"; in dark mode the page starts light and
   switches when its script runs. *Suspected:* several processes start in the same second (splash
   renderer, main renderer, GPU, the PowerShell Windows Hello check); the splash may share a renderer
   process with the main window (both `file://`); the slow first start is mostly outside our code:
   Defender scanning the new unsigned files, cold disk cache, rebuilt GPU caches; the time before Node
   starts is not in `startup.log`. Nothing Kasboek-specific runs on the first start (no migrations,
   backups or network calls before 15 s).
   *Fix order:* (0) a measurement build first: keep the previous `startup.log` as `startup.prev.log`, log
   first-start-of-this-version, time before the log starts (`app.getAppMetrics()` creation times), "electron
   ready", "launch window created / loaded / painted", the process ids of both windows, the main window's
   `dom-ready`, renderer milestones, and the Hello check start; (1) splash as an inline `data:` page with
   the theme baked in and progress set directly (no file reads, no flash, likely its own process); (2) let
   the splash paint before importing the app bundle (cap about 300 ms); (3) start the Windows Hello check
   after the first screen, except for device-mode accounts; (4) progress that follows real steps and
   creeps during the long phase; (5) dynamic imports for the assistant SDK, qrcode, pdf assist, update
   and sync in `src/main/ipc.ts`; (6) lazy-load locales and pages in the renderer (1.65 MB bundle, about
   4 s to "interface loaded"); (7) register IPC and create the main window before `initSession`;
   (8) only if numbers point there: Node compile cache, renderer code cache; (9) Windows code signing.
   Rejected: bytenode or snapshots, a native launcher, `ImageView`, `ready-to-show` for the splash.
   *More from the owner's testing:* on an x86 PC only the small launch window is blank. On a friend's
   Windows on ARM PC the LARGE main window is also blank for a while, longer than on x86, so the app
   looks broken while it boots. Likely contributors (not measured): Windows on ARM draws in software by
   default (`src/shared/graphics.ts:34`), which makes painting the 1.65 MB renderer slower; and the main
   window is shown as soon as it exists, before the interface has painted. Add to the fix list: keep
   the launch window on screen until the main window has really painted its first screen (create the
   main window hidden, show it on the renderer's first-screen signal, then close the launch window),
   and if a window must be visible earlier give it a theme-coloured background and a simple "Starting..."
   content instead of white; on ARM measure first how long compositing in software mode takes
   (the measurement build covers it: log the graphics mode next to the timings) and consider lazy
   loading to shrink the first bundle (steps 5 and 6).
   *Owner can check now:* copy `%APPDATA%\Kasboek\startup.log` after the first start following an
   install, before starting again, then after the second start; time it with a phone video from
   double-click to blank window, logo and main window; reboot without reinstalling and see if it is
   slow again (cold disk cache) or fast (something tied to the install, such as Defender); watch
   "Antimalware Service Executable" during the first start; note whether the PC is Windows on ARM.
   *Done in 0.21.0 (not released), measured values pending:* (0) `startup.log` now has timings (main script,
   Electron ready, launch window created / loaded / painted, app code loaded, main window created and
   `dom-ready`, renderer milestones through the new `app.milestone` op, first screen), the process ids of both
   windows, the time before the log starts, the graphics mode, first-start-of-this-version, and the previous
   log as `startup.prev.log`; (1) the launch window is an inline `data:` page with the theme baked in and
   progress set from the main process (`resources/splash.html` and `splash.js` stay only as a fallback if
   the data page fails to load); (2) the app code starts loading when the launch window has painted or after
   300 ms; (3) the Windows Hello check starts after the first screen, except for passwordless accounts;
   (4) the main window stays hidden until the page reports its first screen (safety timeout 8 s), and the
   bar follows the real steps and creeps between them; (5) the assistant, update, sync, export, PDF reader
   and `qrcode` load on first use (`app-*.js` 1,825 kB -> 257 kB); (7) the account is read while the main
   window is created, and operations other than `app.*` and `prefs.*` wait for it. Steps 6 (lazy renderer),
   8 and 9 are not done. Still to confirm on real Windows (x64 and ARM): the timings in `startup.log`, that
   the `data:` launch window has its own process, that the window never stays blank, the tray and second
   launch behaviour, and the Hello check after the first screen.
28. **Two bugs found while adding "Not a fixed cost" (not fixed yet).** (a) Fixed-cost amounts stay in
    each account's own currency but are added up across accounts and shown in the main currency
    (`src/core/recurring.ts` where the totals are summed, `src/renderer/src/pages/Recurring.tsx`
    where `money()` formats the amounts): convert with the rate of the day.
    (b) Suspected sync bug: a budget's sync id comes from category + month (`src/core/sync-schema.ts`)
    and `setBudget(null)` deletes the row (`src/core/finance.ts`). Deletion is final for a sync id
    (`flush` skips a row whose last synced state is deleted), so a budget removed and later set again
    for the same month and category may never reach the other computer. Check with a test across two
    computers; a fix is probably to store "no budget" as a row instead of deleting it (as fixed-cost
    marks do).
29. **Code review of everything since 0.16.1 (static review, HEAD 6ff68d4; verdict: request changes).** Fix first, in
   this order: (1) PDF AI read can drop an amount's sign and the check still passes (`src/core/pdf-plan.ts:222-232,348`):
   take the sign from the matched text (extend over `-`, `+`, `(`, `)`, `CR`, `DR`) and reject the row if the text has a sign
   the model's string lacks, plus a test; (2) the CSV "Check with AI" sends raw rows, descriptions, rules and the assistant's
   memory notes with only a tooltip (`src/main/assistant/csv.ts:97-138`): add the preview-and-consent dialog like the PDF
   read and apply `maskNumbers`; (3) tips consent is stored per provider id only (`insights.ts` `agreed()`, `insight-plan.ts:20`):
   also store and compare the provider's address (and model), so editing a custom provider's address asks again; (4) lock
   only clears import sessions (`src/main/app.ts:131`): abort running PDF reads, CSV checks and tips runs on lock
   (`cancelAssist`, `cancelInsights`, `pdfRead.abort()`); (5) `window.prompt` is used in `Import.tsx:490,510`, `Budgets.tsx:143`,
   `Transactions.tsx:162,214` and Electron does not implement it (it throws; to be confirmed on a build): replace by small
   modals; (6) memoise `findRecurring` per (data version, day) and debounce `insights.get` on `data.changed`.
   *Other bugs and risks:* an IBAN glued to preceding letters is not masked (`src/shared/iban.ts:7` lookbehind); ~~when no table
   header is found the PDF first-page header (holder name, address) is sent whole~~ (fixed: without a table header, sending starts at the first
   line with a date and an amount, and nothing is sent when there is none; e-mail addresses and phone numbers are masked; the preview
   and the calls both come from `linesToSend`);
   restarting a job for the same session broadcasts a stale `import.checkDone` that resets the screen (`jobs.ts:383-400`);
   a refused second `import.analyzePdf` clears the cancel handle of the first (`ipc.ts:403-418`); an AI read replaces the grid
   and silently drops edits made during the run (`pdf.ts:128-145`); `CLAUDE_PDF_MODEL` is hard-coded and PDF/tips calls reuse the
   CSV effort setting: check the model id exists and accepts that effort; older synced computers skip `recurring_marks`
   changes (`sync.ts:293`): check the cursor logic and say "update all computers" in the notes; Change category on Fixed costs
   does not reload when the rule step fails and uses the derived item name as pattern (`Recurring.tsx`); `loadModels` has no
   staleness guard when switching provider (`SettingsClaude.tsx`); `aria-label="Close"` is English and only 5 of 32 modals set
   `dirty` (`ui.tsx:293`); pdf.js runs in a utility process that is isolated but not OS-sandboxed (keep it updated).
   *Optimisations:* `findRecurring` runs several times per Overview refresh (buildFacts, listAlerts, alerts.list, recurring.list;
   each scans about 430 days), `insights.get` reruns on every `data.changed` with 4 budget queries and 2 reviews; `chargedTwice`
   does one query per fixed cost; zod validates up to 300k PDF items on the main thread (cap lower); PDF bytes are copied
   about 4 times; main chunk `app-*.js` is 1.8 MB (lazy `import()` for assistant and pdf; measure first); "Install and restart"
   still exports and encrypts the backup on the main thread (move to a worker); model lists are re-fetched on every reload click.
   *Clean-up:* fence-stripping and JSON parsing is duplicated 5 times (`parsePlan`, `parsePdfPlan`, `parseSuggestions`,
   `json.ts` `cutOff`, `openai.ts:464`: one `parseJsonAnswer`); duplicated `CHARS_PER_TOKEN`, `median`, `addDays` and the
   language-label lookup; two different `parseDate` functions (`shared/format.ts` and `core/csv/normalize.ts:60`: rename one);
   unused parameter in `pdfAssistPreview`, pointless `export { PDF_LIMITS }`, overlapping `READER_ERROR_CODES` and `PDF_ERROR_CODES`,
   comments still saying "Settings -> Claude"; English-only messages from the main process (`pdf.ts:135-155`, notes in `csv.ts`);
   long files to split (`Settings.tsx` 826 lines, `Import.tsx` 746, `core/import.ts` 710, `ipc.ts` 590, `SettingsClaude.tsx` 439);
   a fixed cost shows twice for 8 s after a hide (`Recurring.tsx`); 13 `eslint-disable` comments, mostly exhaustive-deps.
   *Tests:* `tests/extract.test.ts:77-85` accepts any outcome and only fails on time; `tests/pdf-assist.test.ts:124` does not prove
   the parts run side by side; missing tests for a dropped sign, a job restart, lock during a job; no component tests (node
   environment); nothing tests `reader-process.ts` against the real utility process and packaged path (only an installer
   build shows a packaging mistake).

## Later, maybe

- **Phone app (iPhone / Android).** Would build on sync (item 8): first view the overview and
  budgets, later quick edits (categorise, add a transaction, budgets). Electron doesn't run on
  phones, so this is a separate app reading the same encrypted sync files. Not planned yet.
