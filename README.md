# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Mroismaulana/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Mroismaulana/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar turns a sealed DefiLlama snapshot into a ranked board of protocols that have not
launched a token yet. It reads `/input/snapshot.json`, scores every pre-token protocol with a
small, documented implied-value model, and writes `board.json`, `data.js` and `dossier.json`.
The board is deterministic: the same snapshot always produces the same ranking, because every
factor is derived from the input and nothing is fetched at build time or run time.

The entry also ships a fully static, offline dashboard. It reads only the generated `data.js`
and its own `app.js` — no network calls, no CDN assets, no web fonts. Readers get category,
chain and minimum-TVL filters, a sortable table, a detail drawer with the full model breakdown
and a category-aware farm plan, a live-token tab, and watchlist / early badges that mark which
protocols are required coverage and which were added below the floor as early finds.

Screenshots of the board, the detail drawer and the filtered view live in `screenshots/`, and
`dossier.json` records the scored protocols and their factors in one audit-friendly document.
The whole build runs on plain Node with no dependencies to install.

## Run it

```sh
node main.ts
```

This is the grader's command: it reads the sealed snapshot from `/input/snapshot.json` and
writes the board, `data.js`, the dashboard copy and `dossier.json` to `/output`.

### Run it locally

Point the build at any snapshot and output directory, then re-check the written board without
re-writing it:

```sh
node main.ts --input <snapshot.json> --output out
node main.ts --output out --verify
```

`--verify` re-reads `out/board.json` and confirms the shape, contiguous ranks, non-increasing
implied values, watchlist coverage and gate invariants. The build also runs a 12-assertion model
self-check before it writes anything.

## The model

Implied value is an explainable estimate, not a price prediction:

- **TVL** anchors each protocol at `tvl_usd × base_multiple`.
- **7d growth** is clamped to a floor and cap, then weighted, so one outlier week can neither
  sink nor inflate a protocol.
- **Maturity** scales with days since listing, with a fixed fallback age for unknown listings.
- **Chain breadth** adds a small bonus per additional chain, capped so multi-chain presence
  helps without dominating.
- **Category** applies a multiplier taken from the snapshot's category field; no protocol name
  is ever special-cased.

Every factor comes from the sealed snapshot, the arithmetic is pinned, and the build performs
no network access. The board covers every watchlist slug as a floor and adds early pre-token
protocols below it, so launches can be spotted before they are obvious.

## Repository layout

| Path | What it is |
| --- | --- |
| `main.ts` | CLI and build: parses `--input` / `--output` / `--verify`, writes the outputs, copies the dashboard and screenshots |
| `lib/model.ts` | Scoring model, farm plans, board assembly and the exported `selfCheck()` |
| `dashboard/` | Static front end: `index.html`, `app.css`, `app.js` (offline, reads `../data.js` only) |
| `vendor/makefun-board.ts` | Vendored board helpers, kept as delivered |
| `screenshots/` | Board, detail and filtered captures at 1280×900 |
| `dossier.json` | Per-protocol record with factors and farm steps, written to the output directory |

<sub>Entered on [make.fun](https://make.fun/?ref=jhbwqchj&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
