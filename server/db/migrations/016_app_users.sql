-- ============================================================
-- Cloud9 OS — Migration 016: application users (auth)
-- Login accounts for the Cloud9 OS app itself (separate from helm_users, which
-- are Helm warehouse/customer logins). Everyone has full access for now; the
-- is_admin flag is reserved for future role gating. Passwords are bcrypt-hashed
-- — never stored in plain text.
-- ============================================================

CREATE TABLE IF NOT EXISTS app_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(200) NOT NULL,
  full_name     VARCHAR(200),
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT true,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Case-insensitive unique email (the login identifier).
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users (LOWER(email));

CREATE TRIGGER trg_app_users_updated_at BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
