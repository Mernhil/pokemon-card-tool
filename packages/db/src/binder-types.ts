// Shapes returned by binders.ts, in their own file so client components can
// import them ("@tcg-vault/db/src/binder-types") without pulling in Prisma.

export interface PocketCard {
  name: string;
  number: string;
  setName: string;
  rarity: string | null;
  finish: string;
  imageKey: string | null;
  href: string;
  valueEur: number | null;
}

export interface Pocket {
  position: number;
  /** Owned copy in the pocket. */
  item: (PocketCard & { collectionItemId: string; condition: string | null }) | null;
  /** The card the pocket is for, when it's a "want" pocket. */
  want: (PocketCard & { variantId: string }) | null;
}

export interface BinderDetail {
  id: string;
  name: string;
  color: string;
  rows: number;
  cols: number;
  setName: string | null;
  pages: Pocket[][];
  valueEur: number;
}

export interface AvailableCard extends PocketCard {
  collectionItemId: string;
  /** Copies not yet in any binder. */
  available: number;
  condition: string | null;
}
