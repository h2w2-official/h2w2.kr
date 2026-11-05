// h2w2 liquid cursor: a small drop of ink that follows the pointer.
// At rest it breathes (its outline wobbles slowly); when it moves, the back of the drop
// trails behind on a softer spring, so it stretches like a liquid and jiggles back when it stops.
(function () {
  if (!window.matchMedia || !matchMedia('(hover: hover) and (pointer: fine)').matches) return; // mouse only
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var R = 9;               // drop radius (px)
  var HOVER_R = 15;        // radius over links / buttons
  var N = 48;              // outline points
  var HEAD = 0.35;         // how fast the drop's front catches the pointer (0-1 per frame at 60fps)
  var TAIL_K = 0.08, TAIL_D = 0.78;  // spring for the trailing back: lower k = longer stretch, higher d = less jiggle
  var MAX_STRETCH = 46;    // longest the drop may stretch (px)

  var cv = document.createElement('canvas'), g = cv.getContext('2d');
  cv.setAttribute('aria-hidden', 'true');
  cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647';
  var css = document.createElement('style');
  css.textContent = 'html.liquid-cursor, html.liquid-cursor * { cursor: none !important; }';
  document.head.appendChild(css);

  var dpr = 1, W = 0, H = 0;
  function size() { dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; }
  size(); addEventListener('resize', size);

  var mx = -100, my = -100, hx = -100, hy = -100, tx = -100, ty = -100, tvx = 0, tvy = 0;
  var r = R, rTarget = R, shown = false, down = false, last = performance.now();

  function color() {
    var c = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
    return c || '#111111';
  }
  var ink = '#111111';
  function refreshInk() { ink = color(); }
  refreshInk();
  if (matchMedia('(prefers-color-scheme: dark)').addEventListener) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshInk);

  addEventListener('pointermove', function (e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    mx = e.clientX; my = e.clientY;
    if (!shown) { shown = true; hx = tx = mx; hy = ty = my; document.documentElement.classList.add('liquid-cursor'); if (!cv.isConnected) document.body.appendChild(cv); }
    var t = e.target && e.target.closest ? e.target.closest('a, button, [role="button"], input, select, textarea, label, canvas.thumbcv, .thumb') : null;
    rTarget = t ? HOVER_R : R;
  }, { passive: true });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) shown = false; });
  addEventListener('blur', function () { shown = false; });
  addEventListener('pointerdown', function () { down = true; });
  addEventListener('pointerup', function () { down = false; });

  // smooth closed curve through points (midpoint quadratic)
  function blob(pts) {
    g.beginPath();
    var n = pts.length, a = pts[n - 1], b = pts[0];
    g.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    g.closePath(); g.fill();
  }

  function frame(now) {
    var dt = Math.min((now - last) / 16.667, 3); last = now;
    // front of the drop eases to the pointer, the back follows on a spring (overshoots a little = jiggle)
    var kh = 1 - Math.pow(1 - HEAD, dt);
    hx += (mx - hx) * kh; hy += (my - hy) * kh;
    tvx = (tvx + (hx - tx) * TAIL_K * dt) * Math.pow(TAIL_D, dt);
    tvy = (tvy + (hy - ty) * TAIL_K * dt) * Math.pow(TAIL_D, dt);
    tx += tvx * dt; ty += tvy * dt;
    var dx = tx - hx, dy = ty - hy, d = Math.hypot(dx, dy);
    if (d > MAX_STRETCH) { tx = hx + dx / d * MAX_STRETCH; ty = hy + dy / d * MAX_STRETCH; dx = tx - hx; dy = ty - hy; d = MAX_STRETCH; }
    r += ((down ? rTarget * 0.8 : rTarget) - r) * (1 - Math.pow(0.82, dt));

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (shown) {
      g.fillStyle = ink;
      var ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0, s = now / 1000, pts = [];
      var thin = Math.min(d / MAX_STRETCH, 1);            // the more it stretches, the thinner the neck
      for (var i = 0; i < N; i++) {
        var th = i / N * Math.PI * 2, cx = Math.cos(th), cy = Math.sin(th);
        // slow organic wobble of the outline, even at rest
        var wob = still ? 0 : 0.05 * Math.sin(3 * th + s * 1.7) + 0.035 * Math.sin(5 * th - s * 2.3 + 1.3) + 0.03 * Math.sin(2 * th + s * 1.1 + 2.1);
        var rr = r * (1 + wob), rt = r * (0.62 - 0.22 * thin) * (1 + wob);   // back of the drop stays round, smaller as it stretches
        // points on the back side slide from the front circle to a small circle at the trailing point -> teardrop
        var back = Math.max(0, cx * ux + cy * uy), w = back * back * (3 - 2 * back);
        pts.push([(hx + cx * rr) * (1 - w) + (tx + cx * rt) * w, (hy + cy * rr) * (1 - w) + (ty + cy * rt) * w]);
      }
      blob(pts);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
