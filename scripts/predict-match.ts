/**
 * World Cup 2026 match prediction tool (Dixon-Coles model).
 *
 * Usage:
 *   npx tsx scripts/predict-match.ts CAN BIH
 *   npx tsx scripts/predict-match.ts USA PAR
 *   npx tsx scripts/predict-match.ts --list
 *   npx tsx scripts/predict-match.ts --groups
 */
import { lambdaFor, sampleScoreDC } from '../src/lib/sim/goals';
import { XoshiroRNG } from '../src/lib/sim/rng';
import { recentFormAdjustment } from '../src/lib/sim/match';
import teamsData from '../src/data/teams.json';
import groupsData from '../src/data/groups.json';

const teams = (teamsData as { teams: any[] }).teams;
const groups = (groupsData as { groups: Record<string, string[]> }).groups;
const HOST_BONUS = 100;
const N = 100000;

const args = process.argv.slice(2);

if (args.includes('--list')) {
  console.log('\n可用球队 ID:\n');
  const sorted = [...teams].sort((a, b) => b.elo - a.elo);
  for (const t of sorted) {
    const host = t.is_host ? ' [HOST]' : '';
    console.log(`  ${t.id.padEnd(5)} ${t.name_en.padEnd(22)} ELO ${t.elo}${host}`);
  }
  process.exit(0);
}

if (args.includes('--groups')) {
  const GROUP_PAIRS: [number, number][] = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
  for (const [letter, ids] of Object.entries(groups)) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  GROUP ${letter}`);
    console.log(`${'═'.repeat(60)}`);
    for (const [i, j] of GROUP_PAIRS) {
      compactPredict(ids[i], ids[j]);
    }
  }
  process.exit(0);
}

if (args.length < 2) {
  console.error('用法: npx tsx scripts/predict-match.ts <HOME_ID> <AWAY_ID>');
  console.error('      npx tsx scripts/predict-match.ts --list');
  console.error('      npx tsx scripts/predict-match.ts --groups');
  console.error('\n示例: npx tsx scripts/predict-match.ts CAN BIH');
  process.exit(1);
}

const homeId = args[0].toUpperCase();
const awayId = args[1].toUpperCase();
const homeTeam = teams.find((t: any) => t.id === homeId);
const awayTeam = teams.find((t: any) => t.id === awayId);
if (!homeTeam) { console.error(`未找到球队: ${homeId}。运行 --list 查看。`); process.exit(1); }
if (!awayTeam) { console.error(`未找到球队: ${awayId}。运行 --list 查看。`); process.exit(1); }

fullPredict(homeId, awayId);

// ─── Compact mode (for --groups) ───────────────────────────────────

function compactPredict(homeId: string, awayId: string) {
  const { hw, dr, aw, top } = simulate(homeId, awayId);
  const home = teams.find((t: any) => t.id === homeId)!;
  const away = teams.find((t: any) => t.id === awayId)!;
  const p = (n: number) => (n / N * 100).toFixed(0);
  console.log(
    `  ${home.name_en.padEnd(18)} vs ${away.name_en.padEnd(18)}` +
    `  ${p(hw).padStart(3)}% / ${p(dr)}% / ${p(aw).padStart(3)}%` +
    `  最可能: ${top[0][0]}`
  );
}

// ─── Full prediction output ────────────────────────────────────────

function fullPredict(homeId: string, awayId: string) {
  const home = teams.find((t: any) => t.id === homeId)!;
  const away = teams.find((t: any) => t.id === awayId)!;

  const homeRecent = recentFormAdjustment(home);
  const awayRecent = recentFormAdjustment(away);
  const eloHome = home.elo + homeRecent;
  const eloAway = away.elo + awayRecent;
  const homeBonusVal = home.is_host ? HOST_BONUS : 0;
  const awayBonusVal = away.is_host ? HOST_BONUS : 0;
  const lH = lambdaFor(eloHome, eloAway, homeBonusVal);
  const lA = lambdaFor(eloAway, eloHome, awayBonusVal);

  const { hw, dr, aw, scoreMap, top } = simulate(homeId, awayId);
  const p = (n: number) => (n / N * 100).toFixed(1);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${home.name_en} vs ${away.name_en}`);
  console.log(`${'═'.repeat(70)}`);

  // 基础数据
  console.log(`\n  基础数据:`);
  console.log(`    ${home.name_en}: ELO ${home.elo} → 有效 ${eloHome.toFixed(0)}${home.is_host ? ' [主场+100]' : ''} (近期 ${homeRecent >= 0 ? '+' : ''}${homeRecent.toFixed(1)})`);
  console.log(`    ${away.name_en}: ELO ${away.elo} → 有效 ${eloAway.toFixed(0)}${away.is_host ? ' [主场+100]' : ''} (近期 ${awayRecent >= 0 ? '+' : ''}${awayRecent.toFixed(1)})`);
  console.log(`    ELO差(含主场): ${(eloHome + homeBonusVal - eloAway - awayBonusVal).toFixed(0)}`);
  console.log(`    λ_${homeId}=${lH.toFixed(3)}, λ_${awayId}=${lA.toFixed(3)}, 场均总进球=${(lH + lA).toFixed(2)}`);

  // 胜平负
  console.log(`\n  胜平负 (N=${N.toLocaleString()}, Dixon-Coles ρ=-0.10):`);
  console.log(`    ${home.name_en}胜: ${p(hw)}%`);
  console.log(`    平  局:${' '.repeat(Math.max(1, 12 - 4))}${p(dr)}%`);
  console.log(`    ${away.name_en}胜: ${p(aw)}%`);

  // Top 12 比分
  console.log(`\n  比分分布 (Top 12):`);
  for (const [score, cnt] of top.slice(0, 12)) {
    const [h, a] = score.split('-').map(Number);
    const tag = h > a ? `${homeId}胜` : h < a ? `${awayId}胜` : '平局';
    const bar = '█'.repeat(Math.round(cnt / top[0][1] * 20));
    console.log(`    ${score.padEnd(5)} ${p(cnt).padStart(5)}%  ${bar}  [${tag}]`);
  }

  // 比分矩阵 0-5
  console.log(`\n  比分矩阵 (${homeId}进球 行, ${awayId}进球 列):`);
  let hdr = '        ';
  for (let c = 0; c <= 5; c++) hdr += `   ${c}   `;
  console.log(hdr);
  for (let h = 0; h <= 5; h++) {
    let row = `    ${h}   `;
    for (let a = 0; a <= 5; a++) {
      const cnt = scoreMap.get(`${h}-${a}`) || 0;
      const mark = h === a ? '*' : ' ';
      row += `${mark}${p(cnt).padStart(5)}%`;
    }
    console.log(row);
  }

  // 结论
  console.log(`\n  预测结论:`);
  if (hw > aw * 2) console.log(`    → ${home.name_en} 强势占优`);
  else if (hw > aw * 1.3) console.log(`    → ${home.name_en} 占优`);
  else if (aw > hw * 2) console.log(`    → ${away.name_en} 强势占优`);
  else if (aw > hw * 1.3) console.log(`    → ${away.name_en} 占优`);
  else console.log(`    → 势均力敌，关注平局`);
  console.log(`    → 最可能比分: ${top[0][0]} (${p(top[0][1])}%)`);
  console.log(`    → 推荐关注: ${top.slice(0, 3).map(([s]) => s).join(', ')}`);
  console.log(`${'═'.repeat(70)}\n`);
}

// ─── Core simulation ───────────────────────────────────────────────

function simulate(homeId: string, awayId: string) {
  const home = teams.find((t: any) => t.id === homeId)!;
  const away = teams.find((t: any) => t.id === awayId)!;
  const eloHome = home.elo + recentFormAdjustment(home);
  const eloAway = away.elo + recentFormAdjustment(away);
  const lH = lambdaFor(eloHome, eloAway, home.is_host ? HOST_BONUS : 0);
  const lA = lambdaFor(eloAway, eloHome, away.is_host ? HOST_BONUS : 0);

  const rng = new XoshiroRNG(42);
  let hw = 0, dr = 0, aw = 0;
  const scoreMap = new Map<string, number>();

  for (let i = 0; i < N; i++) {
    const { ga: gH, gb: gA } = sampleScoreDC(lH, lA, rng);
    if (gH > gA) hw++;
    else if (gH < gA) aw++;
    else dr++;
    const k = `${gH}-${gA}`;
    scoreMap.set(k, (scoreMap.get(k) || 0) + 1);
  }

  const top = [...scoreMap.entries()].sort((a, b) => b[1] - a[1]);
  return { hw, dr, aw, scoreMap, top };
}
