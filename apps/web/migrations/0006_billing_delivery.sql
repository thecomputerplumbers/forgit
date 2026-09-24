-- Keep failed usage events for review. Retry transient failures without
-- changing their transaction IDs; quarantine malformed or rejected events.
ALTER TABLE billing_usage_events ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_usage_events ADD COLUMN dead_lettered_at INTEGER;
CREATE INDEX billing_usage_ready
  ON billing_usage_events(delivered_at, dead_lettered_at, next_attempt_at, occurred_at);
