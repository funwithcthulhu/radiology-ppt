# Radiopaedia Case PowerPoint Builder

Builds a case-based `.pptx` from one or more radiology diagnoses by:

1. Searching Radiopaedia for a matching case
2. Pulling representative study images from that case
3. Generating a 3-slide sequence for each diagnosis:
   - `Case N`
   - `Radiology Images`
   - `Diagnosis`

The generated slides include visible source attribution with the Radiopaedia author, `rID`, license, and case URL.

You can also add a study hint after the diagnosis:

- `multiple sclerosis, mri brain`
- `pancreatitis, mri abdomen`
- `appendicitis, ct abdomen`

You can also request random cases:

- `random`
- `random, mri brain`
- `3`
- `msk`
- `body`
- `mri`
- `ct abdomen`
- `neuro diagnosis`
- `pediatrics diagnosis`
- `pediatric neuro diagnosis, mri brain`

The GUI and probe flow use those hints to improve case selection and image study choice.

## Quick Start

From `C:\projects\radiopaedia_case_powerpoint_builder`:

```powershell
.\generate-case-deck.ps1 -Diagnosis "multiple sclerosis","pneumonia"
```

Or use an input file with one diagnosis per line:

```powershell
.\generate-case-deck.ps1 -InputFile .\diagnoses.txt -Title "Resident Review Cases"
```

Outputs are written to `.\outputs\`.

## Desktop GUI

Launch the GUI directly from the project folder:

```powershell
pythonw .\gui_app.py
```

Or create the Desktop shortcut:

```powershell
.\create-desktop-shortcut.ps1
```

The GUI lets you:

- add `Specific Diagnosis`, `Random Case`, or `Manual Case URL` rows
- use optional dropdown filters for primary modality, backup modality, anatomy, age group, topic focus, and difficulty
- request random browser styles such as `Any Case`, `Subspecialty Browser`, `Modality Browser`, `Anatomy Browser`, or `Mixed Deck`
- choose a deck theme, default crop style, default markup style, and whether teaching-point slides should be added
- load legacy text files or JSON request files
- review ambiguous matches before building
- review each prepared case with its actual images before export, then keep, reroll the case, repick images from the same case, favorite it, or block it
- save kept cases into a local case library and reload favorite/saved cases later
- generate the deck and open it when finished
- build a packaged Windows app and refresh the desktop shortcut from inside the GUI

## Options

- `-Diagnosis`: one or more diagnosis strings
- `-InputFile`: text file with one diagnosis per line
- `-Output`: optional output `.pptx` path
- `-Title`: optional deck title
- `-ImagesPerCase`: how many images to place on each image slide, default `3`
- `--theme`: render preset such as `classic`, `clean-light`, `conference-dark`, or `teaching-warm`
- `--include-teaching-points`: add a teaching-points slide after each diagnosis slide

## Notes

- The tool picks the top Radiopaedia case match for each diagnosis query, so it is worth reviewing the finished deck before you use it clinically or for teaching.
- Random/category lines work by sampling from current Radiopaedia case search results, optionally filtered by case system labels such as `Central Nervous System` and `Paediatrics`.
- Random selections now avoid recently used cases across runs so repeated decks do not keep recycling the same case pages.
- Common shorthand is accepted for subspecialties and areas, including `msk`, `body`, `neuro`, `pediatric`, and modality-only requests like `mri`, `ct abdomen`, or `mri brain`.
- If a case only exposes one or two clearly relevant finding frames, the generator will now use fewer, stronger images instead of forcing a weak extra panel.
- When Radiopaedia exposes annotation coordinates, the selected images can now be focus-cropped around the finding and optionally overlaid with subtle focus rings.
- Minimal clinical history can be added to the intro slide, and if a local Ollama vision model is installed the app can also score selected images during case preparation.
- The packaged desktop build is written to `.\dist\Radiopaedia Case PowerPoint Builder\`, and the desktop shortcut script now prefers that `.exe` automatically when it exists.
- Radiopaedia’s article on presentation reuse says using Radiopaedia images in presentations is encouraged, with attribution. This project bakes attribution into the slides:
  [Using and attributing images from Radiopaedia](https://radiopaedia.org/articles/using-and-attributing-images-from-radiopaedia-1?lang=us)
- Current case pages expose a Creative Commons license link in the HTML metadata. The script carries that license onto the slides for each case.
