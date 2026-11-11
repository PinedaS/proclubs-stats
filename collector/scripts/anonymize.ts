// Anonimiza partidos reales antes de guardarlos como fixtures en un repo público:
// reemplaza IDs de cuenta, gamertags y clubes rivales por valores ficticios,
// de forma determinista y sin cambiar la estructura ni los stats.
import type { ClubMatch } from 'proclubs-sdk';

type Dict = Record<string, unknown>;

export interface AnonymizeResult {
  matches: ClubMatch[];
  /** ID real -> ID ficticio. Solo para uso local; no se guarda en el repo. */
  playerIds: Map<string, string>;
  clubIds: Map<string, string>;
}

const FAKE_PLAYER_BASE = 1_000_000_001;
const FAKE_CLUB_BASE = 9_000_001;

export function anonymizeMatches(input: ClubMatch[], ourClubId: string): AnonymizeResult {
  const playerIds = new Map<string, string>();
  const clubIds = new Map<string, string>();

  const fakePlayer = (id: string): string => {
    if (!playerIds.has(id)) playerIds.set(id, String(FAKE_PLAYER_BASE + playerIds.size));
    return playerIds.get(id)!;
  };
  const fakeClub = (id: string): string => {
    if (id === ourClubId) return id;
    if (!clubIds.has(id)) clubIds.set(id, String(FAKE_CLUB_BASE + clubIds.size));
    return clubIds.get(id)!;
  };
  const suffix = (id: string) => id.slice(-2);

  const matches = input.map((original) => {
    const m = structuredClone(original) as unknown as Dict;

    const clubs: Dict = {};
    for (const [id, club] of Object.entries((m.clubs as Dict | undefined) ?? {})) {
      const newId = fakeClub(id);
      const c = club as Dict;
      const details = c.details as Dict | undefined;
      if (details) {
        details.clubId = typeof details.clubId === 'number' ? Number(newId) : newId;
        if (id !== ourClubId) {
          details.name = `Rival FC ${suffix(newId)}`;
          delete details.customKit; // trae nombre de estadio y colores del rival
        }
      }
      clubs[newId] = c;
    }
    m.clubs = clubs;

    const players: Dict = {};
    for (const [clubId, roster] of Object.entries((m.players as Dict | undefined) ?? {})) {
      const isOurs = clubId === ourClubId;
      const newRoster: Dict = {};
      for (const [playerId, stats] of Object.entries(roster as Dict)) {
        const newId = fakePlayer(playerId);
        newRoster[newId] = { ...(stats as Dict), playername: `${isOurs ? 'Jugador' : 'Rival'}_${suffix(newId)}` };
      }
      players[fakeClub(clubId)] = newRoster;
    }
    m.players = players;

    const aggregate: Dict = {};
    for (const [clubId, agg] of Object.entries((m.aggregate as Dict | undefined) ?? {})) {
      aggregate[fakeClub(clubId)] = agg;
    }
    m.aggregate = aggregate;

    return m as unknown as ClubMatch;
  });

  return { matches, playerIds, clubIds };
}
