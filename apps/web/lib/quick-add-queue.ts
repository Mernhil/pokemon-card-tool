/**
 * Serialises and coalesces rapid +1/-1 clicks, per variant, and reports when
 * a burst has settled. Framework-free so the timing rules stay in one place.
 *
 * - Clicks accumulate into a net delta, sent `debounceMs` after the last click
 *   (or `maxWaitMs` after the first, whichever comes first) so a burst becomes
 *   one request. Only one request per variant is ever in
 *   flight; clicks that arrive meanwhile go out as the next one.
 * - If a request fails, everything not yet confirmed for that variant (the
 *   failed delta plus anything queued behind it) is dropped and reported to
 *   `onFail` so the caller can roll its optimistic state back.
 * - `onSettle` runs once, `settleMs` after the last activity, and only if a
 *   request was actually sent and nothing is pending any more.
 */
export interface QuickAddQueueOptions {
  send: (variantId: string, delta: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  onFail: (variantId: string, lostDelta: number, error: string) => void;
  onSettle: () => void | Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
  settleMs?: number;
}

interface Entry {
  pending: number;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** When the oldest unsent click happened. */
  since: number;
}

export class QuickAddQueue {
  private entries = new Map<string, Entry>();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private closing = false;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly settleMs: number;

  constructor(private readonly opts: QuickAddQueueOptions) {
    this.debounceMs = opts.debounceMs ?? 150;
    this.maxWaitMs = opts.maxWaitMs ?? 500;
    this.settleMs = opts.settleMs ?? 800;
  }

  push(variantId: string, delta: number): void {
    if (this.closing || delta === 0) return;
    const e = this.entry(variantId);
    if (e.pending === 0 && !e.timer) e.since = Date.now();
    e.pending += delta;
    if (!e.inFlight) {
      if (e.timer) clearTimeout(e.timer);
      const wait = Math.max(0, Math.min(this.debounceMs, e.since + this.maxWaitMs - Date.now()));
      e.timer = setTimeout(() => void this.flush(variantId), wait);
    }
    this.armSettle();
  }

  /** True while the variant has unsent or unconfirmed clicks. */
  isBusy(variantId: string): boolean {
    const e = this.entries.get(variantId);
    return !!e && (e.inFlight || e.pending !== 0 || e.timer !== null);
  }

  private get busy(): boolean {
    for (const id of this.entries.keys()) if (this.isBusy(id)) return true;
    return false;
  }

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) this.entries.set(id, (e = { pending: 0, inFlight: false, timer: null, since: 0 }));
    return e;
  }

  private async flush(variantId: string): Promise<void> {
    const e = this.entry(variantId);
    e.timer = null;
    if (e.inFlight) return;
    const delta = e.pending;
    e.pending = 0;
    if (delta === 0) {
      this.armSettle();
      return;
    }
    e.inFlight = true;
    this.dirty = true;
    let error: string | null = null;
    try {
      const res = await this.opts.send(variantId, delta);
      if (!res.ok) error = res.error;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    e.inFlight = false;
    if (error !== null) {
      const lost = delta + e.pending;
      e.pending = 0;
      if (!this.closing) this.opts.onFail(variantId, lost, error);
    } else if (e.pending !== 0) {
      e.since = Date.now();
      e.timer = setTimeout(() => void this.flush(variantId), this.debounceMs);
    }
    this.armSettle();
  }

  private armSettle(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(
      () => {
        this.settleTimer = null;
        // Something is still going out: its completion re-arms this.
        if (this.busy || !this.dirty) return;
        this.dirty = false;
        void this.opts.onSettle();
      },
      this.closing ? 0 : this.settleMs,
    );
  }

  /**
   * Unmounting: stop taking clicks, send what's queued so nothing is lost,
   * and settle (snapshot + refresh) as soon as it lands.
   */
  dispose(): void {
    this.closing = true;
    for (const [id, e] of this.entries) {
      if (e.timer) {
        clearTimeout(e.timer);
        void this.flush(id);
      }
    }
    this.armSettle();
  }
}
