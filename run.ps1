param(
  [string]$Config
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

function Require-Command([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command not found: $Name"
  }
  return $command
}

function Ensure-Node22 {
  Require-Command "node" | Out-Null
  $versionText = (& node -p "process.versions.node").Trim()
  $major = [int]($versionText.Split(".")[0])
  if ($major -lt 22) {
    throw "Node.js 22 or newer is required. Found $versionText"
  }
}

function Install-Dependencies {
  if (Test-Path (Join-Path $RepoRoot "node_modules\\ink")) {
    return
  }
  $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
  if ($pnpm) {
    & $pnpm.Source install
    return
  }
  $corepackCmd = Get-Command "corepack" -ErrorAction SilentlyContinue
  if ($corepackCmd) {
    & $corepackCmd.Source pnpm install
    return
  }
  & npm install --no-package-lock
}

Ensure-Node22
Install-Dependencies

$arguments = @("src/tui.js")
if ($Config) {
  $arguments += @("--config", $Config)
}

& node @arguments
