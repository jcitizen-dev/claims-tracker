// Supabase connection details.
//
// Both of these values are meant to be public -- the anon key is a
// "publishable" key. It grants no access on its own: every read and write is
// gated behind a signed-in user by the Row Level Security policy in
// supabase-setup.sql.
//
// Find these in your Supabase project under Settings -> API.
window.CLAIMS_CONFIG = {
  SUPABASE_URL: "PASTE_PROJECT_URL_HERE",
  SUPABASE_ANON_KEY: "PASTE_ANON_PUBLIC_KEY_HERE",
};
