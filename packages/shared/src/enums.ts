/**
 * Value sets for every field that used to be a Prisma enum, back when the
 * database was Postgres. SQLite's Prisma connector has no enum support, so
 * these fields are now plain String columns (see packages/db/prisma/schema.prisma)
 * and this file is the single source of truth for valid values, used for
 * <select> options and zod validation.
 */

export const CONDITIONS = [
  "MINT",
  "NEAR_MINT",
  "LIGHTLY_PLAYED",
  "MODERATELY_PLAYED",
  "HEAVILY_PLAYED",
  "DAMAGED",
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const FINISHES = [
  "NON_FOIL",
  "HOLO",
  "REVERSE_HOLO",
  "COSMOS_HOLO",
  "CRACKED_ICE",
  "FULL_ART_TEXTURED",
  "RAINBOW",
  "GOLD",
  "ETCHED",
  "PARALLEL",
  "SECRET_TEXTURED",
  "ULTIMATE",
  "GHOST",
  "STARLIGHT",
  "QUARTER_CENTURY",
  "PRISMATIC",
  "OTHER",
] as const;
export type Finish = (typeof FINISHES)[number];

export const EDITIONS = [
  "UNLIMITED",
  "FIRST_EDITION",
  "SHADOWLESS",
  "LIMITED",
  "PROMO",
  "STAFF",
  "PRERELEASE",
] as const;
export type Edition = (typeof EDITIONS)[number];

export const GRADING_COMPANIES = ["PSA", "BGS", "CGC", "SGC", "TAG", "ACE", "OTHER"] as const;
export type GradingCompany = (typeof GRADING_COMPANIES)[number];

export const SET_TYPES = [
  "MAIN",
  "EXPANSION",
  "SPECIAL",
  "STARTER_DECK",
  "PROMO",
  "TIN_OR_COLLECTION",
  "TOURNAMENT",
] as const;
export type SetType = (typeof SET_TYPES)[number];

export const PRICE_SOURCE_KINDS = [
  "CARDMARKET",
  "CARDTRADER",
  "TCGPLAYER",
  "EBAY_SOLD",
  "AGGREGATOR",
  "MANUAL",
] as const;
export type PriceSourceKind = (typeof PRICE_SOURCE_KINDS)[number];

export const MARKETPLACES = ["CARDMARKET", "CARDTRADER", "EBAY", "TCGPLAYER"] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

/** SyncState.status — see packages/db/src/jobs/runner.ts. */
export const SYNC_STATUSES = ["pending", "syncing", "done", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];
