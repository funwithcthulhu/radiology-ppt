param(
  [string[]]$Diagnosis,
  [string]$InputFile,
  [string]$Output,
  [string]$Title,
  [int]$ImagesPerCase = 3
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$localNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$localNode = if ($localNodeCommand) { $localNodeCommand.Source } else { $null }
$bundledNode = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

$nodeExe = if (Test-Path $bundledNode) {
  $bundledNode
} elseif ($localNode) {
  $localNode
} else {
  throw "Node.js was not found. Install Node or restore the bundled Codex runtime."
}

$argsList = @(
  (Join-Path $projectRoot "src\cli.mjs")
)

if ($Diagnosis) {
  foreach ($item in $Diagnosis) {
    if ($item -and $item.Trim()) {
      $argsList += "--diagnosis"
      $argsList += $item.Trim()
    }
  }
}

if ($InputFile) {
  $resolvedInput = (Resolve-Path -LiteralPath $InputFile).Path
  $argsList += "--input"
  $argsList += $resolvedInput
}

if ($Output) {
  $resolvedOutputParent = Split-Path -Parent $Output
  if ($resolvedOutputParent) {
    New-Item -ItemType Directory -Force -Path $resolvedOutputParent | Out-Null
  }
  $argsList += "--out"
  $argsList += $Output
}

if ($Title) {
  $argsList += "--title"
  $argsList += $Title
}

if ($ImagesPerCase -gt 0) {
  $argsList += "--images-per-case"
  $argsList += $ImagesPerCase.ToString()
}

Push-Location $projectRoot
try {
  & $nodeExe @argsList
} finally {
  Pop-Location
}
