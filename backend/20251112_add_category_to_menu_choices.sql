ALTER TABLE menu_choices
  ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES menu_categories(id);

CREATE INDEX IF NOT EXISTS menu_choices_category_idx
  ON menu_choices (category_id);

-- Backfill: pick the first linked menu's category when available
WITH choice_primary_category AS (
  SELECT
    l.choice_id,
    MIN(m.category_id) AS category_id
  FROM menu_choice_links l
  JOIN menus m ON m.id = l.menu_id
  WHERE m.category_id IS NOT NULL
  GROUP BY l.choice_id
)
UPDATE menu_choices mc
SET category_id = cpc.category_id
FROM choice_primary_category cpc
WHERE mc.id = cpc.choice_id
  AND mc.category_id IS DISTINCT FROM cpc.category_id;
