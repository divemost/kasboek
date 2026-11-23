Kasboek — a private, local-first budget app with an AI assistant built in. Your data stays on your computer, encrypted and locked to your computer and login.

## What’s new in 0.23.0

Everything in 0.22.3 is included. **This is the last Kasboek version with new features.** The new native app (Finora) comes next. Kasboek itself will from now on only get security fixes.

**New**
- **Accounts page** (replaces Net worth): all your accounts and your net worth in one place. Add, edit and archive accounts there; accounts are no longer in Settings. You can also add an account right where you need it, for example when importing or on the Transactions page.
- **Get started screen**: when Kasboek has no data yet, it offers three ways to begin: import a bank file, add your accounts by hand, or restore a backup.
- **Import button in the top bar**, so importing is one click away from every page.
- **New look**: Playfair Display for titles and buttons, Lato for text and numbers, and a new app icon (a serif K).

**Better**
- Small windows and zoom: on a narrow window the assistant panel now floats over the page instead of squeezing it, and Kasboek remembers whether you had it open.
- Safer dialogs: the dialog with your new recovery key can no longer be closed by accident, errors are shown inside the dialog, the keyboard focus stays inside an open dialog, and a double click no longer creates duplicates.
- Easier to read and use with a keyboard or screen reader: better contrast and clearer labels.
- Wording fixes in German, French, Dutch, Spanish and Portuguese.
- The example amounts when setting up an account follow your number format.
- The button in the banner for uncategorised transactions now says what it does.

**Privacy**
- Nothing changes about where your data goes. The new fonts are part of the app, so Kasboek does not load anything from the internet for its looks. Kasboek only remembers on this computer whether the assistant panel was open.

If you have 0.22.3, you get this version through the Update button.

## Download

| System | File |
|---|---|
| Windows (most PCs) | `Kasboek-…-win-x64.msi` |
| Windows on ARM (Snapdragon) | `Kasboek-…-win-arm64.msi` |
| macOS with Apple Silicon (M1 and later) | `Kasboek-…-mac-arm64.dmg` |
| macOS with an Intel chip | `Kasboek-…-mac-x64.dmg` |
| Linux | `.AppImage` (any distribution) or `.deb` (Debian/Ubuntu), x64 or arm64 |

All builds are 64-bit. Installing over an earlier version keeps your data. Kasboek needs nothing else installed. An export made on one system imports on any other with your login.

## First start

These builds are not yet signed with a certificate:
- **Windows** shows “Windows protected your PC”: click **More info → Run anyway**.
- **macOS** says it can’t verify the developer: **right-click Kasboek → Open**, once. On macOS 15 and later that shortcut no longer works: open **System Settings → Privacy & Security** and click **Open Anyway**.

## Good to know

- **Updating from 0.12 or 0.13**: their update window can’t be clicked, so download the installer from this page once. From 0.14 on, the "Update to …" button works.
- **Windows Hello** has been tested on a real Windows 11 computer. **Touch ID** has only been tested in simulation, not yet on a real Mac; please report anything odd.
- **Updating from 0.15.x** still uses the old update screen once (terminal windows may flash). From 0.16.1 on, the new update window is used.
- The **new update window** has been tried in a real update on Windows 11; please report anything odd.
- **PDF import** and the assistant’s PDF reading have only been tried on invented statements and two real layouts, not yet on a wide range of real bank PDFs.
