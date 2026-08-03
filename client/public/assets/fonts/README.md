# Local fonts

Self-hosted for P1-08, weights added in V-01 (see `docs/STYLING.md` §2 and
`client/src/styles/base.css`). All binaries are OFL-licensed, sourced from the
`google/fonts` GitHub repo.

| File | CSS family | Weight | Size |
|---|---|---|---|
| `Mulish-VariableFont_wght.ttf` | `Mulish` | 100–1000 (variable) | 211,988 B |
| `FiraMono-Regular.ttf` | `Fira Mono` | 400 | 162,472 B |
| `FiraMono-Medium.ttf` | `Fira Mono` | 500 | 173,428 B |
| `FiraMono-Bold.ttf` | `Fira Mono` | 700 | 206,488 B |

The Mulish variable file keeps the exact name nimiq-css `fonts.css` expects
(`Mulish-VariableFont_wght.ttf`), so a future switch to `fonts.css` is trivial;
today `fonts.css` is not imported (it expects different Fira names,
`FiraMono-400.ttf`) and the `@font-face` blocks in `base.css` point here.
Fira Mono has no 600 face; CSS weight 600 requests resolve to 700 per the
font-matching algorithm.
