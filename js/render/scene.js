// Track environments.
// Lincoln Park Speedway, modeled on photos of the track:
//  - orange/red clay, light clay berm ringing a grass infield, infield light poles
//  - front stretch: low concrete wall, grass bank, wooden bleachers, big white building
//  - turns 1-2: no wall, the track drops off down a hill
//  - backstretch: wall set back off the track with a drop down to it
//  - turns 3-4: no wall, flatter runoff out to the pits
// Eldora Speedway (layout 'walled'), from Ryan's in-car video:
//  - concrete wall + tall catch fence all the way around, painted with lettering,
//    billboards along the fence in the turns
//  - inside concrete wall with yellow pads, grass infield
//  - big grandstands down the front stretch and backstretch, tower out of turn 4
import * as THREE from 'three';
import { APRON, BERM_OUT } from '../track.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class TrackScene {
  constructor(track, surface, quality = 'high') {
    this.track = track; this.surface = surface; this.quality = quality;
    this.group = new THREE.Group();
    this.NS = 480;
    this.M = 34;
    this.nightOnly = [];
    this.walled = track.def.layout === 'walled';
    this._buildSky();
    this._buildSurface();
    this._buildInside();
    this._buildOutside();
    this._buildWalls();
    this._buildStands();
    this._buildLights();
    this._buildPits();
    this._buildTrees();
    this._buildFlagstand();
    this._buildTireMarkers();
    this.surfaceVersion = -1;
    this.updateSurface(true);
  }

  // generic ribbon along the track: columns at lateral offsets ds, colors from colorFn
  _ribbon(ds, colorFn) {
    const t = this.track, n = this.NS, nc = ds.length;
    const pos = [], col = [], idx = [];
    const p = {}, c = new THREE.Color();
    for (let i = 0; i <= n; i++) {
      const s = (t.L * i) / n;
      for (let j = 0; j < nc; j++) {
        t.pos(s, ds[j], p);
        pos.push(p.x, t.height(s, ds[j]), p.z);
        colorFn(s, ds[j], j, c);
        col.push(c.r, c.g, c.b);
      }
      if (i < n) {
        for (let j = 0; j < nc - 1; j++) {
          const a = i * nc + j, b = a + nc;
          if (ds[1] > ds[0]) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // ---------------- racing surface ----------------
  _buildSurface() {
    const { NS, M } = this;
    const verts = (NS + 1) * (M + 1);
    const pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
    const idx = [];
    for (let i = 0; i <= NS; i++) {
      for (let j = 0; j <= M; j++) {
        const k = i * (M + 1) + j;
        uv[k * 2] = i / NS; uv[k * 2 + 1] = j / M;
        if (i < NS && j < M) { const a = k, b = k + 1, c = k + M + 1, d = k + M + 2; idx.push(a, b, c, b, d, c); }
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
    const detail = this._detailTex();

    const mat = new THREE.MeshLambertMaterial({ map: this.dirtTex });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.detailMap = { value: detail };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDUv = uv * vec2(260.0, 9.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D detailMap;\nvarying vec2 vDUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 0.6 + 0.55 * texture2D(detailMap, vDUv).r;');
    };
    this.surfMesh = new THREE.Mesh(geo, mat);
    this.surfMesh.receiveShadow = true;
    this.group.add(this.surfMesh);
  }

  _detailTex() {
    if (this._detail) return this._detail;
    const dc = canvas(256, 256), dx = dc.getContext('2d');
    const r = rng(7), img = dx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 200 + (r() - 0.5) * 80 + (r() < 0.04 ? -60 : 0);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
    }
    dx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(dc);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return (this._detail = t);
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
    // Indiana red clay: dark and red when tacky, orange-tan as it dries out
    // Lincoln Park clay: brown and a little red when tacky, tan as it dries out (from in-car video)
    const [tacky, dry, cushion, marbles] = t.def.clay;
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
        n += Math.sin(j * 1.7 + Math.sin(s * 0.05) * 2) * 3;
        // ruts / tire tracks running around the track
        const rut = Math.sin(j * 2.3 + Math.sin(s * 0.031 + j * 0.2) * 3.0 + Math.sin(s * 0.11) * 0.6);
        if (rut > 0.82) n -= (rut - 0.82) * 70;
        else if (rut < -0.9) n += 6;
        if (mr > 0.1 && r() < 0.25 * mr) n += (r() - 0.3) * 40;
        if (cr > 0.2) n += Math.sin(s * 0.9 + j) * 6 * cr;
        const k = (j * w + i) * 4;
        img.data[k] = clamp(col[0] + n, 0, 255);
        img.data[k + 1] = clamp(col[1] + n * 0.8, 0, 255);
        img.data[k + 2] = clamp(col[2] + n * 0.6, 0, 255);
        img.data[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const lw = Math.max(2, Math.round((0.9 / t.L) * w));
    x.fillStyle = 'rgba(235,235,225,0.85)';
    x.fillRect(0, 0, lw, h); x.fillRect(w - lw, 0, lw, h);
    this.dirtTex.needsUpdate = true;
  }

  // ---------------- apron, infield berm, infield ----------------
  _buildInside() {
    if (this.walled) return this._buildInsideWalled();
    const t = this.track, W = t.W;
    const ds = [-W / 2, -W / 2 - APRON * 0.5, -W / 2 - APRON, -W / 2 - APRON - 0.4, -W / 2 - (APRON + BERM_OUT) / 2, -W / 2 - BERM_OUT + 0.3, -W / 2 - BERM_OUT, -W / 2 - BERM_OUT - 2];
    const apron = new THREE.Color('#7a4426'), berm = new THREE.Color('#c99a68'), grass = new THREE.Color('#3f6a2c');
    const g = this._ribbon(ds, (s, d, j, c) => {
      if (j <= 2) c.copy(apron); else if (j <= 6) c.copy(berm).lerp(apron, j === 3 ? 0.4 : 0); else c.copy(grass);
    });
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));

    const shape = new THREE.Shape(), p = {};
    for (let i = 0; i < this.NS; i++) {
      t.pos((i / this.NS) * t.L, -W / 2 - BERM_OUT - 1.5, p);
      if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
    }
    const ig = new THREE.ShapeGeometry(shape, 1);
    ig.rotateX(-Math.PI / 2);
    const inf = new THREE.Mesh(ig, new THREE.MeshLambertMaterial({ color: '#3f6a2c' }));
    inf.position.y = -0.13;
    this.group.add(inf);
  }

  // walled track: the apron runs to a concrete inside wall with yellow pads at
  // the ends of the straights; grass infield behind it
  _buildInsideWalled() {
    const t = this.track, W = t.W, edge = t.innerEdge, apronW = t.def.inner.apron;
    const ds = [-W / 2, -W / 2 - apronW * 0.5, -W / 2 - apronW, -W / 2 - edge, -W / 2 - edge - 3];
    const clay = new THREE.Color().setRGB(...t.def.clay[0].map((v) => (v * 0.85) / 255)).convertSRGBToLinear();
    const concrete = new THREE.Color('#8e8a83');
    const g = this._ribbon(ds, (s, d, j, c) => { if (j <= 3) c.copy(clay); else c.copy(concrete); });
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const shape = new THREE.Shape(), p = {};
    for (let i = 0; i < this.NS; i++) {
      t.pos((i / this.NS) * t.L, -W / 2 - edge - 2.5, p);
      if (i === 0) shape.moveTo(p.x, -p.z); else shape.lineTo(p.x, -p.z);
    }
    const ig = new THREE.ShapeGeometry(shape, 1);
    ig.rotateX(-Math.PI / 2);
    // the whole infield is paved: it's the pit area, full of haulers
    const inf = new THREE.Mesh(ig, new THREE.MeshLambertMaterial({ map: this._concreteTex() }));
    inf.position.y = -0.14;
    this.group.add(inf);
    // the inside wall: a low concrete band, yellow pads where it starts and ends
    const zs = t.turnZones, pads = [];
    for (const zi of [1, 3, 5, 7]) { const s0 = zi % 2 ? zs[zi].s0 : zs[zi].s1; pads.push(s0); }
    const n = this.NS, pos = [], col = [], idx = [], q = {}, cc = new THREE.Color();
    const white = new THREE.Color('#cfcbc2'), yellow = new THREE.Color('#f2c200');
    for (let i = 0; i <= n; i++) {
      const s = (t.L * i) / n;
      const padded = pads.some((ps) => Math.abs(((s - ps + t.L * 1.5) % t.L) - t.L / 2) < 9);
      cc.copy(padded ? yellow : white);
      for (const [dd, y] of [[0, -0.2], [0, 0.85], [-0.35, 0.85], [-0.35, -0.2]]) {
        t.pos(s, -W / 2 - edge + dd, q);
        pos.push(q.x, t.height(s, -W / 2 - edge) + y, q.z); col.push(cc.r, cc.g, cc.b);
      }
      if (i < n) for (let k = 0; k < 3; k++) { const a = i * 4 + k, b = a + 4; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    wg.setIndex(idx); wg.computeVertexNormals();
    this.group.add(new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    // catch fence on top of the inside wall
    const fH = 2.6, fpos = [], fuv = [], fidx = [];
    for (let i = 0; i <= n; i++) {
      const s = (t.L * i) / n;
      t.pos(s, -W / 2 - edge - 0.17, q);
      const y = t.height(s, -W / 2 - edge) + 0.85;
      fpos.push(q.x, y, q.z, q.x, y + fH, q.z);
      const u = s / 0.6;
      fuv.push(u, 0, u, fH / 0.6);
      if (i < n) { const a = i * 2; fidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    fg.setIndex(fidx);
    this.group.add(new THREE.Mesh(fg, this._fenceMat()));
    const np = Math.floor(t.L / 5);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, fH + 0.1, 5), new THREE.MeshLambertMaterial({ color: '#8d8d8d' }), np);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < np; i++) {
      const s = (t.L * i) / np;
      t.pos(s, -W / 2 - edge - 0.17, q);
      m4.makeTranslation(q.x, t.height(s, -W / 2 - edge) + 0.85 + fH / 2, q.z);
      posts.setMatrixAt(i, m4);
    }
    this.group.add(posts);
  }

  _concreteTex() {
    const c = canvas(256, 256), x = c.getContext('2d'), r = rng(31);
    x.fillStyle = '#8e8a83'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1800; i++) { const v = 120 + r() * 40; x.fillStyle = `rgba(${v},${v - 3},${v - 8},0.25)`; x.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); }
    x.strokeStyle = 'rgba(60,58,54,0.5)'; x.lineWidth = 2;   // expansion joints
    for (let i = 0; i <= 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
    for (let i = 0; i < 14; i++) { x.fillStyle = `rgba(40,36,30,${0.08 + r() * 0.12})`; x.beginPath(); x.ellipse(r() * 256, r() * 256, 6 + r() * 20, 4 + r() * 12, r() * 3, 0, 7); x.fill(); } // oil stains
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.05, 0.05);
    return t;
  }

  // Eldora's infield pits: rows of semis (trailer + tractor), a few toter rigs
  // and pickups, all parked on the concrete
  _buildInfieldPits() {
    const t = this.track, W = t.W, r = rng(44);
    const keep = -W / 2 - t.innerEdge - 7; // stay this far inside the inner wall
    const spots = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.N; i++) { minX = Math.min(minX, t.x[i]); maxX = Math.max(maxX, t.x[i]); minZ = Math.min(minZ, t.z[i]); maxZ = Math.max(maxZ, t.z[i]); }
    const pr = {};
    const cx0 = (minX + maxX) / 2, cz0 = (minZ + maxZ) / 2;
    for (let z = minZ + 8; z < maxZ - 8; z += 13) {
      for (let x0 = minX + 10; x0 < maxX - 10; x0 += 21) {
        const x = x0 + (r() - 0.5) * 3, zz = z + (r() - 0.5) * 1.5;
        // both ends of the rig (trailer + tractor) have to clear the inside wall
        let ok = true;
        for (const ex of [-12, 0, 12]) { t.project(x + ex, zz, -1, pr); if (pr.d > keep) ok = false; }
        if (!ok) continue;
        // leave a lane down the middle, room for the infield building, and some gaps
        if (Math.abs(zz - cz0) < 5 || (Math.abs(x - cx0) < 26 && Math.abs(zz - cz0) < 22) || r() < 0.12) continue;
        spots.push([x, zz, r() < 0.5 ? 0 : Math.PI]);
      }
    }
    const n = spots.length;
    const trailerCols = ['#f2f2f2', '#e8e8e8', '#1c1c1c', '#8a1a1a', '#1a3d8a', '#c9c9c9', '#2c5530', '#f37a1f', '#d0102a', '#f6f7f8', '#3c3fb8', '#111'];
    const cabCols = ['#ffffff', '#111111', '#b71c1c', '#0d47a1', '#9e9e9e', '#1b5e20', '#f9a825'];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const trailers = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#fff' }), n);
    const cabs = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#fff' }), n);
    const glass = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#1d2730' }), n);
    const awn = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial({ color: '#fff' }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    const y = -0.14;
    spots.forEach(([x, z, rot], i) => {
      q.setFromAxisAngle(up, rot);
      const dir = rot ? -1 : 1, L = 15 + r() * 2;
      m4.compose(new THREE.Vector3(x, y + 2.05, z), q, new THREE.Vector3(L, 3.9, 2.6)); trailers.setMatrixAt(i, m4);
      trailers.setColorAt(i, c.set(trailerCols[Math.floor(r() * trailerCols.length)]));
      const cx = x + dir * (L / 2 + 2.6);
      m4.compose(new THREE.Vector3(cx, y + 1.75, z), q, new THREE.Vector3(4.6, 3.1, 2.5)); cabs.setMatrixAt(i, m4);
      cabs.setColorAt(i, c.set(cabCols[Math.floor(r() * cabCols.length)]));
      m4.compose(new THREE.Vector3(cx + dir * 1.9, y + 2.4, z), q, new THREE.Vector3(0.9, 1.0, 2.3)); glass.setMatrixAt(i, m4);
      // pop-up awning off the side of the trailer
      m4.compose(new THREE.Vector3(x, y + 3.3, z + 2.9), q, new THREE.Vector3(L * 0.6, 0.12, 3.2)); awn.setMatrixAt(i, m4);
      awn.setColorAt(i, c.set(['#d0102a', '#0d47a1', '#e8e8e8', '#1c1c1c', '#f9a825'][Math.floor(r() * 5)]));
    });
    this.group.add(trailers, cabs, glass, awn);
    // the building in the middle of the infield
    const bld = new THREE.Mesh(new THREE.BoxGeometry(26, 6, 22), new THREE.MeshLambertMaterial({ color: '#b9b4aa' }));
    bld.position.set(cx0, y + 3, cz0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(27, 0.6, 23), new THREE.MeshLambertMaterial({ color: '#7d8186' }));
    roof.position.set(cx0, y + 6.3, cz0);
    this.group.add(bld, roof);
  }

  // ---------------- terrain outside the track ----------------
  _buildOutside() {
    const t = this.track, W = t.W;
    const es = [0, 0.3, 0.6, 1.5, 2.5, 4, 6, 8.5, 9.5, 12, 16, 22, 30, 45, 70];
    const grass = new THREE.Color('#3b6629'), dark = new THREE.Color('#2e521f'), dirt = new THREE.Color('#8a5a3a'), clay = new THREE.Color('#7a4426');
    const g = this._ribbon(es.map((e) => W / 2 + e), (s, d, j, c) => {
      const e = d - W / 2, z = t.zones(s);
      c.copy(grass);
      if (e < 0.6) c.copy(clay);
      else if (z.flat > 0.5 && e < 30) c.copy(dirt).lerp(grass, clamp((e - 12) / 18, 0, 1) * 0.6); // runoff + pit lane
      else if (e > 30) c.copy(dark);
    });
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1100, 32), new THREE.MeshLambertMaterial({ color: '#2a4a1d' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.55;
    this.group.add(ground);
  }

  _adTexture() {
    if (this._ads) return this._ads;
    const ads = canvas(2048, 128), x = ads.getContext('2d');
    const boards = this.walled ? [
      ['ELDORA', '#f4f2ec', '#d0102a'],
      ['RACO MARKETING', '#0b0b0e', '#f2cf7e'],
      ['THE BIG E', '#f4f2ec', '#0b2e6e'],
      ['ROSSBURG, OHIO', '#f4f2ec', '#d0102a'],
    ] : [
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
    });
    const tex = new THREE.CanvasTexture(ads);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return (this._ads = tex);
  }

  _fenceMat() {
    if (this._fm) return this._fm;
    const fc = canvas(64, 64), fx = fc.getContext('2d');
    fx.strokeStyle = 'rgba(200,200,200,0.9)'; fx.lineWidth = 3;
    fx.beginPath(); fx.moveTo(0, 0); fx.lineTo(64, 64); fx.moveTo(64, 0); fx.lineTo(0, 64); fx.stroke();
    const fTex = new THREE.CanvasTexture(fc);
    fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping;
    return (this._fm = new THREE.MeshBasicMaterial({ map: fTex, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  }

  // wall (+ optional catch fence) from s0..s1, e meters past the outer edge
  _wall(s0, s1, e, height, fenceH, ads) {
    const t = this.track, W = t.W;
    const n = Math.max(4, Math.round(((s1 - s0) / t.L) * this.NS));
    const pos = [], uv = [], idx = [], top = [], tidx = [], fpos = [], fuv = [];
    const p = {}, q = {};
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const base = t.height(s, W / 2 + e);
      t.pos(s, W / 2 + e, p); t.pos(s, W / 2 + e + 0.3, q);
      pos.push(p.x, base - 0.5, p.z, p.x, base + height, p.z);
      const u = -((s - s0) / 12);
      uv.push(u, -0.25, u, 1);
      top.push(p.x, base + height, p.z, q.x, base + height, q.z);
      fpos.push(p.x, base + height, p.z, p.x, base + height + fenceH, p.z);
      fuv.push((s - s0) / 0.6, 0, (s - s0) / 0.6, fenceH / 0.6);
      if (i < n) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        tidx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const mk = (P, U, I) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      if (U) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setIndex(I); g.computeVertexNormals();
      return g;
    };
    const wallMat = ads
      ? new THREE.MeshLambertMaterial({ map: this._adTexture(), side: THREE.DoubleSide })
      : new THREE.MeshLambertMaterial({ color: '#9d9a93', side: THREE.DoubleSide });
    this.group.add(new THREE.Mesh(mk(pos, uv, idx), wallMat));
    this.group.add(new THREE.Mesh(mk(top, null, tidx), new THREE.MeshLambertMaterial({ color: '#a39d92', side: THREE.DoubleSide })));
    if (fenceH > 0) {
      this.group.add(new THREE.Mesh(mk(fpos, fuv, idx), this._fenceMat()));
      const np = Math.max(2, Math.floor((s1 - s0) / 5));
      const im = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.05, fenceH + 0.2, 5), new THREE.MeshLambertMaterial({ color: '#8d8d8d' }), np);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < np; i++) {
        const s = s0 + ((s1 - s0) * i) / (np - 1);
        t.pos(s, W / 2 + e + 0.15, p);
        m4.makeTranslation(p.x, t.height(s, W / 2 + e) + height + fenceH / 2, p.z);
        im.setMatrixAt(i, m4);
      }
      this.group.add(im);
    }
    for (const s of [s0, s1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.35, height + 0.5, 0.35), new THREE.MeshLambertMaterial({ color: '#c9c3b8' }));
      t.pos(s, W / 2 + e + 0.15, p);
      cap.position.set(p.x, t.height(s, W / 2 + e) + (height - 0.5) / 2, p.z);
      this.group.add(cap);
    }
  }

  // colorful sponsor billboards mounted along the catch fence (Eldora's turns)
  _billboards(s0, s1, e, y0, h) {
    const t = this.track, W = t.W;
    if (!this._bbTex) {
      const c = canvas(2048, 128), x = c.getContext('2d');
      const boards = [['ELDORA', '#d0102a', '#fff'], ['USAC', '#0b2e6e', '#fff'], ['RACO', '#0b0b0e', '#f2cf7e'], ['HOOSIER', '#f5f5f5', '#111'],
        ['LONG', '#e8e8e8', '#c8102e'], ['KEIZER', '#111', '#fff'], ['FLORACING', '#e4002b', '#fff'], ['SUNOCO', '#ffd100', '#0033a0']];
      boards.forEach(([txt, bg, fg], i) => {
        x.fillStyle = bg; x.fillRect(i * 256 + 4, 6, 248, 116);
        x.fillStyle = fg; x.font = 'italic 900 50px "Arial Black", Arial, sans-serif';
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(txt, i * 256 + 128, 66, 230);
      });
      this._bbTex = new THREE.CanvasTexture(c);
      this._bbTex.colorSpace = THREE.SRGBColorSpace; this._bbTex.wrapS = THREE.RepeatWrapping; this._bbTex.anisotropy = 4;
    }
    const n = Math.max(4, Math.round(((s1 - s0) / t.L) * this.NS));
    const pos = [], uv = [], idx = [], p = {};
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      const base = t.height(s, W / 2 + e);
      t.pos(s, W / 2 + e + 0.05, p);
      pos.push(p.x, base + y0, p.z, p.x, base + y0 + h, p.z);
      const u = -((s - s0) / 48);
      uv.push(u, 0, u, 1);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: this._bbTex, side: THREE.DoubleSide })));
  }

  _buildWalls() {
    const L = this.track.L;
    if (this.walled) {
      this._wall(0, L, 0.3, 1.3, 4.6, true); // wall + catch fence all the way around
      for (const [a, b] of [[1, 3], [5, 7]]) {
        const zs = this.track.turnZones;
        this._billboards(zs[a].s0 + 6, zs[b].s1 - 6, 0.3, 3.0, 1.5);
      }
      // no grandstands down the backstretch: a row of big billboards behind the wall
      const zs = this.track.turnZones;
      this._billboards(zs[4].s0 - 10, zs[4].s1 + 10, 5, 2.5, 4.2);
      return;
    }
    this._wall(L - 52, L + 52, 0.3, 1.0, 3.2, true); // front stretch, right at the edge
    this._wall(206, 296, 9, 1.1, 2.0, true);         // backstretch, set well back
    this._wall(304, 440, 26, 0.6, 1.4, false);       // pit-side fence past the 3-4 runoff
  }

  // ---------------- front stretch: grass bank, wooden bleachers, white building ----------------
  // a big concrete grandstand along the track, centered at sMid, e0 meters past
  // the outer edge, built in a local frame (x along the track, z outward)
  _grandstand(sMid, len, rows, e0, opts = {}) {
    const t = this.track, W = t.W;
    const g = new THREE.Group();
    const rise = opts.rise || 0.5, depth = opts.depth || 0.85;
    const concrete = new THREE.MeshLambertMaterial({ color: opts.color || '#9a958c' });
    const seat = new THREE.MeshLambertMaterial({ color: opts.seat || '#b0362f' });
    const crowdMat = new THREE.MeshLambertMaterial({ map: this._crowdTex(len), transparent: true, alphaTest: 0.2 });
    const y0 = t.outsideY(sMid, e0) + (opts.lift || 0);
    for (let i = 0; i < rows; i++) {
      const z = e0 + i * depth, y = y0 + 0.4 + i * rise;
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, rise, depth), concrete);
      step.position.set(0, y - rise / 2, z + depth / 2);
      g.add(step);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(len - 2, 0.12, 0.3), seat);
      bench.position.set(0, y + 0.3, z + depth * 0.6);
      g.add(bench);
      if ((i * 7) % 10 < 8) {
        const people = new THREE.Mesh(new THREE.PlaneGeometry(len - 3, 0.75), crowdMat);
        people.position.set(0, y + 0.62, z + depth * 0.65);
        people.rotation.y = Math.PI;
        g.add(people);
      }
    }
    // back wall + underside so it reads as a solid structure from the track
    const H = 0.4 + rows * rise;
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, H + 2, 0.4), concrete);
    back.position.set(0, y0 + H / 2, e0 + rows * depth + 0.2);
    g.add(back);
    if (opts.roof) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, rows * depth * 0.6), new THREE.MeshLambertMaterial({ color: '#d8d4cc' }));
      roof.position.set(0, y0 + H + 4, e0 + rows * depth * 0.7);
      g.add(roof);
      for (let i = 0; i <= 6; i++) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.2, 0.3), concrete);
        col.position.set(-len / 2 + (i * len) / 6, y0 + H + 2, e0 + rows * depth);
        g.add(col);
      }
    }
    const sm = t.pos(sMid, W / 2, {});
    g.position.set(sm.x, 0, sm.z);
    g.rotation.y = Math.atan2(-sm.tz, sm.tx);
    this.group.add(g);
    return { g, y0, H, back: e0 + rows * depth };
  }

  _crowdTex(len) {
    const r = rng(11);
    const cc = canvas(512, 32), cx = cc.getContext('2d');
    const shirt = ['#c8102e', '#f5f5f5', '#0033a0', '#ffd100', '#222', '#ff6a13', '#2e7d32', '#999', '#6a1b9a', '#f2cf7e'];
    for (let i = 0; i < 150; i++) {
      if (r() < 0.3) continue;
      const x = i * 3.4 + r() * 1.5;
      cx.fillStyle = shirt[Math.floor(r() * shirt.length)];
      cx.fillRect(x, 13 + r() * 4, 2.4, 14);
      cx.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][Math.floor(r() * 4)];
      cx.fillRect(x + 0.3, 7 + r() * 4, 1.8, 6);
    }
    const crowd = new THREE.CanvasTexture(cc);
    crowd.colorSpace = THREE.SRGBColorSpace;
    crowd.wrapS = THREE.RepeatWrapping; crowd.repeat.set(len / 12, 1);
    return crowd;
  }

  // Eldora: huge grandstands down the front stretch and the backstretch, the
  // press box on top of the front stands, and the tower out of turn 4
  _buildStandsWalled() {
    const t = this.track, S = t.def.straight;
    const front = this._grandstand(0, S * 0.95, 34, 2.2, { rise: 0.52, depth: 0.82, roof: false });
    const pb = new THREE.Mesh(new THREE.BoxGeometry(60, 5, 7), new THREE.MeshLambertMaterial({ color: '#e7e3da' }));
    pb.position.set(0, front.y0 + front.H + 2.5, front.back - 3.5);
    front.g.add(pb);
    this.windowMat = new THREE.MeshBasicMaterial({ color: '#ffe7a6' });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(56, 2.6), this.windowMat);
    glass.position.set(0, front.y0 + front.H + 2.7, front.back - 7.02);
    glass.rotation.y = Math.PI;
    front.g.add(glass);
    // turn 3: grandstand sections following the curve, the tower behind them
    const zs = t.turnZones;
    const t3a = zs[5].s0 + 4, t3b = (zs[6].s0 + zs[6].s1) / 2;
    let back = 0;
    for (let sm = t3a + 11; sm < t3b; sm += 22) back = this._grandstand(sm, 22, 22, 2.2, { rise: 0.5, depth: 0.82, seat: '#2f4f8f' }).back;
    const s3 = zs[5].s1, p = t.pos(s3, t.W / 2 + back + 8, {});
    const tower = new THREE.Group();
    const tb = new THREE.Mesh(new THREE.BoxGeometry(12, 24, 12), new THREE.MeshLambertMaterial({ color: '#d9d5cc' }));
    tb.position.y = 12; tower.add(tb);
    const tg = new THREE.Mesh(new THREE.BoxGeometry(12.2, 3, 12.2), new THREE.MeshLambertMaterial({ color: '#2c7a4b' }));
    tg.position.y = 21; tower.add(tg);
    tower.position.set(p.x, t.outsideY(s3, back + 8) - 1, p.z);
    this.group.add(tower);
    // turn 4: hillside seating, people on the grass bank, running on toward the
    // front-stretch grandstand
    this._hillside(t3b, zs[8].s0 + (zs[8].s1 - zs[8].s0) * 0.15);
  }

  // a grass bank rising away from the wall with fans sitting on it
  _hillside(s0, s1) {
    const t = this.track, W = t.W;
    const es = [0.6, 3, 7, 12, 18, 25, 33, 42];
    const rise = 0.38;
    const yOf = (s, e) => t.height(s, W / 2 + 0.3) + 1.3 + Math.max(0, e - 0.6) * rise;
    const n = Math.max(4, Math.round(((s1 - s0) / t.L) * this.NS));
    const pos = [], idx = [], p = {};
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      for (const e of es) { t.pos(s, W / 2 + e, p); pos.push(p.x, yOf(s, e), p.z); }
      if (i < n) for (let j = 0; j < es.length - 1; j++) { const a = i * es.length + j, b = a + es.length; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    this.group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#4a7a32', side: THREE.DoubleSide })));
    // rows of fans sitting on the bank (lawn chairs and blankets)
    const crowd = this._crowdTex(30);
    crowd.repeat.set(1, 1);
    const mat = new THREE.MeshLambertMaterial({ map: crowd, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide });
    for (const e of [5, 9, 14, 19, 24, 30]) {
      const cpos = [], cuv = [], cidx = [];
      for (let i = 0; i <= n; i++) {
        const s = s0 + ((s1 - s0) * i) / n;
        t.pos(s, W / 2 + e, p);
        const y = yOf(s, e);
        cpos.push(p.x, y - 0.05, p.z, p.x, y + 0.7, p.z);
        const u = (s - s0) / 12 + e * 0.37;
        cuv.push(u, 0, u, 1);
        if (i < n) { const a = i * 2; cidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
      cg.setIndex(cidx);
      this.group.add(new THREE.Mesh(cg, mat));
    }
  }

  _buildStands() {
    if (this.walled) return this._buildStandsWalled();
    const t = this.track, W = t.W;
    const g = new THREE.Group();
    const sm = t.sample(0, {});
    const len = 96, rows = 13, e0 = 5.5;
    const r = rng(11);
    const cc = canvas(512, 32), cx = cc.getContext('2d');
    const shirt = ['#c8102e', '#f5f5f5', '#0033a0', '#ffd100', '#222', '#ff6a13', '#2e7d32', '#999', '#6a1b9a', '#f2cf7e'];
    for (let i = 0; i < 150; i++) {
      if (r() < 0.3) continue;
      const x = i * 3.4 + r() * 1.5;
      cx.fillStyle = shirt[Math.floor(r() * shirt.length)];
      cx.fillRect(x, 13 + r() * 4, 2.4, 14);
      cx.fillStyle = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][Math.floor(r() * 4)];
      cx.fillRect(x + 0.3, 7 + r() * 4, 1.8, 6);
    }
    const crowd = new THREE.CanvasTexture(cc);
    crowd.colorSpace = THREE.SRGBColorSpace;
    crowd.wrapS = THREE.RepeatWrapping; crowd.repeat.set(len / 12, 1);
    const wood = new THREE.MeshLambertMaterial({ color: '#b8a588' });
    const concrete = new THREE.MeshLambertMaterial({ color: '#8f8a80' });
    const crowdMat = new THREE.MeshLambertMaterial({ map: crowd, transparent: true, alphaTest: 0.2 });
    const y0 = t.outsideY(0, e0);
    for (let i = 0; i < rows; i++) {
      const e = e0 + i * 0.95, y = y0 + 0.35 + i * 0.42;
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.42 + i * 0.42, 0.95), concrete);
      step.position.set(sm.x, y - 0.21 - i * 0.21, sm.z + W / 2 + e + 0.47);
      g.add(step);
      const bench = new THREE.Mesh(new THREE.BoxGeometry(len - 6, 0.06, 0.32), wood);
      bench.position.set(sm.x, y + 0.42, sm.z + W / 2 + e + 0.55);
      g.add(bench);
      const people = new THREE.Mesh(new THREE.PlaneGeometry(len - 8, 0.75), crowdMat);
      people.position.set(sm.x, y + 0.75, sm.z + W / 2 + e + 0.62);
      people.rotation.y = Math.PI;
      g.add(people);
    }
    // the big white two-story building behind the stands
    const bz = sm.z + W / 2 + e0 + rows * 0.95 + 7;
    const by = y0 + rows * 0.42 - 1;
    const bld = new THREE.Mesh(new THREE.BoxGeometry(46, 7.5, 11), new THREE.MeshLambertMaterial({ color: '#e9e6df' }));
    bld.position.set(sm.x - 10, by + 3.75, bz);
    g.add(bld);
    const roofG = new THREE.CylinderGeometry(0.01, 6.6, 46.5, 4, 1);
    roofG.rotateZ(Math.PI / 2); roofG.rotateX(Math.PI / 4);
    const roof = new THREE.Mesh(roofG, new THREE.MeshLambertMaterial({ color: '#cfcac0' }));
    roof.scale.set(1, 0.45, 1.2);
    roof.position.set(sm.x - 10, by + 7.5 + 1.3, bz);
    g.add(roof);
    this.windowMat = new THREE.MeshBasicMaterial({ color: '#ffe7a6' });
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 9; i++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.6), this.windowMat);
        win.position.set(sm.x - 30 + i * 5, by + 2 + row * 3.2, bz - 5.51);
        win.rotation.y = Math.PI;
        g.add(win);
      }
    }
    this.group.add(g);
  }

  // ---------------- light poles ----------------
  _buildLights() {
    const t = this.track, W = t.W;
    const poles = [], p = {};
    const spots = this.walled
      ? t.turnZones.filter((z) => z.kind !== 's').flatMap((z) => [z.s0 + (z.s1 - z.s0) * 0.3, z.s0 + (z.s1 - z.s0) * 0.8])
      : [20, 75, 130, 185, 230, 270, 330, 390, 440, 485];
    for (const s of spots) {
      const k = t.zones(s).kind;
      const e = this.walled ? 8 : k === 'front' ? 3.5 : k === 'back' ? 10.5 : 7;
      t.pos(s, W / 2 + e, p);
      poles.push([p.x, p.z, t.height(s, W / 2 + e)]);
    }
    for (const s of [t.L * 0.12, t.L * 0.38, t.L * 0.62, t.L * 0.88]) {
      t.pos(s, -W / 2 - (this.walled ? 22 : 16), p);
      poles.push([p.x, p.z, -0.13]);
    }
    const poleGeo = new THREE.CylinderGeometry(0.17, 0.26, 24, 6);
    poleGeo.translate(0, 12, 0);
    const pm = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#6b5a45' }), poles.length);
    const hm = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 1.6, 0.4), new THREE.MeshBasicMaterial({ color: '#fff6dc' }), poles.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
    const gc = canvas(64, 64), gx = gc.getContext('2d');
    const gr = gx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,248,220,1)'); gr.addColorStop(0.3, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
    const glowMat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.headMat = hm.material;
    poles.forEach(([x, z, y0], i) => {
      m4.makeTranslation(x, y0, z); pm.setMatrixAt(i, m4);
      eu.set(0.35, Math.atan2(-x, -z), 0); q.setFromEuler(eu);
      m4.compose(new THREE.Vector3(x, y0 + 24.5, z), q, sc); hm.setMatrixAt(i, m4);
      const sp = new THREE.Sprite(glowMat);
      sp.position.set(x, y0 + 24.5, z); sp.scale.set(14, 14, 1);
      this.group.add(sp);
      this.nightOnly.push(sp);
    });
    this.group.add(pm, hm);
  }

  // ---------------- pits: haulers beyond the turn 3-4 runoff ----------------
  _buildPits() {
    if (this.walled) return this._buildInfieldPits();
    const t = this.track, W = t.W;
    const r = rng(21);
    const cols = ['#e8e8e8', '#1c1c1c', '#8a1a1a', '#1a3d8a', '#d0d0d0', '#444', '#f0f0f0', '#2c5530'];
    const n = 30;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), p = {};
    // Lincoln: beyond the turn 3-4 runoff. Eldora: behind the wall out of turn 2.
    const zs = t.turnZones;
    const sStart = this.walled ? zs[2].s0 : 312, step = this.walled ? (zs[3].s1 - zs[2].s0) / 15 : 8.6;
    for (let i = 0; i < n; i++) {
      const s = sStart + (i % 15) * step;
      const e = (this.walled ? 26 : 32) + Math.floor(i / 15) * 14 + r() * 3;
      t.pos(s, W / 2 + e, p);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(p.tz, p.tx) + Math.PI / 2 + (r() - 0.5) * 0.25);
      m4.compose(new THREE.Vector3(p.x, t.height(s, W / 2 + e) + 1.9, p.z), q, new THREE.Vector3(2.5, 3.8, 8 + r() * 6));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.set(cols[Math.floor(r() * cols.length)]));
    }
    this.group.add(im);
  }

  // ---------------- tree line (Indiana hardwoods) ----------------
  _buildTrees() {
    const n = this.quality === 'low' ? 160 : 340;
    const geo = new THREE.IcosahedronGeometry(5, 1);
    geo.scale(1, 0.85, 1);
    geo.translate(0, 9, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 6, 5);
    trunkGeo.translate(0, 3, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), n);
    const tr = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#3d2c1e' }), n);
    const r = rng(5), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const rad = (190 + r() * 110 + (r() < 0.3 ? 60 : 0)) * Math.max(1, Math.sqrt(this.track.L / 503));
      const sc = 0.9 + r() * 1.1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6);
      m4.compose(new THREE.Vector3(Math.cos(a) * rad * 1.15, -2.55, Math.sin(a) * rad), q, new THREE.Vector3(sc * (1 + r() * 0.5), sc * (0.9 + r() * 0.5), sc * (1 + r() * 0.5)));
      im.setMatrixAt(i, m4); tr.setMatrixAt(i, m4);
      im.setColorAt(i, c.setHSL(0.24 + r() * 0.08, 0.45, 0.2 + r() * 0.1));
    }
    this.group.add(im, tr);
  }

  // big white tires lying on the inside edge of the turns (turn markers)
  _buildTireMarkers() {
    if (this.walled) return; // Eldora has the inside wall instead
    const t = this.track, W = t.W;
    const geo = new THREE.TorusGeometry(0.62, 0.3, 10, 18);
    const mat = new THREE.MeshLambertMaterial({ color: '#e8e6df' });
    const zs = t.turnZones;
    const spots = [];
    for (const zi of [2, 6]) {
      const a0 = zs[zi].s0, a1 = zs[zi].s1;
      spots.push(a0 + (a1 - a0) * 0.3, a0 + (a1 - a0) * 0.72);
    }
    const p = {};
    for (const s of spots) {
      t.pos(s, -W / 2 - 1.0, p);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, t.height(s, -W / 2 - 1.0) + 0.42, p.z);
      m.rotation.y = -Math.atan2(p.tz, p.tx) + Math.PI / 2;
      m.rotation.x = 0.25;
      this.group.add(m);
    }
  }

  _buildFlagstand() {
    const t = this.track, W = t.W;
    // the flagman's stand sits on the outside of the front stretch, just past the wall
    const p = t.pos(-4, W / 2 + 1.1, {});
    const h0 = t.height(0, W / 2 + 1.1);
    const g = new THREE.Group();
    const leg = new THREE.MeshLambertMaterial({ color: '#777' });
    for (const [dx, dz] of [[-1, -0.7], [1, -0.7], [-1, 0.7], [1, 0.7]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 5), leg);
      l.position.set(dx, 2.25, dz); g.add(l);
    }
    const plat = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 1.8), new THREE.MeshLambertMaterial({ color: '#d8d2c4' }));
    plat.position.y = 4.5; g.add(plat);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.1, 0.08), new THREE.MeshLambertMaterial({ color: '#efe9da' }));
    sign.position.set(0, 3.85, -0.9); g.add(sign);
    const flagman = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.3), new THREE.MeshLambertMaterial({ color: '#b71c1c' }));
    flagman.position.set(0, 5.2, 0); g.add(flagman);
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: '#00c853', side: THREE.DoubleSide }));
    this.flag.position.set(-0.6, 6.0, -0.9); g.add(this.flag);
    g.position.set(p.x, h0, p.z);
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
      m.color.set(kind === 'yellow' ? '#ffd600' : kind === 'red' ? '#d50000' : '#00c853');
    }
    this.flag.visible = kind !== 'none';
    m.needsUpdate = true;
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(1400, 24, 12);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
    this.skyGeo = geo;
    this.group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    const r = rng(9), sp = [];
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2, e = 0.15 + r() * 1.3;
      sp.push(Math.cos(a) * Math.cos(e) * 1300, Math.sin(e) * 1300, Math.sin(a) * Math.cos(e) * 1300);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#cfd8ff', size: 2, sizeAttenuation: false, fog: false }));
    this.group.add(stars);
    this.nightOnly.push(stars);
    const cc = canvas(128, 64), cx = cc.getContext('2d');
    const gr = cx.createRadialGradient(64, 32, 4, 64, 32, 60);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr; cx.fillRect(0, 0, 128, 64);
    const cm = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cc), fog: false, depthWrite: false, transparent: true });
    this.clouds = [];
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Sprite(cm);
      const a = r() * Math.PI * 2, el = 0.12 + r() * 0.45;
      s.position.set(Math.cos(a) * Math.cos(el) * 1000, Math.sin(el) * 1000, Math.sin(a) * Math.cos(el) * 1000);
      s.scale.set(220 + r() * 200, 70 + r() * 50, 1);
      this.group.add(s);
      this.clouds.push(s);
    }
    this.setTime('night');
  }

  setTime(mode) {
    const day = mode === 'day';
    const top = new THREE.Color(day ? '#1f6fd6' : '#04060f'), hor = new THREE.Color(day ? '#bcd9f5' : '#1b2340'), c = new THREE.Color();
    const p = this.skyGeo.attributes.position, col = this.skyGeo.attributes.color;
    for (let i = 0; i < p.count; i++) {
      const y = Math.max(0, p.getY(i) / 1400);
      c.copy(hor).lerp(top, Math.pow(y, 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.nightOnly.forEach((o) => (o.visible = !day));
    if (this.clouds) this.clouds.forEach((o) => (o.visible = day));
    if (this.windowMat) this.windowMat.color.set(day ? '#6f7d88' : '#ffe7a6');
    if (this.headMat) this.headMat.color.set(day ? '#cfcfcf' : '#fff6dc');
  }
}
