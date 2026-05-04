# Decision Logic

This document explains case selection, image selection, and local state.

## Case Request Flow

Each row on the `Cases` tab becomes one or more normalized case requests.

- `Specific Diagnosis` searches Radiopaedia for cases matching the diagnosis and optional dropdown filters.
- `Random Case` expands into the requested number of random case requests, using dropdown filters to steer the search.
- `Manual Case URL` uses the exact Radiopaedia case path or URL.

The backend logs progress and timing for each major stage. Activity displays those events and stores backend job rows in SQLite.

## Random Case Selection

Random mode uses history and filters to reduce repeated cases.

Selection order:

1. Read local exclusions from recent random history, skipped/rejected cases, and the current review request.
2. Search live Radiopaedia results for unused cases that match the filters, walking deeper result pages as needed.
3. If live search does not find enough unused cases, use the local `case_index` as a fallback for unused previously discovered cases.
4. If `Only use new random cases` is unchecked, fill any remaining slots with older cases only after unused discovery fails.
5. Add selected cases to random history so later runs avoid them.

`Only use new random cases` is enabled by default. Generic random searches should keep finding unused Radiopaedia cases across repeated decks. If an unusually narrow filter still cannot fill the request, that indicates a filter/network/search-limit problem rather than a small Radiopaedia case pool.

The first run for a new category is often slower because the app starts with live Radiopaedia discovery. Later runs can still benefit from the local index as a fallback, but random mode does not start from previously prepared cases.

Narrow filters can still over-constrain discovery. If reroll cannot find a new case, broaden modality/anatomy/area filters or skip the case.

## Image Selection

The app builds a candidate bank from Radiopaedia studies and ranks frames by relevance.

High-value signals:

- Radiopaedia annotations on that slice
- Radiopaedia key image
- current viewer slice
- proximity to annotated slices
- distinct series/view coverage
- optional Ollama score when you manually run `Ollama Score Case`

Selected images carry `selectionExplanation`, shown in review and written to the PowerPoint manifest. The `Details` tab lists the same rationale.

The candidate bank is separate from selected images, so `Re-pick Images`, `Replace Unchecked`, and manual `Candidates` selection can reuse same-case frames without reloading the whole case when possible.

## Review Decisions

The review window writes local decisions into SQLite.

- Keeping/favoriting a case records it as preferred.
- Skipping a case records it as avoided for future random pulls.
- Unchecking/removing an image records that frame as rejected.
- Re-picking avoids rejected frames when possible.
- If no alternate frame exists, the app keeps the slot empty instead of silently reusing the rejected frame.

These decisions stay local and are not synced to Radiopaedia or GitHub.

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

- Initial random runs are slower because Radiopaedia pages and image studies must be loaded.
- Later runs improve because search pages, candidate banks, image decisions, and case index rows are cached.
- Background fallback prefetch is off by default to avoid surprising network activity.
- Ollama is never used during initial preparation; it only runs when you explicitly score a reviewed case.
- HTTP concurrency is capped to avoid hammering Radiopaedia.

If a category is slow, start with fewer cases, use broader filters, and let the cache/index build up.
