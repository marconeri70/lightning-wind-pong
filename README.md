# Lightning vs Wind Pong V5 — Cloudflare Multiplayer

## Cosa contiene

### Frontend GitHub Pages
- `index.html`
- `style.css`
- `script.js`
- `multiplayer-config.js`
- `manifest.webmanifest`
- `sw.js`
- icone PWA

### Backend Cloudflare
Cartella `cloudflare-worker/`
- `src/index.js`
- `wrangler.jsonc`
- `package.json`

Il multiplayer usa:
- Cloudflare Worker
- Durable Object `GameRoom`
- WebSocket
- WebSocket Hibernation API per le connessioni
- stato partita autorevole lato Cloudflare
- una stanza per ogni codice di 6 caratteri

## Flusso online

Telefono A:
1. apre il gioco
2. `2 TELEFONI ONLINE`
3. `CREA STANZA`
4. riceve un codice, per esempio `K7M4P2`

Telefono B:
1. apre lo stesso gioco
2. `2 TELEFONI ONLINE`
3. inserisce `K7M4P2`
4. entra nella stanza

Il primo ruolo libero diventa Lightning, il secondo Wind.
Quando entrambi sono collegati parte il conto alla rovescia.

## Dopo il deploy Worker

Apri `multiplayer-config.js` e sostituisci:

`https://REPLACE-WITH-YOUR-WORKER.workers.dev`

con l'URL reale del Worker, per esempio:

`https://lightning-wind-pong-multiplayer.nomeaccount.workers.dev`

Poi carica/aggiorna i file del frontend su GitHub Pages.


## V5.1

Cloudflare multiplayer build enabled
- Worker name aligned to Cloudflare project: `lightning-wind-pong`
- Multiplayer URL already configured: `https://lightning-wind-pong.vocidicassino.workers.dev`
