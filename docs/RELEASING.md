# Releasing

This project ships a Windows installer through GitHub Releases.

## Requirements

- .NET 8 SDK
- Node.js
- Inno Setup compiler (`iscc.exe`)
- GitHub CLI authenticated with release permissions

Install Inno Setup locally:

```powershell
winget install --id JRSoftware.InnoSetup -e --scope user
```

Chocolatey also works from an elevated shell:

```powershell
choco install innosetup -y
```

## Build Locally

From the repository root:

```powershell
npm ci
npm test
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj --configuration Release
.\build-windows-installer.ps1 -Version 0.1.0
```

Output:

```text
dist\installer\Radiopaedia-Case-PowerPoint-Builder-Setup-v0.1.0.exe
```

The installer bundles:

- self-contained C# WPF desktop app
- Node backend files under `src\`
- production `node_modules\`
- bundled `runtime\node.exe`
- app icon, README, and MIT license

## Publish A Release

Use a matching semantic version and tag:

```powershell
git tag v0.1.0
git push origin main v0.1.0
```

Pushing a `v*` tag runs `Build Windows Installer`. It builds the installer, uploads a workflow artifact, and attaches the installer to the matching GitHub Release. If the release does not exist, the workflow creates it.

For a local/manual repair, build the installer and upload it yourself:

```powershell
gh release create v0.1.0 `
  .\dist\installer\Radiopaedia-Case-PowerPoint-Builder-Setup-v0.1.0.exe `
  --title "Radiopaedia Case PowerPoint Builder v0.1.0" `
  --notes-file .\docs\releases\v0.1.0.md
```

If a release already exists, upload or replace the installer asset:

```powershell
gh release upload v0.1.0 `
  .\dist\installer\Radiopaedia-Case-PowerPoint-Builder-Setup-v0.1.0.exe `
  --clobber
```

## GitHub Actions

`Build Windows Installer` runs on demand or from a `v*` tag. It uploads the installer as a workflow artifact. Release publishing stays manual so release notes can be reviewed before distribution.

## Installer Notes

The installer is per-user and defaults to:

```text
%LOCALAPPDATA%\Programs\Radiopaedia Case PowerPoint Builder
```

Runtime state, cache, outputs, and imported private material live under:

```text
%LOCALAPPDATA%\RadiopaediaCasePowerPointBuilder
```

The installer is not code-signed yet, so Windows SmartScreen may warn users. Only distribute installers from the official GitHub Releases page.
