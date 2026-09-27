import { createBrowserClient } from "@supabase/ssr";

// For Client Components: cookie-backed session, safe to call anywhere in the browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
