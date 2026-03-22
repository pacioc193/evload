-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "jwt_secret" TEXT,
    "ha_client_id" TEXT,
    "ha_client_secret" TEXT,
    "ha_token" TEXT,
    "ha_token_obj" TEXT,
    "telegram_bot_token" TEXT,
    "password_hash" TEXT,
    "engine_restore_state" TEXT,
    "key" TEXT,
    "value" TEXT
);

-- CreateTable
CREATE TABLE "ChargingSession" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "vehicleId" TEXT NOT NULL,
    "locationName" TEXT,
    "targetSoc" INTEGER,
    "targetAmps" INTEGER,
    "energyPriceEurPerKwh" REAL NOT NULL DEFAULT 0,
    "totalCostEur" REAL NOT NULL DEFAULT 0,
    "totalEnergyKwh" REAL NOT NULL DEFAULT 0,
    "peakPowerW" REAL NOT NULL DEFAULT 0,
    "averageAmps" REAL NOT NULL DEFAULT 0,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "ChargingTelemetry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voltageV" REAL,
    "currentA" REAL,
    "powerW" REAL,
    "energyKwh" REAL,
    "stateOfCharge" INTEGER,
    "tempBatteryC" REAL,
    "tempCabinC" REAL,
    "chargerPilotA" INTEGER,
    "chargerActualA" INTEGER,
    "chargerPhases" INTEGER,
    "chargerVoltage" INTEGER,
    "chargerPower" REAL,
    "timeToFullCharge" REAL,
    CONSTRAINT "ChargingTelemetry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChargingSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledCharge" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vehicleId" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'start_at',
    "scheduledAt" DATETIME,
    "finishBy" DATETIME,
    "startedAt" DATETIME,
    "targetSoc" INTEGER NOT NULL,
    "targetAmps" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ScheduledClimate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vehicleId" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL DEFAULT 'start_at',
    "scheduledAt" DATETIME,
    "finishBy" DATETIME,
    "startedAt" DATETIME,
    "targetTempC" REAL NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TelegramCommand" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "chatId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "args" TEXT,
    "response" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AppConfig_key_key" ON "AppConfig"("key");

-- CreateIndex
CREATE INDEX "ChargingTelemetry_sessionId_recordedAt_idx" ON "ChargingTelemetry"("sessionId", "recordedAt");
