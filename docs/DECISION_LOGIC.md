# Decision Logic

This document describes how the app chooses cases, selects images, and stores local state.

## Case Request Flow

Each row on the `Cases` tab becomes one or more normalized case requests.

- `Specific Diagnosis` searches Radiopaedia for cases matching the diagnosis and optional dropdown filters.
- `Random Case` expands into the requested number of random case requests, using dropdown filters to steer the search.
- `Manual Case URL` uses the exact Radiopaedia case path or URL.

The backend sends progress and timing events for each major stage. These appear in `Activity` and are also stored as backend job rows in SQLite.

## Random Case Selection

Random mode uses history and filters to reduce repeated cases.

Selection order:

1. Read local exclusions from recent random history, skipped/rejected cases, and the current review request.
2. Search the local `case_index` first for previously prepared cases that match the filters.
3. Prefer indexed cases with lower random-use counts and older last-used times.
4. If the local index does not have enough matches, run live Radiopaedia search.
5. Add selected cases to random history so later runs avoid them.

The first run for a new category can be slower. Later runs can be faster and less repetitive because the local index has prepared-case metadata.

Narrow filters can still exhaust the public case pool. If reroll cannot find a new case, broaden modality/anatomy/area filters or skip the case.

## Image Selection

The app builds a candidate bank from Radiopaedia studies and ranks frames by relevance.

High-value signals:

- Radiopaedia annotations on that slice
- Radiopaedia key image
- current viewer slice
- proximity to annotated slices
- distinct series/view coverage
- optional Ollama score when you manually run `Ollama Score Case`

Selected images now carry `selectionExplanation`, which is shown in review and written to the PowerPoint manifest. The `Details` tab also lists selected-image rationale.

The candidate bank is kept separately from selected images. That allows review actions such as `Re-pick Images`, `Replace Unchecked`, and manual `Candidates` selection without reloading the whole case whenever possible.

## Review Decisions

The review window writes local decisions into SQLite.

- Keeping/favoriting a case records it as useful.
- Skipping a case records it as avoided for future random pulls.
- Unchecking/removing an image records that frame as rejected.
- Re-picking avoids rejected frames when possible.
- If no alternate frame exists, the app keeps the slot empty instead of silently reusing the rejected frame.

These decisions stay local. They are not synced to Radiopaedia or GitHub.

## Backend Jobs

The C# GUI talks to a persistent local Node service through JSON lines. Long-running commands now write durable job rows to `backend_jobs`.

Tracked commands include:

- case preparation
- PowerPoint rendering
- Ollama image scoring
- Core Boards imports

The Activity tab shows recent backend jobs with status and duration. This separates Radiopaedia/network delays from application failures.

## Storage Strategy

SQLite stores durable app state:

- app settings
- review sessions
- case and image decisions
- generated PowerPoint metadata
- HTTP/backend cache rows
- random history
- prepared-case index
- backend job diagnostics
- schema migrations

File folders store generated or cached artifacts:

- `cache\`: downloaded metadata/images and reusable backend cache files
- `scratch\`: temporary PowerPoint build files
- `outputs\`: generated PowerPoints
- `library\board-review\`: private Core Boards imports

Use `Activity` > `Run Maintenance` to clean old cache/scratch files and optimize SQLite after many test runs.

## Speed Tradeoffs

The app optimizes for review quality first, then speed.

- Initial random runs can be slower because Radiopaedia pages and image studies must be loaded.
- Later runs improve because search pages, candidate banks, image decisions, and case index rows are cached.
- Background fallback prefetch is off by default to avoid surprising network activity.
- Ollama is never used during initial preparation; it only runs when you explicitly score a reviewed case.
- HTTP concurrency is capped to avoid hammering Radiopaedia.

If a category is slow, start with fewer cases, use broader filters, and let the cache/index build up.
