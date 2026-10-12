/**
 * Звуки сканера. Синтезируются Web Audio — без файлов и сети.
 *
 * Каждая нота: мягкая атака (без щелчка), экспоненциальное затухание и тихий
 * обертон октавой выше — звучит как колокольчик, а не как писк.
 * Один AudioContext на всё приложение: без задержки на создание при каждом скане.
 *
 * У каждого события скана — свой набор из 15 вариантов по смыслу: «принят» — светлые и
 * восходящие, «повтор» — нейтральные короткие, «уже выдан» — заметные, но спокойные,
 * «не найден» — тревожные и низкие. Выбор, громкость и вкл/выкл — в «Настройках»;
 * хранятся в этом браузере (звук нужен на устройстве со сканером, а не у всех сразу).
 */
import { useSyncExternalStore } from "react";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function audio(): { ctx: AudioContext; out: GainNode } | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
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

export interface Note {
  freq: number;
  /** Скольжение высоты к этой частоте (капля, сирена). */
  to?: number;
  /** Сдвиг начала, сек. */
  at: number;
  /** Длина затухания, сек. */
  len: number;
  vol: number;
  type?: OscillatorType;
  /** Громкость обертона (октава выше) относительно основной ноты. */
  shimmer?: number;
}

function play(notes: Note[], volume: number) {
  if (!notes.length || volume <= 0) return;
  const a = audio();
  if (!a) return;
  a.out.gain.value = 0.6 * Math.min(1, volume / 100);
  const t0 = a.ctx.currentTime + 0.01;
  for (const n of notes) {
    const voices: [number, number, OscillatorType][] = [[1, 1, n.type ?? "sine"]];
    if (n.shimmer) voices.push([2, n.shimmer, "sine"]);
    for (const [mult, rel, type] of voices) {
      const o = a.ctx.createOscillator();
      const g = a.ctx.createGain();
      o.type = type;
      const t = t0 + n.at;
      o.frequency.setValueAtTime(n.freq * mult, t);
      if (n.to) o.frequency.exponentialRampToValueAtTime(n.to * mult, t + n.len * 0.7);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(n.vol * rel, t + 0.008); // атака 8 мс — без щелчка
      g.gain.exponentialRampToValueAtTime(0.0001, t + n.len); // плавное затухание
      o.connect(g).connect(a.out);
      o.start(t);
      o.stop(t + n.len + 0.05);
    }
  }
}

// --- Наборы звуков -------------------------------------------------------------------------------

/** Нота: частота, начало, длина, громкость и тембр. */
const n = (freq: number, at: number, len: number, vol: number, type?: OscillatorType, shimmer?: number, to?: number): Note => ({ freq, at, len, vol, type, shimmer, to });
/** Одна и та же нота несколько раз подряд. */
const rep = (count: number, step: number, freq: number, len: number, vol: number, type?: OscillatorType, shimmer?: number) =>
  Array.from({ length: count }, (_, i) => n(freq, i * step, len, vol, type, shimmer));

export interface SoundDef {
  id: string;
  label: string;
  hint: string;
  notes: Note[];
}
const S = (id: string, label: string, hint: string, notes: Note[]): SoundDef => ({ id, label, hint, notes });
const NONE = S("none", "Без звука", "тишина на это событие", []);

export type ScanEvent = "arrived" | "repeat" | "issued" | "not_found";

export const SOUND_SETS: Record<ScanEvent, SoundDef[]> = {
  // Принят — светлые, восходящие, «всё хорошо».
  arrived: [
    S("bell", "Колокольчик", "светлое «динь-дилинь»", [n(1318.5, 0, 0.22, 0.32, "sine", 0.18), n(1661.2, 0.085, 0.38, 0.3, "sine", 0.15)]),
    S("harp", "Арфа", "три ноты вверх", [n(1046.5, 0, 0.3, 0.26, "sine", 0.15), n(1318.5, 0.07, 0.3, 0.26, "sine", 0.15), n(1568, 0.14, 0.45, 0.26, "sine", 0.15)]),
    S("cash", "Касса", "короткий звонок", [n(2093, 0, 0.08, 0.2, "sine", 0.1), n(2637, 0.07, 0.5, 0.24, "sine", 0.2)]),
    S("coin", "Монетка", "игровое «бли-линь»", [n(987.8, 0, 0.09, 0.24, "triangle"), n(1318.5, 0.08, 0.4, 0.26, "sine", 0.2)]),
    S("beep", "Сканер", "классический «пик»", [n(1000, 0, 0.11, 0.12, "square")]),
    S("ding", "Динь", "одна чистая нота", [n(1760, 0, 0.5, 0.26, "sine", 0.25)]),
    S("chime", "Перезвон", "две ноты вместе", [n(1568, 0, 0.6, 0.2, "sine", 0.2), n(2093, 0, 0.6, 0.16, "sine", 0.15)]),
    S("triad", "Мажор", "быстрое арпеджио", [n(523.3, 0, 0.25, 0.22, "triangle", 0.1), n(659.3, 0.05, 0.25, 0.22, "triangle", 0.1), n(784, 0.1, 0.25, 0.22, "triangle", 0.1), n(1046.5, 0.15, 0.4, 0.24, "triangle", 0.1)]),
    S("sparkle", "Искорка", "высокий блеск", [n(2637, 0, 0.12, 0.16, "sine", 0.3), n(3136, 0.04, 0.28, 0.14, "sine", 0.3)]),
    S("rise", "Дон-динь", "две ноты вверх, спокойно", [n(1046.5, 0, 0.35, 0.26, "sine", 0.15), n(1318.5, 0.18, 0.5, 0.26, "sine", 0.15)]),
    S("levelup", "Уровень", "четыре ноты вверх", [n(1046.5, 0, 0.12, 0.22), n(1318.5, 0.04, 0.12, 0.22), n(1568, 0.08, 0.12, 0.22), n(2093, 0.12, 0.35, 0.24, "sine", 0.15)]),
    S("marimba", "Маримба", "деревянное «тук-динь»", [n(784, 0, 0.15, 0.3, "triangle", 0.08), n(1046.5, 0.09, 0.22, 0.3, "triangle", 0.08)]),
    S("glass", "Стекло", "звон бокала", [n(2093, 0, 0.7, 0.18, "sine", 0.4)]),
    S("success", "Успех", "три ноты, последняя долгая", [n(784, 0, 0.12, 0.24, "sine", 0.1), n(1046.5, 0.08, 0.12, 0.24, "sine", 0.1), n(1318.5, 0.16, 0.5, 0.26, "sine", 0.18)]),
    NONE,
  ],
  // Повтор (уже на складе) — нейтральные, короткие, «уже было».
  repeat: [
    S("knock", "Мягкий тук", "один нейтральный удар", [n(880, 0, 0.2, 0.26, "triangle", 0.06)]),
    S("knock2", "Двойной тук", "«тук-тук»", [n(784, 0, 0.12, 0.24, "triangle", 0.05), n(784, 0.13, 0.16, 0.2, "triangle", 0.05)]),
    S("tick", "Тик", "очень короткий", [n(1200, 0, 0.05, 0.26, "triangle")]),
    S("click", "Щелчок", "сухой клик", [n(2000, 0, 0.03, 0.22)]),
    S("wood", "Дерево", "стук по дереву", [n(600, 0, 0.08, 0.32, "triangle", 0.2)]),
    S("blip", "Блип", "мягкая точка", [n(660, 0, 0.1, 0.28)]),
    S("blip2", "Два блипа", "«блип-блип»", rep(2, 0.11, 660, 0.09, 0.26)),
    S("flat", "Ровный", "одна ровная нота", [n(880, 0, 0.3, 0.22)]),
    S("hum", "Гул", "низкий мягкий", [n(440, 0, 0.25, 0.28, "triangle")]),
    S("tap", "Стук", "глухой удар", [n(300, 0, 0.07, 0.4, "triangle")]),
    S("muted", "Приглушённый", "еле слышный", [n(659.3, 0, 0.15, 0.18)]),
    S("echo", "Эхо", "нота с эхом", [n(880, 0, 0.12, 0.26, "triangle"), n(880, 0.12, 0.12, 0.13, "triangle"), n(880, 0.24, 0.12, 0.07, "triangle")]),
    S("drop", "Капля", "падающая нота", [n(1400, 0, 0.2, 0.3, "sine", 0.05, 600)]),
    S("bubble", "Бульк", "мягкий «бульк»", [n(400, 0, 0.14, 0.34, "sine", 0, 250)]),
    NONE,
  ],
  // Уже выдан — спокойно, но заметно: «этот товар уже отдали».
  issued: [
    S("knock", "Мягкий тук", "один нейтральный удар", [n(880, 0, 0.2, 0.26, "triangle", 0.06)]),
    S("knock2", "Двойной тук", "«тук-тук»", [n(784, 0, 0.12, 0.24, "triangle", 0.05), n(784, 0.13, 0.16, 0.2, "triangle", 0.05)]),
    S("doorbell", "Дин-дон", "дверной звонок", [n(1318.5, 0, 0.35, 0.26, "sine", 0.15), n(1046.5, 0.22, 0.55, 0.26, "sine", 0.15)]),
    S("bong", "Бонг", "низкий круглый", [n(392, 0, 0.6, 0.3, "sine", 0.3)]),
    S("gong", "Гонг", "долгий низкий звон", [n(261.6, 0, 0.9, 0.28, "triangle", 0.4)]),
    S("tritap", "Три тука", "«тук-тук-тук»", rep(3, 0.12, 700, 0.09, 0.24, "triangle")),
    S("slide", "Вниз мягко", "скользит вниз", [n(784, 0, 0.3, 0.26, "sine", 0.05, 523.3)]),
    S("question", "Вопрос", "интонация «а?»", [n(523.3, 0, 0.3, 0.26, "sine", 0.05, 784)]),
    S("hmm", "Хм", "две низкие ноты", [n(329.6, 0, 0.16, 0.3, "triangle"), n(293.7, 0.14, 0.22, 0.3, "triangle")]),
    S("clock", "Часы", "«тик-так»", [n(1500, 0, 0.05, 0.26, "triangle"), n(1200, 0.16, 0.05, 0.26, "triangle")]),
    S("chimedown", "Перезвон вниз", "три ноты вниз", [n(1568, 0, 0.2, 0.22, "sine", 0.15), n(1318.5, 0.09, 0.2, 0.22, "sine", 0.15), n(1046.5, 0.18, 0.4, 0.22, "sine", 0.15)]),
    S("pluck", "Щипок", "как струна", [n(440, 0, 0.14, 0.32, "triangle", 0.25)]),
    S("low2", "Два низких", "низкое «бом-бом»", rep(2, 0.16, 392, 0.14, 0.3, "triangle")),
    S("purr", "Мурлык", "низкое дрожание", rep(3, 0.06, 220, 0.07, 0.3, "triangle")),
    NONE,
  ],
  // Не найден — тревожные, низкие, «внимание».
  not_found: [
    S("down", "Вниз", "две ноты вниз — «не то»", [n(440, 0, 0.2, 0.34, "triangle", 0.08), n(329.6, 0.15, 0.32, 0.34, "triangle", 0.08)]),
    S("alarm", "Тревога", "три коротких сигнала", rep(3, 0.17, 392, 0.13, 0.14, "square")),
    S("buzz", "Зуммер", "низкий гудок", [n(196, 0, 0.36, 0.16, "sawtooth")]),
    S("error", "Ошибка", "двойной резкий", rep(2, 0.13, 220, 0.1, 0.14, "square")),
    S("siren", "Сирена", "вверх-вниз", [n(700, 0, 0.22, 0.24, "triangle", 0, 1000), n(1000, 0.2, 0.22, 0.24, "triangle", 0, 700)]),
    S("thud", "Глухой удар", "тяжёлый низкий", [n(120, 0, 0.25, 0.5)]),
    S("nope", "Не-а", "«не-а»", [n(523.3, 0, 0.14, 0.3, "triangle"), n(392, 0.15, 0.24, 0.3, "triangle")]),
    S("fall3", "Три вниз", "три ноты вниз", [n(784, 0, 0.12, 0.28, "triangle"), n(659.3, 0.1, 0.12, 0.28, "triangle"), n(523.3, 0.2, 0.28, 0.28, "triangle")]),
    S("honk", "Гудок", "автомобильный", [n(233, 0, 0.3, 0.12, "square")]),
    S("falling", "Падение", "долгое падение", [n(900, 0, 0.42, 0.26, "triangle", 0, 200)]),
    S("warn", "Предупреждение", "два высоких пика", rep(2, 0.12, 880, 0.08, 0.1, "square")),
    S("bass", "Бас", "очень низкий", [n(98, 0, 0.32, 0.22, "sawtooth", 0.3)]),
    S("clash", "Диссонанс", "две ноты вразнобой", [n(440, 0, 0.32, 0.22, "triangle"), n(466.2, 0, 0.32, 0.22, "triangle")]),
    S("long", "Длинный сигнал", "протяжный гудок", [n(520, 0, 0.6, 0.1, "square")]),
    NONE,
  ],
};

export const SCAN_EVENTS: { key: ScanEvent; label: string; hint: string; def: string }[] = [
  { key: "arrived", label: "Товар принят", hint: "код найден — товар «На складе»", def: "bell" },
  { key: "repeat", label: "Повтор", hint: "уже на складе — скан ещё раз", def: "knock" },
  { key: "issued", label: "Уже выдан", hint: "товар уже отдали клиенту", def: "doorbell" },
  { key: "not_found", label: "Не найден", hint: "кода нет в заказах или ошибка", def: "down" },
];

const soundOf = (event: ScanEvent, id: string): SoundDef | undefined => SOUND_SETS[event].find((s) => s.id === id);

// --- Настройки (в этом браузере) -----------------------------------------------------------------

export interface SoundPrefs {
  on: boolean;
  /** 0–100 */
  volume: number;
  /** id звука из набора этого события. */
  map: Record<ScanEvent, string>;
}

const KEY = "rb_sounds";
const DEFAULTS: SoundPrefs = { on: true, volume: 80, map: Object.fromEntries(SCAN_EVENTS.map((e) => [e.key, e.def])) as Record<ScanEvent, string> };

function read(): SoundPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SoundPrefs> | null;
    if (!raw) return DEFAULTS;
    const map = { ...DEFAULTS.map };
    // Звук, которого нет в наборе события (старые настройки), — заменяется звуком по умолчанию.
    for (const e of SCAN_EVENTS) if (raw.map?.[e.key] && soundOf(e.key, raw.map[e.key])) map[e.key] = raw.map[e.key];
    return { on: raw.on !== false, volume: typeof raw.volume === "number" ? Math.max(0, Math.min(100, raw.volume)) : DEFAULTS.volume, map };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getSoundPrefs(): SoundPrefs {
  return current;
}

export function setSoundPrefs(patch: Partial<SoundPrefs>) {
  current = { ...current, ...patch, map: { ...current.map, ...(patch.map ?? {}) } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* хранилище недоступно — настройки действуют до перезагрузки */
  }
  listeners.forEach((l) => l());
}

export function resetSoundPrefs() {
  setSoundPrefs({ ...DEFAULTS, map: { ...DEFAULTS.map } });
}

export const isDefaultSounds = (p: SoundPrefs) => p.on === DEFAULTS.on && p.volume === DEFAULTS.volume && SCAN_EVENTS.every((e) => p.map[e.key] === e.def);

/** Настройки звука с подпиской: меняются в «Настройках» — сразу видны на «Приёме», и наоборот. */
export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          current = read();
          cb();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSoundPrefs
  );
}

/** Прослушать звук (в настройках) — играет даже при выключенном звуке приёма. */
export function previewSound(event: ScanEvent, id: string, volume = current.volume) {
  play(soundOf(event, id)?.notes ?? [], volume);
}

/** Звук события скана — по выбору в настройках; ничего, если звук выключен. */
export function scanSound(event: ScanEvent) {
  if (!current.on) return;
  play(soundOf(event, current.map[event])?.notes ?? [], current.volume);
}

export const soundLabel = (event: ScanEvent, id: string) => soundOf(event, id)?.label ?? id;
