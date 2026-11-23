// MayLo TV hub — ESP32 DevKit (Arduino IDE, arduino-esp32 core 3.x).
//
// A fixed address for the TV browser receiver. Phones at home register
// themselves with POST /register; the TV opens GET / (saved as a favorite),
// which looks up GET /phones and forwards the TV to the most recent phone
// that answers. Video never goes through the ESP32.
//
// Setup: see README.md (copy secrets.example.h to secrets.h first).

#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Falta secrets.h: copiá secrets.example.h como secrets.h y completá WIFI_SSID / WIFI_PASSWORD (ver README.md)."
#endif

#include "register_validation.h"

static const char *kHostname = "maylo-tv";
static const uint32_t kReconnectEveryMs = 15000UL;     // retry WiFi.begin while offline
static const uint32_t kRestartAfterOfflineMs = 600000UL;  // last resort: reboot after 10 min offline

WebServer server(80);
static tvhub::Registry registry;

// /register body, captured through the raw-body callback so the server never
// buffers more than HTTP_RAW_BUFLEN at a time and we keep at most 512 bytes.
static char bodyBuf[tvhub::kMaxBodyBytes + 1];
static size_t bodyLen = 0;
static bool bodyTooLarge = false;
static bool bodyComplete = false;

static bool wasConnected = false;
static bool mdnsStarted = false;
static uint32_t lastAttemptMs = 0;
static uint32_t offlineSinceMs = 0;

// ---------------------------------------------------------------------------
// TV entry page (S3 behaviour, S5 design: artboard 01 with the dark tokens).
// ES5 only, no external URLs, no CSS variables or flex gap (old TV browsers).
// Phone names are inserted with textContent / createTextNode only.
static const char INDEX_HTML[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MayLo &middot; Buscando un tel&eacute;fono en casa&hellip;</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden}
body{background:#15110F;background:radial-gradient(ellipse at 50% 30%,#2A1A12 0%,#15110F 60%);color:#F7F1EC;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;position:relative}
body>*{margin:14px 0}
svg{display:block}
.brand{display:flex;align-items:center;font-size:40px;font-weight:800;letter-spacing:-.5px}
.brand svg{color:#FF8A57;margin-right:16px}
h1{font-size:44px;font-weight:700;padding:0 40px}
.sub{font-size:26px;color:#B9ACA2;max-width:900px;line-height:1.4}
.spin{width:72px;height:72px;border-radius:50%;border:6px solid #2F2621;border-top-color:#FF8A57;animation:spin 1.1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none;border-right-color:#FF8A57}}
#phones{display:flex;justify-content:center;margin-top:22px}
.ph{width:180px;margin:0 18px}
.av{position:relative;width:132px;height:132px;margin:0 auto 12px;border-radius:50%;background:#2F2621;color:#B9ACA2;font-size:56px;font-weight:800;line-height:132px}
.on .av{background:#FF8A57;background:linear-gradient(160deg,#FFB25B,#FF8A57);color:#2B1206;box-shadow:0 0 0 6px #15110F,0 0 0 10px #6CC24A}
.off .av{opacity:.55}
.dot{display:none;position:absolute;right:6px;bottom:6px;width:28px;height:28px;border-radius:50%;border:5px solid #15110F;background:#5A4E46}
.on .dot,.off .dot{display:block}
.on .dot{background:#6CC24A}
.nm{font-size:28px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{display:block;margin-top:12px;font-size:20px;color:#B9ACA2}
.on .st{color:#8FD86F}
.steps{display:flex;align-items:center;font-size:26px;background:#221C18;border-radius:16px;padding:22px 30px}
.steps>*{margin:0 8px}
.steps b{color:#FF9E72}
.ar{color:#8C7F76}
.retry{font-size:20px;color:#B9ACA2}
.foot{position:absolute;bottom:28px;left:0;right:0;margin:0;font-size:18px;color:#8C7F76}
.idle-only,.idle .busy{display:none}
.idle .idle-only{display:block}
.idle .steps{display:flex}
</style>
</head>
<body>
<div class="brand"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M8 2l4 4 4-4"/></svg>MayLo</div>
<div class="spin busy" role="status" aria-label="Buscando"></div>
<h1 id="head" class="busy">Buscando un tel&eacute;fono en casa&hellip;</h1>
<div id="phones" class="busy"></div>
<h1 class="idle-only">Listo para ver algo en la tele</h1>
<p class="sub idle-only">Abr&iacute; MayLo en tu tel&eacute;fono y entr&aacute; a la pantalla de la tele:</p>
<div class="steps idle-only"><b aria-label="Tele"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M8 2l4 4 4-4"/></svg></b><span class="ar">&rarr;</span><span>Ver en la tele</span><span class="ar">&rarr;</span><span>Usar el navegador de la tele</span></div>
<p id="retry" class="retry idle-only"></p>
<p id="foot" class="foot"></p>
<script>
(function () {
  var PROBE_TIMEOUT_MS = 2000;
  var RETRY_MS = 5000;
  var body = document.body;
  var headEl = document.getElementById('head');
  var phonesEl = document.getElementById('phones');
  var retryEl = document.getElementById('retry');
  var redirected = false;
  var countdown = null;

  document.getElementById('foot').textContent = 'TV MayLo · hub ' + location.host;

  function setIdle(idle) {
    body.className = idle ? 'idle' : '';
  }

  // First code point of the name, upper-cased ("?" when empty).
  function initial(name) {
    if (!name) return '?';
    var code = name.charCodeAt(0);
    var c = code >= 0xD800 && code <= 0xDBFF && name.length > 1 ? name.substr(0, 2) : name.charAt(0);
    return c.toUpperCase();
  }

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  // One circular avatar per phone (initial, name, state); text via text nodes only.
  function renderPhones(phones) {
    var views = [];
    while (phonesEl.firstChild) phonesEl.removeChild(phonesEl.firstChild);
    for (var i = 0; i < phones.length; i++) {
      var name = phones[i].label;
      var item = el('div', 'ph');
      var av = el('div', 'av');
      av.setAttribute('aria-hidden', 'true');
      av.appendChild(document.createTextNode(initial(name)));
      av.appendChild(el('span', 'dot'));
      var nm = el('div', 'nm');
      nm.appendChild(document.createTextNode(name || '?'));
      var st = el('small', 'st');
      st.appendChild(document.createTextNode('Probando…'));
      item.appendChild(av);
      item.appendChild(nm);
      item.appendChild(st);
      phonesEl.appendChild(item);
      views.push({ item: item, st: st });
    }
    return views;
  }

  function setPhoneState(view, cls, text) {
    view.item.className = cls ? 'ph ' + cls : 'ph';
    view.st.textContent = text;
  }

  function tick(left) {
    if (left <= 0) {
      countdown = null;
      retryEl.textContent = 'Buscando teléfonos…';
      search();
      return;
    }
    retryEl.textContent = 'Buscando teléfonos otra vez en ' + left + ' s…';
    countdown = setTimeout(function () { tick(left - 1); }, 1000);
  }

  function retryLater() {
    setIdle(true);
    if (countdown) clearTimeout(countdown);
    tick(RETRY_MS / 1000);
  }

  function probe(url, done) {
    var finished = false;
    var xhr = new XMLHttpRequest();
    var timer = setTimeout(function () {
      finish(false);
    }, PROBE_TIMEOUT_MS);
    function finish(ok) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { xhr.abort(); } catch (e) {}
      done(ok);
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState >= 2) {
        if (xhr.status >= 200 && xhr.status < 300) finish(true);
        else if (xhr.readyState === 4) finish(false);
      }
    };
    xhr.onerror = function () { finish(false); };
    try {
      xhr.open('HEAD', url + '/hls.js', true);
      xhr.timeout = PROBE_TIMEOUT_MS;
      xhr.ontimeout = function () { finish(false); };
      xhr.send();
    } catch (e) {
      finish(false);
    }
  }

  function tryPhones(phones, views, index) {
    if (redirected) return;
    if (index >= phones.length) {
      retryLater();
      return;
    }
    var phone = phones[index];
    setPhoneState(views[index], '', 'Probando…');
    probe(phone.url, function (ok) {
      if (ok) {
        redirected = true;
        setPhoneState(views[index], 'on', 'En casa');
        headEl.textContent = phone.label ? 'Conectando con el teléfono de ' + phone.label + '…' : 'Conectando con un teléfono…';
        setIdle(false);
        location.replace(phone.url + '?hub=' + encodeURIComponent(location.origin));
      } else {
        setPhoneState(views[index], 'off', 'No responde');
        tryPhones(phones, views, index + 1);
      }
    });
  }

  function search() {
    var xhr = new XMLHttpRequest();
    var handled = false;
    function fail() {
      if (handled) return;
      handled = true;
      retryLater();
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || handled) return;
      if (xhr.status !== 200) {
        fail();
        return;
      }
      var phones = [];
      try {
        var data = JSON.parse(xhr.responseText);
        if (data && data.phones && data.phones.length) phones = data.phones;
      } catch (e) {
        fail();
        return;
      }
      var valid = [];
      for (var i = 0; i < phones.length; i++) {
        var p = phones[i];
        if (p && typeof p.url === 'string' && /^http:\/\/[0-9.]+:[0-9]+\/tv\/[A-Za-z0-9]{6}$/.test(p.url)) {
          valid.push({ url: p.url, label: typeof p.name === 'string' ? p.name.replace(/^\s+|\s+$/g, '') : '' });
        }
      }
      handled = true;
      if (!valid.length) {
        retryLater();
        return;
      }
      // The first search shows the avatars while probing; retries stay on the
      // idle screen until a phone answers, so it does not flicker every 5 s.
      tryPhones(valid, renderPhones(valid), 0);
    };
    xhr.onerror = fail;
    try {
      xhr.open('GET', '/phones?t=' + new Date().getTime(), true);
      xhr.timeout = 5000;
      xhr.ontimeout = fail;
      xhr.send();
    } catch (e) {
      fail();
    }
  }

  setIdle(false);
  search();
})();
</script>
</body>
</html>
)HTML";

// ---------------------------------------------------------------------------
// HTTP handlers.

static void sendCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

static void resetBody() {
  bodyLen = 0;
  bodyBuf[0] = '\0';
  bodyTooLarge = false;
  bodyComplete = false;
}

static void handleOptions() {
  sendCors();
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
  server.sendHeader("Access-Control-Max-Age", "600");
  server.send(204);
}

static void handleIndex() {
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", INDEX_HTML);
}

static void handlePhones() {
  static char json[tvhub::kPhonesJsonCap];
  size_t n = tvhub::buildPhonesJson(&registry, millis(), json, sizeof(json));
  sendCors();
  server.sendHeader("Cache-Control", "no-store");
  if (n == 0) {
    server.send(500, "application/json", "{\"phones\":[]}");
    return;
  }
  server.send(200, "application/json", json);
}

// Raw-body callback for POST /register (called with RAW_START, RAW_WRITE...,
// RAW_END or RAW_ABORTED). Multipart bodies take the upload path instead, where
// server.raw() must not be used, so they are ignored here and rejected later.
static void handleRegisterBody() {
  String contentType = server.header("Content-Type");
  if (contentType.startsWith("multipart/")) return;
  HTTPRaw &raw = server.raw();
  switch (raw.status) {
    case RAW_START:
      resetBody();
      break;
    case RAW_WRITE:
      if (bodyTooLarge) break;
      if (bodyLen + raw.currentSize > tvhub::kMaxBodyBytes) {
        bodyTooLarge = true;
        break;
      }
      memcpy(bodyBuf + bodyLen, raw.buf, raw.currentSize);
      bodyLen += raw.currentSize;
      bodyBuf[bodyLen] = '\0';
      break;
    case RAW_END:
      bodyComplete = true;
      break;
    case RAW_ABORTED:
    default:
      resetBody();
      break;
  }
}

static void handleRegister() {
  bool ok = false;
  if (bodyComplete && !bodyTooLarge && server.clientContentLength() <= (int)tvhub::kMaxBodyBytes) {
    tvhub::RegisterRequest req;
    if (tvhub::parseRegisterBody(bodyBuf, bodyLen, &req)) {
      IPAddress remote = server.client().remoteIP();
      if (remote.type() == IPv4) {
        uint8_t remoteIp[4] = {remote[0], remote[1], remote[2], remote[3]};
        if (tvhub::sameIp(req.ip, remoteIp)) {
          tvhub::registryUpsert(&registry, req, millis());
          ok = true;
          Serial.printf("Registrado: %s (%s)\n", req.url, req.name);
        }
      }
    }
  }
  resetBody();
  sendCors();
  if (ok) {
    server.send(204);
  } else {
    server.send(400, "text/plain", "bad request");
  }
}

static void handleNotFound() {
  server.send(404, "text/plain", "not found");
}

// ---------------------------------------------------------------------------
// Wi-Fi.

static void startWifi() {
  WiFi.persistent(false);
  WiFi.setHostname(kHostname);  // must be set before WiFi.mode()/begin()
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastAttemptMs = millis();
  offlineSinceMs = lastAttemptMs;
}

static void startMdns() {
  if (mdnsStarted) {
    MDNS.end();
    mdnsStarted = false;
  }
  if (MDNS.begin(kHostname)) {
    MDNS.addService("http", "tcp", 80);
    mdnsStarted = true;
    Serial.printf("mDNS: http://%s.local/\n", kHostname);
  } else {
    Serial.println("mDNS no disponible (se sigue usando la IP).");
  }
}

static void maintainWifi() {
  uint32_t now = millis();
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected) {
    if (!wasConnected) {
      wasConnected = true;
      Serial.print("Conectado. Abrí en la tele: http://");
      Serial.print(WiFi.localIP());
      Serial.println("/");
      startMdns();
    }
    return;
  }
  if (wasConnected) {
    wasConnected = false;
    offlineSinceMs = now;
    lastAttemptMs = now;
    Serial.println("Wi-Fi desconectado, reintentando...");
  }
  if (tvhub::elapsedMs(now, offlineSinceMs) > kRestartAfterOfflineMs) {
    Serial.println("Sin Wi-Fi hace 10 minutos: reiniciando.");
    delay(100);
    ESP.restart();
  }
  if (tvhub::elapsedMs(now, lastAttemptMs) > kReconnectEveryMs) {
    lastAttemptMs = now;
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println("MayLo TV hub");
  tvhub::registryInit(&registry);
  resetBody();

  startWifi();

  const char *headerKeys[] = {"Content-Type"};
  server.collectHeaders(headerKeys, 1);
  server.on("/", HTTP_GET, handleIndex);
  server.on("/phones", HTTP_GET, handlePhones);
  server.on("/phones", HTTP_OPTIONS, handleOptions);
  server.on("/register", HTTP_POST, handleRegister, handleRegisterBody);
  server.on("/register", HTTP_OPTIONS, handleOptions);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.println("Servidor HTTP en el puerto 80. Esperando Wi-Fi...");
}

void loop() {
  maintainWifi();
  server.handleClient();
  tvhub::registryExpire(&registry, millis());
  delay(2);
}
