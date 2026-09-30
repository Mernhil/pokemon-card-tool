/**
 * URL segment for a printing. The printed number keeps its "/total" part
 * (as "-total": "002-30") because one set can hold the same number twice —
 * the 30th Celebration's "002/128" and its Classic Collection "002/30" — and
 * a bare "002" would open whichever the database returned first.
 */
export function cardSlug(collectorNumber: string): string {
  return collectorNumber.replace("/", "-");
}

/**
 * The collector numbers a URL segment may refer to, most specific first:
 * the exact number, the "-total" form turned back into "/total", and (for old
 * links and bare numbers) anything starting with "slug/".
 */
export function collectorNumberCandidates(slug: string): string[] {
  const i = slug.lastIndexOf("-");
  return i > 0 ? [slug, `${slug.slice(0, i)}/${slug.slice(i + 1)}`] : [slug];
}
