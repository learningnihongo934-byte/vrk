# VRK installer for Windows:  irm https://vrkweb.web.app/install-windows | iex
# Downloads the VRK installer, marks it as trusted by you (so SmartScreen doesn't
# stop an app without a paid certificate), installs it for your account (no admin
# needed, with Start menu and desktop shortcuts) and opens it.
$ErrorActionPreference = 'Stop'
$release = 'https://github.com/learningnihongo934-byte/vrk/releases/latest/download'
function Say($text) { Write-Host '◆ VRK ' -ForegroundColor Magenta -NoNewline; Write-Host $text }

if (-not [Environment]::Is64BitOperatingSystem) { Say 'VRK needs 64-bit Windows 10 or 11.'; return }
if (Get-Process -Name VRK -ErrorAction SilentlyContinue) { Say 'Quit VRK first, then run this again.'; return }

$setup = Join-Path $env:TEMP 'VRK-Setup.exe'
Say 'Downloading VRK for Windows (about 140 MB)…'
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri "$release/VRK-Setup-windows-x64.exe" -OutFile $setup -UseBasicParsing
Unblock-File -Path $setup
Say 'Installing…'
Start-Process -FilePath $setup -ArgumentList '/S' -Wait
Remove-Item $setup -Force -ErrorAction SilentlyContinue
$exe = Join-Path $env:LOCALAPPDATA 'Programs\VRK\VRK.exe'
if (Test-Path $exe) { Say 'Done. Opening VRK…'; Start-Process $exe } else { Say 'Done. Open VRK from the Start menu.' }
