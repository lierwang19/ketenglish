'use strict';

let audioContext = null;
let unlockBound = false;

export function playFeedbackTone(type) {
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime + 0.01;
  const master = ctx.createGain();
  master.connect(ctx.destination);

  if (type === 'success') {
    playTone(ctx, master, { start: now, duration: 0.08, freq: 660, gain: 0.05, waveform: 'sine' });
    playTone(ctx, master, { start: now + 0.09, duration: 0.12, freq: 880, gain: 0.06, waveform: 'sine' });
    return;
  }

  playTone(ctx, master, { start: now, duration: 0.11, freq: 280, gain: 0.055, waveform: 'sawtooth' });
  playTone(ctx, master, { start: now + 0.1, duration: 0.12, freq: 210, gain: 0.045, waveform: 'triangle' });
}

function ensureAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === 'suspended') {
    bindUnlock();
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function bindUnlock() {
  if (unlockBound) return;

  const unlock = () => {
    audioContext?.resume().catch(() => {});
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    unlockBound = false;
  };

  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  unlockBound = true;
}

function playTone(ctx, master, { start, duration, freq, gain, waveform }) {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();

  osc.type = waveform;
  osc.frequency.setValueAtTime(freq, start);

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(amp);
  amp.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}
