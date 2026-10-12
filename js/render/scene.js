// Lincoln Park Speedway environment: banked clay oval, cushion, wall, catch
// fence, lights, hillside seating, pits, trees, night sky.
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export class TrackScene {
  constructor(track, surface, quality = 'high') {
    this.track = track; this.surface = surface; this.quality = quality;
    this.group = new THREE.Group();
    this.NS = 480;
    this.M = 34;
    this._buildSky();
    this._buildSurface();
    this._buildApronInfield();
    this._buildWall();
    this._buildOutside();
    this._buildStands();
    this._buildLights();
    this._buildPits();
    this._buildTrees();
    this._buildFlagstand();
    this.surfaceVersion = -1;
    this.updateSurface(true);
  }

  // ---------------- racing surface ----------------
  _buildSurface() {
    const { NS, M } = this, t = this.track;
    const verts = (NS + 1) * (M + 1);
    const pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
    const idx = [];
    for (let i = 0; i <= NS; i++) {
      for (let j = 0; j <= M; j++) {
        const k = i * (M + 1) + j;
        uv[k * 2] = i / NS; uv[k * 2 + 1] = j / M;
        if (i < NS && j < M) {
          const a = k, b = k + 1, c = k + M + 1, d = k + M + 2;
          idx.push(a, b, c, b, d, c);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.surfGeo = geo;

    this.dirtCanvas = canvas(2048, 64);
    this.dirtTex = new THREE.CanvasTexture(this.dirtCanvas);
    this.dirtTex.colorSpace = THREE.SRGBColorSpace;
    this.dirtTex.anisotropy = 8;
    this.dirtTex.wrapS = THREE.RepeatWrapping;
    // fine detail noise, tiled
    const dc = canvas(256, 256), dx = dc.getContext('2d');
    const r = rng(7), img = dx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 200 + (r() - 0.5) * 90 + (r() < 0.04 ? -60 : 0);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    dx.putImageData(img, 0, 0);
    const detail = new THREE.CanvasTexture(dc);
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.repeat.set(160, 6);

    const mat = new THREE.MeshLambertMaterial({ map: this.dirtTex });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDUv = uv * vec2(260.0, 9.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vDUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.55 + 0.6 * texture2D(detailMap, vDUv).r;');
    };
    this.surfMesh = new THREE.Mesh(geo, mat);
    this.group.add(this.surfMesh);
  }

  updateSurface(force) {
    const surf = this.surface;
    if (!force && surf.version === this.surfaceVersion) return;
    this.surfaceVersion = surf.version;
    const { NS, M } = this, t = this.track, W = t.W;
    const pos = this.surfGeo.attributes.position.array;
    const p = {};
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * t.L;
      for (let j = 0; j <= M; j++) {
        const d = -W / 2 + (j / M) * W;
        t.pos(s, d, p);
        const k = (i * (M + 1) + j) * 3;
        pos[k] = p.x; pos[k + 1] = t.height(s, d, surf); pos[k + 2] = p.z;
      }
    }
    this.surfGeo.attributes.position.needsUpdate = true;
    this.surfGeo.computeVertexNormals();
    this.surfGeo.computeBoundingSphere();
    this._paintDirt();
  }

  _paintDirt() {
    const c = this.dirtCanvas, x = c.getContext('2d'), surf = this.surface, t = this.track;
    const w = c.width, h = c.height;
    const img = x.createImageData(w, h);
    const r = rng(3);
    // colors (linear-ish sRGB)
    const tacky = [92, 58, 38], dry = [128, 104, 84], cushion = [78, 50, 34], marbles = [110, 84, 62];
    const rows = [];
    for (let j = 0; j < h; j++) {
      const dn = (j + 0.5) / h;
      const dryv = surf.dryness(dn);
      let col = tacky.map((v, i) => v + (dry[i] - v) * dryv);
      const cr = Math.exp(-(((dn - surf.cPos) / 0.03) ** 2)) * surf.cush;
      col = col.map((v, i) => v + (cushion[i] - v) * cr);
      const mr = dn > surf.cPos + 0.02 ? Math.min(1, (dn - surf.cPos - 0.02) / 0.03) * (0.4 + 0.6 * surf.cush) : 0;
      col = col.map((v, i) => v + (marbles[i] - v) * mr);
      rows.push({ col, cr, mr });
    }
    for (let j = 0; j < h; j++) {
      const { col, cr, mr } = rows[j];
      for (let i = 0; i < w; i++) {
        const s = (i / w) * t.L;
        let n = (r() - 0.5) * 16;
        // tire tracks: faint streaks along the groove
        n += Math.sin(j * 1.7 + Math.sin(s * 0.05) * 2) * 3;
        if (mr > 0.1 && r() < 0.25 * mr) n += (r() - 0.3) * 40; // clods
        if (cr > 0.2) n += Math.sin(s * 0.9 + j) * 6 * cr;
        const k = (j * w + i) * 4;
        img.data[k] = Math.max(0, Math.min(255, col[0] + n));
        img.data[k + 1] = Math.max(0, Math.min(255, col[1] + n * 0.85));
        img.data[k + 2] = Math.max(0, Math.min(255, col[2] + n * 0.7));
        img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    // start / finish line at s = 0 (and wrap)
    const lw = Math.max(2, Math.round((0.9 / t.L) * w));
    x.fillStyle = 'rgba(235,235,225,0.85)';
    x.fillRect(0, 0, lw, h); x.fillRect(w - lw, 0, lw, h);
    this.dirtTex.needsUpdate = true;
  }

  // ---------------- apron + infield ----------------
  _buildApronInfield() {
    const t = this.track, W = t.W, NS = this.NS;
    // apron strip
    const pos = [], idx = [];
    const p = {};
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * t.L;
      for (const d of [-W / 2 - 1.6, -W / 2]) {
        t.pos(s, d, p);
        pos.push(p.x, t.height(s, d) - 0.01, p.z);
      }
      if (i < NS) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#4b3324' })));

    // infield grass
    const shape = new THREE.Shape();
    for (let i = 0; i < NS; i++) {
      t.pos((i / NS) * t.L, -W / 2 - 1.5, p);
      if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
    }
    const ig = new THREE.ShapeGeometry(shape, 1);
    ig.rotateX(-Math.PI / 2);
    const inf = new THREE.Mesh(ig, new THREE.MeshLambertMaterial({ color: '#1f3a1a' }));
    inf.position.y = -0.1;
    this.group.add(inf);

    // inside tire barrier (instanced)
    const tireGeo = new THREE.TorusGeometry(0.45, 0.2, 6, 10);
    tireGeo.rotateX(Math.PI / 2);
    const n = Math.floor(t.L / 1.3);
    const im = new THREE.InstancedMesh(tireGeo, new THREE.MeshLambertMaterial({ color: '#141414' }), n * 2);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      t.pos((i / n) * t.L, -W / 2 - 7.4, p);
      m4.makeTranslation(p.x, 0.1, p.z); im.setMatrixAt(i * 2, m4);
      m4.makeTranslation(p.x, 0.48, p.z); im.setMatrixAt(i * 2 + 1, m4);
    }
    this.group.add(im);
    // a few infield light-colored concrete pads / infield crew area
    const pad = new THREE.Mesh(new THREE.BoxGeometry(46, 0.1, 10), new THREE.MeshLambertMaterial({ color: '#555049' }));
    pad.position.set(0, -0.05, -t.W - 8);
    this.group.add(pad);
  }

  // ---------------- wall + catch fence ----------------
  _buildWall() {
    const t = this.track, W = t.W, NS = this.NS;
    const ads = canvas(2048, 128), x = ads.getContext('2d');
    const boards = [
      ['LINCOLN PARK SPEEDWAY', '#c8102e', '#fff'],
      ['RACO MARKETING', '#0b0b0e', '#f2cf7e'],
      ['PUTNAMVILLE, INDIANA', '#0033a0', '#fff'],
      ['5/16 MILE CLAY', '#f5f5f5', '#111'],
    ];
    boards.forEach(([txt, bg, fg], i) => {
      x.fillStyle = bg; x.fillRect(i * 512, 0, 512, 128);
      x.fillStyle = fg; x.font = 'italic 900 52px "Arial Black", Arial, sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(txt, i * 512 + 256, 66, 480);
      x.fillStyle = 'rgba(255,255,255,0.15)'; x.fillRect(i * 512, 0, 4, 128);
    });
    const adTex = new THREE.CanvasTexture(ads);
    adTex.colorSpace = THREE.SRGBColorSpace;
    adTex.wrapS = THREE.RepeatWrapping;
    adTex.anisotropy = 4;

    const pos = [], uv = [], idx = [], top = [], tidx = [];
    const p = {};
    const reps = Math.round(t.L / 48);
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * t.L;
      const h0 = t.height(s, W / 2);
      t.pos(s, W / 2 + 0.3, p);
      pos.push(p.x, h0 - 0.4, p.z, p.x, h0 + 1.15, p.z);
      uv.push(-(i / NS) * reps, 0, -(i / NS) * reps, 1); // read correctly from the infield side
      const q = t.pos(s, W / 2 + 0.6, {});
      top.push(p.x, h0 + 1.15, p.z, q.x, h0 + 1.15, q.z);
      if (i < NS) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); tidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const wall = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: adTex, side: THREE.DoubleSide }));
    this.group.add(wall);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    tg.setIndex(tidx); tg.computeVertexNormals();
    this.group.add(new THREE.Mesh(tg, new THREE.MeshLambertMaterial({ color: '#cfcfc8', side: THREE.DoubleSide })));

    // catch fence
    const fc = canvas(64, 64), fx = fc.getContext('2d');
    fx.strokeStyle = 'rgba(200,200,200,0.9)'; fx.lineWidth = 3;
    fx.beginPath(); fx.moveTo(0, 0); fx.lineTo(64, 64); fx.moveTo(64, 0); fx.lineTo(0, 64); fx.stroke();
    const fTex = new THREE.CanvasTexture(fc);
    fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping;
    const fpos = [], fuv = [], fidx = [];
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * t.L;
      const h0 = t.height(s, W / 2);
      t.pos(s, W / 2 + 0.45, p);
      fpos.push(p.x, h0 + 1.15, p.z, p.x, h0 + 5.2, p.z);
      fuv.push((i / NS) * t.L / 0.6, 0, (i / NS) * t.L / 0.6, 4.05 / 0.6);
      if (i < NS) { const a = i * 2; fidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(fidx); fg.computeVertexNormals();
    const fence = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ map: fTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.group.add(fence);
    // fence posts
    const n = Math.floor(t.L / 5);
    const post = new THREE.CylinderGeometry(0.05, 0.05, 4.4, 5);
    const im = new THREE.InstancedMesh(post, new THREE.MeshLambertMaterial({ color: '#8d8d8d' }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const s = (i / n) * t.L;
      t.pos(s, W / 2 + 0.5, p);
      m4.makeTranslation(p.x, t.height(s, W / 2) + 3.1, p.z);
      im.setMatrixAt(i, m4);
    }
    this.group.add(im);
  }

  // ---------------- terrain outside the wall ----------------
  _buildOutside() {
    const t = this.track, W = t.W, NS = this.NS;
    const pos = [], idx = [], col = [];
    const p = {};
    const rings = [[0.6, 0], [3, -0.2], [16, null], [70, null]];
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * t.L;
      const h0 = t.height(s, W / 2);
      rings.forEach(([off, dh], r) => {
        t.pos(s, W / 2 + off, p);
        const y = dh === null ? (r === 2 ? Math.max(0, h0 * 0.35) : -0.2) : h0 + dh;
        pos.push(p.x, y, p.z);
        col.push(0.13, 0.2, 0.1);
      });
      if (i < NS) {
        for (let r = 0; r < rings.length - 1; r++) {
          const a = i * rings.length + r, b = a + rings.length;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#203a19', side: THREE.DoubleSide })));
    // big ground
    const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32), new THREE.MeshLambertMaterial({ color: '#16260f' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    this.group.add(ground);
  }

  // ---------------- hillside seating + bleachers along the front stretch ----------------
  _buildStands() {
    const t = this.track, W = t.W;
    const g = new THREE.Group();
    // front straight is centered at s=0 heading +x; outside is +z
    const sm = t.sample(0, {});
    const h0 = t.height(0, W / 2);
    const baseD = W / 2 + 5;
    const rows = 12, len = 96;
    // crowd texture
    const cc = canvas(512, 32), cx = cc.getContext('2d');
    cx.fillStyle = '#2a2a2e'; cx.fillRect(0, 0, 512, 32);
    const r = rng(11);
    const shirt = ['#c8102e', '#f5f5f5', '#0033a0', '#ffd100', '#222', '#ff6a13', '#2e7d32', '#999', '#6a1b9a', '#f2cf7e'];
    for (let i = 0; i < 150; i++) {
      if (r() < 0.25) continue;
      const x = i * 3.4 + r() * 1.5;
      cx.fillStyle = shirt[Math.floor(r() * shirt.length)];
      cx.fillRect(x, 12 + r() * 4, 2.4, 14);
      cx.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][Math.floor(r() * 4)];
      cx.fillRect(x + 0.3, 6 + r() * 4, 1.8, 6);
    }
    const crowd = new THREE.CanvasTexture(cc);
    crowd.colorSpace = THREE.SRGBColorSpace;
    crowd.wrapS = THREE.RepeatWrapping; crowd.repeat.set(len / 12, 1);
    const benchMat = new THREE.MeshLambertMaterial({ color: '#9ea3a8' });
    const crowdMat = new THREE.MeshLambertMaterial({ map: crowd });
    for (let i = 0; i < rows; i++) {
      const d = baseD + i * 0.9, y = h0 + 0.3 + i * 0.5;
      const bench = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.85), benchMat);
      bench.position.set(sm.x, y, sm.z + d);
      g.add(bench);
      const people = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.7), crowdMat);
      people.position.set(sm.x, y + 0.4, sm.z + d + 0.2);
      people.rotation.y = Math.PI; // face the track (-z)
      g.add(people);
    }
    // the hillside the bleachers sit on
    const hill = new THREE.Mesh(new THREE.BoxGeometry(len + 40, 1, 40), new THREE.MeshLambertMaterial({ color: '#223f1b' }));
    hill.position.set(sm.x, h0 - 0.2 + 2.5, sm.z + baseD + 20);
    hill.rotation.x = -0.17;
    g.add(hill);
    // press box / announcer stand
    const press = new THREE.Mesh(new THREE.BoxGeometry(18, 3.2, 4), new THREE.MeshLambertMaterial({ color: '#d8d4cc' }));
    press.position.set(sm.x - 8, h0 + 0.3 + rows * 0.5 + 2.2, sm.z + baseD + rows * 0.9 + 2.5);
    g.add(press);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(16, 1.3), new THREE.MeshBasicMaterial({ color: '#ffe9a8' }));
    glass.position.set(press.position.x, press.position.y + 0.4, press.position.z - 2.01);
    glass.rotation.y = Math.PI;
    g.add(glass);
    this.group.add(g);
  }

  // ---------------- light poles ----------------
  _buildLights() {
    const t = this.track, W = t.W;
    const poles = [], heads = [];
    const p = {};
    const n = 14;
    for (let i = 0; i < n; i++) {
      const s = (i / n) * t.L + 10;
      t.pos(s, W / 2 + 9, p);
      poles.push([p.x, p.z, t.height(s, W / 2) * 0.35]);
    }
    // infield poles
    for (let i = 0; i < 4; i++) {
      const s = (i / 4) * t.L + t.L / 8;
      t.pos(s, -W / 2 - 14, p);
      poles.push([p.x, p.z, 0]);
    }
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.28, 24, 6);
    const pm = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#5f5f5f' }), poles.length);
    const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 1.6, 0.4), new THREE.MeshBasicMaterial({ color: '#fff6dc' }), poles.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
    // glow sprites
    const gc = canvas(64, 64), gx = gc.getContext('2d');
    const gr = gx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,248,220,1)'); gr.addColorStop(0.3, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
    const glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    poles.forEach(([x, z, y0], i) => {
      m4.makeTranslation(x, y0 + 12, z); pm.setMatrixAt(i, m4);
      const yaw = Math.atan2(-x, -z);
      e.set(0.35, yaw, 0); q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, y0 + 24.5, z), q, sc); hm.setMatrixAt(i, m4);
      const sp = new THREE.Sprite(glowMat);
      sp.position.set(x, y0 + 24.5, z); sp.scale.set(14, 14, 1);
      this.group.add(sp);
    });
    this.group.add(pm, hm);
  }

  // ---------------- pits: haulers outside turns 3-4 ----------------
  _buildPits() {
    const t = this.track, W = t.W;
    const r = rng(21);
    const cols = ['#e8e8e8', '#1c1c1c', '#8a1a1a', '#1a3d8a', '#d0d0d0', '#444', '#f0f0f0', '#2c5530'];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const n = 26;
    const im = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    const p = {};
    for (let i = 0; i < n; i++) {
      const s = t.turnZones[5].s0 + 20 + (i % 13) * 11;
      const row = Math.floor(i / 13);
      t.pos(s, W / 2 + 30 + row * 16 + r() * 3, p);
      const yaw = Math.atan2(p.tz, p.tx);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw + Math.PI / 2 + (r() - 0.5) * 0.2);
      const len = 8 + r() * 6;
      m4.compose(new THREE.Vector3(p.x, 1.9, p.z), q, new THREE.Vector3(2.5, 3.8, len));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.set(cols[Math.floor(r() * cols.length)]));
    }
    this.group.add(im);
  }

  // ---------------- tree line ----------------
  _buildTrees() {
    const n = this.quality === 'low' ? 120 : 260;
    const geo = new THREE.ConeGeometry(4, 13, 6);
    geo.translate(0, 6.5, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#10200d' }), n);
    const r = rng(5), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const rad = 210 + r() * 120;
      const sc = 0.8 + r() * 1.3;
      m4.compose(new THREE.Vector3(Math.cos(a) * rad * 1.15, -0.3, Math.sin(a) * rad), q, new THREE.Vector3(sc, sc * (0.8 + r() * 0.6), sc));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setHSL(0.28 + r() * 0.06, 0.4, 0.07 + r() * 0.05));
    }
    this.group.add(im);
  }

  _buildFlagstand() {
    const t = this.track, W = t.W;
    const p = t.pos(-3, W / 2 + 1.2, {});
    const h0 = t.height(0, W / 2);
    const g = new THREE.Group();
    const leg = new THREE.MeshLambertMaterial({ color: '#777' });
    for (const [dx, dz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 5, 5), leg);
      l.position.set(dx, 2.5, dz); g.add(l);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 2), new THREE.MeshLambertMaterial({ color: '#c62828' }));
    plat.position.y = 5; g.add(plat);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.1, 2.2), new THREE.MeshLambertMaterial({ color: '#eee' }));
    roof.position.y = 7.2; g.add(roof);
    const flagman = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), new THREE.MeshLambertMaterial({ color: '#222' }));
    flagman.position.set(0, 5.7, 0); g.add(flagman);
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: '#00c853', side: THREE.DoubleSide }));
    this.flag.position.set(0, 6.5, -0.9); g.add(this.flag);
    g.position.set(p.x, h0 - 0.4, p.z);
    this.group.add(g);
    this._flagTex = {};
  }

  setFlag(kind) {
    if (!this.flag || this._flagKind === kind) return;
    this._flagKind = kind;
    const m = this.flag.material;
    m.map = null;
    if (kind === 'checkered' || kind === 'white') {
      if (!this._flagTex[kind]) {
        const c = canvas(64, 48), x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 48);
        if (kind === 'checkered') { x.fillStyle = '#000'; for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) if ((i + j) % 2) x.fillRect(i * 8, j * 8, 8, 8); }
        this._flagTex[kind] = new THREE.CanvasTexture(c);
      }
      m.map = this._flagTex[kind]; m.color.set('#fff');
    } else {
      m.color.set(kind === 'green' ? '#00c853' : kind === 'yellow' ? '#ffd600' : kind === 'red' ? '#d50000' : '#00c853');
    }
    this.flag.visible = kind !== 'none';
    m.needsUpdate = true;
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1400, 24, 12);
    const col = [];
    const p = geo.attributes.position;
    const top = new THREE.Color('#04060f'), hor = new THREE.Color('#1b2340'), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = Math.max(0, p.getY(i) / 1400);
      c.copy(hor).lerp(top, Math.pow(y, 0.6));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.group.add(sky);
    const r = rng(9), sp = [];
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2, e = 0.15 + r() * 1.3;
      sp.push(Math.cos(a) * Math.cos(e) * 1300, Math.sin(e) * 1300, Math.sin(a) * Math.cos(e) * 1300);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.group.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfd8ff', size: 2, sizeAttenuation: false, fog: false })));
  }
}
