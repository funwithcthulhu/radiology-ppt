# radiology-ppt Memory Index

This is the lightweight repo-local memory index. Read this first when returning to
`radiology-ppt`.

## Canonical Project Memory

- Full project memory: `.agents/memory/radiology-ppt.md`
- Agent instructions: `AGENTS.md`
- GitHub workflow skill: `.agents/skills/radiology-ppt-github-workflow/SKILL.md`
- Core Boards handoff: `CORE_REVIEW_HANDOFF.md`

## Current North Star

- Keep the repo/project name as `radiology-ppt`.
- Primary desktop app is the C# WPF project at `csharp/RadiologyPpt.App`.
- The Node backend under `src/` remains the Radiopaedia/Core Boards/PowerPoint engine.
- Local durable metadata lives in ignored SQLite state at `state/radiology-ppt.sqlite`.
- JSON schemas for C# to Node payloads live under `src/contracts`.
- Use clear GUI labels such as `Cases`, `PowerPoint`, and `Core Boards`.
- Use `Core Boards` for ABR Core Exam prep infrastructure.
- Treat Core Boards as a serious radiology board-review workflow with PDF/source ingestion,
  image-aware questions, gold-marker localization, human review, and source-grounded teaching
  explanations.
- Keep private PDFs, extracted images, generated corpora, and local question banks out of commits
  unless the user explicitly says otherwise.

## Shell Reminder

Use PowerShell 7 for Windows-side work:

```powershell
pwsh.exe -NoLogo -NoProfile -Command ...
```

If native Windows tool output is strange from WSL, use:

```powershell
cmd.exe /d /c ...
```
