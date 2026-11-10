/**
 * Накладная из Китая: файл со списком отправленных кодов (订单号 / «Номер заказа»).
 *
 *  - пока файла нет — зона «перетащите накладную» и короткое объяснение, как это работает;
 *  - с файлом — карточка накладной (номер, дата отправки, коробки), сколько товаров станет «В пути»,
 *    плитки-фильтры (станут «В пути» / уже на складе / не найдены / повторы) и таблица кодов;
 *  - ниже — загруженные накладные с прогрессом: сколько ещё в пути, сколько уже на складе и выдано.
 * Превью ничего не пишет. «В пути» вычисляется по накладной — скрыли её, и товары снова «Заказан».
 */
import ImportHelp from "./ImportHelp";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import {
  commitWaybill,
  deleteShipment,
  getShipment,
  listShipments,
  previewWaybill,
  type Shipment,
  type ShipmentDetail,
  type WaybillCounts,
  type WaybillMatch,
  type WaybillPreview,
  type WaybillState,
} from "../api/domain";
import { Confirm } from "../components/cargo";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CLOSE, I_EXCEL, Icon, Svg } from "../design/icons";
import { HButton, ModalError, ST } from "../design/ui";
import { date, dateTime, shortDateTime, som } from "../lib/cargo";
import { emit } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type Filter = "all" | WaybillState;

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";

const STATE: Record<WaybillState, { label: string; tile: string; fg: string; dot: string }> = {
  transit: { label: "Станет «В пути»", tile: "Станут «В пути»", fg: "var(--sky)", dot: "var(--sky-dot)" },
  arrived: { label: "Уже приехал", tile: "Уже на складе или выданы", fg: "var(--green)", dot: "var(--green-dot)" },
  not_found: { label: "Нет в заказах", tile: "Не найдены в заказах", fg: "var(--danger)", dot: "var(--danger-dot)" },
  dup: { label: "Повтор в файле", tile: "Повторы в файле", fg: "var(--text-3)", dot: "var(--text-4)" },
};

export default function ImportWaybill({ toast, initialFile }: { toast: Toast; initialFile?: File | null }) {
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<WaybillPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [done, setDone] = useState<{ counts: WaybillCounts; waybill: string; updated: boolean } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (f: File) => {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewWaybill(f));
    } catch (e) {
      setPreview(null);
      setError(apiError(e, "Не удалось прочитать накладную"));
    } finally {
      setBusy(false);
    }
  }, []);

  const pickFile = useCallback(
    (f: File | null) => {
      setDone(null);
      setFile(f);
      setPreview(null);
      setFilter("all");
      if (f) run(f);
      if (inputRef.current) inputRef.current.value = "";
    },
    [run]
  );

  // Файл, брошенный в обычный импорт и узнанный как накладная, — сразу разбираем.
  useEffect(() => {
    if (initialFile) pickFile(initialFile);
  }, [initialFile, pickFile]);

  async function save() {
    if (!file || !preview) return;
    setSaving(true);
    setError("");
    try {
      const r = await commitWaybill(file);
      const n = r.counts.transit_items;
      setDone({ counts: r.counts, waybill: r.shipments.map((s) => s.waybill).join(", "), updated: r.shipments.some((s) => s.updated) });
      toast("success", n ? `«В пути»: ${n} ${plural(n, "товар", "товара", "товаров")}` : "Накладная сохранена");
      emit("cargo:changed");
      setHistoryKey((k) => k + 1);
      run(file);
    } catch (e) {
      setError(apiError(e, "Не удалось сохранить накладную"));
    } finally {
      setSaving(false);
    }
  }

  const cnt = preview?.counts;
  const rows = (preview?.rows ?? []).filter((r) => filter === "all" || r.state === filter);
  const w = preview?.waybills[0];

  return (
    <>
      <input ref={inputRef} type="file" accept=".xlsx" style={css("display:none")} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
      {error && (
        <div style={css("margin-bottom:12px")}>
          <ModalError text={error} />
        </div>
      )}

      {!preview || !cnt || !w ? (
        <WStart busy={busy} fileName={file?.name} onPick={() => inputRef.current?.click()} onDrop={pickFile} />
      ) : (
        <>
          {/* Файл */}
          <section className="im-file">
            <span className="im-file-icon wb-icon">
              <Svg paths={I_EXCEL} size={22} sw={1.7} />
            </span>
            <div style={css("flex:1 1 240px;min-width:0")}>
              <div style={css("font-size:15px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{file?.name ?? preview.filename}</div>
              <div style={css(NUM + ";font-size:12.5px;color:var(--text-3);margin-top:2px")}>
                {cnt.rows} {plural(cnt.rows, "строка", "строки", "строк")} · лист «{preview.sheet}»{busy ? " · пересчитываю…" : ""}
              </div>
            </div>
            <HButton onClick={() => inputRef.current?.click()} className="im-ghost" s="" hover="">
              Другая накладная
            </HButton>
            <HButton onClick={() => pickFile(null)} title="Убрать файл" aria-label="Убрать файл" className="im-x" s="" hover="">
              <Svg paths={I_CLOSE} size={16} sw={2} />
            </HButton>
          </section>

          {done && (
            <section className="wb-done">
              <span className="wb-done-i">✓</span>
              <span style={css("flex:1;min-width:0")}>
                <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>
                  {done.updated ? "Накладная обновлена" : "Накладная загружена"}: {done.counts.transit_items} {plural(done.counts.transit_items, "товар", "товара", "товаров")} в пути
                </span>
                <span style={css("display:block;font-size:12.5px;color:var(--text-3)")}>
                  {done.waybill} · на приёме скан переведёт их «На склад»
                </span>
              </span>
              <HButton onClick={() => nav("/orders?status=in_transit")} className="im-ghost" s="" hover="">
                Открыть «В пути» в заказах
              </HButton>
            </section>
          )}

          {/* Накладная: что в ней и что станет «В пути» */}
          <section className="wb-hero">
            <div style={css("min-width:0")}>
              <div style={css("font-size:12px;color:var(--sky)")}>Накладная из Китая</div>
              <div className="wb-number">{w.waybill}</div>
              <div style={css("display:flex;flex-wrap:wrap;gap:6px;margin-top:10px")}>
                {w.shipped_at && <span className="wb-chip">отправлена {date(w.shipped_at)}</span>}
                {w.arrives_at && <span className="wb-chip">прибытие {date(w.arrives_at)}</span>}
                <span className="wb-chip">
                  {cnt.codes} {plural(cnt.codes, "код", "кода", "кодов")}
                </span>
                {cnt.boxes > 0 && (
                  <span className="wb-chip">
                    {cnt.boxes} {plural(cnt.boxes, "коробка", "коробки", "коробок")}
                  </span>
                )}
                {preview.waybills.length > 1 && <span className="wb-chip">ещё накладных в файле: {preview.waybills.length - 1}</span>}
              </div>
              {w.loaded && !done && (
                <div className="wb-note">Эта накладная уже загружена {dateTime(w.loaded.at)} — повторная загрузка обновит её, дублей не будет.</div>
              )}
            </div>
            <div className="wb-cta">
              <span style={css("font-size:12.5px;color:var(--text-3)")}>Станут «В пути»</span>
              <span style={css(NUM + ";font-size:34px;font-weight:500;line-height:1.1;color:var(--sky)")}>
                <CountUp text={String(cnt.transit_items)} />
                <span style={css("font-size:15px;color:var(--text-3);margin-left:6px")}>{plural(cnt.transit_items, "товар", "товара", "товаров")}</span>
              </span>
              <span style={css(NUM + ";font-size:12.5px;color:var(--text-3)")}>
                {cnt.customers} {plural(cnt.customers, "клиент", "клиента", "клиентов")} · на {som(cnt.transit_sum)}
              </span>
              <HButton onClick={save} disabled={saving || busy || !cnt.codes} className="wb-go" s="" hover="">
                {saving ? "Сохраняю…" : w.loaded ? "Обновить накладную" : cnt.transit_items ? `Отметить «В пути»` : "Сохранить накладную"}
              </HButton>
            </div>
          </section>

          {/* Итоги — они же фильтры таблицы */}
          <div className="wb-tiles">
            {(["transit", "arrived", "not_found", "dup"] as WaybillState[]).map((k) => (
              <button key={k} type="button" className={"wb-tile" + (filter === k ? " on" : "")} style={{ ["--c" as string]: STATE[k].dot }} onClick={() => setFilter(filter === k ? "all" : k)}>
                <span style={css("display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text-3)")}>
                  <span style={mix("width:8px;height:8px;border-radius:50%", { background: STATE[k].dot })} />
                  {STATE[k].tile}
                </span>
                <span style={mix(NUM + ";display:block;margin-top:4px;font-size:22px;font-weight:500", { color: cnt[k] ? STATE[k].fg : "var(--text-4)" })}>{cnt[k]}</span>
              </button>
            ))}
          </div>
          {filter === "not_found" && cnt.not_found > 0 && (
            <div className="wb-note" style={css("margin:0 0 12px")}>
              Этих кодов нет ни у одного товара. Если товар есть — впишите код в его карточку: он сам станет «В пути», накладную загружать заново не нужно.
            </div>
          )}

          <WTable rows={rows} />
        </>
      )}

      <WHistory key={historyKey} toast={toast} />
    </>
  );
}

// --- Старт ----------------------------------------------------------------------------------------

function WStart({ busy, fileName, onPick, onDrop }: { busy: boolean; fileName?: string; onPick: () => void; onDrop: (f: File | null) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="im-start">
      <div
        className={"im-drop wb-drop" + (over ? " over" : "") + (busy ? " busy" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop(e.dataTransfer.files?.[0] ?? null);
        }}
        onClick={() => !busy && onPick()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && onPick()}
      >
        <svg className="im-dash" aria-hidden><rect x="1" y="1" rx="19" /></svg>
        <span className="im-drop-icon wb-drop-icon">
          <Icon name="batches" size={34} />
        </span>
        {busy ? (
          <>
            <span style={css("font-size:17px;font-weight:500;color:var(--text)")}>Читаю накладную…</span>
            <span style={css("font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%")}>{fileName}</span>
            <span className="im-progress">
              <span />
            </span>
          </>
        ) : (
          <>
            <span style={css("font-size:18px;font-weight:500;color:var(--text)")}>{over ? "Отпустите — прочитаем накладную" : "Перетащите накладную из Китая"}</span>
            <span style={css("font-size:13px;color:var(--text-3)")}>Excel со списком отправленных номеров заказов · .xlsx</span>
            <span className="im-pick wb-pick">Выбрать файл</span>
          </>
        )}
      </div>

      <ImportHelp
        title="Как выглядит накладная"
        sub="Excel, который присылает Китай"
        cols={["订单号 / Номер заказа *", "运单号 / Номер накладной", "发货时间 / Время отправления", "箱子编号 / Номер коробки", "入库时间 / Время поступления"]}
        tips={[
          ["search", "Найдём по коду", "номер заказа = код товара"],
          ["truck", "Статус «В пути»", "с накладной и датой"],
          ["scan", "На приёме", "скан → «На складе»"],
        ]}
      />
    </div>
  );
}

// --- Таблица кодов ----------------------------------------------------------------------------------

function MatchCell({ m }: { m: WaybillMatch[] }) {
  if (!m.length) return <span style={css("font-size:12.5px;color:var(--text-4)")}>—</span>;
  const first = m[0];
  return (
    <span style={css("min-width:0")}>
      <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{first.name}</span>
      <span style={css("display:block;font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
        {first.customer_name} · {first.qty} шт{m.length > 1 ? ` · ещё ${m.length - 1}` : ""}
      </span>
    </span>
  );
}

function StateCell({ state, m }: { state: WaybillState; m: WaybillMatch[] }) {
  if (state === "transit")
    return (
      <span className="wb-flow">
        <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST.ordered.dot })} />
        Заказан
        <span style={css("color:var(--text-4)")}>→</span>
        <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST.in_transit.dot })} />
        <span style={css("color:var(--sky)")}>В пути</span>
      </span>
    );
  if (state === "arrived") {
    const s = m[0]?.stage ?? "in_stock";
    return (
      <span className="wb-flow">
        <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST[s].dot })} />
        <span style={{ color: ST[s].fg }}>уже {ST[s].label.toLowerCase()}</span>
      </span>
    );
  }
  return (
    <span className="wb-flow">
      <span style={mix("width:7px;height:7px;border-radius:50%", { background: STATE[state].dot })} />
      <span style={{ color: STATE[state].fg }}>{STATE[state].label.toLowerCase()}</span>
    </span>
  );
}

function WTable({ rows }: { rows: WaybillPreview["rows"] }) {
  const [limit, setLimit] = useState(100);
  return (
    <section className="wb-table">
      <div className="wb-row wb-head">
        <span>Строка</span>
        <span>Номер заказа</span>
        <span>Коробка</span>
        <span>Товар в заказах</span>
        <span>Что будет</span>
      </div>
      {rows.length === 0 && <div style={css("padding:28px;text-align:center;font-size:13px;color:var(--text-4)")}>Нет строк с таким итогом</div>}
      {rows.slice(0, limit).map((r) => (
        <div key={r.row} className={"wb-row" + (r.state === "dup" ? " dim" : "")} style={{ ["--c" as string]: STATE[r.state].dot }}>
          <span style={css(NUM + ";font-size:12px;color:var(--text-4)")}>{r.row}</span>
          <span style={css("min-width:0")}>
            <span style={css(CODE + ";display:block;font-size:12.5px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.code}</span>
            {r.china_in_at && <span style={css(NUM + ";display:block;font-size:11.5px;color:var(--text-4)")}>в Китае с {date(r.china_in_at)}</span>}
          </span>
          <span style={css("font-size:12px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.box || "—"}</span>
          <MatchCell m={r.matches} />
          <StateCell state={r.state} m={r.matches} />
        </div>
      ))}
      {rows.length > limit && (
        <div style={css("padding:12px;text-align:center")}>
          <HButton onClick={() => setLimit((l) => l + 200)} className="im-ghost" s="" hover="">
            Показать ещё {Math.min(200, rows.length - limit)}
          </HButton>
        </div>
      )}
    </section>
  );
}

// --- Загруженные накладные ------------------------------------------------------------------------

function WHistory({ toast }: { toast: Toast }) {
  const [list, setList] = useState<Shipment[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [cache, setCache] = useState<Record<number, ShipmentDetail>>({});
  const [hide, setHide] = useState<Shipment | null>(null);
  const [flt, setFlt] = useState<"all" | "go" | "done">("all");
  const [all, setAll] = useState(false);

  const load = useCallback(() => {
    listShipments()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  const want = (id: number) => {
    if (cache[id]) return;
    getShipment(id)
      .then((d) => setCache((c) => ({ ...c, [id]: d })))
      .catch(() => undefined);
  };

  if (list && !list.length) return null;
  const dm = (iso: string) => shortDateTime(iso).slice(0, 5);
  const isGo = (x: Shipment) => x.stats.in_transit > 0;
  const nGo = (list ?? []).filter(isGo).length;
  const nDone = (list ?? []).length - nGo;
  const picked = (list ?? []).filter((x) => (flt === "all" ? true : flt === "go" ? isGo(x) : !isGo(x)));
  const LIMIT = 6;
  const shown = all ? picked : picked.slice(0, LIMIT);
  return (
    <section className="im-card ihs wts" style={css("margin-top:16px")}>
      <div className="ihs-head">
        <span className="ihs-ttl">
          Загруженные накладные
          {list && <em>{list.length}</em>}
        </span>
        {list && list.length > 0 && (
          <span className="ihs-flt" role="tablist">
            {(
              [
                ["all", "Все", list.length],
                ["go", "В пути", nGo],
                ["done", "Доехали", nDone],
              ] as const
            ).map(([k, l, c]) => (
              <button key={k} type="button" role="tab" aria-selected={flt === k} className={flt === k ? "on" : ""} disabled={k !== "all" && !c} onClick={() => setFlt(k)}>
                {l}
                <em>{c}</em>
              </button>
            ))}
          </span>
        )}
      </div>
      {!list ? (
        <div className="wts-grid">
          {[0, 1].map((i) => (
            <span key={i} className="sk" style={css("height:150px;border-radius:16px")} />
          ))}
        </div>
      ) : (
        <div className="wts-grid">
          {shown.map((s, i) => {
            const t = s.stats;
            const total = Math.max(1, t.in_transit + t.in_stock + t.issued + t.ordered);
            const p = (t.in_stock + t.issued) / total;
            const done = t.items > 0 && t.in_transit === 0 && t.ordered === 0;
            const isOpen = open === s.id;
            const no = s.waybill.match(/^(.*-)([^-]+-[^-]+)$/);
            const days = s.shipped_at ? Math.round((new Date(s.updated_at.slice(0, 10)).getTime() - new Date(s.shipped_at.slice(0, 10)).getTime()) / 864e5) : null;
            return (
              <div key={s.id} className={"wt-w" + (isOpen ? " open" : "")} style={{ ["--k" as string]: i }}>
                <div className={"wt" + (done ? " done" : "") + (t.in_transit > 0 ? " moving" : "")} style={{ ["--p" as string]: p }}>
                  <div className="wt-stub">
                    <span className="wt-lbl">
                      Накладная
                      {s.user_login && <span>{s.user_login}</span>}
                    </span>
                    <b className="wt-no" title={s.waybill}>
                      {no ? (
                        <>
                          <span>{no[1]}</span>
                          {no[2]}
                        </>
                      ) : (
                        s.waybill
                      )}
                    </b>
                    <span className="wt-route">
                      <span>
                        {s.shipped_at ? date(s.shipped_at).slice(0, 5) : "—"}
                        <small>отправлена</small>
                      </span>
                      <span className="wt-gap">{days === null ? "" : days <= 0 ? "в тот же день" : `${days} ${plural(days, "день", "дня", "дней")}`}</span>
                      <span>
                        {dm(s.updated_at)}
                        <small>загружена</small>
                      </span>
                    </span>
                    <span className="wt-sum">
                      <span>
                        <b>{t.items}</b> {plural(t.items, "товар", "товара", "товаров")}
                      </span>
                      <b>{som(t.sum)}</b>
                    </span>
                  </div>
                  <div className="wt-main">
                    <div className="wt-road" title={`Доехало до склада: ${Math.round(p * 100)}%`}>
                      <span className="wt-end">Китай</span>
                      <span className="wt-track">
                        <span className="wt-line">
                          <i />
                        </span>
                        <span className="wt-truck">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d={done ? "M5 12.5l4.5 4.5L19 7.5" : "M3 6h11v10H3z M14 9h4l3 3v4h-7 M9 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z M19 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"} />
                          </svg>
                        </span>
                      </span>
                      <span className="wt-end">Склад</span>
                    </div>
                    <div className="wt-st">
                      {(
                        [
                          [t.in_transit, "в пути", total, "mv"],
                          [t.in_stock, "на складе", total, ""],
                          [t.issued, "выдано", total, ""],
                          ...(t.ordered > 0 ? [[t.ordered, "в другой накладной", total, ""]] : []),
                          ...(t.not_found > 0 ? [[t.not_found, plural(t.not_found, "код без товара", "кода без товара", "кодов без товара"), Math.max(1, t.codes), "warn"]] : []),
                        ] as [number, string, number, string][]
                      ).map(([v, l, of, c]) => (
                        <span key={l} className={"wt-s" + (v ? "" : " z") + (c ? " " + c : "")}>
                          <span className="wt-s-v">
                            <b>{v}</b>
                            <small>{l}</small>
                          </span>
                          <u>
                            <i style={{ width: (v / of) * 100 + "%" }} />
                          </u>
                        </span>
                      ))}
                    </div>
                    <div className="wt-foot">
                      <span className="wt-acts">
                        <button
                          type="button"
                          className={"wt-btn" + (isOpen ? " on" : "")}
                          onMouseEnter={() => want(s.id)}
                          onFocus={() => want(s.id)}
                          onClick={() => {
                            want(s.id);
                            setOpen(isOpen ? null : s.id);
                          }}
                        >
                          {isOpen ? "Свернуть" : "Подробнее"}
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                        <button type="button" className="wt-btn wt-hide" onClick={() => setHide(s)} title="Скрыть накладную">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3 3l18 18 M10.6 5.1A10 10 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.7 3.6 M6.3 6.3C3.9 8 2.5 12 2.5 12s3.5 7 9.5 7a9.6 9.6 0 0 0 4.2-1 M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                          </svg>
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
                {(() => {
                  const det = cache[s.id];
                  // пока грузится — заглушка той же высоты, что и будущая таблица (без скачка)
                  const h = Math.min(368, 42 + Math.max(1, t.codes) * 42);
                  return (
                    <div className={"wt-x" + (isOpen ? " open" : "")} aria-hidden={!isOpen}>
                      <div className="wt-x-in">
                        {det ? (
                          <div className="wt-detail thin-scroll">
                            <div className="wt-dr wt-dh">
                              <span>Клиент</span>
                              <span>Товар</span>
                              <span>Код</span>
                              <span className="r">Шт</span>
                              <span className="r">Сумма</span>
                              <span>Статус</span>
                            </div>
                            {det.rows.map((r, j) => {
                              const m = r.matches[0];
                              return (
                                <div key={j} className={"wt-dr" + (m ? "" : " miss")}>
                                  <span className="wt-dc">
                                    {m ? (
                                      <>
                                        <i>{(m.customer_name || "?").trim().charAt(0).toUpperCase()}</i>
                                        <b>{m.customer_name}</b>
                                      </>
                                    ) : (
                                      <>
                                        <i className="wt-skel" />
                                        <s className="wt-skel" style={{ width: 84 }} />
                                      </>
                                    )}
                                  </span>
                                  <span className="wt-dn">
                                    {m ? m.name : "нет товара с таким кодом"}
                                    {r.matches.length > 1 && <small>+{r.matches.length - 1}</small>}
                                  </span>
                                  <span className="wt-dk">{r.code}</span>
                                  <span className="r">{m ? m.qty : <s className="wt-skel" style={{ width: 18 }} />}</span>
                                  <span className="r">{m ? som(m.sale) : <s className="wt-skel" style={{ width: 52 }} />}</span>
                                  <span className={"wt-stage " + (m ? m.stage : "none")}>
                                    <i />
                                    {m ? ST[m.stage].label : "нет товара"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                              ) : (
                          <span className="wt-detail wt-dsk" style={{ height: h }} />
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
          {picked.length > LIMIT && (
            <button type="button" className="ihs-more" onClick={() => setAll(!all)}>
              {all ? "Свернуть" : `Показать все · ещё ${picked.length - LIMIT}`}
            </button>
          )}
        </div>
      )}
      {hide && (
        <Confirm
          title="Скрыть накладную?"
          confirmLabel="Скрыть"
          text={
            <>
              Накладная {hide.waybill} пропадёт из списка, а её товары, которые ещё не приехали, снова станут «Заказан». Товары и их статусы не меняются — это можно
              сделать в любой момент, загрузив накладную заново.
            </>
          }
          onClose={() => setHide(null)}
          onConfirm={async () => {
            await deleteShipment(hide.id);
            toast("success", "Накладная скрыта");
            emit("cargo:changed");
            setHide(null);
            setOpen(null);
            load();
          }}
        />
      )}
    </section>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
