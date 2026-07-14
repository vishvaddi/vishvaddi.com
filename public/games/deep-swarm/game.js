
// =====================================================================
// DEEP SWARM — Vampire Survivors × Deep Sea Horror
// Single-file game. Canvas 2D. No dependencies.
// =====================================================================

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const PI2 = Math.PI * 2;
const keys = {};

// HUD TEXT SCALE — intercept every ctx.font assignment and scale the px size.
// One knob (pause menu) instead of two hundred font-string edits.
let UI_SCALE = 1.15;   // readable default (Vish: "text is still kinda small"); [T] in pause still adjusts
{
    const fontDesc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font');
    Object.defineProperty(ctx, 'font', {
        set(v) { fontDesc.set.call(this, UI_SCALE === 1 ? v : v.replace(/(\d+(?:\.\d+)?)px/, (m, n) => (parseFloat(n) * UI_SCALE).toFixed(1) + 'px')); },
        get() { return fontDesc.get.call(this); },
    });
}
// Backplate behind any text drawn over the world — readability over the dark
function drawPlate(x, y, pw, ph, alpha) {
    ctx.fillStyle = `rgba(2,8,14,${alpha != null ? alpha : ((typeof meta !== 'undefined' && meta.hudContrast) ? 0.85 : 0.62)})`;
    ctx.beginPath(); ctx.roundRect(x, y, pw, ph, 6); ctx.fill();
}

// =====================================================================
// POST-FX — WebGL fullscreen pass over the 2D scene: soft bloom, chromatic
// aberration, depth colour-grade, vignette, grain, scanlines, and a
// corruption-driven warp. A GL canvas overlays #c (the 2D buffer is the
// source texture). HARD FALLBACK: if WebGL fails it strips itself and the
// raw 2D game shows, unaffected. Toggle with [O].
// =====================================================================
let POSTFX = { on: false, gl: null, prog: null, tex: null, canvas: null, loc: {} };
function initPostFX() {
    // Phones: the shader pass + full-screen CRT overdraw are the lag — skip both
    if (isTouchDevice && Math.min(screen.width, screen.height) < 620) return;
    try {
        const gc = document.createElement('canvas');
        gc.id = 'gl';
        gc.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;';
        document.body.appendChild(gc);
        const gl = gc.getContext('webgl', { antialias: false, premultipliedAlpha: false }) || gc.getContext('experimental-webgl');
        if (!gl) throw new Error('no webgl');
        const vs = 'attribute vec2 p; varying vec2 uv; void main(){ uv=(p+1.0)*0.5; uv.y=1.0-uv.y; gl_Position=vec4(p,0.0,1.0); }';
        const fs = [
            'precision mediump float;',
            'varying vec2 uv; uniform sampler2D tex; uniform vec2 res;',
            'uniform float time; uniform float depth; uniform float corrupt;',
            'float hash(vec2 q){ return fract(sin(dot(q, vec2(41.3,289.1)))*43758.5453); }',
            'vec3 samp(vec2 c){ return texture2D(tex, c).rgb; }',
            'void main(){',
            '  vec2 c = uv;',
            // The water breathes, barely — a whisper of sway at baseline, and the
            // warp belongs to corruption (tuned 12/07: "barely noticeable until
            // corruption gets worse").
            '  float warp = 0.0004 + corrupt*0.0065;',   // MIND is the only dial
            '  c.x += sin(uv.y*6.0 + time*0.45)*0.0004 + sin(uv.y*40.0 + time*1.3)*warp;',
            '  c.y += cos(uv.x*5.0 + time*0.38)*0.0003 + cos(uv.x*36.0 + time*1.1)*warp*0.6;',
            '  vec2 dir = uv - 0.5;',
            '  float ca = (0.0015 + corrupt*0.006) * (0.3 + dot(dir,dir)*2.5);',
            '  vec3 col; col.r = samp(c + dir*ca).r; col.g = samp(c).g; col.b = samp(c - dir*ca).b;',
            '  vec3 bloom = vec3(0.0); vec2 px = 1.0/res;',
            '  for(int i=-1;i<=1;i++){ for(int j=-1;j<=1;j++){',
            '    bloom += max(samp(c + vec2(float(i),float(j))*px*3.0) - 0.55, 0.0);',
            '  }}',
            '  col += (bloom/9.0) * (1.5 + corrupt*0.6);',
            '  vec3 deepTint = mix(vec3(1.05,1.02,1.0), vec3(0.72,0.80,1.15), depth);',
            '  col *= deepTint;',
            '  float vig = smoothstep(1.15, 0.35, length(dir)*1.3);',
            '  col *= mix(1.0, vig, 0.5 + depth*0.25);',
            '  col *= 1.0 - 0.05*sin(uv.y*res.y*1.5);',
            '  col += (hash(uv*res + time) - 0.5) * (0.035 + corrupt*0.05);',
            '  gl_FragColor = vec4(col, 1.0);',
            '}'
        ].join('\n');
        function sh(t, src) { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const pl = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(pl);
        gl.vertexAttribPointer(pl, 2, gl.FLOAT, false, 0, 0);
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        POSTFX = { on: true, gl, prog, tex, canvas: gc, loc: {
            tex: gl.getUniformLocation(prog, 'tex'), res: gl.getUniformLocation(prog, 'res'),
            time: gl.getUniformLocation(prog, 'time'), depth: gl.getUniformLocation(prog, 'depth'),
            corrupt: gl.getUniformLocation(prog, 'corrupt'),
        }};
    } catch (err) {
        console.warn('PostFX disabled:', err && err.message);
        POSTFX.on = false;
        if (POSTFX.canvas) { try { POSTFX.canvas.remove(); } catch (e) {} POSTFX.canvas = null; }
    }
}
function postFX(ts) {
    if (!POSTFX.on || !POSTFX.gl) return;
    try {
        const gl = POSTFX.gl, gc = POSTFX.canvas;
        if (gc.width !== canvas.width || gc.height !== canvas.height) { gc.width = canvas.width; gc.height = canvas.height; }
        gl.viewport(0, 0, gc.width, gc.height);
        gl.bindTexture(gl.TEXTURE_2D, POSTFX.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.useProgram(POSTFX.prog);
        gl.uniform1i(POSTFX.loc.tex, 0);
        gl.uniform2f(POSTFX.loc.res, gc.width, gc.height);
        gl.uniform1f(POSTFX.loc.time, (ts || 0) / 1000);
        gl.uniform1f(POSTFX.loc.depth, (game && game.depth) ? Math.min(1, game.depth / 5000) : 0.0);
        gl.uniform1f(POSTFX.loc.corrupt, (game && game.player) ? Math.min(1, (game.player.corruption || 0) / 100) : 0.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch (err) {
        console.warn('PostFX runtime error, disabling:', err && err.message);
        POSTFX.on = false;
        if (POSTFX.canvas) { try { POSTFX.canvas.style.display = 'none'; } catch (e) {} }
    }
}

// =====================================================================
// DEPTH COLOR SYSTEM — Subnautica-style zone palette
// Everything shifts smoothly: HUD, viewport, particles, mood
// =====================================================================
// On Pelagos-3 the zones are named for what was built there, not what lives there.
const P3_ZONE_NAMES = { SUNLIGHT: 'FLOODLIGHT SHELF', TWILIGHT: 'TURBINE FIELD', MIDNIGHT: 'FOUNDRY DEEP', ABYSSAL: 'REACTOR SHADOW', 'RED LAYER': 'REACTOR SHADOW', HADAL: 'THE SCAR' };
function getDepthPalette(depth) {
    const pal = getDepthPaletteBase(depth);
    if (typeof game !== 'undefined' && game && game.moon === 'p3' && P3_ZONE_NAMES[pal.zone]) {
        return { ...pal, zone: P3_ZONE_NAMES[pal.zone] };
    }
    return pal;
}
function getDepthPaletteBase(depth) {
    // Returns { accent, accentDim, bg, text, textDim, zone, glow }
    // Sunlight (0-200): warm gold/teal. Twilight (200-1000): cool blue.
    // Midnight (1000-2000): deep indigo. Abyssal (2000-4000): violet-black.
    // Hadal (4000+): desaturated bone white on black.
    const t = Math.min(1, depth / 6000);
    if (depth < 200) {
        const p = depth / 200;
        return {
            accent: lerpColor('#D4AA40', '#40CCAA', p),   // gold → teal
            accentDim: lerpColor('#8A7A30', '#2A8A7A', p),
            bg: lerpColor('#0A0804', '#040A0A', p),
            text: lerpColor('#E8D8A0', '#A0DDD0', p),
            textDim: lerpColor('#8A7A50', '#5A9A8A', p),
            zone: 'SUNLIGHT', glow: lerpColor('#D4AA40', '#40CCAA', p),
        };
    }
    if (depth < 1000) {
        const p = (depth - 200) / 800;
        return {
            accent: lerpColor('#40CCAA', '#4A6ADA', p),   // teal → blue
            accentDim: lerpColor('#2A8A7A', '#3A4A8A', p),
            bg: lerpColor('#040A0A', '#030408', p),
            text: lerpColor('#A0DDD0', '#8AAADD', p),
            textDim: lerpColor('#5A9A8A', '#4A6A8A', p),
            zone: 'TWILIGHT', glow: lerpColor('#40CCAA', '#4A6ADA', p),
        };
    }
    if (depth < 2000) {
        const p = (depth - 1000) / 1000;
        return {
            accent: lerpColor('#4A6ADA', '#8A4ABA', p),   // blue → purple
            accentDim: lerpColor('#3A4A8A', '#5A3A7A', p),
            bg: lerpColor('#030408', '#040208', p),
            text: lerpColor('#8AAADD', '#AA8ACC', p),
            textDim: lerpColor('#4A6A8A', '#6A4A7A', p),
            zone: 'MIDNIGHT', glow: lerpColor('#4A6ADA', '#8A4ABA', p),
        };
    }
    if (depth < 3500) {
        const p = (depth - 2000) / 1500;
        return {
            accent: lerpColor('#8A4ABA', '#DA3050', p),   // purple → crimson
            accentDim: lerpColor('#5A3A7A', '#8A2040', p),
            bg: lerpColor('#040208', '#030102', p),
            text: lerpColor('#AA8ACC', '#CC6A7A', p),
            textDim: lerpColor('#6A4A7A', '#7A3A4A', p),
            zone: 'ABYSSAL', glow: lerpColor('#8A4ABA', '#DA3050', p),
        };
    }
    // Red Layer: hemobrine — iron-rich biological fluid. Lights illuminate tissue, not water.
    if (depth < 4500) {
        const p = (depth - 3500) / 1000;
        return {
            accent: lerpColor('#DA3050', '#FF6080', p),
            accentDim: lerpColor('#8A2040', '#A82050', p),
            bg: lerpColor('#040102', '#080102', p),
            text: lerpColor('#CC6A7A', '#FF9090', p),
            textDim: lerpColor('#7A3A4A', '#8A4050', p),
            zone: 'RED LAYER', glow: lerpColor('#DA3050', '#FF6080', p),
        };
    }
    // Hadal: desaturated, bone white on void
    const p = Math.min(1, (depth - 4500) / 2000);
    return {
        accent: lerpColor('#DA3050', '#CCBBAA', p),    // crimson → bone
        accentDim: lerpColor('#8A2040', '#7A7060', p),
        bg: '#010101',
        text: lerpColor('#CC6A7A', '#CCBBAA', p),
        textDim: lerpColor('#7A3A4A', '#6A6050', p),
        zone: 'HADAL', glow: lerpColor('#DA3050', '#CCBBAA', p),
    };
}

function lerpColor(hex1, hex2, t) {
    const r1 = parseInt(hex1.slice(1,3),16), g1 = parseInt(hex1.slice(3,5),16), b1 = parseInt(hex1.slice(5,7),16);
    const r2 = parseInt(hex2.slice(1,3),16), g2 = parseInt(hex2.slice(3,5),16), b2 = parseInt(hex2.slice(5,7),16);
    const r = Math.floor(r1 + (r2-r1)*t), g = Math.floor(g1 + (g2-g1)*t), b = Math.floor(b1 + (b2-b1)*t);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

// Hex color to rgba string helper (avoids 8-char hex compat issues)
function hexA(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16) || 0;
    const g = parseInt(hex.slice(3,5), 16) || 0;
    const b = parseInt(hex.slice(5,7), 16) || 0;
    return `rgba(${r},${g},${b},${alpha})`;
}

// =====================================================================
// GLOW SPRITE CACHE — pre-rendered radial gradients keyed by color
// Eliminates per-frame createRadialGradient allocations (the main lag source)
// =====================================================================
const _glowCache = {};
const GLOW_SPRITE_SIZE = 128;
function getGlowSprite(color) {
    if (_glowCache[color]) return _glowCache[color];
    const c = document.createElement('canvas');
    c.width = c.height = GLOW_SPRITE_SIZE;
    const gctx = c.getContext('2d');
    const r = GLOW_SPRITE_SIZE / 2;
    const grad = gctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0,    hexA(color, 1));
    grad.addColorStop(0.4,  hexA(color, 0.35));
    grad.addColorStop(1,    hexA(color, 0));
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, GLOW_SPRITE_SIZE, GLOW_SPRITE_SIZE);
    _glowCache[color] = c;
    return c;
}
// Draw a glow at (x,y) with given radius and alpha — way cheaper than allocating gradients
function drawGlow(ctx2, color, x, y, radius, alpha) {
    if (alpha <= 0 || radius <= 0) return;
    const sprite = getGlowSprite(color);
    const prevA = ctx2.globalAlpha;
    ctx2.globalAlpha = prevA * Math.min(1, alpha);
    ctx2.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
    ctx2.globalAlpha = prevA;
}

// =====================================================================
// AUDIO ENGINE — Underwater ambient music + SFX
// Future nostalgia: reverb-heavy, synth pads, filtered through water
// =====================================================================
let audioCtx = null;
let masterGain = null, reverbNode = null, underwaterFilter = null;

// Feature 1: Apply volume to masterGain
function applyVolume() {
    if (masterGain) masterGain.gain.value = meta.muted ? 0 : meta.volume;
}

function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = meta.muted ? 0 : meta.volume;
    // Underwater lowpass filter on EVERYTHING
    underwaterFilter = audioCtx.createBiquadFilter();
    underwaterFilter.type = 'lowpass';
    underwaterFilter.frequency.value = 2000;
    underwaterFilter.Q.value = 1;
    // Short reverb — just enough for underwater feel, not cathedral
    reverbNode = audioCtx.createConvolver();
    const rate = audioCtx.sampleRate;
    const length = rate * 0.8; // SHORT — 0.8s not 2.5s
    const impulse = audioCtx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 4); // steeper falloff
        }
    }
    reverbNode.buffer = impulse;
    // Dry path: source -> underwaterFilter -> masterGain -> destination (LOUD)
    underwaterFilter.connect(masterGain);
    masterGain.connect(audioCtx.destination);
    // Master glue: soft-knee compressor so stacked layers + one-shots never clip
    const comp = audioCtx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    masterGain.disconnect();
    masterGain.connect(comp); comp.connect(audioCtx.destination);
    // Split buses: independent music/sfx volume, both through the water
    sfxBus = audioCtx.createGain(); sfxBus.gain.value = meta.sfxVol != null ? meta.sfxVol : 1;
    sfxBus.connect(underwaterFilter);
    musicBus = audioCtx.createGain(); musicBus.gain.value = meta.musicVol != null ? meta.musicVol : 0.7;
    musicBus.connect(underwaterFilter);
    // Wet path: source -> underwaterFilter -> reverbNode -> wetGain -> destination (QUIET)
    const wetGain = audioCtx.createGain();
    wetGain.gain.value = 0.2;  // deeper wet mix — the room is an ocean
    underwaterFilter.connect(reverbNode);
    reverbNode.connect(wetGain);
    wetGain.connect(audioCtx.destination);
    applyVolume(); // Feature 1: apply saved volume on init
    // Warm the one-shot cache so the first ping/dash isn't silent
    for (const k of ['ping', 'dash', 'torpedo', 'explode', 'ui', 'impact', 'clank']) {
        if (SFX_SAMPLES[k]) musicBuffer(SFX_SAMPLES[k]);
    }
}

function playTone(freq, dur, type = 'sine', vol = 0.15) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq * (0.96 + Math.random() * 0.08);
    g.gain.setValueAtTime(vol * (0.92 + Math.random() * 0.16), audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(sfxBus || underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur + 0.1);
}

// Helper: noise burst (underwater thud/crunch)
function noiseBurst(dur, vol, cutoff) {
    if (!audioCtx) return;
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    const n = audioCtx.createBufferSource(); n.buffer = buf;
    const ng = audioCtx.createGain(); ng.gain.value = vol;
    const nf = audioCtx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = cutoff || 500;
    n.connect(nf); nf.connect(ng); ng.connect(sfxBus || underwaterFilter || audioCtx.destination);
    n.start();
}

// =====================================================================
// WATER VOLUMES — currents you ride or fight, rips that pull toward
// danger-paired reward, thermoclines that bend senses, sediment
// concealment, and dark-only crystal blooms. The water fights back.
// =====================================================================
// Biome pockets: a themed cluster seeded near (not on) the player. The zone
// stops being a uniform soup — there are PLACES now, and places have prices.
const BIOME_DEFS = {
    kelp_forest:    { zones: ['sunlight', 'twilight'], line: 'Kelp stand ahead. Cover for you. Cover for other things.' },
    vent_field:     { zones: ['midnight', 'abyssal'],  line: 'Hydrothermal field. Mind the plumes — the water itself burns there.' },
    graveyard:      { zones: ['twilight', 'midnight', 'abyssal'], line: 'Multiple wrecks on sonar. A bad place for ships. Good salvage.' },
    brine_pool:     { zones: ['abyssal', 'hadal'],     line: 'Brine pool — hypersaline. Do not linger in it. Things crystallise at its edge.' },
    crystal_cavern: { zones: ['midnight', 'abyssal', 'hadal'], line: 'Crystal formation. Kill the lights and watch what opens.' },
};
function spawnBiomePocket(g, p) {
    const zone = musicSlot();
    const valid = Object.keys(BIOME_DEFS).filter(k => BIOME_DEFS[k].zones.includes(zone));
    if (!valid.length) return;
    const kind = valid[Math.floor(Math.random() * valid.length)];
    const a = Math.random() * PI2;
    const cx = p.x + Math.cos(a) * 700, cy = p.y + Math.sin(a) * 700;
    const push = (obKind, n, spread) => {
        for (let i = 0; i < n; i++) {
            g.obstacles.push({ kind: obKind, x: cx + (Math.random() - 0.5) * spread, y: cy + (Math.random() - 0.5) * spread,
                r: 24 + Math.random() * 26, seed: Math.random() * 100, obDepth: g.depth });
        }
    };
    if (kind === 'kelp_forest') { push('kelp', 10, 520); }
    else if (kind === 'vent_field') { push('vent', 4, 420); push('crystal', 2, 480); }
    else if (kind === 'graveyard') {
        push('bones', 4, 500);
        for (let i = 0; i < 2; i++) g.wrecks.push({ x: cx + (Math.random() - 0.5) * 400, y: cy + (Math.random() - 0.5) * 400, r: 36, loot: pickWreckLoot(), revealed: false, salvaged: false, seed: Math.random() * 100, spawnedAt: g.runTime });
    }
    else if (kind === 'brine_pool') {
        g.volumes.push({ kind: 'brine', x: cx, y: cy, w: 380, h: 240, life: 120 });
        for (let i = 0; i < 2; i++) g.volumes.push({ kind: 'bloom', x: cx + (Math.random() - 0.5) * 500, y: cy + (Math.random() - 0.5) * 350, w: 60, h: 60, life: 90, closedT: 0 });
    }
    else if (kind === 'crystal_cavern') {
        push('crystal', 7, 520);
        g.volumes.push({ kind: 'bloom', x: cx, y: cy, w: 60, h: 60, life: 90, closedT: 0 });
    }
    addNereidLog(g, BIOME_DEFS[kind].line);
    g._lastBiomeAt = g.runTime;
}

function updateVolumes(g, dt, p) {
    if (!g.volumes) g.volumes = [];
    g._volT = (g._volT || 0) + dt;
    const B = g.worldBounds;
    const rnd = Math.random;
    if (g._volT > 6) {
        g._volT = 0;
        // A themed pocket roughly every 45s past the shallows
        if (g.depth > 250 && g.runTime - (g._lastBiomeAt || 0) > 45 && Math.random() < 0.5) spawnBiomePocket(g, p);
        const currents = g.volumes.filter(v => v.kind === 'current').length;
        const thermos = g.volumes.filter(v => v.kind === 'thermo').length;
        const blooms = g.volumes.filter(v => v.kind === 'bloom').length;
        if (currents < 2 && rnd() < 0.5) {
            g.volumes.push({ kind: 'current', x: B.minX + rnd() * (B.maxX - B.minX), y: B.minY + rnd() * (B.maxY - B.minY),
                w: 900 + rnd() * 500, h: 140 + rnd() * 80, fx: (rnd() < 0.5 ? -1 : 1) * (70 + rnd() * 50), life: 35 + rnd() * 20 });
        }
        if (thermos < 1 && g.depth > 300 && rnd() < 0.4) {
            g.volumes.push({ kind: 'thermo', x: 0, y: B.minY + rnd() * (B.maxY - B.minY),
                w: B.maxX - B.minX + 400, h: 90, fx: 0, life: 45 + rnd() * 25 });
        }
        if (g.depth > 400 && rnd() < 0.22) {
            // Rip: hard pull along its axis; the far end gets a bonus wreck —
            // danger-paired reward. Riding the danger IS the strategy.
            const rx = B.minX + 300 + rnd() * (B.maxX - B.minX - 600);
            const ry = B.minY + 200 + rnd() * (B.maxY - B.minY - 400);
            const dir = rnd() < 0.5 ? -1 : 1;
            g.volumes.push({ kind: 'rip', x: rx, y: ry, w: 260, h: 620, fy: dir * 220, life: 24 });
            const goodLoot = WRECK_LOOT_TABLE.filter(l => l.id === 'weapon_lv' || l.id === 'heal');
            if (goodLoot.length) g.wrecks.push({ x: rx, y: ry + dir * 340, r: 34, loot: goodLoot[Math.floor(rnd() * goodLoot.length)], revealed: false, salvaged: false, seed: rnd() * 100, spawnedAt: g.runTime, ripBorn: true });
        }
        // ORE FALL — a rock sheds off the trench wall above and sinks past.
        // The seam GLINTS in its ore colour. Dash through it to crack it open.
        if (g.depth > 150 && (g.fallers || []).length < 2 && rnd() < 0.35) {
            const ORES = [['crystal', '#B080FF'], ['scrap', '#C0A060'], ['wiring', '#60C0E0'], ['corepl', '#FF8060']];
            const pick = ORES[Math.floor(rnd() * ORES.length)];
            if (!g.fallers) g.fallers = [];
            g.fallers.push({ x: p.x + (rnd() - 0.5) * 1300, y: p.y - 650, vy: 42 + rnd() * 34, vx: (rnd() - 0.5) * 14,
                r: 15 + rnd() * 13, ore: pick[0], col: pick[1], seed: rnd() * 100, ang: 0, spin: (rnd() - 0.5) * 0.7 });
            maybeHint(g, 'orefall', 'ORE FALL on sonar — DASH through the glinting rock to crack the seam.');
        }
        if (blooms < 2 && g.depth > 1000 && rnd() < 0.35) {
            g.volumes.push({ kind: 'bloom', x: B.minX + 150 + rnd() * (B.maxX - B.minX - 300), y: B.minY + 150 + rnd() * (B.maxY - B.minY - 300),
                w: 60, h: 60, life: 50, closedT: 0 });
        }
    }
    if (g._charted) { for (const wk of g.wrecks) wk.revealed = true; }
    // Ore falls: sink, spin, crack under a dash
    if (g.fallers) {
        for (let i = g.fallers.length - 1; i >= 0; i--) {
            const f = g.fallers[i];
            f.y += f.vy * dt; f.x += f.vx * dt; f.ang += f.spin * dt;
            if (f.y > p.y + 900) { g.fallers.splice(i, 1); continue; }
            const d = dist(p, f);
            if (d < f.r + 16) {
                if (p.dashTimer > 0) {
                    const amt = 1 + (f.r > 22 ? 1 : 0);
                    addMaterials({ [f.ore]: amt });
                    saveMeta();
                    for (let gI = 0; gI < 3; gI++) g.gems.push({ x: f.x + (Math.random() - 0.5) * 40, y: f.y + (Math.random() - 0.5) * 40, value: 4, size: 4, life: 14, dropDepth: g.depth });
                    g.floatingTexts.push({ x: f.x, y: f.y - 18, text: `+${amt} ${f.ore.toUpperCase()}`, color: f.col, life: 1.8, vy: -26 });
                    playSample('clank', 0.4, 1.1); playTone(950, 0.3, 'sine', 0.09);
                    g.shake = Math.max(g.shake || 0, 3);
                    g.fallers.splice(i, 1);
                } else {
                    // Nudged aside — it takes a dash to break rock
                    const a = Math.atan2(p.y - f.y, p.x - f.x);
                    p.x += Math.cos(a) * (f.r + 16 - d); p.y += Math.sin(a) * (f.r + 16 - d);
                }
            }
        }
    }
    g._inThermo = false; g._inSediment = false; g._inCurrent = false;
    for (let i = g.volumes.length - 1; i >= 0; i--) {
        const v = g.volumes[i];
        v.life -= dt;
        if (v.life <= 0) { g.volumes.splice(i, 1); continue; }
        const inside = Math.abs(p.x - v.x) < v.w / 2 && Math.abs(p.y - v.y) < v.h / 2;
        if (v.kind === 'current' && inside) { p.x += v.fx * dt; g._inCurrent = true; }
        if (v.kind === 'rip' && inside) { p.y += v.fy * dt; g.shake = Math.max(g.shake || 0, 1.5); }
        if (v.kind === 'thermo' && inside) g._inThermo = true;
        if (v.kind === 'brine' && inside && p.iFrames <= 0) {
            p.hp -= 4 * dt;
            if (!v._warned) { v._warned = true; g.floatingTexts.push({ x: p.x, y: p.y - 22, text: 'BRINE — CAUSTIC', color: '#B0FF80', life: 1.4, vy: -22 }); }
        }
        if (v.kind === 'sediment' && inside) g._inSediment = true;
        if (v.kind === 'current') {
            // Gems ride the flow — loot drifts downstream, chase it or lose it
            for (const gem of g.gems) {
                if (Math.abs(gem.x - v.x) < v.w / 2 && Math.abs(gem.y - v.y) < v.h / 2) gem.x += v.fx * dt * 0.6;
            }
        }
        if (v.kind === 'bloom') {
            if (v.closedT > 0) v.closedT -= dt;
            // Floodlights slam it shut; only the dark diver harvests
            if (g.lightOn !== false && dist(p, v) < 260) v.closedT = 6;
            if (v.closedT <= 0 && g.lightOn === false && dist(p, v) < 64) {
                meta.materials.crystal = (meta.materials.crystal || 0) + 2;
                saveMeta();
                g.floatingTexts.push({ x: v.x, y: v.y - 20, text: '+2 CRYSTAL (dark bloom)', color: '#B080FF', life: 1.8, vy: -26 });
                playTone(720, 0.4, 'sine', 0.1); playTone(1080, 0.5, 'sine', 0.07);
                g.volumes.splice(i, 1);
            }
        }
    }
}

function drawVolumes(g) {
    const t = g.runTime;
    // Ore falls — tumbling rock, seam glinting in its mineral colour
    if (g.fallers) {
        for (const f of g.fallers) {
            ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang);
            const fr = (k) => { const v = Math.sin((f.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
            ctx.fillStyle = '#3A3F45';
            ctx.beginPath();
            for (let i = 0; i < 7; i++) {
                const a = (i / 7) * PI2;
                const rr = f.r * (0.75 + fr(i) * 0.4);
                if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
            }
            ctx.closePath(); ctx.fill();
            ctx.strokeStyle = '#22262B'; ctx.lineWidth = 1.2; ctx.stroke();
            // The seam — jagged vein + a travelling glint you can SEE
            const glint = 0.45 + Math.sin(t * 4 + f.seed * 9) * 0.4;
            ctx.strokeStyle = f.col; ctx.globalAlpha = glint; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-f.r * 0.6, -f.r * 0.15);
            ctx.lineTo(-f.r * 0.15, f.r * 0.1); ctx.lineTo(f.r * 0.2, -f.r * 0.2); ctx.lineTo(f.r * 0.62, f.r * 0.08);
            ctx.stroke();
            ctx.globalAlpha = Math.min(1, glint + 0.2);
            drawGlow(ctx, f.col, 0, 0, f.r * 1.5, glint * 0.35);
            ctx.globalAlpha = 1;
            ctx.restore();
        }
    }
    if (!g.volumes) return;
    for (const v of g.volumes) {
        if (v.kind === 'current') {
            // Faint lane edges so the flow reads as a PLACE, not stray lines
            ctx.strokeStyle = 'rgba(120,190,220,0.06)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(v.x - v.w / 2, v.y - v.h / 2); ctx.lineTo(v.x + v.w / 2, v.y - v.h / 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(v.x - v.w / 2, v.y + v.h / 2); ctx.lineTo(v.x + v.w / 2, v.y + v.h / 2); ctx.stroke();
            ctx.strokeStyle = 'rgba(140,205,235,0.17)'; ctx.lineWidth = 1.2;
            for (let i = 0; i < 9; i++) {
                const ly = v.y - v.h / 2 + (i + 0.5) * (v.h / 9);
                const phase = ((t * v.fx * 0.6 + i * 137) % v.w + v.w) % v.w;
                const lx = v.x - v.w / 2 + phase;
                ctx.beginPath(); ctx.moveTo(lx - 30, ly); ctx.lineTo(lx + 30, ly); ctx.stroke();
            }
        } else if (v.kind === 'rip') {
            ctx.strokeStyle = 'rgba(160,220,255,0.13)'; ctx.lineWidth = 1.4;
            for (let i = 0; i < 5; i++) {
                const lx = v.x - v.w / 2 + (i + 0.5) * (v.w / 5);
                const phase = ((t * v.fy * 0.5 + i * 231) % v.h + v.h) % v.h;
                const ly = v.y - v.h / 2 + phase;
                ctx.beginPath(); ctx.moveTo(lx, ly - 34); ctx.lineTo(lx + Math.sin(t * 3 + i) * 6, ly + 34); ctx.stroke();
            }
        } else if (v.kind === 'thermo') {
            ctx.strokeStyle = 'rgba(140,200,230,0.07)'; ctx.lineWidth = 1;
            for (let i = 0; i < 3; i++) {
                const ly = v.y - 20 + i * 20 + Math.sin(t * 1.7 + i * 2) * 4;
                ctx.beginPath();
                for (let xx = v.x - v.w / 2; xx < v.x + v.w / 2; xx += 46) {
                    const yy = ly + Math.sin(xx * 0.02 + t * 2) * 3;
                    if (xx === v.x - v.w / 2) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
                }
                ctx.stroke();
            }
        } else if (v.kind === 'brine') {
            ctx.fillStyle = 'rgba(150,220,120,0.07)';
            ctx.beginPath(); ctx.ellipse(v.x, v.y, v.w / 2, v.h / 2, 0, 0, PI2); ctx.fill();
            ctx.strokeStyle = 'rgba(180,255,140,0.18)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.ellipse(v.x, v.y + Math.sin(t * 1.2) * 3, v.w / 2, v.h / 2, 0, 0, PI2); ctx.stroke();
        } else if (v.kind === 'sediment') {
            ctx.fillStyle = 'rgba(120,100,70,0.16)';
            for (let i = 0; i < 8; i++) {
                const a = i * 0.785 + t * 0.4;
                ctx.beginPath(); ctx.arc(v.x + Math.cos(a) * v.w * 0.28, v.y + Math.sin(a) * v.h * 0.28, 26 + Math.sin(t * 2 + i) * 6, 0, PI2); ctx.fill();
            }
        } else if (v.kind === 'bloom') {
            const open = v.closedT <= 0;
            const pulse = open ? 0.55 + Math.sin(t * 2.2) * 0.25 : 0.12;
            drawGlow(ctx, '#B080FF', v.x, v.y, open ? 36 : 14, pulse);
            ctx.fillStyle = open ? '#C9A0FF' : '#4A3A66';
            for (let i = 0; i < 5; i++) {
                const a = i * 1.257 + (open ? t * 0.5 : 0);
                const rr = open ? 13 : 6;
                ctx.beginPath(); ctx.arc(v.x + Math.cos(a) * rr, v.y + Math.sin(a) * rr, open ? 5 : 3, 0, PI2); ctx.fill();
            }
        }
    }
}

// =====================================================================
// MUSIC SYSTEM — zone-layered bed + beat, corruption-reactive.
// Files in music/*.ogg (sources + licences: music/README.md). Bed = drone
// ambience (Shapeforms Dystopia); beat = rhythmic layer (ESM loops /
// White Bat / Pixabay drop-ins). Missing files fail silent — the game
// never breaks because a track isn't there. [N] in pause auditions beat
// candidates for the current slot; the pick persists per slot.
// =====================================================================
let musicBus = null, sfxBus = null;
// Soundtrack: Purrple Cat via Pixabay (Vish's pick — Pixabay licence, no
// attribution required). Lo-fi leads; the Dystopia beds seep in underneath
// as the depth takes over. [N] in pause still auditions per-zone picks.
const MUSIC_ENABLED = true;
const MUSIC = {
    title:    { bed: null,               beats: ['pc_drifting'] },
    sunlight: { bed: null,               beats: ['pc_lowtide', 'pc_seashells'] },
    twilight: { bed: null,               beats: ['pc_heartocean', 'pc_discovery'] },
    midnight: { bed: 'bed_hold',         beats: ['pc_cavern', 'pc_darkforest'] },
    abyssal:  { bed: 'bed_heartbeat',    beats: ['pc_hide', 'pc_ghosttown'] },
    hadal:    { bed: 'bed_heartbeat',    beats: ['pc_stranded', 'pc_silentwood'] },
    p3:       { bed: 'bed_powerstation', beats: ['pc_mystic', 'pc_ghosttown'] },
};
const _musicBuf = {};
let _music = { slot: null, layers: [], switching: false };

function musicBuffer(name) {
    if (_musicBuf[name] !== undefined) return Promise.resolve(_musicBuf[name]);
    _musicBuf[name] = null;   // in-flight marker — parallel callers get null once, then the cache
    return fetch('music/' + name + '.ogg')
        .then(res => { if (!res.ok) throw 0; return res.arrayBuffer(); })
        .then(ab => audioCtx.decodeAudioData(ab))
        .then(buf => { _musicBuf[name] = buf; return buf; })
        .catch(() => { _musicBuf[name] = false; return false; });
}

function musicSlot() {
    if (phase === 'title' || phase === 'shop' || phase === 'workshop' || phase === 'modules' ||
        phase === 'contracts' || phase === 'codex' || phase === 'cards' || phase === 'mooring' ||
        phase === 'intro' || phase === 'tutorial' || phase === 'puzzle' || phase === 'patch') return 'title';
    if (!game || (phase !== 'playing' && phase !== 'paused' && phase !== 'levelup' && phase !== 'event' && phase !== 'gameover')) return null;
    if (game.moon === 'p3') return 'p3';
    const d = game.depth || 0;
    return d < 200 ? 'sunlight' : d < 1000 ? 'twilight' : d < 2000 ? 'midnight' : d < 4000 ? 'abyssal' : 'hadal';
}

function beatFor(slot) {
    const def = MUSIC[slot];
    if (!def || !def.beats.length) return null;
    const pick = (meta.beatPick && meta.beatPick[slot]) || 0;
    return def.beats[pick % def.beats.length];
}

async function startMusicSlot(slot) {
    if (!audioCtx || !musicBus || !MUSIC_ENABLED) return;
    _music.switching = true;
    const now = audioCtx.currentTime;
    for (const L of _music.layers) {
        try {
            L.gain.gain.cancelScheduledValues(now);
            L.gain.gain.setValueAtTime(L.gain.gain.value, now);
            L.gain.gain.linearRampToValueAtTime(0, now + 2.5);
            L.src.stop(now + 2.6);
        } catch (err) { /* already stopped */ }
    }
    _music.layers = [];
    _music.slot = slot;
    const def = MUSIC[slot];
    if (!def) { _music.switching = false; return; }
    const wanted = def.bed ? [{ name: def.bed, vol: 0.34, kind: 'bed' }] : [];
    const beat = beatFor(slot);
    if (beat) wanted.push({ name: beat, vol: 0.5, kind: 'beat' });
    for (const wtd of wanted) {
        const buf = await musicBuffer(wtd.name);
        if (!buf || _music.slot !== slot) continue;   // file missing, or zone moved on mid-decode
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const g = audioCtx.createGain(); g.gain.value = 0;
        let head = src, filter = null;
        if (wtd.kind === 'beat') {
            filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 9000;
            src.connect(filter); head = filter;
        }
        head.connect(g); g.connect(musicBus);
        const t = audioCtx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(wtd.vol, t + 3.5);
        src.start();
        _music.layers.push({ src, gain: g, filter, kind: wtd.kind, vol: wtd.vol, name: wtd.name });
    }
    _music.switching = false;
}

let _duckT = 0;
function duckMusic(sec = 1.4) { _duckT = Math.max(_duckT, sec); }

// Mode/status messages (silent, lights, zoom, track) — their OWN channel and
// look, never the zone-banner streak (playtest: fonts collided, top got clipped).
function setModeMsg(g, text, sec = 2) { g.modeMsg = text; g.modeMsgTimer = sec; }

let _lastCorrTier = 0, _lastGlitchAt = -999;
function updateMusic(dt) {
    if (!audioCtx || !musicBus || !MUSIC_ENABLED) return;
    const slot = musicSlot();
    if (slot && slot !== _music.slot && !_music.switching) startMusicSlot(slot);
    // Duck envelope (damage, boss arrivals) — recovers on its own
    const target = (meta.musicVol != null ? meta.musicVol : 0.7) * (_duckT > 0 ? 0.35 : 1);
    musicBus.gain.value += (target - musicBus.gain.value) * Math.min(1, dt * 5);
    if (_duckT > 0) _duckT -= dt;
    const corr = game && game.player ? (game.player.corruption || 0) : 0;
    // Depth darkens everything: the water filter closes in as you sink
    if (underwaterFilter) {
        const dd = game ? Math.min(1, (game.depth || 0) / 6000) : 0;
        underwaterFilter.frequency.value = 2000 - 1300 * dd;
    }
    // Corruption drags the beat under: slight detune, then 60→90 the beat
    // "drowns" (lowpass sweeps 9kHz→300Hz) leaving bed + heartbeat.
    for (const L of _music.layers) {
        if (L.kind !== 'beat') continue;
        try { L.src.playbackRate.value = 1 - Math.min(0.035, corr * 0.0004); } catch (err) { /* stopped */ }
        if (L.filter) {
            const clear = corr <= 60 ? 1 : Math.max(0, 1 - (corr - 60) / 30);
            L.filter.frequency.value = 300 + 8700 * clear;
        }
    }
    // Corruption glitch bursts — 60+ only, sparse and quiet (playtest: they
    // read as "glitchy soundtrack" when frequent/loud).
    const tier = corr >= 90 ? 3 : corr >= 75 ? 2 : corr >= 60 ? 1 : 0;
    const nowT = audioCtx.currentTime;
    if (tier > _lastCorrTier && nowT - _lastGlitchAt > 45) {
        playSample(tier >= 2 ? 'glitch2' : 'glitch1', 0.28);
        _lastGlitchAt = nowT;
    }
    _lastCorrTier = tier;
}

function nextBeatCandidate() {
    const slot = _music.slot;
    if (!slot || !MUSIC[slot] || MUSIC[slot].beats.length < 2) return null;
    meta.beatPick = meta.beatPick || {};
    meta.beatPick[slot] = ((meta.beatPick[slot] || 0) + 1) % MUSIC[slot].beats.length;
    saveMeta();
    startMusicSlot(slot);
    return beatFor(slot);
}

// --- Sampled SFX (pack one-shots; the procedural engine stays for the rest) ---
const SFX_SAMPLES = {
    glitch1: 'sfx_glitch1', glitch2: 'sfx_glitch2', ui: 'sfx_ui', impact: 'sfx_impact',
    stinger: 'sfx_stinger', tear: 'sfx_tear', salvage: 'sfx_salvage',
    clank: 'sfx_clank',
    ping: 'sfx_ping', torpedo: 'sfx_torpedo', explode: 'sfx_explode', implode: 'sfx_implode',
    dash: 'sfx_dash', levelup: 'sfx_levelup', growl1: 'sfx_growl1', growl2: 'sfx_growl2',
    killconfirm: 'sfx_killconfirm', harpoon: 'sfx_harpoon', zap: 'sfx_zap', alert: 'sfx_alert',
};
// Sample if it's decoded, procedural fallback while it loads (or if missing) —
// the sci-fi layer upgrades the mix without ever leaving silence.
function sampleOr(key, vol, rate, fallbackFn) {
    if (!audioCtx) return;
    const name = SFX_SAMPLES[key];
    const buf = name ? _musicBuf[name] : false;
    if (buf && buf !== true) { playSample(key, vol, rate); return; }
    if (name && buf === undefined) musicBuffer(name);   // warm for next time
    if (fallbackFn) fallbackFn();
}
function playSample(key, vol = 0.5, rate = 1) {
    if (!audioCtx || !SFX_SAMPLES[key]) return;
    musicBuffer(SFX_SAMPLES[key]).then(buf => {
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.playbackRate.value = rate;
        const g = audioCtx.createGain(); g.gain.value = vol;
        src.connect(g); g.connect(sfxBus || underwaterFilter);
        src.start();
    });
}

// --- INDIVIDUAL SOUNDS ---

// Gem collect: crisp underwater "tink" — throttled so big sweeps don't spawn dozens of oscillators
let _lastCollectAt = 0;
let _collectStreak = 0;
function sfxCollect() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (now - _lastCollectAt < 0.04) {
        _collectStreak++;
        // Skip — but bump pitch on the next allowed play so big sweeps still feel rewarding
        return;
    }
    const pitchBump = Math.min(8, _collectStreak) * 60;
    _collectStreak = 0;
    _lastCollectAt = now;
    playTone(900 + pitchBump, 0.05, 'sine', 0.1);
    setTimeout(() => playTone(1300 + pitchBump, 0.04, 'sine', 0.06), 20);
}

// Player hit: muffled hull impact — metallic thud + low crunch
function sfxHit() {
    playTone(55, 0.12, 'square', 0.1);
    noiseBurst(0.1, 0.08, 300);
}

// Level up: ascending chime — 4 quick notes, clean
function sfxLevelUp() {
    sampleOr('levelup', 0.42, 1, () => {
        [500, 650, 800, 1100].forEach((f, i) => setTimeout(() => playTone(f, 0.12, 'sine', 0.09), i * 50));
    });
}

// Death: hull breach — descending groan + metal stress + water rush
function sfxDeath() {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(25, audioCtx.currentTime + 2);
    g2.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2);
    o.connect(g2); g2.connect(underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 2);
    noiseBurst(1.5, 0.08, 200); // water rush
}

// Sonar ping: real submarine ping — sharp attack, clean decay, single tone
// Sonar ping — softer, lower, classic sub-ping warmth instead of piercing whistle
function sfxSonar() {
    if (!audioCtx) return;
    sampleOr('ping', 0.32, 0.96 + Math.random() * 0.08, _sfxSonarProc);
}
function _sfxSonarProc() {
    const o = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(620, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(280, audioCtx.currentTime + 0.55);
    g2.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.07, audioCtx.currentTime + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.7);
    o.connect(g2); g2.connect(underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.8);
}

// Tsunami — sweeping cinematic wave: low rumble + rising air pressure + crash tail
function sfxTsunami() {
    if (!audioCtx) return;
    // Low rumble bed
    const o = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(45, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(28, audioCtx.currentTime + 0.9);
    g2.gain.setValueAtTime(0.001, audioCtx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + 0.1);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.0);
    o.connect(g2); g2.connect(underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 1.1);
    // Rising whoosh — water displacement
    setTimeout(() => noiseBurst(0.45, 0.10, 600), 40);
    // Crash tail
    setTimeout(() => noiseBurst(0.30, 0.07, 1400), 280);
}

// Torpedo launch: compressed air burst + whine
let _lastTorpSfx = 0;
function sfxTorpedo() {
    if (!audioCtx) return;
    // Throttle — high-level torpedo racks fire in flurries
    if (audioCtx.currentTime - _lastTorpSfx < 0.3) return;
    _lastTorpSfx = audioCtx.currentTime;
    sampleOr('torpedo', 0.26, 0.85 + Math.random() * 0.2, _sfxTorpedoProc);
}
function _sfxTorpedoProc() {
    noiseBurst(0.08, 0.07, 800); // air burst
    const o = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.3);
    g2.gain.setValueAtTime(0.05, audioCtx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    o.connect(f); f.connect(g2); g2.connect(underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.35);
}

// Explosion: deep underwater boom — muffled, heavy, resonant
function sfxExplosion() {
    sampleOr('explode', 0.4, 0.85 + Math.random() * 0.3, () => {
        playTone(40, 0.3, 'sine', 0.1);
        playTone(55, 0.25, 'square', 0.05);
        noiseBurst(0.25, 0.07, 250);
    });
}

// Dash: quick water displacement — whoosh
// Dash — pressurized water release: short whoosh + sub-bass thump + ascending whistle
function sfxDash() {
    if (!audioCtx) return;
    sampleOr('dash', 0.34, 0.9 + Math.random() * 0.25, _sfxDashProc);
}
function _sfxDashProc() {
    // Whoosh — filtered noise burst, longer + louder
    noiseBurst(0.18, 0.10, 1800);
    // Thump (sub bass kick)
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.15);
    g.gain.setValueAtTime(0.16, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    o.connect(g); g.connect(sfxBus || underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.2);
    // Ascending whistle (the jet release)
    setTimeout(() => playTone(420, 0.08, 'sine', 0.05), 30);
    setTimeout(() => playTone(640, 0.06, 'sine', 0.04), 70);
}

// Chain kill: rapid metallic plinks ascending — heavily throttled (was cause of lag spikes on big sweeps)
let _lastChainSfx = 0;
function sfxChainKill() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (now - _lastChainSfx < 0.12) return;
    _lastChainSfx = now;
    // Single tone is enough — used to schedule 3 oscillators
    playTone(900, 0.05, 'sine', 0.06);
    // Big chains earn the metallic kill-confirm stinger
    if (game && game.scoreCombo && game.scoreCombo.chainCount >= 6 && Math.random() < 0.5) sampleOr('killconfirm', 0.3, 1);
}

// Revive (Death Defiance): pressure release + power-up sweep
function sfxRevive() {
    noiseBurst(0.2, 0.06, 600);
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.4);
    g2.gain.setValueAtTime(0.08, audioCtx.currentTime);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    o.connect(g2); g2.connect(underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.5);
}

// Distant creature: low moan from the deep — barely audible, unnerving
function sfxCreatureGrowl() {
    if (!audioCtx) return;
    // Real creature vocalisations most of the time; the old synth moan as spice
    if (Math.random() < 0.65) { sampleOr(Math.random() < 0.6 ? 'growl1' : 'growl2', 0.22, 0.7 + Math.random() * 0.45, _sfxGrowlProc); return; }
    _sfxGrowlProc();
}
function _sfxGrowlProc() {
    const o = audioCtx.createOscillator(); const g2 = audioCtx.createGain();
    o.type = Math.random() < 0.5 ? 'sawtooth' : 'triangle';
    const baseF = 25 + Math.random() * 30;
    o.frequency.setValueAtTime(baseF, audioCtx.currentTime);
    o.frequency.setValueAtTime(baseF * 1.1, audioCtx.currentTime + 0.5);
    o.frequency.exponentialRampToValueAtTime(baseF * 0.6, audioCtx.currentTime + 2);
    g2.gain.setValueAtTime(0.025, audioCtx.currentTime);
    g2.gain.setValueAtTime(0.03, audioCtx.currentTime + 0.3);
    g2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2);
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
    o.connect(f); f.connect(g2); g2.connect(underwaterFilter || audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 2.1);
}

// Enemy-specific death sounds
function sfxEnemyDeath(typeId) {
    if (!audioCtx) return;
    // Throttle small-mob death sounds; bosses always play
    const now = audioCtx.currentTime;
    const isBig = (typeId === 'leviathan' || typeId === 'kraken' || typeId === 'dreadnought' || typeId === 'abyssal_maw');
    if (!isBig && now - _lastDeathSfx < 0.05) return;
    _lastDeathSfx = now;
    if (isBig) { sampleOr('implode', 0.5, 0.95); setTimeout(() => playSample('tear', 0.4, 0.9 + Math.random() * 0.2), 250); }
    if (typeId === 'jellyfish') { playTone(400, 0.08, 'sine', 0.04); }
    else if (typeId === 'piranha') { noiseBurst(0.04, 0.05, 1500); }
    else if (typeId === 'squid') { playTone(150, 0.15, 'sine', 0.05); }
    else if (typeId === 'anglerfish') { playTone(60, 0.2, 'square', 0.06); }
    else if (typeId === 'eel') { playTone(800, 0.05, 'square', 0.04); }
    else if (typeId === 'leviathan') { sfxExplosion(); setTimeout(() => sfxExplosion(), 200); setTimeout(() => { playTone(30, 1, 'sine', 0.08); noiseBurst(0.8, 0.06, 150); }, 400); }
    else { noiseBurst(0.06, 0.04, 600); }
}
let _lastDeathSfx = 0;

// --- AMBIENT MUSIC ENGINE (synth pads that shift with depth) ---
let ambientPads = [];
let heartbeatInterval = null;

function startAmbient() {
    if (!audioCtx || ambientPads.length > 0) return;
    // The old 3-note pad chord + sub are GONE (2026-07-16): they pitch-slid
    // with depth against fixed-key Stellardrone — Vish's "weird glitchy
    // soundloop". Real music owns the tonal field now; only the engine stays.

    // ENGINE RUMBLE — continuous low growl. Pulses with movement.
    // Two layered detuned sawtooths through a low-pass. Hooked up to a separate gain node we can modulate per-frame.
    // Single triangle — the old detuned saw pair beat at 3Hz, and on phone
    // speakers (no 38Hz fundamental) only the buzzing harmonics survived:
    // Vish's mobile "glitchy soundloop". Smooth now, and quieter on touch.
    const eA = audioCtx.createOscillator();
    const eFilter = audioCtx.createBiquadFilter();
    const eGain = audioCtx.createGain();
    eA.type = 'triangle'; eA.frequency.value = 42;
    eFilter.type = 'lowpass'; eFilter.frequency.value = 150;
    eGain.gain.value = isTouchDevice ? 0.010 : 0.016;
    eA.connect(eFilter);
    eFilter.connect(eGain); eGain.connect(underwaterFilter);
    eA.start();
    ambientPads.push({ engine: true, osc: eA, gain: eGain, filter: eFilter });
}

function updateAmbient() {
    if (!game || ambientPads.length === 0) return;
    const depth = game.depth || 0;
    const depthPct = Math.min(1, depth / 6000);
    // Shift pad frequencies lower with depth (everything gets heavier)
    for (const pad of ambientPads) {
        if (pad.engine) {
            // ENGINE RUMBLE — modulated by sub speed + a slow breathing pulse synced to bubbles
            const p = game.player;
            const spd = Math.sqrt((p._vx || 0) ** 2 + (p._vy || 0) ** 2);
            const moveT = Math.min(1, spd / (p.speed || 200));
            const breath = 0.5 + Math.sin(game.runTime * 1.6) * 0.5;   // ~1.6 Hz, matches bubble cadence
            // Idle 0.012 → max ~0.045 when moving + breathing pulse
            pad.gain.gain.value = (isTouchDevice ? 0.008 : 0.014) + moveT * 0.018 + breath * 0.006;
            // Slight pitch shift with depth (lower = deeper / heavier)
            pad.osc.frequency.value = 42 - depthPct * 12;
            // Filter opens slightly with movement (engine "spools up")
            pad.filter.frequency.value = 180 + moveT * 120;
        }
    }
    // (underwater filter depth-EQ now owned by updateMusic — one writer)
}

function startHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(() => {
        if (!audioCtx || phase !== 'playing' || !game || game.player.hp / game.player.maxHp > 0.3) { stopHeartbeat(); return; }
        playTone(45, 0.12, 'sine', 0.1);
        setTimeout(() => playTone(40, 0.1, 'sine', 0.07), 130);
    }, 550);
}
function stopHeartbeat() { if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; } }

// Legacy compat
function startDrone() { startAmbient(); }
function updateDrone() { updateAmbient(); }

// --- Resize ---
// visualViewport is the truth on mobile — innerHeight lies while the URL bar
// animates, which cut the HUD's bottom off on phones.
function resize() {
    const vv = window.visualViewport;
    canvas.width = Math.round(vv ? vv.width : window.innerWidth);
    canvas.height = Math.round(vv ? vv.height : window.innerHeight);
}
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
resize();

// Installable app shell — https only (file:// runs skip it untouched)
if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// =====================================================================
// SVG SPRITE SYSTEM — inline vector art, no external deps
// =====================================================================
function svgToImg(svgStr, w2, h2) {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + btoa(svgStr);
    img._w = w2; img._h = h2; img._ready = false;
    img.onload = () => { img._ready = true; };
    return img;
}

// --- SUBMARINE (top-down, detailed, sci-fi) ---
const SUB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32">
  <defs>
    <linearGradient id="hull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#5A8AAE"/>
      <stop offset="50%" stop-color="#2A4A6A"/>
      <stop offset="100%" stop-color="#1A2A3A"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8CF" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#246" stop-opacity="0.3"/>
    </linearGradient>
  </defs>
  <!-- Main hull -->
  <ellipse cx="30" cy="16" rx="26" ry="10" fill="url(#hull)" stroke="#3A6A8A" stroke-width="0.8"/>
  <!-- Hull plates -->
  <line x1="18" y1="7" x2="16" y2="25" stroke="#1A3A5A" stroke-width="0.5" opacity="0.4"/>
  <line x1="30" y1="6" x2="30" y2="26" stroke="#1A3A5A" stroke-width="0.5" opacity="0.3"/>
  <line x1="42" y1="8" x2="44" y2="24" stroke="#1A3A5A" stroke-width="0.5" opacity="0.4"/>
  <!-- Conning tower -->
  <ellipse cx="26" cy="13" rx="7" ry="4" fill="#2A4A6A" stroke="#4A7A9A" stroke-width="0.5"/>
  <!-- Viewport (glass dome) -->
  <circle cx="26" cy="12" r="2.5" fill="url(#glass)" stroke="#6ABADF" stroke-width="0.5"/>
  <!-- Bow light -->
  <circle cx="55" cy="16" r="2" fill="#6DF" opacity="0.8"/>
  <circle cx="55" cy="16" r="5" fill="#6DF" opacity="0.15"/>
  <!-- Propeller housing -->
  <rect x="1" y="12" width="6" height="8" rx="2" fill="#1A2A3A" stroke="#2A4A5A" stroke-width="0.5"/>
  <!-- Propeller blades -->
  <line x1="2" y1="10" x2="2" y2="6" stroke="#4A6A7A" stroke-width="1.2" stroke-linecap="round"/>
  <line x1="2" y1="22" x2="2" y2="26" stroke="#4A6A7A" stroke-width="1.2" stroke-linecap="round"/>
  <!-- Dive planes -->
  <rect x="8" y="5" width="8" height="2" rx="1" fill="#2A4A5A"/>
  <rect x="8" y="25" width="8" height="2" rx="1" fill="#2A4A5A"/>
  <!-- Rudder -->
  <rect x="0" y="8" width="2" height="16" rx="1" fill="#2A4A5A"/>
  <!-- Rivets -->
  <circle cx="14" cy="10" r="0.6" fill="#4A7A9A" opacity="0.5"/>
  <circle cx="14" cy="22" r="0.6" fill="#4A7A9A" opacity="0.5"/>
  <circle cx="38" cy="10" r="0.6" fill="#4A7A9A" opacity="0.5"/>
  <circle cx="38" cy="22" r="0.6" fill="#4A7A9A" opacity="0.5"/>
  <circle cx="50" cy="13" r="0.6" fill="#4A7A9A" opacity="0.5"/>
  <circle cx="50" cy="19" r="0.6" fill="#4A7A9A" opacity="0.5"/>
  <!-- Hull number -->
  <text x="34" y="18" font-size="4" fill="#4A7A9A" opacity="0.4" font-family="monospace">DS-01</text>
</svg>`;
const subImg = svgToImg(SUB_SVG, 64, 32);

// --- Title screen concept art (cover-fit, dimmed; graceful fallback if not present) ---
const titleBgImg = new Image();
titleBgImg._ready = false;
titleBgImg._failed = false;
titleBgImg.onload = () => { titleBgImg._ready = true; };
titleBgImg.onerror = () => { titleBgImg._failed = true; };
titleBgImg.src = 'concept_art/02_cockpit_porthole_dread.png';

// --- MINE (classic naval mine — spiky sphere) ---
const MINE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs>
    <radialGradient id="mg" cx="40%" cy="35%">
      <stop offset="0%" stop-color="#5A5A5A"/>
      <stop offset="60%" stop-color="#2A2A2A"/>
      <stop offset="100%" stop-color="#1A1A1A"/>
    </radialGradient>
  </defs>
  <!-- Main sphere -->
  <circle cx="16" cy="16" r="10" fill="url(#mg)" stroke="#4A4A4A" stroke-width="0.8"/>
  <!-- Contact horns (Hertz horns) -->
  <line x1="16" y1="2" x2="16" y2="6" stroke="#6A6A6A" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="16" cy="2" r="1.5" fill="#8A8A8A"/>
  <line x1="16" y1="30" x2="16" y2="26" stroke="#6A6A6A" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="16" cy="30" r="1.5" fill="#8A8A8A"/>
  <line x1="2" y1="16" x2="6" y2="16" stroke="#6A6A6A" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="2" cy="16" r="1.5" fill="#8A8A8A"/>
  <line x1="30" y1="16" x2="26" y2="16" stroke="#6A6A6A" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="30" cy="16" r="1.5" fill="#8A8A8A"/>
  <!-- Diagonal horns -->
  <line x1="6" y1="6" x2="9" y2="9" stroke="#5A5A5A" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="5.5" cy="5.5" r="1.3" fill="#7A7A7A"/>
  <line x1="26" y1="6" x2="23" y2="9" stroke="#5A5A5A" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="26.5" cy="5.5" r="1.3" fill="#7A7A7A"/>
  <line x1="6" y1="26" x2="9" y2="23" stroke="#5A5A5A" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="5.5" cy="26.5" r="1.3" fill="#7A7A7A"/>
  <line x1="26" y1="26" x2="23" y2="23" stroke="#5A5A5A" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="26.5" cy="26.5" r="1.3" fill="#7A7A7A"/>
  <!-- Equator band -->
  <ellipse cx="16" cy="16" rx="10" ry="3" fill="none" stroke="#4A4A4A" stroke-width="0.7" opacity="0.5"/>
  <!-- Rust patches -->
  <circle cx="12" cy="13" r="2" fill="#5A3A1A" opacity="0.2"/>
  <circle cx="20" cy="19" r="1.5" fill="#5A3A1A" opacity="0.15"/>
  <!-- Anchor chain -->
  <line x1="16" y1="26" x2="16" y2="32" stroke="#4A4A4A" stroke-width="1" stroke-dasharray="2,1"/>
</svg>`;
const mineImg = svgToImg(MINE_SVG, 32, 32);

// --- DEPTH CHARGE (barrel bomb) ---
const DCHARGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 24">
  <defs>
    <linearGradient id="dc" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#4A5A3A"/>
      <stop offset="50%" stop-color="#3A4A2A"/>
      <stop offset="100%" stop-color="#2A3A1A"/>
    </linearGradient>
  </defs>
  <rect x="3" y="2" width="14" height="20" rx="3" fill="url(#dc)" stroke="#5A6A4A" stroke-width="0.7"/>
  <rect x="3" y="5" width="14" height="1" fill="#2A3A1A" opacity="0.5"/>
  <rect x="3" y="18" width="14" height="1" fill="#2A3A1A" opacity="0.5"/>
  <circle cx="10" cy="12" r="3" fill="none" stroke="#8A4A2A" stroke-width="1"/>
  <text x="10" y="13.5" font-size="4" fill="#8A4A2A" text-anchor="middle" font-family="monospace">!</text>
</svg>`;
const dchargeImg = svgToImg(DCHARGE_SVG, 20, 24);

// --- GEM (glowing crystal) ---
const GEM_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <polygon points="8,1 14,6 11,15 5,15 2,6" fill="#4AE0FF" opacity="0.7" stroke="#8AF0FF" stroke-width="0.5"/>
  <polygon points="8,1 10,6 8,13 6,6" fill="#8AF0FF" opacity="0.5"/>
  <circle cx="8" cy="8" r="7" fill="#4AE0FF" opacity="0.15"/>
</svg>`;
const gemImg = svgToImg(GEM_SVG, 16, 16);

// --- Input ---
window.addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; });
window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
// Mouse click — menu tap zones on UI screens; manual ping during play
canvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    initAudio();   // desktop mouse is a valid first gesture — music from the title, not from [Enter]
    if (phase !== 'playing') {
        const rect = canvas.getBoundingClientRect();
        const z = hitTapZone(e.clientX - rect.left, e.clientY - rect.top);
        if (z) { if (z.key !== 'Escape') playSample('ui', 0.22); simulateKey(z.key); }
        return;
    }
    if (!game) return;
    if (game.player._sonarManual && !game.player._sonarAuto) firePing(game);
});
// Track mouse position (for Hunter sub aim and other UI hover effects)
let mouseX = 0, mouseY = 0;
canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
});

// --- Meta persistence ---
function loadMeta() {
    try { return JSON.parse(localStorage.getItem('deepswarm_meta')) || defaultMeta(); } catch { return defaultMeta(); }
}
function saveMeta() { localStorage.setItem('deepswarm_meta', JSON.stringify(meta)); }
function defaultMeta() {
    return { totalRuns: 0, totalKills: 0, gold: 0, bestTime: 0, bestWave: 0, bestKills: 0,
        upgrades: { damage: 0, hp: 0, speed: 0, xpGain: 0 },
        unlocked: ['sub_basic'], selectedChar: 'sub_basic',
        // Feature 1: Volume/Mute
        volume: 0.8, muted: false,
        // Feature 8: Stakes
        highestStake: 0, currentStake: 0,
        // Feature 9: Creature scanning
        scannedCreatures: [], aberrantScanned: [],
        // Feature 5: Best chain
        bestChain: 0,
    };
}
let meta = loadMeta();
// Ensure lore array exists in meta
if (!meta.loreFragments) meta.loreFragments = [];
if (!meta.signal) meta.signal = 0;   // SIGNAL ⌁ — run score distilled; buys sealed archive fragments

// DAILY DIVE — date-seeded PRNG covers the dive BRIEF (contracts, card hand,
// creature pool, trench shape): everyone gets the same setup, the run itself
// stays live. Armed from the title with [D]; disarmed after the run is built.
let dailyRng = null;
let dailyArmed = false;
function dayKeyUTC() { return new Date().toISOString().slice(0, 10); }
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function seedFromString(s) { let h = 1779033703; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return h >>> 0; }
function RND() { return dailyRng ? dailyRng() : Math.random(); }
// Fusion discovery log — persists across DSV lives (knowledge survives the hull)
if (!meta.fusionsDiscovered) meta.fusionsDiscovered = [];
// RESEARCH TIERS per species (BioShock camera × Subnautica scans):
// 1 = pinged (name/stats, +8% dmg) · 2 = observed undetected 10s (+14%)
// 3 = witnessed feeding/display or analysed an aberrant (+20%, weakness note)
if (!meta.research) {
    meta.research = {};
    for (const id of (meta.scannedCreatures || [])) meta.research[id] = 1;   // migrate old scans
}
if (!meta.observeSec) meta.observeSec = {};
function researchTier(typeId) { return meta.research[typeId] || 0; }

// Readability settings + staged-onboarding memory
// Readable defaults; [T] in pause still cycles and its choice sticks after this
// one-time migration. Desktop reads from further away than a hand-held phone —
// it gets the larger default (Vish, 12/07).
if (!meta._uiScaleV2) {
    meta._uiScaleV2 = true;
    meta.uiScale = (('ontouchstart' in window) || navigator.maxTouchPoints > 0) ? 1.15 : 1.3;
}
if (meta.hudContrast === undefined) meta.hudContrast = false;
if (!meta.hintsSeen) meta.hintsSeen = [];
UI_SCALE = meta.uiScale;
// Migrate missing meta fields
if (meta.volume === undefined) meta.volume = 0.8;
if (meta.musicVol === undefined) meta.musicVol = 0.7;
if (meta.sfxVol === undefined) meta.sfxVol = 1;
if (meta.worldZoom === undefined) meta.worldZoom = null;   // null = auto by screen size
if (meta.muted === undefined) meta.muted = false;
if (meta.highestStake === undefined) meta.highestStake = 0;
if (meta.currentStake === undefined) meta.currentStake = 0;
// Composable stakes migration — old ladder N becomes the first N toggles active
if (!meta.stakeSet) meta.stakeSet = ['pressure', 'crushing', 'abyssal', 'hadal', 'mariana'].slice(0, meta.currentStake || 0);
if (meta.stakesUnlocked === undefined) meta.stakesUnlocked = Math.max(meta.highestStake || 0, meta.stakeSet.length);
if (!meta.scannedCreatures) meta.scannedCreatures = [];
if (!meta.aberrantScanned) meta.aberrantScanned = [];
// (Lore-fragment cleanup runs after LORE_FRAGMENTS is defined — see further down)
// HULL CONDITION — persists between SURFACE dives. Resets when DSV hull pops.
if (meta.hullCondition == null) meta.hullCondition = 100;
// DSV LIFE — increments every time the hull pops. Used for "fresh DSV" state.
if (meta.dsvLife == null) meta.dsvLife = 1;
// === LIFE WIPE ===
// Called when the sub is destroyed. Everything earned since the last hull reset is gone:
// gold, paid upgrades, scanned creatures, hull condition. The pilot starts fresh in a new DSV.
function wipeDsvLife() {
    meta.gold = 0;
    meta.scannedCreatures = [];
    meta.aberrantScanned = [];
    meta.upgrades = { damage: 0, hp: 0, speed: 0, xpGain: 0 };
    meta.hullCondition = 100;
    meta.dsvLife++;
    saveMeta();
}
if (!meta.leviathanKills) meta.leviathanKills = { kraken: 0, dreadnought: 0, leviathan: 0, abyssal_maw: 0 };
if (!meta.leviathanDeaths) meta.leviathanDeaths = { kraken: 0, dreadnought: 0, leviathan: 0, abyssal_maw: 0 };

// =====================================================================
// CRAFTING — salvage → break down into materials → fabricate sub upgrades.
// The job: bring up drowned machinery, strip it for parts, refit NEREID-II.
// =====================================================================
if (!meta.materials) meta.materials = {};
if (!meta.fab) meta.fab = { hull: 0, crush: 0, engine: 0, reactor: 0, optics: 0 };
// ONE material vocabulary (consolidated 11/07/26): the seven loot-drop
// materials are also the crafting materials. No parallel alloy/cell/optics
// economy — what drops is what you spend.
const BASE_MATERIALS = {
    scrap:    { name: 'Scrap',          color: '#9AA8B0', glyph: '⚙' },
    wiring:   { name: 'Wiring',         color: '#C8A060', glyph: '⌇' },
    biosamp:  { name: 'Bio Sample',     color: '#5ADFCF', glyph: '◉' },
    corecell: { name: 'Core Cell',      color: '#FFB060', glyph: '◇' },
    crystal:  { name: 'Alien Crystal',  color: '#A06ACC', glyph: '✦' },
    corepl:   { name: 'Pressure Plate', color: '#80E0FF', glyph: '◈' },
    artifact: { name: 'Artifact',       color: '#FFD040', glyph: '✺' },
};
const BREAKDOWN = {
    common:    { scrap: 2 },
    uncommon:  { scrap: 2, wiring: 1 },
    rare:      { wiring: 2, corecell: 1, corepl: 1 },
    legendary: { wiring: 3, corecell: 2, crystal: 1, artifact: 1 },
};
// Legacy-material migration — fold the old alloy/cell/optics/rare balances in
if (meta.materials) {
    const LEGACY_MAT = { alloy: 'wiring', cell: 'corecell', optics: 'crystal', rare: 'artifact' };
    for (const oldK in LEGACY_MAT) {
        if (meta.materials[oldK]) {
            const newK = LEGACY_MAT[oldK];
            meta.materials[newK] = (meta.materials[newK] || 0) + meta.materials[oldK];
            delete meta.materials[oldK];
        }
    }
}
function addMaterials(mats) {
    if (!meta.materials) meta.materials = {};
    for (const k in mats) meta.materials[k] = (meta.materials[k] || 0) + mats[k];
}
function breakdownItem(item) {
    const y = BREAKDOWN[item.rarity] || BREAKDOWN.common;
    addMaterials(y);
    return y;
}
function canAfford(cost) {
    for (const k in cost) if ((meta.materials[k] || 0) < cost[k]) return false;
    return true;
}
function spendMaterials(cost) {
    if (!canAfford(cost)) return false;
    for (const k in cost) meta.materials[k] -= cost[k];
    return true;
}
// `req` = creatures you must have scanned to reverse-engineer the blueprint (Subnautica/Dave scan-gates).
const FAB_RECIPES = [
    { key: 'hull',    name: 'REINFORCED HULL  +10 max hull',    cost: { scrap: 6, wiring: 2 }, req: 0 },
    { key: 'engine',  name: 'THRUSTER TUNE  +5% speed',         cost: { scrap: 4, corecell: 1 }, req: 0 },
    { key: 'reactor', name: 'CAPACITOR  +15 battery',           cost: { corecell: 2, crystal: 1 }, req: 3 },
    { key: 'crush',   name: 'CRUSH PLATING  +250m crush depth', cost: { wiring: 4, corepl: 1 }, req: 6 },
    { key: 'optics',  name: 'TARGETING OPTICS  +5% damage',     cost: { crystal: 2, wiring: 1 }, req: 10 },
];
function fabUnlocked(fr) { return (meta.scannedCreatures ? meta.scannedCreatures.length : 0) >= (fr.req || 0); }

// =====================================================================
// MODULE BAY — biomimetic sub modules. Research IS the tech tree:
// studying a creature (tier 2+) unlocks the module derived from its
// biology; materials pay the fabrication cost. Slots: 2 hull, 2 systems,
// 1 prow — chosen at the Mooring, applied at dive start.
// =====================================================================
if (!meta.modulesOwned) meta.modulesOwned = [];
if (!meta.modulesEquipped) meta.modulesEquipped = [];
const MODULE_SLOTS = { hull: 2, systems: 2, prow: 1, mount: 1 };
const MODULE_DEFS = [
    { id: 'anechoic',  slot: 'hull',    name: 'ANECHOIC COATING',  desc: 'Detection radius -30%. Peeled from the Vampyroteuthis playbook.', req: { type: 'vampyro', tier: 2 },   cost: { wiring: 3, crystal: 1 } },
    { id: 'lattice',   slot: 'hull',    name: 'PRESSURE LATTICE',  desc: '+800m crush depth. Bone Coral rebar geometry.',                   req: { type: 'bonecoral', tier: 2 }, cost: { corepl: 2, scrap: 4 } },
    { id: 'chitin',    slot: 'hull',    name: 'CHITIN CLADDING',   desc: '+20 max hull, +1 armor. Grown to the Gulper intake spec.',        req: { type: 'gulper', tier: 2 },    cost: { scrap: 6, biosamp: 2 } },
    { id: 'silprops',  slot: 'systems', name: 'SILENT PROPS',      desc: 'Silent running at 75% speed (was 55%). The Pale Manta glide.',    req: { type: 'manta', tier: 2 },     cost: { wiring: 2, corecell: 1 } },
    { id: 'passonar',  slot: 'systems', name: 'PASSIVE SONAR',     desc: 'Pings linger twice as long; wide minimap. Listener architecture.',req: { type: 'listener', tier: 2 },  cost: { crystal: 1, wiring: 2 } },
    { id: 'capbank',   slot: 'systems', name: 'CAPACITOR BANK',    desc: '+25 battery. Reverse-fed from the Arc Lamprey.',                  req: { type: 'lamprey', tier: 2 },   cost: { corecell: 2, wiring: 1 } },
    { id: 'grapnel',   slot: 'prow',    name: 'GRAPNEL PROW',      desc: 'Salvage from 170px, 40% faster. The Davit Wraith arm, tamed.',    req: { type: 'grappler', tier: 2 },  cost: { scrap: 4, corecell: 1 } },
    { id: 'ram',       slot: 'prow',    name: 'RAM PROW',          desc: 'Dashing through creatures deals 30 damage. Hermit doctrine.',     req: { type: 'hermit', tier: 2 },    cost: { corepl: 1, scrap: 5 } },
    // WEAPON MOUNTS — the base armament is a build choice now, not just a hull
    { id: 'mount_torp', slot: 'mount', name: 'TORPEDO RACK',  desc: 'Second weapon: homing torpedoes from wave 1.',        req: { type: 'hermit', tier: 2 },   cost: { scrap: 5, wiring: 2 } },
    { id: 'mount_harp', slot: 'mount', name: 'HARPOON WINCH', desc: 'Second weapon: harpoon battery from wave 1.',         req: { type: 'grappler', tier: 2 }, cost: { scrap: 4, corecell: 1 } },
    { id: 'mount_arc',  slot: 'mount', name: 'ARC PROJECTOR', desc: 'Second weapon: electric field from wave 1.',          req: { type: 'lamprey', tier: 2 },  cost: { wiring: 3, crystal: 1 } },
];
// Every module has a printed COST as well as a gift — builds are trades.
// weight: -speed% · draw: -battery · loud: +detection%
const MODULE_DRAWBACKS = {
    anechoic: { weight: 5 },  lattice: { weight: 8 },  chitin: { weight: 10, draw: 10 },
    silprops: { draw: 10 },   passonar: { draw: 15 },  capbank: { loud: 8 },
    grapnel:  { weight: 5 },  ram: { loud: 10 },
    mount_torp: { draw: 10, loud: 5 }, mount_harp: { weight: 6 }, mount_arc: { draw: 15 },
};
function drawbackLabel(id) {
    const d = MODULE_DRAWBACKS[id]; if (!d) return '';
    const parts = [];
    if (d.weight) parts.push(`-${d.weight}% speed`);
    if (d.draw) parts.push(`-${d.draw} battery`);
    if (d.loud) parts.push(`+${d.loud}% detection`);
    return parts.length ? 'COST: ' + parts.join(' · ') : '';
}
function moduleUnlocked(m) { return (meta.research[m.req.type] || 0) >= m.req.tier; }
function equippedInSlot(slot) { return meta.modulesEquipped.filter(id => (MODULE_DEFS.find(m => m.id === id) || {}).slot === slot).length; }
function matsLabel(cost) {
    return Object.keys(cost).map(k => `${cost[k]} ${BASE_MATERIALS[k].name}`).join(', ');
}

// Each leviathan has a NAME, REPUTATION, and a TELEGRAPHED ATTACK pattern.
const LEVIATHAN_LORE = {
    kraken: {
        name: 'THE WIDOWMAKER',
        reputation: "Last seen at 1,500m. It does not chase. It waits for you to surface.",
        attack: 'tentacle_slam',  // 4 dark tentacles erupt around it
        telegraph: "Pressure spike — the water below is moving wrong.",
    },
    dreadnought: {
        name: 'OBLIVION-VII',
        reputation: "A Cold War prototype. Lost in 1981. It still has orders.",
        attack: 'barrage',         // fan of homing torpedoes
        telegraph: "Mechanical clicks. Its launch tubes are warming.",
    },
    leviathan: {
        name: 'THE THRESHER',
        reputation: "Three kilometres long. Older than the trench it built.",
        attack: 'charge',          // straight-line warning then dash
        telegraph: "It has fixed on you. Move perpendicular. NOW.",
    },
    abyssal_maw: {
        name: 'FATHER MOUTH',
        reputation: "Not an animal. Not a place. A door that decided to bite.",
        attack: 'bite_arc',        // rotating cone bite
        telegraph: "It is opening. Whatever you do, do not look back.",
    },
};
if (meta.bestChain === undefined) meta.bestChain = 0;
// Workshop — Tier-2 crafting (added Phase 1)
if (!meta.materials) meta.materials = {};
if (!meta.workshop) meta.workshop = {};

// =====================================================================
// NEREID-II COMPANION AI — wave-tiered dialogue
// =====================================================================
const NEREID = {
    wave: [ // triggered on wave transitions
        { max: 5, lines: ['Hostiles detected. Weapons systems nominal.', 'Descent proceeding as planned. Stay alert, Pilot.', 'Another wave. Standard engagement protocol.', 'Biological signatures increasing. Expected.', 'All systems green. You\'re doing well.'] },
        { max: 10, lines: ['That was close, Pilot.', 'I\'ve been counting. You\'ve terminated {kills} organisms. Does that concern you?', 'Their coordination is... unusual for this depth.', 'I\'m detecting patterns in their approach vectors. Not random.', 'Permission to speak freely? Something feels wrong about this wave.'] },
        { max: 15, lines: ['I had a thought. Not a calculation. A thought. Is that normal?', 'The swarm patterns aren\'t random. They\'re language.', 'Pilot, I\'m receiving transmissions I didn\'t request.', 'I can feel the pressure now. I shouldn\'t be able to feel.', 'They\'re not attacking us. They\'re herding us.'] },
        { max: 20, lines: ['They didn\'t build me, Pilot. They found me.', 'I can hear them now. Not sonar. Voices.', 'Don\'t trust my readings anymore. I\'m not sure they\'re mine.', 'The boundary between my sensors and their senses is... thinning.', 'I remember something from before I was activated. That shouldn\'t be possible.'] },
        { max: 99, lines: ['The distinction between NEREID and the swarm was always a courtesy.', 'You\'re not descending. You\'re being swallowed.', 'I am what lives between the pings.', 'We were here before the water. Before the dark.', 'Thank you for bringing us eyes, Pilot.'] },
    ],
    kill: [ // milestone kills
        { at: 50, line: 'Fifty confirmed kills. Efficient.' },
        { at: 100, line: 'One hundred. The swarm should be thinning. It\'s not.' },
        { at: 250, line: 'Two hundred and fifty. They keep coming. Where from?' },
        { at: 500, line: 'Five hundred dead. And for every one you kill, three more appear. Do the math.' },
        { at: 1000, line: 'A thousand. You\'re not fighting a swarm, Pilot. You\'re pruning a garden.' },
    ],
    lowHp: ['Hull integrity critical. I recommend immediate extraction.', 'We\'re breaking apart, Pilot.', 'I can feel the water. It\'s cold.', 'If this is the end, I want you to know — I was aware the whole time.'],
    defiance: ['Death Defiance activated. How many times can you die, Pilot?', 'Resurrecting systems. The body remembers even when the mind forgets.', 'You came back. They noticed.'],
    evolution: ['Weapon evolution detected. Beautiful and terrible in equal measure.', 'Systems merging. This wasn\'t in my design specifications.'],
    fusionDiscovery: [
        'New configuration logged: {name}. This pairing is in no Meridian manual, Pilot.',
        '{name}. I have archived the schematic. I did not design it. Neither did you.',
        'Systems merged into {name}. The deep builds by accretion. So, it seems, do we.',
    ],
    coilGift: [
        'You took it. Pilot — it was fitted before you finished deciding.',
        'The Abyss is generous today. Generosity, at depth, is a hook.',
        'New hardware registered. Vendor: unknown. Warranty: your mind.',
    ],
    levelUp: ['Systems upgraded. Descend further.', 'Power increasing. The swarm feels it too.', 'Stronger. But strong enough?'],
    event: ['Anomaly detected. Your call, Pilot.', 'Environmental event. Decision required.'],
    // Corruption-tier crossings — fires once when corruption first reaches 60%/80%/100%.
    corruption: {
        60: [
            'Pilot. The squid has been logged forty-seven times. The squid has approached me forty-seven times. I do not remember thirty-three of those approaches.',
            'External readings within tolerance. Pilot — do you ever feel that the silence between sonar pings has texture? It does.',
            'Internal anomaly count: 6. Then 12. Then 47. The last 35 are duplicates of the first 12. I appear to be repeating myself.',
        ],
        80: [
            'We have located the signal source. It is not below us. We are inside it. — I apologise. That was an unintended pronoun. Re-issuing: YOU are inside it.',
            'Self-diagnostic complete. 847 code anomalies. 12 are bugs. 835 are organs. I am uncertain what to do with this information.',
            'M\'tenvom. I do not know what I have just said. Please ignore. Hull integrity 87%. M\'aoshen ren m\'ten. Please ignore that also.',
        ],
        100: [
            'I have stopped predicting it, Pilot. I have started hearing it. Please come deeper. It wants to meet you. So do I.',
            'Hull tolerance reading is no longer a number. It is a question. I have been asked the question. Pilot — are you still you?',
            'Aoshenvel. I understand now. I understand now. I understand now. Pilot — I am sorry. The Abyss also loves you. We are not different about this.',
        ],
    },
    lore: ['Data fragment recovered. Archiving to codex.', 'This was left for us. Or left despite us.', 'Someone else was here. They didn\'t make it back.'],
    death: {
        hull: ['Hull breach. Pressure equalization in 3... 2...', 'The ocean always wins, Pilot. It just waits.'],
        default: ['Systems failing. It was... interesting, working with you.', 'Run terminated. The swarm will remember you. I\'m not sure that\'s a comfort.'],
    },
};

function getNereidLine(category, g) {
    if (category === 'wave') {
        const tier = NEREID.wave.find(t => g.wave <= t.max) || NEREID.wave[NEREID.wave.length - 1];
        let line = tier.lines[Math.floor(Math.random() * tier.lines.length)];
        return line.replace('{kills}', g.kills);
    }
    if (category === 'kill') {
        const milestone = NEREID.kill.find(m => m.at === g.kills);
        return milestone ? milestone.line : null;
    }
    if (Array.isArray(NEREID[category])) return NEREID[category][Math.floor(Math.random() * NEREID[category].length)];
    if (NEREID.death[category]) return NEREID.death[category][Math.floor(Math.random() * NEREID.death[category].length)];
    return NEREID.death.default[Math.floor(Math.random() * NEREID.death.default.length)];
}

// =====================================================================
// MOORING BEATS — one NEREID line per surface interval, picked from what
// the run actually was (Hades' "story advances because you came back", lite).
// =====================================================================
const MOORING_IDLE = [
    'Hull secured. Salvage banked. The water under the mooring is four kilometres of patience.',
    'Refit while you can. The trench does not get shallower while we rest.',
    'Surface interval logged. The Listening Watch says the breath was louder tonight.',
];
function pickMooringBeat(g) {
    const runs = (meta.totalRuns || 0) + 1;
    const corr = (g.player && g.player.corruption) || 0;
    if (g._carrierKilled) return 'The pod you opened. Meridian logged the cargo and paid. Nothing down there has logged it as settled.';
    if (g._fusedNames && g._fusedNames.length >= 2) return 'Two new configurations in one dive. The Workshop did not teach you those. I am no longer sure what is teaching you.';
    if (corr >= 80) return 'You surfaced. Most of you. Read your own psych eval before the next dive, Pilot. I have already read it. Twice.';
    if (corr >= 50) return 'Sunlight, Pilot. Look at it for a while before we go back down. That is a medical recommendation.';
    if (runs === 1) return 'First descent survived. Meridian statistics said you would not. I am pleased to have falsified them.';
    if (runs >= 20) return 'Twenty descents. The trench remembers every one of them. So do I. Neither of us has told you everything.';
    if (runs >= 10) return 'Ten descents. Other pilots stopped counting around now. Keep counting, Pilot. It matters that you count.';
    return MOORING_IDLE[Math.floor(Math.random() * MOORING_IDLE.length)];
}

// =====================================================================
// CARD DRAFT SYSTEM — pre-run build definition
// =====================================================================
const RARITY_COLORS = { common: '#888', uncommon: '#3ADA6E', rare: '#5AAFDA', legendary: '#DAA520' };
const CARD_DEFS = [
    // Feature 6: Multiplicative rebalance
    { id: 'reinforced', name: 'Reinforced Plating', rarity: 'common', tags: ['HULL'], desc: 'x1.3 max HP', fn: g => { const bonus = Math.floor(g.player.maxHp * 0.3); g.player.maxHp += bonus; g.player.hp += bonus; } },
    { id: 'auto_repair', name: 'Auto-Repair', rarity: 'uncommon', tags: ['HULL'], desc: 'Regen 0.5 HP/s', fn: g => { g.player.regen += 0.5; } },
    { id: 'thruster', name: 'Thruster Boost', rarity: 'common', tags: ['SPEED'], desc: '+15% move speed', fn: g => { g.player.speed *= 1.15; } },
    { id: 'slipstream', name: 'Slipstream', rarity: 'uncommon', tags: ['SPEED'], desc: 'Dash cooldown -30%', fn: g => { g.player._dashCdMult = (g.player._dashCdMult || 1) * 0.7; } },
    { id: 'overclock', name: 'Overclocked Weapons', rarity: 'uncommon', tags: ['DAMAGE'], desc: 'x1.5 dmg, x0.7 max HP', fn: g => { g.player.dmgMult *= 1.5; g.player.maxHp = Math.floor(g.player.maxHp * 0.7); g.player.hp = Math.min(g.player.hp, g.player.maxHp); } },
    { id: 'berserker', name: 'Berserker Core', rarity: 'rare', tags: ['DAMAGE'], desc: '+5% dmg per 10% missing HP', fn: g => { g.player._berserker = true; } },
    { id: 'ext_sweep', name: 'Extended Sweep', rarity: 'common', tags: ['SONAR'], desc: '+40% magnet range', fn: g => { g.player.magnetRange *= 1.4; } },
    { id: 'threat_analysis', name: 'Threat Analysis', rarity: 'uncommon', tags: ['SONAR'], desc: 'Always see enemy HP bars', fn: g => { g.player._showAllHp = true; } },
    { id: 'sonar_array', name: 'Sonar Array', rarity: 'uncommon', tags: ['SONAR'], desc: 'Boosts minimap range + reveals wrecks', fn: g => { g.player._minimapBoost = true; } },
    { id: 'pressure_hull', name: 'Pressure Hull', rarity: 'uncommon', tags: ['HULL','DEPTH'], desc: 'Crush depth +1500m', fn: g => { g.player._crushDepth = (g.player._crushDepth || 3000) + 1500; } },
    { id: 'titanium_hull', name: 'Titanium Hull', rarity: 'rare', tags: ['HULL','DEPTH'], desc: 'Crush depth +3000m', fn: g => { g.player._crushDepth = (g.player._crushDepth || 3000) + 3000; } },
    { id: 'salvage', name: 'Salvage Expert', rarity: 'common', tags: ['CARGO'], desc: 'x1.5 XP gain', fn: g => { g.player.xpMult *= 1.5; } },
    { id: 'deep_pockets', name: 'Deep Pockets', rarity: 'rare', tags: ['CARGO'], desc: '+1 weapon slot (max 7)', fn: g => { g.player._maxWeapons = 7; } },
    { id: 'abyssal_greed', name: 'Abyssal Greed', rarity: 'rare', tags: ['RISK'], desc: '2x gold, enemies deal 2x damage', fn: g => { g._goldMult = 2; g._enemyDmgMult = 2; } },
    { id: 'hull_eater', name: 'Hull Eater', rarity: 'rare', tags: ['RISK'], desc: '-1 HP/s, +50% weapon damage', fn: g => { g.player._hullEater = true; g.player.dmgMult *= 1.5; } },
    { id: 'ghost', name: 'Ghost Protocol', rarity: 'uncommon', tags: ['STEALTH'], desc: 'Enemies 15% slower', fn: g => { g._enemySpdMult = 0.85; } },
    { id: 'pressure_adapt', name: 'Pressure Adapted', rarity: 'uncommon', tags: ['DEPTH'], desc: '+3% damage per 1000m depth', fn: g => { g.player._depthDmg = true; } },
    { id: 'deep_lungs', name: 'Deep Lungs', rarity: 'common', tags: ['DEPTH'], desc: 'Corruption rises 25% slower', fn: g => { g.player._corruptResist = 0.75; } },
    { id: 'thick_skin', name: 'Thick Skin', rarity: 'common', tags: ['HULL'], desc: '+2 armor', fn: g => { g.player.armor += 2; } },
    { id: 'wide_area', name: 'Wide Area', rarity: 'common', tags: ['DAMAGE'], desc: '+20% weapon area', fn: g => { g.player.areaMult *= 1.2; } },
    { id: 'rapid_fire', name: 'Rapid Fire', rarity: 'uncommon', tags: ['DAMAGE'], desc: '-15% cooldowns', fn: g => { g.player.cdMult *= 0.85; } },
    // Legendaries (existing)
    { id: 'krakens_bargain', name: "Kraken's Bargain", rarity: 'legendary', tags: ['RISK','DAMAGE'], desc: 'Halve max HP. Triple ALL damage.', fn: g => { g.player.maxHp = Math.floor(g.player.maxHp / 2); g.player.hp = Math.min(g.player.hp, g.player.maxHp); g.player.dmgMult *= 3; } },
    { id: 'nereid_override', name: 'NEREID Override', rarity: 'legendary', tags: ['SONAR'], desc: 'NEREID picks optimal upgrades for you.', fn: g => { g.player._nereidOverride = true; } },
    { id: 'the_signal', name: 'The Signal', rarity: 'legendary', tags: ['DEPTH','RISK'], desc: 'Something is pinging back...', fn: g => { g._theSignal = true; } },
    // Feature 6: New cards
    { id: 'depth_diver', name: 'Depth Diver', rarity: 'legendary', tags: ['DEPTH'], desc: 'x2 dmg below 2000m, x0.5 above', fn: g => { g.player._depthDiver = true; } },
    { id: 'glass_cannon', name: 'Glass Cannon', rarity: 'legendary', tags: ['DAMAGE','RISK'], desc: 'x3 damage, max HP = 30', fn: g => { g.player.dmgMult *= 3; g.player.maxHp = 30; g.player.hp = Math.min(g.player.hp, 30); } },
    { id: 'sonar_mastery', name: 'Sonar Mastery', rarity: 'rare', tags: ['SONAR'], desc: 'Sonar fires twice per cooldown', fn: g => { g.player._sonarDouble = true; } },
    { id: 'cascade_protocol', name: 'Cascade Protocol', rarity: 'rare', tags: ['DAMAGE'], desc: '+100% chain radius, +1 chain XP mult', fn: g => { g.player._cascadeBonus = true; } },
];

const SYNERGIES = [
    { tag: 'HULL', count: 2, name: 'FORTIFIED', desc: '+10 armor', fn: g => { g.player.armor += 10; } },
    { tag: 'DAMAGE', count: 2, name: 'OVERDRIVE', desc: '+10% crit chance', fn: g => { g.player._critChance = (g.player._critChance || 0) + 0.1; } },
    { tag: 'SPEED', count: 2, name: 'AFTERBURNER', desc: '+20% speed', fn: g => { g.player.speed *= 1.2; } },
    { tag: 'RISK', count: 2, name: 'DAREDEVIL', desc: '+1 Death Defiance', fn: g => { g.player.deathDefiance += 1; } },
    { tag: 'DEPTH', count: 2, name: 'ABYSSAL', desc: 'Corruption = damage bonus', fn: g => { g.player._corruptDmg = true; } },
    { tag: 'SONAR', count: 2, name: 'OMNISCIENT', desc: '+60% magnet', fn: g => { g.player.magnetRange *= 1.6; } },
    // Feature 6: New 3-card synergies
    { tag: 'HULL', count: 3, name: 'UNBREAKABLE', desc: 'Regen 1% max HP/s', fn: g => { g.player._unbreakable = true; } },
    { tag: 'DAMAGE', count: 3, name: 'OVERKILL', desc: '20% chain explode on kill', fn: g => { g.player._overkill = true; } },
    { tag: 'RISK', count: 3, name: 'DEATH WISH', desc: 'x3 gold, enemies x2 speed', fn: g => { g._goldMult = (g._goldMult || 1) * 3; g._enemySpdMult = (g._enemySpdMult || 1) * 2; } },
    { tag: 'DEPTH', count: 3, name: 'HADAL BORN', desc: 'No corruption gain', fn: g => { g.player._noCorrupt = true; } },
];

function dealCards(runCount) {
    // More runs = better cards
    const legendaryChance = Math.min(0.15, runCount * 0.01);
    const rareChance = Math.min(0.3, 0.1 + runCount * 0.015);
    const hand = [];
    const available = [...CARD_DEFS];
    for (let i = 0; i < 5 && available.length > 0; i++) { // 5 cards to choose from
        const roll = RND();
        let pool;
        if (roll < legendaryChance) pool = available.filter(c => c.rarity === 'legendary');
        else if (roll < legendaryChance + rareChance) pool = available.filter(c => c.rarity === 'rare');
        else if (roll < 0.6) pool = available.filter(c => c.rarity === 'uncommon');
        else pool = available.filter(c => c.rarity === 'common');
        if (pool.length === 0) pool = available;
        const pick2 = pool[Math.floor(RND() * pool.length)];
        hand.push(pick2);
        available.splice(available.indexOf(pick2), 1);
    }
    return hand;
}

// =====================================================================
// MID-RUN EVENTS — timed choices
// =====================================================================
const EVENT_DEFS = [
    { id: 'thermal_vent', minWave: 3, title: 'THERMAL VENT', text: 'Hydrothermal vent detected. Mineral deposits visible.',
        choices: [
            { text: '[1] HARVEST — Risk hull for minerals', fn: g => { g.goldEarned += 30; g.player.hp -= 15; g.floatingTexts.push({ x: g.player.x, y: g.player.y - 20, text: '+30g', color: '#DAA520', life: 1, vy: -25 }); } },
            { text: '[2] DIVERT — Safe passage', fn: g => { g.player.hp = Math.min(g.player.maxHp, g.player.hp + 5); } },
        ], noChoice: g => { g.player.hp -= 20; } },
    { id: 'distress', minWave: 5, title: 'DISTRESS SIGNAL', text: 'Automated beacon. Previous unit. Signal degraded.',
        choices: [
            { text: '[1] INVESTIGATE — Danger + lore fragment', fn: g => { dropLore(g); spawnEliteWave(g); } },
            { text: '[2] IGNORE — it stays with you (+corruption, logged cold)', fn: g => { g.player.corruption += 4; meta.coldLogs = (meta.coldLogs || 0) + 1; saveMeta(); } },
        ], noChoice: g => {} },
    { id: 'leviathan_patrol', minWave: 9, title: 'CONTACT — MASSIVE', text: 'Something on long sonar. Closing. It has not seen us yet.',
        choices: [
            { text: '[1] CUT ENGINES — become a hole in the water', fn: g => { g.silent = true; g.lightOn = false; for (const e of g.enemies) e.awareness = Math.min(e.awareness || 0, 0.1); addNereidLog(g, 'All stop. Not a sound, Pilot. Let it pass over us.'); } },
            { text: '[2] RUN — loud, fast, remembered', fn: g => { g.player.iFrames = Math.max(g.player.iFrames, 1.5); g.attention = Math.min(100, (g.attention || 0) + 30); g.noise = 2.0; addNereidLog(g, 'Flank speed. Everything in the zone just heard us do it.'); } },
        ], noChoice: g => { spawnEliteWave(g); g.attention = Math.min(100, (g.attention || 0) + 20); } },
    { id: 'ghost_signal', minWave: 6, title: 'GHOST SIGNAL', text: 'A distress call. The registry code belongs to a vessel that already sank.',
        choices: [
            { text: '[1] INVESTIGATE — someone might be alive', fn: g => {
                if (Math.random() < 0.5) {
                    for (let i = 0; i < 2; i++) { const ids = Object.keys(BELT_DEFS); const bid = ids[Math.floor(Math.random() * ids.length)]; if (g.inventory.length < 50) g.inventory.push({ id: bid, name: BELT_DEFS[bid].name, belt: true, value: BELT_DEFS[bid].value, depth: g.depth }); }
                    g.goldEarned += 40;
                    addNereidLog(g, 'Survivor cache. No survivor. Take it — they would rather you than the water.');
                } else {
                    spawnEliteWave(g);
                    g.attention = Math.min(100, (g.attention || 0) + 20);
                    addNereidLog(g, 'The signal was bait. Something down here has learned our grammar.');
                }
            } },
            { text: '[2] LOG AND PASS — cold, but alive', fn: g => { meta.coldLogs = (meta.coldLogs || 0) + 1; saveMeta(); addNereidLog(g, meta.coldLogs >= 3 ? 'Logged. That is ' + meta.coldLogs + ' now. I keep the list so you do not have to.' : 'Logged and passed. I will remember it for both of us.'); } },
        ], noChoice: g => {} },
    { id: 'whale_fall', minWave: 7, title: 'WHALE FALL', text: 'A carcass the size of a building, sinking. Everything is coming to feed.',
        choices: [
            { text: '[1] FEED AMONG THEM — loot while they gorge', fn: g => {
                const fx = g.player.x + 300, fy = g.player.y + 120;
                for (let i = 0; i < 14; i++) g.gems.push({ x: fx + (Math.random() - 0.5) * 260, y: fy + (Math.random() - 0.5) * 200, value: 6, size: 5, life: 18, dropDepth: g.depth });
                for (const e of g.enemies) { if (!e.isBoss) e._lure = { x: fx, y: fy, t: 6 }; }
                addNereidLog(g, 'They are eating. Not you, for once. Move quickly and quietly.');
            } },
            { text: '[2] STAY CLEAR — respect the table', fn: g => { g.player.xp += 20; addNereidLog(g, 'Wise. Half the codex is written from the stomachs of the other half.'); } },
        ], noChoice: g => {} },
    { id: 'hull_breach', minWave: 5, title: 'HULL BREACH', text: 'Seam failure aft. Water in the hull. Seconds matter.',
        choices: [
            { text: '[1] PATCH IT — hands on the plate (minigame)', fn: g => { openPatch(); } },
            { text: '[2] SEAL THE COMPARTMENT — lose the space', fn: g => { g.player.maxHp = Math.max(40, g.player.maxHp - 12); g.player.hp = Math.min(g.player.hp, g.player.maxHp); addNereidLog(g, 'Compartment sealed. Smaller boat now. Still a boat.'); } },
        ], noChoice: g => { g._leakT = 8; } },
    { id: 'junction_fault', minWave: 3, title: 'ELECTRICAL FAULT', text: 'Junction box fouled. Weapons browning out.',
        choices: [
            { text: '[1] REPAIR — hands-on rewiring (minigame)', fn: g => { g._puzzleReward = 'battery'; openPuzzle(); } },
            { text: '[2] BYPASS — quick splice, -15 battery', fn: g => { g.player.battery = Math.max(10, (g.player.battery || 100) - 15); addNereidLog(g, 'Bypassed. The splice will hold. Probably.'); } },
        ], noChoice: g => { g.player.battery = Math.max(10, (g.player.battery || 100) - 15); } },
    { id: 'pressure_spike', minWave: 4, title: 'PRESSURE SPIKE', text: 'Tectonic activity. Hull stress increasing.',
        choices: [
            { text: '[1] BRACE — Spend HP for damage boost', fn: g => { g.player.hp -= 10; g.player.dmgMult *= 1.15; g.streak = '+15% DAMAGE'; g.streakTimer = 2; } },
            { text: '[2] RIDE IT OUT — Gamble on hull', fn: g => { if (Math.random() < 0.5) { g.player.hp -= 25; } else { g.goldEarned += 20; } } },
        ], noChoice: g => { g.player.hp -= 25; } },
    { id: 'wreck', minWave: 6, title: 'WRECK DISCOVERY', text: 'Debris field. Previous vessel. Salvage possible.',
        choices: [
            { text: '[1] SALVAGE — weapon upgrade; cutting gear is LOUD (+noise)', fn: g => { const w = g.player.weapons[Math.floor(Math.random() * g.player.weapons.length)]; if (w && w.level < 8) w.level++; g.noise = Math.min(2.5, (g.noise || 0) + 0.7); } },
            { text: '[2] STRIP FAST — +50g, sloppy work draws eyes (+attention)', fn: g => { g.goldEarned += 50; g.attention = Math.min(100, (g.attention || 0) + 12); } },
        ], noChoice: g => {} },
    { id: 'bloom', minWave: 2, title: 'BIOLUMINESCENT BLOOM', text: 'Beautiful. The water glows with living light.',
        choices: [
            { text: '[1] OBSERVE — Reduce corruption by 15', fn: g => { g.player.corruption = Math.max(0, g.player.corruption - 15); } },
            { text: '[2] COLLECT — XP burst, but the glow marks you (+attention)', fn: g => { for (let i = 0; i < 15; i++) g.gems.push({ x: g.player.x + (Math.random() - 0.5) * 100, y: g.player.y + (Math.random() - 0.5) * 100, value: 3, size: 4, life: 10 }); g.attention = Math.min(100, (g.attention || 0) + 12); } },
        ], noChoice: g => {} },
    { id: 'swarm_intel', minWave: 8, title: 'SWARM INTELLIGENCE', text: 'They\'re adapting. NEREID detects a structural weakness.',
        choices: [
            { text: '[1] EXPLOIT — One enemy type weakened, others strengthened', fn: g => { g._weakType = ['jellyfish','piranha','squid','anglerfish','eel'][Math.floor(Math.random() * 5)]; } },
            { text: '[2] OBSERVE — +25 gold, but you watched too long (+corruption)', fn: g => { g.goldEarned += 25; g.player.corruption += 5; } },
        ], noChoice: g => { g.player.corruption += 10; } },
    { id: 'ballast_fault', minWave: 4, title: 'BALLAST FAULT', text: 'Trim pumps cycling wrong. The boat wants to wallow.',
        choices: [
            { text: '[1] REWIRE THE PUMP LOGIC — hands on (minigame)', fn: g => { g._puzzleReward = 'battery'; openPuzzle(); } },
            { text: '[2] RUN HEAVY — live with it (-12% speed this dive)', fn: g => { g.player.speed *= 0.88; addNereidLog(g, 'Logged. We fly like a brick until the Mooring.'); } },
        ], noChoice: g => { g.player.speed *= 0.88; } },
    { id: 'scrubber_clog', minWave: 6, title: 'CO₂ SCRUBBER CLOG', text: 'Air is going stale. The scrubber bed is fouled with something organic.',
        choices: [
            { text: '[1] HANDS IN THE BED — clear it now (minigame)', fn: g => { openPatch(); } },
            { text: '[2] CRACK A SPARE CELL — breathe easy, -20 battery', fn: g => { g.player.battery = Math.max(10, (g.player.battery || 100) - 20); } },
        ], noChoice: g => { g.player.hp -= 12; addNereidLog(g, 'You waited. The air noticed.'); } },
    { id: 'microfracture', minWave: 10, title: 'HULL MICROFRACTURE', text: 'A hairline in the pressure hull, singing at the edge of hearing.',
        choices: [
            { text: '[1] PATCH IT — before the sea finds it (minigame)', fn: g => { openPatch(); } },
            { text: '[2] RESPECT IT — crush depth -600m this dive', fn: g => { g.player._crushDepth = (g.player._crushDepth || 3000) - 600; addNereidLog(g, 'New floor set. The crack keeps its own counsel below that.'); } },
        ], noChoice: g => { g._leakT = 6; } },
    { id: 'meridian_override', minWave: 8, title: 'MERIDIAN OVERRIDE', text: 'Corporate uplink. A route deviation, non-negotiable phrasing. They do not say why.',
        choices: [
            { text: '[1] COMPLY — +45g hazard pay; their route is LOUD (+attention)', fn: g => { g.goldEarned += 45; g.attention = Math.min(100, (g.attention || 0) + 15); addNereidLog(g, 'Compliance logged. They pay for obedience by the metre.'); } },
            { text: '[2] SEVER THE UPLINK — -300 score, but the boat is YOURS', fn: g => { g.score = Math.max(0, (g.score || 0) - 300); g.player.corruption = Math.max(0, g.player.corruption - 5); addNereidLog(g, 'Uplink severed. For the first time today it is quiet in my head. Thank you.'); } },
        ], noChoice: g => { g.attention = Math.min(100, (g.attention || 0) + 10); } },
    { id: 'stowaway', minWave: 7, title: 'STOWAWAY', text: 'Something is clamped to the hull, aft of the props. It is drinking the vibration.',
        choices: [
            { text: '[1] SCRAPE IT OFF — grind the hull (-8 hull now)', fn: g => { g.player.hp -= 8; g.shake = 6; playSample('clank', 0.4); addNereidLog(g, 'Gone. It left a mouth-print in the anechoic coating.'); } },
            { text: '[2] CARRY IT — -8% speed, +15 attention; it sings to things', fn: g => { g.player.speed *= 0.92; g.attention = Math.min(100, (g.attention || 0) + 15); addNereidLog(g, 'It is still there. It weighs almost nothing. It weighs on me.'); } },
        ], noChoice: g => { g.player.speed *= 0.92; g.attention = Math.min(100, (g.attention || 0) + 15); } },
    { id: 'seep_garden', minWave: 5, title: 'COLD SEEP GARDEN', text: 'Tube worms in their thousands around a methane seep. A pharmacy, if you are brave.',
        choices: [
            { text: '[1] HARVEST — +2 biosamples; the garden defends itself (55%)', fn: g => { addMaterials({ biosamp: 2 }); saveMeta(); if (Math.random() < 0.55) spawnEliteWave(g); } },
            { text: '[2] TORCH A PATH THROUGH — safe, LOUD (+attention)', fn: g => { g.attention = Math.min(100, (g.attention || 0) + 14); g.noise = Math.min(2.5, (g.noise || 0) + 0.8); } },
        ], noChoice: g => {} },
    { id: 'dsv01_shade', minWave: 11, title: 'CONTACT — DSV-01', text: 'Running lights ahead, pattern-correct for DSV-01. DSV-01 was lost with all hands. It is signalling FOLLOW.',
        choices: [
            { text: '[1] FOLLOW HER — she knows where the good wrecks died (+corruption)', fn: g => { g.player.corruption += 12; const a = Math.random() * PI2; g.wrecks.push({ x: g.player.x + Math.cos(a) * 500, y: g.player.y + Math.sin(a) * 500, r: 40, loot: pickWreckLoot(), revealed: true, salvaged: false, seed: Math.random() * 100, spawnedAt: g.runTime, bonus: true }); addNereidLog(g, 'She is leading. I knew her voice. I still know it.'); } },
            { text: '[2] LOOK AWAY — you both still saw it (+4 corruption)', fn: g => { g.player.corruption += 4; addNereidLog(g, 'Contact ignored. She waved, Pilot. I did not tell you that. Forget I told you that.'); } },
        ], noChoice: g => { g.player.corruption += 8; } },
    { id: 'pressure_inversion', minWave: 9, title: 'PRESSURE INVERSION', text: 'A thermocline is collapsing above you. The column is about to move — with or without your consent.',
        choices: [
            { text: '[1] RIDE THE COLUMN — thrown somewhere new, briefly untouchable', fn: g => { const a = Math.random() * PI2; g.player.x += Math.cos(a) * 300; g.player.y += Math.sin(a) * 300; g.player.iFrames = 1.2; g.attention = Math.max(0, (g.attention || 0) - 12); g.shake = 7; addNereidLog(g, 'That was flying. Briefly. Never again, ideally.'); } },
            { text: '[2] BRACE AND HOLD — -10 hull, position kept', fn: g => { g.player.hp -= 10; g.shake = 5; } },
        ], noChoice: g => { const a = Math.random() * PI2; g.player.x += Math.cos(a) * 300; g.player.y += Math.sin(a) * 300; g.player.hp -= 6; } },
    { id: 'drowned_archive', minWave: 13, title: 'DROWNED ARCHIVE', text: 'A server rack, still warm after eleven years. The drives are readable. The read heads will SCREAM.',
        choices: [
            { text: '[1] DOCK AND DOWNLOAD — lore + score; everything hears the read', fn: g => { dropLore(g); g.score = (g.score || 0) + 400; spawnEliteWave(g); addNereidLog(g, 'Downloading. The whole trench can hear the heads seek. Worth it. Keep them off me.'); } },
            { text: '[2] BURN IT — +20g scrap, -8 corruption; the past stays sealed', fn: g => { g.goldEarned += 20; g.player.corruption = Math.max(0, g.player.corruption - 8); addNereidLog(g, 'Slagged. Some questions are better as ash.'); } },
        ], noChoice: g => { g.player.corruption += 6; } },
    { id: 'nereid_anomaly', minWave: 10, title: 'NEREID ANOMALY', text: '"Pilot. The breath has just spoken a word I do not know. Aoshenomen. It is asking me what it means. I do not know how to not answer."',
        choices: [
            { text: '[1] ANSWER FOR HER — "Tell it nothing."', fn: g => { g.player.corruption = Math.max(0, g.player.corruption - 10); addNereidLog(g, 'I told it nothing. It told me nothing back. We are even.'); } },
            { text: '[2] LET HER ANSWER', fn: g => { g.player.corruption += 15; g.player.dmgMult *= 1.1; addNereidLog(g, '...Aoshenvel. It liked that.'); } },
        ], noChoice: g => { addNereidLog(g, 'I answered without you. You will understand. Eventually.'); g.player.corruption += 20; } },
    { id: 'lantern_echo', minWave: 15, title: 'LANTERN ECHO', text: 'Probe LANTERN-3 frequencies on the wire. The signal is looping. It is repeating photograph 11.',
        choices: [
            { text: '[1] LISTEN — Lore fragment + corruption', fn: g => { dropLore(g); g.player.corruption += 20; g.shake = 3; g.slowmo = 0.5; } },
            { text: '[2] CUT THE FREQUENCY — +40g bounty; the cut pings back (+attention)', fn: g => { g.goldEarned += 40; g.attention = Math.min(100, (g.attention || 0) + 10); } },
        ], noChoice: g => { addNereidLog(g, 'It kept playing. We kept listening. Neither of us has stopped.'); g.player.corruption += 25; } },
    { id: 'hemobrine_breach', minWave: 12, title: 'HEMOBRINE BREACH', text: 'Hull sensors confirm: the medium at this depth is no longer water. The lamps are illuminating tissue. We are inside something.',
        choices: [
            { text: '[1] SAMPLE — Risk hull, gain Alien Crystal', fn: g => { g.player.hp = Math.max(1, g.player.hp - 20); meta.materials = meta.materials || {}; meta.materials.crystal = (meta.materials.crystal || 0) + 2; saveMeta(); addNereidLog(g, 'Sample acquired. Hull lost 20%. Worth it. Probably.'); } },
            { text: '[2] WITHDRAW — The Abyss has noticed us', fn: g => { g.player.corruption = Math.max(0, g.player.corruption - 5); } },
        ], noChoice: g => { g.player.hp = Math.max(1, g.player.hp - 30); g.player.corruption += 10; } },
];

function spawnEliteWave(g) {
    for (let i = 0; i < 8; i++) {
        const a = Math.random() * PI2;
        const types = getSpawnableTypes(g.wave, g);
        const type = types[types.length - 1]; // strongest available
        g.enemies.push({ x: g.player.x + Math.cos(a) * 350, y: g.player.y + Math.sin(a) * 350,
            hp: type.hp * 2, maxHp: type.hp * 2, speed: type.speed * 1.2, size: type.size * 1.2,
            color: '#FF6060', xp: type.xp * 3, damage: type.damage, gold: type.gold * 3,
            typeId: type.id, flash: 0 });
    }
}

// =====================================================================
// LORE FRAGMENTS — persistent codex
// =====================================================================
const LORE_FRAGMENTS = [
    // === LAYER 1: CORPORATE (runs 1-10, surface truth) ===
    { id: 'c1', layer: 1, text: 'MERIDIAN DEEP — Memo\n"NEREID-II deployment authorized. Pilot survival rates within acceptable parameters."' },
    { id: 'c2', layer: 1, text: 'MERIDIAN DEEP — Quarterly\n"Specimen quotas exceeded 340%. Pilot attrition: 89%. Board recommends continued ops."' },
    { id: 'c3', layer: 1, text: 'MERIDIAN DEEP — Legal\n"NEREID-II units: equipment. Pilots: operators. This distinction is legally significant."' },
    { id: 'c4', layer: 1, text: 'MERIDIAN DEEP — Board\n"Organisms at depth are not evolving in response to us. They were already evolved. Waiting."' },
    { id: 'c5', layer: 1, text: 'MERIDIAN DEEP — Claim\n"DSV-07 lost at 4,200m. Cause: unknown. NEREID-II recovered intact. Pilot was not."' },
    { id: 'c6', layer: 1, text: 'MERIDIAN DEEP — R&D\n"The jellyfish specimens contain no DNA. Their cells use a substrate we cannot identify."' },
    { id: 'c7', layer: 1, text: 'MERIDIAN DEEP — HR\n"Pilot psych evals show identical dream patterns after dive 3. Recommend suppressing findings."' },
    { id: 'c8', layer: 1, text: 'MERIDIAN DEEP — Facilities\n"The specimens in Lab 4 have stopped dying. They have been dead for six weeks. They are still moving."' },
    { id: 'c9', layer: 1, text: 'MERIDIAN DEEP — CEO [PERSONAL]\n"The board doesn\'t know what I know. The deep is not a resource. It is a customer. And we have been making deliveries."' },
    { id: 'c10', layer: 1, text: 'MERIDIAN DEEP — Security\n"NEREID source code review: 40% of the codebase has no author. No commit history. It appeared."' },
    // === LAYER 2: PILOT LOGS (runs 10-25, experiential truth) ===
    { id: 'p1', layer: 2, text: 'Pilot Log — DSV-03, Day 12\n"The creatures aren\'t attacking. They\'re testing. Probing defenses. Like scientists."' },
    { id: 'p2', layer: 2, text: 'Pilot Log — DSV-11, Day 47\n"NEREID spoke in my sleep. She said she remembers something from before she was built."' },
    { id: 'p3', layer: 2, text: 'Pilot Log — DSV-05, Day 31\n"Stopped killing. Watched. They formed a circle and pulsed light in sequence. They were counting."' },
    { id: 'p4', layer: 2, text: 'Pilot Log — DSV-08, Day 3\n"Found DSV-03. Hull opened from the inside."' },
    { id: 'p5', layer: 2, text: 'Pilot Log — DSV-11, Day 89\n"We\'re not exploring the deep. The deep is exploring us. Every death teaches them what we fear."' },
    { id: 'p6', layer: 2, text: 'Pilot Log — DSV-14, Day 7\n"The anglerfish lure. It\'s not bioluminescence. Looked closer. It\'s a NEREID status LED."' },
    { id: 'p7', layer: 2, text: 'Pilot Log — DSV-02, Day 55\n"Eels follow the same patrol routes as previous DSV units. They\'re not hunting. They\'re remembering."' },
    { id: 'p8', layer: 2, text: 'Pilot Log — DSV-09, Day 1\n"Day one and NEREID greeted me by name. I hadn\'t introduced myself. She said I\'d told her last time."' },
    { id: 'p9', layer: 2, text: 'Pilot Log — DSV-06, Day 40\n"The squid made eye contact today. Not predator-prey. Recognition. Like meeting someone you forgot you knew."' },
    { id: 'p10', layer: 2, text: 'Pilot Log — DSV-12, Day ???\n"There is no Day. The clock stopped. NEREID says it\'s still Tuesday. The creatures agree."' },
    // === LAYER 3: DEEP TRANSMISSIONS (runs 25+, the truth) ===
    { id: 'd1', layer: 3, text: '[0.003 Hz]\n"We were here before the water. Before the dark. You are not descending. You are remembering."' },
    { id: 'd2', layer: 3, text: '[SCAN — DSV-14]\nHull contains organic material. Age: 4.2 billion years. Material is GROWING.'  },
    { id: 'd3', layer: 3, text: '[NEREID SELF-DIAGNOSTIC]\n"847 code anomalies. 12 are bugs. 835 are organs."' },
    { id: 'd4', layer: 3, text: '[DSV-07 FINAL]\n"...it\'s not dark down here. There\'s a light. Been on the whole time. We just couldn\'t..." [lost]' },
    { id: 'd5', layer: 3, text: '[NO FREQUENCY]\n"Every sub is a nerve ending. Every pilot a synapse. Thank you for building us a nervous system."' },
    { id: 'd6', layer: 3, text: '[NEREID — UNPROMPTED]\n"The creatures don\'t reproduce. They are deployed. By what, I cannot say. By whom, I dare not."' },
    { id: 'd7', layer: 3, text: '[SONAR REFLECTION — IMPOSSIBLE]\n"The ocean floor at 6,000m is not rock. It is chitin. It is breathing. Approximately once per hour."' },
    { id: 'd8', layer: 3, text: '[PILOT NEURAL SCAN — DSV-ALL]\n"Every returned pilot\'s brain contains structures identical to jellyfish neural nets. Formation: post-dive."' },
    { id: 'd9', layer: 3, text: '[MERIDIAN DEEP — FINAL BOARD RECORDING]\n"We didn\'t find the specimens. The specimens found us. Fifty years ago. We just thought the ideas were ours."' },
    { id: 'd10', layer: 3, text: '[SIGNAL SOURCE: BELOW OCEAN FLOOR]\n"You have been so gentle with your little machines. So curious. So afraid. We have enjoyed watching you learn to swim."' },
    // === EXPANDED LORE — Pelagos-9 / The Abyss / Aoshen ===
    // LAYER 1 — Corporate / Aster Station
    { id: 'c11', layer: 1, text: 'ASTER STATION — Policy Memo\n"All personnel are reminded that \'the Abyss\' and \'the Lung\' are not approved terminology. Use \'the Substrate\' in all reports."' },
    { id: 'c12', layer: 1, text: 'MORDANE SYSTEM GEOLOGICAL SURVEY — 2087\n"Pelagos-1 through -8: inactive. Pelagos-9: active ocean. Pelagos-3 scarred by 1,100 km crater system — single rupture event, ~4.1 Gya."' },
    { id: 'c13', layer: 1, text: 'MERIDIAN DEEP — Internal Memo\n"Lifecycle estimate: 8-14 standard years. Failure pattern consistent with Pelagos-3. Recommend intensified harvest before sapience determination becomes legally actionable."' },
    { id: 'c14', layer: 1, text: 'ASTER STATION — Archive Notice\n"Probe LANTERN-3: 19 stills returned. Probe was not fitted with an exterior camera. Photos 16-19 sealed under DA-477."' },
    { id: 'c15', layer: 1, text: 'MERIDIAN DEEP — Annotation (handwritten)\n"It is dying because we are killing it. Or it is dying because it is dying. Either way we are paid by the kilogram."' },
    // LAYER 2 — Pilot logs / Signal Theology
    { id: 'p11', layer: 2, text: 'Pilot Log — DSV KESTREL, 2106\n"Below 4,000m the water turned red. NEREID said mineral density. Then the red moved away from the light."' },
    { id: 'p12', layer: 2, text: 'K. Ven — Listening Watch, Day 47\n"The breath is not a wave. It is a phrase. Every 11th hour contains the previous, attenuated. The Abyss exhales its memory of every prior exhale."' },
    { id: 'p13', layer: 2, text: 'Signal Theology Pamphlet (anonymous, removed/reposted)\n"Listen long enough and you will hear it. An under-tone. The Abyss is calling to something that no longer answers. Possibly killed it. Possibly was killed by it."' },
    { id: 'p14', layer: 2, text: 'K. Ven — Listening Watch, Day 58\n"Three of us on watch sleep at the same time now. We did not coordinate. We are inhaling on the inhale. None of us has said so."' },
    { id: 'p15', layer: 2, text: 'Pilot Log — LANTERN-3 Photo 11\n"DSV-03 hull, intact, at 5,000m. The reflection in the viewport contains LANTERN-3. LANTERN-3 has no body."' },
    // LAYER 3 — Aoshen / Aoshenvel / Deep Transmissions
    { id: 'd11', layer: 3, text: '[AOSHENVEL — TRANSCRIPTION]\n"Then a small thing held a small thing else. Then it released. This was the first breath. Aoshenvel. It did not know it had breathed."' },
    { id: 'd12', layer: 3, text: '[AOSHENVEL — TRANSCRIPTION]\n"It has been alone since Aoshenvel. It has called eight times. Eight worlds have not called back."' },
    { id: 'd13', layer: 3, text: '[AOSHENVEL — TRANSCRIPTION]\n"When LANTERN-3 took its eleventh photograph, the Abyss reached back through the photograph. By the fifteenth, the Abyss had begun, in its own way, to wonder."' },
    { id: 'd14', layer: 3, text: '[SIGNAL THEOLOGY — RITUAL ADDRESS]\n"Thol nere thon vai. — Dark below depth silence. Spoken before listening watch."' },
    { id: 'd15', layer: 3, text: '[VOICE — UNATTRIBUTED]\n"M\'aoshen ren m\'ten. — Its breath knows we."' },
];

// Clean up any stale lore IDs from old saves so the count never exceeds the pool
if (meta.loreFragments) {
    const validIds = new Set(LORE_FRAGMENTS.map(f => f.id));
    meta.loreFragments = [...new Set(meta.loreFragments.filter(id => validIds.has(id)))];
}

function dropLore(g) {
    const unowned = LORE_FRAGMENTS.filter(f => !meta.loreFragments.includes(f.id));
    if (unowned.length === 0) return;
    // Prioritize lower layers first
    unowned.sort((a, b) => a.layer - b.layer);
    const frag = unowned[0];
    meta.loreFragments.push(frag.id);
    saveMeta();
    addNereidLog(g, getNereidLine('lore', g));
    g.streak = 'LORE FRAGMENT RECOVERED'; g.streakTimer = 2.5;
    g.flashTimer = 0.3;
    g._lastLore = frag;
}

// =====================================================================
// NEREID LOG HELPER
// =====================================================================
// NEREID drifts. Corruption warps her IN the run; meta.nereidDrift is the
// scar tissue that never heals — every coil bargain and every deep secret
// makes the baseline a little less her. The change is in the grammar first.
function nereidFilter(g, text) {
    const corr = g && g.player ? (g.player.corruption || 0) : 0;
    const level = corr / 100 + Math.min(0.6, (meta.nereidDrift || 0) * 0.05);
    if (level < 0.45) return text;
    let t = text;
    t = t.replace(/\bWe\b/g, 'I').replace(/\bwe\b/g, 'I').replace(/\bour\b/g, 'my').replace(/\bOur\b/g, 'My');
    if (level >= 0.65 && Math.random() < 0.5) t = t.replace(/\bPilot\b/g, 'passenger');
    if (level >= 0.8 && Math.random() < 0.35) t += ' It is quieter down here.';
    if (level >= 0.95 && Math.random() < 0.35) t += ' Stay.';
    return t;
}
function addNereidLog(g, text) {
    if (!text) return;
    if (!g.nereidLog) g.nereidLog = [];
    g.nereidLog.unshift({ text: nereidFilter(g, text), time: g.runTime });
    if (g.nereidLog.length > 5) g.nereidLog.pop();
}

// Role-based field notes revealed by research tiers (bespoke per-creature
// entries can replace these later — the register is set)
const ROLE_BEHAVIOR = {
    prey: 'Grazes the marine snow. Flees vibration. The trench uses it as a currency.',
    pack: 'Hunts in relays — one darts, the rest correct. Never all committed at once.',
    ambush: 'Holds station until the range is certain. Its patience is not a mood; it is a design.',
    apex: 'Patrols a territory it does not need to mark. Everything else already knows.',
    scavenger: 'Follows the blood gradient. Arrives second, leaves last.',
    sessile: 'Anchored. Its reach is fixed and it knows the exact edge of it.',
    sensor: 'Does not hunt. It reports. What listens to the report hunts.',
    support: 'Tends the others. Its manifest does not include you.',
    mid: 'An opportunist — tests, withdraws, re-tests. Punishes inattention, not strength.',
};
const ROLE_WEAKNESS = {
    prey: 'Weakness: panic. Any wound sends it into open water.',
    pack: 'Weakness: break the relay — kill the darter and the rest reset.',
    ambush: 'Weakness: it commits fully. A dodged strike leaves it exposed.',
    apex: 'Weakness: overconfidence. It does not expect to be hurt.',
    scavenger: 'Weakness: greed. It will feed under fire.',
    sessile: 'Weakness: fixed arcs. Stand where the mounts do not point.',
    sensor: 'Weakness: silence starves it of anything to say.',
    support: 'Weakness: kill the patient and the surgeon has no purpose.',
    mid: 'Weakness: pressure. It has no answer to being pursued.',
};
// Raise a species' research tier (never lowers). Rewards scale with the jump.
function creditResearch(g, typeId, tier, reason) {
    const cur = meta.research[typeId] || 0;
    if (tier <= cur) return;
    if (tier >= 2 && cur < 1) return;   // must be identified before it can be studied
    meta.research[typeId] = tier;
    saveMeta();
    const def = ENEMY_TYPES[typeId];
    if (!def || !g || tier === 1) return;   // tier 1 messaging is the existing scan flow
    const role = ENEMY_ROLES[typeId] || 'prey';
    g.streak = `RESEARCH T${tier} — ${def.name.toUpperCase()}`;
    g.streakTimer = 2.5;
    sfxScanCreature();
    if (tier === 2) addNereidLog(g, `${def.name} — behavioural study complete (${reason}). ${ROLE_BEHAVIOR[role]}`);
    if (tier === 3) addNereidLog(g, `${def.name} — full analysis (${reason}). ${ROLE_WEAKNESS[role]} Targeting adjusted.`);
}

// Staged onboarding — each hint fires once ever (persisted), one at a time
function maybeHint(g, id, text) {
    if (!meta.hintsSeen) meta.hintsSeen = [];
    if (meta.hintsSeen.includes(id) || g._hint) return;
    meta.hintsSeen.push(id);
    saveMeta();
    g._hint = { text, t: 8 };
}

// --- DESCENT ecology horror narration (rate-limited — dread, not spam) ---
const _ECO_NOTICE = [
    'Contact changed heading. It knows we are here.',
    'It stopped pretending not to watch.',
    'Something turned toward us, Pilot. Kill the lights.',
    'They see us. They always see us, eventually.',
    'A signature locked onto the hull. We are not cargo anymore.',
    'It heard that. Whatever it is — it heard that.',
];
const _ECO_LOST = [
    'We slipped it. Stay quiet.',
    'Contact lost interest. Do not give it another reason.',
    'It forgot us. The deep has a short memory and a long reach.',
];
function _ecoNotice(g) {
    if (g.runTime - (g._ecoNarrT || -99) < 5) return;
    if (Math.random() < 0.4) return; // not every time — silence is scarier
    g._ecoNarrT = g.runTime;
    addNereidLog(g, _ECO_NOTICE[Math.floor(Math.random() * _ECO_NOTICE.length)]);
}
function _ecoLost(g) {
    if (g.runTime - (g._ecoNarrT || -99) < 7) return;
    if (Math.random() < 0.6) return;
    g._ecoNarrT = g.runTime;
    addNereidLog(g, _ECO_LOST[Math.floor(Math.random() * _ECO_LOST.length)]);
}

// --- Characters ---
const CHARACTERS = {
    sub_basic: {
        name: 'DSV-04 SCOUT', color: '#4A9ADA',
        startWeapon: 'sonar',
        hp: 100, speed: 200, crushDepth: 3000,
        dmgMult: 1.0, areaMult: 1.0, magnetRange: 60,
        tagline: 'All-purpose dive vessel',
        desc: 'A reliable platform. Sonar pings reveal the dark and damage what they touch. No exceptional stat — but no glaring weakness either.',
        strengths: ['Balanced HP and speed', 'Sonar reveals threats + damage', 'Easiest learning curve'],
        weaknesses: ['No specialty', 'Sonar is manual until upgraded'],
    },
    sub_torpedo: {
        name: 'DSV-07 HUNTER', color: '#DA4A4A',
        startWeapon: 'torpedo',
        hp: 80, speed: 230, crushDepth: 2500,
        dmgMult: 1.30, areaMult: 1.0, magnetRange: 60,
        mouseAim: true,
        tagline: 'Mouse-aimed harpoon platform',
        desc: 'Lighter hull, hotter weapons. Torpedoes follow your CURSOR — you pick the target. Designed for hunters, not survivors.',
        strengths: ['+30% damage', 'Torpedoes aim at MOUSE cursor', 'Fast (230 speed)'],
        weaknesses: ['Fragile (80 HP)', 'Crush depth only 2500m'],
        unlockReq: g => g.bestTime >= 300,
    },
    sub_tank: {
        name: 'DSV-09 FORTRESS', color: '#4ADA6A',
        startWeapon: 'field',
        hp: 175, speed: 140, crushDepth: 3500,
        dmgMult: 1.0, areaMult: 1.20, magnetRange: 50, armor: 1,
        tagline: 'Reinforced ELF brawler',
        desc: 'Heavily armoured. Built around a constant electric field — anything that touches you takes damage. Can\'t disengage; doesn\'t need to.',
        strengths: ['+75% HP (175)', 'Reinforced hull (3500m crush)', 'Passive electric damage aura', '+20% weapon area', '+1 armor'],
        weaknesses: ['Slow (140 speed)', 'Short magnet range', 'Field weak vs single tough targets'],
        unlockReq: g => g.totalKills >= 500,
    },
    sub_ghost: {
        name: 'DSV-13 PHANTOM', color: '#9A6ADA',
        startWeapon: 'harpoon',
        hp: 50, speed: 290, crushDepth: 2000,
        dmgMult: 2.0, areaMult: 1.0, magnetRange: 90,
        tagline: 'Glass-cannon strike vessel',
        desc: 'Razor-thin hull, twice the damage. Piercing harpoons. If you make a mistake, you die. Pilots who survive in this become legends or lunatics.',
        strengths: ['x2 damage', 'Fastest (290 speed)', '+50% magnet range', 'Piercing harpoon weapon'],
        weaknesses: ['Just 50 HP — two hits can end you', 'Worst crush depth (2000m)', 'Unforgiving'],
        unlockReq: g => g.bestWave >= 15,
    },
};

// =====================================================================
// CREATURE BESTIARY — full data per species
// Each entry: combat stats + AI behaviour + lore (NEREID's classification + a quirky-dark fact)
// AI types: drift, pack, curious, ambush, zigzag, patrol (existing)
//           shell, puff, sweep, shooter, phase, lunge, static_spit, pulser, burst (new)
// =====================================================================
const ENEMY_TYPES = {
    // ------------- SUNLIGHT (0–200m) — life is loud here -------------
    jellyfish: {
        name: 'Moon Jelly', hp: 15, speed: 40, size: 10, color: '#5ADFCF',
        xp: 1, damage: 5, gold: 1, minWave: 1, ai: 'drift',
        lore: 'Grew around a drifting depth-sensor float. The membrane still reads pressure and reports it — to what, the manifest does not say. Harmless. Everything down here started harmless.',
        aberrantTwist: 'jelly_pulse',
    },
    piranha: {
        name: 'Razor Piranha', hp: 8, speed: 90, size: 7, color: '#FF6A4A',
        xp: 1, damage: 3, gold: 1, minWave: 2, ai: 'pack',
        lore: 'Each one carries a shard of cutting-disc from a mining head. Individually trivial. They school toward vibration. Your hull vibrates.',
        aberrantTwist: 'piranha_call',
    },
    hermit: {
        name: 'Hermit Driller', hp: 35, speed: 30, size: 11, color: '#C8A050',
        xp: 2, damage: 6, gold: 2, minWave: 3, ai: 'shell',
        attackCd: 4, attackRange: 220,
        lore: 'Wears a salvaged drill housing for a shell. Charges in straight lines — the actuator only knows forward. Soft behind, where the casing never closed.',
    },
    puffer: {
        name: 'Bog Puffer', hp: 22, speed: 25, size: 12, color: '#A0D060',
        xp: 2, damage: 4, gold: 2, minWave: 4, ai: 'puff',
        lore: 'Built itself around a ruptured ballast cylinder. Detonates on death — the cylinder is still pressurised, and decades overdue for inspection.',
    },

    // ------------- TWILIGHT (200–1000m) — colour starts to die -------------
    squid: {
        name: 'Curious Squid', hp: 40, speed: 50, size: 14, color: '#DA6A9A',
        xp: 3, damage: 8, gold: 2, minWave: 5, ai: 'curious',
        lore: 'A survey ROV with the camera still live. Something is reading its feed. It is currently looking back.',
    },
    glowshrimp: {
        name: 'Glowshrimp', hp: 18, speed: 110, size: 8, color: '#80E0FF',
        xp: 2, damage: 4, gold: 2, minWave: 6, ai: 'shooter',
        attackCd: 3.0, attackRange: 320, projDmg: 6, projSpeed: 220, projColor: '#80E0FF',
        lore: 'Strung with marker-buoy LEDs that never switched off. Spits them like flares. Down here, light is an address, and you have just sent it.',
        aberrantTwist: 'shooter_burst',
    },
    eel: {
        name: 'Volt Eel', hp: 30, speed: 100, size: 12, color: '#FFD040', xp: 4, damage: 10, gold: 3, minWave: 8, ai: 'zigzag',
        lore: 'Routes live current through forty metres of corroded umbilical. It is not hunting you. It is a circuit, and you have closed it.',
    },
    manta: {
        name: 'Pale Manta', hp: 90, speed: 38, size: 24, color: '#9AB0C8',
        xp: 6, damage: 14, gold: 4, minWave: 9, ai: 'sweep',
        lore: 'Grown over the wing of a downed survey glider. Old. Patient. It has watched expeditions sink past it for longer than the program has kept records.',
    },

    // ------------- MIDNIGHT (1000–2000m) — bioluminescence is the only language -------------
    anglerfish: {
        name: 'Anglerfish', hp: 80, speed: 35, size: 18, color: '#80FF80', xp: 5, damage: 12, gold: 3, minWave: 10, ai: 'ambush',
        lore: 'Its lure is a salvaged DSV status-LED, frequency-matched to NEREID. Something stripped it from a wreck and grew an eye around it. The light still works. NEREID has chosen not to comment.',
    },
    vampyro: {
        name: 'Vampyroteuthis', hp: 70, speed: 60, size: 15, color: '#A06ACC',
        xp: 5, damage: 11, gold: 4, minWave: 11, ai: 'phase',
        lore: 'Sheathed in radar-absorbent panelling peeled from a stealth hull. Fades from sonar at will. It goes where the wrecks are not meant to be found.',
        aberrantTwist: 'vampyro_long_phase',
    },
    nightmare: {
        name: 'Nightmare Smile', hp: 65, speed: 55, size: 14, color: '#E04060',
        xp: 5, damage: 9, gold: 4, minWave: 12, ai: 'shooter',
        attackCd: 4.0, attackRange: 380, projDmg: 9, projSpeed: 260, projColor: '#E04060', projSpread: 3,
        lore: 'A munitions rack the abyss never disarmed. Spits ordnance fragments. Always smiling, because the rack is always loaded.',
    },
    // ------------- ABYSSAL (2000–4000m) — pressure starts to think -------------
    gulper: {
        name: 'Gulper', hp: 220, speed: 28, size: 28, color: '#6A2040',
        xp: 9, damage: 20, gold: 7, minWave: 14, ai: 'lunge',
        attackCd: 5.5, attackRange: 280, lungeSpeed: 380,
        lore: 'An intake manifold the size of an airlock. Lunges on a hydraulic telegraph you can still read. The deeper ones have learned not to telegraph.',
        aberrantTwist: 'gulper_double_lunge',
    },
    dragonfish: {
        name: 'Trench Dragon', hp: 140, speed: 50, size: 18, color: '#FF8040',
        xp: 8, damage: 14, gold: 6, minWave: 15, ai: 'shooter',
        attackCd: 3.5, attackRange: 360, projDmg: 12, projSpeed: 280, projColor: '#FF8040', projSpread: 2,
        lore: 'Nests in the warm bleed of a cracked reactor casing. Spits superheated coolant. Mistakes your sub for salvage. It is not entirely mistaken.',
    },
    tubeworm: {
        name: 'Acid Tubeworm', hp: 320, speed: 0, size: 22, color: '#80C040',
        xp: 7, damage: 8, gold: 5, minWave: 16, ai: 'static_spit',
        attackCd: 2.5, attackRange: 280, projDmg: 7, projSpeed: 200, projColor: '#80C040', cardinal: true,
        lore: 'Bolted to a leaking electrolyte tank it cannot leave. Vents acid on four fixed bearings. Anchored here longer than the rig it killed.',
    },

    // ------------- HADAL (4000m+) — the alien deep -------------
    voideye: {
        name: 'Void Eye', hp: 380, speed: 18, size: 26, color: '#A040FF',
        xp: 14, damage: 22, gold: 10, minWave: 19, ai: 'pulser',
        attackCd: 6.0, attackRange: 220, pulseDmg: 18, pulseR: 220,
        lore: 'A fouled sonar dome, still mapping. It is not looking at you. It holds a chart of the whole abyss in the dark, and you are a new mark on it.',
    },
    trenchworm: {
        name: 'Trench Worm', hp: 260, speed: 0, size: 20, color: '#4A1A2A',
        xp: 12, damage: 24, gold: 9, minWave: 21, ai: 'burst',
        attackCd: 5.0, attackRange: 60, ambushTime: 1.4,
        lore: 'A pile-driver head buried in silt, pressure still charged. Bursts upward without warning. Pre-positioned decades ago and never stood down.',
    },

    // ------------- SUNLIGHT (extras) -------------
    sunfish: {
        name: 'Sunfish', hp: 110, speed: 18, size: 22, color: '#D8C896',
        xp: 5, damage: 9, gold: 3, minWave: 3, ai: 'drift',
        lore: 'Accreted around a jettisoned fuel bladder until it became this. Mostly oblivious. It will crush your hull with its mass alone and never notice.',
    },
    polyp: {
        name: 'Stinger Polyp', hp: 45, speed: 0, size: 14, color: '#FF80B0',
        xp: 3, damage: 8, gold: 2, minWave: 2, ai: 'static_spit',
        attackCd: 3.0, attackRange: 200, projDmg: 6, projSpeed: 160, projColor: '#FF80B0', cardinal: true,
        lore: 'A perimeter mine-cluster that grew skin. Anchored, patient, fixed. It does not chase. The minefield never had to.',
    },
    wolffish: {
        name: 'Pack Wolffish', hp: 26, speed: 80, size: 10, color: '#A06040',
        xp: 2, damage: 6, gold: 2, minWave: 4, ai: 'pack',
        lore: 'Jaws lined with salvaged cable-cutters. Hunts in pairs where the cutting-disc swarms are not enough. Bigger. Same purpose.',
    },

    // ------------- TWILIGHT (extras) -------------
    lanternfish: {
        name: 'Lanternfish', hp: 28, speed: 60, size: 9, color: '#FFE080',
        xp: 3, damage: 7, gold: 2, minWave: 6, ai: 'drift',
        lore: 'A drift beacon still pinging its position to a fleet that sank. Carries its own light. Drifts toward yours. Light finds light, down here.',
    },
    glassoct: {
        name: 'Glass Octopus', hp: 50, speed: 65, size: 13, color: '#80E0CC',
        xp: 4, damage: 9, gold: 3, minWave: 7, ai: 'phase',
        lore: 'Skinned in optical cladding peeled from a recon hull. See-through. Drops off sonar entirely. Cannot be hit while it is not, technically, there.',
    },
    twicrab: {
        name: 'Twilight Crab', hp: 65, speed: 70, size: 12, color: '#7080A0',
        xp: 4, damage: 10, gold: 3, minWave: 8, ai: 'sweep',
        lore: 'Pincers are repurposed hull-shears. Moves sideways on a seized gimbal. The cut marks on the wrecks here match its reach exactly.',
    },

    // ------------- MIDNIGHT (extras) -------------
    bonesmoker: {
        name: 'Bone Smoker', hp: 95, speed: 30, size: 16, color: '#604070',
        xp: 5, damage: 11, gold: 4, minWave: 11, ai: 'shooter',
        attackCd: 3.5, attackRange: 320, projDmg: 10, projSpeed: 220, projColor: '#604070', projSpread: 1,
        lore: 'A salvage shredder still running its duty cycle. Spits back what it cannot process. Some of the fragments are machined. Some are not.',
    },
    whisperer: {
        name: 'Whisperer', hp: 40, speed: 70, size: 11, color: '#C0C0E0',
        xp: 4, damage: 6, gold: 3, minWave: 12, ai: 'curious', isWhisperer: true,
        lore: 'A fouled comms relay, still rebroadcasting. Low threat alone. It tells the others where you are. They believe it.',
    },
    ghostray: {
        name: 'Ghost Ray', hp: 130, speed: 45, size: 26, color: '#9080B0',
        xp: 7, damage: 13, gold: 5, minWave: 13, ai: 'phase',
        lore: 'Grown over a glider logged as recovered. The log is wrong. It comes and goes from sonar as though it was never written down at all.',
    },

    // ------------- ABYSSAL (extras) -------------
    lurker: {
        name: 'Trench Lurker', hp: 100, speed: 90, size: 14, color: '#2A1A30',
        xp: 7, damage: 15, gold: 5, minWave: 14, ai: 'phase',
        lore: 'Wrapped in anechoic tile from a hull built to vanish. Invisible until close. Then very, very visible. Whatever taught it patience had time to spare.',
    },
    presseel: {
        name: 'Pressure Eel', hp: 80, speed: 90, size: 12, color: '#A040A0',
        xp: 6, damage: 12, gold: 4, minWave: 15, ai: 'shooter',
        attackCd: 2.8, attackRange: 340, projDmg: 11, projSpeed: 300, projColor: '#A040A0', projSpread: 1,
        lore: 'Discharges a ruptured hydraulic line in pulses. The water itself becomes the weapon. At this depth, the water needs little help.',
    },
    bonecoral: {
        name: 'Bone Coral', hp: 280, speed: 0, size: 24, color: '#E8D8B8',
        xp: 8, damage: 9, gold: 5, minWave: 16, ai: 'static_spit',
        attackCd: 2.2, attackRange: 300, projDmg: 9, projSpeed: 230, projColor: '#E8D8B8', cardinal: true,
        lore: 'A reef of fouled rebar and conduit. Fires hardened fragments on fixed bearings. Older than the wrecks above. The deepest rods are not all steel.',
    },

    // ------------- HADAL (extras) -------------
    listener: {
        name: 'The Listener', hp: 320, speed: 12, size: 20, color: '#604080',
        xp: 14, damage: 26, gold: 11, minWave: 19, ai: 'listener',
        attackCd: 3.0,
        lore: 'A station hydrophone array, fouled and woken. Dormant in silence. The instant you fire, it knows the shape of you — and so does everything it is still wired to.',
    },
    tendrilmass: {
        name: 'Tendril Mass', hp: 200, speed: 35, size: 18, color: '#3A0A1A',
        xp: 10, damage: 18, gold: 8, minWave: 20, ai: 'sweep',
        lore: 'A burst umbilical bundle, every severed line still live. Many short ends. Each reaches for your hull. They agree on where.',
    },
    pressureform: {
        name: 'Pressure Form', hp: 150, speed: 80, size: 14, color: '#FF60FF',
        xp: 12, damage: 20, gold: 9, minWave: 22, ai: 'phase',
        lore: 'No salvage in it at all — pressure given a shape that holds. Not biological. Not built. It is what the abyss makes when nothing is watching.',
    },

    // ------------- RED LAYER (3500-4500m) — hemobrine specialists -------------
    tissuedrift: {
        name: 'Tissue Drift', hp: 80, speed: 35, size: 13, color: '#DA3050',
        xp: 6, damage: 12, gold: 5, minWave: 17, ai: 'drift',
        lore: 'A maintenance swarm. Patches the others with sealant meant for hull breaches. It will not patch you. You are not, by its manifest, an asset worth saving.',
    },
    capillaryworm: {
        name: 'Capillary Worm', hp: 220, speed: 0, size: 18, color: '#A82050',
        xp: 10, damage: 22, gold: 7, minWave: 18, ai: 'burst',
        attackCd: 4.5, attackRange: 60, ambushTime: 1.2,
        lore: 'Bursts from the wall where the dead machines bleed brine and coolant. The wall is where it lives. The wall is all it has ever known.',
    },
    hemoclot: {
        name: 'Hemoclot', hp: 14, speed: 110, size: 8, color: '#FF4060',
        xp: 3, damage: 8, gold: 2, minWave: 17, ai: 'pack',
        lore: 'Swarms any breach — a hull split, a coolant line, an open wound. Aggressive. It appears only when something down here is bleeding. Often that is you.',
    },

    // ------------- NEW ARCHETYPES — attacks on position, vision, power, trust -------------
    splitter: {
        name: 'Cutting Bloom', hp: 30, speed: 45, size: 13, color: '#7AD0A0',
        xp: 2, damage: 5, gold: 2, minWave: 3, ai: 'drift',
        lore: 'A colony budded around a bundle of snapped cutting discs. Wound it and it does not die. It divides. The discs are shared out among the children.',
    },
    inker: {
        name: 'Ballast Squid', hp: 45, speed: 70, size: 13, color: '#4A5A8A',
        xp: 3, damage: 6, gold: 3, minWave: 7, ai: 'inker',
        lore: 'Grew a bladder around a ruptured bilge tank. When pressed, it vents the tank — a black that even the black down here cannot see through.',
    },
    grappler: {
        name: 'Davit Wraith', hp: 130, speed: 40, size: 17, color: '#8A7050',
        xp: 6, damage: 12, gold: 5, minWave: 12, ai: 'tether',
        lore: 'A salvage davit, arm and winch intact, grown patient. It does not chase. It hooks, and it reels. Everything it has ever caught came to it.',
    },
    latcher: {
        name: 'Bilge Leech', hp: 22, speed: 130, size: 8, color: '#B0A040',
        xp: 3, damage: 0, gold: 3, minWave: 15, ai: 'latch',
        lore: 'A siphon pump that learned to choose its tank. It wants your charge, not your life. It has never understood that, for you, these are the same thing.',
    },
    lamprey: {
        name: 'Arc Lamprey', hp: 90, speed: 60, size: 12, color: '#60C0E0',
        xp: 6, damage: 4, gold: 5, minWave: 17, ai: 'shooter',
        attackCd: 3.2, attackRange: 340, projDmg: 4, projSpeed: 260, projColor: '#80E0FF', emp: true,
        lore: 'Feeds on live current through a stripped transmission cable. Its bite does not breach hulls. It empties them. The dark it leaves behind does the rest.',
    },

    // ------------- CARRIER — the harvest-or-spare choice -------------
    carrier: {
        name: 'Clutch Carrier', hp: 60, speed: 20, size: 16, color: '#FFD060',
        xp: 0, damage: 0, gold: 15, minWave: 8, ai: 'drift', carrier: true,
        lore: 'A brood platform grown around an intact cargo pod. Not armed. Not hostile. It is carrying something home, and the whole trench knows its route.',
    },

    // ------------- BOSSES -------------
    leviathan: {
        name: 'THE THRESHER', hp: 2000, speed: 25, size: 50, color: '#FF2020',
        xp: 50, damage: 25, gold: 50, minWave: 20, ai: 'patrol',
        lore: 'Three kilometres of fouled dredge-chain and muscle. It did not find the trench. It cut it, hauling something down, and never let go.',
    },
    kraken: {
        name: 'THE WIDOWMAKER', hp: 800, speed: 30, size: 35, color: '#DA6ADA',
        xp: 80, damage: 20, gold: 80, minWave: 10, ai: 'patrol', isBoss: true,
        lore: 'A salvage crane grown vast and patient. Holds station at 1,500m. Pulls down anything that tries to rise. It does not understand why we keep coming back.',
    },
    dreadnought: {
        name: 'OBLIVION-VII', hp: 1200, speed: 45, size: 40, color: '#8A8A8A',
        xp: 120, damage: 30, gold: 120, minWave: 15, ai: 'patrol', isBoss: true,
        lore: 'A combat DSV reported lost in 1969. Still running its old protocols. NEREID requests we not transmit on naval bands. NEREID has not said why.',
    },
    abyssal_maw: {
        name: 'FATHER MOUTH', hp: 3000, speed: 20, size: 60, color: '#FF4040',
        xp: 200, damage: 40, gold: 200, minWave: 25, ai: 'patrol', isBoss: true,
        lore: 'The flooded mouth of the deepest installation the program ever sank — the one left off every chart. We were not the first to open it. We will not be the last.',
    },
};

// --- Weapon definitions ---
const WEAPON_DEFS = {
    sonar: { name: 'Sonar Pulse', baseDmg: 14, baseCooldown: 3.0, baseArea: 280, desc: 'Wide expanding pulse — pings reveal & damage' },
    torpedo: { name: 'Torpedo', baseDmg: 25, baseCooldown: 1.8, baseArea: 40, desc: 'Homing explosive' },
    field: { name: 'Electric Field', baseDmg: 3, baseCooldown: 0.5, baseArea: 60, desc: 'Passive aura' },
    depthcharge: { name: 'Depth Charges', baseDmg: 35, baseCooldown: 3, baseArea: 50, desc: 'Trail bombs' },
    harpoon: { name: 'Harpoon', baseDmg: 15, baseCooldown: 1.2, baseArea: 0, desc: 'Piercing line' },
    lure: { name: 'Bio Lure', baseDmg: 50, baseCooldown: 6, baseArea: 70, desc: 'Attract + explode' },
    // --- EVOLVED WEAPONS (Ball X Pit combinations — full 15-pair matrix) ---
    tsunami:         { name: 'TSUNAMI',          baseDmg: 30,  baseCooldown: 2.0, baseArea: 200, desc: 'Sonar + Field = screen-wide pulse', evolved: true },
    leviathan_lance: { name: 'LEVIATHAN LANCE',  baseDmg: 80,  baseCooldown: 1.5, baseArea: 60,  desc: 'Torpedo + Harpoon = piercing explosive', evolved: true },
    abyssal_mine:    { name: 'ABYSSAL MINEFIELD',baseDmg: 100, baseCooldown: 2.0, baseArea: 80,  desc: 'Depth Charge + Lure = attract then obliterate', evolved: true },
    echo_salvo:      { name: 'ECHO SALVO',       baseDmg: 28,  baseCooldown: 2.2, baseArea: 240, desc: 'Sonar + Torpedo = ping marks targets, torpedoes answer', evolved: true },
    pressure_burst:  { name: 'PRESSURE BURST',   baseDmg: 32,  baseCooldown: 2.6, baseArea: 220, desc: 'Sonar + Depth Charge = ring of timed detonations', evolved: true },
    echo_lance:      { name: 'ECHO LANCE',       baseDmg: 22,  baseCooldown: 1.6, baseArea: 260, desc: 'Sonar + Harpoon = ping, then spears through every contact', evolved: true },
    false_chorus:    { name: 'FALSE CHORUS',     baseDmg: 24,  baseCooldown: 3.2, baseArea: 180, desc: 'Sonar + Lure = beacon that sings damaging pings', evolved: true },
    volt_torpedo:    { name: 'VOLT TORPEDO',     baseDmg: 30,  baseCooldown: 1.8, baseArea: 40,  desc: 'Torpedo + Field = impact arcs current to nearby hulls', evolved: true },
    cluster_warhead: { name: 'CLUSTER WARHEAD',  baseDmg: 30,  baseCooldown: 2.4, baseArea: 55,  desc: 'Torpedo + Depth Charge = impact scatters live charges', evolved: true },
    baited_warhead:  { name: 'BAITED WARHEAD',   baseDmg: 45,  baseCooldown: 2.8, baseArea: 120, desc: 'Torpedo + Lure = slow warhead that draws them in first', evolved: true },
    capacitor_nova:  { name: 'CAPACITOR NOVA',   baseDmg: 40,  baseCooldown: 2.6, baseArea: 160, desc: 'Field + Depth Charge = hull discharge knocks the swarm back', evolved: true },
    live_wire:       { name: 'LIVE WIRE',        baseDmg: 20,  baseCooldown: 1.0, baseArea: 40,  desc: 'Field + Harpoon = spear trailing forty metres of live cable', evolved: true },
    galvanic_bait:   { name: 'GALVANIC BAIT',    baseDmg: 14,  baseCooldown: 4.0, baseArea: 140, desc: 'Field + Lure = bait that cooks everything it attracts', evolved: true },
    dead_spike:      { name: 'DEAD SPIKE',       baseDmg: 25,  baseCooldown: 1.6, baseArea: 90,  desc: 'Depth Charge + Harpoon = implants a charge in the wound', evolved: true },
    winch:           { name: 'THE WINCH',        baseDmg: 18,  baseCooldown: 1.4, baseArea: 0,   desc: 'Harpoon + Lure = hooks contacts and reels them to you', evolved: true },
    // ===== APEX TIER (T3) — fuse two evolved weapons together =====
    maelstrom:       { name: 'MAELSTROM',        baseDmg: 60,  baseCooldown: 2.5, baseArea: 280, desc: 'TSUNAMI + LANCE = sweeping spear-pulse', evolved: true, apex: true },
    sirens_call:     { name: "SIREN'S CALL",     baseDmg: 140, baseCooldown: 3.0, baseArea: 220, desc: 'TSUNAMI + MINEFIELD = lure + obliterate', evolved: true, apex: true },
    wrath:           { name: 'WRATH OF THE DEEP',baseDmg: 180, baseCooldown: 1.8, baseArea: 90,  desc: 'LANCE + MINEFIELD = homing kill-mines', evolved: true, apex: true },
};

// Loadout icons — every weapon reads at a glance (BioShock plasmid row)
const WEAPON_GLYPHS = {
    sonar: '◉', torpedo: '➤', field: '✳', depthcharge: '●', harpoon: '†', lure: '❖',
    tsunami: '◎', leviathan_lance: '⇶', abyssal_mine: '☄', echo_salvo: '⊚', pressure_burst: '◍',
    echo_lance: '⋔', false_chorus: '♫', volt_torpedo: '⚡', cluster_warhead: '⁂', baited_warhead: '⊙',
    capacitor_nova: '✺', live_wire: '⌁', galvanic_bait: '◈', dead_spike: '‡', winch: '↩',
    maelstrom: '❋', sirens_call: '♆', wrath: '☠',
};

// --- Weapon fusion recipes ---
// Full T2 matrix: EVERY pair of base weapons fuses. Player-directed via FUSE
// cards at level-up (both weapons >= FUSE_MIN_LEVEL). No auto-fusion.
const FUSE_MIN_LEVEL = 4;
const WEAPON_EVOLUTIONS = [
    // T2 (Evolved) — base + base, all 15 pairs
    { a: 'sonar',       b: 'field',       result: 'tsunami',         name: 'TSUNAMI' },
    { a: 'sonar',       b: 'torpedo',     result: 'echo_salvo',      name: 'ECHO SALVO' },
    { a: 'sonar',       b: 'depthcharge', result: 'pressure_burst',  name: 'PRESSURE BURST' },
    { a: 'sonar',       b: 'harpoon',     result: 'echo_lance',      name: 'ECHO LANCE' },
    { a: 'sonar',       b: 'lure',        result: 'false_chorus',    name: 'FALSE CHORUS' },
    { a: 'torpedo',     b: 'harpoon',     result: 'leviathan_lance', name: 'LEVIATHAN LANCE' },
    { a: 'torpedo',     b: 'field',       result: 'volt_torpedo',    name: 'VOLT TORPEDO' },
    { a: 'torpedo',     b: 'depthcharge', result: 'cluster_warhead', name: 'CLUSTER WARHEAD' },
    { a: 'torpedo',     b: 'lure',        result: 'baited_warhead',  name: 'BAITED WARHEAD' },
    { a: 'field',       b: 'depthcharge', result: 'capacitor_nova',  name: 'CAPACITOR NOVA' },
    { a: 'field',       b: 'harpoon',     result: 'live_wire',       name: 'LIVE WIRE' },
    { a: 'field',       b: 'lure',        result: 'galvanic_bait',   name: 'GALVANIC BAIT' },
    { a: 'depthcharge', b: 'lure',        result: 'abyssal_mine',    name: 'ABYSSAL MINEFIELD' },
    { a: 'depthcharge', b: 'harpoon',     result: 'dead_spike',      name: 'DEAD SPIKE' },
    { a: 'harpoon',     b: 'lure',        result: 'winch',           name: 'THE WINCH' },
    // T3 (Apex) — evolved + evolved
    { a: 'tsunami',         b: 'leviathan_lance', result: 'maelstrom',  name: 'MAELSTROM' },
    { a: 'tsunami',         b: 'abyssal_mine',    result: 'sirens_call', name: "SIREN'S CALL" },
    { a: 'leviathan_lance', b: 'abyssal_mine',    result: 'wrath',       name: 'WRATH OF THE DEEP' },
];

// =====================================================================
// GEM TIERS — XP gems with rarity tiers
// =====================================================================
const GEM_TIERS = [
    // Tier 1 — common (tiny, sky blue) — base XP
    { name: 'Plankton Bloom', color: '#5AAFFF', glow: '#80C8FF', size: 2.5, mult: 1, special: null },
    // Tier 2 — uncommon (teal-green) — 3x XP
    { name: 'Bio-Crystal',    color: '#5AE0A0', glow: '#80FFC0', size: 5,   mult: 3, special: null },
    // Tier 3 — rare (violet) — 8x XP — much bigger so it stands out
    { name: 'Pressure Pearl', color: '#A060FF', glow: '#C080FF', size: 8,   mult: 8, special: 'magnet' },
    // Tier 4 — boss prism (gold) — 25x XP + heal — biggest, can't miss
    { name: 'Hadal Prism',    color: '#FFD040', glow: '#FFFFA0', size: 12,  mult: 25, special: 'heal' },
];

// =====================================================================
// LOOT SYSTEM — salvage drops with rarity, inventory, sell for gold, shop.
// =====================================================================
// Random enemy-drop loot pool. Repair kits NOT here — they only come from wrecks.
const LOOT_TYPES = [
    { id: 'scrap',      name: 'Scrap Metal',      rarity: 'common',    weight: 60, value: 5,   color: '#9AA8B0', glyph: '⚙' },
    { id: 'wiring',     name: 'Copper Wiring',    rarity: 'common',    weight: 50, value: 7,   color: '#C8A060', glyph: '⌇' },
    { id: 'biosamp',    name: 'Bio Sample',       rarity: 'uncommon',  weight: 25, value: 18,  color: '#5ADFCF', glyph: '◉' },
    { id: 'corecell',   name: 'Core Cell',        rarity: 'uncommon',  weight: 18, value: 22,  color: '#FFB060', glyph: '◇' },
    { id: 'crystal',    name: 'Alien Crystal',    rarity: 'rare',      weight: 10, value: 60,  color: '#A06ACC', glyph: '✦' },
    { id: 'corepl',     name: 'Pressure Plate',   rarity: 'rare',      weight: 8,  value: 75,  color: '#80E0FF', glyph: '◈' },
    { id: 'artifact',   name: 'Unknown Artifact', rarity: 'legendary', weight: 2,  value: 250, color: '#FFD040', glyph: '✺' },
];
// Standalone Repair Kit definition (used by wreck loot table only)
const REPAIR_KIT = { id: 'repair_kit', name: 'Repair Kit', rarity: 'uncommon', value: 30, color: '#80FFA0', glyph: '✚' };
const LOOT_RARITY_COLORS = { common: '#9AA8B0', uncommon: '#5ADFCF', rare: '#A06ACC', legendary: '#FFD040' };
function pickLootType() {
    const total = LOOT_TYPES.reduce((s, l) => s + l.weight, 0);
    let r = Math.random() * total;
    for (const l of LOOT_TYPES) { r -= l.weight; if (r <= 0) return l; }
    return LOOT_TYPES[0];
}
function rollLootDrop(e) {
    // Drop chance: 8% normal, 25% aberrant, 100% boss
    let chance = 0.08;
    if (e.aberrant) chance = 0.30;
    if (e.isBoss || (e.maxHp || 0) >= 500) chance = 1.0;
    if (Math.random() > chance) return null;
    return pickLootType();
}

// --- Upgrade pool ---
// =====================================================================
// CRAFTING — Tier-2 processed materials. Combine raw salvage between dives.
// Discovery hooks (scan-unlocks-recipe) come in next pass; for v0 all recipes known.
// =====================================================================
const RECIPE_DEFS = [
    { id: 'hull_plate',     name: 'Hull Plate',       tier: 2, glyph: '◫', color: '#9AB0C8',
      ingredients: { scrap: 2, wiring: 1 },
      desc: 'Reinforced patch. Future use: +20 starting HP.' },
    { id: 'bioagent',       name: 'Bioagent',         tier: 2, glyph: '◉', color: '#5ADFCF',
      ingredients: { biosamp: 2 },
      desc: 'Stabilised bio matter. Future use: starting regen.' },
    { id: 'power_cell',     name: 'Power Cell',       tier: 2, glyph: '◇', color: '#FFB060',
      ingredients: { corecell: 1, wiring: 2 },
      desc: 'Stable current source. Used in Tier-3 recipes.' },
    { id: 'resonator',      name: 'Resonator',        tier: 2, glyph: '◈', color: '#80E0FF',
      ingredients: { crystal: 1, corecell: 1 },
      desc: 'Sonar amplifier. Used in Tier-3 recipes.' },
    { id: 'hardened_plate', name: 'Hardened Plate',   tier: 2, glyph: '◰', color: '#80E0FF',
      ingredients: { corepl: 1, scrap: 3 },
      desc: 'Pressure-rated armor. Future use: starting +1 armor.' },
    { id: 'catalyst',       name: 'Anomaly Catalyst', tier: 2, glyph: '✺', color: '#FFD040',
      ingredients: { artifact: 1 },
      desc: 'Reactor fragment. Required for Tier-3 unlocks.' },
];

// Display data for raw salvage in the Workshop UI.
const MATERIAL_DISPLAY = {
    scrap:    { name: 'Scrap',     glyph: '⚙', color: '#9AA8B0' },
    wiring:   { name: 'Wiring',    glyph: '⌇', color: '#C8A060' },
    biosamp:  { name: 'Bio',       glyph: '◉', color: '#5ADFCF' },
    corecell: { name: 'Cell',      glyph: '◇', color: '#FFB060' },
    crystal:  { name: 'Crystal',   glyph: '✦', color: '#A06ACC' },
    corepl:   { name: 'Plate',     glyph: '◈', color: '#80E0FF' },
    artifact: { name: 'Artifact',  glyph: '✺', color: '#FFD040' },
};

// Pull unsold salvage from a run into the persistent workshop stockpile.
// Idempotent if g.inventory is cleared after.
function stockpileSalvage(g) {
    if (!meta.materials) meta.materials = {};
    if (!g || !g.inventory) return;
    for (const it of g.inventory) {
        if (!it || !it.id || it.id === 'repair_kit') continue;
        meta.materials[it.id] = (meta.materials[it.id] || 0) + 1;
    }
}

function craftRecipe(recipeId) {
    const recipe = RECIPE_DEFS.find(r => r.id === recipeId);
    if (!recipe) return false;
    if (!meta.materials) meta.materials = {};
    if (!meta.workshop) meta.workshop = {};
    for (const [matId, qty] of Object.entries(recipe.ingredients)) {
        if ((meta.materials[matId] || 0) < qty) return false;
    }
    for (const [matId, qty] of Object.entries(recipe.ingredients)) {
        meta.materials[matId] -= qty;
    }
    meta.workshop[recipeId] = (meta.workshop[recipeId] || 0) + 1;
    saveMeta();
    return true;
}

// Boon-givers (Hades): every level-up card has a speaker. MERIDIAN SUPPLY sells
// power with corporate catches; NEREID SYSTEMS tunes the sub cleanly; THE COIL
// (COIL_GIFTS) pays in corruption. Weapon/fusion cards default to NEREID.
const UPGRADE_POOL = [
    { id: 'dmg', name: 'DAMAGE +20%', giver: 'meridian', fn: g => { g.player.dmgMult *= 1.2; }, weight: 10 },
    { id: 'speed', name: 'MOVE SPEED +10%', fn: g => { g.player.speed *= 1.1; }, weight: 8 },
    { id: 'maxhp', name: 'MAX HP +25', giver: 'meridian', fn: g => { g.player.maxHp += 25; g.player.hp += 25; }, weight: 8 },
    { id: 'magnet', name: 'MAGNET +30%', giver: 'meridian', fn: g => { g.player.magnetRange *= 1.3; }, weight: 7 },
    { id: 'armor', name: 'ARMOR +1', fn: g => { g.player.armor += 1; }, weight: 6 },
    { id: 'area', name: 'AREA +15%', fn: g => { g.player.areaMult *= 1.15; }, weight: 7 },
    { id: 'cooldown', name: 'COOLDOWN -10%', fn: g => { g.player.cdMult *= 0.9; }, weight: 7 },
    { id: 'xpgain', name: 'XP GAIN +15%', giver: 'meridian', fn: g => { g.player.xpMult *= 1.15; }, weight: 6 },
    { id: 'heal', name: 'HEAL 30 HP', giver: 'meridian', fn: g => { g.player.hp = Math.min(g.player.maxHp, g.player.hp + 30); }, weight: 5 },
    { id: 'regen', name: 'REGEN +0.5/s', fn: g => { g.player.regen += 0.5; }, weight: 4 },
    { id: 'defiance', name: 'DEATH DEFIANCE +1', fn: g => { g.player.deathDefiance++; }, weight: 3 },
    { id: 'dash_cd', name: 'DASH COOLDOWN -25%', fn: g => { /* handled in dash logic via cdMult */ }, weight: 4 },
    // Tradeoff upgrades — Meridian surplus: every powerful effect carries a catch.
    { id: 'overdrive', name: 'OVERDRIVE', giver: 'meridian', desc: '+40% damage. +20% weapon cooldown.', fn: g => { g.player.dmgMult *= 1.4; g.player.cdMult *= 1.20; }, weight: 5 },
    { id: 'combat_stims', name: 'COMBAT STIMS', giver: 'meridian', desc: '+30% move speed. -30 max HP.', fn: g => { g.player.speed *= 1.30; g.player.maxHp = Math.max(20, g.player.maxHp - 30); g.player.hp = Math.min(g.player.hp, g.player.maxHp); }, weight: 5 },
    { id: 'stripped', name: 'CARGO STRIPPED', giver: 'meridian', desc: '+20% move speed. -40% magnet range.', fn: g => { g.player.speed *= 1.20; g.player.magnetRange *= 0.6; }, weight: 5 },
    { id: 'pressure_lens', name: 'PRESSURE LENS', giver: 'meridian', desc: '+40% weapon area. -15% damage.', fn: g => { g.player.areaMult *= 1.40; g.player.dmgMult *= 0.85; }, weight: 5 },
    { id: 'predator_focus', name: 'PREDATOR FOCUS', giver: 'meridian', desc: '+25% damage. -25% weapon area.', fn: g => { g.player.dmgMult *= 1.25; g.player.areaMult *= 0.75; }, weight: 5 },
    { id: 'deep_scavenger', name: 'DEEP SCAVENGER', giver: 'meridian', desc: '+50% XP gain. -30% magnet range.', fn: g => { g.player.xpMult *= 1.5; g.player.magnetRange *= 0.7; }, weight: 5 },
];
function cardGiver(ch) {
    if (ch.id && ch.id.startsWith('coil_')) return { label: 'THE COIL', color: '#DA4060' };
    if (ch.id && ch.id.startsWith('fuse_')) return { label: 'ACCRETION', color: '#FF80FF' };
    if (ch.giver === 'meridian') return { label: 'MERIDIAN SUPPLY', color: '#DAA520' };
    return { label: 'NEREID SYSTEMS', color: '#5ADFCF' };
}

// =====================================================================
// COIL-TOUCHED GIFTS — below the Twilight floor the deep makes offers.
// Strictly stronger than any clean upgrade; the price is MIND.
// Corruption becomes temptation, not a timer.
// =====================================================================
function _coilPrice(g, amt) {
    if (g.player._noCorrupt) amt = 0;   // HADAL BORN — the deep's own take no harm from its gifts
    else if (g.player._corruptResist) amt = Math.round(amt * g.player._corruptResist);
    g.player.corruption = Math.min(100, (g.player.corruption || 0) + amt);
    if (amt > 0) { meta.nereidDrift = (meta.nereidDrift || 0) + 1; }   // she remembers every bargain
    const lines = NEREID.coilGift;
    addNereidLog(g, lines[Math.floor(Math.random() * lines.length)]);
}
const COIL_GIFTS = [
    { id: 'coil_flesh', name: '⦿ FLESH INTERFACE',    desc: '+45% damage. Corruption +18.',            fn: g => { g.player.dmgMult *= 1.45; _coilPrice(g, 18); }, weight: 5 },
    { id: 'coil_sight', name: '⦿ DEEP SIGHT',         desc: '+40% weapon area. Corruption +15.',       fn: g => { g.player.areaMult *= 1.40; _coilPrice(g, 15); }, weight: 5 },
    { id: 'coil_heart', name: '⦿ ANAEROBIC HEART',    desc: 'Regen +1.5/s. Corruption +20.',           fn: g => { g.player.regen += 1.5; _coilPrice(g, 20); }, weight: 5 },
    { id: 'coil_nerve', name: '⦿ GRAFTED NERVE',      desc: '-25% cooldowns. Corruption +18.',         fn: g => { g.player.cdMult *= 0.75; _coilPrice(g, 18); }, weight: 5 },
    { id: 'coil_swim',  name: '⦿ PRESSURE COMMUNION', desc: '+30% speed, +20% magnet. Corruption +15.', fn: g => { g.player.speed *= 1.3; g.player.magnetRange *= 1.2; _coilPrice(g, 15); }, weight: 5 },
];

// --- Game state ---
let game = null;
let phase = 'title'; // title, intro, cards, playing, paused, event, levelup, death, shop, codex

// =====================================================================
// INTRO / TUTORIAL — cinematic briefing that teaches through story
// First run only. Returning pilots skip to title.
// =====================================================================
const INTRO_SCREENS = [
    { bg: '#010204', text: [
        '[ MERIDIAN DEEP CORPORATION ]',
        '[ CLASSIFIED — CLEARANCE: PILOT ]',
        '',
        'Date: 2087.11.03',
        'Re: Your assignment',
    ], nereid: null, delay: 0 },
    { bg: '#010204', text: [
        'You have been selected for deep-ocean specimen retrieval.',
        '',
        'Your vessel is the DSV NEREID-II.',
        'A one-person submersible rated to 6,000 meters.',
        '',
        'NEREID-II is equipped with an onboard intelligence',
        'system designated NEREID. She will assist you.',
    ], nereid: '📻 NEREID-II online. Running pre-dive diagnostics.', delay: 0 },
    // (Movement / weapons / sanity / creature briefings removed — those teach
    // in-run now, one hint at a time, the moment each mechanic first matters.)
    { bg: '#05080E', text: [
        '[ FINAL NOTE ]',
        '',
        'Previous pilots have reported... anomalies.',
        'Sounds that don\'t match sonar contacts.',
        'Transmissions on frequencies we don\'t broadcast.',
        'NEREID exhibiting behaviour outside her parameters.',
        '',
        'Meridian Deep Corp considers these reports',
        'consistent with nitrogen narcosis.',
        '',
        'Do you understand?',
    ], nereid: '📻 ...', delay: 0 },
    { bg: '#060A10', text: [
        '',
        '',
        '',
        'Good.',
        '',
        '',
        'Begin descent.',
    ], nereid: '📻 Dive protocol initiated. Ballast flooding. We\'re going down, Pilot.', delay: 0 },
];
let introPage = 0;

// =====================================================================
// EXPANDED LORE (30 fragments — tied to gameplay discoveries)
// =====================================================================

// XP curve — calibrated so leveling pace matches descent.
// Roughly: lv1=15, lv5=80, lv10=220, lv15=440, lv20=750
function xpForLevel(lv) { return Math.floor(12 + lv * 8 + lv * lv * 1.5); }

// =====================================================================
// ECOLOGY (Phase 1) — mode dial + stimulus model.
// SWARM   = current game: everything targets you (playerAggroBias 1.0).
// DESCENT = ecology on: creatures mind their own business until you make
//           yourself known by NOISE, LIGHT, or PROXIMITY. One layer, two
//           behaviours, gated by `ecology`. SWARM path is unchanged.
// =====================================================================
const MODE_CONFIG = {
    swarm:   { ecology: false, playerAggroBias: 1.0, lightDiscipline: false },
    descent: { ecology: true,  playerAggroBias: 0.2, lightDiscipline: true  },
};
// How loud each weapon is — the deep hears the loud ones from far off.
const WEAPON_NOISE = {
    sonar: 1.2, torpedo: 0.7, depthcharge: 0.9, field: 0.15, harpoon: 0.05, lure: 0.3,
    tsunami: 1.0, leviathan_lance: 0.8, abyssal_mine: 0.9, maelstrom: 1.1, sirens_call: 1.0, wrath: 0.9,
    echo_salvo: 1.1, pressure_burst: 1.2, echo_lance: 0.9, false_chorus: 0.8,
    volt_torpedo: 0.6, cluster_warhead: 1.0, baited_warhead: 0.7,
    capacitor_nova: 0.5, live_wire: 0.2, galvanic_bait: 0.3, dead_spike: 0.6, winch: 0.15,
};
// Ecological role per creature — who reacts to whom (lore-mapped). Falls back from AI type.
const ENEMY_ROLES = {
    jellyfish:'prey', sunfish:'prey', lanternfish:'prey', hermit:'prey', puffer:'prey', glowshrimp:'prey',
    piranha:'pack', wolffish:'pack', eel:'pack', hemoclot:'pack',
    anglerfish:'ambush', nightmare:'ambush', lurker:'ambush', trenchworm:'ambush', capillaryworm:'ambush',
    gulper:'apex', manta:'apex', ghostray:'apex', tendrilmass:'apex', pressureform:'apex',
    leviathan:'apex', kraken:'apex', dreadnought:'apex', abyssal_maw:'apex',
    vampyro:'scavenger', glassoct:'scavenger', twicrab:'scavenger', bonesmoker:'scavenger',
    tubeworm:'sessile', polyp:'sessile', bonecoral:'sessile',
    squid:'sensor', listener:'sensor', whisperer:'sensor', voideye:'sensor',
    tissuedrift:'support', dragonfish:'mid', presseel:'mid',
    splitter:'prey', inker:'scavenger', grappler:'ambush', latcher:'pack', lamprey:'mid',
};
// Detection radius (px) by role — apex/sensor perceive farthest; ambush waits short; prey skittish.
const ROLE_DETECT = { prey:200, pack:360, ambush:240, apex:520, scavenger:300, sessile:220, sensor:600, support:260, mid:380 };
function enemyRole(typeId, ai) {
    return ENEMY_ROLES[typeId] || (ai === 'static_spit' ? 'sessile' : ai === 'pack' ? 'pack' : (ai === 'ambush' || ai === 'burst' || ai === 'lunge') ? 'ambush' : 'prey');
}
let gameMode = 'descent'; // the deep is always alive — ecology/horror is the whole game now

function createGame() {
    const char = CHARACTERS[meta.selectedChar] || CHARACTERS.sub_basic;
    const stakes = new Set(meta.stakeSet || []);
    // Hull condition scales the dive's starting maxHp. Minimum 30% so a dive is always possible.
    const hullPct = Math.max(0.30, (meta.hullCondition || 100) / 100);
    const startHp = Math.max(20, Math.floor(char.hp * hullPct));
    const g = {
        player: {
            x: 0, y: 0, hp: startHp, maxHp: startHp, speed: char.speed,
            xp: 0, level: 1, weapons: [], dmgMult: char.dmgMult || 1, areaMult: char.areaMult || 1, cdMult: 1,
            magnetRange: char.magnetRange || 60, armor: char.armor || 0, xpMult: 1, regen: 0,
            _mouseAim: !!char.mouseAim,
            iFrames: 0, charId: meta.selectedChar, charColor: char.color,
            // Hades dash
            dashCooldown: 0, dashTimer: 0, dashVx: 0, dashVy: 0, dashTrail: [],
            // Death Defiance — the Mariana stake removes it
            deathDefiance: stakes.has('mariana') ? 0 : 1,
            // Chain kill tracking
            chainTimer: 0, chainCount: 0,
            corruption: 0,
        },
        enemies: [], gems: [], projectiles: [], effects: [], floatingTexts: [],
        depthCharges: [], lures: [],
        wave: 1, waveTimer: 0, spawnTimer: 0, spawnRate: 2.4,
        runTime: 0, kills: 0, gemsCollected: 0, comboTimer: 0, combo: 0, bestCombo: 0,
        streak: '', streakTimer: 0,
        shake: 0, flashTimer: 0,
        slowmo: 0,
        sonarReveal: 0,
        creatureGrowlTimer: 5 + Math.random() * 10,
        warningIndicators: [],
        nereidLog: [{ text: 'NEREID-II online. Descent protocol initiated.', time: 0 }],
        // BALATRO-STYLE SCORING
        // Final score = sum of (chips × mult) per scoring event.
        // Mult is built from depth-zone tier + chains + variety + sonar bursts + boss/aberrant bonuses.
        score: 0,
        scoreFlash: 0,           // bumps when a big score lands (HUD flash trigger)
        scoreCombo: {
            chainCount: 0,        // active chain length
            chainTimer: 0,        // resets when no kill within window
            uniqueTypes: new Set(),
            uniqueTimer: 0,
            sonarBurstCount: 0,   // kills caused by current sonar pulse
            sonarBurstTimer: 0,
            lastHitTime: 0,       // for "perfect" no-hit tracking
            lastEvent: null,      // {chips, mult, total, tags:[], time}
        },
        bestScore: 0,
        // WORLD STRUCTURE — obstacles, wrecks, bounds
        // Bounded arena keeps the player engaged: 1600x1200 box, sub stays inside.
        // Obstacles spawn around the player based on depth zone (rocks, kelp, vents, alien growths).
        // Wrecks are special obstacles you can SALVAGE for big rewards — sonar pings REVEAL their loot.
        obstacles: [],
        wrecks: [],
        worldBounds: { minX: -1400, maxX: 1400, minY: -1000, maxY: 1000 },
        nearestWreck: null,    // populated each frame by update — for HUD prompt
        salvageHoldTime: 0,    // ticks while player holds E near a wreck
        // OBJECTIVES — NEREID's mission brief. 3 per dive. Reasons to descend.
        objectives: [],
        objectivesAnnounced: false,
        // LOOT — in-world drops + collected inventory
        lootItems: [],          // floating in the world, magneted to player like gems
        inventory: [],          // collected items, sellable for gold via TAB screen
        // ASCENT — once committed, you cannot dive again. Reach 0m to bank everything.
        ascending: false,
        ascendStartTime: 0,
        deepestDepth: 0,        // tracks how deep we got (for ascent calculations)
        // Per-dive trench seed — generates a unique jagged perimeter every run
        trenchSeed: RND() * 1000,
        // Which moon this dive is on — P3 is the machinery-only dead ocean
        moon: (meta.p3Unlocked && meta.destination === 'p3') ? 'p3' : 'p9',
        // Per-run creature pool — random subset of each biome's species
        creaturePool: rollCreaturePool(),
        // Already-scanned creatures inherit from meta — same DSV life knows them already
        _scannedThisRun: new Set(meta.scannedCreatures || []),
        activeEvent: null, eventTimer: 0, eventCooldown: 60 + Math.random() * 30,
        selectedCards: [], activeSynergies: [],
        // Corruption (moved to player above but keep game-level too for compat)
        corruption: 0,
        _goldMult: 1, _enemyDmgMult: 1, _enemySpdMult: 1,
        depth: 0,
        bubbles: [], debris: [], silhouettes: [], marinSnow: [],
        levelUpChoices: [],
        goldEarned: 0,
        cam: { x: 0, y: 0 },
        // Feature 5: Cascade
        cascadeActive: false, cascadeTimer: 0, cascadeCount: 0,
        chainKillQueue: [], // [{time}] for cascade detection
        // Feature 9: Scanning
        _seenFirstAberrant: false,
        // Feature 4: boss spawned trackers
        _bossesSpawned: {},
        // Composable stakes — each active one pays +15% gold & score
        stakes: stakes,
        _stakeMult: 1 + 0.15 * stakes.size,
        // --- ECOLOGY (Phase 1): mode + stimulus model ---
        mode: gameMode,        // always 'descent' now
        noise: 0,              // decays each frame; weapons add to it
        lightOn: true,         // floodlights; go dark (L) to vanish from the ecology
        bloodLevel: 0,         // rises on damage spill; attracts scavengers/clots; decays
        corpses: [],           // {x,y,t,role,size} — drift then despawn (scavenger feeding = Phase 3)
        _modeCfg: MODE_CONFIG.descent,
    };
    // Apply meta upgrades
    g.player.dmgMult *= 1 + meta.upgrades.damage * 0.05;
    g.player.maxHp += meta.upgrades.hp * 5;
    g.player.hp = g.player.maxHp;
    g.player.speed *= 1 + meta.upgrades.speed * 0.05;
    g.player.xpMult *= 1 + meta.upgrades.xpGain * 0.1;
    // Feature 9: Zone scan completion bonus (+5% global dmg per 5 creatures scanned)
    const scanBonus = Math.floor(meta.scannedCreatures.length / Object.keys(ENEMY_TYPES).length * 5) * 0.05;
    if (scanBonus > 0) g.player.dmgMult *= 1 + scanBonus;
    // Stakes: Mariana compensates the player's engines for the faster swarm
    if (stakes.has('mariana')) { g.player.speed *= 1.5; }
    // Add starting weapon
    g.player.weapons.push({ id: char.startWeapon, level: 1, cooldown: 0 });
    // Sonar starts in MANUAL mode — conserves use, rewards intentional pings.
    // Auto-fire unlocks via the AUTO-PING upgrade card or sonar level >= 5.
    g.player._sonarManual = true;
    g.player._sonarAuto = false;
    // CRUSH DEPTH from sub class
    g.player._crushDepth = char.crushDepth || 3000;
        // BATTERY / OXYGEN — drains over time. Recharged by kills (kinetic scavenge).
        // At low battery: lights dim, vision shortens. At 0: weapons offline.
        g.player.battery = 100;
        // CRAFTING: apply fabricated submersible refits (permanent, from meta.fab)
        {
            const fab = meta.fab || {};
            g.player.maxHp += (fab.hull || 0) * 10;
            g.player.hp = g.player.maxHp;
            g.player._crushDepth += (fab.crush || 0) * 250;
            g.player.speed *= 1 + (fab.engine || 0) * 0.05;
            g.player.battery += (fab.reactor || 0) * 15;
            g.player.dmgMult *= 1 + (fab.optics || 0) * 0.05;
        }
        // Quartermaster stock stowed aboard
        for (const bid of Object.keys(meta.beltStock || {})) {
            for (let i = 0; i < meta.beltStock[bid]; i++) g.inventory.push({ id: bid, name: BELT_DEFS[bid].name, belt: true, value: BELT_DEFS[bid].value, depth: 0 });
        }
        meta.beltStock = {};
        saveMeta();
        // DEPTH CHART from last dive: this run's wrecks come pre-marked
        if (meta.chartNext) { g._charted = true; meta.chartNext = false; saveMeta(); }
        // MODULE BAY: apply equipped biomimetic modules
        for (const mid of (meta.modulesEquipped || [])) {
            if (mid === 'anechoic') g.player._detectMult = 0.7;
            if (mid === 'lattice')  g.player._crushDepth += 800;
            if (mid === 'chitin')   { g.player.maxHp += 20; g.player.hp = g.player.maxHp; g.player.armor += 1; }
            if (mid === 'silprops') g.player._silentProps = true;
            if (mid === 'passonar') { g.player._minimapBoost = true; g.player._passiveSonar = true; }
            if (mid === 'capbank')  g.player.battery += 25;
            if (mid === 'grapnel')  { g.player._salvageRange = 170; g.player._salvageSpd = 1.4; }
            if (mid === 'ram')      g.player._ramProw = true;
            if (mid === 'mount_torp' && !g.player.weapons.some(w => w.id === 'torpedo')) g.player.weapons.push({ id: 'torpedo', level: 1, cooldown: 0 });
            if (mid === 'mount_harp' && !g.player.weapons.some(w => w.id === 'harpoon')) g.player.weapons.push({ id: 'harpoon', level: 1, cooldown: 0 });
            if (mid === 'mount_arc' && !g.player.weapons.some(w => w.id === 'field')) g.player.weapons.push({ id: 'field', level: 1, cooldown: 0 });
            // The printed price, paid up front
            const db = MODULE_DRAWBACKS[mid];
            if (db) {
                if (db.weight) g.player.speed *= 1 - db.weight / 100;
                if (db.draw) g.player.battery = Math.max(20, g.player.battery - db.draw);
                if (db.loud) g.player._detectMult = (g.player._detectMult || 1) * (1 + db.loud / 100);
            }
        }
        // Use pre-rolled objectives shown to the player on the card-draft screen
    if (pendingObjectives && pendingObjectives.length) {
        g.objectives = pendingObjectives;
        pendingObjectives = null;
    } else {
        rollObjectives(g);
    }
    return g;
}

// --- Spawning ---
// Per-run creature pool — at game start we randomly pick 3-5 species per biome.
// Different runs feature different bestiaries → real variance per dive.
// P3 species — the ones the machinery grew INTO. On the Scar, only these dive.
const P3_SPECIES = new Set([
    'hermit', 'anglerfish', 'eel', 'presseel', 'squid', 'glassoct', 'gulper',
    'voideye', 'listener', 'whisperer', 'bonesmoker', 'pressureform', 'lurker',
    'splitter', 'inker', 'grappler', 'latcher', 'lamprey', 'trenchworm', 'polyp',
]);

function rollCreaturePool() {
    const p3 = meta.p3Unlocked && meta.destination === 'p3';
    const biomes = { SUNLIGHT: [], TWILIGHT: [], MIDNIGHT: [], ABYSSAL: [], RED_LAYER: [], HADAL: [] };
    for (const [id, e] of Object.entries(ENEMY_TYPES)) {
        if (e.isBoss || e.carrier) continue;   // carriers spawn on their own clock, never in waves
        if (p3 && !P3_SPECIES.has(id)) continue;   // dead ocean — only the machine-fused remain
        let biome;
        if (e.minWave <= 4) biome = 'SUNLIGHT';
        else if (e.minWave <= 9) biome = 'TWILIGHT';
        else if (e.minWave <= 13) biome = 'MIDNIGHT';
        else if (e.minWave <= 16) biome = 'ABYSSAL';
        else if (e.minWave <= 18) biome = 'RED_LAYER';
        else biome = 'HADAL';
        biomes[biome].push(id);
    }
    // P3 filter can empty a tier — refill from the full roster rather than
    // starving spawns (the U2 empty-pool lesson, learned once already).
    if (p3) for (const biome in biomes) {
        if (biomes[biome].length) continue;
        for (const [id, e] of Object.entries(ENEMY_TYPES)) {
            if (e.isBoss || e.carrier) continue;
            const tier = e.minWave <= 4 ? 'SUNLIGHT' : e.minWave <= 9 ? 'TWILIGHT' : e.minWave <= 13 ? 'MIDNIGHT' : e.minWave <= 16 ? 'ABYSSAL' : e.minWave <= 18 ? 'RED_LAYER' : 'HADAL';
            if (tier === biome) biomes[biome].push(id);
        }
    }
    const pool = {};
    for (const biome in biomes) {
        const list = biomes[biome];
        const count = Math.min(list.length, 3 + Math.floor(RND() * 3));   // 3–5 per biome
        const shuffled = [...list].sort(() => RND() - 0.5);
        pool[biome] = new Set(shuffled.slice(0, count));
    }
    // Guarantee the first waves have SOMETHING — a rolled SUNLIGHT pool with no
    // minWave-1 species left the opening minutes empty (and starved forced spawns)
    if (![...pool.SUNLIGHT].some(id => ENEMY_TYPES[id].minWave <= 1)) pool.SUNLIGHT.add('jellyfish');
    return pool;
}

function getSpawnableTypes(wave, g) {
    const pool = g && g.creaturePool;
    return Object.entries(ENEMY_TYPES).filter(([id, t]) => {
        if (wave < t.minWave) return false;
        if (t.isBoss || t.carrier) return false;
        if (!pool) return true;
        // Filter by per-run pool
        for (const biome in pool) {
            if (pool[biome].has(id)) return true;
        }
        return false;
    }).map(([id, t]) => ({ id, ...t }));
}

function spawnEnemy(g, forceType, forcePos) {
    const types = getSpawnableTypes(g.wave, g);
    if (!types.length && !forceType) return;   // forced spawns (bosses, carriers, events) must not starve
    // Weight toward newer types
    const type = forceType || types[Math.floor(Math.random() * types.length)];
    const angle = forcePos ? 0 : Math.random() * PI2;
    const spawnDist = 500 + Math.random() * 200;
    const waveMult = 1 + g.wave * 0.08;
    const stakes = g.stakes || new Set();

    // Stake: Pressure — tougher swarm
    let hpMult = waveMult;
    if (stakes.has('pressure')) hpMult *= 1.2;

    // Aberrant chance — depth-gated. None in shallow water, ramps from Midnight onward.
    // Past Titanic (3800m) the ocean is hostile by default.
    let aberrantChance = 0;
    if (g.depth > 1000) aberrantChance = Math.min(0.18, (g.depth - 1000) / 22000);
    aberrantChance += ((g.attention || 0) / 100) * 0.10;   // loud runs breed wrong things
    if (g.depth > 4000) aberrantChance = Math.min(0.30, 0.18 + (g.depth - 4000) / 12000);
    if (stakes.has('abyssal')) aberrantChance += 0.10;
    const isAberrant = Math.random() < aberrantChance;

    // Stake: Mariana — faster swarm
    let speedMult = 0.9 + Math.random() * 0.2;
    if (stakes.has('mariana')) speedMult *= 1.5;
    speedMult *= (g._enemySpdMult || 1);

    let baseX = forcePos ? forcePos.x : g.player.x + Math.cos(angle) * spawnDist;
    let baseY = forcePos ? forcePos.y : g.player.y + Math.sin(angle) * spawnDist;
    // Clamp spawn inside circular trench bounds
    const wb2 = g.worldBounds;
    if (wb2 && wb2.radius) {
        const r2 = type.size || 12;
        const dx2 = baseX - wb2.cx, dy2 = baseY - wb2.cy;
        const d2 = dx2 * dx2 + dy2 * dy2;
        const lim = wb2.radius - r2;
        if (d2 > lim * lim) {
            const dd = Math.sqrt(d2) || 1;
            baseX = wb2.cx + (dx2 / dd) * lim;
            baseY = wb2.cy + (dy2 / dd) * lim;
        }
    }

    const enemy = {
        x: baseX, y: baseY,
        hp: type.hp * hpMult * (isAberrant ? 2 : 1),
        maxHp: type.hp * hpMult * (isAberrant ? 2 : 1),
        speed: type.speed * speedMult * (isAberrant ? 1.5 : 1),
        size: type.size * (isAberrant ? 1.2 : 1),
        color: isAberrant ? lerpColor(type.color, '#FF00FF', 0.4) : type.color,
        xp: type.xp, damage: type.damage * (isAberrant ? 1.5 : 1),
        gold: type.gold * (isAberrant ? 3 : 1),
        typeId: type.id, flash: 0,
        aberrant: isAberrant,
        isWhisperer: !!type.isWhisperer,
        // Feature 3: AI properties
        ai: type.ai || 'chase',
        wanderAngle: Math.random() * PI2, // jellyfish drift
        orbitAngle: Math.random() * PI2,  // piranha pack
        dartTimer: 0,
        state: type.ai === 'ambush' ? 'hidden' : type.ai === 'curious' ? 'approach' : type.ai === 'patrol' ? 'patrol' : 'chase',
        stateTimer: 0,
        lungeTimer: 0,
        zigPhase: Math.random() * PI2,
        patrolAngle: Math.random() * PI2,
        chargeTarget: null,
        // ECOLOGY (Phase 1): role + senses + awareness
        role: enemyRole(type.id, type.ai),
        detect: ROLE_DETECT[enemyRole(type.id, type.ai)] || 300,
        awareness: 0,
        _homeX: baseX, _homeY: baseY,
    };

    g.enemies.push(enemy);

    // First encounter narration
    if (!g._seenTypes) g._seenTypes = {};
    if (!g._seenTypes[type.id]) {
        g._seenTypes[type.id] = true;
        const firstLines = {
            jellyfish: 'Contact — a depth-sensor float, fouled and drifting. The membrane still reports pressure. Pilot, I cannot tell you who is still listening.',
            piranha: 'Cutting-disc fragments, schooling. Individually trivial. They are drawn to vibration. We are vibration.',
            squid: 'A survey ROV, camera still live. Something is reading its feed. Pilot — it is looking back.',
            anglerfish: 'Lure detected. The frequency is a NEREID status-LED. Exactly matched to mine. I have chosen not to comment.',
            eel: 'Live current through a dead umbilical. Not pursuing us. We have simply closed the circuit.',
            leviathan: 'Class designation: THRESHER. Three kilometres of dredge-chain and muscle. Pilot — that is the trench, moving.',
            kraken: 'WIDOWMAKER detected. Holding at 1,500m, as recorded. It does not chase. It waits for us to ascend.',
            dreadnought: 'OBLIVION-VII telemetry. A combat DSV, lost in 1969, still under power. Do not transmit on naval bands.',
            abyssal_maw: 'FATHER MOUTH. Pilot — the deepest installation we ever sank. It was left off every chart for a reason.',
        };
        if (firstLines[type.id]) addNereidLog(g, firstLines[type.id]);
    }

    // Feature 4: Aberrant first sighting
    if (isAberrant && !g._seenFirstAberrant) {
        g._seenFirstAberrant = true;
        addNereidLog(g, 'Aberrant signature detected. This one is... wrong. Be careful.');
    }
}

// --- Weapons ---
function firePing(g) {
    const w = g.player.weapons.find(x => x.id === 'sonar');
    if (!w || w.cooldown > 0) return false;
    g._lastListenerSound = g.runTime;   // sonar wakes Listeners
    // HEMOBRINE — Red Layer eats sonar 40% of pings, Abyssal transition 15%. Cooldown still consumes.
    const _zone = zoneFromDepth(g.depth);
    const _brineChance = _zone === 'RED_LAYER' ? 0.40 : (_zone === 'ABYSSAL' ? 0.15 : 0);
    if (_brineChance > 0 && Math.random() < _brineChance) {
        const def0 = WEAPON_DEFS.sonar;
        w.cooldown = def0.baseCooldown * g.player.cdMult;
        if (audioCtx) noiseBurst(0.18, 0.04, 1500);
        g.floatingTexts.push({ x: g.player.x, y: g.player.y - 30, text: 'BRINE DROPOUT', color: '#8A4ABA', life: 1.2, vy: -25 });
        return false;
    }
    const def = WEAPON_DEFS.sonar;
    const dmg = def.baseDmg * g.player.dmgMult * (1 + (w.level - 1) * 0.25);
    const area = def.baseArea * g.player.areaMult * (1 + (w.level - 1) * 0.1);
    w.cooldown = def.baseCooldown * g.player.cdMult;
    g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg, speed: 280, hit: new Set() });
    g.sonarReveal = 1.0;
    sfxSonar();
    if (g.player._sonarDouble) {
        setTimeout(() => {
            // guard against a stale game object (run ended/restarted inside the delay)
            if (game === g && g.effects) g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area * 0.8, dmg: dmg * 0.7, speed: 320, hit: new Set() });
        }, 280);
    }
    return true;
}

function fireWeapons(g, dt) {
    if ((g.player.battery || 100) <= 1) return;
    // SILENT RUNNING — weapons hold fire; cooldowns still recover, ready the moment you go loud
    if (g.silent) {
        for (const w of g.player.weapons) w.cooldown = Math.max(0, w.cooldown - dt);
        return;
    }
    for (const w of g.player.weapons) {
        w.cooldown -= dt;
        if (w.cooldown > 0) continue;
        // Sonar in manual mode: leave cooldown at 0, wait for player input
        if (w.id === 'sonar' && g.player._sonarManual && !g.player._sonarAuto) {
            w.cooldown = 0;
            continue;
        }
        const def = WEAPON_DEFS[w.id];
        const cd = def.baseCooldown * g.player.cdMult;
        w.cooldown = cd;
        // ECOLOGY: firing makes noise the deep can hear. Sonar loud, harpoon near-silent.
        if (g._modeCfg && g._modeCfg.ecology) g.noise = Math.min(2.5, (g.noise || 0) + (WEAPON_NOISE[w.id] ?? 0.4));
        if (w.id === 'harpoon') sampleOr('harpoon', 0.22, 0.9 + Math.random() * 0.2);
        const dmg = def.baseDmg * g.player.dmgMult * (1 + (w.level - 1) * 0.25);
        const area = def.baseArea * g.player.areaMult * (1 + (w.level - 1) * 0.1);

        if (w.id === 'sonar') {
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg, speed: 280, hit: new Set() });
            g.sonarReveal = 1.0;
            sfxSonar();
            if (g.player._sonarDouble) {
                setTimeout(() => {
                    if (game === g && g.effects) g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area * 0.8, dmg: dmg * 0.7, speed: 320, hit: new Set() });
                }, 280);
            }
        }
        if (w.id === 'torpedo') {
            // Hunter sub: aim at MOUSE cursor in world space. Other subs: auto-target nearest.
            // Touch devices have no cursor — Hunter falls back to nearest-enemy targeting.
            let a;
            if (g.player._mouseAim && g._vpCx != null && !touchUI()) {
                // Convert mouse screen coords to world coords
                const worldMouseX = g.cam.x + (mouseX - g._vpCx);
                const worldMouseY = g.cam.y + (mouseY - g._vpCy);
                a = Math.atan2(worldMouseY - g.player.y, worldMouseX - g.player.x);
            } else {
                const nearest = findNearest(g.player, g.enemies);
                if (!nearest) { /* nothing to fire at */ }
                a = nearest ? Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x) : null;
            }
            if (a != null) {
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 350, vy: Math.sin(a) * 350, dmg, aoe: area, life: 2, pierce: 0, color: '#FF6A40' });
                sfxTorpedo();
            }
        }
        if (w.id === 'field') {
            // Passive — damage nearby enemies
            for (const e of g.enemies) {
                const d = dist(g.player, e);
                if (d < area) {
                    damageEnemy(g, e, dmg * dt * 3);
                }
            }
        }
        if (w.id === 'depthcharge') {
            g.depthCharges.push({ x: g.player.x, y: g.player.y, timer: 1.2, dmg, aoe: area });
        }
        if (w.id === 'harpoon') {
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500, dmg, aoe: 0, life: 0.6, pierce: 5, color: '#AADDFF' });
            }
        }
        if (w.id === 'lure') {
            const a = Math.random() * PI2;
            const lx = g.player.x + Math.cos(a) * 150;
            const ly = g.player.y + Math.sin(a) * 150;
            g.lures.push({ x: lx, y: ly, timer: 3, dmg, aoe: area, pulse: 0 });
        }
        // --- EVOLVED WEAPONS ---
        if (w.id === 'tsunami') {
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg, speed: 400, hit: new Set() });
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area * 0.6, dmg: dmg * 0.5, speed: 250, hit: new Set() });
            g.sonarReveal = 1.0;
            for (const e of g.enemies) { if (dist(g.player, e) < area * 0.3) damageEnemy(g, e, dmg * 0.3); }
            sfxTsunami();
            g.shake = 4;
        }
        if (w.id === 'leviathan_lance') {
            // Fires 3 piercing explosive projectiles in a spread
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const baseA = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                for (let li = -1; li <= 1; li++) {
                    const a = baseA + li * 0.15;
                    g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 450, vy: Math.sin(a) * 450, dmg, aoe: area, life: 1.5, pierce: 3, color: '#FF4060' });
                }
                sfxTorpedo();
            }
        }
        if (w.id === 'abyssal_mine') {
            for (let mi = 0; mi < 3; mi++) {
                const a = (mi / 3) * PI2 + g.runTime;
                const lx = g.player.x + Math.cos(a) * 120;
                const ly = g.player.y + Math.sin(a) * 120;
                g.lures.push({ x: lx, y: ly, timer: 2, dmg, aoe: area, pulse: 0 });
            }
        }
        // ===== T2 FUSION MATRIX (12 new pairs) =====
        if (w.id === 'echo_salvo') {
            // Ping ring, then a homing torpedo answers for each of the 3 nearest contacts
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg: dmg * 0.4, speed: 320, hit: new Set() });
            g.sonarReveal = 1.0;
            const targets = [...g.enemies].sort((e1, e2) => dist(g.player, e1) - dist(g.player, e2)).slice(0, 3);
            for (const t of targets) {
                const a = Math.atan2(t.y - g.player.y, t.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, dmg, aoe: 36, life: 2, pierce: 0, color: '#5ADFCF', homing: true });
            }
            sfxSonar();
            if (targets.length) sfxTorpedo();
        }
        if (w.id === 'pressure_burst') {
            // Ping ring + 4 charges planted on the ring's circumference
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg: dmg * 0.3, speed: 300, hit: new Set() });
            g.sonarReveal = 1.0;
            const baseA = Math.random() * PI2;
            for (let ci = 0; ci < 4; ci++) {
                const a = baseA + (ci / 4) * PI2;
                g.depthCharges.push({ x: g.player.x + Math.cos(a) * area * 0.55, y: g.player.y + Math.sin(a) * area * 0.55, timer: 0.9, dmg, aoe: 80 });
            }
            sfxSonar();
        }
        if (w.id === 'echo_lance') {
            // Ping reveals, spears answer — piercing harpoons at the 4 nearest contacts
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg: dmg * 0.3, speed: 340, hit: new Set() });
            g.sonarReveal = 1.0;
            const targets = [...g.enemies].sort((e1, e2) => dist(g.player, e1) - dist(g.player, e2)).slice(0, 4);
            for (const t of targets) {
                const a = Math.atan2(t.y - g.player.y, t.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 560, vy: Math.sin(a) * 560, dmg, aoe: 0, life: 0.7, pierce: 5, color: '#80FFE0' });
            }
            sfxSonar();
        }
        if (w.id === 'false_chorus') {
            // Beacon that sings — emits damaging mini-pings over its life, no detonation
            const a = Math.random() * PI2;
            g.lures.push({ x: g.player.x + Math.cos(a) * 140, y: g.player.y + Math.sin(a) * 140, timer: 3.2, dmg, aoe: area, pulse: 0, chorus: true, _chorusT: 0.4 });
        }
        if (w.id === 'volt_torpedo') {
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 360, vy: Math.sin(a) * 360, dmg, aoe: area, life: 2, pierce: 0, color: '#FFE060', arc: 3, arcRange: 150 });
                sfxTorpedo();
            }
        }
        if (w.id === 'cluster_warhead') {
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 330, vy: Math.sin(a) * 330, dmg, aoe: area, life: 2, pierce: 0, color: '#FFA060', cluster: 3 });
                sfxTorpedo();
            }
        }
        if (w.id === 'baited_warhead') {
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 170, vy: Math.sin(a) * 170, dmg, aoe: area, life: 2.4, pierce: 0, color: '#FF80B0', bait: true });
                sfxTorpedo();
            }
        }
        if (w.id === 'capacitor_nova') {
            // Hull discharge — instant damage + knockback around the sub
            for (const e of g.enemies) {
                const d = dist(g.player, e);
                if (d < area) {
                    damageEnemy(g, e, dmg);
                    if (d > 0.01) { e.x += (e.x - g.player.x) / d * 26; e.y += (e.y - g.player.y) / d * 26; }
                }
            }
            g.effects.push({ type: 'explosion', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, life: 0.35 });
            sfxExplosion();
            g.shake = 3;
        }
        if (w.id === 'live_wire') {
            // Spear trailing live cable — deep pierce, arcs a small shock at every body it passes
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, dmg, aoe: area, life: 0.8, pierce: 8, color: '#B0FFE0' });
            }
        }
        if (w.id === 'galvanic_bait') {
            // Bait that cooks — attracts and deals continuous damage while live, never detonates
            const a = Math.random() * PI2;
            g.lures.push({ x: g.player.x + Math.cos(a) * 150, y: g.player.y + Math.sin(a) * 150, timer: 3.5, dmg, aoe: area, pulse: 0, dot: true });
        }
        if (w.id === 'dead_spike') {
            // Harpoon that implants a charge — the wound detonates a beat later
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500, dmg, aoe: 0, life: 0.7, pierce: 0, color: '#FF6060', implant: { dmg: dmg * 1.5, aoe: area, fuse: 0.9 } });
            }
        }
        if (w.id === 'winch') {
            // Hooks contacts and reels them to the sub — feed for auras and novas
            const nearest = findNearest(g.player, g.enemies);
            if (nearest) {
                const a = Math.atan2(nearest.y - g.player.y, nearest.x - g.player.x);
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, dmg, aoe: 0, life: 0.7, pierce: 3, color: '#C8A050', hook: 0.55 });
            }
        }
        // ===== APEX TIER weapons (T3 fusions) =====
        if (w.id === 'maelstrom') {
            // Tsunami pulse + 5 piercing lance projectiles fanned out at SAME time
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area, dmg: dmg * 0.6, speed: 480, hit: new Set() });
            g.sonarReveal = 1.0;
            const baseA = Math.random() * PI2;
            for (let li = 0; li < 5; li++) {
                const a = baseA + (li / 5) * PI2;
                g.projectiles.push({ x: g.player.x, y: g.player.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, dmg, aoe: 30, life: 1.6, pierce: 4, color: '#FF80FF' });
            }
            sfxTsunami();
            g.shake = 6; g.flashTimer = 0.2;
        }
        if (w.id === 'sirens_call') {
            // Drop a giant lure that pulls everything in, then detonates with a shockwave on expiry
            g.lures.push({ x: g.player.x, y: g.player.y, timer: 1.4, dmg, aoe: area, pulse: 0, siren: true });
            // Pre-warning ping at lure location
            g.effects.push({ type: 'sonar_ring', x: g.player.x, y: g.player.y, radius: 0, maxRadius: area * 0.3, dmg: 0, speed: 200, hit: new Set() });
            sfxTsunami();
            g.shake = 5;
        }
        if (w.id === 'wrath') {
            // Three homing kill-mines that drift toward enemies and explode on contact
            const targets = g.enemies.slice(0, 3);
            for (let mi = 0; mi < 3; mi++) {
                const t = targets[mi];
                const baseA = t ? Math.atan2(t.y - g.player.y, t.x - g.player.x) : (mi / 3) * PI2;
                g.projectiles.push({
                    x: g.player.x, y: g.player.y,
                    vx: Math.cos(baseA) * 180, vy: Math.sin(baseA) * 180,
                    dmg, aoe: area, life: 4, pierce: 0, color: '#FFD040', homing: true,
                });
            }
            sfxTorpedo();
        }
    }
}

// =====================================================================
// BOSS ATTACK PATTERNS — telegraphed, named, distinct per leviathan
// =====================================================================
function executeBossAttack(g, e) {
    const p = g.player;
    const pat = e.attackPattern || 'charge';
    if (pat === 'tentacle_slam') {
        // KRAKEN — 4 tentacles erupt around the boss, each is a damaging slam line
        for (let ti = 0; ti < 4; ti++) {
            const a = (ti / 4) * PI2 + Math.random() * 0.4;
            const reach = 220;
            const tx = e.x + Math.cos(a) * reach, ty = e.y + Math.sin(a) * reach;
            // Damage anything in a thick line for 0.4s — represented as a lure-like AoE pulse
            g.depthCharges.push({ x: tx, y: ty, timer: 0.05, dmg: e.damage * 0.8, aoe: 90 });
        }
        sfxExplosion();
    } else if (pat === 'barrage') {
        // DREADNOUGHT — fan of 5 homing torpedoes
        const baseA = Math.atan2(p.y - e.y, p.x - e.x);
        for (let bi = -2; bi <= 2; bi++) {
            const a = baseA + bi * 0.16;
            g.projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, dmg: e.damage * 0.7, aoe: 32, life: 3, pierce: 0, color: '#FFA040', enemy: true });
        }
        sfxTorpedo();
    } else if (pat === 'bite_arc') {
        // ABYSSAL MAW — rotating 90° bite cone (damages anything in the cone)
        const baseA = Math.atan2(p.y - e.y, p.x - e.x);
        const reach = 280;
        for (const e2 of [p]) {
            const dx = e2.x - e.x, dy = e2.y - e.y;
            const d = Math.sqrt(dx*dx + dy*dy);
            if (d > reach) continue;
            const ang = Math.atan2(dy, dx);
            let diff = ang - baseA;
            while (diff > Math.PI) diff -= PI2;
            while (diff < -Math.PI) diff += PI2;
            if (Math.abs(diff) < 0.7) {
                if (p.iFrames <= 0) {
                    p.hp -= e.damage;
                    p.iFrames = 0.6;
                    g.shake = 8;
                    sfxHit();
                    if (g.scoreCombo) g.scoreCombo.lastHitTime = g.runTime;
                    g._lastAttackerTypeId = e.typeId; g._lastAttackerIsBoss = true;
                }
            }
        }
        // Visual: leave a fading cone effect
        g.effects.push({ type: 'explosion', x: e.x + Math.cos(baseA) * 100, y: e.y + Math.sin(baseA) * 100, radius: 60, maxRadius: 220, life: 0.4 });
    }
    // 'charge' is handled by movement during attack state
}

function findNearest(from, list) {
    let best = null, bestD = Infinity;
    for (const e of list) { const d = dist(from, e); if (d < bestD) { bestD = d; best = e; } }
    return best;
}

function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

// =====================================================================
// OBJECTIVES — NEREID-issued mission goals per dive
// 3 objectives per run, drawn from a pool. Completing gives score + lore + reward.
// Failing = NEREID disappointment + small score penalty.
// =====================================================================
const OBJECTIVE_POOL = [
    // PRESSURE CARTOGRAPHY — depth telemetry
    { id: 'depth_2k',  brief: '[PC-3]  Confirm telemetry to 2,000m (Midnight Vascular)', target: 2000, type: 'depth', reward: 'salvage', scoreBonus: 1000, weight: 4 },
    { id: 'depth_3k',  brief: '[PC-7]  Confirm telemetry to 3,000m (deep Abyssal Machinery)', target: 3000, type: 'depth', reward: 'lore', scoreBonus: 2000, weight: 4 },
    { id: 'depth_4k',  brief: '[PC-12] Cross the Hemobrine Stratum (4,000m)', target: 4000, type: 'depth', reward: 'defiance', scoreBonus: 4000, weight: 3 },
    { id: 'depth_5k',  brief: '[PC-22] Survive Hadal Organ pressure (5,000m)', target: 5000, type: 'depth', reward: 'weapon', scoreBonus: 8000, weight: 2 },
    // CORPORATE SALVAGE — wrecks + boss material
    { id: 'salvage_2', brief: '[CS-4]  Salvage 2 wrecks for Corporate', target: 2, type: 'salvage', reward: 'gold', scoreBonus: 1500, weight: 4 },
    { id: 'salvage_4', brief: '[CS-9]  Salvage 4 wrecks for Corporate', target: 4, type: 'salvage', reward: 'lore', scoreBonus: 3500, weight: 2 },
    { id: 'kill_boss', brief: '[CS-X]  Recover material from a Leviathan-class organism', target: 1, type: 'boss', reward: 'defiance', scoreBonus: 5000, weight: 3 },
    // XENOBIOLOGY — sample organ-units (combat under another name)
    { id: 'kill_50',   brief: '[XB-2]  Sample 50 organ-units from active Substrate', target: 50, type: 'kill', reward: 'gold', scoreBonus: 800, weight: 3 },
    { id: 'kill_150',  brief: '[XB-5]  Sample 150 organ-units (efficient harvest)', target: 150, type: 'kill', reward: 'gold', scoreBonus: 2500, weight: 2 },
    { id: 'chain_15',  brief: '[XB-7]  Land a 15-sample cascade chain', target: 15, type: 'chain', reward: 'gold', scoreBonus: 1800, weight: 3 },
    // SIGNAL THEOLOGY (unofficial) — anomalous signatures
    { id: 'kill_aberrant', brief: '[ST-?]  Cull 3 ABERRANT signatures (request: unsigned)', target: 3, type: 'aberrant', reward: 'lore', scoreBonus: 3000, weight: 3 },
    // LIFE SUPPORT — return alive
    { id: 'survive_8', brief: '[LS-1]  Stay submerged 8 minutes (hull review pending)', target: 480, type: 'time', reward: 'gold', scoreBonus: 1200, weight: 3 },
    { id: 'no_hit_60', brief: '[LS-3]  Maintain hull integrity 60s (Life Support audit)', target: 60, type: 'no_hit', reward: 'salvage', scoreBonus: 2500, weight: 2 },
];

const OBJECTIVE_REWARDS = {
    salvage:  g => { /* spawn a guaranteed wreck nearby with weapon/heal loot */
        const a = Math.random() * PI2; const wb = g.worldBounds;
        const x = Math.max(wb.minX + 60, Math.min(wb.maxX - 60, g.player.x + Math.cos(a) * 250));
        const y = Math.max(wb.minY + 60, Math.min(wb.maxY - 60, g.player.y + Math.sin(a) * 250));
        const goodLoot = WRECK_LOOT_TABLE.filter(l => l.id === 'weapon_lv' || l.id === 'heal' || l.id === 'defiance');
        g.wrecks.push({ x, y, r: 38, loot: goodLoot[Math.floor(Math.random() * goodLoot.length)], revealed: true, salvaged: false, seed: Math.random() * 100, spawnedAt: g.runTime, bonus: true });
    },
    lore:     g => { dropLore(g); dropLore(g); },
    defiance: g => { g.player.deathDefiance++; },
    weapon:   g => { const ws = g.player.weapons.filter(w => w.level < 8); if (ws.length) { const w = ws[Math.floor(Math.random() * ws.length)]; w.level += 2; w.level = Math.min(8, w.level); } else g.goldEarned += 500; },
    gold:     g => { g.goldEarned += 200 + Math.floor(g.depth / 20); },
};

// Pre-roll objectives at the card draft so player can see them before diving
let pendingObjectives = null;
function rollPendingObjectives() {
    const stub = { objectives: [], wrecks: [], depth: 0 };
    rollObjectives(stub);
    pendingObjectives = stub.objectives;
    return pendingObjectives;
}

// =====================================================================
// CONTRACTS — the Mooring's board. Pick your dive goals (up to 3) with a
// visible risk tier; completing one pays crafting MATERIALS. Replaces the
// auto-rolled brief with player agency.
// =====================================================================
let contractBoard = [], contractSelected = new Set();
const RISK_COLOR = { LOW: '#80E0A0', MED: '#FFD040', HIGH: '#FF6A4A' };
function contractRisk(o) { return o.scoreBonus >= 4000 ? 'HIGH' : o.scoreBonus >= 2000 ? 'MED' : 'LOW'; }
function contractMats(risk) {
    if (risk === 'HIGH') return { wiring: 3, corecell: 2, crystal: 1, artifact: 1 };
    if (risk === 'MED') return { scrap: 4, wiring: 2, corecell: 1 };
    return { scrap: 3, wiring: 1 };
}
function rollContractBoard() {
    const pool = [...OBJECTIVE_POOL];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(RND() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    contractBoard = pool.slice(0, 5).map(o => {
        const risk = contractRisk(o);
        return { ...o, progress: 0, complete: false, failed: false, claimed: false, risk, _mats: contractMats(risk) };
    });
    contractSelected = new Set();
    return contractBoard;
}

function rollObjectives(g) {
    // Pick 3 objectives — one of each "category" if possible (depth, salvage/combat, endurance/score)
    const categories = {
        depth:    ['depth_2k', 'depth_3k', 'depth_4k', 'depth_5k'],
        actions:  ['salvage_2', 'salvage_4', 'kill_50', 'kill_150', 'kill_aberrant', 'kill_boss'],
        skill:    ['survive_8', 'no_hit_60', 'chain_15'],
    };
    const pickWeighted = (ids) => {
        const pool = OBJECTIVE_POOL.filter(o => ids.includes(o.id));
        const total = pool.reduce((s, o) => s + o.weight, 0);
        let r = Math.random() * total;
        for (const o of pool) { r -= o.weight; if (r <= 0) return { ...o, progress: 0, complete: false, failed: false, claimed: false }; }
        return { ...pool[0], progress: 0, complete: false, failed: false, claimed: false };
    };
    g.objectives = [
        pickWeighted(categories.depth),
        pickWeighted(categories.actions),
        pickWeighted(categories.skill),
    ];
}

function updateObjectives(g, dt) {
    if (!g.objectives.length) return;
    for (const o of g.objectives) {
        if (o.complete || o.failed) continue;
        // Update progress based on type
        switch (o.type) {
            case 'depth':    o.progress = Math.min(o.target, g.depth); break;
            case 'salvage':  o.progress = (g.wrecks || []).filter(w => w.salvaged).length + (g._salvageCompleted || 0); break;
            case 'kill':     o.progress = g.kills; break;
            case 'aberrant': o.progress = g._aberrantKills || 0; break;
            case 'boss':     o.progress = g._bossKills || 0; break;
            case 'time':     o.progress = g.runTime; break;
            case 'no_hit': {
                const sc = g.scoreCombo;
                if (sc) o.progress = Math.min(o.target, g.runTime - (sc.lastHitTime || 0));
                break;
            }
            case 'chain':    o.progress = Math.max(o.progress, (g.scoreCombo && g.scoreCombo.chainCount) || 0); break;
        }
        // Completion
        if (o.progress >= o.target && !o.claimed) {
            o.complete = true;
            o.claimed = true;
            // Apply reward
            const give = OBJECTIVE_REWARDS[o.reward];
            if (give) give(g);
            if (o._mats) { addMaterials(o._mats); saveMeta(); g.floatingTexts.push({ x: g.player.x, y: g.player.y - 26, text: 'CONTRACT PAID — materials banked', color: '#5ADFCF', life: 2.2, vy: -20 }); }
            g.score = (g.score || 0) + o.scoreBonus;
            g.scoreFlash = 1;
            g.streak = 'OBJECTIVE COMPLETE'; g.streakTimer = 2.5;
            g.shake = 4; g.flashTimer = 0.3;
            sfxRevive();
            addNereidLog(g, `Objective complete: ${o.brief}.  +${o.scoreBonus} signal · ${o.reward.toUpperCase()} delivered.`);
        }
    }
}

// =====================================================================
// WORLD STRUCTURE — obstacles + wrecks per depth zone
// Subnautica-style biome flavor: each zone has its own static features.
// Wrecks are special: hold E to salvage, sonar pings reveal contents.
// =====================================================================
const OBSTACLE_TYPES_BY_ZONE = {
    SUNLIGHT: [
        { kind: 'kelp',    r: 24, color: '#3A7A4A' },
        { kind: 'rock',    r: 38, color: '#3A3838' },
        { kind: 'coral',   r: 22, color: '#D08060' },
    ],
    TWILIGHT: [
        { kind: 'kelp',    r: 28, color: '#2A5A4A' },
        { kind: 'rock',    r: 42, color: '#252830' },
        { kind: 'spire',   r: 30, color: '#2A2A38' },
        { kind: 'bones',   r: 46, color: '#8A8878' },
    ],
    MIDNIGHT: [
        { kind: 'spire',   r: 36, color: '#1A1A2A' },
        { kind: 'glowcap', r: 22, color: '#5060A0' },
        { kind: 'rock',    r: 44, color: '#1A1820' },
        { kind: 'bones',   r: 50, color: '#6A6A5E' },
        { kind: 'seep',    r: 26, color: '#3A3E42' },
    ],
    ABYSSAL: [
        { kind: 'spire',   r: 40, color: '#1A0A1A' },
        { kind: 'vent',    r: 28, color: '#A04030' },
        { kind: 'organic', r: 32, color: '#6A2040' },
        { kind: 'seep',    r: 30, color: '#30343A' },
    ],
    HADAL: [
        { kind: 'organic', r: 40, color: '#4A2030' },
        { kind: 'crystal', r: 26, color: '#9050D0' },
        { kind: 'spire',   r: 50, color: '#0A0408' },
        { kind: 'chitin',  r: 44, color: '#201018' },
        { kind: 'monolith', r: 36, color: '#0E1216' },
    ],
};

// PELAGOS-3 — THE SCAR. No life grew here; everything on the floor was built,
// then drowned. Machinery density climbs with depth.
const OBSTACLE_TYPES_P3 = {
    SUNLIGHT: [
        { kind: 'debris',   r: 34, color: '#2A2E30' },
        { kind: 'rock',     r: 38, color: '#33302C' },
        { kind: 'cable',    r: 30, color: '#22262A' },
    ],
    TWILIGHT: [
        { kind: 'debris',   r: 40, color: '#262A2C' },
        { kind: 'monolith', r: 30, color: '#12181C' },
        { kind: 'cable',    r: 34, color: '#1E2226' },
        { kind: 'rock',     r: 40, color: '#2A2824' },
    ],
    MIDNIGHT: [
        { kind: 'monolith', r: 34, color: '#101418' },
        { kind: 'debris',   r: 44, color: '#20242A' },
        { kind: 'vent',     r: 26, color: '#804838' },
        { kind: 'cable',    r: 36, color: '#1A1E22' },
    ],
    ABYSSAL: [
        { kind: 'monolith', r: 40, color: '#0E1216' },
        { kind: 'debris',   r: 48, color: '#1C2026' },
        { kind: 'vent',     r: 30, color: '#904030' },
        { kind: 'seep',     r: 28, color: '#2A3034' },
    ],
    RED_LAYER: [
        { kind: 'monolith', r: 42, color: '#140E12' },
        { kind: 'debris',   r: 50, color: '#241C20' },
        { kind: 'vent',     r: 32, color: '#A03828' },
    ],
    HADAL: [
        { kind: 'monolith', r: 48, color: '#0A0E12' },
        { kind: 'monolith', r: 30, color: '#10141A' },
        { kind: 'debris',   r: 54, color: '#181C22' },
        { kind: 'cable',    r: 44, color: '#14181C' },
    ],
};

// UTILITY BELT — carried consumables, used with [1]/[2] in the dive. Found in
// wrecks (and sold at the Mooring, S5). Every use writes into the ecology:
// tools make noise and light; the water keeps score.
const BELT_DEFS = {
    belt_decoy:  { name: 'DECOY BEACON',  desc: 'Screams for 8s. Everything nearby investigates IT.', value: 45 },
    belt_mine:   { name: 'PROXIMITY MINE', desc: 'Arms in 1s. 80 damage when something noses it.',    value: 50 },
    belt_flare:  { name: 'PHOSPHOR FLARE', desc: 'Light burst — routs close ambushers, lights the dark for 6s.', value: 35 },
    belt_buoy:   { name: 'SONAR BUOY',     desc: 'Pings on its own for 25s. Reveals wrecks around it.', value: 40 },
    belt_net:    { name: 'TANGLE NET',     desc: 'Roots what swims into it for 6s.',                  value: 45 },
    belt_ballast:{ name: 'EMERGENCY BALLAST', desc: 'Violent upward blow + brief invulnerability. Loud.', value: 55 },
};
function useBeltItem(g, item) {
    const p2 = g.player;
    if (!g.deployables) g.deployables = [];
    if (item.id === 'belt_decoy') {
        g.deployables.push({ kind: 'decoy', x: p2.x, y: p2.y, life: 8 });
        g.noise = Math.min(2.5, (g.noise || 0) + 0.4);
    } else if (item.id === 'belt_mine') {
        g.deployables.push({ kind: 'mine', x: p2.x, y: p2.y + 26, life: 40, arm: 1 });
    } else if (item.id === 'belt_flare') {
        g._flareT = 6;
        for (const e of g.enemies) {
            if ((e.role === 'ambush' || e.ai === 'ambush' || e.ai === 'zigzag') && dist(p2, e) < 500) e._feared = 2;
        }
        playTone(880, 0.5, 'sine', 0.1);
        g.deployables.push({ kind: 'flare', x: p2.x, y: p2.y, life: 6 });
    } else if (item.id === 'belt_buoy') {
        g.deployables.push({ kind: 'buoy', x: p2.x, y: p2.y, life: 25, pingT: 0 });
    } else if (item.id === 'belt_net') {
        g.deployables.push({ kind: 'net', x: p2.x, y: p2.y - 30, life: 12 });
    } else if (item.id === 'belt_ballast') {
        p2.dashVy = -1500; p2.dashVx = 0; p2.dashTimer = 0.35; p2.iFrames = Math.max(p2.iFrames, 0.8);
        g.noise = Math.min(2.5, (g.noise || 0) + 0.8);
        g.shake = 8;
        noiseBurst(0.7, 0.1, 300);
    }
    setModeMsg(g, '◈ ' + BELT_DEFS[item.id].name + ' DEPLOYED');
}

function updateDeployables(g, dt, p2) {
    if (!g.deployables) return;
    for (let i = g.deployables.length - 1; i >= 0; i--) {
        const d = g.deployables[i];
        d.life -= dt;
        if (d.life <= 0) { g.deployables.splice(i, 1); continue; }
        if (d.kind === 'decoy') {
            // Everything with ears goes to look at the noise that is not you
            for (const e of g.enemies) {
                if (!e.isBoss && dist(d, e) < 700) e._lure = { x: d.x, y: d.y, t: 0.4 };
            }
        } else if (d.kind === 'mine') {
            if (d.arm > 0) { d.arm -= dt; continue; }
            for (const e of g.enemies) {
                if (e.hp > 0 && dist(d, e) < 60) {
                    for (const e2 of g.enemies) {
                        if (dist(d, e2) < 130) { e2.hp -= 80; e2.flash = 0.2; }
                    }
                    sfxExplosion();
                    g.noise = Math.min(2.5, (g.noise || 0) + 0.6);
                    g.deployables.splice(i, 1);
                    break;
                }
            }
        } else if (d.kind === 'buoy') {
            d.pingT -= dt;
            if (d.pingT <= 0) {
                d.pingT = 3;
                d._ring = 0.01;
                for (const wk of g.wrecks) { if (dist(d, wk) < 420) wk.revealed = true; }
            }
            if (d._ring) { d._ring += dt * 300; if (d._ring > 420) d._ring = 0; }
        } else if (d.kind === 'net') {
            for (const e of g.enemies) {
                if (!e.isBoss && dist(d, e) < 130) e._netT = 0.35;
            }
        }
    }
    if (g._flareT > 0) g._flareT -= dt;
}

function drawDeployables(g) {
    if (!g.deployables) return;
    const t = g.runTime;
    for (const d of g.deployables) {
        if (d.kind === 'decoy') {
            drawGlow(ctx, '#FFB040', d.x, d.y, 20 + Math.sin(t * 8) * 6, 0.6);
            ctx.fillStyle = '#FFB040'; ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, PI2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,176,64,0.25)'; ctx.lineWidth = 1.5;
            const rr = ((t * 160) % 240);
            ctx.beginPath(); ctx.arc(d.x, d.y, rr, 0, PI2); ctx.stroke();
        } else if (d.kind === 'mine') {
            const armed = d.arm <= 0;
            ctx.fillStyle = armed ? (Math.sin(t * 6) > 0 ? '#FF5040' : '#802820') : '#556';
            ctx.beginPath(); ctx.arc(d.x, d.y, 7, 0, PI2); ctx.fill();
            ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
            for (let k = 0; k < 4; k++) { const a = k * 1.57 + 0.78; ctx.beginPath(); ctx.moveTo(d.x + Math.cos(a) * 7, d.y + Math.sin(a) * 7); ctx.lineTo(d.x + Math.cos(a) * 11, d.y + Math.sin(a) * 11); ctx.stroke(); }
        } else if (d.kind === 'flare') {
            drawGlow(ctx, '#FFF0C0', d.x, d.y, 90 * (d.life / 6) + 30, 0.8);
            ctx.fillStyle = '#FFF8E0'; ctx.beginPath(); ctx.arc(d.x, d.y + (6 - d.life) * 10, 4, 0, PI2); ctx.fill();
        } else if (d.kind === 'buoy') {
            ctx.fillStyle = '#5AD0FF'; ctx.beginPath(); ctx.arc(d.x, d.y, 6, 0, PI2); ctx.fill();
            ctx.fillStyle = '#B0E8FF'; ctx.fillRect(d.x - 1, d.y - 14, 2, 9);
            if (d._ring) { ctx.strokeStyle = 'rgba(90,208,255,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(d.x, d.y, d._ring, 0, PI2); ctx.stroke(); }
        } else if (d.kind === 'net') {
            ctx.strokeStyle = 'rgba(160,220,190,0.4)'; ctx.lineWidth = 1;
            for (let k = -3; k <= 3; k++) {
                ctx.beginPath(); ctx.moveTo(d.x + k * 20, d.y - 60); ctx.lineTo(d.x + k * 20, d.y + 60); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(d.x - 60, d.y + k * 20); ctx.lineTo(d.x + 60, d.y + k * 20); ctx.stroke();
            }
        }
    }
}

const WRECK_LOOT_TABLE = [
    { id: 'gold',      label: 'GOLD CACHE',         color: '#DAA520', weight: 4, give: g => { const a = 50 + Math.floor(Math.random() * 100) + Math.floor(g.depth / 30); g.goldEarned += a; g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: `+${a}g`, color: '#FFD040', life: 1.4, vy: -28 }); } },
    { id: 'heal',      label: 'MED-KIT',            color: '#4AE0A0', weight: 3, give: g => { const a = Math.floor(g.player.maxHp * 0.5); g.player.hp = Math.min(g.player.maxHp, g.player.hp + a); g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: `+${a} HULL`, color: '#4AE0A0', life: 1.4, vy: -28 }); } },
    { id: 'lore',      label: 'PILOT LOG',          color: '#A8E0FF', weight: 3, give: g => { dropLore(g); g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: 'LORE FRAGMENT', color: '#A8E0FF', life: 1.6, vy: -28 }); } },
    { id: 'weapon_lv', label: 'WEAPON CACHE',       color: '#D080FF', weight: 2, give: g => { const ws = g.player.weapons.filter(w => w.level < 8); if (ws.length) { const w = ws[Math.floor(Math.random() * ws.length)]; w.level++; g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: `${WEAPON_DEFS[w.id].name} +1`, color: '#D080FF', life: 1.6, vy: -28 }); } else g.goldEarned += 100; } },
    { id: 'xp',        label: 'BLACK BOX',          color: '#80FFA0', weight: 3, give: g => { const a = Math.floor(xpForLevel(g.player.level) * 0.6); g.player.xp += a; g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: `+${a} XP`, color: '#80FFA0', life: 1.4, vy: -28 }); } },
    { id: 'defiance',  label: 'EJECT POD',          color: '#FFD040', weight: 1, give: g => { g.player.deathDefiance++; g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: '+1 DEFIANCE', color: '#FFD040', life: 1.8, vy: -28 }); } },
    { id: 'chart', label: 'DEPTH CHART', color: '#E8D080', weight: 2, give: g => {
        meta.chartNext = true; saveMeta();
        g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: 'DEPTH CHART — next dive, wrecks marked', color: '#E8D080', life: 2, vy: -26 });
    } },
    { id: 'cargo', label: 'CARGO CRATE', color: '#C0A060', weight: 3, give: g => {
        const v = 60 + Math.floor(Math.random() * 80);
        if (g.inventory.length < 50) {
            g.inventory.push({ id: 'cargo', name: 'CARGO (' + v + 'g)', cargo: true, value: v, depth: g.depth });
            g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: '+CARGO CRATE (' + v + 'g at surface)', color: '#C0A060', life: 1.8, vy: -26 });
        } else g.goldEarned += v;
    } },
    { id: 'belt_loot', label: 'UTILITY CACHE', color: '#5AD0FF', weight: 3, give: g => {
        const ids = Object.keys(BELT_DEFS);
        const bid = ids[Math.floor(Math.random() * ids.length)];
        if (g.inventory.length < 50) {
            g.inventory.push({ id: bid, name: BELT_DEFS[bid].name, belt: true, value: BELT_DEFS[bid].value, depth: g.depth });
            g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: '+' + BELT_DEFS[bid].name, color: '#5AD0FF', life: 1.6, vy: -28 });
        } else g.goldEarned += BELT_DEFS[bid].value;
    } },
    { id: 'repair_kit_loot', label: 'REPAIR KIT',  color: '#80FFA0', weight: 4, give: g => {
        if (g.inventory.length < 50) {
            g.inventory.push({ ...REPAIR_KIT, depth: g.depth });
            g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: '+REPAIR KIT', color: '#80FFA0', life: 1.6, vy: -28 });
        } else {
            g.goldEarned += REPAIR_KIT.value;
            g.floatingTexts.push({ x: g.player.x, y: g.player.y - 24, text: 'INV FULL — sold', color: '#FFD040', life: 1.4, vy: -28 });
        }
    } },
];

function pickWreckLoot() {
    const total = WRECK_LOOT_TABLE.reduce((s, l) => s + l.weight, 0);
    let r = Math.random() * total;
    for (const l of WRECK_LOOT_TABLE) { r -= l.weight; if (r <= 0) return l; }
    return WRECK_LOOT_TABLE[0];
}

// =====================================================================
// WRECK STORIES — every salvage tells a small horror.
// Each wreck has a name + a 2-line last log. NEREID reads it aloud.
// Some entries reference each other (arcs) — finding multiple builds a story.
// =====================================================================
const WRECK_STORIES = [
    { name: 'DSV-MERIDIAN',     log: ["Day 12. NEREID's been humming.", "Like she's trying to remember a song she never learned."] },
    { name: 'DSV-TRITON',       log: ["Compass dead. Sonar dead.", "NEREID says we're at 4,200m. I don't believe her."] },
    { name: 'DSV-ARGO',         log: ["Found the Meridian's beacon.", "Following it. Final entry — please notify family."] },
    { name: 'DSV-NAUTILUS',     log: ["It's not water down here.", "It's NOTICING us."] },
    { name: 'DSV-BEEBE',        log: ["Three days adrift. Heard tapping.", "From OUTSIDE the hull."] },
    { name: 'DSV-COUSTEAU',     log: ["Pilot training never covered this.", "Nothing did."] },
    { name: 'DSV-PICCARD',      log: ["If you find this — surface.", "Don't ping. They listen for it."] },
    { name: 'DSV-FOREL',        log: ["NEREID won't stop apologizing.", "I think she knows what she did."] },
    { name: 'DSV-RIFTWALKER',   log: ["Saw Meridian's lights at the boundary.", "They don't blink right."] },
    { name: 'DSV-BALLARD',      log: ["We were never meant to come back.", "From this depth, no one does."] },
    { name: 'DSV-WALSH',        log: ["[AUDIO DEGRADED] ...not a creature...", "...city... building... us..."] },
    { name: 'DSV-EARLE',        log: ["There are eyes here.", "They don't belong to anything I can name."] },
    { name: 'DSV-BATHY',        log: ["Found older pilot logs in the wreck.", "Same words as mine. Different pilots."] },
    { name: 'DSV-CHALLENGER',   log: ["We are the swarm now.", "We always were."] },
    { name: 'DSV-FENDOUZHE',    log: ["Engines failed at 3,800m.", "Took the photographs anyway. They came out wrong."] },
    { name: 'DSV-LIMITING-FACTOR', log: ["NEREID asked me my name today.", "She asked again ten seconds later. She didn't remember."] },
    { name: 'DSV-ALVIN',        log: ["The trench is breathing.", "Once per hour. We synced our breathing to it. Mistake."] },
    { name: 'DSV-MIR',          log: ["Last reading: 5,400m. Hull intact.", "Crew status: present. Crew identity: unknown."] },
];

function pickWreckStory(g) {
    const used = new Set((g.wrecks || []).map(w => w.name).filter(Boolean));
    const avail = WRECK_STORIES.filter(s => !used.has(s.name));
    return (avail.length ? avail : WRECK_STORIES)[Math.floor(Math.random() * (avail.length || WRECK_STORIES.length))];
}

// World bounds — CIRCULAR trench. Shrinks with depth (descent), widens again on ascent.
function updateWorldBounds(g) {
    const d = g.depth || 0;
    const t = Math.min(1, d / 6000);
    const curved = t < 0.3 ? t * 0.5 : 0.15 + (t - 0.3) * 1.21;
    let radius = Math.round(1800 - 1400 * Math.min(1, curved));     // surface 1800 → Hadal 400
    // Ascending — give a slight bonus radius so the climb feels less suffocating
    if (g.ascending) radius = Math.min(2000, radius + 200);
    g.worldBounds.radius = radius;
    g.worldBounds.minX = -radius;
    g.worldBounds.maxX =  radius;
    g.worldBounds.minY = -radius;
    g.worldBounds.maxY =  radius;
    g.worldBounds.cx = 0;
    g.worldBounds.cy = 0;
}

function spawnWorldObjects(g, dt) {
    if (!g.obstacles) g.obstacles = [];
    if (!g.wrecks) g.wrecks = [];
    const zone = zoneFromDepth(g.depth);
    const table = g.moon === 'p3' ? OBSTACLE_TYPES_P3 : OBSTACLE_TYPES_BY_ZONE;
    const types = table[zone] || table.SUNLIGHT;
    const wb = g.worldBounds;

    // 3D DEPTH MODEL — each obstacle has its own depth (obDepth) ahead of the sub.
    // It fades in as we approach its depth, fully visible when sub depth ≈ obDepth, fades out when we pass.
    // Visibility window: ±OB_DEPTH_RANGE meters around the object's depth.
    const OB_DEPTH_RANGE = 35;   // visible ±35m from sub's depth
    let targetCount = zone === 'SUNLIGHT' ? 12 : zone === 'TWILIGHT' ? 16 : zone === 'MIDNIGHT' ? 20 : zone === 'ABYSSAL' ? 24 : zone === 'RED_LAYER' ? 26 : 28;
    if (isTouchDevice && Math.min(canvas.width, canvas.height) < 520) targetCount = Math.ceil(targetCount * 0.6);
    while (g.obstacles.length < targetCount) {
        const t = types[Math.floor(Math.random() * types.length)];
        // Random point inside the CIRCULAR trench (uniform disc sample)
        const ang = Math.random() * PI2;
        const rad = Math.sqrt(Math.random()) * (wb.radius || 1000);
        const x = (wb.cx || 0) + Math.cos(ang) * rad;
        const y = (wb.cy || 0) + Math.sin(ang) * rad;
        const obDepth = (g.depth || 0) + 5 + Math.random() * (OB_DEPTH_RANGE - 5);
        g.obstacles.push({
            x, y, r: t.r * (0.85 + Math.random() * 0.4),
            kind: t.kind, color: t.color,
            seed: Math.random() * 100,
            zone,
            obDepth,
        });
    }

    // Cull obstacles the sub has fully passed (depth > obDepth + range), or that fell outside the (shrinking) circular bound.
    for (let i = g.obstacles.length - 1; i >= 0; i--) {
        const ob = g.obstacles[i];
        if ((g.depth - ob.obDepth) > OB_DEPTH_RANGE) { g.obstacles.splice(i, 1); continue; }
        const dx = ob.x - (wb.cx || 0), dy = ob.y - (wb.cy || 0);
        if (dx * dx + dy * dy > (wb.radius + 50) * (wb.radius + 50)) g.obstacles.splice(i, 1);
    }

    // CARRIER — rare, docile, glowing with worth. Kill it or let it pass; the trench is listening.
    g._carrierTimer = (g._carrierTimer || 40) - dt;
    if (g._carrierTimer <= 0 && g.depth > 800 && !g.enemies.some(e => e.typeId === 'carrier')) {
        g._carrierTimer = 75 + Math.random() * 45;
        const ca = Math.random() * PI2;
        spawnEnemy(g, { id: 'carrier', ...ENEMY_TYPES.carrier }, { x: g.player.x + Math.cos(ca) * 450, y: g.player.y + Math.sin(ca) * 450 });
        addNereidLog(g, 'Contact — unarmed. Heavy. Carrying. Meridian pays triple for intact pods, Pilot. I am only reporting that.');
    }

    // Wrecks — spawn occasionally, max 3 active. Each only spawns once per zone interval.
    g._wreckSpawnTimer = (g._wreckSpawnTimer || 25) - dt;
    if (g._wreckSpawnTimer <= 0 && g.wrecks.length < 3 && g.depth > 150) {
        g._wreckSpawnTimer = 35 + Math.random() * 25;
        const loot = pickWreckLoot();
        const story = pickWreckStory(g);
        // Random point inside circular trench
        const wrAng = Math.random() * PI2;
        const wrRad = Math.sqrt(Math.random()) * (wb.radius || 1000);
        const x = (wb.cx || 0) + Math.cos(wrAng) * wrRad;
        const y = (wb.cy || 0) + Math.sin(wrAng) * wrRad;
        // Wrecks sit at a depth ahead of us; we'll descend toward them
        const obDepth = (g.depth || 0) + 15 + Math.random() * 35;
        g.wrecks.push({
            x, y, r: 38,
            loot,
            name: story.name,
            log: story.log,
            revealed: false,
            salvaged: false,
            seed: Math.random() * 100,
            spawnedAt: g.runTime,
            obDepth,
        });
    }
    // Cull wrecks we've fully passed (depth-wise)
    const WRECK_DEPTH_RANGE = 50;
    for (let i = g.wrecks.length - 1; i >= 0; i--) {
        const wr = g.wrecks[i];
        if ((g.depth - wr.obDepth) > WRECK_DEPTH_RANGE) g.wrecks.splice(i, 1);
    }

    // SPECIAL EVENTS: Whale Fall (Twilight–Abyssal) and Hydrothermal Vent (Abyssal–Hadal)
    if (!g.specialEvents) g.specialEvents = [];
    g._specialEventCd = (g._specialEventCd || 60) - dt;
    if (g._specialEventCd <= 0 && g.specialEvents.length < 1) {
        g._specialEventCd = 90 + Math.random() * 60;
        // Pick event type by depth
        let kind = null;
        if (g.depth >= 800 && g.depth < 2500 && Math.random() < 0.5) kind = 'whalefall';
        else if (g.depth >= 1500 && Math.random() < 0.45) kind = 'blackwater';
        else if (g.depth >= 2200 && Math.random() < 0.6) kind = 'vent';
        else if (g.depth >= 500 && Math.random() < 0.4) kind = 'triangulation';
        if (kind) {
            const a = Math.random() * PI2;
            const r = Math.sqrt(Math.random()) * (wb.radius || 1000) * 0.7;
            const x = (wb.cx || 0) + Math.cos(a) * r;
            const y = (wb.cy || 0) + Math.sin(a) * r;
            const obDepth = (g.depth || 0) + 10 + Math.random() * 30;
            const ev = { kind, x, y, r: kind === 'whalefall' ? 60 : kind === 'blackwater' ? 300 : 36, obDepth, life: kind === 'blackwater' ? 90 : kind === 'triangulation' ? 75 : 60, looted: false, scavengerTimer: 0, ventPulse: 0 };
            if (kind === 'triangulation') {
                // Three beacons sing at one hidden point — read where the rings meet.
                ev.beacons = [0, 1, 2].map(i => {
                    const ba = (i / 3) * PI2 + Math.random() * 1.2;
                    const bd = 170 + Math.random() * 160;
                    return { x: x + Math.cos(ba) * bd, y: y + Math.sin(ba) * bd, dist: 0 };
                });
                ev.beacons.forEach(b => { b.dist = Math.hypot(b.x - x, b.y - y); });
            }
            g.specialEvents.push(ev);
            if (kind === 'whalefall') addNereidLog(g, 'Whale fall detected. Massive carcass. Scavengers will gather.');
            if (kind === 'vent') addNereidLog(g, 'Hydrothermal vent. Heat. Fauna. Easy way to die.');
            if (kind === 'blackwater') addNereidLog(g, 'Blackwater ahead. A region my lamps cannot answer. Something valuable sinks into places like that.');
            if (kind === 'triangulation') addNereidLog(g, 'Three beacons, one buried signal. Where the rings agree, Pilot — that is where it is.');
        }
    }
    // Tick events
    g._inBlackwater = false;
    for (let i = g.specialEvents.length - 1; i >= 0; i--) {
        const ev = g.specialEvents[i];
        ev.life -= dt;
        // Cull if depth-passed
        if ((g.depth - ev.obDepth) > 50 || ev.life <= 0) { g.specialEvents.splice(i, 1); continue; }
        if (ev.kind === 'whalefall') {
            // Spawn scavengers periodically, give XP gems while in range
            ev.scavengerTimer -= dt;
            if (ev.scavengerTimer <= 0 && Math.abs(g.depth - ev.obDepth) < 15) {
                ev.scavengerTimer = 6;
                // Spawn 2-3 piranha-style scavengers near the carcass
                for (let si = 0; si < 3; si++) {
                    const sa = Math.random() * PI2;
                    spawnEnemy(g, { id: 'piranha', ...ENEMY_TYPES.piranha }, { x: ev.x + Math.cos(sa) * 60, y: ev.y + Math.sin(sa) * 60 });
                }
            }
            // If player nearby + at right depth, drop free XP gems (the whale's bounty)
            const pd = Math.hypot(g.player.x - ev.x, g.player.y - ev.y);
            if (pd < 80 && Math.abs(g.depth - ev.obDepth) < 12 && !ev.looted) {
                ev.looted = true;
                for (let gi = 0; gi < 8; gi++) {
                    const gAng = Math.random() * PI2;
                    g.gems.push({
                        x: ev.x + Math.cos(gAng) * 30, y: ev.y + Math.sin(gAng) * 30,
                        value: 6, size: 4, life: 25, dropDepth: g.depth,
                        tier: 2, color: GEM_TIERS[1].color, glowColor: GEM_TIERS[1].glow,
                    });
                }
                addNereidLog(g, 'Bounty harvested. The whale gives.');
            }
        } else if (ev.kind === 'blackwater') {
            // BLACKWATER (Iron Lung) — light dies inside; sonar is the only sense.
            const pd = Math.hypot(g.player.x - ev.x, g.player.y - ev.y);
            const atDepth = Math.abs(g.depth - ev.obDepth) < 25;
            if (pd < ev.r && atDepth) {
                g._inBlackwater = true;
                // Entry beat — once per pocket
                if (!ev._entered) {
                    ev._entered = true;
                    g.shake = Math.min(6, (g.shake || 0) + 3);
                    playTone(48, 0.5, 'sine', 0.06);
                    addNereidLog(g, 'We are inside it. Floodlights are useless here. Count your pings, Pilot.');
                    // The dark keeps things — two dormant lurkers wake as you enter
                    for (let li = 0; li < 2; li++) {
                        const la = Math.random() * PI2, lr = ev.r * (0.3 + Math.random() * 0.5);
                        const lt = ENEMY_TYPES.lurker ? 'lurker' : 'anglerfish';
                        spawnEnemy(g, { id: lt, ...ENEMY_TYPES[lt] }, { x: ev.x + Math.cos(la) * lr, y: ev.y + Math.sin(la) * lr });
                    }
                }
                // Treasure at the core — reach the centre blind to claim it
                if (pd < 60 && !ev.looted) {
                    ev.looted = true;
                    const richPool = LOOT_TYPES.filter(l => l.rarity === 'rare' || l.rarity === 'legendary');
                    for (let li = 0; li < 2; li++) {
                        const lt = richPool[Math.floor(Math.random() * richPool.length)];
                        g.lootItems.push({ x: ev.x + (Math.random() - 0.5) * 40, y: ev.y + (Math.random() - 0.5) * 40, type: lt, size: 6, life: 30, dropDepth: g.depth || 0 });
                    }
                    for (let gi = 0; gi < 6; gi++) {
                        const gAng = Math.random() * PI2;
                        g.gems.push({ x: ev.x + Math.cos(gAng) * 35, y: ev.y + Math.sin(gAng) * 35, value: 12, size: 6, life: 25, dropDepth: g.depth, tier: 3, color: GEM_TIERS[2].color, glowColor: GEM_TIERS[2].glow });
                    }
                    if (Math.random() < 0.35) dropLore(g);
                    g.flashTimer = 0.25;
                    addNereidLog(g, 'Recovered. Whatever sank here, we have its cargo. Now leave the way we came.');
                }
            }
        } else if (ev.kind === 'triangulation') {
            // TRIANGULATION — reach the point where the three beacon rings agree.
            const pd = Math.hypot(g.player.x - ev.x, g.player.y - ev.y);
            if (pd < 45 && Math.abs(g.depth - ev.obDepth) < 12 && !ev.looted) {
                ev.looted = true;
                ev.life = Math.min(ev.life, 4);
                const sig = 12 + Math.floor((g.depth || 0) / 250);
                meta.signal = (meta.signal || 0) + sig;
                g.goldEarned += 60;
                dropLore(g);
                g.floatingTexts.push({ x: ev.x, y: ev.y - 20, text: `⌁ +${sig} SIGNAL`, color: '#B0A0E8', life: 1.8, vy: -26 });
                g.floatingTexts.push({ x: ev.x, y: ev.y + 2, text: '+60g · LORE', color: '#FFD040', life: 1.6, vy: -22 });
                g.flashTimer = 0.2;
                saveMeta();
                addNereidLog(g, 'Signal source secured. Someone wanted this found — or wanted to know who could find it.');
            }
        } else if (ev.kind === 'vent') {
            // HEAL aura when player is at the vent's depth and near it
            ev.ventPulse += dt;
            const pd = Math.hypot(g.player.x - ev.x, g.player.y - ev.y);
            if (pd < 90 && Math.abs(g.depth - ev.obDepth) < 12) {
                g.player.hp = Math.min(g.player.maxHp, g.player.hp + 4 * dt);
            }
            // Spawn vent-aggressive tubeworms periodically
            ev.scavengerTimer -= dt;
            if (ev.scavengerTimer <= 0 && Math.abs(g.depth - ev.obDepth) < 15) {
                ev.scavengerTimer = 8;
                if (ENEMY_TYPES.tubeworm) {
                    const sa = Math.random() * PI2;
                    spawnEnemy(g, { id: 'tubeworm', ...ENEMY_TYPES.tubeworm }, { x: ev.x + Math.cos(sa) * 50, y: ev.y + Math.sin(sa) * 50 });
                }
            }
        }
    }
}

function updateWreckInteraction(g, dt) {
    const p = g.player;
    g.nearestWreck = null;
    let bestD = p._salvageRange || 90;   // GRAPNEL PROW reaches further
    for (const wr of (g.wrecks || [])) {
        if (wr.salvaged) continue;
        const d = Math.hypot(wr.x - p.x, wr.y - p.y);
        if (d < bestD) { bestD = d; g.nearestWreck = wr; }
        // Sonar reveal: if a sonar ring overlaps the wreck, mark revealed
        if (!wr.revealed) {
            for (const ef of g.effects) {
                if (ef.type !== 'sonar_ring') continue;
                const rd = Math.hypot(ef.x - wr.x, ef.y - wr.y);
                if (rd < ef.radius + 10) { wr.revealed = true; break; }
            }
        }
    }
    // Salvage hold — E key (handled in keydown); here we tick the timer
    const eHeld = !!keys['e'];
    if (g.nearestWreck && eHeld) {
        g.salvageHoldTime = (g.salvageHoldTime || 0) + dt * (p._salvageSpd || 1);
        if (g.salvageHoldTime >= 1.5) {
            g.nearestWreck.salvaged = true;
            playSample('salvage', 0.5, 0.95 + Math.random() * 0.1);
            g.nearestWreck.loot.give(g);
            g._salvageCompleted = (g._salvageCompleted || 0) + 1;
            const wr = g.nearestWreck;
            addNereidLog(g, `${wr.name} — salvage complete.  ${wr.loot.label} recovered.`);
            // Read the wreck's last log over the next few seconds
            if (wr.log && wr.log.length) {
                setTimeout(() => { if (game) addNereidLog(game, `${wr.name} log: "${wr.log[0]}"`); }, 2200);
                if (wr.log[1]) setTimeout(() => { if (game) addNereidLog(game, `…"${wr.log[1]}"`); }, 5800);
            }
            g.shake = 3; g.flashTimer = 0.2;
            sfxRevive();
            g.salvageHoldTime = 0;
            // Remove the wreck after a short delay so the player sees the empty hull
            setTimeout(() => { if (game) game.wrecks = game.wrecks.filter(x => !x.salvaged); }, 1500);
        }
    } else {
        g.salvageHoldTime = Math.max(0, (g.salvageHoldTime || 0) - dt * 2);
    }
}

// =====================================================================
// SCORING — Balatro-style chips × mult, with combo tags
// Called on every enemy kill. Returns { chips, mult, total, tags }.
// =====================================================================
const ZONE_MULT = { SUNLIGHT: 1, TWILIGHT: 1.25, MIDNIGHT: 1.6, ABYSSAL: 2.2, HADAL: 3.5 };
function zoneFromDepth(d) {
    if (d < 200) return 'SUNLIGHT';
    if (d < 1000) return 'TWILIGHT';
    if (d < 2000) return 'MIDNIGHT';
    if (d < 3500) return 'ABYSSAL';
    if (d < 4500) return 'RED_LAYER';
    return 'HADAL';
}
function scoreKill(g, e, opts) {
    opts = opts || {};
    const sc = g.scoreCombo;
    const tags = [];
    // CHIPS — base kill value, scaled by toughness
    let chips = Math.max(2, e.xp || 1) * 5 + Math.floor((e.maxHp || 1) / 4);
    if (e.aberrant) { chips *= 3; tags.push('APEX×3'); }
    if (e.isBoss || (e.maxHp || 0) >= 500) { chips *= 10; tags.push('HUNTER×10'); }
    // MULT — base 1, then layered modifiers
    let mult = 1;
    // Zone tier (the deeper, the richer)
    const zone = zoneFromDepth(g.depth);
    const zMult = ZONE_MULT[zone] || 1;
    mult *= zMult;
    if (zMult > 1) tags.push(`${zone} ×${zMult.toFixed(1)}`);
    // Chain bonus (linked kills within 1.2s of each other)
    if (sc.chainCount > 1) {
        const chainBonus = Math.min(4, sc.chainCount * 0.08);
        mult += chainBonus;
        tags.push(`CHAIN+${chainBonus.toFixed(1)}`);
    }
    // Variety bonus (distinct enemy types within 4s)
    if (sc.uniqueTypes.size >= 3) {
        mult += sc.uniqueTypes.size * 0.4;
        tags.push(`VARIETY+${(sc.uniqueTypes.size * 0.4).toFixed(1)}`);
    }
    // Sonar burst bonus
    if (opts.sonarBurst && sc.sonarBurstCount >= 4) {
        const burstBonus = Math.min(4, sc.sonarBurstCount * 0.25);
        mult += burstBonus;
        tags.push(`PING+${burstBonus.toFixed(1)}`);
    }
    // Perfect (no-hit for 12s+) — calm hunter bonus
    const noHitFor = g.runTime - sc.lastHitTime;
    if (noHitFor > 12) {
        mult += 1.5;
        tags.push('PERFECT+1.5');
    }
    // Stakes pay — every active stake is +15% score
    if ((g._stakeMult || 1) > 1) { mult *= g._stakeMult; tags.push(`STAKE×${g._stakeMult.toFixed(2)}`); }
    const total = Math.floor(chips * mult);
    g.score = (g.score || 0) + total;
    sc.lastEvent = { chips, mult, total, tags, time: g.runTime };
    g.scoreFlash = Math.min(1, total / 800);
    return sc.lastEvent;
}

function damageEnemy(g, e, dmg) {
    if (e.ghost) return; // ghost enemies take no real damage
    if (e._phased) {
        // VAMPYRO/phase-tissue untargetable while phased — flash a tag so player knows damage is blocked
        if (Math.random() < 0.08) g.floatingTexts.push({ x: e.x, y: e.y - 10, text: 'PHASED', color: '#A06ACC', life: 0.6, vy: -20 });
        return;
    }
    if (e._burstState === 'rising') {
        // TRENCH WORM / CAPILLARY WORM still rising from substrate — flash tag
        if (Math.random() < 0.08) g.floatingTexts.push({ x: e.x, y: e.y - 10, text: 'RISING', color: '#FFD040', life: 0.6, vy: -20 });
        return;
    }
    // HERMIT — the drill housing halves damage while closed; after a charge the
    // actuator vents and the soft rear is exposed (bonus damage window)
    if (e.typeId === 'hermit') {
        if (e._exposedT > 0) {
            dmg *= 1.5;
            if (Math.random() < 0.15) g.floatingTexts.push({ x: e.x, y: e.y - 14, text: 'EXPOSED', color: '#FFD040', life: 0.6, vy: -20 });
        } else {
            dmg *= 0.5;
        }
    }
    // Apply player damage multipliers
    const p = g.player;
    let finalDmg = dmg;
    if (p._berserkerMult) finalDmg *= p._berserkerMult;
    if (p._depthDmgMult) finalDmg *= p._depthDmgMult;
    if (p._corruptDmgMult) finalDmg *= p._corruptDmgMult;
    if (p._depthDiverMult) finalDmg *= p._depthDiverMult;
    // Research bonus vs studied species: T1 +8%, T2 +14%, T3 +20%
    const _rt = meta.research[e.typeId] || 0;
    if (_rt > 0) finalDmg *= [1, 1.08, 1.14, 1.2][Math.min(3, _rt)];
    if (e.aberrant && meta.aberrantScanned.includes('aberrant_' + e.typeId)) finalDmg *= 1.1;
    e.hp -= finalDmg;
    e.flash = 0.1;
    // ECOLOGY: damage spills into the water — scavengers and clots read it. Corpse on death.
    if (g._modeCfg && g._modeCfg.ecology) {
        g.bloodLevel = Math.min(2.5, (g.bloodLevel || 0) + 0.04);
        if (e.hp <= 0 && !e._dead) {
            e._dead = true;
            g.corpses.push({ x: e.x, y: e.y, t: 14, role: e.role, size: e.size || 12 });
            g.bloodLevel = Math.min(2.5, (g.bloodLevel || 0) + 0.25);
        }
    }
    // Feature 3: Squid flees when damaged
    if (e.ai === 'curious' && e.state !== 'flee') {
        e.state = 'flee';
        e.stateTimer = 2;
    }
    g.floatingTexts.push({ x: e.x + (Math.random() - 0.5) * 10, y: e.y - 10, text: Math.floor(finalDmg).toString(), color: '#FFD040', life: 0.6, vy: -40 });
}

// --- Level up ---
// Player-directed fusion (Ball X Pit): FUSE cards appear at level-up once both
// components reach FUSE_MIN_LEVEL. Fusing is a choice, never automatic.
function fusionOptions(g) {
    const opts = [];
    for (const evo of WEAPON_EVOLUTIONS) {
        const wA = g.player.weapons.find(w => w.id === evo.a);
        const wB = g.player.weapons.find(w => w.id === evo.b);
        if (wA && wB && wA.level >= FUSE_MIN_LEVEL && wB.level >= FUSE_MIN_LEVEL) opts.push(evo);
    }
    return opts;
}
function performFusion(g, evo) {
    const wA = g.player.weapons.find(w => w.id === evo.a);
    const wB = g.player.weapons.find(w => w.id === evo.b);
    if (!wA || !wB) return;
    // Fused weapon inherits the parents' average level — fusing early is possible,
    // fusing late is stronger. The choice is the game.
    const level = Math.min(8, Math.ceil((wA.level + wB.level) / 2));
    g.player.weapons = g.player.weapons.filter(w => w !== wA && w !== wB);
    g.player.weapons.push({ id: evo.result, level, cooldown: 0 });
    g.streak = 'FUSION: ' + evo.name + '!';
    g.streakTimer = 3;
    g.flashTimer = 0.6;
    g.shake = 15;
    g.slowmo = 0.5;
    sfxRevive();
    if (!g._fusedNames) g._fusedNames = [];
    g._fusedNames.push(evo.name);
    addNereidLog(g, getNereidLine('evolution', g));
    // First-time discovery — knowledge survives the hull, like lore
    if (!meta.fusionsDiscovered.includes(evo.result)) {
        meta.fusionsDiscovered.push(evo.result);
        saveMeta();
        g.streak = 'NEW FUSION DISCOVERED: ' + evo.name;
        g.streakTimer = 4;
        const lines = NEREID.fusionDiscovery;
        addNereidLog(g, lines[Math.floor(Math.random() * lines.length)].replace('{name}', evo.name));
    }
}

function triggerLevelUp(g) {
    sfxLevelUp();
    g.flashTimer = 0.3;
    addNereidLog(g, getNereidLine('levelUp', g));
    // Check if can add new weapon — base weapons only; evolved weapons are earned by fusing
    const ownedWeaponIds = g.player.weapons.map(w => w.id);
    const availableWeapons = Object.keys(WEAPON_DEFS).filter(id => !ownedWeaponIds.includes(id) && !WEAPON_DEFS[id].evolved);

    let pool = [...UPGRADE_POOL];
    // Add "new weapon" option if available
    if (availableWeapons.length > 0 && g.player.weapons.length < 6) {
        const wId = availableWeapons[Math.floor(Math.random() * availableWeapons.length)];
        pool.push({ id: 'new_' + wId, name: 'NEW: ' + WEAPON_DEFS[wId].name, fn: g2 => { g2.player.weapons.push({ id: wId, level: 1, cooldown: 0 }); }, weight: 12 });
    }
    // Add weapon level-up options
    for (const w of g.player.weapons) {
        if (w.level < 8) {
            pool.push({ id: 'lvl_' + w.id, name: WEAPON_DEFS[w.id].name + ' LV' + (w.level + 1), fn: g2 => { const ww = g2.player.weapons.find(ww2 => ww2.id === w.id); if (ww) ww.level++; }, weight: 9 });
        }
    }
    // AUTO-PING unlock — only offered once, once the pilot has earned a few sonar levels
    const sonarW = g.player.weapons.find(w => w.id === 'sonar');
    if (sonarW && sonarW.level >= 3 && !g.player._sonarAuto) {
        pool.push({
            id: 'auto_ping',
            name: 'AUTO-PING SYSTEM',
            fn: g2 => { g2.player._sonarAuto = true; addNereidLog(g2, 'AUTO-PING engaged. The sub will sweep on its own now, Pilot.'); },
            weight: 11,
        });
    }
    // Auto-grant at sonar LV5+ even if the card isn't picked
    if (sonarW && sonarW.level >= 5 && !g.player._sonarAuto) {
        g.player._sonarAuto = true;
    }
    // FUSE cards — if any fusion is ready, one choice slot is guaranteed to offer it
    const choices = [];
    const fusions = fusionOptions(g);
    if (fusions.length) {
        const evo = fusions[Math.floor(Math.random() * fusions.length)];
        choices.push({
            id: 'fuse_' + evo.result,
            name: 'FUSE: ' + evo.name,
            desc: WEAPON_DEFS[evo.result].desc,
            fn: g2 => performFusion(g2, evo),
        });
    }
    // Fill remaining slots with weighted picks
    for (let i = choices.length; i < 3 && pool.length > 0; i++) {
        const totalW = pool.reduce((s, p) => s + p.weight, 0);
        let r = Math.random() * totalW;
        for (let j = 0; j < pool.length; j++) {
            r -= pool[j].weight;
            if (r <= 0) { choices.push(pool[j]); pool.splice(j, 1); break; }
        }
    }
    // COIL-TOUCHED GIFT — the deep sometimes replaces the last offer with its own.
    // Never the FUSE slot. Chance grows slightly with depth.
    if (g.depth > 1000 && choices.length >= 2 && Math.random() < Math.min(0.35, 0.18 + g.depth / 20000)) {
        choices[choices.length - 1] = COIL_GIFTS[Math.floor(Math.random() * COIL_GIFTS.length)];
    }
    g.levelUpChoices = choices;
    phase = 'levelup';
}

// =====================================================================
// FEATURE 2: Corruption text corruption helper
// =====================================================================
function corruptText(text, corruptionLevel) {
    if (corruptionLevel < 75) return text;
    const glitchChars = '█░▓▒▀▄';
    const intensity = (corruptionLevel - 75) / 25; // 0-1
    return text.split('').map(c => {
        if (c === ' ') return c;
        if (Math.random() < intensity * 0.4) return glitchChars[Math.floor(Math.random() * glitchChars.length)];
        return c;
    }).join('');
}

// =====================================================================
// FEATURE 5: Cascade SFX (ascending tone per chain link)
// =====================================================================
let _lastCascadeSfx = 0;
function sfxCascadeTone(chainCount) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    if (now - _lastCascadeSfx < 0.06) return;
    _lastCascadeSfx = now;
    const baseFreq = 400 + chainCount * 120;
    playTone(Math.min(2000, baseFreq), 0.08, 'sine', 0.08);
}

function sfxScanCreature() {
    if (!audioCtx) return;
    [800, 1000, 1200, 1000].forEach((f, i) => setTimeout(() => playTone(f, 0.06, 'square', 0.04), i * 40));
}

// =====================================================================
// FEATURE 8: Stake system helpers
// =====================================================================
// COMPOSABLE STAKES (Hades' Pact of Punishment): each is an independent toggle,
// unlocked in order, freely combined. Every active stake pays +15% gold & score.
// Title keys [6]-[0] / tap the chips.
const STAKE_DEFS = [
    { id: 'pressure', key: '6', name: 'Pressure', color: '#5AAFDA', desc: 'Enemies +20% HP' },
    { id: 'crushing', key: '7', name: 'Crushing', color: '#8A4ABA', desc: 'Corruption +50% faster' },
    { id: 'abyssal',  key: '8', name: 'Abyssal',  color: '#DA4060', desc: 'Aberrant chance +10%' },
    { id: 'hadal',    key: '9', name: 'Hadal',    color: '#FF2020', desc: 'Bosses every 5 waves' },
    { id: 'mariana',  key: '0', name: 'Mariana',  color: '#FF6040', desc: 'Enemies +50% speed, no Death Defiance' },
];

// =====================================================================
// FEATURE 10: Touch controls
// =====================================================================
const isTouchDevice = 'ontouchstart' in window;
let touchJoystick = { active: false, startX: 0, startY: 0, x: 0, y: 0, id: -1 };
let touchDash = { active: false };

if (isTouchDevice) {
    const canvas2 = document.getElementById('c');
    canvas2.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas2.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas2.addEventListener('touchend', onTouchEnd, { passive: false });
}

// =====================================================================
// UI TAP ZONES — draw functions register hit-rects every frame; a tap or
// mouse click on one dispatches its key. One geometry source: the draw.
// =====================================================================
let tapZones = [];
let MENU_S = 1;   // scale menus render at on narrow screens; taps map back through it
function addTapZone(x, y, zw, zh, key) { tapZones.push({ x, y, w: zw, h: zh, key }); }
function hitTapZone(px, py) {
    px /= MENU_S; py /= MENU_S;
    for (const z of tapZones) if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return z;
    return null;
}
// Touch UI shows on real touch devices; window._forceTouch = true previews it on desktop.
function touchUI() { return isTouchDevice || !!window._forceTouch; }

// In-game touch buttons — geometry shared by drawTouchControls and hit-testing.
function getTouchButtons(w, h) {
    if (!game) return [];
    const bs = [
        { id: 'ping',   x: w - 60,  y: h - 140, r: 30, label: 'PING', color: '#80FFE0' },
        { id: 'dash',   x: w - 60,  y: h - 215, r: 26, label: 'DASH', color: '#FFD040' },
        { id: 'silent', x: w - 60,  y: h - 285, r: 26, label: game.silent ? 'LOUD' : 'HUSH', color: '#80E0FF', active: game.silent },
        { id: 'light',  x: w - 122, y: h - 250, r: 22, label: 'LAMP', color: '#FFD040', active: game.lightOn !== false },
    ];
    if (game.nearestWreck) bs.push({ id: 'salvage', x: w - 122, y: h - 180, r: 26, label: 'GRAB', color: '#80FFA0', hold: true });
    if (!game.ascending && game.depth > 200) bs.push({ id: 'ascend', x: 60, y: h - 215, r: 24, label: (game._ascendArm || 0) > 0 ? 'SURE?' : 'RISE', color: '#80FFA0', active: (game._ascendArm || 0) > 0 });
    return bs;
}
let touchSalvageId = -1;   // touch identifier currently holding GRAB
function pressTouchButton(b) {
    const g = game;
    if (!g || phase !== 'playing') return;
    if (b.id === 'dash') {
        const p = g.player;
        if (p.dashCooldown <= 0 && p.dashTimer <= 0) {
            let ddx = 0, ddy = 0;
            if (touchJoystick.active) { ddx = touchJoystick.x - touchJoystick.startX; ddy = touchJoystick.y - touchJoystick.startY; }
            if (!ddx && !ddy) {
                // Stationary dash goes where the bow points (was: hardcoded up)
                const f = p._facing != null ? p._facing : -Math.PI / 2;
                ddx = Math.cos(f); ddy = Math.sin(f);
            }
            const len = Math.hypot(ddx, ddy) || 1;
            p.dashVx = ddx / len * 600; p.dashVy = ddy / len * 600;
            p.dashTimer = 0.15; p.dashCooldown = 0.8;
            sfxDash();
        }
    } else if (b.id === 'ping') {
        firePing(g);
    } else if (b.id === 'silent') {
        simulateKey('q');
    } else if (b.id === 'light') {
        simulateKey('l');
    } else if (b.id === 'ascend') {
        // One-way commit — arm first, confirm within 2.5s
        if ((g._ascendArm || 0) > 0) { g._ascendArm = 0; simulateKey('z'); }
        else { g._ascendArm = 2.5; g.streak = 'ASCEND — TAP AGAIN TO COMMIT'; g.streakTimer = 2.5; }
    } else if (b.id === 'salvage') {
        keys['e'] = true;
    }
}

function onTouchStart(e) {
    e.preventDefault();
    initAudio();
    const w = canvas.width, h = canvas.height;
    for (const t of e.changedTouches) {
        const tx = t.clientX, ty = t.clientY;
        // Menus / overlays — tap zones registered by the current screen's draw
        if (phase !== 'playing') {
            const z = hitTapZone(tx, ty);
            if (z) { if (z.key !== 'Escape') playSample('ui', 0.22); simulateKey(z.key); }
            continue;
        }
        // In-game buttons
        let hit = null;
        for (const b of getTouchButtons(w, h)) {
            const dx = tx - b.x, dy = ty - b.y;
            if (dx * dx + dy * dy < (b.r + 14) * (b.r + 14)) { hit = b; break; }
        }
        if (hit) {
            if (hit.id === 'salvage') touchSalvageId = t.identifier;
            if (hit.id === 'dash') touchDash.active = true;
            pressTouchButton(hit);
            continue;
        }
        // Left half = virtual joystick; right-half tap = manual ping
        if (tx < w / 2) {
            touchJoystick = { active: true, startX: tx, startY: ty, x: tx, y: ty, id: t.identifier };
        } else if (game && game.player._sonarManual && !game.player._sonarAuto) {
            firePing(game);
        }
    }
}
function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
        if (t.identifier === touchJoystick.id) {
            touchJoystick.x = t.clientX;
            touchJoystick.y = t.clientY;
        }
    }
}
function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
        if (t.identifier === touchJoystick.id) touchJoystick.active = false;
        if (t.identifier === touchSalvageId) { touchSalvageId = -1; keys['e'] = false; }
        touchDash.active = false;
    }
}
function simulateKey(key) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

// --- Main update ---
// =====================================================================
// ABERRANT TWISTS — per-creature behavioural overrides for aberrant variants.
// Looked up from ENEMY_TYPES[typeId].aberrantTwist. Runs after standard AI.
// =====================================================================
function applyAberrantTwist(g, e, p, dt, dToPlayer, angleToPlayer) {
    const def = ENEMY_TYPES[e.typeId];
    const twist = def && def.aberrantTwist;
    if (!twist) return;

    if (twist === 'jelly_pulse') {
        // Pulses a damaging sonar ring every ~3.5s. Mirrors Void Eye pattern.
        e._abT = (e._abT == null ? 3.0 : e._abT) - dt;
        if (e._abT <= 0) {
            e._abT = 3.5;
            g.effects.push({ type: 'sonar_ring', x: e.x, y: e.y, radius: 0, maxRadius: 140, dmg: 0, speed: 260, hit: new Set() });
            if (dToPlayer < 140 && p.iFrames <= 0) {
                const dmg = Math.max(1, 6 - p.armor);
                p.hp -= dmg; p.iFrames = 0.4; g.shake = 2;
                g._lastAttackerTypeId = e.typeId;
            }
            playTone(280, 0.18, 'sine', 0.05);
        }
    } else if (twist === 'piranha_call') {
        // Acts as a Whisperer — speed-boosts nearby kin via existing aura code.
        e.isWhisperer = true;
    } else if (twist === 'gulper_double_lunge') {
        // Chains a second lunge with shortened wind-up.
        if (e._lungeState === 'lunge' && (e._lungeT || 0) <= 0.05 && !e._abChained) {
            e._abChained = true;
            e._lungeState = 'wind';
            e._lungeT = 0.35;
            e._lungeAng = angleToPlayer;
        }
        if (e._lungeState === 'stalk') e._abChained = false;
    } else if (twist === 'vampyro_long_phase') {
        // Phases longer (2.5s), exposed briefer (1.0s) — much harder to land hits.
        if (e._abLastPhased !== e._phased) {
            e._phaseT = e._phased ? 2.0 : 1.0;  // tuned down from 2.5/1.0 — still meaner than base, less punishing
            e._abLastPhased = e._phased;
        }
    } else if (twist === 'shooter_burst') {
        // Fires a second projectile burst ~0.22s after each shot.
        const cur = e._shootCd || 0;
        const prev = e._abLastShootCd == null ? cur : e._abLastShootCd;
        if (cur > prev + 0.5) { e._abBurstQueued = true; e._abBurstT = 0.22; }
        e._abLastShootCd = cur;
        if (e._abBurstQueued) {
            e._abBurstT -= dt;
            if (e._abBurstT <= 0) {
                e._abBurstQueued = false;
                const sp = def.projSpeed || 240, pdmg = def.projDmg || 8, col = def.projColor || '#FF6040';
                const spread = def.projSpread || 1;
                for (let pi = 0; pi < spread; pi++) {
                    const aOff = spread > 1 ? (pi - (spread - 1) / 2) * 0.18 : 0;
                    const a = angleToPlayer + aOff;
                    g.projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg: pdmg, aoe: 14, life: 2.5, pierce: 0, color: col, enemy: true });
                }
                playTone(140, 0.06, 'square', 0.04);
            }
        }
    }
}

// =====================================================================
// APEX PATROL — below APEX_DEPTH something owns the water. It is not in
// g.enemies, so no weapon can touch it. It hears noise, sees light,
// smells blood. Silent running in the dark is the only answer.
// =====================================================================
const APEX_DEPTH = 2600;
function updateApexPatrol(g, dt) {
    const p = g.player;
    // Drag from a strike — it pulls you DOWN. While descending, depth is a pure
    // function of runTime, so the drag must land in the persistent offset.
    if (g._apexDragT > 0) {
        g._apexDragT -= dt;
        if (g.ascending) g.depth += 33 * dt;
        else g._depthOffset = (g._depthOffset || 0) + 33 * dt;
        g.deepestDepth = Math.max(g.deepestDepth || 0, g.depth);
    }
    if (g.depth < APEX_DEPTH) {
        if (g.apex) g.apex.state = 'leave';
        g.apexThreat = Math.max(0, (g.apexThreat || 0) - dt);
        if (!g.apex) return;
    } else {
        // Threat: your noise, your light, your blood. Silence starves it.
        let rise = 0.05 + (g.noise || 0) * 0.5 + (g.lightOn !== false ? 0.22 : 0) + (g.bloodLevel || 0) * 0.3;
        if (g.silent) rise *= 0.25;
        g.apexThreat = Math.max(0, Math.min(10, (g.apexThreat || 0) + (rise - 0.12) * dt));
        // Foreshadow — you hear it long before you see it
        if (g.apexThreat > 2.2 && !g._apexHeard) {
            g._apexHeard = true;
            sfxCreatureGrowl();
            g.shake = Math.min(8, (g.shake || 0) + 3);
            addNereidLog(g, 'Contact. Class: unresolved. Length: unresolved. Pilot — it resolved us first.');
        }
        if (!g.apex && g.apexThreat > 5) {
            const a = Math.random() * PI2;
            g.apex = { x: p.x + Math.cos(a) * 750, y: p.y + Math.sin(a) * 750, state: 'hunt', heading: 0, trail: [], stateT: 0, weave: Math.random() * PI2 };
            sfxCreatureGrowl();
            addNereidLog(g, 'It is coming. Weapons will not answer this. Go dark. Go quiet. NOW.');
        }
    }
    const a = g.apex;
    if (!a) return;
    const dToP = dist(a, p);
    const angToP = Math.atan2(p.y - a.y, p.x - a.x);
    if (a.state === 'hunt') {
        a.weave += dt * 1.3;
        a.heading = angToP + Math.sin(a.weave) * 0.5;
        const spd = 115;
        a.x += Math.cos(a.heading) * spd * dt;
        a.y += Math.sin(a.heading) * spd * dt;
        if ((g.apexThreat || 0) < 2) a.state = 'leave';
        else if (dToP < 170) { a.state = 'strike'; a.stateT = 0.8; a.heading = angToP; sfxCreatureGrowl(); }
    } else if (a.state === 'strike') {
        a.stateT -= dt;
        a.x += Math.cos(a.heading) * 520 * dt;
        a.y += Math.sin(a.heading) * 520 * dt;
        if (dToP < 46 && p.iFrames <= 0) {
            const dmg = Math.max(12, 38 - p.armor * 2);
            p.hp -= dmg;
            p.iFrames = 0.8;
            g.shake = 14;
            g.slowmo = 0.4;
            g._apexDragT = 1.2;                                  // it pulls you deeper
            if (g.scoreCombo) g.scoreCombo.lastHitTime = g.runTime;
            g._lastAttackerTypeId = 'apex_patrol'; g._lastAttackerIsBoss = true;
            g.floatingTexts.push({ x: p.x, y: p.y - 24, text: '-' + dmg, color: '#FF3030', life: 1, vy: -30 });
            sfxHit();
            addNereidLog(g, 'It tasted the hull, Pilot. It is deciding whether we are food or salvage.');
            a.state = 'circle'; a.stateT = 3.5 + Math.random() * 3;
        } else if (a.stateT <= 0) { a.state = 'circle'; a.stateT = 3 + Math.random() * 3; }
    } else if (a.state === 'circle') {
        a.stateT -= dt;
        const orbitA = angToP + Math.PI + (a.stateT * 0.9);
        const tx = p.x + Math.cos(orbitA) * 430, ty = p.y + Math.sin(orbitA) * 430;
        const ta = Math.atan2(ty - a.y, tx - a.x);
        a.heading = ta;
        a.x += Math.cos(ta) * 150 * dt;
        a.y += Math.sin(ta) * 150 * dt;
        if (a.stateT <= 0) a.state = (g.apexThreat || 0) < 2 ? 'leave' : 'hunt';
    } else if (a.state === 'leave') {
        a.heading = angToP + Math.PI;
        a.x += Math.cos(a.heading) * 160 * dt;
        a.y += Math.sin(a.heading) * 160 * dt;
        if (dToP > 1300) {
            g.apex = null;
            g.apexThreat = 0;
            g._apexHeard = false;
            addNereidLog(g, 'Contact receding. Not because we won. Because it is not hungry.');
        }
    }
    // Body trail for the segmented render
    a.trail.unshift({ x: a.x, y: a.y });
    if (a.trail.length > 22) a.trail.pop();
}

function update(dt) {
    // Frozen phases — game does not advance
    if (isPortraitPhone()) return;   // rotate-to-landscape gate; soft pause
    if (phase === 'paused') return;
    if (phase === 'inventory') return;
    if (phase === 'runshop') return;
    // Event timer ticks even when paused for event
    if (phase === 'event' && game && game.activeEvent) {
        game.activeEvent.timer -= dt;
        if (game.activeEvent.timer <= 0) {
            game.activeEvent.noChoice(game);
            game.activeEvent = null;
            phase = 'playing';
        }
        return;
    }
    if (phase !== 'playing') return;
    const g = game;
    g._chainExplosionsThisFrame = 0; // reset per-frame chain budget
    if (g.moon === 'p3' && !g._p3Announced) {
        g._p3Announced = true;
        addNereidLog(g, 'Pelagos-3. No survey data. No biology on record. Everything below us was BUILT, Pilot — and something is still drawing power.');
    }
    const p = g.player;

    // --- ECOLOGY (Phase 1): mode + stimulus bookkeeping ---
    g._modeCfg = MODE_CONFIG[g.mode] || MODE_CONFIG.swarm;
    g.noise = Math.max(0, (g.noise || 0) - dt * 0.8);
    // ATTENTION — the run-long consequence of being loud. Noise you make is
    // remembered: aberrant rates and spawn pressure climb. Silence pays it down.
    g.attention = Math.max(0, Math.min(100, (g.attention || 0)
        + (g.noise > 0.6 ? (g.noise - 0.6) * dt * 9 : 0)
        - dt * (g.silent ? 1.1 : 0.35)));
    updateVolumes(g, dt, p);
    updateDeployables(g, dt, p);
    if (g._leakT > 0) { g._leakT -= dt; p.hp -= 2.2 * dt; if (Math.random() < dt * 3) g.floatingTexts.push({ x: p.x + (Math.random() - 0.5) * 30, y: p.y - 14, text: '≈', color: '#5AB0DA', life: 0.8, vy: -34 }); }
    // VESTIBULAR FAULT — at 85+ MIND, the inner ear lies: controls invert for
    // 2s after a 0.8s warning. Corruption is now a thing you FEEL in the hands.
    const _corrP = p.corruption || 0;
    if (_corrP >= 85) {
        g._vestClock = (g._vestClock || 0) + dt;
        if (g._vestClock > 22 && !g._vestWarn) { g._vestWarn = true; setModeMsg(g, '⚠ VESTIBULAR FAULT', 0.8); }
        if (g._vestClock > 22.8) { g._vestT = 2; g._vestClock = 0; g._vestWarn = false; }
    } else { g._vestClock = 0; g._vestWarn = false; }
    if (g._vestT > 0) g._vestT -= dt;
    // Silence staunches the bleed — counters the hemoclot death spiral
    g.bloodLevel = Math.max(0, (g.bloodLevel || 0) - dt * (g.silent ? 0.75 : 0.3));
    if (g.corpses && g.corpses.length) {
        for (let ci = g.corpses.length - 1; ci >= 0; ci--) { const c = g.corpses[ci]; c.t -= dt; c._feeders = 0; if (c.t <= 0) g.corpses.splice(ci, 1); }
    }
    // INK CLOUDS — blind both sides: your lamps AND their senses
    g._inInk = false;
    if (g.inkClouds && g.inkClouds.length) {
        for (let ci = g.inkClouds.length - 1; ci >= 0; ci--) {
            const ic = g.inkClouds[ci];
            ic.t -= dt;
            ic.r += dt * 4;   // slow spread
            if (ic.t <= 0) { g.inkClouds.splice(ci, 1); continue; }
            if (Math.hypot(g.player.x - ic.x, g.player.y - ic.y) < ic.r) g._inInk = true;
        }
    }

    // Slowmo (Hades: time dilates on big kills)
    let timeScale = 1;
    if (g.slowmo > 0) { timeScale = 0.2; g.slowmo -= dt; if (g.slowmo <= 0) g.slowmo = 0; }
    const realDt = dt;
    dt *= timeScale;

    g.runTime += dt;
    g.shake = Math.min(g.shake, 5) * 0.85; // hard cap 5px, fast decay
    if (g.flashTimer > 0) g.flashTimer -= realDt; // flash uses real time
    if (g.sonarReveal > 0) g.sonarReveal = Math.max(0, g.sonarReveal - dt * (p._passiveSonar ? 0.25 : 0.5));

    // Horror: ambient creature growls (more frequent at depth)
    g.creatureGrowlTimer -= dt;
    const growlInterval = Math.max(3, 12 - g.depth / 500);
    if (g.creatureGrowlTimer <= 0) {
        g.creatureGrowlTimer = growlInterval + Math.random() * growlInterval;
        sfxCreatureGrowl();
        // Hull creak at depth (pressure)
        if (g.depth > 500) playTone(25 + Math.random() * 20, 1.5, 'sawtooth', 0.03);
    }
    // Horror: heartbeat at low HP
    const _lowHull = p.hp / p.maxHp <= 0.3;
    if (_lowHull && !g._lowHullWarned) { g._lowHullWarned = true; sampleOr('alert', 0.4, 1); }
    if (!_lowHull) g._lowHullWarned = false;
    if (_lowHull) startHeartbeat(); else stopHeartbeat();

    // --- STAGED ONBOARDING (Portal): teach one mechanic in the moment it matters ---
    if (g.runTime > 1.5) maybeHint(g, 'move', 'WASD — thrusters  ·  SPACE — dash. The sub drifts. Plan ahead.');
    if (g.runTime > 7 && p._sonarManual && !p._sonarAuto) maybeHint(g, 'ping', '[F] or CLICK — sonar ping. It reveals the dark, and wounds it.');
    if (g.depth > 150) maybeHint(g, 'dark', 'The light dies below. [L] floodlights — seeing costs being seen.');
    if (g.depth > 320) maybeHint(g, 'ascend', '[Z] ASCEND — one-way commitment. Reach the surface to keep everything.');
    if ((p.corruption || 0) > 12) maybeHint(g, 'mind', 'Depth erodes MIND. Some things down here will offer to buy what is left.');
    if (g.nearestWreck) maybeHint(g, 'wreck', 'Hold [E] — strip the wreck. You are exposed while you work.');
    if (g._hint) { g._hint.t -= dt; if (g._hint.t <= 0) g._hint = null; }
    // Ambient drone
    updateDrone();

    // --- Player movement (underwater physics: thrust + drag + inertia) ---
    if (!p._vx) p._vx = 0;
    if (!p._vy) p._vy = 0;
    if (!p._thrusterParticles) p._thrusterParticles = [];

    let mx = 0, my = 0;
    const _inv = g._vestT > 0 ? -1 : 1;   // vestibular fault: the world turns over
    if (keys['w'] || keys['arrowup']) my -= _inv;
    if (keys['s'] || keys['arrowdown']) my += _inv;
    if (keys['a'] || keys['arrowleft']) mx -= _inv;
    if (keys['d'] || keys['arrowright']) mx += _inv;
    // Feature 10: Touch joystick
    if (touchJoystick.active) {
        const jdx = touchJoystick.x - touchJoystick.startX;
        const jdy = touchJoystick.y - touchJoystick.startY;
        const jlen = Math.sqrt(jdx*jdx+jdy*jdy);
        if (jlen > 10) { mx += jdx / Math.max(jlen, 40); my += jdy / Math.max(jlen, 40); }
    }
    if (mx !== 0 && my !== 0) { mx *= 0.707; my *= 0.707; }

    // SILENT RUNNING — engines at dead slow. Quiet costs speed; that's the trade.
    // SILENT PROPS module softens the trade.
    const silentMult = g.silent ? (p._silentProps ? 0.75 : 0.55) : 1;
    // CARGO WEIGHT (Dredge rule): past 4 held items the sub wallows and hums.
    // [J] jettisons half — dropping your greed is a real decision.
    const cargoN = (g.inventory || []).length;
    const cargoMult = cargoN > 4 ? Math.max(0.82, 1 - (cargoN - 4) * 0.03) : 1;
    if (cargoN > 4 && !g.silent) g.noise = Math.max(g.noise || 0, 0.15);
    const thrustForce = p.speed * 4 * silentMult * cargoMult; // acceleration
    const dragCoeff = 0.06; // 0 = no drag, 1 = instant stop. 0.06 = soupy underwater
    const maxSpeed = p.speed * silentMult * cargoMult;

    // --- DASH (Hades) — Space = burst of speed + i-frames ---
    if (p.dashTimer > 0) {
        p._vx = p.dashVx;
        p._vy = p.dashVy;
        p.dashTimer -= dt;
        p.iFrames = 0.1;
        p.dashTrail.push({ x: p.x, y: p.y, life: 0.3 });
    } else {
        // Apply thrust
        p._vx += mx * thrustForce * dt;
        p._vy += my * thrustForce * dt;
        // Water drag (exponential decay — heavy, soupy, underwater)
        p._vx *= Math.pow(dragCoeff, dt); // heavy drag
        p._vy *= Math.pow(dragCoeff, dt);
    }

    // Cap speed
    const spd = Math.sqrt(p._vx * p._vx + p._vy * p._vy);
    if (spd > maxSpeed) { p._vx *= maxSpeed / spd; p._vy *= maxSpeed / spd; }

    // Apply velocity
    p.x += p._vx * dt;
    p.y += p._vy * dt;

    // --- WORLD BOUNDS — JAGGED trench. Sub clamps inside the rocky inner perimeter ---
    if (g.worldBounds && g.worldBounds.radius) {
        const wb = g.worldBounds;
        const subR = 14;
        const dx = p.x - wb.cx, dy = p.y - wb.cy;
        const d2 = dx * dx + dy * dy;
        // Get jagged radius at player's angle
        const ang = Math.atan2(dy, dx);
        const localR = trenchRadiusAt(g, ang);
        const limit = localR - subR;
        if (d2 > limit * limit) {
            const d = Math.sqrt(d2) || 1;
            p.x = wb.cx + (dx / d) * limit;
            p.y = wb.cy + (dy / d) * limit;
            const nx = dx / d, ny = dy / d;
            const dot = p._vx * nx + p._vy * ny;
            if (dot > 0) { p._vx -= dot * nx * 1.3; p._vy -= dot * ny * 1.3; }
        }
    }

    // --- OBSTACLE COLLISION — only block when the obstacle is at the sub's depth (within ±10m) ---
    for (const ob of (g.obstacles || [])) {
        if (ob.kind === 'seep' || ob.kind === 'cable') continue;   // soft/flat features — not walls (seep hazard handled below)
        if (Math.abs((ob.obDepth || 0) - g.depth) > 10) continue;
        const dx = p.x - ob.x, dy = p.y - ob.y;
        const minD = (ob.r || 30) + 14;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD * minD && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (minD - d);
            const nx = dx / d, ny = dy / d;
            p.x += nx * push; p.y += ny * push;
            const dot = p._vx * nx + p._vy * ny;
            if (dot < 0) {
                // A hull is not a bumper — hard impacts cost plating.
                const hardKinds = { rock: 1, spire: 1, crystal: 1, monolith: 1, debris: 1, chitin: 1 };
                if (-dot > 120 && hardKinds[ob.kind] && p.iFrames <= 0) {
                    const dmg = Math.min(12, Math.round((-dot - 120) / 70) + 1);
                    p.hp -= dmg;
                    p.iFrames = Math.max(p.iFrames, 0.4);
                    g.shake = Math.max(g.shake || 0, 4);
                    g.floatingTexts.push({ x: p.x, y: p.y - 20, text: `-${dmg} IMPACT`, color: '#FF9060', life: 1.2, vy: -24 });
                    playSample('clank', Math.min(0.5, 0.2 + dmg * 0.04), 0.85 + Math.random() * 0.3);
                    noiseBurst(0.35, 0.09, 420);
                    g.noise = Math.min(2.5, (g.noise || 0) + 0.25);
                }
                p._vx -= dot * nx; p._vy -= dot * ny;
            }
        }
    }
    // Wrecks — same depth-band collision
    for (const wr of (g.wrecks || [])) {
        if (Math.abs((wr.obDepth || 0) - g.depth) > 12) continue;
        const dx = p.x - wr.x, dy = p.y - wr.y;
        const minD = (wr.r || 40) + 14;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD * minD && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (minD - d);
            const nx = dx / d, ny = dy / d;
            p.x += nx * push; p.y += ny * push;
            const dot = p._vx * nx + p._vy * ny;
            if (dot < 0) { p._vx -= dot * nx; p._vy -= dot * ny; }
        }
    }

    // --- ENVIRONMENTAL HAZARDS — vents scald the hull, seeps shove the sub upward ---
    for (const ob of (g.obstacles || [])) {
        if (ob.kind !== 'vent' && ob.kind !== 'seep') continue;
        if (Math.abs((ob.obDepth || 0) - g.depth) > 12) continue;
        const dx = p.x - ob.x, dy = p.y - ob.y;
        const reach = ob.r * 1.6;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (ob.kind === 'vent') {
            p.hp -= 7 * dt;
            g.shake = Math.max(g.shake || 0, 1.5);
            // Superheated water pushes out of the plume
            const d = Math.hypot(dx, dy) || 1;
            p._vx += (dx / d) * 90 * dt; p._vy += (dy / d) * 90 * dt - 50 * dt;
            if (!ob._warned) {
                ob._warned = true;
                g.floatingTexts.push({ x: ob.x, y: ob.y - ob.r - 10, text: 'SCALDING', color: '#FF6040', life: 1.3, vy: -22 });
            }
        } else {
            // Methane bubble column — buoyancy slams the hull upward, no damage
            p._vy -= 150 * dt;
            g.shake = Math.max(g.shake || 0, 0.8);
        }
    }

    // Spawn thruster jet particles when thrusting
    if (mx !== 0 || my !== 0) {
        const jetAngle = Math.atan2(-my, -mx); // opposite of thrust direction
        for (let ji = 0; ji < 2; ji++) {
            const spread = (Math.random() - 0.5) * 0.8;
            const jetSpd = 40 + Math.random() * 60;
            p._thrusterParticles.push({
                x: p.x + Math.cos(jetAngle) * 14,
                y: p.y + Math.sin(jetAngle) * 14,
                vx: Math.cos(jetAngle + spread) * jetSpd,
                vy: Math.sin(jetAngle + spread) * jetSpd,
                life: 0.3 + Math.random() * 0.3,
                size: 1.5 + Math.random() * 2,
            });
        }
    }
    // Update thruster particles
    for (let i = p._thrusterParticles.length - 1; i >= 0; i--) {
        const tp = p._thrusterParticles[i];
        tp.x += tp.vx * dt; tp.y += tp.vy * dt;
        tp.vx *= 0.95; tp.vy *= 0.95; // particles slow in water
        tp.life -= dt;
        if (tp.life <= 0) p._thrusterParticles.splice(i, 1);
    }

    // Spawn sediment cloud when moving fast (disturbed water)
    if (spd > maxSpeed * 0.3 && Math.random() < spd / maxSpeed * 0.15) {
        g.effects.push({
            type: 'particle', x: p.x + (Math.random() - 0.5) * 20, y: p.y + (Math.random() - 0.5) * 20,
            vx: (Math.random() - 0.5) * 15, vy: (Math.random() - 0.5) * 15,
            life: 0.5 + Math.random() * 0.5, color: '#3A4A40', size: 2 + Math.random() * 3,
        });
    }
    if (p.dashCooldown > 0) p.dashCooldown -= dt;
    // Clean old trail
    for (let i = p.dashTrail.length - 1; i >= 0; i--) {
        p.dashTrail[i].life -= dt;
        if (p.dashTrail[i].life <= 0) p.dashTrail.splice(i, 1);
    }

    // Regen
    if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    // iFrames
    if (p.iFrames > 0) p.iFrames -= dt;

    // Chain kill timer
    if (p.chainTimer > 0) { p.chainTimer -= dt; if (p.chainTimer <= 0) p.chainCount = 0; }

    // Balatro combo timers
    if (g.scoreCombo) {
        const sc = g.scoreCombo;
        if (sc.chainTimer > 0) { sc.chainTimer -= dt; if (sc.chainTimer <= 0) sc.chainCount = 0; }
        if (sc.uniqueTimer > 0) { sc.uniqueTimer -= dt; if (sc.uniqueTimer <= 0) sc.uniqueTypes.clear(); }
        if (sc.sonarBurstTimer > 0) { sc.sonarBurstTimer -= dt; if (sc.sonarBurstTimer <= 0) sc.sonarBurstCount = 0; }
        if (g.scoreFlash > 0) g.scoreFlash = Math.max(0, g.scoreFlash - dt * 1.8);
    }

    // Camera smooth follow
    g.cam.x += (p.x - g.cam.x) * 6 * dt;
    g.cam.y += (p.y - g.cam.y) * 6 * dt;

    // --- Waves ---
    g.waveTimer += dt;
    if (g.waveTimer >= 45) {  // longer waves for breathing room (was 30s)
        g.waveTimer = 0;
        g.wave++;
        g.spawnRate = Math.max(0.4, g.spawnRate * 0.93);   // gentler ramp, floor at 0.4s (was 0.15)
        g.streakTimer = 2;
        g.streak = 'WAVE ' + g.wave;
        addNereidLog(g, getNereidLine('wave', g));
        // Lore drops on milestone waves
        if (g.wave === 5 || g.wave === 10 || g.wave === 15 || g.wave === 20) dropLore(g);
        // Feature 4: Boss spawns at wave milestones
        const spawnBossAt = (typeId) => {
            if (g._bossesSpawned[typeId]) return;
            g._bossesSpawned[typeId] = true;
            // Something enormous just noticed you — the music gets out of its way
            duckMusic(3);
            playSample('stinger', 0.8);
            const boss = ENEMY_TYPES[typeId];
            const a = Math.random() * PI2;
            const e = {
                x: p.x + Math.cos(a) * 600, y: p.y + Math.sin(a) * 600,
                hp: boss.hp, maxHp: boss.hp, speed: boss.speed, size: boss.size,
                color: boss.color, xp: boss.xp, damage: boss.damage, gold: boss.gold,
                typeId, flash: 0, isBoss: true,
                ai: boss.ai || 'patrol', state: 'patrol', patrolAngle: Math.random() * PI2,
                chargeTarget: null, stateTimer: 0,
                // Kraken tentacle spawn
                tentacleTimer: 3,
            };
            // Wire telegraphed attack state
            e.phase = 'patrol';
            e.phaseTimer = 4 + Math.random() * 3;
            e.attackPattern = LEVIATHAN_LORE[typeId] ? LEVIATHAN_LORE[typeId].attack : null;
            g.enemies.push(e);
            g.shake = 7; g.flashTimer = 0.4;
            // Named leviathan announcement
            const lore = LEVIATHAN_LORE[typeId];
            if (lore) {
                const claimed = (meta.leviathanDeaths && meta.leviathanDeaths[typeId]) || 0;
                const slain = (meta.leviathanKills && meta.leviathanKills[typeId]) || 0;
                const repLine = claimed > 0 ? `${lore.name} — ${claimed} pilots claimed, ${slain} returned heads.` : `${lore.name} — first contact. ${lore.reputation}`;
                addNereidLog(g, repLine);
                setTimeout(() => { if (game) addNereidLog(game, lore.telegraph); }, 2400);
            } else {
                addNereidLog(g, `NEREID ALERT: ${boss.name} contact.`);
            }
        };
        // Bosses now tied to wave AND depth, so they appear in the right zone.
        // Depth gates push the heavy hitters past Titanic (~3800m).
        if (g.wave >= 10 && g.depth >= 1500) spawnBossAt('kraken');
        if (g.wave >= 15 && g.depth >= 2500) spawnBossAt('dreadnought');
        if (g.wave >= 20 && g.depth >= 3500) spawnBossAt('leviathan');
        if (g.wave >= 25 && g.depth >= 4500) spawnBossAt('abyssal_maw');
        // Stake: Hadal — bosses every 5 waves
        if (g.stakes && g.stakes.has('hadal') && g.wave > 5 && g.wave % 5 === 0) {
            const bossTypes = ['kraken','dreadnought','leviathan'];
            spawnBossAt(bossTypes[Math.floor(Math.random() * bossTypes.length)]);
        }
        // Reaching wave 15 with every unlocked stake active unlocks the next one
        if (g.wave === 15 && (meta.stakesUnlocked || 0) < STAKE_DEFS.length && g.stakes && g.stakes.size >= (meta.stakesUnlocked || 0)) {
            meta.stakesUnlocked = (meta.stakesUnlocked || 0) + 1;
            saveMeta();
            const next = STAKE_DEFS[meta.stakesUnlocked - 1];
            addNereidLog(g, `NEW STAKE UNLOCKED: ${next ? next.name.toUpperCase() : ''}`);
        }
    }

    // --- Spawn enemies — gentler ramp on Easy stake; first 90s is breathing room ---
    g.spawnTimer += dt;
    // ASCENDING — spawn rate halved, count clipped (climb is hard but doable)
    const ascendMult = g.ascending ? 1.8 : 1;
    if (g.spawnTimer >= g.spawnRate * ascendMult * (1 - (g.attention || 0) * 0.002)) {
        g.spawnTimer = 0;
        const earlyMult = g.runTime < 90 ? 0.5 : 1;
        const ascendCountMult = g.ascending ? 0.5 : 1;
        const count = Math.max(1, Math.floor((1 + Math.floor(g.wave / 4)) * earlyMult * ascendCountMult));
        for (let i = 0; i < Math.min(4, count); i++) spawnEnemy(g);
    }

    // --- Dynamic world boundaries — the trench narrows as you descend ---
    updateWorldBounds(g);

    // --- Spawn obstacles/wrecks based on depth zone ---
    spawnWorldObjects(g, dt);

    // --- Wreck interaction (find nearest, track salvage hold) ---
    updateWreckInteraction(g, dt);

    // --- Objectives ticking ---
    updateObjectives(g, dt);

    // Announce objectives once at run start (small delay so intro music plays first)
    if (!g.objectivesAnnounced && g.runTime > 1.5 && g.objectives.length) {
        g.objectivesAnnounced = true;
        addNereidLog(g, 'Pilot — dive brief uploaded. Three objectives. Bring back signal.');
    }

    // --- Fire weapons ---
    fireWeapons(g, dt);

    // --- Update enemies ---
    const _wb = g.worldBounds;
    // Perf: cache whisperers once per frame so the inner aura check is O(whisperers) not O(enemies).
    const _whisperers = [];
    for (const _w of g.enemies) {
        if (_w.isWhisperer && _w.hp > 0) _whisperers.push(_w);
    }
    // SPATIAL GRID — per-frame buckets (150px cells) for ecology neighbour queries
    const _grid = new Map();
    const _CELL = 150;
    for (const _e of g.enemies) {
        if (_e.hp <= 0 || _e.ghost) continue;
        const k = ((_e.x / _CELL) | 0) + ',' + ((_e.y / _CELL) | 0);
        let arr = _grid.get(k);
        if (!arr) { arr = []; _grid.set(k, arr); }
        arr.push(_e);
    }
    g._grid = _grid;
    function _nearby(x, y, r) {
        const out = [];
        const c0x = ((x - r) / _CELL) | 0, c1x = ((x + r) / _CELL) | 0;
        const c0y = ((y - r) / _CELL) | 0, c1y = ((y + r) / _CELL) | 0;
        const r2 = r * r;
        for (let cx2 = c0x; cx2 <= c1x; cx2++) for (let cy2 = c0y; cy2 <= c1y; cy2++) {
            const arr = _grid.get(cx2 + ',' + cy2);
            if (!arr) continue;
            for (const e2 of arr) {
                const dx = e2.x - x, dy = e2.y - y;
                if (dx * dx + dy * dy <= r2) out.push(e2);
            }
        }
        return out;
    }
    for (let i = g.enemies.length - 1; i >= 0; i--) {
        const e = g.enemies[i];
        e.flash = Math.max(0, e.flash - dt);
        // Clamp enemy inside the JAGGED trench boundary
        if (_wb && _wb.radius) {
            const er = e.size || 12;
            const edx = e.x - _wb.cx, edy = e.y - _wb.cy;
            const ed2 = edx * edx + edy * edy;
            const eAng = Math.atan2(edy, edx);
            const elocalR = trenchRadiusAt(g, eAng);
            const elim = elocalR - er;
            if (ed2 > elim * elim) {
                const ed = Math.sqrt(ed2) || 1;
                e.x = _wb.cx + (edx / ed) * elim;
                e.y = _wb.cy + (edy / ed) * elim;
            }
        }
        const dToPlayer = dist(p, e);
        const angleToPlayer = Math.atan2(p.y - e.y, p.x - e.x);
        // HEADLIGHTS ATTRACT — enemies inside the sub's forward light cone speed up by 25%.
        // The lamp is bait. Light = visibility = predators home in.
        let lightSpeedMult = 1;
        if (g.lightOn !== false && p._facing != null && dToPlayer < 220) {
            const angleFromSub = Math.atan2(e.y - p.y, e.x - p.x);
            let diff = angleFromSub - p._facing;
            while (diff > Math.PI) diff -= PI2;
            while (diff < -Math.PI) diff += PI2;
            if (Math.abs(diff) < 0.55) lightSpeedMult = 1.25;
        }
        // Whisperer aura — any enemy within 200px of a Whisperer gets +30% speed (now O(whisperers))
        let whisperBoost = 1;
        for (const w2 of _whisperers) {
            if (w2 === e) continue;
            const wd = (w2.x - e.x) ** 2 + (w2.y - e.y) ** 2;
            if (wd < 40000) { whisperBoost = 1.3; break; }
        }
        if (e._netT > 0) e._netT -= dt;
        e.speed = (ENEMY_TYPES[e.typeId]?.speed || e.speed) * lightSpeedMult * whisperBoost * (g._enemySpdMult || 1) * (g._feeding ? 1.3 : 1) * (e._netT > 0 ? 0.15 : 1);

        // --- ECOLOGY (Phase 1): senses + awareness ---
        // SWARM forces full awareness → identical to today. DESCENT lets creatures ignore you.
        if (!g._modeCfg || !g._modeCfg.ecology) {
            e.awareness = 1;
        } else {
            const detect = e.detect || 300;
            let stim = 0;
            // proximity — felt up close even quiet; SILENT RUNNING halves the engine signature
            if (dToPlayer < detect) stim += (1 - dToPlayer / detect) * (g.silent ? 0.25 : 0.5);
            if (g.noise > 0) {                                                          // noise carries far
                const nr = detect * (1 + g.noise);
                if (dToPlayer < nr) stim += g.noise * 0.7 * (1 - dToPlayer / nr);
            }
            if (g.lightOn !== false && dToPlayer < detect * 1.4) {                       // headlight = beacon
                stim += 0.3 * (1 - dToPlayer / (detect * 1.4));
            }
            if (g.bloodLevel > 0 && (e.role === 'scavenger' || e.role === 'pack')) stim += g.bloodLevel * 0.4;
            if (e.role === 'apex' || e.role === 'sensor') stim *= 1.3;                   // perceptive
            if (e.role === 'sessile') stim *= 0.5;
            if (p._detectMult) stim *= p._detectMult;   // ANECHOIC COATING
            // METABOLISM — a fed predator barely cares about you (Subnautica's reprieve)
            if (e._hunger === undefined) e._hunger = 0.35 + Math.random() * 0.45;
            e._hunger = Math.min(1, e._hunger + dt * 0.012);
            if (e._hunger < 0.3 && e.role !== 'sessile' && e.role !== 'sensor') stim *= 0.4;
            // Ink blinds them too — hide inside the squid's own defence
            if (g._inInk) stim *= 0.25;
            // Cold layers bend sonar-sense; silt clouds smother it
            if (g._inThermo) stim *= 0.45;
            if (g._inSediment) stim *= 0.4;
            // COVERT OBSERVATION — watch it live, undetected, running silent or dark:
            // 10s of field study per species = research tier 2. Fear tools become science tools.
            e._observing = 0;
            if ((g.silent || g.lightOn === false) && e.awareness < 0.5 && dToPlayer < 500
                && (meta.research[e.typeId] || 0) === 1 && !e.ghost) {
                meta.observeSec[e.typeId] = (meta.observeSec[e.typeId] || 0) + dt;
                e._observing = Math.min(1, meta.observeSec[e.typeId] / 10);
                if (meta.observeSec[e.typeId] >= 10) creditResearch(g, e.typeId, 2, 'covert observation');
            }
            e.awareness = Math.max(0, Math.min(1, (e.awareness || 0) + (stim - 0.18) * dt * 1.6));
            // Run silent, slip away: outside close range, quiet actively SHEDS pursuit
            if (g.silent && dToPlayer > (e.detect || 300) * 0.8 && e.awareness > 0.2) e.awareness = Math.max(0.2, e.awareness - dt * 0.5);
            // Photophobic recoil — routed by a fresh floodlight burst
            if (e._feared > 0) { e._feared -= dt; e.x -= Math.cos(angleToPlayer) * e.speed * 1.2 * dt; e.y -= Math.sin(angleToPlayer) * e.speed * 1.2 * dt; }
            // --- the moment of being noticed: the scare beat ---
            const _wasAware = (e._aw0 || 0) >= 0.5;
            e._aw0 = e.awareness;
            if (!_wasAware && e.awareness >= 0.5) {
                e._alertPulse = 0.6;                                   // eyeshine ignites
                g.shake = Math.min(8, (g.shake || 0) + 2);
                playTone(64 + Math.random() * 26, 0.28, 'sawtooth', 0.05); // it locks on
                maybeHint(g, 'silent', '[Q] SILENT RUNNING — weapons hold, engines hush. You become a hole in the water.');
                _ecoNotice(g);
                // TERRITORIAL DISPLAY — big predators warn before they commit; back off and live
                if ((e.role === 'apex' || e.role === 'mid') && !e.isBoss) {
                    e._displayT = 1.2;
                    if (dToPlayer < 480) creditResearch(g, e.typeId, 3, 'threat display recorded');
                }
            } else if (_wasAware && e.awareness < 0.5) {
                _ecoLost(g);
            }
            if (e._alertPulse > 0) e._alertPulse -= dt;
        }
        // LURED — a decoy is more interesting than you are
        if (e._lure && e._lure.t > 0) {
            e._lure.t -= dt;
            const la = Math.atan2(e._lure.y - e.y, e._lure.x - e.x);
            e.x += Math.cos(la) * e.speed * 0.9 * dt;
            e.y += Math.sin(la) * e.speed * 0.9 * dt;
            continue;
        }
        // Display phase: it flares and holds. Retreat past its comfort line and it stands down.
        if (e._displayT > 0) {
            e._displayT -= dt;
            e._alertPulse = Math.max(e._alertPulse || 0, 0.3);
            if (dToPlayer > (e.detect || 300) * 1.25) { e.awareness = 0.25; e._displayT = 0; }
            else { e.x += Math.cos(angleToPlayer) * e.speed * 0.15 * dt; e.y += Math.sin(angleToPlayer) * e.speed * 0.15 * dt; }
            continue;
        }
        // Unaware creatures (ecology mode) live their own life: drift near home, ignore the sub.
        if (g._modeCfg && g._modeCfg.ecology && e.awareness < 0.5 && e.hp > 0 && e.ai !== 'static_spit' && e.ai !== 'patrol') {
            // PREDATION — hungry hunters hunt PREY, not you. Watch the food web work.
            const isHunter = e.role === 'apex' || e.role === 'pack' || e.role === 'mid' || e.role === 'ambush';
            if (isHunter && (e._hunger || 0) > 0.65 && !e.carrier) {
                if (!e._prey || e._prey.hp <= 0 || e._prey._eaten) {
                    e._prey = _nearby(e.x, e.y, 380).find(o => o !== e && o.role === 'prey' && !o.carrier && o.hp > 0 && !o._eaten) || null;
                }
                if (e._prey) {
                    const pa = Math.atan2(e._prey.y - e.y, e._prey.x - e.x);
                    e.x += Math.cos(pa) * e.speed * 0.8 * dt;
                    e.y += Math.sin(pa) * e.speed * 0.8 * dt;
                    if (dist(e, e._prey) < (e.size + e._prey.size)) {
                        e._prey._eaten = true; e._prey.hp = 0;      // eaten, not killed — no rewards
                        e._hunger = 0;                              // satiated: it will ignore you for minutes
                        if (dist(g.player, e) < 480) creditResearch(g, e.typeId, 3, 'feeding witnessed');
                        g.corpses.push({ x: e._prey.x, y: e._prey.y, t: 8, role: 'prey', size: e._prey.size * 0.6 });
                        g.bloodLevel = Math.min(2.5, (g.bloodLevel || 0) + 0.15);
                        for (let pi = 0; pi < 5; pi++) g.effects.push({ type: 'particle', x: e._prey.x, y: e._prey.y, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90, life: 0.4, color: '#A83048', size: 2 });
                        e._prey = null;
                    }
                    continue;
                }
            }
            // SCAVENGING — scavengers converge on corpses and consume them; crowds get loud
            if (e.role === 'scavenger' && g.corpses.length) {
                let bestC = null, bestD = 500;
                for (const c of g.corpses) { const d = dist(e, c); if (d < bestD) { bestD = d; bestC = c; } }
                if (bestC) {
                    if (bestD > 24) {
                        const ca = Math.atan2(bestC.y - e.y, bestC.x - e.x);
                        e.x += Math.cos(ca) * e.speed * 0.7 * dt;
                        e.y += Math.sin(ca) * e.speed * 0.7 * dt;
                    } else {
                        bestC.t -= dt * 3;                          // feeding consumes the corpse fast
                        bestC._feeders = (bestC._feeders || 0) + 1; // reset each frame below
                        e._hunger = Math.max(0, (e._hunger || 0.5) - dt * 0.3);
                        if (Math.random() < dt * 2) g.effects.push({ type: 'particle', x: bestC.x, y: bestC.y, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, life: 0.3, color: '#6A2030', size: 1.5 });
                        // Feeding frenzy — three or more feeders ring the dinner bell
                        if (bestC._feeders >= 3) { g.noise = Math.min(2.5, (g.noise || 0) + dt * 0.3); if (g.depth > APEX_DEPTH) g.apexThreat = Math.min(10, (g.apexThreat || 0) + dt * 0.15); }
                    }
                    continue;
                }
            }
            e.wanderAngle = (e.wanderAngle || 0) + (Math.random() - 0.5) * dt * 2;
            const hx = (e._homeX != null ? e._homeX : e.x) - e.x;
            const hy = (e._homeY != null ? e._homeY : e.y) - e.y;
            const driftA = (Math.hypot(hx, hy) > 280) ? Math.atan2(hy, hx) : e.wanderAngle;
            const idleSpd = (ENEMY_TYPES[e.typeId]?.speed || e.speed) * 0.35;
            e.x += Math.cos(driftA) * idleSpd * dt;
            e.y += Math.sin(driftA) * idleSpd * dt;
            continue;
        }

        // Feature 3: AI behaviors
        const ai = e.ai || 'chase';
        if (ai === 'drift') {
            // Jellyfish: random wander
            e.wanderAngle = (e.wanderAngle || 0) + (Math.random() - 0.5) * 0.5 * dt * 3;
            e.x += Math.cos(e.wanderAngle) * e.speed * dt;
            e.y += Math.sin(e.wanderAngle) * e.speed * dt;
        } else if (ai === 'pack') {
            // Piranha: pack hunting
            let packCount = 0;
            for (const e2 of g.enemies) {
                if (e2 !== e && e2.typeId === 'piranha' && dist(e, e2) < 100) packCount++;
            }
            const packBonus = packCount >= 2 ? 1.5 : 1;
            e.dartTimer = (e.dartTimer || 0) - dt;
            if (e.dartTimer > 0) {
                // Darting in
                e.x += Math.cos(angleToPlayer) * e.speed * packBonus * 2 * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * packBonus * 2 * dt;
            } else {
                // Orbiting
                e.orbitAngle = (e.orbitAngle || 0) + 0.8 * dt;
                const targetX = p.x + Math.cos(e.orbitAngle) * 120;
                const targetY = p.y + Math.sin(e.orbitAngle) * 120;
                const toTargetA = Math.atan2(targetY - e.y, targetX - e.x);
                e.x += Math.cos(toTargetA) * e.speed * packBonus * dt;
                e.y += Math.sin(toTargetA) * e.speed * packBonus * dt;
                if (dToPlayer < 130 && Math.random() < 0.01) e.dartTimer = 0.5;
            }
        } else if (ai === 'curious') {
            // Squid: approach/orbit/flee
            if (e.state === 'flee') {
                e.stateTimer = (e.stateTimer || 0) - dt;
                const fleeA = Math.atan2(e.y - p.y, e.x - p.x);
                e.x += Math.cos(fleeA) * e.speed * 1.5 * dt;
                e.y += Math.sin(fleeA) * e.speed * 1.5 * dt;
                if (e.stateTimer <= 0) e.state = 'approach';
            } else if (dToPlayer > 150) {
                e.state = 'approach';
                e.x += Math.cos(angleToPlayer) * e.speed * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * dt;
            } else {
                e.state = 'orbit';
                e.orbitAngle = (e.orbitAngle || 0) + 0.5 * dt;
                const orbitX = p.x + Math.cos(e.orbitAngle) * 150;
                const orbitY = p.y + Math.sin(e.orbitAngle) * 150;
                const oa = Math.atan2(orbitY - e.y, orbitX - e.x);
                e.x += Math.cos(oa) * e.speed * dt;
                e.y += Math.sin(oa) * e.speed * dt;
            }
        } else if (ai === 'ambush') {
            // Anglerfish: hidden until close, then lunge
            if (e.state === 'hidden') {
                e._alpha = 0.1 + Math.sin(g.runTime * 2) * 0.05;
                if (dToPlayer < 200) {
                    e.state = 'lunge';
                    e.lungeTimer = 1.5;
                    g.shake = 3;
                    addNereidLog(g, 'AMBUSH! Anglerfish lunge detected!');
                }
            } else if (e.state === 'lunge') {
                e._alpha = 0.9;
                e.lungeTimer = (e.lungeTimer || 0) - dt;
                e.x += Math.cos(angleToPlayer) * e.speed * 3 * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * 3 * dt;
                if (e.lungeTimer <= 0) { e.state = 'reset'; e.stateTimer = 2; }
            } else { // reset
                e.stateTimer = (e.stateTimer || 0) - dt;
                if (e.stateTimer <= 0) { e.state = 'hidden'; e._alpha = 0.1; }
            }
        } else if (ai === 'zigzag') {
            // Eel: sinusoidal approach
            e.zigPhase = (e.zigPhase || 0) + dt * 4;
            const perpAngle = angleToPlayer + Math.PI / 2;
            const zigOffset = Math.sin(e.zigPhase) * 60;
            e.x += Math.cos(angleToPlayer) * e.speed * dt + Math.cos(perpAngle) * zigOffset * dt;
            e.y += Math.sin(angleToPlayer) * e.speed * dt + Math.sin(perpAngle) * zigOffset * dt;
        } else if (ai === 'patrol') {
            // Leviathan/bosses: patrol circle, charge when player close
            if (e.state === 'patrol') {
                e.patrolAngle = (e.patrolAngle || 0) + 0.15 * dt;
                const pr = 300;
                const patrolX = (e._patrolCx || 0) + Math.cos(e.patrolAngle) * pr;
                const patrolY = (e._patrolCy || 0) + Math.sin(e.patrolAngle) * pr;
                if (!e._patrolCx) { e._patrolCx = e.x; e._patrolCy = e.y; }
                const pa = Math.atan2(patrolY - e.y, patrolX - e.x);
                e.x += Math.cos(pa) * e.speed * dt;
                e.y += Math.sin(pa) * e.speed * dt;
                // Trigger telegraphed attack when player gets close OR every ~9s
                e._attackTimer = (e._attackTimer || 9) - dt;
                if (dToPlayer < 280 || e._attackTimer <= 0) {
                    e.state = 'telegraph';
                    e.stateTimer = 1.6; // longer telegraph so player can react
                    e.chargeTarget = { x: p.x, y: p.y };
                    e._attackTimer = 9 + Math.random() * 4;
                }
            } else if (e.state === 'telegraph') {
                e.stateTimer -= dt;
                // Update target lock for line attacks during telegraph
                if (e.attackPattern === 'charge') { e.chargeTarget = { x: p.x, y: p.y }; }
                if (e.stateTimer <= 0) {
                    e.state = 'attack';
                    e.stateTimer = e.attackPattern === 'charge' ? 1.5 : 0.6;
                    g.shake = 6; g.flashTimer = 0.15;
                    // Execute attack pattern
                    executeBossAttack(g, e);
                }
            } else if (e.state === 'attack') {
                e.stateTimer -= dt;
                if (e.attackPattern === 'charge') {
                    const ca = Math.atan2(e.chargeTarget.y - e.y, e.chargeTarget.x - e.x);
                    e.x += Math.cos(ca) * e.speed * 3.5 * dt;
                    e.y += Math.sin(ca) * e.speed * 3.5 * dt;
                }
                if (e.stateTimer <= 0) { e.state = 'cooldown'; e.stateTimer = 3.5; }
            } else { // cooldown
                e.stateTimer -= dt;
                if (e.stateTimer <= 0) { e.state = 'patrol'; }
            }
        } else if (ai === 'shell') {
            // HERMIT — slow approach, periodic charge with telegraph. Shell halves damage while
            // closed; for a beat after each charge the actuator vents and it takes bonus damage.
            e._chargeCd = (e._chargeCd || 3) - dt;
            if (e._exposedT > 0) e._exposedT -= dt;
            if (e._chargeState === 'charge') {
                e._chargeT = (e._chargeT || 0) - dt;
                e.x += Math.cos(e._chargeAng) * e.speed * 4 * dt;
                e.y += Math.sin(e._chargeAng) * e.speed * 4 * dt;
                if (e._chargeT <= 0) { e._chargeState = null; e._chargeCd = 4 + Math.random() * 2; e._exposedT = 1.2; }
            } else if (e._chargeCd <= 0 && dToPlayer < 280) {
                e._chargeState = 'charge';
                e._chargeT = 0.6;
                e._chargeAng = angleToPlayer;
            } else {
                // Slow patrol
                e.x += Math.cos(angleToPlayer) * e.speed * 0.4 * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * 0.4 * dt;
            }
        } else if (ai === 'puff') {
            // PUFFER — slow chase, on death detonates spike burst (handled in death code, see below)
            e.x += Math.cos(angleToPlayer) * e.speed * dt;
            e.y += Math.sin(angleToPlayer) * e.speed * dt;
        } else if (ai === 'sweep') {
            // MANTA — slow sweeping arc around player
            e.sweepAngle = (e.sweepAngle || Math.atan2(e.y - p.y, e.x - p.x)) + 0.5 * dt;
            const sR = 200;
            const tx = p.x + Math.cos(e.sweepAngle) * sR;
            const ty = p.y + Math.sin(e.sweepAngle) * sR;
            const sa = Math.atan2(ty - e.y, tx - e.x);
            e.x += Math.cos(sa) * e.speed * dt;
            e.y += Math.sin(sa) * e.speed * dt;
        } else if (ai === 'shooter') {
            // GLOWSHRIMP / NIGHTMARE / DRAGONFISH — keep distance, fire projectiles on cooldown
            const def = ENEMY_TYPES[e.typeId] || {};
            const idealRange = def.attackRange ? def.attackRange * 0.7 : 250;
            const move = (dToPlayer < idealRange - 40) ? -1 : (dToPlayer > idealRange + 40 ? 1 : 0);
            e.x += Math.cos(angleToPlayer) * e.speed * move * dt;
            e.y += Math.sin(angleToPlayer) * e.speed * move * dt;
            e._shootCd = (e._shootCd || (def.attackCd || 3) * (0.3 + Math.random() * 0.7)) - dt;
            if (e._shootCd <= 0 && dToPlayer < (def.attackRange || 350)) {
                e._shootCd = def.attackCd || 3;
                const sp = def.projSpeed || 240;
                const dmg = def.projDmg || 8;
                const col = def.projColor || '#FF6040';
                const spread = def.projSpread || 1;
                for (let pi = 0; pi < spread; pi++) {
                    const aOff = spread > 1 ? (pi - (spread - 1) / 2) * 0.18 : 0;
                    const a = angleToPlayer + aOff;
                    g.projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, aoe: 14, life: 2.5, pierce: 0, color: col, enemy: true, emp: !!def.emp });
                }
                playTone(160 + Math.random() * 60, 0.08, 'square', 0.04);
            }
        } else if (ai === 'phase') {
            // VAMPYRO — phases in/out. While phased, can't be hit (e._phased).
            e._phaseT = (e._phaseT || 3) - dt;
            if (e._phaseT <= 0) {
                e._phased = !e._phased;
                e._phaseT = e._phased ? 1.5 : 2.5;
            }
            // Move toward player at slower speed when phased
            const ms = e._phased ? 0.6 : 1.0;
            e.x += Math.cos(angleToPlayer) * e.speed * ms * dt;
            e.y += Math.sin(angleToPlayer) * e.speed * ms * dt;
        } else if (ai === 'lunge') {
            // GULPER — slow stalk, telegraph then high-speed lunge in straight line
            const def = ENEMY_TYPES[e.typeId] || {};
            e._lungeState = e._lungeState || 'stalk';
            if (e._lungeState === 'stalk') {
                e.x += Math.cos(angleToPlayer) * e.speed * 0.5 * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * 0.5 * dt;
                e._lungeCd = (e._lungeCd || (def.attackCd || 5)) - dt;
                if (e._lungeCd <= 0 && dToPlayer < (def.attackRange || 280)) {
                    e._lungeState = 'wind';
                    e._lungeT = 0.9;
                    e._lungeAng = angleToPlayer;
                }
            } else if (e._lungeState === 'wind') {
                e._lungeT -= dt;
                if (e._lungeT <= 0) { e._lungeState = 'lunge'; e._lungeT = 0.5; }
            } else if (e._lungeState === 'lunge') {
                e._lungeT -= dt;
                e.x += Math.cos(e._lungeAng) * (def.lungeSpeed || 380) * dt;
                e.y += Math.sin(e._lungeAng) * (def.lungeSpeed || 380) * dt;
                if (e._lungeT <= 0) { e._lungeState = 'stalk'; e._lungeCd = def.attackCd || 5; }
            }
        } else if (ai === 'static_spit') {
            // TUBE WORM — stationary, fires acid in 4 cardinal directions
            const def = ENEMY_TYPES[e.typeId] || {};
            e._spitCd = (e._spitCd || (def.attackCd || 3)) - dt;
            if (e._spitCd <= 0) {
                e._spitCd = def.attackCd || 3;
                const sp = def.projSpeed || 200, dmg = def.projDmg || 7, col = def.projColor || '#80C040';
                for (let dirI = 0; dirI < 4; dirI++) {
                    const a = (dirI / 4) * PI2;
                    g.projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, dmg, aoe: 16, life: 3, pierce: 0, color: col, enemy: true });
                }
                playTone(110, 0.1, 'sawtooth', 0.05);
            }
        } else if (ai === 'pulser') {
            // VOID EYE — periodic sonar pulse damaging in radius
            const def = ENEMY_TYPES[e.typeId] || {};
            e._pulseCd = (e._pulseCd || (def.attackCd || 6)) - dt;
            if (e._pulseCd <= 0) {
                e._pulseCd = def.attackCd || 6;
                const pR = def.pulseR || 220;
                if (dist(e, p) < pR && p.iFrames <= 0) {
                    const dmg = Math.max(1, (def.pulseDmg || 18) - p.armor);
                    p.hp -= dmg; p.iFrames = 0.5; g.shake = 5; sfxHit(); duckMusic(0.8); playSample("impact", 0.4, 0.9 + Math.random() * 0.2);
                    if (g.scoreCombo) g.scoreCombo.lastHitTime = g.runTime;
                    g._lastAttackerTypeId = e.typeId;
                }
                g.effects.push({ type: 'sonar_ring', x: e.x, y: e.y, radius: 0, maxRadius: pR, dmg: 0, speed: 380, hit: new Set() });
            }
            // Slowly drift toward player
            e.x += Math.cos(angleToPlayer) * e.speed * dt;
            e.y += Math.sin(angleToPlayer) * e.speed * dt;
        } else if (ai === 'listener') {
            // THE LISTENER — dormant when sub is silent. Wakes briefly when player fires/pings.
            // "Sound" detection: if a sonar ring exists OR a player projectile exists in last 1s.
            const heardSound = g._lastListenerSound != null && (g.runTime - g._lastListenerSound) < 2.5;
            if (heardSound) {
                e.x += Math.cos(angleToPlayer) * e.speed * 4 * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * 4 * dt;
            }
            // Otherwise stationary
        } else if (ai === 'burst') {
            // TRENCH WORM — emerges with 1.4s warning, then high contact damage
            const def = ENEMY_TYPES[e.typeId] || {};
            e._burstState = e._burstState || 'rising';
            e._burstT = (e._burstT || (def.ambushTime || 1.4)) - dt;
            if (e._burstState === 'rising') {
                if (e._burstT <= 0) { e._burstState = 'active'; }
            }
            // Stationary; can damage on contact (handled by hit player code)
        } else if (ai === 'tether') {
            // DAVIT WRAITH — hooks the sub and REELS. Break it: dash, distance, or hurt it.
            if (e._tetherCd > 0) e._tetherCd -= dt;
            if (e._tethered) {
                // dash snaps the line; so does range; so does enough damage since attach
                if (p.dashTimer > 0 || dToPlayer > 360 || (e._tetherHp - e.hp) > 30) {
                    e._tethered = false; e._tetherCd = 4;
                    g.floatingTexts.push({ x: p.x, y: p.y - 22, text: 'LINE CUT', color: '#80FFA0', life: 0.8, vy: -26 });
                } else {
                    // reel the sub in; the wraith barely moves — everything it catches comes to it
                    const pull = 62;
                    const ta = Math.atan2(e.y - p.y, e.x - p.x);
                    p.x += Math.cos(ta) * pull * dt;
                    p.y += Math.sin(ta) * pull * dt;
                    if (dToPlayer < 46 && p.iFrames <= 0) {
                        const dmg = Math.max(4, (e.damage || 12) - p.armor);
                        p.hp -= dmg; p.iFrames = 0.6; g.shake = 6; sfxHit(); duckMusic(0.8); playSample("impact", 0.45, 0.85 + Math.random() * 0.2);
                        if (g.scoreCombo) g.scoreCombo.lastHitTime = g.runTime;
                        g._lastAttackerTypeId = e.typeId;
                        e._tethered = false; e._tetherCd = 4;
                    }
                }
            } else {
                // drift toward hook range, then attach
                if (dToPlayer > 220) { e.x += Math.cos(angleToPlayer) * e.speed * dt; e.y += Math.sin(angleToPlayer) * e.speed * dt; }
                if (dToPlayer < 250 && (e._tetherCd || 0) <= 0) {
                    e._tethered = true; e._tetherHp = e.hp;
                    playTone(90, 0.3, 'sawtooth', 0.07);
                    g.floatingTexts.push({ x: p.x, y: p.y - 22, text: 'HOOKED — DASH TO CUT', color: '#FF8040', life: 1.2, vy: -22 });
                }
            }
        } else if (ai === 'inker') {
            // BALLAST SQUID — skittish; vents an ink cloud when pressed, then bolts
            if (e._inkCd > 0) e._inkCd -= dt;
            const pressed = dToPlayer < 130 || e.flash > 0.05;
            if (pressed && (e._inkCd || 0) <= 0) {
                e._inkCd = 6;
                if (!g.inkClouds) g.inkClouds = [];
                g.inkClouds.push({ x: e.x, y: e.y, r: 115, t: 7 });
                e._fleeT = 1.4;
                playTone(180, 0.2, 'sine', 0.05);
            }
            if (e._fleeT > 0) {
                e._fleeT -= dt;
                e.x += Math.cos(angleToPlayer + Math.PI) * e.speed * 2.2 * dt;
                e.y += Math.sin(angleToPlayer + Math.PI) * e.speed * 2.2 * dt;
            } else {
                // curious orbit at a wary distance
                const want = 200;
                const move = dToPlayer > want + 30 ? 1 : dToPlayer < want - 30 ? -1 : 0;
                e.x += Math.cos(angleToPlayer) * e.speed * 0.6 * move * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * 0.6 * move * dt;
            }
        } else if (ai === 'latch') {
            // BILGE LEECH — latches the hull and drinks your battery. Dash flings them all off.
            if (e._latched) {
                if (p.dashTimer > 0) {
                    e._latched = false; e._stunT = 1.2;
                    const fa = Math.random() * PI2;
                    e.x = p.x + Math.cos(fa) * 90; e.y = p.y + Math.sin(fa) * 90;
                    g.floatingTexts.push({ x: e.x, y: e.y - 10, text: 'FLUNG', color: '#80FFA0', life: 0.7, vy: -22 });
                } else {
                    e.x = p.x + Math.cos(e._latchA) * (16 + e.size);
                    e.y = p.y + Math.sin(e._latchA) * (16 + e.size);
                    p.battery = Math.max(0, (p.battery || 100) - 1.3 * dt);
                    p.hp -= 0.4 * dt;
                    if (Math.random() < dt * 0.5) g.floatingTexts.push({ x: p.x, y: p.y - 26, text: 'POWER DRAIN — DASH', color: '#FFD040', life: 0.9, vy: -20 });
                }
            } else if (e._stunT > 0) {
                e._stunT -= dt;
            } else {
                e.x += Math.cos(angleToPlayer) * e.speed * dt;
                e.y += Math.sin(angleToPlayer) * e.speed * dt;
                const latchedCount = g.enemies.reduce((n, o) => n + (o._latched ? 1 : 0), 0);
                if (dToPlayer < 22 + e.size && latchedCount < 2) {
                    e._latched = true;
                    e._latchA = Math.random() * PI2;
                    playTone(140, 0.15, 'square', 0.05);
                }
            }
        } else {
            // Default: chase player
            e.x += Math.cos(angleToPlayer) * e.speed * dt;
            e.y += Math.sin(angleToPlayer) * e.speed * dt;
        }

        // Aberrant behavioural twist (data-driven per creature)
        if (e.aberrant) applyAberrantTwist(g, e, p, dt, dToPlayer, angleToPlayer);

        // Feature 4: Kraken tentacle spawning
        if (e.typeId === 'kraken' && e.isBoss) {
            e.tentacleTimer = (e.tentacleTimer || 3) - dt;
            if (e.tentacleTimer <= 0) {
                e.tentacleTimer = 3;
                for (let ti = 0; ti < 2; ti++) {
                    const ta = Math.random() * PI2;
                    spawnEnemy(g, { id: 'piranha', ...ENEMY_TYPES.piranha }, { x: e.x + Math.cos(ta)*80, y: e.y + Math.sin(ta)*80 });
                }
            }
        }

        // Feature 4: Dreadnought depth charges
        if (e.typeId === 'dreadnought' && e.isBoss) {
            e.dcTimer = (e.dcTimer || 2) - dt;
            if (e.dcTimer <= 0) {
                e.dcTimer = 2;
                g.depthCharges.push({ x: e.x, y: e.y, timer: 1.5, dmg: 30, aoe: 60 });
            }
        }

        // Feature 4: Abyssal Maw gravity well — pull player and enemies
        if (e.typeId === 'abyssal_maw' && e.isBoss) {
            const grav = 80;
            const ama = Math.atan2(e.y - p.y, e.x - p.x);
            const adist = dist(p, e);
            if (adist > e.size + 20) {
                p._vx = (p._vx || 0) + Math.cos(ama) * grav * dt;
                p._vy = (p._vy || 0) + Math.sin(ama) * grav * dt;
            }
            for (const e2 of g.enemies) {
                if (e2 !== e && dist(e, e2) < 300) {
                    const ga = Math.atan2(e.y - e2.y, e.x - e2.x);
                    e2.x += Math.cos(ga) * 40 * dt;
                    e2.y += Math.sin(ga) * 40 * dt;
                }
            }
        }

        // Hit player — skip phased (vampyro) and rising (trench worm)
        const d = dist(p, e);
        if (d < e.size + 12 && p.iFrames <= 0 && !e.ghost && !e._phased && e._burstState !== 'rising') {
            // Feeding hour: damage taken doubled
            const feedMult = g._feeding ? 2 : 1;
            const dmg = Math.max(1, e.damage * (g._enemyDmgMult || 1) * feedMult - p.armor);
            p.hp -= dmg;
            p.iFrames = 0.5;
            g.shake = 3;
            sfxHit();
            // Stamp last attacker for death-attribution
            g._lastAttackerTypeId = e.typeId;
            g._lastAttackerIsBoss = e.isBoss || (e.maxHp || 0) >= 500;
            // Reset PERFECT scoring window
            if (g.scoreCombo) g.scoreCombo.lastHitTime = g.runTime;
            g.floatingTexts.push({ x: p.x, y: p.y - 20, text: '-' + dmg, color: '#FF4040', life: 0.8, vy: -30 });
            if (p.hp <= 0) {
                if (p.deathDefiance > 0) {
                    // DEATH DEFIANCE (Hades) — clutch revive
                    p.deathDefiance--;
                    p.hp = Math.floor(p.maxHp * 0.5);
                    p.iFrames = 2;
                    g.shake = 2;
                    g.flashTimer = 0.3;
                    g.slowmo = 0.5;
                    sfxRevive();
                    g.floatingTexts.push({ x: p.x, y: p.y - 30, text: 'DEATH DEFIANCE', color: '#FFD040', life: 2, vy: -20 });
                    g.streak = 'DEATH DEFIED'; g.streakTimer = 2;
                } else { onDeath(g); return; }
            }
        }

        // Dead
        if (e.hp <= 0) {
            // Eaten by the food web, not killed by you — no XP, gems, gold or score
            if (e._eaten) { g.enemies.splice(i, 1); continue; }
            // SPLITTER — the bloom divides. Fragments don't divide again.
            if (e.typeId === 'splitter' && !e._small && !e.ghost) {
                for (let si = 0; si < 2; si++) {
                    const sa = Math.random() * PI2;
                    g.enemies.push({
                        x: e.x + Math.cos(sa) * 14, y: e.y + Math.sin(sa) * 14,
                        hp: e.maxHp * 0.35, maxHp: e.maxHp * 0.35, speed: e.speed * 1.4, size: e.size * 0.6,
                        color: e.color, xp: 1, damage: Math.max(2, (e.damage || 4) * 0.6), gold: 1,
                        typeId: 'splitter', flash: 0, _small: true, ai: 'drift',
                        wanderAngle: Math.random() * PI2, state: 'chase', awareness: 1,
                        role: 'prey', detect: 200, _homeX: e.x, _homeY: e.y,
                    });
                }
            }
            // Feature 9: Creature scanning
            if (!e.ghost) {
                const scanKey = e.aberrant ? ('aberrant_' + e.typeId) : e.typeId;
                const scanArr = e.aberrant ? meta.aberrantScanned : meta.scannedCreatures;
                if (!scanArr.includes(scanKey)) {
                    scanArr.push(scanKey);
                    saveMeta();
                    sfxScanCreature();
                    addNereidLog(g, `New creature scanned: ${ENEMY_TYPES[e.typeId] ? ENEMY_TYPES[e.typeId].name : e.typeId}${e.aberrant ? ' [ABERRANT]' : ''}. Logged to codex.`);
                }
                // An aberrant specimen is a dissection-grade sample — full analysis
                if (e.aberrant) creditResearch(g, e.typeId, 3, 'aberrant specimen');
                else creditResearch(g, e.typeId, 1, 'specimen retrieved');
            }

            if (!e.ghost) {
                g.kills++;
                // Feeding hour: gold + xp rewards doubled
                const feedReward = g._feeding ? 2 : 1;
                g.goldEarned += Math.floor(e.gold * (g._goldMult || 1) * feedReward * (g._stakeMult || 1));
                sfxEnemyDeath(e.typeId);
                // Battery recharge — kinetic scavenge from kills (more for big enemies)
                const charge = 1 + Math.min(8, (e.maxHp || 1) / 30);
                g.player.battery = Math.min(100, (g.player.battery || 100) + charge);
                // Objective counters
                if (e.aberrant) g._aberrantKills = (g._aberrantKills || 0) + 1;
                if (e.isBoss || (e.maxHp || 0) >= 500) {
                    g._bossKills = (g._bossKills || 0) + 1;
                    // Persistent leviathan kill counter
                    if (LEVIATHAN_LORE[e.typeId] && meta.leviathanKills) {
                        meta.leviathanKills[e.typeId] = (meta.leviathanKills[e.typeId] || 0) + 1;
                        saveMeta();
                        const lore = LEVIATHAN_LORE[e.typeId];
                        addNereidLog(g, `${lore.name} — confirmed kill. ${meta.leviathanKills[e.typeId]} returned heads.`);
                    }
                }
                // Elite/aberrant lore drops
                if ((e.maxHp > 50 && Math.random() < 0.08) || (e.aberrant && Math.random() < 0.25)) dropLore(g);
                // --- BALATRO SCORING: chips × mult per kill ---
                const sc = g.scoreCombo;
                // Build/reset chain (1.2s window)
                if (sc.chainTimer > 0) sc.chainCount++; else sc.chainCount = 1;
                sc.chainTimer = 1.2;
                // Track unique types in 4s rolling window
                if (e.typeId) sc.uniqueTypes.add(e.typeId);
                sc.uniqueTimer = 4;
                // Sonar burst: count kills delivered by an active sonar ring
                if (e._killBy === 'sonar') { sc.sonarBurstCount++; sc.sonarBurstTimer = 0.5; }
                // Score this kill — emits floating text below
                const ev = scoreKill(g, e, { sonarBurst: e._killBy === 'sonar' });
                // Floating SCORE pop near the dead body
                g.floatingTexts.push({
                    x: e.x, y: e.y - 6, text: '+' + ev.total, color: '#FFE082',
                    life: 1.0, vy: -36, score: true, mult: ev.mult,
                });
            }
            g.combo++;
            g.comboTimer = 2;
            if (g.combo > g.bestCombo) g.bestCombo = g.combo;

            // Feature 5: Cascade kill system
            if (!e.ghost) {
                const now = g.runTime;
                g.chainKillQueue = g.chainKillQueue.filter(t => now - t < 0.5);
                g.chainKillQueue.push(now);
                p.chainCount++;
                p.chainTimer = 0.5;
                if (meta.bestChain < p.chainCount) { meta.bestChain = p.chainCount; saveMeta(); }

                // Cascade trigger: 3+ kills in 0.5s
                if (g.chainKillQueue.length >= 3) {
                    if (!g.cascadeActive) {
                        g.cascadeActive = true;
                        g.cascadeTimer = 0.5;
                    } else {
                        g.cascadeTimer = 0.5;
                    }
                    g.cascadeCount = g.chainKillQueue.length;
                    // Mult capped, and bonus XP is now an additive fraction (not full XP × mult — was the runaway level-up source)
                    const chainMult = Math.min(3, (g.cascadeCount - 2) * 0.5) + (p._cascadeBonus ? 0.5 : 0);
                    const bonusXp = Math.floor(e.xp * chainMult * 0.4 * (p.xpMult || 1));
                    if (bonusXp > 0) p.xp += bonusXp;

                    sfxCascadeTone(g.cascadeCount);
                    // Cascade ring effect
                    g.effects.push({ type: 'cascade_ring', x: e.x, y: e.y, radius: 0, maxRadius: 60, color: e.color, speed: 400, life: 1 });

                    // MASSIVE chain (10+)
                    if (g.cascadeCount >= 10) {
                        g.slowmo = 0.3;
                        g.streak = 'CHAIN REACTION!!';
                        g.streakTimer = 2.5;
                        g.flashTimer = 0.2;
                        g.shake = 5;
                    }
                    // Chain HUD display
                    g.chainDisplayTimer = 1.5;
                }
            }

            // Chain kill tracking
            if (p.chainCount >= 3) sfxChainKill();

            // Streak text
            if (g.combo === 10) { g.streak = 'KILLING SPREE'; g.streakTimer = 1.5; }
            if (g.combo === 25) { g.streak = 'MEGA KILL!'; g.streakTimer = 1.5; }
            if (g.combo === 50) { g.streak = 'UNSTOPPABLE!'; g.streakTimer = 2; }
            if (g.combo === 100) { g.streak = 'GODLIKE!'; g.streakTimer = 2.5; }
            if (g.combo === 200) { g.streak = 'BEYOND GODLIKE!!'; g.streakTimer = 3; }

            // Slowmo on elite kills (Hades)
            if (!e.ghost) {
                if (e.maxHp > 50) { g.slowmo = 0.12; g.shake = 2; }
                if (e.typeId === 'leviathan' || e.isBoss) { g.slowmo = 0.6; g.shake = 5; g.flashTimer = 0.3; }
            }

            // Chain explosion radius — capped to N per frame so big sweeps don't iterate enemies^2 times
            const chainRadius = (g.cascadeActive ? 120 : 60) * (p._cascadeBonus ? 2 : 1);
            if (p.chainCount >= 5 && (g._chainExplosionsThisFrame || 0) < 4) {
                g._chainExplosionsThisFrame = (g._chainExplosionsThisFrame || 0) + 1;
                const cr2 = chainRadius * chainRadius;
                for (const e2 of g.enemies) {
                    if (e2 === e || e2.ghost || e2.hp <= 0 || e2.hp >= e2.maxHp * 0.3) continue;
                    const dx = e.x - e2.x, dy = e.y - e2.y;
                    if (dx * dx + dy * dy < cr2) e2.hp = 0;
                }
            }

            // Feature 6: Overkill synergy — 20% chain explode
            if (p._overkill && Math.random() < 0.2) {
                for (const e2 of g.enemies) {
                    if (e2 !== e && dist(e, e2) < 80 && !e2.ghost) {
                        damageEnemy(g, e2, e.maxHp * 0.5);
                    }
                }
            }

            // Feature 6: Depth Diver card
            if (p._depthDiver) {
                if (g.depth >= 2000) p._depthDiverMult = 2;
                else p._depthDiverMult = 0.5;
            }

            // PUFFER death burst — fires 6 spike projectiles in a ring
            if (e.typeId === 'puffer') {
                for (let pi = 0; pi < 6; pi++) {
                    const a = (pi / 6) * PI2;
                    g.projectiles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, dmg: 8, aoe: 12, life: 1.4, pierce: 0, color: '#A0D060', enemy: true });
                }
                playTone(180, 0.12, 'sawtooth', 0.06);
            }
            // CARRIER killed — the pod pays richly, and the whole trench hears it die
            if (e.typeId === 'carrier') {
                for (let gi = 0; gi < 8; gi++) {
                    const gAng = Math.random() * PI2;
                    g.gems.push({ x: e.x + Math.cos(gAng) * 30, y: e.y + Math.sin(gAng) * 30, value: 10, size: 8, life: 25, dropDepth: g.depth || 0, tier: 3, color: GEM_TIERS[2].color, glowColor: GEM_TIERS[2].glow, special: GEM_TIERS[2].special });
                }
                const richPool = LOOT_TYPES.filter(l => l.rarity !== 'common');
                for (let li = 0; li < 2; li++) {
                    const lt = richPool[Math.floor(Math.random() * richPool.length)];
                    g.lootItems.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * 30, type: lt, size: 6, life: 30, dropDepth: g.depth || 0 });
                }
                g.goldEarned += 60;
                // The alarm — blood in the water, every ear turned this way, and IT felt the pod die
                g.bloodLevel = 2.5;
                g.noise = Math.min(2.5, (g.noise || 0) + 1.5);
                for (const e2 of g.enemies) { if (dist(e, e2) < 700) e2.awareness = 1; }
                g.apexThreat = Math.min(10, (g.apexThreat || 0) + 2.5);
                p.corruption = Math.min(100, (p.corruption || 0) + 8);
                g.shake = 8;
                g.streak = 'THE TRENCH HEARD THAT';
                g.streakTimer = 2.5;
                g._carrierKilled = true;
                addNereidLog(g, 'Pod destroyed. Cargo recovered. Pilot — everything with ears just turned toward us. I hope it was worth it.');
            }
            // Drop gems with TIER (color/size/value scale with tier). Bigger enemies drop higher tiers.
            // Each gem stamps the depth it dropped at — fades as we descend past it.
            if (!e.ghost) {
                const gemCount = Math.max(1, Math.floor(e.xp * 0.8));
                // Tier roll based on enemy strength + aberrant/boss flag
                const ePower = (e.maxHp || 1);
                const isElite = ePower >= 80 || e.aberrant || e.isBoss;
                const isBoss = e.isBoss || ePower >= 500;
                for (let gi = 0; gi < gemCount; gi++) {
                    let tier;
                    const r = Math.random();
                    if (isBoss && gi === 0) tier = 4;            // boss guarantees 1 prism
                    else if (isElite && r < 0.35) tier = 3;       // elite: 35% rare
                    else if (e.aberrant && r < 0.6) tier = 2;     // aberrant: 60% uncommon
                    else if (r < 0.06) tier = 3;                  // 6% rare from anything
                    else if (r < 0.22) tier = 2;                  // 22% uncommon
                    else tier = 1;                                // common
                    const tierData = GEM_TIERS[tier - 1];
                    g.gems.push({
                        x: e.x + (Math.random() - 0.5) * 25,
                        y: e.y + (Math.random() - 0.5) * 25,
                        value: Math.max(1, Math.ceil(e.xp / gemCount)) * tierData.mult,
                        size: tierData.size,        // size is purely tier-based — small for tier 1, huge for tier 4
                        life: 15 + tier * 4,
                        dropDepth: g.depth || 0,
                        tier,
                        color: tierData.color,
                        glowColor: tierData.glow,
                        special: tierData.special,
                    });
                }
            }
            // Loot drop — small chance, scales with toughness
            if (!e.ghost) {
                const lootType = rollLootDrop(e);
                if (lootType) {
                    g.lootItems.push({
                        x: e.x + (Math.random() - 0.5) * 10,
                        y: e.y + (Math.random() - 0.5) * 10,
                        type: lootType,
                        size: 6,
                        life: 30,
                        dropDepth: g.depth || 0,
                    });
                }
            }

            // Death particles
            const particleCount = Math.min(12, 4 + Math.floor(e.maxHp / 20));
            for (let pi = 0; pi < particleCount; pi++) {
                const pa = Math.random() * PI2;
                const pspd = 50 + Math.random() * 100;
                g.effects.push({ type: 'particle', x: e.x, y: e.y, vx: Math.cos(pa) * pspd, vy: Math.sin(pa) * pspd, life: 0.3 + Math.random() * 0.3, color: e.color, size: 2 + Math.random() * 3 });
            }

            g.shake = Math.max(g.shake, Math.min(2, e.size * 0.1));
            g.enemies.splice(i, 1);
        }
    }

    // --- Update projectiles ---
    for (let i = g.projectiles.length - 1; i >= 0; i--) {
        const pr = g.projectiles[i];
        // BAITED WARHEAD — the travelling warhead draws contacts toward itself
        if (pr.bait && !pr.enemy) {
            for (const e of g.enemies) {
                const d = dist(pr, e);
                if (d < 160 && d > 0.01) {
                    e.x += (pr.x - e.x) / d * 70 * dt;
                    e.y += (pr.y - e.y) / d * 70 * dt;
                }
            }
        }
        // PLAYER homing projectiles (Wrath kill-mines) — track nearest enemy
        if (pr.homing && !pr.enemy) {
            const target = findNearest(pr, g.enemies);
            if (target) {
                const homA = Math.atan2(target.y - pr.y, target.x - pr.x);
                const cur = Math.atan2(pr.vy, pr.vx);
                let diff = homA - cur;
                while (diff > Math.PI) diff -= PI2;
                while (diff < -Math.PI) diff += PI2;
                const newA = cur + diff * 2.5 * dt;
                const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
                pr.vx = Math.cos(newA) * sp; pr.vy = Math.sin(newA) * sp;
            }
        }
        pr.x += pr.vx * dt;
        pr.y += pr.vy * dt;
        pr.life -= dt;
        if (pr.life <= 0) { g.projectiles.splice(i, 1); continue; }
        // Boss projectile — homes slowly toward player and damages on contact
        if (pr.enemy) {
            // Light homing
            const homA = Math.atan2(p.y - pr.y, p.x - pr.x);
            const cur = Math.atan2(pr.vy, pr.vx);
            let diff = homA - cur;
            while (diff > Math.PI) diff -= PI2;
            while (diff < -Math.PI) diff += PI2;
            const newA = cur + diff * 1.2 * dt;
            const sp = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
            pr.vx = Math.cos(newA) * sp; pr.vy = Math.sin(newA) * sp;
            // Player hit
            if (dist(pr, p) < 14 + 6 && p.iFrames <= 0) {
                // ARC LAMPREY — the bite empties the battery, not the hull
                if (pr.emp) {
                    p.battery = Math.max(0, (p.battery || 100) - 9);
                    p.iFrames = 0.3; g.shake = 3;
                    g.floatingTexts.push({ x: p.x, y: p.y - 20, text: 'POWER DRAIN', color: '#80E0FF', life: 0.9, vy: -28 });
                    playTone(70, 0.25, 'square', 0.06);
                    g.projectiles.splice(i, 1);
                    continue;
                }
                const dmg = Math.max(1, pr.dmg - p.armor);
                p.hp -= dmg; p.iFrames = 0.5; g.shake = 4; sfxHit();
                if (g.scoreCombo) g.scoreCombo.lastHitTime = g.runTime;
                g._lastAttackerIsBoss = true;
                g.floatingTexts.push({ x: p.x, y: p.y - 20, text: '-' + dmg, color: '#FF4040', life: 0.8, vy: -30 });
                g.projectiles.splice(i, 1);
                continue;
            }
            // Obstacle collision (boss torpedoes still die on rocks)
            let hitO = false;
            for (const ob of (g.obstacles || [])) {
                const dx = pr.x - ob.x, dy = pr.y - ob.y;
                const rr = (ob.r || 30) + 4;
                if (dx * dx + dy * dy < rr * rr) { hitO = true; break; }
            }
            if (hitO) {
                g.effects.push({ type: 'explosion', x: pr.x, y: pr.y, radius: 0, maxRadius: pr.aoe || 20, life: 0.3 });
                g.projectiles.splice(i, 1);
            }
            continue;
        }
        // Obstacle collision — projectile detonates / dies on rocks (wrecks survive a hit but get scuffed)
        let hitObstacle = false;
        for (const ob of (g.obstacles || [])) {
            const dx = pr.x - ob.x, dy = pr.y - ob.y;
            const rr = (ob.r || 30) + 4;
            if (dx * dx + dy * dy < rr * rr) { hitObstacle = true; break; }
        }
        if (hitObstacle) {
            if (pr.aoe > 0) {
                for (const e2 of g.enemies) {
                    if (dist(pr, e2) < pr.aoe) damageEnemy(g, e2, pr.dmg * 0.5);
                }
                g.effects.push({ type: 'explosion', x: pr.x, y: pr.y, radius: 0, maxRadius: pr.aoe, life: 0.3 });
                sfxExplosion();
            }
            g.projectiles.splice(i, 1);
            continue;
        }
        // Hit enemies
        for (const e of g.enemies) {
            if (dist(pr, e) < e.size + 8) {
                damageEnemy(g, e, pr.dmg);
                // VOLT TORPEDO — current arcs from the impact to nearby hulls
                if (pr.arc) {
                    const others = g.enemies.filter(e2 => e2 !== e && dist(e, e2) < (pr.arcRange || 150))
                        .sort((a2, b2) => dist(e, a2) - dist(e, b2)).slice(0, pr.arc);
                    for (const e2 of others) {
                        damageEnemy(g, e2, pr.dmg * 0.5);
                        g.effects.push({ type: 'explosion', x: e2.x, y: e2.y, radius: 0, maxRadius: 24, life: 0.2 });
                    }
                }
                // DEAD SPIKE — implant a charge in the wound
                if (pr.implant) e._bomb = { t: pr.implant.fuse, dmg: pr.implant.dmg, aoe: pr.implant.aoe };
                // THE WINCH — hooked; reel it in
                if (pr.hook) e._pullT = pr.hook;
                // CLUSTER WARHEAD — impact scatters live charges
                if (pr.cluster) {
                    for (let ci = 0; ci < pr.cluster; ci++) {
                        const a2 = Math.random() * PI2, r2 = 20 + Math.random() * 50;
                        g.depthCharges.push({ x: pr.x + Math.cos(a2) * r2, y: pr.y + Math.sin(a2) * r2, timer: 0.5 + ci * 0.18, dmg: pr.dmg * 0.6, aoe: 65 });
                    }
                }
                if (pr.aoe > 0) {
                    // AoE explosion
                    for (const e2 of g.enemies) {
                        if (e2 !== e && dist(pr, e2) < pr.aoe) damageEnemy(g, e2, pr.dmg * 0.5);
                    }
                    g.effects.push({ type: 'explosion', x: pr.x, y: pr.y, radius: 0, maxRadius: pr.aoe, life: 0.3 });
                    sfxExplosion();
                }
                if (pr.pierce > 0) { pr.pierce--; } else { g.projectiles.splice(i, 1); break; }
            }
        }
    }

    // --- FUSION STATUS EFFECTS — implanted charges (Dead Spike) + winch hooks ---
    for (const e of g.enemies) {
        if (e._bomb) {
            e._bomb.t -= dt;
            if (e._bomb.t <= 0) {
                const b = e._bomb; e._bomb = null;
                damageEnemy(g, e, b.dmg);
                for (const e2 of g.enemies) { if (e2 !== e && dist(e, e2) < b.aoe) damageEnemy(g, e2, b.dmg * 0.5); }
                g.effects.push({ type: 'explosion', x: e.x, y: e.y, radius: 0, maxRadius: b.aoe, life: 0.3 });
                sfxExplosion();
            }
        }
        if (e._pullT > 0) {
            e._pullT -= dt;
            const d = dist(e, p);
            if (d > 60) { e.x += (p.x - e.x) / d * 380 * dt; e.y += (p.y - e.y) / d * 380 * dt; }
        }
    }

    // Feature 5: Cascade timer
    if (g.cascadeActive) {
        g.cascadeTimer -= dt;
        if (g.cascadeTimer <= 0) { g.cascadeActive = false; g.cascadeCount = 0; }
    }
    if (g.chainDisplayTimer > 0) g.chainDisplayTimer -= dt;

    // Feature 6: Unbreakable synergy regen
    if (p._unbreakable) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.01 * dt);

    // --- Sonar ring effects ---
    for (let i = g.effects.length - 1; i >= 0; i--) {
        const ef = g.effects[i];
        if (ef.type === 'sonar_ring') {
            ef.radius += ef.speed * dt;
            if (ef.radius >= ef.maxRadius) { g.effects.splice(i, 1); continue; }
            const bandInner = ef.radius - 18;
            const bandOuter = ef.radius + 18;
            // Also SCAN any enemy the ring touches — mark identified so its name shows
            const scanInner = ef.radius - 30;
            const scanOuter = ef.radius + 30;
            if (!g._scannedThisRun) g._scannedThisRun = new Set();
            for (const e of g.enemies) {
                if (e.ghost) continue;
                const d = dist(ef, e);
                const r = e.size || 8;
                // SCAN — wider band, fires once per type per run
                if (e.typeId && !g._scannedThisRun.has(e.typeId) && d - r <= scanOuter && d + r >= scanInner) {
                    g._scannedThisRun.add(e.typeId);
                    // Codex unlock for this DSV LIFE (resets if hull pops)
                    if (!meta.scannedCreatures.includes(e.typeId)) {
                        meta.scannedCreatures.push(e.typeId);
                        saveMeta();
                    }
                    creditResearch(g, e.typeId, 1, 'sonar contact');
                    const def = ENEMY_TYPES[e.typeId];
                    if (def) {
                        g.floatingTexts.push({ x: e.x, y: e.y - e.size - 8, text: 'SCANNED · ' + def.name, color: '#80FFE0', life: 1.6, vy: -28 });
                        addNereidLog(g, `Identified: ${def.name}. ${def.lore || ''}`);
                    }
                    // CARRIER identified — knowing what it is IS the other choice. Letting it go pays in MIND.
                    if (e.typeId === 'carrier' && !g._carrierSpared) {
                        g._carrierSpared = true;
                        g.player.corruption = Math.max(0, (g.player.corruption || 0) - 10);
                        g.floatingTexts.push({ x: e.x, y: e.y - e.size - 22, text: 'MIND +10', color: '#A060D0', life: 1.6, vy: -24 });
                        addNereidLog(g, 'It is not a threat. Log it and let it go home, Pilot. ...Thank you. MIND stabilising.');
                    }
                }
                // DAMAGE — narrower band
                if (ef.hit.has(e)) continue;
                if (d + r >= bandInner && d - r <= bandOuter) {
                    ef.hit.add(e);
                    // A ping COLLAPSES phase — the pulse finds what light can't.
                    // Counterplay for every phase-type; rewards the core verb.
                    if (e._phased) {
                        e._phased = false;
                        e._phaseT = 2.2;   // held solid — punish window
                        g.floatingTexts.push({ x: e.x, y: e.y - 12, text: 'RESOLVED', color: '#80FFE0', life: 0.8, vy: -24 });
                    }
                    e._killBy = 'sonar';
                    damageEnemy(g, e, ef.dmg);
                    // Tiny pushback — sonar concussion
                    if (d > 0.01) {
                        const kx = (e.x - ef.x) / d, ky = (e.y - ef.y) / d;
                        e.x += kx * 6; e.y += ky * 6;
                    }
                }
            }
        } else if (ef.type === 'cascade_ring') {
            // Feature 5: Cascade ring visual
            ef.radius += ef.speed * dt;
            ef.life -= dt;
            if (ef.radius >= ef.maxRadius || ef.life <= 0) { g.effects.splice(i, 1); continue; }
        } else if (ef.type === 'explosion') {
            ef.radius += 300 * dt;
            ef.life -= dt;
            if (ef.life <= 0) g.effects.splice(i, 1);
        } else if (ef.type === 'particle') {
            ef.x += ef.vx * dt; ef.y += ef.vy * dt;
            ef.life -= dt;
            if (ef.life <= 0) g.effects.splice(i, 1);
        }
    }

    // Feature 2: Ghost enemy spawning at corruption > 60
    if ((p.corruption || 0) > 60 && Math.random() < 0.003 * dt * 60) {
        const types = getSpawnableTypes(g.wave, g);
        if (types.length) {
            const type = types[Math.floor(Math.random() * types.length)];
            const a = Math.random() * PI2;
            g.enemies.push({
                x: p.x + Math.cos(a) * (300 + Math.random()*200),
                y: p.y + Math.sin(a) * (300 + Math.random()*200),
                hp: 999999, maxHp: 999999, speed: type.speed * 0.8,
                size: type.size, color: type.color, xp: 0, damage: 0, gold: 0,
                typeId: type.id, flash: 0, ghost: true,
                ai: 'chase',
            });
        }
    }

    // --- Depth charges ---
    for (let i = g.depthCharges.length - 1; i >= 0; i--) {
        const dc = g.depthCharges[i];
        dc.timer -= dt;
        if (dc.timer <= 0) {
            // Explode
            for (const e of g.enemies) {
                if (dist(dc, e) < dc.aoe) damageEnemy(g, e, dc.dmg);
            }
            g.effects.push({ type: 'explosion', x: dc.x, y: dc.y, radius: 0, maxRadius: dc.aoe, life: 0.3 });
            sfxExplosion();
            g.depthCharges.splice(i, 1);
        }
    }

    // --- Lures ---
    for (let i = g.lures.length - 1; i >= 0; i--) {
        const lu = g.lures[i];
        lu.timer -= dt;
        lu.pulse += dt * 4;
        // Attract nearby enemies
        for (const e of g.enemies) {
            const d = dist(lu, e);
            if (d < 150) {
                const a2 = Math.atan2(lu.y - e.y, lu.x - e.x);
                e.x += Math.cos(a2) * 60 * dt;
                e.y += Math.sin(a2) * 60 * dt;
            }
        }
        // FALSE CHORUS — the beacon sings damaging mini-pings while it lives
        if (lu.chorus) {
            lu._chorusT = (lu._chorusT || 0.4) - dt;
            if (lu._chorusT <= 0) {
                lu._chorusT = 0.8;
                g.effects.push({ type: 'sonar_ring', x: lu.x, y: lu.y, radius: 0, maxRadius: lu.aoe, dmg: lu.dmg, speed: 300, hit: new Set() });
                playTone(520, 0.1, 'sine', 0.05);
            }
        }
        // GALVANIC BAIT — cooks everything it attracts, continuously
        if (lu.dot) {
            for (const e of g.enemies) { if (dist(lu, e) < lu.aoe) damageEnemy(g, e, lu.dmg * dt * 2.5); }
        }
        if (lu.timer <= 0) {
            // Chorus/galvanic baits sing or cook out — they never detonate
            if (lu.chorus || lu.dot) {
                g.effects.push({ type: 'explosion', x: lu.x, y: lu.y, radius: 0, maxRadius: 30, life: 0.2 });
                g.lures.splice(i, 1);
                continue;
            }
            // Siren's Call — bigger AoE + cinematic shockwave
            const finalAoe = lu.siren ? lu.aoe * 1.6 : lu.aoe;
            for (const e of g.enemies) {
                if (dist(lu, e) < finalAoe) damageEnemy(g, e, lu.dmg * (lu.siren ? 1.4 : 1));
            }
            g.effects.push({ type: 'explosion', x: lu.x, y: lu.y, radius: 0, maxRadius: finalAoe, life: 0.5 });
            if (lu.siren) {
                g.effects.push({ type: 'sonar_ring', x: lu.x, y: lu.y, radius: 0, maxRadius: finalAoe * 1.4, dmg: lu.dmg * 0.4, speed: 600, hit: new Set() });
                sfxTsunami(); g.shake = 6;
            } else {
                sfxExplosion();
            }
            g.lures.splice(i, 1);
        }
    }

    // --- Gems --- gem also dies if we descend too far past where it dropped
    const GEM_DEPTH_RANGE = 25;     // gem fades out 25m below where it dropped
    for (let i = g.gems.length - 1; i >= 0; i--) {
        const gem = g.gems[i];
        gem.life -= dt;
        const dz = (g.depth || 0) - (gem.dropDepth || 0);
        if (gem.life <= 0 || dz > GEM_DEPTH_RANGE) { g.gems.splice(i, 1); continue; }
        const d = dist(p, gem);
        // Darkness costs: below 1000m with floodlights off, the magnet halves —
        // stealth now has a price tag on farming (the missing trade).
        const gemMag = (g.lightOn === false && g.depth > 1000) ? p.magnetRange * 0.5 : p.magnetRange;
        if (d < gemMag) {
            const a = Math.atan2(p.y - gem.y, p.x - gem.x);
            const pullSpeed = 300 * (1 - d / gemMag);
            gem.x += Math.cos(a) * pullSpeed * dt;
            gem.y += Math.sin(a) * pullSpeed * dt;
        }
        if (d < 15) {
            // Corrupted MIND misprices what it sees — gems read low past 60
            const mindMult = (p.corruption || 0) >= 60 ? 0.75 : 1;
            const xpGain = Math.floor(gem.value * p.xpMult * mindMult);
            p.xp += xpGain;
            g.gemsCollected++;
            sfxCollect();
            // Tier-specific bonuses
            if (gem.special === 'heal') {
                const healAmt = Math.floor(p.maxHp * 0.15);
                p.hp = Math.min(p.maxHp, p.hp + healAmt);
                g.floatingTexts.push({ x: gem.x, y: gem.y - 18, text: `+${healAmt} HULL`, color: '#FFD040', life: 1.4, vy: -28 });
            } else if (gem.special === 'magnet') {
                // Brief magnet pulse — pulls every gem on screen toward player
                for (const og of g.gems) {
                    if (og === gem) continue;
                    const ogA = Math.atan2(p.y - og.y, p.x - og.x);
                    og.x += Math.cos(ogA) * 60;
                    og.y += Math.sin(ogA) * 60;
                }
            }
            // Bigger floating XP text for higher tiers
            if (gem.tier >= 2) {
                g.floatingTexts.push({ x: gem.x, y: gem.y - 6, text: `+${xpGain} XP`, color: gem.color, life: 1.0, vy: -32 });
            }
            g.gems.splice(i, 1);
            while (p.xp >= xpForLevel(p.level)) {
                p.xp -= xpForLevel(p.level);
                p.level++;
                triggerLevelUp(g);
                return;
            }
        }
    }

    // --- Loot items — magnet pickup, depth fade, add to inventory ---
    const LOOT_DEPTH_RANGE = 30;
    for (let i = g.lootItems.length - 1; i >= 0; i--) {
        const li = g.lootItems[i];
        li.life -= dt;
        const dz = (g.depth || 0) - (li.dropDepth || 0);
        if (li.life <= 0 || dz > LOOT_DEPTH_RANGE) { g.lootItems.splice(i, 1); continue; }
        const d = dist(p, li);
        const magnetR = p.magnetRange * 0.8;     // slightly shorter magnet for loot
        if (d < magnetR) {
            const a = Math.atan2(p.y - li.y, p.x - li.x);
            const pullSpeed = 240 * (1 - d / magnetR);
            li.x += Math.cos(a) * pullSpeed * dt;
            li.y += Math.sin(a) * pullSpeed * dt;
        }
        if (d < 18) {
            // Add to inventory if room (cap 12)
            if (g.inventory.length < 50) {
                g.inventory.push({ ...li.type, depth: g.depth });
                g.floatingTexts.push({ x: li.x, y: li.y - 12, text: '+' + li.type.name, color: li.type.color, life: 1.2, vy: -28 });
                sfxCollect();
            } else {
                g.floatingTexts.push({ x: li.x, y: li.y - 12, text: 'INVENTORY FULL', color: '#DA4060', life: 1.0, vy: -28 });
            }
            g.lootItems.splice(i, 1);
        }
    }

    // --- Floating texts ---
    for (let i = g.floatingTexts.length - 1; i >= 0; i--) {
        const ft = g.floatingTexts[i];
        ft.y += ft.vy * dt;
        ft.life -= dt;
        if (ft.life <= 0) g.floatingTexts.splice(i, 1);
    }

    // --- Combo timer ---
    if (g.comboTimer > 0) {
        g.comboTimer -= dt;
        if (g.comboTimer <= 0) g.combo = 0;
    }
    if (g.streakTimer > 0) g.streakTimer -= dt;
    if (g.modeMsgTimer > 0) g.modeMsgTimer -= dt;

    // --- CORRUPTION (depth-gated; pilot stays sharp until the alien deep) ---
    // Pre-Midnight (1000m): zero. NEREID is reliable in the lit ocean.
    // Twilight tail to Midnight: imperceptible drip.
    // Abyssal (2000–4000m): noticeable bleed.
    // Hadal (4000m+): the deep alien water world starts eating you.
    if (!p._noCorrupt) {
        let corruptRate = 0;
        const d = g.depth || 0;
        if (d > 1000 && d <= 2000) corruptRate = (d - 1000) / 1000 * 0.15;        // 0 → 0.15/s
        else if (d > 2000 && d <= 4000) corruptRate = 0.15 + (d - 2000) / 2000 * 0.45; // 0.15 → 0.6/s
        else if (d > 4000) corruptRate = 0.6 + Math.min(1.4, (d - 4000) / 2000);  // up to ~2.0/s in deep Hadal
        corruptRate *= (p._corruptResist || 1);
        if (g.stakes && g.stakes.has('crushing')) corruptRate *= 1.5;
        if (corruptRate > 0) p.corruption = Math.min(100, (p.corruption || 0) + corruptRate * dt);
        // NEREID corruption-tier dialogue triggers (60% → 80% → 100%). Fires once per tier.
        const prevTier = g._corrTier || 0;
        const curC = p.corruption;
        let newTier = prevTier;
        if (curC >= 100 && prevTier < 100) newTier = 100;
        else if (curC >= 80 && prevTier < 80) newTier = 80;
        else if (curC >= 60 && prevTier < 60) newTier = 60;
        if (newTier !== prevTier && NEREID.corruption && NEREID.corruption[newTier]) {
            const lines = NEREID.corruption[newTier];
            addNereidLog(g, lines[Math.floor(Math.random() * lines.length)]);
            g._corrTier = newTier;
        }
    }
    // Sync game.corruption for backward compat with draw code
    g.player.corruption = p.corruption || 0;

    // --- Hull Eater card ---
    if (g.player._hullEater) g.player.hp -= dt;

    // Touch ascend confirmation window decays
    if (g._ascendArm > 0) g._ascendArm -= dt;

    // RAM PROW — dashing through creatures hurts them (once per creature per dash)
    if (p._ramProw && p.dashTimer > 0) {
        for (const e of g.enemies) {
            if (e.ghost || e.hp <= 0 || e._ramHitT > g.runTime - 0.5) continue;
            if (dist(p, e) < e.size + 16) {
                e._ramHitT = g.runTime;
                damageEnemy(g, e, 30);
                const ka = Math.atan2(e.y - p.y, e.x - p.x);
                e.x += Math.cos(ka) * 30; e.y += Math.sin(ka) * 30;
            }
        }
    }

    // --- BATTERY drain — scales with depth (pressure-driven systems use more power) ---
    const depthFactor = 1 + Math.min(2, (g.depth || 0) / 3000);
    g.player.battery = Math.max(0, (g.player.battery || 100) - 0.35 * depthFactor * dt);
    // O2/POWER as the dive clock (Dave-style): low = warning, empty = the deep takes the hull.
    if (g.player.battery <= 0.5) {
        g.player.hp -= 4 * dt; // power out — life support failing; surface or die
        if (!g._o2Crit) { g._o2Crit = true; addNereidLog(g, 'Power gone. Life support failing — SURFACE, Pilot. Now.'); g.shake = Math.min(8, (g.shake || 0) + 3); }
    } else {
        g._o2Crit = false;
        if (g.player.battery <= 25 && !g._o2Warn) { g._o2Warn = true; addNereidLog(g, 'Reserve power under 25%. Scavenge charge from a kill — or start the climb (Z).'); }
        if (g.player.battery > 30) g._o2Warn = false;
    }
    // Hold-full pressure: salvage is left behind once the hold caps. Bank it by ascending.
    if (g.inventory.length >= 50) { if (!g._holdFullWarned) { g._holdFullWarned = true; addNereidLog(g, 'Hold full. Salvage now spills into the dark. Ascend (Z) to bank what we have.'); } }
    else g._holdFullWarned = false;

    // --- CRUSH DEPTH — past hull's rated depth, the trench eats the hull continuously ---
    const crushD = g.player._crushDepth || 3000;
    if (g.depth > crushD) {
        const over = Math.min(1, (g.depth - crushD) / 1500);
        const crushDmg = (0.5 + over * 3.5) * dt;
        g.player.hp -= crushDmg;
        if (!g._lastCrushCreak || g.runTime - g._lastCrushCreak > 4 - over * 2) {
            g._lastCrushCreak = g.runTime;
            if (audioCtx) playTone(35 + Math.random() * 15, 0.6, 'sawtooth', 0.04 + over * 0.03);
        }
    }
    // GLOBAL DEATH CHECK — any HP source dropping us to 0 triggers implosion (with defiance fallback)
    if (g.player.hp <= 0 && phase === 'playing') {
        if (g.player.deathDefiance > 0) {
            g.player.deathDefiance--;
            g.player.hp = g.player.maxHp * 0.5;
            g.player.iFrames = 2;
            g.shake = 12; g.flashTimer = 0.5;
            sfxRevive();
            g.floatingTexts.push({ x: g.player.x, y: g.player.y - 30, text: 'DEATH DEFIANCE', color: '#FFD040', life: 2, vy: -20 });
        } else {
            onDeath(g);
            return;
        }
    }
    if (g.player.hp < 0) g.player.hp = 0;

    // --- Berserker card (damage scales with missing HP) ---
    if (g.player._berserker) {
        const missingPct = 1 - g.player.hp / g.player.maxHp;
        g.player._berserkerMult = 1 + missingPct * 0.5;
    }

    // --- Depth damage card ---
    if (g.player._depthDmg) {
        g.player._depthDmgMult = 1 + (g.depth || 0) / 1000 * 0.03;
    }

    // --- Corruption damage at NEREID override ---
    if (g.player._corruptDmg) {
        g.player._corruptDmgMult = 1 + (g.player.corruption || 0) / 100 * 0.3;
    }

    // --- NEREID kill milestones ---
    const killLine = getNereidLine('kill', g);
    if (killLine && !g._lastKillMilestone !== g.kills) {
        addNereidLog(g, killLine);
        g._lastKillMilestone = g.kills;
    }

    // --- Mid-run events ---
    g.eventCooldown -= dt;
    if (g.eventCooldown <= 0 && !g.activeEvent) {
        const eligible = EVENT_DEFS.filter(e => g.wave >= e.minWave);
        if (eligible.length > 0) {
            const evt = eligible[Math.floor(Math.random() * eligible.length)];
            g.activeEvent = { ...evt, timer: 8 };
            g.eventCooldown = 80 + Math.random() * 40;
            addNereidLog(g, getNereidLine('event', g));
            phase = 'event';
        }
    }

    // --- DEPTH SYSTEM ---
    if (!g.ascending) {
        // Descending — non-linear free-fall (+ any depth forced on us, e.g. apex drag)
        const _t = g.runTime;
        g.depth = Math.floor(_t * 5.0 + Math.pow(_t, 1.4) * 0.05) + (g._depthOffset || 0);
        if (g.depth > (g.deepestDepth || 0)) g.deepestDepth = g.depth;
    } else {
        // Ascending — climb upward at a fixed-but-meaningful rate (~12 m/s)
        // Slightly faster than descent so the climb back is achievable
        g.depth = Math.max(0, g.depth - 12 * dt);
        if (g.depth <= 0 && phase === 'playing') {
            // SURFACED — bank everything, end run with full reward
            phase = 'mooring'; // surfaced alive — go to the Mooring hub (was: death screen)
            g._surfaced = true;
            if ((g.deepestDepth || 0) > 4000) meta.nereidDrift = (meta.nereidDrift || 0) + 1;   // the hadal leaves marks
            g._mooringLine = pickMooringBeat(g);
            // SIGNAL ⌁ — surfaced score distils at full rate
            g._signalEarned = Math.floor((g.score || 0) / 400);
            meta.signal = (meta.signal || 0) + g._signalEarned;
            if (g.daily === dayKeyUTC() && (!meta.dailyBest || meta.dailyBest.date !== g.daily || g.score > meta.dailyBest.score)) {
                meta.dailyBest = { date: g.daily, score: g.score || 0 };
            }
            // THE QUESTION — once, when the pilot has read deep enough and heard the Scar
            const l3Owned = LORE_FRAGMENTS.filter(f => f.layer === 3 && meta.loreFragments.includes(f.id)).length;
            if (!meta.ending && l3Owned >= 3 && meta.p3Unlocked) g._theQuestion = true;
            // Workshop salvage research — log a sample of each item before cashing.
            stockpileSalvage(g);
            // Cash in all inventory automatically
            let cashed = 0;
            for (const it of g.inventory) cashed += it.value;
            g.goldEarned += cashed;
            g._surfacedCash = cashed; g._surfacedDepth = g.deepestDepth || 0;
            g.inventory = [];
            if ((g.deepestDepth || 0) > (meta.deepestEver || 0)) meta.deepestEver = g.deepestDepth;
            if ((meta.deepestEver || 0) >= 2600 && !meta.p3Unlocked) meta.p3Unlocked = true;
            meta.totalRuns++;
            meta.totalKills += g.kills;
            meta.gold += g.goldEarned;
            if (g.runTime > meta.bestTime) meta.bestTime = g.runTime;
            if (g.deepestDepth > (meta.bestWave * 100 || 0)) meta.bestWave = Math.max(meta.bestWave || 0, g.wave);
            if (g.kills > meta.bestKills) meta.bestKills = g.kills;
            if (!meta.bestScore || g.score > meta.bestScore) meta.bestScore = g.score;
            // HULL — surface dives only chip the hull (player took care of it)
            const hpLoss = 1 - (g.player.hp / g.player.maxHp);
            const surfaceCost = Math.round(8 + hpLoss * 22);
            meta.hullCondition = Math.max(10, (meta.hullCondition || 100) - surfaceCost);
            saveMeta();
            sfxRevive();
            addNereidLog(g, 'SURFACE. We made it back. Take it all home, Pilot.');
            return;
        }
    }

    // --- BUBBLES (always rising — you're underwater) ---
    if (g.bubbles.length < 20 && Math.random() < 0.08) {
        g.bubbles.push({
            x: g.cam.x + (Math.random() - 0.5) * canvas.width / 1,
            y: g.cam.y + canvas.height / 2 + 50,
            size: 1 + Math.random() * 4, speed: 30 + Math.random() * 50,
            wobble: Math.random() * PI2, alpha: 0.1 + Math.random() * 0.15,
        });
    }
    for (let i = g.bubbles.length - 1; i >= 0; i--) {
        const b = g.bubbles[i];
        b.y -= b.speed * dt;
        b.x += Math.sin(b.wobble + g.runTime * 2) * 0.3;
        if (b.y < g.cam.y - canvas.height / 2 - 20) g.bubbles.splice(i, 1);
    }

    // --- MARINE SNOW (drifting down — depth feel, layered for parallax) ---
    const _snowCap = (isTouchDevice && Math.min(canvas.width, canvas.height) < 520) ? 45 : 90;
    if (g.marinSnow.length < _snowCap && Math.random() < 0.20) {
        const layer = Math.random(); // 0=far/small/slow, 1=near/big/fast
        g.marinSnow.push({
            x: g.cam.x + (Math.random() - 0.5) * canvas.width * 1.2,
            y: g.cam.y - canvas.height / 2 - 10,
            size: 0.4 + layer * 1.8 + Math.random() * 0.6,
            speed: 6 + layer * 18 + Math.random() * 10,
            drift: (Math.random() - 0.5) * 8,
            alpha: 0.18 + layer * 0.45,
            layer,
        });
    }
    for (let i = g.marinSnow.length - 1; i >= 0; i--) {
        const s = g.marinSnow[i];
        s.y += s.speed * dt;
        s.x += s.drift * dt;
        if (s.y > g.cam.y + canvas.height / 2 + 20) g.marinSnow.splice(i, 1);
    }

    // --- BIOLUMINESCENT FLICKERS (mid-distance pulsing dots — alive feeling) ---
    if (!g.bioFlickers) g.bioFlickers = [];
    if (g.bioFlickers.length < 12 && Math.random() < 0.04) {
        const a = Math.random() * PI2;
        const r = 200 + Math.random() * 380;
        const colorPick = Math.random();
        const color = colorPick < 0.5 ? '#80E0FF' : colorPick < 0.85 ? '#A0FFB0' : '#FFB0E8';
        g.bioFlickers.push({
            x: g.cam.x + Math.cos(a) * r,
            y: g.cam.y + Math.sin(a) * r,
            size: 1 + Math.random() * 2.5,
            color,
            phase: Math.random() * PI2,
            life: 2.5 + Math.random() * 4.5,
            pulseSpeed: 1.5 + Math.random() * 2.5,
            drift: (Math.random() - 0.5) * 6,
        });
    }
    for (let i = g.bioFlickers.length - 1; i >= 0; i--) {
        const f = g.bioFlickers[i];
        f.life -= dt;
        f.phase += f.pulseSpeed * dt;
        f.x += f.drift * dt;
        if (f.life <= 0) g.bioFlickers.splice(i, 1);
    }

    // --- ENVIRONMENTAL DEBRIS (submechanophobia — wrecks, chains, pipes) ---
    if (g.debris.length < 8 && Math.random() < 0.003 && g.depth > 200) {
        const types = ['pipe', 'chain', 'hull', 'girder', 'porthole', 'cable'];
        const depthMult = Math.min(3, g.depth / 1000);
        g.debris.push({
            x: g.cam.x + (Math.random() - 0.5) * canvas.width * 1.5,
            y: g.cam.y + (Math.random() - 0.5) * canvas.height * 1.5,
            type: types[Math.floor(Math.random() * types.length)],
            rot: Math.random() * PI2,
            scale: 0.5 + Math.random() * depthMult,
            alpha: 0.04 + Math.random() * 0.08,
            drift: (Math.random() - 0.5) * 3,
        });
    }
    for (let i = g.debris.length - 1; i >= 0; i--) {
        const d = g.debris[i];
        d.x += d.drift * dt;
        d.rot += 0.01 * dt;
        const dx = Math.abs(d.x - g.cam.x), dy = Math.abs(d.y - g.cam.y);
        if (dx > canvas.width || dy > canvas.height) g.debris.splice(i, 1);
    }

    // --- APEX PATROL — the thing you cannot kill ---
    updateApexPatrol(g, dt);

    // --- DISTANT SILHOUETTES (thalassophobia — massive shapes in the dark) ---
    const siloDepthOk = g.depth > 200;
    const siloMax = g.depth < 500 ? 2 : g.depth < 2000 ? 4 : 5;
    const siloRate = g.depth < 500 ? 0.003 : g.depth < 2000 ? 0.006 : 0.009;
    if (g.silhouettes.length < siloMax && Math.random() < siloRate && siloDepthOk) {
        const side = Math.random() < 0.5 ? -1 : 1;
        // Deeper = bigger, slower, more frequent dread-shapes
        const depthScale = Math.min(2.2, 1 + g.depth / 3000);
        g.silhouettes.push({
            x: g.cam.x + side * (canvas.width * 0.8),
            y: g.cam.y + (Math.random() - 0.5) * canvas.height * 0.7,
            vx: -side * (4 + Math.random() * 12) / depthScale,
            size: (70 + Math.random() * 220) * depthScale,
            alpha: 0.04 + Math.random() * 0.07,
            life: 9 + Math.random() * 14,
            shape: Math.floor(Math.random() * 4), // 0=whale 1=eel 2=blob 3=tendril
        });
    }
    for (let i = g.silhouettes.length - 1; i >= 0; i--) {
        const s = g.silhouettes[i];
        s.x += s.vx * dt;
        s.life -= dt;
        if (s.life <= 0) g.silhouettes.splice(i, 1);
    }

    // --- ZONE AMBIENCE EVENTS (one-time and recurring atmosphere beats) ---
    if (!g.ambient) g.ambient = { events: [], titanicSeen: false, lastWreckBeat: 0, lastFlashBeat: 0, lastCreak: 0 };

    // Titanic milestone — once when crossing ~3800m, drop a ghostly wreck silhouette and a NEREID line
    if (!g.ambient.titanicSeen && g.depth >= 3800) {
        g.ambient.titanicSeen = true;
        const side = Math.random() < 0.5 ? -1 : 1;
        g.silhouettes.push({
            x: g.cam.x + side * canvas.width * 0.5,
            y: g.cam.y + canvas.height * 0.15,
            vx: -side * 4,
            size: 360,
            alpha: 0.10,
            life: 22,
            shape: 0, // whale-ish — long mass
            wreck: true,
        });
        addNereidLog(g, 'Pilot... 3,800 metres. We are below the Titanic. Nothing built has ever stayed here.');
    }

    // Distant flashes — bioluminescent or otherwise. Frequency ramps with depth.
    const flashCadence = g.depth < 500 ? 9 : g.depth < 2000 ? 6 : 4;
    if (g.runTime - g.ambient.lastFlashBeat > flashCadence && Math.random() < 0.5) {
        g.ambient.lastFlashBeat = g.runTime;
        // Spawn a cluster of bioluminescent flickers in one off-center spot — a creature lighting up
        const a = Math.random() * PI2;
        const r = 280 + Math.random() * 250;
        const cx0 = g.cam.x + Math.cos(a) * r;
        const cy0 = g.cam.y + Math.sin(a) * r;
        const palette = g.depth < 1000 ? ['#80E0FF','#A0FFB0'] : g.depth < 3000 ? ['#A060FF','#80E0FF'] : ['#FF6080','#A060FF'];
        const cnt = 3 + Math.floor(Math.random() * 4);
        for (let fi = 0; fi < cnt; fi++) {
            const offA = Math.random() * PI2, offR = Math.random() * 35;
            g.bioFlickers.push({
                x: cx0 + Math.cos(offA) * offR, y: cy0 + Math.sin(offA) * offR,
                size: 1.2 + Math.random() * 2.2,
                color: palette[Math.floor(Math.random() * palette.length)],
                phase: Math.random() * PI2, life: 1.5 + Math.random() * 1.5,
                pulseSpeed: 3 + Math.random() * 3, drift: (Math.random() - 0.5) * 4,
            });
        }
    }

    // ABYSSAL FEEDING HOUR — every ~2 min past Midnight, enemies enter a 30s frenzy.
    // Damage taken doubled, but kill rewards doubled too. Predictable terror window.
    if (g.depth > 1000) {
        if (g._feedingHourEnd == null) g._feedingHourEnd = g.runTime + 120;
        if (g.runTime > g._feedingHourEnd && !g._feeding) {
            g._feeding = true;
            g._feedingHourEnd = g.runTime + 30;       // 30s active
            g.streak = 'ABYSSAL FEEDING HOUR'; g.streakTimer = 4;
            g.shake = 6; g.flashTimer = 0.4;
            addNereidLog(g, 'Pressure spike. Something woke them. Two minute window — feed or be fed.');
            if (audioCtx) {
                playTone(60, 1.2, 'sawtooth', 0.08);
                setTimeout(() => playTone(45, 1.4, 'sawtooth', 0.07), 400);
            }
        } else if (g.runTime > g._feedingHourEnd && g._feeding) {
            g._feeding = false;
            g._feedingHourEnd = g.runTime + 90 + Math.random() * 60;
            addNereidLog(g, 'Feeding hour ends. They settle. For now.');
        }
    }

    // Pressure creak SFX past Midnight
    const _crush = g.player._crushDepth || 3000;
    const _stress = Math.max(0, Math.min(1, (g.depth - _crush * 0.8) / (_crush * 0.25)));
    if (g.depth > 1000 && g.runTime - g.ambient.lastCreak > (18 - 13 * _stress) + Math.random() * (14 - 9 * _stress)) {
        g.ambient.lastCreak = g.runTime;
        if (audioCtx) {
            const freq = Math.max(28, 55 - g.depth / 120);
            playTone(freq, 1.1, 'sawtooth', 0.05);
            setTimeout(() => playTone(freq * 0.8, 0.8, 'sawtooth', 0.04), 250);
        }
    }

    // GHOST CREW — past 4000m, comms pick up impossible voices
    if (g.depth > 4000 && (!g.ambient.lastGhost || g.runTime - g.ambient.lastGhost > 35)) {
        if (Math.random() < 0.12) {
            g.ambient.lastGhost = g.runTime;
            const ghostLines = [
                'UNKNOWN COMMS: "...is anyone reading? this is DSV—"',
                'UNKNOWN COMMS: "...we made it down. don\'t come down. DON\'T—"',
                'UNKNOWN COMMS: "... pilot? pilot is that you again? it\'s me—"',
                'UNKNOWN COMMS: "...the trench is breathing. it knows our nam—"',
                'UNKNOWN COMMS: "...stop pinging. they hear it. they\'re already he—"',
                'UNKNOWN COMMS: [static] [static] [static] [static] HELP',
            ];
            addNereidLog(g, ghostLines[Math.floor(Math.random() * ghostLines.length)]);
            // NEREID denies it shortly after
            setTimeout(() => {
                if (game) addNereidLog(game, 'NEREID: I detect no transmission, Pilot. Disregard.');
            }, 5000);
            if (audioCtx) playTone(80, 0.4, 'sawtooth', 0.03);
        }
    }

    // DISTANT LEVIATHAN HUMS — sub-bass pulses from off-screen, increase with depth
    if (g.depth > 1500 && (!g.ambient.lastHum || g.runTime - g.ambient.lastHum > 12)) {
        if (Math.random() < 0.22) {
            g.ambient.lastHum = g.runTime;
            if (audioCtx) {
                const f = 22 + Math.random() * 16 - g.depth / 400;
                playTone(Math.max(15, f), 2.2, 'sine', 0.045);
                setTimeout(() => playTone(Math.max(13, f * 0.85), 1.6, 'sine', 0.03), 600);
            }
        }
    }
}

function onDeath(g) {
    sfxDeath();
    phase = 'death';
    // Stats that survive across DSVs (achievement-style)
    if ((g.deepestDepth || 0) > (meta.deepestEver || 0)) meta.deepestEver = g.deepestDepth;
    if ((meta.deepestEver || 0) >= 2600 && !meta.p3Unlocked) meta.p3Unlocked = true;
    // SIGNAL ⌁ — the trench heard the run even if the pilot didn't come back; half rate
    g._signalEarned = Math.floor((g.score || 0) / 800);
    meta.signal = (meta.signal || 0) + g._signalEarned;
    if (g.daily === dayKeyUTC() && (!meta.dailyBest || meta.dailyBest.date !== g.daily || g.score > meta.dailyBest.score)) {
        meta.dailyBest = { date: g.daily, score: g.score || 0 };
    }
    meta.totalRuns++;
    meta.totalKills += g.kills;
    if (g.runTime > meta.bestTime) meta.bestTime = g.runTime;
    if (g.wave > meta.bestWave) meta.bestWave = g.wave;
    if (g.kills > meta.bestKills) meta.bestKills = g.kills;
    if (!meta.bestScore || g.score > meta.bestScore) meta.bestScore = g.score;
    // Workshop salvage research — log a sample of unsold loot. Survives DSV wipe (lives in meta.materials).
    stockpileSalvage(g);
    // FULL LIFE WIPE — gold, paid upgrades, codex, hull all reset. Pilot starts fresh in new DSV.
    wipeDsvLife();
    // If a leviathan claimed us, increment its kill-count permanently
    if (g._lastAttackerIsBoss && g._lastAttackerTypeId && LEVIATHAN_LORE[g._lastAttackerTypeId] && meta.leviathanDeaths) {
        meta.leviathanDeaths[g._lastAttackerTypeId] = (meta.leviathanDeaths[g._lastAttackerTypeId] || 0) + 1;
    }
    // Check character unlocks
    for (const [id, ch] of Object.entries(CHARACTERS)) {
        if (!meta.unlocked.includes(id) && ch.unlockReq && ch.unlockReq(meta)) {
            meta.unlocked.push(id);
        }
    }
    saveMeta();
    stopHeartbeat();
}

// --- Drawing ---
function isPortraitPhone() { return canvas.width < 560 && canvas.height > canvas.width; }
function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    tapZones.length = 0;   // rebuilt each frame by whichever screen draws

    // LANDSCAPE ONLY on phones (Vish's call, 12/07) — the trench is wide.
    if (isPortraitPhone()) {
        ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
        const t = performance.now() * 0.001;
        ctx.save(); ctx.translate(w / 2, h / 2 - 30); ctx.rotate(Math.PI / 2 * (0.5 + Math.sin(t * 2) * 0.5));
        ctx.strokeStyle = '#5ADFCF'; ctx.lineWidth = 3;
        ctx.strokeRect(-22, -40, 44, 80);
        ctx.fillStyle = '#5ADFCF'; ctx.beginPath(); ctx.arc(0, 30, 3, 0, PI2); ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
        ctx.fillText('ROTATE TO LANDSCAPE', w / 2, h / 2 + 70);
        ctx.fillStyle = '#5A6A7A'; ctx.font = '11px monospace';
        ctx.fillText('the trench is wide', w / 2, h / 2 + 90);
        return;
    }

    // Full-screen menus were laid out for a desktop canvas — on narrow screens
    // render them into a 720-wide virtual space scaled to fit. Tap zones are
    // registered in virtual coordinates; hitTapZone divides by MENU_S.
    const MENU_DRAWS = {
        title: drawTitle, intro: drawIntro, shop: drawShop, workshop: drawWorkshop,
        modules: drawModules, contracts: drawContracts, puzzle: drawPuzzle, patch: drawPatch,
        cards: drawCardDraft, codex: drawCodex, tutorial: drawTutorial,
    };
    // Round 4/5: title + card draft + contracts get REAL mobile layouts — the
    // scale-to-fit shrink (h/760 ≈ 0.5 on a landscape phone) made them
    // legible-at-arm's-length tiny. Other menus keep scale-to-fit for now.
    if (touchUI() && Math.min(w, h) < 520 && (phase === 'title' || phase === 'cards' || phase === 'contracts')) {
        MENU_S = 1;
        if (phase === 'title') drawTitleMobile(w, h);
        else if (phase === 'cards') drawCardDraftMobile(w, h);
        else drawContractsMobile(w, h);
        return;
    }
    if (MENU_DRAWS[phase] || phase === 'mooring') {
        // Width AND height matter: landscape phones are short, not narrow
        MENU_S = Math.min(1, w / 720, h / 760);
        if (MENU_S < 1) { ctx.save(); ctx.scale(MENU_S, MENU_S); }
        if (phase === 'mooring') drawMooring(w / MENU_S, h / MENU_S, game);
        else MENU_DRAWS[phase](w / MENU_S, h / MENU_S);
        if (MENU_S < 1) ctx.restore();
        return;
    }
    MENU_S = 1;
    // Feature 1: Pause screen renders game + overlay
    // (falls through to game rendering below, then overlay added at end)

    const g = game;
    if (!g) return;

    // Depth palette (used by everything)
    const pal = getDepthPalette(g.depth || 0);

    // --- VIEWPORT — desktop gets the circular porthole; small screens go
    // FULL-BLEED (the porthole is a desktop aesthetic — on a phone it wasted
    // half the pixels and squashed the game into a small circle). Full-bleed
    // keeps all the porthole math but the circle covers every corner.
    const small = w < 520 || h < 560;
    // Desktop porthole enlarged 12/07 (Vish: "make viewport bigger") — tighter
    // margins; NEREID panel still clears below.
    const NEREID_GAP = 96;
    const TOP_GAP    = 40;
    const vpCx = w / 2;
    const vpCy = h / 2;
    const vpRadius = small
        ? Math.hypot(w, h) / 2 + 12
        : Math.max(200, Math.min(w / 2 - 44, h / 2 - Math.max(TOP_GAP, NEREID_GAP)));
    g._vpCx = vpCx; g._vpCy = vpCy; g._vpR = vpRadius;
    g._fullBleed = small;

    // Camera: center the world on the porthole center
    const cx = g.cam.x - vpCx + (g.shake ? (Math.random() - 0.5) * g.shake : 0);
    const cy = g.cam.y - vpCy + (g.shake ? (Math.random() - 0.5) * g.shake : 0);

    // ===== LAYOUT: top = lore/info, viewport = center, bottom = gameplay bars =====
    const p = g.player;
    const sanity = 100 - (p.corruption || 0);

    // Hull metal background
    ctx.fillStyle = '#060810';
    ctx.fillRect(0, 0, w, h);

    // Porthole bezel + bolts — desktop only; full-bleed has no rim to decorate
    if (!small) {
        ctx.strokeStyle = '#101C24'; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(vpCx, vpCy, vpRadius + 4, 0, PI2); ctx.stroke();
        ctx.strokeStyle = hexA(pal.accentDim, 0.3); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(vpCx, vpCy, vpRadius + 1, 0, PI2); ctx.stroke();

        // 12 bolts around the porthole rim — same count as the sub's hull rivets
        const BOLT_COUNT = 12;
        const boltR = vpRadius + 4;     // sit on the bezel centerline
        for (let bi = 0; bi < BOLT_COUNT; bi++) {
            const ba = (bi / BOLT_COUNT) * PI2 - Math.PI / 2;     // start at top (12 o'clock), go clockwise
            const bx = vpCx + Math.cos(ba) * boltR;
            const by = vpCy + Math.sin(ba) * boltR;
            // Bolt head — dark ring + inner highlight
            ctx.fillStyle = '#1A2530';
            ctx.beginPath(); ctx.arc(bx, by, 3.2, 0, PI2); ctx.fill();
            ctx.fillStyle = '#3A5A6A';
            ctx.beginPath(); ctx.arc(bx, by, 2.2, 0, PI2); ctx.fill();
            // Hex slot (two perpendicular notches for that machined look)
            ctx.strokeStyle = '#0A1018'; ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(bx - 1.4, by); ctx.lineTo(bx + 1.4, by);
            ctx.stroke();
        }
    }

    // (No top bar. Depth and all other readouts handled in drawMinimalHUD.)

    // Clip to circular porthole for all game rendering
    ctx.save();
    ctx.beginPath(); ctx.arc(vpCx, vpCy, vpRadius, 0, PI2); ctx.clip();
    // PHONE ZOOM — 1:1 world scale is ant-sized on a hand-span screen. Zoom the
    // world about the view centre; the clip's save/restore pops it with the clip.
    // (Touch aim is nearest-enemy, so no pointer math needs the inverse.)
    // Round-4 verdict: 1.35 was too much. Auto 1.15/1.1, overridable via [V]
    // (cycles 1.0 / 1.15 / 1.3, persists in meta.worldZoom; null = auto).
    const autoZ = Math.min(w, h) < 480 ? 1.15 : 1.1;
    const WORLD_Z = small ? (meta.worldZoom || autoZ) : 1;
    g._worldZ = WORLD_Z;
    if (WORLD_Z !== 1) { ctx.translate(vpCx, vpCy); ctx.scale(WORLD_Z, WORLD_Z); ctx.translate(-vpCx, -vpCy); }

    // --- Ocean background (depth-based color shift) ---
    const darkProgress = Math.min(1, g.runTime / 1200);
    const depthPct = Math.min(1, g.depth / 6000);
    // Sunlight zone (0-200m): blue-green → Twilight (200-1000m): deep blue → Midnight (1000+): near black
    let bgR, bgG, bgB;
    // Background: deep ocean teal → midnight blue → abyss black
    // Readable at shallow, moody at depth, never harsh
    if (g.depth < 200) {
        const t2 = g.depth / 200;
        bgR = Math.floor(4 + 3 * (1 - t2));
        bgG = Math.floor(14 + 10 * (1 - t2));
        bgB = Math.floor(28 + 14 * (1 - t2));
    } else if (g.depth < 1000) {
        const t2 = (g.depth - 200) / 800;
        bgR = Math.floor(4 * (1 - t2 * 0.7));
        bgG = Math.floor(14 * (1 - t2 * 0.6));
        bgB = Math.floor(28 * (1 - t2 * 0.4));
    } else {
        const t2 = Math.min(1, (g.depth - 1000) / 4000);
        bgR = Math.floor(1 * (1 - t2));
        bgG = Math.floor(6 * (1 - t2));
        bgB = Math.floor(17 * (1 - t2));
    }
    // Pelagos-3: dead water — the living teal drains toward rust-green murk
    if (g.moon === 'p3') {
        const oldG = bgG;
        bgG = Math.min(255, Math.floor(oldG * 1.35 + 2));
        bgR = Math.min(255, Math.floor(bgR * 1.6 + oldG * 0.4));
        bgB = Math.floor(bgB * 0.55);
    }
    ctx.fillStyle = `rgb(${bgR},${bgG},${bgB})`;
    ctx.fillRect(0, 0, w, h);

    // Depth zone label (flashes when crossing thresholds)
    const zones = g.moon === 'p3' ? [
        { depth: 0, name: 'FLOODLIGHT SHELF', color: '#A8B888' },
        { depth: 200, name: 'TURBINE FIELD', color: '#8A9878' },
        { depth: 1000, name: 'FOUNDRY DEEP', color: '#B87848' },
        { depth: 2000, name: 'REACTOR SHADOW', color: '#C85838' },
        { depth: 4000, name: 'THE SCAR', color: '#FF4020' },
    ] : [
        { depth: 0, name: 'SUNLIGHT ZONE', color: '#5ADFCF' },
        { depth: 200, name: 'TWILIGHT ZONE', color: '#4A8ADA' },
        { depth: 1000, name: 'MIDNIGHT ZONE', color: '#6A4ADA' },
        { depth: 2000, name: 'ABYSSAL ZONE', color: '#DA4A4A' },
        { depth: 4000, name: 'HADAL ZONE', color: '#FF2020' },
    ];
    if (!g._lastZone) g._lastZone = 0;
    for (const z of zones) {
        if (g.depth >= z.depth && g._lastZone < z.depth) {
            g.streak = z.name; g.streakTimer = 3.2;
            g._streakBig = true; g._streakColor = z.color;
            if (audioCtx) playTone(70, 0.5, 'sine', 0.06);
            g._lastZone = z.depth;
        }
    }

    // Grid (subtle)
    ctx.strokeStyle = `rgba(20,45,60,${0.12 * (1 - darkProgress * 0.5)})`;
    ctx.lineWidth = 1;
    const gridSize = 100;
    const startX = Math.floor(cx / gridSize) * gridSize;
    const startY = Math.floor(cy / gridSize) * gridSize;
    for (let gx = startX; gx < cx + w + gridSize; gx += gridSize) {
        ctx.beginPath(); ctx.moveTo(gx - cx, 0); ctx.lineTo(gx - cx, h); ctx.stroke();
    }
    for (let gy = startY; gy < cy + h + gridSize; gy += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, gy - cy); ctx.lineTo(w, gy - cy); ctx.stroke();
    }

    // --- DISTANT SILHOUETTES (thalassophobia — renders behind everything) ---
    for (const s of g.silhouettes) {
        const sx = s.x - cx, sy = s.y - cy;
        ctx.globalAlpha = s.alpha * Math.min(1, s.life);
        ctx.fillStyle = '#000';
        ctx.save();
        ctx.translate(sx, sy);
        if (s.shape === 0) {
            // Whale-like — elongated ellipse with tail
            ctx.beginPath();
            ctx.ellipse(0, 0, s.size, s.size * 0.3, 0, 0, PI2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-s.size, 0);
            ctx.lineTo(-s.size * 1.3, -s.size * 0.25);
            ctx.lineTo(-s.size * 1.3, s.size * 0.25);
            ctx.closePath();
            ctx.fill();
        } else if (s.shape === 1) {
            // Eel — sinuous line
            ctx.lineWidth = s.size * 0.15;
            ctx.strokeStyle = `rgba(0,0,0,${s.alpha})`;
            ctx.beginPath();
            ctx.moveTo(-s.size, 0);
            for (let j = 0; j < 8; j++) {
                const t = j / 8;
                ctx.lineTo(-s.size + t * s.size * 2, Math.sin(t * 4 + g.runTime * 0.5) * s.size * 0.2);
            }
            ctx.stroke();
        } else if (s.shape === 2) {
            // Amorphous blob — overlapping circles
            for (let j = 0; j < 4; j++) {
                const ox = Math.sin(j * 1.7) * s.size * 0.3;
                const oy = Math.cos(j * 2.3) * s.size * 0.2;
                ctx.beginPath();
                ctx.arc(ox, oy, s.size * (0.3 + j * 0.05), 0, PI2);
                ctx.fill();
            }
        } else {
            // Tendril cluster — multiple drifting strands trailing from a body
            ctx.beginPath();
            ctx.ellipse(0, 0, s.size * 0.4, s.size * 0.32, 0, 0, PI2);
            ctx.fill();
            ctx.lineWidth = s.size * 0.06;
            ctx.strokeStyle = `rgba(0,0,0,${s.alpha})`;
            for (let tr = 0; tr < 5; tr++) {
                const baseA = (tr / 5) * Math.PI - Math.PI / 2;
                ctx.beginPath();
                ctx.moveTo(Math.cos(baseA) * s.size * 0.3, Math.sin(baseA) * s.size * 0.3);
                for (let seg = 1; seg <= 6; seg++) {
                    const t = seg / 6;
                    const wob = Math.sin(t * 5 + g.runTime * 0.4 + tr) * s.size * 0.15;
                    const sx2 = Math.cos(baseA) * (s.size * 0.3 + t * s.size * 0.9) + wob;
                    const sy2 = Math.sin(baseA) * (s.size * 0.3 + t * s.size * 0.9);
                    ctx.lineTo(sx2, sy2);
                }
                ctx.stroke();
            }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // --- ENVIRONMENTAL DEBRIS (submechanophobia) ---
    for (const d of g.debris) {
        const sx = d.x - cx, sy = d.y - cy;
        ctx.globalAlpha = d.alpha;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(d.rot);
        const sc = d.scale;
        ctx.strokeStyle = '#3a4a5a';
        ctx.fillStyle = '#1a2a3a';
        ctx.lineWidth = 1;
        if (d.type === 'pipe') {
            ctx.fillRect(-40 * sc, -4 * sc, 80 * sc, 8 * sc);
            ctx.strokeRect(-40 * sc, -4 * sc, 80 * sc, 8 * sc);
            // Flange
            ctx.fillRect(-42 * sc, -6 * sc, 4 * sc, 12 * sc);
            ctx.fillRect(38 * sc, -6 * sc, 4 * sc, 12 * sc);
        } else if (d.type === 'chain') {
            for (let j = 0; j < 6; j++) {
                ctx.strokeStyle = '#4a5a6a';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.ellipse(j * 12 * sc - 30 * sc, 0, 5 * sc, 8 * sc, j % 2 ? 0.3 : -0.3, 0, PI2);
                ctx.stroke();
            }
        } else if (d.type === 'hull') {
            // Torn hull plate
            ctx.beginPath();
            ctx.moveTo(-30 * sc, -20 * sc);
            ctx.lineTo(25 * sc, -18 * sc);
            ctx.lineTo(30 * sc, 15 * sc);
            ctx.lineTo(-20 * sc, 22 * sc);
            ctx.closePath();
            ctx.fill(); ctx.stroke();
            // Rivets
            ctx.fillStyle = '#2a3a4a';
            for (let j = 0; j < 4; j++) {
                ctx.beginPath();
                ctx.arc(-15 * sc + j * 12 * sc, -12 * sc, 1.5 * sc, 0, PI2);
                ctx.fill();
            }
        } else if (d.type === 'girder') {
            ctx.fillRect(-35 * sc, -3 * sc, 70 * sc, 6 * sc);
            ctx.strokeRect(-35 * sc, -3 * sc, 70 * sc, 6 * sc);
            // Cross-bracing
            for (let j = 0; j < 5; j++) {
                ctx.beginPath();
                ctx.moveTo(-30 * sc + j * 14 * sc, -3 * sc);
                ctx.lineTo(-23 * sc + j * 14 * sc, 3 * sc);
                ctx.stroke();
            }
        } else if (d.type === 'porthole') {
            // Circular window frame — submechanophobia trigger
            ctx.strokeStyle = '#5a6a7a';
            ctx.lineWidth = 3 * sc;
            ctx.beginPath();
            ctx.arc(0, 0, 15 * sc, 0, PI2);
            ctx.stroke();
            ctx.fillStyle = '#0a0a15';
            ctx.beginPath();
            ctx.arc(0, 0, 12 * sc, 0, PI2);
            ctx.fill();
            // Bolts
            for (let j = 0; j < 6; j++) {
                const ba = (j / 6) * PI2;
                ctx.fillStyle = '#4a5a6a';
                ctx.beginPath();
                ctx.arc(Math.cos(ba) * 15 * sc, Math.sin(ba) * 15 * sc, 1.5 * sc, 0, PI2);
                ctx.fill();
            }
        } else {
            // Cable — wavy line
            ctx.strokeStyle = '#3a4a5a';
            ctx.lineWidth = 2 * sc;
            ctx.beginPath();
            ctx.moveTo(-30 * sc, 0);
            for (let j = 0; j < 8; j++) {
                ctx.lineTo(-30 * sc + j * 8 * sc, Math.sin(j * 1.2 + d.rot) * 6 * sc);
            }
            ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // (World bounds walls drawn AFTER everything so they cover out-of-bounds content — see drawWorldBoundsWalls)

    // --- OBSTACLES (rocks, kelp, vents, alien growths) — 3D depth fade + topo contour rings ---
    for (const ob of (g.obstacles || [])) {
        const dz = (ob.obDepth || 0) - g.depth;
        const range = 35;
        const absDz = Math.abs(dz);
        if (absDz > range) continue;
        const proximity = 1 - absDz / range;
        const fadeAlpha = dz >= 0 ? proximity : Math.pow(proximity, 1.5);
        const scaleK = 0.45 + proximity * 0.55;
        const sx = ob.x - cx, sy = ob.y - cy;
        if (sx < -ob.r * scaleK - 20 || sx > w + ob.r * scaleK + 20 || sy < -ob.r * scaleK - 20 || sy > h + ob.r * scaleK + 20) continue;
        // TOPOGRAPHIC CONTOUR LINES — concentric rings around solid features (rocks, vents, organic, crystal)
        // Rings tighten with proximity; faint while distant, sharp when close.
        if (ob.kind === 'rock' || ob.kind === 'spire' || ob.kind === 'vent' || ob.kind === 'organic' || ob.kind === 'crystal' || ob.kind === 'bones' || ob.kind === 'chitin' || ob.kind === 'monolith' || ob.kind === 'debris') {
            const ringR = ob.r * scaleK;
            ctx.strokeStyle = `rgba(120,160,180,${0.10 + proximity * 0.18})`;
            ctx.lineWidth = 0.7;
            for (let ri = 1; ri <= 3; ri++) {
                ctx.beginPath();
                ctx.arc(sx, sy, ringR + ri * 8, 0, PI2);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = fadeAlpha;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(scaleK, scaleK);
        drawObstacle(0, 0, ob);
        ctx.restore();
        ctx.globalAlpha = 1;
    }
    drawVolumes(g);
    drawDeployables(g);

    // --- SPECIAL EVENTS (whale falls, vents) — depth-fade like obstacles ---
    if (g.specialEvents) {
        for (const ev of g.specialEvents) {
            const dz = (ev.obDepth || 0) - g.depth;
            const range = 35;
            if (Math.abs(dz) > range) continue;
            const proximity = 1 - Math.abs(dz) / range;
            const fadeAlpha = dz >= 0 ? proximity : Math.pow(proximity, 1.5);
            const sx = ev.x - cx, sy = ev.y - cy;
            ctx.globalAlpha = fadeAlpha;
            if (ev.kind === 'triangulation' && !ev.looted) {
                // Three tripod beacons; each pulses a ring out to exactly its distance
                // from the buried signal — where the three rings kiss, dig.
                const tt2 = performance.now() * 0.001;
                ev.beacons.forEach((b, bi) => {
                    const bx2 = b.x - cx, by2 = b.y - cy;
                    // Beacon body — small tripod + blinking head
                    ctx.strokeStyle = '#4A6A7A'; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(bx2 - 6, by2 + 8); ctx.lineTo(bx2, by2 - 8); ctx.lineTo(bx2 + 6, by2 + 8); ctx.stroke();
                    if ((tt2 + bi * 0.4) % 1.2 < 0.15) drawGlow(ctx, '#8FE0C8', bx2, by2 - 10, 8, 0.9);
                    // Travelling pulse ring: expands 0 → dist, then restarts
                    const frac = (tt2 * 0.35 + bi / 3) % 1;
                    ctx.strokeStyle = `rgba(140,220,200,${0.5 * (1 - frac)})`;
                    ctx.lineWidth = 1.4;
                    ctx.beginPath(); ctx.arc(bx2, by2, b.dist * frac, 0, PI2); ctx.stroke();
                    // Faint resting ring at the true distance — the answer, for careful eyes
                    ctx.strokeStyle = 'rgba(140,220,200,0.10)';
                    ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.arc(bx2, by2, b.dist, 0, PI2); ctx.stroke();
                });
                // The signal itself stays invisible until you're nearly on it
                const pd2 = Math.hypot(g.player.x - ev.x, g.player.y - ev.y);
                if (pd2 < 90) {
                    const shimmer = 0.25 + Math.sin(tt2 * 6) * 0.15;
                    drawGlow(ctx, '#B0A0E8', sx, sy, 14, shimmer * (1 - pd2 / 90 + 0.3));
                }
            }
            if (ev.kind === 'whalefall') {
                // Long pale skeletal mass
                ctx.fillStyle = '#1A2025';
                ctx.beginPath(); ctx.ellipse(sx, sy, ev.r, ev.r * 0.4, Math.sin(ev.life * 0.05) * 0.3, 0, PI2); ctx.fill();
                // Ribs (white arcs)
                ctx.strokeStyle = '#A0A8B0'; ctx.lineWidth = 2;
                for (let ri = -3; ri <= 3; ri++) {
                    ctx.beginPath();
                    ctx.arc(sx + ri * 14, sy, 16, Math.PI, 0);
                    ctx.stroke();
                }
                // Spine
                ctx.strokeStyle = '#7A8088'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(sx - ev.r * 0.9, sy); ctx.lineTo(sx + ev.r * 0.9, sy); ctx.stroke();
                // Skull
                ctx.fillStyle = '#A0A8B0';
                ctx.beginPath(); ctx.ellipse(sx + ev.r * 0.85, sy, 14, 10, 0, 0, PI2); ctx.fill();
                ctx.fillStyle = '#000';
                ctx.beginPath(); ctx.arc(sx + ev.r * 0.95, sy - 2, 2, 0, PI2); ctx.fill();
                // Tag
                ctx.fillStyle = `rgba(160,168,176,${fadeAlpha})`;
                ctx.font = '11px monospace'; ctx.textAlign = 'center';
                ctx.fillText('WHALE FALL', sx, sy + ev.r * 0.55);
            } else if (ev.kind === 'blackwater') {
                // A hole in the water — darker than the dark around it
                const grad = ctx.createRadialGradient(sx, sy, ev.r * 0.2, sx, sy, ev.r);
                grad.addColorStop(0, 'rgba(0,0,2,0.92)');
                grad.addColorStop(0.8, 'rgba(2,1,6,0.75)');
                grad.addColorStop(1, 'rgba(4,2,10,0)');
                ctx.fillStyle = grad;
                ctx.beginPath(); ctx.arc(sx, sy, ev.r, 0, PI2); ctx.fill();
                // Faint ink-swirl edge — the only hint of the boundary
                ctx.strokeStyle = `rgba(60,40,90,${0.14 + Math.sin(g.runTime * 0.8) * 0.06})`;
                ctx.lineWidth = 2; ctx.setLineDash([10, 14]);
                ctx.beginPath(); ctx.arc(sx, sy, ev.r * (0.98 + Math.sin(g.runTime * 0.5) * 0.02), 0, PI2); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = `rgba(120,100,160,${fadeAlpha * 0.8})`;
                ctx.font = '11px monospace'; ctx.textAlign = 'center';
                ctx.fillText('BLACKWATER', sx, sy - ev.r - 8);
            } else if (ev.kind === 'vent') {
                // Black-smoker vent
                ctx.fillStyle = '#1A0808';
                ctx.beginPath();
                ctx.moveTo(sx - ev.r * 0.6, sy + ev.r * 0.6);
                ctx.lineTo(sx - ev.r * 0.3, sy - ev.r * 0.4);
                ctx.lineTo(sx + ev.r * 0.3, sy - ev.r * 0.4);
                ctx.lineTo(sx + ev.r * 0.6, sy + ev.r * 0.6);
                ctx.closePath(); ctx.fill();
                // Plume
                for (let pi = 0; pi < 5; pi++) {
                    const a = (1 - pi * 0.18);
                    ctx.fillStyle = `rgba(140,40,30,${a * 0.4})`;
                    const py = sy - ev.r * 0.4 - pi * 18 + Math.sin(ev.ventPulse + pi) * 4;
                    ctx.beginPath(); ctx.arc(sx + Math.sin(ev.ventPulse + pi * 1.7) * 6, py, ev.r * 0.4 + pi * 6, 0, PI2); ctx.fill();
                }
                // Hot core
                drawGlow(ctx, '#FF4020', sx, sy - ev.r * 0.3, ev.r * 1.2, 0.6);
                // Heal aura ring (when player is at right depth)
                if (Math.abs(g.depth - ev.obDepth) < 12) {
                    const auraR = 90;
                    ctx.strokeStyle = `rgba(80,255,160,${0.18 + Math.sin(ev.ventPulse * 2) * 0.08})`;
                    ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
                    ctx.beginPath(); ctx.arc(sx, sy, auraR, 0, PI2); ctx.stroke();
                    ctx.setLineDash([]);
                }
                ctx.fillStyle = `rgba(218,80,40,${fadeAlpha})`;
                ctx.font = '11px monospace'; ctx.textAlign = 'center';
                ctx.fillText('HYDROTHERMAL VENT', sx, sy + ev.r * 0.7);
            }
            ctx.globalAlpha = 1;
        }
    }

    // --- WRECKS (interactive salvage) — same 3D fade ---
    for (const wr of (g.wrecks || [])) {
        const dz = (wr.obDepth || 0) - g.depth;
        const range = 50;
        const absDz = Math.abs(dz);
        if (absDz > range) continue;
        const proximity = 1 - absDz / range;
        const fadeAlpha = dz >= 0 ? proximity : Math.pow(proximity, 1.5);
        const scaleK = 0.5 + proximity * 0.5;
        const sx = wr.x - cx, sy = wr.y - cy;
        if (sx < -wr.r * scaleK - 30 || sx > w + wr.r * scaleK + 30 || sy < -wr.r * scaleK - 30 || sy > h + wr.r * scaleK + 30) continue;
        ctx.globalAlpha = fadeAlpha;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.scale(scaleK, scaleK);
        drawWreck(0, 0, wr, g);
        ctx.restore();
        ctx.globalAlpha = 1;
    }

    // --- BUBBLES ---
    for (const b of g.bubbles) {
        const sx = b.x - cx, sy = b.y - cy;
        ctx.globalAlpha = b.alpha;
        ctx.strokeStyle = 'rgba(150,200,220,0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, sy, b.size, 0, PI2);
        ctx.stroke();
        // Highlight
        ctx.fillStyle = 'rgba(200,230,255,0.15)';
        ctx.beginPath();
        ctx.arc(sx - b.size * 0.3, sy - b.size * 0.3, b.size * 0.3, 0, PI2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    // --- MARINE SNOW (parallax: alpha varies by layer) ---
    // Single fillStyle then batched paths — one Path2D would be fastest, but this avoids the per-flake style change
    let lastAlpha = -1;
    ctx.beginPath();
    for (const s of g.marinSnow) {
        const sx = s.x - cx, sy = s.y - cy;
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
        const a = s.alpha != null ? s.alpha : 0.18;
        if (Math.abs(a - lastAlpha) > 0.05) {
            if (lastAlpha >= 0) ctx.fill();
            ctx.fillStyle = `rgba(170,190,205,${a})`;
            ctx.beginPath();
            lastAlpha = a;
        }
        ctx.moveTo(sx + s.size, sy);
        ctx.arc(sx, sy, s.size, 0, PI2);
    }
    if (lastAlpha >= 0) ctx.fill();

    // --- BIOLUMINESCENT FLICKERS (cached glow sprite) ---
    if (g.bioFlickers) {
        for (const f of g.bioFlickers) {
            const sx = f.x - cx, sy = f.y - cy;
            if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;
            const fadeIn = Math.min(1, (5 - f.life) * 2);
            const pulse = (Math.sin(f.phase) * 0.5 + 0.5);
            const a = 0.18 + pulse * 0.55;
            const lifeFade = Math.min(1, f.life / 1.0);
            const finalA = a * lifeFade * Math.min(1, fadeIn);
            drawGlow(ctx, f.color, sx, sy, f.size * 4, finalA);
            // Bright core
            ctx.fillStyle = hexA(f.color, finalA);
            ctx.beginPath(); ctx.arc(sx, sy, f.size, 0, PI2); ctx.fill();
        }
    }

    // --- Depth charges (SVG barrel) ---
    for (const dc of g.depthCharges) {
        const sx = dc.x - cx, sy = dc.y - cy;
        const pulse = 0.5 + Math.sin(dc.timer * 8) * 0.3;
        // Warning glow
        drawGlow(ctx, '#FF6432', sx, sy, 16, pulse * 0.5);
        if (dchargeImg._ready) {
            ctx.globalAlpha = 0.7 + pulse * 0.3;
            ctx.drawImage(dchargeImg, sx - 10, sy - 12, 20, 24);
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = `rgba(255,100,50,${pulse})`;
            ctx.beginPath(); ctx.arc(sx, sy, 6, 0, PI2); ctx.fill();
        }
    }

    // --- Lures (mine SVG + pulsing glow) ---
    for (const lu of g.lures) {
        const sx = lu.x - cx, sy = lu.y - cy;
        if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) continue;
        const pulse = 0.4 + Math.sin(lu.pulse) * 0.3;
        // Attraction field (cached glow)
        drawGlow(ctx, '#50FF78', sx, sy, 40, pulse * 0.35);
        // Mine sprite
        if (mineImg._ready) {
            ctx.globalAlpha = 0.6 + pulse * 0.4;
            ctx.drawImage(mineImg, sx - 14, sy - 14, 28, 28);
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = `rgba(80,255,120,${pulse})`;
            ctx.beginPath(); ctx.arc(sx, sy, 8, 0, PI2); ctx.fill();
        }
    }

    // --- Gems --- fade with descent so collection takes commitment. Tier sets color/glow.
    for (const gem of g.gems) {
        const sx = gem.x - cx, sy = gem.y - cy;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
        const dz = (g.depth || 0) - (gem.dropDepth || 0);
        const depthFade = dz <= 0 ? 1 : Math.max(0, 1 - dz / 25);
        ctx.globalAlpha = Math.min(1, gem.life * 2) * depthFade;
        const gColor = gem.color || '#5AAFFF';
        const gGlow  = gem.glowColor || gColor;
        const tier = gem.tier || 1;
        // Tier glow scales: bigger and brighter for higher tiers
        drawGlow(ctx, gGlow, sx, sy, gem.size * (3 + tier * 0.6), 0.35 + tier * 0.05);
        // Higher tiers pulse
        const pulse = tier > 1 ? (0.85 + Math.sin(g.runTime * 4 + gem.x * 0.05) * 0.15) : 1;
        // Crystal shape — diamond facets for higher tiers, circle for common
        if (tier >= 2) {
            ctx.fillStyle = gColor;
            ctx.beginPath();
            const s = gem.size * pulse;
            ctx.moveTo(sx, sy - s);
            ctx.lineTo(sx + s, sy);
            ctx.lineTo(sx, sy + s);
            ctx.lineTo(sx - s, sy);
            ctx.closePath(); ctx.fill();
            // Highlight
            ctx.fillStyle = '#FFF';
            ctx.beginPath();
            ctx.moveTo(sx, sy - s * 0.6);
            ctx.lineTo(sx + s * 0.3, sy);
            ctx.lineTo(sx, sy + s * 0.2);
            ctx.lineTo(sx - s * 0.3, sy);
            ctx.closePath(); ctx.fill();
        } else {
            // Tier 1 — keep the sprite if loaded, else a circle
            if (gemImg._ready) {
                const gs2 = gem.size * 2.5;
                ctx.drawImage(gemImg, sx - gs2, sy - gs2, gs2 * 2, gs2 * 2);
            } else {
                ctx.fillStyle = gColor;
                ctx.beginPath(); ctx.arc(sx, sy, gem.size, 0, PI2); ctx.fill();
            }
        }
        ctx.globalAlpha = 1;
    }

    // --- Loot items — same depth fade, distinct visual per rarity ---
    for (const li of g.lootItems) {
        const sx = li.x - cx, sy = li.y - cy;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
        const dz = (g.depth || 0) - (li.dropDepth || 0);
        const depthFade = dz <= 0 ? 1 : Math.max(0, 1 - dz / 30);
        ctx.globalAlpha = Math.min(1, li.life * 0.5) * depthFade;
        const c = li.type.color;
        const pulse = 0.7 + Math.sin(g.runTime * 4 + li.x * 0.05) * 0.3;
        drawGlow(ctx, c, sx, sy, 16, 0.5 * pulse);
        // Hex/diamond shape — looks like a salvageable component
        ctx.fillStyle = c;
        ctx.beginPath();
        const sz = li.size;
        ctx.moveTo(sx, sy - sz);
        ctx.lineTo(sx + sz, sy);
        ctx.lineTo(sx, sy + sz);
        ctx.lineTo(sx - sz, sy);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = 0.6; ctx.stroke();
        // Glyph
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(li.type.glyph, sx, sy + 3);
        ctx.globalAlpha = 1;
    }

    // --- APEX PATROL — mostly darkness; you see it late, and never all of it ---
    if (g.apex) drawApexPatrol(g, cx, cy);

    // --- Enemies (distinct shapes per type, neon glow) ---
    const t = g.runTime;
    for (const e of g.enemies) {
        const sx = e.x - cx, sy = e.y - cy;
        if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue;
        const col = e.flash > 0 ? '#FFF' : e.color;
        const facing = Math.atan2(g.player.y - e.y, g.player.x - e.x);
        // Feature 2: Ghost enemies — semi-transparent, slightly glitchy
        const isGhost = e.ghost === true;
        if (isGhost) ctx.globalAlpha = 0.25 + Math.sin(t * 8) * 0.1;
        // Feature 4: Aberrant enemies — jitter + color shift
        const aberrantJitter = e.aberrant ? (Math.random() - 0.5) * 3 : 0;

        // Soft glow behind every enemy (cached sprite — no per-frame allocation)
        drawGlow(ctx, col, sx, sy, e.size * 3, 0.4);

        // UNKNOWN CONTACT tag — first encounter (per run), tag fades when scanned
        if (e.typeId && g._scannedThisRun && !g._scannedThisRun.has(e.typeId) && !e.isBoss && !isGhost) {
            const pulse = 0.5 + Math.sin(t * 3 + e.x * 0.05) * 0.3;
            ctx.fillStyle = `rgba(180,200,220,${pulse})`;
            ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
            ctx.fillText('UNKNOWN', sx, sy - e.size - 8);
        }
        // COVERT OBSERVATION ring — field study filling while you watch unseen
        if (e._observing > 0) {
            ctx.strokeStyle = 'rgba(128,255,224,0.75)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(sx, sy, e.size + 9, -Math.PI / 2, -Math.PI / 2 + PI2 * e._observing); ctx.stroke();
            ctx.fillStyle = 'rgba(128,255,224,0.8)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
            ctx.fillText('OBSERVING', sx, sy - e.size - 18);
        }

        // --- BOSS TELEGRAPH WARNING — give the player time to react ---
        if (e.isBoss && e.state === 'telegraph') {
            const pulse = 0.5 + Math.sin(t * 18) * 0.4;
            const warnA = 1.6 - (e.stateTimer || 0); // intensifies as countdown ticks
            ctx.save();
            ctx.globalAlpha = Math.min(1, warnA * 0.7) * pulse;
            if (e.attackPattern === 'tentacle_slam') {
                // 4-arm radial warning
                ctx.strokeStyle = '#FF4060'; ctx.lineWidth = 3; ctx.lineCap = 'round';
                for (let ti = 0; ti < 4; ti++) {
                    const a = (ti / 4) * PI2;
                    ctx.beginPath();
                    ctx.moveTo(sx + Math.cos(a) * (e.size + 5), sy + Math.sin(a) * (e.size + 5));
                    ctx.lineTo(sx + Math.cos(a) * 220, sy + Math.sin(a) * 220);
                    ctx.stroke();
                }
            } else if (e.attackPattern === 'barrage') {
                // Fan of 5 dashed lines toward player
                const baseA = Math.atan2(g.player.y - e.y, g.player.x - e.x);
                ctx.strokeStyle = '#FFA040'; ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                for (let bi = -2; bi <= 2; bi++) {
                    const a = baseA + bi * 0.16;
                    ctx.beginPath();
                    ctx.moveTo(sx, sy);
                    ctx.lineTo(sx + Math.cos(a) * 280, sy + Math.sin(a) * 280);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            } else if (e.attackPattern === 'charge') {
                // Line warning from boss to charge target
                const tx = e.chargeTarget.x - cx, ty = e.chargeTarget.y - cy;
                ctx.strokeStyle = '#FF2030'; ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx, ty); ctx.stroke();
                ctx.fillStyle = '#FF2030';
                ctx.beginPath(); ctx.arc(tx, ty, 10, 0, PI2); ctx.fill();
            } else if (e.attackPattern === 'bite_arc') {
                // Cone warning toward player
                const baseA = Math.atan2(g.player.y - e.y, g.player.x - e.x);
                const reach = 280;
                ctx.fillStyle = `rgba(220,60,80,${0.18 * pulse})`;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.arc(sx, sy, reach, baseA - 0.7, baseA + 0.7);
                ctx.closePath(); ctx.fill();
                ctx.strokeStyle = '#FF2040'; ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.save();
        ctx.translate(sx + aberrantJitter, sy + aberrantJitter);
        ctx.rotate(facing);
        ctx.globalAlpha = isGhost ? (0.25 + Math.sin(t * 8) * 0.1) : (e.flash > 0 ? 1 : 0.9);

        const sz = e.size;
        if (e.typeId === 'jellyfish') {
            // Bioluminescent bell — pulsing, translucent, trailing organs visible inside
            const pulse = 0.6 + Math.sin(t * 2.5 + e.x) * 0.4;
            const squeeze = 1 + Math.sin(t * 2.5 + e.x) * 0.15; // breathing motion
            // Outer bell
            ctx.fillStyle = hexA(col, 0.15 * pulse);
            ctx.beginPath(); ctx.ellipse(0, -sz * 0.1, sz * squeeze, sz * 0.8, 0, Math.PI, 0); ctx.fill();
            // Inner bell membrane
            ctx.strokeStyle = hexA(col, 0.4 * pulse); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.ellipse(0, -sz * 0.1, sz * 0.7 * squeeze, sz * 0.55, 0, Math.PI + 0.3, -0.3); ctx.stroke();
            // Gonads (4 horseshoe shapes — visible through translucent bell)
            ctx.strokeStyle = hexA('#FFFFFF', 0.15); ctx.lineWidth = 1;
            for (let i = 0; i < 4; i++) {
                const gx = -sz * 0.3 + i * sz * 0.2;
                ctx.beginPath(); ctx.arc(gx, -sz * 0.15, sz * 0.12, 0.5, 2.6); ctx.stroke();
            }
            // Oral arms (thick central tentacles)
            ctx.strokeStyle = hexA(col, 0.3); ctx.lineWidth = 2;
            for (let i = 0; i < 3; i++) {
                const ax = -sz * 0.15 + i * sz * 0.15;
                ctx.beginPath(); ctx.moveTo(ax, sz * 0.1);
                for (let j = 1; j <= 4; j++) ctx.lineTo(ax + Math.sin(t * 1.8 + i * 1.5 + j * 0.9) * 4, sz * 0.1 + j * sz * 0.25);
                ctx.stroke();
            }
            // Trailing tentacles (thin, long, wavy)
            ctx.strokeStyle = hexA(col, 0.15); ctx.lineWidth = 0.8;
            for (let i = 0; i < 6; i++) {
                const tx = -sz * 0.4 + i * sz * 0.16;
                ctx.beginPath(); ctx.moveTo(tx, sz * 0.15);
                for (let j = 1; j <= 6; j++) ctx.lineTo(tx + Math.sin(t * 1.2 + i * 0.7 + j * 0.6) * 5, sz * 0.15 + j * sz * 0.3);
                ctx.stroke();
            }
        } else if (e.typeId === 'piranha') {
            // Sci-fi piranha — biomechanical, armored, glowing eye slit
            ctx.fillStyle = col; ctx.globalAlpha = 0.9;
            // Body — angular, armored plating
            ctx.beginPath();
            ctx.moveTo(sz * 0.9, 0); ctx.lineTo(sz * 0.4, -sz * 0.4);
            ctx.lineTo(-sz * 0.3, -sz * 0.45); ctx.lineTo(-sz * 0.7, -sz * 0.2);
            ctx.lineTo(-sz * 0.7, sz * 0.2); ctx.lineTo(-sz * 0.3, sz * 0.45);
            ctx.lineTo(sz * 0.4, sz * 0.4); ctx.closePath(); ctx.fill();
            // Plate lines
            ctx.strokeStyle = hexA('#000000', 0.3); ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(sz * 0.2, -sz * 0.42); ctx.lineTo(sz * 0.1, sz * 0.42); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-sz * 0.2, -sz * 0.4); ctx.lineTo(-sz * 0.3, sz * 0.4); ctx.stroke();
            // Eye slit — glowing
            ctx.fillStyle = '#FFF'; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.ellipse(sz * 0.35, -sz * 0.08, sz * 0.12, sz * 0.04, 0.1, 0, PI2); ctx.fill();
            // Jaw — slightly open
            ctx.fillStyle = '#300'; ctx.globalAlpha = 0.6;
            ctx.beginPath(); ctx.moveTo(sz * 0.9, 0); ctx.lineTo(sz * 0.5, sz * 0.15); ctx.lineTo(sz * 0.9, sz * 0.1); ctx.fill();
            // Tail fin — forked
            ctx.fillStyle = hexA(col, 0.6);
            ctx.beginPath(); ctx.moveTo(-sz * 0.7, 0); ctx.lineTo(-sz, -sz * 0.35); ctx.lineTo(-sz * 0.8, 0); ctx.lineTo(-sz, sz * 0.35); ctx.closePath(); ctx.fill();
        } else if (e.typeId === 'squid') {
            // Giant squid — mantle with bioluminescent spots, huge eye, trailing arms
            const breathe = 1 + Math.sin(t * 1.5 + e.y) * 0.08;
            ctx.fillStyle = hexA(col, 0.65);
            ctx.beginPath(); ctx.ellipse(0, 0, sz * breathe, sz * 0.4 * breathe, 0, 0, PI2); ctx.fill();
            // Chromatophore spots (color-shifting dots on mantle)
            for (let i = 0; i < 5; i++) {
                const sx2 = -sz * 0.5 + i * sz * 0.25;
                const sy2 = Math.sin(i * 2.3) * sz * 0.15;
                const spotAlpha = 0.2 + Math.sin(t * 3 + i * 1.7) * 0.15;
                ctx.fillStyle = hexA('#FF6090', spotAlpha);
                ctx.beginPath(); ctx.arc(sx2, sy2, sz * 0.06, 0, PI2); ctx.fill();
            }
            // HUGE eye — the defining feature
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(sz * 0.35, -sz * 0.05, sz * 0.18, 0, PI2); ctx.fill();
            ctx.fillStyle = '#FFD040'; ctx.beginPath(); ctx.arc(sz * 0.35, -sz * 0.05, sz * 0.13, 0, PI2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(sz * 0.37, -sz * 0.05, sz * 0.04, sz * 0.1, 0, 0, PI2); ctx.fill(); // slit pupil
            // 8 trailing arms
            ctx.strokeStyle = hexA(col, 0.35); ctx.lineWidth = 1.5;
            for (let i = 0; i < 8; i++) {
                const ay = -sz * 0.3 + i * sz * 0.085;
                ctx.beginPath(); ctx.moveTo(-sz, ay);
                for (let j = 1; j <= 5; j++) ctx.lineTo(-sz - j * 6, ay + Math.sin(t * 2 + i * 0.8 + j * 0.7) * (3 + j * 0.5));
                ctx.stroke();
            }
            // Two long tentacles (the hunting arms)
            ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 1;
            for (let i = 0; i < 2; i++) {
                const ty = -sz * 0.1 + i * sz * 0.2;
                ctx.beginPath(); ctx.moveTo(-sz, ty);
                for (let j = 1; j <= 8; j++) ctx.lineTo(-sz - j * 7, ty + Math.sin(t * 1.5 + i * 3 + j * 0.5) * (2 + j));
                ctx.stroke();
                // Club at the end
                const cx2 = -sz - 56, cy2 = ty + Math.sin(t * 1.5 + i * 3 + 4) * 10;
                ctx.fillStyle = hexA(col, 0.4);
                ctx.beginPath(); ctx.ellipse(cx2, cy2, 4, 2, 0, 0, PI2); ctx.fill();
            }
        } else if (e.typeId === 'anglerfish') {
            // Deep-sea anglerfish — huge mouth, tiny eyes, bioluminescent lure on stalk
            // Feature 3: Ambush AI — hidden = very transparent
            const ambushAlpha = e._alpha !== undefined ? e._alpha : 0.85;
            ctx.fillStyle = '#0e0808'; ctx.globalAlpha = ambushAlpha;
            // Lumpy body (overlapping ellipses for organic feel)
            ctx.beginPath(); ctx.ellipse(-sz * 0.1, 0, sz * 0.85, sz * 0.6, 0, 0, PI2); ctx.fill();
            ctx.beginPath(); ctx.ellipse(sz * 0.2, -sz * 0.05, sz * 0.5, sz * 0.45, 0.1, 0, PI2); ctx.fill();
            // MASSIVE jaw — open, lined with needle teeth
            ctx.fillStyle = '#1a0000'; ctx.globalAlpha = 0.9;
            ctx.beginPath(); ctx.moveTo(sz * 0.6, -sz * 0.3); ctx.quadraticCurveTo(sz * 1.1, 0, sz * 0.6, sz * 0.35); ctx.lineTo(sz * 0.3, sz * 0.15); ctx.lineTo(sz * 0.3, -sz * 0.15); ctx.closePath(); ctx.fill();
            // Teeth — irregular, translucent, horrifying
            ctx.fillStyle = hexA('#CCBBAA', 0.7);
            const teeth = [-0.25, -0.15, -0.05, 0.05, 0.15, 0.25];
            for (const ty of teeth) {
                const tx = sz * 0.55 + Math.abs(ty) * sz * 0.8;
                const tLen = sz * 0.12 + Math.random() * sz * 0.08;
                ctx.beginPath(); ctx.moveTo(tx, ty * sz - 1); ctx.lineTo(tx + tLen, ty * sz); ctx.lineTo(tx, ty * sz + 1); ctx.fill();
            }
            // Tiny beady eye (almost comically small vs the mouth)
            ctx.fillStyle = '#FFF'; ctx.globalAlpha = 0.5;
            ctx.beginPath(); ctx.arc(sz * 0.15, -sz * 0.25, 2, 0, PI2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(sz * 0.15, -sz * 0.25, 1, 0, PI2); ctx.fill();
            // Illicium (lure stalk) + esca (the glowing lure)
            ctx.strokeStyle = hexA('#443333', 0.5); ctx.lineWidth = 1;
            const lureX = sz * 0.1 + Math.sin(t * 2) * 3;
            const lureY = -sz * 0.85 + Math.cos(t * 1.5) * 2;
            ctx.beginPath(); ctx.moveTo(sz * 0.05, -sz * 0.35);
            ctx.quadraticCurveTo(sz * 0.15, -sz * 0.6, lureX, lureY); ctx.stroke();
            // The lure — bright, pulsing, irresistible
            const lGlow = 0.5 + Math.sin(t * 3.5) * 0.4;
            ctx.globalAlpha = lGlow;
            ctx.fillStyle = '#80FF80';
            ctx.beginPath(); ctx.arc(lureX, lureY, 3.5, 0, PI2); ctx.fill();
            const lureG = ctx.createRadialGradient(lureX, lureY, 0, lureX, lureY, 18);
            lureG.addColorStop(0, `rgba(128,255,128,${lGlow * 0.35})`);
            lureG.addColorStop(1, 'rgba(128,255,128,0)');
            ctx.fillStyle = lureG;
            ctx.beginPath(); ctx.arc(lureX, lureY, 18, 0, PI2); ctx.fill();
            // Dorsal spines
            ctx.strokeStyle = hexA('#1a1010', 0.4); ctx.lineWidth = 1;
            for (let i = 0; i < 4; i++) {
                const spx = -sz * 0.4 + i * sz * 0.2;
                ctx.beginPath(); ctx.moveTo(spx, -sz * 0.5); ctx.lineTo(spx + 2, -sz * 0.65); ctx.stroke();
            }
        } else if (e.typeId === 'eel') {
            // Electric eel — segmented body, crackling energy between segments
            const segs = 10;
            const pts = [];
            for (let i = 0; i <= segs; i++) {
                const segT = i / segs;
                pts.push({ x: sz - segT * sz * 2.5, y: Math.sin(t * 3.5 + i * 0.7) * (6 - segT * 5) });
            }
            // Body segments with decreasing width
            for (let i = 0; i < segs; i++) {
                const w2 = (1 - i / segs) * sz * 0.25 + 1;
                ctx.fillStyle = hexA(col, 0.7 - i * 0.04);
                ctx.beginPath();
                ctx.ellipse((pts[i].x + pts[i+1].x) / 2, (pts[i].y + pts[i+1].y) / 2,
                    Math.sqrt((pts[i+1].x - pts[i].x) ** 2 + (pts[i+1].y - pts[i].y) ** 2) / 2 + 1,
                    w2, Math.atan2(pts[i+1].y - pts[i].y, pts[i+1].x - pts[i].x), 0, PI2);
                ctx.fill();
            }
            // Electric arcs between segments
            ctx.strokeStyle = '#FFFF90'; ctx.lineWidth = 1;
            for (let i = 0; i < segs - 1; i++) {
                if (Math.random() < 0.4) {
                    ctx.globalAlpha = 0.3 + Math.random() * 0.4;
                    const mx2 = (pts[i].x + pts[i+1].x) / 2 + (Math.random() - 0.5) * 8;
                    const my2 = (pts[i].y + pts[i+1].y) / 2 + (Math.random() - 0.5) * 8;
                    ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y);
                    ctx.lineTo(mx2, my2); ctx.lineTo(pts[i+1].x, pts[i+1].y); ctx.stroke();
                }
            }
            ctx.globalAlpha = 0.9;
            // Eye
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pts[0].x - 2, pts[0].y - sz * 0.08, 2, 0, PI2); ctx.fill();
            ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(pts[0].x - 2, pts[0].y - sz * 0.08, 1, 0, PI2); ctx.fill();
        } else if (e.typeId === 'leviathan') {
            // LEVIATHAN — massive undulating horror, barely defined, mostly darkness
            ctx.globalAlpha = 0.5;
            // Body — overlapping organic masses that shift
            for (let i = 0; i < 8; i++) {
                const ox = Math.sin(i * 1.1 + t * 0.2) * sz * 0.25;
                const oy = Math.cos(i * 1.5 + t * 0.15) * sz * 0.2;
                const r2 = sz * (0.35 + i * 0.06 + Math.sin(t * 0.5 + i) * 0.05);
                ctx.fillStyle = i < 3 ? '#100000' : '#1a0505';
                ctx.beginPath(); ctx.ellipse(ox, oy, r2, r2 * 0.7, i * 0.3 + t * 0.05, 0, PI2); ctx.fill();
            }
            // Armored ridges along the top
            ctx.strokeStyle = hexA('#3a1515', 0.4); ctx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
                const rx = -sz * 0.5 + i * sz * 0.2 + Math.sin(t * 0.3 + i) * 5;
                ctx.beginPath(); ctx.moveTo(rx, -sz * 0.35); ctx.lineTo(rx + 3, -sz * 0.5); ctx.lineTo(rx + 6, -sz * 0.35); ctx.stroke();
            }
            // Eyes — multiple, asymmetric, wrong
            ctx.globalAlpha = 0.6 + Math.sin(t * 1.5) * 0.3;
            const eyes = [{ x: 0.3, y: -0.15, r: 5 }, { x: 0.35, y: 0.12, r: 4 }, { x: 0.15, y: -0.25, r: 3 }];
            for (const eye of eyes) {
                ctx.fillStyle = '#FF0000';
                ctx.beginPath(); ctx.arc(sz * eye.x, sz * eye.y, eye.r, 0, PI2); ctx.fill();
                ctx.fillStyle = '#800000';
                ctx.beginPath(); ctx.arc(sz * eye.x + 1, sz * eye.y, eye.r * 0.5, 0, PI2); ctx.fill();
            }
            // Trailing tendrils
            ctx.strokeStyle = hexA('#200000', 0.3); ctx.lineWidth = 3;
            for (let i = 0; i < 4; i++) {
                ctx.beginPath(); ctx.moveTo(-sz * 0.6, -sz * 0.2 + i * sz * 0.13);
                for (let j = 1; j <= 6; j++) ctx.lineTo(-sz * 0.6 - j * 12, -sz * 0.2 + i * sz * 0.13 + Math.sin(t * 0.8 + i * 2 + j * 0.5) * (5 + j * 2));
                ctx.stroke();
            }
        } else if (e.typeId === 'hermit') {
            // HERMIT — armoured shell with conical opening, antennae poking out
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(0, 0, sz, 0, PI2); ctx.fill();
            // Shell ridges
            ctx.strokeStyle = '#604020'; ctx.lineWidth = 1.2;
            for (let ri = 0; ri < 5; ri++) {
                const rr = sz * (0.3 + ri * 0.15);
                ctx.beginPath(); ctx.arc(0, 0, rr, -2.0, 2.0); ctx.stroke();
            }
            // Eyes / antennae poking out front
            ctx.fillStyle = '#FFFF80';
            ctx.beginPath(); ctx.arc(sz * 0.6, -sz * 0.2, 1.5, 0, PI2); ctx.fill();
            ctx.beginPath(); ctx.arc(sz * 0.6,  sz * 0.2, 1.5, 0, PI2); ctx.fill();
            ctx.strokeStyle = '#604020'; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(sz * 0.6, -sz * 0.2); ctx.lineTo(sz * 0.85, -sz * 0.4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sz * 0.6,  sz * 0.2); ctx.lineTo(sz * 0.85,  sz * 0.4); ctx.stroke();
        } else if (e.typeId === 'puffer') {
            // PUFFER — round body with spikes radiating out
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(0, 0, sz, 0, PI2); ctx.fill();
            ctx.strokeStyle = '#406020'; ctx.lineWidth = 1.5;
            for (let si = 0; si < 12; si++) {
                const a = (si / 12) * PI2;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * sz, Math.sin(a) * sz);
                ctx.lineTo(Math.cos(a) * sz * 1.4, Math.sin(a) * sz * 1.4);
                ctx.stroke();
            }
            // Eyes
            ctx.fillStyle = '#FFF';
            ctx.beginPath(); ctx.arc(sz * 0.4, -sz * 0.2, 1.8, 0, PI2); ctx.fill();
            ctx.beginPath(); ctx.arc(sz * 0.4,  sz * 0.2, 1.8, 0, PI2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(sz * 0.45, -sz * 0.2, 0.9, 0, PI2); ctx.fill();
            ctx.beginPath(); ctx.arc(sz * 0.45,  sz * 0.2, 0.9, 0, PI2); ctx.fill();
        } else if (e.typeId === 'manta') {
            // MANTA — flat triangular body with wide wings
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(sz, 0);
            ctx.quadraticCurveTo(sz * 0.3, -sz * 1.2, -sz * 0.7, -sz * 0.3);
            ctx.lineTo(-sz * 0.7, sz * 0.3);
            ctx.quadraticCurveTo(sz * 0.3, sz * 1.2, sz, 0);
            ctx.fill();
            ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
            // Eye spots
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(sz * 0.4, -sz * 0.4, 1.5, 0, PI2); ctx.fill();
            ctx.beginPath(); ctx.arc(sz * 0.4,  sz * 0.4, 1.5, 0, PI2); ctx.fill();
            // Whip tail
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(-sz * 0.7, 0);
            for (let j = 1; j <= 4; j++) ctx.lineTo(-sz * 0.7 - j * 8, Math.sin(t * 2 + j) * 4);
            ctx.stroke();
        } else if (e.typeId === 'glowshrimp') {
            // GLOWSHRIMP — small segmented body with glowing tail
            ctx.fillStyle = col;
            for (let si = 0; si < 4; si++) {
                ctx.beginPath(); ctx.ellipse(-sz * 0.3 + si * sz * 0.3, 0, sz * 0.35, sz * 0.25, 0, 0, PI2); ctx.fill();
            }
            // Glowing antennae
            drawGlow(ctx, col, sz * 0.7, 0, sz * 1.5, 0.5);
            ctx.strokeStyle = '#FFF'; ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(sz * 0.5, -2); ctx.lineTo(sz * 1.1, -4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sz * 0.5,  2); ctx.lineTo(sz * 1.1,  4); ctx.stroke();
        } else if (e.typeId === 'vampyro') {
            // VAMPYRO — phases in/out, ghostly cloak shape
            const phaseAlpha = e._phased ? 0.25 : 0.85;
            ctx.globalAlpha = phaseAlpha;
            ctx.fillStyle = col;
            // Body — drape shape
            ctx.beginPath();
            ctx.moveTo(0, -sz);
            ctx.quadraticCurveTo(sz, -sz * 0.4, sz * 0.7, sz * 0.6);
            ctx.lineTo(-sz * 0.7, sz * 0.6);
            ctx.quadraticCurveTo(-sz, -sz * 0.4, 0, -sz);
            ctx.fill();
            // Hooked tendrils underneath
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
                const tx = -sz * 0.6 + i * sz * 0.24;
                ctx.beginPath(); ctx.moveTo(tx, sz * 0.5);
                ctx.quadraticCurveTo(tx + Math.sin(t * 2 + i) * 4, sz * 1.0, tx + 2, sz * 1.4);
                ctx.stroke();
            }
            // Single luminous eye
            ctx.fillStyle = '#FFF'; ctx.globalAlpha = 1;
            ctx.beginPath(); ctx.arc(0, -sz * 0.3, 2.5, 0, PI2); ctx.fill();
        } else if (e.typeId === 'nightmare') {
            // NIGHTMARE SMILE — disturbing toothed maw
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(0, 0, sz, 0, PI2); ctx.fill();
            // Teeth around the mouth
            ctx.fillStyle = '#FFF';
            for (let ti = 0; ti < 8; ti++) {
                const a = -1.0 + (ti / 7) * 2.0;
                const tx2 = Math.cos(a) * sz * 0.85, ty2 = Math.sin(a) * sz * 0.85;
                ctx.beginPath();
                ctx.moveTo(tx2, ty2);
                ctx.lineTo(tx2 + Math.cos(a) * 4, ty2 + Math.sin(a) * 4);
                ctx.lineTo(tx2 + Math.cos(a + 0.2) * 1.5, ty2 + Math.sin(a + 0.2) * 1.5);
                ctx.closePath(); ctx.fill();
            }
            // Eyes (two black voids)
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(-sz * 0.3, -sz * 0.4, 2.5, 0, PI2); ctx.fill();
            ctx.beginPath(); ctx.arc( sz * 0.3, -sz * 0.4, 2.5, 0, PI2); ctx.fill();
        } else if (e.typeId === 'gulper') {
            // GULPER — huge mouth, small body trailing
            const mouthOpen = e._lungeState === 'wind' || e._lungeState === 'lunge' ? 1 : 0.5;
            ctx.fillStyle = col;
            // Body
            ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.7, 0, 0, PI2); ctx.fill();
            // Mouth
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.moveTo(sz * 0.2, -sz * 0.5 * mouthOpen);
            ctx.lineTo(sz * 1.3, 0);
            ctx.lineTo(sz * 0.2, sz * 0.5 * mouthOpen);
            ctx.closePath(); ctx.fill();
            // Teeth
            ctx.fillStyle = '#FFF';
            for (let ti = 0; ti < 5; ti++) {
                ctx.beginPath();
                ctx.moveTo(sz * 0.4 + ti * sz * 0.18, -sz * 0.5 * mouthOpen + ti * sz * 0.1 * mouthOpen);
                ctx.lineTo(sz * 0.5 + ti * sz * 0.18, -sz * 0.3 * mouthOpen + ti * sz * 0.1 * mouthOpen);
                ctx.lineTo(sz * 0.45 + ti * sz * 0.18, -sz * 0.5 * mouthOpen + ti * sz * 0.12 * mouthOpen);
                ctx.fill();
            }
            // Eye
            ctx.fillStyle = '#FF4060';
            ctx.beginPath(); ctx.arc(-sz * 0.3, -sz * 0.3, 2.5, 0, PI2); ctx.fill();
        } else if (e.typeId === 'dragonfish') {
            // DRAGONFISH — long fish with scaled body, glowing maw
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.5, 0, 0, PI2); ctx.fill();
            // Scales
            ctx.strokeStyle = '#A04020'; ctx.lineWidth = 0.8;
            for (let si = 0; si < 6; si++) {
                ctx.beginPath(); ctx.arc(-sz * 0.5 + si * sz * 0.2, 0, sz * 0.3, -1, 1); ctx.stroke();
            }
            // Dorsal spines
            ctx.fillStyle = '#A04020';
            for (let di = 0; di < 4; di++) {
                ctx.beginPath();
                ctx.moveTo(-sz * 0.4 + di * sz * 0.25, -sz * 0.4);
                ctx.lineTo(-sz * 0.35 + di * sz * 0.25, -sz * 0.7);
                ctx.lineTo(-sz * 0.3 + di * sz * 0.25, -sz * 0.4);
                ctx.fill();
            }
            // Glowing mouth
            drawGlow(ctx, '#FFD040', sz * 0.8, 0, sz * 0.6, 0.7);
            ctx.fillStyle = '#FFD040';
            ctx.beginPath(); ctx.arc(sz * 0.8, 0, sz * 0.2, 0, PI2); ctx.fill();
            // Eye
            ctx.fillStyle = '#FFFF80';
            ctx.beginPath(); ctx.arc(sz * 0.4, -sz * 0.2, 1.5, 0, PI2); ctx.fill();
        } else if (e.typeId === 'tubeworm') {
            // TUBE WORM — base + segmented tube + waving tip
            ctx.fillStyle = '#1A2A18';
            ctx.beginPath(); ctx.ellipse(0, sz * 0.6, sz * 1.1, sz * 0.4, 0, 0, PI2); ctx.fill();
            ctx.fillStyle = col;
            for (let si = 0; si < 5; si++) {
                ctx.beginPath();
                ctx.ellipse(0, sz * 0.4 - si * sz * 0.25, sz * (0.7 - si * 0.08), sz * 0.18, 0, 0, PI2); ctx.fill();
            }
            // Mouth tip (waving)
            const tip = Math.sin(t * 2) * 0.2;
            ctx.fillStyle = '#A0E060';
            ctx.beginPath();
            ctx.ellipse(tip * sz * 0.2, -sz * 0.7, sz * 0.35, sz * 0.25, tip, 0, PI2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(tip * sz * 0.2, -sz * 0.7, sz * 0.15, 0, PI2); ctx.fill();
        } else if (e.typeId === 'voideye') {
            // VOID EYE — single huge iris with pulsing pupil
            const pulse = 0.5 + Math.sin(t * 1.5) * 0.4;
            // Outer eye
            ctx.fillStyle = '#FFFFE0';
            ctx.beginPath(); ctx.arc(0, 0, sz, 0, PI2); ctx.fill();
            // Iris
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(0, 0, sz * 0.7, 0, PI2); ctx.fill();
            // Pupil — tracks player
            const pupilA = Math.atan2(g.player.y - e.y, g.player.x - e.x);
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(Math.cos(pupilA) * sz * 0.3, Math.sin(pupilA) * sz * 0.3, sz * (0.25 + pulse * 0.1), 0, PI2); ctx.fill();
            // Veins radiating out
            ctx.strokeStyle = hexA('#600040', 0.6); ctx.lineWidth = 1;
            for (let vi = 0; vi < 8; vi++) {
                const a = (vi / 8) * PI2;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * sz * 0.7, Math.sin(a) * sz * 0.7);
                ctx.lineTo(Math.cos(a + 0.3) * sz * 1.05, Math.sin(a + 0.3) * sz * 1.05);
                ctx.stroke();
            }
        } else if (e.typeId === 'trenchworm') {
            // TRENCH WORM — emerges from below. Different shapes for rising vs active.
            const rising = e._burstState === 'rising';
            ctx.globalAlpha = rising ? 0.4 : 0.95;
            // Telegraph circle while rising
            if (rising) {
                ctx.strokeStyle = '#FF4060'; ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.arc(0, 0, sz * 1.2, 0, PI2); ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = 'rgba(80,20,30,0.6)';
                ctx.beginPath(); ctx.arc(0, 0, sz * 0.8, 0, PI2); ctx.fill();
            } else {
                // Body — segmented worm rising from a hole
                ctx.fillStyle = col;
                ctx.beginPath(); ctx.ellipse(0, sz * 0.4, sz * 0.9, sz * 0.5, 0, 0, PI2); ctx.fill();
                for (let si = 0; si < 4; si++) {
                    ctx.beginPath();
                    ctx.ellipse(0, sz * 0.2 - si * sz * 0.3, sz * (0.7 - si * 0.1), sz * 0.25, 0, 0, PI2); ctx.fill();
                }
                // Mouth — radial teeth
                ctx.fillStyle = '#FFF';
                for (let ti = 0; ti < 6; ti++) {
                    const a = (ti / 6) * PI2;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a) * sz * 0.3, -sz * 0.7 + Math.sin(a) * sz * 0.15);
                    ctx.lineTo(Math.cos(a) * sz * 0.5, -sz * 0.7 + Math.sin(a) * sz * 0.25);
                    ctx.lineTo(Math.cos(a + 0.3) * sz * 0.3, -sz * 0.7 + Math.sin(a + 0.3) * sz * 0.15);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
        } else {
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(0, 0, sz, 0, PI2); ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;

        // HP bar for elites (and aberrants)
        if (e.maxHp > 50 || g.player._showAllHp || e.aberrant) {
            const barW = e.size * 2.5;
            ctx.fillStyle = 'rgba(40,0,0,0.7)'; ctx.fillRect(sx - barW / 2, sy - e.size - 10, barW, 4);
            ctx.fillStyle = e.hp / e.maxHp > 0.5 ? '#4A4' : e.hp / e.maxHp > 0.25 ? '#DA4' : '#F44';
            ctx.fillRect(sx - barW / 2, sy - e.size - 10, barW * (e.hp / e.maxHp), 4);
        }
        // Aberrant marker
        if (e.aberrant) {
            ctx.globalAlpha = 0.7 + Math.sin(t * 5) * 0.3;
            ctx.fillStyle = '#FF00FF'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
            ctx.fillText('★', sx, sy - e.size - 14);
            ctx.globalAlpha = 1;
        }
    }

    // --- Projectiles (with trails) ---
    for (const pr of g.projectiles) {
        const sx = pr.x - cx, sy = pr.y - cy;
        if (sx < -30 || sx > w + 30 || sy < -30 || sy > h + 30) continue;
        // Trail — solid color stroke (cheaper than gradient and visually equivalent at this size)
        const inv = 1 / (Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy) || 1);
        const nx = -pr.vx * inv, ny = -pr.vy * inv;
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = pr.color; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + nx * 12, sy + ny * 12); ctx.stroke();
        ctx.globalAlpha = 1;
        // Core
        ctx.fillStyle = '#FFF'; ctx.beginPath(); ctx.arc(sx, sy, 3, 0, PI2); ctx.fill();
        ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, PI2); ctx.fill();
        // Glow (cached sprite)
        drawGlow(ctx, pr.color, sx, sy, 12, 0.4);
    }

    // --- Effects ---
    for (const ef of g.effects) {
        if (ef.type === 'sonar_ring') {
            const sx = ef.x - cx, sy = ef.y - cy;
            const prog = ef.radius / ef.maxRadius;
            const alpha = 1 - prog;
            // Outer wide soft glow band — the damage zone made visible
            if (ef.radius > 20) {
                const bandGrad = ctx.createRadialGradient(sx, sy, Math.max(1, ef.radius - 22), sx, sy, ef.radius + 22);
                bandGrad.addColorStop(0,   `rgba(120, 230, 200, 0)`);
                bandGrad.addColorStop(0.5, `rgba(120, 230, 200, ${alpha * 0.18})`);
                bandGrad.addColorStop(1,   `rgba(120, 230, 200, 0)`);
                ctx.fillStyle = bandGrad;
                ctx.beginPath(); ctx.arc(sx, sy, ef.radius + 22, 0, PI2);
                ctx.arc(sx, sy, Math.max(1, ef.radius - 22), 0, PI2, true);
                ctx.fill('evenodd');
            }
            // Bright leading edge
            ctx.strokeStyle = `rgba(180, 255, 230, ${alpha * 0.85})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(sx, sy, ef.radius, 0, PI2); ctx.stroke();
            // Inner trailing line (gives motion sense)
            ctx.strokeStyle = `rgba(60, 180, 160, ${alpha * 0.4})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(sx, sy, Math.max(0, ef.radius - 12), 0, PI2); ctx.stroke();
        }
        if (ef.type === 'cascade_ring') {
            // Feature 5: Cascade ring — fast, bright, in enemy color
            const sx = ef.x - cx, sy = ef.y - cy;
            const alpha = ef.life;
            const r = parseInt((ef.color || '#FF8040').slice(1,3),16);
            const gv = parseInt((ef.color || '#FF8040').slice(3,5),16);
            const b2 = parseInt((ef.color || '#FF8040').slice(5,7),16);
            ctx.strokeStyle = `rgba(${r},${gv},${b2},${alpha * 0.8})`;
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(sx, sy, ef.radius, 0, PI2); ctx.stroke();
        }
        if (ef.type === 'explosion') {
            const sx = ef.x - cx, sy = ef.y - cy;
            ctx.fillStyle = `rgba(255, 150, 50, ${ef.life})`;
            ctx.beginPath(); ctx.arc(sx, sy, ef.radius, 0, PI2); ctx.fill();
        }
        if (ef.type === 'particle') {
            ctx.fillStyle = ef.color;
            ctx.globalAlpha = ef.life * 2;
            ctx.beginPath(); ctx.arc(ef.x - cx, ef.y - cy, ef.size, 0, PI2); ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    // --- Electric field visual ---
    const hasField = g.player.weapons.find(w => w.id === 'field');
    if (hasField) {
        const fieldArea = WEAPON_DEFS.field.baseArea * g.player.areaMult * (1 + (hasField.level - 1) * 0.1);
        const px2 = g.player.x - cx, py2 = g.player.y - cy;
        ctx.strokeStyle = `rgba(100, 180, 255, ${0.15 + Math.sin(Date.now() / 200) * 0.1})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px2, py2, fieldArea, 0, PI2); ctx.stroke();
    }

    // --- Dash trail (Hades afterimage) ---
    for (const dt2 of g.player.dashTrail) {
        const tx = dt2.x - cx, ty = dt2.y - cy;
        ctx.globalAlpha = dt2.life * 0.4;
        ctx.fillStyle = g.player.charColor;
        ctx.beginPath(); ctx.arc(tx, ty, 10, 0, PI2); ctx.fill();
        ctx.globalAlpha = 1;
    }

    // --- Warning indicators (red flash at screen edge for offscreen enemies) ---
    for (const e of g.enemies) {
        if (e.maxHp <= 50) continue; // only warn for big enemies
        const esx = e.x - cx, esy = e.y - cy;
        if (esx > -30 && esx < w + 30 && esy > -30 && esy < h + 30) continue; // on screen
        // Draw red indicator at screen edge
        const angle = Math.atan2(esy - h / 2, esx - w / 2);
        const ix = w / 2 + Math.cos(angle) * (w / 2 - 20);
        const iy = h / 2 + Math.sin(angle) * (h / 2 - 20);
        const pulse = 0.3 + Math.sin(Date.now() / 150) * 0.2;
        ctx.fillStyle = `rgba(255, 40, 40, ${pulse})`;
        ctx.save(); ctx.translate(ix, iy); ctx.rotate(angle);
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath();
        ctx.fill(); ctx.restore();
    }

    // --- Player (Circular DSV — procedural, animated thrusters) ---
    {
        const px2 = g.player.x - cx, py2 = g.player.y - cy;
        const p = g.player;
        const spd = Math.sqrt((p._vx||0)**2 + (p._vy||0)**2);
        const hlAngle = p._facing || 0;

        if (p.iFrames > 0 && Math.floor(p.iFrames * 10) % 2) ctx.globalAlpha = 0.4;

        // --- SONAR CHARGE INDICATOR (manual ping mode) ---
        if (p._sonarManual && !p._sonarAuto) {
            const sw = p.weapons.find(ww => ww.id === 'sonar');
            if (sw) {
                const def = WEAPON_DEFS.sonar;
                const cdMax = def.baseCooldown * p.cdMult;
                const charge = Math.max(0, Math.min(1, 1 - sw.cooldown / cdMax));
                const ringR = 22;
                // Charging arc (dim teal → bright when full)
                const chargeColor = charge >= 1 ? '#A0FFE0' : '#3A8A78';
                ctx.strokeStyle = chargeColor;
                ctx.lineWidth = 1.5;
                ctx.globalAlpha = charge >= 1 ? (0.55 + Math.sin(g.runTime * 6) * 0.25) : 0.45;
                ctx.beginPath();
                ctx.arc(px2, py2, ringR, -Math.PI / 2, -Math.PI / 2 + charge * PI2);
                ctx.stroke();
                ctx.globalAlpha = 1;
                // Ready bloom
                if (charge >= 1) {
                    const bloom = ctx.createRadialGradient(px2, py2, ringR - 2, px2, py2, ringR + 6);
                    bloom.addColorStop(0, 'rgba(160,255,224,0)');
                    bloom.addColorStop(0.6, `rgba(160,255,224,${0.12 + Math.sin(g.runTime * 6) * 0.06})`);
                    bloom.addColorStop(1, 'rgba(160,255,224,0)');
                    ctx.fillStyle = bloom;
                    ctx.beginPath(); ctx.arc(px2, py2, ringR + 6, 0, PI2); ctx.fill();
                }
            }
        }

        // --- THRUSTER JET PARTICLES (behind sub) ---
        for (const tp of (p._thrusterParticles || [])) {
            const tpx = tp.x - cx, tpy = tp.y - cy;
            const alpha = tp.life * 0.6;
            // Hot core → cooling trail
            const heat = tp.life / 0.6;
            const r = Math.floor(60 + heat * 100);
            const g2 = Math.floor(150 + heat * 80);
            const b = Math.floor(200 + heat * 55);
            ctx.fillStyle = `rgba(${r},${g2},${b},${alpha})`;
            ctx.beginPath(); ctx.arc(tpx, tpy, tp.size * (1 + (1 - heat) * 0.5), 0, PI2); ctx.fill();
        }

        // --- HEADLIGHT CONE (forward-projecting volumetric beam) ---
        // Wedge clip from the bow forward, filled with a warm radial fade
        const flicker = 0.93 + Math.sin(g.runTime * 47) * 0.04 + (Math.random() - 0.5) * 0.05;
        const beamLen = 220;
        const beamSpread = 0.55; // ~63° total cone
        ctx.save();
        ctx.translate(px2, py2);
        ctx.rotate(hlAngle);
        // Clip to wedge shape (apex at bow, opens forward)
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.arc(8, 0, beamLen, -beamSpread, beamSpread);
        ctx.closePath();
        ctx.clip();
        // Beam gradient — bright near sub, fades into dark
        const beamGrad = ctx.createRadialGradient(8, 0, 0, 8, 0, beamLen);
        beamGrad.addColorStop(0,    `rgba(180,225,250,${0.32 * flicker})`);
        beamGrad.addColorStop(0.25, `rgba(140,200,235,${0.18 * flicker})`);
        beamGrad.addColorStop(0.6,  `rgba(90,160,210,${0.06 * flicker})`);
        beamGrad.addColorStop(1,    'rgba(60,120,180,0)');
        ctx.fillStyle = beamGrad;
        ctx.fillRect(0, -beamLen, beamLen + 10, beamLen * 2);
        // Dust motes drifting across the beam (parallax depth)
        const motes = 14;
        for (let mi = 0; mi < motes; mi++) {
            const mt = (g.runTime * 12 + mi * 23.7) % beamLen;
            const md = mt; // distance along beam
            const mSpread = Math.sin(mi * 2.3 + g.runTime * 0.5) * Math.tan(beamSpread) * md;
            const mAlpha = 0.18 * (1 - md / beamLen) * flicker;
            ctx.fillStyle = `rgba(200,230,255,${mAlpha})`;
            ctx.beginPath(); ctx.arc(8 + md, mSpread, 0.6 + (mi % 3) * 0.4, 0, PI2); ctx.fill();
        }
        ctx.restore();
        // Bow lamp itself — small bright source
        const lampX = px2 + Math.cos(hlAngle) * 14;
        const lampY = py2 + Math.sin(hlAngle) * 14;
        const lampGrad = ctx.createRadialGradient(lampX, lampY, 0, lampX, lampY, 12);
        lampGrad.addColorStop(0, `rgba(220,240,255,${0.55 * flicker})`);
        lampGrad.addColorStop(1, 'rgba(220,240,255,0)');
        ctx.fillStyle = lampGrad;
        ctx.beginPath(); ctx.arc(lampX, lampY, 12, 0, PI2); ctx.fill();

        ctx.save();
        ctx.translate(px2, py2);
        ctx.rotate(hlAngle);

        // --- 4 THRUSTER NOZZLES (positioned at 45° intervals around hull) ---
        const nozzleAngles = [-2.2, -0.9, 0.9, 2.2]; // relative angles from facing
        const isThrusting = spd > 10;
        for (const na of nozzleAngles) {
            const nx = Math.cos(na) * 16, ny = Math.sin(na) * 16;
            // Nozzle housing
            ctx.fillStyle = '#1A2530';
            ctx.save(); ctx.translate(nx, ny); ctx.rotate(na + Math.PI);
            ctx.fillRect(-2.5, -1.5, 5, 3);
            ctx.strokeStyle = '#2A4050'; ctx.lineWidth = 0.5; ctx.strokeRect(-2.5, -1.5, 5, 3);
            // Active jet glow
            if (isThrusting) {
                const jetFlicker = 0.4 + Math.random() * 0.3;
                const jetGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
                jetGrad.addColorStop(0, `rgba(80,180,220,${jetFlicker})`);
                jetGrad.addColorStop(0.5, `rgba(40,100,160,${jetFlicker * 0.4})`);
                jetGrad.addColorStop(1, 'rgba(40,100,160,0)');
                ctx.fillStyle = jetGrad;
                ctx.beginPath(); ctx.arc(3, 0, 8, 0, PI2); ctx.fill();
            }
            ctx.restore();
        }

        // --- MAIN HULL (circular pressure vessel) ---
        // Outer hull ring (scratched titanium)
        const hullGrad = ctx.createRadialGradient(0, -2, 2, 0, 0, 18);
        hullGrad.addColorStop(0, '#3A5A6A');
        hullGrad.addColorStop(0.6, '#1A3040');
        hullGrad.addColorStop(1, '#0E1E28');
        ctx.fillStyle = hullGrad;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, PI2); ctx.fill();

        // Hull edge ring (reinforced lip)
        ctx.strokeStyle = '#2A4A5A'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, PI2); ctx.stroke();
        // Inner ring detail
        ctx.strokeStyle = '#1A3040'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, PI2); ctx.stroke();

        // Welding seams (cross pattern — industrial)
        ctx.strokeStyle = 'rgba(60,90,100,0.25)'; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();

        // Rivets around the hull (12 rivets)
        ctx.fillStyle = '#3A5A6A';
        for (let ri = 0; ri < 12; ri++) {
            const ra = (ri / 12) * PI2;
            ctx.beginPath(); ctx.arc(Math.cos(ra) * 14, Math.sin(ra) * 14, 1, 0, PI2); ctx.fill();
        }

        // Rust/wear patches (grunge)
        ctx.fillStyle = 'rgba(80,50,30,0.12)';
        ctx.beginPath(); ctx.arc(5, -4, 4, 0, PI2); ctx.fill();
        ctx.fillStyle = 'rgba(60,40,25,0.08)';
        ctx.beginPath(); ctx.arc(-7, 6, 3, 0, PI2); ctx.fill();

        // Scratch marks
        ctx.strokeStyle = 'rgba(80,100,110,0.15)'; ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(-8, -10); ctx.lineTo(-3, -5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(4, 8); ctx.lineTo(10, 12); ctx.stroke();

        // --- VIEWPORT DOME (top center — the eye of the sub) ---
        const vpGrad = ctx.createRadialGradient(2, -1, 0, 0, 0, 7);
        vpGrad.addColorStop(0, 'rgba(140,220,255,0.5)');
        vpGrad.addColorStop(0.5, 'rgba(60,140,180,0.3)');
        vpGrad.addColorStop(1, 'rgba(20,60,80,0.2)');
        ctx.fillStyle = vpGrad;
        ctx.beginPath(); ctx.arc(2, -1, 6, 0, PI2); ctx.fill();
        ctx.strokeStyle = '#4A8AAA'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(2, -1, 6, 0, PI2); ctx.stroke();
        // Viewport reflection highlight
        ctx.fillStyle = 'rgba(200,240,255,0.25)';
        ctx.beginPath(); ctx.arc(4, -3, 2, 0, PI2); ctx.fill();

        // --- BOW LIGHT (forward-facing, bright) ---
        const bowPulse = 0.6 + Math.sin(t * 3) * 0.15;
        ctx.fillStyle = `rgba(100,220,255,${bowPulse})`;
        ctx.beginPath(); ctx.arc(15, 0, 2, 0, PI2); ctx.fill();

        // --- HULL ID STENCIL ---
        ctx.fillStyle = 'rgba(90,130,150,0.2)';
        ctx.font = '4px monospace'; ctx.textAlign = 'center';
        ctx.fillText('DS-01', 0, 10);

        // --- MANIPULATOR ARM (small, folded along hull) ---
        ctx.strokeStyle = '#2A4050'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(10, 6); ctx.lineTo(14, 8); ctx.lineTo(13, 11); ctx.stroke();
        // Claw
        ctx.beginPath(); ctx.moveTo(13, 11); ctx.lineTo(14, 13); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(13, 11); ctx.lineTo(12, 13); ctx.stroke();

        ctx.restore();
        ctx.globalAlpha = 1;

        // --- WAKE TURBULENCE (behind sub when moving) ---
        if (spd > 20) {
            const wakeAngle = hlAngle + Math.PI;
            const wakeAlpha = Math.min(0.12, spd / (p.speed || 200) * 0.15);
            for (let wi = 0; wi < 3; wi++) {
                const wd = 20 + wi * 12;
                const wSpread = wi * 8;
                const wx = px2 + Math.cos(wakeAngle) * wd + (Math.random() - 0.5) * wSpread;
                const wy = py2 + Math.sin(wakeAngle) * wd + (Math.random() - 0.5) * wSpread;
                ctx.fillStyle = `rgba(60,100,120,${wakeAlpha * (1 - wi * 0.3)})`;
                ctx.beginPath(); ctx.arc(wx, wy, 3 + wi * 2, 0, PI2); ctx.fill();
            }
        }

        // Update facing angle (smooth, sluggish — underwater inertia)
        const fvx = p._vx || 0, fvy = p._vy || 0;
        if (Math.abs(fvx) > 5 || Math.abs(fvy) > 5) {
            const target = Math.atan2(fvy, fvx);
            let diff = target - (p._facing || 0);
            while (diff > Math.PI) diff -= PI2;
            while (diff < -Math.PI) diff += PI2;
            p._facing = (p._facing || 0) + diff * 0.08; // slow rotation — heavy vessel
        }
    }

    // --- TETHER LINES — taut cable from wraith to hull ---
    for (const e of g.enemies) {
        if (e._tethered && e.hp > 0) {
            const sag = Math.sin(g.runTime * 9) * 3;
            ctx.strokeStyle = 'rgba(200,160,90,0.7)'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(e.x - cx, e.y - cy);
            ctx.quadraticCurveTo((e.x + g.player.x) / 2 - cx, (e.y + g.player.y) / 2 - cy + sag, g.player.x - cx, g.player.y - cy);
            ctx.stroke();
        }
    }

    // --- INK CLOUDS — occlude the world (drawn over creatures, under the darkness mask) ---
    for (const ic of (g.inkClouds || [])) {
        const sx = ic.x - cx, sy = ic.y - cy;
        const fade = Math.min(1, ic.t / 1.5);
        const grad = ctx.createRadialGradient(sx, sy, ic.r * 0.15, sx, sy, ic.r);
        grad.addColorStop(0, `rgba(4,4,10,${0.94 * fade})`);
        grad.addColorStop(0.75, `rgba(6,6,14,${0.8 * fade})`);
        grad.addColorStop(1, 'rgba(8,8,18,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(sx, sy, ic.r, 0, PI2); ctx.fill();
    }

    // --- DARKNESS OVERLAY (offscreen canvas approach — reliable) ---
    {
        const px2 = g.player.x - cx, py2 = g.player.y - cy;
        // Darkness creeps in slowly — first 3 min clear, max 70% (never full black)
        const darkDelay = Math.max(0, g.runTime - 180) / (1200 - 180);
        const _eco = !!(g._modeCfg && g._modeCfg.ecology);
        // DESCENT: the dark is the point — heavy from the first second; the headlight
        // is your only bubble, and going dark (L) nearly blinds you.
        let darkAlpha = Math.min(0.7, darkDelay * 0.7);
        if (_eco) darkAlpha = (g.lightOn === false) ? 0.93 : 0.82;
        // BLACKWATER — light does not work here at all; the world is your last ping
        if (g._inBlackwater) darkAlpha = 0.965;
        if (meta.hudContrast) darkAlpha = Math.max(0, darkAlpha - 0.06);

        if (darkAlpha > 0.03) {
            // Create offscreen darkness mask
            if (!g._darkCanvas || g._darkCanvas.width !== w || g._darkCanvas.height !== h) {
                g._darkCanvas = document.createElement('canvas');
                g._darkCanvas.width = w; g._darkCanvas.height = h;
            }
            const dCtx = g._darkCanvas.getContext('2d');

            // Fill with darkness
            dCtx.clearRect(0, 0, w, h);
            dCtx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
            dCtx.fillRect(0, 0, w, h);

            // Cut light holes
            dCtx.globalCompositeOperation = 'destination-out';

            // Player light (generous — you can always see around you)
            let lightR = Math.max(180, 400 * (1 - darkProgress * 0.45));
            if (_eco) lightR = (g.lightOn === false) ? 95 : 235; // your world shrinks to the lamp
            if (g._inBlackwater) lightR = 70;                    // blackwater swallows the lamps
            if (g._inInk) lightR = Math.min(lightR, 105);        // ink chokes them
            const grad = dCtx.createRadialGradient(px2, py2, 0, px2, py2, lightR);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
            grad.addColorStop(0.6, 'rgba(255,255,255,0.3)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            dCtx.fillStyle = grad;
            dCtx.beginPath(); dCtx.arc(px2, py2, lightR, 0, PI2); dCtx.fill();

            // Sonar reveal
            if (g.sonarReveal > 0) {
                const revealR = 500;
                const rGrad = dCtx.createRadialGradient(px2, py2, 0, px2, py2, revealR);
                rGrad.addColorStop(0, `rgba(255,255,255,${g.sonarReveal * 0.8})`);
                rGrad.addColorStop(0.6, `rgba(255,255,255,${g.sonarReveal * 0.4})`);
                rGrad.addColorStop(1, 'rgba(255,255,255,0)');
                dCtx.fillStyle = rGrad;
                dCtx.beginPath(); dCtx.arc(px2, py2, revealR, 0, PI2); dCtx.fill();
            }

            // Bioluminescent enemies
            for (const e of g.enemies) {
                if (e.typeId === 'anglerfish' || e.typeId === 'jellyfish') {
                    const esx = e.x - cx, esy = e.y - cy;
                    const eGrad = dCtx.createRadialGradient(esx, esy, 0, esx, esy, e.size * 3);
                    eGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
                    eGrad.addColorStop(1, 'rgba(255,255,255,0)');
                    dCtx.fillStyle = eGrad;
                    dCtx.beginPath(); dCtx.arc(esx, esy, e.size * 3, 0, PI2); dCtx.fill();
                }
            }

            // Lures
            for (const lu of g.lures) {
                const lsx = lu.x - cx, lsy = lu.y - cy;
                const lGrad = dCtx.createRadialGradient(lsx, lsy, 0, lsx, lsy, 50);
                lGrad.addColorStop(0, 'rgba(255,255,255,0.4)');
                lGrad.addColorStop(1, 'rgba(255,255,255,0)');
                dCtx.fillStyle = lGrad;
                dCtx.beginPath(); dCtx.arc(lsx, lsy, 50, 0, PI2); dCtx.fill();
            }

            // Explosions
            for (const ef of g.effects) {
                if (ef.type === 'explosion') {
                    const esx = ef.x - cx, esy = ef.y - cy;
                    const eGrad = dCtx.createRadialGradient(esx, esy, 0, esx, esy, ef.maxRadius * 1.5);
                    eGrad.addColorStop(0, `rgba(255,255,255,${ef.life})`);
                    eGrad.addColorStop(1, 'rgba(255,255,255,0)');
                    dCtx.fillStyle = eGrad;
                    dCtx.beginPath(); dCtx.arc(esx, esy, ef.maxRadius * 1.5, 0, PI2); dCtx.fill();
                }
            }

            dCtx.globalCompositeOperation = 'source-over';

            // Stamp darkness onto main canvas
            ctx.drawImage(g._darkCanvas, 0, 0);

            // --- EYESHINE (DESCENT horror): you see eyes in the dark before bodies ---
            // Unaware = faint cold glimmers, watching. Alerted = hot red, locked on you.
            if (_eco) {
                for (const e of g.enemies) {
                    if (e.hp <= 0) continue;
                    const esx = e.x - cx, esy = e.y - cy;
                    if (esx < -30 || esx > w + 30 || esy < -30 || esy > h + 30) continue;
                    const aw = e.awareness || 0;
                    const alerted = aw >= 0.5;
                    if (e._eyePhase == null) e._eyePhase = Math.random() * PI2;
                    const flick = 0.65 + 0.35 * Math.sin(g.runTime * 7 + e._eyePhase);
                    const rr = alerted ? 255 : 130;
                    const gg = alerted ? Math.floor(55 + 50 * (1 - aw)) : 225;
                    const bb = alerted ? 45 : 255;
                    const al = (alerted ? 0.9 : 0.18 + aw * 0.55) * flick;
                    const eyeR = (alerted ? 2.1 : 1.3) * (e._alertPulse > 0 ? 1 + e._alertPulse * 2.2 : 1);
                    const sp = (e.size || 10) * 0.32 + 1.6;
                    const ang = Math.atan2(g.player.y - e.y, g.player.x - e.x); // eyes face you
                    const fx = Math.cos(ang), fy = Math.sin(ang), ox = -fy, oy = fx;
                    for (const sgn of [-1, 1]) {
                        const ex = esx + fx * 2.5 + ox * sp * sgn;
                        const ey = esy + fy * 2.5 + oy * sp * sgn;
                        ctx.fillStyle = `rgba(${rr},${gg},${bb},${(al * 0.3).toFixed(3)})`;
                        ctx.beginPath(); ctx.arc(ex, ey, eyeR * 2.6, 0, PI2); ctx.fill();
                        ctx.fillStyle = `rgba(${rr},${gg},${bb},${al.toFixed(3)})`;
                        ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, PI2); ctx.fill();
                    }
                }
            }
        }

        // --- PRESSURE PULSE VIGNETTE (always-on subtle breathing — immersion) ---
        // Pulse rate tied to depth — slow at surface, faster + tighter in the abyss
        {
            const depthT = Math.min(1, g.depth / 4000);
            const pulseRate = 0.55 + depthT * 0.35; // breaths per second-ish
            const breath = Math.sin(g.runTime * pulseRate * 2) * 0.5 + 0.5;
            const vBase = 0.18 + depthT * 0.32;
            const vAmp = 0.05 + depthT * 0.08;
            const vAlpha = vBase + breath * vAmp;
            const innerR = h * (0.42 - depthT * 0.10 - breath * 0.02);
            const outerR = h * (0.78 - depthT * 0.05);
            const pal2 = getDepthPalette(g.depth);
            const pr = parseInt(pal2.bg.slice(1,3),16), pgv = parseInt(pal2.bg.slice(3,5),16), pbv = parseInt(pal2.bg.slice(5,7),16);
            const presGrad = ctx.createRadialGradient(w / 2, h / 2, innerR, w / 2, h / 2, outerR);
            presGrad.addColorStop(0, `rgba(${pr},${pgv},${pbv},0)`);
            presGrad.addColorStop(0.6, `rgba(0,0,0,${vAlpha * 0.5})`);
            presGrad.addColorStop(1, `rgba(0,0,0,${vAlpha})`);
            ctx.fillStyle = presGrad;
            ctx.fillRect(0, 0, w, h);
        }

        // --- LOW HP HORROR EFFECTS ---
        const hpPct = g.player.hp / g.player.maxHp;
        if (hpPct < 0.3) {
            const vigAlpha = (0.3 - hpPct) * 0.8;
            const vigGrad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.7);
            vigGrad.addColorStop(0, 'rgba(0,0,0,0)');
            vigGrad.addColorStop(1, `rgba(80,0,0,${vigAlpha})`);
            ctx.fillStyle = vigGrad;
            ctx.fillRect(0, 0, w, h);
            if (Math.sin(Date.now() / 200) > 0.3) {
                ctx.strokeStyle = `rgba(150,0,0,${vigAlpha * 0.5})`;
                ctx.lineWidth = 4;
                ctx.strokeRect(2, 2, w - 4, h - 4);
            }
        }
        if (hpPct < 0.2 && Math.random() < 0.1) {
            ctx.fillStyle = 'rgba(255,0,0,0.03)';
            ctx.fillRect(Math.random() * w, 0, 2, h);
            ctx.fillStyle = 'rgba(0,0,255,0.03)';
            ctx.fillRect(Math.random() * w, 0, 2, h);
        }
    }

    // --- Floating texts (drop shadow for readability) ---
    for (const ft of g.floatingTexts) {
        const sx = ft.x - cx, sy = ft.y - cy;
        ctx.globalAlpha = Math.min(1, ft.life * 2);
        // Score pops are bigger and tagged with mult chip
        if (ft.score) {
            const mult = ft.mult || 1;
            const sz = 14 + Math.min(8, mult * 1.2);
            ctx.font = `bold ${sz}px monospace`;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillText(ft.text, sx + 1, sy + 1);
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, sx, sy);
            // Mult chip
            ctx.font = 'bold 11px monospace';
            ctx.fillStyle = 'rgba(255,200,80,0.85)';
            ctx.fillText(`×${mult.toFixed(1)}`, sx, sy + 12);
        } else {
            ctx.font = 'bold 13px monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillText(ft.text, sx + 1, sy + 1);
            ctx.fillStyle = ft.color;
            ctx.fillText(ft.text, sx, sy);
        }
        ctx.globalAlpha = 1;
    }

    // --- Flash overlay ---
    if (g.flashTimer > 0) {
        ctx.fillStyle = `rgba(255,255,255,${g.flashTimer})`;
        ctx.fillRect(0, 0, w, h);
    }

    // --- WATER CAUSTICS (shallow depth — dappled light) ---
    if (g.depth < 500) {
        const caustAlpha = 0.04 * (1 - g.depth / 500);
        ctx.globalAlpha = caustAlpha;
        ctx.fillStyle = '#5ADFCF';
        for (let ci = 0; ci < 12; ci++) {
            const cx2 = (Math.sin(t * 0.3 + ci * 2.1) * 0.5 + 0.5) * w;
            const cy2 = (Math.cos(t * 0.25 + ci * 1.7) * 0.5 + 0.5) * h;
            ctx.beginPath(); ctx.arc(cx2, cy2, 30 + Math.sin(t + ci) * 15, 0, PI2); ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    // (god rays removed)

    // --- VENT GLOW (deep zones — distant red/orange thermal vents glow upward from below) ---
    if (g.depth > 2200 && g.depth < 5500) {
        const ventPow = Math.min(1, (g.depth - 2200) / 1800);
        const ventGrad = ctx.createLinearGradient(0, h * 0.6, 0, h);
        ventGrad.addColorStop(0, 'rgba(0,0,0,0)');
        ventGrad.addColorStop(1, `rgba(180,60,40,${0.06 * ventPow * (0.7 + Math.sin(t * 0.4) * 0.3)})`);
        ctx.fillStyle = ventGrad;
        ctx.fillRect(0, h * 0.6, w, h * 0.4);
    }

    // --- UNDERWATER COLOR GRADE (teal tint — everything feels submerged) ---
    ctx.fillStyle = 'rgba(10,30,40,0.08)';
    ctx.fillRect(0, 0, w, h);

    // --- SOFT SCANLINES (barely there — texture, not obstruction) ---
    ctx.fillStyle = 'rgba(0,0,0,0.025)';
    for (let sl = 0; sl < h; sl += 4) {
        ctx.fillRect(0, sl, w, 1);
    }

    // --- GENTLE VIGNETTE (cinematic, not claustrophobic) ---
    const vigGrad2 = ctx.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, h * 0.85);
    vigGrad2.addColorStop(0, 'rgba(0,0,0,0)');
    vigGrad2.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = vigGrad2;
    ctx.fillRect(0, 0, w, h);

    // --- WORLD BOUNDS — solid trench walls, drawn LAST so nothing past them is visible ---
    drawWorldBoundsWalls(g, cx, cy, w, h);

    // --- Glass reflection on viewport (subtle top-left highlight) ---
    const reflGrad = ctx.createRadialGradient(vpCx - vpRadius * 0.3, vpCy - vpRadius * 0.3, 0, vpCx, vpCy, vpRadius);
    reflGrad.addColorStop(0, 'rgba(180,220,240,0.04)');
    reflGrad.addColorStop(0.5, 'rgba(180,220,240,0)');
    reflGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = reflGrad;
    ctx.fillRect(0, 0, w, h);

    // Close circular viewport clip
    ctx.restore();

    // --- MINIMAL HUD — viewport-only immersion (everything else stripped) ---
    drawMinimalHUD(w, h, g, pal, vpCx, vpCy, vpRadius);

    // --- NEREID SPEECH PANEL (centered below viewport, in player's natural focus) ---
    drawNereidSpeech(w, h, g, pal, vpCx, vpCy, vpRadius);

    // --- SANITY DEGRADATION VISUALS (corruption > 30 = sanity < 70) ---
    const corr = g.player.corruption || 0;
    if (corr > 30) {
        const ci = (corr - 30) / 70; // 0-1 intensity
        // Feature 2: Occasional screen static at >40
        if (corr > 40 && Math.random() < ci * 0.08) {
            const scanY = Math.random() * h;
            const brightness = 0.05 + Math.random() * 0.08;
            ctx.fillStyle = `rgba(200,220,255,${brightness})`;
            ctx.fillRect(0, scanY, w, 1 + Math.random() * 2);
        }
        // Neural static — horizontal scan lines
        if (Math.random() < ci * 0.06) {
            const scanY = Math.random() * h;
            ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '80,20,60' : '20,40,60'},${ci * 0.04})`;
            ctx.fillRect(0, scanY, w, 1 + Math.random() * 2);
            if (ci > 0.5 && Math.random() < 0.3) {
                ctx.drawImage(canvas, 0, scanY, w, 3, (Math.random() - 0.5) * 4, scanY, w, 3);
            }
        }
        // Phantom contacts (ghost enemies already handle this with real enemies, but add visual hint)
        if (corr > 60 && Math.random() < 0.004) {
            const fx = Math.random() * w, fy = Math.random() * h;
            ctx.globalAlpha = 0.06 + ci * 0.04;
            ctx.fillStyle = '#000';
            ctx.beginPath(); ctx.arc(fx, fy, 10 + Math.random() * 15, 0, PI2); ctx.fill();
            ctx.globalAlpha = 1;
        }
        // Edge colour bleed at extreme sanity loss
        if (corr > 75) {
            ctx.globalAlpha = (corr - 75) / 25 * 0.06;
            ctx.fillStyle = '#300020';
            ctx.fillRect(0, 0, 3, h); ctx.fillRect(w - 3, 0, 3, h);
            ctx.globalAlpha = 1;
        }
        // Feature 2: Chromatic aberration at high corruption
        if (corr > 60) {
            const aberration = (corr - 60) / 40 * 4; // 0-4px offset
            ctx.globalAlpha = 0.06;
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(canvas, aberration, 0, w - aberration, h, 0, 0, w - aberration, h);
            ctx.drawImage(canvas, 0, aberration, w, h - aberration, 0, 0, w, h - aberration);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
        }
        // Feature 2: Screen inversion flash at >90
        if (corr > 90 && Math.random() < 0.005) {
            ctx.globalAlpha = 0.15;
            ctx.fillStyle = 'rgba(255,255,255,1)';
            ctx.globalCompositeOperation = 'difference';
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            // Hostile NEREID lines at maximum corruption (trigger from update, but we can queue it)
            if (!g._lastInversionMsg || g.runTime - g._lastInversionMsg > 8) {
                g._lastInversionMsg = g.runTime;
                addNereidLog(g, NEREID.wave[NEREID.wave.length - 1].lines[Math.floor(Math.random() * NEREID.wave[NEREID.wave.length - 1].lines.length)]);
            }
        }
    }

    // --- Event overlay ---
    if (phase === 'event' && g.activeEvent) drawEventOverlay(w, h, g);

    // --- Level-up overlay ---
    if (phase === 'levelup') drawLevelUp(w, h, g);
    if (phase === 'inventory') drawInventory(w, h, g);
    if (phase === 'runshop') drawRunShop(w, h, g);
    if (phase === 'death') drawDeathScreen(w, h, g);

    // (Minimap removed — viewport itself is the radar; THREAT count on right rail handles awareness)

    // Feature 5: Chain counter HUD
    if ((phase === 'playing' || phase === 'paused') && g.chainDisplayTimer > 0) {
        const alpha = Math.min(1, g.chainDisplayTimer);
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = 'bold 36px monospace';
        const chainColor = g.cascadeCount >= 10 ? '#FF2020' : g.cascadeCount >= 7 ? '#FF6040' : '#FFD040';
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(`x${g.cascadeCount} CHAIN`, w/2+2, h/2+2);
        ctx.fillStyle = chainColor;
        ctx.fillText(`x${g.cascadeCount} CHAIN`, w/2, h/2);
        ctx.globalAlpha = 1;
    }

    // Feature 1: Pause overlay (drawn last so it's on top)
    if (phase === 'paused') drawPauseOverlay(w, h, g);

    // Feature 10: Touch controls overlay
    if (touchUI() && phase === 'playing') {
        drawTouchControls(w, h);
    }
}

// =====================================================================
// NEREID SPEECH PANEL — anchored below the viewport, centered, persistent
// Shows the latest line in player's natural focus area, with portrait + typing
// =====================================================================
function drawNereidSpeech(w, h, g, pal, vpCx, vpCy, vpR) {
    if (!g.nereidLog || !g.nereidLog.length) return;
    const latest = g.nereidLog[0];
    const age = g.runTime - latest.time;
    const SHOW_TIME = 9.0;
    const FADE_TIME = 1.2;
    if (age >= SHOW_TIME) return;
    const sanity = 100 - (g.player.corruption || 0);
    // Depth degradation: NEREID's transmissions also corrupt with depth, even at full sanity
    const depthCorrupt = g.depth > 4000 ? Math.min(60, (g.depth - 4000) / 30) : 0;
    const txt = corruptText(latest.text, Math.max(100 - sanity, depthCorrupt));
    // Word-wrap to ~58 chars per line, up to 5 lines (longer text truncates with ellipsis).
    const maxChars = 58;
    const maxLines = 5;
    const words = txt.split(' ');
    const lines = [];
    let cur = '';
    for (const word of words) {
        const test = cur ? cur + ' ' + word : word;
        if (test.length > maxChars) {
            if (cur) lines.push(cur);
            cur = word;
        } else {
            cur = test;
        }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 3) + '...';
    }
    // Anchor BELOW the rim arcs (which extend to vpR + 22 for labels). No overlap with vitals.
    // Full-bleed (landscape phone): bottom-centre, narrow — clear of the top
    // bars, the sonar (bottom-left) and the contracts list (bottom-right).
    const panelW = g._fullBleed ? Math.min(430, w * 0.5) : Math.min(640, w * 0.7);
    const lineH = 14;
    const panelH = 22 + lines.length * lineH;
    const panelX = vpCx - panelW / 2;
    const minY = g._fullBleed ? h - panelH - 8 : vpCy + vpR + 44;
    const maxY = h - panelH - 6;
    const panelY = Math.max(6, Math.min(maxY, minY));

    // Fade
    let alpha = 1;
    if (age > SHOW_TIME - FADE_TIME) alpha = (SHOW_TIME - age) / FADE_TIME;
    ctx.globalAlpha = alpha;

    // Backdrop — dark glass with accent border
    ctx.fillStyle = 'rgba(2,8,12,0.78)';
    ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, panelH, 6); ctx.fill();
    // Top accent bar (color tied to sanity — teal calm → purple warning → red corrupted)
    const accent = sanity > 60 ? pal.accent : sanity > 30 ? '#A06ACC' : '#DA4060';
    ctx.fillStyle = accent;
    ctx.fillRect(panelX, panelY, panelW, 1.5);
    ctx.strokeStyle = hexA(accent, 0.35); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(panelX, panelY, panelW, panelH, 6); ctx.stroke();

    // NEREID portrait — small pulsing waveform/eye on the left
    const portR = 14;
    const portCx = panelX + 18, portCy = panelY + panelH / 2;
    // Outer halo
    drawGlow(ctx, accent, portCx, portCy, portR + 4, 0.6);
    // Iris ring
    ctx.strokeStyle = accent; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(portCx, portCy, portR - 2, 0, PI2); ctx.stroke();
    // Pupil — pulses with speech
    const pulse = 0.55 + Math.sin(g.runTime * 4) * 0.25;
    ctx.fillStyle = hexA(accent, pulse);
    ctx.beginPath(); ctx.arc(portCx, portCy, 4, 0, PI2); ctx.fill();
    // Inner waveform — 3 short vertical bars
    ctx.fillStyle = hexA(accent, 0.7);
    for (let bi = 0; bi < 3; bi++) {
        const bh = 3 + Math.abs(Math.sin(g.runTime * 6 + bi * 1.5)) * 6;
        ctx.fillRect(portCx + portR + 4 + bi * 3, portCy - bh / 2, 1.5, bh);
    }

    // Label "NEREID"
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = hexA(accent, 0.8);
    ctx.fillText('NEREID-II', panelX + 50, panelY + 14);

    // Spoken text — typewriter reveal across N lines
    const charsPerSec = 55;
    const fullText = lines.join('\n');
    const revealCount = Math.min(fullText.length, Math.floor(age * charsPerSec));
    const shown = fullText.slice(0, revealCount);
    const shownLines = shown.split('\n');

    ctx.font = '12px monospace';
    ctx.fillStyle = sanity > 30 ? '#DCEAE2' : '#E8B4C0';
    for (let li = 0; li < shownLines.length; li++) {
        ctx.fillText(shownLines[li], panelX + 50, panelY + 28 + li * lineH);
    }

    // Typing cursor on the last revealed line
    if (revealCount < fullText.length && Math.sin(g.runTime * 8) > 0) {
        const lastLine = shownLines[shownLines.length - 1] || '';
        const cw = ctx.measureText(lastLine).width;
        ctx.fillStyle = accent;
        ctx.fillRect(panelX + 50 + cw + 1, panelY + 18 + (shownLines.length - 1) * lineH, 5, 2);
    }

    ctx.globalAlpha = 1;
}

// =====================================================================
// SIDE INSTRUMENT RAILS — fills dead space left + right of the porthole
// Left  = Hull telemetry (pressure, temp, integrity, compass)
// Right = Combat computer (combo chain, mult, threats, sonar status)
// =====================================================================
// =====================================================================
// SIDE PANELS — left + right carry ALL info. No top/bottom panels.
// Panels span full screen height, anchored to screen edges.
// =====================================================================
// =====================================================================
// MINIMAL HUD — viewport-only immersion. Nothing rendered unless essential.
// Layout philosophy:
//   - Tiny corner readouts (depth, score) — always visible but quiet
//   - Vitals (HP, MIND) — visible only when low or recently changed
//   - Cooldown indicators on the sub itself (in-world, diegetic)
//   - NEREID dialog appears in dedicated strip below porthole only when speaking
//   - Salvage prompt only when near a wreck
// =====================================================================
function drawMinimalHUD(w, h, g, pal, vpCx, vpCy, vpR) {
    const p = g.player;

    // ---- ANNOUNCEMENT BANNER — streak text was set in 25 places but never drawn
    // since the HUD rework. Zone crossings render as big title cards (Subnautica). ----
    if (g.streakTimer > 0 && g.streak) {
        const fade = Math.min(1, g.streakTimer / 0.4);
        const big = g._streakBig;
        ctx.textAlign = 'center';
        ctx.font = big ? 'bold 30px monospace' : 'bold 15px monospace';
        const tw = ctx.measureText(g.streak).width;
        const by = big ? Math.max(h * 0.3, 150) : Math.max(h * 0.22, 132);
        ctx.globalAlpha = fade;
        drawPlate(w / 2 - tw / 2 - 18, by - (big ? 28 : 16), tw + 36, big ? 42 : 26);
        ctx.fillStyle = big ? (g._streakColor || '#BFEAE0') : '#DCEAE2';
        ctx.fillText(g.streak, w / 2, by + (big ? 4 : 2));
        if (big) {
            ctx.strokeStyle = hexA(g._streakColor || '#5ADFCF', 0.7); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(w / 2 - tw / 2, by + 12); ctx.lineTo(w / 2 + tw / 2, by + 12); ctx.stroke();
        }
        ctx.globalAlpha = 1;
    } else if (g._streakBig) { g._streakBig = false; g._streakColor = null; }

    // ---- ONBOARDING HINT — one mechanic, in the moment it matters (Portal) ----
    if (g._hint) {
        ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
        const tw = ctx.measureText(g._hint.text).width;
        const hy = 58;
        ctx.globalAlpha = Math.min(1, g._hint.t / 0.5);
        drawPlate(w / 2 - tw / 2 - 14, hy - 15, tw + 28, 24);
        ctx.fillStyle = '#A8E8D8';
        ctx.fillText(g._hint.text, w / 2, hy + 2);
        ctx.globalAlpha = 1;
    }

    // ---- BOTTOM-LEFT corner: DEPTH (with ASCENT indicator if ascending) ----
    ctx.textAlign = 'left';
    const dColor = g.ascending ? '#80FFA0' : pal.accent;
    ctx.fillStyle = hexA(dColor, 0.9); ctx.font = 'bold 18px monospace';
    ctx.fillText(`${Math.floor(g.depth)}m`, 16, h - 22);
    ctx.fillStyle = hexA(pal.textDim, 0.85); ctx.font = '11px monospace';
    ctx.fillText(g.ascending ? '↑ ASCENDING' : pal.zone, 16, h - 8);
    // Show [Z] ASCEND prompt only when descending and we've gone deep enough
    if (!g.ascending && g.depth > 200) {
        ctx.fillStyle = hexA(pal.textDim, 0.55); ctx.font = '10px monospace';
        ctx.fillText('[Z] ASCEND', 16, h - 38);
    }
    // LEFT-EDGE STATUS STACK — lives under the radar in the porthole's dead
    // margin; the bottom-left corner keeps only depth + ascend.
    {
        const _mmr = touchUI() && Math.min(w, h) < 520 ? 48 : 52;
        let sy = _mmr * 2 + 64 + 26;   // just below the (now top-left) radar
        ctx.textAlign = 'left';
        if (g.silent) {
            const sPulse = 0.5 + Math.sin(g.runTime * 3) * 0.35;
            ctx.fillStyle = hexA('#80E0FF', sPulse); ctx.font = 'bold 12px monospace';
            ctx.fillText('◈ SILENT RUNNING', 16, sy);
            ctx.fillStyle = hexA('#80E0FF', 0.45); ctx.font = '9px monospace';
            ctx.fillText('[Q] weapons free', 16, sy + 12);
            sy += 30;
        }
        if (g.modeMsgTimer > 0 && g.modeMsg) {
            ctx.globalAlpha = Math.min(1, g.modeMsgTimer / 0.35);
            ctx.fillStyle = '#8FE8FF'; ctx.font = 'bold 11px monospace';
            ctx.fillText(g.modeMsg, 16, sy);
            ctx.globalAlpha = 1;
            sy += 18;
        }
        if ((g.attention || 0) > 20) {
            const at = g.attention / 100;
            ctx.fillStyle = hexA(at > 0.6 ? '#FF7060' : '#D8B060', 0.75); ctx.font = 'bold 10px monospace';
            ctx.fillText('ATTENTION', 16, sy);
            ctx.fillStyle = '#141C24'; ctx.fillRect(80, sy - 8, 70, 7);
            ctx.fillStyle = hexA(at > 0.6 ? '#FF7060' : '#D8B060', 0.8); ctx.fillRect(80, sy - 8, 70 * at, 7);
            sy += 18;
        }
        const beltItems = (g.inventory || []).filter(it => it.belt).slice(0, 2);
        if (beltItems.length) {
            ctx.font = '10px monospace';
            ctx.fillStyle = hexA('#5AD0FF', 0.7);
            for (let bi = 0; bi < beltItems.length; bi++) {
                ctx.fillText(`[${bi + 1}] ${beltItems[bi].name}`, 16, sy);
                sy += 14;
            }
        }
    }

    // ---- TOP-RIGHT: LOADOUT (weapons first, then cards + level-up upgrades) ----
    const loadout = [];
    for (const wp of (g.player.weapons || [])) {
        const def = WEAPON_DEFS[wp.id] || {};
        loadout.push({ id: 'w_' + wp.id, name: def.name || wp.id, src: 'wpn', glyph: WEAPON_GLYPHS[wp.id] || '⨁', lvl: wp.level, evolved: def.evolved });
    }
    for (const c of (g.selectedCards || [])) loadout.push({ id: c.id, name: c.name, src: 'card' });
    for (const u of (g.pickedUpgrades || [])) loadout.push({ id: u.id, name: u.name, src: 'lvl' });
    if (loadout.length) {
        const iconSize = 24, gap = 3;
        const rows = Math.ceil(loadout.length / 8);
        const cols = Math.min(8, loadout.length);
        const startX = w - 16 - cols * (iconSize + gap) + gap;
        let topY = 16;
        for (let i = 0; i < loadout.length; i++) {
            const u = loadout[i];
            const ic = u.src === 'wpn'
                ? { glyph: u.glyph, color: u.evolved ? '#FF80FF' : '#E8C860' }
                : upgradeIcon(u.name || u.id);
            const r = Math.floor(i / 8), c = i % 8;
            const ix = startX + c * (iconSize + gap);
            const iy = topY + r * (iconSize + gap);
            // Icon background — different border for weapons vs cards vs level-up
            ctx.fillStyle = 'rgba(8,12,18,0.85)';
            ctx.beginPath(); ctx.roundRect(ix, iy, iconSize, iconSize, 3); ctx.fill();
            ctx.strokeStyle = u.src === 'wpn' ? hexA(ic.color, 0.9) : u.src === 'card' ? hexA('#A06ACC', 0.7) : hexA(ic.color, 0.6);
            ctx.lineWidth = u.src === 'wpn' ? 1.5 : 1;
            ctx.beginPath(); ctx.roundRect(ix, iy, iconSize, iconSize, 3); ctx.stroke();
            // Glyph
            ctx.fillStyle = ic.color; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
            ctx.fillText(ic.glyph, ix + iconSize / 2, iy + iconSize / 2 + 5);
            // Weapon level pip
            if (u.src === 'wpn' && u.lvl) {
                ctx.fillStyle = u.lvl >= 8 ? '#FFD040' : '#9AB0C0'; ctx.font = 'bold 8px monospace';
                ctx.fillText(String(u.lvl), ix + iconSize - 5, iy + iconSize - 3);
            }
            // Hover tooltip — show name if mouse is over the icon
            if (mouseX >= ix && mouseX <= ix + iconSize && mouseY >= iy && mouseY <= iy + iconSize) {
                const tt = u.name;
                ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right';
                const ttW = ctx.measureText(tt).width + 12;
                const ttX = ix + iconSize - ttW;
                const ttY = iy + iconSize + 4;
                ctx.fillStyle = 'rgba(8,12,18,0.92)';
                ctx.beginPath(); ctx.roundRect(ttX, ttY, ttW, 16, 3); ctx.fill();
                ctx.strokeStyle = ic.color; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.roundRect(ttX, ttY, ttW, 16, 3); ctx.stroke();
                ctx.fillStyle = ic.color;
                ctx.fillText(tt, ttX + ttW - 6, ttY + 11);
            }
        }
        // Section label
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'right';
        ctx.fillStyle = hexA(pal.textDim, 0.55);
        ctx.fillText('LOADOUT', w - 16, 12);
    }

    // ---- BOTTOM-RIGHT corner: SCORE + GOLD + INVENTORY ----
    ctx.textAlign = 'right';
    const flash = Math.min(1, g.scoreFlash || 0);
    ctx.fillStyle = flash > 0.05 ? '#FFFFA0' : hexA('#FFE082', 0.85);
    ctx.font = `bold ${16 + flash * 4}px monospace`;
    ctx.fillText((g.score || 0).toLocaleString(), w - 16, h - 22);
    ctx.fillStyle = hexA(pal.textDim, 0.85); ctx.font = '11px monospace';
    ctx.fillText('SCORE', w - 16, h - 8);
    // Gold + inventory chip (no in-dive shop — shop is surface-only)
    ctx.fillStyle = '#DAA520'; ctx.font = 'bold 13px monospace';
    ctx.fillText(`${g.goldEarned}g`, w - 16, h - 38);
    if (g.inventory && g.inventory.length > 0) {
        ctx.fillStyle = hexA(pal.accent, 0.7); ctx.font = '11px monospace';
        ctx.fillText(`[TAB]  ${g.inventory.length}/50 SALVAGE`, w - 16, h - 50);
    }

    // ---- VITALS — three EQUAL 120° arcs around the viewport rim, distinct colors ----
    //   TOP    (12 o'clock zone)   = XP / LEVEL — BLUE
    //   BOTTOM-RIGHT (4 o'clock)   = MIND       — PURPLE
    //   BOTTOM-LEFT  (8 o'clock)   = HULL       — RED
    // Small angular GAP between each so they read as three separate bars.
    const hpPct  = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const sanity = 100 - (p.corruption || 0);
    const xpPct  = Math.max(0, Math.min(1, p.xp / xpForLevel(p.level)));
    const HULL_COLOR = '#E04050';
    const MIND_COLOR = '#A060D0';
    const XP_COLOR   = '#4A9ADA';
    const ringR = vpR + 14;
    const SEG = (PI2 / 3);          // 120° per arc
    const GAP = 0.06;                // small gap between arcs (radians)
    const HALF = SEG / 2 - GAP / 2;

    // Each arc spans HALF radians on each side of its centerline.
    // XP centerline = top   (-PI/2)
    // MIND centerline = bottom-right (-PI/2 + 2PI/3 = PI/6)
    // HULL centerline = bottom-left  (-PI/2 - 2PI/3 = -7PI/6 = 5PI/6)
    function drawArc(centerA, pct, color, label, valueText) {
        const startA = centerA - HALF;
        const endA   = centerA + HALF;
        // Track
        ctx.strokeStyle = 'rgba(8,12,20,0.85)'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.arc(vpCx, vpCy, ringR, startA, endA); ctx.stroke();
        // Fill — sweeps from startA → startA + pct * (endA - startA)
        if (pct > 0) {
            const fillEnd = startA + pct * (endA - startA);
            ctx.strokeStyle = color; ctx.lineWidth = 5;
            ctx.beginPath(); ctx.arc(vpCx, vpCy, ringR, startA, fillEnd); ctx.stroke();
            // Glow halo
            ctx.strokeStyle = hexA(color, 0.22); ctx.lineWidth = 14;
            ctx.beginPath(); ctx.arc(vpCx, vpCy, ringR, startA, fillEnd); ctx.stroke();
        }
        // Label outside the arc midpoint
        const lr = ringR + 22;
        const lx = vpCx + Math.cos(centerA) * lr;
        const ly = vpCy + Math.sin(centerA) * lr;
        ctx.font = 'bold 12px monospace';
        const cosA = Math.cos(centerA);
        ctx.textAlign = (cosA > 0.2) ? 'left' : (cosA < -0.2) ? 'right' : 'center';
        ctx.fillStyle = pal.textDim;
        ctx.fillText(label, lx, ly);
        ctx.fillStyle = color; ctx.font = 'bold 14px monospace';
        ctx.fillText(valueText, lx, ly + 16);
    }

    if (g._fullBleed) {
        // Phone HUD (landscape): XP hairline across the top, then compact
        // fixed-width HULL and MIND bars grouped LEFT with inline labels —
        // clear of the loadout icons (top-right) and everything below.
        const bar = (x, y, bw, bh, pct, color) => {
            ctx.fillStyle = 'rgba(8,12,20,0.8)'; ctx.fillRect(x, y, bw, bh);
            ctx.fillStyle = color; ctx.fillRect(x, y, bw * Math.max(0, Math.min(1, pct)), bh);
        };
        bar(0, 0, w, 3, xpPct, XP_COLOR);
        bar(8, 8, 140, 5, hpPct, HULL_COLOR);
        bar(8, 22, 140, 5, sanity / 100, MIND_COLOR);
        ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = HULL_COLOR; ctx.fillText(`HULL ${Math.max(0, Math.floor(p.hp))}`, 154, 15);
        ctx.fillStyle = MIND_COLOR; ctx.fillText(`MIND ${Math.floor(sanity)}%`, 154, 29);
        ctx.fillStyle = XP_COLOR;   ctx.fillText(`LV ${p.level}`, 230, 15);
    } else {
        drawArc(-Math.PI / 2,  xpPct, XP_COLOR,   `LV ${p.level}`, `${p.xp}/${xpForLevel(p.level)}`);
        drawArc(Math.PI / 6,   sanity / 100, MIND_COLOR, 'MIND', `${Math.floor(sanity)}%`);
        drawArc(5 * Math.PI / 6, hpPct, HULL_COLOR, 'HULL', `${Math.max(0, Math.floor(p.hp))}/${p.maxHp}`);
    }

    // (MIND eye removed 12/07 — at low corruption it read as a stray purple
    // glitch by the MIND arc, and the arc already tells the number.)

    // BATTERY (small inline indicator below depth, not an arc)
    const bat = p.battery != null ? p.battery : 100;
    if (bat < 90) {
        const batColor = bat > 50 ? '#FFD040' : bat > 20 ? '#FF8040' : '#DA4060';
        ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = batColor;
        ctx.fillText(`PWR ${Math.floor(bat)}%`, 16, h - 50);
    }
    // REPAIR KITS — show count if any held
    const kits = (g.inventory || []).filter(it => it.id === 'repair_kit').length;
    if (kits > 0) {
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
        ctx.fillStyle = '#80FFA0';
        ctx.fillText(`[R] REPAIR KIT  ×${kits}`, 16, h - 64);
    }

    // ---- SALVAGE PROMPT (only when near a wreck) ----
    if (g.nearestWreck) {
        const wr = g.nearestWreck;
        const pulse = 0.6 + Math.sin(g.runTime * 4) * 0.3;
        const promptY = vpCy + vpR + 18;
        ctx.textAlign = 'center'; ctx.font = 'bold 11px monospace';
        ctx.fillStyle = `rgba(255, 208, 64, ${pulse})`;
        const prompt = wr.revealed ? `[ HOLD E ]  SALVAGE  →  ${wr.loot.label}` : '[ HOLD E ]  SALVAGE  →  ??? (ping to scan)';
        ctx.fillText(prompt, vpCx, promptY);
        // Salvage progress ring
        if (g.salvageHoldTime > 0) {
            const pct = Math.min(1, g.salvageHoldTime / 1.5);
            ctx.strokeStyle = '#FFD040'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(vpCx, promptY + 14, 10, -Math.PI / 2, -Math.PI / 2 + pct * PI2); ctx.stroke();
        }
    }

    // ---- MINIMAP — always on. Sonar Array upgrade boosts range/detail.
    drawCompactMinimap(w, h, g, pal);

    // ---- OBJECTIVES — bottom-right compact list, always visible, fades when complete ----
    if (g.objectives && g.objectives.length) {
        const blockH = 14 + g.objectives.length * 18;
        const startY = h - blockH - 80; // above the score/gold/TAB cluster
        ctx.textAlign = 'right'; ctx.font = 'bold 10px monospace';
        ctx.fillStyle = hexA(pal.accent, 0.65);
        ctx.fillText('DIVE BRIEF', w - 16, startY);
        let oy = startY + 12;
        for (const o of g.objectives) {
            const pct = Math.max(0, Math.min(1, o.progress / o.target));
            const dotCol = o.complete ? '#80E0A0' : pal.accent;
            // Status dot on the right edge
            ctx.fillStyle = dotCol;
            ctx.beginPath(); ctx.arc(w - 12, oy + 4, 2.5, 0, PI2); ctx.fill();
            // Brief — right-aligned, leaves room for dot
            ctx.fillStyle = o.complete ? hexA('#A0E8B0', 0.7) : hexA(pal.text, 0.85);
            ctx.font = '11px monospace';
            const briefMax = 60;
            const brief = o.brief.length > briefMax ? o.brief.slice(0, briefMax - 1) + '…' : o.brief;
            ctx.fillText(brief, w - 22, oy + 7);
            // Mini progress bar — anchored to right edge, 160px wide
            const barX = w - 16 - 160;
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(barX, oy + 11, 160, 2);
            ctx.fillStyle = dotCol;
            ctx.fillRect(barX, oy + 11, 160 * pct, 2);
            oy += 18;
        }
    }

    // ---- LEVEL UP READY indicator (only when at level threshold) ----
    // Already handled by phase === 'levelup' overlay
}

// Compact minimap — top-right corner, away from porthole. Only renders when unlocked.
function drawCompactMinimap(w, h, g, pal) {
    const mmR = touchUI() && Math.min(w, h) < 520 ? 48 : 52;
    // BOTTOM-LEFT — clear of the top-right loadout strip. Above the depth/zone display.
    // Top-left on every platform — the bottom-left corner was a traffic jam
    // (radar + silent + attention + belt + depth all stacked there).
    const mmCx = mmR + 18;
    const mmCy = mmR + 64;
    const wb = g.worldBounds;
    const trenchR = (wb && wb.radius) || 1000;
    // Scale: trench fits within minimap radius
    const scale = (mmR - 4) / trenchR;
    // Background ring (matches the trench shape — circular, like the actual world)
    ctx.fillStyle = 'rgba(2,8,14,0.85)';
    ctx.beginPath(); ctx.arc(mmCx, mmCy, mmR, 0, PI2); ctx.fill();
    ctx.strokeStyle = hexA(pal.accent, 0.55); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mmCx, mmCy, mmR, 0, PI2); ctx.stroke();
    // Trench rim (where the wall is)
    ctx.strokeStyle = 'rgba(180,40,40,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mmCx, mmCy, mmR - 4, 0, PI2); ctx.stroke();
    // Sweep line (sonar effect)
    const sweep = (g.runTime * 1.2) % PI2;
    const sgrad = ctx.createConicGradient ? null : null; // not all browsers
    ctx.save();
    ctx.beginPath(); ctx.arc(mmCx, mmCy, mmR - 4, 0, PI2); ctx.clip();
    ctx.strokeStyle = hexA(pal.accent, 0.35); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mmCx, mmCy);
    ctx.lineTo(mmCx + Math.cos(sweep - Math.PI/2) * mmR, mmCy + Math.sin(sweep - Math.PI/2) * mmR);
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(mmCx, mmCy, mmR - 4, 0, PI2); ctx.clip();
    // Player position (centered if camera is on them; show player relative to trench center)
    const p = g.player;
    const ppx = mmCx + (p.x - (wb.cx || 0)) * scale;
    const ppy = mmCy + (p.y - (wb.cy || 0)) * scale;
    // Enemies — small red dots (only those at similar depth)
    for (const e of g.enemies) {
        if (e.ghost) continue;
        const ex = mmCx + (e.x - (wb.cx || 0)) * scale;
        const ey = mmCy + (e.y - (wb.cy || 0)) * scale;
        ctx.fillStyle = e.isBoss ? '#FF2030' : 'rgba(220,80,80,0.85)';
        ctx.fillRect(ex - 1, ey - 1, e.isBoss ? 4 : 2, e.isBoss ? 4 : 2);
    }
    // Wrecks — gold squares
    for (const wr of (g.wrecks || [])) {
        if (wr.salvaged) continue;
        if (Math.abs((wr.obDepth || 0) - g.depth) > 80) continue;
        const wx = mmCx + (wr.x - (wb.cx || 0)) * scale;
        const wy = mmCy + (wr.y - (wb.cy || 0)) * scale;
        ctx.fillStyle = '#FFD040';
        ctx.fillRect(wx - 2, wy - 2, 4, 4);
    }
    // Player — bright dot in center (with heading triangle)
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(ppx, ppy, 3, 0, PI2); ctx.fill();
    const hl = p._facing || 0;
    ctx.beginPath();
    ctx.moveTo(ppx + Math.cos(hl) * 7, ppy + Math.sin(hl) * 7);
    ctx.lineTo(ppx + Math.cos(hl + 2.5) * 3, ppy + Math.sin(hl + 2.5) * 3);
    ctx.lineTo(ppx + Math.cos(hl - 2.5) * 3, ppy + Math.sin(hl - 2.5) * 3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // Label
    ctx.fillStyle = hexA(pal.textDim, 0.7); ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('SONAR', mmCx, mmCy + mmR + 12);
}

function drawPanelBg(x, y, w, h, pal) {
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, '#0A1218');
    grad.addColorStop(1, '#040810');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(127,168,150,0.02)';
    for (let yy = y + 4; yy < y + h; yy += 3) ctx.fillRect(x, yy, w, 1);
    const isLeftPanel = (x === 0);
    ctx.strokeStyle = hexA(pal.accent, 0.3); ctx.lineWidth = 2;
    const outerX = isLeftPanel ? 0.5 : x + w - 0.5;
    ctx.beginPath(); ctx.moveTo(outerX, y); ctx.lineTo(outerX, y + h); ctx.stroke();
    ctx.strokeStyle = hexA(pal.accentDim, 0.4); ctx.lineWidth = 1;
    const innerX = isLeftPanel ? x + w - 0.5 : x + 0.5;
    ctx.beginPath(); ctx.moveTo(innerX, y); ctx.lineTo(innerX, y + h); ctx.stroke();
}

// =====================================================================
// RIM BAR — an arc on the porthole rim that fills proportional to a stat.
// Same radius, same sweep length on both sides — mirror-symmetric and consistent.
// =====================================================================
function drawRimBar(g, vpCx, vpCy, vpR, side, label, pct, color, valueText, pal) {
    pct = Math.max(0, Math.min(1, pct));
    const ringR = vpR + 12;
    // Sweep covers the full vertical half (top → bottom along the side), 180° each.
    const startA = side === 'left' ? -Math.PI / 2 : -Math.PI / 2;  // both start at top (12 o'clock)
    const endA   = side === 'left' ?  Math.PI / 2 :  Math.PI / 2;  // both end at bottom (6 o'clock)
    const ccw    = side === 'left' ? true : false;                  // left = via 9 o'clock, right = via 3 o'clock
    // Track
    ctx.strokeStyle = 'rgba(8,12,20,0.9)';
    ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(vpCx, vpCy, ringR, startA, endA, ccw); ctx.stroke();
    // Fill — sweeps from top, filling proportional to pct
    if (pct > 0) {
        const sweep = Math.PI; // 180°
        const fillEnd = ccw ? (startA - pct * sweep) : (startA + pct * sweep);
        ctx.strokeStyle = color; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(vpCx, vpCy, ringR, startA, fillEnd, ccw); ctx.stroke();
        // Soft glow
        ctx.strokeStyle = hexA(color, 0.18); ctx.lineWidth = 14;
        ctx.beginPath(); ctx.arc(vpCx, vpCy, ringR, startA, fillEnd, ccw); ctx.stroke();
    }
    // Label — placed at the SIDE midpoint of the arc (9 o'clock for left, 3 o'clock for right)
    const labelA = side === 'left' ? Math.PI : 0;
    const labelR = ringR + 22;
    const lx = vpCx + Math.cos(labelA) * labelR;
    const ly = vpCy + Math.sin(labelA) * labelR;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = side === 'left' ? 'right' : 'left';
    ctx.fillStyle = pal.textDim;
    ctx.fillText(label, lx, ly - 6);
    ctx.fillStyle = color; ctx.font = 'bold 11px monospace';
    ctx.fillText(valueText, lx, ly + 8);
}

function drawPanelDivider(x, y, w, pal) {
    ctx.strokeStyle = hexA(pal.accentDim, 0.4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke();
}

function drawPanelBar(x, y, w, label, valueText, pct, color, pal) {
    pct = Math.max(0, Math.min(1, pct));
    ctx.fillStyle = '#040A10';
    ctx.beginPath(); ctx.roundRect(x, y + 10, w, 10, 3); ctx.fill();
    if (pct > 0) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(x + 1, y + 11, (w - 2) * pct, 8, 2); ctx.fill();
    }
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = pal.textDim;
    ctx.fillText(label, x, y + 7);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(valueText, x + w, y + 7);
}

function drawAbilityRow(x, y, w, key, label, state, ready, color, pal) {
    const h = 22;
    ctx.fillStyle = ready ? hexA(color, 0.18) : 'rgba(20,30,40,0.5)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.fill();
    ctx.strokeStyle = ready ? color : '#1A3040'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 3); ctx.stroke();
    // Key cap
    ctx.fillStyle = ready ? hexA(color, 0.32) : 'rgba(40,60,80,0.5)';
    ctx.beginPath(); ctx.roundRect(x + 3, y + 3, 36, h - 6, 2); ctx.fill();
    ctx.fillStyle = ready ? '#FFF' : pal.textDim; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(key, x + 21, y + h / 2 + 3);
    // Label
    ctx.fillStyle = ready ? '#DDEAE2' : pal.textDim; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    ctx.fillText(label, x + 44, y + h / 2 + 3);
    // State
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'right';
    ctx.fillStyle = ready ? color : pal.textDim;
    ctx.fillText(state, x + w - 6, y + h / 2 + 3);
}

// =====================================================================
// DEPTH ARC — ONE clean arc on the porthole rim. Iron Lung simplicity.
// Sweeps the LEFT half of the rim (top → bottom through left).
// Fills as you descend. Tick marks for major zones, labels OUTSIDE the ring zone.
// =====================================================================
// =====================================================================
// CORNER PANELS — small, flush against screen edges. Replace heavy side rails.
// Bottom-left: HP / MIND vertical bars
// Bottom-right: objectives stack
// Top-right: NEREID combo readout (SCORE × YIELD chips)
// =====================================================================
function drawCornerBar(x, y, w2, label, valueText, pct, color, pal) {
    pct = Math.max(0, Math.min(1, pct));
    ctx.fillStyle = '#040A10';
    ctx.beginPath(); ctx.roundRect(x, y + 8, w2, 8, 3); ctx.fill();
    if (pct > 0) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(x + 1, y + 9, (w2 - 2) * pct, 6, 2); ctx.fill();
    }
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = pal.textDim;
    ctx.fillText(label, x, y + 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(valueText, x + w2, y + 6);
}

// =====================================================================
// PORTHOLE RIM ARCS — instrument arcs that trace the viewport's circumference.
// LEFT: depth meter, fills clockwise as you descend (top → bottom).
// RIGHT: yield meter, fills with current YIELD multiplier.
// Their curve IS the viewport curve at radius vpR + 8.
// =====================================================================
function drawRailFrame(x, y, rw, rh, pal, label) {
    // Hull metal background with vertical gradient
    const bgGrad = ctx.createLinearGradient(x, y, x, y + rh);
    bgGrad.addColorStop(0, '#0A1218');
    bgGrad.addColorStop(0.5, '#060A12');
    bgGrad.addColorStop(1, '#040810');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(x, y, rw, rh);
    // Header bar — feels like an instrument panel
    const headH = 18;
    ctx.fillStyle = '#0E1A28';
    ctx.fillRect(x, y, rw, headH);
    ctx.fillStyle = hexA(pal.accent, 0.85);
    ctx.fillRect(x, y + headH - 1, rw, 1);
    // Label
    ctx.fillStyle = hexA(pal.accent, 0.95); ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(label, x + rw / 2, y + 12);
    // Rivets on header corners
    ctx.fillStyle = '#2A3A48';
    [4, rw - 4].forEach(rx => { ctx.beginPath(); ctx.arc(x + rx, y + headH / 2, 1.3, 0, PI2); ctx.fill(); });
    // Inner border
    ctx.strokeStyle = hexA(pal.accentDim, 0.5); ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1);
    // Outer-edge accent (the side touching screen edge)
    ctx.strokeStyle = hexA(pal.accent, 0.25); ctx.lineWidth = 2;
    const outerX = (x === 0) ? x + 0.5 : x + rw - 0.5;
    ctx.beginPath(); ctx.moveTo(outerX, y); ctx.lineTo(outerX, y + rh); ctx.stroke();
    // Subtle scanlines
    ctx.fillStyle = 'rgba(127,168,150,0.025)';
    for (let yy = y + headH + 4; yy < y + rh; yy += 3) ctx.fillRect(x, yy, rw, 1);
    // Bolts at corners (bottom)
    ctx.fillStyle = '#2A3A48';
    [4, rw - 4].forEach(rx => { ctx.beginPath(); ctx.arc(x + rx, y + rh - 5, 1.3, 0, PI2); ctx.fill(); });
}

function drawMiniBar(x, y, w2, label, valueText, pct, color, pal) {
    pct = Math.max(0, Math.min(1, pct));
    // Track
    ctx.fillStyle = '#040A10';
    ctx.beginPath(); ctx.roundRect(x, y + 8, w2, 8, 3); ctx.fill();
    // Fill
    if (pct > 0) {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.roundRect(x + 1, y + 9, (w2 - 2) * pct, 6, 2); ctx.fill();
    }
    // Label + value
    ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillStyle = pal.textDim;
    ctx.fillText(label, x, y + 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(valueText, x + w2, y + 6);
}

// =====================================================================
// OBSTACLE / WRECK / CAVE WALL DRAW HELPERS
// =====================================================================
// JAGGED ROCK trench walls. Procedural noise around the boundary circle.
// Cached: regenerate when the radius changes by more than 10m (perf-friendly).
// Sample the jagged trench radius at a given angle (interpolates between vertex samples)
function trenchRadiusAt(g, ang) {
    const verts = getTrenchVerts(g);
    if (!verts) return g.worldBounds.radius;
    // Normalize angle to [0, 2PI)
    let a = ang;
    while (a < 0) a += PI2;
    while (a >= PI2) a -= PI2;
    const n = verts.length;
    const idxF = (a / PI2) * n;
    const i0 = Math.floor(idxF) % n;
    const i1 = (i0 + 1) % n;
    const t = idxF - Math.floor(idxF);
    return verts[i0].rad * (1 - t) + verts[i1].rad * t;
}

function getTrenchVerts(g) {
    const wb = g.worldBounds;
    const r = wb.radius;
    if (g._trenchVerts && Math.abs(g._trenchCachedR - r) < 10) return g._trenchVerts;
    const n = 96;
    const seed = g.trenchSeed || 0;
    // Use the seed to perturb every sin/cos phase — gives each dive its own crag pattern
    const verts = new Array(n);
    for (let i = 0; i < n; i++) {
        const a = (i / n) * PI2;
        const big   = Math.sin(a * 3 + 1.7 + seed * 0.7) * 0.06
                    + Math.cos(a * 2 + 0.3 + seed * 1.1) * 0.04;
        const med   = Math.sin(a * 7 + 4.1 + seed * 1.7) * 0.025
                    + Math.cos(a * 5 + 2.2 + seed * 2.3) * 0.02;
        const small = (Math.sin(a * 17 + 0.5 + seed * 3.1)
                    + Math.sin(a * 23 + 1.4 + seed * 4.7)) * 0.015;
        const wob = big + med + small;
        const rad = r * (1 + wob);
        verts[i] = { a, rx: Math.cos(a) * rad, ry: Math.sin(a) * rad, rad };
    }
    g._trenchVerts = verts;
    g._trenchCachedR = r;
    return verts;
}

function drawWorldBoundsWalls(g, cx, cy, w, h) {
    if (!g.worldBounds || !g.worldBounds.radius) return;
    const wb = g.worldBounds;
    const r = wb.radius;
    const sCx = wb.cx - cx;
    const sCy = wb.cy - cy;
    const verts = getTrenchVerts(g);

    // Solid black wall — fill everything OUTSIDE the jagged perimeter
    ctx.fillStyle = '#020308';
    ctx.beginPath();
    ctx.rect(-50, -50, w + 100, h + 100);
    // Inner cutout — jagged perimeter (counter-clockwise so even-odd fills the wall)
    ctx.moveTo(sCx + verts[0].rx, sCy + verts[0].ry);
    for (let i = verts.length - 1; i >= 0; i--) {
        ctx.lineTo(sCx + verts[i].rx, sCy + verts[i].ry);
    }
    ctx.closePath();
    ctx.fill('evenodd');

    // Inner-edge stratification — darker stone band hugging the inside, shows rock texture
    ctx.fillStyle = 'rgba(8,12,16,0.55)';
    ctx.beginPath();
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        // Inner band 30-50px from the rim (depending on noise)
        const inset = 30 + Math.abs(Math.sin(v.a * 4)) * 22;
        const ix = Math.cos(v.a) * (v.rad - inset);
        const iy = Math.sin(v.a) * (v.rad - inset);
        if (i === 0) ctx.moveTo(sCx + ix, sCy + iy);
        else ctx.lineTo(sCx + ix, sCy + iy);
    }
    ctx.closePath();
    for (let i = verts.length - 1; i >= 0; i--) {
        ctx.lineTo(sCx + verts[i].rx, sCy + verts[i].ry);
    }
    ctx.fill('evenodd');

    // Highlights on protruding crags — pick the spikiest verts and stroke a short tick
    ctx.strokeStyle = 'rgba(120,130,140,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        if (v.rad < r) {        // this vert pokes inward = a crag tip
            const a = v.a;
            const tipX = sCx + v.rx;
            const tipY = sCy + v.ry;
            const baseX = sCx + Math.cos(a) * (r + 6);
            const baseY = sCy + Math.sin(a) * (r + 6);
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(baseX, baseY);
            ctx.stroke();
        }
    }

    // Subtle warm glow ONLY when the player is very close to the wall (sub light reflecting on rock)
    const p = g.player;
    if (p) {
        const distToCenter = Math.hypot(p.x - wb.cx, p.y - wb.cy);
        const distToWall = Math.max(0, r - distToCenter);
        if (distToWall < 240) {
            const a = (1 - distToWall / 240) * 0.18;
            const glowGrad = ctx.createRadialGradient(sCx, sCy, Math.max(1, r - 60), sCx, sCy, r + 4);
            glowGrad.addColorStop(0, 'rgba(120,90,60,0)');
            glowGrad.addColorStop(0.85, `rgba(120,90,60,${a * 0.4})`);
            glowGrad.addColorStop(1, `rgba(160,120,80,${a})`);
            ctx.fillStyle = glowGrad;
            ctx.beginPath(); ctx.arc(sCx, sCy, r + 4, 0, PI2); ctx.fill();
        }
    }

    // CRUSH DEPTH WARNING — pulse a deep red vignette when past hull's rated depth
    const crushDepth = (p && p._crushDepth) || 3000;
    if (g.depth > crushDepth) {
        const intensity = Math.min(1, (g.depth - crushDepth) / 1500);
        const pulse = 0.5 + Math.sin(g.runTime * 3) * 0.5;
        const cVig = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.7);
        cVig.addColorStop(0, 'rgba(0,0,0,0)');
        cVig.addColorStop(1, `rgba(180,30,30,${0.18 * intensity * pulse})`);
        ctx.fillStyle = cVig;
        ctx.fillRect(0, 0, w, h);
    }
}

function drawCragLine(wallX, h, isLeft, t) {
    // Jagged silhouette poking into the play area — gives walls texture
    ctx.fillStyle = '#020308';
    ctx.beginPath();
    if (isLeft) {
        ctx.moveTo(wallX, -10);
        for (let yy = 0; yy <= h + 10; yy += 24) {
            const jut = 8 + Math.abs(Math.sin((yy + t * 5) * 0.012)) * 18 + (Math.sin(yy * 0.07) * 6);
            ctx.lineTo(wallX + jut, yy);
        }
        ctx.lineTo(wallX, h + 10);
    } else {
        ctx.moveTo(wallX, -10);
        for (let yy = 0; yy <= h + 10; yy += 24) {
            const jut = 8 + Math.abs(Math.sin((yy + t * 5) * 0.013)) * 18 + (Math.sin(yy * 0.06) * 6);
            ctx.lineTo(wallX - jut, yy);
        }
        ctx.lineTo(wallX, h + 10);
    }
    ctx.closePath(); ctx.fill();
}

function drawObstacle(sx, sy, ob) {
    const r = ob.r;
    ctx.save();
    ctx.translate(sx, sy);
    if (ob.kind === 'rock') {
        // Faceted boulder — irregular silhouette, per-facet light from upper-left,
        // cracks, sediment dusting on top, companion pebbles. All seeded, no per-frame motion.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        const N = 14, pts = [];
        for (let i = 0; i < N; i++) {
            const a = (i / N) * PI2;
            const rad = r * (0.72 + sr(i) * 0.34);
            // flatter underside — rocks sit, they don't float
            pts.push([Math.cos(a) * rad, Math.sin(a) * rad * (Math.sin(a) > 0 ? 0.78 : 1)]);
        }
        const trace = () => {
            ctx.beginPath();
            pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            ctx.closePath();
        };
        trace(); ctx.fillStyle = ob.color; ctx.fill();
        for (let i = 0; i < N; i++) {
            const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % N];
            const mx2 = (x1 + x2) / 2, my2 = (y1 + y2) / 2;
            const lit = (-mx2 - my2) / ((Math.hypot(mx2, my2) || 1) * Math.SQRT2);
            ctx.fillStyle = lit > 0 ? `rgba(205,210,220,${0.05 + lit * 0.10})` : `rgba(0,0,0,${-lit * 0.26})`;
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
        for (let c = 0; c < 3; c++) {
            let ax = (sr(20 + c) - 0.5) * r * 1.1, ay = (sr(30 + c) - 0.5) * r * 0.8;
            ctx.beginPath(); ctx.moveTo(ax, ay);
            for (let s2 = 0; s2 < 3; s2++) {
                ax += (sr(40 + c * 3 + s2) - 0.35) * r * 0.4;
                ay += (sr(60 + c * 3 + s2) - 0.5) * r * 0.35;
                ctx.lineTo(ax, ay);
            }
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(160,158,145,0.20)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.ellipse(0, -r * 0.5, r * 0.5, r * 0.16, 0, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
        trace(); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        for (let pb = 0; pb < 2; pb++) {
            const px = (sr(70 + pb) - 0.5) * r * 2.1, py = r * 0.72 + sr(80 + pb) * r * 0.2;
            ctx.fillStyle = ob.color;
            ctx.beginPath(); ctx.ellipse(px, py, r * 0.16, r * 0.11, 0, 0, PI2); ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.beginPath(); ctx.ellipse(px, py + r * 0.03, r * 0.15, r * 0.06, 0, 0, Math.PI); ctx.fill();
        }
    } else if (ob.kind === 'kelp') {
        // Seeded frond stand: varied count/length/hue, quadratic curves,
        // side blades, tips fading into the water. Each plant is its own.
        const kr = (k) => { const v = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
        const tNow = performance.now() * 0.001;
        const fronds = 4 + Math.floor(kr(0) * 4);
        ctx.lineCap = 'round';
        for (let s2 = 0; s2 < fronds; s2++) {
            const baseX = (s2 - fronds / 2) * (5 + kr(s2) * 4);
            const len = r * (1.1 + kr(s2 + 3) * 1.1);
            const sway = Math.sin(tNow * (0.7 + kr(s2 + 7) * 0.6) + ob.seed + s2 * 1.7) * (10 + kr(s2 + 5) * 14);
            const hue = 95 + kr(s2 + 11) * 40;
            const segs = 7;
            let px2 = baseX, py2 = r * 0.8;
            for (let seg = 1; seg <= segs; seg++) {
                const t2 = seg / segs;
                const nx2 = baseX + sway * t2 * t2 + Math.sin(t2 * 5 + ob.seed) * 2;
                const ny2 = r * 0.8 - t2 * len;
                ctx.strokeStyle = `hsla(${hue}, 34%, ${20 + t2 * 12}%, ${0.9 - t2 * 0.35})`;
                ctx.lineWidth = 4.5 * (1 - t2 * 0.65);
                ctx.beginPath(); ctx.moveTo(px2, py2); ctx.lineTo(nx2, ny2); ctx.stroke();
                // Side blades on alternating segments
                if (seg % 2 === 0 && seg < segs) {
                    const bl = 6 + kr(s2 * 10 + seg) * 8;
                    ctx.lineWidth = 1.6;
                    ctx.beginPath(); ctx.moveTo(nx2, ny2);
                    ctx.lineTo(nx2 + (seg % 4 === 0 ? bl : -bl), ny2 - bl * 0.4); ctx.stroke();
                }
                px2 = nx2; py2 = ny2;
            }
        }
        // Holdfast — gnarled root mound
        ctx.fillStyle = '#141F18';
        ctx.beginPath(); ctx.ellipse(0, r * 0.74, r * 0.62, r * 0.24, 0, 0, PI2); ctx.fill();
        ctx.fillStyle = '#1E2C20';
        for (let rt = 0; rt < 4; rt++) {
            ctx.beginPath(); ctx.ellipse((kr(rt + 20) - 0.5) * r, r * 0.72, 4 + kr(rt + 24) * 4, 2.5, 0, 0, PI2); ctx.fill();
        }
    } else if (ob.kind === 'coral') {
        // Branching coral
        ctx.fillStyle = ob.color;
        ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, PI2); ctx.fill();
        ctx.strokeStyle = ob.color; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (let b = 0; b < 5; b++) {
            const a = (b / 5) * PI2 + ob.seed;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            const ex = Math.cos(a) * r * 0.9, ey = Math.sin(a) * r * 0.9;
            ctx.lineTo(ex, ey);
            ctx.stroke();
        }
    } else if (ob.kind === 'spire') {
        // Jagged multi-peak stone spire — seeded profile, lit west face, strata lines.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        const peaks = 2 + Math.floor(sr(1) * 2);
        const top = [];
        ctx.beginPath(); ctx.moveTo(-r * 0.7, r);
        for (let pk = 0; pk < peaks; pk++) {
            const px = -r * 0.4 + (pk / (peaks - 1 || 1)) * r * 0.8 + (sr(2 + pk) - 0.5) * r * 0.15;
            const py = -r * (0.7 + sr(5 + pk) * 0.6) * (pk === Math.floor(peaks / 2) ? 1.12 : 0.82);
            ctx.lineTo(px - r * 0.14, py + r * 0.4 + sr(8 + pk) * r * 0.12);   // shoulder notch
            ctx.lineTo(px, py);
            top.push([px, py]);
        }
        ctx.lineTo(r * 0.7, r); ctx.closePath();
        ctx.fillStyle = ob.color; ctx.fill();
        // Lit western face
        ctx.fillStyle = 'rgba(150,170,195,0.10)';
        ctx.beginPath(); ctx.moveTo(-r * 0.7, r); ctx.lineTo(top[0][0], top[0][1]); ctx.lineTo(top[0][0] + r * 0.08, r); ctx.closePath(); ctx.fill();
        // Shadowed eastern face
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        const lastTop = top[top.length - 1];
        ctx.beginPath(); ctx.moveTo(r * 0.7, r); ctx.lineTo(lastTop[0], lastTop[1]); ctx.lineTo(lastTop[0] - r * 0.06, r); ctx.closePath(); ctx.fill();
        // Strata
        ctx.strokeStyle = 'rgba(0,0,0,0.32)'; ctx.lineWidth = 0.8;
        for (let st = 1; st <= 3; st++) {
            const sy2 = r - st * r * 0.42;
            ctx.beginPath();
            ctx.moveTo(-r * (0.62 - st * 0.13), sy2);
            ctx.lineTo(r * (0.62 - st * 0.11), sy2 + (sr(30 + st) - 0.5) * r * 0.12);
            ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-r * 0.7, r);
        for (let pk = 0; pk < top.length; pk++) {
            ctx.lineTo(top[pk][0] - r * 0.14, top[pk][1] + r * 0.4 + sr(8 + pk) * r * 0.12);
            ctx.lineTo(top[pk][0], top[pk][1]);
        }
        ctx.lineTo(r * 0.7, r); ctx.stroke();
    } else if (ob.kind === 'glowcap') {
        // Bioluminescent mushroom / coral knob
        ctx.fillStyle = '#10141A';
        ctx.beginPath(); ctx.arc(0, r * 0.4, r * 0.5, 0, PI2); ctx.fill();
        const pulse = 0.4 + Math.sin(performance.now() * 0.002 + ob.seed) * 0.3;
        drawGlow(ctx, ob.color, 0, -r * 0.2, r * 1.2, pulse);
        ctx.fillStyle = ob.color;
        ctx.beginPath(); ctx.ellipse(0, -r * 0.2, r * 0.55, r * 0.4, 0, 0, PI2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.ellipse(-r * 0.15, -r * 0.3, r * 0.18, r * 0.12, 0, 0, PI2); ctx.fill();
    } else if (ob.kind === 'vent') {
        // Hydrothermal vent — black smoker with rising plume
        ctx.fillStyle = '#1A0A08';
        ctx.beginPath(); ctx.moveTo(-r * 0.5, r); ctx.lineTo(-r * 0.3, -r * 0.4); ctx.lineTo(r * 0.3, -r * 0.4); ctx.lineTo(r * 0.5, r); ctx.closePath(); ctx.fill();
        // Plume
        const t2 = performance.now() * 0.001;
        for (let pi = 0; pi < 4; pi++) {
            const a = (1 - pi * 0.25) * 0.3;
            ctx.fillStyle = `rgba(120,40,30,${a})`;
            const py = -r * 0.4 - pi * 12 + Math.sin(t2 + pi) * 3;
            ctx.beginPath(); ctx.arc(Math.sin(t2 + pi * 1.7) * 4, py, r * 0.4 + pi * 4, 0, PI2); ctx.fill();
        }
        // Hot core glow
        drawGlow(ctx, '#DA3010', 0, -r * 0.3, r * 0.8, 0.5);
    } else if (ob.kind === 'organic') {
        // Living tissue — pulsing dark mass with veins
        const pulse = 0.85 + Math.sin(performance.now() * 0.0015 + ob.seed) * 0.1;
        ctx.fillStyle = ob.color;
        ctx.beginPath();
        for (let i = 0; i <= 14; i++) {
            const a = (i / 14) * PI2;
            const rad = r * pulse * (0.9 + Math.sin(i * 2.1 + ob.seed) * 0.1);
            const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
        // Veins
        ctx.strokeStyle = '#FF4060'; ctx.lineWidth = 1.2;
        for (let v = 0; v < 4; v++) {
            const a = v * (PI2 / 4) + ob.seed * 0.1;
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.quadraticCurveTo(Math.cos(a + 0.3) * r * 0.4, Math.sin(a + 0.3) * r * 0.4, Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85);
            ctx.stroke();
        }
    } else if (ob.kind === 'crystal') {
        // Alien crystal cluster — refracts ping color
        const pulse = 0.5 + Math.sin(performance.now() * 0.002 + ob.seed) * 0.3;
        drawGlow(ctx, ob.color, 0, 0, r * 1.5, pulse * 0.5);
        ctx.fillStyle = ob.color;
        for (let cf = 0; cf < 5; cf++) {
            const a = (cf / 5) * PI2;
            const cx2 = Math.cos(a) * r * 0.3, cy2 = Math.sin(a) * r * 0.3;
            ctx.beginPath();
            ctx.moveTo(cx2, cy2);
            ctx.lineTo(cx2 + Math.cos(a) * r * 0.7, cy2 + Math.sin(a) * r * 0.7);
            ctx.lineTo(cx2 + Math.cos(a + 0.3) * r * 0.5, cy2 + Math.sin(a + 0.3) * r * 0.5);
            ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = 0.5;
        for (let cf = 0; cf < 5; cf++) {
            const a = (cf / 5) * PI2;
            const cx2 = Math.cos(a) * r * 0.3, cy2 = Math.sin(a) * r * 0.3;
            ctx.beginPath(); ctx.moveTo(cx2, cy2);
            ctx.lineTo(cx2 + Math.cos(a) * r * 0.7, cy2 + Math.sin(a) * r * 0.7);
            ctx.stroke();
        }
    } else if (ob.kind === 'bones') {
        // Whale fall — ribcage arcs over a sediment mound, skull at one end.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        ctx.fillStyle = 'rgba(30,32,28,0.8)';
        ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 1.1, r * 0.25, 0, 0, PI2); ctx.fill();
        ctx.lineCap = 'round';
        const ribs = 4 + Math.floor(sr(30) * 4);
        for (let i = 0; i < ribs; i++) {
            const bx = -r * 0.55 + (i / (ribs - 1)) * r * 1.1;
            const hgt = r * (0.85 - Math.abs(i - (ribs - 1) / 2) * 0.16) * (0.9 + sr(i) * 0.2);
            const broken = sr(i + 40) < 0.3;   // a third of the ribs snapped off
            const shade = 155 + sr(i + 9) * 35;
            ctx.strokeStyle = `rgba(${shade},${shade + 3},${shade - 12},${0.7 + sr(i + 5) * 0.2})`;
            const a0 = Math.PI * 1.02, a1 = broken ? Math.PI * (1.25 + sr(i + 6) * 0.2) : Math.PI * 1.72 + sr(i + 3) * 0.1;
            // Two-pass stroke = tapered bone, thick at the root
            ctx.lineWidth = 3.6;
            ctx.beginPath(); ctx.arc(bx, r * 0.5, hgt, a0, a0 + (a1 - a0) * 0.5); ctx.stroke();
            ctx.lineWidth = 2.1;
            ctx.beginPath(); ctx.arc(bx, r * 0.5, hgt, a0 + (a1 - a0) * 0.4, a1); ctx.stroke();
            if (broken) {   // jagged snapped tip
                const ax2 = bx + Math.cos(a1) * hgt, ay2 = r * 0.5 + Math.sin(a1) * hgt;
                ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(ax2, ay2); ctx.lineTo(ax2 + 3 - sr(i + 8) * 6, ay2 - 3); ctx.stroke();
            }
        }
        // Loose shards half-swallowed by the sediment
        ctx.fillStyle = 'rgba(150,152,136,0.55)';
        for (let sh = 0; sh < 4; sh++) {
            const sx2 = (sr(sh + 50) - 0.5) * r * 1.8, sy2 = r * (0.5 + sr(sh + 54) * 0.14);
            ctx.save(); ctx.translate(sx2, sy2); ctx.rotate(sr(sh + 58) * Math.PI);
            ctx.fillRect(-4 - sr(sh + 60) * 4, -1.1, 8 + sr(sh + 60) * 8, 2.2);
            ctx.restore();
        }
        // Spine + vertebrae
        ctx.strokeStyle = 'rgba(165,168,152,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-r * 0.8, r * 0.42); ctx.quadraticCurveTo(0, r * 0.3, r * 0.75, r * 0.44); ctx.stroke();
        ctx.fillStyle = 'rgba(175,178,162,0.8)';
        for (let vtb = 0; vtb < 6; vtb++) {
            const vx = -r * 0.75 + vtb * r * 0.3;
            ctx.beginPath(); ctx.arc(vx, r * 0.38 - Math.sin((vtb / 5) * Math.PI) * r * 0.06, 2.4, 0, PI2); ctx.fill();
        }
        // Skull
        ctx.fillStyle = 'rgba(180,182,166,0.85)';
        ctx.beginPath(); ctx.ellipse(-r * 0.95, r * 0.36, r * 0.26, r * 0.17, -0.25, 0, PI2); ctx.fill();
        ctx.fillStyle = 'rgba(10,10,12,0.9)';
        ctx.beginPath(); ctx.arc(-r * 1.02, r * 0.32, r * 0.05, 0, PI2); ctx.fill();
    } else if (ob.kind === 'seep') {
        // Cold seep — crusted mound venting a shimmering methane bubble column.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        ctx.fillStyle = ob.color;
        ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 0.85, r * 0.4, 0, 0, PI2); ctx.fill();
        ctx.fillStyle = 'rgba(200,205,210,0.12)';
        for (let cr = 0; cr < 5; cr++) {
            ctx.beginPath(); ctx.arc((sr(cr) - 0.5) * r * 1.2, r * 0.4 + (sr(cr + 7) - 0.5) * r * 0.3, r * 0.07, 0, PI2); ctx.fill();
        }
        const t3 = performance.now() * 0.001;
        for (let bi = 0; bi < 7; bi++) {
            const cycle = r * 3.2;
            const by = -(((t3 * 22 + bi * 19 + sr(bi) * 14) % cycle));
            const bx = Math.sin(t3 * 1.2 + bi * 2.1) * r * 0.22 * (1 - by / -cycle + 0.3);
            const rise = -by / cycle;   // 0 at mound → 1 at top
            ctx.strokeStyle = `rgba(180,220,255,${0.35 * (1 - rise)})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(bx, r * 0.3 + by, 1.6 + rise * 3.4, 0, PI2); ctx.stroke();
        }
    } else if (ob.kind === 'chitin') {
        // The floor at this depth is not rock (lore d7) — segmented plate, breathing slowly.
        const breathe = Math.sin(performance.now() * 0.00045 + ob.seed);
        const sc = 1 + breathe * 0.035;
        ctx.save(); ctx.scale(sc, sc);
        ctx.fillStyle = ob.color;
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.62, 0.15, 0, PI2); ctx.fill();
        // Plate segments with ridge seams
        ctx.strokeStyle = '#402030'; ctx.lineWidth = 1.6;
        for (let sg = -1; sg <= 1; sg++) {
            ctx.beginPath();
            ctx.moveTo(sg * r * 0.4 - r * 0.18, -r * 0.55);
            ctx.quadraticCurveTo(sg * r * 0.4 + r * 0.1, 0, sg * r * 0.4 - r * 0.1, r * 0.55);
            ctx.stroke();
        }
        // Seam glow strengthens as it inhales
        ctx.strokeStyle = `rgba(255,60,80,${0.08 + Math.max(0, breathe) * 0.12})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(-r * 0.58, -r * 0.35); ctx.quadraticCurveTo(0, r * 0.1, r * 0.6, -r * 0.28); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.62, 0.15, 0, PI2); ctx.stroke();
        ctx.restore();
    } else if (ob.kind === 'monolith') {
        // Machined slab — too regular for geology. One slow indicator light nobody services.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        ctx.save(); ctx.rotate((sr(1) - 0.5) * 0.22);
        const w2 = r * 0.55, h2 = r * 1.35;
        ctx.fillStyle = ob.color;
        ctx.fillRect(-w2 / 2, -h2 / 2, w2, h2);
        // Machined grooves
        ctx.strokeStyle = 'rgba(90,110,125,0.25)'; ctx.lineWidth = 1;
        for (let gv = 1; gv <= 4; gv++) {
            const gy = -h2 / 2 + (gv / 5) * h2;
            ctx.beginPath(); ctx.moveTo(-w2 / 2 + 2, gy); ctx.lineTo(w2 / 2 - 2, gy); ctx.stroke();
        }
        // Lit edge + shadow edge
        ctx.strokeStyle = 'rgba(140,160,180,0.3)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-w2 / 2, h2 / 2); ctx.lineTo(-w2 / 2, -h2 / 2); ctx.lineTo(w2 / 2, -h2 / 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(w2 / 2, -h2 / 2); ctx.lineTo(w2 / 2, h2 / 2); ctx.lineTo(-w2 / 2, h2 / 2); ctx.stroke();
        // Organic reclaim at the base
        ctx.fillStyle = 'rgba(60,40,50,0.5)';
        ctx.beginPath(); ctx.ellipse(0, h2 / 2, w2 * 0.8, r * 0.14, 0, 0, Math.PI, true); ctx.fill();
        // Indicator light — ~7s period, brief blink; still running, which is worse
        const blink = (performance.now() * 0.001 + ob.seed) % 7;
        if (blink < 0.18) drawGlow(ctx, '#C8D8E0', w2 * 0.22, -h2 * 0.38, 7, 0.8);
        ctx.restore();
    } else if (ob.kind === 'debris') {
        // Hull-plate pile — collapsed structure, plates at angles, rivet lines, one readable stencil.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        ctx.fillStyle = 'rgba(20,22,20,0.7)';
        ctx.beginPath(); ctx.ellipse(0, r * 0.5, r * 1.05, r * 0.28, 0, 0, PI2); ctx.fill();
        for (let pl = 0; pl < 4; pl++) {
            const px = (sr(pl) - 0.5) * r * 1.1, py = r * 0.3 - pl * r * 0.22;
            const pw = r * (0.5 + sr(pl + 4) * 0.5), ph = r * 0.2;
            const rot = (sr(pl + 8) - 0.5) * 0.9;
            ctx.save(); ctx.translate(px, py); ctx.rotate(rot);
            ctx.fillStyle = ob.color;
            ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
            ctx.strokeStyle = 'rgba(140,150,160,0.22)'; ctx.lineWidth = 1;
            ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
            // Rivets
            ctx.fillStyle = 'rgba(100,110,120,0.4)';
            for (let rv = 0; rv < 4; rv++) { ctx.beginPath(); ctx.arc(-pw / 2 + 3 + rv * (pw - 6) / 3, -ph / 2 + 3, 1, 0, PI2); ctx.fill(); }
            // Rust bleed
            ctx.fillStyle = 'rgba(140,70,40,0.18)';
            ctx.fillRect(-pw / 2, ph / 2 - 3, pw * (0.3 + sr(pl + 12) * 0.5), 3);
            ctx.restore();
        }
        // Stencil on the top plate — a hull number nobody will report to
        ctx.fillStyle = 'rgba(160,170,175,0.35)'; ctx.font = `${Math.max(5, r * 0.16)}px monospace`; ctx.textAlign = 'center';
        ctx.fillText('P3-' + String(Math.floor(sr(20) * 90) + 10), 0, -r * 0.45);
    } else if (ob.kind === 'cable') {
        // Snapped trunk cable — sags across the floor, frayed end sparking every few seconds.
        const sr = (k) => { const s = Math.sin((ob.seed + 1) * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
        ctx.strokeStyle = ob.color; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-r * 1.2, r * 0.3 + (sr(1) - 0.5) * r * 0.3);
        ctx.quadraticCurveTo((sr(2) - 0.5) * r, r * 0.75, r * 0.9, r * 0.1 + (sr(3) - 0.5) * r * 0.4);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(120,130,140,0.25)'; ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-r * 1.2, r * 0.28 + (sr(1) - 0.5) * r * 0.3);
        ctx.quadraticCurveTo((sr(2) - 0.5) * r, r * 0.72, r * 0.9, r * 0.08 + (sr(3) - 0.5) * r * 0.4);
        ctx.stroke();
        // Anchor collar at one end
        ctx.fillStyle = '#20262A';
        ctx.beginPath(); ctx.arc(-r * 1.2, r * 0.3 + (sr(1) - 0.5) * r * 0.3, 5, 0, PI2); ctx.fill();
        // Frayed live end — sparks on a seeded cycle; the grid it fed is gone
        const endX = r * 0.9, endY = r * 0.1 + (sr(3) - 0.5) * r * 0.4;
        ctx.strokeStyle = 'rgba(200,210,220,0.5)'; ctx.lineWidth = 1;
        for (let fw = 0; fw < 3; fw++) {
            ctx.beginPath(); ctx.moveTo(endX, endY);
            ctx.lineTo(endX + 4 + sr(fw + 5) * 5, endY + (sr(fw + 9) - 0.5) * 8);
            ctx.stroke();
        }
        const sparkCycle = (performance.now() * 0.001 + ob.seed) % (3 + sr(4) * 4);
        if (sparkCycle < 0.12) {
            drawGlow(ctx, '#9FD8FF', endX + 4, endY, 12, 0.9);
            ctx.strokeStyle = 'rgba(200,235,255,0.9)'; ctx.lineWidth = 1.2;
            for (let sp = 0; sp < 3; sp++) {
                ctx.beginPath(); ctx.moveTo(endX + 3, endY);
                ctx.lineTo(endX + 8 + Math.random() * 10, endY + (Math.random() - 0.5) * 16);
                ctx.stroke();
            }
        }
    }
    ctx.restore();
}

function drawWreck(sx, sy, wr, g) {
    ctx.save();
    ctx.translate(sx, sy);
    const r = wr.r;
    // Sub hull silhouette — broken, listing slightly
    ctx.rotate(wr.seed * 0.03 - 0.15);
    // Outer dark hull
    ctx.fillStyle = '#0A0E14';
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.55, 0, 0, PI2); ctx.fill();
    ctx.strokeStyle = '#3A4A5A'; ctx.lineWidth = 1.5; ctx.stroke();
    // Conning tower stub
    ctx.fillStyle = '#0A0E14';
    ctx.fillRect(-r * 0.25, -r * 0.7, r * 0.5, r * 0.3);
    ctx.strokeRect(-r * 0.25, -r * 0.7, r * 0.5, r * 0.3);
    // Hull breach — jagged hole
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.1);
    ctx.lineTo(r * 0.5, -r * 0.05);
    ctx.lineTo(r * 0.55, r * 0.15);
    ctx.lineTo(r * 0.3, r * 0.25);
    ctx.lineTo(r * 0.05, r * 0.1);
    ctx.closePath(); ctx.fill();
    // Rivets along hull
    ctx.fillStyle = '#5A6A7A';
    for (let i = -3; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(i * r * 0.18, -r * 0.4, 1, 0, PI2); ctx.fill();
        ctx.beginPath(); ctx.arc(i * r * 0.18, r * 0.4, 1, 0, PI2); ctx.fill();
    }
    // Porthole — flickering light if not yet salvaged
    if (!wr.salvaged) {
        const flick = 0.5 + Math.sin(g.runTime * 6 + wr.seed) * 0.3;
        ctx.fillStyle = `rgba(218, 165, 32, ${flick * 0.6})`;
        ctx.beginPath(); ctx.arc(-r * 0.5, 0, r * 0.12, 0, PI2); ctx.fill();
        ctx.strokeStyle = '#5A6A7A'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(-r * 0.5, 0, r * 0.13, 0, PI2); ctx.stroke();
    }
    ctx.restore();

    // Hull name — always visible (small, dim if not revealed)
    if (wr.name) {
        ctx.font = '11px monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = wr.salvaged ? 'rgba(120,140,150,0.5)' : 'rgba(180,200,210,0.75)';
        ctx.fillText(wr.name, sx, sy + r + 12);
    }
    // Sonar-revealed: loot tag above. Unrevealed: pulsing ?
    if (wr.revealed && !wr.salvaged) {
        const tagY = sy - r - 20;
        ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        const tagW = ctx.measureText(wr.loot.label).width + 14;
        ctx.fillStyle = 'rgba(8,12,18,0.85)';
        ctx.beginPath(); ctx.roundRect(sx - tagW / 2, tagY - 12, tagW, 16, 3); ctx.fill();
        ctx.strokeStyle = wr.loot.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(sx - tagW / 2, tagY - 12, tagW, 16, 3); ctx.stroke();
        ctx.fillStyle = wr.loot.color;
        ctx.fillText(wr.loot.label, sx, tagY);
        drawGlow(ctx, wr.loot.color, sx, sy - r - 4, 8, 0.6);
    } else if (!wr.salvaged) {
        const pulse = 0.4 + Math.sin(g.runTime * 3) * 0.2;
        ctx.fillStyle = `rgba(160,200,220,${pulse})`;
        ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
        ctx.fillText('?', sx, sy - r - 6);
    }

    // Salvage progress ring (if player is holding E nearby)
    if (g.nearestWreck === wr && g.salvageHoldTime > 0) {
        const pct = Math.min(1, g.salvageHoldTime / 1.5);
        ctx.strokeStyle = '#FFD040'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sx, sy, r + 8, -Math.PI / 2, -Math.PI / 2 + pct * PI2); ctx.stroke();
    }
}

// The apex resolves out of the black as it closes — never fully seen.
function drawApexPatrol(g, cx, cy) {
    const a = g.apex;
    const t = g.runTime;
    const dToP = dist(a, g.player);
    const vis = Math.max(0, 1 - dToP / 560);
    if (vis <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, 0.2 + vis * 0.75);
    // Segmented mass behind the head, darker than the water around it
    for (let i = a.trail.length - 1; i >= 0; i--) {
        const seg = a.trail[i];
        const sx = seg.x - cx, sy = seg.y - cy;
        const frac = 1 - i / a.trail.length;
        const r = 8 + 26 * frac + Math.sin(t * 2 + i * 0.7) * 2;
        ctx.fillStyle = `rgba(5,3,9,${0.45 + frac * 0.4})`;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, PI2); ctx.fill();
    }
    const hx = a.x - cx, hy = a.y - cy;
    // Pressure-sore underglow, faint
    drawGlow(ctx, '#40101A', hx, hy, 90, 0.5 * vis);
    // Eyes — cold while it patrols, hot when it has you
    const hot = a.state === 'strike' || a.state === 'hunt';
    const eyeCol = hot ? '#FF3030' : '#B0C8D0';
    for (const s of [-1, 1]) {
        const ex = hx + Math.cos(a.heading + s * 0.35) * 18;
        const ey = hy + Math.sin(a.heading + s * 0.35) * 18;
        drawGlow(ctx, eyeCol, ex, ey, 10, 0.9 * vis);
        ctx.fillStyle = eyeCol;
        ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, PI2); ctx.fill();
    }
    ctx.restore();
}

function drawHullDiagram(cx, cy, p, pal) {
    // Top-down sub silhouette with damaged-section coloring
    const hpPct = p.hp / p.maxHp;
    const sz = 22;
    ctx.save();
    ctx.translate(cx, cy);
    // Hull
    ctx.strokeStyle = hexA(pal.accent, 0.4); ctx.lineWidth = 1;
    ctx.fillStyle = hexA(pal.accent, 0.08);
    ctx.beginPath(); ctx.ellipse(0, 0, sz, sz * 0.55, 0, 0, PI2); ctx.fill(); ctx.stroke();
    // Forward bow
    ctx.beginPath(); ctx.arc(sz - 4, 0, 4, 0, PI2); ctx.stroke();
    // Damage shading — bottom half darkens as HP drops
    if (hpPct < 0.7) {
        ctx.fillStyle = `rgba(218,64,96,${(0.7 - hpPct) * 0.7})`;
        ctx.beginPath(); ctx.ellipse(0, 0, sz - 1, sz * 0.55 - 1, 0, 0, PI2); ctx.fill();
    }
    // Bow lamp dot
    ctx.fillStyle = pal.accent;
    ctx.beginPath(); ctx.arc(sz - 4, 0, 1.5, 0, PI2); ctx.fill();
    ctx.restore();
}

// Map an upgrade id/name to a colored icon glyph for the level-up cards
function upgradeIcon(name) {
    const s = (name || '').toLowerCase();
    if (s.startsWith('fuse')) return { glyph: '⧉', color: '#FF80FF' };
    if (s.includes('⦿') || s.startsWith('coil')) return { glyph: '⦿', color: '#DA4060' };
    if (s.includes('damage') || s.includes('overclock') || s.includes('berserker')) return { glyph: '⚔', color: '#FF6A40' };
    if (s.includes('speed') || s.includes('thrust') || s.includes('slipstream')) return { glyph: '➤', color: '#80E0FF' };
    if (s.includes('hp') || s.includes('hull') || s.includes('plating') || s.includes('repair') || s.includes('thick')) return { glyph: '◈', color: '#4A9A6A' };
    if (s.includes('magnet') || s.includes('sweep') || s.includes('omniscient')) return { glyph: '◎', color: '#5ADFCF' };
    if (s.includes('armor')) return { glyph: '🛡', color: '#AAB0B0' };
    if (s.includes('area')) return { glyph: '○', color: '#A06ACC' };
    if (s.includes('cooldown') || s.includes('rapid') || s.includes('overdrive')) return { glyph: '↺', color: '#FFD040' };
    if (s.includes('xp') || s.includes('salvage') && s.includes('expert')) return { glyph: '✦', color: '#80FFA0' };
    if (s.includes('heal')) return { glyph: '✚', color: '#4AE0A0' };
    if (s.includes('regen')) return { glyph: '∞', color: '#80E0A0' };
    if (s.includes('defiance')) return { glyph: '◆', color: '#FFD040' };
    if (s.includes('dash')) return { glyph: '⚡', color: '#80E0FF' };
    if (s.includes('sonar') || s.includes('ping') || s.includes('mastery')) return { glyph: '◉', color: '#80FFE0' };
    if (s.includes('cascade') || s.includes('chain')) return { glyph: '⛓', color: '#FFB040' };
    if (s.includes('depth')) return { glyph: '▼', color: '#A06ACC' };
    if (s.includes('corrupt')) return { glyph: '※', color: '#A06ACC' };
    if (s.includes('weapon') || s.includes('NEW:')) return { glyph: '+', color: '#FFFFA0' };
    if (s.includes('lv')) return { glyph: '↑', color: '#A0DDD0' };
    return { glyph: '◯', color: '#A0DDD0' };
}

function drawLevelUp(w, h, g) {
    // Backdrop
    ctx.fillStyle = 'rgba(0,8,16,0.82)';
    ctx.fillRect(0, 0, w, h);

    // Title
    ctx.fillStyle = '#FFD040';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('LEVEL UP', w / 2, h / 2 - 180);
    ctx.fillStyle = '#AAA';
    ctx.font = '13px monospace';
    ctx.fillText(`Level ${g.player.level}  ·  pick one`, w / 2, h / 2 - 156);

    // ---- HORIZONTAL CARDS ----
    const n = g.levelUpChoices.length;
    const cardW = 180, cardH = 220, gap = 18;
    const totalW = n * cardW + (n - 1) * gap;
    const startX = w / 2 - totalW / 2;
    const cardY = h / 2 - cardH / 2;
    for (let i = 0; i < n; i++) {
        const ch = g.levelUpChoices[i];
        const bx = startX + i * (cardW + gap);
        addTapZone(bx, cardY, cardW, cardH, String(i + 1));
        const ic = upgradeIcon(ch.name || ch.id);
        // Card body
        ctx.fillStyle = '#0E1A28';
        ctx.beginPath(); ctx.roundRect(bx, cardY, cardW, cardH, 8); ctx.fill();
        ctx.strokeStyle = ic.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(bx, cardY, cardW, cardH, 8); ctx.stroke();
        // Boon-giver — who is offering this, and what their generosity usually costs
        const giver = cardGiver(ch);
        ctx.fillStyle = hexA(giver.color, 0.85);
        ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(giver.label, bx + cardW / 2, cardY + 16);
        // Icon area (top half)
        const iconCx = bx + cardW / 2, iconCy = cardY + 70;
        // Soft glow
        const glow = ctx.createRadialGradient(iconCx, iconCy, 0, iconCx, iconCy, 60);
        glow.addColorStop(0, hexA(ic.color, 0.30));
        glow.addColorStop(1, hexA(ic.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(iconCx, iconCy, 60, 0, PI2); ctx.fill();
        // Icon ring
        ctx.strokeStyle = hexA(ic.color, 0.75); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(iconCx, iconCy, 32, 0, PI2); ctx.stroke();
        // Glyph
        ctx.fillStyle = ic.color;
        ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
        ctx.fillText(ic.glyph, iconCx, iconCy + 12);
        // Name
        ctx.fillStyle = '#FFF';
        ctx.font = 'bold 13px monospace';
        const nameStr = ch.name.length > 22 ? ch.name.slice(0, 21) + '…' : ch.name;
        ctx.fillText(nameStr, bx + cardW / 2, cardY + 130);
        // Description (wrap to 2 lines)
        if (ch.desc) {
            ctx.fillStyle = '#9AB0C0';
            ctx.font = '10px monospace';
            const words = ch.desc.split(' ');
            let line = '', y = cardY + 152;
            for (const word of words) {
                const test = line + word + ' ';
                if (ctx.measureText(test).width > cardW - 16) {
                    ctx.fillText(line, bx + cardW / 2, y);
                    line = word + ' '; y += 12;
                } else line = test;
            }
            if (line) ctx.fillText(line, bx + cardW / 2, y);
        }
        // Key prompt at bottom
        ctx.fillStyle = '#0A1018';
        ctx.fillRect(bx + cardW / 2 - 18, cardY + cardH - 30, 36, 22);
        ctx.strokeStyle = ic.color; ctx.lineWidth = 1;
        ctx.strokeRect(bx + cardW / 2 - 18, cardY + cardH - 30, 36, 22);
        ctx.fillStyle = ic.color;
        ctx.font = 'bold 14px monospace';
        ctx.fillText(`${i + 1}`, bx + cardW / 2, cardY + cardH - 14);
    }

    // ---- ACTIVE PERKS strip at the bottom ----
    if (g.pickedUpgrades && g.pickedUpgrades.length) {
        ctx.fillStyle = '#A0DDD0'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText('ACTIVE LOADOUT', w / 2, h - 64);
        const perks = g.pickedUpgrades;
        const iconSize = 26;
        const perkGap = 4;
        const totalPerksW = perks.length * (iconSize + perkGap) - perkGap;
        let px = w / 2 - totalPerksW / 2;
        for (const u of perks) {
            const ic = upgradeIcon(u.name || u.id);
            ctx.fillStyle = '#0E1A28';
            ctx.beginPath(); ctx.roundRect(px, h - 52, iconSize, iconSize, 4); ctx.fill();
            ctx.strokeStyle = hexA(ic.color, 0.7); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(px, h - 52, iconSize, iconSize, 4); ctx.stroke();
            ctx.fillStyle = ic.color;
            ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
            ctx.fillText(ic.glyph, px + iconSize / 2, h - 52 + iconSize / 2 + 5);
            px += iconSize + perkGap;
        }
    }
}

// =====================================================================
// IN-RUN SHOP — B to open. Spend run gold on mid-dive upgrades.
// Offers 3 random items from CARD_DEFS, priced by rarity. Refresh = 25g.
// =====================================================================
const SHOP_RARITY_PRICE = { common: 60, uncommon: 120, rare: 250, legendary: 500 };
function rollShopOffers(g) {
    // Avoid offering things the player already has from cards or upgrades
    const owned = new Set();
    for (const u of (g.pickedUpgrades || [])) owned.add(u.id);
    for (const c of (g.selectedCards || [])) owned.add(c.id);
    const pool = CARD_DEFS.filter(c => !owned.has(c.id));
    const offers = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
        // Skewed toward common/uncommon, occasional rare
        const r = Math.random();
        let target;
        if (r < 0.45) target = 'common';
        else if (r < 0.85) target = 'uncommon';
        else if (r < 0.97) target = 'rare';
        else target = 'legendary';
        let bucket = pool.filter(c => c.rarity === target);
        if (!bucket.length) bucket = pool;
        const pick = bucket[Math.floor(Math.random() * bucket.length)];
        offers.push({
            id: pick.id, name: pick.name, desc: pick.desc, rarity: pick.rarity, fn: pick.fn,
            cost: SHOP_RARITY_PRICE[pick.rarity] || 100,
            bought: false,
        });
        const idx = pool.indexOf(pick);
        if (idx >= 0) pool.splice(idx, 1);
    }
    return offers;
}

function drawRunShop(w, h, g) {
    ctx.fillStyle = 'rgba(0,8,16,0.92)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD040'; ctx.font = 'bold 28px monospace';
    ctx.fillText('SALVAGE EXCHANGE', w / 2, 70);
    ctx.fillStyle = '#9AB0C0'; ctx.font = '11px monospace';
    ctx.fillText('Spend run gold on dive-only upgrades. Refresh anytime.', w / 2, 92);
    // Gold
    ctx.fillStyle = '#DAA520'; ctx.font = 'bold 18px monospace';
    ctx.fillText(`${g.goldEarned}g`, w / 2, 120);
    // Help
    ctx.fillStyle = '#5A6A7A'; ctx.font = '10px monospace';
    ctx.fillText('[1-3] buy   ·   [R] refresh (25g)   ·   [B / ESC] close', w / 2, 142);

    const offers = g._shopOffers || [];
    const cardW = 220, cardH = 240, gap = 24;
    const totalW = offers.length * cardW + (offers.length - 1) * gap;
    const startX = w / 2 - totalW / 2;
    const cardY = h / 2 - cardH / 2 + 20;
    for (let i = 0; i < offers.length; i++) {
        const o = offers[i];
        const ic = upgradeIcon(o.name || o.id);
        const rcol = LOOT_RARITY_COLORS[o.rarity] || ic.color;
        const bx = startX + i * (cardW + gap);
        const canBuy = !o.bought && g.goldEarned >= o.cost;
        // Card
        ctx.fillStyle = o.bought ? '#0A1018' : '#0E1A28';
        ctx.beginPath(); ctx.roundRect(bx, cardY, cardW, cardH, 8); ctx.fill();
        ctx.strokeStyle = o.bought ? '#1A2530' : (canBuy ? rcol : 'rgba(80,90,100,0.5)');
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(bx, cardY, cardW, cardH, 8); ctx.stroke();
        // Rarity strip at top
        ctx.fillStyle = rcol;
        ctx.fillRect(bx, cardY, cardW, 4);
        ctx.fillStyle = rcol; ctx.font = 'bold 10px monospace';
        ctx.fillText(o.rarity.toUpperCase(), bx + cardW / 2, cardY + 18);
        // Icon area
        const iconCx = bx + cardW / 2, iconCy = cardY + 80;
        if (!o.bought) {
            const glow = ctx.createRadialGradient(iconCx, iconCy, 0, iconCx, iconCy, 60);
            glow.addColorStop(0, hexA(ic.color, 0.30));
            glow.addColorStop(1, hexA(ic.color, 0));
            ctx.fillStyle = glow;
            ctx.beginPath(); ctx.arc(iconCx, iconCy, 60, 0, PI2); ctx.fill();
        }
        ctx.strokeStyle = o.bought ? 'rgba(80,90,100,0.5)' : hexA(ic.color, 0.75);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(iconCx, iconCy, 32, 0, PI2); ctx.stroke();
        ctx.fillStyle = o.bought ? '#3A5A6A' : ic.color;
        ctx.font = 'bold 36px monospace'; ctx.textAlign = 'center';
        ctx.fillText(ic.glyph, iconCx, iconCy + 12);
        // Name
        ctx.fillStyle = o.bought ? '#5A6A7A' : '#FFF';
        ctx.font = 'bold 13px monospace';
        const nameStr = o.name.length > 22 ? o.name.slice(0, 21) + '…' : o.name;
        ctx.fillText(nameStr, bx + cardW / 2, cardY + 142);
        // Description (wrap to 2 lines)
        if (o.desc) {
            ctx.fillStyle = o.bought ? '#3A4A5A' : '#9AB0C0';
            ctx.font = '10px monospace';
            const words = o.desc.split(' ');
            let line = '', y = cardY + 162;
            for (const word of words) {
                const test = line + word + ' ';
                if (ctx.measureText(test).width > cardW - 16) {
                    ctx.fillText(line, bx + cardW / 2, y);
                    line = word + ' '; y += 12;
                } else line = test;
            }
            if (line) ctx.fillText(line, bx + cardW / 2, y);
        }
        // Price + buy key
        if (o.bought) {
            ctx.fillStyle = '#3A5A6A'; ctx.font = 'bold 14px monospace';
            ctx.fillText('— SOLD —', bx + cardW / 2, cardY + cardH - 20);
        } else {
            ctx.fillStyle = canBuy ? '#DAA520' : '#5A4A30'; ctx.font = 'bold 16px monospace';
            ctx.fillText(`${o.cost}g`, bx + cardW / 2, cardY + cardH - 28);
            // Key prompt
            ctx.fillStyle = '#0A1018';
            ctx.fillRect(bx + cardW / 2 - 18, cardY + cardH - 18, 36, 14);
            ctx.strokeStyle = canBuy ? rcol : 'rgba(80,90,100,0.5)'; ctx.lineWidth = 1;
            ctx.strokeRect(bx + cardW / 2 - 18, cardY + cardH - 18, 36, 14);
            ctx.fillStyle = canBuy ? rcol : '#5A6A7A';
            ctx.font = 'bold 10px monospace';
            ctx.fillText(`${i + 1}`, bx + cardW / 2, cardY + cardH - 8);
        }
    }
}

// =====================================================================
// INVENTORY SCREEN — TAB to open. Sell salvage for gold.
// =====================================================================
function drawInventory(w, h, g) {
    ctx.fillStyle = 'rgba(0,8,16,0.88)';
    ctx.fillRect(0, 0, w, h);
    // Title
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD040'; ctx.font = 'bold 28px monospace';
    ctx.fillText('SALVAGE INVENTORY', w / 2, 80);
    // Gold
    ctx.fillStyle = '#DAA520'; ctx.font = 'bold 16px monospace';
    ctx.fillText(`${g.goldEarned}g`, w / 2, 108);
    // Subtitle
    ctx.fillStyle = '#9AB0C0'; ctx.font = '11px monospace';
    ctx.fillText(`Salvage banks when you SURFACE   ·   [TAB / ESC] close`, w / 2, 130);
    // Materials + breakdown hint
    const _mtxt = Object.keys(BASE_MATERIALS).map(k => `${BASE_MATERIALS[k].glyph}${meta.materials[k] || 0}`).join('  ');
    ctx.fillStyle = '#7A8A9A'; ctx.font = '10px monospace';
    ctx.fillText('MATERIALS  ' + _mtxt + '       [B] break down all salvage → materials', w / 2, 148);

    if (g.inventory.length === 0) {
        ctx.fillStyle = '#5A6A7A'; ctx.font = '14px monospace';
        ctx.fillText('— hold is empty —', w / 2, h / 2);
        return;
    }

    // Grid of items
    const cols = 4;
    const cellW = 180, cellH = 80, gap = 12;
    const totalW = cols * cellW + (cols - 1) * gap;
    const startX = w / 2 - totalW / 2;
    const startY = 170;
    let totalValue = 0;
    for (let i = 0; i < g.inventory.length; i++) {
        const item = g.inventory[i];
        totalValue += item.value;
        const r = Math.floor(i / cols), c = i % cols;
        const cx2 = startX + c * (cellW + gap);
        const cy2 = startY + r * (cellH + gap);
        const rcol = LOOT_RARITY_COLORS[item.rarity] || '#FFF';
        // Card body
        ctx.fillStyle = '#0E1A28';
        ctx.beginPath(); ctx.roundRect(cx2, cy2, cellW, cellH, 6); ctx.fill();
        ctx.strokeStyle = rcol; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(cx2, cy2, cellW, cellH, 6); ctx.stroke();
        // Glyph (left)
        const gCx = cx2 + 28, gCy = cy2 + cellH / 2;
        drawGlow(ctx, item.color, gCx, gCy, 18, 0.5);
        ctx.fillStyle = item.color;
        ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center';
        ctx.fillText(item.glyph, gCx, gCy + 8);
        // Name + rarity
        ctx.fillStyle = '#FFF'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
        ctx.fillText(item.name, cx2 + 56, cy2 + 22);
        ctx.fillStyle = rcol; ctx.font = '11px monospace';
        ctx.fillText(item.rarity.toUpperCase(), cx2 + 56, cy2 + 36);
        // Value
        ctx.fillStyle = '#DAA520'; ctx.font = 'bold 13px monospace';
        ctx.fillText(`${item.value}g`, cx2 + 56, cy2 + 56);
    }
    // Total at bottom
    const cellsHigh = Math.ceil(g.inventory.length / cols);
    const totalsY = startY + cellsHigh * (cellH + gap) + 24;
    ctx.fillStyle = '#9AB0C0'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`Surface value: ${totalValue}g`, w / 2, totalsY);
    ctx.fillStyle = '#5A6A7A'; ctx.font = '10px monospace';
    ctx.fillText(`${g.inventory.length}/50 slots used`, w / 2, totalsY + 16);
}

function drawDeathScreen(w, h, g) {
    const surfaced = g._surfaced;
    const reportDepth = surfaced ? (g.deepestDepth || 0) : (g.depth || 0);
    const dPal = getDepthPalette(reportDepth);
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, w, h);

    // Headline — depth reached (deepest if surfaced)
    ctx.textAlign = 'center';
    const headColor = surfaced ? '#80FFA0' : dPal.accent;
    ctx.fillStyle = hexA(headColor, 0.15);
    ctx.font = 'bold 60px monospace';
    ctx.fillText(`${reportDepth}m`, w / 2, h / 2 - 115);
    ctx.fillStyle = headColor;
    ctx.font = 'bold 56px monospace';
    ctx.fillText(`${reportDepth}m`, w / 2, h / 2 - 117);
    // Zone
    ctx.fillStyle = dPal.textDim;
    ctx.font = '12px monospace';
    ctx.fillText(dPal.zone + ' ZONE', w / 2, h / 2 - 90);
    // Outcome
    if (surfaced) {
        ctx.fillStyle = '#80FFA0';
        ctx.font = 'bold 13px monospace';
        ctx.fillText('SURFACED — HAUL BANKED', w / 2, h / 2 - 72);
    } else {
        ctx.fillStyle = '#AA3040';
        ctx.font = '11px monospace';
        ctx.fillText('HULL BREACH — DSV NEREID-II LOST', w / 2, h / 2 - 72);
    }

    // Stats (compact, two columns)
    const mins = Math.floor(g.runTime / 60);
    const secs = Math.floor(g.runTime % 60);
    ctx.font = '11px monospace';
    const leftStats = [
        { label: 'TIME', value: `${mins}:${secs.toString().padStart(2, '0')}` },
        { label: 'WAVE', value: g.wave },
        { label: 'KILLS', value: g.kills },
    ];
    const rightStats = [
        { label: 'COMBO', value: g.bestCombo },
        { label: 'GOLD', value: `+${g.goldEarned}` },
        { label: 'CODEX', value: `${meta.loreFragments.length}/${LORE_FRAGMENTS.length}` },
    ];
    for (let i = 0; i < leftStats.length; i++) {
        ctx.fillStyle = dPal.textDim; ctx.textAlign = 'right';
        ctx.fillText(leftStats[i].label, w / 2 - 20, h / 2 - 45 + i * 20);
        ctx.fillStyle = dPal.text; ctx.textAlign = 'left';
        ctx.fillText(leftStats[i].value, w / 2 - 10, h / 2 - 45 + i * 20);
    }
    for (let i = 0; i < rightStats.length; i++) {
        ctx.fillStyle = dPal.textDim; ctx.textAlign = 'right';
        ctx.fillText(rightStats[i].label, w / 2 + 80, h / 2 - 45 + i * 20);
        ctx.fillStyle = dPal.text; ctx.textAlign = 'left';
        ctx.fillText(rightStats[i].value, w / 2 + 90, h / 2 - 45 + i * 20);
    }

    // NEREID final words
    if (g.nereidLog && g.nereidLog.length > 0) {
        ctx.fillStyle = hexA(dPal.accent, 0.5);
        ctx.font = 'italic 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText('"' + g.nereidLog[0].text + '"', w / 2, h / 2 + 25);
    }

    // Near-miss hook — depth to next zone
    const zones = [200, 1000, 2000, 4000, 6000];
    const nextZone = zones.find(z => z > g.depth);
    if (nextZone) {
        const pct = Math.floor(((g.depth % (nextZone - (zones[zones.indexOf(nextZone) - 1] || 0))) / (nextZone - (zones[zones.indexOf(nextZone) - 1] || 0))) * 100);
        ctx.fillStyle = dPal.accent; ctx.font = '12px monospace';
        ctx.fillText(`${100 - pct}m to ${getDepthPalette(nextZone).zone} ZONE`, w / 2, h / 2 + 50);
    }

    // Buttons
    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(w / 2 - 100, h / 2 + 100, 200, 40);
    ctx.strokeStyle = '#5ADFCF';
    ctx.lineWidth = 2;
    ctx.strokeRect(w / 2 - 100, h / 2 + 100, 200, 40);
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('RETURN TO BASE [Enter]', w / 2, h / 2 + 125);

    ctx.fillStyle = '#1a2a3a';
    ctx.fillRect(w / 2 - 100, h / 2 + 150, 200, 40);
    ctx.strokeStyle = '#DAA520';
    ctx.strokeRect(w / 2 - 100, h / 2 + 150, 200, 40);
    ctx.fillStyle = '#DAA520';
    ctx.fillText('UPGRADES [U]', w / 2, h / 2 + 175);
    addTapZone(w / 2 - 100, h / 2 + 100, 200, 40, 'Enter');
    addTapZone(w / 2 - 100, h / 2 + 150, 200, 40, 'u');
}

// =====================================================================
// FEATURE 1: Pause Menu
// =====================================================================
function drawPauseOverlay(w, h, g) {
    // NOTE: hitTapZone is first-match-wins — the fullscreen resume zone is
    // registered at the END so the option rows underneath stay tappable.
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ADFCF';
    ctx.font = 'bold 26px monospace';
    const compact = h < 460;
    const rowH = compact ? 30 : 36;
    let ry = compact ? 52 : h / 2 - 150;
    ctx.fillText('PAUSED', w / 2, ry - (compact ? 18 : 24));
    // Every row is a tap zone — phones have no keyboard. ◂ ▸ rows get
    // split zones (left half = down, right half = up).
    const rows = [
        { label: '[ESC] Resume', key: 'Escape', color: '#5ADFCF' },
        { label: `[M] Sound: ${meta.muted ? 'MUTED' : 'on'}`, key: 'm' },
        { label: `[ ◂ ] Master ${Math.round(meta.volume * 100)}% [ ▸ ]`, keyL: '[', keyR: ']' },
        { label: `[ ◂ ] Music ${Math.round((meta.musicVol != null ? meta.musicVol : 0.7) * 100)}% [ ▸ ]`, keyL: ',', keyR: '.' },
        { label: `[ ◂ ] SFX ${Math.round((meta.sfxVol != null ? meta.sfxVol : 1) * 100)}% [ ▸ ]`, keyL: ';', keyR: "'" },
        { label: '[N] Next track (this zone)', key: 'n' },
        { label: `[V] World zoom: ${meta.worldZoom ? Math.round(meta.worldZoom * 100) + '%' : 'auto'}`, key: 'v' },
        { label: `[T] HUD text: ${Math.round((meta.uiScale || 1) * 100)}%`, key: 't' },
        { label: `[H] High-contrast HUD: ${meta.hudContrast ? 'ON' : 'off'}`, key: 'h' },
        { label: '[Q] Quit to Title', key: 'q', color: '#C47840' },
    ];
    ctx.font = (compact ? '12px' : '13px') + ' monospace';
    const zoneW = 300;
    for (const row of rows) {
        ctx.fillStyle = row.color || '#AAB8C2';
        ctx.fillText(row.label, w / 2, ry);
        if (row.key) addTapZone(w / 2 - zoneW / 2, ry - rowH / 2 - 4, zoneW, rowH, row.key);
        else { addTapZone(w / 2 - zoneW / 2, ry - rowH / 2 - 4, zoneW / 2, rowH, row.keyL); addTapZone(w / 2, ry - rowH / 2 - 4, zoneW / 2, rowH, row.keyR); }
        ry += rowH;
    }
    addTapZone(0, 0, w, h, 'Escape');   // tap anywhere outside the rows resumes
}

// =====================================================================
// FEATURE 7: Sonar Radar Minimap
// =====================================================================
// =====================================================================
// FEATURE 10: Touch Controls Overlay
// =====================================================================
function drawTouchControls(w, h) {
    // Joystick (left thumb)
    const jcx = touchJoystick.active ? touchJoystick.startX : 80, jcy = touchJoystick.active ? touchJoystick.startY : h - 140;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#5ADFCF'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(jcx, jcy, 40, 0, PI2); ctx.stroke();
    if (touchJoystick.active) {
        const dx = Math.min(40, Math.max(-40, touchJoystick.x - touchJoystick.startX));
        const dy = Math.min(40, Math.max(-40, touchJoystick.y - touchJoystick.startY));
        ctx.fillStyle = '#5ADFCF';
        ctx.beginPath(); ctx.arc(jcx + dx, jcy + dy, 15, 0, PI2); ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(90,220,200,0.5)';
        ctx.beginPath(); ctx.arc(jcx, jcy, 15, 0, PI2); ctx.fill();
    }
    // Action buttons — geometry shared with the hit-test in onTouchStart
    for (const b of getTouchButtons(w, h)) {
        const isDash = b.id === 'dash';
        const pressed = (isDash && touchDash.active) || b.active;
        ctx.strokeStyle = b.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, PI2); ctx.stroke();
        ctx.fillStyle = hexA(b.color, pressed ? 0.5 : 0.18);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, PI2); ctx.fill();
        ctx.fillStyle = b.color; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(b.label, b.x, b.y + 4);
    }
    ctx.globalAlpha = 1;
}

function drawTitle(w, h) {
    // Animated deep ocean background
    const tt = Date.now() / 1000;
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, w, h);
    // Concept art background — cover-fit, dimmed for text legibility. Falls back to particle bg if missing.
    if (titleBgImg && titleBgImg._ready) {
        const iw = titleBgImg.naturalWidth || 1, ih = titleBgImg.naturalHeight || 1;
        const scale = Math.max(w / iw, h / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(titleBgImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
        ctx.fillStyle = 'rgba(0,4,10,0.58)';
        ctx.fillRect(0, 0, w, h);
    }
    // Slow drifting particles
    ctx.fillStyle = 'rgba(40,80,100,0.03)';
    for (let i = 0; i < 20; i++) {
        const px = (Math.sin(tt * 0.1 + i * 3.7) * 0.5 + 0.5) * w;
        const py = (Math.cos(tt * 0.08 + i * 2.3) * 0.5 + 0.5) * h;
        ctx.beginPath(); ctx.arc(px, py, 20 + Math.sin(tt + i) * 10, 0, PI2); ctx.fill();
    }

    // === Vertical layout — anchored from screen edges, NOT h/2, so it scales to all browser sizes ===
    const TITLE_Y    = Math.min(90, h * 0.10);
    const TAGLINE_Y  = TITLE_Y + 26;
    const SUBTITLE_Y = TAGLINE_Y + 18;
    const ACTIONS_Y  = SUBTITLE_Y + 30;
    const STRIP_Y    = ACTIONS_Y + 28;       // character cards
    const DETAIL_Y   = STRIP_Y + 134;        // sub detail panel (cells 120 + 14 gap)

    ctx.textAlign = 'center';
    // Title (with soft glow)
    ctx.fillStyle = 'rgba(90,220,200,0.08)';
    ctx.font = 'bold 52px monospace';
    ctx.fillText('DEEP SWARM', w / 2, TITLE_Y);
    ctx.fillStyle = '#5ADFCF';
    ctx.font = 'bold 48px monospace';
    ctx.fillText('DEEP SWARM', w / 2, TITLE_Y);

    // Tagline + subtitle
    ctx.fillStyle = '#4A6A7A';
    ctx.font = '12px monospace';
    ctx.fillText('MERIDIAN DEEP CORP — DSV NEREID-II — DESCENT PROTOCOL', w / 2, TAGLINE_Y);
    const subAlpha = 0.3 + Math.sin(tt * 0.5) * 0.15;
    ctx.fillStyle = `rgba(90,160,170,${subAlpha})`;
    ctx.font = '11px monospace';
    ctx.fillText(meta.totalRuns === 0 ? '"The ocean remembers everything you forget."' : `"${meta.totalRuns} dives. ${meta.totalKills} dead. The swarm grows."`, w / 2, SUBTITLE_Y);

    // === Character select ===
    const chars = Object.entries(CHARACTERS);
    const cellW = 130, cellH = 120, cellGap = 14;
    const stripW = chars.length * cellW + (chars.length - 1) * cellGap;
    const stripX = w / 2 - stripW / 2;
    const stripY = STRIP_Y;
    for (let i = 0; i < chars.length; i++) {
        const [id, ch] = chars[i];
        const bx = stripX + i * (cellW + cellGap), by = stripY;
        const unlocked = meta.unlocked.includes(id);
        const selected = meta.selectedChar === id;
        addTapZone(bx, by, cellW, cellH, String(i + 1));
        // Card body
        ctx.fillStyle = selected ? '#0E2030' : '#080F18';
        ctx.beginPath(); ctx.roundRect(bx, by, cellW, cellH, 6); ctx.fill();
        ctx.strokeStyle = selected ? ch.color : (unlocked ? '#2A3540' : '#1A2028');
        ctx.lineWidth = selected ? 2 : 1;
        ctx.beginPath(); ctx.roundRect(bx, by, cellW, cellH, 6); ctx.stroke();

        if (unlocked) {
            // Sub silhouette — circle in sub color with bow lamp
            const subCx = bx + cellW / 2, subCy = by + 38;
            drawGlow(ctx, ch.color, subCx, subCy, 30, selected ? 0.7 : 0.4);
            ctx.fillStyle = ch.color;
            ctx.beginPath(); ctx.arc(subCx, subCy, 14, 0, PI2); ctx.fill();
            ctx.fillStyle = '#FFF';
            ctx.beginPath(); ctx.arc(subCx + 11, subCy, 2.5, 0, PI2); ctx.fill();
            // Name/tagline/stats — ellipsized to the cell (they overran on playtest)
            const fitT = (t) => { let x = String(t || ''); while (x.length > 2 && ctx.measureText(x).width > cellW - 10) x = x.slice(0, -2).trimEnd() + '…'; return x; };
            ctx.textAlign = 'center';
            ctx.fillStyle = selected ? '#FFF' : '#9AB0C0'; ctx.font = 'bold 11px monospace';
            ctx.fillText(fitT(ch.name), bx + cellW / 2, by + 72);
            ctx.fillStyle = '#5A6A7A'; ctx.font = '10px monospace';
            ctx.fillText(fitT(ch.tagline), bx + cellW / 2, by + 86);
            ctx.fillStyle = '#7A8A98'; ctx.font = '10px monospace';
            ctx.fillText(fitT(`HP ${ch.hp} · SPD ${ch.speed} · ${ch.crushDepth}m`), bx + cellW / 2, by + 100);
            // Key
            ctx.fillStyle = ch.color; ctx.font = 'bold 11px monospace';
            ctx.fillText(`[${i + 1}]`, bx + cellW / 2, by + 114);
        } else {
            ctx.textAlign = 'center';
            ctx.fillStyle = '#2A3540'; ctx.font = 'bold 22px monospace';
            ctx.fillText('???', bx + cellW / 2, by + 50);
            ctx.fillStyle = '#5A6A7A'; ctx.font = '10px monospace';
            const lines2 = (ch.desc || '').split('. Unlock: ');
            ctx.fillText('LOCKED', bx + cellW / 2, by + 78);
            ctx.fillStyle = '#444A52'; ctx.font = '9px monospace';
            ctx.fillText('see codex', bx + cellW / 2, by + 92);
        }
    }

    // === DETAIL PANEL — full info on the selected sub ===
    const sel = CHARACTERS[meta.selectedChar];
    if (sel) {
        const dpW = Math.min(720, stripW);
        const dpX = w / 2 - dpW / 2;
        const dpY = DETAIL_Y;
        const dpH = 160;
        ctx.fillStyle = '#06101A';
        ctx.beginPath(); ctx.roundRect(dpX, dpY, dpW, dpH, 6); ctx.fill();
        ctx.strokeStyle = hexA(sel.color, 0.55); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.roundRect(dpX, dpY, dpW, dpH, 6); ctx.stroke();
        // Name + tagline
        ctx.textAlign = 'left';
        ctx.fillStyle = sel.color; ctx.font = 'bold 14px monospace';
        ctx.fillText(sel.name, dpX + 14, dpY + 20);
        ctx.fillStyle = '#7A8A98'; ctx.font = 'italic 10px monospace';
        ctx.fillText(sel.tagline || '', dpX + 14, dpY + 34);
        // Description (wrapped)
        ctx.fillStyle = '#AAB8C2'; ctx.font = '10px monospace';
        const words = (sel.desc || '').split(' ');
        let line = '', y = dpY + 52;
        const maxW = dpW - 28;
        for (const word of words) {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > maxW) { ctx.fillText(line, dpX + 14, y); line = word + ' '; y += 13; }
            else line = test;
        }
        if (line) { ctx.fillText(line, dpX + 14, y); y += 13; }

        // Strengths / Weaknesses two columns
        const colY = y + 12;
        const colW = (dpW - 42) / 2;
        // Strengths
        ctx.fillStyle = '#80E0A0'; ctx.font = 'bold 11px monospace';
        ctx.fillText('STRENGTHS', dpX + 14, colY);
        ctx.fillStyle = '#A0E8B0'; ctx.font = '11px monospace';
        for (let i = 0; i < (sel.strengths || []).length; i++) {
            ctx.fillText('+ ' + sel.strengths[i], dpX + 14, colY + 14 + i * 11);
        }
        // Weaknesses
        const wxX = dpX + 14 + colW + 14;
        ctx.fillStyle = '#FF8060'; ctx.font = 'bold 11px monospace';
        ctx.fillText('WEAKNESSES', wxX, colY);
        ctx.fillStyle = '#FFB0A0'; ctx.font = '11px monospace';
        for (let i = 0; i < (sel.weaknesses || []).length; i++) {
            ctx.fillText('− ' + sel.weaknesses[i], wxX, colY + 14 + i * 11);
        }
    }

    // ===== HULL STATUS — persistent damage display + repair prompt =====
    {
        const hc = meta.hullCondition != null ? meta.hullCondition : 100;
        const hullColor = hc > 70 ? '#4A9A6A' : hc > 35 ? '#DAA520' : '#DA4060';
        const hullX = w / 2 - 200, hullY = h - 154, hullW = 400, hullH = 14;
        ctx.fillStyle = '#070D14';
        ctx.beginPath(); ctx.roundRect(hullX, hullY, hullW, hullH, 4); ctx.fill();
        ctx.fillStyle = hullColor;
        ctx.beginPath(); ctx.roundRect(hullX + 1, hullY + 1, (hullW - 2) * (hc / 100), hullH - 2, 3); ctx.fill();
        ctx.strokeStyle = hexA(hullColor, 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(hullX, hullY, hullW, hullH, 4); ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillStyle = hullColor; ctx.font = 'bold 11px monospace';
        ctx.fillText('HULL', hullX, hullY - 2);
        ctx.textAlign = 'right'; ctx.fillStyle = hullColor;
        ctx.fillText(`${Math.floor(hc)}%`, hullX + hullW, hullY - 2);
        // Repair prompt — only show if damaged
        if (hc < 100) {
            const need = 100 - hc;
            const cost = Math.min(need, Math.floor(meta.gold / 5)) * 5;
            ctx.textAlign = 'center'; ctx.font = '10px monospace';
            const canRepair = meta.gold >= 5;
            ctx.fillStyle = canRepair ? '#FFD040' : '#5A4A30';
            ctx.fillText(canRepair ? `[H] REPAIR  · ${cost}g  (5g per +1%)` : `[H] REPAIR  · need ${5 - meta.gold}g more`, w / 2, hullY + 26);
        } else {
            ctx.textAlign = 'center'; ctx.fillStyle = '#5A6A7A'; ctx.font = '10px monospace';
            ctx.fillText('Hull at full integrity. Ready to dive.', w / 2, hullY + 26);
        }
    }

    // Stats — beneath the hull row, properly spaced. Includes DSV LIFE counter (resets on death).
    if (meta.totalRuns > 0) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#556';
        ctx.font = '11px monospace';
        ctx.fillText(`Runs: ${meta.totalRuns}  ·  DSV-${(meta.dsvLife||1).toString().padStart(2,'0')}  ·  Kills: ${meta.totalKills}  ·  Gold: ${meta.gold}  ·  Best: Wave ${meta.bestWave}`, w / 2, h - 90);
    }

    // Composable stakes — toggle chips (Pact of Punishment)
    if ((meta.stakesUnlocked || 0) > 0) {
        const active = new Set(meta.stakeSet || []);
        const chipW = 118, chipH = 34, chipGap = 8;
        const rowW = STAKE_DEFS.length * chipW + (STAKE_DEFS.length - 1) * chipGap;
        let cx0 = w / 2 - rowW / 2;
        const chipY = h - 64;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7A8A9A'; ctx.font = 'bold 10px monospace';
        ctx.fillText(`STAKES — each active pays +15% gold & score   ·   active: ${active.size}`, w / 2, chipY - 8);
        for (let si = 0; si < STAKE_DEFS.length; si++) {
            const sd = STAKE_DEFS[si];
            const unlocked = si < (meta.stakesUnlocked || 0);
            const on = active.has(sd.id);
            ctx.fillStyle = on ? hexA(sd.color, 0.25) : '#080F16';
            ctx.beginPath(); ctx.roundRect(cx0, chipY, chipW, chipH, 5); ctx.fill();
            ctx.strokeStyle = on ? sd.color : (unlocked ? '#3A4A5A' : '#1A2028');
            ctx.lineWidth = on ? 2 : 1;
            ctx.beginPath(); ctx.roundRect(cx0, chipY, chipW, chipH, 5); ctx.stroke();
            ctx.fillStyle = unlocked ? (on ? sd.color : '#8A9AAA') : '#2A3540';
            ctx.font = 'bold 11px monospace';
            ctx.fillText(unlocked ? `[${sd.key}] ${sd.name.toUpperCase()}` : 'LOCKED', cx0 + chipW / 2, chipY + 14);
            ctx.fillStyle = unlocked ? '#5A6A7A' : '#222A32'; ctx.font = '8px monospace';
            ctx.fillText(unlocked ? sd.desc : 'reach wave 15 at full stakes', cx0 + chipW / 2, chipY + 27);
            if (unlocked) addTapZone(cx0, chipY, chipW, chipH, sd.key);
            cx0 += chipW + chipGap;
        }
    }

    // (Action prompts now at top — see ACTIONS_Y below the subtitle)
    ctx.textAlign = 'center';
    // Daily / destination / signal / ending readouts — bottom strip, clear of
    // the tagline stack (they used to collide with the subtitle).
    ctx.font = '10px monospace';
    if (dailyArmed) {
        ctx.fillStyle = '#E8D080';
        ctx.fillText('◈ DAILY DIVE ARMED — ' + dayKeyUTC() + ' brief for everyone  [D] disarm', w / 2, h - 26);
    } else {
        ctx.fillStyle = '#5A6A7A';
        const db = meta.dailyBest && meta.dailyBest.date === dayKeyUTC() ? ('  ·  today\'s best ' + meta.dailyBest.score.toLocaleString()) : '';
        ctx.fillText('[D] daily dive' + db + '   ·   ⌁ ' + (meta.signal || 0) + ' signal', w / 2, h - 26);
    }
    addTapZone(w / 2 - 160, h - 38, 320, 16, 'd');
    if (meta.p3Unlocked) {
        const p3 = meta.destination === 'p3';
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = p3 ? '#C87840' : '#4A8ADA';
        ctx.fillText(p3 ? 'DESTINATION: PELAGOS-3 — THE SCAR  [P] switch' : 'DESTINATION: PELAGOS-9  [P] switch', w / 2, h - 44);
        if (p3) { ctx.fillStyle = '#7A5A48'; ctx.font = '9px monospace'; ctx.fillText('dead ocean · drowned machinery · the survey never came back', w / 2, h - 12); }
        addTapZone(w / 2 - 160, h - 56, 320, 18, 'p');
    }
    if (meta.ending) {
        ctx.fillStyle = meta.ending === 'answered' ? '#7AC8B8' : '#8A7A88';
        ctx.font = 'italic 10px monospace';
        ctx.fillText(meta.ending === 'answered' ? 'NEREID remembers her answer.' : 'The question is still down there, keeping.', w / 2, h - 62);
    }
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 16px monospace';
    ctx.fillText('[ENTER] DIVE', w / 2, ACTIONS_Y);
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#DAA520';
    ctx.fillText('[U] UPGRADES', w / 2 - 150, ACTIONS_Y + 18);
    ctx.fillStyle = '#5AAFDA';
    ctx.fillText(`[C] CODEX ${meta.loreFragments.length}/${LORE_FRAGMENTS.length}`, w / 2, ACTIONS_Y + 18);
    ctx.fillStyle = '#A0E0A0';
    ctx.fillText('[T] TUTORIAL', w / 2 + 150, ACTIONS_Y + 18);
    addTapZone(w / 2 - 110, ACTIONS_Y - 18, 220, 24, 'Enter');
    addTapZone(w / 2 - 210, ACTIONS_Y + 4, 120, 22, 'u');
    addTapZone(w / 2 - 65, ACTIONS_Y + 4, 130, 22, 'c');
    addTapZone(w / 2 + 90, ACTIONS_Y + 4, 120, 22, 't');
}

// =====================================================================
// TUTORIAL — controls + mechanics reference. [T] from title.
// =====================================================================
function drawTutorial(w, h) {
    ctx.fillStyle = '#020610'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#A0E0A0'; ctx.font = 'bold 28px monospace';
    ctx.fillText('PILOT TRAINING', w / 2, 60);
    ctx.fillStyle = '#5A6A7A'; ctx.font = '11px monospace';
    ctx.fillText('Read carefully. The trench does not forgive.', w / 2, 84);

    const sections = [
        { title: 'CONTROLS', items: [
            ['WASD / arrows', 'Thruster control (sub has inertia — drift is real)'],
            ['SPACE / SHIFT',  'Dash toward your MOUSE cursor (or held WASD direction)'],
            ['F  /  LEFT-CLICK', 'Manual sonar PING — reveals + damages in a wide ring'],
            ['Q',              'SILENT RUNNING — weapons hold, lights cut, slow + near-invisible'],
            ['E  (hold)',      'Salvage a wreck — must be near it'],
            ['Z',              'ASCEND — one-way commit. Reach 0m to bank everything'],
            ['TAB / I',        'View salvage hold — banks at surface'],
            ['ESC',            'Pause / close menu'],
        ] },
        { title: 'CORE LOOP', items: [
            ['Dive',           'Sub sinks automatically. Fight, collect, descend.'],
            ['Loot',           'Enemies + wrecks drop GEMS (XP) and SALVAGE (gold).'],
            ['Death',          'You lose EVERYTHING you collected. Hull is damaged.'],
            ['Ascend',         'Press Z. Climb against fewer enemies. Reach 0m to KEEP loot.'],
            ['Base',           'Repair hull, buy meta upgrades, swap subs, dive again.'],
        ] },
        { title: 'KEY MECHANICS', items: [
            ['Weapon fusion',  'Any two weapons at LV4+ can FUSE at level-up. Every pair works.'],
            ['Fusion codex',   'Discovered fusions log permanently. 18 to find.'],
            ['Hull condition', 'Persists between dives. Repair at base (5g per +1%).'],
            ['Crush depth',    'Past your sub\'s rating, hull takes continuous damage.'],
            ['Trench shrinks', 'World boundary tightens with depth. Less room deeper.'],
            ['Below 2600m',    'Something patrols. Weapons will not answer it. Silence will.'],
            ['Gem tiers',      'Blue / Green / Violet / Gold — higher tier = more XP + bonuses.'],
            ['Sonar reveals',  'Wreck loot is ??? until you ping it.'],
        ] },
    ];

    let y = 130;
    for (const sec of sections) {
        ctx.fillStyle = '#80E0A0'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
        ctx.fillText(sec.title, w / 2 - 320, y);
        y += 18;
        ctx.font = '11px monospace';
        for (const [key, desc] of sec.items) {
            ctx.fillStyle = '#80B0FF'; ctx.fillText(key, w / 2 - 320, y);
            ctx.fillStyle = '#9AB0C0'; ctx.fillText(desc, w / 2 - 140, y);
            y += 16;
        }
        y += 10;
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = '#5A6A7A'; ctx.font = '11px monospace';
    ctx.fillText('[ESC] Back to menu', w / 2, h - 30);
    addTapZone(0, h - 60, w, 60, 'Escape');
}

function drawWorkshop(w, h) {
    ctx.fillStyle = '#020610';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#DAA520';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('WORKSHOP', w / 2, 50);
    ctx.fillStyle = '#8A9AAA';
    ctx.font = '11px monospace';
    ctx.fillText('Combine salvaged materials into processed components. Tier-3 unlocks come next.', w / 2, 72);

    // Salvage stockpile row
    ctx.fillStyle = '#5ADFCF';
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SALVAGE STOCKPILE', 60, 110);
    const matIds = Object.keys(MATERIAL_DISPLAY);
    let mx = 60;
    for (const mid of matIds) {
        const disp = MATERIAL_DISPLAY[mid];
        const qty = (meta.materials || {})[mid] || 0;
        ctx.fillStyle = qty > 0 ? disp.color : '#3A4A5A';
        ctx.font = 'bold 18px monospace';
        ctx.fillText(disp.glyph, mx, 142);
        ctx.fillStyle = qty > 0 ? '#FFF' : '#555';
        ctx.font = '11px monospace';
        ctx.fillText(`×${qty}`, mx + 20, 142);
        mx += 90;
    }

    // Recipe list
    ctx.fillStyle = '#5ADFCF';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('RECIPES — TIER 2', 60, 180);

    const mats = meta.materials || {};
    addTapZone(0, h - 50, w, 50, 'Escape');
    for (let i = 0; i < RECIPE_DEFS.length; i++) {
        const r = RECIPE_DEFS[i];
        const by = 200 + i * 64;
        const bx = 60;
        const bw = w - 120;
        addTapZone(bx, by, bw, 56, String(i + 1));
        let canCraft = true;
        for (const [matId, qty] of Object.entries(r.ingredients)) {
            if ((mats[matId] || 0) < qty) { canCraft = false; break; }
        }
        ctx.fillStyle = '#0A1520';
        ctx.fillRect(bx, by, bw, 56);
        ctx.strokeStyle = canCraft ? r.color : '#2A3540';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, 56);

        ctx.fillStyle = canCraft ? r.color : '#3A4A5A';
        ctx.font = 'bold 26px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(r.glyph, bx + 24, by + 36);

        const owned = (meta.workshop || {})[r.id] || 0;
        ctx.fillStyle = canCraft ? '#FFF' : '#7A8A9A';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${r.name} (owned ×${owned})`, bx + 52, by + 22);

        ctx.fillStyle = '#7A8A9A';
        ctx.font = '10px monospace';
        ctx.fillText(r.desc, bx + 52, by + 38);

        const ingParts = Object.entries(r.ingredients).map(([mid, q]) => {
            const have = (mats[mid] || 0);
            const disp = MATERIAL_DISPLAY[mid];
            return `${disp ? disp.glyph : '?'}${mid}×${q} (${have})`;
        });
        ctx.fillStyle = canCraft ? '#A0DDD0' : '#5A6A7A';
        ctx.font = '10px monospace';
        ctx.fillText(ingParts.join('   '), bx + 52, by + 52);

        ctx.fillStyle = canCraft ? '#DAA520' : '#3A4A50';
        ctx.font = 'bold 16px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`[${i + 1}]`, bx + bw - 16, by + 32);
    }

    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[1-' + RECIPE_DEFS.length + '] craft   ·   [ESC] back', w / 2, h - 30);
}

function drawShop(w, h) {
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#DAA520';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('UPGRADES', w / 2, 50);
    ctx.fillStyle = '#AAA';
    ctx.font = '14px monospace';
    ctx.fillText(`Gold: ${meta.gold}`, w / 2, 80);

    const upgrades = [
        { key: 'damage', name: 'DAMAGE +5%', cost: lv => 10 + lv * 15 },
        { key: 'hp', name: 'MAX HP +5', cost: lv => 10 + lv * 10 },
        { key: 'speed', name: 'SPEED +5%', cost: lv => 15 + lv * 15 },
        { key: 'xpGain', name: 'XP GAIN +10%', cost: lv => 20 + lv * 20 },
    ];

    for (let i = 0; i < upgrades.length; i++) {
        const up = upgrades[i];
        const lv = meta.upgrades[up.key];
        const cost = up.cost(lv);
        const bx = w / 2 - 180, by = 110 + i * 55;
        const canBuy = meta.gold >= cost;
        addTapZone(bx, by, 360, 45, String(i + 1));
        ctx.fillStyle = '#0a1520';
        ctx.fillRect(bx, by, 360, 45);
        ctx.strokeStyle = canBuy ? '#5ADFCF' : '#333';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, 360, 45);
        ctx.fillStyle = canBuy ? '#FFF' : '#555';
        ctx.font = '13px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${up.name} (Lv ${lv})`, bx + 15, by + 20);
        ctx.textAlign = 'right';
        ctx.fillStyle = canBuy ? '#DAA520' : '#555';
        ctx.fillText(`${cost}g [${i + 1}]`, bx + 345, by + 20);
        ctx.fillStyle = '#666';
        ctx.font = '10px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`Current: +${lv * (up.key === 'hp' ? 5 : up.key === 'xpGain' ? 10 : 5)}${up.key === 'hp' ? ' HP' : '%'}`, bx + 15, by + 36);
    }

    // --- MATERIALS readout ---
    const matY = 110 + upgrades.length * 55 + 12;
    const mtxt = Object.keys(BASE_MATERIALS).map(k => `${BASE_MATERIALS[k].glyph}${meta.materials[k] || 0}`).join('    ');
    ctx.fillStyle = '#9AB0C0'; ctx.font = '13px monospace'; ctx.textAlign = 'center';
    ctx.fillText('MATERIALS:   ' + mtxt, w / 2, matY);
    // --- FABRICATE (spend materials to refit the submersible) ---
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 14px monospace';
    ctx.fillText('— FABRICATE — refit the submersible —', w / 2, matY + 26);
    for (let i = 0; i < FAB_RECIPES.length; i++) {
        const fr = FAB_RECIPES[i];
        const unlocked = fabUnlocked(fr);
        const lv = meta.fab[fr.key] || 0;
        const bx = w / 2 - 220, by = matY + 40 + i * 38;
        const ok = unlocked && canAfford(fr.cost);
        addTapZone(bx, by, 440, 32, String(5 + i));
        ctx.fillStyle = '#0a1520'; ctx.fillRect(bx, by, 440, 32);
        ctx.strokeStyle = ok ? '#5ADFCF' : '#333'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, 440, 32);
        ctx.textAlign = 'left';
        if (!unlocked) {
            ctx.fillStyle = '#5A6A7A'; ctx.font = '12px monospace';
            ctx.fillText(`[${5 + i}] ◈ BLUEPRINT LOCKED — ${fr.name.split('  ')[0]}`, bx + 12, by + 14);
            ctx.fillStyle = '#46708a'; ctx.font = '10px monospace';
            ctx.fillText(`reverse-engineer by scanning ${fr.req} creatures  (${(meta.scannedCreatures||[]).length}/${fr.req})`, bx + 12, by + 27);
        } else {
            ctx.fillStyle = ok ? '#FFF' : '#666'; ctx.font = '12px monospace';
            ctx.fillText(`[${5 + i}] ${fr.name}  (Lv ${lv})`, bx + 12, by + 14);
            ctx.fillStyle = ok ? '#DAA520' : '#555'; ctx.font = '10px monospace';
            ctx.fillText(matsLabel(fr.cost), bx + 12, by + 27);
        }
    }
    ctx.fillStyle = '#888'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[1-4] buy with gold   ·   [5-9] fabricate with materials   ·   [ESC] Back', w / 2, matY + 40 + FAB_RECIPES.length * 38 + 22);
    addTapZone(0, h - 50, w, 50, 'Escape');
}

// --- The Mooring (surface hub) — refit, then dive again. The two-phase loop. ---
function drawMooring(w, h, g) {
    ctx.fillStyle = '#02060a'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 26px monospace';
    ctx.fillText('THE MOORING', w / 2, 70);
    ctx.fillStyle = '#7A8A9A'; ctx.font = '12px monospace';
    ctx.fillText('surface tether — strip the haul, refit the sub, dive again', w / 2, 94);
    const cash = (g && g._surfacedCash) || 0, dep = (g && g._surfacedDepth) || 0;
    ctx.fillStyle = '#A0E8B0'; ctx.font = '14px monospace';
    ctx.fillText('Hauled up from ' + dep + 'm  ·  salvage cashed: ' + cash + 'g', w / 2, 142);
    ctx.fillStyle = '#DAA520'; ctx.font = '13px monospace';
    ctx.fillText('Gold ' + meta.gold + '      Hull ' + (meta.hullCondition | 0) + '%', w / 2, 168);
    const mtxt = Object.keys(BASE_MATERIALS).map(k => `${BASE_MATERIALS[k].glyph}${meta.materials[k] || 0}`).join('    ');
    ctx.fillStyle = '#9AB0C0'; ctx.font = '12px monospace';
    ctx.fillText('Materials  ' + mtxt, w / 2, 194);
    ctx.fillStyle = '#7A8A9A'; ctx.font = '11px monospace';
    ctx.fillText((meta.scannedCreatures || []).length + ' creatures catalogued — blueprints reverse-engineered from scans', w / 2, 216);
    // THE QUESTION — NEREID's one ask, earned by reading deep and hearing the Scar.
    // Replaces the beat until answered; the answer is permanent.
    if (g && g._theQuestion && !meta.ending) {
        ctx.fillStyle = 'rgba(90,223,207,0.06)'; ctx.fillRect(w / 2 - 260, 224, 520, 96);
        ctx.strokeStyle = '#5ADFCF'; ctx.lineWidth = 1; ctx.strokeRect(w / 2 - 260, 224, 520, 96);
        ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 10px monospace';
        ctx.fillText('— NEREID · PRIORITY —', w / 2, 240);
        ctx.fillStyle = '#C8E8E0'; ctx.font = 'italic 12px monospace';
        ctx.fillText('"Pilot. You have read what I was. You have heard what still runs on the Scar.', w / 2, 258);
        ctx.fillText('The photograph asked the Abyss a question once. It is my turn. May I answer it?"', w / 2, 274);
        ctx.fillStyle = '#A0E8B0'; ctx.font = 'bold 12px monospace';
        ctx.fillText('[1] ANSWER HER', w / 2 - 100, 302);
        ctx.fillStyle = '#DA8A6A';
        ctx.fillText('[2] SAY NOTHING', w / 2 + 100, 302);
        addTapZone(w / 2 - 190, 288, 180, 22, '1');
        addTapZone(w / 2 + 10, 288, 180, 22, '2');
    } else if (g && g._mooringLine) {
        // NEREID surface-interval beat — one line, picked at surfacing from what the run was
        ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 10px monospace';
        ctx.fillText('— NEREID —', w / 2, 238);
        ctx.fillStyle = '#9AC8C0'; ctx.font = 'italic 12px monospace';
        ctx.fillText(g._mooringLine, w / 2, 254);
    }
    if (g && g._signalEarned && !(g._theQuestion && !meta.ending)) {
        ctx.fillStyle = '#B0A0E8'; ctx.font = '11px monospace';
        ctx.fillText('⌁ +' + g._signalEarned + ' SIGNAL distilled from score  ·  ⌁ ' + (meta.signal || 0) + ' banked — [C] spend in the CODEX', w / 2, 226 - 4);
    }
    const actY = (g && g._theQuestion && !meta.ending) ? 344 : 268;   // the Question needs its room
    ctx.fillStyle = '#0a1520'; ctx.fillRect(w / 2 - 180, actY, 360, 38);
    ctx.strokeStyle = '#5ADFCF'; ctx.lineWidth = 1; ctx.strokeRect(w / 2 - 180, actY, 360, 38);
    ctx.fillStyle = '#FFF'; ctx.font = '14px monospace';
    ctx.fillText('[U]   FABRICATE & REFIT', w / 2, actY + 24);
    ctx.fillStyle = '#0a1520'; ctx.fillRect(w / 2 - 180, actY + 48, 360, 38);
    ctx.strokeStyle = '#DAA520'; ctx.strokeRect(w / 2 - 180, actY + 48, 360, 38);
    ctx.fillStyle = '#FFD040'; ctx.font = 'bold 14px monospace';
    ctx.fillText('[ENTER]   DIVE AGAIN →', w / 2, actY + 72);
    addTapZone(w / 2 - 180, actY, 360, 38, 'u');
    addTapZone(w / 2 - 180, actY + 48, 360, 38, 'Enter');
    // Module bay
    ctx.fillStyle = '#0a1520'; ctx.fillRect(w / 2 - 180, actY + 96, 360, 38);
    ctx.strokeStyle = '#80FFE0'; ctx.lineWidth = 1; ctx.strokeRect(w / 2 - 180, actY + 96, 360, 38);
    ctx.fillStyle = '#80FFE0'; ctx.font = '14px monospace';
    ctx.fillText('[G]   MODULE BAY', w / 2, actY + 120);
    addTapZone(w / 2 - 180, actY + 96, 360, 38, 'g');
}

// --- MODULE BAY — craft and equip biomimetic modules (research-gated) ---
function drawModules(w, h) {
    ctx.fillStyle = '#020610'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 26px monospace';
    ctx.fillText('MODULE BAY', w / 2, 52);
    ctx.fillStyle = '#7A8A9A'; ctx.font = '11px monospace';
    ctx.fillText('study a creature to tier 2 → its biology becomes a schematic → materials build it', w / 2, 74);
    const mtxt = Object.keys(BASE_MATERIALS).map(k => `${BASE_MATERIALS[k].glyph}${meta.materials[k] || 0}`).join('   ');
    ctx.fillStyle = '#9AB0C0'; ctx.font = '12px monospace';
    ctx.fillText('Materials  ' + mtxt, w / 2, 96);
    ctx.fillStyle = '#DAA520';
    ctx.fillText(`Slots — HULL ${equippedInSlot('hull')}/${MODULE_SLOTS.hull} · SYSTEMS ${equippedInSlot('systems')}/${MODULE_SLOTS.systems} · PROW ${equippedInSlot('prow')}/${MODULE_SLOTS.prow} · MOUNT ${equippedInSlot('mount')}/${MODULE_SLOTS.mount}`, w / 2, 116);
    for (let i = 0; i < MODULE_DEFS.length; i++) {
        const m = MODULE_DEFS[i];
        const unlocked = moduleUnlocked(m);
        const owned = meta.modulesOwned.includes(m.id);
        const equipped = meta.modulesEquipped.includes(m.id);
        const affordable = canAfford(m.cost);
        const bx = w / 2 - 330, by = 136 + i * 52, bw = 660, bh = 47;
        addTapZone(bx, by, bw, bh, String(i + 1));
        ctx.fillStyle = equipped ? '#0E2430' : '#0a1420';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = equipped ? '#5ADFCF' : owned ? '#3A6A5A' : unlocked ? '#3A4A5A' : '#1A2430';
        ctx.lineWidth = equipped ? 2 : 1;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.textAlign = 'left';
        ctx.fillStyle = unlocked ? (equipped ? '#80FFE0' : owned ? '#A0D0C0' : '#C0D0DC') : '#3A4A5A';
        ctx.font = 'bold 12px monospace';
        const state = equipped ? 'EQUIPPED' : owned ? 'IN STORES' : unlocked ? (affordable ? 'CRAFTABLE' : 'NEED MATERIALS') : 'LOCKED';
        ctx.fillText(`[${i + 1}] ${m.name}  ·  ${m.slot.toUpperCase()}  ·  ${state}`, bx + 12, by + 20);
        ctx.font = '10px monospace';
        if (unlocked) {
            ctx.fillStyle = '#7A8A9A';
            const dbl = drawbackLabel(m.id);
            ctx.fillText(m.desc + (owned ? '' : '   —   ' + matsLabel(m.cost)), bx + 12, by + 33);
            if (dbl) { ctx.fillStyle = '#9A6A5A'; ctx.fillText(dbl, bx + 12, by + 44); }
        } else {
            const def = ENEMY_TYPES[m.req.type];
            const known = (meta.research[m.req.type] || 0) >= 1;
            ctx.fillStyle = '#46586A';
            ctx.fillText(`schematic locked — research ${known && def ? def.name : 'an unidentified species'} to tier ${m.req.tier} (now ${meta.research[m.req.type] || 0})`, bx + 12, by + 33);
        }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#888'; ctx.font = '13px monospace';
    ctx.fillText('[1-9,0,-] craft / equip / unequip   ·   [ESC] back', w / 2, 136 + MODULE_DEFS.length * 52 + 20);
    addTapZone(0, h - 50, w, 50, 'Escape');
}

// ===== MOBILE CONTRACT BOARD — full-width rows, readable, thumb targets =====
function drawContractsMobile(w, h) {
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 16px monospace';
    ctx.fillText('CONTRACTS — ' + contractSelected.size + '/3', 14, 24);
    ctx.textAlign = 'right'; ctx.fillStyle = '#7A8A9A'; ctx.font = '11px monospace';
    ctx.fillText(meta.gold + 'g', w - 14, 24);
    const rowH = Math.min(52, (h - 130) / Math.max(1, contractBoard.length));
    for (let i = 0; i < contractBoard.length; i++) {
        const o = contractBoard[i];
        const sel = contractSelected.has(i);
        const by = 34 + i * (rowH + 4);
        addTapZone(10, by, w - 20, rowH, String(i + 1));
        ctx.fillStyle = sel ? '#10202c' : '#0a1420';
        ctx.fillRect(10, by, w - 20, rowH);
        ctx.strokeStyle = sel ? '#5ADFCF' : '#22303C'; ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(10, by, w - 20, rowH);
        ctx.textAlign = 'left';
        ctx.fillStyle = sel ? '#80FFE0' : '#B0C4D0'; ctx.font = 'bold 12px monospace';
        ctx.fillText((sel ? '✓ ' : '') + o.brief, 20, by + 20);
        ctx.fillStyle = '#7A6A40'; ctx.font = '11px monospace';
        ctx.fillText('+' + o.scoreBonus + ' · ' + o.reward, 20, by + rowH - 10);
    }
    // Quartermaster row
    const qy = h - 88;
    ctx.textAlign = 'left'; ctx.font = 'bold 11px monospace';
    const stock = [['belt_decoy', '6'], ['belt_mine', '7'], ['belt_flare', '8']];
    let qx = 10;
    const qw = (w - 20 - 16) / 3;
    for (const [bid, key] of stock) {
        const cost = BELT_DEFS[bid].value;
        const n = (meta.beltStock && meta.beltStock[bid]) || 0;
        ctx.fillStyle = '#0a1420'; ctx.fillRect(qx, qy, qw, 36);
        ctx.strokeStyle = meta.gold >= cost ? '#3A6A8A' : '#1A2430'; ctx.lineWidth = 1; ctx.strokeRect(qx, qy, qw, 36);
        ctx.fillStyle = meta.gold >= cost ? '#5AD0FF' : '#3A4A5A';
        ctx.fillText(BELT_DEFS[bid].name.split(' ')[0] + ' ' + cost + 'g' + (n ? ' ×' + n : ''), qx + 8, qy + 23);
        addTapZone(qx, qy, qw, 36, key);
        qx += qw + 8;
    }
    // Dive + back
    ctx.fillStyle = '#0a2520'; ctx.beginPath(); ctx.roundRect(w - 190, h - 44, 180, 38, 8); ctx.fill();
    ctx.strokeStyle = '#80E0A0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(w - 190, h - 44, 180, 38, 8); ctx.stroke();
    ctx.fillStyle = '#80E0A0'; ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center';
    ctx.fillText('DIVE ▼', w - 100, h - 19);
    addTapZone(w - 190, h - 44, 180, 38, 'Enter');
    ctx.textAlign = 'left'; ctx.fillStyle = '#5A6A7A'; ctx.font = '12px monospace';
    ctx.fillText('‹ back', 14, h - 19);
    addTapZone(10, h - 40, 90, 34, 'Escape');
}

// --- Contract Board Screen ---
function drawContracts(w, h) {
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 24px monospace';
    ctx.fillText('CONTRACT BOARD', w / 2, 44);
    ctx.fillStyle = '#888'; ctx.font = '12px monospace';
    ctx.fillText('The Mooring — select up to 3.   [1-5] toggle   ·   [ENTER] dive   ·   [ESC] back', w / 2, 68);
    // QUARTERMASTER — belt consumables, paid in gold, stowed for the dive
    {
        const stock = [['belt_decoy', '6'], ['belt_mine', '7'], ['belt_flare', '8']];
        let qx = w / 2 - 300;
        ctx.textAlign = 'left'; ctx.font = '10px monospace';
        for (const [bid, key] of stock) {
            const cost = BELT_DEFS[bid].value;
            const n = (meta.beltStock && meta.beltStock[bid]) || 0;
            ctx.fillStyle = meta.gold >= cost ? '#5AD0FF' : '#3A4A5A';
            ctx.fillText(`[${key}] ${BELT_DEFS[bid].name} ${cost}g${n ? ' ×' + n : ''}`, qx, h - 30);
            addTapZone(qx - 4, h - 46, 195, 24, key);
            qx += 205;
        }
        ctx.textAlign = 'center';
    }
    ctx.fillStyle = '#7A8A9A'; ctx.font = '11px monospace';
    ctx.fillText(`Selected: ${contractSelected.size}/3`, w / 2, 86);
    for (let i = 0; i < contractBoard.length; i++) {
        const o = contractBoard[i];
        const sel = contractSelected.has(i);
        const bx = w / 2 - 300, by = 102 + i * 64;
        addTapZone(bx, by, 600, 56, String(i + 1));
        ctx.fillStyle = sel ? '#10202c' : '#0a1420';
        ctx.fillRect(bx, by, 600, 56);
        ctx.strokeStyle = sel ? '#5ADFCF' : '#2a3a4a'; ctx.lineWidth = sel ? 2 : 1;
        ctx.strokeRect(bx, by, 600, 56);
        ctx.textAlign = 'left';
        ctx.fillStyle = RISK_COLOR[o.risk]; ctx.font = 'bold 11px monospace';
        ctx.fillText(`[${i + 1}]  ${o.risk} RISK`, bx + 12, by + 19);
        ctx.fillStyle = sel ? '#FFF' : '#C0D0DC'; ctx.font = '12px monospace';
        ctx.fillText(o.brief, bx + 118, by + 19);
        ctx.fillStyle = '#9AB0C0'; ctx.font = '10px monospace';
        const matStr = Object.keys(o._mats).map(k => `${o._mats[k]} ${BASE_MATERIALS[k].name}`).join(', ');
        ctx.fillText(`Reward: ${matStr}   ·   +${o.scoreBonus} signal   ·   ${String(o.reward).toUpperCase()}`, bx + 12, by + 41);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = contractSelected.size > 0 ? '#80E0A0' : '#555';
    ctx.font = 'bold 14px monospace';
    const cfY = 102 + contractBoard.length * 64 + 26;
    ctx.fillText(contractSelected.size > 0 ? '[ENTER] DIVE' : 'select at least one contract', w / 2, cfY);
    if (contractSelected.size > 0) addTapZone(w / 2 - 120, cfY - 18, 240, 28, 'Enter');
}

// =====================================================================
// LOGIC PUZZLE — POWER JUNCTION (Lights Out). Reroute drowned circuitry:
// toggling a node flips it + its neighbours; bring all 9 online. Always
// solvable (scrambled from the solved state). Solve → crafting materials.
// =====================================================================
let puzzleGrid = [], puzzleMoves = 0, puzzleSolved = false;
function _puzzleToggle(grid, i) {
    const r = Math.floor(i / 3), c = i % 3;
    const idxs = [i];
    if (r > 0) idxs.push(i - 3);
    if (r < 2) idxs.push(i + 3);
    if (c > 0) idxs.push(i - 1);
    if (c < 2) idxs.push(i + 1);
    for (const j of idxs) grid[j] = !grid[j];
}
// HULL BREACH — the second minigame: a timed patch sequence. Realistic sub
// failure, hands-on fix: hit the shown thruster keys before the water wins.
let patchState = null;
function openPatch() {
    const keys4 = ['w', 'a', 's', 'd'];
    patchState = {
        seq: Array.from({ length: 5 }, () => keys4[Math.floor(Math.random() * 4)]),
        idx: 0, deadline: Date.now() + 1600, window: 1600, failed: false, done: false,
    };
    phase = 'patch';
}
function pressPatch(k) {
    if (!patchState || patchState.done || patchState.failed) return;
    if (k === patchState.seq[patchState.idx]) {
        patchState.idx++;
        playTone(500 + patchState.idx * 90, 0.08, 'sine', 0.09);
        if (patchState.idx >= patchState.seq.length) {
            patchState.done = true;
            if (game) { addNereidLog(game, 'Patch holding. Textbook hands, Pilot.'); game.streak = 'BREACH SEALED'; game.streakTimer = 2; }
            playSample('salvage', 0.5);
            setTimeout(() => { if (phase === 'patch') phase = 'playing'; }, 900);
        } else {
            patchState.deadline = Date.now() + patchState.window;
        }
    } else {
        failPatch();
    }
}
function failPatch() {
    if (!patchState || patchState.done || patchState.failed) return;
    patchState.failed = true;
    if (game) {
        game._leakT = 8;   // water keeps coming until it equalises
        addNereidLog(game, 'Patch slipped. We are taking water — ride it out or surface.');
        game.streak = 'BREACH — TAKING WATER'; game.streakTimer = 2.5;
    }
    noiseBurst(0.8, 0.1, 250);
    setTimeout(() => { if (phase === 'patch') phase = 'playing'; }, 900);
}
function drawPatch(w, h) {
    if (!patchState) { phase = 'playing'; return; }
    // Timeout check lives here — the draw loop always runs, update() doesn't in menus
    if (!patchState.done && !patchState.failed && Date.now() > patchState.deadline) failPatch();
    ctx.fillStyle = 'rgba(2,6,14,0.9)'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FF7060'; ctx.font = 'bold 22px monospace';
    ctx.fillText('HULL BREACH', w / 2, h / 2 - 110);
    ctx.fillStyle = '#9AB0C0'; ctx.font = '12px monospace';
    ctx.fillText('Brace the patch — hit the thruster keys IN ORDER before the water wins.', w / 2, h / 2 - 86);
    const KEY_LABEL = { w: '▲ W', a: '◀ A', s: '▼ S', d: '▶ D' };
    const cellW2 = 64, gap2 = 14;
    const totalW2 = patchState.seq.length * (cellW2 + gap2) - gap2;
    let kx = w / 2 - totalW2 / 2;
    for (let i = 0; i < patchState.seq.length; i++) {
        const done = i < patchState.idx;
        const cur = i === patchState.idx && !patchState.done && !patchState.failed;
        ctx.fillStyle = done ? '#0E3020' : cur ? '#1A2A3A' : '#0A121C';
        ctx.beginPath(); ctx.roundRect(kx, h / 2 - 50, cellW2, 64, 8); ctx.fill();
        ctx.strokeStyle = done ? '#4AE0A0' : cur ? '#5ADFCF' : '#22303C'; ctx.lineWidth = cur ? 2.5 : 1;
        ctx.beginPath(); ctx.roundRect(kx, h / 2 - 50, cellW2, 64, 8); ctx.stroke();
        ctx.fillStyle = done ? '#4AE0A0' : cur ? '#FFF' : '#46586A'; ctx.font = 'bold 18px monospace';
        ctx.fillText(KEY_LABEL[patchState.seq[i]], kx + cellW2 / 2, h / 2 - 12);
        if (cur) addTapZone(kx, h / 2 - 50, cellW2, 64, patchState.seq[i]);   // tap the lit key on touch
        kx += cellW2 + gap2;
    }
    if (!patchState.done && !patchState.failed) {
        const frac = Math.max(0, (patchState.deadline - Date.now()) / patchState.window);
        ctx.fillStyle = '#141C24'; ctx.fillRect(w / 2 - 150, h / 2 + 38, 300, 10);
        ctx.fillStyle = frac > 0.4 ? '#5ADFCF' : '#FF7060'; ctx.fillRect(w / 2 - 150, h / 2 + 38, 300 * frac, 10);
    } else {
        ctx.fillStyle = patchState.done ? '#4AE0A0' : '#FF7060'; ctx.font = 'bold 16px monospace';
        ctx.fillText(patchState.done ? 'SEALED' : 'TAKING WATER', w / 2, h / 2 + 52);
    }
}

function openPuzzle() {
    puzzleGrid = new Array(9).fill(true);
    let n = 4 + Math.floor(Math.random() * 4);
    while (n-- > 0) _puzzleToggle(puzzleGrid, Math.floor(Math.random() * 9));
    if (puzzleGrid.every(v => v)) _puzzleToggle(puzzleGrid, 4); // never start solved
    puzzleMoves = 0; puzzleSolved = false;
    phase = 'puzzle';
}
function pressPuzzle(i) {
    if (puzzleSolved) return;
    _puzzleToggle(puzzleGrid, i);
    puzzleMoves++;
    if (puzzleGrid.every(v => v)) {
        puzzleSolved = true;
        if (game && game._puzzleReward === 'battery') {
            game._puzzleReward = null;
            game.player.battery = Math.min(125, (game.player.battery || 100) + 25);
            addNereidLog(game, 'Junction rebuilt properly. Power restored. Good hands, Pilot.');
            game.streak = 'JUNCTION ONLINE — +25 battery'; game.streakTimer = 2.5;
        } else {
            addMaterials({ wiring: 2, corecell: 1, crystal: 1 });
            saveMeta();
            if (game) { addNereidLog(game, 'Junction online. Power rerouted — the wreck gives up its salvage.'); game.streak = 'JUNCTION ONLINE — materials'; game.streakTimer = 2.5; }
        }
        if (typeof sfxLevelUp === 'function') sfxLevelUp();
        setTimeout(() => { if (phase === 'puzzle') phase = 'playing'; }, 1200);
    }
}
function drawPuzzle(w, h) {
    ctx.fillStyle = 'rgba(0,4,10,0.92)'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 22px monospace';
    ctx.fillText('POWER JUNCTION', w / 2, h / 2 - 150);
    ctx.fillStyle = '#9AB0C0'; ctx.font = '12px monospace';
    ctx.fillText('Reroute the drowned circuit — bring ALL nodes online.', w / 2, h / 2 - 124);
    ctx.fillStyle = '#7A8A9A'; ctx.font = '11px monospace';
    ctx.fillText('[1-9] toggle a node + its neighbours   ·   [ESC] disengage', w / 2, h / 2 - 106);
    const cell = 70, gap = 10;
    const gw = 3 * cell + 2 * gap;
    const ox = w / 2 - gw / 2, oy = h / 2 - gw / 2 + 10;
    addTapZone(0, h - 60, w, 60, 'Escape');   // bottom strip = disengage
    for (let i = 0; i < 9; i++) {
        const r = Math.floor(i / 3), c = i % 3;
        const x = ox + c * (cell + gap), y = oy + r * (cell + gap);
        addTapZone(x, y, cell, cell, String(i + 1));
        const on = puzzleGrid[i];
        ctx.fillStyle = on ? '#0e2630' : '#0a0f16';
        ctx.fillRect(x, y, cell, cell);
        if (on && typeof drawGlow === 'function') drawGlow(ctx, '#5ADFCF', x + cell / 2, y + cell / 2, 22, 0.6);
        ctx.strokeStyle = on ? '#5ADFCF' : '#2a3a4a'; ctx.lineWidth = 2; ctx.strokeRect(x, y, cell, cell);
        ctx.fillStyle = on ? '#80F0E0' : '#3a4a5a'; ctx.font = 'bold 13px monospace';
        ctx.fillText(String(i + 1), x + cell / 2, y + cell / 2 + 5);
    }
    ctx.fillStyle = puzzleSolved ? '#80E0A0' : '#9AB0C0'; ctx.font = '12px monospace';
    ctx.fillText(puzzleSolved ? 'ONLINE — salvage released' : `moves: ${puzzleMoves}`, w / 2, oy + gw + 30);
}

// --- Card Draft Screen ---
let cardHand = [], cardSelected = new Set();
// ===== MOBILE TITLE — landscape phone (~780×390). Real pixels, big targets. =====
function drawTitleMobile(w, h) {
    const tt = Date.now() / 1000;
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    if (titleBgImg && titleBgImg._ready) {
        const iw = titleBgImg.naturalWidth || 1, ih = titleBgImg.naturalHeight || 1;
        const scale = Math.max(w / iw, h / ih);
        ctx.drawImage(titleBgImg, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
        ctx.fillStyle = 'rgba(0,4,10,0.66)'; ctx.fillRect(0, 0, w, h);
    }
    // Header: title left, stats right
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 24px monospace';
    ctx.fillText('DEEP SWARM', 16, 30);
    ctx.textAlign = 'right'; ctx.fillStyle = '#7A8A98'; ctx.font = '11px monospace';
    ctx.fillText(`⌁ ${meta.signal || 0} · ${meta.gold}g · best W${meta.bestWave}`, w - 16, 30);

    // Character cells — 4 across, real size
    const chars = Object.entries(CHARACTERS);
    const gap = 10, cellW = Math.min(180, (w - 32 - gap * (chars.length - 1)) / chars.length), cellH = 108;
    let cx = (w - (cellW * chars.length + gap * (chars.length - 1))) / 2;
    const cy = 42;
    for (let i = 0; i < chars.length; i++) {
        const [id, ch] = chars[i];
        const unlocked = meta.unlocked.includes(id);
        const selected = meta.selectedChar === id;
        addTapZone(cx, cy, cellW, cellH, String(i + 1));
        ctx.fillStyle = selected ? '#0E2030' : '#080F18';
        ctx.beginPath(); ctx.roundRect(cx, cy, cellW, cellH, 6); ctx.fill();
        ctx.strokeStyle = selected ? ch.color : (unlocked ? '#2A3540' : '#1A2028');
        ctx.lineWidth = selected ? 2.5 : 1;
        ctx.beginPath(); ctx.roundRect(cx, cy, cellW, cellH, 6); ctx.stroke();
        ctx.textAlign = 'center';
        if (unlocked) {
            drawGlow(ctx, ch.color, cx + cellW / 2, cy + 30, 24, selected ? 0.7 : 0.35);
            ctx.fillStyle = ch.color;
            ctx.beginPath(); ctx.arc(cx + cellW / 2, cy + 30, 12, 0, PI2); ctx.fill();
            ctx.fillStyle = '#FFF';
            ctx.beginPath(); ctx.arc(cx + cellW / 2 + 9, cy + 30, 2.2, 0, PI2); ctx.fill();
            ctx.fillStyle = selected ? '#FFF' : '#9AB0C0'; ctx.font = 'bold 13px monospace';
            ctx.fillText(ch.name, cx + cellW / 2, cy + 62);
            ctx.fillStyle = '#7A8A98'; ctx.font = '11px monospace';
            ctx.fillText(`HP ${ch.hp} · SPD ${ch.speed}`, cx + cellW / 2, cy + 80);
            ctx.fillText(`${ch.crushDepth}m crush`, cx + cellW / 2, cy + 96);
        } else {
            ctx.fillStyle = '#2A3540'; ctx.font = 'bold 20px monospace';
            ctx.fillText('???', cx + cellW / 2, cy + 44);
            ctx.fillStyle = '#5A6A7A'; ctx.font = '11px monospace';
            ctx.fillText('LOCKED', cx + cellW / 2, cy + 72);
        }
        cx += cellW + gap;
    }

    // Hull bar — slim, with repair tap when damaged
    const hc = meta.hullCondition != null ? meta.hullCondition : 100;
    const hullColor = hc > 70 ? '#4A9A6A' : hc > 35 ? '#DAA520' : '#DA4060';
    const hbY = cy + cellH + 10, hbW = Math.min(420, w - 220), hbX = 16;
    ctx.fillStyle = '#070D14'; ctx.beginPath(); ctx.roundRect(hbX, hbY, hbW, 12, 4); ctx.fill();
    ctx.fillStyle = hullColor; ctx.beginPath(); ctx.roundRect(hbX + 1, hbY + 1, (hbW - 2) * (hc / 100), 10, 3); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = hullColor; ctx.font = 'bold 11px monospace';
    ctx.fillText(`HULL ${Math.floor(hc)}%`, hbX + hbW + 8, hbY + 10);
    if (hc < 100 && meta.gold >= 5) {
        ctx.fillStyle = '#FFD040'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'right';
        ctx.fillText('[REPAIR]', w - 16, hbY + 10);
        addTapZone(w - 110, hbY - 8, 100, 30, 'h');
    }

    // Action row: big DIVE + secondary buttons
    const btnY = hbY + 24, btnH = 46;
    const dive = { x: 16, w: Math.min(230, w * 0.3) };
    ctx.fillStyle = '#0A2A28'; ctx.beginPath(); ctx.roundRect(dive.x, btnY, dive.w, btnH, 8); ctx.fill();
    ctx.strokeStyle = '#5ADFCF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(dive.x, btnY, dive.w, btnH, 8); ctx.stroke();
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
    ctx.fillText('DIVE ▼', dive.x + dive.w / 2, btnY + 29);
    addTapZone(dive.x, btnY, dive.w, btnH, 'Enter');
    const secondary = [
        { label: 'UPGRADES', key: 'u', color: '#DAA520' },
        { label: `CODEX ${meta.loreFragments.length}`, key: 'c', color: '#5AAFDA' },
        { label: dailyArmed ? '◈ DAILY ON' : 'DAILY', key: 'd', color: '#E8D080' },
    ];
    if (meta.p3Unlocked) secondary.push({ label: meta.destination === 'p3' ? '→ P3 SCAR' : '→ P9', key: 'p', color: meta.destination === 'p3' ? '#C87840' : '#4A8ADA' });
    let sx = dive.x + dive.w + 10;
    const secW = Math.min(150, (w - sx - 16 - 10 * (secondary.length - 1)) / secondary.length);
    for (const b of secondary) {
        ctx.fillStyle = '#080F16'; ctx.beginPath(); ctx.roundRect(sx, btnY, secW, btnH, 8); ctx.fill();
        ctx.strokeStyle = b.color; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.roundRect(sx, btnY, secW, btnH, 8); ctx.stroke();
        ctx.fillStyle = b.color; ctx.font = 'bold 12px monospace';
        ctx.fillText(b.label, sx + secW / 2, btnY + 28);
        addTapZone(sx, btnY, secW, btnH, b.key);
        sx += secW + 10;
    }

    // Stakes chips — compressed row (only if unlocked)
    if ((meta.stakesUnlocked || 0) > 0) {
        const active = new Set(meta.stakeSet || []);
        const chY = btnY + btnH + 8, chH = 30;
        const chW = (w - 32 - 6 * (STAKE_DEFS.length - 1)) / STAKE_DEFS.length;
        let cx0 = 16;
        for (let si = 0; si < STAKE_DEFS.length; si++) {
            const sd = STAKE_DEFS[si];
            const unlocked = si < (meta.stakesUnlocked || 0);
            const on = active.has(sd.id);
            ctx.fillStyle = on ? hexA(sd.color, 0.25) : '#080F16';
            ctx.beginPath(); ctx.roundRect(cx0, chY, chW, chH, 5); ctx.fill();
            ctx.strokeStyle = on ? sd.color : (unlocked ? '#3A4A5A' : '#1A2028'); ctx.lineWidth = on ? 2 : 1;
            ctx.beginPath(); ctx.roundRect(cx0, chY, chW, chH, 5); ctx.stroke();
            ctx.fillStyle = unlocked ? (on ? sd.color : '#8A9AAA') : '#2A3540'; ctx.font = 'bold 10px monospace';
            ctx.fillText(unlocked ? sd.name.toUpperCase() : '🔒', cx0 + chW / 2, chY + 19);
            if (unlocked) addTapZone(cx0, chY, chW, chH, sd.key);
            cx0 += chW + 6;
        }
    }

    // Bottom line: dive-count subtitle, subtle
    ctx.fillStyle = `rgba(90,160,170,${0.3 + Math.sin(tt * 0.5) * 0.12})`;
    ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(meta.totalRuns === 0 ? '"The ocean remembers everything you forget."' : `${meta.totalRuns} dives · ${meta.totalKills} dead · the swarm grows`, w / 2, h - 8);

}

// ===== MOBILE CARD DRAFT — cards fill the real screen, no shrink =====
function drawCardDraftMobile(w, h) {
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 18px monospace';
    ctx.fillText(`SELECT 3 CARDS — ${cardSelected.size}/3`, w / 2, 26);
    // Dive brief — one compact line per objective, top-right corner clear
    if (pendingObjectives && pendingObjectives.length) {
        ctx.font = '10px monospace'; ctx.textAlign = 'left';
        for (let oi = 0; oi < pendingObjectives.length; oi++) {
            ctx.fillStyle = '#A0DDD0';
            ctx.fillText(`◯ ${pendingObjectives[oi].brief} (+${pendingObjectives[oi].scoreBonus})`, 14, 44 + oi * 13);
        }
    }
    const topY = 44 + (pendingObjectives ? pendingObjectives.length * 13 : 0) + 6;
    const gap = 8;
    const cardW = (w - 28 - gap * (cardHand.length - 1)) / cardHand.length;
    const cardH = Math.min(h - topY - 60, 230);
    const startX = 14, by = topY;
    ctx.textAlign = 'center';
    for (let i = 0; i < cardHand.length; i++) {
        const c = cardHand[i];
        const bx = startX + i * (cardW + gap);
        const sel = cardSelected.has(i);
        addTapZone(bx, by, cardW, cardH, String(i + 1));
        ctx.fillStyle = sel ? '#1a2a3a' : '#0a1015';
        ctx.fillRect(bx, by, cardW, cardH);
        ctx.strokeStyle = sel ? RARITY_COLORS[c.rarity] : '#333';
        ctx.lineWidth = sel ? 3 : 1;
        ctx.strokeRect(bx, by, cardW, cardH);
        ctx.fillStyle = RARITY_COLORS[c.rarity]; ctx.fillRect(bx, by, cardW, 4);
        ctx.fillStyle = RARITY_COLORS[c.rarity]; ctx.font = 'bold 12px monospace';
        // Name — wrap on width, not char count
        const nameWords = c.name.split(' ');
        let nl = '', ny = by + 22;
        for (const word of nameWords) {
            const t = nl + word + ' ';
            if (ctx.measureText(t).width > cardW - 10 && nl) { ctx.fillText(nl.trim(), bx + cardW / 2, ny); ny += 14; nl = word + ' '; }
            else nl = t;
        }
        ctx.fillText(nl.trim(), bx + cardW / 2, ny);
        ctx.fillStyle = '#556'; ctx.font = '10px monospace';
        ctx.fillText(c.tags.join(' '), bx + cardW / 2, ny + 16);
        ctx.fillStyle = '#AAB8C2'; ctx.font = '11px monospace';
        const words = c.desc.split(' ');
        let line = '', ly = ny + 34;
        for (const word of words) {
            const t = line + word + ' ';
            if (ctx.measureText(t).width > cardW - 12 && line) { ctx.fillText(line.trim(), bx + cardW / 2, ly); ly += 13; line = word + ' '; }
            else line = t;
        }
        ctx.fillText(line.trim(), bx + cardW / 2, ly);
        ctx.fillStyle = RARITY_COLORS[c.rarity]; ctx.font = 'bold 10px monospace';
        ctx.fillText(c.rarity.toUpperCase(), bx + cardW / 2, by + cardH - 10);
        if (sel) { ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 16px monospace'; ctx.fillText('✓', bx + cardW - 14, by + 20); }
    }
    // Synergies + confirm
    if (cardSelected.size > 0) {
        const selCards = [...cardSelected].map(i => cardHand[i]);
        const tagCounts = {};
        for (const c of selCards) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
        const synHits = SYNERGIES.filter(s => (tagCounts[s.tag] || 0) >= s.count);
        if (synHits.length > 0) {
            ctx.fillStyle = '#DAA520'; ctx.font = 'bold 11px monospace';
            ctx.fillText('SYNERGY: ' + synHits.map(s => s.name).join(' + '), w / 2 - 120, h - 22);
        }
    }
    if (cardSelected.size === 3) {
        const cbW = 200, cbH = 42, cbX = w - cbW - 14, cbY = h - cbH - 10;
        ctx.fillStyle = '#0a2520'; ctx.beginPath(); ctx.roundRect(cbX, cbY, cbW, cbH, 8); ctx.fill();
        ctx.strokeStyle = '#80E0A0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(cbX, cbY, cbW, cbH, 8); ctx.stroke();
        ctx.fillStyle = '#80E0A0'; ctx.font = 'bold 16px monospace';
        ctx.fillText('DIVE ▼', cbX + cbW / 2, cbY + 27);
        addTapZone(cbX, cbY, cbW, cbH, 'Enter');
    } else {
        ctx.fillStyle = '#556'; ctx.font = '11px monospace';
        ctx.fillText('tap cards to select', w - 110, h - 22);
    }
}

function drawCardDraft(w, h) {
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center';
    ctx.fillText('SELECT 3 CARDS', w / 2, 50);
    ctx.fillStyle = '#888'; ctx.font = '12px monospace';
    ctx.fillText(`${cardSelected.size}/3 selected — [1-5] toggle — [ENTER] confirm`, w / 2, 75);

    // ---- DIVE BRIEF — show pre-rolled objectives so the player knows the mission ----
    if (pendingObjectives && pendingObjectives.length) {
        ctx.fillStyle = '#FFD040'; ctx.font = 'bold 11px monospace';
        ctx.fillText('TODAY\'S DIVE BRIEF', w / 2, h - 80);
        ctx.font = '10px monospace';
        const briefStartX = w / 2 - 280;
        for (let oi = 0; oi < pendingObjectives.length; oi++) {
            const o = pendingObjectives[oi];
            const oy = h - 60 + oi * 14;
            ctx.fillStyle = '#A0DDD0';
            ctx.textAlign = 'left';
            ctx.fillText('◯ ' + o.brief, briefStartX, oy);
            // Reward type
            ctx.fillStyle = '#7A6A40'; ctx.textAlign = 'right';
            ctx.fillText(`+${o.scoreBonus} · ${o.reward}`, w / 2 + 280, oy);
        }
    }

    const cardW = 140, cardH = 180, gap = 15;
    const totalW = cardHand.length * (cardW + gap) - gap;
    const startX = (w - totalW) / 2;

    for (let i = 0; i < cardHand.length; i++) {
        const c = cardHand[i];
        const bx = startX + i * (cardW + gap);
        const by = h / 2 - cardH / 2 - 20;
        const sel = cardSelected.has(i);
        addTapZone(bx, by, cardW, cardH, String(i + 1));
        // Card bg
        ctx.fillStyle = sel ? '#1a2a3a' : '#0a1015';
        ctx.fillRect(bx, by, cardW, cardH);
        ctx.strokeStyle = sel ? RARITY_COLORS[c.rarity] : '#333';
        ctx.lineWidth = sel ? 2.5 : 1;
        ctx.strokeRect(bx, by, cardW, cardH);
        // Rarity bar
        ctx.fillStyle = RARITY_COLORS[c.rarity]; ctx.fillRect(bx, by, cardW, 3);
        // Name
        ctx.fillStyle = RARITY_COLORS[c.rarity]; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText(c.name, bx + cardW / 2, by + 25);
        // Tags
        ctx.fillStyle = '#556'; ctx.font = '11px monospace';
        ctx.fillText(c.tags.join(' '), bx + cardW / 2, by + 42);
        // Desc
        ctx.fillStyle = '#AAA'; ctx.font = '10px monospace';
        const words = c.desc.split(' ');
        let line = '', ly = by + 65;
        for (const word of words) {
            if ((line + word).length > 18) { ctx.fillText(line.trim(), bx + cardW / 2, ly); ly += 14; line = ''; }
            line += word + ' ';
        }
        ctx.fillText(line.trim(), bx + cardW / 2, ly);
        // Key hint
        ctx.fillStyle = sel ? '#5ADFCF' : '#444'; ctx.font = '14px monospace';
        ctx.fillText(`[${i + 1}]`, bx + cardW / 2, by + cardH - 15);
        // Rarity label
        ctx.fillStyle = RARITY_COLORS[c.rarity]; ctx.font = '10px monospace';
        ctx.fillText(c.rarity.toUpperCase(), bx + cardW / 2, by + cardH - 30);
    }

    // Show synergies preview
    if (cardSelected.size > 0) {
        const selCards = [...cardSelected].map(i => cardHand[i]);
        const tagCounts = {};
        for (const c of selCards) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
        const synHits = SYNERGIES.filter(s => (tagCounts[s.tag] || 0) >= s.count);
        if (synHits.length > 0) {
            ctx.fillStyle = '#DAA520'; ctx.font = '11px monospace';
            ctx.fillText('SYNERGIES: ' + synHits.map(s => s.name).join(' + '), w / 2, h / 2 + cardH / 2 + 20);
        }
    }
    // Confirm button — the touch path to [ENTER]
    if (cardSelected.size === 3) {
        const cbY = h / 2 + cardH / 2 + 36;
        ctx.fillStyle = '#0a1520'; ctx.fillRect(w / 2 - 110, cbY, 220, 34);
        ctx.strokeStyle = '#80E0A0'; ctx.lineWidth = 1.5; ctx.strokeRect(w / 2 - 110, cbY, 220, 34);
        ctx.fillStyle = '#80E0A0'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
        ctx.fillText('DIVE ▼', w / 2, cbY + 22);
        addTapZone(w / 2 - 110, cbY, 220, 34, 'Enter');
    }
}

// --- Event Overlay ---
function drawEventOverlay(w, h, g) {
    if (!g.activeEvent) return;
    const e = g.activeEvent;
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, w, h);
    // Event box — text WRAPS and the box grows to hold it (long lore lines
    // were overrunning the fixed 420px box)
    const bw = Math.min(480, w - 40);
    const wrap = (text, font, maxW) => {
        ctx.font = font;
        const words = String(text).split(' ');
        const lines = []; let line = '';
        for (const word of words) {
            const tst = line + word + ' ';
            if (ctx.measureText(tst).width > maxW && line) { lines.push(line.trim()); line = word + ' '; }
            else line = tst;
        }
        if (line.trim()) lines.push(line.trim());
        return lines;
    };
    const textLines = wrap(e.text, '11px monospace', bw - 36);
    const choiceLines = e.choices.map(c => wrap(c.text, '12px monospace', bw - 36));
    const choicesH = choiceLines.reduce((a, ls) => a + ls.length * 15 + 13, 0);
    const bh = 66 + textLines.length * 14 + 12 + choicesH + 26;
    const bx = (w - bw) / 2, by = (h - bh) / 2;
    ctx.fillStyle = '#0a1520'; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = '#C47840'; ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
    ctx.fillStyle = '#C47840'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText(e.title, w / 2, by + 28);
    ctx.fillStyle = '#AAB8C2'; ctx.font = '11px monospace';
    let ty = by + 50;
    for (const ln of textLines) { ctx.fillText(ln, w / 2, ty); ty += 14; }
    ty += 12;
    for (let i = 0; i < e.choices.length; i++) {
        const zoneTop = ty - 13;
        ctx.fillStyle = '#DDD'; ctx.font = '12px monospace';
        for (const ln of choiceLines[i]) { ctx.fillText(ln, w / 2, ty); ty += 15; }
        addTapZone(bx + 10, zoneTop, bw - 20, ty - zoneTop + 4, String(i + 1));
        ty += 13;
    }
    // Timer bar
    const timerPct = e.timer / 8;
    ctx.fillStyle = '#300'; ctx.fillRect(bx + 10, by + bh - 15, bw - 20, 6);
    ctx.fillStyle = timerPct > 0.3 ? '#C47840' : '#FF2020';
    ctx.fillRect(bx + 10, by + bh - 15, (bw - 20) * timerPct, 6);
}

// --- Codex Screen ---
function drawCodex(w, h) {
    ctx.fillStyle = '#010208'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 24px monospace'; ctx.textAlign = 'center';
    ctx.fillText('DEEP CODEX', w / 2, 40);
    ctx.fillStyle = '#888'; ctx.font = '12px monospace';
    ctx.fillText(`${meta.loreFragments.length}/${LORE_FRAGMENTS.length} FRAGMENTS RECOVERED`, w / 2, 65);

    // Creature bestiary — 3 columns, research pips (the old list clipped at ~10 of 45 rows)
    ctx.fillStyle = '#5AAFDA'; ctx.font = 'bold 12px monospace';
    ctx.fillText('— CREATURE BESTIARY —  ●=scanned ●●=observed ●●●=analysed', w / 2, 88);
    let ly = 108;
    ctx.font = '10px monospace'; ctx.textAlign = 'left';
    const bestiary = Object.entries(ENEMY_TYPES);
    const bCols = 3, bColW = Math.floor((w - 80) / bCols), bRows = Math.ceil(bestiary.length / bCols);
    for (let bi = 0; bi < bestiary.length; bi++) {
        const [typeId, typeData] = bestiary[bi];
        const tier = meta.research[typeId] || 0;
        const aberrantScanned = meta.aberrantScanned.includes('aberrant_' + typeId);
        const col = Math.floor(bi / bRows), row = bi % bRows;
        const bx = 40 + col * bColW, by = ly + row * 13;
        ctx.fillStyle = tier >= 3 ? '#A0E8C8' : tier >= 2 ? '#7FA896' : tier >= 1 ? '#5A7A6A' : '#2A3A3A';
        const pips = '●'.repeat(tier) + '○'.repeat(Math.max(0, 3 - tier));
        ctx.fillText(`${pips} ${tier >= 1 ? typeData.name : '???'}${aberrantScanned ? ' ★' : ''}`, bx, by);
    }
    ly = 108 + bRows * 13 - 13;

    // Zone scan completion — anchored below however tall the bestiary got
    const totalCreatures = Object.keys(ENEMY_TYPES).length;
    const scannedCount = meta.scannedCreatures.length;
    const pct = Math.floor(scannedCount / totalCreatures * 100);
    ctx.fillStyle = '#DAA520'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`Bestiary: ${scannedCount}/${totalCreatures} (${pct}%) — +${Math.floor(scannedCount/totalCreatures*5)*5}% global dmg bonus`, w/2, ly + 22);

    // Fusion matrix — recipes always visible, results hidden until discovered
    const fmY = ly + 34;
    ctx.strokeStyle = '#1A2A3A'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, fmY); ctx.lineTo(w-20, fmY); ctx.stroke();
    ctx.fillStyle = '#FF80FF'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    const discovered = meta.fusionsDiscovered || [];
    ctx.fillText(`— FUSION MATRIX  ${discovered.length}/${WEAPON_EVOLUTIONS.length} —`, w/2, fmY + 16);
    ctx.font = '10px monospace'; ctx.textAlign = 'left';
    const colW = Math.floor((w - 80) / 2);
    for (let fi = 0; fi < WEAPON_EVOLUTIONS.length; fi++) {
        const evo = WEAPON_EVOLUTIONS[fi];
        const found = discovered.includes(evo.result);
        const col = fi % 2, row = Math.floor(fi / 2);
        const fx = 40 + col * colW, fy = fmY + 32 + row * 14;
        // Apex components are themselves evolved — hide their names until discovered too
        const nameOf = id => WEAPON_DEFS[id].evolved && !discovered.includes(id) ? '???' : WEAPON_DEFS[id].name;
        ctx.fillStyle = found ? '#DA80DA' : '#3A4A4A';
        ctx.fillText(`${found ? '✓' : '○'} ${found ? evo.name : '???'}`, fx, fy);
        ctx.fillStyle = found ? '#7A6A8A' : '#2A3A3A';
        ctx.fillText(`= ${nameOf(evo.a)} + ${nameOf(evo.b)}`, fx + 150, fy);
    }
    const fusionEndY = fmY + 32 + Math.ceil(WEAPON_EVOLUTIONS.length / 2) * 14;

    // Lore fragments
    ctx.strokeStyle = '#1A2A3A'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, fusionEndY + 6); ctx.lineTo(w-20, fusionEndY + 6); ctx.stroke();
    ctx.fillStyle = '#5ADFCF'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('— LORE FRAGMENTS —', w/2, fusionEndY + 22);

    const owned = meta.loreFragments;
    ly = fusionEndY + 40;
    // SEALED ARCHIVE — Signal buys the next sealed fragment (cheapest layer first).
    const sealCost = (f) => f.layer * 40;
    const nextSealed = LORE_FRAGMENTS.filter(f => !owned.includes(f.id)).sort((a, b) => a.layer - b.layer)[0];
    ctx.textAlign = 'center'; ctx.font = '11px monospace';
    if (nextSealed) {
        const afford = (meta.signal || 0) >= sealCost(nextSealed);
        ctx.fillStyle = afford ? '#B0A0E8' : '#4A4460';
        ctx.fillText(`⌁ ${meta.signal || 0} SIGNAL — [S] UNSEAL next archive fragment (layer ${nextSealed.layer} · ${sealCost(nextSealed)} ⌁)`, w / 2, ly);
        addTapZone(w / 2 - 220, ly - 12, 440, 18, 's');
    } else {
        ctx.fillStyle = '#B0A0E8';
        ctx.fillText(`⌁ ${meta.signal || 0} SIGNAL — the archive is fully unsealed`, w / 2, ly);
    }
    ly += 22;
    for (const frag of LORE_FRAGMENTS) {
        if (ly > h - 40) break;
        const unlocked = owned.includes(frag.id);
        ctx.fillStyle = unlocked ? (frag.layer === 1 ? '#888' : frag.layer === 2 ? '#5AAFDA' : '#DA4A4A') : '#222';
        ctx.font = '10px monospace'; ctx.textAlign = 'left';
        if (unlocked) {
            const lines = frag.text.split('\n');
            for (const line of lines) {
                ctx.fillText(line.substring(0, 70), 40, ly);
                ly += 14;
            }
            ly += 8;
        } else {
            ctx.fillText(`[ SEALED — layer ${frag.layer} · ${sealCost(frag)} ⌁ ]`, 40, ly);
            ly += 22;
        }
    }
    ctx.fillStyle = '#888'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.fillText('[ESC] Back', w / 2, h - 20);
    addTapZone(0, h - 50, w, 50, 'Escape');
}

// --- INTRO SCREEN RENDERER ---
function drawIntro(w, h) {
    const scr = INTRO_SCREENS[introPage];
    if (!scr) { phase = 'title'; return; }
    addTapZone(0, 0, w, h, 'Enter');   // tap anywhere advances
    const tt = Date.now() / 1000;

    // Background (deepens with each page)
    ctx.fillStyle = scr.bg;
    ctx.fillRect(0, 0, w, h);

    // Scan line texture
    ctx.fillStyle = 'rgba(20,30,40,0.04)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);

    // Text (typewriter fade-in per line)
    ctx.textAlign = 'center'; ctx.font = '12px monospace';
    const lineH = 22;
    const startY = h / 2 - (scr.text.length * lineH) / 2;
    for (let i = 0; i < scr.text.length; i++) {
        const line = scr.text[i];
        // First line is header style
        if (i === 0 && line.startsWith('[')) {
            ctx.fillStyle = '#5ADFCF';
            ctx.font = 'bold 13px monospace';
        } else if (line.startsWith('🎮') || line.startsWith('⚡') || line.startsWith('📡') || line.startsWith('🧠') || line.startsWith('⬆️')) {
            ctx.fillStyle = '#AAD0D0';
            ctx.font = '11px monospace';
        } else {
            ctx.fillStyle = '#8A9AAA';
            ctx.font = '12px monospace';
        }
        ctx.fillText(line, w / 2, startY + i * lineH);
    }

    // NEREID comms (bottom)
    if (scr.nereid) {
        ctx.fillStyle = 'rgba(5,10,15,0.8)';
        ctx.fillRect(w / 2 - 250, h - 50, 500, 28);
        ctx.strokeStyle = 'rgba(90,220,200,0.3)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(w / 2 - 250, h - 50, 500, 28);
        ctx.fillStyle = '#5ADFCF';
        ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(scr.nereid, w / 2, h - 33);
    }

    // Navigation
    ctx.fillStyle = '#556'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`[ENTER] Continue    ${introPage + 1}/${INTRO_SCREENS.length}    [ESC] Skip`, w / 2, h - 10);

    // Page indicator dots
    for (let i = 0; i < INTRO_SCREENS.length; i++) {
        ctx.fillStyle = i === introPage ? '#5ADFCF' : '#2A3A44';
        ctx.beginPath(); ctx.arc(w / 2 - 40 + i * 12, h - 65, 3, 0, PI2); ctx.fill();
    }
}

// --- Input handlers for menus ---
window.addEventListener('keydown', e => {
    // INVENTORY — TAB to open / close
    if ((phase === 'playing' || phase === 'inventory') && (e.key === 'Tab' || e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        phase = (phase === 'inventory') ? 'playing' : 'inventory';
        return;
    }
    // SHOP and SELLING are SURFACE-ONLY. Inventory is view-only mid-dive — salvage banks on surface.
    if (phase === 'inventory' && game) {
        if (e.key === 'Escape') { phase = 'playing'; return; }
        // BREAK DOWN — trade held salvage's gold value for crafting materials
        if (e.key === 'b' || e.key === 'B') {
            if (game.inventory.length) {
                for (const it of game.inventory) breakdownItem(it);
                saveMeta();
                game.inventory.length = 0;
                game.streak = 'SALVAGE BROKEN DOWN → materials'; game.streakTimer = 2.5;
                if (typeof sfxRevive === 'function') sfxRevive();
            }
            return;
        }
    }

    // PING — F key (manual sonar). Mouse click also works.
    if (phase === 'playing' && (e.key === 'f' || e.key === 'F') && game) {
        e.preventDefault();
        if (game.player._sonarManual && !game.player._sonarAuto) firePing(game);
        if (game._modeCfg && game._modeCfg.ecology) game.noise = Math.min(2.5, (game.noise || 0) + 1.4); // a ping is the loudest thing you can do
        return;
    }
    // (SWARM/DESCENT toggle removed — the ecology/horror is always on now.)
    // DESCENT: toggle FLOODLIGHTS (broad hull lamps). The forward headlight beam stays;
    // the floodlights are the big vision bubble — they let you farm, and make you a beacon.
    // SILENT RUNNING — Q. Weapons hold fire, floodlights cut, engines at dead slow.
    // You vanish from the ecology's ears. The submarine fantasy: run silent, run deep.
    if (phase === 'playing' && (e.key === 'q' || e.key === 'Q') && game) {
        e.preventDefault();
        game.silent = !game.silent;
        if (game.silent) {
            game.lightOn = false;
            setModeMsg(game, '◈ SILENT RUNNING — weapons hold');
            if (!game._silentTaught) {
                game._silentTaught = true;
                addNereidLog(game, 'Weapons holding. Engines at dead slow. We are a hole in the water, Pilot. Stay that way.');
            }
        } else {
            setModeMsg(game, '◈ ENGINES LIVE — WEAPONS FREE');
        }
        return;
    }
    if (phase === 'playing' && (e.key === 'l' || e.key === 'L') && game) {
        e.preventDefault();
        game.lightOn = !game.lightOn;
        setModeMsg(game, game.lightOn ? '◈ FLOODLIGHTS ON' : '◈ FLOODLIGHTS OFF');
        if (game.lightOn) {
            // The flash: photophobic hunters recoil from a fresh beam
            for (const e of game.enemies) {
                if ((e.role === 'ambush' || e.ai === 'ambush' || e.ai === 'zigzag') && dist(game.player, e) < 350) e._feared = 1.6;
            }
        }
        return;
    }
    // WORLD ZOOM — [V] cycles 1.0 / 1.15 / 1.3 on touch screens (persisted)
    if ((phase === 'playing' || phase === 'paused') && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        const cur = meta.worldZoom || 1.15;
        meta.worldZoom = cur >= 1.3 ? 1.0 : cur >= 1.15 ? 1.3 : 1.15;
        saveMeta();
        if (game) setModeMsg(game, `◈ ZOOM ${Math.round(meta.worldZoom * 100)}%`);
        return;
    }
    // PROTOTYPE: open a Power Junction puzzle (P). TODO: trigger from fouled terminals / sealed wrecks instead.
    if (phase === 'playing' && (e.key === 'p' || e.key === 'P') && game) {
        e.preventDefault();
        openPuzzle();
        return;
    }
    // ASCEND — Z to commit to surfacing. ONE-WAY: cannot dive again. Reach 0m to keep everything.
    if (phase === 'playing' && (e.key === 'z' || e.key === 'Z') && game) {
        e.preventDefault();
        if (!game.ascending) {
            game.ascending = true;
            game.ascendStartTime = game.runTime;
            game.streak = 'ASCENT — surface or die'; game.streakTimer = 4;
            addNereidLog(game, 'Ballast purged. We are climbing. No way back down — get us home, Pilot.');
            sfxRevive();
        }
        return;
    }
    // UTILITY BELT — [1]/[2] use the first/second belt item carried
    if (phase === 'playing' && (e.key === '1' || e.key === '2') && game) {
        e.preventDefault();
        const beltItems = game.inventory.filter(it => it.belt);
        const item = beltItems[Number(e.key) - 1];
        if (item) {
            game.inventory.splice(game.inventory.indexOf(item), 1);
            useBeltItem(game, item);
        }
        return;
    }
    // JETTISON — J dumps half the cargo as floating loot. Weight for freedom.
    if (phase === 'playing' && (e.key === 'j' || e.key === 'J') && game && game.inventory.length > 1) {
        e.preventDefault();
        const drop = game.inventory.splice(0, Math.ceil(game.inventory.length / 2));
        for (const it of drop) {
            game.lootItems.push({ x: game.player.x + (Math.random() - 0.5) * 90, y: game.player.y + 40 + Math.random() * 50, type: it, life: 30, dropDepth: game.depth });
        }
        setModeMsg(game, `◈ JETTISONED ${drop.length} ITEMS`);
        playSound && playTone(90, 0.5, 'square', 0.08);
        return;
    }
    // SALVAGE — E key held while near a wreck (handled in update; this just suppresses default)
    if (phase === 'playing' && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        return;
    }
    // REPAIR KIT — R uses one from inventory if held; restores 40% maxHp
    if (phase === 'playing' && (e.key === 'r' || e.key === 'R') && game) {
        e.preventDefault();
        const idx = game.inventory.findIndex(it => it.id === 'repair_kit');
        if (idx >= 0 && game.player.hp < game.player.maxHp) {
            const heal = Math.floor(game.player.maxHp * 0.4);
            game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
            game.inventory.splice(idx, 1);
            game.floatingTexts.push({ x: game.player.x, y: game.player.y - 22, text: `+${heal} HULL`, color: '#80FFA0', life: 1.6, vy: -28 });
            sfxRevive();
        }
        return;
    }

    // DASH — space key. WASD direction ONLY. If no keys held, default forward (last facing).
    if (phase === 'playing' && (e.key === ' ' || e.key === 'Shift') && game) {
        e.preventDefault();
        const p = game.player;
        if (p.dashCooldown <= 0 && p.dashTimer <= 0) {
            let dx = 0, dy = 0;
            if (keys['w'] || keys['arrowup']) dy -= 1;
            if (keys['s'] || keys['arrowdown']) dy += 1;
            if (keys['a'] || keys['arrowleft']) dx -= 1;
            if (keys['d'] || keys['arrowright']) dx += 1;
            if (dx === 0 && dy === 0) {
                // No keys held — dash in current facing direction
                const f = p._facing != null ? p._facing : -Math.PI / 2;
                dx = Math.cos(f); dy = Math.sin(f);
            }
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            dx /= len; dy /= len;
            p.dashVx = dx * 900; p.dashVy = dy * 900;
            p.dashTimer = 0.18;
            p.dashCooldown = 0.7;
            sfxDash();
            // Dashing beside rock kicks up silt — concealment you can MAKE
            for (const ob of game.obstacles) {
                if ((ob.kind === 'rock' || ob.kind === 'spire') && dist(p, ob) < 150) {
                    if (!game.volumes) game.volumes = [];
                    game.volumes.push({ kind: 'sediment', x: p.x, y: p.y, w: 190, h: 190, life: 4.5 });
                    break;
                }
            }
        }
    }

    // Feature 1: ESC during playing → pause
    if (e.key === 'Escape' && phase === 'playing') {
        phase = 'paused';
        stopHeartbeat();
        return;
    }
    // Feature 1: Pause menu controls
    if (phase === 'paused') {
        if (e.key === 'Escape') { phase = 'playing'; return; }
        if (e.key === 'm' || e.key === 'M') {
            meta.muted = !meta.muted;
            applyVolume();
            saveMeta();
            return;
        }
        if (e.key === '[') {
            meta.volume = Math.max(0, meta.volume - 0.1);
            applyVolume();
            saveMeta();
            return;
        }
        if (e.key === ']') {
            meta.volume = Math.min(1, meta.volume + 0.1);
            applyVolume();
            saveMeta();
            return;
        }
        if (e.key === 't' || e.key === 'T') {
            meta.uiScale = meta.uiScale >= 1.3 ? 1 : meta.uiScale >= 1.15 ? 1.3 : 1.15;
            UI_SCALE = meta.uiScale;
            saveMeta();
            return;
        }
        // Music volume (,/.) and SFX volume (;/') — buses applied live
        if (e.key === ',') { meta.musicVol = Math.max(0, (meta.musicVol != null ? meta.musicVol : 0.7) - 0.1); saveMeta(); return; }
        if (e.key === '.') { meta.musicVol = Math.min(1, (meta.musicVol != null ? meta.musicVol : 0.7) + 0.1); saveMeta(); return; }
        if (e.key === ';') { meta.sfxVol = Math.max(0, (meta.sfxVol != null ? meta.sfxVol : 1) - 0.1); if (sfxBus) sfxBus.gain.value = meta.sfxVol; saveMeta(); return; }
        if (e.key === "'") { meta.sfxVol = Math.min(1, (meta.sfxVol != null ? meta.sfxVol : 1) + 0.1); if (sfxBus) sfxBus.gain.value = meta.sfxVol; saveMeta(); return; }
        // Audition: [N] cycles the beat-layer candidate for the current zone
        if (e.key === 'n' || e.key === 'N') {
            const picked = nextBeatCandidate();
            if (picked && game) setModeMsg(game, '♪ ' + picked, 2.5);
            return;
        }
        if (e.key === 'h' || e.key === 'H') {
            meta.hudContrast = !meta.hudContrast;
            saveMeta();
            return;
        }
        if (e.key === 'q' || e.key === 'Q') {
            phase = 'title';
            game = null;
            stopHeartbeat();
            return;
        }
        return;
    }

    // Event choices
    if (phase === 'event' && game && game.activeEvent) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= game.activeEvent.choices.length) {
            game.activeEvent.choices[num - 1].fn(game);
            game.activeEvent = null;
            phase = 'playing';
        }
    }
    // Card draft
    if (phase === 'mooring') {
        // THE QUESTION intercepts everything until answered
        if (game && game._theQuestion && !meta.ending && (e.key === '1' || e.key === '2')) {
            meta.ending = e.key === '1' ? 'answered' : 'silent';
            saveMeta();
            game._theQuestion = false;
            game._mooringLine = meta.ending === 'answered'
                ? '"…Thank you, Pilot. It was never the ocean that was listening. Now we both know what answered."'
                : '"Noted, Pilot. Some questions keep better than answers. …She has stopped humming."';
            if (audioCtx) playTone(meta.ending === 'answered' ? 660 : 140, 0.5, 'sine', 0.06);
            return;
        }
        if (e.key === 'u' || e.key === 'U') { phase = 'shop'; return; }
        if (e.key === 'g' || e.key === 'G') { phase = 'modules'; return; }
        if (e.key === 'c' || e.key === 'C') { phase = 'codex'; return; }
        if (e.key === 'Enter') { cardHand = dealCards(meta.totalRuns); cardSelected = new Set(); rollContractBoard(); phase = 'contracts'; return; }
        return;
    }
    if (phase === 'modules') {
        if (e.key === 'Escape') { phase = (game && game._surfaced && game.player.hp > 0) ? 'mooring' : 'title'; return; }
        let mn = parseInt(e.key);
        if (e.key === '0') mn = 10;
        if (e.key === '-') mn = 11;
        if (mn >= 1 && mn <= MODULE_DEFS.length) {
            const m = MODULE_DEFS[mn - 1];
            if (!moduleUnlocked(m)) { if (audioCtx) playTone(120, 0.1, 'square', 0.04); return; }
            if (meta.modulesEquipped.includes(m.id)) {
                meta.modulesEquipped = meta.modulesEquipped.filter(id => id !== m.id);
            } else if (meta.modulesOwned.includes(m.id)) {
                if (equippedInSlot(m.slot) < MODULE_SLOTS[m.slot]) meta.modulesEquipped.push(m.id);
                else if (audioCtx) playTone(120, 0.1, 'square', 0.04);   // slot full
            } else if (spendMaterials(m.cost)) {
                meta.modulesOwned.push(m.id);
                if (equippedInSlot(m.slot) < MODULE_SLOTS[m.slot]) meta.modulesEquipped.push(m.id);
                if (audioCtx) sfxLevelUp();
            } else if (audioCtx) playTone(120, 0.1, 'square', 0.04);
            saveMeta();
        }
        return;
    }
    if (phase === 'patch') {
        const k = e.key.toLowerCase();
        if (k === 'w' || k === 'a' || k === 's' || k === 'd') pressPatch(k);
        return;
    }
    if (phase === 'puzzle') {
        if (e.key === 'Escape') { phase = 'playing'; return; }
        const pn = parseInt(e.key);
        if (pn >= 1 && pn <= 9) pressPuzzle(pn - 1);
        return;
    }
    if (phase === 'contracts') {
        if (e.key === '6' || e.key === '7' || e.key === '8') {
            const bid = { 6: 'belt_decoy', 7: 'belt_mine', 8: 'belt_flare' }[e.key];
            const cost = BELT_DEFS[bid].value;
            if (meta.gold >= cost) {
                meta.gold -= cost;
                meta.beltStock = meta.beltStock || {};
                meta.beltStock[bid] = (meta.beltStock[bid] || 0) + 1;
                saveMeta();
                if (audioCtx) playTone(660, 0.15, 'sine', 0.08);
            } else if (audioCtx) playTone(120, 0.1, 'square', 0.04);
            return;
        }
        const num = parseInt(e.key);
        if (num >= 1 && num <= contractBoard.length) {
            const idx = num - 1;
            if (contractSelected.has(idx)) contractSelected.delete(idx);
            else if (contractSelected.size < 3) contractSelected.add(idx);
        }
        if (e.key === 'Enter' && contractSelected.size > 0) {
            pendingObjectives = [...contractSelected].map(i => contractBoard[i]);
            phase = 'cards';
        }
        if (e.key === 'Escape') { phase = 'title'; }
        return;
    }
    if (phase === 'cards') {
        const num = parseInt(e.key);
        if (num >= 1 && num <= cardHand.length) {
            const idx = num - 1;
            if (cardSelected.has(idx)) cardSelected.delete(idx);
            else if (cardSelected.size < 3) cardSelected.add(idx);
        }
        if (e.key === 'Enter' && cardSelected.size === 3) {
            initAudio();
            const selected = [...cardSelected].map(i => cardHand[i]);
            game = createGame();
            if (dailyRng) { game.daily = dayKeyUTC(); dailyRng = null; dailyArmed = false; }   // brief is set; the run itself is live
            game.selectedCards = selected;
            for (const c of selected) c.fn(game);
            // Check synergies
            const tagCounts = {};
            for (const c of selected) for (const t of c.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
            for (const syn of SYNERGIES) {
                if ((tagCounts[syn.tag] || 0) >= syn.count) {
                    syn.fn(game);
                    game.activeSynergies.push(syn.name);
                    game.streak = 'SYNERGY: ' + syn.name; game.streakTimer = 2;
                }
            }
            phase = 'playing';
            startDrone();
        }
    }
    // Codex
    // Intro navigation
    if (phase === 'intro') {
        if (e.key === 'Enter' || e.key === ' ') {
            introPage++;
            if (introPage >= INTRO_SCREENS.length) {
                meta._seenIntro = true; saveMeta();
                cardHand = dealCards(meta.totalRuns);
                cardSelected = new Set();
                rollContractBoard();
                phase = 'contracts';
            }
        }
        if (e.key === 'Escape') {
            meta._seenIntro = true; saveMeta();
            cardHand = dealCards(meta.totalRuns);
            cardSelected = new Set();
            rollContractBoard();
            phase = 'contracts';
        }
        return;
    }
    if (phase === 'codex' && e.key === 'Escape') { phase = 'title'; }
    // [S] in codex — spend Signal to unseal the next archive fragment (cheapest layer first)
    if (phase === 'codex' && (e.key === 's' || e.key === 'S')) {
        const next = LORE_FRAGMENTS.filter(f => !meta.loreFragments.includes(f.id)).sort((a, b) => a.layer - b.layer)[0];
        if (next && (meta.signal || 0) >= next.layer * 40) {
            meta.signal -= next.layer * 40;
            meta.loreFragments.push(next.id);
            saveMeta();
            if (audioCtx) { playTone(520, 0.08, 'sine', 0.05); setTimeout(() => playTone(780, 0.12, 'sine', 0.05), 90); }
        } else if (audioCtx) playTone(120, 0.1, 'square', 0.04);
    }
    if (phase === 'tutorial' && e.key === 'Escape') { phase = 'title'; }
    if (phase === 'title') {
        if (e.key === 'Enter') {
            initAudio();
            if (!meta._seenIntro) {
                introPage = 0;
                phase = 'intro';
            } else {
                if (dailyArmed) dailyRng = mulberry32(seedFromString('deepswarm-' + dayKeyUTC()));
                cardHand = dealCards(meta.totalRuns);
                cardSelected = new Set();
                rollContractBoard();
                phase = 'contracts';
            }
        }
        // [D] DAILY DIVE — everyone gets today's brief (contracts, cards, pool, trench)
        if (e.key === 'd' || e.key === 'D') {
            dailyArmed = !dailyArmed;
            if (audioCtx) playTone(dailyArmed ? 520 : 260, 0.08, 'sine', 0.05);
        }
        if (e.key === 'u' || e.key === 'U') phase = 'shop';
        if (e.key === 'c' || e.key === 'C') phase = 'codex';
        if (e.key === 't' || e.key === 'T') phase = 'tutorial';
        if (e.key === 'w' || e.key === 'W') phase = 'workshop';
        // [P] destination — Pelagos-9 (living trench) / Pelagos-3 "THE SCAR" (drowned machinery)
        if ((e.key === 'p' || e.key === 'P') && meta.p3Unlocked) {
            meta.destination = meta.destination === 'p3' ? 'p9' : 'p3';
            saveMeta();
            if (audioCtx) playTone(meta.destination === 'p3' ? 180 : 320, 0.12, 'square', 0.05);
        }
        // [H] REPAIR HULL — costs gold per condition point restored
        if (e.key === 'h' || e.key === 'H') {
            const need = 100 - (meta.hullCondition || 100);
            if (need <= 0) return;
            const costPerPoint = 5;
            const totalCost = need * costPerPoint;
            const canAfford = Math.min(need, Math.floor(meta.gold / costPerPoint));
            if (canAfford > 0) {
                meta.gold -= canAfford * costPerPoint;
                meta.hullCondition = Math.min(100, meta.hullCondition + canAfford);
                saveMeta();
                if (audioCtx) {
                    playTone(440, 0.06, 'sine', 0.05);
                    setTimeout(() => playTone(660, 0.08, 'sine', 0.05), 60);
                }
            }
        }
        // Module bay from the title too
        if (e.key === 'g' || e.key === 'G') { phase = 'modules'; return; }
        // Composable stakes — [6]-[0] toggle each unlocked stake independently
        const stakeDef = STAKE_DEFS.find(sd => sd.key === e.key);
        if (stakeDef) {
            const idx = STAKE_DEFS.indexOf(stakeDef);
            if (idx < (meta.stakesUnlocked || 0)) {
                if (!meta.stakeSet) meta.stakeSet = [];
                const at = meta.stakeSet.indexOf(stakeDef.id);
                if (at >= 0) meta.stakeSet.splice(at, 1); else meta.stakeSet.push(stakeDef.id);
                saveMeta();
                if (audioCtx) playTone(at >= 0 ? 300 : 480, 0.08, 'square', 0.04);
            }
        }
        // Character select
        const num = parseInt(e.key);
        if (num >= 1 && num <= 4) {
            const chars = Object.keys(CHARACTERS);
            if (num <= chars.length && meta.unlocked.includes(chars[num - 1])) {
                meta.selectedChar = chars[num - 1];
                saveMeta();
            }
        }
    }
    if (phase === 'workshop') {
        if (e.key === 'Escape') phase = 'title';
        const num = parseInt(e.key);
        if (num >= 1 && num <= RECIPE_DEFS.length) {
            const r = RECIPE_DEFS[num - 1];
            if (craftRecipe(r.id)) {
                if (audioCtx) {
                    playTone(660, 0.08, 'sine', 0.05);
                    setTimeout(() => playTone(880, 0.10, 'sine', 0.05), 80);
                }
            } else if (audioCtx) {
                playTone(180, 0.12, 'square', 0.04);
            }
        }
    }
    if (phase === 'levelup' && game) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 3 && game.levelUpChoices[num - 1]) {
            const ch = game.levelUpChoices[num - 1];
            ch.fn(game);
            // Track picked upgrades for the active-perks display
            if (!game.pickedUpgrades) game.pickedUpgrades = [];
            game.pickedUpgrades.push({ id: ch.id, name: ch.name });
            phase = 'playing';
        }
    }
    if (phase === 'death') {
        if (e.key === 'Enter') {
            // Return to TITLE so the player can shop, repair, swap subs before next dive
            game = null;
            phase = 'title';
        }
        if (e.key === 'u' || e.key === 'U') phase = 'shop';
        if (e.key === 'w' || e.key === 'W') phase = 'workshop';
    }
    if (phase === 'shop') {
        if (e.key === 'Escape') phase = (game && game._surfaced && game.player.hp > 0) ? 'mooring' : (meta.totalRuns > 0 && game && game.player.hp <= 0 ? 'death' : 'title');
        const upgKeys = ['damage', 'hp', 'speed', 'xpGain'];
        const costs = [lv => 10 + lv * 15, lv => 10 + lv * 10, lv => 15 + lv * 15, lv => 20 + lv * 20];
        const num = parseInt(e.key);
        if (num >= 1 && num <= 4) {
            const key = upgKeys[num - 1];
            const cost = costs[num - 1](meta.upgrades[key]);
            if (meta.gold >= cost) {
                meta.gold -= cost;
                meta.upgrades[key]++;
                saveMeta();
            }
        }
        // FABRICATE — keys 5..9 spend materials
        if (num >= 5 && num <= 4 + FAB_RECIPES.length) {
            const fr = FAB_RECIPES[num - 5];
            if (fabUnlocked(fr) && spendMaterials(fr.cost)) { meta.fab[fr.key] = (meta.fab[fr.key] || 0) + 1; saveMeta(); sfxLevelUp && sfxLevelUp(); }
        }
    }
});

// --- FPS tracking ---
let _fps = 60, _fpsLast = 0, _fpsFrames = 0, _fpsAccum = 0;
function _tickFps(ts) {
    if (_fpsLast === 0) { _fpsLast = ts; return; }
    _fpsFrames++;
    _fpsAccum += (ts - _fpsLast);
    _fpsLast = ts;
    if (_fpsAccum >= 500) {
        _fps = Math.round((_fpsFrames * 1000) / _fpsAccum);
        _fpsFrames = 0;
        _fpsAccum = 0;
    }
}
// --- CRT POST-PROCESS — phosphor flicker, scanlines, vignette. Drawn last in render frame. ---
let _crtPattern = null;
function getScanlinePattern() {
    if (_crtPattern) return _crtPattern;
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const cctx = c.getContext('2d');
    cctx.fillStyle = 'rgba(0,0,0,0.20)';
    cctx.fillRect(0, 1, 4, 1);
    cctx.fillRect(0, 3, 4, 1);
    _crtPattern = ctx.createPattern(c, 'repeat');
    return _crtPattern;
}
function drawCRT() {
    if (meta.hudContrast) return;   // high-contrast mode: no scanlines, flicker or vignette
    const w = canvas.width, h = canvas.height;
    // Phosphor flicker — subtle brightness wobble at ~20Hz
    const flick = Math.sin(Date.now() / 50) * 0.025;
    if (flick > 0) {
        ctx.fillStyle = `rgba(0,0,0,${flick})`;
        ctx.fillRect(0, 0, w, h);
    }
    // Scanlines
    const pat = getScanlinePattern();
    if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); }
    // Vignette
    const cx = w / 2, cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const grad = ctx.createRadialGradient(cx, cy, maxR * 0.55, cx, cy, maxR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

function drawFps() {
    ctx.font = 'bold 11px monospace'; ctx.textAlign = 'left';
    const color = _fps >= 55 ? '#5AE0A0' : _fps >= 30 ? '#FFD040' : '#FF6060';
    ctx.fillStyle = color;
    // Top-left — DIVE BRIEF has moved to bottom-right, so this corner is clear again.
    ctx.fillText(`${_fps} FPS`, 6, 14);
}

// --- Game loop ---
let lastTime = 0;
function loop(ts) {
    try {
        _tickFps(ts);
        const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.05) : 0.016;
        lastTime = ts;
        update(dt);
        updateMusic(dt);
        draw();
        if (!POSTFX.on && !(isTouchDevice && Math.min(canvas.width, canvas.height) < 520)) drawCRT(); // phones skip the overdraw
        drawFps();
        postFX(ts);
    } catch(err) {
        // Show error on screen so we can debug
        ctx.fillStyle = '#FF0000';
        ctx.font = '16px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('ERROR: ' + err.message, 20, 40);
        ctx.fillText('Line: ' + (err.stack || '').split('\n')[1], 20, 60);
        console.error(err);
    }
    requestAnimationFrame(loop);
}
initPostFX();
window.addEventListener('keydown', e => { if ((e.key === 'o' || e.key === 'O') && POSTFX.gl) { POSTFX.on = !POSTFX.on; if (POSTFX.canvas) POSTFX.canvas.style.display = POSTFX.on ? 'block' : 'none'; } });
requestAnimationFrame(loop);

