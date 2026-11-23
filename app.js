'use strict';
/* The Music v1.2 — desktop shell.
   ES5 / IIFE / var. Регистрирует SW, ловит beforeinstallprompt,
   общается с iframe через MessageChannel + window.postMessage (fallback),
   проксирует горячие клавиши, синхронизирует тему и показывает online/offline. */
(function (window, document) {
  var SHELL = 'the-music-shell';
  var APP = 'the-music-app';
  var THEME_KEY = 'the-music.desktop.themeMode';
  var ROUTES = {
    home: 1, library: 1, search: 1, playlists: 1, playlist: 1,
    favorites: 1, track: 1, decoder: 1, settings: 1, player: 1
  };

  var frame = null;
  var installBtn = null;
  var siteBtn = null;
  var settingsBtn = null;
  var settingsPanel = null;
  var netStatus = null;
  var netText = null;
  var appStatus = null;
  var buildHint = null;
  var toastEl = null;
  var navToggle = null;
  var mobileNav = null;

  var port = null;
  var deferredPrompt = null;
  var toastTimer = null;

  function byId(id) {
    return document && document.getElementById ? document.getElementById(id) : null;
  }

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function normalizeMode(value) {
    var mode = String(value == null ? '' : value).toLowerCase();
    return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
  }

  function systemLight() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
    } catch (e) {
      return false;
    }
  }

  function resolveMode(mode) {
    return mode === 'system' ? (systemLight() ? 'light' : 'dark') : mode;
  }

  function storedMode() {
    try {
      return normalizeMode(window.localStorage.getItem(THEME_KEY) || 'system');
    } catch (e) {
      return 'system';
    }
  }

  function saveMode(mode) {
    try {
      window.localStorage.setItem(THEME_KEY, mode);
    } catch (e) { /* приватный режим — просто живём без сохранения */ }
  }

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = String(message == null ? '' : message);
    toastEl.hidden = false;
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.hidden = true;
      toastTimer = null;
    }, 2600);
  }

  function setAppStatus(text, ok) {
    if (appStatus) appStatus.textContent = String(text || '');
    if (ok && buildHint) buildHint.hidden = true;
  }

  function withSource(data) {
    var out = {};
    var key;
    for (key in data) if (hasOwn(data, key)) out[key] = data[key];
    out.source = SHELL;
    return out;
  }

  function targetOrigin() {
    try {
      if (window.location.protocol === 'file:') return '*';
      return window.location.origin || '*';
    } catch (e) {
      return '*';
    }
  }

  /* Единая точка отправки: MessageChannel когда есть порт, иначе window.postMessage. */
  function send(data) {
    if (!data || typeof data !== 'object') return;
    var msg = withSource(data);
    if (port) {
      try {
        port.postMessage(msg);
        return;
      } catch (e) {
        port = null;
      }
    }
    if (frame && frame.contentWindow) {
      try {
        frame.contentWindow.postMessage(msg, targetOrigin());
      } catch (e) { /* iframe ещё не готов */ }
    }
  }

  function applyTheme(mode, notifyApp) {
    mode = normalizeMode(mode);
    var resolved = resolveMode(mode);
    var root = document.documentElement;
    var meta = document.querySelector ? document.querySelector('meta[name="theme-color"]') : null;
    var buttons, i;

    if (root && root.setAttribute) {
      root.setAttribute('data-theme-mode', mode);
      root.setAttribute('data-theme-pref', mode);
      root.setAttribute('data-color-scheme', resolved);
      if (root.classList) {
        root.classList.toggle('theme-light', resolved === 'light');
        root.classList.toggle('theme-dark', resolved === 'dark');
      }
    }
    if (meta && meta.setAttribute) {
      meta.setAttribute('content', resolved === 'light' ? '#f4f6fd' : '#0d0d20');
    }
    buttons = document.querySelectorAll ? document.querySelectorAll('#shell-settings [data-mode]') : [];
    for (i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', buttons[i].getAttribute('data-mode') === mode ? 'true' : 'false');
    }
    saveMode(mode);
    if (notifyApp !== false) send({ type: 'theme', mode: mode, resolved: resolved });
  }

  function setActiveRoute(route) {
    var buttons = document.querySelectorAll ? document.querySelectorAll('[data-route]') : [];
    var i;
    route = String(route || 'home');
    for (i = 0; i < buttons.length; i++) {
      if (buttons[i].getAttribute('data-route') === route) buttons[i].classList.add('active');
      else buttons[i].classList.remove('active');
    }
  }

  function setNetwork(online) {
    if (netStatus && netStatus.classList) netStatus.classList.toggle('offline', !online);
    if (netText) netText.textContent = online ? 'Онлайн' : 'Оффлайн';
    send({ type: 'online', online: !!online });
  }

  function onAppMessage(msg) {
    if (!msg || msg.source !== APP) return;
    switch (msg.type) {
      case 'ready':
        setAppStatus('Приложение на связи · v1.2', true);
        applyTheme(storedMode(), true);
        send({ type: 'online', online: navigator.onLine !== false });
        if (msg.route) setActiveRoute(msg.route);
        break;
      case 'theme':
        if (msg.mode) applyTheme(msg.mode, false);
        break;
      case 'route':
        if (msg.route) setActiveRoute(msg.route);
        break;
      case 'volume':
        showToast('Громкость: ' + Math.round((Number(msg.volume) || 0) * 100) + '%');
        break;
      case 'error':
        showToast(msg.message || 'Ошибка в приложении');
        break;
      case 'pong':
        setAppStatus('Приложение отвечает · v1.2', true);
        break;
      default:
        break;
    }
  }

  /* Адаптер, который вставляется прямо в documents iframe.
     Он знает публичный API TheMusic (Core / Player / Theme) и не ломается,
     если какого-то модуля ещё нет: всё через guards. */
  function appBridge() {
    'use strict';
    var SRC_SHELL = 'the-music-shell';
    var SRC_APP = 'the-music-app';
    var T = window.TheMusic || (window.TheMusic = {});
    var ROUTES = {
      home: 1, library: 1, search: 1, playlists: 1, playlist: 1,
      favorites: 1, track: 1, decoder: 1, settings: 1, player: 1
    };
    var port = null;
    var bound = false;
    var readySent = false;
    var ticks = 0;

    function core() {
      return T.Core || T.core || null;
    }

    function player() {
      return T.Player || (T.modules && T.modules.Player) || null;
    }

    function send(type, data) {
      var msg = { source: SRC_APP, type: type };
      var key;
      if (data && typeof data === 'object') {
        for (key in data) if (Object.prototype.hasOwnProperty.call(data, key)) msg[key] = data[key];
      }
      try {
        if (port && port.postMessage) port.postMessage(msg);
        else if (window.parent && window.parent.postMessage) window.parent.postMessage(msg, '*');
      } catch (e) { /* родитель закрыт */ }
    }

    function call(fn) {
      try {
        if (typeof fn === 'function') return fn();
      } catch (e) { /* модуль может быть не готов */ }
      return null;
    }

    function normMode(value) {
      var mode = String(value == null ? '' : value).toLowerCase();
      return mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system';
    }

    function resolvedMode(mode) {
      if (mode !== 'system') return mode;
      try {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      } catch (e) {
        return 'dark';
      }
    }

    function currentMode() {
      var c = core();
      return normMode(c && c.state && c.state.settings ? c.state.settings.themeMode : 'system');
    }

    function currentRoute() {
      var c = core();
      return c && c.state ? String(c.state.route || 'home') : 'home';
    }

    function applyTheme(mode) {
      var themeMod = T.modules && T.modules.Theme;
      var c = core();
      var root = document.documentElement;
      var resolved;
      mode = normMode(mode);
      resolved = resolvedMode(mode);
      if (themeMod && typeof themeMod.setMode === 'function') {
        call(function () { return themeMod.setMode(mode); });
        if (typeof themeMod.resolved === 'function') resolved = themeMod.resolved();
      } else {
        if (c && c.state && c.state.settings) c.state.settings.themeMode = mode;
        if (root && root.setAttribute) {
          root.setAttribute('data-theme-pref', mode);
          root.setAttribute('data-theme-mode', resolved);
          root.setAttribute('data-color-scheme', resolved);
          if (root.classList) {
            root.classList.toggle('theme-light', resolved === 'light');
            root.classList.toggle('theme-dark', resolved === 'dark');
          }
        }
        call(function () { return c && c.save && c.save(); });
        if (c && typeof c.emit === 'function') {
          c.emit('thememode', mode);
          c.emit('themeresolved', resolved);
        }
      }
      send('theme', { mode: mode, resolved: resolved });
    }

    function go(route) {
      var c = core();
      route = String(route || 'home');
      if (!ROUTES[route]) route = 'home';
      if (c && typeof c.go === 'function') c.go(route);
      if (route === 'search') {
        window.setTimeout(function () {
          var input = document.getElementById('tm-search-input');
          if (input && input.focus) input.focus();
        }, 120);
      }
      send('route', { route: route });
    }

    function back() {
      var c = core();
      if (c && typeof c.back === 'function') c.back();
      send('route', { route: currentRoute() });
    }

    function changeVolume(delta) {
      var c = core();
      var current = c && c.state && c.state.settings ? Number(c.state.settings.volume) : NaN;
      var value = isFinite(current) ? current : 0.9;
      var input = document.getElementById ? document.getElementById('pl-vol') : null;
      var evt;
      value = Math.max(0, Math.min(1, value + delta));
      if (input) {
        input.value = String(Math.round(value * 100));
        try {
          evt = new Event('input', { bubbles: true });
          input.dispatchEvent(evt);
        } catch (e) {
          try {
            evt = document.createEvent('HTMLEvents');
            evt.initEvent('input', true, true);
            input.dispatchEvent(evt);
          } catch (e2) { /* слайдер может отсутствовать */ }
        }
      }
      if (c && c.state && c.state.settings) c.state.settings.volume = value;
      if (c && typeof c.native === 'function') c.native('setVolume', value);
      call(function () { return c && c.save && c.save(); });
      send('volume', { volume: value });
    }

    function hotkey(action) {
      var p;
      var c;
      switch (action) {
        case 'playpause':
          p = player();
          if (p && typeof p.toggle === 'function') call(function () { return p.toggle(); });
          else {
            c = core();
            if (c && typeof c.native === 'function') call(function () { return c.native('play'); });
          }
          break;
        case 'next':
          p = player();
          if (p && typeof p.next === 'function') call(function () { return p.next(); });
          break;
        case 'prev':
          p = player();
          if (p && typeof p.prev === 'function') call(function () { return p.prev(); });
          break;
        case 'volumeup':
          changeVolume(0.05);
          break;
        case 'volumedown':
          changeVolume(-0.05);
          break;
        case 'search':
          go('search');
          break;
        case 'back':
          back();
          break;
        default:
          break;
      }
    }

    function handle(msg) {
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'hotkey':
          hotkey(msg.action);
          break;
        case 'theme':
          applyTheme(msg.mode);
          break;
        case 'navigate':
          go(msg.route);
          break;
        case 'back':
          back();
          break;
        case 'online':
          window.__theMusicShellOnline = !!msg.online;
          break;
        case 'ping':
          send('pong', { route: currentRoute(), mode: currentMode() });
          break;
        default:
          break;
      }
    }

    function bindEvents() {
      var c = core();
      if (!c || typeof c.on !== 'function' || bound) return;
      bound = true;
      c.on('thememode', function (mode) {
        mode = normMode(mode);
        send('theme', { mode: mode, resolved: resolvedMode(mode) });
      });
      c.on('route', function (route) {
        send('route', { route: (route && route.screen) || route || 'home' });
      });
    }

    function onMessage(event) {
      var data = event && event.data;
      if (!data || data.source !== SRC_SHELL) return;
      if (data.type === 'connect' && event.ports && event.ports[0]) {
        port = event.ports[0];
        port.onmessage = function (e) { handle(e && e.data); };
        if (port.start) port.start();
        send('ready', { route: currentRoute(), mode: currentMode() });
        return;
      }
      handle(data);
    }

    window.addEventListener('message', onMessage, false);
    var timer = window.setInterval(function () {
      ticks++;
      bindEvents();
      if (!readySent && core()) {
        readySent = true;
        send('ready', { route: currentRoute(), mode: currentMode() });
      }
      if (ticks > 50) window.clearInterval(timer);
    }, 100);
  }

  function injectBridge() {
    var doc = null;
    var script;
    try {
      doc = frame && (frame.contentDocument || (frame.contentWindow && frame.contentWindow.document));
    } catch (e) {
      return;
    }
    if (!doc || !doc.documentElement || !doc.createElement) return;
    if (doc.getElementById && doc.getElementById('__themusic_shell_bridge__')) return;
    try {
      script = doc.createElement('script');
      script.id = '__themusic_shell_bridge__';
      script.type = 'text/javascript';
      script.textContent = '(' + String(appBridge) + ')();';
      (doc.head || doc.documentElement).appendChild(script);
    } catch (e) { /* iframe с другим origin — работаем только через postMessage */ }
  }

  function connectFrame() {
    var channel;
    injectBridge();
    if (!frame || !frame.contentWindow) return;
    if (!window.MessageChannel) {
      send({ type: 'theme', mode: storedMode() });
      return;
    }
    try {
      channel = new window.MessageChannel();
      port = channel.port1;
      port.onmessage = function (event) { onAppMessage(event && event.data); };
      if (port.start) port.start();
      frame.contentWindow.postMessage({ source: SHELL, type: 'connect' }, targetOrigin(), [channel.port2]);
    } catch (e) {
      port = null;
      try {
        frame.contentWindow.postMessage({ source: SHELL, type: 'connect' }, '*');
      } catch (e2) { /* ignore */ }
      send({ type: 'theme', mode: storedMode() });
    }
  }

  function onFrameLoad() {
    setAppStatus('Приложение загружено · соединение…', true);
    connectFrame();
  }

  function closeSettings() {
    if (!settingsPanel) return;
    settingsPanel.hidden = true;
    if (settingsBtn) settingsBtn.setAttribute('aria-expanded', 'false');
  }

  function isStandalone() {
    try {
      return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true;
    } catch (e) {
      return false;
    }
  }

  function bindShellUI() {
    var navButtons = document.querySelectorAll ? document.querySelectorAll('[data-route]') : [];
    var themeButtons = document.querySelectorAll ? document.querySelectorAll('#shell-settings [data-mode]') : [];
    var i;

    for (i = 0; i < navButtons.length; i++) {
      navButtons[i].addEventListener('click', function () {
        var route = this.getAttribute('data-route');
        setActiveRoute(route);
        send({ type: 'navigate', route: route });
      });
    }
    for (i = 0; i < themeButtons.length; i++) {
      themeButtons[i].addEventListener('click', function () {
        applyTheme(this.getAttribute('data-mode'), true);
      });
    }
    if (settingsBtn && settingsPanel) {
      settingsBtn.addEventListener('click', function () {
        settingsPanel.hidden = !settingsPanel.hidden;
        settingsBtn.setAttribute('aria-expanded', settingsPanel.hidden ? 'false' : 'true');
      });
    }
    if (navToggle && mobileNav) {
      navToggle.addEventListener('click', function () {
        mobileNav.hidden = !mobileNav.hidden;
      });
    }
    document.addEventListener('click', function (event) {
      if (!settingsPanel || settingsPanel.hidden) return;
      var target = event && event.target;
      if (settingsPanel.contains && target && !settingsPanel.contains(target) &&
          !(settingsBtn && settingsBtn.contains && settingsBtn.contains(target))) {
        closeSettings();
      }
    });

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      if (installBtn) {
        installBtn.disabled = false;
        installBtn.title = 'Установить The Music на рабочий стол';
      }
    });
    if (installBtn) {
      if (isStandalone()) installBtn.hidden = true;
      installBtn.addEventListener('click', function () {
        if (!deferredPrompt) {
          showToast('Установка появится в Chrome/Edge после первого визита');
          return;
        }
        var promptEvent = deferredPrompt;
        deferredPrompt = null;
        installBtn.disabled = true;
        try {
          promptEvent.prompt();
          promptEvent.userChoice.then(function (choice) {
            showToast(choice && choice.outcome === 'accepted' ? 'The Music установлен!' : 'Установка отменена');
          }, function () {
            showToast('Не удалось установить приложение');
          });
        } catch (e) {
          showToast('Браузер запретил установку');
        }
      });
    }
    window.addEventListener('appinstalled', function () {
      if (installBtn) installBtn.hidden = true;
      showToast('Готово — приложение установлено');
    });
  }

  function onKeyDown(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape' && settingsPanel && !settingsPanel.hidden) {
      event.preventDefault();
      closeSettings();
      return;
    }
    var target = event.target || {};
    var tag = String(target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;

    var key = event.key || '';
    var code = event.keyCode || 0;
    var action = null;
    if (key === ' ' || key === 'Spacebar' || code === 32) action = 'playpause';
    else if (key === 'ArrowLeft' || code === 37) action = 'prev';
    else if (key === 'ArrowRight' || code === 39) action = 'next';
    else if (key === 'ArrowUp' || code === 38) action = 'volumeup';
    else if (key === 'ArrowDown' || code === 40) action = 'volumedown';
    else if (key === '/' || code === 191) action = 'search';
    else if (key === 'Escape' || code === 27) action = 'back';
    if (!action) return;
    event.preventDefault();
    send({ type: 'hotkey', action: action, key: key });
  }

  function registerSW() {
    if (!window.navigator || !('serviceWorker' in window.navigator)) {
      setAppStatus('Service Worker недоступен — открой через http(s)', false);
      return;
    }
    try {
      window.navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function () {
        setAppStatus('Оффлайн-кэш активен', true);
      }, function () {
        setAppStatus('SW не зарегистрирован — нужен http(s)', false);
      });
    } catch (e) {
      setAppStatus('SW недоступен с file:// — запусти bash desktop/build.sh serve', false);
    }
  }

  function init() {
    frame = byId('app-frame');
    installBtn = byId('install-btn');
    siteBtn = byId('site-btn');
    settingsBtn = byId('settings-btn');
    settingsPanel = byId('shell-settings');
    netStatus = byId('net-status');
    netText = byId('net-text');
    appStatus = byId('app-status');
    buildHint = byId('build-hint');
    toastEl = byId('toast');
    navToggle = byId('nav-toggle');
    mobileNav = byId('mobile-nav');

    applyTheme(storedMode(), false);
    bindShellUI();
    window.addEventListener('keydown', onKeyDown, false);
    window.addEventListener('online', function () { setNetwork(true); }, false);
    window.addEventListener('offline', function () { setNetwork(false); }, false);
    setNetwork(navigator.onLine !== false);

    if (frame) frame.addEventListener('load', onFrameLoad, false);
    connectFrame();
    registerSW();
    setAppStatus('Соединение с приложением…', true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }
})(window, document);
