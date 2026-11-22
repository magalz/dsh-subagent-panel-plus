# BDR-0001: Listing and identity rules

Date: 2026-11-21 · Status: Accepted

Business rules that decide what the replacement list shows. Each rule is implemented in `client.js` and covered by `test/client.test.mjs` where indicated.

| ID | Rule | Rationale |
|---|---|---|
| BDR-001 | A child is identified by the catalog label, else the session title, else the agent name, else the id. | Matches the native tree; `displayTitle` would fall back to the workspace folder name. |
| BDR-002 | The model line is `model · reasoningEffort` from the latest model-selection projection, else the next queued selection, else `—`. | Shows the selection actually in use, not a configured default. |
| BDR-003 | State is `running` when the status or summary says so; otherwise `done` only when `lastTurnCompleted` is true; otherwise `idle`; external entries are always `external`. | A session that stopped without completing its last turn is idle, not done. |
| BDR-004 | Order is running, idle, done, external; catalog order is stable within a group. | Active work is the first thing the user needs to find. |
| BDR-005 | Tokens are the sum of uncached input, output, cache read and cache write. | Matches DSH's total token count. |
| BDR-006 | Duration is settled time plus the active turn up to now (running) or to `active.through`; `since` uses `updatedAt`, which for a subagent is its spawn prompt. | DSH persists no end-of-turn timestamp; the start label is explicitly a spawn time. |
| BDR-007 | The chip is hidden on a child session and when there are no direct catalog entries. | The native breadcrumb owns navigation inside a subagent. |
| BDR-008 | An archived id or a confirmed missing folder hides the row; an entry with mode `external` is never opened and never actioned. | A deleted or archived subagent must stay gone in every browser. |
