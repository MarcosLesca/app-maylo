# TV browser receiver

The Hisense 50A4QS (VIDAA U9, 192.168.0.248) has no DLNA renderer: it answers SSDP only for DIAL. Cast any web video by opening a receiver page served by the phone in the TV's VIDAA browser; "Ver en la tele" then plays the video there and the app's remote keeps working.
Builds on modules/tv-cast (CastProxy HTTP server, proxiedUrl) and the cast sheet/remote. Android only; tokens from design/system.md.

## Specs

- **S1 Receiver address.** The phone serves the receiver page at `http://<phone Wi-Fi IP>:8765/tv/<key>` (fixed port 8765; if taken, the next free port up to 8775 and the screen shows the real one). `<key>` is a random 6-character code generated once and persisted on the phone, so the TV can keep it as a favorite. Wrong key → 404. The server runs while the cast browser or the connect screen is open, even when no proxy session is active (stopProxy revokes sessions but does not stop the receiver).
- **S2 Connect screen.** From the sheet ("Usar el navegador de la tele") the user sees the address in large type, the steps ("En la tele abrí el navegador, entrá a esta dirección y guardala en favoritos"), and a live status: "Esperando a la tele…" / "Tele conectada (192.168.0.248)". 
- **S3 Receiver page (runs in the TV's VIDAA browser).** Self-contained HTML/JS, no external URLs except the video itself: fullscreen black page with an idle message "Listo para recibir videos de MayLo" and the phone's name; long-polls the phone for commands; plays MP4/WebM directly and HLS with hls.js (vendored, served by the phone from the module assets, license notice included) falling back to native HLS; reports state (playing/paused/ended/error, position, duration, volume, muted, last error) about every second; reconnects automatically when the phone server restarts. Large on-screen error text when a video fails ("No se pudo reproducir este video").
- **S4 Command channel.** Commands from the app: load {url, title}, play, pause, seek {seconds}, stop, volume {0-100}, mute {bool}. Delivered in order, at most once; the TV long-poll returns within ~25 s when idle. Only requests carrying the key are accepted; the state POST is size-limited.
- **S5 App integration.** A connected receiver (state seen within the last 5 s) appears in the sheet's TV list as "Navegador de la tele (<TV IP>)" alongside DLNA TVs. "Ver en la tele" on it sends `load` with the proxied URL (proxiedUrl, so Referer/UA/Cookie still apply) and the title. The remote (progress, ±10 s, pausa, volumen, silenciar, Detener, Elegir otra tele) works on the receiver through the command channel and its reported state, with the same UI and the same "one command at a time" rule.
- **S6 Report clean-up.** The discovery report no longer lists the phone's own M-SEARCH packets as a device (sender = the phone's Wi-Fi address), and when the only TV-like device answers DIAL only, the sheet suggests "Usar el navegador de la tele".
- **S7 Release.** Version 1.5.0; README cast entry explains the receiver.

## Tasks

- [x] T1 — S1, S4 (native side) — worker A: receiver routes in the tv-cast HTTP server, fixed port, key check, command queue + long-poll, state store, vendored hls.js asset, receiver lifetime independent of proxy sessions — commit:
- [x] T2 — S2, S3, S4 (JS side), S5, S6 — worker B: receiver page, JS receiver client, connect screen, renderer abstraction in sheet/remote, report clean-up — commit:
- [ ] T3 — S7 — inline: integrate, verify, version, docs, PR, release — commit:

## Contract between T1 and T2 (modules/tv-cast/index.ts, all optional on old APKs)

- `startReceiverAsync(key: string, html: string): Promise<{ url: string; port: number; address: string }>` — starts the server if needed and serves `html` at `GET /tv/<key>`; `GET /tv/<key>/hls.js` serves the vendored hls.js.
- `pushReceiverCommandAsync(command: string): Promise<void>` — `command` is a JSON object string; appended to the queue with an increasing `id`.
- `GET /tv/<key>/commands?after=<id>` (TV side) → `{"commands":[{"id":n, ...command}]}`; waits up to 25 s when empty.
- `POST /tv/<key>/state` (TV side) body JSON ≤ 16 KB → 204; stored with the sender IP and time.
- `getReceiverStateAsync(): Promise<{ connected: boolean; address: string; lastSeenMs: number; state: string }>` — `connected` = state posted within 5 s; `state` = last JSON body.
- `stopReceiverAsync(): Promise<void>`.
- If `after` is greater than the highest id issued by the current server run (the phone app restarted), it is treated as `after=0`.
- Commands: `{"type":"load","url","title"}` | `{"type":"play"|"pause"|"stop"}` | `{"type":"seek","seconds"}` | `{"type":"volume","level":0-100}` | `{"type":"mute","muted":bool}`. State: `{"status":"idle|loading|playing|paused|ended|error","position","duration","volume","muted","error","title"}`.

## Log

- L1 (user, verbatim): "09:06:58 Buscar: ninguna TV respondió … 192.168.0.248 (Hisense 50A4QS) respondió por DIAL pero no ofrece reproductor DLNA (AVTransport) … Búsqueda directa a 192.168.0.248: 0 respuestas" after Content Sharing on (Settings → Conexión → Conexión de dispositivos multimedia) and a TV restart.
- L2 (user): chose "Receptor en el navegador de la tele (recomendado)".
- L3 (verify mwsiv1pq): no blockers; S1-S6 met in code; Kotlin compile only in the release workflow. Applied suggestion 1 (receiver page backs off 2 s after an immediate empty long-poll). Commits 9eaa452 (T1), b5dc65f (T2), 7f451e1 (1.5.0).
