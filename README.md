# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/calm-finch-84/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/calm-finch-84/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar turns a sealed DefiLlama snapshot into an offline research board for protocols without a recorded token.
It estimates a possible token-launch value using live category peers, explains the estimate, and supplies a seven-step activity plan.
The bundled snapshot contains 758 protocols and a 40-protocol watchlist.
All scoring uses the supplied records and snapshot date: no network, current clock, random scoring, package install or build step is required.

## The radar-5 valuation

The valuation starts with this calculation:

```text
TVL × category peer multiple × growth multiplier × maturity multiplier
```

- **Peer basis:** collect market-cap / TVL ratios from live-token protocols with reported market caps and positive TVL, including peers outside the displayed live set.
- **Winsorization:** bound each ratio to 0.02–3 before calculating the global and category medians.
- **Shrinkage:** blend the category median with the global median as `(n × category median + 24 × global median) / (n + 24)`, where `n` is the category sample size.
- **Peer table:** each exported category entry carries its sample size, the raw median before shrinkage (`raw_median`), and the resulting shrunk and clamped multiple (`multiple`), from the same peer basis used to score board rows.
- **Multiple limits:** clamp the blended category multiple to 0.03–2 and retain four decimal places. Categories without observations use the global basis.
- **Growth:** clamp reported seven-day TVL change to −60% through +120%, then use `1 + 0.5 × change / 100`. Unreported growth contributes a neutral multiplier.
- **Maturity:** start at 0.6 and add up to 0.4 over 1,095 days since listing. An unknown listing date uses 365 days; age is measured against the snapshot date.
- **Dollar ordering:** round the estimate to whole dollars, order ties by slug, and raise colliding values from the bottom upward as needed to keep every value positive and distinct.

Thin categories (n=1–2) are pulled strongly toward the global median so a single peer cannot set a category's price.

Confidence describes input coverage, not the likelihood of a launch or a successful claim.
Its score is `0.5 × n / (n + 24)`, plus 0.25 for a usable listing date and 0.25 for reported weekly growth, rounded to four decimal places.
Each row includes three machine-generated reasons covering its peer basis, growth direction and maturity assumption.
No protocol name receives a special scoring rule.

## Board membership

A protocol is pre-token only when `mcap_usd`, `gecko_id` and `symbol` are all null.
Every watchlist slug must have a pre-token record and appear on the ranked board.
The board adds up to 160 other pre-token protocols below the watchlist TVL floor, selected by descending model implied value and then slug ascending.
Early selection uses the same category peer basis and rounded growth and maturity factors as board scoring; the watchlist is always retained before final ranking and distinct-dollar allocation.
Those early additions exclude CEX entries and names ending in version markers.
Live-token protocols never enter the ranking; a separate reference set carries up to 24 non-CEX protocols ordered by market cap.
With the bundled input, the board has 200 ranked rows and the reference set has 24 live rows.

## Run locally

Use Node 22.18 or later, with native TypeScript support and the standard library only.
From the repository root:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`--input` accepts either a file or a directory containing `snapshot.json`; its default is `/input`.
The output directory comes from `--output`, then `MAKEFUN_OUTPUT_DIR`, then `/output`.
Both `--input=value` and `--output=value` forms are accepted.
For example, an explicit output path overrides the environment setting:

```sh
node main.ts --input /path/to/input-directory --output out
```

A missing snapshot exits with code 2 and an explanatory stderr message.
A rejected board or another build failure exits with code 1.
Use a fresh output directory when assembling a submission so old assets are not carried forward.

## Generated bundle

| Path | Contents |
| --- | --- |
| `board.json` | An object with `rows`, containing ranks, source fields, implied values, model evidence, reasons and seven farm-step strings per row. |
| `data.js` | The same board's dashboard fields assigned to `window.RADAR`, including the exact farm strings, peer table, constants, counts and live reference rows. |
| `dashboard/` | Local HTML, JavaScript and CSS copied from this repository. |
| `screenshots/` | Supplied screenshot files copied from this repository. |
| `dossier.json` | Canonical submission bytes generated by the vendored make.fun builder, written last. |

The copier takes regular files from the two asset directories and skips dotfiles and subdirectories.
At least three screenshots are required, with at most four allowed and a 524,288-byte limit per image.
Screenshot names must match `^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$`.
The entrypoint checks image signatures and closing markers to catch common truncation; it does not decode image pixels.
The dossier uses a 65,536-byte text cap and dashboard limits of 400 files and 4,194,304 bytes.
Its final size is checked against the library's 4 MiB limit, and the written bytes are read back and compared.
The terminal summary reports model coverage, the global peer multiple, the top estimate and every output location.

## Exploring the dashboard

Open `out/dashboard/index.html` after building; its scripts load the adjacent `out/data.js` without fetching remote resources.
The discovery table supports text, category, chain, minimum-TVL and watchlist filters, plus clickable sort headers.
The watchlist filter uses the snapshot floor, which separates watchlist rows from early additions in the sealed input.
Selecting a row opens its valuation, reasons, confidence explanation, category sample and exact seven-step farm plan.
Press Escape to close the detail view; keyboard users can also activate focused rows with Enter or Space.
The model panel displays the constants, global median and exported category peer table.
A separate live-token section shows reported market caps rather than modeled launch values.

The dashboard also multiplies the exported factors and rounds the result for every row.
It visibly marks any disagreement with the exported implied value, without changing or hiding the row.
The model scores with the same four-decimal growth and maturity multipliers it exports; any remaining differences can arise from resolving dollar collisions.
Farm plans vary by category, chain fee class, TVL and age; their costs are planning estimates rather than live quotes.
Neither implied values nor activity plans promise a token launch, rewards or investment returns.

## Reproducibility

Run the same input into two fresh output directories and compare `board.json`, `data.js` and `dossier.json` with `cmp`.
The generated artifacts do not embed the output path or a runtime timestamp.
The model lives in `lib/model.ts`, bundle assembly in `main.ts`, and the dashboard in `dashboard/`.
The vendored dossier builder and supplied screenshots remain separate from those implementations.
