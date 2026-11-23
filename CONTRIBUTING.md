# Contributing to dsh-subagent-panel-plus

Thanks for considering a contribution. This guide explains how work is organized here: how to pick it up, how it is reviewed, and what is expected before merge. Following it respects the time of the people who review your change.

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Before you start](#before-you-start)
- [Development setup](#development-setup)
- [Conventions](#conventions)
- [Pull request lifecycle](#pull-request-lifecycle)
- [Review and approval](#review-and-approval)
- [Checklist](#checklist)
- [Sign your commits](#sign-your-commits)
- [Bugs and security](#bugs-and-security)

## Ways to contribute

- **Code** — fixes to the authenticated Host routes or to the browser panel.
- **Documentation** — README, the specification, ADRs, and this guide.
- **Bug reports and triage** — reproduce an issue, add detail, confirm duplicates.
- **Reviews** — reviewing someone else's pull request is a contribution too.
- **Metadata** — plugin title and description in `locale/`.

This plugin is deliberately small and build-free. Changes that add network calls, alter the deletion model, or move responsibility between the two halves need an issue and agreement first. Read `docs/SPEC.md` and `docs/adr/` before proposing a structural change.

## Before you start

- For anything larger than a typo or an obvious fix, open an issue first: describe the problem, the intended change, and why it belongs here.
- Comment on the issue to say you are taking it, so two people do not do the same work.
- Issues labeled `good first issue` and `help wanted` are good starting points.
- If you get stuck, ask in the issue. Include what you tried, your OS, and your dsh version.

## Development setup

Requirements: Node.js 22 or newer. No dependencies to install.

| Command | What it does |
| --- | --- |
| `npm run check` | Syntax check of `client.js` and `host.js`. |
| `npm test` | `node --test` over `test/*.test.mjs`. Fakes only, no dsh process. |

To try a change in dsh, install this checkout as a local plugin from **Plugins → Add plugin** with its absolute path. JavaScript changes take effect after restarting dsh. (For a published package, the CLI form is `dsh plugin --profile <name> add <package>`.)

Layout: `host.js` holds the authenticated `delete`/`exists` routes; `client.js` holds the header chip, tree, keyboard navigation, and row actions; `cordis.patch.yml` inserts the plugin row; `icon.svg` and `locale/en.json` carry the identity. There is no build step — both JavaScript files are source.

## Conventions

- **Branches:** `<type>/<short-slug>`, for example `fix/panel-keyboard` or `docs/contribution-guide`. One change per branch.
- **Commit messages:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- All repository content — comments, labels, tests, and documentation — is in English.
- Behavior changes come with tests. Write the failing test first where practical.
- Keep UI text in English, including locale metadata.

## Pull request lifecycle

- Open a draft PR early if you want feedback; mark it ready for review once the checklist passes.
- Keep pull requests small and focused on one change. Say what changed and why.
- Expect first feedback within about 7 days. If nothing arrives after that, ping the reviewer in the PR.
- Respond to review feedback within two weeks. After four weeks without activity we may close the pull request or pick it up.
- If you no longer want to finish, say so in the PR — we will close it or take it over.
- Merged work ships from `main`; release tags are cut separately by the maintainer.

## Review and approval

- `.github/CODEOWNERS` assigns `@magalz` to every file, so GitHub requests a review automatically for pull requests opened by other contributors.
- The policy is **one approving review from a code owner plus a green `check` CI run** before merge. Reviews should be specific and kind: comment on the line, not the person.
- GitHub does not count the author's own approval. Today branch protection enforces the pull request, the `check` status, and resolved conversations; the approval count is a documented policy until a maintainer enables it in branch protection after a second approver has write access.
- The author does not merge their own pull request while another reviewer is available.

## Checklist

- [ ] The change is small, focused, and the description explains why.
- [ ] A related issue is referenced (`Fixes #N`) or the change is too small to need one.
- [ ] `npm run check` and `npm test` pass locally.
- [ ] Behavior changes have new or updated tests.
- [ ] Documentation is updated when behavior or UI changed.
- [ ] Every commit has a DCO `Signed-off-by` line.
- [ ] The `check` CI run is green before merge.

## Sign your commits

We use the [Developer Certificate of Origin](https://developercertificate.org/) (DCO), not a contributor license agreement. Add a sign-off to every commit with `git commit -s`:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

By signing you certify that you wrote the contribution or otherwise have the right to submit it under this repository's license. A reviewer will ask for a sign-off if one is missing.

## Bugs and security

Open an issue to report bugs or request features. Never report a vulnerability in a public issue — use GitHub's **Report a vulnerability** link on the Security tab and see [SECURITY.md](SECURITY.md).
