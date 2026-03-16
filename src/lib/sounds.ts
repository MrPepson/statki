// Singleton kontekstu audio – jeden na całą aplikację
let _ctx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!_ctx) _ctx = new AudioContext();
  // Przeglądarka może zawiesić kontekst po bezczynności
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

/**
 * Syntetyczny dźwięk "pudło" – krótki plusk wody.
 * Składa się z:
 *  - oscylatora opadającego z 220 Hz → 55 Hz (głuche uderzenie)
 *  - szumu pasmowego 900 Hz (bryzg wody)
 */
export function playSplash(): void {
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Komponent 1: głuchy plusk (opadający ton)
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.55, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  osc.connect(oscGain);
  oscGain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.22);

  // Komponent 2: szum bryzgu wody
  const SR = ctx.sampleRate;
  const buf = ctx.createBuffer(1, Math.floor(SR * 0.28), SR);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 900;
  bpf.Q.value = 0.7;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.28, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  noise.connect(bpf);
  bpf.connect(noiseGain);
  noiseGain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.28);
}
