// h2w2 hero logo: endless liquid morph  have -> want -> h2w2 -> have ...
// Each word is turned into a float signed-distance field at three softness levels (sharp / soft / blob).
// A step melts the current word into a rounded blob, swaps the shape while it is liquid, and lets the
// next word set again — like ink re-forming — instead of cross-fading two hard outlines (which tears).
(function () {
  var SRC = ['/media/logo/have.svg', '/media/logo/want.svg', '/media/logo/h2w2.svg'];
  var VB = { w: 394, h: 181 };                // frame the logos are centered in
  var HOLD_FIRST = 0, MORPH = 8000;          // MORPH = time per step; loop have->want->h2w2->have = 3 x MORPH
  var TENT_ON = 0.06, TENT_OFF = 0.05;       // tent light timing, as a fraction of the have->want / h2w2->have steps
  var WANT = 0.3;                             // speed while passing each word (0 = stops there, 1 = barely slows)
  // liquid feel (fractions of the logo height)
  var MELT = 0.5;                             // how far a word melts mid-step (0 = hard outline, 1 = full blob)
  var SOFT_R = 0.03, BLOB_R = 0.065;          // blur radius of the "soft" and "blob" levels
  var SWELL = 0.01;                           // extra thickness while liquid, keeps thin parts from snapping off
  var RIPPLE = 0.012;                         // slow surface flow while liquid
  var SDF_SCALE = 1.5;                        // distance-field resolution per CSS px (canvas itself renders at full res)
  var RES = 2;                                // canvas resolution multiplier (x devicePixelRatio, capped)

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('fx');
  if (!stage || !canvas) return;
  function noAnim(){ document.dispatchEvent(new CustomEvent('h2w2:static')); }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return noAnim();
  var gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return noAnim(); // static logo stays

  var VS = '#version 300 es\nin vec2 p; out vec2 uv; void main(){ uv = p*0.5+0.5; uv.y = 1.0-uv.y; gl_Position = vec4(p,0.,1.); }';
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 uv; out vec4 o;',
    'uniform sampler2D dA; uniform sampler2D dB;',
    'uniform float cross;   // 0 = word A, 1 = word B',
    'uniform float melt;    // 0 = sharp, 1 = blob',
    'uniform float swell; uniform float ripple; uniform float time; uniform float aspect; uniform vec3 color;',
    // r = sharp, g = soft, b = blob distance (in logo heights, negative inside)
    'float level(vec3 t, float m){ return m < 0.5 ? mix(t.r, t.g, m * 2.0) : mix(t.g, t.b, m * 2.0 - 1.0); }',
    'void main(){',
    '  vec2 q = uv * vec2(aspect, 1.0);',
    '  vec2 flow = vec2(sin(q.y * 6.0 + time * 0.7) + sin(q.x * 3.1 - time * 0.45 + 1.3),',
    '                   sin(q.x * 4.3 - time * 0.6) + sin(q.y * 3.7 + time * 0.5 + 2.1)) * 0.5;',
    '  vec2 suv = uv + flow * ripple * vec2(1.0 / aspect, 1.0);',
    '  float d = mix(level(texture(dA, suv).rgb, melt), level(texture(dB, suv).rgb, melt), cross) - swell;',
    '  float w = fwidth(d) * 0.75 + 1e-5;',
    '  float a = 1.0 - smoothstep(-w, w, d);',
    '  o = vec4(color * a, a);',
    '}'
  ].join('\n');

  // all GL objects are (re)created here, so the logo can come back after a lost WebGL context
  var prog, U, texs = [];
  function initGL(){
    function sh(type, src){ var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    U = {}; ['dA','dB','cross','melt','swell','ripple','time','aspect','color'].forEach(function(k){ U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1i(U.dA, 0); gl.uniform1i(U.dB, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    texs = [0,1,2].map(function(){ var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; });
  }
  initGL();

  function upload(i, f){ gl.bindTexture(gl.TEXTURE_2D, texs[i]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, f.w, f.h, 0, gl.RGBA, gl.FLOAT, f.data); }
  // morph step from word a to word b: bind their fields to units 0 / 1
  function pair(a, b){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texs[a]); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texs[b]); }

  // ---------- distance fields (run in a worker) ----------
  // exact euclidean distance transform (Felzenszwalb)
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
  // separable box blur, 3 passes ~ gaussian
  function blur(src, W, H, r){
    var a = Float32Array.from(src), b = new Float32Array(W*H);
    if (r < 1) return a;
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
    return a;
  }
  // px: RGBA rasterized at 2x the field size. Returns RGBA float field (sharp, soft, blob, 0) in logo heights.
  function field(px, W2, H2, softR, blobR){
    var N = W2*H2, inG = new Float64Array(N), outG = new Float64Array(N), i;
    for (i = 0; i < N; i++){ var on = px[i*4+3] > 127; outG[i] = on ? 0 : 1e20; inG[i] = on ? 1e20 : 0; }
    edt(outG, W2, H2); edt(inG, W2, H2);
    var W = W2 >> 1, H = H2 >> 1, D = new Float32Array(W*H), x, y;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++){ // 2x2 average, back to field pixels
      var s = 0;
      for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 2; dx++){ var j = (y*2+dy)*W2 + x*2+dx; s += Math.sqrt(outG[j]) - Math.sqrt(inG[j]) - 0.5 * (outG[j] > 0 ? 1 : -1); }
      D[y*W+x] = s / 8 / H;    // /4 average, /2 back to field px, /H -> logo heights
    }
    var S = blur(D, W, H, Math.round(softR * H)), B = blur(D, W, H, Math.round(blobR * H));
    var out = new Float32Array(W*H*4);
    for (i = 0; i < W*H; i++){ out[i*4] = D[i]; out[i*4+1] = S[i]; out[i*4+2] = B[i]; }
    return { w: W, h: H, data: out };
  }

  var workerURL = null;
  try { workerURL = URL.createObjectURL(new Blob([edt1.toString(), edt.toString(), blur.toString(), field.toString(),
    'onmessage=function(e){var d=e.data,o=field(d.px,d.W,d.H,d.s,d.b);postMessage(o,[o.data.buffer]);};'], { type: 'text/javascript' })); } catch (e) {}
  function fieldAsync(px, w, h){
    return new Promise(function(res){
      var wk = null; try { wk = workerURL && new Worker(workerURL); } catch (e) {}
      if (!wk) return res(field(px, w, h, SOFT_R, BLOB_R));
      wk.onmessage = function(e){ wk.terminate(); res(e.data); };
      wk.onerror = function(){ wk.terminate(); res(field(px, w, h, SOFT_R, BLOB_R)); };
      wk.postMessage({ px: px, W: w, H: h, s: SOFT_R, b: BLOB_R }, [px.buffer]);
    });
  }

  var svgs = null, W = 0, H = 0;
  var staticImg = stage.querySelector('.logo-static'); if (staticImg) staticImg.style.visibility = 'hidden'; // no h2w2 before 'have'
  function rasterize(svgText, cw, ch){
    return new Promise(function(res, rej){
      var m = svgText.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number), lw = m[2], lh = m[3];
      var img = new Image();
      img.onload = function(){
        var c = document.createElement('canvas'); c.width = cw; c.height = ch;
        var x = c.getContext('2d'), k = Math.min(cw / VB.w, ch / VB.h);
        x.drawImage(img, (cw - lw * k) / 2, (ch - lh * k) / 2, lw * k, lh * k);
        res(x.getImageData(0, 0, cw, ch));
      };
      img.onerror = rej;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    });
  }

  var ready = false, cross = 0, melt = 0, seg = 0;
  function fgColor(){ var c = getComputedStyle(stage).color.match(/\d+(\.\d+)?/g) || [17,17,17]; return [c[0]/255, c[1]/255, c[2]/255]; }

  function build(){
    var rect = stage.getBoundingClientRect(), dpr = Math.min((window.devicePixelRatio || 1) * RES, 3);
    W = Math.max(2, Math.round(rect.width * dpr)); H = Math.max(2, Math.round(rect.height * dpr));
    canvas.width = W; canvas.height = H; gl.viewport(0, 0, W, H); gl.uniform1f(U.aspect, W / H);
    var fw = Math.max(16, Math.round(rect.width * SDF_SCALE)) * 2, fh = Math.max(8, Math.round(rect.height * SDF_SCALE)) * 2;
    return Promise.all(svgs.map(function(t){ return rasterize(t, fw, fh).then(function(r){ return fieldAsync(new Uint8ClampedArray(r.data), fw, fh); }); }))
      .then(function(fs){
        fs.forEach(function(f, i){ upload(i, f); }); pair(seg % 3, (seg + 1) % 3);
        ready = true; draw(performance.now()); stage.classList.add('gl'); if (staticImg) staticImg.style.visibility = 'hidden';
      });
  }

  var t0 = performance.now();
  function draw(now){
    if (!ready) return;
    var bump = Math.sin(Math.PI * Math.min(1, Math.max(0, melt)));
    gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(U.cross, cross); gl.uniform1f(U.melt, MELT * bump);
    gl.uniform1f(U.swell, SWELL * bump); gl.uniform1f(U.ripple, RIPPLE * bump);
    gl.uniform1f(U.time, ((now - t0) / 1000) % 600); gl.uniform3fv(U.color, fgColor());
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // p (0..1 within a step) -> melt progress and shape cross-over.
  // The step slows near each word (WANT); the shape swap happens in the middle, while the ink is most liquid.
  function ease(p){
    var m = WANT, TAU = 2 * Math.PI;
    return (m * p + (1 - m) * (p / 2 - Math.sin(TAU * p) / (2 * TAU))) / (m + (1 - m) / 2);
  }
  function crossOf(m){ var t = Math.min(1, Math.max(0, (m - 0.2) / 0.6)); return t * t * (3 - 2 * t); }
  function setStep(k, p){
    if (k !== seg) { seg = k; pair(k % 3, (k + 1) % 3); }
    var m = ease(p); melt = m; cross = crossOf(m);
    return m;
  }

  function runSequence(){
    setTimeout(function(){
      var start = performance.now(), shownWord = -1, shownLit = false;
      (function tick(now){
        var e = now - start, k = Math.floor(e / MORPH), p = (e - k * MORPH) / MORPH;
        setStep(k, p);
        var w = cross < .5 ? k % 3 : (k + 1) % 3;
        if (w !== shownWord) { shownWord = w; document.dispatchEvent(new CustomEvent('h2w2:word', { detail: w })); }
        // tent light: switches on as have starts turning into want, fades out as the loop settles back on have
        var step = k % 3, lit = shownLit;
        if (step === 0 && p >= TENT_ON) lit = true; else if (step === 2 && p >= TENT_OFF) lit = false;
        if (lit !== shownLit) { shownLit = lit; document.dispatchEvent(new CustomEvent('h2w2:tent', { detail: lit })); }
        if (gl.isContextLost()) { if (ready) fallback(); }
        else if (onScreen) draw(now);
        requestAnimationFrame(tick);
      })(start);
    }, HOLD_FIRST);
  }
  function whenIntroGone(cb){
    if (!document.body.classList.contains('intro-on')) return cb();
    var mo = new MutationObserver(function(){ if (!document.body.classList.contains('intro-on')) { mo.disconnect(); setTimeout(cb, 0); } });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  // WebGL can be dropped by the browser (GPU reset, memory pressure, long time in the background).
  // Show the static SVG meanwhile and rebuild the animation when the context comes back.
  function fallback(){ document.dispatchEvent(new CustomEvent('h2w2:static')); ready = false; stage.classList.remove('gl'); if (staticImg) staticImg.style.visibility = ''; }
  canvas.addEventListener('webglcontextlost', function(e){ e.preventDefault(); fallback(); });
  canvas.addEventListener('webglcontextrestored', function(){ initGL(); if (svgs) build().catch(fallback); });
  // don't render while the logo is scrolled out of view
  var onScreen = true;
  if ('IntersectionObserver' in window) new IntersectionObserver(function(es){ onScreen = es[0].isIntersecting; }).observe(stage);
  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(function(){ if (svgs && !gl.isContextLost()) build().catch(fallback); }, 150); });
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', function(){ draw(performance.now()); }) : mq.addListener(function(){ draw(performance.now()); })); }

  // ?logotest : no loop, frames are driven from the console (for checking the morph frame by frame)
  var TEST = /[?&]logotest\b/.test(location.search);
  Promise.all(SRC.map(function(u){ return fetch(u).then(function(r){ return r.text(); }); }))
    .then(function(t){ svgs = t; return build(); })
    .then(function(){
      if (TEST) { window.__logo = { frame: function(k, p){ setStep(k, p); draw(performance.now()); } }; return; }
      whenIntroGone(runSequence);
    })
    .catch(function(){ fallback(); /* keep static logo */ });
})();
