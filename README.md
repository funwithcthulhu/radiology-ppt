# Radiopaedia Case PowerPoint Builder

Desktop GUI app for building case-based radiology PowerPoints from Radiopaedia.

For each case, the app prepares a teaching sequence like:

1. `Case N`
2. image slide
3. `Diagnosis`

The app can:

- build from specific diagnoses
- pull random cases by subspecialty, modality, anatomy, or mixed category
- use manual Radiopaedia case URLs
- review matches before export
- let you keep, reroll, repick images, favorite, or block cases during review
- add optional teaching-point slides
- keep local history so random decks do not keep repeating the same recent cases

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
5. Go to the `Build` tab and set deck title, output path, images per case, theme, and optional extras.
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
- favorite the case
- mark the case as never use again
- skip the case

## Notes

- The app prefers stronger finding-centered images and can use fewer images when a case does not have enough clearly useful frames.
- When Radiopaedia exposes annotation coordinates, the app can focus-crop around the finding and optionally add a subtle focus ring.
- Optional minimal clinical history can be added to the intro slide.
- If a local Ollama vision model is installed, the app can optionally score selected images during preparation.
- The packaged app writes outputs, cache, library data, and state inside its app folder.
- Radiopaedia image reuse in presentations is encouraged with attribution, and this app adds attribution to the slides:
  [Using and attributing images from Radiopaedia](https://radiopaedia.org/articles/using-and-attributing-images-from-radiopaedia-1?lang=us)

## Maintenance

These scripts are for maintaining the desktop app, not for normal deck generation:

```powershell
.\build-windows-app.ps1
.\create-desktop-shortcut.ps1
```
