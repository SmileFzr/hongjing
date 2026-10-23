/* ============================================================
   audio.js — 背景音乐与音效
   ------------------------------------------------------------
   全部用 Web Audio API 现场合成，不加载任何音频文件。
   好处：零资源、零加载时间、改音色只改几行参数。

   两个关键约束：
     1. 浏览器不允许无交互自动播放，必须等用户第一次点击才 init()
     2. 几十个单位同时开火会糊成一片噪声墙，同类音效要节流（55ms）
   ============================================================ */

window.HJ = window.HJ || {};

HJ.Sfx = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  noise: null,
  ready: false,
  muted: false,
  bgmOn: true,
  bgmTimer: null,
  bgmStep: 0,
  last: {},

  /* ---------------- 初始化 ---------------- */

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.75;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.master);

    this.noise = this.makeNoise();
    this.ready = true;

    if (ctx.state === 'suspended') ctx.resume();
    this.startBGM();
  },

  makeNoise() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  },

  /* ---------------- 合成基元 ---------------- */

  /* 噪声爆发：枪声、爆炸、鼓点都靠它 + 不同的滤波 */
  noiseBurst(gain, freq, q, dur, filterType, bus) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = filterType || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q || 1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(f);
    f.connect(g);
    g.connect(bus || this.sfxBus);

    src.start(t);
    src.stop(t + dur + 0.03);
  },

  /* 单音：可以指定滑音终点 */
  tone(freq, dur, type, gain, bus, slideTo) {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g);
    g.connect(bus || this.sfxBus);

    osc.start(t);
    osc.stop(t + dur + 0.03);
  },

  /* ---------------- 音效 ---------------- */

  play(name) {
    if (!this.ready || this.muted) return;

    /* 同类音效 55ms 内只放一次。不加这个，二十个步枪兵同时开火
       会叠成一堵噪声墙，什么信息都听不出来 */
    const now = Date.now();
    if (this.last[name] && now - this.last[name] < 55) return;
    this.last[name] = now;

    switch (name) {
      case 'rifle':
        this.noiseBurst(0.14, 1900, 2.2, 0.06, 'bandpass');
        this.tone(300, 0.045, 'square', 0.045, null, 130);
        break;

      case 'cannon':
        this.tone(130, 0.26, 'sine', 0.42, null, 40);
        this.noiseBurst(0.24, 420, 0.8, 0.2, 'lowpass');
        break;

      case 'laser':
        this.tone(850, 0.13, 'sawtooth', 0.13, null, 2500);
        break;

      case 'tesla':
        this.noiseBurst(0.16, 3200, 5, 0.1, 'highpass');
        this.tone(190, 0.09, 'square', 0.09);
        break;

      case 'hero':
        this.noiseBurst(0.16, 2800, 3, 0.05, 'highpass');
        break;

      case 'explode':
        this.tone(95, 0.34, 'sine', 0.3, null, 32);
        this.noiseBurst(0.3, 620, 0.6, 0.34, 'lowpass');
        break;

      case 'build':
        this.tone(392, 0.09, 'triangle', 0.16);
        setTimeout(() => this.tone(523, 0.12, 'triangle', 0.16), 85);
        break;

      case 'sell':
        this.tone(523, 0.07, 'triangle', 0.12, null, 330);
        break;

      case 'levelup':
        this.tone(659, 0.09, 'triangle', 0.17);
        setTimeout(() => this.tone(988, 0.15, 'triangle', 0.17), 85);
        break;

      case 'wave':
        this.tone(98, 0.42, 'sawtooth', 0.22);
        setTimeout(() => this.tone(147, 0.5, 'sawtooth', 0.2), 230);
        break;

      case 'alarm':
        this.tone(440, 0.14, 'square', 0.14);
        setTimeout(() => this.tone(330, 0.14, 'square', 0.14), 160);
        break;

      case 'click':
        this.tone(880, 0.035, 'square', 0.08);
        break;

      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => {
          setTimeout(() => this.tone(f, 0.3, 'triangle', 0.2), i * 130);
        });
        break;

      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => {
          setTimeout(() => this.tone(f, 0.36, 'sawtooth', 0.18), i * 180);
        });
        break;

      default:
        break;
    }
  },

  /* 武器 → 音效名。逻辑层只报 warhead，怎么响在这里决定 */
  fire(warhead) {
    switch (warhead) {
      case 'AP':
      case 'HE':
        this.play('cannon');
        break;
      case 'PRISM':
        this.play('laser');
        break;
      case 'TESLA':
        this.play('tesla');
        break;
      case 'HERO':
        this.play('hero');
        break;
      default:
        this.play('rifle');
    }
  },

  /* ---------------- 背景音乐 ---------------- */
  /* 小调进行 Am - F - C - G，低音铺底 + 八分音符军鼓。
     节奏偏慢，因为这是防守战不是冲锋 */

  startBGM() {
    if (!this.ready || this.bgmTimer) return;
    const stepMs = (60 / 92) * 1000 / 2;
    const roots = [110, 87.31, 130.81, 98];

    const tick = () => {
      if (!this.bgmOn || this.muted) {
        this.bgmTimer = setTimeout(tick, stepMs);
        return;
      }

      const bar = Math.floor(this.bgmStep / 8) % 4;
      const beat = this.bgmStep % 8;
      const root = roots[bar];

      if (beat === 0 || beat === 4) {
        this.tone(root, 0.4, 'sawtooth', 0.13, this.musicBus);
        this.tone(root * 2, 0.18, 'triangle', 0.04, this.musicBus);
      }
      if (beat % 2 === 1) {
        this.noiseBurst(0.028, 2400, 1.6, 0.05, 'bandpass', this.musicBus);
      }
      if (beat === 6 && bar % 2 === 0) {
        this.tone(root * 3, 0.28, 'triangle', 0.05, this.musicBus);
      }

      this.bgmStep = (this.bgmStep + 1) % 32;
      this.bgmTimer = setTimeout(tick, stepMs);
    };

    tick();
  },

  toggle() {
    this.muted = !this.muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
    return this.muted;
  },
};
