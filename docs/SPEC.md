# Specification — dsh-subagent-panel-plus

> Version: 0.1.0 · Date: 2026-11-21 · Revision: `ee70dbf` (branch `main`)

## 1. Goal

Replace the native subagent list in the DSH session header with a drop-in replacement that identifies each subagent by model and reasoning effort, orders it by state, and offers archive and permanent-delete actions, while remaining safe to install and uninstall.

## 2. Scope

### In scope

- A DSH bundle with a Host half (`host.js`) and a Web Client half (`client.js`), no build step and no runtime dependencies.
- A header chip and dropdown tree registered under the native entry id (`subagent-catalog`) at priority `-1`, so the native entry is shadowed and returns when the bundle is removed.
- Per-child row data: catalog title, name/mode, model plus reasoning effort, token count, active duration, start time (`since HH:MM`) and a state dot (`running`, `idle`, `done`, `external`).
- Stable ordering: running, idle, done, external; catalog order within each group.
- Keyboard interaction: ArrowDown opens and focuses the first row; Up/Down/Home/End move; Right/Left expand and collapse; Enter/Space opens; Escape closes and restores focus to the chip.
- A per-row "more actions" menu with **Archive** and **Delete permanently**, placed beside the list when there is room and inside it otherwise.
- Two authenticated POST routes: `/dsh-subagent-panel-plus/exists` and `/dsh-subagent-panel-plus/delete`.
- User-facing strings, bundle metadata and the README are in English.

### Out of scope

- The agent-team task board rendered by the native footer entry.
- Retry after a failed catalog load, and migration-required handling in the tree.
- Localization into languages other than English.
- Changing DSH's session model, search index, projection cache or archived-session set.
- Publishing the bundle to npm or to a plugin index (preparation only in this revision).

## 3. Acceptance criteria

1. `npm run check` and `npm test` pass; the suite contains 37 tests at revision `ee70dbf`.
2. The chip is rendered only for a parent session with at least one direct subagent; on a child session the native breadcrumb remains in charge.
3. Every visible row carries a state dot and the model line; a row without a recorded selection shows `—`.
4. Running children are listed before idle, done and external children.
5. Keyboard navigation moves focus among rows and does not open a child when the "more" or "sidebar" button has focus.
6. Archive uses DSH's own archive API and is disabled while the subagent runs.
7. Delete requires two clicks, refuses a running target or descendant, refuses an id not listed by the session controller, refuses a folder without a session log, archives before removing files, and removes only the target and descendant folders.
8. Both routes pass DSH's Connection gate, fail closed when the gate or workspace registry is absent, and reject non-POST requests and oversized bodies.
9. `exists` never reports a running or loaded session as missing and reports nothing when the disk read is incomplete or the root is empty.
10. Uninstalling the bundle restores the native chip.
11. All tracked code, metadata, tests and documentation are in English.

## 4. Failure modes and required behavior

| Failure | Required behavior |
|---|---|
| Session controller unavailable or times out | Delete refuses; the row stays; no files are removed. |
| Connection service not mounted | Both routes answer `503`; no operation runs. |
| Origin/Host mismatch or missing browser credential | Connection gate rejects; no operation runs. |
| Target id malformed, path-like or not listed | `400`/`404`; no archive, no delete. |
| Target or descendant is running | `409`; no archive, no delete. |
| Target is not a subagent origin | `403`; no archive, no delete. |
| Session folder missing or has no session log | `410`; the list hides the row, other rows are untouched. |
| Archive fails | `409`; no files are removed. |
| Disk read fails, root is empty, or a link is encountered | `exists` answers an empty `missing` array; no row is hidden. |
| `exists` request fails or is overtaken by a newer check/delete | The list keeps its current rows; an older answer cannot undo a newer fact. |
| Native entry changes id or priority contract | The replacement stops rendering; the native chip stays available. |

## 5. Priorities

1. **Safety first** — no permanent delete without every check passing, and no cross-origin calls.
2. **Correct identification** — model and state must reflect DSH's own projections.
3. **Native parity** — navigation and keyboard behavior match the native tree where possible.
4. **Community readiness** — complete metadata, icon, license, compatibility declaration and documentation.
5. **Polish** — placement and styling refinements that do not change behavior.

## 6. Non-goals

- Do not guess a session's end time: DSH does not persist one. `since` is based on `updatedAt`, which for a subagent is its spawn prompt.
- Do not follow junctions or symlinks when indexing session folders.
- Do not store plugin configuration or credentials.
- Do not change DSH's own deletion model or edit the session log by hand.

## 7. Verification status

- Verified at `ee70dbf` and again on the publication commit: syntax check and 37 Node tests pass; no non-English text found in tracked source.
- Keyboard use was tested personally by the owner. Not verified: rendered icon and menu placement in Plugin Manager and in a live browser.
- Remaining community-readiness gaps are recorded in `docs/community-readiness.md`.
