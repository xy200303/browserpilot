# 把 release/win-unpacked 直接覆盖到本机安装目录，比 NSIS 静默安装可靠（不会弹用户选项页）。
# 用法: npm run build:win 之后 powershell -File scripts/deploy-local.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src = Join-Path $root 'release\win-unpacked'
$dst = Join-Path $env:LOCALAPPDATA 'Programs\BrowserPilot'

if (-not (Test-Path (Join-Path $src 'BrowserPilot.exe'))) {
  throw '没找到 release\win-unpacked，先跑 npm run build:win'
}

Get-Process BrowserPilot, electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /R:2 /W:2 | Out-Null
if ($LASTEXITCODE -gt 7) { throw "robocopy 失败 $LASTEXITCODE" }

Start-Process (Join-Path $dst 'BrowserPilot.exe')
Write-Output "已部署到 $dst 并启动"
