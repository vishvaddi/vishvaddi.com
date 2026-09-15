-- The webhook usually creates the licence before the customer's browser reaches
-- /pay/success, so the success page recovers the key from the Stripe customer's
-- metadata and shows it exactly once. This records that showing.
ALTER TABLE pro_licences ADD COLUMN key_shown_at INTEGER;
