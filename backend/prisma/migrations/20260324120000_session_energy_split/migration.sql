-- AlterTable
ALTER TABLE "ChargingSession" ADD COLUMN "meterEnergyKwh" REAL NOT NULL DEFAULT 0;
ALTER TABLE "ChargingSession" ADD COLUMN "vehicleEnergyKwh" REAL NOT NULL DEFAULT 0;
ALTER TABLE "ChargingSession" ADD COLUMN "chargingEfficiencyPct" REAL;
