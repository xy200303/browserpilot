# 一条龙发布：升版本、提交、打 tag、打 Windows 包、（可选）覆盖部署到本机。
# 用法: powershell -File scripts/release.ps1 -Version 0.3.0 [-Deploy]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [switch]$Deploy
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 32 | Set-Content package.json -Encoding utf8

git add -A
git commit -m "release: $Version"
git tag "v$Version"

npm run dist:win
if ($LASTEXITCODE -ne 0) { throw '打包失败' }

if ($Deploy) {
  powershell -ExecutionPolicy Bypass -File scripts/deploy-local.ps1
}
Write-Output "完成：v$Version。产物在 release\，git tag v$Version 已打。push 和发 GitHub Release 自己确认后再做。"
