$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = "Radiopaedia Case PowerPoint Builder"
$distRoot = Join-Path $projectRoot "dist"
$appDir = Join-Path $distRoot $appName
$buildRoot = Join-Path $projectRoot "build\pyinstaller"
$stageDistRoot = Join-Path $buildRoot "dist-stage"
$stageAppDir = Join-Path $stageDistRoot $appName
$helperDistRoot = Join-Path $projectRoot "dist-focus-helper"
$runtimeDir = Join-Path $appDir "runtime"
$appScriptsDir = Join-Path $appDir "scripts"

function Get-PythonRuntime {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($python) {
    return @{ Command = $python.Source; Prefix = @() }
  }

  $pythonCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python314\python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Python\Python315\python.exe")
  )

  foreach ($candidate in $pythonCandidates) {
    if (Test-Path $candidate) {
      return @{ Command = $candidate; Prefix = @() }
    }
  }

  $py = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($py) {
    return @{ Command = $py.Source; Prefix = @("-3") }
  }

  throw "Python was not found."
}

function Invoke-NativeCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [Parameter(Mandatory = $true)]
    [string[]]$Args,
    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $processStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processStartInfo.FileName = $Command
  $processStartInfo.WorkingDirectory = $projectRoot
  $processStartInfo.UseShellExecute = $false

  foreach ($arg in $Args) {
    [void]$processStartInfo.ArgumentList.Add($arg)
  }

  $process = [System.Diagnostics.Process]::Start($processStartInfo)
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    throw "$Label failed with exit code $($process.ExitCode): $Command $($Args -join ' ')"
  }
}

function Invoke-Python {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime,
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  Invoke-NativeCommand -Command $Runtime.Command -Args @($Runtime.Prefix + $Args) -Label "Python command"
}

function Get-NodeRuntime {
  $packaged = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $packaged) {
    return $packaged
  }

  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    return $node.Source
  }

  throw "Node.js was not found."
}

function Ensure-ArtifactToolDependency {
  $target = Join-Path $projectRoot "node_modules\@oai\artifact-tool"
  $targetEntry = Join-Path $target "dist\artifact_tool.mjs"
  if (Test-Path $targetEntry) {
    return
  }

  $bundled = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\@oai\artifact-tool"
  $bundledEntry = Join-Path $bundled "dist\artifact_tool.mjs"
  if (-not (Test-Path $bundledEntry)) {
    throw "Missing @oai/artifact-tool. Restore node_modules\@oai\artifact-tool before building, or install the Codex workspace dependency bundle."
  }

  New-Item -ItemType Directory -Force -Path $target | Out-Null
  Get-ChildItem -LiteralPath $bundled -Force | Copy-Item -Destination $target -Recurse -Force
}

$pythonRuntime = Get-PythonRuntime
$nodeRuntime = Get-NodeRuntime

Ensure-ArtifactToolDependency

Invoke-Python -Runtime $pythonRuntime -Args @("-m", "pip", "install", "--upgrade", "pyinstaller", "pillow")

Remove-Item -Recurse -Force $buildRoot -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $helperDistRoot -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $stageDistRoot -ErrorAction SilentlyContinue

Invoke-Python -Runtime $pythonRuntime -Args @(
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--noconsole",
  "--onefile",
  "--name", "focus_crop",
  "--distpath", $helperDistRoot,
  "--workpath", (Join-Path $buildRoot "focus_crop\work"),
  "--specpath", (Join-Path $buildRoot "focus_crop"),
  (Join-Path $projectRoot "scripts\focus_crop.py")
)

Invoke-Python -Runtime $pythonRuntime -Args @(
  "-m", "PyInstaller",
  "--noconfirm",
  "--clean",
  "--noconsole",
  "--onedir",
  "--name", $appName,
  "--distpath", $stageDistRoot,
  "--workpath", (Join-Path $buildRoot "gui\work"),
  "--specpath", (Join-Path $buildRoot "gui"),
  "--add-data", "$projectRoot\src;src",
  "--add-data", "$projectRoot\scripts;scripts",
  "--add-data", "$projectRoot\node_modules;node_modules",
  "--add-data", "$projectRoot\package.json;.",
  "--add-data", "$projectRoot\README.md;.",
  "--add-data", "$projectRoot\create-desktop-shortcut.ps1;.",
  (Join-Path $projectRoot "gui_app.py")
)

if (-not (Test-Path $stageAppDir)) {
  throw "The staged app was not built successfully."
}

$preservedDirs = @("outputs", "cache", "scratch", "library")
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Get-ChildItem -LiteralPath $appDir -Force | Where-Object { $preservedDirs -notcontains $_.Name } | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $stageAppDir -Force | Copy-Item -Destination $appDir -Recurse -Force

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $appScriptsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "outputs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "cache") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "scratch") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appDir "library") | Out-Null

Copy-Item -Force $nodeRuntime (Join-Path $runtimeDir "node.exe")

$focusCropExe = Join-Path $helperDistRoot "focus_crop.exe"
if (-not (Test-Path $focusCropExe)) {
  throw "The focus crop helper was not built successfully."
}
Copy-Item -Force $focusCropExe (Join-Path $appScriptsDir "focus_crop.exe")

& (Join-Path $projectRoot "create-desktop-shortcut.ps1")

Write-Output "Packaged app: $appDir"
