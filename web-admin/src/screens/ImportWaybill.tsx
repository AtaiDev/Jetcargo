/**
 * Накладная из Китая: файл со списком отправленных кодов (订单号 / «Номер заказа»).
 *
 *  - пока файла нет — зона «перетащите накладную» и короткое объяснение, как это работает;
 *  - с файлом — карточка накладной (номер, дата отправки, коробки), сколько товаров станет «В пути»,
 *    плитки-фильтры (станут «В пути» / уже на складе / не найдены / повторы) и таблица кодов;
 *  - ниже — загруженные накладные с прогрессом: сколько ещё в пути, сколько уже на складе и выдано.
 * Превью ничего не пишет. «В пути» вычисляется по накладной — скрыли её, и товары снова «Заказан».
 */
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
import { date, dateTime, som } from "../lib/cargo";
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

      <section className="im-card">
        <div style={css("font-size:15px;font-weight:500;color:var(--text)")}>Как это работает</div>
        <div style={css("display:flex;flex-direction:column;gap:12px;margin-top:14px")}>
          {[
            ["Китай присылает накладную", "Excel с номерами заказов, номером накладной, датой отправки и коробками"],
            ["Загружаете её сюда", "найдём товары по коду: «Номер заказа» в накладной = код товара"],
            ["Найденные становятся «В пути»", "видно в заказах, на складе и в карточке товара — с номером накладной и датой отправки"],
            ["На приёме — как обычно", "скан кода переводит товар «На склад»; накладную можно скрыть, и товары снова «Заказан»"],
          ].map(([t, h], i) => (
            <div key={t} style={css("display:flex;gap:12px;align-items:flex-start")}>
              <span style={css(NUM + ";width:24px;height:24px;border-radius:8px;flex:none;display:grid;place-items:center;font-size:12px;font-weight:600;color:var(--sky);background:var(--sky-tint)")}>{i + 1}</span>
              <span style={css("min-width:0")}>
                <span style={css("display:block;font-size:13.5px;color:var(--text)")}>{t}</span>
                <span style={css("display:block;font-size:12.5px;color:var(--text-4);margin-top:1px;line-height:1.45")}>{h}</span>
              </span>
            </div>
          ))}
        </div>
        <div style={css("font-size:12px;color:var(--text-3);margin:16px 0 8px")}>Какие колонки понимаем</div>
        <div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
          {["订单号 / Номер заказа *", "运单号 / Номер накладной", "发货时间 / Время отправления", "箱子编号 / Номер коробки", "入库时间 / Время поступления"].map((k) => (
            <span key={k} className="im-chip">
              {k}
            </span>
          ))}
        </div>
      </section>
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
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [hide, setHide] = useState<Shipment | null>(null);

  const load = useCallback(() => {
    listShipments()
      .then(setList)
      .catch(() => setList([]));
  }, []);
  useEffect(load, [load]);

  useEffect(() => {
    setDetail(null);
    if (open !== null) getShipment(open).then(setDetail).catch(() => setDetail(null));
  }, [open]);

  if (list && !list.length) return null;
  return (
    <section style={css("margin-top:22px")}>
      <div style={css("display:flex;align-items:baseline;gap:10px;margin-bottom:10px")}>
        <span style={css("font-size:15px;font-weight:500;color:var(--text)")}>Загруженные накладные</span>
        {list && <span style={css(NUM + ";font-size:12.5px;color:var(--text-4)")}>{list.length}</span>}
      </div>
      {!list ? (
        <div className="wb-hist">
          {[0, 1].map((i) => (
            <span key={i} className="sk" style={css("height:96px;border-radius:16px")} />
          ))}
        </div>
      ) : (
        <div className="wb-hist">
          {list.map((s) => {
            const t = s.stats;
            const total = Math.max(1, t.in_transit + t.in_stock + t.issued + t.ordered);
            const seg = (n: number) => `${(n / total) * 100}%`;
            const isOpen = open === s.id;
            return (
              <div key={s.id} className={"wb-card" + (isOpen ? " open" : "")}>
                <div className="wb-card-top">
                  <span style={css("min-width:0;flex:1")}>
                    <span style={css(CODE + ";display:block;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.waybill}</span>
                    <span style={css(NUM + ";display:block;font-size:12px;color:var(--text-3);margin-top:2px")}>
                      {s.shipped_at ? `отправлена ${date(s.shipped_at)} · ` : ""}загружена {dateTime(s.updated_at)}
                      {s.user_login ? ` · ${s.user_login}` : ""}
                    </span>
                  </span>
                  <span style={css(NUM + ";font-size:13px;color:var(--text-2);white-space:nowrap")}>
                    {t.items} {plural(t.items, "товар", "товара", "товаров")} · {som(t.sum)}
                  </span>
                </div>
                <div className="wb-bar" aria-hidden>
                  <span style={{ width: seg(t.in_transit), background: "var(--sky-dot)" }} />
                  <span style={{ width: seg(t.in_stock), background: "var(--accent)" }} />
                  <span style={{ width: seg(t.issued), background: "var(--green-dot)" }} />
                  <span style={{ width: seg(t.ordered), background: "var(--amber-dot)" }} />
                </div>
                <div className="wb-legend">
                  <Leg c="var(--sky-dot)" n={t.in_transit} label="в пути" />
                  <Leg c="var(--accent)" n={t.in_stock} label="на складе" />
                  <Leg c="var(--green-dot)" n={t.issued} label="выдано" />
                  {t.ordered > 0 && <Leg c="var(--amber-dot)" n={t.ordered} label="в другой накладной" />}
                  {t.not_found > 0 && <Leg c="var(--danger-dot)" n={t.not_found} label="кодов без товара" />}
                  <span style={css("flex:1")} />
                  <HButton onClick={() => setOpen(isOpen ? null : s.id)} className="au-reset" s="" hover="">
                    {isOpen ? "Свернуть" : "Подробнее"}
                  </HButton>
                  <HButton onClick={() => setHide(s)} className="au-reset" s="color:var(--text-4)" hover="color:var(--danger)">
                    Скрыть
                  </HButton>
                </div>
                {isOpen &&
                  (!detail ? (
                    <span className="sk" style={css("display:block;height:80px;margin-top:12px;border-radius:12px")} />
                  ) : (
                    <div className="wb-detail thin-scroll">
                      {detail.rows.map((r, i) => (
                        <div key={i} className="wb-drow">
                          <span style={css(CODE + ";font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{r.code}</span>
                          <MatchCell m={r.matches} />
                          <span className="wb-flow">
                            {r.matches.length ? (
                              <>
                                <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST[r.matches[0].stage].dot })} />
                                <span style={{ color: ST[r.matches[0].stage].fg }}>{ST[r.matches[0].stage].label}</span>
                              </>
                            ) : (
                              <>
                                <span style={mix("width:7px;height:7px;border-radius:50%", { background: "var(--danger-dot)" })} />
                                <span style={css("color:var(--danger)")}>нет товара</span>
                              </>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            );
          })}
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

const Leg = ({ c, n, label }: { c: string; n: number; label: string }) => (
  <span style={css(NUM + ";display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--text-3);white-space:nowrap")}>
    <span style={mix("width:7px;height:7px;border-radius:50%", { background: c })} />
    <b style={css("font-weight:500;color:var(--text-2)")}>{n}</b> {label}
  </span>
);

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
