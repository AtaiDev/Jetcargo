/**
 * Телефон с кодом страны. По умолчанию подставляется +996 (Кыргызстан), но код можно стереть
 * и ввести любой другой: +7, +998, +86… Страна определяется по коду и показывается справа,
 * номер раскладывается по группам под эту страну.
 *
 * Вставка приводится к норме: «0700123456» / «700123456» → +996 700 123 456, «8 900…» → +7 900…,
 * «00 86…» → +86…. Наружу отдаётся «+КОД номер» (или пустая строка, если цифр нет).
 */
import { useLayoutEffect, useRef, useState } from "react";

import { MONO, mix } from "../design/css";

const LOCAL = 9;

/** Из любой записи номера — локальные 9 цифр (без 996 и ведущего 0). */
export function localDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("996") && d.length > LOCAL) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, LOCAL);
}

/** 700123456 → «700 123 456» (частичный ввод тоже: «700 12»). */
function group(d: string): string {
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 9)].filter(Boolean).join(" ");
}

/** Полный номер для сохранения: «+996 700 123 456». */
export const fullPhone = (d: string) => (d ? `+996 ${group(d)}` : "");

type Country = { code: string; iso: string; name: string; len: number; g: number[] };
// код страны → название, длина национального номера и группы цифр
const COUNTRIES: Country[] = [
  { code: "996", iso: "KG", name: "Кыргызстан", len: 9, g: [3, 3, 3] },
  { code: "998", iso: "UZ", name: "Узбекистан", len: 9, g: [2, 3, 2, 2] },
  { code: "992", iso: "TJ", name: "Таджикистан", len: 9, g: [2, 3, 2, 2] },
  { code: "993", iso: "TM", name: "Туркменистан", len: 8, g: [2, 2, 2, 2] },
  { code: "994", iso: "AZ", name: "Азербайджан", len: 9, g: [2, 3, 2, 2] },
  { code: "995", iso: "GE", name: "Грузия", len: 9, g: [3, 2, 2, 2] },
  { code: "374", iso: "AM", name: "Армения", len: 8, g: [2, 3, 3] },
  { code: "375", iso: "BY", name: "Беларусь", len: 9, g: [2, 3, 2, 2] },
  { code: "380", iso: "UA", name: "Украина", len: 9, g: [2, 3, 2, 2] },
  { code: "971", iso: "AE", name: "ОАЭ", len: 9, g: [2, 3, 4] },
  { code: "86", iso: "CN", name: "Китай", len: 11, g: [3, 4, 4] },
  { code: "90", iso: "TR", name: "Турция", len: 10, g: [3, 3, 2, 2] },
  { code: "82", iso: "KR", name: "Корея", len: 10, g: [2, 4, 4] },
  { code: "49", iso: "DE", name: "Германия", len: 11, g: [3, 4, 4] },
  { code: "44", iso: "GB", name: "Великобритания", len: 10, g: [4, 6] },
  { code: "7", iso: "RU", name: "Россия", len: 10, g: [3, 3, 2, 2] },
  { code: "1", iso: "US", name: "США / Канада", len: 10, g: [3, 3, 4] },
];
const MAX = 15;

/** Страна по цифрам номера (самый длинный подходящий код). У +7 номера на 6/7 — Казахстан. */
export function countryOf(d: string): Country | null {
  for (const n of [3, 2, 1]) {
    const c = COUNTRIES.find((x) => x.code.length === n && d.startsWith(x.code));
    if (c) {
      if (c.code === "7" && /^[67]/.test(d.slice(1))) return { ...c, iso: "KZ", name: "Казахстан" };
      return c;
    }
  }
  return null;
}

/** Любая запись → цифры с кодом страны («0700…» и «700…» — это Кыргызстан, «8 9…» — Россия). */
export function normDigits(raw: string): string {
  const plus = /^\s*\+/.test(raw);
  let d = raw.replace(/\D/g, "");
  if (!plus) {
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.length === 10 && d.startsWith("0")) d = "996" + d.slice(1);
    else if (d.length === 9) d = "996" + d;
    else if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  }
  return clip(d);
}

/** Не длиннее, чем бывает у этой страны (и не больше 15 цифр вообще). */
function clip(d: string): string {
  const c = countryOf(d);
  return d.slice(0, c ? c.code.length + c.len : MAX);
}

/** Цифры → «+996 700 123 456» / «+7 900 123 45 67» (частичный ввод тоже). */
export function formatIntl(d: string): string {
  if (!d) return "";
  const c = countryOf(d);
  if (!c) return "+" + (d.match(/.{1,3}/g) ?? []).join(" ");
  const nat = d.slice(c.code.length);
  const parts: string[] = [];
  let i = 0;
  for (const n of c.g) {
    if (i >= nat.length) break;
    parts.push(nat.slice(i, i + n));
    i += n;
  }
  if (i < nat.length) parts.push(nat.slice(i));
  return "+" + c.code + (parts.length ? " " + parts.join(" ") : "");
}

export default function PhoneInput({
  value,
  onChange,
  autoFocus,
  height = 36,
}: {
  value: string;
  onChange: (full: string) => void;
  autoFocus?: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const caretDigits = useRef<number | null>(null);
  // пустое поле при фокусе показывает «+996 » — код можно стереть и ввести другой
  const [draft, setDraft] = useState<string | null>(null);
  const digits = value ? normDigits(value) : (draft ?? "");
  const shown = formatIntl(digits);
  const c = countryOf(digits);

  useLayoutEffect(() => {
    const el = ref.current;
    const n = caretDigits.current;
    if (!el || n === null) return;
    let pos = 0;
    let seen = 0;
    while (pos < shown.length && seen < n) {
      if (/\d/.test(shown[pos])) seen++;
      pos++;
    }
    if (n === 0) pos = shown.startsWith("+") ? 1 : 0;
    el.setSelectionRange(pos, pos);
    caretDigits.current = null;
  }, [shown]);

  function emit(d: string) {
    setDraft(d ? null : "");
    onChange(d ? formatIntl(d) : "");
  }

  return (
    <div
      className="phone-field"
      style={mix(
        "display:flex;align-items:stretch;width:100%;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface);overflow:hidden",
        { height }
      )}
    >
      <input
        ref={ref}
        value={shown}
        autoFocus={autoFocus}
        inputMode="tel"
        autoComplete="tel"
        placeholder="+996 700 123 456"
        onFocus={() => {
          if (!value && draft === null) {
            setDraft("996");
            caretDigits.current = 3;
          }
        }}
        onBlur={() => !value && setDraft(null)}
        onChange={(e) => {
          const el = e.target;
          const before = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, "").length;
          const d = clip(el.value.replace(/\D/g, ""));
          caretDigits.current = Math.min(before, d.length);
          emit(d);
        }}
        onPaste={(e) => {
          e.preventDefault();
          const d = normDigits(e.clipboardData.getData("text"));
          caretDigits.current = d.length;
          emit(d);
        }}
        style={mix("flex:1;min-width:0;border:none;outline:none;background:transparent;padding:0 10px;font-size:13.5px;letter-spacing:.02em;" + MONO, {
          boxShadow: "none",
        })}
      />
      {digits.length > 0 && (
        <span className="ph-cc" title={c ? c.name : "Код страны не распознан"}>
          <b>{c ? c.iso : "?"}</b>
          {c ? c.name : "другая страна"}
        </span>
      )}
    </div>
  );
}
