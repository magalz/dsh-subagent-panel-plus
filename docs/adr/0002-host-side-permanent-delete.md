# ADR-0002: Implement permanent delete in the Host behind dsh's Connection gate

Date: 2026-11-21 · Status: Accepted

## Context

DSH offers archive for sessions but no permanent delete. The Web Client cannot remove session folders itself, and a route that trusted a bare POST body would let any page on the network call a destructive endpoint.

## Decision

Expose `POST /dsh-subagent-panel-plus/delete` from the Host half. The handler:

1. passes DSH's `connection` gate first and fails closed if the service is missing;
2. validates the id shape and rejects path traversal;
3. reads the session list through `sessionController`;
4. requires the target and every descendant to be listed subagents and not running;
5. requires the target folder to exist and contain a session log;
6. archives through `workspaceRegistry` only after all checks pass;
7. removes only the target and descendant folders that hold a session log.

A companion `POST /dsh-subagent-panel-plus/exists` reports which posted ids have no folder, so a deletion performed by hand or in another browser is reflected in the list.

## Consequences

- Destructive behavior is gated by DSH's own authentication and by the listed-session truth, not by a client assertion.
- DSH's search index, projection cache and archived-session set still contain the deleted id; the UI hides it but other session lists may show an empty entry.
- Permanent delete cannot be undone; the Client requires two clicks and shows an explicit warning.
- The small window between the running check and the archive remains a known limitation.
