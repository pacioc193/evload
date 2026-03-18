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

## Logica Di Comunicazione EVLoad <-> Proxy (Implementata)

Hard-cleaning note (March 2026): runtime status logic uses a single polling endpoint `vehicle_data`; legacy heartbeat-based references below are superseded by F-21 and retained only as historical context.

Questa sezione descrive il comportamento effettivamente implementato nel codice attuale tra EVLoad e proxy Tesla.

### Flusso Runtime Principale
- EVLoad usa un client HTTP dedicato verso il proxy con TLS configurabile tramite `proxy.rejectUnauthorized`.
- Ogni risposta riuscita del proxy aggiorna uno stato separato `proxyHealthState` con `connected`, `lastSuccessAt`, `lastEndpoint`, `error`.
- Lo stato proxy e lo stato veicolo sono separati: il proxy puo' risultare LIVE anche quando l'auto dorme o `vehicle_data` non sta girando in quel momento.

### Loop 1 - Poll Completo Del Veicolo (`vehicle_data`)
- Il loop `NORMAL` gira con intervallo `proxy.normalPollIntervalMs`.
- In `NORMAL`, EVLoad chiama `GET /api/1/vehicles/:vehicleId/vehicle_data`.
- Se il payload completo non contiene un `charge_state` utile ma il veicolo non e' segnalato come asleep, EVLoad esegue solo allora il fallback `GET /api/1/vehicles/:vehicleId/vehicle_data?endpoints=charge_state`.
- Da `vehicle_data` EVLoad ricava stato di ricarica, SoC, limiti, temperatura, tensione, corrente, fasi, range, lock state, odometro e raw payload diagnostici.

### Loop 2 - Heartbeat Leggero (`body_controller_state`)
- Il loop heartbeat gira sempre con intervallo `proxy.reactivePollIntervalMs`, indipendentemente dal fatto che il sistema sia in `NORMAL` o `REACTIVE`.
- Il heartbeat usa `GET /api/1/vehicles/:vehicleId/body_controller_state`.
- Il heartbeat aggiorna `proxyHealthState` e i campi `vehicleSleepStatus` / `userPresence` senza richiedere `vehicle_data`.
- In `REACTIVE`, una risposta heartbeat valida mantiene il veicolo marcato come raggiungibile anche se non si stanno facendo refresh completi `vehicle_data`.

### Passaggio Di Modalita'
- Stato iniziale: `NORMAL`.
- Se `vehicle_data` o il heartbeat confermano `VEHICLE_SLEEP_STATUS_ASLEEP` per due cicli consecutivi e il veicolo non sta caricando, EVLoad passa a `REACTIVE` senza inviare `wake_up`.
- Se in `REACTIVE` il heartbeat vede `userPresence = VEHICLE_USER_PRESENCE_PRESENT`, EVLoad torna a `NORMAL`.
- Se in `REACTIVE` il heartbeat vede `VEHICLE_SLEEP_STATUS_AWAKE`, EVLoad torna a `NORMAL`.
- `requestWakeMode()` forza sempre `NORMAL`, resetta i contatori sleep e riavvia entrambi i timer.

### Comandi Verso Il Proxy
- Avvio manuale motore: `startEngine()` chiama `requestWakeMode(false)` prima di avviare il ciclo motore, quindi forza `NORMAL` ma non invia automaticamente `wake_up`.
- Wake manuale esplicito: `POST /api/engine/wake` chiama `requestWakeMode(true)` e quindi invia `POST /api/1/vehicles/:vehicleId/command/wake_up`.
- Scheduler: prima degli start pianificati e quando una schedule entra nella lead window, usa `requestWakeMode(true)` per risvegliare il veicolo.
- Comandi runtime verso il proxy passano da `POST /api/1/vehicles/:vehicleId/command/:command`.
- Aggiornamenti dati Tesla mutabili passano da `PUT /api/1/vehicles/:vehicleId/data_request/:section`.

### Coordinamento Tra Scheduler E Wake
- `scheduleLeadTimeSec` definisce quanti secondi prima del prossimo start pianificato EVLoad puo' passare a wake mode.
- Il scheduler evita wake ripetuti per la stessa occorrenza tramite una chiave interna di deduplicazione.
- Gli start pianificati (`start_at`, `weekly`, `start_end`, `finish_by`) chiamano sempre il percorso con wake prima dell'avvio del motore.

### Stato Live Esposto Alla Interfaccia
- WebSocket backend espone separatamente `proxy`, `vehicle` e `pollMode`.
- `proxy` contiene lo stato live del proxy basato sull'ultima chiamata riuscita a qualunque endpoint proxy supportato, incluso `body_controller_state`.
- La dashboard mostra il badge modalità (`NORMAL` / `REACTIVE`) e il pulsante `Wake Vehicle`.
- Le impostazioni mostrano lo stato LIVE/OFFLINE del proxy, l'ultimo endpoint riuscito, l'ultimo timestamp di successo e la configurazione proxy completa.

### Parita' Simulatore
- Il simulatore supporta `vehicle_data`, fallback `?endpoints=charge_state`, `body_controller_state`, i comandi `wake_up`, `sleep`, `charge_start`, `charge_stop`, `set_charging_amps`, `set_temps`.
- `body_controller_state` del simulatore restituisce `vehicleSleepStatus`, `vehicleLockState` e `userPresence` coerenti con lo stato simulato.

### Tabella Operativa Endpoint Proxy

| Endpoint proxy | Metodo | Chi lo usa | Quando parte | Effetto principale |
|---|---|---|---|---|
| `/api/1/vehicles/:vehicleId/vehicle_data` | `GET` | `proxy.service` | Loop `NORMAL` su `normalPollIntervalMs` | Aggiorna stato veicolo completo e diagnostica raw |
| `/api/1/vehicles/:vehicleId/vehicle_data?endpoints=charge_state` | `GET` | `proxy.service` | Solo fallback se `vehicle_data` non contiene `charge_state` utile | Recupera il solo `charge_state` senza duplicare sempre la chiamata |
| `/api/1/vehicles/:vehicleId/body_controller_state` | `GET` | `proxy.service` | Heartbeat continuo su `reactivePollIntervalMs` | Aggiorna `proxyHealthState`, `vehicleSleepStatus`, `userPresence` e supporta lo switch `NORMAL` / `REACTIVE` |
| `/api/1/vehicles/:vehicleId/command/wake_up` | `POST` | `requestWakeMode(true)` via engine route o scheduler | Wake manuale o pre-wake schedulato | Forza il ritorno a `NORMAL` e tenta il risveglio dell'auto |
| `/api/1/vehicles/:vehicleId/command/charge_start` | `POST` | engine / scheduler | Avvio ricarica | Comando Tesla di start charging |
| `/api/1/vehicles/:vehicleId/command/charge_stop` | `POST` | engine / scheduler | Stop manuale, end plan, stop engine | Comando Tesla di stop charging |
| `/api/1/vehicles/:vehicleId/command/set_charging_amps` | `POST` | engine | Durante balancing e throttling HA | Aggiorna il current request del veicolo |
| `/api/1/vehicles/:vehicleId/command/set_temps` | `POST` | climate / scheduler | Start climate manuale o schedulato | Imposta temperature abitacolo |
| `/api/1/vehicles/:vehicleId/data_request/charge_state` | `PUT` | servizi backend | Quando serve aggiornare dati mutabili Tesla lato proxy | Aggiorna `charge_state` via proxy e rinnova health state |
| `/api/1/vehicles/:vehicleId/data_request/climate_state` | `PUT` | servizi backend | Quando serve aggiornare dati clima lato proxy | Aggiorna `climate_state` via proxy e rinnova health state |

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

## Regola Finale Anti-Regressione

Quando un item e' `VERIFIED`, rieseguire i test/build minimi e confermare che non rompe item gia' verificati.
Se una modifica altera comportamento specifico richiesto, riportare immediatamente `REGRESSION`.

