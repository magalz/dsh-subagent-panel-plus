# BDR-0002: Archive and permanent-delete rules

Date: 2026-11-21 · Status: Accepted

Business rules enforced by `host.js` and mirrored in the Client menu. The Host is authoritative: a disabled menu item is a convenience, not a security control.

| ID | Rule | Response when violated |
|---|---|---|
| BDR-010 | Only a listed subagent session may be deleted. | `404` for an unlisted id; `403` for a listed session that is not a subagent. |
| BDR-011 | The target and every descendant subagent must be stopped. | `409`; nothing is archived and no folder is removed. |
| BDR-012 | The target folder must exist and contain a `session.v<N>.jsonl` or `.zstd` log. | `410`; the row is hidden as already deleted. |
| BDR-013 | Only the target and descendants whose folders hold a session log are removed. | A descendant alone is never deleted in the target's place. |
| BDR-014 | The session must be archived through DSH before any folder is removed. | `409`; no folder is removed if archive fails. |
| BDR-015 | A directory reached through a link is never followed and makes the disk read incomplete. | No row is hidden and no delete target is inferred from a linked folder. |
| BDR-016 | Delete requires two clicks in the Client; the first click arms for four seconds. | A single click never deletes. |
| BDR-017 | Archive and delete are disabled while the subagent runs, and a Host refusal is shown in the open menu. | The row stays and the user sees the reason. |
| BDR-018 | Every route passes DSH's Connection gate and accepts POST only. | `503` when the gate is missing; gate rejection otherwise; `405` for other methods. |
