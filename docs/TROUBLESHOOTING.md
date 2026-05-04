# Troubleshooting

## The App Says Not Responding

If Windows marks the app as not responding, the backend is usually waiting on Radiopaedia, PowerPoint rendering, or a local model.

Try:

1. Wait 10-20 seconds if Radiopaedia is actively loading.
2. Use `Cancel Current Task` on the PowerPoint tab for prepare/render/import work.
3. Use `Cancel Action` in the review window for reroll, re-pick, replace, or Ollama scoring.
4. Check the Activity tab for the last logged step.

Canceling a stuck action may kill and restart the local Node backend service.

If freezing repeatedly happens during review, disable Ollama review and use `Ollama Score Case` only on one case at a time.

## Backend Service Restarted

The GUI keeps one local Node backend service open for review actions. The health monitor pings the service only when it is idle. If the service dies, the app logs a restart and continues.

This is normal if:

- a previous action was cancelled
- a Radiopaedia request hung and was killed
- the Node process exited unexpectedly

If restarts happen constantly:

1. Open Activity.
2. Look for repeated backend errors.
3. Run `npm test` from the repository root.
4. Rebuild the packaged app.

## Random Cases Repeat Too Often

The app records random history, skipped/rejected cases, and prepared-case quality in:

```text
state\radiology-ppt.sqlite
```

Actions:

- Skip weak cases during review so random mode avoids them later.
- Reroll unwanted cases instead of approving them.
- Keep `Only use new random cases` enabled on the PowerPoint tab if you prefer fewer cases over reused random cases.
- Use broader filters if a narrow category has only a small pool.
- Use the Library tab to see whether a category is cycling through familiar cases.
- Do not delete the state database unless you intentionally want to reset history.

Random mode starts with live Radiopaedia search. Later runs may still improve because the app can use `case_index` as a fallback after live search cannot fill the request.

For generic random decks, repeated runs should continue finding unused Radiopaedia cases. If repeats still happen, check that `Only use new random cases` is checked and review the Activity log for Radiopaedia errors or cancelled searches.

## Reroll Case Says No Alternate Was Found

Reroll excludes the current case and searches again for the same request. It does not intentionally reuse the selected case.

If no alternate is found:

- the category may be too narrow
- the requested modality/anatomy/subspecialty combination may have too few public cases
- the current case may have come from an exact/manual URL with no useful alternate search text

Try broadening filters, changing Area to `Any` or `Mixed`, or skipping the case.

## Random Preparation Seems Slow

Random preparation has two phases:

1. Find candidate cases.
2. Load case pages, studies, candidate images, and selected images.

The Activity tab logs timing for major stages.

Actions:

- Start with fewer random cases only if Radiopaedia is slow or your filters are very narrow.
- Use broader filters if a filtered search stalls.
- Re-run after one successful pass so cached metadata and `case_index` can help.
- Avoid Ollama during initial preparation.
- Use `Run Maintenance` after many test runs.
- Check `Activity` for recent backend job duration. If `prepare` is long, the delay is usually live Radiopaedia case/study loading rather than PowerPoint rendering.

Random discovery defaults:

- `RADIOLOGY_PPT_RANDOM_SEARCH_PAGE_LIMIT=250`
- `RADIOLOGY_PPT_RANDOM_CANDIDATE_LIMIT=3000`
- `RADIOLOGY_PPT_RANDOM_SEARCH_TIMEOUT_MS=300000`

If network work feels too aggressive or Radiopaedia/curl errors become frequent, lower HTTP concurrency before launching the app:

```powershell
$env:RADIOLOGY_PPT_HTTP_CONCURRENCY = "2"
```

Background fallback prefetch is off by default. To opt into warming alternate random case pages after preparation:

```powershell
$env:RADIOLOGY_PPT_PREFETCH_FALLBACKS = "1"
```

## Ollama Takes Too Long

Ollama is optional and intentionally deferred to review.

Recommended use:

1. Enable `Use Ollama image review` only if you want local model help.
2. Choose a local model in the PowerPoint tab.
3. Generate normally.
4. In review, click `Ollama Score Case` only for selected cases.

Default limits:

- `RADIOLOGY_PPT_OLLAMA_IMAGE_TIMEOUT_MS=12000`
- `RADIOLOGY_PPT_OLLAMA_CASE_TIMEOUT_MS=20000`
- `RADIOLOGY_PPT_OLLAMA_MAX_IMAGES_PER_CASE=1`

Lower those values if your local model is slow.

## Re-pick Images Gives The Same Images

Use this sequence:

1. Uncheck the bad image.
2. Click `Replace Unchecked`.
3. If no replacement exists, the app leaves that slot empty instead of reusing the rejected image.
4. Use the `Candidates` tab to manually select a better same-case frame if one exists.

If the case has only a few useful frames, use `Remove Unchecked` and export fewer images.

Use the image rationale in the review window to see why a frame was selected. If the rationale is weak, check the `Candidates` tab for annotated or key-image candidates.

## The Case Intro Gives Away The Diagnosis

Intro slides stay minimal. With `Show patient age/sex when available` enabled, the app prefers age/sex context and avoids diagnosis-revealing findings.

If Radiopaedia does not expose clean patient information, the slide may only say `Case N`.

If you want pure unknown-case conference mode, leave teaching-point slides off.

## PowerPoint Completed But I Did Not See A Popup

The success popup was removed because it interrupted review/export flow.

Use:

- left status area
- Activity log
- `Open Last PowerPoint`
- `Open Outputs Folder`

## The Window Opens Off Screen

The app clamps launch placement to the visible Windows work area.

If Windows display scaling changes while the app is open:

1. Close the app.
2. Reopen it from the desktop shortcut.
3. If it still opens incorrectly, rebuild the shortcut:

```powershell
.\create-desktop-shortcut.ps1
```

## The Desktop Shortcut Opens An Old App

Refresh the packaged app and shortcut:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

If you installed from GitHub Releases, rerun the latest installer instead. The installer writes Start menu shortcuts and can optionally create a desktop shortcut.

## Windows Blocks The Installer

The release installer is not code-signed yet, so Windows SmartScreen may warn on first launch.

Use the installer only from the official GitHub Releases page:

```text
https://github.com/funwithcthulhu/radiology-ppt/releases
```

Code signing is not configured yet.

## Generator Files Are Missing

This means the executable cannot find the repository resources.

The app must be able to locate:

```text
src\backend-service.mjs
```

Use the normal build script and do not copy only the `.exe` elsewhere:

```powershell
.\build-csharp-app.ps1
```

## PowerPoint Generation Fails

Check Activity first.

Common causes:

- no matching Radiopaedia case
- temporary Radiopaedia/network issue
- output path is locked by an open PowerPoint file
- cache/scratch files were partially written during cancellation
- the backend service was killed mid-action

Try:

1. Close the output PowerPoint if it is open.
2. Change the output filename.
3. Run `Clean Scratch` or `Run Maintenance`.
4. Re-run with broader filters.

## Core Boards Import Fails

Common causes:

- PDF is locked or inaccessible
- PDF is very large
- output folder is unavailable
- imported material is image-heavy and extraction takes time

Try:

1. Import fewer PDFs at once.
2. Use a broad domain such as `General / Mixed`.
3. Check Activity for the failing file.
4. Make sure `library\board-review\` is writable.

## Reset Local State

Use this only if you intentionally want to lose app history and review decisions.

1. Close the app.
2. Move or delete the active state folder shown in Activity.

For source-checkout runs, the default database is:

```text
state\radiology-ppt.sqlite
```

For installed runs, the default app data folder is:

```text
%LOCALAPPDATA%\RadiopaediaCasePowerPointBuilder
```

3. Reopen the app.

Do not delete `outputs\` unless you no longer need generated PowerPoints.
