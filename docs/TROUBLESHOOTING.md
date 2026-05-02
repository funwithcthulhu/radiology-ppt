# Troubleshooting

## The App Says Not Responding

This should be uncommon now that long-running work is isolated behind background jobs. If it happens:

1. Wait 10-20 seconds if Radiopaedia is actively loading.
2. Use **Cancel Current Task** on the PowerPoint tab for prepare/render/import work.
3. Use **Cancel Action** in the review window for reroll, repick, replace, or Ollama scoring.
4. Check the **Activity** tab for the last logged step.

If it repeatedly freezes at review, disable Ollama review and use **Ollama Score Case** only on one case at a time.

Behind the scenes, the GUI keeps a local Node backend service open. Cancelling a stuck review action may restart that service; this is expected and is safer than leaving a hung Radiopaedia request attached to the review window.

## Random Cases Repeat Too Often

The app records random history and a prepared-case index in `state/radiology-ppt.sqlite`.

Helpful actions:

- Skip weak cases during review so they are avoided later.
- Reroll unwanted cases instead of approving them.
- Use broader filters if a narrow category has only a small pool of cases.
- Use the Library tab to see whether a narrow category is cycling through cases you have already reviewed.
- Do not clean the state database unless you intentionally want to reset history.

The first run for a new filter can still be slow because the app has to discover cases live. Later runs should improve because random mode checks the local `case_index` first and can reuse prepared cases that already had enough relevant images.

## Random Preparation Seems Slow

Radiopaedia random mode has two phases: finding candidate cases, then loading studies/images for each selected case. The Activity tab now logs stage completions with timings, which helps identify whether time is going into search, case loading, image downloads, or PowerPoint rendering.

Helpful actions:

- Start with fewer random cases while exploring a new category.
- Use broader filters if a category is narrow.
- Re-run the same category after one successful pass; cached search/image metadata and `case_index` should reduce repeated work.
- Avoid Ollama review during initial preparation. Use **Ollama Score Case** only on selected review cases.

## Ollama Takes Too Long

Ollama is optional and intentionally deferred.

Recommended workflow:

1. Enable **Use Ollama image review** only if you want local model assistance.
2. Generate normally.
3. In review, click **Ollama Score Case** only for the current case.

Default limits:

- `RADIOLOGY_PPT_OLLAMA_IMAGE_TIMEOUT_MS=12000`
- `RADIOLOGY_PPT_OLLAMA_CASE_TIMEOUT_MS=20000`
- `RADIOLOGY_PPT_OLLAMA_MAX_IMAGES_PER_CASE=1`

You can lower these environment variables if your local model is slow.

If network work feels too aggressive or Radiopaedia/curl errors become frequent, lower backend HTTP concurrency before launching the app:

```powershell
$env:RADIOLOGY_PPT_HTTP_CONCURRENCY = "2"
```

## Re-pick Images Gives the Same Images

Try this sequence:

1. Uncheck the bad image.
2. Click **Replace Unchecked**.
3. If no replacement exists, the app leaves that slot empty instead of reusing the rejected image.
4. Use the **Candidates** tab to manually select a better frame if one exists.

If a case has only a few useful frames, use **Remove Unchecked** and export fewer images.

## The Case Intro Gives Away the Diagnosis

The app tries to keep intro slides minimal. With **Show patient age/sex when available** enabled, it prefers age/sex style patient context. If Radiopaedia does not expose clean patient information, the slide may only say `Case N`.

Avoid enabling teaching-point slides if you want pure unknown-case conference mode.

## The Window Opens Off Screen

The app clamps launch placement to the visible Windows work area. If Windows display scaling changes while the app is open:

1. Close the app.
2. Reopen it from the desktop shortcut.
3. If it still opens incorrectly, rebuild the shortcut with:

```powershell
.\create-desktop-shortcut.ps1
```

## The Desktop Shortcut Opens an Old App

Refresh the packaged app and shortcut:

```powershell
.\build-csharp-app.ps1
.\create-desktop-shortcut.ps1
```

The expected shortcut is:

`C:\Users\Admin\OneDrive\Desktop\Radiopaedia Case PowerPoint Builder.lnk`

## Generator Files Are Missing

This usually means the executable was copied without the project resources, or it is running from an unexpected folder. The app needs to find:

`src\backend-service.mjs`

`src\cli.mjs`

Use the normal build script instead of moving the executable by hand:

```powershell
.\build-csharp-app.ps1
```

## PowerPoint Generation Fails

Check the Activity tab first. Common causes:

- no matching Radiopaedia case
- temporary Radiopaedia/network issue
- output path is locked by an open PowerPoint file
- cache files were partially written during cancellation

Try:

1. Close the output PowerPoint if it is open.
2. Change the output filename.
3. Use **Clean Scratch** or **Run Maintenance** on the Activity tab.
4. Re-run with broader filters.

## Reset Local State

Use this only if you intentionally want to lose app history and review decisions.

1. Close the app.
2. Move or delete `state\radiology-ppt.sqlite`.
3. Reopen the app.

Do not delete `outputs/` unless you no longer need generated PowerPoints.
