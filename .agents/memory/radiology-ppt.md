# radiology-ppt Canonical Memory

Last updated: 2026-05-02

This is repo-local canonical memory for the Radiopaedia Case PowerPoint Builder project.
Read this before making project decisions, UI changes, GitHub changes, packaging changes, or
Core Boards/Core Review changes.

## Identity

- Lightweight memory index: `MEMORY.MD`
- Repo name must remain `radiology-ppt`.
- GitHub remote: `https://github.com/funwithcthulhu/radiology-ppt`
- Check `git status --short --branch` for the current branch before making changes.
- Main desktop app entrypoint: `csharp/RadiologyPpt.App`
- Packaged desktop app: `dist/Radiopaedia Case PowerPoint Builder/Radiopaedia Case PowerPoint Builder.exe`
- Main Node CLI entrypoint: `src/cli.mjs`
- Existing project GitHub workflow skill: `.agents/skills/radiology-ppt-github-workflow/SKILL.md`
- Core Review handoff note: `CORE_REVIEW_HANDOFF.md`

## User Preferences And Corrections

- Use PowerShell 7 for Windows-side work by default:
  `pwsh.exe -NoLogo -NoProfile -Command ...`
- If native Windows command output is empty or strange from WSL, use:
  `cmd.exe /d /c ...`
- Do not rename the project or repo. The user explicitly said to leave it as `radiology-ppt`.
- The conference-building workflow should use plain labels like `Cases` and `PowerPoint`, not unexplained `deck` wording.
- The board-exam workflow should be visibly called `Core Boards`, not hidden only as a PowerPoint style.
- The user expects durable memory/context and gets justifiably frustrated when project context is lost.
- Keep summaries grounded in actual file and command evidence, not vibes.

## Current Product Direction

This app is evolving from a Radiopaedia case PowerPoint builder into two related workflows:

- `Cases` / case-conference workflow: build teaching PowerPoints from Radiopaedia cases,
  diagnoses, random case pulls, or exact Radiopaedia URLs.
- `Core Boards`: build ABR Diagnostic Radiology Core Exam style study infrastructure from
  local study PDFs, image-heavy references, and reviewed question banks.

Core Boards is not a playful label. It refers to the ABR Core Exam taken by R3/PGY-4
radiology residents and should cover the broad diagnostic radiology curriculum.

## C# Desktop Migration

- Primary GUI is now a native Windows C# WPF app under `csharp/RadiologyPpt.App`.
- Keep using the existing Node backend (`src/cli.mjs` and modules under `src/`) for Radiopaedia search, image selection, caching, Core Boards ingestion, and PowerPoint rendering.
- Local durable metadata is stored in SQLite at `state/radiology-ppt.sqlite`; `state/` is ignored by Git.
- JSON schema contracts for C# to Node prepare/render payloads live under `src/contracts`.
- `AppJobRunner.cs` centralizes cancellable long-running GUI jobs.
- `AppStorage.cs` stores settings, review sessions, image candidates, generated PowerPoint metadata, Core Boards source imports, and diagnostics.
- Build and publish the desktop app with `build-csharp-app.ps1`.
- Refresh the desktop shortcut with `create-desktop-shortcut.ps1`.
- The packaged app path remains `dist/Radiopaedia Case PowerPoint Builder/Radiopaedia Case PowerPoint Builder.exe`.
- The WPF main/review windows should clamp to the visible Windows work area so title bars do not open above the screen on scaled displays.
- `gui_app.py` is legacy/reference during migration unless the user explicitly asks to work on the old Python GUI.

## Core Boards Requirements

The Core Boards module should support:

- ABR-style domains across organ systems, modalities, physics, NIS, and RISC.
- Single-best-answer MCQs with plausible homogeneous distractors.
- Gold-marker localization questions where the learner places a marker on the abnormality.
- Hotspot anatomy/localization questions.
- Numeric physics and protocol/safety calculation questions.
- Teaching explanations after right or wrong answers.
- Source-grounded explanations tied back to PDF pages, images, chunks, and citations.
- Human review before generated questions become active.

## Private Knowledge Base Policy

- User PDFs and extracted assets are private/local by default.
- Do not commit `library/board-review/` contents unless the user explicitly says the content is
  licensed and should be committed.
- `.gitignore` should keep `library/board-review/` out of normal commits.
- Generated corpora, page renders, extracted images, and local question banks should usually stay local.

## Implemented During Core Boards Work

- Added visible `Core Boards` navigation and tab in `gui_app.py`.
- Keep user-facing wording simple and prefer `PowerPoint` over unexplained `deck` language.
- Added Core Boards PDF import controls in the GUI:
  - domain selector
  - `Import PDFs`
  - `Open Knowledge Base Folder`
  - knowledge-base status summary
- Added backend Core Review module under `src/core_review/`.
- Added schema/domain/question-type definitions in `src/core_review/schema.mjs`.
- Added source ingestion in `src/core_review/ingest.mjs`.
- Added quiz/session/scoring logic in `src/core_review/quiz.mjs`.
- Added exports in `src/core_review/index.mjs`.
- Added PDF ingestion helper: `scripts/core_review_pdf_ingest.py`.
- Added example question bank: `examples/core-review-question-bank.example.json`.
- Added CLI commands:
  - `--core-review-schema`
  - `--core-review-ingest`
  - `--core-review-ingest-pdf`
  - `--core-review-quiz`
- Updated `build-windows-app.ps1` so packaged builds can include `core_review_pdf_ingest.exe`.
- Updated deck generation so `Core Review` mode can produce a Core Review teaching slide.
- Added compact-first Ollama vision model auto-detection in `src/ollama-review.mjs`:
  prefer `moondream`, then `minicpm`, then Qwen-VL/LLaVA/BakLLaVA/generic vision models.
  If asked whether this is currently the best model, verify with current docs/model availability.

## Current UI State

- Do not assume an app process is already running.
- Relaunch from source with `dotnet run --project .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj`, or use the packaged desktop shortcut after rebuilding.
- C# GUI tabs are `Cases`, `Core Boards`, `PowerPoint`, and `Activity`.
- Case review supports keep/skip/reroll/re-pick images, replace unchecked images, remove unchecked images, exact candidate-frame selection from the `Candidates` tab, and cancel long review actions.
- Ollama review can be enabled from the PowerPoint tab and the user can choose/refresh the local model list.
- Activity tab includes diagnostics, state folder access, scratch cleanup, and old-cache cleanup.
- Screenshots and local temp paths from prior sessions are not durable project state.

## Verification Commands Already Run

From the repo root on 2026-05-01:

```powershell
python.exe -m py_compile gui_app.py scripts\focus_crop.py scripts\core_review_pdf_ingest.py
node.exe --check src\cli.mjs
node.exe --check src\deck.mjs
node.exe --check src\radiopaedia.mjs
node.exe --check src\core_review\index.mjs
node.exe --check src\core_review\ingest.mjs
node.exe --check src\core_review\quiz.mjs
node.exe --check src\core_review\schema.mjs
git.exe diff --check
```

`git.exe diff --check` emitted only CRLF normalization warnings for tracked text files.

From the repo root on 2026-05-02 during C# migration:

```powershell
dotnet build .\csharp\RadiologyPpt.App\RadiologyPpt.App.csproj
npm test
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

The packaged C# executable was smoke-launched successfully.

From the repo root on 2026-05-02 after the architecture pass:

- Added SQLite app storage and metadata persistence.
- Added C# to Node JSON contract schemas and tests.
- Added cancellable background job runner.
- Added exact candidate-frame review gallery.
- Added Activity diagnostics and cleanup tools.

## Next Product Steps

- Build the actual Core Boards quiz runner UI.
- Add the image canvas for gold-marker and hotspot questions.
- Add human-review queues for generated questions.
- Add ingestion support for folders/batches and richer metadata tags.
- Add a way to map PDFs/source pages/images to teaching explanations.
- Decide how reviewed local Core Boards question banks should be exported, backed up, and kept private.
- When ready, stage intentionally, commit, push, and open a PR to `funwithcthulhu/radiology-ppt`.

## GitHub Notes

- Before pushing, verify `gh.exe auth status`.
- Use branch prefix `codex/` unless the user asks otherwise.
- Do not stage generated/private artifacts.
- Prefer a draft PR unless the user explicitly asks for direct push or a ready PR.
