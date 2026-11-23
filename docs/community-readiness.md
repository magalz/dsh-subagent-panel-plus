# Community readiness review

Reviewed at implementation revision `ee70dbf` against the DSH 0.2.2-rc.5 documentation
(`docs/user/develop/basic/publish.md`, `docs/user/guide/plugin-market.md`) and the `dsh-doc`
display checklist (`references/host-plugin.md`, `plugin-details.md`, `artwork.md`, `ui-plugin.md`).

## Passed

| Criterion | Evidence |
|---|---|
| Bundle manifest declares a configuration layer | `package.json` has `dsh.bundle.patch: ./cordis.patch.yml`. |
| Patch inserts a uniquely named plugin row | `cordis.patch.yml` inserts `subagent-panel-plus` with `name: 'dsh-subagent-panel-plus'`. |
| Client half declares its platform and inject | `dsh.client.platform: web`, `inject: ['@deepseek-ai/dsh-client-ui-slots']`. |
| Browser factory id equals the package name | `client.js` loads `id: 'dsh-subagent-panel-plus'`. |
| Resources are exported and packaged | `./locale/*.json` and `./icon` are exported; `files` lists both runtimes, patch, locale, icon, README and LICENSE. |
| Display metadata exists in English | `locale/en.json` has `meta.title` and `meta.description` in sentence case. |
| Icon is a self-contained SVG | `icon.svg` has one circle and two paths; no script, style, image or remote reference. |
| Syntax and behavior checks | `npm run check` passes; `npm test` passes 37 tests. |
| Content is in English | No non-English text in tracked source, metadata, tests or docs. |
| Compatibility is declared | `engines.dsh: >=0.2.2-rc.5 <0.3.0` matches the installed DSH. |
| Publishing fields are present | `private: false`, `license: MIT`, `author`, `repository`, `homepage` and `keywords`. |
| License file | MIT `LICENSE` at the package root. |
| Keyboard interaction | Tested personally by the owner. |

## Remaining gaps

| ID | Gap | Impact | Proposed action |
|---|---|---|---|
| C-04 | No version tag | The Git index generator lists versions from `vX.Y.Z`, `X.Y.Z` or `<name>@X.Y.Z` tags, plus the default-branch version. | Done: tag `v0.1.0` published on 2026-11-23 with the prebuilt tarball attached. |
| C-06 | Rendered display not verified | The icon, title, description and row menu have been checked in source only. | Verify in **Plugins** after a restart; report as unverified if no browser control is available. |
| C-08 | Visible text is not fully routed through the Client locale | DSH recommends localized UI text; this bundle uses English fallback strings. | Keep as a deviation, or add locale keys later. |
| C-09 | No `dsh-plugin` GitHub topic and no public release asset | Community catalogs screen candidates by topic, bundle manifest, license, tests and an installable release. | Done: topic added 2026-11-21; release `v0.1.0` with the tarball published 2026-11-23; catalog submission open as awesome-dsh-plugin#18183. |
| C-10 | Verification is single-tier | Community reviewers distinguish unit-tested, replayed and live-mounted verification. | Keep the current wording: syntax/tests verified, keyboard tested by owner, rendering not verified. |

Community catalogs are third-party and have no binding acceptance process; the criteria above follow the public submission pattern in the [DSH community catalog discussion](https://github.com/deepseek-ai/deepseek-harness/discussions/1045) and the bundled DSH documentation.

## Optional, not blocking

- `meta.detail` is absent, so Plugin Manager falls back to the package README. This is allowed; keep functionality in `meta.description`.
- The icon uses `currentColor` and a 24-unit viewBox. The artwork guidance suggests a fixed palette and a 36-unit viewBox; it still decodes as a self-contained SVG, but its rendered contrast should be checked in both themes (C-06).
