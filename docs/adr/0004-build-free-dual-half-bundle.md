# ADR-0004: Ship a build-free dual-half bundle

Date: 2026-11-21 · Status: Accepted

## Context

Installing from a git host fetches sources, not built artifacts: a TypeScript package without a `prepare` script fails to load, and pnpm requires the user to allow the build. The plugin needs both a Host module and a browser module.

## Decision

Author plain ESM files (`host.js`, `client.js`) with no dependencies, no transpilation and no install scripts. `package.json` exposes the bundle patch plus the `./client` subpath and declares `dsh.bundle.patch` and `dsh.client.platform: web` with the `dsh-client-ui-slots` inject.

## Consequences

- A git install needs no `allowBuilds` permission and loads the same bytes that are tested locally.
- The browser half is a hand-written `__ModuleLoader__` factory, so type checking and JSX tooling are unavailable; correctness relies on the Node tests and a live UI check.
- All runtime files must stay listed in `package.json` `files`; adding a module requires updating that array.
