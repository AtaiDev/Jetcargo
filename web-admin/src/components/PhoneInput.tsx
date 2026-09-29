/**
 * Телефон Кыргызстана: префикс +996 стоит всегда, вводятся только 9 цифр,
 * которые сразу раскладываются как «700 123 456».
 *
 * Вставка любого формата приводится к норме: «0700123456», «996700123456»,
 * «+996 (700) 12-34-56» → 700 123 456. Наружу отдаётся «+996 700 123 456»
 * (или пустая строка, если цифр нет).
 */
import { useLayoutEffect, useRef } from "react";

import { MONO, css, mix } from "../design/css";

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
  // Значение хранится полным («+996 700 1…»): префикс отрезаем явно, иначе при
  // коротком номере «996» приняли бы за начало локальных цифр.
  const digits = /^\s*\+996/.test(value) ? value.replace(/^\s*\+996/, "").replace(/\D/g, "").slice(0, LOCAL) : localDigits(value);
  const shown = group(digits);

  // Курсор после форматирования ставим за то же число цифр, что было до него.
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
    el.setSelectionRange(pos, pos);
    caretDigits.current = null;
  }, [shown]);

  const complete = digits.length === LOCAL;
  return (
    <div
      className="phone-field"
      style={mix(
        "display:flex;align-items:stretch;width:100%;border:1px solid var(--border-strong);border-radius:8px;background:var(--surface);overflow:hidden",
        { height }
      )}
    >
      <span
        style={css(
          "display:flex;align-items:center;padding:0 10px;background:var(--surface-2);border-right:1px solid var(--border-2);color:var(--text-2);font-size:13px;font-weight:600;flex:none;" + MONO
        )}
      >
        +996
      </span>
      <input
        ref={ref}
        value={shown}
        autoFocus={autoFocus}
        inputMode="tel"
        autoComplete="tel"
        placeholder="700 123 456"
        onChange={(e) => {
          const el = e.target;
          const before = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, "").length;
          const d = localDigits(el.value);
          caretDigits.current = Math.min(before, d.length);
          onChange(fullPhone(d));
        }}
        onPaste={(e) => {
          e.preventDefault();
          const d = localDigits(e.clipboardData.getData("text"));
          caretDigits.current = d.length;
          onChange(fullPhone(d));
        }}
        style={mix("flex:1;min-width:0;border:none;outline:none;background:transparent;padding:0 10px;font-size:13.5px;letter-spacing:.02em;" + MONO, {
          boxShadow: "none",
        })}
      />
      {digits.length > 0 && (
        <span
          title={complete ? "Номер полный" : `Ещё ${LOCAL - digits.length} цифр`}
          style={mix("display:flex;align-items:center;padding:0 10px;font-size:11px;flex:none;white-space:nowrap", {
            color: complete ? "var(--green)" : "var(--text-4)",
          })}
        >
          {complete ? "✓" : `${digits.length}/${LOCAL}`}
        </span>
      )}
    </div>
  );
}
