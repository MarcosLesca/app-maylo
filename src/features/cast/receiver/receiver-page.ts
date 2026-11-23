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

  /*
   * The state posted to the phone; info.mode is idle, loading, video or error;
   * info.from names the phone that loaded the video ('' when unknown).
   */
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
      title: String(info.title || '').slice(0, 200),
      from: typeof info.from === 'string' ? info.from.slice(0, 60) : ''
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

  /* Avatar name: the member's name from a "MayLo de <name>" label, else the label itself. */
  function personName(label) {
    var text = String(label || '').replace(/^\s+|\s+$/g, '');
    var match = /^MayLo de\s+(.+)$/i.exec(text);
    return match ? match[1] : text;
  }

  /* First code point, upper-cased; "?" when empty. */
  function initial(name) {
    if (!name) return '?';
    var code = name.charCodeAt(0);
    return (code >= 0xd800 && code <= 0xdbff && name.length > 1 ? name.substr(0, 2) : name.charAt(0)).toUpperCase();
  }

  /* Avatar state: null until the phone first answers or fails. */
  function presence(connected) {
    if (connected === null) return { className: '', text: 'Buscando…' };
    return connected ? { className: 'on', text: 'En línea' } : { className: 'off', text: 'Sin conexión' };
  }

  function senderText(name) {
    return name ? 'Lo mandó ' + name + ' · cargando el video…' : 'Cargando el video…';
  }

  function badgeText(name) {
    return name ? 'MayLo · ' + name : 'MayLo';
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /* m:ss under an hour, h:mm:ss above; --:-- when unknown (live, NaN). */
  function formatTime(seconds) {
    if (num(seconds) === null || seconds < 0) return '--:--';
    var s = Math.floor(seconds);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
  }

  /* Played percent, 0 when the duration is unknown. */
  function progress(current, duration) {
    if (num(current) === null || num(duration) === null || duration <= 0) return 0;
    return Math.min(100, Math.max(0, (current / duration) * 100));
  }

  /* The OSD shows 4 s after the last command and stays while paused. */
  var OSD_MS = 4000;
  function osdVisible(paused, shownAt, now) {
    return !!paused || (typeof shownAt === 'number' && now - shownAt < OSD_MS);
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
    hubEntry: hubEntry,
    personName: personName,
    initial: initial,
    presence: presence,
    senderText: senderText,
    badgeText: badgeText,
    formatTime: formatTime,
    progress: progress,
    osdVisible: osdVisible
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
  var loadingFrom = document.getElementById('loading-from');
  var failed = document.getElementById('failed');
  var foot = document.getElementById('foot');
  var osd = document.getElementById('osd');
  var osdFrom = document.getElementById('osd-from');
  var osdPause = document.getElementById('osd-pause');
  var osdTitle = document.getElementById('osd-title');
  var osdState = document.getElementById('osd-state');
  var osdFill = document.getElementById('osd-fill');
  var osdNow = document.getElementById('osd-now');
  var osdTotal = document.getElementById('osd-total');
  var phonesEl = document.getElementById('phones');
  var mode = 'idle';
  var errorText = null;
  var title = '';
  /* Name of the phone whose command is running, and of the one that sent the video. */
  var commandFrom = '';
  var sender = '';
  var osdAt = null;
  var hls = null;
  var token = 0;
  var hlsWaiting = null;
  /* Opened through the ESP32 hub: when this phone is gone, the hub picks the other one. */
  var hub = core.hubFromSearch(location.search);
  var ownAnsweredAt = new Date().getTime();
  var leaving = false;
  /* Each phone has its own cursor, backoff and first-batch skip. */
  var phones = [];
  function el(tag, className) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    return element;
  }

  for (var r = 0; r < RECEIVERS.length; r++) {
    /* One avatar per phone; names only through text nodes. */
    var name = core.personName(RECEIVERS[r].label);
    var item = el('div', 'ph');
    var avatar = el('div', 'av');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.appendChild(document.createTextNode(core.initial(name)));
    avatar.appendChild(el('span', 'dot'));
    var nameEl = el('div', 'nm');
    nameEl.appendChild(document.createTextNode(name || '?'));
    var state = el('div', 'st');
    item.appendChild(avatar);
    item.appendChild(nameEl);
    item.appendChild(state);
    phonesEl.appendChild(item);
    phones.push({
      base: RECEIVERS[r].base,
      key: RECEIVERS[r].key,
      label: RECEIVERS[r].label,
      name: name,
      item: item,
      state: state,
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
    show(foot, mode !== 'video');
    setText(loadingTitle, title);
    setText(loadingFrom, core.senderText(sender));
    setText(foot, mode === 'loading' ? 'TV MayLo' : 'TV MayLo · recibiendo desde ' + location.hostname);
    renderOsd();
  }

  /* Playback OSD over the video: shown after a command, hidden 4 s later unless paused. */
  function renderOsd() {
    var visible = mode === 'video' && core.osdVisible(video.paused, osdAt, new Date().getTime());
    show(osd, visible);
    if (!visible) return;
    setText(osdFrom, core.badgeText(sender));
    show(osdPause, video.paused);
    setText(osdTitle, title);
    setText(osdState, video.paused ? 'En pausa' : 'Reproduciendo');
    osdFill.style.width = core.progress(video.currentTime, video.duration) + '%';
    setText(osdNow, core.formatTime(video.currentTime));
    setText(osdTotal, core.formatTime(video.duration));
  }

  function setConnected(phone, connected) {
    var view = core.presence(connected);
    phone.item.className = view.className ? 'ph ' + view.className : 'ph';
    phone.item.setAttribute('aria-label', core.statusText(phone.label, !!connected));
    setText(phone.state, view.text);
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
    var state = core.snapshot(mode === 'idle' ? null : video, { mode: mode, error: errorText, title: title, from: sender });
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
      sender = commandFrom;
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
      sender = '';
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
        commandFrom = phone.name;
        try {
          /* A load shows the loading screen instead; the video then starts without overlay. */
          if (core.applyCommand(player, list[i]) && list[i].type !== 'load') osdAt = new Date().getTime();
        } catch (error) {
          fail();
        }
      }
      if (list.length) {
        renderOsd();
        report();
      }
      // An empty answer that came back at once means the phone had no free long-poll slot
      // (an old connection still holds it): wait a little instead of polling 5 times a second.
      var quickEmpty = !list.length && new Date().getTime() - sentAt < 1000;
      again(list.length ? 0 : quickEmpty ? 2000 : 200);
    });
  }

  render();
  for (var p = 0; p < phones.length; p++) {
    setConnected(phones[p], null);
    poll(phones[p]);
  }
  report();
  setInterval(report, 1000);
  setInterval(renderOsd, 500);
  if (hub) setInterval(watchHub, 1000);
})();`;

/** The MayLo TV line icon (24px grid, stroke 2), as on the hub page. */
const tvIcon = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M8 2l4 4 4-4"/></svg>`;

/** Dark tokens of design/system.md written out: old TV engines lack CSS variables, flex gap and grid. */
const PAGE_CSS = `*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000;color:#F7F1EC;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
svg{display:inline-block;vertical-align:middle}
video{position:fixed;left:0;top:0;width:100%;height:100%;background:#000;display:none}
.screen{position:fixed;left:0;top:0;width:100%;height:100%;display:none;text-align:center;background:#15110F;background:radial-gradient(ellipse at 50% 30%,#2A1A12 0%,#15110F 60%)}
.box{position:absolute;left:0;right:0;top:50%;padding:0 48px;-webkit-transform:translateY(-50%);transform:translateY(-50%)}
.box>*{margin:0 auto 28px}
.brand{font-size:40px;font-weight:800;letter-spacing:-.5px}
.brand svg{color:#FF8A57;margin:-6px 16px 0 0}
h1{font-size:44px;font-weight:700;line-height:1.2}
.sub{font-size:26px;color:#B9ACA2;max-width:900px;line-height:1.4}
.ph{display:inline-block;vertical-align:top;width:180px;margin:0 18px}
.av{position:relative;width:112px;height:112px;margin:0 auto 12px;border-radius:50%;background:#2F2621;color:#B9ACA2;font-size:48px;font-weight:800;line-height:112px}
.on .av{background:#FF8A57;background:linear-gradient(160deg,#FFB25B,#FF8A57);color:#2B1206;box-shadow:0 0 0 6px #15110F,0 0 0 10px #6CC24A}
.off .av{opacity:.55}
.dot{position:absolute;right:4px;bottom:4px;width:26px;height:26px;border-radius:50%;border:5px solid #15110F;background:#5A4E46}
.on .dot{background:#6CC24A}
.nm{font-size:26px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{margin-top:8px;font-size:19px;color:#B9ACA2}
.on .st{color:#8FD86F}
.spin{width:72px;height:72px;border-radius:50%;border:6px solid #2F2621;border-top-color:#FF8A57;-webkit-animation:spin 1.1s linear infinite;animation:spin 1.1s linear infinite}
@-webkit-keyframes spin{to{-webkit-transform:rotate(360deg)}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{-webkit-animation:none;animation:none;border-right-color:#FF8A57}}
.err{width:96px;height:96px;border-radius:50%;background:#3A1F1F;color:#FF6B6B;font-size:56px;font-weight:800;line-height:96px}
.hint{max-width:880px;padding:20px 28px;border-radius:16px;background:#221C18;font-size:24px;color:#B9ACA2;line-height:1.4}
#foot{position:fixed;left:0;right:0;bottom:28px;margin:0;text-align:center;font-size:18px;color:#8C7F76}
#osd{position:fixed;left:0;top:0;width:100%;height:100%;display:none}
.shade{position:absolute;left:0;right:0;bottom:0;height:55%;background:rgba(10,8,7,.6);background:linear-gradient(rgba(10,8,7,0),rgba(10,8,7,.92))}
.badge{position:absolute;top:40px;left:64px;padding:10px 18px;border-radius:14px;background:rgba(21,17,15,.7);font-size:22px;font-weight:700}
.badge svg{color:#FF8A57;margin:-4px 12px 0 0}
.pause{position:absolute;left:50%;top:50%;width:140px;height:140px;margin:-120px 0 0 -70px;border-radius:50%;background:rgba(21,17,15,.7);line-height:140px;text-align:center}
.bar{position:absolute;left:64px;right:64px;bottom:56px}
.bar .t{font-size:40px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar .s{margin:6px 0 18px;font-size:22px;color:#B9ACA2}
.track{height:10px;border-radius:5px;background:rgba(247,241,236,.18);overflow:hidden}
.track i{display:block;height:100%;width:0;background:#FF8A57}
.times{position:relative;height:28px;margin-top:18px;font-size:22px;color:#B9ACA2}
.times span{position:absolute;top:0;left:0}
.times .r{left:auto;right:0}`;

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
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MayLo en la tele</title>
<style>
${PAGE_CSS}
</style>
</head>
<body>
<video id="video" playsinline></video>
<div id="idle" class="screen"><div class="box">
<div class="brand">${tvIcon(48)}MayLo</div>
<h1>Listo para recibir videos</h1>
<p class="sub">En MayLo abrí la página del video y tocá “Ver en la tele”.</p>
<div id="phones"></div>
</div></div>
<div id="loading" class="screen"><div class="box">
<div class="spin" role="status" aria-label="Cargando"></div>
<h1 id="loading-title"></h1>
<p id="loading-from" class="sub"></p>
</div></div>
<div id="failed" class="screen"><div class="box">
<div class="err" aria-hidden="true">!</div>
<h1>No se pudo reproducir este video</h1>
<div class="hint">Probá con otro servidor o calidad en la página, o usá “Duplicar la pantalla” desde MayLo.</div>
<p class="sub">Sigue listo para recibir otro video.</p>
</div></div>
<div id="osd"><div class="shade"></div>
<div class="badge">${tvIcon(26)}<span id="osd-from"></span></div>
<div id="osd-pause" class="pause" aria-label="En pausa"><svg width="56" height="56" viewBox="0 0 24 24" fill="#F7F1EC" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg></div>
<div class="bar"><div id="osd-title" class="t"></div><div id="osd-state" class="s"></div>
<div class="track"><i id="osd-fill"></i></div>
<div class="times"><span id="osd-now"></span><span id="osd-total" class="r"></span></div></div>
</div>
<p id="foot"></p>
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
