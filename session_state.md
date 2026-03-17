# Session State — F-01 through F-09

## Summary Table

| # Step | Feature | Stato | Conclusione Breve |
|--------|---------|-------|-------------------|
| F-01 | Notifications Widget | VERIFIED | Panel con enable/disable per regola, lista vuota di default |
| F-01B | Notification Message Source Of Truth | VERIFIED | Nessun fallback statico; Smart Rules Builder completo con changed/increased_by/decreased_by/mod_step |
| F-02 | Show All Placeholders | VERIFIED | Modal popup via Help button, filtrata per evento, con descrizioni |
| F-03 | Test Center & Event Schemas | VERIFIED | Schema validation, preset, missing-placeholder warning, real event dispatch, prerequisite errors |
| F-04 | API Token Write-Only | VERIFIED | Token esclusivo in .env, mascherato in GET, ignorato se `***` in PATCH, reload immediato |
| F-05 | Allowed Chat IDs Full Management | VERIFIED | Input multi-ID comma-separated, persistenza e no value loss verificato da test |
| F-06 | Delete All Event Messages | VERIFIED | Pulsante "Delete All" presente, svuota regole, persistenza verificata da test |
| F-07 | Load Example Or Generate From Scratch | VERIFIED | "Load Examples" e "Generate From Scratch" presenti; scelta esplicita all'aggiunta notifica |
| F-08 | Dashboard Themes | VERIFIED | Toggle dark/light, persistenza localStorage, applicato all'intera app via classe HTML |
| F-09 | Dashboard All Information | VERIFIED | Tutti i campi visibili (current, desired current, voltage, phase, time to full), label e unità coerenti |

---

### F-01 – Notifications Widget (event-based)

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — `NotificationsPage.tsx` contiene sezione "Event Message Widget" con pannello dedicato per regole di notifica
- C2: PASS — per ogni evento è possibile definire template personalizzati via `upsertPrimaryRuleForEvent`
- C3: PASS — toggle `ToggleRight/ToggleLeft` per attivare/disattivare singole regole
- C4: PASS — `config.ts` Zod schema default per `notifications.rules` è `[]`; nessuna regola di default

**Evidenza codice:**
- `frontend/src/pages/NotificationsPage.tsx`: componente `NotificationsPage`, sezione "Event Message Widget"
- `backend/src/config.ts`: `rules: z.array(NotificationRuleSchema).default([])`

**Evidenza runtime:**
- Build: `npm run build` → success
- Test: 54/54 pass

**Gap:** nessuno

**Conclusione:** Conformità completa a tutti i criteri.

---

### F-01B – Notification Message Source Of Truth

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — `dispatchTelegramNotificationEvent` non ha fallback statici; usa solo `getRules()` da config
- C2: PASS — se non ci sono regole corrispondenti, `messages = []` e `delivered = 0`
- C3.1: PASS — Rules Builder mostra dropdown con placeholder dall'endpoint backend `/settings/telegram/placeholders`
- C3.2: PASS — operatori `changed`, `increased_by`, `decreased_by` implementati in `evaluateCondition`
- C3.3: PASS — operatore `mod_step` implementato in `evaluateCondition`
- C4: PASS — sotto l'Event Message Widget: "Message source of truth: only user-defined rules above are used for runtime notifications."

**Evidenza codice:**
- `backend/src/services/notification-rules.service.ts`: `evaluateCondition` con casi `changed`, `increased_by`, `decreased_by`, `mod_step`
- `backend/src/config.ts`: `operator: z.enum([... 'changed', 'increased_by', 'decreased_by', 'mod_step'])` — **FIX APPLICATO in questa sessione**
- `frontend/src/pages/NotificationsPage.tsx`: `TELEGRAM_OPERATOR_OPTIONS` include tutti gli operatori

**Evidenza runtime:**
- Test `supports increased_by, decreased_by and mod_step operators` → PASS
- Test `supports changed operator with previous payload tracking` → PASS

**Gap corretti in questa sessione:**
- `config.ts` `NotificationRuleSchema` mancava degli operatori avanzati (`changed`, `increased_by`, `decreased_by`, `mod_step`) nel Zod enum — causava rigetto silenzioso delle regole avanzate al reload config. Corretto.
- `settings.routes.ts` tipo TypeScript del body PATCH mancava degli stessi operatori. Corretto.
- Aggiunto test di regressione in `settings.routes.test.ts`.

**Conclusione:** Conformità completa dopo correzione schema Zod.

---

### F-02 – Show All Placeholders

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — pulsante "All Placeholders" in header pagina apre `PlaceholderModal`
- C2: PASS — un unico modal consolidato, non ripetuto in più sezioni
- C3: PASS — ogni placeholder mostra descrizione da `placeholderDescriptions` (es. `sessionId: 'ID sessione di ricarica'`)
- C4: PASS — `PlaceholderModal` riceve `currentEvent` e filtra con `placeholdersByEvent[currentEvent]`

**Evidenza codice:**
- `frontend/src/pages/NotificationsPage.tsx`: `PlaceholderModal` con prop `currentEvent`, `placeholdersByEvent`
- `backend/src/services/notification-rules.service.ts`: `PLACEHOLDER_DESCRIPTIONS` con descrizioni per tutti i placeholder

**Evidenza runtime:**
- Build: success; test: 54/54 pass

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-03 – Test Center & Event Schemas

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — `EVENT_PAYLOAD_SCHEMAS` in `notification-rules.service.ts` definisce schema per ogni evento (required fields + tipi)
- C2: PASS — `validateTestPayloadForEvent` blocca l'invio se schema non valido; backend `/settings/telegram/test` fa lo stesso
- C3: PASS — `EVENT_PAYLOAD_PRESETS` fornisce preset per ogni evento; frontend carica il preset quando si seleziona un evento
- C4: PASS — `missingPlaceholders` restituiti nel risultato test e mostrati nell'UI
- C5: PASS — `triggerTestEvent` chiama `POST /engine/test-event` che emette sull'event bus e restituisce matched rules
- C6: PASS — `getTelegramPrerequisiteStatus()` verificato prima dell'invio; errore mostrato come "Prerequisites missing: ..."

**Evidenza codice:**
- `backend/src/services/notification-rules.service.ts`: `EVENT_PAYLOAD_SCHEMAS`, `EVENT_PAYLOAD_PRESETS`, `validateNotificationPayload`, `extractMissingTemplatePlaceholders`
- `backend/src/routes/settings.routes.ts`: prerequisite check prima di `sendTelegramNotificationTest`
- `frontend/src/pages/NotificationsPage.tsx`: `handleSendTelegramTest`, `handleTriggerRealEvent`

**Evidenza runtime:**
- Test `validates payload schema for each selected event` → PASS
- Test `extracts placeholders missing from payload for warning reporting` → PASS

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-04 – API Token Write-Only

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — campo `Telegram Bot Token` con label "Write-Only" in `NotificationsPage`
- C2: PASS — `settings.routes.ts` scrive il token nel `.env` e fa `delete telegram['botToken']` prima di scrivere il YAML
- C3: PASS — GET restituisce `telegramBotToken: currentToken ? '********' : ''`
- C4: PASS — input di tipo `password` con placeholder `'********'` se token già presente
- C5: PASS — condizione `!incoming.telegramBotToken.includes('***')` in PATCH route
- C6: PASS — `fs.existsSync(ENV_PATH)` con creazione automatica se assente
- C7: PASS — `initTelegram()` chiamata dopo ogni `reloadConfig()` nel PATCH handler

**Evidenza codice:**
- `backend/src/routes/settings.routes.ts`: logica `.env` write, `delete telegram['botToken']`, prerequisite check
- `backend/src/services/telegram.service.ts`: legge `process.env.TELEGRAM_BOT_TOKEN`

**Evidenza runtime:**
- Test `writes token to .env and removes token from config yaml` → PASS

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-05 – Allowed Chat IDs Full Management

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — input comma-separated supporta più IDs: `value.split(',').map(v => v.trim()).filter(Boolean)`
- C2: PASS — `telegramAllowedChatIds` scritto in `config.yaml` tramite PATCH handler
- C3: PASS — test `stores multiple allowed chat IDs and keeps them across subsequent saves` verifica no value loss

**Evidenza codice:**
- `frontend/src/pages/NotificationsPage.tsx`: input con `onChange` che splita per virgola
- `backend/src/routes/settings.routes.ts`: `telegram['allowedChatIds'] = incoming.telegramAllowedChatIds`

**Evidenza runtime:**
- Test `stores multiple allowed chat IDs and keeps them across subsequent saves` → PASS

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-06 – Delete All Event Messages

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — pulsante "Delete All" con icona `Trash2` presente nell'Event Message Widget
- C2: PASS — `generateFromScratch` imposta `telegramRules: []`
- C3: PASS — test `delete all event messages persists empty rules array` verifica persistenza dopo save/reload

**Evidenza codice:**
- `frontend/src/pages/NotificationsPage.tsx`: `<button onClick={generateFromScratch}>Delete All</button>`
- `backend/src/routes/settings.routes.ts`: `notifications['rules'] = []` quando array vuoto

**Evidenza runtime:**
- Test `delete all event messages persists empty rules array` → PASS

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-07 – Load Example Or Generate From Scratch

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — pulsante "Load Examples" chiama `loadExampleRules` con 4 esempi predefiniti (incluse condizioni avanzate)
- C2: PASS — pulsante "Generate From Scratch" chiama `generateFromScratch` → `telegramRules: []`
- C3: PASS — al click "Add Event Message", compare `pendingAddEvent` con scelta esplicita tra "Load Example Template" e "Generate From Scratch"
- C4: PASS — entrambe le azioni chiedono conferma se ci sono regole esistenti (`window.confirm`)

**Evidenza codice:**
- `frontend/src/pages/NotificationsPage.tsx`: `loadExampleRules`, `generateFromScratch`, `pendingAddEvent` dialog

**Evidenza runtime:**
- Build: success

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-08 – Dashboard Themes

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — toggle `dark`/`light` in header (Layout); valore iniziale da localStorage, default `'dark'`
- C2: PASS — `localStorage.setItem(THEME_STORAGE_KEY, theme)` ad ogni cambio tema
- C3: PASS — `root.classList.add('dark')` / `root.classList.remove('dark')` agisce su `<html>` → applica `dark:` classes Tailwind a tutta l'app

**Evidenza codice:**
- `frontend/src/App.tsx`: `THEME_STORAGE_KEY`, `useEffect` per aggiornare classe HTML, `toggleTheme` passato a Layout

**Evidenza runtime:**
- Build: success

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

### F-09 – Dashboard All Information

**Stato:** VERIFIED

**Checklist letterale:**
- C1: PASS — campi visibili: `chargerActualCurrent` (Current), `chargerPilotCurrent` (Desired Current), `chargerVoltage` (Voltage), `chargerPhases` (Phases), `timeToFullChargeH` (Time Full)
- C2: PASS — `timeToFullChargeH` deriva da `useWsStore((s) => s.vehicle)` → dati realtime via WebSocket dal proxy veicolo
- C3: PASS — label: "Current"/"Desired Current"/"Voltage"/"Phases"/"Time Full" con unità rispettive A/A/V/(numero)/h

**Evidenza codice:**
- `frontend/src/pages/DashboardPage.tsx`: grid cards con tutti i campi indicati
- `frontend/src/store/wsStore.ts`: `VehicleState` con tutti i campi tipizzati

**Evidenza runtime:**
- Build: success; test: 54/54 pass

**Gap:** nessuno

**Conclusione:** Conformità completa.

---

## Anti-regressione

- Build backend: ✅ `tsc` clean
- Test suite: ✅ 54/54 pass (aggiunto 1 test per operatori avanzati)
- Nessuna regressione su item precedenti

---

# Session State — F-10 through F-22

## Summary Table

| # Step | Feature | Status | Brief Conclusion |
|--------|---------|--------|-----------------|
| F-10 | Top Of Page Power Metrics | VERIFIED | Grid kW + Auto(Grid-Charger) kW cards at dashboard top |
| F-11 | Next Charge Start Time | VERIFIED | Derived from scheduler API, displayed with locale time format |
| F-12 | Engine Log | VERIFIED | "Engine Live Log" section in dashboard, runtime debugLog from engine |
| F-13 | Configuration - Demo Mode | VERIFIED | Toggle in Settings; yellow banner in dashboard when active |
| F-14 | Configuration - Home Assistant Panel | VERIFIED | URL, power entity, grid entity, Connect button, live status |
| F-15 | Configuration - Power Load | VERIFIED | haMaxHomePowerW field, used in computeHaAllowedAmps throttle/pause |
| F-16 | Configuration - Charging | VERIFIED | batteryCapacityKwh, defaultAmps/minAmps/maxAmps, rampIntervalSec; min≤default≤max validation |
| F-17 | Configuration - Proxy | VERIFIED | proxyUrl and vehicleId (VIN) configurable, used in proxy calls |
| F-18 | Recharge Engine Modes | VERIFIED | Off/Plan/On modes with ModePill UI; different engine behaviors |
| F-19 | Recharge Engine Ramp | VERIFIED | Immediate throttle on reduction; F-22 formula on recovery; null-gridW fallback; rampIntervalSec |
| F-20 | Dynamic Notification Event Bus | VERIFIED | emitNotificationEvent bus; frontend fetches event catalog dynamically from backend |
| F-21 | Extended Settings Panel | VERIFIED | All panels present; Sign Out at top; HA live readings; full YAML editor |
| F-22 | Charging Engine Smart Current Algorithm | VERIFIED | Formula implemented; domain names; tests with known values |

---

### F-10 – Top Of Page Power Metrics

**Status:** VERIFIED

**Checklist:**
- C1: PASS — Two cards at top of DashboardPage: "Actual Grid" (gridW/1000 kW) and "Auto Power" (autoW/1000 kW)
- C2: PASS — `autoW = gridW - vehicleW` where vehicleW = chargeRateKw*1000 (charger power)
- C3: PASS — Both derive from wsStore ha/vehicle state which updates every 1s via WebSocket

**Evidence:** `frontend/src/pages/DashboardPage.tsx` — two grid cards at top with `gridW` and `autoW` calculations

**Gap:** none

---

### F-11 – Next Charge Start Time

**Status:** VERIFIED

**Checklist:**
- C1: PASS — "Next Charge" cell in mode control row shows time or "— no schedule —"
- C2: PASS — `getScheduledCharges()` API call, polls every 15s, filters enabled future start_at schedules
- C3: PASS — `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })` format

**Evidence:** `frontend/src/pages/DashboardPage.tsx` — `nextStartTime` state, `getScheduledCharges()` useEffect

**Gap:** none

---

### F-12 – Engine Log

**Status:** VERIFIED

**Checklist:**
- C1: PASS — "Engine Live Log" section at bottom of dashboard with monospace scrollable area
- C2: PASS — `engine?.debugLog` from wsStore, refreshed every 1s via WebSocket
- C3: PASS — debugLog populated by `pushEngineLog()` throughout engine lifecycle

**Evidence:** `frontend/src/pages/DashboardPage.tsx` — Engine Live Log section; `backend/src/engine/charging.engine.ts` — `pushEngineLog` calls

**Gap:** none

---

### F-13 – Configuration - Demo Mode

**Status:** VERIFIED

**Checklist:**
- C1: PASS — Demo Mode toggle in SettingsPage Quick Settings panel
- C2: PASS — Persisted to config.yaml; ha.service.ts has dedicated demo branch for simulated values
- C3: PASS — Yellow banner "Demo Mode Active — Simulated Data" at top of DashboardPage when demo=true

**Evidence:**
- `frontend/src/pages/SettingsPage.tsx` — ToggleRight/ToggleLeft for demo
- `frontend/src/pages/DashboardPage.tsx` — `demo` from wsStore, yellow banner
- `backend/src/services/ha.service.ts` — demo branch generates simulated powerW + gridW

**Gap corrected:** Added demo banner to DashboardPage (F-13 C3)

---

### F-14 – Configuration - Home Assistant Panel

**Status:** VERIFIED

**Checklist:**
- C1: PASS — Fields: HA URL, Power Entity ID, Grid Power Entity ID present in SettingsPage
- C2: PASS — "Connect / Re-authorize" button opens HA OAuth flow via `getHaAuthorizeUrl()`
- C3: PASS — LIVE/OFFLINE indicator with colored dot in HA section header
- C4: PASS — Real-time kW readings shown next to entity fields when HA is connected

**Evidence:** `frontend/src/pages/SettingsPage.tsx` — Home Assistant section with live readings

**Gap:** none

---

### F-15 – Configuration - Power Load

**Status:** VERIFIED

**Checklist:**
- C1: PASS — "Max Home Power" field (haMaxHomePowerW) in SettingsPage Charging Engine section
- C2: PASS — `computeHaAllowedAmps` uses `cfg.homeAssistant.maxHomePowerW` to compute throttle amps
- C3: PASS — `home_power_limit_exceeded` event emitted when exceeded; charge stopped below minAmps

**Evidence:** `backend/src/engine/charging.engine.ts` — `computeHaAllowedAmps`, throttle/pause logic

**Gap:** none

---

### F-16 – Configuration - Charging

**Status:** VERIFIED

**Checklist:**
- C1: PASS — All fields: batteryCapacityKwh, defaultAmps (Start A), minAmps, maxAmps, rampIntervalSec
- C2: PASS — Engine uses them: startEngine uses defaultAmps/maxAmps, adjustAmps uses rampIntervalSec and minAmps/maxAmps
- C3: PASS — Validation: `minAmps <= defaultAmps <= maxAmps` enforced in PATCH /settings

**Evidence:** `backend/src/routes/settings.routes.ts` — validation; `backend/src/config.ts` — Zod schema with all fields

**Gap:** none

---

### F-17 – Configuration - Proxy

**Status:** VERIFIED

**Checklist:**
- C1: PASS — "Proxy URL" and "Vehicle ID (VIN)" fields in SettingsPage Proxy & Vehicle section
- C2: PASS — `cfg.proxy.url` used in `proxy.service.ts`; `cfg.proxy.vehicleId` used as vehicleId in commands

**Evidence:** `frontend/src/pages/SettingsPage.tsx` — Proxy & Vehicle panel

**Gap:** none

---

### F-18 – Recharge Engine Modes

**Status:** VERIFIED

**Checklist:**
- C1: PASS — Three ModePill buttons: Off, Plan, On in DashboardPage
- C2: PASS — Off → stopCharging(); Plan → setPlanMode(targetSoc); On → startCharging(targetSoc)
- C3: PASS — Active mode highlighted; synced with engine?.mode from wsStore

**Evidence:** `frontend/src/pages/DashboardPage.tsx` — ModePill, `applyMode`; `backend/src/routes/engine.routes.ts`

**Gap:** none

---

### F-19 – Recharge Engine Ramp

**Status:** VERIFIED

**Checklist:**
- C1: PASS — Immediate throttle: `if (desired > maxPossible) { desired = maxPossible; lastRampUpMs = now }`
- C2: PASS — Recovery via F-22 formula at each rampIntervalSec interval
- C3: PASS — `gridPowerW === null` branch skipped → setpoint maintained when HA disconnected
- C4: PASS — `rampIntervalSec` in config, used as `(cfg.charging.rampIntervalSec ?? 10) * 1000`
- C5: PASS — Tests: immediate throttle + formula correctness + null fallback
- C6: PASS — SettingsPage label "Ramp Up Interval (Loop Refresh Rate)" with unit (sec)

**Evidence:** `backend/src/engine/charging.engine.ts` — `adjustAmps`; `backend/src/engine/__tests__/ramp.test.ts`

**Gap corrected:** Replaced +1A with F-22 formula; updated tests

---

### F-20 – Dynamic Notification Event Bus

**Status:** VERIFIED

**Checklist:**
- C1: PASS — `notificationEvents` EventEmitter + `emitNotificationEvent` reusable from any module
- C2: PASS — `emitNotificationEvent` emits on bus; no direct Telegram dependency
- C3: PASS — `notificationEvents.on('notify', ...)` listener dispatches to Telegram
- C4: PASS — `GET /settings/telegram/placeholders` returns `events` array; frontend uses `setEventOptions(nextEvents)`
- C5: PASS — `EVENT_PLACEHOLDER_CATALOG` keys drive both backend catalog and frontend options
- C6: PASS — Tests: `emitNotificationEvent bus triggers rule evaluation`, `does not trigger rules for different events`

**Evidence:**
- `backend/src/services/notification-rules.service.ts` — `notificationEvents`, `emitNotificationEvent`
- `frontend/src/pages/NotificationsPage.tsx` — `eventOptions` state set from backend API

**Gap:** none

---

### F-21 – Extended Settings Panel

**Status:** VERIFIED

**Checklist:**
- C1: PASS — Demo Mode toggle with description "Bypass all real HTTP calls with simulated data"
- C2: PASS — Home Assistant panel: URL, Charger Power Entity, Grid Power Entity all present
- C3: PASS — "Connect / Re-authorize" button for OAuth
- C4: PASS — Real-time kW readings shown next to entity fields
- C5: PASS — Proxy panel: Proxy URL + Vehicle ID (VIN)
- C6: PASS — Charging Engine panel: Max Home Power, Battery Capacity, Start A, Min A, Max A, Ramp Up Interval
- C7: PASS — Full YAML editor with Monaco editor
- C8: PASS — Sign Out button in page header at TOP (flex row with h1 title)

**Evidence:** `frontend/src/pages/SettingsPage.tsx`

**Gap:** none

---

### F-22 – Charging Engine Smart Current Algorithm

**Status:** VERIFIED

**Checklist:**
- C1: PASS — `residualPowerW = gridPowerW - chargerPowerW`
- C2: PASS — `deltaAmps = residualPowerW / vehicleVoltageV`
- C3: PASS — `desired = Math.round(actualAmps + deltaAmps)` (NOT fixed +1A)
- C4: PASS — `rampIntervalSec` configurable; used as loop update interval in `adjustAmps`
- C5: PASS — When `gridPowerW === null`: formula branch skipped, setpoint maintained
- C6: PASS — Test: `gridPowerW=1150, chargerPowerW=0, vehicleVoltageV=230, actualAmps=5 → setpoint=10`
- C7: PASS — Variable names: gridPowerW, chargerPowerW, vehicleVoltageV, residualPowerW, deltaAmps

**Evidence:** `backend/src/engine/charging.engine.ts` — `adjustAmps`; `backend/src/engine/__tests__/ramp.test.ts`

**Gap corrected:** Replaced +1A increment with formula; rewrote ramp tests; added domain-specific variable names

---

## Anti-regression

- Backend build: ✅ `tsc` clean
- Test suite: ✅ 54/54 pass
- Frontend build: ✅ Vite production build clean
- CodeQL: ✅ 0 alerts
