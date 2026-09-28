# TCG Vault — setup guide

Everything you (a person) have to do by hand, in order, so you can redo it
on a new machine. The app does the rest by itself in the background.

> **What was and wasn't checked.** The steps below were written from each
> provider's documentation and help pages as found by web search in
> September 2026. The provider websites themselves (TCGdex, CardTrader,
> eBay, Cardmarket) **could not be opened** from the environment this was
> written in, so button names and page layouts may differ slightly. Where
> a step comes from memory rather than a source, it says so. If something
> doesn't match, the "Test connection" button in Settings tells you
> whether the result works.

## Contents

1. [Overview: what needs you, and what it costs](#1-overview)
2. [Run it locally (developers)](#2-run-it-locally)
3. [CardTrader API token](#3-cardtrader-api-token)
4. [eBay developer keys](#4-ebay-developer-keys)
5. [Cardmarket](#5-cardmarket)
6. [Enter the keys and test them](#6-enter-the-keys-and-test-them)
7. [Windows installer and CI: where keys live](#7-windows-installer-and-ci)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

| What                  | Needed for                                                                             | Cost                              | Waiting time                                                                          | Required?                              |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------- |
| Nothing               | Card catalog (all Pokémon sets), card images, Cardmarket + TCGplayer prices via TCGdex | Free                              | None                                                                                  | —                                      |
| CardTrader API token  | CardTrader lowest listings per condition                                               | Free (needs a CardTrader account) | None expected                                                                         | Optional                               |
| eBay developer keyset | eBay asking prices (active listings)                                                   | Free                              | Account approval can take up to ~1 business day; keyset stays disabled until step 4.6 | Optional                               |
| Cardmarket API        | —                                                                                      | —                                 | **Not available**: Cardmarket isn't accepting new API applications                    | No — Cardmarket prices come via TCGdex |

Without any keys the app still works: the CardTrader and eBay panels on a
card page just say **"API key not set"**.

**About the kinds of prices** — the app never presents an asking price as a
sale:

- **Cardmarket (via TCGdex)**: Trend, Market avg (Cardmarket's average _sale_
  price), Lowest listing. EUR, updated about daily.
- **TCGplayer (via TCGdex)**: Market avg (based on recent sales), Asking
  (median listing), Lowest listing. USD.
- **CardTrader**: Lowest listing per condition. CardTrader's API has no
  sold-price history.
- **eBay**: Asking (median of active listings) and Lowest listing, after
  filtering out lots, proxies, graded slabs, sealed product, other languages
  and other cards. eBay's sold-price API (Marketplace Insights) is
  restricted and not open to new developers, and scraping sold listings is
  against eBay's terms — so there are no eBay sold prices.

---

## 2. Run it locally

For development on your own machine (Windows, macOS or Linux). End users of
the installer skip this whole section.

1. Install **Node.js 20 or newer** (https://nodejs.org → "LTS") and
   **pnpm 9**: open a terminal and run `npm install -g pnpm@9.12.0`.
2. Get the code and install dependencies:
   ```bash
   git clone https://github.com/Mernhil/pokemon-card-tool.git
   cd pokemon-card-tool
   pnpm install
   ```
3. Create your local settings file: copy `.env.example` to `.env` (same
   folder). The defaults work as they are:
   - `DATABASE_URL="file:./local.db"` — the SQLite file (created for you).
   - `MEDIA_DIR="./.media"` — set logos, your own photos.
   - `TCG_VAULT_DATA_DIR=""` — leave empty: the image cache and
     `secrets.json` then go to `~/.tcg-vault` (outside the repo).
   - Don't put API keys in `.env` unless you want to (see step 6); the
     Settings page is the normal place. `.env` is git-ignored either way.
4. Create the database and its tables:
   ```bash
   pnpm db:generate
   pnpm db:migrate
   pnpm db:seed
   ```
   `db:migrate` should end with "All migrations have been successfully
   applied." (If it says **"database is locked"**, stop `pnpm dev` first.)
5. Start the app: `pnpm dev`, then open http://localhost:3000.
6. **First catalog sync** — nothing to do: about 10 seconds after start
   the app begins syncing every Pokémon set in the background, newest
   first. Watch it in the sidebar ("Syncing catalog 12/170") or on the
   **Sync** page. Card data only; images download when you first look at a
   card. To run it from the terminal instead:
   ```bash
   pnpm db:sync-catalog -- --all          # everything (what the app does)
   pnpm db:sync-catalog -- --sets sv06.5  # one set, now
   pnpm db:sync-catalog -- --status       # progress and failures
   ```
7. **Test data without internet or keys** (optional):
   `pnpm db:seed-demo` adds one sample card in a set called
   "DEMO — sample prices (not real)" with two months of made-up prices from
   all four providers. Open http://localhost:3000/pokemon/demo/001. Remove
   it with `pnpm db:seed-demo -- --remove`.
8. Checks before committing: `pnpm typecheck`, `pnpm lint`, `pnpm test`.
   Tests never use the network.

**How to confirm it worked**: the Sync page shows "N of M sets synced", and
opening any card shows its Prices section with Cardmarket and TCGplayer
panels filled in (after the background refresh, the "Updating…" label
disappears).

---

## 3. CardTrader API token

**What / why**: a personal token that lets the app read CardTrader's
marketplace listings. **Cost**: free. **Wait**: none expected. You need a
CardTrader account.

1. Open https://www.cardtrader.com and click **Sign up** (top right) if you
   don't have an account; confirm your email.
2. Log in, open your profile menu (top right) → **Settings**.
3. Find the **API** section (CardTrader's docs say the token is "in your
   profile settings"; from memory the page is
   https://www.cardtrader.com/en/full_api_app — _not verified_).
4. If there's no token yet, click the button to **generate** one (it may
   ask you to name your "app": use `TCG Vault`).
5. **Copy the token** — a long string. Treat it like a password: it can act
   on your CardTrader account.
6. Paste it in the app: **Settings → CardTrader → API token → Save** (see
   step 6 below).

**Confirm**: Settings → CardTrader → **Test connection** says
"Connected as …".

**Common problems**

- _"invalid or expired credentials (HTTP 401)"_ — copied only part of the
  token, or it was regenerated on the website. Copy it again and save.
- _"access denied (HTTP 403)"_ — the token doesn't have API access, or your
  network/firewall blocks `api.cardtrader.com`.
- _"No match found"_ on a card — the app couldn't find that card on
  CardTrader by set name + card number. Use **Wrong match?** on the card
  page and paste the number from the card's CardTrader URL.
- _Uncertain match_ warning — matched by number but the name differs
  (e.g. an alt-art version). Check it, and fix it with **Wrong match?** if
  needed; until then it's not used for your collection value.

---

## 4. eBay developer keys

**What / why**: a Client ID + Client Secret so the app can search eBay's
active listings through the official Browse API. **Cost**: free.
**Wait**: registration can take up to about one business day to be
approved (_from memory, not verified_); the production keyset stays
**disabled** until you complete step 4.6. Default limit: 5,000 calls per
day — the app uses at most ~150 an hour.

**Sandbox vs production**: _sandbox_ keys only see eBay's fake test data —
useless for prices. You want **production** keys.

1. Open https://developer.ebay.com and click **Register** / **Join**
   (top right). Sign in with your normal eBay account or create one, fill in
   the form, accept the API License Agreement, and confirm your email.
2. Once approved, sign in to developer.ebay.com, open your account menu →
   **Application Keys** (https://developer.ebay.com/my/keys).
3. Enter an **application title**, e.g. `TCG Vault`.
4. In the **Production** column, click **Create a keyset**.
5. You'll likely see **"Your keyset is currently disabled"**. Click the
   link in that message — it opens the **Marketplace Account Deletion**
   page.
6. On that page, turn on the toggle **"Not persisting eBay data"** → click
   **Confirm** in the pop-up → choose the exemption reason that says you
   don't store eBay user data → **Submit**.
   _Why this is accurate for TCG Vault_: the app stores only aggregate
   prices (median / lowest of a search), never any eBay seller or buyer
   data.
7. Back on **Application Keys**, the production keyset now shows:
   - **App ID (Client ID)** → copy it.
   - **Cert ID (Client Secret)** → click to reveal, copy it.
   - _Dev ID_ — not needed.
8. Paste them in the app: **Settings → eBay → Client ID (App ID)** and
   **Client Secret (Cert ID)**, each with **Save**. Set **Keys are for** to
   **Production**, and **Marketplace** to the eBay site you want prices
   from (e.g. `EBAY_IT`, `EBAY_DE`, `EBAY_GB`, `EBAY_US`).

The app requests an _application_ token by itself (OAuth "client
credentials", scope `https://api.ebay.com/oauth/api_scope`) and renews it
every ~2 hours. You never need a "user token" or to "Sign in with eBay".

**Confirm**: Settings → eBay → **Test connection** says "Got an application
token (production, EBAY_…)". Then open a card you own: the eBay panel fills
in after a minute, showing "Asking · N listings".

**Common problems**

- _"eBay rejected the Client ID / Secret"_ / _"invalid_client"_ — Secret and
  ID swapped, a space copied along, sandbox keys used with "Production" (or
  the other way round), or the keyset is still disabled (redo step 4.6).
- _"access denied (HTTP 403)"_ when searching — the keyset isn't activated
  yet, or your app lacks the Browse API scope (new production keysets have
  it by default).
- _Rate limited_ — the 5,000 calls/day limit was hit (e.g. several installs
  sharing one keyset). The app waits and retries; eBay offers a free
  "Application Growth Check" to raise the limit.
- _Few or no listings_ — normal for cheap cards on smaller eBay sites; the
  panel shows "No data yet". Try `EBAY_US` or fix the search with **Wrong
  match?** on the card page.

---

## 5. Cardmarket

**You can't get Cardmarket API access** as a hobby user: Cardmarket's help
page says it is currently not accepting applications. Nothing to do:

- The app already shows **Cardmarket prices relayed by TCGdex** (trend,
  average sale, lowest listing; EUR; about daily), and links each card to
  its Cardmarket product. No key needed.
- Cardmarket also publishes a daily **price guide** download for logged-in
  users (cardmarket.com → Pokémon → Data → Price Guide). The app has a
  documented stub for importing it
  (`packages/sources/src/pricing/cardmarket-price-guide.ts`) but doesn't
  use it — its download URLs and terms couldn't be verified.

---

## 6. Enter the keys and test them

1. Open the app → sidebar → **Settings**.
2. Under **Price sources**, for each provider:
   - Paste the key into its field and click **Save**. The field empties and
     shows `Saved (••••••abcd)` — the last 4 characters, so you can tell
     which key it is. The full key is never shown again.
   - Click **Test connection**. Green = working. Red shows the reason (see
     the troubleshooting lists above).
   - Uncheck **Enabled** to stop using a provider without deleting its key.
3. **Display → Currency**: the currency every price is shown in
   (converted prices are marked "≈"). Rates come from the European Central
   Bank daily; until the first download, built-in approximate rates are used.
4. **Refresh cadence**: collection prices every 24 h by default; a card page
   older than 24 h refreshes when you open it; set data is re-synced every
   30 days.
5. **Refresh prices** (top of the Price sources section) refreshes your
   whole collection now.

**Where the keys are stored**: in `secrets.json` in the app data folder,
readable only by your user:

- Windows installer: `%APPDATA%\app.tcgvault.desktop\secrets.json`
- Development: `~/.tcg-vault/secrets.json` (or `TCG_VAULT_DATA_DIR`)

They're never stored in the database, the repository or the installer,
and never written to logs. Alternatively (development/CI) set the
environment variables `CARDTRADER_API_TOKEN`, `EBAY_CLIENT_ID`,
`EBAY_CLIENT_SECRET`; Settings then shows "from an environment variable".

---

## 7. Windows installer and CI

**No API keys are involved in building the installer.** Keys are entered by
each user at runtime in Settings and live on their own computer, so:

- Don't add CardTrader/eBay keys to GitHub **Secrets**, the workflow, or
  `.env` files that get committed. Nothing in the build reads them.
- The only build secrets are the existing updater-signing ones
  (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) —
  see `apps/desktop/README.md`. Nothing new is needed for this release.
- Release as before: bump the version in
  `apps/desktop/src-tauri/tauri.conf.json` (+ `Cargo.toml`, `Cargo.lock`,
  `package.json`), tag `desktop-vX.Y.Z`, push the tag.
- On first launch after updating, the app applies the new database
  migrations by itself (your collection and binders are kept), then starts
  the catalog sync and price refresh in the background.
- The desktop shell now passes `TCG_VAULT_DATA_DIR` (the per-user app data
  folder) to the local server; the image cache (default max 500 MB) lives
  in `image-cache\` there.

---

## 8. Troubleshooting

- **The sidebar says "N sets failed"** — click **Retry**. Failed sets are
  retried automatically on every later run anyway; the Sync page lists each
  one's error. If _everything_ fails, the app can't reach `api.tcgdex.net`
  (offline, firewall, proxy); it tries again after 5 minutes, then less
  often.
- **Card images show "Image unavailable"** — the image couldn't be
  downloaded right now (offline, or not published by TCGdex yet). It's tried
  again the next time you open the card; failures are never cached.
- **A price panel says "Rate limited"** — the provider asked the app to slow
  down; it waits as long as the provider says and continues by itself.
- **"Couldn't fetch prices"** on a panel — the last attempt failed; the
  message is the provider's error. Settings shows each provider's last
  success and last error.
- **Logs** — installer: `%APPDATA%\app.tcgvault.desktop\server.log`
  (recreated on each launch); development: the `pnpm dev` terminal.
- **Start over on a fresh machine**: install (or section 2), then section 6.
  Your collection lives in `local.db` in the same app data folder — copy
  that file (with the app closed) to move it.
