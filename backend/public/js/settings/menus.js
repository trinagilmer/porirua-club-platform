// public/js/settings/menus.js
document.addEventListener("DOMContentLoaded", () => {
  console.log("📄 menus.js loaded");

  // ✅ Detect the page
  const page = document.querySelector("main.menus-page");
  if (!page) return;

  // 🧭 Context data (if passed via EJS)
  const { categories = [], units = [] } = window.menuBuilderData || {};

  console.log("🧠 Categories loaded:", categories.length);
  console.log("🧠 Units loaded:", units.length);

  // 🪄 Optional: highlight active category block
  page.addEventListener("click", (e) => {
    const block = e.target.closest(".menu-category-block");
    if (!block) return;

    document
      .querySelectorAll(".menu-category-block.active")
      .forEach((b) => b.classList.remove("active"));
    block.classList.add("active");
  });

  // 🧩 Nothing else needed — the drawer logic is handled in menuDrawer.js
});
// ======================
// 🔸 Sales Categories API
// ======================

// GET all categories
router.get('/categories', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name FROM public.menu_categories ORDER BY name ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /settings/menus/categories error:', err);
    res.status(500).json({ success: false, error: 'Failed to load categories' });
  }
});

// POST create category
router.post('/categories', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO public.menu_categories (name) VALUES ($1) RETURNING id, name`,
      [name.trim()]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('POST /settings/menus/categories error:', err);
    res.status(500).json({ success: false, error: 'Failed to create category' });
  }
});

// PATCH rename category
router.patch('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name } = req.body || {};
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    const { rows } = await pool.query(
      `UPDATE public.menu_categories SET name = $1 WHERE id = $2 RETURNING id, name`,
      [name.trim(), id]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('PATCH /settings/menus/categories/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to update category' });
  }
});

// DELETE category (optional; safe if no FKs block it)
router.delete('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    await pool.query(`DELETE FROM public.menu_categories WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /settings/menus/categories/:id error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete category' });
  }
});

