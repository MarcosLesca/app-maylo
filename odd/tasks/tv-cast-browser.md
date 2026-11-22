# TV cast browser

In-app browser in MayLo that detects the video playing on any page and sends it to the Hisense VIDAA TV over DLNA ("Ver en la tele"), following design/tv-cast/03-navegador-con-cast.html.
Builds on the DLNA spike (commit f338970): modules/tv-cast, src/features/cast/dlna*.ts. Android only; tokens from design/system.md.

## Specs

- **S1 Browser.** "la idea mia es poder tener un apartado en la app para cast cualquier pagina que quiera". A screen with a WebView that can open any page. Top bar per artboard: back button (goes back in web history, or leaves the screen when there is none), address pill with a lock icon showing the current URL (tap to edit; typed text that is not a URL becomes a web search), and a cast icon button on an accentSoft circle. Loading and load-error states visible.
- **S2 Video detector.** JS injected into every frame (including cross-origin iframes) reports candidate video URLs: `<video>`/`<source>` src (skip `blob:`), and network requests (fetch/XHR) whose path ends in `.m3u8`, `.mp4`, `.webm` or `.mkv`. Each candidate carries the URL, the page URL it came from (used as Referer), the page title, the frame's `navigator.userAgent` and `document.cookie`. Deduplicated; cleared when the top page navigates. Generic for every site: no per-site rules, no bypassing of DRM or protections.
- **S3 "Ver en la tele" pill.** When at least one video is detected, an accent pill with the TV icon and the label "Ver en la tele" floats over the bottom of the page. The cast icon button in the top bar opens the same sheet at any time (with no video it explains that none was found yet).
- **S4 Sheet.** Bottom sheet titled "Ver en la tele" over a scrim: the detected video row (thumbnail block, page title, "Video MP4" / "Video HLS" and "1 encontrado en la página" / "N encontrados en la página"); the TV list, searching automatically when opened, with the status line "Buscando otras teles en tu Wi-Fi…" while searching; and an outlined row "Duplicar la pantalla" with "Si el video no anda: muestra todo el teléfono en la tele" that opens Android's cast settings. Tapping a TV casts the selected video; then the sheet shows it playing on that TV with Pausa / Detener, and errors inline in plain Spanish.
- **S5 Proxy.** The TV cannot send the page's Referer, User-Agent or cookies, so videos are served to the TV through an HTTP server on the phone (`http://<phone Wi-Fi IP>:<port>/...`). It forwards GET/HEAD with those headers, passes Range requests and status codes through, and rewrites HLS playlists (`.m3u8`, including nested playlists, segment and `#EXT-X-KEY`/`#EXT-X-MAP` URIs) so every URI also goes through the proxy. Only URLs under an unguessable per-cast session token are served, so it is not an open relay on the LAN.
- **S7 Full remote.** Design comment on design/tv-cast/02-paso-a-paso.html: "agregale estos controles ...."; the user chose "Retroceder / adelantar 10 s", "Barra de progreso con tiempo" and "Volumen y silencio", and answered "Sí, como tarea nueva al final" to adding them to the app. While a video plays on the TV, the sheet shows: a draggable progress bar with current time / duration (GetPositionInfo, polled while visible; Seek REL_TIME on release), −10 s / +10 s buttons beside Pausa, and TV volume with Silenciar, − and + plus the current level (RenderingControl GetVolume/SetVolume/SetMute). Layout per the updated 02 artboard's playing screen.
- **S6 Entry.** The TV button in the tabs header opens the browser. The existing test panel stays reachable from the browser for diagnosis.

## Tasks

- [x] T1 — S1, S2, S3, S4, S6 — worker A (browser, detector, sheet) — commit: b7cc6e1
- [x] T2 — S5 — worker B (native proxy + JS wrapper) — commit: 3a7b7b7
- [ ] T3 — S4, S5 — inline: cast through the proxy from the sheet, verify, review — commit: 47a6c7b (verify + review pending)
- [x] T4 — S7 — full remote (seek, progress, volume) — commit: a50cafc (Detener / Elegir otra tele also revoke the proxy session; independent verify pending with the T3 re-check)

## Log

- L1 (user, verbatim): "investiguemos.. .tengo un tv haisense de 50 pulgadas con VIDDA.. quiero transmitir (cast) una peli desde mi telefono con el navegador o cualqier video que este en el navegador... (eg cinecalidad.am) la idea mia es poder tener un apartado en la app para cast cualquier pagina que quiera"
- L2 (user, verbatim): "para pero yo puedo entrar a youtube y me aparece el (cast) para transmitirlo... o lo mismo me pasa en spotify eso quiero"
- L3 (user): TV model "Televisor Hisense Smart TV 50\" FHD LED A4NV" (VIDAA U9, DLNA "Compartir contenido").
- L4 (user): chose artboard design/tv-cast/03-navegador-con-cast.html ("Navegador con botón “Ver en la tele”") to implement; 01 and 02 are alternatives. Design: design/tv-cast/.
- L5 (decision): the browser replaces /cast; the spike panel moves to /cast-test. The proxy contract between T1 and T2 is `src/features/cast/proxy.ts` exporting `proxiedUrl(target: string, headers: Record<string, string>): Promise<string>` (starts the server on demand) and `stopProxy(): Promise<void>`.
- L7 (user): "me gustaria que [remote controls of 02] esta parte este aca... [03]" → 03 artboard got a third phone: the sheet becomes the full remote after casting; S7 follows that phone. Design commit bdf7b80.
- L8 (slice): branch is ~3,100 authored lines over 6 commits (spike, design, proxy, browser, design, wiring); publish as chained PRs split at those commits.
- L9 (verify mwsbbu3h, range d044564..47a6c7b): S1, S3, S4, S6 met. Blockers: S2 detector never runs in iframes (react-native-webview 14 Android ignores *ForMainFrameOnly); S5 Cookie sent to any host a playlist names + token holder can fetch any URL; S5 sessions never revoked (stopProxy unused). Advisories: loopback/LAN SSRF, catch Exception not Throwable, slow-header pool exhaustion, tun/hotspot interface pick, https→http cookie, Range on extensionless playlist, java.net.URL vs WHATWG. Fix worker launched (allow-set per session, cookie host binding, addDocumentStartJavaScript for iframes + "Abrir el reproductor" fallback, revoke on new cast/unmount).
- L6 (user): design comment 1loruqx9 on 02 "agregale estos controles ...." → chose seek ±10 s, progress bar with time, volume and mute; then "Sí, como tarea nueva al final" → S7 / T4.
