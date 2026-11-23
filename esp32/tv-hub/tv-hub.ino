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
// TV entry page (S3). ES5 only, no external URLs. Phone names are inserted
// with textContent only.
static const char INDEX_HTML[] PROGMEM = R"HTML(<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MayLo &middot; Buscando un tel&eacute;fono en casa&hellip;</title>
<style>
html,body{margin:0;height:100%;background:#000;color:#fff;font-family:sans-serif}
body{display:flex;align-items:center;justify-content:center;text-align:center}
#box{max-width:80%}
h1{font-size:44px;font-weight:600;margin:0 0 24px}
p{font-size:30px;line-height:1.4;margin:0;color:#ccc}
</style>
</head>
<body>
<div id="box">
<h1>MayLo &middot; Buscando un tel&eacute;fono en casa&hellip;</h1>
<p id="status"></p>
</div>
<script>
(function () {
  var PROBE_TIMEOUT_MS = 2000;
  var RETRY_MS = 5000;
  var NONE_TEXT = 'Abrí la app MayLo en un teléfono (Ver en la tele → Usar el navegador de la tele)';
  var statusEl = document.getElementById('status');
  var redirected = false;

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function retryLater() {
    setStatus(NONE_TEXT);
    setTimeout(search, RETRY_MS);
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

  function tryPhones(phones, index) {
    if (redirected) return;
    if (index >= phones.length) {
      retryLater();
      return;
    }
    var phone = phones[index];
    var name = typeof phone.name === 'string' && phone.name ? phone.name : 'un teléfono';
    setStatus('Probando ' + name + '…');
    probe(phone.url, function (ok) {
      if (ok) {
        redirected = true;
        location.replace(phone.url + '?hub=' + encodeURIComponent(location.origin));
      } else {
        tryPhones(phones, index + 1);
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
        if (phones[i] && typeof phones[i].url === 'string' && /^http:\/\/[0-9.]+:[0-9]+\/tv\/[A-Za-z0-9]{6}$/.test(phones[i].url)) {
          valid.push(phones[i]);
        }
      }
      handled = true;
      tryPhones(valid, 0);
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

  setStatus('');
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
