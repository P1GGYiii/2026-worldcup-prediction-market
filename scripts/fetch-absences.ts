/**
 * POC: Fetch a national team's squad with name / position / market value / injury status.
 *
 * Source priority:
 *   1. transfermarkt.com (rich: market value + injury flag in squad table)
 *   2. fbref.com (fallback: squad list, no market value)
 *
 * Output shape:
 *   { team_id: "ARG", players: [{ name, position, market_value_mil, injured? }, ...] }
 *
 * Usage: pnpm tsx scripts/fetch-absences.ts [TEAM_ID]
 * Defaults to ARG.
 *
 * Anti-bot notes:
 *   - Transfermarkt blocks default node UAs. Sends realistic Chrome UA + Accept-Language.
 *   - On 403 / CAPTCHA HTML markers we fall through to fbref.
 *   - Single request per team (squad page); no parallel hammering.
 */

import * as cheerio from 'cheerio';

// ---------- types ----------

type Position = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM' | 'WG' | 'ATT';

interface Player {
  name: string;
  position: Position;
  market_value_mil: number | null;
  injured?: boolean;
}

interface SquadResult {
  team_id: string;
  source: 'transfermarkt' | 'fbref';
  players: Player[];
}

// ---------- config ----------

// Hardcoded for POC. In full impl this would be a map of all 48 WC teams.
const TEAM_REGISTRY: Record<
  string,
  { tm_slug: string; tm_id: number; fbref_id: string; fbref_slug: string }
> = {
  ARG: {
    tm_slug: 'argentinien',
    tm_id: 3437,
    fbref_id: 'f9fddd6e',
    fbref_slug: 'Argentina-Men-Stats',
  },
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const COMMON_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

// ---------- helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function looksLikeBlock(html: string, status: number): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const lower = html.slice(0, 4000).toLowerCase();
  return (
    lower.includes('captcha') ||
    lower.includes('access denied') ||
    lower.includes('cloudflare') && lower.includes('challenge') ||
    lower.includes('just a moment')
  );
}

/**
 * Parse market value strings: "€90.00m", "€800k", "-", "" → number in millions or null.
 */
function parseMarketValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === '-') return null;
  const m = s.match(/€?\s*([\d.,]+)\s*([mk])?/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ''));
  if (Number.isNaN(num)) return null;
  const unit = (m[2] ?? 'm').toLowerCase();
  return unit === 'k' ? num / 1000 : num;
}

/**
 * Map transfermarkt long-form position labels → our 8-bucket schema.
 */
function normalizePosition(raw: string): Position {
  const s = raw.toLowerCase().trim();
  if (s.includes('goalkeeper') || s === 'gk') return 'GK';
  if (s.includes('centre-back') || s.includes('center-back')) return 'CB';
  if (s.includes('right-back') || s.includes('left-back') || s.includes('full-back') || s.includes('wing-back'))
    return 'FB';
  if (s.includes('defensive midfield')) return 'DM';
  if (s.includes('attacking midfield') || s.includes('second striker')) return 'AM';
  if (s.includes('left winger') || s.includes('right winger')) return 'WG';
  if (s.includes('central midfield') || s.includes('left midfield') || s.includes('right midfield') || s === 'mid')
    return 'CM';
  if (s.includes('centre-forward') || s.includes('center-forward') || s.includes('striker') || s.includes('forward'))
    return 'ATT';
  // last-resort buckets
  if (s.includes('defen')) return 'CB';
  if (s.includes('midfield')) return 'CM';
  if (s.includes('attack')) return 'ATT';
  return 'CM';
}

// ---------- transfermarkt ----------

async function fetchTransfermarkt(teamId: string): Promise<SquadResult | null> {
  const meta = TEAM_REGISTRY[teamId];
  if (!meta) throw new Error(`Unknown team_id: ${teamId}`);

  const url = `https://www.transfermarkt.com/${meta.tm_slug}/startseite/verein/${meta.tm_id}`;
  console.error(`[transfermarkt] GET ${url}`);

  const res = await fetch(url, { headers: COMMON_HEADERS, redirect: 'follow' });
  const html = await res.text();

  if (looksLikeBlock(html, res.status)) {
    console.error(`[transfermarkt] BLOCKED status=${res.status} len=${html.length}`);
    return null;
  }
  console.error(`[transfermarkt] OK status=${res.status} len=${html.length}`);

  const $ = cheerio.load(html);

  // The squad table is `table.items > tbody > tr.odd | tr.even`.
  // Each player row has a `td.hauptlink` containing the player name (anchor),
  // a small inline position label, and a `.rechts.hauptlink` cell with the market value.
  const rows = $('table.items > tbody > tr').filter((_i, el) => {
    const cls = $(el).attr('class') ?? '';
    return cls.includes('odd') || cls.includes('even');
  });

  const players: Player[] = [];

  rows.each((_i, el) => {
    const $row = $(el);

    // Name lives in the inline-table inside the player cell.
    // Structure: td > div.box-personeninfos OR table.inline-table > tr > td > a
    const nameAnchor = $row.find('table.inline-table td.hauptlink a').first();
    const name = nameAnchor.text().trim();
    if (!name) return;

    // Position is the SECOND row of the inline-table (under the name link).
    const posCell = $row.find('table.inline-table tr').eq(1).find('td').first();
    const posRaw = posCell.text().trim();
    const position = normalizePosition(posRaw);

    // Market value: last td with .rechts.hauptlink, or generic .rechts at end of row.
    let mvText = $row.find('td.rechts.hauptlink').first().text().trim();
    if (!mvText) mvText = $row.find('td').last().text().trim();
    const market_value_mil = parseMarketValue(mvText);

    // Injury icon: transfermarkt puts <span class="ausrufezeichen-rund-icon ..."> or
    // an <img title="Injured"> in the row when a player is sidelined.
    const injuryFlag =
      $row.find('span[class*="ausrufezeichen"], span[class*="verletzt"], img[title*="njur"], img[title*="uspen"]')
        .length > 0;

    players.push({
      name,
      position,
      market_value_mil,
      ...(injuryFlag ? { injured: true } : {}),
    });
  });

  if (players.length === 0) {
    console.error('[transfermarkt] parsed 0 rows — selector may have drifted');
    return null;
  }

  return { team_id: teamId, source: 'transfermarkt', players };
}

// ---------- fbref fallback ----------

async function fetchFbref(teamId: string): Promise<SquadResult | null> {
  const meta = TEAM_REGISTRY[teamId];
  if (!meta) throw new Error(`Unknown team_id: ${teamId}`);

  const url = `https://fbref.com/en/squads/${meta.fbref_id}/${meta.fbref_slug}`;
  console.error(`[fbref] GET ${url}`);

  const res = await fetch(url, { headers: COMMON_HEADERS, redirect: 'follow' });
  const html = await res.text();

  if (looksLikeBlock(html, res.status)) {
    console.error(`[fbref] BLOCKED status=${res.status} len=${html.length}`);
    return null;
  }
  console.error(`[fbref] OK status=${res.status} len=${html.length}`);

  const $ = cheerio.load(html);

  // fbref's main roster table is `table#stats_standard_*` or `table#roster`.
  // We grab the first table whose data-stat="player" anchor list is non-empty.
  const players: Player[] = [];
  const candidateTable = $('table').filter((_i, t) => $(t).find('th[data-stat="player"], td[data-stat="player"]').length > 0).first();

  candidateTable.find('tbody tr').each((_i, el) => {
    const $row = $(el);
    if ($row.hasClass('thead')) return;
    const name = $row.find('th[data-stat="player"] a, td[data-stat="player"] a').first().text().trim();
    if (!name) return;
    const posRaw = $row.find('td[data-stat="position"]').first().text().trim();
    // fbref uses short codes already: GK, DF, MF, FW
    let position: Position;
    if (posRaw === 'GK') position = 'GK';
    else if (posRaw === 'DF') position = 'CB';
    else if (posRaw === 'MF') position = 'CM';
    else if (posRaw === 'FW') position = 'ATT';
    else if (posRaw.includes('MF') && posRaw.includes('FW')) position = 'AM';
    else if (posRaw.includes('DF') && posRaw.includes('MF')) position = 'DM';
    else position = normalizePosition(posRaw);

    players.push({ name, position, market_value_mil: null });
  });

  if (players.length === 0) {
    console.error('[fbref] parsed 0 rows');
    return null;
  }

  return { team_id: teamId, source: 'fbref', players };
}

// ---------- main ----------

async function main() {
  const teamId = (process.argv[2] ?? 'ARG').toUpperCase();

  let result = await fetchTransfermarkt(teamId);
  if (!result) {
    console.error('[main] transfermarkt failed, falling back to fbref…');
    await sleep(1500); // small courtesy delay before hitting the next host
    result = await fetchFbref(teamId);
  }

  if (!result) {
    console.error('[main] HARD BLOCKER: both sources failed for', teamId);
    process.exit(2);
  }

  // Print summary to stderr, payload to stdout (so caller can pipe to a file).
  console.error(
    `[main] OK source=${result.source} team=${result.team_id} players=${result.players.length}`,
  );
  console.error('--- first 5 players ---');
  for (const p of result.players.slice(0, 5)) {
    console.error(
      `  ${p.name.padEnd(28)} ${p.position.padEnd(4)} €${(p.market_value_mil ?? 0).toFixed(1)}m${p.injured ? '  [INJ]' : ''}`,
    );
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

main().catch((err) => {
  console.error('[main] fatal:', err);
  process.exit(1);
});
