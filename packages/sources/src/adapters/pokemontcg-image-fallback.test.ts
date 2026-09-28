import { describe, expect, it, vi } from "vitest";
import { PokemonTcgIoImageFallback } from "./pokemontcg-image-fallback";

function fakeFetch(sets: Array<{ id: string; name: string; releaseDate?: string }>) {
  return vi.fn(async (url: string) => {
    expect(url).toContain("/sets");
    return new Response(JSON.stringify({ data: sets }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("PokemonTcgIoImageFallback", () => {
  it("matches a set by normalized name and builds candidate image URLs", async () => {
    const fallback = new PokemonTcgIoImageFallback({
      fetch: fakeFetch([{ id: "swsh45", name: "Shining Fates", releaseDate: "2021/02/19" }]),
    });

    const urls = await fallback.imageUrlsFor({
      setName: "Shining Fates",
      releaseDate: "2021-02-19",
      localId: "4",
    });

    expect(urls).toEqual([
      "https://images.pokemontcg.io/swsh45/4_hires.png",
      "https://images.pokemontcg.io/swsh45/4.png",
    ]);
  });

  it("disambiguates same-named sets by release date", async () => {
    const fallback = new PokemonTcgIoImageFallback({
      fetch: fakeFetch([
        { id: "base1", name: "Base", releaseDate: "1999/01/09" },
        { id: "base4", name: "Base", releaseDate: "2000/01/09" },
      ]),
    });

    const urls = await fallback.imageUrlsFor({
      setName: "Base",
      releaseDate: "2000-01-09",
      localId: "4",
    });

    expect(urls?.[0]).toContain("/base4/");
  });

  it("returns null when no set matches", async () => {
    const fallback = new PokemonTcgIoImageFallback({
      fetch: fakeFetch([{ id: "base1", name: "Base Set" }]),
    });

    const urls = await fallback.imageUrlsFor({ setName: "Totally Unknown Set", localId: "4" });
    expect(urls).toBeNull();
  });

  it("returns null (not a throw) when the API is unreachable", async () => {
    const fallback = new PokemonTcgIoImageFallback({
      fetch: vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });

    await expect(
      fallback.imageUrlsFor({ setName: "Base Set", localId: "4" }),
    ).resolves.toBeNull();
  });

  it("caches the set list across lookups (only fetches once)", async () => {
    const fetchImpl = fakeFetch([{ id: "base1", name: "Base Set" }]);
    const fallback = new PokemonTcgIoImageFallback({ fetch: fetchImpl });

    await fallback.imageUrlsFor({ setName: "Base Set", localId: "1" });
    await fallback.imageUrlsFor({ setName: "Base Set", localId: "2" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
