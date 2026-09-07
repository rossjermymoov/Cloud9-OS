-- ============================================================
-- Cloud9 OS — Migration 025: collections (UPS pickup bookings)
-- Stores booked driver collections / pickups with UPS.
-- Tracks PRN, pickup date & time window, address, parcel counts,
-- and API response details.
-- ============================================================

CREATE TABLE IF NOT EXISTS collections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prn                 VARCHAR(100),
  status              VARCHAR(30) NOT NULL DEFAULT 'booked',
  company_name        VARCHAR(200),
  contact_name        VARCHAR(200),
  phone               VARCHAR(50),
  email               VARCHAR(200),
  address_line        TEXT,
  city                VARCHAR(100),
  postal_code         VARCHAR(50),
  country_code        VARCHAR(10) DEFAULT 'GB',
  pickup_date         VARCHAR(30),
  ready_time          VARCHAR(20),
  close_time          VARCHAR(20),
  parcels             INTEGER DEFAULT 1,
  total_weight_kg     NUMERIC(10, 2) DEFAULT 1.0,
  tracking_number     VARCHAR(100),
  special_instruction TEXT,
  service_code        VARCHAR(20) DEFAULT '011',
  response            JSONB,
  created_by          UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_created_at ON collections (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collections_prn ON collections (prn);
CREATE INDEX IF NOT EXISTS idx_collections_tracking ON collections (tracking_number);
