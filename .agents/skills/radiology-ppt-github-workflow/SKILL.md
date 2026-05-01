---
name: radiology-ppt-github-workflow
description: Use for the radiology-ppt repository when publishing, pushing, opening PRs, packaging the Windows desktop app, syncing from an older working copy, or avoiding generated artifact commits. Triggers on radiology-ppt, Radiopaedia Case PowerPoint Builder, PowerPoint builder, GitHub publish, package build, PyInstaller, or draft PR work for this project.
---

# Radiology PPT GitHub Workflow

## Canonical Repo

- GitHub: `https://github.com/funwithcthulhu/radiology-ppt`
- Local clone for GitHub work: `C:\Users\Chase\Documents\New project\radiology-ppt`
- Older working copy may exist at: `C:\Users\Chase\Documents\New project\radiology-ppt-main\radiology-ppt-main`
- Do not rename the repo or project. Keep the name `radiology-ppt`.
- Do not push from the parent `C:\Users\Chase\Documents\New project` git root.

## Shell Rules

- Use PowerShell 7 for Windows-side work:
  `pwsh.exe -NoLogo -NoProfile -Command ...`
- If native Windows command output behaves oddly from WSL-hosted PowerShell, use `cmd.exe /d /c ...` for `git.exe`, `gh.exe`, `node.exe`, and `python.exe` checks.
- User PATH should include Git, Node, Python, and Codex `rg.exe`; refresh PowerShell PATH when needed:
  `[Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")`

## GitHub Publish Flow

1. Work in `C:\Users\Chase\Documents\New project\radiology-ppt`.
2. Verify auth:
   `gh.exe auth status`
3. Create a branch with the `codex/` prefix unless the user asks otherwise.
4. Stage only source/build files that belong in the change.
5. Do not commit generated artifacts unless the user explicitly asks.
6. Commit, push with tracking, and open a draft PR against `main`.

Useful baseline:

```powershell
git.exe status -sb
git.exe diff --stat
python.exe -m py_compile gui_app.py scripts\focus_crop.py
node.exe --check src\cli.mjs
node.exe --check src\deck.mjs
node.exe --check src\radiopaedia.mjs
node.exe --check src\utils.mjs
git.exe push -u origin <branch>
gh.exe pr create --repo funwithcthulhu/radiology-ppt --base main --head <branch> --draft
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
- `__pycache__/`
- `gui_state.json`
- generated `.pptx`, logs, preview images, and temporary operator-test artifacts

The repo `.gitignore` already covers the main generated directories.

## Packaging Notes

- `build-windows-app.ps1` should build through a staged dist folder and then copy into the packaged app directory while preserving `outputs`, `cache`, `scratch`, and `library`.
- The packaged app lives under:
  `dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe`
- Before rebuilding, close any running `Radiopaedia Case PowerPoint Builder` process.
- After rebuilding, reopen the packaged exe and confirm Windows reports it as responding.

## Current Project Context

Known draft PR from the UI modernization work:

- Branch: `codex/radiology-ppt-ui-redesign`
- Commit: `cc92709`
- PR: `https://github.com/funwithcthulhu/radiology-ppt/pull/1`

Recent validated changes include:

- Dark left navigation rail and cleaner desktop UI.
- Simplified random modes: `Any`, `Subspecialty`, `Mixed`.
- `Radiopaedia System` as a real random filter.
- Live selection summary and clear filters control.
- Cancel current build.
- Ollama review off by default.
- URL validation, random search bounds, redaction cleanup, image-slide text fitting.
- Safer PowerShell/PyInstaller packaging behavior.
