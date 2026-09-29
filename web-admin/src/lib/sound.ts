/**
 * Звуки сканера. Синтезируются Web Audio — без файлов и сети.
 *
 * Каждая нота: мягкая атака (без щелчка), экспоненциальное затухание и тихий
 * обертон октавой выше — звучит как колокольчик, а не как писк.
 * Один AudioContext на всё приложение: без задержки на создание при каждом скане.
 */
export type ScanSound = "ok" | "repeat" | "error";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = 0.5;
      // Лёгкий компрессор сглаживает пики, когда ноты накладываются.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

interface Note {
  freq: number;
  /** Сдвиг начала, сек. */
  at: number;
  /** Длина затухания, сек. */
  len: number;
  vol: number;
  type?: OscillatorType;
  /** Громкость обертона (октава выше) относительно основной ноты. */
  shimmer?: number;
}

function play(notes: Note[]) {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime + 0.01;
  for (const n of notes) {
    const voices: [number, number, OscillatorType][] = [[n.freq, 1, n.type ?? "sine"]];
    if (n.shimmer) voices.push([n.freq * 2, n.shimmer, "sine"]);
    for (const [f, rel, type] of voices) {
      const o = a.ctx.createOscillator();
      const g = a.ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      const t = t0 + n.at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(n.vol * rel, t + 0.008); // атака 8 мс — без щелчка
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.len); // плавное затухание
      o.connect(g).connect(a.out);
      o.start(t);
      o.stop(t + n.len + 0.05);
    }
  }
}

const SOUNDS: Record<ScanSound, Note[]> = {
  // Принят: восходящая большая терция E6 → G#6, «динь-дилинь».
  ok: [
    { freq: 1318.5, at: 0, len: 0.22, vol: 0.32, shimmer: 0.18 },
    { freq: 1661.2, at: 0.085, len: 0.38, vol: 0.3, shimmer: 0.15 },
  ],
  // Уже на складе / уже выдан: один мягкий нейтральный «тук».
  repeat: [{ freq: 880, at: 0, len: 0.2, vol: 0.26, type: "triangle", shimmer: 0.06 }],
  // Не найден / ошибка: нисходящий двухтон A4 → E4, заметный, но не резкий.
  error: [
    { freq: 440, at: 0, len: 0.2, vol: 0.34, type: "triangle", shimmer: 0.08 },
    { freq: 329.6, at: 0.15, len: 0.32, vol: 0.34, type: "triangle", shimmer: 0.08 },
  ],
};

export function scanSound(kind: ScanSound) {
  play(SOUNDS[kind]);
}
