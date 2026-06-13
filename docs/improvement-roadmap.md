# 2026 World Cup Prediction Model - Improvement Roadmap

## Executive Summary

Evidence-based improvement plan for the Monte Carlo simulation engine. All improvements are prioritized by **academic evidence strength**, not post-hoc rationalization from individual match results.

**Guiding Principles:**
1. No improvement ships without passing statistical gates (walk-forward backtest)
2. Single match results do not justify model changes (overfitting trap)
3. Prefer low-risk, high-certainty improvements over speculative features
4. The prediction ceiling for 3-way football outcomes is 55-65% (8-10% irreducible randomness)

**Current Model Strengths:**
- ELO + independent Poisson (validated baseline)
- Bayesian penalty shootout model (103 historical shoot-outs)
- Recent-form adjustment (α=0.2, calibrated on 2014/18/22)
- Post-ET fatigue modeling
- Dual-pass with/without absences

**Current Model Weaknesses (evidence-backed):**
- Independent Poisson undercounts low-scoring draws by 10-15% (Karlis & Ntzoufras 2003)
- No market odds integration (the only signal proven to beat ELO)
- K-factor for ELO updates not optimized (FIFA uses 60, Berkeley study shows 15-25 is better)
- xG data available but unused (modest ΔBrier ≈ -0.002, but statistically significant)
- No formal validation framework (prevents detecting real improvements vs noise)

---

## Validation Gate (ALL improvements must pass)

```
Gate 1: ΔBrier < -0.005 on walk-forward backtest (2000+ international matches)
Gate 2: ΔECE < +0.2pp (calibration must not degrade)
Gate 3: No degradation on 2014/2018/2022 World Cups individually
Gate 4: Diebold-Mariano test p < 0.05

If any gate fails → REVERT. No exceptions.
```

### Validation Infrastructure

```typescript
// Required BEFORE any model change
interface ValidationResult {
  brier_base: number;
  brier_new: number;
  delta_brier: number;
  ece_base: number;
  ece_new: number;
  delta_ece: number;
  dm_test_p_value: number;
  wc_2014_regression: boolean;
  wc_2018_regression: boolean;
  wc_2022_regression: boolean;
  gate_passed: boolean;
}
```

---

## Phase 1: High-Certainty Improvements (evidence: strong)

### 1. Dixon-Coles τ Correction

**Evidence:** Winner of RSS 2022 prediction competition (Penn & Donnelly). Independent Poisson undercounts 0-0 and 1-1 draws by 10-15%. The τ parameter corrects correlation between low scores.

**Academic basis:**
- Karlis & Ntzoufras (2003): Bivariate Poisson improves draw predictions by 6.5-14%
- Zenn.dev (2026): Independent Poisson predicted 11% draws vs 20% actual at World Cup
- Dixon & Coles (1997): Original paper, 40,000+ citations

**Implementation:**
```typescript
// src/lib/sim/goals.ts - Add Dixon-Coles correction
// τ adjusts joint probability for low-scoring outcomes
function dixonColesAdjustment(
  goalsHome: number,
  goalsAway: number,
  lambdaHome: number,
  lambdaAway: number,
  rho: number  // correlation parameter, typically -0.05 to -0.15
): number {
  if (goalsHome === 0 && goalsAway === 0)
    return 1 - lambdaHome * lambdaAway * rho;
  if (goalsHome === 0 && goalsAway === 1)
    return 1 + lambdaHome * rho;
  if (goalsHome === 1 && goalsAway === 0)
    return 1 + lambdaAway * rho;
  if (goalsHome === 1 && goalsAway === 1)
    return 1 - rho;
  return 1; // No adjustment for scores > 1
}
```

**Expected improvement:** +1-3pp on draw prediction accuracy, better group stage tiebreaker resolution.

**Risk:** Low. Additive correction, doesn't change ELO or λ calculation.

---

### 2. K-Factor Calibration

**Evidence:** Berkeley study (Yang, 2016) tested 5 ELO variants on 49,000 international matches. K=15-25 outperforms FIFA's K=60 for prediction accuracy. Current model uses HOST_BONUS=100 which was "neither helpful nor harmful" in backtest.

**Academic basis:**
- Yang (2016, Berkeley): Optimal K=15-25 for international prediction
- Sullivan & Cronin (2015): K=20-25 optimal for domestic leagues
- eloratings.net: K=60 for WC, 50 continental, 40 qualifiers (complexity without proven benefit)

**Implementation:**
```typescript
// src/lib/sim/elo.ts - Update K-factor
// Current: implicit K in eloratings.net data (external)
// Change: If we compute our own ELO updates, use K=20

// src/lib/sim/match.ts - Sweep HOST_BONUS
// Current: HOST_BONUS = 100 (backtest inconclusive)
// Action: Sweep 0/50/75/100/125 against historical data, pick minimizer of Brier
```

**Expected improvement:** More stable ratings, less oscillation from friendly match noise.

**Risk:** Low. Parameter change only, easily reversible.

---

### 3. Market Odds Fusion

**Evidence:** The ONLY feature consistently proven to outperform ELO across multiple independent studies. Bookmaker odds encode private information, injury news, and sharp bettor signals that ELO cannot capture.

**Academic basis:**
- Multiple backtests show odds-implied probabilities beat ELO by 2-5%
- WagerBase (2026): 60/40 ensemble of actual result + xG performance validated on 269 PL matches
- Closing line value (CLV) is the gold standard for "does this feature add information"

**Implementation:**
```typescript
// src/lib/sim/market-fusion.ts
export function fusedProbability(
  modelProb: number,
  marketProb: number,
  marketWeight = 0.30
): number {
  // Only fuse when market data is available and recent (< 24h pre-match)
  if (!marketProb || marketProb <= 0) return modelProb;
  return marketWeight * marketProb + (1 - marketWeight) * modelProb;
}

// Apply to win expectancy in match.ts, not to λ directly
// Market provides W/D/L probabilities → adjust ELO-derived win expectancy
```

**Data source:** Polymarket/Kalshi odds (already scraped via `fetch-odds.ts`). Currently display-only, not used in simulation.

**Expected improvement:** +2-5% accuracy where market data available.

**Risk:** Medium. Market data may not be available for all matches (small market teams). Need fallback to pure model.

---

## Phase 2: Moderate-Certainty Improvements (evidence: exists but modest)

### 4. xG as Poisson Response Variable

**Evidence:** onthepitch.now production system validated ΔBrier = -0.0023 on tournament slice (pass gate). However, only 342 international matches have xG data vs 25,000+ with goals. International xG has lower validity than club football (r=0.475 vs r=0.537).

**Academic basis:**
- onthepitch.now (2026): ΔBrier_median −0.0023, ΔECE −0.41pp → PASS on tournaments
- INSPIREE (2026): National team xG correlation r=0.475 (lower than clubs)
- gamblingcalc.com: "3 World Cup matches of xG is descriptive, not enough to reprice a team"

**Implementation approach (NOT lambda blending):**
```typescript
// WRONG: λ = 0.6 * xG + 0.4 * elo_lambda (overfits to sparse xG data)
// CORRECT: Use xG as Poisson response where available, fallback to actual goals

// In Dixon-Coles fitting:
function getPoissonResponse(match: HistoricalMatch): { home: number; away: number } {
  if (match.xg_available && match.xg_provider === 'statsbomb') {
    // Use xG as response (more informative than goals for Poisson fit)
    return { home: Math.round(match.home_xg), away: Math.round(match.away_xg) };
  }
  // Fallback: actual goals (96% of international matches)
  return { home: match.home_goals, away: match.away_goals };
}
```

**Critical constraints:**
- Heavy shrinkage for teams with < 10 xG observations
- Single provider only (StatsBomb open data) to avoid calibration drift
- Never blend lambdas directly (sample size too small)

**Expected improvement:** ΔBrier ≈ -0.002 (small but real).

**Risk:** Medium. xG sample size for internationals is marginal. Must validate doesn't degrade.

---

### 5. Confederation Strength Adjustment

**Evidence:** Cross-confederation matches show systematic prediction errors (AFC vs UEFA, CONMEBOL vs CAF, etc). 1.5pp improvement documented on cross-confed subset.

**Implementation:**
```typescript
// src/lib/sim/elo.ts
const CONFED_ADJUSTMENT: Record<string, number> = {
  UEFA: 0,      // baseline
  CONMEBOL: -10, // slightly overrated by ELO (fewer matches)
  AFC: +20,     // underrated (strong teams face weak in qualifiers)
  CAF: +15,     // underrated
  CONCACAF: 0,
  OFC: +30,     // very few international matches, ELO unreliable
};

// Apply when teams from different confederations meet
function confedAdjustment(teamA: Team, teamB: Team): number {
  if (teamA.confed === teamB.confed) return 0;
  return (CONFED_ADJUSTMENT[teamA.confed] ?? 0) - (CONFED_ADJUSTMENT[teamB.confed] ?? 0);
}
```

**Expected improvement:** +1.5pp on cross-confederation matches.

**Risk:** Low-medium. Parameters need calibration from historical cross-confed results.

---

### 6. Walk-Forward Validation Framework

**Evidence:** Industry standard. Without this, we cannot distinguish genuine improvement from overfitting. Current N=192 (3 WC) is insufficient for detecting small effects; need 2000+ matches.

**Implementation:**
```typescript
// scripts/validate-model.ts
interface ValidationConfig {
  data_source: 'internationals_2018_2026';
  min_matches: 2000;
  burn_in: 150;  // First 150 matches for initial rating stabilization
  metrics: ['brier', 'rps', 'log_loss', 'ece'];
  statistical_test: 'diebold_mariano';
  significance: 0.05;
}

// Walk-forward protocol:
// 1. Process matches in chronological order
// 2. Predict each using ONLY pre-match data
// 3. Update model state after each match
// 4. Compute aggregate metrics on evaluation window
// 5. Compare base model vs enhanced model
// 6. Report CI, not just point estimates
```

**Data sources:**
- International results 2018-2026 (qualifiers + tournaments + friendlies)
- ESPN API (already integrated via `fetch-results.ts`)
- Historical backtest data (already have 2014/2018/2022)

**Expected improvement:** Not accuracy improvement—prevents false improvements from shipping.

**Risk:** None. Pure infrastructure.

---

## Phase 3: Explicitly NOT Doing (evidence: against)

### ~~Dynamic ELO (In-Tournament Updates)~~

**Why NOT:** Zero peer-reviewed evidence that mid-tournament ELO updates improve prediction. After 3 group matches:
- Maximum rating change with K=60: ±180 points
- Standard error: ±40-60 ELO points
- Signal-to-noise ratio < 2:1 (updates dominated by variance)
- Berkeley study: "Markovian system does relatively poorly, perhaps because transition probabilities estimated from small sample"

**The momentum myth:** Reading Economics (2023) proved no momentum effect exists in football betting data. Bettors believe in it, data doesn't support it.

---

### ~~Tactical Style / Possession Modeling~~

**Why NOT:** Multiple independent backtests prove ELO already absorbs tactical information:
- hjjbh1314 (8,021 international matches): Gradient boosting + form/fatigue/venue = 0% improvement over ELO
- KU Leuven (2018): "Elo ratings as single covariate achieves best performance"
- Nate Silver PELE: Tactical "Tilt" rating is orthogonal to prediction accuracy

**Why it seems intuitive but fails:** Strong possession teams already have high ELO (because possession wins matches). Adding possession as a feature double-counts the signal.

---

### ~~Fine-Grained Player Absence Modeling~~

**Why NOT:** Current backtest shows ALL weight combinations regress Brier on historical data. This indicates:
- Data too sparse (14 matches with documented absences in 3 World Cups)
- France 2022 won DESPITE losing Benzema/Pogba/Kanté (outlier dominates)
- Need 50+ absence-affected matches to calibrate—won't have until 2030

**Keep as-is:** Absence module is plumbed end-to-end but with conservative weights. Let it accumulate data from 2026.

---

### ~~Knockout Stage Psychology~~

**Why NOT:** Cannot be quantified or validated. "Champion mentality" and "pressure penalty" are narrative constructs with no measurable predictive value. Adding them = adding researcher bias.

---

### ~~Referee / Weather / Motivation~~

**Why NOT:** Edge-case effects with insufficient sample size to calibrate. Adding parameters with 3-5 data points each = guaranteed overfitting.

---

## Implementation Timeline

| Phase | Duration | Items | Gate |
|-------|----------|-------|------|
| **Phase 0** | 3 days | Validation framework (scripts/validate-model.ts) | N/A (infrastructure) |
| **Phase 1** | 1 week | Dixon-Coles + K-factor sweep + Market fusion | Gate 1-4 on 2000+ matches |
| **Phase 2** | 2 weeks | xG response + Confed adjustment | Gate 1-4 |
| **Continuous** | — | Monitor 2026 match-by-match Brier score | Track real-time calibration |

**Total effort:** 3-4 weeks
**Expected realistic gain:** +2-5% accuracy (from ~60% to ~62-65%), better calibration

---

## Post-Tournament Analysis Plan

2026 World Cup provides 104 matches of fresh validation data. Plan:

1. **Pre-lock predictions** — commit full tournament simulation before each match day (timestamped)
2. **Track per-match Brier** — running score throughout tournament
3. **Compare model vs market** — where did we disagree? Who was right?
4. **Calibration audit** — reliability diagram on all 104 predictions
5. **Use as ground truth** — 2026 data becomes calibration dataset for future models

---

## Academic References

1. **Dixon & Coles (1997)** — Modelling Association Football Scores and Inefficiencies in the Football Betting Market
2. **Karlis & Ntzoufras (2003)** — Analysis of Sports Data by Using Bivariate Poisson Models (RSA Journal)
3. **Yang (2016, Berkeley)** — Performance of ELO Rating System Variants (49k international matches)
4. **Penn & Donnelly (2022)** — Double Poisson Model (RSS Euro 2020 prediction winner)
5. **Robberechts & Davis (2018, KU Leuven)** — Forecasting the FIFA World Cup
6. **Reading Economics (2023)** — Momentum in Football Betting Markets (no momentum effect)
7. **onthepitch.now (2026)** — xG Integration Gate Results (ΔBrier -0.0023)
8. **gamblingcalc.com (2026)** — International Football xG Limitations
9. **INSPIREE (2026)** — xG Correlation in National Teams (r=0.475)
10. **Koopman & Lit (2015)** — Bivariate Poisson: significant in-sample, negligible out-of-sample

---

**Document Version:** 2.0
**Date:** 2026-06-12
**Status:** Evidence-based revision (replaces v1.0 speculation-driven plan)
**Methodology:** Based on 3 parallel literature reviews covering xG validation, dynamic ELO evidence, and prediction model validation methodology
