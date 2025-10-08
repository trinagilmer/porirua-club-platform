// /backend/services/messageMatcher.js
const { pool } = require("../db");

async function matchMessages() {
  console.log("[Auto-Linker] Starting message matching process...");
  const client = await pool.connect();

  const matchContactsSQL = `
    UPDATE public.messages AS m
    SET related_contact = c.id
    FROM public.contacts AS c
    WHERE m.from_email = c.email
      AND m.related_contact IS NULL;
  `;

  const matchFunctionsSQL = `
    UPDATE public.messages AS m
    SET related_function = COALESCE(fc.function_id, f.id)
    FROM public.contacts AS c
    LEFT JOIN public.function_contacts AS fc ON c.id = fc.contact_id
    LEFT JOIN public.functions AS f ON c.id = f.contact_id
    WHERE m.from_email = c.email
      AND m.related_function IS NULL;
  `;

  const insertLeadsSQL = `
    INSERT INTO public.leads (email, message_id, created_at)
    SELECT m.from_email, m.id, NOW()
    FROM public.messages m
    LEFT JOIN public.contacts c ON m.from_email = c.email
    WHERE c.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.leads l WHERE l.email = m.from_email
      );
  `;

  try {
    await client.query("BEGIN");

    // Step 1 – Match contacts
    await client.query(matchContactsSQL);
    console.log("[Auto-Linker] ✅ Contacts matched");

    // Step 2 – Match functions
    await client.query(matchFunctionsSQL);
    console.log("[Auto-Linker] ✅ Functions matched");

    // Step 3 – Insert leads
    try {
      await client.query(insertLeadsSQL);
      console.log("[Auto-Linker] ✅ Leads inserted (if any)");
    } catch (err) {
      if (err.message.includes("relation") && err.message.includes("leads")) {
        console.warn("[Auto-Linker] ⚠️ Leads table missing — skipping lead insertion.");
      } else {
        throw err;
      }
    }

    await client.query("COMMIT");
    console.log("[Auto-Linker] ✅ Completed successfully");
    return { status: "success" };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Auto-Linker] ❌ Error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { matchMessages };


