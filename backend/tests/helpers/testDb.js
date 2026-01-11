const { Pool } = require("pg");

function getTestConnectionString() {
  const value = process.env.DATABASE_URL_TEST;
  if (!value) {
    throw new Error("DATABASE_URL_TEST is required for tests.");
  }
  return value;
}

function createPool() {
  return new Pool({
    connectionString: getTestConnectionString(),
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
    max: 2,
  });
}

function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function resetPublicSchema(pool) {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public';`
  );
  const tables = rows.map((row) => row.tablename).filter(Boolean);
  if (!tables.length) return;
  const tableList = tables.map(quoteIdent).join(", ");
  await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
}

async function seedCoreData(pool) {
  const adminEmail = (process.env.TEST_ADMIN_EMAIL || "").trim();
  const adminPassword = (process.env.TEST_ADMIN_PASSWORD || "").trim();
  if (!adminEmail || !adminPassword) {
    throw new Error("TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD are required for seeding.");
  }

  const bcrypt = require("bcrypt");
  const hash = await bcrypt.hash(adminPassword, 10);
  const { rows: userColumns } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users';`
  );
  const cols = new Set(userColumns.map((r) => r.column_name));
  let roleId = null;
  if (cols.has("role_id")) {
    const { rows: roleTable } = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'roles';`
    );
    if (roleTable.length) {
      const { rows: existingRole } = await pool.query(
        `SELECT id FROM roles WHERE LOWER(name) = 'owner' LIMIT 1;`
      );
      if (existingRole.length) {
        roleId = existingRole[0].id;
      } else {
        const insertRole = await pool.query(
          `INSERT INTO roles (name) VALUES ('owner') RETURNING id;`
        );
        roleId = insertRole.rows[0]?.id || null;
      }
    }
  }
  const fields = [];
  const values = [];
  const params = [];
  let idx = 1;
  const pushField = (field, value) => {
    fields.push(field);
    values.push(value);
    params.push(`$${idx++}`);
  };
  pushField("name", "Test Admin");
  pushField("email", adminEmail.toLowerCase());
  if (cols.has("password_hash")) pushField("password_hash", hash);
  if (cols.has("role_id")) {
    pushField("role_id", roleId);
  } else if (cols.has("role")) {
    pushField("role", "owner");
  }
  if (cols.has("default_landing")) pushField("default_landing", "/dashboard");

  const updates = [
    "name = EXCLUDED.name",
    cols.has("password_hash") ? "password_hash = EXCLUDED.password_hash" : null,
    cols.has("role") ? "role = EXCLUDED.role" : null,
    cols.has("default_landing") ? "default_landing = EXCLUDED.default_landing" : null,
    cols.has("updated_at") ? "updated_at = NOW()" : null,
  ].filter(Boolean);

  await pool.query(
    `
    INSERT INTO users (${fields.join(", ")})
    VALUES (${params.join(", ")})
    ON CONFLICT (email) DO UPDATE
      SET ${updates.join(", ")};
    `,
    values
  );

  const { rows: roomRows } = await pool.query(`SELECT id FROM rooms WHERE name = 'Test Room' LIMIT 1;`);
  if (!roomRows.length) {
    await pool.query(`INSERT INTO rooms (name, capacity) VALUES ('Test Room', 50);`);
  }

  const { rows: typeRows } = await pool.query(
    `SELECT id FROM club_event_types WHERE name = 'Test Event' LIMIT 1;`
  );
  if (!typeRows.length) {
    await pool.query(`INSERT INTO club_event_types (name) VALUES ('Test Event');`);
  }

  const { rows: calendarRows } = await pool.query(`SELECT id FROM calendar_settings LIMIT 1;`);
  if (!calendarRows.length) {
    await pool.query(`INSERT INTO calendar_settings (day_slot_minutes) VALUES (30);`);
  }

  const { rows: serviceRows } = await pool.query(
    `SELECT id FROM restaurant_services WHERE name = 'Test Dinner' LIMIT 1;`
  );
  if (!serviceRows.length) {
    await pool.query(
      `
      INSERT INTO restaurant_services
        (name, day_of_week, start_time, end_time, slot_minutes, turn_minutes, max_covers_per_slot, max_online_covers, active)
      VALUES ('Test Dinner', 5, '17:00', '21:00', 30, 90, 40, 20, TRUE);
      `
    );
  }
}

module.exports = {
  createPool,
  resetPublicSchema,
  seedCoreData,
};
