# Incremental Check Prompt (Strict Literal Mode)

Usa questo file come backlog incrementale e protocollo di verifica.
L'agente deve processare UNA feature alla volta, con verifica letterale, senza inferenze.

## Aggiornamenti Recenti (2026-04-11) — v1.6.5

- **VIN anonimizzazione nei log**:
	- Tutti i log backend ora anonimizzano VIN e vehicleId, mostrando solo le ultime 4 cifre (es. `***5ABC` instead di `7G1FB1E3XF1234567`).
	- Implementato tramite funzione `anonimizeVin()` che agisce su tutti i campi `vin` e `vehicleId` nella struttura di logging.
	- Sensibili: authorization, token, password, api_key, cookie.

- **Timestamp con timezone corretto**:
	- Frontend Settings → System → Timezone: il display cambia da hardcoded "Current server time (UTC)" a formato dinamico con timezone selezionato.
	- Usa `Intl.DateTimeFormat()` con la timezone IANA selezionata per mostrare l'ora effettiva nel fuso orario della macchina/server.
	- Formato: `YYYY-MM-DD HH:MM:SS (Europe/Rome)` instead di sempre UTC.

- **Pre-push local compilation enforcement**:
	- Nuovo script `scripts/pre-push-checks.ps1` che verifica la compilazione prima permettere il push.
	- Controlla:
		1. Backend TypeScript compiles (`npm run build`)
		2. Frontend build succeeds (Vite + TypeScript)
	- Exit code 0 = safe to push, 1 = build failed (stop push).
	- Può essere integrato come git hook pre-push per automazione.

- **OTA come deployment method ufficiale**:
	- Documentazione in `docs/DEPLOYMENT.md`: "Always use OTA unless OTA is broken."
	- OTA Update UI in Settings mostra lo status live e i guard-blocking reasons.
	- Script `Update-EvloadNative.ps1` supporta OTA come fallback quando il push locale non è possibile.
	- Preserva database, config, log files su update.
	- Supporta rollback a versioni precedenti.

- **Unified logging system — single log file**:
	- Rimossi dual transports (`error.log` + `combined.log`) dal logger.
	- Backend ora scrive unicamente su file `logs/log` (maxsize 50MB, maxFiles 5, formato JSON).
	- Semantica semplificata: non esiste più distinzione tra error e combined.
	- API `/api/settings/logs/backend` semplificata: rimuove il parametro `type` (era "error"/"combined"), serve direttamente il file `log`.
	- Frontend: `downloadBackendLog()` non richiede più il tipo, scarica un unico file `evload-backend.log`.

- **Schedule panel — complete mobile-first redesign**:
	- Refactor UI da desktop-first a mobile-first responsive.
	- Sticky header con pulsante "New" gradiente.
	- Collapsible form per aggiungere/modificare schedule (toggle `showForm`).
	- Integrazione mode tabs (Charger/Climate) direttamente nel form.
	- Card-based list items con delete on hover.
	- Responsive grid: verticale su mobile (stacked), 2-colonne su desktop.
	- Day selector semplificato a bottoni single-letter (L/M/M/G/V/S/D).
	- Estrazione di `renderScheduleItem()` per renderizzazione coerente.

- **Vehicle defrost command — fixed to proxy API spec**:
	- Bottone defrost ora chiama `sendVehicleCommand('auto_conditioning_start', { wait: true })` verso proxy.
	- Precedente: `sendVehicleCommand('defrost_max', { on: true })` (incompatibile con spec Tesla proxy).
	- Allineamento con altri vehicle command per coerenza API.

- **OTA error visibility — detailed error messages and timeout diagnostics**:
	- Backend (`updater.service.ts`): 
		- Enhanced error messages con context: "Update already in progress on branch X", "Failed to write update script to PATH: ERROR", ecc.
		- Added spawn error handling con try-catch, file descriptor cleanup, e logging di PID/script path.
		- Detailed fallback error reason quando spawn fallisce.
	- Frontend OTA handler (`SettingsPage.tsx` `handleOtaStart`):
		- Improved error classification: distingue guard-blocked (409 con `otaGuards`) vs altri 409 errors (already running, file errors) vs network errors.
		- Enhanced logging con `flog.info('OTA', 'Starting...', { branch, forced })` e detailed error logs.
		- Error messages include status code e reason dal backend.
	- Frontend OTA UI:
		- Log viewer status indicator: "⏳ Process starting... (waiting for output)" quando update è running ma no logs ricevuti.
		- Live indicator con pulse ("🟢 Live") quando logs stream in tempo reale.
		- Timeout warning dopo 30 secondi di no output: "⚠️ No output received for 30+ seconds. Check backend logs for details".
		- Empty state message: "Loading output from server..." vs "No logs".
	- State tracking: `otaStartTime`, `otaNoOutputWarning` per monitorare timeout di output.

## Aggiornamenti Recenti (2026-04-10) — v1.5.5

- **Docker — fix persistenza DB su update/rebuild**:
	- Aggiunto in `docker-compose.yml` il default `DATABASE_URL=${DATABASE_URL:-file:/app/backend/data/db.sqlite}`.
	- Se il file `.env` manca o non contiene `DATABASE_URL`, il backend non ricade piu su `file:./dev.db` (path volatile nel container), evitando reset di `AppConfig` e del target SoC a 80 dopo aggiornamenti.

- **Native/Raspberry — fix persistenza DB senza dipendenza da `.env`**:
	- Aggiornato backend runtime (`backend/src/prisma.ts`) e Prisma CLI (`backend/prisma.config.ts`) per usare di default `file:./data/evload.db` in produzione quando `DATABASE_URL` non e impostato.
	- Aggiornati i service systemd nei deploy script (`scripts/raspberry/install.sh`, `Deploy-EvloadNative.ps1`) con `Environment=DATABASE_URL=file:/opt/evload/backend/data/evload.db`.
	- Effetto: i dati applicativi persistenti (`AppConfig`, inclusi target SoC e segreti) restano nel DB su disco anche se `.env` non contiene `DATABASE_URL`.

- **Fix bug target SoC persistito sovrascritto dal plan**:
	- In `engine_restore_state` il `targetSoc` del piano armato veniva riusato anche come preferenza persistita, quindi un plan/schedule a 80 poteva sovrascrivere la preferenza utente (es. 100) dopo riavvio/update.
	- Introdotto campo `preferredTargetSoc` separato in `PersistedEngineRestoreState` (`backend/src/engine/charging.engine.ts`).
	- `initializeEngineState()` ora ricarica la preferenza da `preferredTargetSoc` (con fallback retrocompatibile a `targetSoc` per record vecchi).
	- Aggiunto test di regressione: `engine.modes.test.ts` verifica che con plan=80 e preferenza=100, dopo restart il piano resti 80 ma la preferenza resti 100.

- **Proxy reason reset e visibilita condizionale in UI**:
	- Backend (`backend/src/services/proxy.service.ts`): quando la comunicazione proxy/veicolo e ripristinata, `vehicleState.reason` viene azzerato (`null`) e non viene piu popolato con messaggi di successo.
	- Dashboard (`frontend/src/pages/DashboardPage.tsx`) e Settings (`frontend/src/pages/SettingsPage.tsx`): il campo `Reason` e mostrato solo se esiste un errore reale (`vehicle.error` o `proxy.error` o `vehicle.reason`).
	- Risultato: niente reason stale quando tutto e tornato online, e reason visibile solo in caso di problema.

- **Comando manuale Window Duration nel pannello Proxy (Settings)**:
	- Aggiunto pulsante sempre disponibile `Wake / Start Data Window` in `frontend/src/pages/SettingsPage.tsx`.
	- Il pulsante richiama `POST /api/engine/wake` (API `wakeVehicle`) e forza l'apertura immediata della finestra `vehicle_data` lato backend (`requestWakeMode(true)`).
	- Utile per attivare manualmente il polling completo del proxy senza attendere trigger automatici.

- **Settings Versioning — UX più efficace su molte release**:
	- Storico versioni ora mostrato in forma compatta: default alle release più recenti (5 voci).
	- Aggiunta espansione progressiva con pulsante `Show 5 more releases` e `Collapse history`.
	- Ogni release lunga ha toggle `Read more / Show less` per evitare blocchi di testo troppo estesi.
	- Risultato: pagina Settings più leggibile, meno scroll e accesso completo ai dettagli solo quando servono.

- **OTA updater — fix checkout bloccato da modifiche locali**:
	- In `backend/src/services/updater.service.ts`, lo script OTA ora esegue auto-stash (`git stash push --include-untracked`) quando il working tree non e pulito, prima di `git checkout -B`.
	- Evita l'errore: `Your local changes ... would be overwritten by checkout` (tipicamente su lockfile).
	- Step dipendenze OTA: backend in modalita live-safe con `npm install --include=dev` (evita la rimozione distruttiva di `node_modules` mentre il servizio e attivo), con fallback a `npm ci`; frontend mantiene `npm ci` con fallback a `npm install --no-package-lock`.
	- Aggiunte guardie runtime in `backend/src/routes/update.routes.ts`: update bloccato di default quando `engine.running`, sessione attiva, `vehicle.charging`/`chargingState=Charging`, `mode=plan`, failsafe attivo o proxy disconnesso. Override disponibile solo con `force=true`.
	- UI OTA in `frontend/src/pages/SettingsPage.tsx`: gestione esplicita del `409` con visualizzazione motivi bloccanti (`reasons`) e stato dettagliato di ogni guardia; aggiunto toggle `Force start (bypass guards)`.

- **Rimozione targetSocOff e scheduleLead**:
	- Eliminato il concetto di `targetSocOff` (target SoC separato per quando il motore è spento): esiste ora un solo `targetSoc` persisted che si applica in tutti i modi (idle, on, plan).
	- Rimosso `targetSocOn`/`targetSocOff` da `EngineStatus`, `PersistedEngineRestoreState`, store WS frontend, API `/engine/targets`.
	- L'endpoint `PATCH /api/engine/targets` non richiede più il parametro `mode` ("on"/"off"): accetta direttamente `{ targetSoc, applyToRunningSession }`.
	- La funzione `getTargetSocPreferences()` restituisce `{ value: number }` invece di `{ on, off }`.
	- Rimosso `scheduleLeadTimeSec` dal backend (`config.ts`, `settings.routes.ts`) e dal frontend (`SettingsPage.tsx`, `api/index.ts`): il programma non sveglia più il veicolo in anticipo rispetto all'orario pianificato.
	- Rimossa la sezione "Scheduler" dalla pagina Impostazioni.
	- Il cursore della Dashboard ora opera su un singolo `manualTargetSoc` (prima `manualTargetSocOn`/`manualTargetSocOff` separati).

- **Dashboard — fix cursore SoC non mostra valore salvato nel backend**:
	- Il `useEffect` che sincronizzava `manualTargetSocOn`/`manualTargetSocOff` dallo store WS aveva `engine` (oggetto) nel dependency array.
	- Il backend fa broadcast WS ogni **1 secondo** → il riferimento dell'oggetto `engine` cambia ad ogni messaggio → l'effect si rieseguiva ogni secondo con il vecchio valore del backend, resettando il cursore durante il trascinamento.
	- Fix: rimosso `engine` dal dependency array; si traccia solo `engine?.targetSocOn` e `engine?.targetSocOff` (valori primitivi) che cambiano solo quando il backend persiste un nuovo valore.
	- Risultato: il cursore mostra sempre il valore salvato nel backend, si aggiorna correttamente quando un altro utente connesso modifica il target, e non viene più resettato durante il trascinamento locale.

- **Garage — Unlatch sempre disponibile**:
	- Il pulsante Unlatch in GaragePage non richiede più che il cavo sia collegato (`vehicle.pluggedIn`).
	- Il pulsante è disabilitato solo mentre un comando è in corso (`busy`), consentendo di aprire lo sportello anche quando l'auto è in stato idle/sleep in garage.
	- Aggiornato il testo descrittivo del pulsante da "Open the charge-port door for cable removal" a "Open the charge-port door".


- **Statistics — zoom drag su grafici nel popup**:
	- Nella modale di espansione grafici (SoC, Power/Current, Voltage) è ora possibile trascinare orizzontalmente per zoomare sull'asse X.
	- Al rilascio del mouse il dominio X viene aggiornato a `[x1, x2]` e l'asse Y si adatta automaticamente ai dati visibili (`auto`).
	- Durante il trascinamento viene mostrata una `ReferenceArea` semitrasparente come anteprima della selezione.
	- Quando lo zoom è attivo compare il pulsante "Reset zoom" nell'header del modale; in caso contrario viene mostrato il testo guida "Drag to zoom".
	- La funzione `openZoomedChart` resetta sempre lo zoom prima di aprire un nuovo grafico.
	- Chiusura del modale (click overlay, pulsante ✕, Escape) resetta lo zoom.


- **Fix compilazione frontend (TypeScript strict)**:
	- Build bloccata da `TS6133` in `frontend/src/pages/StatisticsPage.tsx` per import `React` non usato.
	- Rimosso default import inutilizzato (`import { useEffect, useRef, useState } from 'react'`).
	- `npm run build` root ora completa con successo (backend `tsc` + frontend `tsc && vite build`).

## Aggiornamenti Recenti (2026-04-09) — v1.5.5

- **Version bump**:
	- Versione aggiornata a `1.5.5` in:
		- `backend/src/version.ts`
		- `package.json` root
		- `backend/package.json`
		- `frontend/package.json`

- **Statistiche: export CSV sessione selezionata**:
	- Aggiunto pulsante `Download CSV` nella pagina Statistics.
	- Il file include metadati sessione (energia, costo, efficienza, tariffa) + tabella telemetria completa.

- **Statistiche: asse X a data/ora reale**:
	- I grafici sessione (SoC, Potenza/Corrente, Tensione) usano ora `recordedAt` come timeline.
	- Rimosso asse X in minuti trascorsi di ricarica.
	- Tooltip e tick mostrano ora data/ora telemetria.

- **Rewrite totale calcolo "Evload average" in Dashboard**:
	- Rimossa la media su tutta la durata sessione (lenta a convergere dopo fasi di attesa/start).
	- Nuova logica basata su finestra mobile di energia recente (`accumulatedSessionEnergyKwh`) con slope su campioni temporali.
	- Fallback alla potenza live solo quando la finestra minima non è ancora sufficiente.

- **Fix OFF non interrompe ricarica con proxy instabile**:
	- Su `stopEngine({ forceOff: true })` il backend tenta `charge_stop` anche con telemetria veicolo non connessa.
	- Se il comando fallisce (es. proxy 503), viene attivato retry automatico periodico con limite massimo tentativi.
	- Al reconnect del proxy viene eseguito un retry immediato del `charge_stop` pendente.

- **Fix re-sync corrente richiesta Tesla vs setpoint engine**:
	- Quando il backend rileva mismatch tra setpoint evload e `charge_current_request` riportato dal proxy Tesla, invia nuovamente `set_charging_amps`.
	- Retry limitato da cooldown per evitare command spam.
	- Caso tipico risolto: corrente bloccata a 14A mentre target engine/setpoint richiede 16A.

- **Dashboard target SoC persistente per modalità ON/OFF**:
	- Introdotte preferenze target SoC separate per `on` e `off`, persistite lato backend in `engine_restore_state`.
	- Aggiunti endpoint autenticati:
		- `GET /api/engine/targets` (lettura preferenze)
		- `PATCH /api/engine/targets` (aggiornamento preferenze)
	- Le preferenze sono condivise tra browser e sopravvivono a refresh/reopen.

- **Slider SoC modificabile in ON e OFF**:
	- Dashboard: slider non più bloccato durante sessione manuale `on` (resta readonly in `plan`).
	- In `on`, il commit dello slider salva il target e aggiorna immediatamente il target attivo dell'engine.
	- In `off`, il commit salva il target predefinito usato per il successivo start manuale.

## Aggiornamenti Recenti (2026-04-08) — v1.5.5

- **Fix `proxyGet` — errori HTTP non causano più offline marking né retry inutili**:
  - `proxyGet` ora controlla, dopo il filtro sleep-response, se l'errore è un errore HTTP (`err.response != null`). In questo caso il proxy È raggiungibile (ha risposto con un codice di stato), si tratta di un problema a livello veicolo (es. 503).
  - Comportamento precedente: 3 retry consecutivi su qualsiasi errore → `markProxyError` → proxy marcato offline → soft failsafe → log `PROXY_CONNECTIVITY_TRANSITION` anche se il proxy stava rispondendo.
  - Comportamento nuovo: su errori HTTP (503, 4xx, ecc.) si lancia immediatamente l'errore senza retry e senza chiamare `markProxyError`. Il poll body-controller continuerà al prossimo tick e recupererà automaticamente la comunicazione quando il proxy torna operativo.
  - Il retry a 3 tentativi rimane SOLO per failure di rete (ECONNREFUSED, ETIMEDOUT, ecc.) dove il proxy non risponde affatto.
  - Log dedicato `PROXY_GET_HTTP_ERROR` con `statusCode` e URL per ogni caso HTTP-error.
  - Allineamento con `proxyPost` che già gestiva gli errori HTTP allo stesso modo (`PROXY_CMD_ERROR`).

## Aggiornamenti Recenti (2026-04-08) — v1.5.3

## Aggiornamenti Recenti (2026-04-08) — v1.5.4

- **Settings / Logs severity selector**:
	- Added `logLevel` to backend config schema and `/api/settings` GET/PATCH contract.
	- Runtime logger severity can now be changed from Settings without backend restart.
	- Allowed levels: `error`, `warn`, `info`, `verbose`, `debug`, `silly`.

- **Human-readable backend log downloads**:
	- `GET /api/settings/logs/backend` now supports `format=pretty`.
	- Download from Settings uses pretty format by default for easier manual diagnosis while file logs remain JSON.

- **OTA / native update branch consistency + frontend build reliability**:
	- OTA updater now checks out the selected branch explicitly (`git checkout -B <branch> origin/<branch>`) before reset/build.
	- Native updater now restores/updates the current branch explicitly and installs frontend dev dependencies (`npm ci --include=dev`) to prevent `tsc: not found`.

- **Frontend language consistency**:
	- Garage and related user-facing labels were aligned to English wording.

- **Garage cable state consistency**:
	- Proxy plugged-in inference now follows charging-state semantics only (`Charging|Stopped|Complete|Connected`) to avoid false "connected cable" badges when backend start checks report disconnected cable.

- **OTA Update panel in Settings / Versioning**:
  - Nuovo pannello "OTA Update" dentro la sezione Versioning delle Impostazioni.
  - **Card commit locale vs remoto**: mostra hash corto, messaggio, autore e data sia per HEAD locale che per `origin/<branch>`. Badge "N commit disponibili" (giallo) oppure "✓ aggiornato" (verde).
  - **Auto-check ogni 60 s**: `startAutoFetch()` avvia un `setInterval` nel backend che esegue `git fetch --all --prune` ogni 60 secondi (senza network call sulla pagina). Non gira durante un aggiornamento attivo.
  - **Branch selector**: dropdown con tutti i branch remoti; il branch corrente è marcato con `(current)`.
  - **Pulsante "Fetch ora"**: trigger manuale di `POST /api/update/fetch` per aggiornare subito le info remote.
  - **Pulsante "Avvia Aggiornamento"**: `POST /api/update/start` con `{ branch }`. Esegue in background (processo bash detached): `git fetch → git reset --hard origin/<branch> → npm ci → prisma migrate → build-prod.sh → systemctl/pm2 restart`.
  - **Log di build in tempo reale**: polling `GET /api/update/logs?from=<byte>` ogni 1 s mentre l'aggiornamento è in corso. Log appesi in una `<pre>` con auto-scroll e max-height 18rem.
  - **Badge stato**: idle/in corso/completato/errore con icone animate.
  - **Warning sessione attiva**: avviso giallo se il motore sta caricando.
  - **Persistenza**: `updater.log` e `updater.status.json` scritti in `<repo_root>/` → sopravvivono al riavvio del servizio.
  - **Tutti gli endpoint protetti da JWT** (`requireAuth`): `GET /api/update/status`, `POST /api/update/fetch`, `POST /api/update/start`, `GET /api/update/logs`.
  - Rate limit: 60 req/min per status/logs, 6 req/min per fetch, 3 aggiornamenti ogni 5 min per start.

- **Fix grafici statistiche (solo 1h visibile)**:
  - `GET /api/sessions/:id` aveva `take: 3600` (hardcoded = 1 ora a 1 pt/s). Sostituito con downsampling intelligente: se `totalPoints ≤ 1000` restituisce tutto; altrimenti usa SQLite `ROW_NUMBER()` per selezionare 1000 punti distribuiti uniformemente + ultimo punto sempre incluso.
  - Frontend: asse X dei grafici ora usa minuti trascorsi dall'inizio sessione (proporzionale, non indice) con `tickFormatter="Xmin"`.

## Aggiornamenti Recenti (2026-04-08) — v1.5.2

- **Fix modalità dopo fine ricarica (manuale vs plan)**:
  - `startEngine` accetta un nuovo parametro `fromPlan: boolean` (default `false`).
  - Quando `fromPlan=false` (avvio manuale tramite API `/engine/start`), il flag `planArmed` viene resettato a `false` → la sessione riceve `mode='on'` e, a fine ricarica, il motore torna a `mode='off'`.
  - Quando `fromPlan=true` (avvio da scheduler), `planArmed` resta `true` → la sessione riceve `mode='plan'` e, a fine ricarica, il motore resta `mode='plan'` (piano armato).
  - Il service scheduler chiama `startEngine(targetSoc, targetAmps, true)`.

- **Fix slider SOC durante sessione attiva**:
  - `effectiveTargetSoc` usa `engine.targetSoc` (valore autorevole dal backend) quando il motore è in esecuzione in modalità manuale, evitando che un remount della pagina mostri 80% (da `chargeLimitSoc`) invece del valore effettivamente inviato.
  - Il cursore è `readonly` anche durante una sessione manuale attiva (precedentemente solo in plan mode), impedendo modifiche al target durante la carica.

- **Log diagnostici targetSoc**:
  - `flog.debug('TARGET_SOC')` quando `manualTargetSoc` viene seminato da `chargeLimitSoc` (con contesto engine running/targetSoc).
  - `flog.debug('TARGET_SOC')` ad ogni spostamento del cursore (valore precedente/nuovo, stato engine).
  - `flog.info('SESSION')` arricchito al click Start: include `manualTargetSoc`, `effectiveTargetSoc`, `engineCurrentTargetSoc`, `chargeLimitSoc`.

## Aggiornamenti Recenti (2026-04-08) — v1.5.1

- **Fix media potenza evload gonfiata dopo retry/navigazione**:
  - `chargingStartedAtMs` era stato locale al componente React → resettato ad ogni remount, producendo tempi trascorsi piccoli e potenza media enorme.
  - Aggiunto `sessionStartedAt: string | null` in `EngineStatus` (backend + wsStore), impostato al timestamp DB di avvio sessione e azzerato a fine sessione.
  - Il frontend usa `engine.sessionStartedAt` e `Date.now()` (wall clock) per calcolare `chargingElapsedMs`, eliminando il problema del remount.

## Aggiornamenti Recenti (2026-04-07) — v1.5.0

- **Proxy resilience — 3 tentativi prima di dichiarare lost communication**:
	- `proxyGet` ora esegue fino a 3 tentativi prima di chiamare `markProxyError` e propagare l'errore.
	- Ogni tentativo usa un timeout di 30 s (aumentato da 4 s / 8 s per coprire risposte lente del proxy BLE fino a ~30 s).
	- Tutti i timeout proxy allineati a 30 s: `proxyGet` default, `body_controller_state`, `vehicle_data`, `proxyPost`, `PUT sendCommand`.
	- Ogni tentativo fallito logga `PROXY_GET_RETRY` con numero tentativo e timeout.
	- Worst-case prima del "lost communication": 3 × 30 s = 90 s.

- **ETA guardia contro proxy disconnesso**:
	- `chargeRateKw` dal proxy Tesla viene azzerato nel frontend quando `proxyConnected=false`, evitando che valori stale (es. 30 kW) alimentino il calcolo ETA.
	- `machineHours` (ETA nativa del veicolo) viene anch'essa ignorata quando il proxy è offline.
	- `fallbackAveragePowerKw` è condizionato a `proxyConnected`: quando offline si usa solo la media calcolata dal contatore reale; se non disponibile, ETA mostra "—".

- **Statistics — ricaricamento automatico a fine sessione**:
	- La pagina Statistics sottoscrive `engine.sessionId` via wsStore.
	- Quando la sessione termina (`sessionId` passa da un valore a `null`), la lista sessioni si ricarica automaticamente dopo 1,5 s (per attendere il commit DB finale con `totalCostEur`, `chargingEfficiencyPct`, ecc.).

## Aggiornamenti Recenti (2026-03-25)

- Hardening install/update script (2026-04-07):
	- Tutti gli script di installazione/aggiornamento ora forzano reinstall pulita dipendenze npm (`rm -rf node_modules` + `npm ci`).
	- Update Docker e deploy Proxmox eseguono `docker compose build --no-cache` per rigenerare sempre i layer dipendenze.
	- Tutti i percorsi deploy/update/install ora eseguono sync schema robusto: `prisma migrate deploy` con fallback automatico a `prisma db push --accept-data-loss`.
	- In caso di restart fallito del servizio/container, gli script stampano automaticamente gli ultimi log (`journalctl`/`docker compose logs`) e terminano con errore.
	- Nuova gestione engine per `charge_start` con veicolo/cavo disconnesso: retry sospesi finché lo stato non rientra, con messaggio esplicito nello stato engine.
	- Nuovo evento notifiche Telegram `charge_start_blocked` con payload contestuale (`reason`, `chargingState`, `pluggedIn`, `vehicleConnected`, `soc`, `sessionId`).
	- Notifications UI: aggiunto template predefinito per `charge_start_blocked` nel builder eventi e nel pacchetto "Load examples".
	- Dashboard: avviso visuale dedicato quando il blocco `charge_start` è attivo.
	- Layout: menu laterale collassabile con bottone hamburger (desktop + drawer mobile).
	- Obiettivo: eliminare drift/incompletezza di `node_modules` post-update (es. modulo runtime mancante `googleapis`).

- Vehicle energy baseline al session start:
	- `charge_energy_added` letto dal proxy Tesla non viene sempre azzerato tra sessioni.
	- Al primo campionamento di ogni sessione, il valore viene catturato come baseline e sottratto da tutti i campioni successivi.
	- `vehicleBatteryEnergyKwh` in `EngineStatus` è sempre relativo all'avvio sessione → efficienza corretta.
	- `vehicleBatteryEnergyRawKwh` espone il valore grezzo del proxy (informativo).
- Dual vehicle energy nella Dashboard Vehicle Details:
	- Tile "Vehicle Energy (da partenza sessione)": mostra `vehicleBatteryEnergyKwh` (baseline-corrected), usata per efficienza.
	- Tile "Vehicle Energy (raw Tesla proxy)": mostra `vehicleBatteryEnergyRawKwh` (charge_energy_added diretto dal proxy).
	- Efficienza calcolata sempre su valore sessione-relativo.
- Nuovo parametro `charging.startAmps` (default 8 A):
	- Al primo comando in sessione, l'engine usa `startAmps` invece del default del veicolo.
	- **Safe charge start sequence**: `set_charging_amps(startAmps)` è inviato e confermato PRIMA di `charge_start`, garantendo che Tesla accetti il setpoint sicuro prima che la corrente cominci a scorrere. Questo evita picchi di corrente all'accensione nel caso in cui l'ultimo livello impostato fosse troppo elevato.
	- Il ramp-up incrementa di +1A per `rampIntervalSec` partendo dal setpoint comandato (`setpointAmps`), non dall'ampere effettivo riportato dal veicolo (che può essere in ritardo).
	- `setpointAmps` inizializzato a 0 all'avvio sessione come sentinel per il primo comando.
	- Aggiornati `config.yaml`, `config.example.yaml` e schema Zod.
- YAML editor standalone (no CDN):
	- Rimosso `@monaco-editor/react` da Settings: Monaco carica worker JS da CDN jsdelivr.net, inutilizzabile in ambienti LAN senza internet.
	- Sostituito con `<textarea>` styled dark (stesso aspetto, nessuna dipendenza esterna).

## Aggiornamenti Recenti (2026-03-24)

- Energy semantics allineata end-to-end:
	- Dashboard principale mostra energia da contatore calcolata lato backend.
	- Vehicle Details -> Vehicle Charged Energy mostra energia immessa in batteria dal veicolo.
	- Entrambi i valori sono persistiti in `ChargingSession` con efficienza di ricarica (`chargingEfficiencyPct`).
- Failsafe recovery hardening:
	- attivazione/reset failsafe su reale stato di connettivita del proxy (non su semplici transizioni `vehicle.connected`).
	- risolto blocco della ripartenza manuale in modalita ON dopo timeout brevi del proxy.
- ETA/average power stabilization: media EVLoad calcolata su finestra sessione con warmup minimo di 10s per evitare valori instabili nei primi secondi.
- Version tracking in UI:
	- versione corrente visibile nell'header.
	- pannello Versioning in Settings con latest release check e storico versioni.

## Regole Obbligatorie

1. Verifica letterale, non interpretativa.
- Se la richiesta dice "button per ogni notifica", un solo bottone globale NON e' valido.
- Se la richiesta dice "read from message", non e' valido leggere da un'altra sorgente.

2. Nessun "sembra implementato".
- Ogni claim richiede evidenza oggettiva: codice + comportamento + test/manual check.

3. Se il comportamento e' cambiato rispetto al testo originale, marcare come NON conforme.

4. Ogni step deve produrre output strutturato con:
- Stato: `NOT_STARTED | VERIFIED | FAILED` (Lo stato `PARTIAL` non è più contemplato; ogni feature deve essere completata prima di avanzare o restare in `NOT_STARTED`/`FAILED`).
- Evidenza file (path + funzione/componente)
- Evidenza runtime (azione eseguita + risultato osservato)
- Gap residui (se presenti)

5. Non chiudere uno step come `VERIFIED` senza tutti i criteri soddisfatti.

6. Nessun messaggio evento di default all'avvio.
- La lista notifiche deve partire vuota.
- L'utente crea una notifica scegliendo esplicitamente:
	- da template predefinito, oppure
	- da zero (from scratch).
- Se esiste una regola senza azione esplicita dell'utente, lo step e' `FAILED`.

7. Scope di sessione agente obbligatorio e CLEANUP TOTALE.
- In ogni sessione e per ogni item, l'agente deve mantenere SOLO il codice e le configurazioni esplicitamente richiesti dai criteri di accettazione attivi.
- Qualsiasi funzionalità, parametro, file o elemento UI (es. Telegram, notifiche statiche, campi extra) non menzionato esplicitamente come requisito nel backlog deve essere considerato "fuori scope" e ELIMINATO IMMEDIATAMENTE.
- Non è consentito lasciare "residui" di vecchie implementazioni o dipendenze non più necessarie.
- Un item è `VERIFIED` solo se l'agente ha eseguito il cleanup di tutto ciò che non appartiene strettamente a quell'item o agli item precedenti già verificati.

8. Workflow incrementale obbligatorio per handoff tra agenti.
- Ogni nuovo agente deve eseguire nell'ordine: `verificare` -> `implementare/eliminare` -> `punto finale`.
- `Punto finale` significa: stato item aggiornato, evidenze codice/runtime aggiornate, regressioni dichiarate o assenti dichiarate.
- Se il workflow non e' completo, lo step resta `PARTIAL`.

9. Implementazione full-stack e test obbligatori per nuove feature.
- Se si implementa una nuova feature, la feature deve essere coperta lato backend e lato frontend quando applicabile al requisito.
- La feature deve essere testata al meglio con test rilevanti, preferendo test automatici backend/frontend oltre alla verifica runtime minima richiesta dallo step.

10. Nessun messaggio statico hardcoded per notifiche evento.
- E' vietato avere messaggi fissi in codice per eventi (esempio: "engine_started" con testo statico predefinito).
- Tutti i messaggi evento devono essere definiti dall'utente tramite regole/template salvati in configurazione.
- Se esiste anche un solo evento con messaggio statico non user-defined, lo step e' `FAILED`.

11. Eventi dinamici e pubblicabili da moduli diversi.
- Gli eventi notificabili devono provenire da un catalogo dinamico (event registry / event bus), non da enum hardcoded chiuse nel solo modulo notifiche.
- Qualsiasi parte del codice (engine, scheduler, HA, failsafe, proxy, climate, ecc.) deve poter emettere eventi attraverso API comune.
- L'engine notifiche deve reagire agli eventi emessi esternamente, applicando solo regole utente compatibili.

12. Assenza di commenti nel codice.
- È vietato lasciare commenti nel codice sorgente (es. TODO, spiegazioni, blocchi commentati).
- Il codice deve essere auto-esplicativo; se un commento è necessario per capire il "perché", deve essere rimosso o trasformato in documentazione esterna/commit message.
- Eccezione: commenti di configurazione (es. eslint-disable, ts-ignore) se strettamente necessari.

13. Catalogo eventi minimo obbligatorio.
- Oltre agli eventi gia' presenti, devono essere supportati almeno:
	- `soc_increased`
	- `start_charging`
	- `stop_charging`
	- `plan_start`
	- `plan_updated`
	- `plan_completed`
	- `plan_skipped`
	- `target_soc_reached`
	- `charging_paused`
	- `charging_resumed`
	- `home_power_limit_exceeded`
	- `home_power_limit_restored`
	- `vehicle_connected`
	- `vehicle_disconnected`
	- `failsafe_cleared`
- Il catalogo deve poter essere esteso senza cambiare la UI in modo hardcoded per singolo evento.

14. Regola Generale: Testa sempre prima di continuare.
- È obbligatorio verificare la correttezza sintattica e funzionale (build/test) dopo ogni modifica significativa.
- Non procedere alla feature successiva se quella corrente introduce errori di compilazione o regressioni bloccanti.

15. Aggiornamento Versione Software.
- Per ogni modifica significativa o nuova feature, è obbligatorio incrementare la versione del software (semver: major.minor.patch).
- La versione deve essere aggiornata coerentemente in: `backend/src/version.ts` (costante `VERSION` e `VERSION_HISTORY`), `package.json` della root e `backend/package.json`.
- Uno step senza aggiornamento versione per modifiche sostanziali è considerato `FAILED`.

16. Veridicità dei default e inizializzazione corretta.
- All'apertura della pagina, ogni campo (test center, selettori, template) deve mostrare dati coerenti con l'evento di default selezionato.
- È vietato avere discordanze tra evento visualizzato e payload/template mostrato (es. Test Center che mostra `engine_started` ma con payload di un altro evento).
- L'inizializzazione deve essere dinamica basata sul catalogo backend, non basata su costanti statiche frontend potenzialmente obsolete.

16. Documentazione UI obbligatoria (Self-Explaining UI).
- Ogni campo di input, selettore, pulsante o sezione editabile deve essere accompagnato da una chiara spiegazione testuale (label descrittiva, sottotitolo o tooltip) che ne spieghi la funzione o il formato atteso.
- Nessun campo deve essere lasciato privo di contesto o con nomi ambigui non documentati direttamente nell'interfaccia.

17. Gestione Dipendenze Emergenti.
- Se l'analisi o l'implementazione di una feature evidenzia una dipendenza funzionale o tecnica da un componente non ancora previsto o non presente nel backlog, l'agente deve aggiungere immediatamente tale dipendenza come nuovo item nel backlog di `features.md`.
- Ogni nuova dipendenza deve contenere i propri criteri di accettazione letterali per poter essere marcata come `VERIFIED`.

18. Aggiornamento Default Config e `.env` Obbligatorio.
- Ogni volta che viene aggiunto o modificato un campo configurabile (config.yaml, .env, Zod schema), il file `config.example.yaml` e, se presente, il template `.env.example` devono essere aggiornati con valore di default o placeholder corretto.
- Lo schema Zod del backend deve fornire valori default espliciti per ogni nuovo campo, in modo che il backend non vada in crash per campi mancanti in installazioni esistenti.
- Un item è `FAILED` se introduce nuovi campi senza aggiornare i file di default corrispondenti.

19. Nomi Variabili e Label UI Significativi.
- Tutte le variabili, i campi config, le label UI e i nomi funzione devono usare nomi semanticamente chiari coerenti col dominio EV: es. `gridPowerW`, `chargerPowerW`, `vehicleVoltageV` invece di nomi ambigui come `powerW`, `carChargeKw`.
- Ogni agente, per ogni step, deve riesaminare esplicitamente i nomi di campi/variabili sia nel codice (backend+frontend) sia nella UI, e correggere eventuali nomi ambigui prima della chiusura dello step.
- La rinomina deve propagarsi end-to-end: schema Zod backend, services, engine, routes, tipi TypeScript frontend, store Zustand, label UI, config.yaml, commenti API.
- Un item che introduce o mantiene nomi ambigui non auto-esplicativi è `FAILED`.

20. Formato Obbligatorio di `session_state.md`.
- Il file `session_state.md` deve rispettare il seguente formato:
  1. **Tabella riassuntiva in testa** con colonne: `# Step` | `Feature` | `Stato` | `Conclusione Breve`. La tabella deve essere aggiornata ad ogni cambio di stato.
  2. **Sezione per ogni step processato** con header `### F-XX – <titolo>` contenente: Stato, Checklist letterale (PASS/FAIL per criterio), Evidenza codice, Evidenza runtime, Gap, Conclusione.
- Il file viene svuotato e reinizializzato all'inizio di ogni sessione con la tabella aggiornata e tutte le feature a `NOT_STARTED` (o allo stato corrente noto).
- L'assenza di questo formato rende invalida la tracciatura dello stato per la sessione corrente.

21. Rimozione Configurazioni Fuori Scope Solo Con Autorizzazione Umana.
- Qualsiasi configurazione non richiesta esplicitamente nel backlog di `features.md` (campi in config.yaml/.env/schema/UI impostazioni) deve essere candidata alla rimozione.
- La rimozione effettiva può avvenire solo previa autorizzazione esplicita umana nella sessione corrente.
- In assenza di autorizzazione, l'agente deve lasciare invariato il campo e registrare in `session_state.md` il candidato da rimuovere con motivazione.
- Uno step che rimuove configurazioni fuori scope senza autorizzazione umana è `FAILED`.

22. Rimuovi ciò che non è espressamente presente in questo file a livello di codice/ui/implementazione seguendo le regole del punto 21.

23. Policy `.env` Minimo Obbligatorio.
- Una configurazione environment resta necessaria anche se molte impostazioni applicative sono persistite nel `.db` o in `config.yaml`, perché contiene variabili runtime e segreti di bootstrap.
- Variabili obbligatorie minime: `DATABASE_URL`, `JWT_SECRET`.
- Variabili opzionali (da tenere come placeholder commentati nel template): `TELEGRAM_BOT_TOKEN` (legacy, migrato automaticamente al DB al primo avvio), `HA_CLIENT_ID`, `HA_CLIENT_SECRET`, `APP_URL`, `FRONTEND_URL`, `PORT`, `LOG_LEVEL`.
- Ogni modifica alla policy `.env` deve aggiornare `backend/.env.example` e la sezione Environment Variables in `README.md`.

24. Tutti i valori configurabili devono essere presenti nella pagina Impostazioni.
- Ogni parametro presente nello schema Zod del backend (`config.ts`) deve essere esposto e modificabile dalla pagina Settings del frontend.
- Il backend deve esporre il valore via GET `/api/settings` e accettare l'aggiornamento via PATCH `/api/settings`.
- Il frontend deve mostrare un campo UI dedicato con label chiara e descrizione per ogni parametro.
- Aggiungere un parametro al solo config.yaml/schema Zod senza esporlo in Settings è `FAILED`.
- Questo include (ma non si limita a): `proxy.chargingPollIntervalMs`, `proxy.windowPollIntervalMs`, `proxy.bodyPollIntervalMs`, `proxy.vehicleDataWindowMs`, `charging.startAmps`, e qualsiasi nuovo parametro aggiunto in futuro.

25. Strategia di Polling Smart per vehicle_data — Two Independent Timers.
- Due timer indipendenti: **body timer** (sempre attivo, intervallo: `bodyPollIntervalMs`) e **vehicle data timer** (condizionale).
- **Body timer**: chiama sempre `body_controller_state` a intervallo fisso (`bodyPollIntervalMs`). Non sveglia il veicolo. Gestisce le transizioni sleep/wake e apre/chiude la finestra vehicle_data.
- **Vehicle data timer**: chiamato SOLO quando la finestra è attiva (intervallo: `windowPollIntervalMs`) o quando il veicolo è in ricarica/engine running (intervallo: `chargingPollIntervalMs`). Si ferma automaticamente quando nessuna condizione è attiva.
- `bodyPollIntervalMs` è indipendente dallo stato della finestra o della ricarica — non viene mai sovrascritto.
- All'avvio di una sessione di ricarica (requestWakeMode) la finestra vehicle_data viene riaperta e il vehicle data timer viene avviato.
- Una implementazione con un singolo timer che sovrascrive bodyPollIntervalMs durante la finestra è `FAILED`.
- Il pannello Proxy nelle impostazioni mostra il countdown della finestra dati attiva e lo stato sleep del veicolo in tempo reale.

26. Regola di Versioning.
- Il numero di versione è contenuto in `backend/src/version.ts` (costante `VERSION`) e deve corrispondere a `backend/package.json` e `frontend/package.json`.
- Ad ogni rilascio significativo (nuova feature, bugfix importante, refactor UX) incrementare la versione secondo SemVer: PATCH per bugfix/UX minori, MINOR per nuove feature, MAJOR per breaking changes.
- Aggiungere sempre un nuovo entry a `VERSION_HISTORY` in `version.ts` con data e sommario della release.
- Aggiornare contemporaneamente `backend/package.json`, `frontend/package.json` e `package.json` (root).
- Il controllo di aggiornamenti usa la GitHub Releases API. Se `GITHUB_TOKEN` è configurato nel backend `.env`, funziona anche su repository privati.
- Mostrare "—" (non "Unknown") quando la versione latest non è recuperabile.

## Protocollo Di Verifica Per Ogni Step

Per ogni item `F-XX`:

1. Leggere il requisito letterale.
2. Cercare implementazione backend + frontend + config collegata.
3. Verificare criterio per criterio con check binario (`PASS/FAIL`).
4. Eseguire build/test rilevanti.
5. Se manca qualcosa: proporre patch minima e applicarla.
6. Rieseguire verifica completa dello stesso item.
7. Eliminare codice non previsto per la sessione corrente, se individuato.
8. Fare il punto finale dello step con esito e anti-regressione.

Template output richiesto:
(Utilizzare `session_state.md` per il tracing dello stato corrente, non scrivere qui i risultati intermedi).

```
F-XX - <titolo>
Stato: VERIFIED | FAILED
Checklist letterale:
- C1 ... PASS/FAIL
- C2 ... PASS/FAIL
- C3 ... PASS/FAIL
Evidenza codice:
- <file>: <simbolo/componente>
Evidenza runtime:
- <comando/azione>: <risultato>
Gap:
- <eventuali gap>
```

## Backlog Features (Con Criteri Letterali)

### F-01 Widget Notifiche (basato su eventi)
Accettazione letterale:
- C1: Pannello dedicato per regole di notifica (Template per eventi).
- C2: Possibilità di definire template personalizzati per ogni evento del sistema.
- C3: La UI deve permettere di attivare/disattivare singole regole.
- C4: La lista iniziale deve essere vuota (punto 6 regole obbligatorie).

### F-01B Sorgente Unica Dei Messaggi Notifica
Accettazione letterale:
- C1: Eliminazione di qualsiasi fallback di testo statico nel backend per le notifiche (punto 10 regole obbligatorie).
- C2: Nessun messaggio deve essere inviato se l'utente non ha definito una regola/template corrispondente.
- C3: **Costruttore Regole Avanzate**: La creazione di regole avanzate deve supportare:
	- C3.1: Selezione del campo da una lista a discesa basata sui placeholder validi per l'evento.
	- C3.2: **Condizioni Delta**: Supporto per operatori `changed` (diverso dal precedente), `increased_by` (aumentato di X), `decreased_by` (diminuito di X).
	- C3.3: **Condizioni Modulo**: Operatore `mod_step` (triggera ogni volta che il valore attraversa un multiplo di X, es. ogni 10% di SoC).
- C4: Sotto l'etichetta del pannello (o specifica sezione) deve essere indicato chiaramente che i messaggi vengono inviati SOLO se esiste una regola configurata.

### F-02 Mostra Tutti I Placeholder
Accettazione letterale:
- C1: Lista placeholder visibile in UI tramite pulsante di Help o Finestra Popup (non staticamente sulla pagina).
- C2: I placeholder devono essere consolidati in un unico punto dell'interfaccia (non ripetuti in più sezioni).
- C3: Ogni placeholder deve avere una descrizione chiara del significato e del tipo di dato previsto.
- C4: La lista deve filtrare o evidenziare quali placeholder sono disponibili per lo specifico evento selezionato.

### F-03 Centro Test E Schemi Evento
Accettazione letterale:
- C1: Ogni evento nel catalogo deve definire uno schema di campi/payload obbligatori/previsti (es. engine_started deve richiedere sessionId, targetSoc).
- C2: Il Test Center deve impedire l'invio di test con payload non congruenti con l'evento selezionato (validazione schema).
- C3: Il Test Center deve fornire preset di payload validi per ogni tipo di evento, invece di un JSON generico unico.
- C4: Il risultato del test deve mostrare chiaramente se il template dell'utente ha usato placeholder non presenti nel payload dell'evento (warning di missing placeholders).
- C5: Possibilità di generare un evento "reale" nel sistema (bus eventi) dal Test Center per verificare la reazione di tutte le regole collegate.
- C6: Gestione esplicita degli errori di pre-requisito: il Test Center deve segnalare se l'invio non è possibile a causa di configurazioni mancanti (es: Bot Token mancante, Chat ID non impostati, Telegram disabilitato).

### F-04 Token API In Sola Scrittura
Requisito: "Permettere di inserire il token API solo in modalità write-only"
Accettazione letterale:
- C1: Campo token configurabile in UI (Telegram Bot Token).
- C2: Il token deve essere salvato esclusivamente nel file `.env` del backend per ragioni di sicurezza, MAI nel file `config.yaml`.
- C3: Il token esistente deve essere oscurato (es: "********") in qualsiasi risposta `GET` dall'API.
- C4: La UI deve permettere di inserire un nuovo token senza esporre quello precedente.
- C5: Se l'utente invia il valore oscurato (********) in una `PATCH`, il backend deve ignorare il campo (mantenendo il token in `.env`).
- C6: Se il file `.env` non esiste, il backend deve crearlo o aggiornarlo dinamicamente al salvataggio del token.
- C7: Il servizio Telegram deve ricaricare il token dal `.env` immediatamente dopo il salvataggio senza riavvio.

### F-05 Gestione Completa Degli Allowed Chat IDs
Requisito: "Permettere di inserire tutti gli Allowed Chat IDs"
Accettazione letterale:
- C1: Inserimento multiplo IDs.
- C2: Persistenza corretta in config.
- C3: Nessuna perdita di valori al reload.

### F-06 Elimina Tutti I Messaggi Evento
Requisito: "Permettere di eliminare tutti i messaggi evento"
Accettazione letterale:
- C1: Azione bulk "delete all" disponibile.
- C2: Cancella tutti i template evento/regole evento.
- C3: Stato persistito dopo save/reload.

### F-07 Carica Esempio O Genera Da Zero
Requisito: "Possibilità di caricare un esempio o generare da zero."
Accettazione letterale:
- C1: Azione "Carica esempio" presente.
- C2: Azione "Genera da zero" presente e produce set vuoto (nessuna regola).
- C3: Quando l'utente aggiunge una notifica, deve scegliere esplicitamente tra template o creazione da zero.
- C4: Entrambe le azioni non devono corrompere regole salvate accidentalmente.

### F-08 Temi Dashboard
Requisito: "Tema differente (dark, white)"
Accettazione letterale:
- C1: Almeno 2 temi selezionabili in runtime (dark e white).
- C2: Persistenza preferenza tema.
- C3: Tema applicato a dashboard completa, non solo a singoli blocchi.

### F-09 Dashboard Tutte Le Informazioni
Requisito: "Tutte le informazioni (corrente attuale, corrente desiderata, tensione, fase, time to full letto dal messaggio)"
Accettazione letterale:
- C1: Tutti i campi indicati sono visibili.
- C2: "time to full" e campi marcati "read from message" derivano da messaggio corretto.
- C3: Label e unita' coerenti.

### F-10 Metriche Potenza In Testa Pagina
Requisito: "In cima alla pagina (consumo totale attuale casa, consumo casa senza charger (home_total - charger))"
Accettazione letterale:
- C1: Entrambe le metriche sono nella sezione superiore della dashboard.
- C2: Formula home_without_charger = home_total - charger rispettata letteralmente.
- C3: Aggiornamento live coerente con stream dati.

### F-11 Orario Prossimo Avvio Ricarica (stile EVCC)
Requisito: "Mostrare l'orario di inizio della prossima ricarica come EVCC"
Accettazione letterale:
- C1: Orario prossimo avvio visibile in dashboard.
- C2: Derivato da scheduler reale (non placeholder statico).
- C3: Formato orario chiaro.

### F-12 Log Motore
Requisito: "Log del motore"
Accettazione letterale:
- C1: Sezione log dedicata in dashboard.
- C2: Aggiornamento runtime.
- C3: Contiene eventi rilevanti del motore.

### F-13 Configurazione - Modalità Demo
Requisito: "Modalità Demo (toggle switch)"
Accettazione letterale:
- C1: Toggle presente in configurazione.
- C2: Persistenza + effetto runtime.
- C3: Indicatore demo visibile nell'app.

### F-14 Configurazione - Pannello Home Assistant
Requisito: "url, entità potenza totale casa, entità charger, autorizzazione Home Assistant con stato di validità e lettura dell'entità"
Accettazione letterale:
- C1: Campi URL, home total power entity, charger entity presenti.
- C2: Flusso autorizzazione presente.
- C3: Stato di validità visibile.
- C4: Lettura entita' configurate verificabile.

### F-15 Configurazione - Carico Di Potenza
Requisito: "massimo consumo di potenza consentito"
Accettazione letterale:
- C1: Campo configurabile presente.
- C2: Usato realmente nel throttle/pausa.
- C3: Verifica runtime con superamento soglia.

### F-16 Configurazione - Ricarica
Requisito: "capacità batteria, A min, A max, A iniziali, frequenza loop"
Accettazione letterale:
- C1: Tutti i campi presenti e persistenti.
- C2: Il motore li usa realmente.
- C3: Validazioni min/max coerenti.

### F-17 Configurazione - Proxy
Requisito: "URL proxy, vehicle Id, nome veicolo, parametri di polling e wake"
Accettazione letterale:
- C1: Sono configurabili almeno `proxyUrl`, `vehicleId`, `vehicleName`, `normalPollIntervalMs`, `scheduleLeadTimeSec`, `rejectUnauthorized`.
- C2: I campi proxy sono persistiti via `config.yaml` e via API strutturata `GET/PATCH /api/settings`.
- C3: `proxyUrl` e `vehicleId` sono usati in tutte le chiamate proxy/emulatore.
- C4: `normalPollIntervalMs` governa il refresh `vehicle_data`, `scheduleLeadTimeSec` governa il pre-wake scheduler, `rejectUnauthorized` governa il client HTTPS verso il proxy.

### F-18 Modalità Del Motore Di Ricarica
Requisito: "Off, Plan, On"
Accettazione letterale:
- C1: Tre modalita' distinte selezionabili.
- C2: Ogni modalita' ha comportamento diverso verificabile.
- C3: Stato modalita' visibile in UI.

### F-19 Ramp Del Motore Di Ricarica
Requisito: "Riduzione immediata degli ampere in throttle; ramp up a intervallo configurabile usando la formula Home Total Power (vedi F-22)"
Accettazione letterale:
- C1: In riduzione: throttle immediato al valore massimo consentito dalla griglia.
- C2: In ripresa: il setpoint viene ricalcolato ad ogni intervallo (Ramp Up Interval) usando la formula definita in F-22.
- C3: Se Home Total Power non disponibile (HA disconnesso o valore nullo): nessun ramp, mantieni il setpoint corrente.
- C4: L'intervallo di aggiornamento è il campo `rampIntervalSec` configurabile nelle impostazioni.
- C5: Verifica con test automatici: throttle immediato su riduzione + aggiornamento corretto ad ogni step.
- C6: Chiarezza UI: il campo nelle impostazioni deve essere etichettato in modo esplicito come intervallo di ramp up o refresh del loop.

### F-20 Event Bus Dinamico Delle Notifiche
Requisito: "Gli eventi sono dinamici e possono essere generati da altre parti del codice; il motore notifiche reagisce agli eventi emessi."
Accettazione letterale:
- C1: Esiste un event bus/registry notifiche riusabile da moduli multipli (engine, scheduler, HA, failsafe, proxy, climate).
- C2: I producer evento pubblicano su API comune senza dipendere direttamente dal trasporto Telegram.
- C3: L'engine notifiche ascolta eventi pubblicati e applica matching regole utente + render template.
- C4: API/UI leggono il catalogo eventi da backend dinamicamente, senza lista hardcoded fissa lato frontend.
- C5: Aggiunta nuovo evento nel backend deve comparire in UI senza patch specifica di componenti evento.
- C6: Test automatici coprono almeno: emissione evento, dispatch rule match/no-match, e assenza di fallback statico.

### F-21 Stato Proxy E Auto Separato (Endpoint Unico)
Requisito: "Usare solo vehicle_data per lo stato runtime; distinguere proxy connesso da auto in garage e mostrare sempre reason"
Accettazione letterale:
- C1: Il polling runtime stato usa solo `GET /api/1/vehicles/{VIN}/vehicle_data`.
- C2: `vehicle_data.response.result === true` deve essere interpretato come auto in garage/raggiungibile.
- C3: `vehicle_data.response.result === false` deve essere interpretato come proxy raggiungibile ma auto non in garage/non raggiungibile.
- C4: Errori rete/timeout del polling devono indicare proxy non raggiungibile.
- C5: Dashboard deve restare visibile con WS attivo anche quando auto non raggiungibile.
- C6: Nel pannello centrale Dashboard devono essere mostrati separatamente stato proxy, stato auto e reason.
- C7: In Settings (pannello Proxy) devono essere mostrati separatamente stato proxy, stato auto e reason.
- C8: La reason deve essere sempre visibile in Dashboard e Settings (success/failure).
- C9: Documentazione aggiornata in `README.md` coerente con C1-C8.

### F-21 Pannello Impostazioni Esteso
Accettazione letterale:
- C1: Modalità demo (toggle switch) presente in Settings. Quando attiva, deve generare valori simulati per TUTTE le entità (home total power + charger power).
- C2: Pannello Home Assistant con: URL, Home Total Power Entity, Charger Power Entity. TUTTE le entità HA sono obbligatorie.
- C3: Pulsante "Connetti" per flusso OAuth Home Assistant con indicazione di validità.
- C4: Lettura realtime delle entità HA direttamente nel pannello settings per verifica.
- C5: Pannello Proxy con: URL e VIN (Vehicle Identification Number).
- C6: Pannello Charging Engine Rules con: Max Home Power, Battery Capacity, Start A, Min A, Max A, time increase for each step A.
- C7: Sezione "Full configuration yaml" per visualizzazione/editing avanzato.
- C8: Pulsante "Sign-out" spostato in ALTO nella pagina (non in fondo).

### F-22 Algoritmo Smart Current Del Motore Di Ricarica
Requisito: "Engine calcola la corrente di ricarica usando: Home Total Power - Charger Power = Residual Power; Residual Power / Vehicle Voltage = A delta; New setpoint = A actual + A delta; usa il tempo di loop (Ramp Up Interval) configurabile da settings."
Accettazione letterale:
- C1: Formula end-to-end implementata: `Residual Power W = Home Total Power W - Charger Power W`.
- C2: `A delta = Residual Power W / Vehicle Voltage V` (ampere disponibili dalla rete residua).
- C3: `New setpoint amps = A actual + A delta` (non incremento fisso +1A).
- C4: Il campo `rampIntervalSec` è configurabile nelle impostazioni e usato come intervallo di aggiornamento del loop engine.
- C5: Fallback se Home Total Power non disponibile (HA disconnesso): mantieni setpoint corrente senza variazioni.
- C6: Test automatici verificano la formula con valori noti: Home Total Power X, Charger Power Y, Voltage Z -> setpoint atteso calcolato correttamente.

### F-23 Modalita Plan Persistente
Requisito: "Plan e' un selettore funzionale persistente e non deve richiedere riarmo dopo ogni piano."
Accettazione letterale:
- C1: Se l'utente seleziona `Plan`, la modalita resta `Plan` durante e dopo l'esecuzione del piano.
- C2: La modalita passa a `Off` solo con azione esplicita di stop/disarmo utente.
- C3: Lo scheduler avvia piani solo quando la modalita engine non e' `Off`.
- C4: La UI mostra stato modalita coerente con backend in runtime.

### F-24 Interrompi Ricarica Allo Start
Requisito: "Se abilitata, una ricarica partita dallo scheduler interno Tesla deve essere interrotta quando parte uno schedule di EVload, cosi l'engine mantiene il controllo esclusivo."
Accettazione letterale:
- C1: Esiste configurazione `stopChargeOnManualStart` in settings/config.
- C2: Con toggle attivo (ON), qualsiasi avvio engine (schedulato o manuale) controlla se la macchina è già sotto carica; se sì manda `charge_stop` prima di prendere il controllo.
- C3: Con toggle disattivo (OFF), se la macchina è già sotto carica al momento dello start engine, evload non la stoppa ma gestisce solo la potenza (throttle/stop HA) per evitare il distacco del contatore.
- C4: Opzione visibile e persistente nel pannello Settings -> Engine Options, con descrizione coerente.
- C5: In entrambi i casi (ON e OFF), il log registra chiaramente: stato rilevato, corrente effettiva, soc, e quale azione è stata intrapresa (`charge_stop` vs `power management only`).
- C6: Il proxy poll registra ogni transizione `charging false→true` e `charging true→false` con context (stato, corrente, soc), indipendentemente dal motore engine.
- C7: La rilevazione avviene anche a motore fermo (engine idle/off/plan): quando il poll individua la macchina in carica per la prima volta (`charging_started` event), se `stopChargeOnManualStart=true` e il motore non è in esecuzione, viene inviato immediatamente `charge_stop` senza attendere un successivo avvio manuale o schedulato.

### F-25 Coerenza Lingua UI E Selettore Engine Sempre Disponibile
Requisito: "La UI deve restare in inglese coerente e lo stato engine deve essere selezionabile anche con auto sleep/offline."
Accettazione letterale:
- C1: Label e testi delle nuove sezioni Dashboard/Settings sono in inglese.
- C2: Pulsanti mode `Off/Plan/On` non vengono disabilitati per `proxy offline` o `vehicle sleep`.
- C3: Disabilitazione mode consentita solo per loading locale o failsafe attivo.
- C4: Il comportamento reale del backend resta protetto da guardrail di sicurezza anche con selettori disponibili.
- C7: Tutte le variabili interne usano nomi espliciti di dominio: `homeTotalPowerW`, `chargerPowerW`, `vehicleVoltageV`, `residualPowerW`, `deltaAmps` (regola 19).

### F-23 Scheduler Extended Windows + Telegram Scope Cleanup
Requisito: "Telegram va gestito solo in Notifications; scheduler climate con opzione inizio/fine; scheduler charging con opzione aggiuntiva inizio+fine oltre start_at e finish_by."
Accettazione letterale:
- C1: La pagina Settings non contiene piu' sezione Telegram.
- C2: Le configurazioni Telegram restano disponibili nella pagina Notifications senza regressioni.
- C3: Scheduling charging supporta tre modalita': `start_at`, `finish_by`, `start_end`.
- C4: Scheduling climate supporta due modalita': `start_at`, `start_end`.
- C5: Per `start_end` sono obbligatori `scheduledAt` e `finishBy`, con validazione `finishBy > scheduledAt`.
- C6: Runtime scheduler esegue sia fase start che fase stop per schedule `start_end` (charging e climate).
- C7: Build frontend/backend e test automatici passano dopo l'estensione.

### F-24 Energy Price Per kWh + Cost Tracking
Requisito: "Impostare il costo per kWh da Settings, tracciare i costi nelle Statistics e aggiornare il valore in Dashboard in realtime."
Accettazione letterale:
- C1: In Settings esiste campo `energyPriceEurPerKwh` (EUR/kWh), persistente su config.
- C2: Dashboard mostra prezzo corrente per kWh e costo realtime derivato dalla potenza di ricarica istantanea.
- C3: Ogni sessione salva snapshot tariffa e costo totale sessione.
- C4: Statistics mostra costo totale, costo medio sessione e costo per sessione.
- C5: I calcoli costo usano formula `cost = energyKwh * energyPriceEurPerKwh`.

### F-25 Endpoint Proxy Vehicle Data (testdata.json)
Requisito: "Usare gli endpoint presenti in testdata.json per leggere lo stato auto e aggiornare anche emulatore."
Accettazione letterale:
- C1: Polling backend usa endpoint `GET /api/1/vehicles/{VIN}/vehicle_data`.
- C2: Supporto endpoint mirato `GET /api/1/vehicles/{VIN}/vehicle_data?endpoints=charge_state`.
- C3: Parsing campi da payload annidato (`response.response.charge_state`, `response.response.climate_state`).
- C4: Gestione stato `vehicle is sleeping` senza crash del ciclo polling.
- C5: Emulatore espone endpoint `vehicle_data` coerenti con i payload contrattuali.
- C6: Nessun riferimento a endpoint `summary` inesistente nel flusso runtime/contract.

### F-26 Nome Veicolo Nelle Impostazioni
Requisito: "Possibilità di impostare un nome macchina da Settings, subito sotto il VIN."
Accettazione letterale:
- C1: Nelle impostazioni è presente il campo `Vehicle Name` immediatamente sotto il campo VIN.
- C2: Il valore è persistente via API settings e salvato in configurazione.
- C3: Il nome configurato viene usato come display name runtime quando il provider non ne restituisce uno.
- C4: Build e test automatici includono verifica persistenza `vehicleName`.

### F-27 Architettura Informativa Della Sidebar
Requisito: "Riordinare le pagine laterali in un ordine moderno e coerente con il flusso operativo dell'app."
Accettazione letterale:
- C1: Ordine sidebar orientato al task flow principale: `Dashboard`, `Schedule`, `Climate`, `Statistics`, `Notifications`, `Settings`.
- C2: Nessun riferimento a endpoint legacy/non esistenti nel pannello demo sidebar (es. `vehicle.summary`).
- C3: Build frontend valida dopo il riordino IA.

### F-28 Dashboard Time To Full + UX Simulatore Mobile
Requisito: "Il Time To Full in dashboard deve aggiornarsi in modo affidabile; il simulatore non deve rompere il layout in modalità telefonino."
Accettazione letterale:
- C1: `timeToFullChargeH` viene popolato anche quando l'API fornisce valori incompleti, con fallback calcolato da SoC, capacità batteria e potenza di carica.
- C2: Dashboard mostra Time To Full aggiornato runtime da stream websocket senza freeze su valore nullo persistente.
- C3: In mobile il simulatore non occupa sidebar fissa: apertura tramite bottone in alto con pannello popup/overlay chiudibile.
- C4: In desktop il simulatore resta disponibile come pannello laterale dedicato.
- C5: Build frontend/backend valide dopo il refactor UX + calcolo fallback.

### F-29 Affidabilità Di Apply Manual State Nel Simulatore Demo
Requisito: "Apply Manual State deve applicare i valori inseriti senza essere sovrascritto durante l'editing e deve avere test automatici dedicati."
Accettazione letterale:
- C1: I campi manuali del simulatore non vengono riscritti ad ogni aggiornamento websocket mentre l'utente sta editando.
- C2: È disponibile azione esplicita per sincronizzare i campi manuali con lo stato live corrente (`Sync Inputs From Live State`).
- C3: Dopo `Apply Manual State`, il pannello evidenzia endpoint coerente con lo stato aggiornato (`vehicle.charge_state`).
- C4: Test backend automatici coprono route `PUT /vehicle/data-request/:section` (successo, validazione sezione, VIN mancante).
- C5: Test backend automatici coprono il blocco comandi con failsafe attivo su route vehicle.

### F-30 IA Settings + Time-To-Full Consapevole Del Target + Chiusura Simulatore
Requisito: "Riordinare Settings con focus sul blocco Charging Engine; rendere sempre chiudibile il pannello simulator; rendere Time To Full dipendente dal target SOC rispetto al target auto nella risposta JSON."
Accettazione letterale:
- C1: In Settings il blocco Charging Engine è riordinato in gruppi leggibili (Power/Loop, Battery/Cost, Current Limits) con layout più chiaro.
- C2: Il pannello simulator è apribile/chiudibile anche su desktop con la stessa logica d'uso già presente in mobile (azione esplicita di close).
- C3: Lo stato veicolo espone il target auto letto dalla risposta JSON (`charge_limit_soc`) e la UI mostra un segnalino dedicato sul grafico SoC.
- C4: Se target selezionato utente = target auto: Time To Full usa direttamente il valore veicolo.
- C5: Se target selezionato utente < target auto: Time To Full viene ricalcolato manualmente.
- C6: Se target selezionato utente > target auto: la UI mostra errore esplicito e blocca avvio `plan/on` fino a target valido.
- C7: Build frontend/backend e test backend passano dopo l'integrazione.

### F-31 Mapping Completo JSON Veicolo + Fedeltà Stato Cavo
Requisito: "La dashboard deve riflettere correttamente lo stato cavo usando i campi completi del JSON veicolo; il limite hardware auto deve essere indicato in barra SoC con linea verticale interna."
Accettazione letterale:
- C1: Mapping backend esteso da `charge_state` includendo almeno `conn_charge_cable`, `charge_port_latch`, `charge_port_door_open`, `charge_current_request`, `charge_current_request_max`, `usable_battery_level`.
- C2: Lo stato `pluggedIn` non è dedotto solo da `charging_state`, ma da combinazione robusta dei campi cavo/porta/latch del payload reale.
- C3: Dashboard mostra stato cavo dettagliato (tipo cavo + latch + stato porta) invece di solo plugged/unplugged.
- C4: In SoC bar il limite hardware auto (`charge_limit_soc`) è rappresentato con linea verticale interna alla barra, senza label testuale "Selected Target".
- C5: Build frontend/backend e suite test backend restano verdi dopo l'aggiornamento.

### F-32 Fedeltà Completa Del Payload Demo + Verifica Motore Via charging_state
Requisito: "Il simulatore demo deve generare payload `vehicle_data` esteso coerente al JSON reale e offrire controlli utili (es. `charge_limit_soc`, `charging_state`) per verificare il comportamento dell'engine."
Accettazione letterale:
- C1: `fleet-simulator` restituisce `charge_state` e `climate_state` con set esteso di campi reali (timestamps, limiti SoC min/max, charge port/cable metadata, correnti request, placeholder HVAC avanzati) mantenendo shape compatibile al JSON Tesla.
- C2: Endpoint demo `PUT /data_request/charge_state` accetta almeno `charge_limit_soc`, `charging_state`, correnti e campi utili al test dinamico dell'engine.
- C3: Nel pannello simulator UI sono disponibili input per `charge_limit_soc` e `charging_state` oltre ai controlli esistenti.
- C4: Il pannello simulator mostra un hint di coerenza tra stato engine e `charging_state` per verificare rapidamente mismatch runtime.
- C5: In Dashboard, vicino al blocco `Limit`, viene mostrato warning esplicito quando limite auto < target selezionato.
- C6: Build frontend/backend e test backend passano dopo l'estensione.

### F-33 Riscrittura Ordinata Dashboard + Charging Recap
Requisito: "Riscrivere la Dashboard in modo più ordinato mantenendo i dati attuali ma riducendo ridondanze e spostando il dettaglio sotto la card principale in un recap coerente."
Accettazione letterale:
- C1: Sotto la card principale non esistono più pannelli metrici ridondanti sparsi; i dati sono raccolti in un recap unico e leggibile.
- C2: Il recap separa chiaramente informazioni operative da diagnostica elettrica/limiti.
- C3: Le metriche duplicate già mostrate sopra (es. Home Total/Home Without Charger) non vengono replicate inutilmente in card secondarie.
- C4: La Dashboard mantiene comunque visibili i dati necessari al debug charge loop (actual/pilot/request/max, voltage/phases, hardware range, cable status).
- C5: Gerarchia visiva ordinata: card principale, recap, log engine.

### F-34 Revisione Logica Polling Proxy
Requisito: "La logica di polling non deve fare chiamate ridondanti ad ogni tick quando `vehicle_data` contiene già le informazioni necessarie."
Accettazione letterale:
- C1: Il polling usa `vehicle_data` come sorgente primaria di stato.
- C2: La richiesta `vehicle_data?endpoints=charge_state` viene eseguita solo come fallback quando il payload completo non contiene `charge_state` utile.

### F-35 Persistenza Stato Pannelli UI
Requisito: "Salva lo stato di ogni pannello se è stato compresso o no."
Accettazione letterale:
- C1: I pannelli comprimibili di Dashboard mantengono lo stato expand/collapse dopo refresh pagina.
- C2: I pannelli comprimibili di Notifications mantengono lo stato expand/collapse dopo refresh pagina.
- C3: I pannelli comprimibili di Settings mantengono lo stato expand/collapse dopo refresh pagina.
- C4: La persistenza avviene senza rompere il caricamento iniziale delle pagine.

### F-36 Cancellazione Sessioni In Statistics Con Doppia Conferma
Requisito: "Con un doppio conferma dammi la possibilità di cancellare delle ricarica della statistica."
Accettazione letterale:
- C1: La pagina Statistics espone un'azione di delete per ogni sessione di ricarica.
- C2: La delete richiede doppia conferma esplicita prima della rimozione definitiva.
- C3: Il backend espone una route autenticata per eliminare una sessione e la relativa telemetria.
- C4: Dopo la delete la lista Statistics si aggiorna senza lasciare selezioni stale nel dettaglio sessione.
- C5: README e backlog features documentano la funzionalità.

## Logica Di Comunicazione EVLoad <-> Proxy (Implementata)

Questa sezione descrive il comportamento effettivamente implementato nel codice attuale tra EVLoad e il proxy Tesla (TeslaBleHttpProxy).

### Principio Fondamentale: Il Polling Non Sveglia Il Veicolo

TeslaBleHttpProxy **non** sveglia il veicolo quando riceve `GET /vehicle_data` (senza `?wakeup=true`).
I comandi POST (`charge_start`, `charge_stop`, `set_charging_amps`, `wake_up`) invece svegliano automaticamente il veicolo.
EVLoad sfrutta questo comportamento per separare il polling diagnostico (sicuro, non invasivo) dai comandi operativi (che richiedono il veicolo sveglio).

### Flusso Runtime

- EVLoad usa un client HTTP dedicato verso il proxy con TLS configurabile tramite `proxy.rejectUnauthorized`.
- Il polling gira su un singolo loop con intervallo `proxy.normalPollIntervalMs`.
- Ad ogni tick viene chiamato `GET /api/1/vehicles/:vehicleId/vehicle_data` senza parametri wake.
- Ogni risposta riuscita del proxy aggiorna `proxyHealthState` con `connected`, `lastSuccessAt`, `lastEndpoint`, `error`.
- Lo stato proxy e lo stato veicolo sono separati: `proxy.connected = true` anche quando l'auto dorme.

### Gestione Risposta Sleep Del Proxy

Il proxy TeslaBleHttpProxy può restituire una risposta HTTP non-200 quando il veicolo è addormentato, con payload del tipo:

```json
{ "response": { "result": false, "reason": "vehicle is sleeping" } }
```

EVLoad intercetta questi casi in `proxyGet`: se la risposta non-200 contiene una `reason` che include `sleep`, `asleep`, `offline` o `unavailable`, il proxy viene marcato come **raggiungibile** (`proxy.connected = true`) e il corpo viene letto normalmente per estrarre lo stato sleep.

### Interpretazione Del Payload `vehicle_data`

| Condizione payload | `proxy.connected` | `vehicle.connected` | `vehicle.vehicleSleepStatus` |
|---|---|---|---|
| `result: true` + `charge_state` presente | `true` | `true` | `AWAKE` |
| `result: false` + reason contiene "sleep" | `true` | `false` | `ASLEEP` |
| `result: false` + altra reason | `true` | `false` | `AWAKE` |
| Errore rete / timeout | `false` | invariato | invariato |

Da `vehicle_data` EVLoad ricava: stato ricarica, SoC, limiti, temperatura, tensione, corrente, fasi, range, lock state, odometro e raw payload diagnostici.

### Poll Immediato All'Avvio Motore

Quando l'utente preme Start, `POST /api/engine/start` chiama `triggerImmediatePoll()` in fire-and-forget.
Questo cancella il timer del prossimo poll schedulato ed esegue subito `pollProxyOnce()`, evitando attese fino a `normalPollIntervalMs`.

### Guard Comandi Su Veicolo Disconnesso

`stopEngine()` verifica `vState.connected` prima di inviare `charge_stop`:
- `vehicle.connected = true` → invia `charge_stop` normalmente.
- `vehicle.connected = false` → **salta** `charge_stop` per non risvegliare il veicolo involontariamente.

Lo stesso principio si applica a qualsiasi comando operativo.

### Comandi Verso Il Proxy

- Avvio manuale motore: `startEngine()` chiama `requestWakeMode(true)` (sveglia il veicolo) poi `triggerImmediatePoll()`.
- Wake manuale esplicito: `POST /api/engine/wake` chiama `requestWakeMode(true)` e invia `POST /api/1/vehicles/:vehicleId/command/wake_up`.
- Scheduler: usa `requestWakeMode(true)` nella lead window `scheduleLeadTimeSec` e prima degli start pianificati.
- Comandi runtime: `POST /api/1/vehicles/:vehicleId/command/:command`.
- Aggiornamenti dati mutabili: `PUT /api/1/vehicles/:vehicleId/data_request/:section`.

### Stato Live Esposto Alla UI

WebSocket backend espone separatamente `proxy` e `vehicle`.
- `proxy.connected`: proxy HTTP raggiungibile (rimane `true` durante sleep veicolo).
- `vehicle.connected`: veicolo raggiungibile (da `vehicle_data.response.result`).
- `vehicle.vehicleSleepStatus`: stato sleep interpretato dalla risposta.
- Dashboard mostra "Sleeping" invece di "Not in garage" quando `vehicle.connected = false` e `vehicleSleepStatus = ASLEEP`.
- Pannello Proxy in Settings: badge giallo "SLEEP" quando proxy è up ma veicolo dorme.

### Tabella Operativa Endpoint Proxy

| Endpoint proxy | Metodo | Chi lo usa | Quando parte | Effetto principale |
|---|---|---|---|---|
| `/api/1/vehicles/:vehicleId/vehicle_data` | `GET` | `proxy.service` | Loop periodico su `normalPollIntervalMs` + trigger immediato su start engine | Aggiorna stato veicolo completo, proxyHealthState e diagnostica raw. Non sveglia il veicolo. |
| `/api/1/vehicles/:vehicleId/command/wake_up` | `POST` | `requestWakeMode(true)` via engine route o scheduler | Wake manuale o pre-wake schedulato | Sveglia attivamente il veicolo. |
| `/api/1/vehicles/:vehicleId/command/charge_start` | `POST` | engine / scheduler | Avvio ricarica (solo se `vehicle.connected = true`) | Sveglia il veicolo se dormiente e avvia la ricarica. |
| `/api/1/vehicles/:vehicleId/command/charge_stop` | `POST` | engine / scheduler | Stop engine (solo se `vehicle.connected = true`) | Ferma la ricarica. Skippato se veicolo disconnesso per evitare wake non voluto. |
| `/api/1/vehicles/:vehicleId/command/set_charging_amps` | `POST` | engine | Durante throttling HA e ramp | Aggiorna il current request del veicolo. |
| `/api/1/vehicles/:vehicleId/command/set_temps` | `POST` | climate / scheduler | Start climate manuale o schedulato | Imposta temperature abitacolo. |
| `/api/1/vehicles/:vehicleId/data_request/charge_state` | `PUT` | servizi backend | Quando serve aggiornare dati mutabili Tesla lato proxy | Aggiorna `charge_state` via proxy. |
| `/api/1/vehicles/:vehicleId/data_request/climate_state` | `PUT` | servizi backend | Quando serve aggiornare dati clima lato proxy | Aggiorna `climate_state` via proxy. |

### Nota Su F-40 (Polling Adattivo / Heartbeat)

Implementazione parziale:
- Il backend mantiene un loop adattivo che usa `normalPollIntervalMs` (default 5s) durante la ricarica o quando l'engine è in esecuzione, e passa a `idlePollIntervalMs` (default 60s) quando il veicolo è inattivo per permettere lo sleep.
- Heartbeat separato via `body_controller_state` è ancora nel backlog.

## F-35 Pannelli Di Dominio Collassabili Nelle Impostazioni
- La pagina impostazioni deve essere organizzata in pannelli di dominio collassabili invece di un unico form lungo e continuo.

### F-40 Polling Proxy Adattivo In Sleep + Wake Reattivo In Garage
Requisito: "Ridurre wake inutili del veicolo con polling adattivo, ma restare reattivi in garage e prima degli avvii schedulati."
Accettazione letterale:
- C1: Il backend mantiene due loop distinti: refresh completo `vehicle_data` su `normalPollIntervalMs` e heartbeat `body_controller_state` su `reactivePollIntervalMs`.
- C2: `body_controller_state` viene usato come heartbeat leggero continuo e aggiorna sia `proxyHealthState` sia `vehicleSleepStatus` / `userPresence`.
- C3: In `NORMAL`, dopo due conferme consecutive di sleep e assenza di ricarica attiva, il sistema passa a `REACTIVE` senza inviare comandi wake.
- C4: In `REACTIVE`, quando `userPresence` risulta `VEHICLE_USER_PRESENCE_PRESENT` oppure `vehicleSleepStatus` torna `AWAKE`, il sistema torna a `NORMAL`.
- C5: `requestWakeMode(false)` forza `NORMAL` senza `wake_up`; `requestWakeMode(true)` forza `NORMAL`, resetta i timer e invia `wake_up` quando il VIN e' configurato.
- C6: Scheduler usa `requestWakeMode(true)` sia nella lead window configurabile `scheduleLeadTimeSec` sia immediatamente prima degli start pianificati; l'engine usa `requestWakeMode(false)` allo start manuale.
- C7: E' disponibile endpoint API autenticato `POST /api/engine/wake` e lo stato websocket espone sia `pollMode` sia `proxy` per la UI.
- C8: Il simulatore supporta `GET /api/1/vehicles/:vehicleId/body_controller_state` con campi `vehicleSleepStatus`, `vehicleLockState` e `userPresence` coerenti.
- C9: La dashboard frontend mostra il badge modalità e il pulsante `Wake Vehicle`; le impostazioni mostrano lo stato live del proxy e i campi `normalPollIntervalMs`, `reactivePollIntervalMs`, `scheduleLeadTimeSec`, `rejectUnauthorized`.
- I pannelli principali devono essere: Home Assistant, Proxy, Opzioni Engine e YAML.
- Ogni pannello deve mantenere raggruppati gli input correlati e consentire di ridurre il rumore visivo collassando le sezioni non in modifica.
- Le impostazioni legate all'engine devono evitare campi duplicati su più card, così ogni controllo ha un solo punto chiaro nella UI.

## F-36 Widget Di Composizione Del Carico In Dashboard
- La sezione superiore della dashboard deve presentare il consumo domestico usando un widget più ampio e multi-colonna invece di card metriche isolate.
- Il widget deve includere una barra di composizione chiara che separi visivamente il carico base della casa dal carico EV usando colori distinti.
- Il consumo totale di casa deve restare un valore riepilogativo separato sopra la barra suddivisa.
- Le etichette della riga di split devono restare minimali e non ripetere esplicitamente formule di sottrazione se la struttura visiva rende già chiaro il significato.
- La struttura visiva deve seguire un layout energy-flow ispirato a EVCC, con la barra orizzontale del carico come elemento dominante e statistiche secondarie minimali.
- Label e testo di supporto dentro questo widget superiore devono restare coerenti con il resto dell'app: in inglese e intenzionalmente minimali.
- L'area superiore deve usare un layout responsive a due colonne sugli schermi larghi, con il widget energy-flow accanto alla card principale di controllo ricarica.
- Il widget energy-flow non deve duplicare costi live di ricarica o tariffa se sono già presentati nella card di controllo adiacente.
- Su mobile stretto, i due widget superiori devono restare abbastanza compatti da essere visibili il più possibile in una singola schermata.
- I widget superiori devono privilegiare densità verticale compatta rispetto a testo esplicativo, così gli utenti mobile possono vedere entrambi i blocchi più facilmente.

## F-37 Stato Live Del Proxy Nelle Impostazioni
- Il pannello Proxy nelle impostazioni deve esporre un indicatore di stato live chiaro, simile al pannello Home Assistant.
- L'indicatore deve essere guidato dal backend dedicato `proxyHealthState`, non solo da `vehicle.connected`.
- Un heartbeat `body_controller_state` riuscito è sufficiente per marcare il proxy come LIVE.
- Il pannello deve mostrare l'ultimo errore proxy noto o un messaggio offline esplicito quando il proxy non è live.
- Il pannello deve mostrare l'ultimo endpoint proxy andato a buon fine e il relativo timestamp.

## F-38 Riscrittura Del Blocco Dettagli Dashboard
- La vecchia sezione `Charging Recap` deve essere sostituita con un riepilogo `Vehicle Details` più essenziale.
- Il nuovo riepilogo inferiore deve evitare di ripetere valori già mostrati nel widget energy-flow o nella card principale di controllo ricarica.
- La sezione deve dare priorità a dettagli tecnici live ancora utili per la diagnostica: stato cavo, corrente/request, stato clima e contesto elettrico/limiti.
- Potenza, carico casa, costo live, tariffa e altri valori già prominenti nella dashboard non devono essere ripetuti dentro questo blocco dettagli inferiore.

## F-39 Target SoC Trascinabile + Pannello Proxy Vehicle Details Collassabile

### F-39A Controllo Manuale Del Target SoC Per Modalità
Requisito: "Target SoC deve essere drag; il cursore target 80% non è un valore statico ma decidibile da utente. Rimane fisso se siamo in modalità PLAN perché va preso il setpoint del plan ma in modalità Off o On deve essere manualmente modificabile."
Accettazione letterale:
- C1: In modalità Off e On il cursore SoC è trascinabile/cliccabile dall'utente e aggiorna il target manuale locale.
- C2: In modalità Plan il cursore è bloccato (click e drag disabilitati), cursore `not-allowed`, opacità ridotta, e mostra testo di aiuto "Target set by schedule".
- C3: Il valore visualizzato in modalità Plan corrisponde al `targetSoc` della prossima schedulazione reale (endpoint `GET /api/schedule/next-charge`), non al target locale dell'utente.
- C4: Passando da Plan a Off o On, il cursore torna draggable e mantiene l'ultimo valore manuale dell'utente (non sovrascrive `manualTargetSoc` al cambio modalità).
- C5: Il backend espone `GET /api/schedule/next-charge` che restituisce `{ id, scheduleType, targetSoc, targetAmps, computedStartAt, finishBy }` per la prossima carica pianificata reale, con logica identica a `runSchedulerTick` (priorità: start_at → start_end → finish_by con calcolo orario avvio).
- C6: In modalità Off e On, `applyMode()` invia `manualTargetSoc` al backend. In modalità Plan, non usa il cursore locale ma il valore proveniente dall'endpoint backend.

### F-39B Vehicle Details Pannello Collassabile Proxy
Requisito: "Il pannello Vehicle Details deve essere un pannello collassabile, all'interno ci deve essere SOLO la risposta del proxy. Questo pannello serve per capire se l'auto sta rispondendo qualcosa che non ci aspettiamo."
Accettazione letterale:
- C1: La sezione Vehicle Details è un pannello collassabile (default: chiuso).
- C2: All'interno del pannello è presente esclusivamente il JSON di `rawChargeState` (risposta raw del proxy) serializzato e visualizzato in formato leggibile.
- C3: Nessun'altra card, metrica sintetica o dato elaborato è presente dentro il pannello Vehicle Details.
- C4: Il pannello ha un titolo descrittivo che indica chiaramente il suo scopo diagnostico.

### F-39C Riscrittura Completa Della Dashboard Da Zero
Requisito: "Riscrivere tutta la dashboard utilizzando lo stesso stile ma cancellando tutto il contenuto e ripartendo da zero per essere certi che tutto sia ok. Recupera solo l'aspetto e riscrivi la logica in modo migliore."

### F-40 Scheduling Settimanale Ricorrente + Widget In Stile Dashboard
Requisito: "Le schedule devono poter essere ripetitive per giorni della settimana (senza scelta data) e i widget della pagina scheduling devono richiamare il linguaggio visivo della dashboard."
Accettazione letterale:
- C1: Creazione schedule charging con selezione multipla giorni settimana + orario (senza input data obbligatorio).
- C2: Ogni schedule settimanale viene rieseguita automaticamente ogni settimana senza auto-disabilitarsi dopo il primo run.
- C3: Endpoint backend scheduling accetta tipo `weekly` e risolve correttamente la prossima esecuzione anche per `/api/schedule/next-charge`.
- C4: Lista schedule mostra chiaramente pattern ripetitivo (`Every <weekday> at <time>`).
- C5: Widget/section della pagina scheduling devono usare card arrotondate, gerarchia e densità visiva coerenti con la dashboard.
- C6: Le modalità esistenti `start_at`, `start_end` (e `finish_by` per charging) devono restare disponibili e non essere rimosse.
- C7: Weekly scheduling disponibile sia per charging sia per climate.
- C8: La pagina scheduling usa un unico pannello impostazioni con due selettori modalità (`Charger`/`Climate`).
- C9: Sono presenti bottoni rapidi `Oggi` e `Domani` per preimpostare il giorno target nel form corrente.
- C10: Sotto il pannello impostazioni sono presenti due recap separati: `Charger Recap` e `Climate Recap`.
Accettazione letterale:
- C1: Il file `DashboardPage.tsx` viene riscritto da zero: nessuna riga del corpo precedente viene mantenuta verbatim.
- C2: L'identità visiva è preservata: palette Tailwind `evload-*`, card `rounded-3xl`, icone `lucide-react`, spaziatura e font identici all'attuale.
- C3: I componenti puri (`EvccSocBar`, `ModePill`, `FlowStatRow`, `CollapsibleJsonPanel`) sono separati dalla logica di pagina, dichiarati sopra il componente principale, senza business logic inlinata nel JSX.
- C4: La logica `computeTimeToTargetH` è una funzione pura autonoma senza dipendenze da variabili esterne al suo scope.
- C5: Tutti i dati esistenti sono preservati: Energy Flow, Next Charge, Engine Log, potenze, SoC, costi, metriche elettriche.
- C6: Nessun commento nel codice (regola 12). Nomi variabili semantici coerenti col dominio EV (regola 19).
- C7: Build TypeScript frontend (`npm run build`) priva di errori dopo la riscrittura.

### F-41 Hardened Home Assistant Auth Lifecycle + Entities Anti-Ban
Requisito: "Evitare re-auth frequente HA, ridurre ban per auth failure ripetute, e non fare refresh periodico inutile della lista sensori in Settings."
Accettazione letterale:
- C1: Il backend salva e usa un token HA con metadato `issued_at_ms` persistito, includendo migrazione dei token legacy senza timestamp.
- C2: Il backend esegue refresh automatico del token (`grant_type=refresh_token`) prima della scadenza access token usando una finestra di sicurezza.
- C3: In caso di 401/403 durante polling HA o fetch entities, il backend tenta una sola volta refresh forzato e retry della richiesta.
- C4: Se il refresh token fallisce con errore auth hard (400/401/403), il backend imposta immediatamente stato `requiresManualReconnect=true` senza continuare retry aggressivi.
- C5: L'endpoint `GET /api/ha/entities` ha limiter dedicato e cooldown auth con risposta `429` + header `Retry-After` per evitare martellamento verso HA.
- C6: La pagina Settings non esegue polling periodico della lista sensori HA; la lista viene caricata solo quando HA è connesso o dopo OAuth success.
- C7: La UI Settings mostra feedback esplicito per stati auth invalid/cooldown/locked (es. reconnect richiesto o retry tra X secondi), evitando errori silenziosi.
- C8: Build frontend/backend rimane verde dopo l'integrazione della logica auth hardening.
- C9: Il contatore retry auth (`failureCount`) viene incrementato solo per errori auth hard (400/401/403) e NON per errori di validazione entità (entity mancante/non numerica).
- C10: In Settings il warning distingue in modo esplicito "token auth non valido" da "entity non valida/non raggiungibile" con messaggi separati.
- C11: In Settings, per ciascuna entità HA configurata (Home Power, Charger Power), la UI mostra stato esplicito per singola entità: sfondo rosso se l'entità non esiste nel catalogo HA caricato.
- C12: In Settings, per ciascuna entità HA configurata esistente, la UI mostra sfondo verde e il valore live corrente quando disponibile.

## F-42 Sicurezza API End-to-End

Requisito: "In produzione, ogni singola rotta del backend (tranne il login iniziale e i webhooks strettamente necessari) deve essere protetta. Validare la sicurezza dei WebSocket: anche la connessione WS deve richiedere l'autenticazione iniziale."
Accettazione letterale:
- C1: Tutte le rotte API (eccetto `GET /api/auth/*`, `GET /api/ha/callback`, `GET /api/health`) sono protette dal middleware `requireAuth` e restituiscono `401 Unauthorized` se il token JWT è assente o non valido.
- C2: La connessione WebSocket (`/ws`) richiede un token JWT valido passato come query param `?token=<jwt>`; in assenza di token valido la connessione viene chiusa con codice `1008` (Policy Violation).
- C3: Il frontend aggiunge automaticamente il token JWT all'URL WebSocket prima di aprire la connessione.
- C4: Helmet è installato e attivo nel backend; imposta header di sicurezza HTTP standard (X-Content-Type-Options, X-Frame-Options, ecc.) compatibili con il serve dei file statici del frontend.
- C5: Il CORS è configurato in produzione per accettare richieste solo dall'origine definita in `CORS_ORIGIN`; in sviluppo il CORS rimane aperto.
- C6: La variabile `CORS_ORIGIN` è documentata nel file `.env.example` della root e nel `backend/.env.example`.

## F-43 Deploy Semplificato Su Proxmox (Docker/Docker Compose)

Requisito: "Preparare un docker-compose.yml ottimizzato per la produzione. Assicurarsi che i volumi per il database SQLite (.db) e per il file di configurazione (config.yaml) siano mappati all'esterno dei container."
Accettazione letterale:
- C1: Il `docker-compose.yml` include un healthcheck per il servizio `evload` che verifica `GET /api/health`.
- C2: Il `docker-compose.yml` mappa un volume named `evload-db` per la directory dati del database SQLite (path container: `/app/backend/data`).
- C3: Il `docker-compose.yml` mappa un volume named `evload-logs` per i log (path container: `/app/backend/logs`).
- C4: Il `docker-compose.yml` include binding del file `config.yaml` dalla directory host verso il container in modalità read-write.
- C5: Il `Dockerfile` include istruzione `HEALTHCHECK` coerente con il docker-compose.
- C6: Il `docker-compose.yml` espone la variabile `NODE_ENV=production` nel container tramite la sezione `environment`.

## F-44 Script Di Aggiornamento Facile (update.sh)

Requisito: "Creare uno script shell update.sh che esegua automaticamente: pull delle ultime modifiche Git, rebuild dei container Docker, esecuzione automatica delle migrazioni database."
Accettazione letterale:
- C1: Il file `update.sh` esiste nella root del progetto ed è eseguibile (`chmod +x`).
- C2: Lo script esegue `git pull` per scaricare le ultime modifiche.
- C3: Lo script esegue `docker compose up -d --build` per ricostruire e riavviare i container.
- C4: Lo script esegue `docker compose exec evload npx prisma migrate deploy` per applicare le migrazioni database.
- C5: Lo script stampa messaggi di stato chiari in italiano per ogni fase.
- C6: Lo script termina con codice di uscita non-zero se una delle fasi fallisce (set -e).

## F-45 Robustezza In Produzione (Logging, Crash Handling, ENV)

Requisito: "In produzione i log non devono riempire il disco. Il backend non deve spegnersi se una chiamata a HA o al proxy Tesla va in timeout. Assicurarsi che il passaggio da .env.development a .env.production sia fluido."
Accettazione letterale:
- C1: I trasporti file di Winston hanno `maxsize` configurato a 50 MB e `maxFiles: 5` per garantire log rotation automatica.
- C2: Il backend gestisce `process.on('uncaughtException', ...)` con log dell'errore senza terminare il processo (salvo errori fatali dell'event loop).
- C3: Il `backend/.env.example` documenta le variabili di produzione raccomandate: `NODE_ENV`, `LOG_LEVEL`, `CORS_ORIGIN`, `DATABASE_URL`, `JWT_SECRET`, `PORT`.
- C4: Il `docker-compose.yml` passa `NODE_ENV=production` al container tramite la sezione `environment`.

## F-46 Script Di Build Per La Produzione (build-prod.sh)

Requisito: "Creare uno script build-prod.sh che prepari l'intero pacchetto per la produzione. Lo script deve: eseguire type checking, compilare il frontend, compilare il backend, fornire output chiaro su errori bloccanti."
Accettazione letterale:
- C1: Il file `build-prod.sh` esiste nella root del progetto ed è eseguibile.
- C2: Lo script esegue `npm run build --prefix backend` e termina con errore esplicito se fallisce.
- C3: Lo script esegue `npm run build --prefix frontend` e termina con errore esplicito se fallisce.
- C4: Lo script stampa messaggi di stato in italiano per ogni fase con indicatori visivi (✅ / ❌).
- C5: Lo script termina con codice di uscita `0` solo se entrambe le build sono riuscite.

## F-47 Durata Sessione JWT Configurabile

Requisito: "Il JWT deve essere generato dopo l'autenticazione e deve scadere dopo un tot di ore configurabile."
Accettazione letterale:
- C1: Il JWT viene emesso esclusivamente dopo una verifica password corretta (`POST /api/auth/login` o `POST /api/auth/setup`); le rotte API non autenticate non emettono token.
- C2: La durata della sessione JWT è configurabile tramite la variabile d'ambiente `SESSION_HOURS` (intero positivo); il valore di default è `24` ore.
- C3: La variabile `SESSION_HOURS` è documentata in `backend/.env.example` con valore di default e nota sul fallback in caso di valore non valido.
- C4: Il frontend decodifica il campo `exp` del JWT lato client in `isAuthenticated()`; se il token è scaduto, viene rimosso automaticamente dallo store e l'utente viene reindirizzato al login senza attendere il successivo errore 401.
- C5: La variabile `SESSION_HOURS` è documentata nella tabella delle variabili d'ambiente di `README.md`.

## F-48 Log Verbosi In Produzione + Download Log Da Settings

Requisito: "I log in produzione devono essere il più parlanti possibile; le operazioni critiche (set_amp, start_charge, stop_charge, plan, failsafe, HA throttle) devono essere ben marcate e motivate. Nel pannello Settings, se autenticato, deve essere possibile scaricare i log frontend e backend."
Accettazione letterale:
- C1: Ogni operazione critica del motore emette un `logger.info` o `logger.warn` strutturato con tag emoji identificativo e tutti i campi di contesto rilevanti (vehicleId, sessionId, valori prima/dopo, motivo dell'azione).
- C2: I tag obbligatori sono almeno: `🚀 [START_ENGINE]`, `🏁 [STOP_ENGINE]`, `🔌 [CHARGE_START]`, `🛑 [CHARGE_STOP]`, `⚡ [SET_AMP]`, `🗓️ [PLAN_MODE]`, `⛔ [HA_THROTTLE]`, `🚨 [FAILSAFE]`.
- C3: `[SET_AMP]` include sempre: vehicleId, sessionId, motivo (`ramp_up`/`ramp_down`/`ha_throttle`), amperaggio precedente, nuovo amperaggio, target, potenza casa corrente.
- C4: `[START_ENGINE]` include: sessionId, targetSoc, targetAmps, modalità (plan/manual), vehicleId, prezzoEnergia, limiti amp.
- C5: `[STOP_ENGINE]` include: sessionId, energia totale kWh, costo totale €, SoC finale, forceOff.
- C6: In Settings esiste un pannello collassabile "Logs" (default: chiuso) visibile solo se autenticato.
- C7: Il pannello Logs espone pulsanti per scaricare `combined.log` e `error.log` dal backend (endpoint `GET /api/settings/logs/backend?type=combined|error`, autenticato, rate-limited 10/min).
- C8: Il pannello Logs espone pulsanti per scaricare i log frontend localmente e per caricarli sul server (`POST /api/settings/logs/frontend`) con successivo download (`GET /api/settings/logs/frontend`).
- C9: Il frontend usa un logger circolare (`flog`) in `src/utils/frontendLogger.ts` con buffer da 2000 entry e cap localStorage a 512 KB; espone `flog.info/warn/error/debug(tag, msg, meta?)`.
- C10: Il file `frontend.log` lato server non supera 10 MB; al superamento viene ruotato automaticamente con timestamp nel nome.
- C11: Le azioni utente critiche in Dashboard (start/stop/plan/wake) e in Settings (save, HA connect, change password) emettono entry `flog` con contesto rilevante.
- C12: Il pannello Logs mostra un'anteprima live delle ultime 20 entry frontend con color-coding per livello (error=rosso, warn=giallo, info/debug=muted).

## F-49 Native Ubuntu/Proxmox Deployment Scripts
Requisito: "Fornire script per il deploy nativo su Ubuntu senza Docker, gestendo automaticamente installazione, build e servizio systemd."
Accettazione letterale:
- C1: Script `Deploy-EvloadNative.ps1` automatizza setup Node.js, clone repo, install, build e systemd.
- C2: Script `Update-EvloadNative.ps1` automatizza pull, migration, build e restart.
- C3: Gli script gestiscono automaticamente il problema del BOM di Windows e delle newline CRLF.
- C4: Integrazione GitHub CLI (`gh`) per gestire repository privati con autenticazione web.
- C5: Gestione automatica della memoria Node.js (`--max-old-space-size=1024`) per build su container con poca RAM.

## F-50 Raffinamento Algoritmo Ramp-Up Lineare
Requisito: "L'algoritmo di aumento potenza deve essere lineare e reattivo, evitando stalli dovuti a bassi consumi domestici."
Accettazione letterale:
- C1: Rimozione della formula basata sulla potenza residua per il ramp-up (che causava arrotondamenti a zero).
- C2: Implementazione incremento lineare a gradini di +1A per ogni intervallo configurato.
- C3: Il ramp-down resta immediato per protezione sovraccarico.
- C4: L'algoritmo rispetta sempre il `maxPossible` calcolato dinamicamente da HA.

## F-51 Tracciamento Energia Monotòno e Log di Sessione
Requisito: "Il contatore di energia Wh deve essere stabile e non resettarsi durante i cambi di amperaggio; separare energia auto da energia contatore."
Accettazione letterale:
- C1: Implementazione logica monotona nel frontend: il contatore Wh non può tornare indietro durante una sessione.
- C2: Aggiunta di log `flog` (SESSION) per tracciare i tentativi di reset o cali improvvisi di energia riportati dal proxy.
- C3: Dashboard mostra l'energia calcolata (contatore) in primo piano e l'energia riportata dall'auto nei dettagli veicolo.
- C4: Corretto il bug del reset durante il cambio `set_charging_amps`.

## F-52 Routing di Produzione e Identità OAuth
Requisito: "La root path deve servire l'app React ai browser e la pagina OAuth a Home Assistant senza conflitti."
Accettazione letterale:
- C1: Middleware intelligente su `/` che analizza lo User-Agent.
- C2: I browser ricevono `index.html` (Frontend React) per default.
- C3: Client Home Assistant (aiohttp) ricevono la pagina di identità OAuth Client.
- C4: Disabilitata direttiva `upgradeInsecureRequests` in Helmet per permettere il caricamento via HTTP in rete locale.

## F-53 Connection Recovery (Proxy Disconnect)

Requisito: "Quando il proxy BLE si disconnette durante una sessione di ricarica, il motore deve sospendere la sessione (non terminarla) e riprenderla automaticamente alla riconnessione."
Accettazione letterale:
- C1: `failsafe.service.ts` distingue tra failsafe `hard` (HA disconnect → stop definitivo) e `soft` (proxy disconnect → pausa temporanea).
- C2: Su `proxyEvents.on('disconnected')`: si attiva failsafe `soft`, il motore salva `suspendedState` (targetSoc, targetAmps) e transisce in fase `paused`.
- C3: Il motore NON chiama `stopEngine()` né invia `charge_stop` al proxy (irraggiungibile).
- C4: Su `proxyEvents.on('connected')`: se `suspendedState` presente, il motore riavvia automaticamente la ricarica con i parametri salvati; emette log `🔄[CHARGE_RESUME]`.
- C5: Nuovo flag `proxy.stopAutonomousCharge: boolean` (default `true`) — se il proxy riconnette e il veicolo sta già caricando autonomamente (non avviato da evload), invia `charge_stop`.
- C6: La config `proxy.stopAutonomousCharge` è documentata in `config.example.yaml`.

## F-54 Pannello Garage (RPi 7" + Mobile)

Requisito: "Nuova pagina `/garage` touch-friendly ottimizzata per Raspberry Pi 4 + display 7" 800×480, accessibile anche da mobile."
Accettazione letterale:
- C1: Nuova route `/garage` in `App.tsx` con `<Layout>` esistente; link nel nav con icona Warehouse.
- C2: Layout responsive (flex/grid): su desktop e RPi mostra griglia 4 colonne metriche + 4 pulsanti; su mobile ≤768px colonna singola.
- C3: Pannello superiore: SoC (barra + percentuale grande), potenza ricarica (kW), ETA, consumo casa, corrente (A).
- C4: Pulsanti azione (min 88px height): Avvia (con slider SOC), Ferma, Sgancia cavo, Sbrinamento rapido.
- C5: Screen saver: overlay CSS trasparente → nero dopo N minuti; qualsiasi evento `touchstart`/`mousedown`/`mousemove`/`keydown` resetta il timer; Screen Wake Lock API dove disponibile.
- C6: Configurazione timeout schermo persistita in localStorage.
- C7: Backend endpoint `POST /api/garage/display` (protetto JWT) esegue `vcgencmd display_power 0/1` solo se `GARAGE_MODE=true`.

## F-55 Backup su Google Drive

Requisito: "Backup automatico di `config.yaml` e database SQLite su Google Drive via OAuth2, con selezione della cartella di destinazione."
Accettazione letterale:
- C1: `backup.service.ts` usa `googleapis` v144 per OAuth2 + Drive API.
- C2: Backup compressi come `.tar.gz` con timestamp nel nome (`evload-backup-YYYY-MM-DD-<ts>.tar.gz`).
- C3: Cartella Drive configurabile tramite `backup.driveFolderPath` in `config.yaml`; supporta percorsi nidificati (es. `Documenti/evload-backups`); cartelle mancanti create automaticamente.
- C4: Frontend folder-picker in Settings → Backup: sfoglia cartelle radice Drive, selezione con click o digitazione libera.
- C5: Scheduler integrato: ogni minuto controlla se eseguire il backup in base a `frequency` (daily/weekly/monthly) e `time` HH:MM.
- C6: Retention: mantieni ultimi N backup su Drive (default 10), eliminazione automatica dei più vecchi.
- C7: Endpoint `POST /api/backup/restore` scarica e decomprime un backup da Drive, sovrascrive file locali.
- C8: Prisma schema aggiornato con campi `google_access_token`, `google_refresh_token`, `google_token_expiry`, `last_backup_at`.
- C9: Stato connessione (ultimo backup, prossimo backup, cartella corrente) visibile in Settings panel collassabile.

## F-56 Script Raspberry Pi (bash + PowerShell)

Requisito: "Script di installazione, aggiornamento, kiosk e display per Raspberry Pi 4, disponibili sia per Unix/bash che per Windows/PowerShell."
Accettazione letterale:
- C1: `scripts/raspberry/install.sh` — installazione completa su RPi da zero (apt, Node.js, Chromium, unclutter, build, systemd, kiosk, screen blanking).
- C2: `scripts/raspberry/install.ps1` — stesso flusso eseguito in remoto da Windows via SSH.
- C3: `scripts/raspberry/update.sh` — build locale + rsync dist → RPi + restart + health check (Unix).
- C4: `scripts/raspberry/update.ps1` — stesso flusso da Windows PowerShell.
- C5: `scripts/raspberry/setup-kiosk.sh` / `setup-kiosk.ps1` — solo configurazione Chromium kiosk + autostart LXDE.
- C6: `scripts/raspberry/setup-display.sh` / `setup-display.ps1` — rotazione display `/boot/config.txt`, DPMS xorg, permesso vcgencmd sudoers.

## F-57 Setup Guide

Requisito: "Guida step-by-step in `docs/SETUP_GUIDE.md` che copra tutte le opzioni di installazione."
Accettazione letterale:
- C1: Sezioni: Docker, Ubuntu/Proxmox nativo, Raspberry Pi 4, Prima Configurazione, Google Drive Backup, Pannello Garage, Aggiornamento, Troubleshooting.
- C2: Tabella prerequisiti hardware e software.
- C3: Comandi copy-pastabili per ogni scenario.

## Regola Finale Anti-Regressione

Quando un item e' `VERIFIED`, rieseguire i test/build minimi e confermare che non rompe item gia' verificati.
Se una modifica altera comportamento specifico richiesto, riportare immediatamente `REGRESSION`.


## F-58 Comandi Proxy Sincroni + Fix False Proxy-Offline

Requisito: "I comandi inviati dal pannello garage devono risvegliare eventualmente l'auto. Il backend marcava il proxy come offline quando la macchina era in sleep. Tutti i comandi devono usare ?wait=true."

### Proxy false-offline fix
- C1: `proxyPost`: se il proxy risponde con un HTTP error (`err.response != null`), il proxy è raggiungibile — non viene chiamato `markProxyError`. Solo gli errori di rete (nessuna risposta) marcano il proxy offline.
- C2: `updateProxyDataRequest` (PUT): stessa logica — HTTP error = proxy raggiungibile, network error = proxy offline.
- C3: Il proxy health viene gestito dai frequenti poll `body_controller_state` (sempre attivi) — i fallimenti dei comandi non interferiscono con lo stato di connettività.

### Comandi sincroni con ?wait=true
- C4: `sendProxyCommand` aggiunge sempre `?wait=true` all'URL: il proxy aspetta il completamento BLE prima di rispondere, e gestisce l'auto-wake autonomamente se il veicolo è in sleep.
- C5: Timeout 90 s (copre: wake ~40 s + BLE ~5 s + buffer).
- C6: `vehicle.routes.ts`: semplificato — nessuna logica di pre-wake manuale. Log diagnostico se il veicolo è in sleep al momento del comando.
- C7: Tutti i comandi del charging engine (`charge_start`, `charge_stop`, `set_charging_amps`, `wake_up`) e dello scheduler (`auto_conditioning_start/stop`, `set_temps`) usano la stessa `sendProxyCommand` e beneficiano di `?wait=true`.

## F-59 Log Export con Filtro Temporale

Requisito: "Il pannello Logs deve permettere di filtrare i log per intervallo temporale prima del download."
Accettazione:
- C1: Backend `/api/settings/logs/backend` accetta query param `since` con valori `1h`, `6h`, `24h`, `7d`.
- C2: Quando `since` è specificato, legge il file di log, filtra le righe JSON dove `timestamp >= cutoff`, restituisce solo quelle.
- C3: Quando `since` non è specificato, comportamento invariato (stream completo del file).
- C4: Frontend: select "Time range" nel pannello Backend Logs con opzioni All / 1h / 6h / 24h / 7d.
- C5: `downloadBackendLog(type, since?)` passa il parametro `since` come query string.
- C6: Stato `logSince` inizializzato a `''` (All logs).

## F-60 Verbose Logging e LOG_LEVEL Support

Requisito: "Logging verboso per diagnostica proxy/engine; LOG_LEVEL configurabile via env var."
Accettazione:
- C1: `pollBodyController`: aggiunto `logger.debug` al tick iniziale e `logger.verbose` dopo la risposta con `sleepStatus` e `userPresence`.
- C2: `pollVehicleData`: aggiunto `logger.debug` al tick con contesto `isCurrentlyCharging`, `engineRunning`, `windowActive`.
- C3: `runEngineStep`: aggiunto `logger.verbose` dopo ogni tick con `enginePhase`, `soc`, `actualAmps`, `targetAmps`, `chargingState`, `homePowerW`, `vehicleSleepStatus`.
- C4: `.env.example` aggiornato con descrizione estesa di `LOG_LEVEL` (tutti i livelli) e `GARAGE_MODE`.
- C5: `docker-compose.yml` aggiunto `LOG_LEVEL` e `GARAGE_MODE` all'environment section.
- C6: `README.md` env table aggiornata con `LOG_LEVEL` livelli completi e `GARAGE_MODE`.
- C7: Pannello Logs spostato dopo il pannello Backup nella Settings UI.

## F-61 Robust HA Power Calculation

Requisito: "Rendere il calcolo della potenza reale dal contatore HA robusto — evitare che valori negativi o anomali del sensore rompano il motore di ricarica."
Accettazione:
- C1: `ha.service.ts`: `HaState` arricchito con `smoothedPowerW`, `smoothedChargerW` (EMA, α=0.3) e `chargerFault` (boolean).
- C2: `powerW < 0` (surplus solare → esportazione in rete) è ora un valore VALIDO: non viene più emesso warning né interrompe la logica. Solo `chargerW < 0` è un fault reale del sensore.
- C3: Quando `chargerW < 0` (sensor fault): si mantiene il valore smoothed precedente, si imposta `chargerFault = true` e si logga `HA_INPUT_QUALITY_ANOMALY` con kind `negative_charger_power`.
- C4: `charging.engine.ts` → `computeHaAllowedAmps`: usa `smoothedPowerW`/`smoothedChargerW`; quando `chargerFault = true` restituisce `null` (skip tick); `houseOnlyW` è clampato a `[0, maxHomePowerW]`.
- C5: Log `[HA_POWER_CALC]` mostra raw vs. smoothed ad ogni tick per diagnostica.

## F-62 Timezone e Set System Clock

Requisito: "Dal pannello impostazioni poter aggiornare timezone e data/ora del sistema (log ora in UTC)."
Accettazione:
- C1: `config.ts`: aggiunto campo `timezone: z.string().default('UTC')` nello schema Zod.
- C2: GET `/api/settings` espone `timezone`.
- C3: PATCH `/api/settings` accetta `timezone` e lo persiste in `config.yaml`; al salvataggio `process.env.TZ` viene aggiornato senza riavvio.
- C4: POST `/api/settings/system-time` con body `{ iso: string }` imposta il clock di sistema tramite `timedatectl set-time` (fallback: `date -s`). Disabilitato in demo mode.
- C5: `AppSettings` (frontend) include `timezone`.
- C6: Settings UI: nuovo pannello "System" con campo Timezone (IANA) + sezione "Set System Clock" con input datetime-local e pulsante Apply.

## F-63 Fix Unlatch Garage (charge_port_door_open)

Requisito: "Il comando unlatch in garage non funzionava — verificare e correggere."
Accettazione:
- C1: `GaragePage.tsx`: corretto `sendVehicleCommand('charge_port_open')` → `sendVehicleCommand('charge_port_door_open')` (nome comando corretto nell'allowlist di `vehicle.routes.ts`).
- C2: Aggiunto `flog.info('GARAGE', 'Unlatch triggered', { cmd: 'charge_port_door_open' })` prima del comando per visibilità nei log frontend.
- C3: `sendProxyCommand` aggiunge già `?wait=true` → esecuzione sincrona garantita.

## F-64 Statistics Chart Zoom

Requisito: "Nella pagina statistiche poter zoomare i grafici in un popup a schermo intero."
Accettazione:
- C1: `StatisticsPage.tsx`: stato `zoomedChart: 'soc' | 'powerCurrent' | 'voltage' | 'energyBar' | null`.
- C2: Modale fullscreen (`fixed inset-0 z-50`) con sfondo scuro semitrasparente; chiusura su click overlay, pulsante ✕ o tasto Escape.
- C3: Ogni card grafico ha un pulsante `Maximize2` (lucide-react) nell'header per aprire il relativo grafico a 500px di altezza nel modale.
- C4: Il modale riutilizza gli stessi dati `telemetryData`/`sessions` già in memoria — nessuna chiamata API aggiuntiva.


## F-65 Statistics Popup Chart Zoom (X-axis drag)

Requisito: "Il grafico che si apre nella finestra pop-up deve avere la possibilità di essere zommato sull'asse X e Y così da migliorare la lettura dei dati."
Accettazione:
- C1: I grafici SoC, Power/Current e Voltage nella modale di espansione supportano zoom X via drag del mouse.
- C2: Durante il trascinamento una `ReferenceArea` semitrasparente indica la selezione in corso.
- C3: Al rilascio il dominio XAxis viene impostato a `[x1, x2]`; YAxis si adatta automaticamente (`auto`/`allowDataOverflow`).
- C4: Quando lo zoom è attivo: pulsante "Reset zoom" visibile nell'header → ripristina `['dataMin','dataMax']`.
- C5: Quando lo zoom non è attivo: testo guida "Drag to zoom" visibile (solo per grafici time-series).
- C6: `openZoomedChart` resetta lo zoom prima di aprire ogni grafico; chiusura modale (overlay, ✕, Escape) resetta lo zoom.
- C7: Nessuna dipendenza esterna aggiunta — usa solo `ReferenceArea` già incluso in recharts.

## F-66 Piano Pre-Wake + Miglioramento Template Notifiche

Requisito: "Aggiungere parametro per svegliare l'auto X minuti prima in modalità Plan. Modificare template con emoticon e messaggi significativi. Due varianti timestamp: data completa e solo orario HH:MM (H24). Default template con solo orario. Revisione messaggi (es. engine_started aveva ref vuoto)."
Accettazione:
- C1: `config.ts`: aggiunto `planWakeBeforeMinutes: z.number().min(0).default(0)` in `charging`.
- C2: `settings.routes.ts`: `planWakeBeforeMinutes` esposto in GET e PATCH `/api/settings`.
- C3: `scheduler.service.ts`: in `runSchedulerTick`, se `planWakeBeforeMinutes > 0`, invia `requestWakeMode(true)` e evento `plan_wake` quando una carica pianificata è entro `planWakeBeforeMinutes` minuti; set `preWakeArmedIds` evita wake multipli per lo stesso ID; per schedule settimanali, l'ID viene rimosso dal set alla fine di ogni esecuzione.
- C4: `notification-rules.service.ts`: nuovi placeholder `{{timestamp_time}}` (HH:MM 24h) e `{{timestamp_date}}` (gg/mm/aaaa HH:MM) aggiunti automaticamente al payload base; nuovo evento `plan_wake` con campi `planId`, `wakeBeforeMinutes`; catalogo placeholder aggiornato per tutti gli eventi.
- C5: `notification-rules.service.ts`: Fix `engine_started` — rimosso `{{reason}}` dal catalogo (non è in payload); `vehicleId` sempre correttamente incluso.
- C6: `NotificationsPage.tsx`: tutti i template di esempio aggiornati con emoji e messaggi in italiano significativi; `loadExampleRules()` ora carica 7 regole; default template usa `{{timestamp_time}}`.
- C7: `SettingsPage.tsx`: nuovo campo "Pre-wake (min)" nel pannello Charging → Plan Mode.
- C8: `api/index.ts`: `planWakeBeforeMinutes: number` aggiunto a `AppSettings`.

## F-67 Robust Charge Start Grace Window

Requisito: "Assicurati che quando un piano parte non venga interrotto se l'auto non risponde subito mettendosi in charging. Crea un sistema robusto prima di dichiarare errore e stoppare il piano di ricarica."
Accettazione:
- C1: `config.ts`: aggiunto `chargeStartGraceSec: z.number().min(0).default(120)` in `charging`.
- C2: `charging.engine.ts`: aggiunto `engineStartedAtMs: number` (reset a 0 in `stopEngine`, impostato a `Date.now()` in `startEngine`).
- C3: `runEngineStep` — blocco `!vState.connected` al top: se entro la grace window, invece di impostare `chargeStartBlocked=true`, imposta fase `charge_start_grace_not_connected` e ritorna senza bloccare i retry; solo dopo scaduta la grace window si dichiara blocked e si invia la notifica Telegram.
- C4: `runEngineStep` — ramo `resolveChargeStartBlockReason` nel case `continue_charging`: stessa logica grace window; durante il periodo si logga `⏳ [CHARGE_START_GRACE]` e si ritorna senza impostare blocked; alla scadenza si dichiara blocked normalmente.
- C5: Il messaggio di stato durante la grace window mostra i secondi trascorsi e quelli rimanenti.
- C6: `chargeStartGraceSec` esposto in GET/PATCH `/api/settings`.
- C7: `AppSettings` (frontend) e `SettingsPage` aggiornati con campo "Charge Start Grace" (secondi) nel pannello Charging → Current Limits.
- C8: `config.example.yaml`, `features.md`, `README.md` aggiornati.

## F-68 Fix Missing timestamp_time/timestamp_date in Notification Test Placeholder Check

Requisito: "Missing placeholders in payload: timestamp_time — il test mostra timestamp_time come mancante anche se il messaggio viene renderizzato correttamente."
Accettazione:
- C1: `notification-rules.service.ts`: `buildTimestampPayload()` è ora esportata (era privata).
- C2: `settings.routes.ts`: `POST /telegram/test` usa `buildTimestampPayload(new Date())` per costruire il payload di controllo in `extractMissingTemplatePlaceholders`; i campi `timestamp`, `timestamp_time` e `timestamp_date` non vengono più segnalati come mancanti nei template che li usano.

## F-69 Redact Telegram Bot Token from Error Logs

Requisito: "Il token del bot Telegram appare in chiaro nei log di errore perché è parte dell'URL della richiesta HTTP verso api.telegram.org."
Accettazione:
- C1: `telegram.service.ts`: aggiunta helper `sanitizeTelegramError()` che estrae solo i campi sicuri dell'errore (`code`, `name`, `message`, `statusCode`, `description`) e sostituisce il token nel campo `message` con `***REDACTED***`.
- C2: `sanitizeTelegramError` applicata a tutti i `logger.error` del servizio: `sendTelegramNotification`, `bot.on('error')`, `bot.on('polling_error')`.
- C3: Nessun dato sensibile (token, URL completa) viene scritto nei log combinati o di errore.

## F-70 Timezone Field: da testo libero a dropdown IANA

Requisito: "Rendi il campo timezone una dropdown per evitare errori di battitura che causano fallback silenzioso a UTC."
Accettazione:
- C1: `SettingsPage.tsx`: aggiunta costante `IANA_TIMEZONES` con ~60 timezone comuni suddivise per continente.
- C2: Aggiunto componente `SelectField` che renderizza un `<select>` stilizzato coerente con gli altri field della pagina.
- C3: Il pannello System → Timezone ora mostra una dropdown al posto del campo di testo libero.
- C4: Se il valore salvato non è presente nella lista (es. timezone configurata manualmente in yaml), viene mostrato come prima opzione nel select così non va perso.

## F-71 Template di Notifica Multi-Riga con Tutti i Placeholder

Requisito: "Rivedi tutti i template default per avere testi per andare a capo nelle informazioni, così da avere un bel testo chiaro e formattato con tutte le informazioni necessarie già nei template."
Accettazione:
- C1: `NotificationsPage.tsx`: tutti i 24 template in `EVENT_EXAMPLE_TEMPLATES` riformattati con `\n` per andare a capo; ogni template include header con emoji + titolo, riga `📅 {{timestamp_date}}` e righe dedicate per ogni campo rilevante dell'evento.
- C2: Le 7 regole di esempio in `loadExamples()` aggiornate con lo stesso formato multiriga; in particolare `charge_start_blocked` ora include `{{chargingState}}` e `{{soc}}%`; `soc_increased` include la riga data.
- C3: Tutti i template usano `{{timestamp_date}}` (data+ora completa) invece di `{{timestamp_time}}` inline nel testo, garantendo leggibilità anche su notifiche ricevute a distanza di ore.

## F-72 Piano di Ricarica: Campo Nome e Uso Costruttivo

Requisito: "Aggiungi un campo nome per ogni piano di ricarica così da avere un rapido sguardo a quale piano è partito. Il nome deve comparire nella dashboard, nelle notifiche Telegram e nelle statistiche per raggruppare le ricariche."
Accettazione:
- C1: `prisma/schema.prisma`: aggiunto campo `name String?` a `ScheduledCharge` e `ScheduledClimate`.
- C2: Migrazione `20260411100000_add_schedule_name`: `ALTER TABLE "ScheduledCharge" ADD COLUMN "name" TEXT; ALTER TABLE "ScheduledClimate" ADD COLUMN "name" TEXT;` — campo nullable, backward compatible, zero-downtime.
- C3: `schedule.routes.ts`: le POST `/schedule/charges` e `/schedule/climate` accettano il campo `name` (opzionale, stringa non vuota, max 50 caratteri); validation 400 se fuori range.
- C4: `scheduler.service.ts`: `startEngineWithWake` accetta `planName?: string` e lo passa a `startEngine`; tutte le chiamate a `dispatchTelegramNotificationEvent` per eventi plan_* ora includono `planId: String(sc.id)` e `planName: sc.name ?? \`#${sc.id}\``.
- C5: `charging.engine.ts`: `startEngine` accetta `planName?: string` (4° parametro); il nome viene salvato come `locationName` sulla sessione di ricarica creata, rendendo le sessioni plan-aware nelle statistiche.
- C6: `scheduler.service.ts`: `NextPlannedCharge` interface e `resolveNextPlannedCharge()` includono il campo `name: string | null`.
- C7: `notification-rules.service.ts`: aggiunto `planName` al catalogo placeholder, alle presets, agli schemi e alle descrizioni per tutti gli eventi plan_*; presets aggiornate a `planId: '1', planName: 'Ricarica Notturna'`; descrizione `planId` aggiornata a "ID numerico del piano programmato".
- C8: `NotificationsPage.tsx`: tutti i template plan_* aggiornati per usare `{{planName}}` invece di `{{planId}}`; le 2 regole di esempio nel panel aggiornate di conseguenza.
- C9: `api/index.ts` (frontend): `ScheduledCharge`, `ScheduledClimate`, `NextPlannedCharge` ora includono `name: string | null`; `createScheduledCharge` e `createScheduledClimate` accettano `name?: string` in tutte le varianti.
- C10: `SchedulePage.tsx`: aggiunto campo input "Nome piano (opzionale, max 50 car.)" al form charger e climate; la lista recap mostra il nome in grassetto con truncate + tooltip per nomi lunghi; type badge e orario spostati in seconda riga per leggibilità.
- C11: `DashboardPage.tsx`: il widget "Next Charge" mostra un badge 📌 con il nome del piano (se presente) tra l'orario e il badge "Polling Active".
- C12: `StatisticsPage.tsx`: interfacce `Session` e `SessionDetail` includono `locationName?: string | null`; nella lista sessioni compare un badge 📌 inline con il nome piano (se non null); nel pannello dettaglio viene mostrata una riga dedicata "Piano di ricarica" se presente; il CSV esportato include la colonna `plan_name`.
- C13: `version.ts`: versione bumped a 1.6.2; history entry aggiunta.
- C14: `backend/package.json`, `frontend/package.json`, `package.json`: versione aggiornata a 1.6.2.
