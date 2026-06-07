/* =============================================================
   BuyForMe — supabase.js
   Initializes Supabase client
   Import this in every page that needs Supabase
   ============================================================= */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./runtime-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "bfm-auth",
  },
});
