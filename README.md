# 🕵️ Impostor

A real-time multiplayer word game: everyone gets the same secret word except the impostor(s), who get a related word. Take turns giving clues, then vote out the impostor.

Built with Node.js, Express and Socket.io. No database, no build step.

## How to play

1. **Create** a game, or **join** with a room code / invite link.
2. In the lobby the host picks how many impostors (1–5, fewer than the players) and starts.
3. Everyone taps their card to see their word. Impostors also see **YOU ARE THE IMPOSTOR**.
4. Players speak in the shown order and tap **Speak now** when done.
5. The host unlocks voting. When everybody has voted (or the host ends the round), results are shown.
6. **Scoring:** if an impostor is among the most-voted players, every crewmate gets +1. Otherwise every impostor gets +1.
7. The host can deal a **new word**, start a **new round**, or **end the game** to show the podium.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restarts on file changes
npm test           # game-rule and socket integration tests
```

To test several players on one machine, use separate tabs: each tab is its own player.

## Deploy (Render)

- **Build command:** `npm install`
- **Start command:** `npm start`
- Health check path: `/healthz`

Optional environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port (Render sets this) |
| `ROOM_CODE_LENGTH` | `4` | Digits in a room code |
| `MAX_PLAYERS_PER_ROOM` | `20` | Players per room |
| `MAX_ROOMS` | `5000` | Rooms the server will hold at once |
| `HOST_RECONNECT_GRACE_MS` | `60000` | How long a room waits for a disconnected host before closing |

All game state lives in memory in a single process, so run **one instance**. Rooms are lost on restart/redeploy.

## Project structure

```
server.js              HTTP + Socket.io bootstrap, health check, graceful shutdown
src/
  config.js            Limits and timings
  words.js             Word pairs (crew word → impostor word)
  Room.js              Game rules and state for one room (no networking, unit-tested)
  RoomManager.js       Room codes, lookup, expiry of abandoned rooms
  realtime.js          Socket protocol: validation, rate limiting, broadcasting
  utils.js             Errors, shuffle, input cleaning, rate limiter, logging
public/
  index.html           All screens and dialogs
  css/app.css          Styles
  js/main.js           App controller: connection, state, screen selection, effects
  js/net.js            Socket wrapper with request/acknowledgement promises
  js/storage.js        Session (per tab) and preferences
  js/ui.js, dom.js     Avatars, toasts, dialogs, confetti, DOM helpers
  js/sounds.js         Synthesised sound effects
  js/starfield.js      Animated background
  js/screens/*.js      home, lobby, reveal, playing, results, gameover
test/                  node:test suites
```

### How it works

- The server is the single source of truth. After every change it sends each player a personalised `state` snapshot (only their own word and role). The client just renders the latest snapshot, so players can't drift out of sync.
- Every client action is a request with an acknowledgement (`{ ok }` or `{ ok: false, error }`), so errors are shown to the right person.
- Each player gets a secret session token saved in the tab. Reloading, losing signal or locking the phone rejoins the same seat with the same word, vote and score.
- If the host disconnects, the room waits up to 60 s for them before closing. If the host leaves on purpose, the room closes right away.
- Inputs are validated server-side, each socket is rate-limited, and abandoned rooms are cleaned up automatically.

### Adding words

Add a line to `src/words.js`: `"Crew word": "Impostor word",`. Keys must be unique — `npm test` fails if one is duplicated.
