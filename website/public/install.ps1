# VRK installer for Windows:  irm https://vrkweb.web.app/install-windows | iex
# Downloads VRK, unpacks it into your user folder (no admin needed), marks it as
# trusted by you (so SmartScreen doesn't block an app without a paid
# certificate), adds Start menu and desktop shortcuts, and opens it.
$ErrorActionPreference = 'Stop'
$base = 'https://vrkweb.web.app/downloads'
function Say($text) { Write-Host '◆ VRK ' -ForegroundColor Magenta -NoNewline; Write-Host $text }

if (-not [Environment]::Is64BitOperatingSystem) { Say 'VRK needs 64-bit Windows 10 or 11.'; return }
if (Get-Process -Name VRK -ErrorAction SilentlyContinue) { Say 'Quit VRK first, then run this again.'; return }

$dest = Join-Path $env:LOCALAPPDATA 'Programs\VRK'
$zip = Join-Path $env:TEMP 'VRK-windows-x64.zip'
Say 'Downloading VRK for Windows (about 190 MB)…'
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri "$base/VRK-windows-x64.zip" -OutFile $zip -UseBasicParsing
Say 'Installing…'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Get-ChildItem $dest -Recurse | Unblock-File

$exe = Join-Path $dest 'VRK.exe'
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  $link = $shell.CreateShortcut((Join-Path $folder 'VRK.lnk'))
  $link.TargetPath = $exe
  $link.WorkingDirectory = $dest
  $link.Description = 'VRK, the private browser'
  $link.Save()
}
Say 'Done. Opening VRK…'
Start-Process $exe
