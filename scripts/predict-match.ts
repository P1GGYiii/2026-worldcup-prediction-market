/**
 * Quick single-match prediction: KOR vs CZE
 * Usage: npx tsx scripts/predict-match.ts
 */
import { winExpectancy } from '../src/lib/sim/elo';
import { lambdaFor, samplePoisson } from '../src/lib/sim/goals';
import { XoshiroRNG } from '../src/lib/sim/rng';
import { recentFormAdjustment } from '../src/lib/sim/match';
import teamsData from '../src/data/teams.json';

const teams = (teamsData as { teams: any[] }).teams;
const KOR = teams.find((t) => t.id === 'KOR')!;
const CZE = teams.find((t) => t.id === 'CZE')!;

console.log('\n=== 韩国 vs 捷克 预测 (A组) ===\n');
console.log('基础数据:');
console.log(`  韩国: ELO ${KOR.elo}, 一年前 ${KOR.elo_1y_ago}`);
console.log(`  捷克: ELO ${CZE.elo}, 一年前 ${CZE.elo_1y_ago}`);

// 近期状态调整
const korRecent = recentFormAdjustment(KOR);
const czeRecent = recentFormAdjustment(CZE);
console.log(`\n近期状态调整 (α=0.2):`);
console.log(`  韩国: ${korRecent > 0 ? '+' : ''}${korRecent.toFixed(1)} ELO (${KOR.elo - KOR.elo_1y_ago > 0 ? '上升趋势' : '下降趋势'})`);
console.log(`  捷克: ${czeRecent > 0 ? '+' : ''}${czeRecent.toFixed(1)} ELO (${CZE.elo - CZE.elo_1y_ago > 0 ? '上升趋势' : '下降趋势'})`);

const eloKOR = KOR.elo + korRecent;
const eloCZE = CZE.elo + czeRecent;
console.log(`\n有效 ELO:`);
console.log(`  韩国: ${eloKOR.toFixed(0)}`);
console.log(`  捷克: ${eloCZE.toFixed(0)}`);
console.log(`  差距: ${(eloKOR - eloCZE).toFixed(0)} (韩国${eloKOR > eloCZE ? '高' : '低'})`);

// 胜率计算
const winExpKOR = winExpectancy(eloKOR, eloCZE);
console.log(`\nELO 胜率期望 (二元制):`);
console.log(`  韩国: ${(winExpKOR * 100).toFixed(1)}%`);
console.log(`  捷克: ${((1 - winExpKOR) * 100).toFixed(1)}%`);

// 进球率模型
const lambdaKOR = lambdaFor(eloKOR, eloCZE, 0);
const lambdaCZE = lambdaFor(eloCZE, eloKOR, 0);
console.log(`\n进球期望值 (Poisson λ):`);
console.log(`  韩国: ${lambdaKOR.toFixed(3)} 球/场`);
console.log(`  捷克: ${lambdaCZE.toFixed(3)} 球/场`);
console.log(`  场均总进球期望: ${(lambdaKOR + lambdaCZE).toFixed(2)}`);

// 蒙特卡洛模拟 50000 场
const NUM_SIMS = 50000;
const rng = new XoshiroRNG(42); // 固定种子保证可复现
let korWins = 0, draws = 0, czeWins = 0;
const scoreMap = new Map<string, number>();
let totalGoalsKOR = 0, totalGoalsCZE = 0;

for (let i = 0; i < NUM_SIMS; i++) {
  const gKOR = samplePoisson(lambdaKOR, rng);
  const gCZE = samplePoisson(lambdaCZE, rng);
  
  totalGoalsKOR += gKOR;
  totalGoalsCZE += gCZE;
  
  if (gKOR > gCZE) korWins++;
  else if (gKOR < gCZE) czeWins++;
  else draws++;
  
  const key = `${gKOR}-${gCZE}`;
  scoreMap.set(key, (scoreMap.get(key) || 0) + 1);
}

console.log(`\n${'═'.repeat(40)}`);
console.log(`蒙特卡洛模拟结果 (N=${NUM_SIMS.toLocaleString()}, seed=42)`);
console.log(`${'═'.repeat(40)}`);
console.log(`\n胜平负概率:`);
console.log(`  韩国胜: ${(korWins / NUM_SIMS * 100).toFixed(1)}%`);
console.log(`  平  局: ${(draws / NUM_SIMS * 100).toFixed(1)}%`);
console.log(`  捷克胜: ${(czeWins / NUM_SIMS * 100).toFixed(1)}%`);

console.log(`\n场均进球:`);
console.log(`  韩国: ${(totalGoalsKOR / NUM_SIMS).toFixed(2)}`);
console.log(`  捷克: ${(totalGoalsCZE / NUM_SIMS).toFixed(2)}`);

// Top 12 比分
console.log(`\n最可能比分 (前12):`);
const sortedScores = Array.from(scoreMap.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);

const maxCount = sortedScores[0][1];
sortedScores.forEach(([score, count], idx) => {
  const pct = (count / NUM_SIMS * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(count / maxCount * 20));
  const [gK, gC] = score.split('-').map(Number);
  const outcome = gK > gC ? '韩胜' : gK < gC ? '捷胜' : '平局';
  console.log(`  ${String(idx + 1).padStart(2)}. 韩${score.padEnd(4)}捷  ${pct.padStart(5)}%  ${bar}  [${outcome}]`);
});

// 泊松概率直接计算 (用于验证)
console.log(`\n泊松分布直算 (验证):`);
function poissonPMF(k: number, lambda: number): number {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

let pKorWin = 0, pDraw = 0, pCzeWin = 0;
for (let i = 0; i <= 8; i++) {
  for (let j = 0; j <= 8; j++) {
    const p = poissonPMF(i, lambdaKOR) * poissonPMF(j, lambdaCZE);
    if (i > j) pKorWin += p;
    else if (i === j) pDraw += p;
    else pCzeWin += p;
  }
}
console.log(`  韩国胜: ${(pKorWin * 100).toFixed(1)}%`);
console.log(`  平  局: ${(pDraw * 100).toFixed(1)}%`);
console.log(`  捷克胜: ${(pCzeWin * 100).toFixed(1)}%`);

console.log(`\n${'─'.repeat(40)}`);
console.log('预测结论:');
if (korWins > czeWins * 1.3) {
  const confidence = korWins / NUM_SIMS > 0.45 ? '强' : '中等';
  console.log(`  ✅ 韩国小幅占优 (${confidence}信心)`);
  console.log(`  📊 最可能比分: ${sortedScores[0][0].replace('-', ' : ')}`);
  console.log(`  💡 建议: 韩国胜或平局`);
} else if (czeWins > korWins * 1.3) {
  const confidence = czeWins / NUM_SIMS > 0.45 ? '强' : '中等';
  console.log(`  ✅ 捷克小幅占优 (${confidence}信心)`);
  console.log(`  📊 最可能比分: ${sortedScores[0][0].replace('-', ' : ')}`);
} else {
  console.log(`  ⚖️  双方实力非常接近`);
  console.log(`  📊 最可能比分: ${sortedScores[0][0].replace('-', ' : ')}`);
  console.log(`  💡 建议: 关注平局`);
}
console.log(`${'─'.repeat(40)}\n`);
