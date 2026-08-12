param(
  [string]$Config,
  [switch]$InstallPrerequisites
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolsRoot = Join-Path $RepoRoot ".tools"
Set-Location $RepoRoot

function Add-LocalNodeToPath {
  if (-not (Test-Path $ToolsRoot)) {
    return
  }

  $localNodeFolders = Get-ChildItem $ToolsRoot -Directory -Filter "node-v22.*" -ErrorAction SilentlyContinue
  foreach ($folder in $localNodeFolders) {
    $nodeDirectory = if (Test-Path (Join-Path $folder.FullName "node.exe")) {
      $folder.FullName
    } else {
      Join-Path $folder.FullName "bin"
    }
    if (Test-Path (Join-Path $nodeDirectory $(if ($IsWindows -or $env:OS -eq "Windows_NT") { "node.exe" } else { "node" }))) {
      $env:PATH = "$nodeDirectory$([IO.Path]::PathSeparator)$env:PATH"
      return
    }
  }
}

function Test-Node22 {
  if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    return $false
  }

  $versionText = (& node -p "process.versions.node" 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $versionText) {
    return $false
  }

  return [int]($versionText.Trim().Split(".")[0]) -ge 22
}

function Install-LocalNode22 {
  $isWindowsPlatform = $env:OS -eq "Windows_NT"
  $isMacPlatform = -not $isWindowsPlatform -and
    [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX)
  $architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
  if ($architecture -notin @("x64", "arm64")) {
    throw "Automatic Node.js installation does not support the '$architecture' architecture. Install Node.js 22 or newer from https://nodejs.org/."
  }

  $platform = if ($isWindowsPlatform) { "win-$architecture" } elseif ($isMacPlatform) { "darwin-$architecture" } else { "linux-$architecture" }
  $archiveSuffix = if ($isWindowsPlatform) { "zip" } else { "tar.gz" }
  $distributionUrl = "https://nodejs.org/dist/latest-v22.x"

  Write-Host "Downloading a repository-local Node.js 22 installation..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  New-Item -ItemType Directory -Path $ToolsRoot -Force | Out-Null
  $checksums = (Invoke-WebRequest "$distributionUrl/SHASUMS256.txt" -UseBasicParsing).Content
  $artifactPattern = "node-v22\.[0-9]+\.[0-9]+-$([regex]::Escape($platform))\.$([regex]::Escape($archiveSuffix))"
  $artifactMatch = [regex]::Match($checksums, "(?m)^([a-f0-9]{64})\s+($artifactPattern)$")
  if (-not $artifactMatch.Success) {
    throw "Could not find a compatible Node.js 22 download for $platform. Install it manually from https://nodejs.org/."
  }

  $expectedHash = $artifactMatch.Groups[1].Value
  $artifactName = $artifactMatch.Groups[2].Value
  $archivePath = Join-Path $ToolsRoot $artifactName
  Invoke-WebRequest "$distributionUrl/$artifactName" -OutFile $archivePath -UseBasicParsing
  $actualHash = (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $expectedHash) {
    Remove-Item $archivePath -Force
    throw "The downloaded Node.js archive failed checksum verification and was removed."
  }

  if ($isWindowsPlatform) {
    Expand-Archive $archivePath -DestinationPath $ToolsRoot -Force
  } else {
    if (-not (Get-Command "tar" -ErrorAction SilentlyContinue)) {
      throw "The tar command is required to unpack Node.js. Install tar or install Node.js manually from https://nodejs.org/."
    }
    & tar -xzf $archivePath -C $ToolsRoot
    if ($LASTEXITCODE -ne 0) {
      throw "The Node.js archive could not be unpacked."
    }
  }
  Remove-Item $archivePath -Force
  Add-LocalNodeToPath
}

function Ensure-Node22 {
  Add-LocalNodeToPath
  if (-not (Test-Node22) -and $InstallPrerequisites) {
    Install-LocalNode22
  }

  if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    throw "Node.js 22 or newer is required but was not found. Rerun with -InstallPrerequisites to download it locally, or install it from https://nodejs.org/."
  }

  $versionText = (& node -p "process.versions.node").Trim()
  $major = [int]($versionText.Split(".")[0])
  if ($major -lt 22) {
    throw "Node.js 22 or newer is required. Found $versionText. Rerun with -InstallPrerequisites to download it locally, or update Node.js from https://nodejs.org/."
  }
}

function Ensure-ProjectFiles {
  if (-not (Test-Path (Join-Path $RepoRoot "package.json"))) {
    throw "package.json was not found in $RepoRoot. Run this script from a complete copy of the MSLearnToPDF repository."
  }
}

function Get-PackageManager {
  $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
  if ($pnpm) {
    return @{ Kind = "pnpm"; Command = $pnpm.Source; Prefix = @() }
  }

  $corepack = Get-Command "corepack" -ErrorAction SilentlyContinue
  if ($corepack) {
    return @{ Kind = "corepack"; Command = $corepack.Source; Prefix = @("pnpm") }
  }

  $npm = Get-Command "npm" -ErrorAction SilentlyContinue
  if ($npm) {
    return @{ Kind = "npm"; Command = $npm.Source; Prefix = @() }
  }

  throw "No supported Node.js package manager was found. Install Node.js 22 or newer with npm, or install pnpm, and then reopen this terminal."
}

function Invoke-PackageManager($Manager, [string[]]$Arguments, [string]$FailureMessage) {
  & $Manager.Command @($Manager.Prefix) @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Install-Dependencies {
  $requiredPackages = @("ink", "react", "playwright")
  $allInstalled = $true
  foreach ($package in $requiredPackages) {
    if (-not (Test-Path (Join-Path $RepoRoot "node_modules\\$package"))) {
      $allInstalled = $false
      break
    }
  }
  if ($allInstalled) {
    return
  }

  Write-Host "Installing Node.js dependencies..."
  $manager = Get-PackageManager
  $installArguments = if ($manager.Kind -eq "npm") { @("install", "--no-package-lock") } else { @("install") }
  Invoke-PackageManager $manager $installArguments "Node.js dependency installation failed. Review the package-manager output above and try again."
}

function Install-Chromium {
  $chromiumPath = (& node -e "console.log(require('playwright').chromium.executablePath())").Trim()
  if (Test-Path $chromiumPath) {
    return
  }

  Write-Host "Installing Playwright Chromium for PDF generation..."
  $manager = Get-PackageManager
  $browserArguments = if ($manager.Kind -eq "npm") {
    @("exec", "--", "playwright", "install", "chromium")
  } else {
    @("exec", "playwright", "install", "chromium")
  }
  Invoke-PackageManager $manager $browserArguments "Playwright Chromium installation failed. Review the package-manager output above and try again."
}

Ensure-Node22
Ensure-ProjectFiles
Install-Dependencies
Install-Chromium

$arguments = @("src/tui.js")
if ($Config) {
  $arguments += @("--config", $Config)
}

& node @arguments
if ($LASTEXITCODE -ne 0) {
  throw "MSLearnToPDF exited with code $LASTEXITCODE."
}
