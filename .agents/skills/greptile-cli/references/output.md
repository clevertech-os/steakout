# Greptile CLI output reference

Exact shapes of every machine-readable output, and what the exit codes mean.

## Contents

- Exit codes
- `greptile review --json`
- `greptile review status --json`
- `greptile review show --json`
- `greptile config --json`
- `greptile settings --json`
- `greptile skills --json`
- Streams and warnings

## Exit codes

| Code  | Meaning                                                                                       |
| ----- | --------------------------------------------------------------------------------------------- |
| `0`   | Success. For `review status`: the commit has a completed review.                              |
| `1`   | Could not finish. For `review status`: no review exists, signed out, or no usable git remote. |
| `2`   | Invalid invocation: unknown flag, bad flag value, unresolvable commit, malformed argument.    |
| `3`   | `review status` only: a review for the commit is still running.                               |
| `4`   | `review status` only: the most recent review failed.                                          |
| `5`   | `review status` only: the most recent review was cancelled.                                   |
| `130` | Interrupted with Ctrl-C.                                                                      |

`3`, `4`, and `5` are only ever produced by `review status`. Treat any non-zero code from another
command as a plain failure and read stderr for the reason.

**The `1` / `2` split is per-command, not a taxonomy.** Outside a git repository `greptile review`
exits `2` but `greptile config` exits `1`; a missing remote is `1` for both. Do not infer a cause
from the code. Branch on zero versus non-zero and read stderr.

A non-zero exit from `greptile review` means the review did not complete. It does **not** mean the
review found problems. A review that finds ten P0 issues still exits `0`.

### `greptile review` failures a looping agent will hit

All of these exit non-zero with an explanatory stderr message, and none of them mean "the code is
bad":

| Condition                                                                                                | Code |
| -------------------------------------------------------------------------------------------------------- | ---- |
| Detached HEAD                                                                                            | `1`  |
| More than 500 changed files                                                                              | `1`  |
| More than 50 changed `.greptile` files                                                                   | `1`  |
| Diff payload over 3 MB                                                                                   | `1`  |
| The base shares no history with HEAD                                                                     | `1`  |
| Every changed file held back as sensitive                                                                | `1`  |
| `--instructions` empty, over 2000 characters, containing control characters, or combined with `--resume` | `2`  |

## `greptile review --json`

One JSON object on stdout, printed when the review completes.

| Field                 | Type             | Notes                                                        |
| --------------------- | ---------------- | ------------------------------------------------------------ |
| `summary`             | `string \| null` | Markdown summary of the change. May embed a Mermaid diagram. |
| `confidence`          | `1..5 \| null`   | Greptile's confidence the change is ready. `5` is clean.     |
| `confidenceReasoning` | `string \| null` | Why that score.                                              |
| `securitySummary`     | `string \| null` | Present only when security findings exist.                   |
| `instructions`        | `string \| null` | Echo of `--instructions`, if passed.                         |
| `comments`            | `Comment[]`      | Inline findings. `[]` on a clean review.                     |

### `Comment`

| Field              | Type                   | Notes                                                                                             |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------- |
| `id`               | `string`               | Stable within a review.                                                                           |
| `path`             | `string`               | Repo-root-relative POSIX path.                                                                    |
| `startLine`        | `number`               | 1-indexed.                                                                                        |
| `endLine`          | `number`               | Equals `startLine` for a single-line finding.                                                     |
| `side`             | `"old" \| "new"`       | `"old"` anchors to the pre-change file, `"new"` to the post-change file.                          |
| `severity`         | `"P0" \| "P1" \| "P2"` | `P0` most severe.                                                                                 |
| `securityIssue`    | `boolean`              | Flagged as a security problem.                                                                    |
| `category`         | `string`               | **Always the literal `"comment"` here.** Carries no signal on this path; do not branch on it.     |
| `body`             | `string`               | Markdown.                                                                                         |
| `verifiedEvidence` | `null`                 | **Always `null` here.** The JSON renderer never populates it; absence does not mean "unverified". |
| `suggestion`       | `string \| null`       | Replacement code for `startLine..endLine`.                                                        |
| `hunk`             | `Hunk \| null`         | Surrounding diff context. `null` when the comment could not be matched to a hunk.                 |

### `Hunk`

| Field      | Type                               | Notes                                                  |
| ---------- | ---------------------------------- | ------------------------------------------------------ |
| `header`   | `string`                           | The `@@ ... @@` line.                                  |
| `oldRange` | `{ start: number, lines: number }` | Range in the pre-change file.                          |
| `newRange` | `{ start: number, lines: number }` | Range in the post-change file.                         |
| `before`   | `string \| null`                   | The current code the comment refers to.                |
| `after`    | `string \| null`                   | The suggested replacement, same value as `suggestion`. |

### Applying a suggestion

`suggestion` replaces lines `startLine` through `endLine` **inclusive**, on the file identified by
`path`, in the version identified by `side`. Read the file and confirm the current content matches
`hunk.before` before replacing. The working tree may have moved on since the review ran.

Never apply suggestions blindly in bulk. Each one is a proposal, not a verified patch.

## `greptile review status --json`

| Field          | Type                                                            | Notes                                |
| -------------- | --------------------------------------------------------------- | ------------------------------------ |
| `commit`       | `string`                                                        | Full SHA that was checked.           |
| `status`       | `"COMPLETED" \| "IN_FLIGHT" \| "FAILED" \| "CANCELLED" \| null` | `null` when no review exists.        |
| `runId`        | `string \| null`                                                | Pass to `greptile review show <ID>`. |
| `commentCount` | `number \| null`                                                | Findings in that review.             |
| `confidence`   | `1..5 \| null`                                                  | Same scale as `review --json`.       |
| `completedAt`  | `string \| null`                                                | ISO 8601. `null` while in flight.    |
| `baseSha`      | `string \| null`                                                | Base the review ran against.         |
| `headSha`      | `string \| null`                                                | Head the review ran against.         |

When no review is found, every field except `commit` is `null` (`commit` still carries the SHA
that was checked) and the command exits `1`.

## `greptile review show --json`

With an ID, prints that one review in the `review --json` shape above. The ID must be a UUID;
anything else exits `2`.

With **no** ID, prints a JSON **array** of recent reviews grouped by commit, and exits `0` even
when the array is empty:

```json
[
  {
    "baseSha": "...",
    "headSha": "...",
    "baseRef": "main",
    "headRef": "my-branch",
    "reviews": [
      {
        "runId": "...",
        "status": "COMPLETED",
        "commentCount": 3,
        "confidence": 4,
        "summary": "...",
        "completedAt": "...",
        "createdAt": "...",
        "rev": 1,
        "baseSha": "...",
        "baseRef": "main",
        "headRef": "my-branch"
      }
    ]
  }
]
```

This reads **local history only** (`~/.greptile/reviews.json`), scoped to this repository's remote
and the signed-in account, pruned after 14 days and capped at 100 entries. An empty array means
"nothing in local history", not "this branch was never reviewed".

## `greptile config --json`

Prints the resolved config object. Every key below is always present, as empty objects and arrays
rather than missing keys, so there is no need to guard for absence.

| Field           | Type            | Notes                                                                                |
| --------------- | --------------- | ------------------------------------------------------------------------------------ |
| `settings`      | `object`        | Effective review settings. Unset keys fall back to Greptile defaults at review time. |
| `filters`       | `object`        | Applied repo-wide, never cascaded per directory.                                     |
| `rules`         | `Rule[]`        | `{ id, rule, enabled, enforced, severity, source }`.                                 |
| `instructions`  | `Instruction[]` | `{ content, sourcePath }`.                                                           |
| `rulesMarkdown` | `object[]`      | Rules files contributing to the merge.                                               |
| `files`         | `object[]`      | `{ path, description }` context files.                                               |
| `sources`       | `unknown[]`     | Provenance entries; shape is not stable, do not depend on it.                        |

`rule.source.type` is one of `file` (an in-repo `.greptile` file, with `source.path`),
`org_enforced`, `org_default`, or `integration` (the dashboard).

## `greptile settings --json`

`settings list --json` prints an object keyed by setting name:

```json
{ "review.layout": { "value": "diff", "source": "settings" }, "review.context": { "value": 15, "source": "default" } }
```

`source` is `"settings"` (saved by the user), `"default"` (built-in), or `"invalid"` (a saved value
that failed validation).

`settings get <key> --json` prints `{ "key": "...", "value": ..., "source": "..." }`.

`set` and `unset` print their confirmation to **stderr** and emit nothing on stdout.

## `greptile skills --json`

`skills list --json` prints an array of the skills bundled with this CLI:

```json
[{ "name": "greptile-cli", "summary": "...", "files": ["SKILL.md", "references/commands.md"] }]
```

`skills install --json` prints one object. On success (exit `0`):

| Field       | Type                  | Notes                                                    |
| ----------- | --------------------- | -------------------------------------------------------- |
| `ok`        | `true`                |                                                          |
| `scope`     | `"project" \| "user"` | `user` when `--global` was passed.                       |
| `root`      | `string`              | Directory the skill directories were created under.      |
| `installed` | `{ name, paths[] }[]` | `paths` lists every directory actually written this run. |
| `skipped`   | `string[]`            | Names already present in every target, left untouched.   |

A skill can appear in `installed` with only _some_ of its directories when another agent's copy was
already there, because targets are decided independently. `installed: []` with a non-empty `skipped` is a
successful no-op, not a failure; re-run with `--force` to replace.

On failure the object is `{ "ok": false, "error": "..." }`, plus `available` (the valid skill names)
when the cause was an unknown name. Exit is `2` for an unknown name and `1` for a write failure.

## Streams and warnings

- **stdout** carries the payload: JSON, or the rendered review. Parse this.
- **stderr** carries warnings, progress, and error guidance. Never parse it as JSON.

Warnings on stderr are prefixed `warning:` and are non-fatal. Two worth surfacing to the user:

- `warning: could not confirm review status with Greptile; reporting the last known state.`: the
  status came from local history and may be stale.
- `warning: N possibly sensitive file(s) found: …` from `greptile review`. It abbreviates deep
  paths to their last two segments and stops listing past five files, so treat it as a signal, not
  a complete list. Gitignored-but-committed files are held back with no warning at all.

Errors are written to stderr as a message plus, where applicable, suggested commands. When a
command exits non-zero, quote stderr to the user rather than guessing at the cause.
