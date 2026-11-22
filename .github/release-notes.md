Kasboek — a private, local-first budget app with an AI assistant built in. Your data stays on your computer, encrypted and locked to your computer and login.

## What’s new in 0.22.3

Everything in 0.22.2 is included.

**Privacy**
- API keys you entered for the assistant were also written to Kasboek's encrypted activity log; they are removed now and are no longer logged. The same goes for sync passwords. The activity log also no longer keeps account numbers, rule patterns or the text of assistant chats and memory notes.

**Fixes**
- Kasboek now says clearly why it cannot open its data (the Windows or system key cannot be read, the account file is empty or damaged, or the file is busy) and shows the technical details on request. From that screen you can import a backup or export without erasing anything, because the unreadable files are kept in an "erased" folder, and you can open the data folder or copy a short diagnostic text with file names and sizes only. Saving the account file is now safer, with a flushed write and an automatic safety copy that Kasboek uses on its own if the file ever turns up empty or cut off.

If you have 0.22.2, you get this version through the Update button.

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
