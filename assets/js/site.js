/* Фитнес-клуб «Максимум» — общий скрипт для всех страниц
   0. LED-переход между страницами (выключатель — в site.css, блок «LED-переход»)
   1. Меню на мобильном
   2. Кнопки «Написать в Telegram» с готовым текстом
   3. LED-табло на главной: 24/7 → часы по Москве → бегущая строка (из версии 9)
   3б. «24/7» из точек в блоке «О клубе» на главной (выключатель — LED_247 ниже)
   4. Анимации в духе версии 9: появление, заголовки, счётчики, шапка, бегущая строка, наклон карточек
   5. Форма заявки: метки UTM, предвыбор интереса, маска телефона, отправка (демо или прокси → 1С) */

// адрес нашего прокси lead.php на хостинге сайта, например '/api/lead.php' (null = демо-режим, заявка никуда не уходит).
// Адрес вебхука 1С сюда НЕ писать: он только в lead-config.php на сервере (см. README, «Заявки → 1С: Фитнес»)
var LEAD_ENDPOINT = null;

// «24/7» из точек в блоке «О клубе»: false — обычная надпись текстом
var LED_247 = true;

// Telegram, текст по умолчанию и подписи заявок — из assets/data/club.js; ниже запасные значения
var CLUB = window.CLUB || {};
var TG_USER = (CLUB.contacts && CLUB.contacts.telegram.user) || 'maximum_otradnoe';
var TG_DEFAULT = (CLUB.contacts && CLUB.contacts.telegram.defaultText) || 'Здравствуйте! Хочу записаться на пробное занятие в «Максимум»';

// ?interest=... → пункт в «Что интересует» и подпись заявки (subject), как у акций на старом сайте
var INTERESTS = CLUB.leadInterests || {
  trial: { option: 'Пробное занятие', subject: 'Пробное занятие || новый сайт' },
  other: { option: 'Другое', subject: 'Другое || новый сайт' }
};

(function () {
  'use strict';

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var now = function () { return performance.now(); };
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var small = window.matchMedia && matchMedia('(max-width: 640px)').matches;

  function tgLink(text) {
    return 'https://t.me/' + TG_USER + '?text=' + encodeURIComponent(text || TG_DEFAULT);
  }

  /* ---------- 0. LED-переход между страницами ----------
     Первый кадр новой страницы закрывает CSS-шторка (html::after в site.css) — она же выключатель эффекта.
     Скрипт подхватывает её: по клику на внутреннюю ссылку экран закрывается сеткой точек — круговой волной от места клика,
     а на новой странице сетка раскрывается из той же точки. По фронту волны бежит жёлтая «развёртка», как на табло. */
  var introDelay = 0; // на сколько сдвинуть появление первого экрана, пока открывается сетка
  (function () {
    var cover = window.getComputedStyle ? getComputedStyle(root, '::after') : null;
    if (reduce || !cover || cover.content === 'none' || cover.display === 'none') return; // эффект выключен в site.css
    var cv = document.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return;
    cv.className = 'led-cover'; cv.setAttribute('aria-hidden', 'true');

    var conn = navigator.connection || {};
    var plain = !!conn.saveData;                                                 // экономия трафика: обычное затемнение
    var weak = !plain && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4; // слабое устройство: точек меньше
    var PITCH = weak ? 26 : 16, BG = '#1b1b1e', YELLOW = '#f5ff00';
    var CLOSE_MS = 700, OPEN_MS = 900, OPEN_DIRECT_MS = 300, WAIT_MAX = 400;     // прямое открытие: контент ждёт не дольше WAIT_MAX
    var SPREAD = 0.45, LIFE = 1 - SPREAD;                                        // доля времени на проход волны / на рост одной точки (больше — мягче край)
    var W = -1, H = -1, dpr = 1, n = 0, cx, cy, dist, delay, lit;                // -1: сетка ещё не считалась (окно может быть и нулевым)
    var raf = 0, timer = 0, navTimer = 0, busy = false;

    function layout() {
      if (innerWidth === W && innerHeight === H) return;
      W = innerWidth; H = innerHeight;
      dpr = weak ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      var cols = Math.ceil(W / PITCH) + 1, rows = Math.ceil(H / PITCH) + 1, i = 0;
      n = cols * rows;
      cx = new Float32Array(n); cy = new Float32Array(n); dist = new Float32Array(n); delay = new Float32Array(n); lit = new Uint8Array(n);
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++, i++) {
        cx[i] = c * PITCH + PITCH / 2; cy[i] = r * PITCH + PITCH / 2;
        lit[i] = Math.random() < 0.05 ? 1 : 0;                                  // эти точки тихо вспыхивают жёлтым на фронте
      }
    }

    // волна расходится кругом от точки (ox, oy): ближние точки раньше, дальние позже, с лёгкой неровностью «как на табло»
    function aim(ox, oy) {
      var far = Math.max(Math.hypot(ox, oy), Math.hypot(W - ox, oy), Math.hypot(ox, H - oy), Math.hypot(W - ox, H - oy)) || 1;
      for (var i = 0; i < n; i++) {
        dist[i] = Math.hypot(cx[i] - ox, cy[i] - oy) / far;
        delay[i] = Math.min(1, Math.pow(dist[i], 0.9) + (Math.random() - 0.5) * 0.06) * SPREAD;
      }
    }

    var ease = function (x) { return (1 - Math.cos(Math.PI * x)) / 2; }; // мягкий разгон и торможение

    // t: 0…1 — ход перехода; opening: сетка гаснет (true) или закрывает экран (false)
    function draw(t, opening) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (opening ? t >= 1 : t <= 0) return;
      ctx.fillStyle = BG;
      if (plain || (opening ? t <= 0 : t >= 1)) {
        ctx.globalAlpha = plain ? ease(opening ? 1 - t : t) : 1;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
        return;
      }
      // открытие идёт той же волной в обратную сторону: первыми гаснут точки у места клика
      // точка растёт и одновременно проявляется из прозрачной: край волны — мягкий градиент, а не жёсткая линия.
      // Прозрачность раскладываем по 8 уровням — восемь заливок за кадр вместо тысяч
      var R = PITCH * 0.74, LEVELS = 8, i, p, q, r, k;                            // R > половины диагонали ячейки: соседние круги перекрываются без щелей
      var paths = [];
      for (k = 0; k < LEVELS; k++) paths.push(new Path2D());
      for (i = 0; i < n; i++) {
        p = (t - delay[i]) / LIFE;
        p = p < 0 ? 0 : p > 1 ? 1 : p;
        p = opening ? 1 - p : p;
        if (p <= 0.001) continue;
        q = ease(p);
        r = R * (0.35 + 0.65 * q);
        k = Math.min(LEVELS - 1, Math.floor(q * LEVELS));
        paths[k].moveTo(cx[i] + r, cy[i]); paths[k].arc(cx[i], cy[i], r, 0, 6.2832);
      }
      for (k = 0; k < LEVELS; k++) { ctx.globalAlpha = (k + 1) / LEVELS; ctx.fill(paths[k]); }
      ctx.globalAlpha = 1;
      // жёлтая «строка развёртки» на фронте волны: точка загорается чуть раньше графита и гаснет под ним
      ctx.fillStyle = YELLOW;
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        if (!lit[i]) continue;
        q = (t - delay[i] + 0.04) / 0.2;
        if (q <= 0 || q >= 1) continue;
        r = PITCH * 0.13 * Math.sin(q * Math.PI);
        ctx.moveTo(cx[i] + r, cy[i]); ctx.arc(cx[i], cy[i], r, 0, 6.2832);
      }
      ctx.globalAlpha = 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function run(opening, ms, origin, done) {
      cancelAnimationFrame(raf); clearTimeout(timer);
      layout();
      aim(origin.x * W, origin.y * H);
      cv.style.display = 'block';
      var start = now(), ended = false;
      function end() {
        if (ended) return;
        ended = true;
        cancelAnimationFrame(raf); clearTimeout(timer);
        draw(1, opening);
        if (opening) cv.style.display = 'none';
        if (done) done();
      }
      (function frame() {
        var t = (now() - start) / ms;
        if (t >= 1) { end(); return; }
        draw(t, opening);
        raf = requestAnimationFrame(frame);
      })();
      timer = setTimeout(end, ms + 150); // без кадров (фоновая вкладка) экран не остаётся закрытым
    }

    var CENTER = { x: 0.5, y: 0.42 };
    function reopen() { clearTimeout(navTimer); busy = false; run(true, OPEN_DIRECT_MS, CENTER); }

    // подхватываем CSS-шторку: сколько она уже провисела, столько и вычитаем из времени открытия
    var held = 0;
    try { document.getAnimations().forEach(function (a) { if (a.animationName === 'led-cover') held = a.currentTime || 0; }); }
    catch (e) { var fp = performance.getEntriesByType && performance.getEntriesByType('paint')[0]; held = fp ? now() - fp.startTime : 0; }
    var fromLink = false, origin = CENTER;
    try {
      var nav = JSON.parse(sessionStorage.getItem('led-nav') || 'null');
      sessionStorage.removeItem('led-nav');
      if (nav && Date.now() - nav.at < 5000) { fromLink = true; origin = { x: nav.x, y: nav.y }; }
    } catch (e) {}
    // переход по ссылке: волна раскрывает страницу из той же точки; прямое открытие — коротко, не дольше WAIT_MAX
    var openMs = fromLink ? OPEN_MS : Math.min(OPEN_DIRECT_MS, WAIT_MAX - held);
    document.body.appendChild(cv);
    if (openMs >= 120) {                 // иначе шторка уже гаснет сама, не перебиваем
      layout(); draw(0, true);
      cv.style.display = 'block';
      root.classList.add('led-js');      // canvas закрыл экран — CSS-шторку убираем
      introDelay = Math.round(openMs * 0.35);
      run(true, openMs, origin);
    }

    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      var u;
      try { u = new URL(a.href, location.href); } catch (err) { return; }
      if (!/^https?:$/.test(u.protocol) || u.origin !== location.origin) return;       // tel:, t.me, внешние
      if (u.pathname === location.pathname && u.search === location.search) return;     // якорь на этой же странице
      if (!/(?:\/|\.html?|\/[^.\/]+)$/.test(u.pathname)) return;                        // файл, а не страница
      e.preventDefault();
      if (busy) return;
      busy = true;
      // точка, откуда пойдёт волна: место клика, а при нажатии с клавиатуры — центр ссылки
      var box = a.getBoundingClientRect();
      var px = e.clientX || e.clientY ? e.clientX : box.left + box.width / 2;
      var py = e.clientX || e.clientY ? e.clientY : box.top + box.height / 2;
      var from = { x: Math.min(1, Math.max(0, px / innerWidth)), y: Math.min(1, Math.max(0, py / innerHeight)) };
      var pre = document.createElement('link');                                         // страница грузится, пока экран закрывается
      pre.rel = 'prefetch'; pre.href = u.href; document.head.appendChild(pre);
      run(false, CLOSE_MS, from, function () {
        try { sessionStorage.setItem('led-nav', JSON.stringify({ at: Date.now(), x: from.x, y: from.y })); } catch (err) {}
        location.href = u.href;
        navTimer = setTimeout(reopen, 4000);                                            // переход не состоялся — открываем обратно
      });
    });

    // кнопка «Назад»: страница из кэша браузера возвращается с закрытым экраном — открываем
    addEventListener('pageshow', function (e) { if (e.persisted) reopen(); });
  })();

  /* ---------- 1. мобильное меню ---------- */
  var burger = $('.burger'), menu = $('#mobile-menu');
  if (burger && menu) {
    var setMenu = function (open) {
      menu.classList.toggle('open', open);
      document.documentElement.classList.toggle('menu-open', open && innerWidth <= 640); // страница под меню не прокручивается
      document.dispatchEvent(new Event('menu-toggle'));
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    };
    burger.addEventListener('click', function () { setMenu(!menu.classList.contains('open')); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('open')) { setMenu(false); burger.focus(); }
    });
    window.addEventListener('resize', function () { if (innerWidth > 1080) setMenu(false); });
  }

  /* ---------- 2. Telegram: клиент пишет первым ----------
     data-tg="" — текст страницы (body[data-tg]), data-tg="..." — свой текст кнопки */
  var pageTg = document.body.getAttribute('data-tg') || TG_DEFAULT;
  $$('[data-tg]').forEach(function (a) {
    a.href = tgLink(a.getAttribute('data-tg') || pageTg);
    a.target = '_blank';
    a.rel = 'noopener';
  });

  /* ---------- 2б. акции со сроком: истёкшие скрываем, даже если сайт не пересобрали ---------- */
  $$('[data-until]').forEach(function (el) {
    if (new Date(el.getAttribute('data-until') + 'T23:59:59+03:00') < new Date()) el.parentNode.removeChild(el);
  });

  /* ---------- 3. LED-табло и часы по Москве ---------- */
  function moscowTime() {
    try {
      var p = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      var h = '', m = '';
      p.forEach(function (x) { if (x.type === 'hour') h = x.value; if (x.type === 'minute') m = x.value; });
      return [h.padStart(2, '0').slice(-2), m.padStart(2, '0')];
    } catch (e) {
      var d = new Date();
      return [String(d.getHours()).padStart(2, '0'), String(d.getMinutes()).padStart(2, '0')];
    }
  }
  var clock = $('#clock');
  function tick() { if (clock) { var t = moscowTime(); clock.textContent = t[0] + ':' + t[1]; } }
  tick(); setInterval(tick, 15000);

  var FONT = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ':': ['0', '1', '1', '0', '1', '1', '0'],
    ';': ['0', '0', '0', '0', '0', '0', '0'], /* двоеточие в момент мигания */
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
    ' ': ['000', '000', '000', '000', '000', '000', '000'],
    'А': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'Г': ['11111', '10000', '10000', '10000', '10000', '10000', '10000'],
    'Е': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'И': ['10001', '10001', '10011', '10101', '11001', '10001', '10001'],
    'Й': ['01010', '00100', '10001', '10011', '10101', '11001', '10001'],
    'К': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'Л': ['00111', '01001', '01001', '01001', '01001', '01001', '10001'],
    'М': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'Н': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'О': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'Р': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'С': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'Т': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'У': ['10001', '10001', '10001', '01111', '00001', '10001', '01110'],
    'Ч': ['10001', '10001', '10001', '01111', '00001', '00001', '00001'],
    'Ы': ['10001', '10001', '10001', '11101', '10011', '10011', '11101'],
    'Я': ['01111', '10001', '10001', '01111', '00101', '01001', '10001']
  };
  function bitmap(str) {               // строка → массив колонок по 7 бит
    var cols = [];
    str.split('').forEach(function (ch, i) {
      var g = FONT[ch] || FONT[' '];
      if (i) cols.push([0, 0, 0, 0, 0, 0, 0]);
      for (var x = 0; x < g[0].length; x++) {
        var col = [];
        for (var y = 0; y < 7; y++) col.push(g[y][x] === '1' ? 1 : 0);
        cols.push(col);
      }
    });
    return cols;
  }

  var led = $('#led');
  if (led && led.getContext) (function () {
    var ctx = led.getContext('2d');
    // Сетка как в первой версии: только строка из 7 рядов, крупные точки с мягким свечением
    var COLS = 25, ROWS = 7, N = COLS * ROWS;
    var cur = new Float32Array(N), tgt = new Float32Array(N), pend = new Float32Array(N), at = new Float32Array(N);
    var hover = new Float32Array(N);
    var W, H, cell, ox, oy, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      var r = led.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      led.width = W; led.height = H;
      cell = Math.min(W / (COLS + 2), H / (ROWS + 4));
      ox = (W - cell * COLS) / 2; oy = (H - cell * ROWS) / 2;
    }
    function show(cols, offset, dissolveMs) {
      var t = now();
      for (var x = 0; x < COLS; x++) {
        var c = cols[x - offset];
        for (var y = 0; y < ROWS; y++) {
          var i = y * COLS + x, v = c ? c[y] : 0;
          if (dissolveMs) { pend[i] = v; at[i] = t + Math.random() * dissolveMs; }
          else { tgt[i] = v; at[i] = 0; }
        }
      }
    }
    function center(str) { var b = bitmap(str); return { b: b, off: Math.floor((COLS - b.length) / 2) }; }

    // сценарий, всё неторопливо
    var scene = 0, sceneStart = 0, scrollX = 0, scrollBmp = null;
    var SCENES = [
      { type: 'text', text: '24/7', dur: 8000 },
      { type: 'clock', dur: 6500 },
      { type: 'text', text: '24/7', dur: 6500 },
      { type: 'scroll', text: 'ТРЕНИРУЙСЯ НА МАКСИМУМ' }
    ];
    var SCROLL_SPEED = 20;     // колонок в секунду (v4 ~9,6 · v5 6 · v6 8 · v7 9 · v8 13)
    var DISSOLVE = 1100;       // мс на «пересыпание» точек
    function startScene(i) {
      scene = i % SCENES.length; sceneStart = now();
      var s = SCENES[scene];
      if (s.type === 'text') { var c = center(s.text); show(c.b, c.off, DISSOLVE); }
      if (s.type === 'clock') { lastClock = ''; drawClock(true); }
      if (s.type === 'scroll') { scrollBmp = bitmap(s.text); scrollX = COLS; }
    }
    var lastClock = '';
    function drawClock(dissolve) {
      var t = moscowTime(), blink = Math.floor(now() / 1000) % 2 === 0;
      var str = t[0] + (blink ? ':' : ';') + t[1];
      if (str === lastClock) return;
      lastClock = str;
      var c = center(str); show(c.b, c.off, dissolve ? DISSOLVE : 0);
    }

    var bootStart = now(), booting = !reduce;
    var pointer = null;
    if (finePointer) {
      led.addEventListener('pointermove', function (e) {
        var r = led.getBoundingClientRect();
        pointer = { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
      });
      led.addEventListener('pointerleave', function () { pointer = null; });
    }

    var lastT = now();
    function frame() {
      var t = now(), dt = Math.min(250, t - lastT) / 16.67; lastT = t;
      if (booting) {
        var p = (t - bootStart) / 1700, col = Math.floor(p * (COLS + 6));
        for (var x = 0; x < COLS; x++) for (var y = 0; y < ROWS; y++) {
          var d = col - x; tgt[y * COLS + x] = d >= 0 && d < 3 ? (1 - d / 3) * 0.85 : 0;
        }
        if (p >= 1) { booting = false; startScene(0); }
      } else {
        var s = SCENES[scene];
        if (s.type === 'clock') drawClock(false);
        if (s.type === 'scroll') {
          scrollX -= SCROLL_SPEED * dt / 60;
          show(scrollBmp, Math.round(scrollX), 0);
          if (scrollX < -scrollBmp.length - 2) startScene(scene + 1);
        } else if (t - sceneStart > s.dur) startScene(scene + 1);
        for (var k = 0; k < N; k++) if (at[k] && t >= at[k]) { tgt[k] = pend[k]; at[k] = 0; }
      }
      // точки под курсором тихо подсвечиваются
      if (pointer) {
        for (var yy = 0; yy < ROWS; yy++) for (var xx = 0; xx < COLS; xx++) {
          var cx = ox + xx * cell + cell / 2, cy = oy + yy * cell + cell / 2;
          var dd = Math.hypot(cx - pointer.x, cy - pointer.y) / (cell * 1.8);
          if (dd < 1) { var j = yy * COLS + xx; hover[j] = Math.max(hover[j], (1 - dd) * 0.6); }
        }
      }
      ctx.clearRect(0, 0, W, H);
      var rr = cell * 0.36;
      var ease = 1 - Math.pow(1 - (SCENES[scene].type === 'scroll' && !booting ? 0.5 : 0.12), dt);
      var fade = Math.pow(0.94, dt);
      for (var n = 0; n < N; n++) {
        cur[n] += (tgt[n] - cur[n]) * ease;
        hover[n] *= fade;
        var v = Math.min(1, cur[n] + hover[n]);
        var ci = n % COLS, px = ox + ci * cell + cell / 2, py = oy + Math.floor(n / COLS) * cell + cell / 2;
        ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832);
        if (v > 0.03) {
          var wave = reduce ? 1 : 0.86 + 0.14 * Math.sin(t / 420 - ci * 0.35);
          ctx.fillStyle = 'rgba(245,255,0,' + (v * wave).toFixed(3) + ')';
          ctx.shadowColor = 'rgba(245,255,0,' + (0.85 * v).toFixed(3) + ')'; ctx.shadowBlur = small ? 0 : cell * 0.6;
        } else {
          ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.shadowBlur = 0;
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
      if (running) requestAnimationFrame(frame);
    }

    var running = false;
    function play() { if (!running && !reduce) { running = true; lastT = now(); requestAnimationFrame(frame); } }
    function pause() { running = false; }
    resize();
    window.addEventListener('resize', function () { resize(); if (!running) frame(); });
    if (reduce) { var c0 = center('24/7'); show(c0.b, c0.off, 0); for (var q = 0; q < N; q++) cur[q] = tgt[q]; frame(); return; }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { en[0].isIntersecting ? play() : pause(); }).observe(led);
    } else play();
    document.addEventListener('visibilitychange', function () { document.hidden ? pause() : play(); });
  })();

  /* ---------- 3б. «24/7» из точек в блоке «О клубе» ----------
     Настоящий текст остаётся в разметке (для поисковиков и скринридеров), поверх рисуется LED-матрица.
     Пока карточка за краем экрана, точки рассыпаны; по мере прокрутки слетаются на места. */
  if (LED_247) (function () {
    var big = $$('.panel .big').filter(function (el) { return el.textContent.trim() === '24/7'; })[0];
    var panel = big && big.closest('.panel');
    var cv = document.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d');
    if (!panel || !ctx) return;

    // на телефоне матрица 5×7 с крупными точками, на широком экране каждая ячейка — 2×2 точки
    var SCALE = small ? 1 : 2, BASE_PITCH = small ? 12 : 7, LAG = 0.35;
    var cols = bitmap('24/7'), COLS = cols.length * SCALE, ROWS = 7 * SCALE, lit = [], unlit = [];
    cols.forEach(function (col, x) {
      col.forEach(function (on, y) {
        for (var dx = 0; dx < SCALE; dx++) for (var dy = 0; dy < SCALE; dy++) {
          var cell = { gx: x * SCALE + dx, gy: y * SCALE + dy };
          if (on) { cell.sx = Math.random(); cell.sy = Math.random(); cell.lag = Math.random() * LAG; lit.push(cell); }
          else unlit.push(cell);
        }
      });
    });

    cv.setAttribute('aria-hidden', 'true');
    panel.classList.add('led247-host');
    big.classList.add('led247');
    panel.appendChild(cv);

    var W = 0, H = 0, FH = 0, dpr = 1, pitch = BASE_PITCH, ox = 0, oy = 0, barH = 0;
    var actionbar = $('.actionbar');
    function layout() {
      pitch = Math.min(BASE_PITCH, Math.floor(big.clientWidth / COLS * 10) / 10);
      var h = Math.round(ROWS * pitch) + 'px';
      if (big.style.height !== h) big.style.height = h;
      W = panel.clientWidth; H = panel.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      // offset*: без учёта transform, поэтому анимация появления карточки не сбивает координаты
      ox = big.offsetLeft + pitch / 2; oy = big.offsetTop + pitch / 2;
      // рассыпанные точки летают только над текстом карточки — в полосе до заголовка «Круглосуточно…»
      var next = big.nextElementSibling;
      FH = Math.max(oy + ROWS * pitch, Math.min(H, next ? next.offsetTop - 6 : H));
      barH = actionbar ? actionbar.offsetHeight : 0; // на телефоне низ экрана занят панелью «Звонок · Telegram · Заявка»
    }

    // p: 0 — точки рассыпаны, 1 — надпись собрана
    function draw(p) {
      var r = pitch * 0.36, i, c, t, e;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // незажжённые ячейки матрицы проявляются по мере сборки
      ctx.fillStyle = 'rgba(255,255,255,' + (0.055 * p).toFixed(3) + ')';
      ctx.beginPath();
      for (i = 0; i < unlit.length; i++) {
        c = unlit[i];
        ctx.moveTo(ox + c.gx * pitch + r, oy + c.gy * pitch); ctx.arc(ox + c.gx * pitch, oy + c.gy * pitch, r, 0, 6.2832);
      }
      ctx.fill();
      ctx.fillStyle = '#f5ff00';
      ctx.globalAlpha = 0.3 + 0.7 * p;
      if (p >= 1) { ctx.shadowColor = 'rgba(245,255,0,.8)'; ctx.shadowBlur = pitch * 0.9; } // собранная надпись «горит»
      ctx.beginPath();
      for (i = 0; i < lit.length; i++) {
        c = lit[i];
        t = (p - c.lag) / (1 - LAG); t = t < 0 ? 0 : t > 1 ? 1 : t;
        e = 1 - Math.pow(1 - t, 3);
        var x = r + c.sx * (W - 2 * r), y = r + c.sy * (FH - 2 * r);
        x += (ox + c.gx * pitch - x) * e; y += (oy + c.gy * pitch - y) * e;
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
      }
      ctx.fill();
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    }

    var target = reduce ? 1 : 0, shown = -1, rafId = 0;
    // прогресс привязан к прокрутке: 0 — карточка только показалась снизу, 1 — видна целиком
    function measure() {
      var top = panel.parentElement.getBoundingClientRect().top + panel.offsetTop - panel.parentElement.offsetTop;
      var view = innerHeight - barH;
      var p = (view - top) / Math.min(panel.offsetHeight, view * 0.7);
      return p < 0 ? 0 : p > 1 ? 1 : p;
    }
    function tick() {
      rafId = 0;
      var d = target - shown;
      shown = shown < 0 || Math.abs(d) < 0.004 ? target : shown + d * 0.22; // догоняем плавно, без рывков от колеса мыши
      draw(shown);
      cv.classList.toggle('lit', shown >= 1);
      if (shown !== target) rafId = requestAnimationFrame(tick);
    }
    function update() {
      if (!reduce) target = measure();
      if (!rafId && target !== shown) rafId = requestAnimationFrame(tick);
    }

    // первый кадр и пересчёт размеров рисуем сразу, не дожидаясь rAF: иначе canvas на кадр пустеет
    function relayout() {
      layout();
      if (!reduce) target = measure();
      shown = target;
      draw(shown);
      cv.classList.toggle('lit', shown >= 1);
    }
    relayout();
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(panel);
    else addEventListener('resize', relayout);
    if (reduce) return;
    // слушаем прокрутку, только пока карточка рядом с экраном
    var listening = false, opts = { passive: true };
    new IntersectionObserver(function (en) {
      var near = en[0].isIntersecting;
      if (near && !listening) addEventListener('scroll', update, opts);
      if (!near && listening) removeEventListener('scroll', update, opts);
      listening = near;
      update();
    }, { rootMargin: '200px 0px' }).observe(panel);
  })();

  /* ---------- 4. анимации в духе версии 9 ----------
     Исходное состояние страницы обычное: контент виден всегда. Скрытие живёт только внутри
     самой анимации (fill: backwards), поэтому без JS, на скриншотах и для поисковиков ничего не спрятано. */

  // бегущая строка на главной (при reduced motion стоит на месте)
  var TICKER = ['24/7', 'Отрадное', 'Единоборства', 'Дети с ' + ((CLUB.kids && CLUB.kids.minAge) || 5) + ' лет', 'Сауна'];
  var heroBlock = $('.hero');
  if (heroBlock) {
    var ticker = document.createElement('div'), tickerRow = document.createElement('div');
    ticker.className = 'ticker'; ticker.setAttribute('aria-hidden', 'true');
    tickerRow.className = 'ticker-row';
    var tickerGroup = document.createElement('div');
    tickerGroup.className = 'ticker-group';
    TICKER.forEach(function (t) { var s = document.createElement('span'); s.textContent = t; tickerGroup.appendChild(s); });
    tickerRow.appendChild(tickerGroup); ticker.appendChild(tickerRow);
    heroBlock.parentNode.insertBefore(ticker, heroBlock.nextSibling);
  }

  var burst = function () {};

  if (!reduce && Element.prototype.animate) (function () {
    var EASE = 'cubic-bezier(.16,1,.3,1)';
    var STAGGER = small ? 40 : 70;

    function rise(el, delay, y, dur) {
      var d = dur || (small ? 450 : 700);
      var anim = el.animate(
        [{ opacity: 0, transform: 'translateY(' + y + ')' }, { opacity: 1, transform: 'none' }],
        { duration: d, delay: delay || 0, easing: EASE, fill: 'backwards' }
      );
      // страховка: без кадров (фоновая вкладка, снимок) анимация замирает на старте и прячет контент
      setTimeout(function () { if (anim.playState !== 'finished') anim.finish(); }, (delay || 0) + d + 400);
    }

    /* заголовки: слова по очереди */
    function splitWords(el) {
      (function walk(node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
          if (ch.nodeType === 1) { walk(ch); return; }
          if (ch.nodeType !== 3 || !ch.textContent.trim()) return;
          var frag = document.createDocumentFragment();
          ch.textContent.split(/( +)/).forEach(function (p) {
            if (!p) return;
            if (/^ +$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w'; w.textContent = p; frag.appendChild(w);
          });
          node.replaceChild(frag, ch);
        });
      })(el);
    }
    function words(el, delay) {
      $$('.w', el).forEach(function (w, k) { rise(w, delay + k * (small ? 35 : 55), '.35em', small ? 450 : 650); });
    }

    /* эйбрау и короткие подписи: перебор символов, как на табло */
    var GLYPHS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789/+';
    function scramble(el, delay) {
      var final = el.textContent, len = final.length, dur = (small ? 300 : 400) + len * (small ? 12 : 20), start;
      var lock = final.split('').map(function (_, k) { return (k / len) * dur * 0.75 + Math.random() * 120; });
      setTimeout(function () {
        start = now();
        (function step() {
          var t = now() - start, out = '';
          for (var k = 0; k < len; k++) {
            var ch = final[k];
            out += (t >= lock[k] || !/[0-9A-Za-zА-Яа-яЁё]/.test(ch)) ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          }
          el.textContent = out;
          if (t < dur + 120) setTimeout(step, 45); else el.textContent = final;
        })();
      }, delay || 0);
    }

    /* счётчики: цифры считаются от нулей, число знаков не меняется, поэтому вёрстка не дёргается */
    var NUM = /\d[\d ]*\d|\d/g;
    function countUp(el, delay) {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [], n;
      while ((n = walker.nextNode())) {
        if (/\d/.test(n.textContent) && !(n.parentNode.closest && n.parentNode.closest('.todo'))) nodes.push({ n: n, text: n.textContent });
      }
      if (!nodes.length) return;
      function paint(k) {
        nodes.forEach(function (o) {
          o.n.textContent = o.text.replace(NUM, function (m) {
            var digits = m.replace(/\D/g, ''), s = String(Math.round(parseInt(digits, 10) * k));
            while (s.length < digits.length) s = '0' + s;
            var i = 0;
            return m.replace(/\d/g, function () { return s[i++]; });
          });
        });
      }
      var dur = small ? 700 : 1100, start;
      paint(0);
      setTimeout(function () {
        start = now();
        (function step() {
          var p = Math.min(1, (now() - start) / dur);
          if (p >= 1) { nodes.forEach(function (o) { o.n.textContent = o.text; }); return; }
          paint(1 - Math.pow(2, -8 * p));
          setTimeout(step, 45);
        })();
      }, delay || 0);
    }

    /* кто что делает при появлении */
    var CHARS = '.eyebrow, .card .tag, .coach .role, .stub .role, .contact-list small, .board-top span:first-child, .board-bot span';
    var COUNTS = '.panel .big, .hero-meta > span:not(:first-child), .price-tag b, .card .price, .kids-table td:last-child, .coach.star p';
    var GRID = '.grid-2 > *, .grid-3 > *, .grid-4 > *, .coaches > *, .steps > li, .contacts > *';
    var BLOCKS = GRID + ', .lead, .hero-sub, .hero-meta, .btn-row, .subnav, .chips, .table-wrap, .ticks, .note, .motto, .trial-list, .form, .split > .photo, figure > .photo, .board, .live';

    var main = $('main');
    if (!main) return;
    var heads = $$('h1, .h2', main).filter(function (h) { return !h.classList.contains('sr-only'); });
    heads.forEach(splitWords);
    // <body data-fx="calm"> («Опции», «Услуги»): цены и подписи сразу в итоговом виде — без счётчиков и перебора букв
    var calm = document.body.getAttribute('data-fx') === 'calm';
    var chars = calm ? [] : $$(CHARS, main).filter(function (el) { return !el.children.length && el.textContent.trim(); });
    var counts = calm ? [] : $$(COUNTS, main).filter(function (el) { return /\d/.test(el.textContent) && !el.classList.contains('led247'); });
    var blocks = $$(BLOCKS, main).filter(function (el) {
      var up = el.parentElement.closest(BLOCKS);
      return !up || !main.contains(up);
    });

    // порядок первого экрана главной: сначала заголовок, карточка цены отдельно после него
    var HERO_DELAY = [['.live', 0], ['.hero-sub', 450], ['.hero .btn-row', 550], ['.hero-meta', 650], ['.board', 200]];
    function heroDelay(el) {
      for (var i = 0; i < HERO_DELAY.length; i++) if (el.matches(HERO_DELAY[i][0])) return HERO_DELAY[i][1];
      return null;
    }

    var items = [];
    heads.forEach(function (el) { items.push({ el: el, run: function (d) { words(el, d); }, block: false }); });
    chars.forEach(function (el) { items.push({ el: el, run: function (d) { scramble(el, d); }, block: false }); });
    counts.forEach(function (el) { items.push({ el: el, run: function (d) { countUp(el, d); }, block: false }); });
    blocks.forEach(function (el) { items.push({ el: el, run: function (d) { rise(el, d, '24px'); }, block: true }); });

    // первый экран — сразу, до первой отрисовки; если страница уже показана, не дёргаем её
    var painted = performance.getEntriesByType && performance.getEntriesByType('paint').length > 0;
    // сначала все замеры, потом запуск: иначе каждая анимация заставляет браузер заново считать раскладку
    var vh = innerHeight, rest = [], first = [], firstIdx = 0;
    var priceTag = $('.price-tag'), priceTagOnScreen = priceTag && priceTag.getBoundingClientRect().top < vh;
    items.forEach(function (it) { (it.el.getBoundingClientRect().top >= vh ? rest : first).push(it); });
    // introDelay > 0: экран ещё закрыт LED-сеткой, первый экран появляется вслед за ней
    if (!painted || introDelay) {
      first.forEach(function (it) {
        var d = heroDelay(it.el);
        if (d === null) d = it.block ? 200 + Math.min(firstIdx++, 8) * STAGGER : (it.el.closest('.hero') ? 100 : 0);
        it.run(d + introDelay);
      });
      if (priceTagOnScreen) rise(priceTag, 900 + introDelay, '24px');
    }

    // остальное — при прокрутке, пока блок ещё за нижним краем; если он уже на экране (рывок, якорь), не трогаем, иначе мигнёт
    var io = new IntersectionObserver(function (entries) {
      var idx = 0;
      entries.filter(function (e) { return e.isIntersecting; }).sort(function (a, b) {
        return (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left);
      }).forEach(function (e) {
        io.unobserve(e.target);
        if (e.boundingClientRect.top < innerHeight) return;
        var list = e.target.__motion || [];
        list.forEach(function (it) { it.run(it.block ? Math.min(idx, 6) * STAGGER : 0); });
        if (list.some(function (it) { return it.block; })) idx++;
      });
    }, { rootMargin: '0px 0px 120px 0px' });
    rest.forEach(function (it) { (it.el.__motion = it.el.__motion || []).push(it); io.observe(it.el); });

    /* шапка и полоса прогресса; параллакс — только с мышью на широком экране */
    var bar = document.createElement('div');
    bar.className = 'progress'; bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    var heroImg = (finePointer && !small) ? $('.hero-bg img') : null;
    var compact = false, ticking = false;
    function onScroll() {
      ticking = false;
      var y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
      if (!compact && y > 80) { compact = true; root.classList.add('hdr-compact'); }
      else if (compact && y < 40) { compact = false; root.classList.remove('hdr-compact'); }
      if (heroImg && y < heroBlock.offsetHeight) heroImg.style.transform = 'translate3d(0,' + (y * 0.12).toFixed(1) + 'px,0) scale(1.1)';
    }
    function queueScroll() { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }
    addEventListener('scroll', queueScroll, { passive: true });
    addEventListener('resize', queueScroll);
    if (heroImg) heroImg.style.transform = 'scale(1.1)';
    onScroll();

    /* бегущая строка: бесконечная, при наведении замедляется */
    if (heroBlock) {
      var group = $('.ticker-group'), rowEl = $('.ticker-row'), gw = group.getBoundingClientRect().width || 1;
      var half = Math.ceil(Math.max(screen.width || 0, innerWidth) / gw) + 1;
      for (var c = 1; c < half * 2; c++) rowEl.appendChild(group.cloneNode(true));
      var tickerAnim = rowEl.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-50%)' }],
        { duration: (half * gw) / (small ? 28 : 40) * 1000, iterations: Infinity, easing: 'linear' }
      );
      new IntersectionObserver(function (en) { en[0].isIntersecting ? tickerAnim.play() : tickerAnim.pause(); }).observe($('.ticker'));
      if (finePointer) {
        var rate = 1, rateGoal = 1, rateOn = false;
        var ease = function () {
          rate += (rateGoal - rate) * 0.1;
          if (Math.abs(rateGoal - rate) < 0.01) { rate = rateGoal; rateOn = false; }
          tickerAnim.playbackRate = rate;
          if (rateOn) requestAnimationFrame(ease);
        };
        var setRate = function (g) { rateGoal = g; if (!rateOn) { rateOn = true; requestAnimationFrame(ease); } };
        var tickerEl = $('.ticker');
        tickerEl.addEventListener('mouseenter', function () { setRate(0.25); });
        tickerEl.addEventListener('mouseleave', function () { setRate(1); });
      }
    }

    if (finePointer && !small) {
      /* тихая подсветка точек сетки под курсором на первом экране */
      if (heroBlock) {
        var glow = document.createElement('div');
        glow.className = 'hero-glow'; glow.setAttribute('aria-hidden', 'true');
        heroBlock.appendChild(glow);
        var gx = 0, gy = 0, gQueued = false;
        heroBlock.addEventListener('pointermove', function (e) {
          var r = heroBlock.getBoundingClientRect();
          gx = e.clientX - r.left; gy = e.clientY - r.top;
          if (gQueued) return;
          gQueued = true;
          requestAnimationFrame(function () {
            gQueued = false;
            glow.style.setProperty('--mx', gx + 'px'); glow.style.setProperty('--my', gy + 'px');
            glow.classList.add('on');
          });
        });
        heroBlock.addEventListener('pointerleave', function () { glow.classList.remove('on'); });
      }
      /* наклон карточек за курсором, максимум 4 градуса */
      $$('.card, .coach, .stub, .svc, .zone, .trainer-card', main).forEach(function (el) {
        el.classList.add('tilt');
        el.addEventListener('pointermove', function (e) {
          var r = el.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
          el.style.transform = 'perspective(900px) rotateX(' + ((0.5 - py) * 8).toFixed(2) + 'deg) rotateY(' + ((px - 0.5) * 8).toFixed(2) + 'deg)';
        });
        el.addEventListener('pointerleave', function () { el.style.transform = ''; });
      });
    }

    /* взрыв LED-точек после отправки заявки, до 1,2 секунды */
    burst = function (host, x, y) {
      var cv = document.createElement('canvas');
      cv.className = 'burst'; cv.setAttribute('aria-hidden', 'true');
      host.appendChild(cv);
      var r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      var c = cv.getContext('2d'), ps = [], start = now(), last = start, DUR = 1100;
      for (var k = 0; k < (small ? 40 : 70); k++) {
        var a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
        ps.push({ x: x * dpr, y: y * dpr, vx: Math.cos(a) * sp * dpr, vy: (Math.sin(a) * sp - 3) * dpr, r: (1.5 + Math.random() * 2.5) * dpr, w: Math.random() < 0.85 });
      }
      var stop = setTimeout(function () { cv.remove(); }, DUR + 100);
      (function step() {
        var t0 = now(), t = (t0 - start) / DUR, f = Math.min(3, (t0 - last) / 16.67); last = t0;
        if (t >= 1) { clearTimeout(stop); cv.remove(); return; }
        c.clearRect(0, 0, cv.width, cv.height);
        ps.forEach(function (p) {
          p.x += p.vx * f; p.y += p.vy * f; p.vy += 0.2 * dpr * f; p.vx *= Math.pow(0.985, f);
          c.beginPath(); c.arc(p.x, p.y, p.r, 0, 6.2832);
          c.fillStyle = (p.w ? 'rgba(245,255,0,' : 'rgba(255,255,255,') + (1 - t).toFixed(3) + ')';
          c.fill();
        });
        requestAnimationFrame(step);
      })();
    };
  })();

  /* ---------- телефон: нижняя панель уезжает, когда мешает ---------- */
  // клавиатура (фокус в поле ввода), открытое меню, видна форма заявки — там свои кнопки
  (function () {
    var bar = $('.actionbar');
    if (!bar) return;
    var typing = false, formSeen = false;
    var upd = function () { bar.classList.toggle('away', typing || formSeen || document.documentElement.classList.contains('menu-open')); };
    document.addEventListener('focusin', function (e) { if (e.target.matches('input:not([type=checkbox]):not([type=radio]), select, textarea')) { typing = true; upd(); } });
    document.addEventListener('focusout', function () { setTimeout(function () { var a = document.activeElement; typing = !!(a && a.matches && a.matches('input:not([type=checkbox]):not([type=radio]), select, textarea')); upd(); }, 50); });
    document.addEventListener('menu-toggle', upd);
    var lead = $('#lead-form');
    if (lead && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { formSeen = en[0].isIntersecting; upd(); }, { rootMargin: '0px 0px -10% 0px' }).observe(lead);
    }
  })();

  /* ---------- крупные заголовки: длинное слово не рвётся по буквам ---------- */
  // если слово шире строки (iPhone SE, «КОНФИДЕНЦИАЛЬНОСТИ»), уменьшаем кегль заголовка, пока слово не поместится
  (function () {
    var heads = [].slice.call(document.querySelectorAll('h1, h2.h2, .h1, .h2'));
    if (!heads.length) return;
    function fit() {
      heads.forEach(function (h) {
        h.style.fontSize = '';
        if (!h.clientWidth) return;
        var base = parseFloat(getComputedStyle(h).fontSize), size = base, min = Math.max(20, base * 0.6);
        var w = h.clientWidth; // ширину фиксируем: в сетке заголовок иначе растягивается под длинное слово
        h.style.maxWidth = w + 'px'; h.style.overflowWrap = 'normal'; h.style.wordBreak = 'keep-all';
        while (h.scrollWidth > w + 1 && size > min) { size -= 1; h.style.fontSize = size + 'px'; }
        h.style.maxWidth = ''; h.style.overflowWrap = ''; h.style.wordBreak = '';
      });
    }
    var t;
    var later = function () { clearTimeout(t); t = setTimeout(fit, 120); };
    fit();
    // шрифт Inter 900 может догрузиться позже первого замера — меряем ещё раз
    if (document.fonts) { if (document.fonts.ready) document.fonts.ready.then(fit); document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', later); }
    window.addEventListener('load', fit);
    window.addEventListener('resize', later);
    window.addEventListener('orientationchange', later);
  })();

  /* ---------- карта на «Контактах»: iframe прячем до загрузки, пока видна заглушка ---------- */
  // страница виджета Яндекса сначала показывает служебные ссылки неоформленным синим текстом
  (function () {
    var map = $('.map'), fr = map && $('iframe', map);
    if (!fr) return;
    map.classList.add('wait');
    var show = function () { map.classList.remove('wait'); };
    fr.addEventListener('load', function () { setTimeout(show, 400); });
    setTimeout(show, 8000); // если load уже прошёл или не придёт — карта всё равно появится
  })();

  /* ---------- 5. форма заявки ---------- */
  // метки utm_* запоминаем на странице входа: форма обычно на другой странице сайта
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  (function () {
    var q = new URLSearchParams(location.search), got = {}, any = false;
    UTM_KEYS.forEach(function (k) { var v = (q.get(k) || '').trim().slice(0, 200); if (v) { got[k] = v; any = true; } });
    if (any) try { sessionStorage.setItem('utm', JSON.stringify(got)); } catch (e) {}
  })();
  function utm() {
    var u = null;
    try { u = JSON.parse(sessionStorage.getItem('utm') || 'null'); } catch (e) {}
    var out = {};
    if (u) UTM_KEYS.forEach(function (k) { if (typeof u[k] === 'string' && u[k]) out[k] = u[k].slice(0, 200); });
    return out;
  }

  var form = $('#lead-form');
  if (!form) return;

  var nameEl = $('#f-name', form), phone = $('#f-phone', form), interest = $('#f-interest', form);
  var consent = $('#f-consent', form), status = $('.form-status', form), fallback = $('.form-fallback', form);
  var submitBtn = $('button[type=submit]', form), submitText = submitBtn.textContent;

  // предвыбор интереса из ссылки kontakty.html?interest=...#form
  var params = new URLSearchParams(location.search);
  var picked = INTERESTS[params.get('interest')];
  form.elements.subject.value = (picked || INTERESTS.trial).subject;
  if (picked) interest.value = picked.option;

  // тренер из ссылки ...&trainer=Имя — принимаем только имена из club.js, чужой текст в заявку не попадёт
  var trainer = params.get('trainer') || '', known = [];
  ((CLUB.trainers && CLUB.trainers.groups) || []).forEach(function (g) { g.list.forEach(function (t) { known.push(t.name); }); });
  if (known.indexOf(trainer) < 0) trainer = '';
  if (form.elements.trainer) form.elements.trainer.value = trainer;

  var pickedText = [];
  if (picked && picked.label) pickedText.push('Заявка по предложению: ' + picked.label);
  if (trainer) pickedText.push('Тренер: ' + trainer);
  if (pickedText.length) {
    var p = $('.picked', form);
    p.textContent = pickedText.join(' · ');
    p.hidden = false;
  }
  interest.addEventListener('change', function () {
    if (picked && interest.value === picked.option) { form.elements.subject.value = picked.subject; return; }
    for (var k in INTERESTS) {
      if (INTERESTS[k].option === interest.value && !INTERESTS[k].label) { form.elements.subject.value = INTERESTS[k].subject; break; }
    }
  });

  // page: текущая страница и откуда пришли внутри сайта
  var here = location.pathname.split('/').pop() || 'index.html';
  var from = '';
  try {
    var ref = document.referrer ? new URL(document.referrer) : null;
    if (ref && ref.host === location.host) from = ref.pathname.split('/').pop() || 'index.html';
  } catch (e) {}
  form.elements.page.value = from && from !== here ? here + ' ← ' + from : here;

  // маска +7 (___) ___-__-__
  function digits(v) {
    var d = v.replace(/\D/g, '');
    // вставили «+7 999…» или «8 999…» поверх готового «+7 (» — лишнюю 7/8 убираем
    if (d.length > 11 && (d[1] === '7' || d[1] === '8')) d = d[0] + d.slice(2);
    if (d[0] === '8') d = '7' + d.slice(1);
    if (d && d[0] !== '7') d = '7' + d;
    return d.slice(0, 11);
  }
  function formatPhone(d) {
    if (!d) return '';
    var o = '+7';
    if (d.length > 1) o += ' (' + d.slice(1, 4);
    if (d.length >= 4) o += ')';
    if (d.length > 4) o += ' ' + d.slice(4, 7);
    if (d.length > 7) o += '-' + d.slice(7, 9);
    if (d.length > 9) o += '-' + d.slice(9, 11);
    return o;
  }
  phone.addEventListener('input', function () {
    // привычная «8» в начале номера, когда «+7» уже стоит, — не цифра кода
    if (phone.value === '+7 (8') { phone.value = '+7 ('; return; }
    phone.value = formatPhone(digits(phone.value));
    phone.removeAttribute('aria-invalid');
  });
  phone.addEventListener('focus', function () { if (!phone.value) phone.value = '+7 ('; });
  phone.addEventListener('blur', function () { if (digits(phone.value).length <= 1) phone.value = ''; });
  nameEl.addEventListener('input', function () { nameEl.removeAttribute('aria-invalid'); });

  function fadeIn(el) {
    if (!reduce && el.animate) el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: 'ease-out' });
  }

  function fail(msg, el) {
    status.className = 'form-status err';
    status.textContent = msg;
    fadeIn(status);
    if (el) { el.setAttribute('aria-invalid', 'true'); el.focus(); }
  }

  function contactValue() {
    var c = $('input[name=contact]:checked', form);
    return c ? c.value : '';
  }

  function done(isDemo) {
    var name = nameEl.value.trim();
    var text = 'Здравствуйте! Меня зовут ' + name + '. Оставляю заявку с сайта клуба «Максимум», интересует: ' + interest.value.toLowerCase() + (trainer ? ', тренер ' + trainer : '') + '.';
    $('.done-name', form).textContent = name;
    $('.done-tg', form).href = tgLink(text);
    $('.demo', form).hidden = !isDemo;
    var btn = submitBtn.getBoundingClientRect();
    form.classList.add('sent');
    var box = form.getBoundingClientRect();
    fadeIn($('.form-done', form));
    burst(form, btn.left - box.left + btn.width / 2, Math.min(btn.top - box.top + btn.height / 2, box.height * 0.6));
    $('.form-done', form).focus({ preventScroll: true });
    form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // comment для 1С одной строкой: «Что интересует: …; Тренер: …; Удобнее: …; Страница: …; Источник: new-site»
  function leadComment() {
    var parts = ['Что интересует: ' + interest.value];
    if (picked && picked.label && interest.value === picked.option) parts.push('Предложение: ' + picked.label);
    if (trainer) parts.push('Тренер: ' + trainer);
    parts.push('Удобнее: ' + contactValue());
    parts.push('Страница: ' + form.elements.page.value);
    parts.push('Источник: ' + form.elements.source.value);
    return parts.join('; ').replace(/[\r\n]+/g, ' ');
  }

  var sending = false; // защита от двойной отправки: второй клик и Enter, пока идёт запрос, ничего не делают
  function unlock() { sending = false; submitBtn.disabled = false; submitBtn.classList.remove('loading'); submitBtn.textContent = submitText; }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending || form.classList.contains('sent')) return;
    status.className = 'form-status'; status.textContent = ''; fallback.hidden = true;
    // ловушка для ботов: поле hp не видно людям. Бот видит «Спасибо», заявка никуда не уходит
    if (form.elements.hp.value) { sending = true; setTimeout(function () { done(false); }, 500); return; }
    if (!nameEl.value.trim()) return fail('Напишите, как к вам обращаться.', nameEl);
    if (digits(phone.value).length !== 11) return fail('Проверьте номер: нужно 10 цифр после +7.', phone);
    if (!consent.checked) return fail('Нужно согласие на обработку персональных данных.', consent);

    sending = true; submitBtn.disabled = true;
    submitBtn.classList.add('loading'); submitBtn.textContent = 'Отправляем…';

    if (!LEAD_ENDPOINT) { setTimeout(function () { done(true); }, 500); return; }

    // поля как у вебхука 1С: last_name и email не отправляем; hp — ловушка, у людей пустая
    var lead = { name: nameEl.value.trim(), phone: digits(phone.value), comment: leadComment(), hp: '' };
    var u = utm();
    for (var k in u) lead[k] = u[k];
    fetch(LEAD_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(lead), credentials: 'omit' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok || !d || d.ok !== true) throw new Error('HTTP ' + r.status); }); })
      .then(function () { sending = false; done(false); })
      .catch(function () {
        unlock();
        fail('Не получилось отправить, позвоните или напишите в Telegram.');
        fallback.hidden = false;
        fadeIn(fallback);
      });
  });

  $('.again', form).addEventListener('click', function () {
    form.classList.remove('sent');
    fadeIn($('.form-fields', form));
    unlock();
    nameEl.focus();
  });
})();
