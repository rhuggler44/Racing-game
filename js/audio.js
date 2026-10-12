// Synthesized 410 engine + dirt/tire noise + field drone. Web Audio only.
export class Sound {
  constructor() { this.ctx = null; this.vol = 0.8; }

  // call from a user gesture (required on iPhone)
  start() {
    // sound off: never touch the phone's audio, so your music keeps playing
    if (this.vol <= 0) return;
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      // 'ambient' mixes with other apps (Spotify, Apple Music) instead of pausing them
      if (navigator.audioSession) navigator.audioSession.type = 'ambient';
    } catch (e) { /* not supported */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);

    // ---- engine ----
    this.eng = this._engineVoice(0.5);
    this.eng.out.connect(this.master);
    // ---- field (other cars) ----
    this.pack = this._engineVoice(0.0);
    this.pack.out.connect(this.master);

    // ---- noise: dirt / tires / roost ----
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3 + w * 0.3; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.noiseFilter = ctx.createBiquadFilter(); this.noiseFilter.type = 'bandpass'; this.noiseFilter.frequency.value = 500; this.noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    src.connect(this.noiseFilter); this.noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.master);
    src.start();
    this.noiseBuf = buf;
  }

  _engineVoice(gain) {
    const ctx = this.ctx;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 512) - 1; curve[i] = Math.tanh(x * 3.2); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 2.5;
    const out = ctx.createGain(); out.gain.value = gain;
    const mix = ctx.createGain(); mix.gain.value = 0.35;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
    const o3 = ctx.createOscillator(); o3.type = 'square';
    const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
    g1.gain.value = 0.6; g2.gain.value = 0.45; g3.gain.value = 0.35;
    // rough idle: amplitude wobble at crank rate
    const lfo = ctx.createOscillator(); lfo.type = 'sine';
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.15;
    lfo.connect(lfoG); lfoG.connect(mix.gain);
    o1.connect(g1); o2.connect(g2); o3.connect(g3);
    g1.connect(mix); g2.connect(mix); g3.connect(mix);
    mix.connect(shaper); shaper.connect(lp); lp.connect(out);
    [o1, o2, o3, lfo].forEach((o) => o.start());
    return { o1, o2, o3, lfo, lp, out };
  }

  _setVoice(v, rpm, load, gain) {
    const t = this.ctx.currentTime;
    const f = (rpm / 60) * 4; // V8 firing frequency
    v.o1.frequency.setTargetAtTime(f, t, 0.02);
    v.o2.frequency.setTargetAtTime(f * 0.5 * 1.003, t, 0.02);
    v.o3.frequency.setTargetAtTime(f * 0.25, t, 0.02);
    v.lfo.frequency.setTargetAtTime(rpm / 120, t, 0.05);
    v.lp.frequency.setTargetAtTime(500 + load * 2600 + rpm * 0.12, t, 0.03);
    v.out.gain.setTargetAtTime(gain, t, 0.04);
  }

  update({ rpm, throttle, slip, speed, packRpm, packDist, surface, paused }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (paused) { this.master.gain.setTargetAtTime(0, t, 0.05); return; }
    this.master.gain.setTargetAtTime(this.vol, t, 0.1);
    this._setVoice(this.eng, rpm, throttle, 0.22 + throttle * 0.28);
    const pg = packDist < 80 ? 0.22 * Math.max(0, 1 - packDist / 80) : 0;
    this._setVoice(this.pack, packRpm || 6000, 0.7, pg);
    const roar = Math.min(1, speed / 45) * 0.12 + Math.min(1, slip * 2) * 0.2 + (surface === 'marbles' ? 0.1 : 0);
    this.noiseGain.gain.setTargetAtTime(roar, t, 0.05);
    this.noiseFilter.frequency.setTargetAtTime(300 + speed * 18, t, 0.05);
  }

  hit(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1.2, 0.15 + strength * 0.06), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + 0.6);
  }

  beep(freq = 880, dur = 0.15) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = 'square';
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  setVolume(v) {
    this.vol = v;
    if (v <= 0 && this.ctx) {
      // fully release the audio session so iOS hands it back to your music
      this.ctx.close();
      this.ctx = null;
      this.master = null;
    } else if (this.master) {
      this.master.gain.value = v;
    }
  }
  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
}
