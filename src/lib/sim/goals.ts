/**
 * Goal-sampling model: independent Poisson with λ derived from ELO difference + home bonus.
 *
 *   λ_A = clamp( BASE + ALPHA · (ELO_A − ELO_B + home_bonus_A) / 100,  MIN, MAX )
 *
 * BASE = 1.30 - mean goals per team in recent World Cup matches.
 * ALPHA = 0.18 - sensitivity to ELO gap (calibrated against historical scoring).
 *
 * Sampling: Knuth's algorithm for λ < 30 (no real match exceeds that),
 * O(λ) expected steps, fast and allocation-free.
 */

import type { XoshiroRNG } from './rng';

export const BASE_LAMBDA = 1.30;
export const ALPHA = 0.18;
const LAMBDA_MIN = 0.15;
const LAMBDA_MAX = 6.0;

export function lambdaFor(eloSelf: number, eloOpp: number, homeBonus = 0): number {
  const raw = BASE_LAMBDA + (ALPHA * (eloSelf - eloOpp + homeBonus)) / 100;
  if (raw < LAMBDA_MIN) return LAMBDA_MIN;
  if (raw > LAMBDA_MAX) return LAMBDA_MAX;
  return raw;
}

/** Sample one Poisson-distributed goal count. Knuth method. */
export function samplePoisson(lambda: number, rng: XoshiroRNG): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (true) {
    k++;
    p *= rng.next();
    if (p <= L) return k - 1;
    if (k > 50) return k - 1; // safety cap, should never hit for λ ≤ 6
  }
}

/**
 * Dixon-Coles τ correction for low-scoring outcomes.
 *
 * Reference: Dixon & Coles (1997), "Modelling Association Football Scores
 * and Inefficiencies in the Football Betting Market", JRSS-C 46(2).
 *
 * Independent Poisson undercounts 0-0 and 1-1 draws by 10-15%.
 * The τ function inflates/deflates joint probabilities for (0,0), (1,0),
 * (0,1), (1,1) based on a dependence parameter ρ.
 *
 * With ρ < 0 (empirical fit ≈ −0.10 for international football):
 *   - P(0-0) increased  (τ > 1)
 *   - P(1-1) increased  (τ > 1)
 *   - P(1-0) decreased  (τ < 1)
 *   - P(0-1) decreased  (τ < 1)
 *   - All other scores unchanged (τ = 1)
 */
export const DIXON_COLES_RHO = -0.10;

export function dixonColesTau(
  ga: number, gb: number,
  lambdaA: number, lambdaB: number,
  rho: number,
): number {
  if (ga === 0 && gb === 0) return 1 - lambdaA * lambdaB * rho;
  if (ga === 1 && gb === 0) return 1 + lambdaB * rho;
  if (ga === 0 && gb === 1) return 1 + lambdaA * rho;
  if (ga === 1 && gb === 1) return 1 - rho;
  return 1;
}

/**
 * Sample a (ga, gb) score pair from the Dixon-Coles adjusted joint distribution.
 * Uses rejection sampling with independent Poisson as the proposal distribution.
 *
 * Acceptance rate ≈ 85% for typical λ ≈ 1.3, ρ = −0.10 — negligible perf cost.
 * Set rho = 0 to recover pure independent Poisson (τ = 1 everywhere).
 */
export function sampleScoreDC(
  lambdaA: number, lambdaB: number,
  rng: XoshiroRNG,
  rho = DIXON_COLES_RHO,
): { ga: number; gb: number } {
  // Compute rejection envelope: max τ value across all outcomes
  const tauMax = Math.max(
    1 - lambdaA * lambdaB * rho, // τ(0,0) — largest when ρ < 0
    1 - rho,                      // τ(1,1)
    1,                            // all other outcomes
  );

  while (true) {
    const ga = samplePoisson(lambdaA, rng);
    const gb = samplePoisson(lambdaB, rng);
    const tau = dixonColesTau(ga, gb, lambdaA, lambdaB, rho);
    if (rng.next() * tauMax <= tau) {
      return { ga, gb };
    }
  }
}
