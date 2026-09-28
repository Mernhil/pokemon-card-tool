// Cookie names shared by server components (which read them to render the
// right state up front) and client components (which write them). Kept out
// of the "use client" files on purpose: a server component importing a
// constant from a client module gets a client-reference stub, not the string.
export const SIDEBAR_COOKIE = "sidebar";
export const COLLECTION_VIEW_COOKIE = "collectionView";
