# TV cast: discovery fix and ad blocking

Follow-up to odd/tasks/tv-cast-browser.md after the first device test of v1.4.0 (released APK).
The app does not find the Hisense 50A4NV that other apps see on the same Wi-Fi; the in-app browser needs Brave-like ad blocking.

## Specs

- **S1 Discovery finds the TV.** User report: "no encuentra el TV"; the registro says "ninguna TV respondió"; the phone is on the same Wi-Fi as the TV (no VPN, no mobile data selected); "Sí, otra app la ve" (Web Video Caster / BubbleUPnP). So the bug is in our discovery. Make it robust in one round: send SSDP M-SEARCH through the Wi-Fi network/interface explicitly (not the default route), with multicast TTL > 1; also listen passively for `NOTIFY ssdp:alive` on 239.255.255.250:1900 during the search window (best effort; port may be taken); tolerate real-world descriptions (tags with attributes or namespace prefixes, whitespace/case in serviceType, `URLBase`, numeric entities); keep the security rules (Location host = replying address, control URLs on the description host) but compare hosts normalized (case, IPv6 brackets, IPv4-mapped).
- **S2 Discovery diagnostics.** When no TV is found, the test panel log ("Prueba de conexión") shows what happened instead of only "ninguna TV respondió": number of SSDP replies/NOTIFYs, each distinct Location with its sender address, and why each was dropped (host mismatch, description fetch failed with status/error, no AVTransport:1 service). The sheet keeps a short plain-Spanish message.
- **S3 Manual IP fallback.** In the test panel and in the sheet ("¿No aparece tu tele? Ingresá su IP"), the user can type the TV's IP; the app sends a unicast M-SEARCH to `<ip>:1900` and uses the replies like a normal search (same parsing and host rules).
- **S4 Pop-ups and redirects blocked** (user chose "Bloquear ventanas emergentes y redirecciones"). In the in-app browser: `window.open` / `target=_blank` never open a window nor navigate the top page; a top-frame navigation to a different site that did not follow a user tap within ~1 s is blocked and a small banner shows "Se bloqueó una redirección a <host>" with "Abrir igual". Same-site navigation and user-tapped links keep working.
- **S5 Network ad blocking, Brave-like** (user chose "Bloqueo de red nativo (tipo Brave)"). Requests from every frame to known ad/tracker domains (bundled domain list from a permissively licensed source, subdomain match) get an empty response before leaving the phone; the top-level page itself is never blocked. The browser shows a shield with the count of blocked requests for the current page; tapping it turns blocking off/on for the session. Requires a native hook into the WebView's request interception; it must not break react-native-webview's own client behavior (navigation events, onMessage, errors).
- **S6 Release.** App version 1.4.1 (native changes; runtimeVersion follows appVersion). Docs: README cast entry mentions ad blocking and manual IP.

## Tasks

- [ ] T1 — S1, S2, S3 — worker A (discovery: modules/tv-cast native + dlna parsing + test panel/sheet UI) — commit:
- [ ] T2 — S4, S5 — worker B (new local module modules/web-guard + browser integration) — commit:
- [ ] T3 — S6 — inline: integrate, version, docs, verify, PR, release — commit:

## Log

- L1 (user, verbatim): "primero... no encuentra el TV... segundo podemos hacer como brabe para que no haya anuncios?"
- L2 (user answers): registro: "\"ninguna TV respondió\""; red: "Mismo Wi-Fi que la tele"; otra app: "Sí, otra app la ve"; anuncios: "Bloquear ventanas emergentes y redirecciones", "Bloqueo de red nativo (tipo Brave)".
- L4 (user, verbatim): "el duplicar pantalle me abre el  google cast y me figura la pantalla... pero el boton bucar no encuentra la tv" — screen mirroring (Miracast/Anyview Cast, Wi-Fi Direct) sees the TV; our DLNA search over the LAN does not. Consistent with S1: the bug is in our SSDP path, not the TV.
- L3 (decision): ad blocking lives in a separate local Expo module `modules/web-guard` so T1 and T2 edit disjoint files; the browser screen src/app/cast.tsx is owned by T2, the sheet and test panel by T1.
