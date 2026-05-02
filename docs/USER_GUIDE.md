# User Guide

This app builds case-based radiology PowerPoints from Radiopaedia cases. The normal workflow is:

1. Add case requests on the **Cases** tab.
2. Choose output options on the **PowerPoint** tab.
3. Click **Generate PowerPoint**.
4. Review each prepared case and image.
5. Export the final PowerPoint.

## Cases Tab

![Cases tab overview](images/cases-tab.svg)

Use one row per request.

- **Specific Diagnosis**: use this for named diagnoses such as `multiple sclerosis` or `appendicitis`.
- **Random Case**: use this for random teaching cases. Set the count and optional filters with the dropdowns.
- **Manual Case URL**: use this when you already know the exact Radiopaedia case URL.

Useful random filters:

- **Modality**: MRI, CT, X-ray, ultrasound, PET, mammography, and others.
- **Anatomy**: brain, spine, abdomen, chest, breast, MSK regions, and others.
- **Area**: neuro, pediatric neuro, MSK, body, breast, cardiac, etc.
- **Age / Focus / Difficulty**: optional filters for more targeted random cases.

## PowerPoint Tab

![PowerPoint tab overview](images/powerpoint-tab.svg)

The **PowerPoint** tab controls the final presentation.

- **Preset**: applies common settings quickly.
- **Title**: optional. If blank, the app creates a title automatically.
- **Images per case**: target number of images. The review window can keep fewer if a case does not have enough good images.
- **PowerPoint style**: `Case Conference` or `Core Review`.
- **Theme**: visual style for the exported slides.
- **Image crop / markup**: controls focus cropping and optional focus rings.
- **Use Ollama image review**: keeps initial preparation fast; use **Ollama Score Case** in review when you want local model scoring for a specific case.

## Review Window

![Review window overview](images/review-window.svg)

Review is intentionally human-in-the-loop.

- **Keep Case & Next**: approves the current case and moves forward.
- **Skip Case**: rejects this case so random selection avoids it later.
- **Reroll Case**: gets a different case for the same request.
- **Re-pick Images**: gets a new image set from the same case.
- **Replace Unchecked**: uncheck bad images first, then replace only those slots.
- **Remove Unchecked**: uncheck bad images first, then keep a smaller image set.
- **Candidates tab**: manually pick exact alternate frames from the same Radiopaedia case.
- **Ollama Score Case**: scores the current kept images only when Ollama review is enabled.
- **Cancel Action**: stops a stuck reroll, image repick, or Ollama score request.

## Recommended Workflows

Fast random teaching deck:

1. Cases tab: add `Random Case`, set count, choose optional area/modality filters.
2. PowerPoint tab: apply **Fast Preview**.
3. Generate, review, skip/reroll weak cases, export.

Higher-quality image deck:

1. Cases tab: add specific diagnoses or random filtered rows.
2. PowerPoint tab: apply **Image Quality Review**.
3. In review, use **Candidates** or **Replace Unchecked** for weak frames.

Ollama-assisted image review:

1. PowerPoint tab: apply **Ollama Assisted** or enable **Use Ollama image review**.
2. Generate normally.
3. In review, click **Ollama Score Case** only on cases where you want model help.

Core Review style:

1. Cases tab: choose cases.
2. PowerPoint tab: apply **Core Review Teaching**.
3. Export with teaching points when available.

## Local Data

The app stores local-only state in:

- `state/radiology-ppt.sqlite`
- `cache/`
- `scratch/`
- `outputs/`
- `library/board-review/`

These paths are ignored by Git. Use the **Activity** tab to refresh diagnostics, open the state folder, clean scratch files, or clean old cache files.
