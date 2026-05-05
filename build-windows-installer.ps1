param(
  [string]$Version = "0.2.0",
  [switch]$SkipCompile
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectFile = Join-Path $projectRoot "csharp\RadiologyPpt.App\RadiologyPpt.App.csproj"
$distRoot = Join-Path $projectRoot "dist"
$packageDir = Join-Path $distRoot "installer-package"
$installerDir = Join-Path $distRoot "installer"
$issPath = Join-Path $projectRoot "installer\RadiologyPpt.iss"

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Parent
  )

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent)
  $normalizedPath = $resolvedPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $normalizedParent = $resolvedParent.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $isChild = $normalizedPath.StartsWith(
    "$normalizedParent$([System.IO.Path]::DirectorySeparatorChar)",
    [System.StringComparison]::OrdinalIgnoreCase
  )
  if ($normalizedPath -ne $normalizedParent -and -not $isChild) {
    throw "Refusing to operate outside expected parent. Path: $resolvedPath Parent: $resolvedParent"
  }
}

function Resolve-InnoCompiler {
  $command = Get-Command iscc.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
  $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    (Join-Path $programFilesX86 "Inno Setup 6\ISCC.exe"),
    (Join-Path $programFiles "Inno Setup 6\ISCC.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

if (-not (Test-Path $projectFile)) {
  throw "C# project file not found: $projectFile"
}

if (-not (Test-Path $issPath)) {
  throw "Inno Setup script not found: $issPath"
}

foreach ($directoryName in @("src", "node_modules")) {
  $source = Join-Path $projectRoot $directoryName
  if (-not (Test-Path $source)) {
    throw "Required installer resource was not found: $source"
  }
}

if (-not $SkipCompile) {
  $iscc = Resolve-InnoCompiler
  if (-not $iscc) {
    throw "Inno Setup compiler was not found. Install it with: winget install --id JRSoftware.InnoSetup -e --scope user"
  }
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null
Assert-ChildPath -Path $packageDir -Parent $distRoot
Assert-ChildPath -Path $installerDir -Parent $distRoot

foreach ($path in @($packageDir, $installerDir)) {
  if (Test-Path $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
  New-Item -ItemType Directory -Path $path -Force | Out-Null
}

dotnet publish $projectFile `
  --configuration Release `
  --runtime win-x64 `
  --self-contained true `
  --output $packageDir

$exePath = Join-Path $packageDir "Radiopaedia Case PowerPoint Builder.exe"
if (-not (Test-Path $exePath)) {
  throw "Publish completed but the executable was not found: $exePath"
}

foreach ($directoryName in @("src", "node_modules")) {
  $source = Join-Path $projectRoot $directoryName
  $target = Join-Path $packageDir $directoryName
  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

foreach ($fileName in @("package.json", "package-lock.json", "LICENSE", "README.md")) {
  $source = Join-Path $projectRoot $fileName
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $packageDir $fileName) -Force
  }
}

$iconSource = Join-Path $projectRoot "csharp\RadiologyPpt.App\Assets\app-icon.ico"
if (Test-Path $iconSource) {
  Copy-Item -LiteralPath $iconSource -Destination (Join-Path $packageDir "app-icon.ico") -Force
}

$runtimeDir = Join-Path $packageDir "runtime"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodeCandidatePaths = @((Join-Path $projectRoot "runtime\node.exe"))

$nodeCandidates = @()
foreach ($candidate in $nodeCandidatePaths) {
  if ($candidate -and (Test-Path $candidate)) {
    $nodeCandidates += @($candidate)
  }
}

if ($nodeCommand -and (Test-Path $nodeCommand.Source)) {
  $nodeCandidates += @($nodeCommand.Source)
}

$nodeCandidates = @($nodeCandidates | Select-Object -Unique)

if ($nodeCandidates.Count -eq 0) {
  throw "Could not find node.exe to bundle in the installer runtime folder."
}

Copy-Item -LiteralPath $nodeCandidates[0] -Destination (Join-Path $runtimeDir "node.exe") -Force

if ($SkipCompile) {
  Write-Output $packageDir
  return
}

& $iscc `
  "/Qp" `
  "/DAppVersion=$Version" `
  "/DSourceDir=$packageDir" `
  "/DOutputDir=$installerDir" `
  $issPath

$installerPath = Join-Path $installerDir "Radiopaedia-Case-PowerPoint-Builder-Setup-v$Version.exe"
if (-not (Test-Path $installerPath)) {
  throw "Installer build completed but output was not found: $installerPath"
}

Write-Output $installerPath
