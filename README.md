# Outliners · World Cup 2026 Analytics

Monte Carlo simulator and interactive analytics for the **FIFA World Cup 2026** — ELO + Poisson engine, injury-adjusted squads, prediction-market demo, and bookmaker edge analysis. Built by [Outliners](https://outliners.dev) for books, traders, and media.

![FIFA World Cup 2026 — trophy celebration](public/worldcup1.jpg)

> *Inspired by [I Simulated the World Cup, and the US won*](https://www.youtube.com/watch?v=w5NK7bPjQkw) — same core idea, extended with absences, penalties, markets demo, and historical backtests.*

**Live app:** run locally with `npm run dev` → [http://localhost:3000](http://localhost:3000)  
**Languages:** Spanish (default) · English (`/en`)

---

## Features

### Simulator (home page)

- **Monte Carlo engine** — run **1K / 10K / 50K / 100K** full tournaments in the browser via **Web Worker** (~15–25K sims/sec).
- **Dual simulation pass** — every run computes probabilities **with** and **without** squad absences (injuries/suspensions), so you can compare the impact on champion odds.
- **Rich dashboard** after each run:
  - **Prediction delta** — how absences shift top-team probabilities
  - **Champion probabilities** with Wilson 95% confidence intervals and with/without toggle
  - **Stage matrix** — reach R32 / R16 / QF / SF / Final / win %
  - **Group standings** — expected finish distribution per team
  - **Bracket tree** — most likely knockout path
  - **Match calendar** — 104 fixtures with modal W/D/L and score distributions (click a row for detail)
  - **Tournament & goal stats**, **surprise teams**, **market edge vs Polymarket/Kalshi**
- **Team & match drawers** — ELO, absences, stage probabilities, score heatmaps, scorers
- **Sticky section nav**, confetti on sim completion, hero image gallery
- **Mobile responsive** layout with hamburger nav and scroll-friendly tables

### Prediction markets demo (`/demo`)

Play-money sandbox that **reuses the home-page simulation** — no second run when you open the demo.

| Tab | What you can do |
|-----|-----------------|
| **Markets** | Buy/sell **YES/NO** on winner, group winner, and head-to-head markets priced from sim probabilities |
| **Tickets** | Synthetic **secondary-market listings** with face / fair / ask pricing |
| **Portfolio** | Cash, open positions, ticket holdings, settlement history |

- **$1,000 play-money wallet** (persisted in `localStorage`)
- **Settle markets** against a random sampled tournament outcome from your sim
- **Confetti** on successful YES/NO trades
- Filters: all · winner · groups · matches

### Backtest (`/backtest`)

Historical validation on **World Cups 2014, 2018, 2022** — calibration buckets, home-bonus sweep, recent-form blend, and penalty-shootout model evaluation.

### Methodology (`/methodology`)

Full write-up of ELO expectancy, Poisson goals, knockout penalties (Bayesian shrinkage on 103 historical shoot-outs), Monte Carlo aggregation, Wilson CIs, and known limitations.

---

## Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 15 · React 19 · TypeScript |
| Styling | Tailwind CSS v4 (OKLCH palette, Outliners brand teal) |
| i18n | next-intl (ES / EN) |
| Animation | GSAP · canvas-confetti |
| Charts / viz | D3 |
| State | Zustand (selection drawers) |
| Engine | Pure TypeScript · xoshiro128\*\* PRNG · Web Worker |

**Performance:** ~35K sims/sec in Node; ~15–25K in browser worker. 100K dual-pass run typically **~5–10 s** depending on device.

**Data:** official FIFA 2026 draw (5 Dec 2025) · ELO from [eloratings.net](https://www.eloratings.net/) · optional live odds via `/api/odds`

---

## Quick start

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000
npm run build        # production build
npm test             # vitest
```

### Data refresh scripts

```bash
npm run scrape-elo       # refresh national-team ELO
npm run fetch-odds       # Polymarket / Kalshi winner odds
npm run fetch-absences   # squad absences (injuries, suspensions)
npm run fetch-backtest   # historical WC match data for backtest
npm run fetch-results    # live results (ESPN)
npm run fetch-cards      # card accumulation data
```

---

## Model (short)

### ELO win expectancy

```
We = 1 / (10^(-dr/400) + 1)
dr = ELO_A − ELO_B + home_bonus   (+100 for host nations in group stage)
```

### Goals (independent Poisson)

```
λ_team = clamp(1.30 + 0.18 · (ELO_team − ELO_opp + home_bonus) / 100,  0.15,  6.0)
goals ~ Poisson(λ_team)
```

### Knockout ties

Regulation draw → **penalty shoot-out** modeled with Bayesian shrinkage on historical PK rates (not a coin flip). Penalty goals are excluded from goal aggregates.

### Absences

Key players out (injury/suspension) apply an ELO penalty per squad before each tournament draw. The worker runs a **counterfactual pass** with absences disabled for comparison.

### Sanity checks

- Champion probabilities sum to **100%** (exact over N sims)
- Average goals per match ≈ **2.6** (in line with WC history 2.5–2.7)
- Top contenders align with ELO / bookmaker consensus (Spain, Argentina, France, Brazil, Portugal)

See [`/methodology`](http://localhost:3000/methodology) in the app for the full spec.

---

## Project structure

```
src/
├── app/[locale]/           App Router pages
│   ├── page.tsx            Home · simulator + dashboard
│   ├── demo/               Prediction markets & ticket demo
│   ├── backtest/           Historical model validation
│   ├── methodology/        Model documentation
│   └── api/odds/           Live market odds endpoint
├── components/
│   ├── demo/               DemoHub · MarketsTab · TicketsTab · PortfolioTab
│   ├── hero/               HeroGallery · HeroDemoPromo · MeshGradient
│   ├── layout/             Header · Footer · SectionNav
│   └── …                   Dashboard widgets + drawers
├── hooks/
│   ├── useSimulation.ts    Shared Web Worker + sim state (survives navigation)
│   └── useDemoWallet.ts    Play-money wallet (localStorage)
├── i18n/messages/          es.json · en.json
├── lib/
│   ├── sim/                engine · tournament · group · knockout · absences · worker
│   ├── demo/               markets · tickets · cache · flags
│   └── confetti.ts         Shared celebration effect
├── data/                   teams.json · groups.json · bracket.json · absences · odds
└── scripts/                ELO scrape · odds fetch · backtest data · eval sweeps

public/
├── worldcup1.jpg           Hero trophy image (also shown above)
├── logo-worldcup2026.webp
└── …                       Gallery & brand assets
```

---

## Routes

| Path | Description |
|------|-------------|
| `/` | Simulate → dashboard |
| `/demo` | Play-money markets & tickets |
| `/backtest` | 2014 / 2018 / 2022 validation |
| `/methodology` | Model docs |
| `/en/…` | English locale prefix |

---

## Credits

- **ELO ratings:** [eloratings.net](https://www.eloratings.net/)
- **Official draw:** [FIFA World Cup 2026](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026)
- **Reference methodology:** [Luke Benz — World Cup simulation](https://www.youtube.com/watch?v=w5NK7bPjQkw)
- **Flags:** [circle-flags](https://hatscripts.github.io/circle-flags/) (MIT)
- **Built by:** Outliners · Sports quant analytics

---

## License

Private / all rights reserved unless otherwise noted in repository settings.
