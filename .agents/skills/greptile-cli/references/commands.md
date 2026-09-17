# Greptile CLI command reference

Complete flag matrix for every `greptile` command. The common workflows are in `SKILL.md`; this
file is the exhaustive list.

## Contents

- Synopsis
- Global
- `greptile review`
- `greptile review status`
- `greptile review show`
- `greptile config`
- `greptile settings`
- `greptile skills`
- `greptile login` / `logout` / `whoami`
- `greptile fix`
- `greptile onboard` / `update`
- Recipes

## Synopsis

```sh
greptile login [--api-key] | logout | whoami
greptile review [-b BRANCH] [--layout comments|diff | --diff] [--resume] [--include PATH...]
                [--instructions TEXT] [--json | --text | --agent] [--context LINES]
                [--width COLUMNS] [--no-color]
greptile review show [ID]   # same output flags as review
greptile review status [--commit REF] [--json | --text | --agent]
greptile config [PATH] [--json]
greptile settings list | get KEY | set KEY VALUE | unset KEY | path
greptile skills list [--json] | install [NAME...] [-g] [-f] [--json]
greptile fix install | status [--json] | uninstall [--remove-mappings]
greptile onboard
greptile update
```

## Global

| Flag                | Effect                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `-V`, `--version`   | Print the CLI version and exit.                                    |
| `-h`, `--help`      | Print help for the command and exit.                               |
| `--width <COLUMNS>` | Welcome-screen width, `80`–`240`. Only applies to bare `greptile`. |

Bare `greptile` prints a welcome screen. There is no reason for an agent to run it.

## `greptile review`

Reviews the current branch against its base. Requires a git repo with a remote, and reviews
committed work only. The remote is resolved as: the branch's upstream, else `origin`, else the
sole configured remote.

| Flag                        | Effect                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-b`, `--branch <BRANCH>`   | Base branch to review against. Omit for the repository default.                                                                                                                           |
| `--resume`                  | Continue the latest unfinished review for this repository.                                                                                                                                |
| `--include <paths...>`      | Send files that were held back as sensitive. Repeatable, or space-separated.                                                                                                              |
| `--instructions <TEXT>`     | Extra instructions for this run, same channel as `@greptile <text>` on a PR. Max 2000 characters, non-empty, no control characters, and rejected with `--resume`. Any of those exits `2`. |
| `--json`                    | Print findings as one JSON object on stdout.                                                                                                                                              |
| `--text`                    | Plain text. The default when output is piped.                                                                                                                                             |
| `--agent`                   | Alias for `--text`.                                                                                                                                                                       |
| `--layout <comments\|diff>` | Findings as a list (default) or beside the changed code.                                                                                                                                  |
| `--diff`                    | Shorthand for `--layout diff`.                                                                                                                                                            |
| `--context <LINES>`         | Lines of nearby code around each finding, `0`–`60`, default `15`.                                                                                                                         |
| `--width <COLUMNS>`         | Output width, `40`–`240`. Default: terminal width, then `80`.                                                                                                                             |
| `--color` / `--no-color`    | Force ANSI color on / off.                                                                                                                                                                |

`--layout`, `--context`, `--width`, and the color flags only shape human-readable rendering. They
have no effect on `--json`, so skip them when parsing.

## `greptile review status`

Reports the most recent review for a commit. The answer is the **exit code**; stdout is
supplementary.

| Flag                 | Effect                                               |
| -------------------- | ---------------------------------------------------- |
| `--commit <ref>`     | Commit to check. Omit for `HEAD`. Any git rev works. |
| `--json`             | Print the status object.                             |
| `--text` / `--agent` | Plain text.                                          |

It also accepts `--layout`, `--diff`, `--context`, `--width`, and the color flags. They do nothing
here, but an out-of-range `--context`/`--width` still exits `2`.

Exit codes: `0` completed, `1` none/signed out/no remote, `3` running, `4` failed, `5` cancelled,
`2` invalid invocation.

The status is read from local review history first, and reconciled against the server only when
the local entry is still in flight, so a `0` or `4` answer is usually offline and instant.

## `greptile review show`

| Flag                            | Effect                                              |
| ------------------------------- | --------------------------------------------------- |
| `[ID]`                          | Review ID to open. Omit for the recent-review list. |
| `--json` / `--text` / `--agent` | Structured or plain output.                         |

Plus the same rendering flags as `review`. With no ID and no output flag, in a terminal, this
opens an interactive picker, so always pass `--json` from an agent.

## `greptile config`

Prints the effective **review** configuration: in-repo `.greptile` files merged with the dashboard
config and org-level rules. Not to be confused with `greptile settings`.

| Flag     | Effect                                                     |
| -------- | ---------------------------------------------------------- |
| `[path]` | Resolve as it applies to one file. Omit for the repo root. |
| `--json` | Print the resolved config as JSON.                         |

The argument must be a **file**, not a directory: scoped rules like `**/*.ts` match files, so a
directory has no single effective config and is rejected.

Unlike `review`, `config` exits `1` (not `2`) outside a git repository or with no usable remote. It
exits `2` only for a `[path]` that names a directory or escapes the repository.

Output sections: `settings`, `filters`, `rules`, `instructions`, `rulesMarkdown`, `files`,
`sources`. Filters are always repo-wide; settings, rules, and instructions reflect the given path.

## `greptile settings`

Local CLI preferences, stored at `~/.config/greptile/settings.json` (or
`$XDG_CONFIG_HOME/greptile/settings.json`).

| Subcommand           | Effect                                                               |
| -------------------- | -------------------------------------------------------------------- |
| `list [--json]`      | Every setting, its effective value, and where that value comes from. |
| `get <key> [--json]` | The effective value of one key.                                      |
| `set <key> <value>`  | Save a value.                                                        |
| `unset <key>`        | Remove a saved value so the built-in default applies.                |
| `path`               | Print the settings file location.                                    |

| Key              | Values                                  | Equivalent flag          |
| ---------------- | --------------------------------------- | ------------------------ |
| `color`          | `true` (default), `false`               | `--color` / `--no-color` |
| `apiBaseUrl`     | Origin URL for a self-hosted deployment | none                     |
| `webBaseUrl`     | Origin URL for a self-hosted dashboard  | none                     |
| `review.output`  | `auto` (default), `text`, `json`        | `--text` / `--json`      |
| `review.layout`  | `comments` (default), `diff`            | `--layout` / `--diff`    |
| `review.context` | `0`–`60`, default `15`                  | `--context`              |
| `review.width`   | `40`–`240`                              | `--width`                |

Bare `greptile settings` opens an interactive hub, which also reaches server-side repository,
review, and team settings, only for a human at a TTY. With `--json`, with piped output, or when
an agent environment variable is set, it prints the settings list and exits `0`. Safe to run,
though passing `list` says what you mean.

## `greptile skills`

Agent skills bundled with this CLI.

| Subcommand           | Effect                                                  |
| -------------------- | ------------------------------------------------------- |
| `list [--json]`      | Skills shipped with this CLI version.                   |
| `install [names...]` | Install them. Installs every skill when none are named. |

| `install` flag   | Effect                                                     |
| ---------------- | ---------------------------------------------------------- |
| `-g`, `--global` | Install for every project instead of just this repository. |
| `-f`, `--force`  | Replace a skill that is already installed.                 |
| `--json`         | Print the install result as JSON.                          |

Skills are written to `.agents/skills/<name>/` (the Agent Skills standard directory), plus
`.claude/skills/` and `.codex/skills/` when those agents are set up at the same root. Each target
directory is decided independently: an existing copy is left alone and reported as skipped unless
`--force` is passed, while a directory that does not have the skill yet still receives it.

## `greptile login` / `logout` / `whoami`

| Command  | Notes                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `login`  | Interactive browser OAuth. `--api-key` reads a key from a prompt or stdin.                                                                                                                     |
| `logout` | Removes stored credentials on this device.                                                                                                                                                     |
| `whoami` | Prints the signed-in account and organizations. **Exits `0` with no stored credentials**, printing `Not signed in. …` to stdout; non-zero only for a corrupt, expired, or rejected credential. |

`whoami` is the only one of the three an agent should run. Prefer `GREPTILE_API_KEY` in the
environment over any stored credential flow.

## `greptile fix`

macOS-only setup for Greptile's "Fix in Claude Code" deep links.

| Subcommand                      | Notes                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| `install`                       | Installs or repairs the URL handler app. Interactive.                  |
| `status [--json]`               | Reports readiness. Safe for an agent.                                  |
| `uninstall [--remove-mappings]` | Removes the app; keeps repo folder mappings unless the flag is passed. |

## `greptile onboard` / `update`

`onboard` prints a one-screen status to stderr and exits when it detects a non-interactive
invocation (`0`, or `1` when signed out), so it is safe to run but not useful; in a terminal it
opens the setup wizard.

`update` is **not** interactive, but it replaces the running CLI in place, so leave it to the user.
Homebrew installs must use `brew upgrade greptile` instead, which the command says itself.

## Recipes

### Review, then act on the findings

```bash
greptile review --json > /tmp/review.json
jq -r '.confidence' /tmp/review.json
jq -r '.comments[] | select(.severity == "P0" or .securityIssue) | "\(.path):\(.startLine) \(.body)"' /tmp/review.json
```

### Wait out an in-flight review

```bash
for _ in $(seq 1 60); do
  greptile review status --json && break
  status=$?
  [ "$status" -eq 3 ] || break
  sleep 10
done
```

`review status` exits `0` as soon as the commit has a completed review. Any code other than `3`
breaks the loop. There is nothing left to wait for.

### Gate a push on a completed review

```bash
greptile review status
case $? in
  0) ;;                                          # reviewed
  3) echo "Greptile review still running"; exit 1 ;;
  *) echo "Run 'greptile review' before pushing"; exit 1 ;;
esac
```

### Review only what changed against a specific base

```bash
greptile review -b "$(git merge-base --fork-point origin/main HEAD >/dev/null 2>&1 && echo origin/main || echo main)" --json
```

When unsure of the base, omit `-b`. The CLI resolves the repository default branch itself.
