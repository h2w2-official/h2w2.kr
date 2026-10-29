// h2w2 hero logo: have -> want -> h2w2 liquid morph, then cursor-driven liquid hover.
(function () {
  var SRC = ['/media/logo/have.svg', '/media/logo/want.svg', '/media/logo/h2w2.svg'];
  var VB = { w: 394, h: 181 };                // frame the logos are centered in
  var HOLD_FIRST = 700, MORPH = 3000, HOLD = 100;
  var stage = document.getElementById('stage');
  var canvas = document.getElementById('fx');
  if (!stage || !canvas) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl || !gl.getExtension('OES_standard_derivatives')) return; // static logo stays

  var VS = 'attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; uv.y = 1.0-uv.y; gl_Position = vec4(p,0.,1.); }';
  var FS = [
    '#extension GL_OES_standard_derivatives : enable',
    'precision highp float;',
    'varying vec2 uv;',
    'uniform sampler2D sA; uniform sampler2D oA; uniform sampler2D wA; uniform sampler2D dA; uniform sampler2D dB;',
    'uniform vec2 mouse; uniform vec2 vel; uniform float radius; uniform float aspect; uniform float time; uniform vec3 color;',
    'uniform float morph; uniform float wob; uniform float mo;',
    'vec2 flow(vec2 q, float t){ return vec2(sin(q.y*1.7 + t*0.9) + sin(q.x*1.1 - t*0.6 + 1.3), sin(q.x*1.5 - t*0.8) + sin(q.y*1.2 + t*0.7 + 2.1)) * 0.25; }',
    'void main(){',
    '  vec2 d = (uv - mouse) * vec2(aspect, 1.0);',
    '  float s = 1.0 - smoothstep(0.0, radius, length(d));',
    '  s = s*s*(3.0-2.0*s);',
    '  vec2 lens = (uv - mouse) * s * 0.45;',
    '  vec2 drag = vel * s * 1.0;',
    '  vec2 q = uv*vec2(aspect,1.0)*3.2;',
    '  vec2 swirl = flow(q, time);',
    '  vec2 suv = uv - lens - drag + swirl * (0.06 * s + 0.045 * wob);',
    '  float sharp = texture2D(sA, suv).a;',
    '  float soft = texture2D(oA, suv).a, wide = texture2D(wA, suv).a;',
    '  float hover = mix(sharp, max(soft * 1.75, wide * 1.5), s * 0.7);',
    '  float goo = mix(texture2D(dA, suv).a, texture2D(dB, suv).a, morph);',
    '  float field = mix(hover, goo, mo);',
    '  float w = fwidth(field) * 0.9 + 1e-4;',
    '  float liquid = smoothstep(0.5 - w, 0.5 + w, field);',
    '  float a = mix(sharp, liquid, max(smoothstep(0.0, 0.12, s), mo));',
    '  gl_FragColor = vec4(color * a, a);',
    '}'
  ].join('\n');

  function sh(type, src){ var o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {}; ['sA','oA','wA','dA','dB','mouse','vel','radius','aspect','time','color','morph','wob','mo'].forEach(function(k){ U[k] = gl.getUniformLocation(prog, k); });
  gl.uniform1i(U.sA, 0); gl.uniform1i(U.oA, 1); gl.uniform1i(U.wA, 2); gl.uniform1i(U.dA, 3); gl.uniform1i(U.dB, 4);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  var texs = [0,1,2,3,4].map(function(unit){ var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; });
  function upload(unit, img){ gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texs[unit]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); }
  function setA(set){ upload(0, set.sharp); upload(1, set.soft); upload(2, set.wide); upload(3, set.sdf); }
  function setB(set){ upload(4, set.sdf); }

  // alpha-channel gaussian blur (3 box passes)
  function blurAlpha(src, W, H, r){
    var a = new Float32Array(W*H), b = new Float32Array(W*H), i;
    for (i = 0; i < W*H; i++) a[i] = src[i*4+3] / 255;
    function pass(inA, out, horiz){
      var len = horiz ? W : H, lines = horiz ? H : W, inv = 1/(2*r+1);
      for (var l = 0; l < lines; l++){
        var sum = 0, k;
        for (k = -r; k <= r; k++){ var kk = Math.min(len-1, Math.max(0,k)); sum += inA[horiz ? l*W+kk : kk*W+l]; }
        for (k = 0; k < len; k++){
          out[horiz ? l*W+k : k*W+l] = sum*inv;
          var add = Math.min(len-1, k+r+1), sub = Math.max(0, k-r);
          sum += inA[horiz ? l*W+add : add*W+l] - inA[horiz ? l*W+sub : sub*W+l];
        }
      }
    }
    for (var it = 0; it < 3; it++){ pass(a, b, true); pass(b, a, false); }
    var out = new ImageData(W, H);
    for (i = 0; i < W*H; i++){ out.data[i*4]=255; out.data[i*4+1]=255; out.data[i*4+2]=255; out.data[i*4+3]=Math.round(a[i]*255); }
    return out;
  }

  // signed distance field (Felzenszwalb EDT) packed into alpha: >0.5 inside
  function edt1(f, n, d, v, z){
    var k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
    for (var q = 1; q < n; q++){
      var s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q*q) - (f[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]); }
      k++; v[k] = q; z[k] = s; z[k+1] = 1e20;
    }
    k = 0;
    for (q = 0; q < n; q++){ while (z[k+1] < q) k++; d[q] = (q - v[k])*(q - v[k]) + f[v[k]]; }
  }
  function edt(grid, W, H){
    var n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), x, y;
    for (x = 0; x < W; x++){ for (y = 0; y < H; y++) f[y] = grid[y*W + x]; edt1(f, H, d, v, z); for (y = 0; y < H; y++) grid[y*W + x] = d[y]; }
    for (y = 0; y < H; y++){ for (x = 0; x < W; x++) f[x] = grid[y*W + x]; edt1(f, W, d, v, z); for (x = 0; x < W; x++) grid[y*W + x] = d[x]; }
  }
  function sdfImage(src, W, H, spread){
    var inG = new Float64Array(W*H), outG = new Float64Array(W*H), i;
    for (i = 0; i < W*H; i++){ var on = src[i*4+3] > 127; outG[i] = on ? 0 : 1e20; inG[i] = on ? 1e20 : 0; }
    edt(outG, W, H); edt(inG, W, H);
    var D = new Float32Array(W*H), T = new Float32Array(W*H);
    for (i = 0; i < W*H; i++) D[i] = Math.sqrt(outG[i]) - Math.sqrt(inG[i]) - 0.5;
    for (var it = 0; it < 2; it++){ // smooth pixel stair-steps
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++){ var s0 = 0, c = 0; for (var k = -1; k <= 1; k++){ var xx = x + k; if (xx >= 0 && xx < W){ s0 += D[y*W+xx]; c++; } } T[y*W+x] = s0 / c; }
      for (y = 0; y < H; y++) for (x = 0; x < W; x++){ var s1 = 0, c1 = 0; for (k = -1; k <= 1; k++){ var yy = y + k; if (yy >= 0 && yy < H){ s1 += T[yy*W+x]; c1++; } } D[y*W+x] = s1 / c1; }
    }
    var out = new ImageData(W, H);
    for (i = 0; i < W*H; i++){ var dd = D[i]; var val = 0.5 - dd / (2*spread);
      out.data[i*4]=255; out.data[i*4+1]=255; out.data[i*4+2]=255; out.data[i*4+3]=Math.round(Math.max(0, Math.min(1, val))*255); }
    return out;
  }

  var svgs = null, sets = null, W = 0, H = 0;
  function rasterize(svgText, cw, ch){
    return new Promise(function(res){
      var m = svgText.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number), lw = m[2], lh = m[3];
      var img = new Image();
      img.onload = function(){
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var x = c.getContext('2d'), k = Math.min(cw / VB.w, ch / VB.h);
        x.drawImage(img, (cw - lw * k) / 2, (ch - lh * k) / 2, lw * k, lh * k);
        res(x.getImageData(0, 0, cw, ch));
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });
  }
  function makeSet(svgText){
    var hw = Math.max(2, Math.round(W / 2)), hh = Math.max(2, Math.round(H / 2));
    return Promise.all([rasterize(svgText, W, H), rasterize(svgText, hw, hh)]).then(function(r){
      return { sharp: r[0], soft: blurAlpha(r[1].data, hw, hh, Math.max(1, Math.round(hh * 0.035))), wide: blurAlpha(r[1].data, hw, hh, Math.max(2, Math.round(hh * 0.06))), sdf: sdfImage(r[1].data, hw, hh, Math.max(4, hh * 0.12)) };
    });
  }

  var mouse = { x: .5, y: .5 }, vel = { x: 0, y: 0 }, cur = { x: .5, y: .5, r: 0 }, targetR = 0, hovering = false, running = false;
  var MAX_R = 0.42, ready = false, morph = 0, wob = 0, mo = 0;
  var seq = 0;           // 0 have, 1 want, 2 h2w2 (final, interactive)
  function fgColor(){ var c = getComputedStyle(stage).color.match(/\d+(\.\d+)?/g) || [17,17,17]; return [c[0]/255, c[1]/255, c[2]/255]; }

  function build(){
    var rect = stage.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(2, Math.round(rect.width * dpr)); H = Math.max(2, Math.round(rect.height * dpr));
    canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); gl.uniform1f(U.aspect, W / H);
    return Promise.all(svgs.map(makeSet)).then(function(s){
      sets = s; setA(sets[seq]); if (seq < 2) setB(sets[seq + 1]);
      ready = true; draw(performance.now()); stage.classList.add('gl');
    });
  }

  var t0 = performance.now();
  function draw(now){
    if (!ready) return;
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.mouse, cur.x, cur.y); gl.uniform2f(U.vel, vel.x, vel.y); gl.uniform1f(U.radius, cur.r);
    gl.uniform1f(U.time, ((now - t0) / 1000) % 600); gl.uniform3fv(U.color, fgColor());
    gl.uniform1f(U.morph, morph); gl.uniform1f(U.wob, wob); gl.uniform1f(U.mo, mo);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // intro sequence: have -> want -> h2w2
  function ease(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2; }
  function morphTo(next, done){
    setB(sets[next]); var start = performance.now();
    (function tick(now){
      var p = Math.min(1, (now - start) / MORPH);
      morph = ease(p); wob = Math.sin(Math.PI * p); mo = 1;
      draw(now);
      if (p < 1) requestAnimationFrame(tick);
      else { seq = next; setA(sets[next]); morph = 0; wob = 0; mo = 0; draw(now); done(); }
    })(start);
  }
  function runSequence(){
    setTimeout(function(){ morphTo(1, function(){ setTimeout(function(){ morphTo(2, function(){}); }, HOLD); }); }, HOLD_FIRST);
  }
  function whenIntroGone(cb){
    if (!document.body.classList.contains('intro-on')) return cb();
    var mo = new MutationObserver(function(){ if (!document.body.classList.contains('intro-on')) { mo.disconnect(); setTimeout(cb, 500); } });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // cursor liquid (after the sequence)
  var spring = { vx: 0, vy: 0 }, last = 0, acc = 0;
  var K = 0.012, DAMP = 0.955, VMAX = 0.13;
  function step(){
    spring.vx = (spring.vx + (mouse.x - cur.x) * K) * DAMP;
    spring.vy = (spring.vy + (mouse.y - cur.y) * K) * DAMP;
    cur.x += spring.vx; cur.y += spring.vy;
    vel.x = (mouse.x - cur.x) * 0.55; vel.y = (mouse.y - cur.y) * 0.55;
    var vm = Math.sqrt(vel.x*vel.x + vel.y*vel.y);
    if (vm > VMAX) { vel.x *= VMAX / vm; vel.y *= VMAX / vm; }
    cur.r += (targetR - cur.r) * (hovering ? 0.05 : 0.022);
  }
  function frame(now){
    acc += Math.min(100, last ? now - last : 16.7); last = now;
    while (acc >= 16.7) { step(); acc -= 16.7; }
    draw(now);
    var still = Math.abs(spring.vx) + Math.abs(spring.vy) + Math.abs(mouse.x - cur.x) + Math.abs(mouse.y - cur.y) < 4e-4;
    if (!hovering && cur.r < 0.002 && still) { cur.r = 0; draw(now); running = false; last = 0; acc = 0; return; }
    requestAnimationFrame(frame);
  }
  function start(){ if (!running) { running = true; requestAnimationFrame(frame); } }
  function pos(e){ var r = stage.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
  function move(e){ if (seq < 2 || !ready) return; var p = pos(e); if (!hovering && cur.r < 0.01) { cur.x = p.x; cur.y = p.y; spring.vx = spring.vy = 0; t0 = performance.now(); } mouse = p; hovering = true; targetR = MAX_R; start(); }
  function leave(){ if (seq < 2) return; hovering = false; targetR = 0; start(); }
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerdown', move);
  stage.addEventListener('pointerleave', leave);
  stage.addEventListener('pointercancel', leave);
  stage.addEventListener('pointerup', function(e){ if (e.pointerType !== 'mouse') leave(); });
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ if (svgs) build(); }, 150); });
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', function(){ draw(performance.now()); }) : mq.addListener(function(){ draw(performance.now()); })); }

  Promise.all(SRC.map(function(u){ return fetch(u).then(function(r){ return r.text(); }); }))
    .then(function(t){ svgs = t; return build(); })
    .then(function(){ whenIntroGone(runSequence); })
    .catch(function(){ /* keep static logo */ });
})();
