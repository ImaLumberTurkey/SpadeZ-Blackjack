CREATE TABLE IF NOT EXISTS admin_codes (
  id TEXT PRIMARY KEY NOT NULL DEFAULT (
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6)))
  ),
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS admin_pin_attempts (
  fingerprint TEXT PRIMARY KEY NOT NULL,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE TABLE IF NOT EXISTS catalog_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  section_config TEXT NOT NULL CHECK (json_valid(section_config)),
  logo_image TEXT,
  theme_config TEXT NOT NULL DEFAULT '{"backgroundColor":"#0e0f12","backgroundImage":"","backgroundFit":"cover","backgroundPosition":"center","backgroundRepeat":"no-repeat","fixedBackground":false,"mainTextColor":"#f3eede","mainTextFont":"system","accentColor":"#d9ad52","panelBackgroundColor":"#0e0f12"}' CHECK (json_valid(theme_config)),
  seed_complete INTEGER NOT NULL DEFAULT 0 CHECK (seed_complete IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id TEXT PRIMARY KEY NOT NULL,
  section_key TEXT NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS catalog_items_section_created_idx
  ON catalog_items (section_key, created_at);
