-- Remove dead columns from AppConfig:
-- ha_client_id: defined in schema but never read or written by any code (OAuth client ID read from HA_CLIENT_ID env var only)
-- ha_client_secret: same as above (read from HA_CLIENT_SECRET env var only)
-- ha_token: redundant with ha_token_obj; getHaToken() was broken (wrong lookup key); saveHaToken() wrote here but nothing ever read it
-- key/value: legacy key-value storage never used

DROP INDEX IF EXISTS "AppConfig_key_key";

ALTER TABLE "AppConfig" DROP COLUMN "ha_client_id";
ALTER TABLE "AppConfig" DROP COLUMN "ha_client_secret";
ALTER TABLE "AppConfig" DROP COLUMN "ha_token";
ALTER TABLE "AppConfig" DROP COLUMN "key";
ALTER TABLE "AppConfig" DROP COLUMN "value";
