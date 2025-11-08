CREATE TABLE IF NOT EXISTS admin_promotions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  requested_role TEXT NOT NULL,
  ip_address TEXT,
  succeeded BOOLEAN NOT NULL DEFAULT FALSE,
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_promotions_user_id_idx ON admin_promotions(user_id);
