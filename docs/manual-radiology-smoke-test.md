# Manual Radiology Smoke Test

Use this checklist for maintainer verification after changes that affect case
preparation, review, export, Core Review import, local storage, or backend
diagnostics. Record the date, commit, Windows version, whether Ollama was
enabled, and the exact output path tested.

Do not use private patient data. Do not import copyrighted or private source
material unless you have the right to use it locally.

## Exact Case URL

Use this manual case URL unless it is unavailable at test time:

```text
https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us
```

If the URL is unavailable, record the replacement Radiopaedia case URL in the
test notes.

## Cases Workflow

- Open the app from the source checkout or installed build under test.
- In `Cases`, add one `Manual Case URL` row with the exact URL above.
- Add one `Random Case` row with a small count, such as 2, and leave `Only use
  new random cases` enabled.
- Set a temporary `Output .pptx` path under a throwaway directory.
- Click `Generate PowerPoint`.
- Confirm the review window opens instead of exporting immediately.

## Review Actions

- Keep one usable case.
- Skip one prepared case and confirm review advances.
- Use `Reroll Case` once on a prepared case and confirm the replacement is a
  different Radiopaedia case when one is available.
- Use `Re-pick Images` once and inspect the `Details` rationale.
- Uncheck one image, use `Replace Unchecked`, and confirm the image slot changes
  or is left empty with a clear warning when no replacement exists.
- Use `Candidates` to manually select a same-case image when candidates exist.

## PowerPoint Export

- Approve the final reviewed cases.
- Confirm the `.pptx` is written to the chosen output path.
- Confirm the generated manifest exists beside the PowerPoint when that output
  is produced by the current workflow.
- Open the PowerPoint only to check that slides exist, attribution remains
  visible, and the intro slide does not reveal the diagnosis when clean intro
  text is available. Do not treat this as a clinical-content review.

## Core Review Import

- Create a temporary plain-text source file with non-private study notes.
- In `Core Review`, import the text source into a temporary domain.
- If testing PDF, `.docx`, or `.pptx` import, use only a small local file you
  have the right to use and record the filename.
- Confirm imported assets remain under `library\board-review\`.
- Generate a small Core Review PowerPoint from the imported source option and
  approve any cases/images in the review window before export.

## Local Cleanup

- Use `Activity` > `Refresh Diagnostics` and record state/cache/job counts that
  changed during the smoke test.
- Use `Activity` > `Clean Scratch`.
- Use `Activity` > `Clean Old Cache` only if the test run intentionally created
  disposable cache data.
- Open the state folder and remove temporary smoke-test outputs that should not
  remain on the machine.

## Backend Restart And Health

- Click `Activity` > `Refresh Diagnostics` before and after the run.
- Confirm recent backend job rows show prepare/render/import statuses and
  durations.
- Use `Cancel Current Task` only during an intentionally stuck or disposable
  backend action; it kills the active Node backend process and the app starts a
  fresh service on the next request.
- Close and reopen the app, then confirm the Activity log reports the project
  root, Node runtime, and refreshed diagnostics.
