-- Persist schedule and custom-day changes until their effective date.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS scheduled_delivery_schedule delivery_schedule,
  ADD COLUMN IF NOT EXISTS scheduled_custom_days text[];
