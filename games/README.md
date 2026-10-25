# Giochi delle vocali

Apri i giochi online: **[https://pamaldi.github.io/letters-games/](https://pamaldi.github.io/letters-games/)**.

Apri `index.html` per scegliere un gioco o un'attività del percorso.

## Percorso

- **Ascolta e trova** apre Gol delle vocali. Le vocali iniziali sono A ed E; il genitore può selezionare qualsiasi gruppo di vocali, anche una sola.
- **Leggi** mostra una vocale senza pronunciarla. Dopo la risposta del bambino, l'adulto può ascoltare la voce e confermare la lettura. Il minuscolo è disponibile per questa attività; la scrittura parte dallo stampato maiuscolo.
- **Scrivi** propone modello animato, traccia larga, traccia leggera e prova con un modello piccolo. In Miniera il percorso di scrittura permette di aggiungere un mattone. Si può chiudere e riprovare senza perdere costruzioni.
- **Come si gioca** offre una spiegazione che si può ascoltare.
- **Progressi** distingue risposte autonome, risposte con aiuto, lettura confermata dall'adulto e percorsi di scrittura completati.

Nei menu dei giochi apri **Vocali, percorso e progressi** per modificare le opzioni prima della partita. La modalità tranquilla è predefinita: non toglie mattoni, non assegna punti agli avversari per gli errori e lascia il tempo di rispondere. Caccia termina dopo dieci vocali trovate. La modalità **Sfida** conserva velocità e penalità dei giochi originali.

In Luna l'opzione autonoma pronuncia la parola senza anticipare la vocale mancante; dopo due errori offre un aiuto esplicito. L'opzione dei colori uguali permette di esercitare il riconoscimento della forma. La voce e gli effetti hanno controlli separati.

Il controllo della scrittura confronta copertura e vicinanza del tratto con un modello tollerante. Non valuta ordine dei tratti, impugnatura o abilità su carta. La lettura non usa riconoscimento vocale automatico. I progressi rimangono nel browser del dispositivo, senza sincronizzazione.

## Pubblicazione su GitHub Pages

Carica nella stessa cartella tutti i file HTML dei giochi, `index.html`, **`learning.js` e `learning.css`**. I due file condivisi sono necessari: caricare soltanto gli HTML non basta. Non serve una compilazione.

## Verifica

`scripts/test_games_learning.cjs`, nella cartella superiore del progetto, controlla sintassi, collegamenti, avvio dei giochi e i principali percorsi con Playwright e Microsoft Edge. Eseguilo dalla radice del progetto con `node scripts/test_games_learning.cjs`, rendendo disponibile il pacchetto `playwright` nella risoluzione dei moduli Node.
