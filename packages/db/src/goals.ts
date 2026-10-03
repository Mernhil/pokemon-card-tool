import type { Prisma } from "@prisma/client";
import { isRarityTier, rarityTier } from "@tcg-vault/shared";
import { prisma } from "./client";
import { findPokemonByName } from "./dex";

/**
 * Custom goals: a saved search plus a progress bar. The filter is exactly what
 * the Search page understands (name, set, rarity, rarity tier, finish,
 * language, exact-Pokémon match), so any search can become a goal.
 */

export interface GoalFilter {
  q?: string;
  set?: number;
  rarity?: number;
  tier?: string;
  finish?: string;
  /** A language code; absent = any language. */
  lang?: string;
  /** true = the user chose the plain text match over the exact-Pokémon one. */
  plainText?: boolean;
}

export interface PrintingFilterInput extends GoalFilter {
  /** Search page's "owned only". */
  owned?: boolean;
}

/**
 * The Prisma filter for printings behind both the Search page and goals.
 * Also returns the Pokémon it matched exactly, if any.
 */
export async function printingFilter(
  input: PrintingFilterInput,
): Promise<{ where: Prisma.PrintingWhereInput; pokemon: { dexId: number; name: string } | null }> {
  const q = input.q?.trim() ?? "";
  const pokemon = q && !input.plainText ? await findPokemonByName(q) : null;
  const tier = isRarityTier(input.tier) ? input.tier : undefined;
  const tierRarityIds = tier
    ? (
        await prisma.rarity.findMany({
          select: { id: true, name: true, game: { select: { slug: true } } },
        })
      )
        .filter((r) => rarityTier(r.game.slug, r.name) === tier)
        .map((r) => r.id)
    : null;
  const where: Prisma.PrintingWhereInput = {
    ...(pokemon
      ? { card: { dex: { some: { dexId: pokemon.dexId } }, game: { slug: "pokemon" } } }
      : q
        ? { card: { name: { contains: q } } }
        : {}),
    ...(input.set ? { setId: input.set } : {}),
    ...(input.rarity ? { rarityId: input.rarity } : {}),
    ...(tierRarityIds ? { AND: [{ rarityId: { in: tierRarityIds } }] } : {}),
    ...(input.finish || input.owned || input.lang
      ? {
          variants: {
            some: {
              ...(input.finish ? { finish: input.finish } : {}),
              ...(input.lang ? { languageCode: input.lang } : {}),
              ...(input.owned ? { collection: { some: {} } } : {}),
            },
          },
        }
      : {}),
  };
  return { where, pokemon };
}

/** Keeps only the fields a goal stores, with the right types. */
export function sanitizeGoalFilter(raw: unknown): GoalFilter {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : undefined);
  const str = (v: unknown, max = 100) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const out: GoalFilter = {};
  const q = str(r.q);
  if (q) out.q = q;
  const set = num(r.set);
  if (set) out.set = set;
  const rarity = num(r.rarity);
  if (rarity) out.rarity = rarity;
  if (isRarityTier(r.tier)) out.tier = r.tier;
  const finish = str(r.finish, 30);
  if (finish) out.finish = finish;
  const lang = str(r.lang, 10);
  if (lang) out.lang = lang;
  if (r.plainText === true) out.plainText = true;
  return out;
}

export async function createGoal(name: string, filter: unknown) {
  const clean = sanitizeGoalFilter(filter);
  const title = name.trim().slice(0, 80);
  if (!title) throw new Error("Give the goal a name");
  if (Object.keys(clean).length === 0)
    throw new Error("A goal needs at least one filter (a name, set, rarity…)");
  return prisma.goal.create({ data: { name: title, filter: JSON.stringify(clean) } });
}

export async function deleteGoal(id: string): Promise<void> {
  await prisma.goal.delete({ where: { id } });
}

export interface GoalProgress {
  id: string;
  name: string;
  filter: GoalFilter;
  /** Cards (printings) that match. */
  total: number;
  /** Of those, how many you own in the filter's language / finish. */
  owned: number;
}

export function parseGoalFilter(json: string): GoalFilter {
  try {
    return sanitizeGoalFilter(JSON.parse(json));
  } catch {
    return {};
  }
}

export async function goalProgress(goal: { id: string; name: string; filter: string }): Promise<GoalProgress> {
  const filter = parseGoalFilter(goal.filter);
  const { where } = await printingFilter(filter);
  const [total, owned] = await Promise.all([
    prisma.printing.count({ where }),
    prisma.printing.count({
      where: {
        AND: [
          where,
          {
            variants: {
              some: {
                ...(filter.finish ? { finish: filter.finish } : {}),
                ...(filter.lang ? { languageCode: filter.lang } : {}),
                collection: { some: {} },
              },
            },
          },
        ],
      },
    }),
  ]);
  return { id: goal.id, name: goal.name, filter, total, owned };
}

export async function listGoals(): Promise<GoalProgress[]> {
  const goals = await prisma.goal.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(goals.map(goalProgress));
}

/** The Search page URL that shows a goal's cards. */
export function goalSearchParams(filter: GoalFilter): string {
  const p = new URLSearchParams();
  if (filter.q) p.set("q", filter.q);
  if (filter.set) p.set("set", String(filter.set));
  if (filter.rarity) p.set("rarity", String(filter.rarity));
  if (filter.tier) p.set("tier", filter.tier);
  if (filter.finish) p.set("finish", filter.finish);
  p.set("lang", filter.lang ?? "all");
  if (filter.plainText) p.set("dex", "0");
  p.set("sort", "number");
  return p.toString();
}
