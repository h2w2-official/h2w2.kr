// h2w2 liquid cursor — an arrow made of ink.
// The arrow's four corners are separate soft springs: the tip sticks to the pointer, the other
// corners drag behind, so the arrow skews, stretches and jiggles back like a liquid. At rest
// the corners drift very slowly so the outline keeps breathing. A short tail of ink pulls out
// of the arrow when it moves, and on fast moves it sheds droplets that linger and dry up.
// Everything is one summed field drawn as a single iso-line (marching squares), so the arrow,
// the tail and the droplets merge and break smoothly.
(function () {
  if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return; // mouse only
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- feel (tweak here) ----
  // arrow corners relative to the tip (px): tip, bottom of the left edge, inner notch, right wing
  var SHAPE = [[0, 0], [0, 21], [6.6, 15], [15, 14.6]];
  var ROUND = 1.6;                 // corner roundness (px)
  var MAX_DEFORM = 4.5;            // how far a corner may lag behind while moving (px) — the liquid skew
  var HOVER_SCALE = 1.25;          // arrow size over links / buttons
  var CORNER_K = [1, 0.16, 0.2, 0.18], CORNER_D = 0.74;  // corner springs: tip fast, the rest lazy (lower k = stretchier)
  var TAIL_K = 0.07, TAIL_D = 0.70;   // tail springs (lower k = longer, stickier tail)
  var TAIL_R = [3.4, 2.8, 2.2];    // tail ball radii, front to back
  var SEG_MAX = 11;                // longest gap between tail balls (px)
  var WOBBLE = 0.9, WOBBLE_SPEED = 0.3;  // rest breathing: size (px) and speed
  var SPLASH_SPEED = 38;           // pointer speed (px/frame) that starts shedding droplets
  var MAX_DROPS = 16;
  var REACH = 3.2;                 // how far ink pulls toward ink before it merges (px)
  var CELL = 1.5;                  // contour grid (px); smaller = smoother, heavier

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
  var corners = SHAPE.map(function () { return { x: -999, y: -999, vx: 0, vy: 0 }; });
  var tail = TAIL_R.map(function (r) { return { x: -999, y: -999, vx: 0, vy: 0, r: r }; });
  var drops = [];
  var scale = 1, scaleTarget = 1, shown = false, down = false, last = performance.now(), nextDrop = 0, speed = 0;

  function anchor() {   // where the tail grows from: the middle of the arrow body
    return { x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4, y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4 };
  }
  function place(x, y) {
    corners.forEach(function (c, i) { c.x = x + SHAPE[i][0]; c.y = y + SHAPE[i][1]; c.vx = c.vy = 0; });
    var a = anchor(); tail.forEach(function (t) { t.x = a.x; t.y = a.y; t.vx = t.vy = 0; });
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
    scaleTarget = t ? HOVER_SCALE : 1;
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

  // ---- the ink field: arrow (signed distance) + balls ----
  var poly = [], balls = [], box = null;
  function polyDist(x, y) {
    var dmin = 1e9, inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
      var ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay;
      var t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      var dx = wx - ex * t, dy = wy - ey * t, d = dx * dx + dy * dy;
      if (d < dmin) dmin = d;
      if ((ay > y) !== (by > y) && x < ax + (y - ay) * ex / ey) inside = !inside;
    }
    return (inside ? -1 : 1) * Math.sqrt(dmin);
  }
  function field(x, y) {
    var f = 0;
    if (poly.length) {
      var d = polyDist(x, y) - ROUND * scale;
      f += d <= 0 ? 1 - d / REACH : Math.pow(REACH / (d + REACH), 2);
    }
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i], dx = x - b.x, dy = y - b.y;
      f += b.r * b.r / (dx * dx + dy * dy + 0.0001);
    }
    return f - 1;
  }
  function draw() {
    var cells = new Set(), corner = new Map();
    function addBox(x0, y0, x1, y1) {
      var a = Math.floor(x0 / CELL), b = Math.ceil(x1 / CELL), c = Math.floor(y0 / CELL), e = Math.ceil(y1 / CELL);
      for (var cx = a; cx < b; cx++) for (var cy = c; cy < e; cy++) cells.add((cx + 4096) * 16384 + (cy + 4096));
    }
    if (box) addBox(box[0] - 7, box[1] - 7, box[2] + 7, box[3] + 7);
    for (var i = 0; i < balls.length; i++) { var bl = balls[i], rr = bl.r * 2.4 + 5; addBox(bl.x - rr, bl.y - rr, bl.x + rr, bl.y + rr); }
    function val(ix, iy) {
      var k = (ix + 4096) * 16384 + (iy + 4096), v = corner.get(k);
      if (v === undefined) { v = field(ix * CELL, iy * CELL); corner.set(k, v); }
      return v;
    }
    g.beginPath();
    cells.forEach(function (key) {
      var ix = Math.floor(key / 16384), iy = key - ix * 16384 - 4096; ix -= 4096;
      var a = val(ix, iy), b = val(ix + 1, iy), c = val(ix + 1, iy + 1), d = val(ix, iy + 1);
      if (a < 0 && b < 0 && c < 0 && d < 0) return;
      var X = ix * CELL, Y = iy * CELL, S = CELL;
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) { g.rect(X, Y, S, S); return; }
      var cs = [[X, Y, a], [X + S, Y, b], [X + S, Y + S, c], [X, Y + S, d]], pts = [];
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
    scale += ((down ? scaleTarget * 0.88 : scaleTarget) - scale) * (1 - Math.pow(0.86, dt));

    // corners chase their place in the arrow; the slow sine drift is the rest breathing
    var s = now / 1000 * WOBBLE_SPEED;
    for (var i = 0; i < corners.length; i++) {
      var wob = still || i === 0 ? 0 : WOBBLE;
      var ox = SHAPE[i][0] * scale + wob * Math.sin(s * (1 + i * 0.31) + i * 1.9);
      var oy = SHAPE[i][1] * scale + wob * Math.cos(s * (0.8 + i * 0.27) + i * 2.6);
      var cr = corners[i], gx = mx + ox, gy = my + oy;
      if (i === 0) { cr.x = gx; cr.y = gy; cr.vx = cr.vy = 0; continue; }   // the tip is the real click point
      spring(cr, gx, gy, CORNER_K[i], CORNER_D, dt);
      // the arrow keeps its shape: each corner may lag only a few px, so it skews and jiggles instead of folding
      var lx = cr.x - gx, ly = cr.y - gy, ll = Math.hypot(lx, ly);
      if (ll > MAX_DEFORM) { cr.x = gx + lx / ll * MAX_DEFORM; cr.y = gy + ly / ll * MAX_DEFORM; }
    }
    var a = anchor(), prev = { x: a.x, y: a.y };
    for (var j = 0; j < tail.length; j++) {
      var tl = tail[j]; spring(tl, prev.x, prev.y, TAIL_K, TAIL_D, dt);
      var sx = tl.x - prev.x, sy = tl.y - prev.y, sl = Math.hypot(sx, sy);
      if (sl > SEG_MAX) { tl.x = prev.x + sx / sl * SEG_MAX; tl.y = prev.y + sy / sl * SEG_MAX; }
      prev = tl;
    }

    if (!still && shown && speed > SPLASH_SPEED && now > nextDrop && drops.length < MAX_DROPS) {
      nextDrop = now + 40 + Math.random() * 110;
      var src = Math.random() < 0.6 ? tail[tail.length - 1] : tail[1];
      var sv = Math.hypot(src.vx, src.vy) || 1, nx = -src.vy / sv, ny = src.vx / sv, side = (Math.random() - .5) * 2;
      drops.push({ x: src.x + nx * side * 5, y: src.y + ny * side * 5,
        vx: src.vx * (0.15 + Math.random() * 0.2) + nx * side * 0.6, vy: src.vy * (0.15 + Math.random() * 0.2) + ny * side * 0.6,
        r0: 2 + Math.random() * 3, born: now, life: 900 + Math.random() * 900 });
    }

    poly = []; balls = []; box = null;
    if (shown) {
      poly = corners.map(function (c) { return [c.x, c.y]; });
      var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
      box = [Math.min.apply(0, xs), Math.min.apply(0, ys), Math.max.apply(0, xs), Math.max.apply(0, ys)];
      // tail: continuous neck from the arrow body; it sinks back inside the arrow when it slows down
      var stretch = Math.min(Math.hypot(tail[2].x - a.x, tail[2].y - a.y) / 24, 1);
      if (stretch > 0.04) {
        var chain = [{ x: a.x, y: a.y, r: 3 }].concat(tail.map(function (t) { return { x: t.x, y: t.y, r: t.r * (0.35 + 0.65 * stretch) }; }));
        for (var k = 1; k < chain.length; k++) {
          var A = chain[k - 1], B = chain[k], L = Math.hypot(B.x - A.x, B.y - A.y), steps = Math.max(1, Math.ceil(L / 2.2));
          for (var u = 1; u <= steps; u++) { var f = u / steps; balls.push({ x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f, r: (A.r + (B.r - A.r) * f) * 0.6 }); }
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
    if (poly.length || balls.length) { g.fillStyle = ink; draw(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
