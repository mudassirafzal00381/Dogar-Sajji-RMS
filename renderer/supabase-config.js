// ══════════════════════════════════════════════════════════════════════════════
// ⚡ DOGAR SAJJI — SUPABASE CLOUD DATABASE CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════
// To synchronize data live across ALL PC & Mobile devices:
// 1. Create a free project at https://supabase.com
// 2. Paste the SQL code from `supabase_schema.sql` in Supabase SQL Editor and click RUN
// 3. Paste your Supabase Project URL and Anon API Key below (or configure via POS app "☁️ Cloud Sync" button):

window.SUPABASE_URL = localStorage.getItem('dogar_supabase_url') || "";
window.SUPABASE_KEY = localStorage.getItem('dogar_supabase_key') || "";
