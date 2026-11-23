import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const hook = createRequire(import.meta.url)('../build/msi-project.cjs') as (file: string) => Promise<void>

// The parts of electron-builder's generated project that the hook looks for (see its template.xml and MsiTarget.js).
const GENERATED = `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Product Id="*" Name="Kasboek" UpgradeCode="7F3C2A1E-4B5D-4C8E-9A6F-2D1B0E9C8A74" Version="1.0.0" Language="1033" Codepage="65001" Manufacturer="Kasboek">
    <Package Compressed="yes" InstallerVersion="500"/>
    <MajorUpgrade AllowSameVersionUpgrades="yes"/>
    <MediaTemplate CompressionLevel="high" EmbedCab="yes"/>
    <Icon Id="icon.exe" SourceFile="C:\\icon.ico"/>
    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="APPLICATIONFOLDER" Name="Kasboek"/>
    </Directory>
    <Feature Id="ProductFeature" Absent="disallow">
      <ComponentGroupRef Id="ProductComponents"/>
    </Feature>
    <ComponentGroup Id="ProductComponents" Directory="APPLICATIONFOLDER">
      <Component>
        <File Name="Kasboek.exe" Source="$(var.appDir)\\Kasboek.exe" ReadOnly="yes" KeyPath="yes" Id="mainExecutable">
          <Shortcut Id="desktopShortcut" Directory="DesktopFolder" Name="Kasboek" WorkingDirectory="APPLICATIONFOLDER" Advertise="yes" Icon="icon.exe"/>
          <Shortcut Id="startMenuShortcut" Directory="ProgramMenuFolder" Name="Kasboek" WorkingDirectory="APPLICATIONFOLDER" Advertise="yes" Icon="icon.exe">
            <ShortcutProperty Key="System.AppUserModel.ID" Value="app.kasboek"/>
          </Shortcut>
        </File>
      </Component>
      <Component Directory="dResources">
        <File Name="kasboek-mcp.exe" Source="$(var.appDir)\\resources\\kasboek-mcp.exe" ReadOnly="yes" KeyPath="yes"/>
      </Component>
    </ComponentGroup>
  </Product>
</Wix>
`

async function patched(): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), 'kasboek-msi-')), 'project.wxs')
  writeFileSync(file, GENERATED)
  await hook(file)
  return readFileSync(file, 'utf8')
}

const tag = (wxs: string, re: RegExp): string => wxs.match(re)?.[0] ?? ''

describe('MSI project: closing the Claude bridges before an update', () => {
  it('keeps the helper file in the Binary table and in the install', async () => {
    const wxs = await patched()
    expect(tag(wxs, /<Binary Id="KasboekMcpBin"[^>]*\/>/)).toContain('SourceFile="$(var.appDir)\\resources\\kasboek-mcp.exe"')
    expect(wxs).toContain('<File Id="mcpHelper" Name="kasboek-mcp.exe"')
  })

  it('has an immediate action that cannot fail the install and runs the helper from the Binary table', async () => {
    const action = tag(await patched(), /<CustomAction Id="KasboekCloseBridges"[^>]*\/>/)
    expect(action).toContain('BinaryKey="KasboekMcpBin"')
    expect(action).toContain('Execute="immediate"')
    expect(action).toContain('Impersonate="yes"')
    expect(action).toContain('Return="ignore"')
    // The folder ends in a backslash: the trailing "." keeps it from escaping the closing quote.
    expect(action).toContain('ExeCommand="--close-bridges &quot;[APPLICATIONFOLDER].&quot;"')
  })

  it('runs it in InstallExecuteSequence (not the skipped UI sequence) right before InstallValidate, not on uninstall', async () => {
    const wxs = await patched()
    const exec = wxs.match(/<InstallExecuteSequence>[\s\S]*?<\/InstallExecuteSequence>/g) ?? []
    const mine = exec.filter((s) => s.includes('KasboekCloseBridges'))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatch(/<Custom Action="KasboekCloseBridges" Before="InstallValidate">NOT REMOVE<\/Custom>/)
    expect(wxs).not.toContain('InstallUISequence')
    // The existing uninstall clean-up is still there.
    expect(wxs).toContain('<Custom Action="KasboekCleanup" Before="RemoveFiles">')
  })

  it('fails the build when the helper file is not in the project', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kasboek-msi-')), 'project.wxs')
    writeFileSync(file, GENERATED.replace('kasboek-mcp.exe', 'other.exe'))
    await expect(hook(file)).rejects.toThrow(/kasboek-mcp/)
  })
})
