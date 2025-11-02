// ======================================================
// 🧩 Bulk Upload Routes — Menus, Choices, and Links
// ======================================================
const express = require('express');
const router = express.Router();
const { pool } = require('../../db'); // ✅ adjust if db.js path differs

// ======================================================
// 🔹 Render Bulk Upload Page
// ======================================================
router.get('/', async (req, res) => {
  try {
    const [categoriesRes, menusRes, choicesRes] = await Promise.all([
      pool.query('SELECT id, name FROM menu_categories ORDER BY name ASC'),
      pool.query('SELECT id, name FROM menus ORDER BY id ASC'),
      pool.query('SELECT id, name FROM menu_choices ORDER BY id ASC')
    ]);

    const categories = categoriesRes.rows;
    const menus = menusRes.rows;
    const choices = choicesRes.rows;

    res.locals.pageJs = ['/js/settings/menu-bulk.js'];
    res.render('settings/menu-bulk', {
      layout: 'layouts/settings',
      title: 'Settings — Bulk Upload',
      activeTab: 'menu-bulk',
      categories,
      menus,
      choices,
      user: req.session.user || null
    });
  } catch (err) {
    console.error('❌ Error loading bulk upload page:', err);
    res.status(500).send('Error loading bulk upload page');
  }
});


// ======================================================
// 🔸 API — Bulk insert Menus, Choices, or Links
// ======================================================
router.post('/api', async (req, res) => {
  const { type, category_id, items } = req.body || {};

  // ✅ Validate type
  if (!['menu', 'choice', 'link'].includes(type))
    return res.status(400).json({ success: false, error: 'Invalid upload type' });

  // ✅ Validate array
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ success: false, error: 'No items provided' });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ======================================================
    // 🧱 1️⃣ MENUS
    // ======================================================
    if (type === 'menu') {
      for (const item of items) {
        const { name, price, description } = item;
        if (!name) continue;

        await client.query(
          `INSERT INTO menus (name, price, description, category_id)
           VALUES ($1, $2, $3, $4)`,
          [name.trim(), price || null, description || null, category_id || null]
        );
      }
    }

    // ======================================================
    // 🧱 2️⃣ CHOICES
    // ======================================================
    else if (type === 'choice') {
      for (const item of items) {
        const { name } = item;
        if (!name) continue;

        await client.query(
          `INSERT INTO menu_choices (name) VALUES ($1)`,
          [name.trim()]
        );
      }
    }

    // ======================================================
    // 🧱 3️⃣ LINKS (menu ↔ choice)
    // ======================================================
    else if (type === 'link') {
      for (const item of items) {
        const { menu_id, choice_id } = item;
        if (!menu_id || !choice_id) continue;

        await client.query(
          `INSERT INTO menu_choice_links (menu_id, choice_id)
           VALUES ($1, $2)`,
          [menu_id, choice_id]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Bulk insert error:', err);
    res.status(500).json({ success: false, error: 'Failed to process bulk upload' });
  } finally {
    client.release();
  }
});

module.exports = router;
