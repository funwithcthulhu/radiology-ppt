$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$appName = "Radiopaedia Case PowerPoint Builder"
$distRoot = Join-Path $projectRoot "dist"
$appDir = Join-Path $distRoot $appName
$buildRoot = Join-Path $projectRoot "build\pyinstaller"
$helperDistRoot = Join-Path $projectRoot "dist-focus-helper"
$runtimeDir = Join-Path $appDir "runtime"
$appScriptsDir = Join-Path $appDir "scripts"

function Get-PythonRuntime {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @{ Command = $python.Source; Prefix = @() }
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @{ Command = $py.Source; Prefix = @("-3") }
  }

  throw "Python was not found."
}

function Invoke-Python {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Runtime,
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  & $Runtime.Command @($Runtime.Prefix + $Args)
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $($Runtime.Command) $($Args -join ' ')"
  }
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

$pythonRuntime = Get-PythonRuntime
$nodeRuntime = Get-NodeRuntime

Invoke-Python -Runtime $pythonRuntime -Args @("-m", "pip", "install", "--upgrade", "pyinstaller", "pillow")

Remove-Item -Recurse -Force $buildRoot -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $helperDistRoot -ErrorAction SilentlyContinue

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
  "--distpath", $distRoot,
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
