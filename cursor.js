// h2w2 liquid cursor — a drop of ink built from metaballs.
// The drop is a head ball that follows the pointer on a soft, heavily damped spring, plus a
// short chain of smaller balls that drag behind it (the viscous stretch). Three tiny satellites
// drift slowly inside the head so the outline keeps changing even at rest. On fast moves the
// tail sheds a few droplets that break away, linger and dry up.
// The outline is the iso-line of the summed metaball field (marching squares), so every
// merge and break is smooth and round.
(function () {
  if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return; // mouse only
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- feel (tweak here) ----
  var R = 8.5;                     // head radius at rest (px)
  var HOVER_R = 13;                // head radius over links / buttons
  var HEAD_K = 0.11, HEAD_D = 0.74;   // head spring: lower k = lazier, higher d = less overshoot
  var TAIL_K = 0.075, TAIL_D = 0.70;  // tail chain springs (lower k = longer, stickier stretch)
  var TAIL_R = [6.5, 5, 3.6];      // tail ball radii, front to back
  var WOBBLE_SPEED = 0.35;         // rest wobble speed (lower = slower)
  var SPLASH_SPEED = 38;           // pointer speed (px/frame) that starts shedding droplets
  var MAX_DROPS = 16;
  var SEG_MAX = 13;                // longest gap between tail balls (px) — sets the longest stretch
  var CELL = 2;                    // contour grid (px); smaller = smoother, heavier

  var cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
  var css = document.createElement('style');
  css.textContent = 'html.liquid-cursor, html.liquid-cursor * { cursor: none !important; }';
  document.head.appendChild(css);

  var dpr = 1, W = 0, H = 0;
  function size() { dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; }
  size(); addEventListener('resize', size);

  var ink = '#111111';
  function refreshInk() { ink = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#111111'; }
  refreshInk();
  var darkMq = matchMedia('(prefers-color-scheme: dark)');
  if (darkMq.addEventListener) darkMq.addEventListener('change', refreshInk);

  var mx = -999, my = -999, pmx = -999, pmy = -999;
  var head = { x: -999, y: -999, vx: 0, vy: 0, r: R };
  var tail = TAIL_R.map(function (r) { return { x: -999, y: -999, vx: 0, vy: 0, r: r }; });
  var drops = [];
  var rTarget = R, shown = false, down = false, last = performance.now(), nextDrop = 0, speed = 0;

  function place(x, y) {
    head.x = x; head.y = y; head.vx = head.vy = 0;
    tail.forEach(function (t) { t.x = x; t.y = y; t.vx = t.vy = 0; });
    pmx = mx = x; pmy = my = y;
  }

  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    mx = e.clientX; my = e.clientY;
    if (!shown) {
      shown = true; place(mx, my);
      document.documentElement.classList.add('liquid-cursor');
      if (!cv.isConnected) document.body.appendChild(cv);
    }
    var t = e.target && e.target.closest ? e.target.closest('a, button, [role="button"], input, select, textarea, label, .thumb') : null;
    rTarget = t ? HOVER_R : R;
  }, { passive: true });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) shown = false; });
  addEventListener('blur', function () { shown = false; });
  addEventListener('pointerdown', function () { down = true; });
  addEventListener('pointerup', function () { down = false; });

  function spring(p, tx, ty, k, d, dt) {
    p.vx = (p.vx + (tx - p.x) * k * dt) * Math.pow(d, dt);
    p.vy = (p.vy + (ty - p.y) * k * dt) * Math.pow(d, dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
  }

  // ---- metaball contour ----
  var balls = [];
  function field(x, y) {
    var f = 0;
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i], dx = x - b.x, dy = y - b.y;
      f += b.r * b.r / (dx * dx + dy * dy + 0.0001);
    }
    return f - 1;
  }
  function draw() {
    // cells near any ball
    var cells = new Set(), corner = new Map();
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i], reach = b.r * 2.6 + 6;
      var x0 = Math.floor((b.x - reach) / CELL), x1 = Math.ceil((b.x + reach) / CELL);
      var y0 = Math.floor((b.y - reach) / CELL), y1 = Math.ceil((b.y + reach) / CELL);
      for (var cx = x0; cx < x1; cx++) for (var cy = y0; cy < y1; cy++) cells.add((cx + 4096) * 16384 + (cy + 4096));
    }
    function val(ix, iy) {
      var k = (ix + 4096) * 16384 + (iy + 4096), v = corner.get(k);
      if (v === undefined) { v = field(ix * CELL, iy * CELL); corner.set(k, v); }
      return v;
    }
    g.beginPath();
    cells.forEach(function (key) {
      var ix = Math.floor(key / 16384), iy = key - ix * 16384 - 4096; ix -= 4096;
      var a = val(ix, iy), bb = val(ix + 1, iy), c = val(ix + 1, iy + 1), d = val(ix, iy + 1);
      if (a < 0 && bb < 0 && c < 0 && d < 0) return;
      var X = ix * CELL, Y = iy * CELL, S = CELL;
      if (a >= 0 && bb >= 0 && c >= 0 && d >= 0) { g.rect(X, Y, S, S); return; }
      // walk corners clockwise; emit inside corners and edge crossings
      var cs = [[X, Y, a], [X + S, Y, bb], [X + S, Y + S, c], [X, Y + S, d]], pts = [];
      for (var n = 0; n < 4; n++) {
        var p = cs[n], q = cs[(n + 1) % 4];
        if (p[2] >= 0) pts.push(p[0], p[1]);
        if ((p[2] >= 0) !== (q[2] >= 0)) { var t = p[2] / (p[2] - q[2]); pts.push(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t); }
      }
      g.moveTo(pts[0], pts[1]);
      for (var m = 2; m < pts.length; m += 2) g.lineTo(pts[m], pts[m + 1]);
      g.closePath();
    });
    g.fill();
  }

  function frame(now) {
    var dt = Math.min((now - last) / 16.667, 3); last = now;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    var pv = Math.hypot(mx - pmx, my - pmy) / Math.max(dt, 0.001); pmx = mx; pmy = my;
    speed += (pv - speed) * 0.5;

    spring(head, mx, my, HEAD_K, HEAD_D, dt);
    var prev = head;
    for (var i = 0; i < tail.length; i++) {
      var tl = tail[i]; spring(tl, prev.x, prev.y, TAIL_K, TAIL_D, dt);
      // a liquid neck only stretches so far; past that the drop sheds droplets instead
      var sx = tl.x - prev.x, sy = tl.y - prev.y, sl = Math.hypot(sx, sy);
      if (sl > SEG_MAX) { tl.x = prev.x + sx / sl * SEG_MAX; tl.y = prev.y + sy / sl * SEG_MAX; }
      prev = tl;
    }
    head.r += ((down ? rTarget * 0.85 : rTarget) - head.r) * (1 - Math.pow(0.9, dt));

    // shed droplets from the end of the tail on fast moves
    if (!still && shown && speed > SPLASH_SPEED && now > nextDrop && drops.length < MAX_DROPS) {
      nextDrop = now + 40 + Math.random() * 110;
      var end = tail[tail.length - 1], mid = tail[1];
      var src = Math.random() < 0.6 ? end : mid;
      var sv = Math.hypot(src.vx, src.vy) || 1, nx = -src.vy / sv, ny = src.vx / sv, side = (Math.random() - .5) * 2;
      drops.push({ x: src.x + nx * side * 5, y: src.y + ny * side * 5,
        vx: src.vx * (0.15 + Math.random() * 0.2) + nx * side * 0.6, vy: src.vy * (0.15 + Math.random() * 0.2) + ny * side * 0.6, r0: 2.2 + Math.random() * 3.2, born: now, life: 900 + Math.random() * 900 });
    }

    balls = [];
    if (shown) {
      balls.push({ x: head.x, y: head.y, r: head.r });
      // the tail balls shrink back into the head when it slows down, so the rest shape is one round drop
      var stretch = Math.min(Math.hypot(tail[2].x - head.x, tail[2].y - head.y) / 30, 1);
      // fill each tail segment with small balls so the neck stays one continuous body
      var chain = [{ x: head.x, y: head.y, r: head.r * 0.8 }].concat(tail.map(function (t) { return { x: t.x, y: t.y, r: t.r * (0.55 + 0.45 * stretch) }; }));
      for (var j = 1; j < chain.length; j++) {
        var A = chain[j - 1], B = chain[j], L = Math.hypot(B.x - A.x, B.y - A.y), steps = Math.max(1, Math.ceil(L / 2.5));
        for (var u = 1; u <= steps; u++) { var f = u / steps; balls.push({ x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, r: (A.r + (B.r - A.r) * f) * 0.62 }); }
      }
      if (!still) {
        // slow satellites inside the head keep the outline breathing
        var s = now / 1000 * WOBBLE_SPEED;
        for (var k = 0; k < 3; k++) {
          var ang = s * (0.9 + k * 0.37) + k * 2.1, rad = head.r * (0.5 + 0.14 * Math.sin(s * 1.3 + k));
          balls.push({ x: head.x + Math.cos(ang) * rad, y: head.y + Math.sin(ang) * rad, r: head.r * (0.42 + 0.06 * Math.sin(s * 0.8 + k * 1.7)) });
        }
      }
    }
    drops = drops.filter(function (dr) { return now - dr.born < dr.life; });
    for (var q = 0; q < drops.length; q++) {
      var dr = drops[q], age = (now - dr.born) / dr.life;
      dr.vx *= Math.pow(0.86, dt); dr.vy *= Math.pow(0.86, dt);
      dr.x += dr.vx * dt; dr.y += dr.vy * dt;
      var fade = age < 0.55 ? 1 : 1 - (age - 0.55) / 0.45;      // lingers, then dries up
      balls.push({ x: dr.x, y: dr.y, r: dr.r0 * Math.sqrt(Math.max(fade, 0)) });
    }
    if (balls.length) { g.fillStyle = ink; draw(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
