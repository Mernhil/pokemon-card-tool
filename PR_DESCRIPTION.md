## What this is

One PR for six pieces of catalog work. Every item was checked against a **copy** of the real app database (`%APPDATA%\app.tcgvault.desktop\local.db`; the original was never opened for writing). The branch also merges `claude/tile-quick-add` (quick add/remove on set tiles), so this is the single release candidate. No version bump or tag is included yet.

| # | Area | Outcome |
|---|---|---|
| 1 | "Refresh prices" stuck on *Updating…* | Fixed: root cause confirmed, tests added |
| 2 | Sidebar "4 sets couldn't be synced" | 1 app bug fixed, 4 sets are genuine source gaps, new "unavailable at source" state |
| 3 | Set categories | `classifySet`, `Set.category`, sectioned Browse, Pocket toggle |
| 4 | Missing images | `pnpm db:image-report`, constructed CDN candidates, limiter/retries/negative cache, failure reasons |
| 5 | Custom images | Set/replace/remove on any card, drag and drop, folder import, survive re-sync |
| 6 | 30th Celebration subsets | Classic Collection merged into the set, 5 subset tabs, generic rules file |
| 7 | One Piece / Yu-Gi-Oh! | YGO pack art as logos + backfill, fallback tile; **no clean One Piece source exists** (see below) |

New migrations (plain SQL, additive, replayed by the packaged app): `20260930120000_set_category`, `20260930130000_printing_custom_image`, `20260930140000_printing_subset`. `prisma migrate diff` between the migrations and `schema.prisma` reports no difference. Backfills run idempotently at startup next to `ensureBaseData`.

## 1. Refresh prices stuck on "Updating…"

Cause (confirmed on the real DB copy, which held orphaned `pending` rows for `cardtrader`, `ebay` and One Piece `cardmarket`/`tcgplayer`): `enqueuePriceRefresh` queued every provider, but providers that are disabled, unconfigured or unsupported for the game never run, so their rows stayed `pending` and `pricesUpdating()` was true forever.

- `runnableProviders(game, providers, settings)` = enabled AND configured AND supports the game; used for enqueuing **and** for `pricesUpdating()`.
- `pricesUpdating()` ignores rows older than 10 minutes; `cleanupPriceQueue()` removes orphaned rows and re-queues dead `syncing` rows (on every refresh click and at startup, no data migration).
- The button caps the wait at 90 s, catches errors (toast), always re-enables, shows "Last updated X ago" and one outcome line per provider (e.g. "CardTrader: API key not set").
- Tests in `packages/db/test/pricing.test.ts` (non-runnable provider, stale rows).

## 2. "4 sets couldn't be synced"

| Set | Error (as stored) | Cause | Verdict |
|---|---|---|---|
| `jumbo` Jumbo cards | `e.getSet is not a function` (18 attempts) | **our bug**, then source gap | see below |
| `rc` Radiant Collection | same | same | same |
| `sp` Sample | same | same | same |
| `wp` W Promotional | same | same | same |

- **Our bug:** `withImageFallback` returned `{ ...adapter }`; adapters are class instances, so the spread dropped `getSet`/`listSetSummaries`. Fixed (wrapper inherits from the adapter) + regression test.
- **Source gap:** after the fix, reproduced with `pnpm db:sync-catalog -- --sets jumbo,rc,sp,wp`: TCGdex lists all four (`cardCount` 160/25/10/7) but returns `cards: []`. They now become the new terminal state **`unavailable`**: plain-language reason, re-checked about monthly, *not* counted in the sidebar warning, listed separately on the Sync page with a "Check them now" button. Real failures stay failures.
- Also found in the installed app's log: every Yu-Gi-Oh! discovery died with a `SyncState` unique-constraint error because YGOPRODeck reuses `set_code` (e.g. 3 different sets share `ABPF`). Set codes are now made unique deterministically (main set keeps the plain code) and `upsertItems` de-duplicates keys.
- Sidebar tooltip names each failed set with its reason; the Sync page shows name, plain-language error, attempts and last attempt time.

## 3. Set categories

`classifySet({game, code, name, series})` in `packages/shared` (per-game rules, one overrides map). Sections: a special family with 3+ sets gets its own section, smaller ones merge into "Other & special". Browse counts, dashboard totals and binder/search set pickers are consistent (default totals = main sets; special sets stay searchable and labelled). Pocket sets skip price refresh; Settings has "Show digital-only (Pocket) sets".

Result on the real data: **141 main, 28 promo, 12 McDonald's, 21 trainer kits, 15 Pocket, 3 other** (Browse then shows "139 main sets · 76 special": the 30th Classic Collection merged away, 4 source-gap sets not synced). Full table below.

## 4. Missing images

Measured with the new `pnpm db:image-report` (read-only; `--probe`, `--sample N`, `--stored-only`, `--csv`, `--json`) on the DB copy, before any change:

- 27,252 printings; **1,779 (6.5%) had no image URL at all**. Worst sets: Paldean Wonders 131/131, Shining Fates Shiny Vault 122/122, MEP Black Star Promos 112/112, Dragon Majesty 78/78, Shining Legends 78/78, Crown Zenith Galarian Gallery 70/70, SM Promos 67/248, Aquapolis 40/186, SVP 34/226, Skyridge 32/182.
- Failure mode B (429/5xx/timeouts) did not show up in the low-rate probe (0 of 2,356); it only happens under grid bursts, which is what the limiter/retries address.

Fixes: constructed TCGdex asset variants (`high.webp`, `high.png`, `low.webp`) and pokemontcg.io CDN URLs (set-id mapping, e.g. `sv03.5` → `sv3pt5`) are tried after the stored URLs, for printings with or without stored URLs; at most 6 concurrent downloads; 429/5xx/timeout retried with backoff (honours `Retry-After`); 404s remembered per URL for 6 h; 30 s cool-down after a transient failure; the tile tooltip says what was tried (e.g. "Tried TCGdex: not found (404); pokemontcg.io: not found (404).") and the placeholder SVG carries the reason. Pinned collection images are unchanged. Existing Pokémon printings without an image key get the lazy key at startup. Tests with fake fetch: candidate ordering, retry, negative cache, limiter, custom image precedence.

**After** (same DB copy, all 67 sets that had printings without an image URL, every printing probed, stored + constructed candidates):

| | printings | loadable | still missing (all HTTP 404 at every source) |
|---|---|---|---|
| before (stored URLs only) | 3,835 | 2,086 | 1,749 (no URL at all) |
| after | 3,835 | **2,876** | **959** |

**790 cards gained an image.** Sets fully fixed include the four Trainer Galleries, Dragon Majesty, Shining Legends, Shining Fates Shiny Vault, Crown Zenith Galarian Gallery, SM Promos (mostly), 30th Classic Collection, Aquapolis/Skyridge (partly). No 429/5xx/timeouts occurred in any probe. The other 160 sets (one-piece and the rest of Pokémon) had no missing URLs; a 10-per-set sample of them was 100% loadable, and every One Piece set probed in full (OP-01…OP-08, EB-01) was 100% loadable (one OP-07 probe hit a transient network error).

**The remaining 959 are genuine source gaps** (neither TCGdex nor pokemontcg.io has a scan), full list with set, number, name and printing id in [`docs/missing-images.csv`](docs/missing-images.csv). By set: Paldean Wonders `B2a` 131 (Pocket), MEP Black Star Promos 72, My First Battle 34, all trainer kits (~330: `tk-*`), Scarlet & Violet Energy 24, Mega Evolution Energy 16, McDonald's 2014–2018 and 2023–2024 (~80), Celebrations Classic Collection 25, Unseen Forces Unown Collection 27, HGSS promos 9, Aquapolis 17, Skyridge 9, Best of game 9, Yellow A Alternate 6, Poké Card Creator Pack 5, a handful of SVP/SWSH promos and Pocket promos. These are the candidates for "Set custom image" / folder import. (Regenerate any time with `pnpm db:image-report -- --probe --csv out.csv`.)

## 5. Custom images and the official gallery

**Site check** (done before any automated access), for `https://tcg.pokemon.com/en-us/galleries/30th-celebration/`:
- `https://tcg.pokemon.com/robots.txt` returns **HTTP 404** (an HTML "Page not found", not a robots file), so the site publishes no crawl policy at all.
- The pages are served behind **Incapsula bot protection** (an `_Incapsula_Resource` challenge script is embedded in every response, including the 404).
- I did not read or agree to a terms page on the user's behalf, and did not look for a way around the protection.

**Path taken: the fallback.** No gallery adapter was built; nothing is fetched from tcg.pokemon.com. Instead:
- **Set custom image** on the card page and on every missing-image tile: choose a file or drag and drop. PNG/JPEG/WebP only, checked by file *content* (not name), max 10 MB, stored under `media/custom/` and recorded in `Printing.customImageKey`. A "Custom image" badge with *Replace* and *Remove*.
- The image cache serves the custom image first; the catalog sync never writes that column, so a re-sync keeps it (test: custom image survives a re-sync while the source still has nothing).
- **Import images from a folder** (`/import-images`, linked from Sync): files named after the collector number (`004.png`, `4.jpg`, `TG05.webp`) are matched to a chosen set with a preview (unmatched and ambiguous files are listed, never guessed) before saving.
- If the gallery is later wanted as an automated source, that needs explicit permission from the site owner; it is a small adapter on top of `imageUrls` (last fallback candidate).

## 6. 30th Celebration subsets

How the data looked before (real DB copy and TCGdex): `30th` had 161 printings (Common 68, Rare 18, Double rare 12, Pikachu Rare 30, RGB Rare 3, Illustration rare 18, Special illustration rare 10, Futuristic Rare 2) and the **Classic Collection was a separate top-level set `30th-c` with 30 printings** (numbered `NNN/30`, no rarity), 2 owned copies.

- `Printing.subset` (new migration). Rules live in one data file, `packages/shared/src/subsets.ts` (`SUBSET_RULES` + pure `subsetFor({setCode, collectorNumber, rarityName, name})`, tested with real examples). Adding subsets to another set = adding one entry.
- `SET_MERGES` folds `30th-c` into `30th`: printings are re-pointed (ids, variants, collection items, price history, binder slots untouched), sort numbers shifted after the set's own cards, binders and external refs follow, the empty set is deleted. Idempotent; collisions leave everything alone. The sync writes `30th-c` straight into the parent from now on, so the stray set never comes back.
- Result on the DB copy: `30th` = 191 cards: Classic Collection 30, Pikachu Rare 30, Special Art 28, Pokémon ex 12, Futuristic Rare 2 (89 in "See all" only); nothing owned was lost (14/191 owned).
- Set page: "See all" + one chip per subset with counts and owned/total, combined with search, sort, Owned/Missing, list-state restore and the merged quick-add controls; the selected subset is remembered with the other filters. Header completion still covers the whole set. Sets without rules look exactly as before.

## 7. One Piece and Yu-Gi-Oh!

- **Watermark:** downloaded and inspected cards. optcgapi's `card_image` is **byte-identical to Bandai's official card list image** (`en.onepiece-cardgame.com/images/cardlist/card/OP01-077.png`, 196,942 bytes both) and carries the "SAMPLE" watermark. Limitless's CDN (`limitlesstcg.nyc3.digitaloceanspaces.com/one-piece/<SET>/<ID>_EN.webp` and `_JP.webp`) serves the same watermarked art for the cards I checked (OP01-077, OP01-001, OP05-060, OP09-118, ST01-012). TCGplayer's product images are clean but need product ids no free source gives us. **I found no free, complete, unwatermarked One Piece source, so nothing was switched and no cache was invalidated** (there is nothing better to re-fetch). Clean scans can be added per card with "Set custom image" or the folder import.
- **Logos:** `cardsets.php` does return `set_image` (the pack/box art; 910 of 1,035 sets). It is now the Yu-Gi-Oh! set logo, stored locally like the Pokémon path; existing sets get it on the next sync through a cheap `listSetAssets` backfill without re-downloading any card. No free One Piece pack-art source was found; **every set without a logo gets a deterministic fallback tile** (set code + name on a game-coloured gradient), so no tile is ever blank.

## Merge with `claude/tile-quick-add`

Four additive conflicts (`set-grid`, `card-tile`, the set page, `db/index.ts`), all resolved by keeping both sides; the subset chips use the quick-add live owned counts and the subset is part of the grid's status-snapshot key.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` pass (shared 25, sources 85, pricing 16, card-fx 7, db 98). No network in tests. Also loaded the app against the DB copy: `/pokemon` shows "139 main sets · 76 special" with collapsed special sections, `/pokemon/30th` shows the five subset chips with correct counts.

Small test-infra fixes included: `global-setup.ts` runs `npx` through a shell on Windows; one timing-sensitive runner concurrency test was widened.

Not done / follow-ups: clean One Piece scans; an automated gallery adapter (needs permission); the desktop version bump and release tag.

<details><summary>Full Pokémon set → category table (220 TCGdex sets; Synced = printings in the DB copy)</summary>

| Category | Code | Name | Series | TCGdex cards | Synced cards |
|---|---|---|---|---|---|
| main | `base1` | Base Set | Base | 102 | 102 |
| main | `base2` | Jungle | Base | 64 | 64 |
| main | `base3` | Fossil | Base | 62 | 62 |
| main | `base4` | Base Set 2 | Base | 130 | 130 |
| main | `base5` | Team Rocket | Base | 83 | 83 |
| main | `gym1` | Gym Heroes | Gym | 132 | 132 |
| main | `gym2` | Gym Challenge | Gym | 132 | 132 |
| main | `neo1` | Neo Genesis | Neo | 111 | 111 |
| main | `neo2` | Neo Discovery | Neo | 75 | 75 |
| main | `neo3` | Neo Revelation | Neo | 66 | 66 |
| main | `neo4` | Neo Destiny | Neo | 113 | 113 |
| main | `lc` | Legendary Collection | Legendary Collection | 110 | 110 |
| main | `ecard1` | Expedition Base Set | E-Card | 165 | 165 |
| main | `ecard2` | Aquapolis | E-Card | 186 | 186 |
| main | `ecard3` | Skyridge | E-Card | 182 | 182 |
| main | `ex1` | Ruby & Sapphire | EX | 109 | 109 |
| main | `ex2` | Sandstorm | EX | 100 | 100 |
| main | `ex3` | Dragon | EX | 100 | 100 |
| main | `ex4` | Team Magma vs Team Aqua | EX | 97 | 97 |
| main | `ex5` | Hidden Legends | EX | 102 | 102 |
| main | `ex6` | FireRed & LeafGreen | EX | 116 | 116 |
| main | `ex7` | Team Rocket Returns | EX | 111 | 111 |
| main | `ex8` | Deoxys | EX | 108 | 108 |
| main | `ex9` | Emerald | EX | 107 | 107 |
| main | `ex10` | Unseen Forces | EX | 117 | 117 |
| main | `ex11` | Delta Species | EX | 114 | 114 |
| main | `ex12` | Legend Maker | EX | 93 | 93 |
| main | `ex13` | Holon Phantoms | EX | 111 | 111 |
| main | `ex14` | Crystal Guardians | EX | 100 | 100 |
| main | `ex15` | Dragon Frontiers | EX | 101 | 101 |
| main | `ex16` | Power Keepers | EX | 108 | 108 |
| main | `dp1` | Diamond & Pearl | Diamond & Pearl | 130 | 130 |
| main | `dp2` | Mysterious Treasures | Diamond & Pearl | 124 | 124 |
| main | `dp3` | Secret Wonders | Diamond & Pearl | 132 | 132 |
| main | `dp4` | Great Encounters | Diamond & Pearl | 106 | 106 |
| main | `dp5` | Majestic Dawn | Diamond & Pearl | 100 | 100 |
| main | `dp6` | Legends Awakened | Diamond & Pearl | 146 | 146 |
| main | `dp7` | Stormfront | Diamond & Pearl | 106 | 106 |
| main | `pl1` | Platinum | Platinum | 133 | 133 |
| main | `pl2` | Rising Rivals | Platinum | 120 | 120 |
| main | `pl3` | Supreme Victors | Platinum | 153 | 153 |
| main | `pl4` | Arceus | Platinum | 111 | 111 |
| main | `ru1` | Pokémon Rumble | Platinum | 16 | 16 |
| main | `hgss1` | HeartGold SoulSilver | HeartGold & SoulSilver | 124 | 124 |
| main | `hgss2` | Unleashed | HeartGold & SoulSilver | 96 | 96 |
| main | `hgss3` | Undaunted | HeartGold & SoulSilver | 91 | 91 |
| main | `hgss4` | Triumphant | HeartGold & SoulSilver | 103 | 103 |
| main | `col1` | Call of Legends | Call of Legends | 106 | 106 |
| main | `bw1` | Black & White | Black & White | 115 | 115 |
| main | `bw2` | Emerging Powers | Black & White | 98 | 98 |
| main | `bw3` | Noble Victories | Black & White | 102 | 102 |
| main | `bw4` | Next Destinies | Black & White | 103 | 103 |
| main | `bw5` | Dark Explorers | Black & White | 111 | 111 |
| main | `bw6` | Dragons Exalted | Black & White | 128 | 128 |
| main | `dv1` | Dragon Vault | Black & White | 21 | 21 |
| main | `bw7` | Boundaries Crossed | Black & White | 153 | 153 |
| main | `bw8` | Plasma Storm | Black & White | 138 | 138 |
| main | `bw9` | Plasma Freeze | Black & White | 122 | 122 |
| main | `bw10` | Plasma Blast | Black & White | 105 | 105 |
| main | `bw11` | Legendary Treasures | Black & White | 140 | 140 |
| main | `rc` | Radiant Collection | Black & White | 25 | — |
| main | `xy0` | Kalos Starter Set | XY | 39 | 39 |
| main | `xy1` | XY | XY | 146 | 146 |
| main | `xy2` | Flashfire | XY | 110 | 110 |
| main | `xy3` | Furious Fists | XY | 114 | 114 |
| main | `xy4` | Phantom Forces | XY | 124 | 124 |
| main | `xy5` | Primal Clash | XY | 164 | 164 |
| main | `dc1` | Double Crisis | XY | 34 | 34 |
| main | `xy6` | Roaring Skies | XY | 112 | 112 |
| main | `xy7` | Ancient Origins | XY | 101 | 101 |
| main | `xy8` | BREAKthrough | XY | 165 | 165 |
| main | `xy9` | BREAKpoint | XY | 126 | 126 |
| main | `g1` | Generations | XY | 117 | 117 |
| main | `xy10` | Fates Collide | XY | 129 | 129 |
| main | `xy11` | Steam Siege | XY | 116 | 116 |
| main | `xy12` | Evolutions | XY | 113 | 113 |
| main | `sm1` | Sun & Moon | Sun & Moon | 172 | 172 |
| main | `sm2` | Guardians Rising | Sun & Moon | 169 | 169 |
| main | `sm3` | Burning Shadows | Sun & Moon | 169 | 169 |
| main | `sm3.5` | Shining Legends | Sun & Moon | 78 | 78 |
| main | `sm4` | Crimson Invasion | Sun & Moon | 125 | 125 |
| main | `sm5` | Ultra Prism | Sun & Moon | 173 | 173 |
| main | `sm6` | Forbidden Light | Sun & Moon | 146 | 146 |
| main | `sm7` | Celestial Storm | Sun & Moon | 183 | 183 |
| main | `sm7.5` | Dragon Majesty | Sun & Moon | 78 | 78 |
| main | `sm8` | Lost Thunder | Sun & Moon | 236 | 236 |
| main | `sm9` | Team Up | Sun & Moon | 196 | 196 |
| main | `det1` | Detective Pikachu | Sun & Moon | 18 | 18 |
| main | `sm10` | Unbroken Bonds | Sun & Moon | 234 | 234 |
| main | `sm11` | Unified Minds | Sun & Moon | 258 | 258 |
| main | `sm115` | Hidden Fates | Sun & Moon | 69 | 69 |
| main | `sma` | Hidden Fates Shiny Vault | Sun & Moon | 94 | 94 |
| main | `sm12` | Cosmic Eclipse | Sun & Moon | 271 | 271 |
| main | `swsh1` | Sword & Shield | Sword & Shield | 216 | 216 |
| main | `swsh2` | Rebel Clash | Sword & Shield | 209 | 209 |
| main | `swsh3` | Darkness Ablaze | Sword & Shield | 201 | 201 |
| main | `swsh3.5` | Champion's Path | Sword & Shield | 80 | 80 |
| main | `swsh4` | Vivid Voltage | Sword & Shield | 203 | 203 |
| main | `swsh4.5sv` | Shining Fates Shiny Vault | Sword & Shield | 122 | 122 |
| main | `swsh4.5` | Shining Fates | Sword & Shield | 73 | 73 |
| main | `swsh5` | Battle Styles | Sword & Shield | 183 | 183 |
| main | `swsh6` | Chilling Reign | Sword & Shield | 233 | 233 |
| main | `swsh7` | Evolving Skies | Sword & Shield | 237 | 237 |
| main | `cel25` | Celebrations | Sword & Shield | 25 | 25 |
| main | `cel25cc` | Celebrations Classic Collection | Sword & Shield | 25 | 25 |
| main | `swsh8` | Fusion Strike | Sword & Shield | 284 | 284 |
| main | `swsh9tg` | Brilliant Stars Trainer Gallery | Sword & Shield | 30 | 30 |
| main | `swsh9` | Brilliant Stars | Sword & Shield | 186 | 186 |
| main | `swsh10tg` | Astral Radiance Trainer Gallery | Sword & Shield | 30 | 30 |
| main | `swsh10` | Astral Radiance | Sword & Shield | 216 | 216 |
| main | `swsh10.5` | Pokémon GO | Sword & Shield | 88 | 88 |
| main | `swsh11` | Lost Origin | Sword & Shield | 217 | 217 |
| main | `swsh11tg` | Lost Origin Trainer Gallery | Sword & Shield | 30 | 30 |
| main | `swsh12tg` | Silver Tempest Trainer Gallery | Sword & Shield | 30 | 30 |
| main | `swsh12` | Silver Tempest | Sword & Shield | 215 | 215 |
| main | `swsh12.5gg` | Crown Zenith Galarian Gallery | Sword & Shield | 70 | 70 |
| main | `swsh12.5` | Crown Zenith | Sword & Shield | 160 | 160 |
| main | `sv01` | Scarlet & Violet | Scarlet & Violet | 258 | 258 |
| main | `sv02` | Paldea Evolved | Scarlet & Violet | 279 | 279 |
| main | `sv03` | Obsidian Flames | Scarlet & Violet | 230 | 230 |
| main | `sv03.5` | 151 | Scarlet & Violet | 207 | 207 |
| main | `sv04` | Paradox Rift | Scarlet & Violet | 266 | 266 |
| main | `sv04.5` | Paldean Fates | Scarlet & Violet | 245 | 245 |
| main | `sv05` | Temporal Forces | Scarlet & Violet | 218 | 218 |
| main | `sv06` | Twilight Masquerade | Scarlet & Violet | 226 | 226 |
| main | `sv06.5` | Shrouded Fable | Scarlet & Violet | 99 | 99 |
| main | `sv07` | Stellar Crown | Scarlet & Violet | 175 | 175 |
| main | `sv08` | Surging Sparks | Scarlet & Violet | 252 | 252 |
| main | `sv08.5` | Prismatic Evolutions | Scarlet & Violet | 180 | 180 |
| main | `sv09` | Journey Together | Scarlet & Violet | 190 | 190 |
| main | `sv10` | Destined Rivals | Scarlet & Violet | 244 | 244 |
| main | `sv10.5w` | White Flare | Scarlet & Violet | 173 | 173 |
| main | `sv10.5b` | Black Bolt | Scarlet & Violet | 172 | 172 |
| main | `me01` | Mega Evolution | Mega Evolution | 188 | 188 |
| main | `me02` | Phantasmal Flames | Mega Evolution | 130 | 130 |
| main | `me02.5` | Ascended Heroes | Mega Evolution | 295 | 295 |
| main | `me03` | Perfect Order | Mega Evolution | 124 | 124 |
| main | `me04` | Chaos Rising | Mega Evolution | 122 | 122 |
| main | `me05` | Pitch Black | Mega Evolution | 120 | 120 |
| main | `30th-c` | 30th Classic Collection | Mega Evolution | 30 | 30 |
| main | `30th` | 30th Celebration | Mega Evolution | 161 | 161 |
| promo | `miscp` | Miscellaneous Promos | Miscellaneous | 1 | 1 |
| promo | `basep` | Wizards Black Star Promos | Base | 53 | 53 |
| promo | `wp` | W Promotional | Base | 7 | — |
| promo | `si1` | Southern Islands | Neo | 18 | 18 |
| promo | `sp` | Sample | E-Card | 10 | — |
| promo | `bog` | Best of game | E-Card | 9 | 9 |
| promo | `np` | Nintendo Black Star Promos | POP | 40 | 40 |
| promo | `ex5.5` | Poké Card Creator Pack | EX | 5 | 5 |
| promo | `pop1` | POP Series 1 | POP | 17 | 17 |
| promo | `pop2` | POP Series 2 | POP | 17 | 17 |
| promo | `exu` | Unseen Forces Unown Collection | EX | 28 | 27 |
| promo | `pop3` | POP Series 3 | POP | 17 | 17 |
| promo | `pop4` | POP Series 4 | POP | 17 | 17 |
| promo | `pop5` | POP Series 5 | POP | 17 | 17 |
| promo | `dpp` | DP Black Star Promos | Diamond & Pearl | 56 | 56 |
| promo | `pop6` | POP Series 6 | POP | 17 | 17 |
| promo | `pop7` | POP Series 7 | POP | 17 | 17 |
| promo | `pop8` | POP Series 8 | POP | 17 | 17 |
| promo | `pop9` | POP Series 9 | POP | 17 | 17 |
| promo | `hgssp` | HGSS Black Star Promos | HeartGold & SoulSilver | 25 | 25 |
| promo | `bwp` | BW Black Star Promos | Black & White | 101 | 101 |
| promo | `xyp` | XY Black Star Promos | XY | 216 | 216 |
| promo | `xya` | Yellow A Alternate | XY | 6 | 6 |
| promo | `smp` | SM Black Star Promos | Sun & Moon | 248 | 248 |
| promo | `swshp` | SWSH Black Star Promos | Sword & Shield | 307 | 307 |
| promo | `fut2020` | Pokémon Futsal 2020 | Sword & Shield | 5 | 5 |
| promo | `svp` | SVP Black Star Promos | Scarlet & Violet | 226 | 226 |
| promo | `mep` | MEP Black Star Promos | Mega Evolution | 112 | 112 |
| mcdonalds | `2011bw` | McDonald's Collection 2011 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2012bw` | McDonald's Collection 2012 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2014xy` | McDonald's Collection 2014 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2015xy` | McDonald's Collection 2015 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2016xy` | McDonald's Collection 2016 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2017sm` | McDonald's Collection 2017 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2018sm` | McDonald's Collection 2018 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2019sm` | McDonald's Collection 2019 | McDonald's Collection | 12 | 12 |
| mcdonalds | `2021swsh` | McDonald's Collection 2021 | McDonald's Collection | 25 | 25 |
| mcdonalds | `2022swsh` | McDonald's Collection 2022 | McDonald's Collection | 15 | 15 |
| mcdonalds | `2023sv` | McDonald's Collection 2023 | McDonald's Collection | 15 | 15 |
| mcdonalds | `2024sv` | McDonald's Collection 2024 | McDonald's Collection | 15 | 15 |
| trainer-kit | `tk-ex-latia` | EX trainer Kit (Latias) | Trainer kits | 10 | 10 |
| trainer-kit | `tk-ex-latio` | EX trainer Kit (Latios) | Trainer kits | 10 | 10 |
| trainer-kit | `tk-ex-p` | EX trainer Kit 2 (Plusle) | Trainer kits | 12 | 12 |
| trainer-kit | `tk-ex-m` | EX trainer Kit 2 (Minun) | Trainer kits | 12 | 12 |
| trainer-kit | `tk-dp-l` | DP trainer Kit (Lucario) | Trainer kits | 11 | 11 |
| trainer-kit | `tk-dp-m` | DP trainer Kit (Manaphy) | Trainer kits | 12 | 12 |
| trainer-kit | `tk-hs-r` | HS trainer Kit (Raichu) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-hs-g` | HS trainer Kit (Gyarados) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-bw-e` | BW trainer Kit (Excadrill) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-bw-z` | BW trainer Kit (Zoroark) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-sy` | XY trainer Kit (Sylveon) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-n` | XY trainer Kit (Noivern) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-b` | XY trainer Kit (Bisharp) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-w` | XY trainer Kit (Wigglytuff) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-latia` | XY trainer Kit (Latias) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-latio` | XY trainer Kit (Latios) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-su` | XY trainer Kit (Suicune) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-xy-p` | XY trainer Kit (Pikachu Libre) | Trainer kits | 30 | 30 |
| trainer-kit | `tk-sm-l` | SM trainer Kit (Lycanroc) | Trainer kits | 30 | 18 |
| trainer-kit | `tk-sm-r` | SM trainer Kit (Alolan Raichu) | Trainer kits | 30 | 30 |
| trainer-kit | `mfb` | My First Battle | Scarlet & Violet | 48 | 34 |
| pocket | `A1` | Genetic Apex | Pokémon TCG Pocket | 286 | 286 |
| pocket | `P-A` | Promos-A | Pokémon TCG Pocket | 100 | 100 |
| pocket | `A1a` | Mythical Island | Pokémon TCG Pocket | 86 | 86 |
| pocket | `A2` | Space-Time Smackdown | Pokémon TCG Pocket | 207 | 207 |
| pocket | `A2a` | Triumphant Light | Pokémon TCG Pocket | 96 | 96 |
| pocket | `A2b` | Shining Revelry | Pokémon TCG Pocket | 111 | 111 |
| pocket | `A3` | Celestial Guardians | Pokémon TCG Pocket | 239 | 239 |
| pocket | `A3a` | Extradimensional Crisis | Pokémon TCG Pocket | 103 | 103 |
| pocket | `A3b` | Eevee Grove | Pokémon TCG Pocket | 107 | 107 |
| pocket | `A4` | Wisdom of Sea and Sky | Pokémon TCG Pocket | 241 | 241 |
| pocket | `A4a` | Secluded Springs | Pokémon TCG Pocket | 105 | 105 |
| pocket | `B1` | Mega Rising | Pokémon TCG Pocket | 331 | 331 |
| pocket | `B1a` | Crimson Blaze | Pokémon TCG Pocket | 103 | 103 |
| pocket | `B2` | Fantastical Parade | Pokémon TCG Pocket | 234 | 234 |
| pocket | `B2a` | Paldean Wonders | Pokémon TCG Pocket | 131 | 131 |
| other | `jumbo` | Jumbo cards | Miscellaneous | 160 | — |
| other | `sve` | Scarlet & Violet Energy | Scarlet & Violet | 24 | 24 |
| other | `mee` | Mega Evolution Energy | Mega Evolution | 16 | 16 |
</details>

🤖 Generated with [Claude Code](https://claude.com/claude-code)
