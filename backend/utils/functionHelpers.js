// backend/utils/functionHelpers.js
const { pool } = require('../db');

/**
 * Fetch all essential details for a given function (by UUID)
 * including contacts, rooms, and event types.
 */
async function getFunctionDetails(functionId) {
  try {
    // 🧩 Main function details
    const fnResult = await pool.query(
      'SELECT * FROM functions WHERE id = $1 LIMIT 1',
      [functionId]
    );
    const fn = fnResult.rows[0];
    if (!fn) throw new Error('Function not found');

    // 🧩 Linked contacts
    const contactsResult = await pool.query(
      `SELECT c.*
       FROM function_contacts fc
       JOIN contacts c ON fc.contact_id = c.id
       WHERE fc.function_id = $1`,
      [functionId]
    );

    // 🧩 Linked rooms
    const roomsResult = await pool.query(
      `SELECT r.*
       FROM function_facilities ff
       JOIN rooms r ON ff.room_id = r.id
       WHERE ff.function_id = $1`,
      [functionId]
    );

    // 🧩 Event types
    const eventTypesResult = await pool.query(
      `SELECT cet.*
       FROM club_event_types cet
       JOIN functions f ON f.event_type_id = cet.id
       WHERE f.id = $1`,
      [functionId]
    );

    // 🧱 Build full result object
    return {
      ...fn,
      contacts: contactsResult.rows,
      rooms: roomsResult.rows,
      eventTypes: eventTypesResult.rows,
    };
  } catch (err) {
    console.error('Error in getFunctionDetails():', err);
    throw err;
  }
}

module.exports = { getFunctionDetails };

