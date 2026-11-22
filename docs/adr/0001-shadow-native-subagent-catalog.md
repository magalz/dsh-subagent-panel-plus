# ADR-0001: Shadow the native subagent catalog instead of replacing DSH code

Date: 2026-11-21 · Status: Accepted

## Context

The native subagent list is registered in the `conversation.session.header.actions` slot under id `subagent-catalog`. DSH renders the lowest-priority registration for a given id and throws on a duplicate at the same priority. Editing DSH's own source is not an option for a distributable bundle, and a second independent chip would duplicate controls and confuse users.

## Decision

Register the replacement with the same id (`subagent-catalog`) at priority `-1`. The native entry stays registered but is not rendered. Removing the bundle restores the native chip without a migration step.

The replacement reuses DSH's own services (`sessions`, `uiWorkspace`, `sidebarRight`, `slots`) and locale namespace `subagent` for the strings DSH already provides.

## Consequences

- Installation and removal are reversible with no changes to DSH files.
- Any change to the native entry's id or priority contract breaks the shadowing silently; this is the main compatibility risk and motivates an explicit `engines.dsh` range.
- Features owned exclusively by the native footer entry, notably the agent-team task board, cannot be reproduced through this slot and remain a documented gap.
