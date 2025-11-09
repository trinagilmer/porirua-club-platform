// backend/utils/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

/**
 * 🧭 Supabase Client
 * Centralised instance + startup self-test.
 * Safe to import anywhere — only logs connection results.
 */

// Load credentials from .env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "⚠️  Missing Supabase credentials. Add SUPABASE_URL and SUPABASE_KEY to your .env"
  );
}

// Create shared client
export const supabase = createClient(supabaseUrl, supabaseKey);

// Optional self-test: pings Supabase REST API for quick validation
export async function testSupabaseConnection() {
  if (!supabaseUrl || !supabaseKey) {
    console.warn("⚠️  Skipping Supabase connection test — credentials missing.");
    return;
  }

  try {
    const { error } = await supabase.from("_auth").select("id").limit(1);
    if (error && !error.message.includes("permission")) {
      console.error("❌ Supabase connection failed:", error.message);
    } else {
      console.log("✅ Connected to Supabase API:", supabaseUrl);
    }
  } catch (err) {
    console.error("💥 Supabase test request failed:", err.message);
  }
}

