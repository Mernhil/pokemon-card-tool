import { prisma } from "./client";
import { latestValuations } from "./valuations";

export type AlertDirection = "ABOVE" | "BELOW";

/** Pure: has the value crossed the alert's threshold? (At the threshold counts.) */
export function alertCrossed(
  direction: string,
  thresholdEur: number,
  valueEur: number | null | undefined,
): boolean {
  if (valueEur === null || valueEur === undefined) return false;
  return direction === "ABOVE" ? valueEur >= thresholdEur : valueEur <= thresholdEur;
}

export async function createAlert(input: {
  variantId: string;
  direction: AlertDirection;
  thresholdEur: number;
}) {
  if (input.direction !== "ABOVE" && input.direction !== "BELOW") {
    throw new Error("Direction must be ABOVE or BELOW.");
  }
  if (!Number.isInteger(input.thresholdEur) || input.thresholdEur <= 0) {
    throw new Error("The price must be more than zero.");
  }
  return prisma.priceAlert.create({ data: input });
}

export async function deleteAlert(id: string): Promise<void> {
  await prisma.priceAlert.deleteMany({ where: { id } });
}

/**
 * Marks every untriggered alert whose card's latest value has crossed its
 * threshold. Returns how many fired this time. Called after each valuation run.
 */
export async function evaluateAlerts(now = new Date()): Promise<number> {
  const pending = await prisma.priceAlert.findMany({ where: { triggeredAt: null } });
  if (pending.length === 0) return 0;
  const values = await latestValuations([...new Set(pending.map((a) => a.variantId))]);
  let fired = 0;
  for (const alert of pending) {
    const value = values.get(alert.variantId)?.valueEur;
    if (alertCrossed(alert.direction, alert.thresholdEur, value)) {
      await prisma.priceAlert.update({
        where: { id: alert.id },
        data: { triggeredAt: now, triggeredValueEur: value },
      });
      fired++;
    }
  }
  return fired;
}

export interface AlertRow {
  id: string;
  direction: AlertDirection;
  thresholdEur: number;
  triggeredAt: Date | null;
  triggeredValueEur: number | null;
  currentValueEur: number | null;
  variantId: string;
  finish: string;
  edition: string;
  name: string;
  number: string;
  setCode: string;
  setName: string;
  gameSlug: string;
}

/** Alerts with their card, triggered ones first; optionally only for some variants. */
export async function listAlerts(variantIds?: string[]): Promise<AlertRow[]> {
  const alerts = await prisma.priceAlert.findMany({
    where: variantIds ? { variantId: { in: variantIds } } : {},
    orderBy: { createdAt: "desc" },
    include: {
      variant: {
        include: { printing: { include: { card: true, set: { include: { game: true } } } } },
      },
    },
  });
  const values = await latestValuations([...new Set(alerts.map((a) => a.variantId))]);
  const rows = alerts.map((a): AlertRow => {
    const p = a.variant.printing;
    return {
      id: a.id,
      direction: a.direction as AlertDirection,
      thresholdEur: a.thresholdEur,
      triggeredAt: a.triggeredAt,
      triggeredValueEur: a.triggeredValueEur,
      currentValueEur: values.get(a.variantId)?.valueEur ?? null,
      variantId: a.variantId,
      finish: a.variant.finish,
      edition: a.variant.edition,
      name: p.card.name,
      number: p.collectorNumber,
      setCode: p.set.code,
      setName: p.set.name,
      gameSlug: p.set.game.slug,
    };
  });
  return rows.sort((a, b) => Number(b.triggeredAt !== null) - Number(a.triggeredAt !== null));
}
