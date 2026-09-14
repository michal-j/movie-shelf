(() => {
  "use strict";
  const SUPABASE_URL = "https://ybfxyrzkdexjjptuzzuy.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_qI5PQ_DO9esWd9FPAFEbtQ_bcJkmUIN";
  window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
