# 2026 World Cup Prediction Model - Improvement Roadmap

## Executive Summary

This document outlines potential improvements to the Monte Carlo simulation engine for 2026 FIFA World Cup predictions. Improvements are prioritized by **Impact × Feasibility** and grouped into implementation phases.

**Current Model Strengths:**
- ELO + Poisson dual-pass simulation (with/without absences)
- Bayesian penalty shootout model
- Recent-form adjustment (α=0.2)
- Post-ET fatigue modeling
- Historical backtest validation (2014/18/22)

**Known Limitations:**
- Independent Poisson assumption (ignores tactical interactions)
- Static ELO throughout tournament
- Sparse absence calibration data (all weight combinations regressed Brier in backtest)
- No xG (expected goals) integration
- Limited psychological factors in knockout stages

---

## 🔥 Phase 1: High-Impact Core Improvements (2 weeks)

### 1. xG (Expected Goals) Model Integration

**Problem:** Current goal model uses fixed formula `λ = 1.30 + 0.18 · (ELO_diff / 100)`, which doesn't capture offensive/defensive quality differences.

**Solution:**
- Integrate **historical xG / xGA data** per team (StatsBomb, FBref, Understat)
- Hybrid model: `λ = 0.6 · historical_xG + 0.4 · elo_derived_λ`
- Captures "defensive strong teams" (low xGA) vs "offensive weak teams" (high xG but low ELO)

**Implementation:**
```typescript
// src/data/xg-stats.json
{
  "ESP": { "xg_per_match": 2.1, "xga_per_match": 0.7 },
  "ARG": { "xg_per_match": 1.9, "xga_per_match": 0.8 }
}

// src/lib/sim/goals.ts
export function lambdaFor(team: Team, opponent: Team, homeBonus = 0): number {
  const eloDerivedLambda = BASE_LAMBDA + (ALPHA * (team.elo - opponent.elo + homeBonus)) / 100;
  const xgLambda = team.xg_per_match ?? eloDerivedLambda;
  const hybrid = XG_WEIGHT * xgLambda + (1 - XG_WEIGHT) * eloDerivedLambda;
  return clamp(hybrid, LAMBDA_MIN, LAMBDA_MAX);
}
```

**Data Sources:**
- FBref (free, comprehensive)
- Understat API (xG by match)
- StatsBomb Open Data

**Expected Impact:** +3-5% prediction accuracy on group stage matches (backtest validation)

---

### 2. Dynamic ELO (In-Tournament Updates)

**Problem:** After Group Match 1 & 2, teams' ELO remains static at pre-tournament values, ignoring recent form signals.

**Solution:**
- Maintain `liveELO[]` array in `simulateTournament()`
- Update ELO after each match with K=40 (standard FIFA adjustment)
- Captures "momentum" (winning streak) vs "collapse" (losing streak)

**Implementation:**
```typescript
// src/lib/sim/tournament.ts
export function simulateTournament(...) {
  const liveELO = teams.map(t => effectiveElo(t, 'group'));
  
  // After each match in group stage:
  const updateELO = (winnerIdx: number, loserIdx: number, isDraw: boolean) => {
    const K = 40;
    const expected = winExpectancy(liveELO[winnerIdx], liveELO[loserIdx]);
    const actual = isDraw ? 0.5 : 1.0;
    liveELO[winnerIdx] += K * (actual - expected);
    liveELO[loserIdx] += K * ((1 - actual) - (1 - expected));
  };
  
  // Use liveELO instead of static team.elo in knockout stage
}
```

**Expected Impact:** +5-8% accuracy on knockout stage predictions (teams that dominated groups get boosted)

---

## ⚡ Phase 2: Data Quality Enhancement (1 week)

### 3. Fine-Grained Player Absence Modeling

**Problem:** Current criticality formula treats all 100M€ players equally, but Messi's absence ≠ equivalent midfielder's absence.

**Solution:**
```typescript
// Current: criticality = 0.8·market_value + 0.2·position_weight
// Improved:
criticality = 0.5 · (market_value_mil / 150)
            + 0.3 · (player_xg_contribution / team_xg)  // offensive contribution
            + 0.1 · (is_captain ? 1 : 0)                 // leadership
            + 0.1 · recent_form_index                    // last 5 matches
```

**Data Sources:**
- Transfermarkt player xG+xA
- FBref contribution metrics
- Team captaincy data

**Expected Impact:** Better calibration of absence penalties (current model shows ALL weight combos regress Brier)

---

### 4. Real-Time Absence API

**Problem:** `absences.json` requires manual updates; lags behind breaking news.

**Solution:**
- **Transfermarkt API** cron job (daily scrape)
- **Twitter monitoring bot** for official team accounts (injury announcements)
- GitHub Actions workflow: `update-absences.yml` runs every 6 hours

**Implementation:**
```yaml
# .github/workflows/update-absences.yml (already exists, enhance it)
- name: Scrape Transfermarkt injuries
  run: npm run fetch-absences
  
- name: Monitor team Twitter feeds
  run: tsx scripts/twitter-injuries.ts
  
- name: Commit if changed
  run: |
    git diff --quiet src/data/absences.json || \
    git commit -am "chore(absences): auto-refresh $(date -Iseconds)"
```

**Expected Impact:** Capture late injury news 12-24h faster than manual updates

---

## 🎯 Phase 3: Advanced Tactical Modeling (1 week)

### 5. Tactical Style / Match Tempo

**Problem:** Independent Poisson assumes teams' goals don't influence each other, but "possession team vs counter-attack team" changes match dynamics.

**Solution:**
- Add `possession_style` attribute (0-1 scale: counter-attack → possession)
- Adjust λ based on style clash:
  - Both attacking → boost λ (high-scoring game)
  - Possession vs defensive → reduce λ (low-tempo)

**Implementation:**
```typescript
// src/data/teams.json
{
  "id": "ESP",
  "possession_style": 0.85,  // high possession
  "defensive_index": 0.65
}

// src/lib/sim/match.ts
function styleFactor(teamA: Team, teamB: Team): { factorA: number, factorB: number } {
  const possessionGap = Math.abs(teamA.possession_style - teamB.possession_style);
  
  if (possessionGap > 0.3) {
    // Style clash → slower game
    return { factorA: 0.92, factorB: 0.92 };
  } else if (teamA.possession_style > 0.7 && teamB.possession_style > 0.7) {
    // Both possession → open game
    return { factorA: 1.08, factorB: 1.08 };
  }
  
  return { factorA: 1.0, factorB: 1.0 };
}
```

**Data Sources:**
- Sofascore average possession %
- WhoScored tactical summaries

**Expected Impact:** +2-4% accuracy on "style clash" matches (Spain vs Morocco type scenarios)

---

### 6. Knockout Stage Psychology

**Problem:** Penalty shootout model uses historical rates but ignores pressure/experience factors.

**Solution:**
```typescript
// src/lib/sim/penalties.ts
export function penaltySuccessRate(team: Team, stage: Stage): number {
  const basePK = historicalPKRate(team.id);
  
  // Experience bonus
  const championsBonus = team.world_cup_titles * 0.03;  // +3% per title
  
  // Pressure penalty
  const inexperiencePenalty = (stage === 'final' && team.finals_reached === 0) ? 0.05 : 0;
  
  // Cumulative fatigue
  const fatiguePenalty = team.consecutive_et_matches * 0.02;
  
  return clamp(
    basePK * (1 + championsBonus - inexperiencePenalty - fatiguePenalty),
    0.60, 0.85
  );
}
```

**Data Support:**
- 2022: Argentina beats Netherlands in PKs (Messi experience)
- 2018: England loses in PKs (psychological collapse)
- 2014: Germany beats Argentina (champion mentality)

**Expected Impact:** +2-3% PK outcome accuracy

---

## 📊 Phase 4: Environmental & Contextual Factors (Low Priority)

### 7. Referee Bias

- Scrape historical referee data (avg yellow cards, penalty decisions per match)
- Strict referee → higher suspension risk, lower λ (fragmented play)
- Lenient referee → smoother game, more goals

### 8. Weather & Venue Factors

North America in June: Mexico City (2200m altitude) vs Miami (heat/humidity)
- High altitude → faster fatigue (increase `FATIGUE_LAMBDA_FACTOR`)
- High heat → possession teams affected more (reduce λ by 5-8%)

### 9. Group Stage Motivation

Final group matches with "both teams advance on draw" scenarios
- Detect mutual incentive for draw → artificially suppress λ
- Example: Germany vs Spain both qualified, play 1-1 "tactical draw"

---

## 🧪 Validation & Testing

### 10. Extended Historical Backtest

**Problem:** Current backtest only covers 2014/18/22 (3 tournaments, ~192 matches) — sample size too small.

**Solution:**
- Extend to **2006-2022** (5 tournaments, ~320 matches)
- Split by stage: group vs knockout accuracy may differ significantly
- Add **Brier Score decomposition** (reliability vs resolution vs uncertainty)

**Implementation:**
```bash
npm run fetch-backtest -- --years=2006,2010,2014,2018,2022
npm run test:backtest -- --output=docs/backtest-report.json
```

---

### 11. Monte Carlo Variance Analysis

**Problem:** After 100K sims, "Spain 15.3% champion probability" — but what's the confidence interval?

**Solution:**
- Add **Bootstrap resampling** (1000 runs of N=10K each)
- Compute 95% CI for each team's probability
- If CI is [14.1%, 16.8%] → stable; if [9%, 22%] → model uncertain

**Implementation:**
```typescript
// src/lib/sim/bootstrap.ts
export function bootstrapCI(numRuns: number, simsPerRun: number): Map<string, [number, number]> {
  const results: number[][] = [];
  for (let i = 0; i < numRuns; i++) {
    const agg = runSimulations({ numSimulations: simsPerRun, seed: i });
    results.push(championProbabilities(agg).map(p => p.pct));
  }
  return computePercentileCI(results, 0.95);
}
```

---

### 12. Market Odds Fusion

**Problem:** Currently only compare against Polymarket/Kalshi, don't use for calibration.

**Solution:**
- Hybrid model: `λ_final = 0.7 · model_λ + 0.3 · odds_implied_λ`
- Market has information model doesn't (insider news, sharp money)
- Track **Kelly Criterion** bets where model disagrees with market by >5%

**Implementation:**
```typescript
// src/lib/sim/market-fusion.ts
export function fusedProbability(modelProb: number, oddsProb: number): number {
  const MARKET_WEIGHT = 0.3;
  return MARKET_WEIGHT * oddsProb + (1 - MARKET_WEIGHT) * modelProb;
}
```

---

## 🚀 Implementation Timeline

| Phase | Duration | Features | Expected Gain |
|-------|----------|----------|---------------|
| **Phase 1** | 2 weeks | xG integration + Dynamic ELO | +8-13% accuracy |
| **Phase 2** | 1 week | Player modeling + Real-time API | Better data quality |
| **Phase 3** | 1 week | Tactical styles + Psychology | +4-7% knockout accuracy |
| **Phase 4** | Ongoing | Referee/Weather/Motivation | +1-3% edge cases |
| **Validation** | Continuous | Extended backtest + Bootstrap CI | Model confidence |

**Total Effort:** ~4 weeks dev time for Phases 1-3

---

## 📌 Critical Note on 2014/18/22 Backtest Regression

The current absence model shows **"ALL combos regressed Brier"** on historical data — every (α, β, γ) weight combination made predictions worse. This suggests:

1. **Data sparsity:** Only 14 matches with documented key absences across 3 tournaments
2. **Outlier dominance:** France 2022 won DESPITE losing Benzema/Pogba/Kanté (outlier skews results)
3. **Model overcorrection:** May be over-penalizing absences relative to team depth

**Recommendation for 2026:**
- **Lock predictions before tournament starts** (commit to GitHub with timestamp)
- **Publish post-tournament comparison** (predicted vs actual outcomes)
- Use 2026 as **ground truth calibration dataset** for future model refinement
- This tournament will provide 104 matches of real data to validate improvements

---

## 📝 Next Steps

1. **Create feature branches** for each phase
2. **Add unit tests** for new model components
3. **Run backtest suite** after each change to validate no regression
4. **Document data sources** and update scripts in `/scripts`
5. **Version control snapshots** — save pre-tournament predictions for comparison

---

## References

- Current model documentation: `/methodology` route in app
- Backtest implementation: `src/lib/sim/backtest.ts`
- Absence calibration: `src/lib/sim/absences.ts` (L42-58 comments)
- ELO methodology: https://en.wikipedia.org/wiki/World_Football_Elo_Ratings
- xG resources: https://fbref.com/en/, https://understat.com/

---

**Document Version:** 1.0  
**Date:** 2026-06-12  
**Status:** Proposed for review
