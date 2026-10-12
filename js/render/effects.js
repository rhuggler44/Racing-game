// Dirt roost + dust particles (single draw call).
import * as THREE from 'three';

export class Dust {
  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.kind = new Uint8Array(max); // 0 dust, 1 clod
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('kind', new THREE.BufferAttribute(this.kind, 1));
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float size; attribute float alpha; attribute float kind;
        varying float vA; varying float vK;
        uniform float scale;
        void main() {
          vA = alpha; vK = kind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA; varying float vK;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float r = length(c);
          if (r > 0.5) discard;
          float a = vK > 0.5 ? step(r, 0.45) : (1.0 - r * 2.0);
          vec3 col = vK > 0.5 ? vec3(0.22, 0.14, 0.09) : vec3(0.55, 0.45, 0.36);
          gl_FragColor = vec4(col, a * vA);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.mat = mat;
  }

  setViewport(h) { this.mat.uniforms.scale.value = h * 0.9; }

  emit(x, y, z, vx, vy, vz, size, life, kind = 0) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.kind[i] = kind;
  }

  // emit from a car's rear wheels. fx,fz forward unit; rx,rz right unit
  roost(x, y, z, fx, fz, rx, rz, speed, slide, spin, mul = 1) {
    const rate = (speed * 0.12 + slide * 6 + spin * 4) * mul;
    let n = Math.floor(rate * 0.25 + Math.random());
    n = Math.min(n, 4);
    for (let k = 0; k < n; k++) {
      const side = Math.random() < 0.6 ? -1 : 1; // right rear throws more
      const ox = x - fx * 1.3 + rx * 0.8 * side * -1, oz = z - fz * 1.3 + rz * 0.8 * side * -1;
      const back = speed * 0.25 + 4;
      const out = 2 + slide * 8;
      const vx = -fx * back + rx * out * (Math.random() + 0.2) + (Math.random() - 0.5) * 2;
      const vz = -fz * back + rz * out * (Math.random() + 0.2) + (Math.random() - 0.5) * 2;
      if (Math.random() < 0.35 * Math.min(1, spin + slide)) {
        this.emit(ox, y + 0.3, oz, vx * 1.6, 3 + Math.random() * 4, vz * 1.6, 0.12 + Math.random() * 0.1, 0.9, 1);
      } else {
        this.emit(ox, y + 0.3, oz, vx * 0.6, 0.6 + Math.random() * 1.2, vz * 0.6, 0.9 + Math.random() * 1.2, 1.6 + Math.random() * 1.4, 0);
      }
    }
  }

  update(dt) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      if (this.kind[i] === 1) {
        v[i * 3 + 1] -= 9.8 * dt;
        if (p[i * 3 + 1] < 0.05) { v[i * 3] *= 0.5; v[i * 3 + 2] *= 0.5; v[i * 3 + 1] = 0; }
        this.alpha[i] = 1;
      } else {
        v[i * 3] *= 1 - dt * 1.5; v[i * 3 + 2] *= 1 - dt * 1.5; v[i * 3 + 1] *= 1 - dt * 0.8;
        this.size[i] += dt * 2.2;
        this.alpha[i] = 0.32 * (1 - t) * Math.min(1, t * 8);
      }
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.kind.needsUpdate = true;
  }
}
