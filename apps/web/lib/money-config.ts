import { getSettingsCached, loadFxRates } from "@tcg-vault/db";
import { configureMoney, type MoneyDisplay } from "../components/money";

/**
 * The display currency (Settings) and its current rate per EUR, applied to
 * this server runtime's formatEur(). Pages that show money await this first;
 * the root layout passes the result to the browser via <MoneyConfig>.
 */
export async function loadMoneyDisplay(): Promise<MoneyDisplay> {
  const [settings, rates] = await Promise.all([getSettingsCached(), loadFxRates()]);
  const perEur = rates.perEur[settings.displayCurrency];
  const display = perEur
    ? { currency: settings.displayCurrency, perEur }
    : { currency: "EUR", perEur: 1 };
  configureMoney(display);
  return display;
}
