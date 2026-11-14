// 全部声音都用 WebAudio 现场合成，不需要任何音频文件。
const AC = window.AudioContext || window.webkitAudioContext;
let ac = null, master = null, sfxGain = null, musicGain = null, noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('gw_mute') === '1'; } catch (e) { /* ignore */ }

let silentEl = null, analyser = null;
const VOL = 1.8;

// 一小段无声的 WAV。循环播放它，iPhone / iPad 就会把网页当成“正在播放媒体”，
// 这样即使侧边的静音开关打开，WebAudio 的声音也能出来。
function silentWavUrl() {
  const n = 8000, b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  str(36, 'data'); dv.setUint32(40, n, true); b.fill(128, 44);
  return URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
}

// 必须在用户手指点击 / 触摸的事件里调用，浏览器才允许出声。可以重复调用。
export function initAudio() {
  if (!AC) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
  try {
    if (!silentEl) {
      silentEl = new Audio(silentWavUrl());
      silentEl.loop = true; silentEl.preload = 'auto';
      silentEl.setAttribute('playsinline', ''); silentEl.setAttribute('webkit-playsinline', '');
    }
    if (silentEl.paused) { const pr = silentEl.play(); if (pr && pr.catch) pr.catch(() => {}); }
  } catch (e) { /* ignore */ }
  if (!ac) {
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : VOL;
    // 压限器：把整体音量提上去，又不会在爆炸很多的时候破音
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ac.destination);
    analyser = ac.createAnalyser(); analyser.fftSize = 256; master.connect(analyser);
    sfxGain = ac.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
    musicGain = ac.createGain(); musicGain.gain.value = 0.32; musicGain.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state !== 'running') { const pr = ac.resume(); if (pr && pr.catch) pr.catch(() => {}); }
  // 在手势里播一个极短的空白声音，老版本 iOS 靠这个解锁
  try { const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, 22050); s.connect(ac.destination); s.start(0); } catch (e) { /* ignore */ }
}

export function audioDebug() {
  if (!ac) return { state: 'none', peak: 0 };
  const d = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(d);
  let peak = 0; for (const v of d) peak = Math.max(peak, Math.abs(v - 128));
  return { state: ac.state, peak, muted };
}

export function isMuted() { return muted; }
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('gw_mute', m ? '1' : '0'); } catch (e) { /* ignore */ }
  if (master) master.gain.value = m ? 0 : VOL;
}
export function suspendAudio(on) {
  if (!ac) return;
  if (on) { ac.suspend(); if (silentEl) silentEl.pause(); } else initAudio();
}

function tone(type, f0, f1, dur, vol, delay = 0, dest = sfxGain) {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, vol, f0, f1, delay = 0, dest = sfxGain, type = 'lowpass') {
  if (!ac) return;
  const t = ac.currentTime + delay;
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ac.createBiquadFilter(); f.type = type;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

let lastShot = 0;
export const sfx = {
  shoot() {
    if (!ac || ac.currentTime - lastShot < 0.09) return;
    lastShot = ac.currentTime;
    tone('square', 1100 + Math.random() * 200, 280, 0.07, 0.035);
  },
  hit() { tone('triangle', 520, 260, 0.05, 0.08); },
  boom(scale = 1) {
    noise(0.35 + 0.3 * scale, Math.min(0.75, 0.3 + 0.2 * scale), 2400, 90);
    tone('sine', 190 / Math.sqrt(scale), 36, 0.3 + 0.2 * scale, Math.min(0.8, 0.35 + 0.2 * scale));
  },
  pickup() { [660, 880, 1320].forEach((f, i) => tone('square', f, f, 0.09, 0.07, i * 0.06)); },
  power() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone('sawtooth', f, f * 1.01, 0.12, 0.07, i * 0.05)); },
  hurt() { tone('sawtooth', 320, 50, 0.45, 0.3); noise(0.3, 0.3, 1200, 200); },
  shield() { tone('sine', 300, 1200, 0.25, 0.15); },
  bomb() {
    tone('sine', 900, 30, 1.1, 0.7);
    noise(1.3, 0.8, 5000, 60);
    tone('sawtooth', 60, 30, 1.0, 0.4, 0.05);
  },
  warn() { for (let i = 0; i < 4; i++) { tone('sawtooth', 440, 660, 0.22, 0.13, i * 0.45); tone('sawtooth', 660, 440, 0.22, 0.13, i * 0.45 + 0.22); } },
  wave() { [392, 523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.16, 0.13, i * 0.09)); },
  charge() { tone('sawtooth', 200, 900, 0.6, 0.08); },
  over() { [523, 466, 392, 311, 262].forEach((f, i) => tone('triangle', f, f * 0.98, 0.3, 0.16, i * 0.22)); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('square', f, f, 0.16, 0.09, i * 0.11)); },
};

// ---------- 背景音乐：一个小小的步进音序器 ----------
const ROOTS = [57, 57, 53, 53, 60, 60, 55, 55]; // A小调：Am F C G
const ARP = [0, 7, 12, 15, 12, 7, 19, 12, 0, 7, 12, 15, 24, 19, 15, 12];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let playing = false, nextT = 0, step = 0, timer = null, intense = false;

function schedule() {
  if (!ac || !playing) return;
  const bpm = intense ? 150 : 128, sl = 60 / bpm / 4;
  while (nextT < ac.currentTime + 0.12) {
    const d = Math.max(0, nextT - ac.currentTime);
    const s = step % 16, bar = Math.floor(step / 16) % ROOTS.length;
    const root = ROOTS[bar] + (intense ? 2 : 0);
    if (s % 4 === 0) { tone('sine', 150, 40, 0.16, 0.9, d, musicGain); }
    if (s % 4 === 2) { noise(0.04, 0.22, 9000, 7000, d, musicGain, 'highpass'); }
    if (s % 8 === 4) { noise(0.12, 0.35, 3000, 900, d, musicGain, 'bandpass'); }
    if (s % 2 === 0) { tone('sawtooth', mtof(root - 24), mtof(root - 24), sl * 1.7, 0.3, d, musicGain); }
    const n = root + ARP[s] + (bar % 2 ? 0 : 0);
    tone('square', mtof(n), mtof(n), sl * 0.9, 0.07, d, musicGain);
    if (s === 0) { tone('triangle', mtof(root + 12), mtof(root + 12), sl * 14, 0.1, d, musicGain); tone('triangle', mtof(root + 19), mtof(root + 19), sl * 14, 0.07, d, musicGain); }
    nextT += sl; step++;
  }
}

export function startMusic() {
  if (!ac || playing) return;
  playing = true; nextT = ac.currentTime + 0.05; step = 0;
  timer = setInterval(schedule, 30);
}
export function stopMusic() { playing = false; if (timer) clearInterval(timer); timer = null; }
export function setIntense(v) { intense = v; }
