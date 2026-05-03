---
name: radiology-ppt-github-workflow
description: Use for the radiology-ppt repository when publishing, pushing, opening PRs, packaging the Windows desktop app, syncing from an older working copy, or avoiding generated artifact commits. Triggers on radiology-ppt, Radiopaedia Case PowerPoint Builder, PowerPoint builder, GitHub publish, package build, C# desktop packaging, or draft PR work for this project.
---

# Radiology PPT GitHub Workflow

## Canonical Repo

- GitHub: `https://github.com/funwithcthulhu/radiology-ppt`
- Work from the active checkout reported by `git rev-parse --show-toplevel`; do not assume a fixed user profile path.
- If multiple local copies exist, prefer the checkout whose `origin` remote resolves to `funwithcthulhu/radiology-ppt`.
- Do not rename the repo or project. Keep the name `radiology-ppt`.
- Do not push from a parent directory or unrelated git root.
- Before non-trivial project work, read `MEMORY.MD`, then `.agents/memory/radiology-ppt.md`; they are the repo-local memory index and canonical memory.

## Shell Rules

- Use PowerShell 7 for Windows-side work:
  `pwsh.exe -NoLogo -NoProfile -Command ...`
- If native Windows command output behaves oddly from WSL-hosted PowerShell, use `cmd.exe /d /c ...` for `git.exe`, `gh.exe`, and `node.exe` checks.
- User PATH should include Git, Node, .NET, and Codex `rg.exe`; refresh PowerShell PATH when needed:
  `[Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")`

## GitHub Publish Flow

1. Work in the repository root from `git rev-parse --show-toplevel`.
2. Verify auth:
   `gh.exe auth status`
3. Follow the user's requested target. If the user asks to push `main`, stay on `main`; otherwise create a branch with the `codex/` prefix.
4. Stage only source/build files that belong in the change.
5. Do not commit generated artifacts unless the user explicitly asks.
6. Commit and push. Open a draft PR against `main` only for branch/PR workflows.

Useful baseline:

```powershell
git.exe status -sb
git.exe diff --stat
dotnet.exe build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
npm.exe test
node.exe --check src\cli.mjs
node.exe --check src\deck.mjs
node.exe --check src\radiopaedia.mjs
node.exe --check src\radiopaedia-search.mjs
node.exe --check src\radiopaedia-case-fetch.mjs
node.exe --check src\radiopaedia-case-text.mjs
node.exe --check src\focus-crop.mjs
node.exe --check src\core_review\pdf-ingest.mjs
node.exe --check src\utils.mjs
git.exe push origin main
# Or, for branch workflow:
# git.exe push -u origin <branch>
# gh.exe pr create --repo funwithcthulhu/radiology-ppt --base main --head <branch> --draft
```

## Artifact Hygiene

Keep these out of normal commits:

- `dist/`
- `build/`
- `dist-focus-helper/`
- `node_modules/`
- `scratch/`
- `outputs/`
- `cache/`
- `gui_state.json`
- generated `.pptx`, logs, preview images, and temporary operator-test artifacts
- `csharp/**/bin/`
- `csharp/**/obj/`

The repo `.gitignore` already covers the main generated directories.

## Packaging Notes

- Current primary desktop package is C# WPF plus a Node backend. Build it with `build-csharp-app.ps1`.
- There is no supported Python/Tkinter packaging path.
- The packaged app lives under:
  `dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe`
- Before rebuilding, close any running `Radiopaedia Case PowerPoint Builder` process.
- After rebuilding, reopen the packaged exe and confirm Windows reports it as responding.

## Current Project Context

For current status, read `MEMORY.MD`, then `.agents/memory/radiology-ppt.md`.

Current active themes include:

- Desktop GUI-first workflow; command-line entry points are internal maintenance/backend plumbing.
- C# WPF app with a persistent local Node JSONL backend service and health monitor.
- Case-conference PowerPoint creation from Radiopaedia diagnosis/search/random/manual URL rows.
- Local Library tab for reviewed case history.
- Core Boards/Core Review scaffolding for local user-provided study PDFs and question banks.
- Modular Node backend with focused tests for parser, cache, contracts, Radiopaedia search/fetch/text, and image-candidate behavior.
