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
Requisito: "On top of the page (Actual Grid power consumption, power consumption of auto (grid - charger))"
Accettazione letterale:
- C1: Entrambe metriche sono in top section dashboard.
- C2: Formula auto = grid - charger rispettata letteralmente.
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
Requisito: "url, grid entity, charger entity, home assistant authorization with validity status and read of the entity"
Accettazione letterale:
- C1: Campi URL, grid entity, charger entity presenti.
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
Requisito: "Throttle reducing A immediately; ramp up at configurable interval using Grid Power formula (see F-22)"
Accettazione letterale:
- C1: In riduzione: throttle immediato al valore massimo consentito dalla griglia.
- C2: In ripresa: il setpoint viene ricalcolato ad ogni intervallo (Ramp Up Interval) usando la formula definita in F-22.
- C3: Se Grid Power non disponibile (HA disconnesso o valore null): nessun ramp, mantieni setpoint corrente.
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
- C1: Modalità demo (toggle switch) presente in Settings. Quando attiva, deve generare valori simulati per TUTTE le entità (inclusa la nuova Grid Power).
- C2: Pannello Home Assistant con: URL, Charger Power Entity, Grid Power Entity. TUTTE le entità HA sono obbligatorie.
- C3: Pulsante "Connect" per flusso OAuth Home Assistant con indicazione di validità.
- C4: Lettura realtime delle entità HA direttamente nel pannello settings per verifica.
- C5: Pannello Proxy con: URL e VIN (Vehicle Identification Number).
- C6: Pannello Charging Engine Rules con: Max Grid Power, Battery Capacity, Start A, Min A, Max A, time increase for each step A.
- C7: Sezione "Full configuration yaml" per visualizzazione/editing avanzato.
- C8: Pulsante "Sign-out" spostato in ALTO nella pagina (non in fondo).

### F-22 Charging Engine Smart Current Algorithm
Requisito: "Engine calcola la corrente di ricarica usando: Grid Power - Charger Power = Residual Power; Residual Power / Vehicle Voltage = A delta; New setpoint = A actual + A delta; usa il tempo di loop (Ramp Up Interval) configurabile da settings."
Accettazione letterale:
- C1: Formula end-to-end implementata: `Residual Power W = Grid Power W - Charger Power W`.
- C2: `A delta = Residual Power W / Vehicle Voltage V` (ampere disponibili dalla rete residua).
- C3: `New setpoint amps = A actual + A delta` (non incremento fisso +1A).
- C4: Il campo `rampIntervalSec` (Ramp Up Interval / Loop Refresh Rate) è configurabile in settings e usato come intervallo di aggiornamento del loop engine.
- C5: Fallback se Grid Power non disponibile (HA disconnesso): mantieni setpoint corrente senza variazioni.
- C6: Test automatici verificano la formula con valori noti: Grid Power X, Charger Power Y, Voltage Z → setpoint atteso calcolato correttamente.
- C7: Tutte le variabili interne usano nomi espliciti di dominio: `gridPowerW`, `chargerPowerW`, `vehicleVoltageV`, `residualPowerW`, `deltaAmps` (regola 19).

## Regola Finale Anti-Regressione

Quando un item e' `VERIFIED`, rieseguire i test/build minimi e confermare che non rompe item gia' verificati.
Se una modifica altera comportamento specifico richiesto, riportare immediatamente `REGRESSION`.

