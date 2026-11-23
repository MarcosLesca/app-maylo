/**
 * The receiver page the TV's own browser (VIDAA) opens at
 * `http://<phone>:<port>/tv/<key>`: one self-contained HTML string, inline CSS
 * and ES5 JavaScript (old TV engine: no arrow functions, `let`, template
 * literals or fetch). It long-polls the phone for commands, plays the video
 * (hls.js from the phone for HLS, else native) and posts its state every second.
 * No imports, so it is tested in Node.
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

  return {
    applyCommand: applyCommand,
    pendingCommands: pendingCommands,
    firstBatch: firstBatch,
    snapshot: snapshot,
    nextDelay: nextDelay,
    isHls: isHls
  };
})();`;

/** Page runtime: DOM, XHR long-poll, state reports, video/hls.js. `KEY` is defined before it. */
const RECEIVER_RUNTIME = String.raw`(function () {
  var core = MayloCore;
  var FAILED = 'No se pudo reproducir este video';
  var video = document.getElementById('video');
  var idle = document.getElementById('idle');
  var loading = document.getElementById('loading');
  var loadingTitle = document.getElementById('loading-title');
  var failed = document.getElementById('failed');
  var failedTitle = document.getElementById('failed-title');
  var net = document.getElementById('net');
  var lastId = 0;
  var failures = 0;
  var mode = 'idle';
  var errorText = null;
  var title = '';
  var hls = null;
  var token = 0;
  var hlsWaiting = null;
  var posting = false;
  var primed = false;

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

  function setConnected(connected) {
    setText(net, connected ? 'Conectado con el teléfono' : 'Buscando el teléfono…');
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
    if (body !== null) request.setRequestHeader('Content-Type', 'application/json');
    request.send(body);
  }

  function report() {
    if (posting) return;
    posting = true;
    var state = core.snapshot(mode === 'idle' ? null : video, { mode: mode, error: errorText, title: title });
    xhr('POST', '/tv/' + KEY + '/state', JSON.stringify(state), 5000, function () {
      posting = false;
    });
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

  function poll() {
    var sentAt = new Date().getTime();
    xhr('GET', '/tv/' + KEY + '/commands?after=' + lastId, null, 35000, function (ok, request) {
      if (!ok) {
        failures++;
        setConnected(false);
        setTimeout(poll, core.nextDelay(failures));
        return;
      }
      failures = 0;
      setConnected(true);
      var data = null;
      try {
        data = JSON.parse(request.responseText);
      } catch (error) {}
      var list = core.pendingCommands(data && data.commands, lastId);
      if (!primed) {
        primed = true;
        if (list.length) lastId = list[list.length - 1].id;
        list = core.firstBatch(list, new Date().getTime() - sentAt);
      }
      for (var i = 0; i < list.length; i++) {
        lastId = list[i].id;
        try {
          core.applyCommand(player, list[i]);
        } catch (error) {
          fail();
        }
      }
      if (list.length) report();
      setTimeout(poll, list.length ? 0 : 200);
    });
  }

  render();
  setConnected(false);
  poll();
  report();
  setInterval(report, 1000);
})();`;

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The whole receiver page for `key` (6 letters/digits); `phoneName` is shown on the idle screen. */
export function buildReceiverPage({ key, phoneName }: { key: string; phoneName: string }): string {
  if (!/^[A-Za-z0-9]{6}$/.test(key)) throw new Error('receiver key must be 6 letters or digits');
  const phone = phoneName.trim() ? escapeHtml(phoneName.trim().slice(0, 60)) : 'tu teléfono';
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
<div class="mid">Desde ${phone}: tocá “Ver en la tele” y elegí “Navegador de la tele”.</div>
<div id="net" class="small">Buscando el teléfono…</div>
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
var KEY = ${JSON.stringify(key)};
${RECEIVER_CORE}
${RECEIVER_RUNTIME}
</script>
</body>
</html>
`;
}
