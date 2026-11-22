# Pull request #1 — initial plugin import

Target: `https://github.com/magalz/dsh-subagent-panel-plus.git` (public repository, default branch `main`, no tags and no pull requests before this work).

## Sequence

1. Commit the approved documentation, the package rename, the manifest fixes and the MIT license on local `main` at `D:\Repos\dsh-plugins\dsh-agent-identification`.
2. Create the initial commit on remote `main` with a minimal skeleton so PR #1 has a valid base branch.
3. Cut branch `feature/initial-plugin` from that base and add the complete plugin, tests, metadata and documents.
4. Push the branch and open PR #1 as a draft into `main`.

## PR title

Add the subagent panel plus plugin

## PR body

```markdown
## Summary

- Adds a DSH bundle that replaces the native subagent list in the session header.
- Shows each subagent's model and reasoning effort, state ordering, status dots, tokens, working time and start time.
- Adds an Archive action and a two-click permanent delete behind DSH's Connection gate.
- Includes a Host half with authenticated `exists` and `delete` routes, a build-free Client half, display metadata, an icon and 37 Node tests.
- Adds a specification, architecture decision records, business rules and a community-readiness review.

## Verification

- `npm run check`: passed.
- `npm test`: 37 passed, 0 failed.
- `npm pack --dry-run`: all eight expected files are packaged.
- Keyboard use was tested personally by the owner. Rendered icon and menu placement are not verified.

## Remaining work

- Tag `v0.1.0` and add the `dsh-plugin` topic after the draft is reviewed.
- Verify the rendered icon and description in the Plugins page.
```
