# Local fonts

Self-hosted for P1-08 (see `docs/STYLING.md` §2 and `client/src/styles/base.css`):

| File | CSS family | Weight |
|---|---|---|
| `Mulish-Regular.ttf` | `Mulish` | 400 |
| `FiraMono-Regular.ttf` | `Fira Mono` | 400 |

nimiq-css `fonts.css` expects different names (`Mulish-VariableFont_wght.ttf`, `FiraMono-400.ttf`) and is not imported; `@font-face` paths in `base.css` point here.
