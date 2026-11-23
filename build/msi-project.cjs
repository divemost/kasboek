// electron-builder msiProjectCreated hook: adjusts the generated WiX project before it is built.
//  - Shortcuts become optional: a "Shortcuts" page with two checkboxes (desktop, Start menu), both
//    ticked by default. Each shortcut is its own component, installed only when its box is ticked.
//  - Kasboek artwork instead of WiX's default red disc (banner and welcome/finish pages).
// Upgrades stay in-place: electron-builder's template has a fixed UpgradeCode with MajorUpgrade.
const { readFile, writeFile } = require('node:fs/promises')
const path = require('node:path')

const art = (name) => path.resolve(__dirname, 'installer', name)
// Fixed GUIDs (uppercase, as WiX requires): a component keeps its GUID across versions so upgrades replace it cleanly.
const DESKTOP_GUID = '3B9A1F0E-6C2D-4E7A-9D41-5F8C2A7B6E10'
const STARTMENU_GUID = '8D4E2C71-0B5A-4F39-A6E2-1C7D9B3F4A52'
const CLEANUP_GUID = 'C51E7A92-3D84-4B6F-8E0A-27F9D1B64C38'

function replaceOnce(text, find, replace, what) {
  if (typeof find === 'string' ? !text.includes(find) : !find.test(text)) throw new Error(`msi-project: couldn't find ${what}`)
  return text.replace(find, replace)
}

module.exports = async function msiProjectCreated(projectFile) {
  let wxs = await readFile(projectFile, 'utf8')
  const iconId = (wxs.match(/<Icon Id="([^"]+)"/) || [])[1]
  const aumid = (wxs.match(/<ShortcutProperty Key="System.AppUserModel.ID" Value="([^"]+)"/) || [])[1] || 'app.kasboek'

  // 1. Remove the shortcuts electron-builder attached to the main executable.
  wxs = wxs.replace(/\s*<Shortcut Id="desktopShortcut"[^>]*\/>/, '')
  wxs = wxs.replace(/\s*<Shortcut Id="startMenuShortcut"[\s\S]*?<\/Shortcut>/, '')

  // 2. Artwork and the two choices (ticked by default; also settable on the command line).
  wxs = replaceOnce(
    wxs,
    /(<MediaTemplate[^>]*\/>)/,
    `$1
    <WixVariable Id="WixUIBannerBmp" Value="${art('msi-banner.bmp')}"/>
    <WixVariable Id="WixUIDialogBmp" Value="${art('msi-dialog.bmp')}"/>
    <Property Id="DESKTOP_SHORTCUT" Value="1" Secure="yes"/>
    <Property Id="STARTMENU_SHORTCUT" Value="1" Secure="yes"/>`,
    'MediaTemplate'
  )

  // 3. One component per shortcut, each installed only when its box is ticked. A Kasboek.lnk left by
  //    an older install (the .exe installer) is removed first, so the new shortcut replaces it.
  //    Only the Start menu shortcut carries the app ID (Windows uses it for notifications; Kasboek
  //    also sets it itself): setting it on a Desktop that OneDrive backs up can fail with
  //    warning 1946.
  const shortcut = (id, dir, guid, prop, name, withAumid) => `
    <DirectoryRef Id="${dir}">
      <Component Id="${id}" Guid="${guid}">
        <Condition>${prop}</Condition>
        <RemoveFile Id="${id}Stale" Name="Kasboek.lnk" On="install"/>
        <Shortcut Id="${id}Link" Name="Kasboek" Target="[#mainExecutable]" WorkingDirectory="APPLICATIONFOLDER"${iconId ? ` Icon="${iconId}"` : ''}>${withAumid ? `
          <ShortcutProperty Key="System.AppUserModel.ID" Value="${aumid}"/>` : ''}
        </Shortcut>
        <RegistryValue Root="HKCU" Key="Software\\Kasboek\\Installer" Name="${name}" Type="integer" Value="1" KeyPath="yes"/>
      </Component>
    </DirectoryRef>`
  // Always installed: on uninstall it takes Kasboek's registry keys with it (the installer's own,
  // and Windows' notification settings for Kasboek) and stray files in the program folder.
  const cleanup = `
    <DirectoryRef Id="APPLICATIONFOLDER">
      <Component Id="cmpCleanup" Guid="${CLEANUP_GUID}">
        <RegistryValue Root="HKCU" Key="Software\\Kasboek\\Installer" Name="Installed" Type="integer" Value="1" KeyPath="yes"/>
        <RemoveRegistryKey Root="HKCU" Key="Software\\Kasboek" Action="removeOnUninstall"/>
        <RemoveRegistryKey Root="HKCU" Key="Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\${aumid}" Action="removeOnUninstall"/>
        <RemoveRegistryKey Root="HKCU" Key="Software\\Classes\\AppUserModelId\\${aumid}" Action="removeOnUninstall"/>
        <RemoveFile Id="cmpCleanupStray" Name="*" On="uninstall"/>
      </Component>
    </DirectoryRef>`
  wxs = replaceOnce(
    wxs,
    '<ComponentGroup Id="ProductComponents"',
    `${shortcut('cmpDesktopShortcut', 'DesktopFolder', DESKTOP_GUID, 'DESKTOP_SHORTCUT', 'DesktopShortcut', false)}
    ${shortcut('cmpStartMenuShortcut', 'ProgramMenuFolder', STARTMENU_GUID, 'STARTMENU_SHORTCUT', 'StartMenuShortcut', true)}
    ${cleanup}
    <ComponentGroup Id="ProductComponents"`,
    'ProductComponents'
  )
  wxs = replaceOnce(
    wxs,
    '<ComponentGroupRef Id="ProductComponents"/>',
    '<ComponentGroupRef Id="ProductComponents"/>\n      <ComponentRef Id="cmpDesktopShortcut"/>\n      <ComponentRef Id="cmpStartMenuShortcut"/>\n      <ComponentRef Id="cmpCleanup"/>',
    'ProductFeature'
  )

  // 3b. Uninstall cleanup by the kasboek-mcp helper (still on disk before RemoveFiles): Kasboek out
  //     of the Claude apps' settings, caches and update files deleted. The data itself only when
  //     "Also delete my Kasboek data" was ticked (REMOVE_DATA=1); uninstalling from Windows
  //     Settings shows no dialogs, so there the data is always kept. Not on upgrades.
  wxs = replaceOnce(wxs, /<File Name="kasboek-mcp(\.exe)?"/, (m) => m.replace('<File ', '<File Id="mcpHelper" '), 'the kasboek-mcp helper file')
  const helperSource = (wxs.match(/<File Id="mcpHelper" Name="kasboek-mcp(?:\.exe)?" Source="([^"]+)"/) || [])[1]
  if (!helperSource) throw new Error("msi-project: couldn't find the source of the kasboek-mcp helper file")
  const dataDir = '&quot;[AppDataFolder]Kasboek&quot;'
  wxs = replaceOnce(
    wxs,
    /(<MediaTemplate[^>]*\/>)/,
    `$1
    <CustomAction Id="KasboekCleanup" FileKey="mcpHelper" ExeCommand="--uninstall-cleanup --data-dir ${dataDir}" Execute="deferred" Impersonate="yes" Return="ignore"/>
    <CustomAction Id="KasboekCleanupAll" FileKey="mcpHelper" ExeCommand="--uninstall-cleanup --remove-data --data-dir ${dataDir}" Execute="deferred" Impersonate="yes" Return="ignore"/>
    <Binary Id="KasboekMcpBin" SourceFile="${helperSource}"/>
    <CustomAction Id="KasboekCloseBridges" BinaryKey="KasboekMcpBin" ExeCommand="--close-bridges &quot;[APPLICATIONFOLDER].&quot;" Execute="immediate" Impersonate="yes" Return="ignore"/>
    <InstallExecuteSequence>
      <Custom Action="KasboekCloseBridges" Before="InstallValidate">NOT REMOVE</Custom>
      <Custom Action="KasboekCleanup" Before="RemoveFiles">(REMOVE = "ALL") AND (NOT UPGRADINGPRODUCTCODE) AND (REMOVE_DATA &lt;&gt; "1")</Custom>
      <Custom Action="KasboekCleanupAll" Before="RemoveFiles">(REMOVE = "ALL") AND (NOT UPGRADINGPRODUCTCODE) AND (REMOVE_DATA = "1")</Custom>
    </InstallExecuteSequence>`,
    'MediaTemplate (cleanup)'
  )

  // 3c. Before the installer checks which files are in use (InstallValidate), the new helper, run
  //     from the Binary table (the installed copy is the one being replaced), ends the kasboek-mcp
  //     programs that Claude apps keep running from the install folder. They would otherwise make
  //     a silent update (/qn, which can't ask) wait. It is in InstallExecuteSequence, which runs in
  //     every UI mode (InstallUISequence is skipped by /qn), Return="ignore" so it can never fail
  //     an install, and the path ends in "." because "[APPLICATIONFOLDER]" ends in a backslash,
  //     which would swallow the closing quote.

  // 4. The "Shortcuts" page, between choosing where to install and "Ready to install".
  wxs = wxs.replace('Value="VerifyReadyDlg" Order="6">WixAppFolder = "WixPerUserFolder"', 'Value="ShortcutsDlg" Order="6">WixAppFolder = "WixPerUserFolder"')
  wxs = wxs.replace('<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="2">1</Publish>', '<Publish Dialog="InstallDirDlg" Control="Next" Event="NewDialog" Value="ShortcutsDlg" Order="2">1</Publish>')
  wxs = wxs.replace('<Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="InstallScopeDlg" Order="2">NOT Installed</Publish>', '<Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="ShortcutsDlg" Order="2">NOT Installed</Publish>')
  const dialog = `
    <UI>
      <Dialog Id="ShortcutsDlg" Width="370" Height="270" Title="[ProductName] Setup">
        <Control Id="BannerBitmap" Type="Bitmap" X="0" Y="0" Width="370" Height="44" TabSkip="no" Text="WixUI_Bmp_Banner"/>
        <Control Id="Title" Type="Text" X="15" Y="6" Width="200" Height="15" Transparent="yes" NoPrefix="yes" Text="{\\WixUI_Font_Title}Shortcuts"/>
        <Control Id="Description" Type="Text" X="25" Y="23" Width="280" Height="15" Transparent="yes" NoPrefix="yes" Text="Choose where you want to start [ProductName] from."/>
        <Control Id="BannerLine" Type="Line" X="0" Y="44" Width="370" Height="0"/>
        <Control Id="DesktopCheck" Type="CheckBox" X="25" Y="70" Width="320" Height="17" Property="DESKTOP_SHORTCUT" CheckBoxValue="1" Text="Create a shortcut on the &amp;desktop"/>
        <Control Id="StartMenuCheck" Type="CheckBox" X="25" Y="95" Width="320" Height="17" Property="STARTMENU_SHORTCUT" CheckBoxValue="1" Text="Create a shortcut in the &amp;Start menu"/>
        <Control Id="Hint" Type="Text" X="25" Y="125" Width="320" Height="30" NoPrefix="yes" Text="You can change this later by running the installer again."/>
        <Control Id="BottomLine" Type="Line" X="0" Y="234" Width="370" Height="0"/>
        <Control Id="Back" Type="PushButton" X="180" Y="243" Width="56" Height="17" Text="!(loc.WixUIBack)"/>
        <Control Id="Next" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes" Text="!(loc.WixUINext)"/>
        <Control Id="Cancel" Type="PushButton" X="304" Y="243" Width="56" Height="17" Cancel="yes" Text="!(loc.WixUICancel)">
          <Publish Event="SpawnDialog" Value="CancelDlg">1</Publish>
        </Control>
      </Dialog>
      <Publish Dialog="ShortcutsDlg" Control="Back" Event="NewDialog" Value="InstallScopeDlg" Order="1">WixAppFolder = "WixPerUserFolder"</Publish>
      <Publish Dialog="ShortcutsDlg" Control="Back" Event="NewDialog" Value="InstallDirDlg" Order="2">WixAppFolder = "WixPerMachineFolder"</Publish>
      <Publish Dialog="ShortcutsDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="1">1</Publish>
      <Dialog Id="RemoveDataDlg" Width="370" Height="270" Title="[ProductName] Setup">
        <Control Id="BannerBitmap" Type="Bitmap" X="0" Y="0" Width="370" Height="44" TabSkip="no" Text="WixUI_Bmp_Banner"/>
        <Control Id="Title" Type="Text" X="15" Y="6" Width="200" Height="15" Transparent="yes" NoPrefix="yes" Text="{\\WixUI_Font_Title}Your Kasboek data"/>
        <Control Id="Description" Type="Text" X="25" Y="23" Width="280" Height="15" Transparent="yes" NoPrefix="yes" Text="Choose whether to keep your data on this computer."/>
        <Control Id="BannerLine" Type="Line" X="0" Y="44" Width="370" Height="0"/>
        <Control Id="Keep" Type="Text" X="25" Y="60" Width="320" Height="40" NoPrefix="yes" Text="Your budget data stays on this computer unless you tick the box below, so you can install Kasboek again later and carry on. Your sync folder and backup folders are never deleted."/>
        <Control Id="RemoveDataCheck" Type="CheckBox" X="25" Y="108" Width="320" Height="17" Property="REMOVE_DATA" CheckBoxValue="1" Text="Also &amp;delete my Kasboek data from this computer"/>
        <Control Id="Warn" Type="Text" X="40" Y="128" Width="305" Height="30" NoPrefix="yes" Text="This can't be undone. Without a backup or another computer that syncs, your data is gone."/>
        <Control Id="BottomLine" Type="Line" X="0" Y="234" Width="370" Height="0"/>
        <Control Id="Back" Type="PushButton" X="180" Y="243" Width="56" Height="17" Text="!(loc.WixUIBack)"/>
        <Control Id="Next" Type="PushButton" X="236" Y="243" Width="56" Height="17" Default="yes" Text="!(loc.WixUINext)"/>
        <Control Id="Cancel" Type="PushButton" X="304" Y="243" Width="56" Height="17" Cancel="yes" Text="!(loc.WixUICancel)">
          <Publish Event="SpawnDialog" Value="CancelDlg">1</Publish>
        </Control>
      </Dialog>
      <Publish Dialog="MaintenanceTypeDlg" Control="RemoveButton" Event="NewDialog" Value="RemoveDataDlg" Order="99">1</Publish>
      <Publish Dialog="RemoveDataDlg" Control="Back" Event="NewDialog" Value="MaintenanceTypeDlg" Order="1">1</Publish>
      <Publish Dialog="RemoveDataDlg" Control="Next" Event="NewDialog" Value="VerifyReadyDlg" Order="1">1</Publish>
      <Publish Dialog="VerifyReadyDlg" Control="Back" Event="NewDialog" Value="RemoveDataDlg" Order="99">WixUI_InstallMode = "Remove"</Publish>
    </UI>
    <Property Id="REMOVE_DATA" Secure="yes"/>
`
  wxs = replaceOnce(wxs, '<Directory Id="TARGETDIR"', `${dialog}\n    <Directory Id="TARGETDIR"`, 'TARGETDIR')
  await writeFile(projectFile, wxs)
}
