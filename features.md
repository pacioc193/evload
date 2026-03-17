# Incremental Check Prompt (Strict Literal Mode)

Usa questo file come backlog incrementale e protocollo di verifica.
L'agente deve processare UNA feature alla volta, con verifica letterale, senza inferenze.

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

15. Veridicità dei default e inizializzazione corretta.
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

### F-01 Notifications Widget (event-based)
Accettazione letterale:
- C1: Pannello dedicato per regole di notifica (Template per eventi).
- C2: Possibilità di definire template personalizzati per ogni evento del sistema.
- C3: La UI deve permettere di attivare/disattivare singole regole.
- C4: La lista iniziale deve essere vuota (punto 6 regole obbligatorie).

### F-01B Notification Message Source Of Truth
Accettazione letterale:
- C1: Eliminazione di qualsiasi fallback di testo statico nel backend per le notifiche (punto 10 regole obbligatorie).
- C2: Nessun messaggio deve essere inviato se l'utente non ha definito una regola/template corrispondente.
- C3: **Smart Rules Builder**: La creazione di regole avanzate deve supportare:
	- C3.1: Selezione del campo (field) da una lista a discesa basata sui placeholder validi per l'evento.
	- C3.2: **Delta Conditions**: Supporto per operatori `changed` (diverso dal precedente), `increased_by` (aumentato di X), `decreased_by` (diminuito di X).
	- C3.3: **Modulo Conditions**: Operatore `mod_step` (triggera ogni volta che il valore attraversa un multiplo di X, es. ogni 10% di SoC).
- C4: Sotto l'etichetta del pannello (o specifica sezione) deve essere indicato chiaramente che i messaggi vengono inviati SOLO se esiste una regola configurata.

### F-02 Show All Placeholders
Accettazione letterale:
- C1: Lista placeholder visibile in UI tramite pulsante di Help o Finestra Popup (non staticamente sulla pagina).
- C2: I placeholder devono essere consolidati in un unico punto dell'interfaccia (non ripetuti in più sezioni).
- C3: Ogni placeholder deve avere una descrizione chiara del significato e del tipo di dato previsto.
- C4: La lista deve filtrare o evidenziare quali placeholder sono disponibili per lo specifico evento selezionato.

### F-03 Test Center & Event Schemas
Accettazione letterale:
- C1: Ogni evento nel catalogo deve definire uno schema di campi/payload obbligatori/previsti (es. engine_started deve richiedere sessionId, targetSoc).
- C2: Il Test Center deve impedire l'invio di test con payload non congruenti con l'evento selezionato (validazione schema).
- C3: Il Test Center deve fornire preset di payload validi per ogni tipo di evento, invece di un JSON generico unico.
- C4: Il risultato del test deve mostrare chiaramente se il template dell'utente ha usato placeholder non presenti nel payload dell'evento (warning di missing placeholders).
- C5: Possibilità di generare un evento "reale" nel sistema (bus eventi) dal Test Center per verificare la reazione di tutte le regole collegate.
- C6: Gestione esplicita degli errori di pre-requisito: il Test Center deve segnalare se l'invio non è possibile a causa di configurazioni mancanti (es: Bot Token mancante, Chat ID non impostati, Telegram disabilitato).

### F-04 API Token Write-Only
Requisito: "Allow to put the API token in write mode only"
Accettazione letterale:
- C1: Campo token configurabile in UI (Telegram Bot Token).
- C2: Il token deve essere salvato esclusivamente nel file `.env` del backend per ragioni di sicurezza, MAI nel file `config.yaml`.
- C3: Il token esistente deve essere oscurato (es: "********") in qualsiasi risposta `GET` dall'API.
- C4: La UI deve permettere di inserire un nuovo token senza esporre quello precedente.
- C5: Se l'utente invia il valore oscurato (********) in una `PATCH`, il backend deve ignorare il campo (mantenendo il token in `.env`).
- C6: Se il file `.env` non esiste, il backend deve crearlo o aggiornarlo dinamicamente al salvataggio del token.
- C7: Il servizio Telegram deve ricaricare il token dal `.env` immediatamente dopo il salvataggio senza riavvio.

### F-05 Allowed Chat IDs Full Management
Requisito: "Allow to put all Allowed Chat IDs"
Accettazione letterale:
- C1: Inserimento multiplo IDs.
- C2: Persistenza corretta in config.
- C3: Nessuna perdita di valori al reload.

### F-06 Delete All Event Messages
Requisito: "Allow to delete all event message"
Accettazione letterale:
- C1: Azione bulk "delete all" disponibile.
- C2: Cancella tutti i template evento/regole evento.
- C3: Stato persistito dopo save/reload.

### F-07 Load Example Or Generate From Scratch
Requisito: "Possibility to load an example or generate from scratch."
Accettazione letterale:
- C1: Azione "Load example" presente.
- C2: Azione "Generate from scratch" presente e produce set vuoto (nessuna regola).
- C3: Quando l'utente aggiunge una notifica, deve scegliere esplicitamente tra template o creazione da zero.
- C4: Entrambe le azioni non devono corrompere regole salvate accidentalmente.

### F-08 Dashboard Themes
Requisito: "Different theme (dark, white)"
Accettazione letterale:
- C1: Almeno 2 temi selezionabili in runtime (dark e white).
- C2: Persistenza preferenza tema.
- C3: Tema applicato a dashboard completa, non solo a singoli blocchi.

### F-09 Dashboard All Information
Requisito: "All information (actual current, desired current, voltage, phase, time to full read from message)"
Accettazione letterale:
- C1: Tutti i campi indicati sono visibili.
- C2: "time to full" e campi marcati "read from message" derivano da messaggio corretto.
- C3: Label e unita' coerenti.

### F-10 Top Of Page Power Metrics
Requisito: "On top of the page (Actual home total power consumption, power consumption of home without charger (home_total - charger))"
Accettazione letterale:
- C1: Entrambe metriche sono in top section dashboard.
- C2: Formula home_without_charger = home_total - charger rispettata letteralmente.
- C3: Aggiornamento live coerente con stream dati.

### F-11 Next Charge Start Time (EVCC-like)
Requisito: "Show start time of next charge like evcc"
Accettazione letterale:
- C1: Orario prossimo avvio visibile in dashboard.
- C2: Derivato da scheduler reale (non placeholder statico).
- C3: Formato orario chiaro.

### F-12 Engine Log
Requisito: "Log of engine"
Accettazione letterale:
- C1: Sezione log dedicata in dashboard.
- C2: Aggiornamento runtime.
- C3: Contiene eventi rilevanti del motore.

### F-13 Configuration - Demo Mode
Requisito: "Demo Mode (toggle switch)"
Accettazione letterale:
- C1: Toggle presente in configurazione.
- C2: Persistenza + effetto runtime.
- C3: Indicatore demo visibile nell'app.

### F-14 Configuration - Home Assistant Panel
Requisito: "url, home total power entity, charger entity, home assistant authorization with validity status and read of the entity"
Accettazione letterale:
- C1: Campi URL, home total power entity, charger entity presenti.
- C2: Flusso autorizzazione presente.
- C3: Validity status visibile.
- C4: Lettura entita' configurate verificabile.

### F-15 Configuration - Power Load
Requisito: "max power consumption allowed"
Accettazione letterale:
- C1: Campo configurabile presente.
- C2: Usato realmente nel throttle/pausa.
- C3: Verifica runtime con superamento soglia.

### F-16 Configuration - Charging
Requisito: "battery size, min A, max A, starting A, Loop rate(s)"
Accettazione letterale:
- C1: Tutti i campi presenti e persistenti.
- C2: Il motore li usa realmente.
- C3: Validazioni min/max coerenti.

### F-17 Configuration - Proxy
Requisito: "Proxy id, vehicle Id"
Accettazione letterale:
- C1: Entrambi i campi configurabili.
- C2: Usati nelle chiamate proxy/emulatore.

### F-18 Recharge Engine Modes
Requisito: "Off, Plan, On"
Accettazione letterale:
- C1: Tre modalita' distinte selezionabili.
- C2: Ogni modalita' ha comportamento diverso verificabile.
- C3: Stato modalita' visibile in UI.

### F-19 Recharge Engine Ramp
Requisito: "Throttle reducing A immediately; ramp up at configurable interval using Home Total Power formula (see F-22)"
Accettazione letterale:
- C1: In riduzione: throttle immediato al valore massimo consentito dalla griglia.
- C2: In ripresa: il setpoint viene ricalcolato ad ogni intervallo (Ramp Up Interval) usando la formula definita in F-22.
- C3: Se Home Total Power non disponibile (HA disconnesso o valore null): nessun ramp, mantieni setpoint corrente.
- C4: L'intervallo di aggiornamento (Ramp Up Interval) è il campo `rampIntervalSec` configurabile in settings.
- C5: Verifica con test automatici: throttle immediato su riduzione + aggiornamento corretto ad ogni step.
- C6: Chiarezza UI: Il campo in Settings deve essere esplicitamente etichettato come "Ramp Up Interval (sec)" o "Loop Refresh Rate".

### F-20 Dynamic Notification Event Bus
Requisito: "Events are dynamic and can be generated by other parts of the code; notification engine reacts to emitted events."
Accettazione letterale:
- C1: Esiste un event bus/registry notifiche riusabile da moduli multipli (engine, scheduler, HA, failsafe, proxy, climate).
- C2: I producer evento pubblicano su API comune senza dipendere direttamente dal trasporto Telegram.
- C3: L'engine notifiche ascolta eventi pubblicati e applica matching regole utente + render template.
- C4: API/UI leggono il catalogo eventi da backend dinamicamente, senza lista hardcoded fissa lato frontend.
- C5: Aggiunta nuovo evento nel backend deve comparire in UI senza patch specifica di componenti evento.
- C6: Test automatici coprono almeno: emissione evento, dispatch rule match/no-match, e assenza di fallback statico.

### F-21 Extended Settings Panel
Accettazione letterale:
- C1: Modalità demo (toggle switch) presente in Settings. Quando attiva, deve generare valori simulati per TUTTE le entità (home total power + charger power).
- C2: Pannello Home Assistant con: URL, Home Total Power Entity, Charger Power Entity. TUTTE le entità HA sono obbligatorie.
- C3: Pulsante "Connect" per flusso OAuth Home Assistant con indicazione di validità.
- C4: Lettura realtime delle entità HA direttamente nel pannello settings per verifica.
- C5: Pannello Proxy con: URL e VIN (Vehicle Identification Number).
- C6: Pannello Charging Engine Rules con: Max Home Power, Battery Capacity, Start A, Min A, Max A, time increase for each step A.
- C7: Sezione "Full configuration yaml" per visualizzazione/editing avanzato.
- C8: Pulsante "Sign-out" spostato in ALTO nella pagina (non in fondo).

### F-22 Charging Engine Smart Current Algorithm
Requisito: "Engine calcola la corrente di ricarica usando: Home Total Power - Charger Power = Residual Power; Residual Power / Vehicle Voltage = A delta; New setpoint = A actual + A delta; usa il tempo di loop (Ramp Up Interval) configurabile da settings."
Accettazione letterale:
- C1: Formula end-to-end implementata: `Residual Power W = Home Total Power W - Charger Power W`.
- C2: `A delta = Residual Power W / Vehicle Voltage V` (ampere disponibili dalla rete residua).
- C3: `New setpoint amps = A actual + A delta` (non incremento fisso +1A).
- C4: Il campo `rampIntervalSec` (Ramp Up Interval / Loop Refresh Rate) è configurabile in settings e usato come intervallo di aggiornamento del loop engine.
- C5: Fallback se Home Total Power non disponibile (HA disconnesso): mantieni setpoint corrente senza variazioni.
- C6: Test automatici verificano la formula con valori noti: Home Total Power X, Charger Power Y, Voltage Z → setpoint atteso calcolato correttamente.
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

### F-25 Proxy Vehicle Data Endpoints (testdata.json)
Requisito: "Usare gli endpoint presenti in testdata.json per leggere lo stato auto e aggiornare anche emulatore."
Accettazione letterale:
- C1: Polling backend usa endpoint `GET /api/1/vehicles/{VIN}/vehicle_data`.
- C2: Supporto endpoint mirato `GET /api/1/vehicles/{VIN}/vehicle_data?endpoints=charge_state`.
- C3: Parsing campi da payload annidato (`response.response.charge_state`, `response.response.climate_state`).
- C4: Gestione stato `vehicle is sleeping` senza crash del ciclo polling.
- C5: Emulatore espone endpoint `vehicle_data` coerenti con i payload contrattuali.
- C6: Nessun riferimento a endpoint `summary` inesistente nel flusso runtime/contract.

### F-26 Vehicle Name In Settings
Requisito: "Possibilità di impostare un nome macchina da Settings, subito sotto il VIN."
Accettazione letterale:
- C1: In Settings è presente campo `Vehicle Name` immediatamente sotto il campo VIN.
- C2: Il valore è persistente via API settings e salvato in configurazione.
- C3: Il nome configurato viene usato come display name runtime quando il provider non ne restituisce uno.
- C4: Build e test automatici includono verifica persistenza `vehicleName`.

### F-27 Sidebar Navigation Information Architecture
Requisito: "Riordinare le pagine laterali in un ordine moderno e coerente con il flusso operativo dell'app."
Accettazione letterale:
- C1: Ordine sidebar orientato al task flow principale: `Dashboard`, `Schedule`, `Climate`, `Statistics`, `Notifications`, `Settings`.
- C2: Nessun riferimento a endpoint legacy/non esistenti nel pannello demo sidebar (es. `vehicle.summary`).
- C3: Build frontend valida dopo il riordino IA.

### F-28 Dashboard Time To Full + Mobile Simulator UX
Requisito: "Il Time To Full in dashboard deve aggiornarsi in modo affidabile; il simulatore non deve rompere il layout in modalità telefonino."
Accettazione letterale:
- C1: `timeToFullChargeH` viene popolato anche quando l'API fornisce valori incompleti, con fallback calcolato da SoC, capacità batteria e potenza di carica.
- C2: Dashboard mostra Time To Full aggiornato runtime da stream websocket senza freeze su valore nullo persistente.
- C3: In mobile il simulatore non occupa sidebar fissa: apertura tramite bottone in alto con pannello popup/overlay chiudibile.
- C4: In desktop il simulatore resta disponibile come pannello laterale dedicato.
- C5: Build frontend/backend valide dopo il refactor UX + calcolo fallback.

### F-29 Demo Simulator Manual State Apply Reliability
Requisito: "Apply Manual State deve applicare i valori inseriti senza essere sovrascritto durante l'editing e deve avere test automatici dedicati."
Accettazione letterale:
- C1: I campi manuali del simulatore non vengono riscritti ad ogni aggiornamento websocket mentre l'utente sta editando.
- C2: È disponibile azione esplicita per sincronizzare i campi manuali con lo stato live corrente (`Sync Inputs From Live State`).
- C3: Dopo `Apply Manual State`, il pannello evidenzia endpoint coerente con lo stato aggiornato (`vehicle.charge_state`).
- C4: Test backend automatici coprono route `PUT /vehicle/data-request/:section` (successo, validazione sezione, VIN mancante).
- C5: Test backend automatici coprono il blocco comandi con failsafe attivo su route vehicle.

### F-30 Settings IA + Target-Aware Time-To-Full + Simulator Close Behavior
Requisito: "Riordinare Settings con focus sul blocco Charging Engine; rendere sempre chiudibile il pannello simulator; rendere Time To Full dipendente dal target SOC rispetto al target auto nella risposta JSON."
Accettazione letterale:
- C1: In Settings il blocco Charging Engine è riordinato in gruppi leggibili (Power/Loop, Battery/Cost, Current Limits) con layout più chiaro.
- C2: Il pannello simulator è apribile/chiudibile anche su desktop con la stessa logica d'uso già presente in mobile (azione esplicita di close).
- C3: Lo stato veicolo espone il target auto letto dalla risposta JSON (`charge_limit_soc`) e la UI mostra un segnalino dedicato sul grafico SoC.
- C4: Se target selezionato utente = target auto: Time To Full usa direttamente il valore veicolo.
- C5: Se target selezionato utente < target auto: Time To Full viene ricalcolato manualmente.
- C6: Se target selezionato utente > target auto: la UI mostra errore esplicito e blocca avvio `plan/on` fino a target valido.
- C7: Build frontend/backend e test backend passano dopo l'integrazione.

### F-31 Full Vehicle JSON Mapping + Cable Status Fidelity
Requisito: "La dashboard deve riflettere correttamente lo stato cavo usando i campi completi del JSON veicolo; il limite hardware auto deve essere indicato in barra SoC con linea verticale interna."
Accettazione letterale:
- C1: Mapping backend esteso da `charge_state` includendo almeno `conn_charge_cable`, `charge_port_latch`, `charge_port_door_open`, `charge_current_request`, `charge_current_request_max`, `usable_battery_level`.
- C2: Lo stato `pluggedIn` non è dedotto solo da `charging_state`, ma da combinazione robusta dei campi cavo/porta/latch del payload reale.
- C3: Dashboard mostra stato cavo dettagliato (tipo cavo + latch + stato porta) invece di solo plugged/unplugged.
- C4: In SoC bar il limite hardware auto (`charge_limit_soc`) è rappresentato con linea verticale interna alla barra, senza label testuale "Selected Target".
- C5: Build frontend/backend e suite test backend restano verdi dopo l'aggiornamento.

### F-32 Full Demo Payload Fidelity + Engine Verification via charging_state
Requisito: "Il simulatore demo deve generare payload `vehicle_data` esteso coerente al JSON reale e offrire controlli utili (es. `charge_limit_soc`, `charging_state`) per verificare il comportamento dell'engine."
Accettazione letterale:
- C1: `fleet-simulator` restituisce `charge_state` e `climate_state` con set esteso di campi reali (timestamps, limiti SoC min/max, charge port/cable metadata, correnti request, placeholder HVAC avanzati) mantenendo shape compatibile al JSON Tesla.
- C2: Endpoint demo `PUT /data_request/charge_state` accetta almeno `charge_limit_soc`, `charging_state`, correnti e campi utili al test dinamico dell'engine.
- C3: Nel pannello simulator UI sono disponibili input per `charge_limit_soc` e `charging_state` oltre ai controlli esistenti.
- C4: Il pannello simulator mostra un hint di coerenza tra stato engine e `charging_state` per verificare rapidamente mismatch runtime.
- C5: In Dashboard, vicino al blocco `Limit`, viene mostrato warning esplicito quando limite auto < target selezionato.
- C6: Build frontend/backend e test backend passano dopo l'estensione.

### F-33 Ordered Dashboard Rewrite + Charging Recap
Requisito: "Riscrivere la Dashboard in modo più ordinato mantenendo i dati attuali ma riducendo ridondanze e spostando il dettaglio sotto la card principale in un recap coerente."
Accettazione letterale:
- C1: Sotto la card principale non esistono più pannelli metrici ridondanti sparsi; i dati sono raccolti in un recap unico e leggibile.
- C2: Il recap separa chiaramente informazioni operative da diagnostica elettrica/limiti.
- C3: Le metriche duplicate già mostrate sopra (es. Home Total/Home Without Charger) non vengono replicate inutilmente in card secondarie.
- C4: La Dashboard mantiene comunque visibili i dati necessari al debug charge loop (actual/pilot/request/max, voltage/phases, hardware range, cable status).
- C5: Gerarchia visiva ordinata: card principale, recap, log engine.

### F-34 Proxy Polling Logic Review
Requisito: "La logica di polling non deve fare chiamate ridondanti ad ogni tick quando `vehicle_data` contiene già le informazioni necessarie."
Accettazione letterale:
- C1: Il polling usa `vehicle_data` come sorgente primaria di stato.
- C2: La richiesta `vehicle_data?endpoints=charge_state` viene eseguita solo come fallback quando il payload completo non contiene `charge_state` utile.

## F-35 Settings Collapsible Domain Panels
- The Settings page should be organized into collapsible domain panels instead of one long continuous form.
- The primary panels should be: Home Assistant, Proxy, Engine Options, and YAML.
- Each panel should keep related inputs grouped together and allow the user to reduce visual noise by collapsing sections that are not being edited.
- Engine-related settings should avoid duplicated fields across multiple cards so that each control has a single clear place in the UI.

## F-36 Dashboard Load Composition Widget
- The top section of the Dashboard should present home consumption using a wider multi-column widget instead of isolated metric cards.
- The widget should include a clear composition bar that visually separates house base load from EV charger load using distinct colors.
- The total home consumption should remain a separate summary value above the split bar.
- The split row labels should stay minimal and should not explicitly repeat subtraction formulas if the visual structure already makes the meaning clear.
- The visual structure should follow an EVCC-inspired energy-flow layout, with the horizontal load bar as the dominant element and secondary statistics kept minimal.
- Labels and helper copy inside this top widget should stay consistent with the rest of the app: English-only and intentionally minimal.
- The top area should use a responsive two-column layout on wider screens, with the energy-flow widget alongside the main charging control card.
- The energy-flow widget should not duplicate live charging cost or tariff values if those are already presented in the adjacent charging control card.
- On narrow mobile widths, the top two widgets should remain compact enough to be visible within a single screen view as much as possible.
- The top widgets should favor compact vertical density over explanatory copy so that mobile users can see both blocks together more easily.

## F-37 Proxy Live Status In Settings
- The Proxy panel in Settings should expose a clear live status indicator similar to the Home Assistant panel.
- The indicator should show whether the latest proxy polling is returning valid live vehicle data.
- When the proxy is not live, the panel should surface the latest known proxy error or an explicit offline message.

## F-38 Dashboard Details Rewrite
- The old `Charging Recap` section should be replaced with a leaner `Vehicle Details` summary.
- The new lower summary should avoid repeating values already shown in the energy-flow widget or the main charging control card.
- The section should prioritize live technical details that are still useful for diagnostics: cable status, current/request, climate state, and electrical/limit context.
- Power, home load, live cost, tariff, and other already prominent dashboard values should not be repeated inside this lower details block.

## F-39 Target SoC Draggable + Vehicle Details Collapsible Proxy Panel

### F-39A Target SoC Manual Control By Mode
Requisito: "Target SoC deve essere drag; il cursore target 80% non è un valore statico ma decidibile da utente. Rimane fisso se siamo in modalità PLAN perché va preso il setpoint del plan ma in modalità Off o On deve essere manualmente modificabile."
Accettazione letterale:
- C1: In modalità Off e On il cursore SoC è trascinabile/cliccabile dall'utente e aggiorna il target manuale locale.
- C2: In modalità Plan il cursore è bloccato (click e drag disabilitati), cursore `not-allowed`, opacità ridotta, e mostra helper text "Target set by schedule".
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

### F-39C Dashboard Rewrite From Scratch
Requisito: "Riscrivere tutta la dashboard utilizzando lo stesso stile ma cancellando tutto il contenuto e ripartendo da zero per essere certi che tutto sia ok. Recupera solo l'aspetto e riscrivi la logica in modo migliore."

### F-40 Weekly Recurrent Scheduling + Dashboard-like Widgets
Requisito: "Le schedule devono poter essere ripetitive per giorni della settimana (senza scelta data) e i widget della pagina scheduling devono richiamare il linguaggio visivo della dashboard."
Accettazione letterale:
- C1: Creazione schedule charging con selezione multipla giorni settimana + orario (senza input data obbligatorio).
- C2: Ogni schedule settimanale viene rieseguita automaticamente ogni settimana senza auto-disabilitarsi dopo il primo run.
- C3: Endpoint backend scheduling accetta tipo `weekly` e risolve correttamente la prossima esecuzione anche per `/api/schedule/next-charge`.
- C4: Lista schedule mostra chiaramente pattern ripetitivo (`Every <weekday> at <time>`).
- C5: Widget/section della pagina scheduling devono usare card arrotondate, gerarchia e densità visiva coerenti con la dashboard.
- C6: Le modalità esistenti `start_at`, `start_end` (e `finish_by` per charging) devono restare disponibili e non essere rimosse.
- C7: Weekly scheduling disponibile sia per charging sia per climate.
- C8: La pagina scheduling usa un unico pannello Settings con due selettori modalità (`Charger`/`Climate`).
- C9: Sono presenti bottoni rapidi `Oggi` e `Domani` per preimpostare il giorno target nel form corrente.
- C10: Sotto il pannello Settings sono presenti due recap separati: `Charger Recap` e `Climate Recap`.
Accettazione letterale:
- C1: Il file `DashboardPage.tsx` viene riscritto da zero: nessuna riga del corpo precedente viene mantenuta verbatim.
- C2: L'identità visiva è preservata: palette Tailwind `evload-*`, card `rounded-3xl`, icone `lucide-react`, spaziatura e font identici all'attuale.
- C3: I componenti puri (`EvccSocBar`, `ModePill`, `FlowStatRow`, `CollapsibleJsonPanel`) sono separati dalla logica di pagina, dichiarati sopra il componente principale, senza business logic inlinata nel JSX.
- C4: La logica `computeTimeToTargetH` è una funzione pura autonoma senza dipendenze da variabili esterne al suo scope.
- C5: Tutti i dati esistenti sono preservati: Energy Flow, Next Charge, Engine Log, potenze, SoC, costi, metriche elettriche.
- C6: Nessun commento nel codice (regola 12). Nomi variabili semantici coerenti col dominio EV (regola 19).
- C7: Build TypeScript frontend (`npm run build`) priva di errori dopo la riscrittura.

## Regola Finale Anti-Regressione

Quando un item e' `VERIFIED`, rieseguire i test/build minimi e confermare che non rompe item gia' verificati.
Se una modifica altera comportamento specifico richiesto, riportare immediatamente `REGRESSION`.

