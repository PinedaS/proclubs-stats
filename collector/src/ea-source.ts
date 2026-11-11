// Acceso a la API de EA a través de proclubs-sdk, detrás de una interfaz
// (MatchSource) para poder probar el colector sin red.
import { ProClubsClient, type ClubMatch } from 'proclubs-sdk';
import type { MatchType } from './domain.ts';

export interface FoundClub {
  clubId: string;
  name: string;
}

export interface MatchSource {
  findClubByName(name: string): Promise<FoundClub>;
  listMatches(clubId: string, type: MatchType): Promise<ClubMatch[]>;
  /** members/stats tal cual: { members: [...] }. */
  getMemberStats(clubId: string): Promise<unknown>;
  /** skillRating del club (clubs/overallStats), o null si EA no lo da. */
  getClubSkillRating(clubId: string): Promise<number | null>;
}

export class ClubNotFoundError extends Error {
  override name = 'ClubNotFoundError';
}

// EA devuelve como máximo 10 partidos por tipo, aunque se pidan más.
const EA_MAX_MATCHES = 10;

export class EaMatchSource implements MatchSource {
  readonly #client: ProClubsClient;
  readonly #platform: 'common-gen5' | 'nx';

  constructor(platform: 'common-gen5' | 'nx') {
    this.#platform = platform;
    // Reintentos acotados del SDK (429/502/503/504 y red). Sin bucle propio encima.
    this.#client = new ProClubsClient({ platform, maxAttempts: 3, timeoutMs: 20_000 });
  }

  async findClubByName(name: string): Promise<FoundClub> {
    const results = await this.#client.clubs.search({ name, platform: this.#platform });
    // La búsqueda de EA es parcial ("Aston Huila" también trae "Aston Huila FC"):
    // se exige coincidencia exacta, sin distinguir mayúsculas.
    const wanted = name.trim().toLowerCase();
    const exact = results.filter((c) => c.clubName?.trim().toLowerCase() === wanted);
    if (exact.length !== 1) {
      const found = results.map((c) => `${c.clubName} (${c.clubId})`).join(', ') || 'ninguno';
      throw new ClubNotFoundError(
        `Se esperaba 1 club llamado exactamente "${name}" y hubo ${exact.length}. Resultados: ${found}`,
      );
    }
    const club = exact[0]!;
    return { clubId: String(club.clubId), name: club.clubName ?? name };
  }

  listMatches(clubId: string, type: MatchType): Promise<ClubMatch[]> {
    return this.#client.matches.list({ clubId, type, limit: EA_MAX_MATCHES, platform: this.#platform });
  }

  getMemberStats(clubId: string): Promise<unknown> {
    return this.#client.members.stats({ clubId, platform: this.#platform });
  }

  async getClubSkillRating(clubId: string): Promise<number | null> {
    const stats = await this.#client.clubs.overallStats({ clubId, platform: this.#platform });
    const value = Number((stats as { skillRating?: unknown } | null)?.skillRating);
    return Number.isInteger(value) && value > 0 ? value : null;
  }
}
