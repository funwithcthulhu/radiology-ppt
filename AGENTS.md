# AGENTS.md instructions for radiology-ppt

## Canonical Memory

Read `MEMORY.MD` first at the start of any non-trivial task in this repo. It is the
lightweight index for repo-local memory.

Then read `.agents/memory/radiology-ppt.md` for the full canonical project memory. That file
should be treated as more current than chat history or older handoff notes.

## Shell

Use PowerShell 7 for Windows-side shell work by default:

- Prefer `pwsh.exe -NoLogo -NoProfile -Command ...` for PowerShell commands.
- Use Windows PowerShell only when a legacy Windows-only module or host behavior requires it.
- If native Windows command output behaves oddly from WSL, use `cmd.exe /d /c ...` for
  `git.exe`, `gh.exe`, `node.exe`, and `python.exe` checks.
- Keep WSL/Linux commands explicit with `wsl.exe -d Ubuntu -- ...` when crossing into Ubuntu.

## Project Guardrails

- Keep the project/repo name as `radiology-ppt`.
- Do not commit private PDFs, extracted copyrighted images, generated corpora, local caches,
  generated PowerPoints, or user-specific question banks unless explicitly requested.
- Keep GUI language direct: prefer `Cases`, `PowerPoint`, and `Core Boards`; avoid unexplained
  `deck` wording in user-facing controls.
- Treat `Core Boards` as a serious ABR Core Exam preparation workspace, not a cosmetic mode label.
