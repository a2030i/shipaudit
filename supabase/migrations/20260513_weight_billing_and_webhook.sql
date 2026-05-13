-- ════════════════════════════════════════════════════════════════════════════
-- Phase 1 schema: weight-billing workflow + webhook intake + carrier file
-- signatures.
--
-- 1. audits.weight_billing_status — flags whether a given audit's excess-
--    weight rows have been exported to the merchant-billing system yet.
-- 2. carriers.file_signature — JSON describing how to recognise a file
--    as belonging to this carrier (sender domain / filename pattern /
--    column header fingerprint). Used by the webhook intake function.
-- 3. webhook_events — every file received via the inbound webhook,
--    whether or not we could identify the carrier. Acts as an audit
--    trail and gives the admin a UI to manually classify unknowns.
-- 4. weight_billing_exports — every Excel the accountant pulls (or the
--    nightly cron generates) so they can re-download, mark as billed,
--    or audit who generated what.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Audits weight-billing status ─────────────────────────────────────────
ALTER TABLE audits
  ADD COLUMN IF NOT EXISTS weight_billing_status TEXT
    NOT NULL DEFAULT 'pending'
    CHECK (weight_billing_status IN ('pending', 'exported', 'billed', 'skipped'));

CREATE INDEX IF NOT EXISTS audits_weight_billing_status_idx
  ON audits (weight_billing_status);

COMMENT ON COLUMN audits.weight_billing_status IS
  'Lifecycle for re-billing the merchant for excess weight in this audit. '
  'pending = not yet exported; exported = pulled into a weight_billing_exports '
  'file but not yet billed to merchant; billed = accountant confirmed billing; '
  'skipped = explicitly excluded by accountant (e.g. zero excess).';

-- ─── 2. Carrier file signature ───────────────────────────────────────────────
ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS file_signature JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN carriers.file_signature IS
  'How to recognise an incoming file as belonging to this carrier. Shape: '
  '{ "email_from": ["billing@aramex.com"], '
  '  "filename_pattern": "^.*aramex.*\\.xlsx$", '
  '  "header_must_contain": ["AWB","Billing Type","Chargeable Weight"], '
  '  "auto_learn": true }. '
  'Webhook intake tries email_from → filename → headers in order and picks '
  'the highest-confidence match.';

-- ─── 3. Webhook events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  source             TEXT         NOT NULL DEFAULT 'webhook'
                     CHECK (source IN ('webhook', 'manual', 'cron')),
  -- The raw envelope: who sent it, with what
  sender             TEXT,                       -- "from" header or webhook caller id
  subject            TEXT,                       -- email subject (when available)
  file_name          TEXT         NOT NULL,
  file_size          BIGINT,
  file_hash          TEXT,                       -- sha256 for dedup
  file_path          TEXT,                       -- supabase storage path
  -- Detection result
  detected_carrier_id TEXT REFERENCES carriers(id) ON DELETE SET NULL,
  detection_method   TEXT         CHECK (detection_method IN ('email_from','filename','columns','manual', NULL)),
  detection_confidence NUMERIC(3,2),             -- 0.00 – 1.00
  -- Lifecycle
  status             TEXT         NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','processing','processed','failed','awaiting_assignment')),
  audit_id           TEXT REFERENCES audits(id) ON DELETE SET NULL,
  error_message      TEXT,
  -- Catch-all for anything else (Postmark/Mailgun headers, original payload meta)
  metadata           JSONB        DEFAULT '{}'::jsonb,
  -- Audit trail
  processed_at       TIMESTAMPTZ,
  processed_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx ON webhook_events (received_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_status_idx      ON webhook_events (status);
CREATE INDEX IF NOT EXISTS webhook_events_carrier_idx     ON webhook_events (detected_carrier_id);
CREATE INDEX IF NOT EXISTS webhook_events_file_hash_idx   ON webhook_events (file_hash);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_select ON webhook_events;
DROP POLICY IF EXISTS webhook_events_insert ON webhook_events;
DROP POLICY IF EXISTS webhook_events_update ON webhook_events;
CREATE POLICY webhook_events_select ON webhook_events FOR SELECT
  TO authenticated USING (true);
CREATE POLICY webhook_events_insert ON webhook_events FOR INSERT
  TO authenticated WITH CHECK (true);
CREATE POLICY webhook_events_update ON webhook_events FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE webhook_events IS
  'Every file received via the inbound webhook (or manually replayed). '
  'Logs sender, detection outcome, and final processing status so the '
  'admin can audit failures and manually classify unknowns.';

-- ─── 4. Weight-billing exports ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weight_billing_exports (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  exported_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- What it covers
  audit_ids     TEXT[]       NOT NULL,
  row_count     INTEGER      NOT NULL DEFAULT 0,
  -- Where to find the file
  file_name     TEXT         NOT NULL,
  file_path     TEXT,                            -- storage path; null if generated on-the-fly only
  file_size     BIGINT,
  -- Lifecycle
  status        TEXT         NOT NULL DEFAULT 'exported'
                CHECK (status IN ('exported','billed','voided')),
  billed_at     TIMESTAMPTZ,
  billed_by     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  voided_at     TIMESTAMPTZ,
  void_reason   TEXT,
  -- Provenance
  trigger       TEXT         NOT NULL DEFAULT 'manual'
                CHECK (trigger IN ('manual','cron')),
  notes         TEXT,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS weight_billing_exports_exported_at_idx
  ON weight_billing_exports (exported_at DESC);
CREATE INDEX IF NOT EXISTS weight_billing_exports_status_idx
  ON weight_billing_exports (status);

ALTER TABLE weight_billing_exports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS weight_billing_exports_all ON weight_billing_exports;
CREATE POLICY weight_billing_exports_all ON weight_billing_exports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE weight_billing_exports IS
  'History of excess-weight Excel files generated for the merchant '
  'billing system. Each export captures which audits it spans so the '
  'accountant can re-download or confirm billing without recomputing.';
