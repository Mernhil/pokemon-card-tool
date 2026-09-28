/**
 * Fallback scan source for printings TCGdex has no image for at all — e.g.
 * cards in the 30th Anniversary Classic Collection that reprint older cards
 * TCGdex hasn't scanned under that set yet. Distinct from PR #11's
 * sibling-printing fallback (packages/db/src/catalog-sync.ts): this covers
 * cards with no scanned sibling either, by asking a second source
 * (pokemontcg.io) for the same card.
 *
 * pokemontcg.io uses its own set ids ("swsh12pt5" vs TCGdex's "sv08.5"), so
 * cards are matched by set name (normalized) + release date, then by
 * collector number within that set — never by id.
 */

export interface ImageFallbackInput {
  /** The set's display name, as the primary source reports it. */
  setName: string;
  /** The set's release date (ISO date string), if known — disambiguates reprint sets with reused names. */
  releaseDate?: string;
  /** The card's number within its set, without a "/total" suffix (e.g. "4", not "4/102"). */
  localId: string;
}

export interface ImageFallbackSource {
  /** Candidate image URLs (best first), or null when this source has no match. */
  imageUrlsFor(input: ImageFallbackInput): Promise<string[] | null>;
}

interface PokemonTcgIoSet {
  id: string;
  name: string;
  releaseDate?: string; // "YYYY/MM/DD"
}

/** Lowercase, punctuation/whitespace-collapsed, so "Scarlet & Violet—151" and "scarlet violet 151" match. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "2024-08-02" or "2024/08/02" -> "2024-08-02"; undefined when unparseable. */
function normalizeDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const match = date.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

export interface PokemonTcgIoImageFallbackOptions {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  imageBaseUrl?: string;
  timeoutMs?: number;
}

/**
 * Backed by the free pokemontcg.io API/CDN. Sets are fetched once per
 * process and cached in memory (a few hundred rows, rarely changes); a
 * failed or empty fetch is not cached, so the next lookup retries.
 */
export class PokemonTcgIoImageFallback implements ImageFallbackSource {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly imageBaseUrl: string;
  private readonly timeoutMs: number;
  private setsPromise: Promise<PokemonTcgIoSet[]> | null = null;

  constructor(options: PokemonTcgIoImageFallbackOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://api.pokemontcg.io/v2";
    this.imageBaseUrl = options.imageBaseUrl ?? "https://images.pokemontcg.io";
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private async sets(): Promise<PokemonTcgIoSet[]> {
    if (!this.setsPromise) {
      this.setsPromise = this.fetchSets().catch((err) => {
        this.setsPromise = null; // don't cache a failure
        throw err;
      });
    }
    return this.setsPromise;
  }

  private async fetchSets(): Promise<PokemonTcgIoSet[]> {
    const res = await this.fetchImpl(`${this.apiBaseUrl}/sets`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`GET ${this.apiBaseUrl}/sets -> HTTP ${res.status}`);
    const body = (await res.json()) as { data?: PokemonTcgIoSet[] };
    return body.data ?? [];
  }

  private async matchSet(setName: string, releaseDate?: string): Promise<string | null> {
    const wantName = normalizeName(setName);
    const wantDate = normalizeDate(releaseDate);
    const sets = await this.sets();
    const byName = sets.filter((s) => normalizeName(s.name) === wantName);
    if (byName.length === 0) return null;
    if (byName.length === 1) return byName[0]!.id;
    // Same name reused across reprint sets: prefer the one with a matching release date.
    const byDate = wantDate
      ? byName.find((s) => normalizeDate(s.releaseDate) === wantDate)
      : undefined;
    return (byDate ?? byName[0]!).id;
  }

  async imageUrlsFor(input: ImageFallbackInput): Promise<string[] | null> {
    let setId: string | null;
    try {
      setId = await this.matchSet(input.setName, input.releaseDate);
    } catch {
      return null; // couldn't reach pokemontcg.io: no fallback this time, not an error for the caller
    }
    if (!setId) return null;
    const number = input.localId.trim();
    if (!number) return null;
    return [
      `${this.imageBaseUrl}/${setId}/${number}_hires.png`,
      `${this.imageBaseUrl}/${setId}/${number}.png`,
    ];
  }
}
