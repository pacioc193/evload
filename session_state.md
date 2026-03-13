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
