# Windows only: a real per-user MSI install, then an upgrade (silent, /qn) while a kasboek-mcp bridge
# runs from the install folder, which is what froze a user's update to 0.23.0. Passes when the
# upgrade exits 0 (or 3010), the bridge was ended, and the new version is on disk.
#   -OldMsi  the previous release's installer (without the --close-bridges action)
#   -NewMsi  the installer just built
param(
  [Parameter(Mandatory = $true)][string]$OldMsi,
  [Parameter(Mandatory = $true)][string]$NewMsi,
  [Parameter(Mandatory = $true)][string]$NewVersion
)
$ErrorActionPreference = 'Stop'
$work = Join-Path $env:RUNNER_TEMP 'kasboek-smoke'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\Kasboek'

function Install-Msi([string]$msi, [string]$log) {
  $p = Start-Process -FilePath msiexec.exe -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart', '/l*v', "`"$log`"", 'ALLUSERS=""', 'MSIINSTALLPERUSER=1') -Wait -PassThru
  return $p.ExitCode
}

$code = Install-Msi $OldMsi (Join-Path $work 'old.log')
if ($code -ne 0) { Get-Content (Join-Path $work 'old.log') -Tail 60; throw "installing the old MSI exited with $code" }
$bridgeExe = Get-ChildItem -Path $env:LOCALAPPDATA, $env:ProgramFiles -Recurse -Filter 'kasboek-mcp.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $bridgeExe) { throw 'kasboek-mcp.exe was not installed' }
$installDir = Split-Path (Split-Path $bridgeExe.FullName)
Write-Host "Installed in $installDir"

# A bridge as Claude would run it: from the install folder, stdin held open.
$env:KASBOEK_MCP_NO_LAUNCH = '1'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $bridgeExe.FullName
$psi.RedirectStandardInput = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$bridge = [System.Diagnostics.Process]::Start($psi)
Start-Sleep -Seconds 2
if ($bridge.HasExited) { throw 'the test bridge ended by itself' }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$code = Install-Msi $NewMsi (Join-Path $work 'new.log')
$sw.Stop()
Write-Host "Upgrade exited with $code after $([int]$sw.Elapsed.TotalSeconds) s"
if ($code -ne 0 -and $code -ne 3010) { Get-Content (Join-Path $work 'new.log') -Tail 80; throw "the upgrade exited with $code" }
if (-not $bridge.HasExited) { $bridge.Kill(); throw 'the bridge was still running after the upgrade' }
if (-not (Select-String -Path (Join-Path $work 'new.log') -Pattern 'KasboekCloseBridges' -Quiet)) { throw 'the close-bridges action is not in the install log' }
$version = (& (Join-Path $installDir 'resources\kasboek-mcp.exe') --version).Trim()
if ($version -ne $NewVersion) { throw "expected kasboek-mcp $NewVersion after the upgrade, found $version" }

# Clean up.
$p = Start-Process -FilePath msiexec.exe -ArgumentList @('/x', "`"$NewMsi`"", '/qn', '/norestart') -Wait -PassThru
Write-Host "Smoke test passed (uninstall exited with $($p.ExitCode))"
