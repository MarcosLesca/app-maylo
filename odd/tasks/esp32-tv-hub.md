# ESP32 TV hub

A fixed address for the TV browser receiver: an ESP32 DevKit (Arduino IDE) on the home Wi-Fi with a reserved IP. The TV keeps ONE favorite pointing at the ESP32; it forwards the TV to whichever phone is home. Video still flows phone → TV through the phone proxy; the ESP32 only registers phones and redirects. Stage 2 (house DNS / ad blocking on the ESP32) is out of scope here.

## Specs

- **S1 Firmware (Arduino IDE, ESP32 DevKit).** `esp32/tv-hub/tv-hub.ino` plus `secrets.example.h` (Wi-Fi SSID/password; real `secrets.h` gitignored). Connects to Wi-Fi (STA), hostname `maylo-tv` (and mDNS `maylo-tv.local`, best effort), reconnects automatically, HTTP server on port 80. A README explains: install the ESP32 board package, copy secrets, upload, reserve the ESP32 IP in the TP-Link (Avanzado → Red → Servidor DHCP → Reserva de direcciones), save `http://<esp32-ip>/` as the TV favorite.
- **S2 Registry.** `POST /register` with JSON `{"url":"http://<ip>:<port>/tv/<key>","name":"<member name>"}`: accepted only when `url` matches `^http://<ipv4>:87(6[5-9]|7[0-5])/tv/[A-Za-z0-9]{6}$` AND its IP equals the request's remote IP (a device can only register itself); name trimmed to 40 chars; stores up to 4 phones (keyed by IP) with last-seen time; 204, else 400. `GET /phones` → JSON `{"phones":[{"url","name","ageSeconds"}]}` sorted by most recent, only entries seen within 180 s. CORS `Access-Control-Allow-Origin: *` and OPTIONS 204 on both. Body limit 512 bytes.
- **S3 TV entry page.** `GET /` → small ES5 HTML page (no external URLs) "MayLo · Buscando un teléfono en casa…": fetches `/phones`, tries the most recent phone first by probing `<url>/hls.js` with an XHR HEAD/GET (timeout 2 s; CORS is enabled on the phones), and redirects with `location.replace(url + '?hub=' + encodeURIComponent(location.origin))` to the first that answers; if none, shows "Abrí la app MayLo en un teléfono (Ver en la tele → Usar el navegador de la tele)" and retries every 5 s.
- **S4 Phone side (app).** The connect screen has a "Hub de la tele (ESP32)" address field (default `http://maylo-tv.local`, editable, saved and shared through Supabase or AsyncStorage — implementer's choice, documented); while the receiver is held the phone POSTs `/register` every 60 s and on address change. The receiver page, when loaded with `?hub=`, goes back to the hub (`location.replace(hub)`) after its own phone stops answering for ~15 s, so the hub can forward it to the other phone.

## Tasks

- [x] T1 — S1, S2, S3 — worker: firmware + README in `esp32/tv-hub/` — commit: ec38640
- [x] T2 — S4 — 26628ea — after odd/tasks/shared-bulk-and-receivers.md T2 lands: app registration + hub fallback in the receiver page — commit:

## Log

- L1 (user, verbatim): "recuerda que tengo una esp32.. podriamos solucionar algo de los dominios asi?"
- L2 (user): "1 y después 2 (DNS) en otra etapa"; hardware "ESP32 común (DevKit) con Arduino IDE".
- L3 (verify mwsldkzf, 1.6.0 integration): no blockers; contract firmware↔app matches; pages ES5. Fixed suggestion 1 (hub name cut at whole code points, test added).
