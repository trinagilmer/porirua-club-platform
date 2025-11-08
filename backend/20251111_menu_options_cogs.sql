ALTER TABLE menu_options
  ADD COLUMN IF NOT EXISTS cogs_percent NUMERIC(6,2) DEFAULT 0;

COMMENT ON COLUMN menu_options.cogs_percent IS 'Cost of goods sold percentage (cost/price * 100)';

UPDATE menu_options
   SET cogs_percent = CASE
     WHEN price IS NULL OR price = 0 OR cost IS NULL THEN 0
     ELSE ROUND((cost / price) * 100, 2)
   END
 WHERE cogs_percent IS NULL;
