/** Small circular progress (owned / total), gold on a recessive track. */
export function CompletionRing({
  owned,
  total,
  size = 40,
}: {
  owned: number;
  total: number;
  size?: number;
}) {
  const pct = total > 0 ? Math.min(1, owned / total) : 0;
  const stroke = Math.max(3, size / 10);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      title={`${owned} of ${total} cards (${Math.round(pct * 100)}%)`}
      role="img"
      aria-label={`${owned} of ${total} cards owned`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-neutral-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="stroke-accent transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <span className="absolute text-[10px] font-semibold tabular-nums text-neutral-700">
        {Math.round(pct * 100)}%
      </span>
    </span>
  );
}
