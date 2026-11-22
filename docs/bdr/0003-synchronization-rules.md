# BDR-0003: Synchronization rules

Date: 2026-11-21 · Status: Accepted

Rules that keep the replacement list correct when state changes outside the open panel.

| ID | Rule | Rationale |
|---|---|---|
| BDR-020 | `exists` reports only posted ids with no folder; it never reports a running or loaded session. | A freshly spawned session may not have written its folder yet. |
| BDR-021 | An incomplete disk read, an empty index or a failed session-list read answers `missing: []`. | Absence of evidence is not evidence of absence. |
| BDR-022 | At most 500 ids are checked per request, and only id-shaped strings are considered. | Bounds work and keeps paths safe. |
| BDR-023 | A successful check replaces the missing state only for the ids it checked; ids outside the request keep their state. | Partial checks must not clear unrelated hidden ids. |
| BDR-024 | A monotonic epoch prevents an older `exists` answer from undoing a newer delete. | Overlapping async requests can otherwise resurrect a row. |
| BDR-025 | An `exists` failure changes nothing; all rows remain visible. | The list must fail open for display and fail closed for deletion. |
| BDR-026 | A `410` delete answer is treated as success and hides the row; other errors leave it visible. | The folder is already gone, so the desired state is reached. |
