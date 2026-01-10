const { pool } = require("../db");

let ensured = false;

async function ensureRestaurantServiceBookingLimitColumn(db = pool) {
  if (ensured) return;
  await db.query(
    "ALTER TABLE restaurant_services ADD COLUMN IF NOT EXISTS max_online_party_size INTEGER;"
  );
  ensured = true;
}

module.exports = {
  ensureRestaurantServiceBookingLimitColumn,
};
