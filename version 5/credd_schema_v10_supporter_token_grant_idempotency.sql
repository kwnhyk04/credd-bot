-- Additive idempotency guard for real supporter stipend/token grants.
-- Manual/dev grants stay repeatable because this partial index only covers
-- positive payment/subscription grant reasons with a non-null ref.

CREATE UNIQUE INDEX IF NOT EXISTS supporter_token_ledger_grant_once_key
ON supporter_token_ledger (discord_id, reason, ref)
WHERE delta > 0
  AND ref IS NOT NULL
  AND reason IN ('subscribe_grant', 'founder_grant', 'monthly_grant');
