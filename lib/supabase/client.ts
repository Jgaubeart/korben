import { createClient } from "@supabase/supabase-js";

export function createBrowserSupabaseClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://gojgwlnoefbpfvuffxof.supabase.co";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_7HDk7a6zY2DUVA3MiyvG5g_0xeQ3xVr";

  return createClient(url, publishableKey);
}
