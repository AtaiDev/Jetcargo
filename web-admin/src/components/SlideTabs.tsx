import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/** Вкладки со счётчиками: тёмная подложка плавно переезжает под выбранную. Стили — .od-tabs. */
export default function SlideTabs<V extends string>({ value, onChange, options, counts = true }: { value: V; onChange: (v: V) => void; options: [V, string, (number | undefined)?, string?][]; counts?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [th, setTh] = useState<CSSProperties>({ opacity: 0 });
  const nums = options.map((o) => `${o[0]}:${o[2] ?? ""}`).join();
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const put = () => {
      const b = el.querySelector<HTMLElement>("button.on");
      setTh(b ? { width: b.offsetWidth, transform: `translateX(${b.offsetLeft}px)`, opacity: 1 } : { opacity: 0 });
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, nums]);
  return (
    <div ref={box} className="od-tabs" role="tablist">
      <span className="od-tabs-th" style={th} />
      {options.map(([k, l, n, tone]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>
          {tone && <i className={"od-dot " + tone} />}
          {l}
          {counts && options.some((o) => o.length > 2) && <em>{n == null ? "…" : n.toLocaleString("ru-RU")}</em>}
        </button>
      ))}
    </div>
  );
}
