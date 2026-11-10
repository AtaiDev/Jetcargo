/** Подсказка рядом с зоной загрузки: живой мини-лист Excel (колонки, которые узнаём, медленно едут) и три коротких факта. */
// иконки: контур (второй элемент), при наведении «рисуются» заново
const P: Record<string, [string, string]> = {
  sheet: ["M6 3h8l4 4v14H6z", "M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 9.5h16 M4 14.5h16 M10 9.5V20"],
  eye: ["M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12z", "M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"],
  undo: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M3.5 12a8.5 8.5 0 1 0 2.6-6.1 M3.5 4.5v4.5H8 M12 8v4.2l2.8 1.8"],
  search: ["M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z", "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z M20.5 20.5l-4.5-4.5"],
  truck: ["M3 6h11v10H3z", "M3 6h11v10H3z M14 9h4l3 3v4h-7 M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"],
  scan: ["M7.5 7.5h9v9h-9z", "M4 8V5a1 1 0 0 1 1-1h3 M16 4h3a1 1 0 0 1 1 1v3 M20 16v3a1 1 0 0 1-1 1h-3 M8 20H5a1 1 0 0 1-1-1v-3 M7.5 12h9"],
};
export type HelpIcon = "sheet" | "eye" | "undo" | "search" | "truck" | "scan";

const ROWS = 3;
// «данные» в ячейках — серые полоски разной длины (без настоящих значений)
const bar = (c: number, r: number) => 34 + ((c * 37 + r * 23) % 46);

export default function ImportHelp({ title, sub, cols, tips }: { title: string; sub: string; cols: string[]; tips: [HelpIcon, string, string][] }) {
  const parsed = cols.map((c) => {
    const req = c.endsWith(" *");
    const [a, b] = c.replace(/ \*$/, "").split(" / ");
    return { req, name: b ?? a, cn: b ? a : "" };
  });
  const Col = ({ i, hidden }: { i: number; hidden?: boolean }) => {
    const c = parsed[i];
    return (
      <span className={"ih-c" + (c.req ? " req" : "")} aria-hidden={hidden}>
        <i>{String.fromCharCode(65 + i)}</i>
        <b>
          {c.name}
          {c.cn && <small>{c.cn}</small>}
        </b>
        {Array.from({ length: ROWS }, (_, r) => (
          <u key={r}>
            <s style={{ width: bar(i, r) + "%" }} />
          </u>
        ))}
      </span>
    );
  };
  return (
    <section className="im-card ih">
      <div className="ih-head">
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      <div className="ih-sheet">
        <div className="ih-body">
          <span className="ih-nums" aria-hidden>
            <i />
            {Array.from({ length: ROWS + 1 }, (_, r) => (
              <em key={r} className={r === 0 ? "on" : ""}>
                {r + 1}
              </em>
            ))}
          </span>
          <span className="ih-view">
            <span className="ih-track" style={{ animationDuration: cols.length * 2.8 + "s" }}>
              {parsed.map((_, i) => (
                <Col key={i} i={i} />
              ))}
              {parsed.map((_, i) => (
                <Col key={"d" + i} i={i} hidden />
              ))}
            </span>
          </span>
        </div>
        <div className="ih-tabs">
          <span className="ih-tab">Лист1</span>
          <span className="ih-leg">
            <i />
            обязательные<span className="ih-leg-x"> · {cols.length} колонок узнаём сами</span>
          </span>
        </div>
      </div>
      <div className="ih-tips">
        {tips.map(([ic, t, h]) => (
          <span key={t} className="ih-tip">
            
            <b>
              <span className="ih-ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={P[ic][1]} pathLength={1} />
              </svg>
            </span>
              {t}
            </b>
            <small>{h}</small>
          </span>
        ))}
      </div>
    </section>
  );
}
