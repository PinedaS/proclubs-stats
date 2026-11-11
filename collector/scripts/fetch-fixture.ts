// Descarga partidos reales del club configurado y los guarda ANONIMIZADOS como
// fixtures (datos de prueba fijos). El repo es público: nunca guardes gamertags
// ni IDs de cuenta reales en test/fixtures.
// Uso: EA_CLUB_NAME="Aston Huila" npm run fetch-fixture
import { mkdir, writeFile } from 'node:fs/promises';
import { ProClubsClient } from 'proclubs-sdk';
import { anonymizeMatches } from './anonymize.ts';

const PLATFORM = 'common-gen5';
const MATCH_TYPES = ['leagueMatch', 'playoffMatch', 'friendlyMatch'] as const;

const clubName = process.env.EA_CLUB_NAME;
if (!clubName) throw new Error('Falta EA_CLUB_NAME');

const client = new ProClubsClient({ platform: PLATFORM, maxAttempts: 3 });
const outDir = new URL('../test/fixtures/', import.meta.url);
await mkdir(outDir, { recursive: true });

const clubs = await client.clubs.search({ name: clubName, platform: PLATFORM });
const club = clubs.find((c) => c.clubName?.toLowerCase() === clubName.toLowerCase());
if (!club) throw new Error(`No se encontró un club llamado exactamente "${clubName}"`);
const clubId = String(club.clubId);

for (const type of MATCH_TYPES) {
  const matches = await client.matches.list({ clubId, type, limit: 10, platform: PLATFORM });
  console.log(`${type} -> ${matches.length} partidos`);
  if (matches.length === 0) continue;
  const { matches: anonymized } = anonymizeMatches(matches, clubId);
  await writeFile(new URL(`matches-${type}.json`, outDir), JSON.stringify(anonymized, null, 2) + '\n');
}
