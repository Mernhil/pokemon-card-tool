/**
 * Placeholder grid shown while a page's data loads (used by loading.tsx files).
 *
 * Don't add a loading.tsx above a page that has a server-action form (card
 * page, collection, sync, binders): after the action, revalidation re-suspends
 * that boundary, the form unmounts mid-request and the action is aborted —
 * the Sync button just spun forever when there was a root app/loading.tsx.
 */
export function SkeletonPage({
  tiles = 12,
  cardShaped = true,
}: {
  tiles?: number;
  cardShaped?: boolean;
}) {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="skeleton mb-2 h-3 w-24" />
      <div className="skeleton mb-8 h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: tiles }, (_, i) => (
          <div key={i} className={`skeleton ${cardShaped ? "aspect-[5/7]" : "h-28"}`} />
        ))}
      </div>
    </div>
  );
}
