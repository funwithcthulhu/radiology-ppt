# Radiopaedia Case PowerPoint Builder

Desktop GUI app for building case-based radiology PowerPoints from Radiopaedia.

For each case, the app prepares a teaching sequence like:

1. `Case N`
2. image slide
3. `Diagnosis`
4. optional `Teaching Points` or `Core Review` slide

The app can:

- build from specific diagnoses
- pull random cases by subspecialty, modality, anatomy, or mixed category
- use manual Radiopaedia case URLs
- review matches before export
- let you keep, reroll, repick images, favorite, or block cases during review
- choose a case-conference or Core Review PowerPoint style
- add optional teaching-point slides; Core Review includes them automatically when available
- keep local history so random decks do not keep repeating the same recent cases
- cache Radiopaedia metadata and image candidate banks to speed repeated runs
- save the latest review session so an interrupted review can be resumed

## Main Use

The intended way to use this project is the desktop app.

Desktop shortcut:

- `C:\Users\Admin\OneDrive\Desktop\Radiopaedia Case PowerPoint Builder.lnk`

Packaged app:

- `C:\projects\radiopaedia_case_powerpoint_builder\dist\Radiopaedia Case PowerPoint Builder\Radiopaedia Case PowerPoint Builder.exe`

If the packaged app is not present yet, you can launch the source GUI directly:

```powershell
pythonw .\gui_app.py
```

## GUI Workflow

1. Open the app.
2. Go to the `Cases` tab.
3. Add one or more request rows:
   - `Specific Diagnosis`
   - `Random Case`
   - `Manual Case URL`
4. Set optional filters like modality, anatomy, subspecialty, age group, topic, or difficulty.
5. Go to the `PowerPoint` tab and set title, output path, images per case, PowerPoint style, theme, and optional extras.
6. Click `Generate PowerPoint`.
7. Review each prepared case before export.
8. Keep, reroll, repick, favorite, block, or skip each case.
9. Export the final deck.

## Request Types

`Specific Diagnosis`

- best when you know the diagnosis you want
- examples:
  - `multiple sclerosis`
  - `appendicitis`
  - `hypothalamic hamartoma`

`Random Case`

- use dropdown filters instead of typing shorthand
- supports random browsing by:
  - subspecialty
  - modality
  - anatomy
  - mixed deck

`Manual Case URL`

- use this when you already know the exact Radiopaedia case page you want

## Review Step

Before export, the app opens a review dialog so you can inspect the prepared images and decide what to keep.

From the review screen you can:

- keep the case
- reroll to a different case
- repick images from the same case
- uncheck specific images, then replace or remove only those images
- favorite the case
- mark the case as never use again
- skip the case

If you cancel during review, use `PowerPoint` -> `More` -> `Resume Last Review Session` to reopen the most recently prepared review bundle.

## Architecture

The GUI is Python/Tkinter. The Radiopaedia/PowerPoint backend is Node.

- `gui_app.py`: desktop UI, review flow, settings, and app orchestration
- `src/cli.mjs`: internal backend entrypoint used by the GUI
- `src/request-parser.mjs`: diagnosis, random/category, modality, and filter parsing
- `src/radiopaedia-client.mjs`: Radiopaedia HTTP/download helpers and persistent fetch cache
- `src/radiopaedia.mjs`: case search, case assembly, patient data, and teaching text
- `src/image-candidates.mjs`: frame candidate extraction, relevance scoring, and selection
- `src/ollama-review.mjs`: optional local Ollama vision-model scoring
- `src/cache-store.mjs`: persistent JSON metadata cache
- `src/deck.mjs`: PowerPoint rendering

## Notes

- The app prefers stronger finding-centered images and can use fewer images when a case does not have enough clearly useful frames.
- When Radiopaedia exposes annotation coordinates, the app can focus-crop around the finding and optionally add a subtle focus ring.
- Optional minimal clinical history can be added to the intro slide.
- If a local Ollama vision model is installed, the app can optionally score selected images during preparation.
- Ollama auto-detect prefers compact vision models first to reduce slowdown.
- The packaged app writes outputs, cache, library data, and state inside its app folder.
- Case preparation runs multiple cases concurrently, while preserving request order.
- Radiopaedia image reuse in presentations is encouraged with attribution, and this app adds attribution to the slides:
  [Using and attributing images from Radiopaedia](https://radiopaedia.org/articles/using-and-attributing-images-from-radiopaedia-1?lang=us)

## Core Review Infrastructure

The Core Review backend is scaffolded separately from the case-conference flow. It provides ABR Core-style domains, question-type schema, user-supplied source ingestion, quiz-session assembly, and normalized-coordinate support for gold-marker abnormality localization questions.

```powershell
node .\src\cli.mjs --core-review-schema
node .\src\cli.mjs --core-review-ingest .\my-notes.md --out .\library\board-review\corpus.json --format text
node .\src\cli.mjs --core-review-ingest-pdf .\my-atlas.pdf --out .\library\board-review\pdf-corpus.json --domain msk --format text
node .\src\cli.mjs --core-review-quiz .\examples\core-review-question-bank.example.json --count 3 --format text
```

PDF ingestion copies source PDFs into a local source vault, renders pages to PNG, extracts embedded images when present, chunks page text, and preserves page/source provenance for later teaching explanations. The repository does not bundle copyrighted board-review books or qbanks. Import local materials only when you have the right to use them; generated/private study corpora live under `library\board-review`, which is ignored by Git.

## Maintenance

These scripts are for maintaining the desktop app, not for normal deck generation:

```powershell
.\build-windows-app.ps1
.\create-desktop-shortcut.ps1
```

Run focused backend tests:

```powershell
npm test
```
