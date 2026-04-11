-- Add optional name field to ScheduledCharge and ScheduledClimate
-- This allows users to label each scheduled plan for easy identification
-- in Telegram notifications, dashboard display, and session statistics.

ALTER TABLE "ScheduledCharge" ADD COLUMN "name" TEXT;
ALTER TABLE "ScheduledClimate" ADD COLUMN "name" TEXT;
