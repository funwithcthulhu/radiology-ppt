# User Guide

This app builds case-based radiology PowerPoints from Radiopaedia cases.

## Quick Start

1. Open `Radiopaedia Case PowerPoint Builder` from the desktop shortcut.
2. In `Cases`, add one or more request rows.
3. In `PowerPoint`, choose a preset or adjust options manually.
4. Click `Generate PowerPoint`.
5. Review each prepared case.
6. Approve/favorite/skip/reroll cases and adjust images.
7. The app creates the PowerPoint after review.

When export finishes, there is no popup. The left status area changes, the Activity log records completion, and `Open Last PowerPoint` can open the generated file.

## Install Or Update

For normal use, install from GitHub Releases:

1. Open the [GitHub Releases page](https://github.com/funwithcthulhu/radiology-ppt/releases).
2. Download the latest `Radiopaedia-Case-PowerPoint-Builder-Setup-v*.exe`.
3. Run the installer.
4. Keep the optional desktop shortcut checked if you want one.

The installer is per-user, does not require administrator elevation, and bundles the desktop app, backend resources, Node runtime, and app dependencies.

## Cases

![Cases overview](images/cases-tab.svg)

Use one row per request.

Request types:

- `Specific Diagnosis`: use this for named diagnoses such as `multiple sclerosis`, `appendicitis`, or `hypothalamic hamartoma`.
- `Random Case`: use this for random teaching cases. Set `Count` and optional dropdown filters.
- `Manual Case URL`: use this when you already know the exact Radiopaedia case URL or `/cases/...` path.

Useful filters:

- `Modality`: MRI, CT, X-ray, ultrasound, fluoroscopy, PET, nuclear medicine, mammography, angiography, and more.
- `Anatomy`: brain, spine, chest, abdomen, pelvis, breast, MSK regions, fetal, and more.
- `Area`: neuro, pediatrics, pediatric neuro, MSK, body, chest, cardiac, GI, GU, breast, trauma, oncology, and more.
- `Age`: adult, pediatric, neonatal.
- `Focus`: tumor, trauma, infection, vascular, congenital.
- `Difficulty`: easy, medium, hard.

Notes:

- Prefer dropdowns over typed shorthand.
- For random requests, leave the text field blank or type a broad theme if you want one.
- `Mixed` in the Area dropdown asks random mode to diversify across systems.
- Random mode starts with live Radiopaedia search.
- Random mode avoids recent, skipped, rejected, and currently excluded cases by default.
- The local prepared-case index is used only as a fallback when live search cannot fill the request.
- Narrow filters may have a small case pool; if reroll cannot find an alternate, broaden filters or skip the case.

## Library

The Library view is local review history.

You can:

- search reviewed cases by title/path
- filter by approved, favorite, skipped, rejected, or all
- open the selected Radiopaedia case in your browser
- use favorites to revisit cases later

The Library is built from your local SQLite state. It is not synced to Radiopaedia or GitHub.

## Core Review

Core Review has two jobs: build CORE-style case review lectures, and import local source material for standalone review questions.

To build a Core Review lecture:

1. Set `Cases` to the target PowerPoint size. Long reviews such as 50-100 cases are supported, but preparation will take time.
2. Choose a `Domain`. `General / Mixed` uses a broad CORE-style mix. `NIS`, `Physics`, and `RISC` are question domains, so case planning falls back to mixed diagnostic cases.
3. Choose `Selection`. `General Random CORE Mix` gives more slots to large diagnostic areas. `Even Domain Random Mix` spreads cases more evenly. `Focused Domain Random Mix` uses the selected diagnostic domain.
4. Choose `Modality mix`. `Mixed Modalities` rotates through common modalities for a diagnosis. `Prefer Classic Modality` uses the first listed modality. `Any Modality` leaves modality broad.
5. Optional: set `Output .pptx` if you want the Core Review PowerPoint saved somewhere specific.
6. Click `Generate Core Review PowerPoint`.
7. Review the Radiopaedia cases and images before export.

This path does not use the `Cases` tab. It starts from separate Core Review planning logic, searches Radiopaedia, and lets you approve the actual cases.
For larger reviews, the app plans extra candidate requests behind the scenes and keeps preparing until it reaches your requested case count or exhausts the candidate pool. Modality choices are treated as preferences in this workflow so a useful case is not dropped just because Radiopaedia lacks the exact preferred modality.
Core Review asks for one image per case by default, which helps long reviews fill more reliably. NIS, physics, and RISC questions are added as standalone question slides and do not need case images.

To add local question sources:

- import local PDFs, Word `.docx` documents, PowerPoint `.pptx` decks, notes, or JSON files
- open the local study folder
- choose the imported library as the `Question source` in Core Review

Supported source imports:

- PDFs are chunked by page. The importer saves page images and extracted PDF images when available, so generated standalone questions can show the source image from the same page as the supporting text.
- Word imports require `.docx`; PowerPoint imports require `.pptx`.
- Legacy `.doc` and `.ppt` files are not imported directly. Open them in Office or LibreOffice, save as `.docx` or `.pptx`, then import the converted file.
- Plain notes and JSON question banks are still supported for text-only study material.

Imported source files and extracted assets stay under:

```text
library\board-review\
```

This folder is ignored by Git. Do not import copyrighted or private material unless you have the right to use it locally. Imported sources affect standalone NIS/physics questions, not Radiopaedia case selection.

The `Cases` table is not a report, PDF, Word, or PowerPoint importer. It only accepts Radiopaedia case requests: diagnosis searches, random case pulls, exact Radiopaedia case URLs, or request-list files such as plain text, CSV, TSV, or JSON. Use Core Review `Import Sources` for reports, PDFs, Word `.docx` documents, PowerPoint `.pptx` decks, and study notes. If a PDF or binary file is sent to the request-list importer, the app rejects it instead of filling the table with raw PDF fragments such as `xref`, `endobj`, or `%%EOF`.

## Case Conference Settings

![Case conference settings overview](images/powerpoint-tab.svg)

Options:

- `Title`: optional. If blank, the app creates a title automatically.
- `Images per case`: target image count for case-conference slides. Core Review uses one image per case by default so longer reviews are easier to fill.
- `PowerPoint style`: `Case Conference` or `Core Review`.
- `Question source`: in `Core Review`, choose the bundled free bank, the imported Core Review library, or a custom question-bank JSON file.
- `Question bank JSON`: optional path used when `Review question source` is set to the custom JSON option.
- `Theme`: visual style for slides.
- `Output .pptx`: optional explicit output path. If blank, the app writes to `outputs\`.
- `Open PowerPoint when finished`: opens the output file after export.
- `Show patient age/sex when available`: adds minimal patient info on the case slide when clean data exists.
- `Add teaching-points slides when available`: adds teaching points after diagnosis.
- `Only use new random cases`: enabled by default. Prevents random mode from backfilling with cases already selected in earlier random runs.
- `Use Ollama image review`: enables the review-window `Ollama Score Case` action.
- `Refresh Models`: loads local Ollama model names into the model dropdown.

Presets:

- `Fast Preview`: quicker review settings.
- `Ollama Assisted`: enables the Ollama scoring option during review.
- `Core Review Teaching`: Core Review style with teaching points when available.
- `Dark Conference`: darker presentation style.

Buttons:

- `Generate PowerPoint`: prepare cases, show review, then create the PowerPoint after approval.
- `Cancel Current Task`: cancels prepare/render/import work.
- `Open Last PowerPoint`: opens the last generated file if it exists.
- `Open Outputs Folder`: opens generated PowerPoint outputs.

## Review Window

![Review window overview](images/review-window.svg)

The review window appears after case preparation and before PowerPoint creation.

Header:

- `Case Review N of M`: current position in the review queue.
- Case title: the Radiopaedia case currently selected.
- Patient intro: minimal age/sex context when available and enabled.
- Quality line: summary of selected image quality.
- Shortcuts: keyboard reminder.

Tabs:

- `Images`: selected images with keep checkboxes.
- `Details`: source, modality, quality warnings, prompt text, and why the selected images were chosen.
- `Candidates`: alternate same-case frames you can manually select.

Actions:

- `Keep Case & Next`: approve this case.
- `Favorite & Next`: approve and save as a favorite.
- `Skip Case`: reject this case and move on.
- `Reroll Case`: find a different case for the same request while excluding the current case.
- `Re-pick Images`: select a different image set from the same case.
- `Replace Unchecked`: uncheck weak images first, then replace only those slots.
- `Remove Unchecked`: uncheck weak images first, then keep fewer images.
- `Ollama Score Case`: score the current kept images if Ollama review is enabled.
- `Cancel Action`: stop a stuck reroll, re-pick, replace, or Ollama action.
- `Cancel Review`: exit review without exporting.

Image rationale:

- Each selected image has a short explanation such as annotation, key-image, current-slice, or relevance-score reasoning.
- The same rationale is written to the output manifest beside the PowerPoint.
- Use this to sanity-check whether the app picked images for the right reason before exporting.

Keyboard shortcuts:

- `K` or `Enter`: keep case
- `F`: favorite case
- `S`: skip case
- `R`: reroll case
- `I`: re-pick images
- `Delete`: remove unchecked images
- `Esc`: cancel current action, or close review if no action is running

## Activity

Use Activity for performance and error diagnosis.

It shows:

- local database path and size
- cache/scratch/output sizes
- row counts for important SQLite tables
- recent app events
- recent backend jobs with status and duration
- backend progress/timing logs

Maintenance actions:

- `Refresh Diagnostics`: reload counts and recent events.
- `Run Maintenance`: clean old scratch/cache files and optimize SQLite.
- `Clean Scratch`: remove temporary scratch files.
- `Clean Old Cache`: remove cache files older than 30 days.
- `Open State Folder`: open the folder containing `radiology-ppt.sqlite`.

## Example Workflows

Fast random PowerPoint:

1. Cases: add `Random Case`.
2. Set count and optional area/modality filters.
3. PowerPoint: apply `Fast Preview`.
4. Generate, review, skip/reroll weak cases, export.

The first run for a narrow category may be slower because random mode searches Radiopaedia first. Later runs may still be faster because the local index can fill gaps after live search.

Higher-quality image PowerPoint:

1. Cases: add specific diagnoses or filtered random rows.
2. PowerPoint: choose the style, theme, and image count you want.
3. In review, use `Candidates` or `Replace Unchecked` for weak frames.

Review with Ollama:

1. PowerPoint: apply `Ollama Assisted` or enable `Use Ollama image review`.
2. Choose/refresh a local model.
3. Generate normally.
4. In review, click `Ollama Score Case` only for cases where the extra scoring time is useful.

Core Review style PowerPoint:

1. Core Review: set case count, domain, selection, and modality mix.
2. PowerPoint: choose the bundled bank, imported Core Review library, or a custom question-bank JSON file for standalone review questions.
3. Core Review: click `Generate Core Review PowerPoint`.
4. Review and export.

Hand-picked Core Review PowerPoint:

1. Cases: choose specific diagnoses, manual Radiopaedia cases, or random rows.
2. PowerPoint: apply `Core Review Teaching`.
3. Choose the question source for standalone NIS/physics slides.
4. Review and export.

## Local Data And Privacy

Local data paths:

- `state\radiology-ppt.sqlite`
- `cache\`
- `scratch\`
- `outputs\`
- `review-sessions\`
- `library\board-review\`

Installed app data lives under `%LOCALAPPDATA%\RadiopaediaCasePowerPointBuilder`. Source-checkout app data lives under the repository root. The Activity tab shows the current database and folder paths.

These paths are ignored by Git. They may contain local paths, source metadata, review decisions, generated PowerPoints, imported PDF-derived data, or extracted images.

Radiopaedia images are attributed in generated slides. Keep attribution intact and follow source material terms.

See [Decision Logic](DECISION_LOGIC.md) for how random selection, image ranking, backend jobs, and storage fit together.
