// Controls: tilt-to-steer (iPhone permission flow), touch pedals, touch
// steering fallback, keyboard for desktop testing.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Input {
  constructor(settings) {
    this.settings = settings;
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.tiltRaw = 0; this.tiltCenter = 0; this.tiltOK = false; this.tiltSeen = false;
    this.keys = new Set();
    this.gasTouch = null; this.brakeTouch = null; this.steerTouch = null;
    this._onOrient = (e) => this._orient(e);
    window.addEventListener('keydown', (e) => { this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });
  }

  // must be called from a user tap on iOS
  async enableTilt() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') return false;
      }
      if (!DOE) return false;
      window.addEventListener('deviceorientation', this._onOrient);
      this.tiltOK = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  _screenAngle() {
    if (typeof window.orientation === 'number') return window.orientation;
    return (screen.orientation && screen.orientation.angle) || 0;
  }

  _orient(e) {
    if (e.beta == null || e.gamma == null) return;
    this.tiltSeen = true;
    const b = (e.beta * Math.PI) / 180, g = (e.gamma * Math.PI) / 180;
    // gravity in device coords
    const gx = Math.cos(b) * Math.sin(g), gy = -Math.sin(b);
    let right, up;
    const a = this._screenAngle();
    if (a === 90) { right = -gy; up = gx; }
    else if (a === -90 || a === 270) { right = gy; up = -gx; }
    else if (a === 180) { right = -gx; up = -gy; }
    else { right = gx; up = gy; }
    // angle of gravity from "screen down"; turning the phone like a wheel
    this.tiltRaw = Math.atan2(right, -up) * 180 / Math.PI;
  }

  recenter() { this.tiltCenter = this.tiltRaw; }

  // Gas and brake are sliders: thumb at the bottom of the bar = 0%, top = 100%,
  // slide up and down to feather, lift off = 0. ("Button" mode = full on/off.)
  bindPedals(gasEl, brakeEl, steerEl) {
    const opts = { passive: false };
    const level = (el, t) => {
      if (this.settings.pedals === 'button') return 1;
      const r = el.getBoundingClientRect();
      const f = 1 - (t.clientY - r.top) / r.height;      // 0 at the bottom, 1 at the top
      return clamp((f - 0.06) / 0.86, 0, 1);             // small dead zones at both ends
    };
    const press = (el, key) => (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      this[key] = { id: t.identifier, v: level(el, t), el };
    };
    gasEl.addEventListener('touchstart', press(gasEl, 'gasTouch'), opts);
    brakeEl.addEventListener('touchstart', press(brakeEl, 'brakeTouch'), opts);
    if (steerEl) {
      steerEl.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        this.steerTouch = { id: t.identifier, x0: t.clientX, x: t.clientX };
      }, opts);
    }
    const move = (e) => {
      for (const t of e.changedTouches) {
        for (const key of ['gasTouch', 'brakeTouch']) {
          const p = this[key];
          if (p && t.identifier === p.id) p.v = level(p.el, t);
        }
        if (this.steerTouch && t.identifier === this.steerTouch.id) this.steerTouch.x = t.clientX;
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (this.gasTouch && t.identifier === this.gasTouch.id) this.gasTouch = null;
        if (this.brakeTouch && t.identifier === this.brakeTouch.id) this.brakeTouch = null;
        if (this.steerTouch && t.identifier === this.steerTouch.id) this.steerTouch = null;
      }
    };
    window.addEventListener('touchmove', move, opts);
    window.addEventListener('touchend', end, opts);
    window.addEventListener('touchcancel', end, opts);
    // mouse for desktop testing (drag works like a thumb)
    const mdown = (el, key) => (e) => { this[key] = { id: 'm', v: level(el, e), el }; };
    gasEl.addEventListener('mousedown', mdown(gasEl, 'gasTouch'));
    brakeEl.addEventListener('mousedown', mdown(brakeEl, 'brakeTouch'));
    window.addEventListener('mousemove', (e) => {
      for (const key of ['gasTouch', 'brakeTouch']) { const p = this[key]; if (p && p.id === 'm') p.v = level(p.el, e); }
    });
    window.addEventListener('mouseup', () => {
      if (this.gasTouch && this.gasTouch.id === 'm') this.gasTouch = null;
      if (this.brakeTouch && this.brakeTouch.id === 'm') this.brakeTouch = null;
    });
  }

  update(dt) {
    const k = this.keys, s = this.settings;
    let steerT = 0, thr = 0, brk = 0;
    const kbSteer = (k.has('arrowleft') || k.has('a') ? -1 : 0) + (k.has('arrowright') || k.has('d') ? 1 : 0);
    const kbGas = k.has('arrowup') || k.has('w');
    const kbBrake = k.has('arrowdown') || k.has('s') || k.has(' ');

    if (s.controls === 'tilt' && this.tiltOK && this.tiltSeen) {
      let ang = this.tiltRaw - this.tiltCenter;
      if (ang > 180) ang -= 360; else if (ang < -180) ang += 360;
      if (s.invert) ang = -ang;
      const dz = 1.5;
      ang = Math.abs(ang) < dz ? 0 : ang - Math.sign(ang) * dz;
      steerT = clamp(ang / s.tiltRange, -1, 1);
      // a little expo for fine control around center
      steerT = Math.sign(steerT) * (0.35 * Math.abs(steerT) + 0.65 * steerT * steerT);
    } else if (this.steerTouch) {
      steerT = clamp((this.steerTouch.x - this.steerTouch.x0) / 90, -1, 1);
    }
    if (kbSteer) {
      this._kb = clamp((this._kb || 0) + kbSteer * dt * 3, -1, 1);
      steerT = this._kb;
    } else if (this._kb) {
      this._kb *= Math.max(0, 1 - dt * 8);
      if (Math.abs(this._kb) < 0.02) this._kb = 0;
      steerT = this._kb || steerT;
    }

    thr = this.gasTouch ? this.gasTouch.v : 0;
    if (kbGas) thr = 1;
    brk = this.brakeTouch ? this.brakeTouch.v : 0;
    if (kbBrake) brk = 1;

    this.steer += (steerT - this.steer) * Math.min(1, dt * 18);
    this.throttle += (thr - this.throttle) * Math.min(1, dt * 14);
    this.brake = brk;
    return { steer: this.steer, throttle: this.throttle, brake: this.brake };
  }
}
