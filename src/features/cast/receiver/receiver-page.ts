/**
 * The receiver page the TV's own browser (VIDAA) opens at
 * `http://<phone>:<port>/tv/<key>`: one self-contained HTML string, inline CSS
 * and ES5 JavaScript (old TV engine: no arrow functions, `let`, template
 * literals or fetch). It long-polls every known phone (this one and the other
 * member's, from cast_receivers) for commands, runs them in arrival order,
 * plays the video (hls.js from the serving phone for HLS, else native) and
 * posts its state every second to every phone that answers. The other phone is
 * reached cross-origin (its server answers CORS). No imports, so it is tested in Node.
 */

/**
 * Pure part of the page script, shared with the tests: defines `MayloCore`
 * with applyCommand, pendingCommands, snapshot, nextDelay and isHls.
 */
export const RECEIVER_CORE = String.raw`var MayloCore = (function () {
  function num(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
  }

  function isHls(url) {
    var path = String(url).split(/[?#]/)[0].toLowerCase();
    return path.slice(-5) === '.m3u8';
  }

  /* Runs one command on the player; false (and nothing done) when it is invalid. */
  function applyCommand(player, command) {
    if (!command || typeof command !== 'object') return false;
    switch (command.type) {
      case 'load':
        if (typeof command.url !== 'string' || !/^https?:\/\//i.test(command.url)) return false;
        player.load(command.url, typeof command.title === 'string' ? command.title : '');
        return true;
      case 'play':
        player.play();
        return true;
      case 'pause':
        player.pause();
        return true;
      case 'stop':
        player.stop();
        return true;
      case 'seek':
        if (num(command.seconds) === null || command.seconds < 0) return false;
        player.seek(command.seconds);
        return true;
      case 'volume':
        if (num(command.level) === null) return false;
        player.setVolume(Math.min(100, Math.max(0, command.level)) / 100);
        return true;
      case 'mute':
        if (typeof command.muted !== 'boolean') return false;
        player.setMuted(command.muted);
        return true;
      default:
        return false;
    }
  }

  /* Commands newer than lastId, in id order, so each runs once and in order. */
  function pendingCommands(commands, lastId) {
    var list = [];
    if (!commands || typeof commands.length !== 'number') return list;
    for (var i = 0; i < commands.length; i++) {
      var command = commands[i];
      if (command && typeof command.id === 'number' && command.id > lastId) list.push(command);
    }
    list.sort(function (a, b) {
      return a.id - b.id;
    });
    return list;
  }

  /* The state posted to the phone; info.mode is idle, loading, video or error. */
  function snapshot(video, info) {
    var status;
    if (info.mode === 'idle' || !video) status = info.mode === 'error' ? 'error' : 'idle';
    else if (info.mode === 'error') status = 'error';
    else if (video.ended) status = 'ended';
    else if (info.mode === 'loading') status = 'loading';
    else status = video.paused ? 'paused' : 'playing';
    var position = video && status !== 'idle' ? num(video.currentTime) : null;
    var duration = video && status !== 'idle' ? num(video.duration) : null;
    var volume = video && status !== 'idle' ? num(video.volume) : null;
    return {
      status: status,
      position: position === null ? null : Math.round(position * 10) / 10,
      duration: duration !== null && duration > 0 ? duration : null,
      volume: volume === null ? null : Math.round(volume * 100),
      muted: !!(video && status !== 'idle' && video.muted),
      error: info.error ? String(info.error).slice(0, 300) : null,
      title: String(info.title || '').slice(0, 200)
    };
  }

  /* Wait before the next poll after failures: 1, 2, 4, 8, then 10 s. */
  function nextDelay(failures) {
    if (failures <= 0) return 0;
    return Math.min(10000, 1000 * Math.pow(2, failures - 1));
  }

  /*
   * First answer after the page opened: the phone keeps the last commands, so an
   * answer that came at once is history from before this page (skipped, so a
   * reload does not replay old videos); one that waited is new.
   */
  function firstBatch(commands, elapsedMs) {
    return elapsedMs < 1000 ? [] : commands;
  }

  /* A receiver route; base is '' for the phone that served the page, else its origin. */
  function receiverPath(receiver, rest) {
    return receiver.base + '/tv/' + receiver.key + rest;
  }

  /* State goes only to phones whose last poll answered, so an absent phone gets nothing. */
  function reachable(receiver) {
    return receiver.failures === 0;
  }

  function statusText(label, connected) {
    return label + (connected ? ': conectado' : ': buscando…');
  }

  /* The ESP32 hub origin from ?hub= (the hub adds it when it forwards the TV here); http origins only. */
  function hubFromSearch(search) {
    if (typeof search !== 'string') return null;
    var pairs = search.replace(/^\?/, '').split('&');
    for (var i = 0; i < pairs.length; i++) {
      var eq = pairs[i].indexOf('=');
      if (eq < 0 || pairs[i].slice(0, eq) !== 'hub') continue;
      var value;
      try {
        value = decodeURIComponent(pairs[i].slice(eq + 1));
      } catch (error) {
        return null;
      }
      var match = /^http:\/\/([A-Za-z0-9.-]+)(:(\d{1,5}))?$/i.exec(value);
      if (!match) return null;
      if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)) return null;
      return value.toLowerCase();
    }
    return null;
  }

  /* Back to the hub once this page's own phone has not answered for 15 s, so the hub forwards the TV to another phone. */
  var HUB_FALLBACK_MS = 15000;
  function hubFallbackDue(hub, lastAnswerAt, now) {
    return !!hub && now - lastAnswerAt >= HUB_FALLBACK_MS;
  }

  function hubEntry(hub) {
    return hub + '/';
  }

  return {
    applyCommand: applyCommand,
    pendingCommands: pendingCommands,
    firstBatch: firstBatch,
    snapshot: snapshot,
    nextDelay: nextDelay,
    isHls: isHls,
    receiverPath: receiverPath,
    reachable: reachable,
    statusText: statusText,
    hubFromSearch: hubFromSearch,
    hubFallbackDue: hubFallbackDue,
    hubEntry: hubEntry
  };
})();`;

/**
 * Page runtime: DOM, one XHR long-poll per phone, state reports, video/hls.js.
 * `RECEIVERS` ({base, key, label}, the serving phone first) and `KEY` (its key) are defined before it.
 */
const RECEIVER_RUNTIME = String.raw`(function () {
  var core = MayloCore;
  var FAILED = 'No se pudo reproducir este video';
  var video = document.getElementById('video');
  var idle = document.getElementById('idle');
  var loading = document.getElementById('loading');
  var loadingTitle = document.getElementById('loading-title');
  var failed = document.getElementById('failed');
  var failedTitle = document.getElementById('failed-title');
  var mode = 'idle';
  var errorText = null;
  var title = '';
  var hls = null;
  var token = 0;
  var hlsWaiting = null;
  /* Opened through the ESP32 hub: when this phone is gone, the hub picks the other one. */
  var hub = core.hubFromSearch(location.search);
  var ownAnsweredAt = new Date().getTime();
  var leaving = false;
  /* Each phone has its own cursor, backoff and first-batch skip. */
  var phones = [];
  for (var r = 0; r < RECEIVERS.length; r++) {
    phones.push({
      base: RECEIVERS[r].base,
      key: RECEIVERS[r].key,
      label: RECEIVERS[r].label,
      net: document.getElementById('net-' + r),
      lastId: 0,
      failures: 0,
      primed: false,
      posting: false
    });
  }

  function show(element, visible) {
    element.style.display = visible ? 'block' : 'none';
  }

  function setText(element, text) {
    element.textContent = text;
  }

  function render() {
    show(video, mode === 'video' || mode === 'loading');
    show(idle, mode === 'idle');
    show(loading, mode === 'loading');
    show(failed, mode === 'error');
    setText(loadingTitle, title);
    setText(failedTitle, title);
  }

  function setConnected(phone, connected) {
    if (phone.net) setText(phone.net, core.statusText(phone.label, connected));
  }

  function xhr(method, url, body, timeout, done) {
    var request = new XMLHttpRequest();
    var finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true;
      done(ok, request);
    }
    request.open(method, url, true);
    request.timeout = timeout;
    request.onreadystatechange = function () {
      if (request.readyState === 4) finish(request.status >= 200 && request.status < 300);
    };
    request.ontimeout = function () {
      finish(false);
    };
    request.onerror = function () {
      finish(false);
    };
    // text/plain keeps the POST a simple request: the other phone gets it without a preflight.
    if (body !== null) request.setRequestHeader('Content-Type', 'text/plain');
    request.send(body);
  }

  /* Any answer from the phone that served this page keeps the page here. */
  function answered(phone) {
    if (phone === phones[0]) ownAnsweredAt = new Date().getTime();
  }

  function postState(phone, body) {
    if (phone.posting || !core.reachable(phone)) return;
    phone.posting = true;
    xhr('POST', core.receiverPath(phone, '/state'), body, 5000, function (ok) {
      phone.posting = false;
      if (ok) answered(phone);
    });
  }

  /*
   * While the own long-poll waits or backs off, a short HEAD of the page keeps
   * telling whether the phone is there; after ~15 s without any answer the TV
   * goes back to the hub.
   */
  var hubProbing = false;
  function watchHub() {
    if (!hub || leaving) return;
    var now = new Date().getTime();
    if (core.hubFallbackDue(hub, ownAnsweredAt, now)) {
      leaving = true;
      location.replace(core.hubEntry(hub));
      return;
    }
    /* State posts answer every second while all is well; probe only when they stopped. */
    if (hubProbing || now - ownAnsweredAt < 3000) return;
    hubProbing = true;
    xhr('HEAD', '/tv/' + KEY, null, 4000, function (ok) {
      hubProbing = false;
      if (ok) answered(phones[0]);
    });
  }

  /* The same state to every phone that answers, so each app sees the TV connected. */
  function report() {
    var state = core.snapshot(mode === 'idle' ? null : video, { mode: mode, error: errorText, title: title });
    var body = JSON.stringify(state);
    for (var i = 0; i < phones.length; i++) postState(phones[i], body);
  }

  function fail() {
    if (mode !== 'loading' && mode !== 'video') return;
    mode = 'error';
    errorText = FAILED;
    render();
    report();
  }

  function playNow() {
    var started;
    try {
      started = video.play();
    } catch (error) {
      started = null;
    }
    if (started && typeof started.then === 'function') {
      started.then(null, function () {
        /* Autoplay with sound refused: try muted; the phone shows it as silenced. */
        if (video.muted) return;
        video.muted = true;
        try {
          video.play();
        } catch (error) {}
      });
    }
  }

  function cleanup() {
    token++;
    if (hls) {
      try {
        hls.destroy();
      } catch (error) {}
      hls = null;
    }
  }

  function withHls(callback) {
    if (window.Hls) {
      callback(window.Hls);
      return;
    }
    if (hlsWaiting) {
      hlsWaiting.push(callback);
      return;
    }
    hlsWaiting = [callback];
    var script = document.createElement('script');
    function done() {
      var waiting = hlsWaiting;
      hlsWaiting = null;
      for (var i = 0; i < waiting.length; i++) waiting[i](window.Hls || null);
    }
    script.onload = done;
    script.onerror = done;
    script.src = '/tv/' + KEY + '/hls.js';
    document.getElementsByTagName('head')[0].appendChild(script);
  }

  var player = {
    load: function (url, nextTitle) {
      cleanup();
      var mine = token;
      title = nextTitle;
      errorText = null;
      mode = 'loading';
      render();
      if (!core.isHls(url)) {
        video.src = url;
        playNow();
        return;
      }
      withHls(function (Hls) {
        if (mine !== token) return;
        if (Hls && Hls.isSupported && Hls.isSupported()) {
          hls = new Hls();
          hls.on(Hls.Events.ERROR, function (event, data) {
            if (mine === token && data && data.fatal) fail();
          });
          hls.on(Hls.Events.MANIFEST_PARSED, function () {
            if (mine === token) playNow();
          });
          hls.loadSource(url);
          hls.attachMedia(video);
        } else {
          /* No MediaSource: the TV may still play HLS natively. */
          video.src = url;
          playNow();
        }
      });
    },
    play: function () {
      if (mode === 'video' || mode === 'loading') playNow();
    },
    pause: function () {
      video.pause();
    },
    stop: function () {
      mode = 'idle';
      title = '';
      errorText = null;
      cleanup();
      video.pause();
      video.removeAttribute('src');
      try {
        video.load();
      } catch (error) {}
      render();
    },
    seek: function (seconds) {
      var duration = video.duration;
      video.currentTime = isFinite(duration) && duration > 0 ? Math.min(seconds, duration) : seconds;
    },
    setVolume: function (level) {
      video.volume = level;
    },
    setMuted: function (muted) {
      video.muted = muted;
    }
  };

  video.addEventListener('loadedmetadata', function () {
    if (mode === 'loading') {
      mode = 'video';
      render();
    }
  });
  video.addEventListener('playing', function () {
    if (mode === 'loading') {
      mode = 'video';
      render();
    }
  });
  video.addEventListener('error', function () {
    if (video.error) fail();
  });

  /* One long-poll loop per phone; commands run as each answer arrives. */
  function poll(phone) {
    var sentAt = new Date().getTime();
    function again(delay) {
      setTimeout(function () {
        poll(phone);
      }, delay);
    }
    xhr('GET', core.receiverPath(phone, '/commands?after=' + phone.lastId), null, 35000, function (ok, request) {
      if (!ok) {
        phone.failures++;
        setConnected(phone, false);
        again(core.nextDelay(phone.failures));
        return;
      }
      phone.failures = 0;
      answered(phone);
      setConnected(phone, true);
      var data = null;
      try {
        data = JSON.parse(request.responseText);
      } catch (error) {}
      var list = core.pendingCommands(data && data.commands, phone.lastId);
      if (!phone.primed) {
        phone.primed = true;
        if (list.length) phone.lastId = list[list.length - 1].id;
        list = core.firstBatch(list, new Date().getTime() - sentAt);
      }
      for (var i = 0; i < list.length; i++) {
        phone.lastId = list[i].id;
        try {
          core.applyCommand(player, list[i]);
        } catch (error) {
          fail();
        }
      }
      if (list.length) report();
      // An empty answer that came back at once means the phone had no free long-poll slot
      // (an old connection still holds it): wait a little instead of polling 5 times a second.
      var quickEmpty = !list.length && new Date().getTime() - sentAt < 1000;
      again(list.length ? 0 : quickEmpty ? 2000 : 200);
    });
  }

  render();
  for (var p = 0; p < phones.length; p++) {
    setConnected(phones[p], false);
    poll(phones[p]);
  }
  report();
  setInterval(report, 1000);
  if (hub) setInterval(watchHub, 1000);
})();`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Same rule as cast_receivers.url: origin and key of another phone's receiver. */
const PEER_URL = /^(http:\/\/[0-9.]+:[0-9]+)\/tv\/([A-Za-z0-9]{6})$/i;

/** JSON safe inside an inline <script>: no tag, entity or line-separator characters. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const cleanLabel = (label: string, fallback: string) => label.trim().slice(0, 60) || fallback;

/**
 * The whole receiver page for `key` (6 letters/digits). `phoneName` labels the
 * serving phone; `peers` are the other phones (cast_receivers URLs) it also
 * polls; invalid ones and any with this key are skipped.
 */
export function buildReceiverPage({
  key,
  phoneName,
  peers = [],
}: {
  key: string;
  phoneName: string;
  peers?: readonly { url: string; label: string }[];
}): string {
  if (!/^[A-Za-z0-9]{6}$/.test(key)) throw new Error('receiver key must be 6 letters or digits');
  const receivers = [{ base: '', key, label: cleanLabel(phoneName, 'Este teléfono') }];
  for (const peer of peers) {
    const match = PEER_URL.exec(peer.url);
    if (!match || receivers.some((receiver) => receiver.key === match[2])) continue;
    receivers.push({ base: match[1], key: match[2], label: cleanLabel(peer.label, 'MayLo') });
  }
  const lines = receivers
    .map((receiver, index) => `<div id="net-${index}">${escapeHtml(receiver.label)}: buscando…</div>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MayLo en la tele</title>
<style>
html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; color: #F7F1EC; font-family: sans-serif; }
video { position: fixed; left: 0; top: 0; width: 100%; height: 100%; background: #000; display: none; }
.screen { position: fixed; left: 0; top: 0; width: 100%; height: 100%; display: none; text-align: center; }
.box { position: absolute; left: 5%; right: 5%; top: 50%; margin-top: -120px; }
.big { font-size: 56px; font-weight: bold; line-height: 1.2; }
.mid { font-size: 32px; margin-top: 24px; color: #B9ACA2; }
.small { font-size: 24px; margin-top: 40px; color: #B9ACA2; }
.danger { color: #FF6B6B; }
</style>
</head>
<body>
<video id="video" playsinline></video>
<div id="idle" class="screen"><div class="box">
<div class="big">Listo para recibir videos de MayLo</div>
<div class="mid">Desde MayLo en el teléfono: tocá “Ver en la tele” y elegí “Navegador de la tele”.</div>
<div class="small">
${lines}
</div>
</div></div>
<div id="loading" class="screen"><div class="box">
<div class="big">Cargando el video…</div>
<div id="loading-title" class="mid"></div>
</div></div>
<div id="failed" class="screen"><div class="box">
<div class="big danger">No se pudo reproducir este video</div>
<div id="failed-title" class="mid"></div>
<div class="small">Probá con otro video desde el teléfono.</div>
</div></div>
<script>
var RECEIVERS = ${scriptJson(receivers)};
var KEY = ${JSON.stringify(key)};
${RECEIVER_CORE}
${RECEIVER_RUNTIME}
</script>
</body>
</html>
`;
}
