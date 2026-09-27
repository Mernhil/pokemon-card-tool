import { createBrowserClient } from "@supabase/ssr";

/** Client Component client — for use in "use client" components only. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
