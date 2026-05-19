/* =============================================================
   BuyForMe — supabase.js
   Initializes Supabase client
   Import this in every page that needs Supabase
   ============================================================= */

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm";

const SUPABASE_URL = "https://jbdfzrgxukwyepwqutdt.supabase.co";
const SUPABASE_KEY = "sb_publishable_dkEYDXibAaRL0Lht6D3y6g_Tz9lbxTu";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "bfm-auth",
  },
});
