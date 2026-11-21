# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/calm-finch-84/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/calm-finch-84/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Token Radar** ranks protocols that record no token yet by what their token launch would be worth, and gives each one a concrete farm plan. It reads the sealed DefiLlama snapshot (758 protocols, 40 on the watchlist), values every pre-token protocol with a category-peer model derived from the snapshot's own live-token protocols, and renders a static dashboard: a sortable, filterable board, a detail view per protocol with the model's working shown, and the live-token protocols set aside with their real market caps.

Run it with Node 22.18 or later (standard library only, no network):

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory.
