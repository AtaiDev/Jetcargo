/**
 * Импорт Excel — мастер из четырёх шагов: файл → колонки → проверка → импорт.
 *
 *  - пока файла нет — большая зона «перетащите файл» и подсказка, как подготовить таблицу;
 *  - с файлом — полоса файла (лист, строки), слева сопоставление колонок, справа «Проверка»:
 *    что запишется, полоса новых / обновлений / дубликатов / ошибок, настройки и «Импортировать»;
 *  - ниже — строки файла с фильтром и пометками по каждой строке; в самом низу — история импортов.
 * Превью ничего не пишет. Существующие записи по умолчанию не меняются. Любой импорт можно отменить.
 */
import ImportHelp from "./ImportHelp";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import {
  commitImport,
  listImports,
  getImportTemplate,
  listShipments,
  previewImport,
  undoImport,
  type ImportBatch,
  type Shipment,
  type ImportField,
  type ImportOptions,
  type ImportPreview,
  type ImportRow,
  type ItemStatus,
} from "../api/domain";
import { Confirm, Empty, Tabs } from "../components/cargo";
import Select from "../components/Select";
import CountUp from "../design/CountUp";
import { MONO, css, mix } from "../design/css";
import { I_CHECK, I_CLOSE, I_EXCEL, Icon, Svg } from "../design/icons";
import { Page } from "../design/table";
import { HButton, ModalError, ST, StatusBadge } from "../design/ui";
import { STATUS_LABEL, date, dateTime, shortDateTime, som } from "../lib/cargo";
import { emit } from "../lib/events";
import ImportWaybill from "./ImportWaybill";
import { HomeHead } from "./overview/Home";

type Toast = (kind: "success" | "error", text: string) => void;
type RowFilter = "all" | ImportRow["action"] | "warn";

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
const CODE = MONO + ";letter-spacing:.02em";

const ACTION: Record<ImportRow["action"], { label: string; fg: string; dot: string; grad: string }> = {
  new: { label: "Новая", fg: "var(--ov-text)", dot: "var(--ov-ink)", grad: "var(--ov-ink)" },
  update: { label: "Обновится", fg: "var(--ov-text)", dot: "color-mix(in srgb,var(--ov-text) 55%,transparent)", grad: "color-mix(in srgb,var(--ov-text) 55%,transparent)" },
  duplicate: { label: "Дубликат", fg: "var(--ov-mute)", dot: "color-mix(in srgb,var(--ov-text) 22%,transparent)", grad: "color-mix(in srgb,var(--ov-text) 22%,transparent)" },
  error: { label: "Ошибка", fg: "#9C3B2E", dot: "#9C3B2E", grad: "#9C3B2E" },
};

/** Какие колонки понимает импорт — подсказка до выбора файла. */
const KNOWN = ["Имя клиента *", "Телефон", "Название товара *", "Код товара", "Количество", "Сумма", "Цена, ¥", "Реальная цена", "Статус", "Оплата", "Оплачено", "Дата заказа", "Разделить с", "Комментарий"];

export default function Import({ toast }: { toast: Toast }) {
  // Режим: заказы из таблицы или накладная из Китая (отмечает товары «В пути»). Запоминается в адресе.
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "waybill" ? "waybill" : "orders";
  const [handoff, setHandoff] = useState<File | null>(null);
  // сводка истории — справа от вкладок режима
  const [hist, setHist] = useState<ImportBatch[] | null>(null);
  const [ships, setShips] = useState<Shipment[] | null>(null);
  useEffect(() => {
    listImports()
      .then(setHist)
      .catch(() => setHist(null));
    listShipments()
      .then(setShips)
      .catch(() => setShips(null));
  }, []);
  async function downloadTemplate() {
    try {
      const blob = await getImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Jetcargo — шаблон импорта.xlsx";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      toast("error", "Не удалось скачать шаблон");
    }
  }
  const ago = (iso?: string) => {
    if (!iso) return "—";
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d <= 0 ? "сегодня" : d === 1 ? "вчера" : `${d} дн.`;
  };
  // сводка справа — своя для каждого режима
  const sum: { icon: ReactNode; value: string; label: string; title?: string }[] | null =
    mode === "waybill"
      ? ships && [
          { icon: <Icon name="batches" size={14} />, value: String(ships.length), label: "накладных" },
          { icon: <Svg paths={I_EXCEL} size={14} sw={1.9} />, value: ships.reduce((a, x) => a + (x.stats?.items || 0), 0).toLocaleString("ru-RU"), label: "товаров" },
          { icon: CLOCK, value: ago(ships[0]?.created_at), label: "последняя", title: ships[0] ? `${ships[0].filename} · ${dateTime(ships[0].created_at)}` : undefined },
        ]
      : hist &&
        (() => {
          const live = hist.filter((h) => !h.undone_at);
          return [
            { icon: <Icon name="batches" size={14} />, value: String(live.length), label: "импортов" },
            { icon: <Svg paths={I_EXCEL} size={14} sw={1.9} />, value: live.reduce((a, h) => a + (h.alive_items || 0), 0).toLocaleString("ru-RU"), label: "товаров" },
            { icon: CLOCK, value: ago(live[0]?.created_at), label: "последний", title: live[0] ? `${live[0].filename} · ${dateTime(live[0].created_at)}` : undefined },
          ];
        })();
  const setMode = (m: "orders" | "waybill") => {
    const next = new URLSearchParams(params);
    if (m === "waybill") next.set("mode", "waybill");
    else next.delete("mode");
    setParams(next, { replace: true });
  };
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<ImportOptions>({ on_duplicate: "skip" });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<ImportPreview["counts"] | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (f: File, o: ImportOptions) => {
    setBusy(true);
    setError("");
    try {
      const p = await previewImport(f, o);
      setPreview(p);
    } catch (e) {
      setPreview(null);
      setError(apiError(e, "Не удалось прочитать файл"));
    } finally {
      setBusy(false);
    }
  }, []);

  function pickFile(f: File | null) {
    setDone(null);
    setFile(f);
    setPreview(null);
    setFilter("all");
    const o: ImportOptions = { on_duplicate: "skip" };
    setOpts(o);
    if (f) run(f, o);
    if (inputRef.current) inputRef.current.value = "";
  }

  function change(next: ImportOptions) {
    setOpts(next);
    if (file) run(file, next);
  }

  // Смена листа: сопоставление и статус угадываются заново.
  const changeSheet = (sheet: string) => change({ on_duplicate: opts.on_duplicate, sheet });

  const setMapping = (field: ImportField, col: string) => {
    if (!preview) return;
    const mapping = { ...preview.mapping, [field]: col === "" ? null : Number(col) };
    change({ ...opts, sheet: preview.sheet, mapping, default_status: opts.default_status ?? preview.default_status });
  };

  async function doImport() {
    if (!file || !preview) return;
    const o = { ...opts, sheet: preview.sheet, mapping: preview.mapping, default_status: preview.default_status };
    const r = await commitImport(file, o);
    setConfirm(false);
    setDone(r.counts);
    toast("success", "Импорт выполнен");
    emit("cargo:changed");
    setHistoryKey((k) => k + 1);
    run(file, o); // превью обновится: теперь эти строки — дубликаты
  }

  const cnt = preview?.counts;
  const rows = (preview?.rows ?? []).filter((r) => (filter === "all" ? true : filter === "warn" ? r.warnings.length > 0 : r.action === filter));
  const toWrite = (cnt?.new ?? 0) + (cnt?.update ?? 0);
  const missing = preview?.missing_required.length ?? 0;
  const step = done ? 4 : !preview ? 1 : missing ? 2 : 3;
  const looksWaybill = !!preview && preview.headers.some((h) => /订单号|运单号|накладн/i.test(h));

  function openAsWaybill() {
    setHandoff(file);
    setPreview(null);
    setFile(null);
    setMode("waybill");
  }

  return (
    <Page size="wide">
      <div className="ov im2">
      <div className="wx-head im-top">
        <HomeHead title="Импорт Excel" />
        <span className="im-acts">
          {mode === "orders" && (
            <button type="button" className="im-act ink" onClick={downloadTemplate} title="Готовая таблица с нужными колонками и строкой-примером">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              Шаблон Excel
            </button>
          )}
          <button
            type="button"
            className="im-act"
            onClick={() => document.getElementById("im-history")?.scrollIntoView({ behavior: "smooth", block: "start" }) ?? window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}
            title="К истории загрузок"
          >
            {CLOCK}
            История
            {sum && <em>{sum[0].value}</em>}
          </button>
        </span>
      </div>
      <div className="im-modebar">
        <div className={"im-sw" + (mode === "waybill" ? " r" : "")} role="tablist">
          <span className="im-sw-th" aria-hidden />
          <button type="button" role="tab" aria-selected={mode === "orders"} className={mode === "orders" ? "on" : ""} onClick={() => setMode("orders")}>
            Заказы из таблицы
          </button>
          <button type="button" className="im-sw-mid" onClick={() => setMode(mode === "orders" ? "waybill" : "orders")} title="Переключить" aria-label="Переключить режим">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path className="a-r" d="M4 8h15 M15 4l4 4-4 4" />
              <path className="a-l" d="M20 16H5 M9 12l-4 4 4 4" />
            </svg>
          </button>
          <button type="button" role="tab" aria-selected={mode === "waybill"} className={mode === "waybill" ? "on" : ""} onClick={() => setMode("waybill")}>
            Накладная из Китая
          </button>
        </div>
        {mode === "waybill" ? <WaybillSteps /> : <Stepper step={step} />}
      </div>

      {mode === "waybill" ? (
        <ImportWaybill toast={toast} initialFile={handoff} />
      ) : (
        <>
          <input ref={inputRef} type="file" accept=".xlsx" style={css("display:none")} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          {looksWaybill && (
            <section className="im-waybill-hint">
              <span className="im-mode-i" style={css("background:var(--ov-stone);color:var(--ov-text)")}>
                <Icon name="batches" size={18} />
              </span>
              <span style={css("flex:1;min-width:0")}>
                <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>Похоже, это накладная из Китая</span>
                <span style={css("display:block;font-size:12.5px;color:var(--text-3)")}>В ней номера заказов и накладной, а не клиенты и товары. Откройте её как накладную — найдём товары по коду и отметим «В пути».</span>
              </span>
              <HButton onClick={openAsWaybill} className="wb-go" s="" hover="">
                Открыть как накладную
              </HButton>
            </section>
          )}
    
          {!preview ? (
            <Start busy={busy} fileName={file?.name} onPick={() => inputRef.current?.click()} onDrop={pickFile} />
          ) : (
            cnt && (
              <>
                {/* Файл */}
                <section className="im-file">
                  <span className="im-file-icon">
                    <Svg paths={I_EXCEL} size={22} sw={1.7} />
                  </span>
                  <div style={css("flex:1 1 240px;min-width:0")}>
                    <div style={css("font-size:15px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{file?.name ?? preview.filename}</div>
                    <div style={css(NUM + ";font-size:12.5px;color:var(--text-3);margin-top:2px")}>
                      {cnt.total} {plural(cnt.total, "строка", "строки", "строк")} с данными · заголовки в строке {preview.header_row}
                      {busy ? " · пересчитываю…" : ""}
                    </div>
                  </div>
                  {preview.sheets.length > 1 && (
                    <span style={css("display:flex;align-items:center;gap:8px")}>
                      <span style={css("font-size:12.5px;color:var(--text-3)")}>Лист</span>
                      <Select
                        value={preview.sheet}
                        onChange={changeSheet}
                        width={190}
                        height={36}
                        ariaLabel="Лист"
                        menuMinWidth={220}
                        options={preview.sheets.map((s) => ({ value: s.name, label: s.name, hint: `${s.rows} строк` }))}
                      />
                    </span>
                  )}
                  {preview.sheets.length === 1 && <span className="im-chip">лист «{preview.sheet}»</span>}
                  <HButton onClick={() => inputRef.current?.click()} className="im-ghost" s="" hover="">
                    Другой файл
                  </HButton>
                  <HButton onClick={() => pickFile(null)} title="Убрать файл" aria-label="Убрать файл" className="im-x" s="" hover="">
                    <Svg paths={I_CLOSE} size={15} />
                  </HButton>
                </section>
    
                {error && <ModalError text={error} />}
                {done && (
                  <div className="im-done">
                    <span style={css("width:34px;height:34px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#34D399,#16A34A)")}>
                      <Svg paths={I_CHECK} size={17} sw={2.6} />
                    </span>
                    <span style={css("min-width:0")}>
                      <span style={css("display:block;font-size:14px;font-weight:500;color:var(--text)")}>Импорт выполнен</span>
                      <span style={css(NUM + ";display:block;font-size:12.5px;color:var(--text-3)")}>
                        новых {done.new} · обновлено {done.update} · пропущено дубликатов {done.duplicate} · с ошибками {done.error} — отменить можно в истории ниже
                      </span>
                    </span>
                  </div>
                )}
    
                <div className="im-work">
                  {/* Колонки */}
                  <section className="im-card">
                    <CardHead n={2} title="Колонки" hint="какая колонка файла куда идёт — проверьте, всё ли угадано" />
                    <div className="im-map">
                      {preview.fields.map((f) => {
                        const v = preview.mapping[f.key];
                        const mapped = v !== null && v !== undefined;
                        const bad = f.required && !mapped;
                        return (
                          <div key={f.key} className={"im-map-row" + (bad ? " bad" : mapped ? " ok" : "")}>
                            <span className="im-map-mark">{bad ? "!" : mapped ? <Svg paths={I_CHECK} size={11} sw={3} /> : null}</span>
                            <span style={css("min-width:0")}>
                              <span style={mix("display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", { color: bad ? "var(--danger)" : "var(--text)" })}>
                                {f.label}
                                {f.required && <span style={css("color:var(--danger)")}> *</span>}
                              </span>
                            </span>
                            <Select
                              value={mapped ? String(v) : ""}
                              onChange={(x) => setMapping(f.key, x)}
                              height={34}
                              fontSize={12.5}
                              invalid={bad}
                              ariaLabel={f.label}
                              options={[{ value: "", label: "— не импортировать —" }, ...preview.headers.flatMap((h, i) => (h ? [{ value: String(i), label: h, hint: colName(i) }] : []))]}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="im-note">
                      <b style={css("font-weight:500;color:var(--text-2)")}>Сумма</b> — цена для клиента, по ней считаются оплата и долг. <b style={css("font-weight:500;color:var(--text-2)")}>Реальная цена</b> — за
                      сколько выкуплен товар; прибыль = Сумма − Реальная цена.
                    </div>
                  </section>
    
                  {/* Проверка */}
                  <aside className="im-card im-check">
                    <CardHead n={3} title="Проверка" hint="ничего не записано, пока не нажмёте «Импортировать»" />
                    <div style={css("display:flex;align-items:baseline;gap:10px;margin-top:18px")}>
                      <span style={css(NUM + ";font-size:40px;font-weight:600;letter-spacing:-.03em;line-height:1;color:var(--text)")}>
                        <CountUp text={String(toWrite)} />
                      </span>
                      <span style={css("font-size:13.5px;color:var(--text-3)")}>
                        {plural(toWrite, "запись запишется", "записи запишутся", "записей запишется")} из {cnt.total}
                      </span>
                    </div>
                    <div className="im-bar">
                      {(["new", "update", "duplicate", "error"] as const).map((k) => (cnt[k] > 0 ? <span key={k} style={{ flexGrow: cnt[k], background: ACTION[k].grad }} /> : null))}
                    </div>
                    <div style={css("display:flex;flex-direction:column;gap:2px;margin-top:10px")}>
                      {(
                        [
                          ["new", "Новые записи", "добавятся"],
                          ["update", "Обновятся", "изменятся отличающиеся поля"],
                          ["duplicate", "Дубликаты", "уже есть — пропустятся"],
                          ["error", "С ошибками", "пропустятся"],
                        ] as const
                      ).map(([k, label, hint]) => (
                        <button key={k} type="button" className={"im-leg" + (filter === k ? " on" : "")} onClick={() => setFilter(filter === k ? "all" : k)}>
                          <span style={mix("width:9px;height:9px;border-radius:3px;flex:none", { background: ACTION[k].dot })} />
                          <span style={css("font-size:13px;color:var(--text)")}>{label}</span>
                          <span className="im-leg-hint" style={css("font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0")}>{hint}</span>
                          <span style={mix(NUM + ";margin-left:auto;font-size:14px;font-weight:500", { color: cnt[k] ? ACTION[k].fg : "var(--text-5)" })}>{cnt[k]}</span>
                        </button>
                      ))}
                    </div>
                    <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px")}>
                      <MiniStat label="Новых клиентов" value={cnt.new_customers} />
                      <MiniStat label="Предупреждения" value={cnt.warnings} tone={cnt.warnings ? "var(--amber)" : undefined} onClick={cnt.warnings ? () => setFilter(filter === "warn" ? "all" : "warn") : undefined} />
                    </div>
    
                    <div style={css("display:flex;flex-direction:column;gap:12px;margin-top:16px;padding-top:16px;border-top:1px dashed var(--border-2)")}>
                      <Field label="Статус, если в строке не указан">
                        <Select<ItemStatus>
                          value={preview.default_status}
                          onChange={(v) => change({ ...opts, sheet: preview.sheet, mapping: preview.mapping, default_status: v })}
                          width="100%"
                          height={36}
                          ariaLabel="Статус по умолчанию"
                          options={(["ordered", "in_stock", "issued"] as ItemStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s], dot: ST[s].dot }))}
                        />
                      </Field>
                      <Field label="Если запись уже есть в системе">
                        <div className="im-seg">
                          {(
                            [
                              ["skip", "Пропустить"],
                              ["update", "Обновить поля"],
                            ] as const
                          ).map(([k, label]) => (
                            <button
                              key={k}
                              type="button"
                              className={(opts.on_duplicate ?? "skip") === k ? "on" : ""}
                              onClick={() => (opts.on_duplicate ?? "skip") !== k && change({ ...opts, sheet: preview.sheet, mapping: preview.mapping, on_duplicate: k })}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </Field>
                    </div>
    
                    {missing > 0 && <div className="im-warn">Сопоставьте обязательные колонки: {preview.missing_required.join(", ")}</div>}
                    <HButton
                      disabled={!toWrite || missing > 0 || busy}
                      onClick={() => setConfirm(true)}
                      className={"im-go" + (toWrite && !missing && !busy ? " on" : "")}
                      s=""
                      hover=""
                    >
                      <Icon name="import" size={17} />
                      {toWrite ? `Импортировать ${toWrite} ${plural(toWrite, "запись", "записи", "записей")}` : "Нечего импортировать"}
                    </HButton>
                  </aside>
                </div>
    
                {/* Строки файла */}
                <section className="im-card" style={css("padding:0;overflow:hidden")}>
                  <div style={css("display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:16px 18px")}>
                    <div style={css("min-width:0;margin-right:auto")}>
                      <div style={css("font-size:15px;font-weight:500;color:var(--text)")}>Строки файла</div>
                      <div style={css("font-size:12.5px;color:var(--text-4)")}>что произойдёт с каждой строкой — ошибки и предупреждения подписаны прямо под ней</div>
                    </div>
                    <Tabs<RowFilter>
                      value={filter}
                      onChange={setFilter}
                      tabs={[
                        { key: "all", label: "Все", count: cnt.total },
                        { key: "new", label: "Новые", count: cnt.new, dot: ACTION.new.dot },
                        { key: "update", label: "Обновятся", count: cnt.update, dot: ACTION.update.dot },
                        { key: "duplicate", label: "Дубликаты", count: cnt.duplicate, dot: ACTION.duplicate.dot },
                        { key: "error", label: "Ошибки", count: cnt.error, dot: ACTION.error.dot },
                        { key: "warn", label: "Предупреждения", count: cnt.warnings, dot: "var(--amber-dot)" },
                      ]}
                    />
                  </div>
                  <PreviewTable rows={rows} />
                </section>
              </>
            )
          )}
    
          {!preview && error && (
            <div style={css("margin-top:12px")}>
              <ModalError text={error} />
            </div>
          )}
    
          <History key={historyKey} toast={toast} />
    
          {confirm && cnt && (
            <Confirm
              title="Подтвердите импорт"
              danger={false}
              confirmLabel="Импортировать"
              text={
                <>
                  Будет создано записей: <b>{cnt.new}</b>
                  {cnt.update ? (
                    <>
                      , обновлено: <b>{cnt.update}</b>
                    </>
                  ) : null}
                  . Дубликаты ({cnt.duplicate}) и строки с ошибками ({cnt.error}) будут пропущены. Существующие данные не удаляются; импорт можно отменить в истории ниже.
                </>
              }
              onClose={() => setConfirm(false)}
              onConfirm={doImport}
            />
          )}
        </>
      )}
      </div>
    </Page>
  );
}

// --- Шаги ----------------------------------------------------------------------------------------

const CLOCK = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

/** Шаги накладной — как у заказов, рядом с вкладками. */
function WaybillSteps() {
  const steps = [
    ["Файл", "накладная .xlsx"],
    ["Сверка", "найдём коды"],
    ["В пути", "отметим товары"],
  ];
  return (
    <div className="im-steps wb">
      {steps.map(([t, h], i) => (
        <div key={t} className={"im-step" + (i === 0 ? " now" : "")}>
          <span className="im-step-n">{i + 1}</span>
          <span style={css("min-width:0")}>
            <span style={css("display:block;font-size:13.5px;font-weight:500")}>{t}</span>
            <span style={css("display:block;font-size:12px;opacity:.75")}>{h}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const steps = [
    ["Файл", "выберите .xlsx"],
    ["Колонки", "сопоставьте поля"],
    ["Проверка", "посмотрите итог"],
    ["Импорт", "запишем и всё"],
  ];
  return (
    <div className="im-steps">
      {steps.map(([t, h], i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "now" : "";
        return (
          <div key={t} className={"im-step " + state}>
            <span className="im-step-n">{n < step ? <Svg paths={I_CHECK} size={13} sw={3} /> : n}</span>
            <span style={css("min-width:0")}>
              <span style={css("display:block;font-size:13.5px;font-weight:500")}>{t}</span>
              <span style={css("display:block;font-size:12px;opacity:.75")}>{h}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CardHead({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div style={css("display:flex;align-items:center;gap:12px")}>
      <span style={css(NUM + ";width:32px;height:32px;border-radius:10px;flex:none;display:grid;place-items:center;font-size:14px;font-weight:600;color:var(--ov-ink-fg);background:var(--ov-ink)")}>{n}</span>
      <span style={css("min-width:0")}>
        <span style={css("display:block;font-size:15px;font-weight:500;color:var(--text)")}>{title}</span>
        <span style={css("display:block;font-size:12.5px;color:var(--text-4)")}>{hint}</span>
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span style={css("display:block;font-size:12px;color:var(--text-3);margin-bottom:6px")}>{label}</span>
      {children}
    </div>
  );
}

function MiniStat({ label, value, tone, onClick }: { label: string; value: number; tone?: string; onClick?: () => void }) {
  const body = (
    <>
      <span style={css("display:block;font-size:12px;color:var(--text-3)")}>{label}</span>
      <span style={mix(NUM + ";display:block;margin-top:2px;font-size:18px;font-weight:500", { color: tone ?? "var(--text)" })}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="im-mini click" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="im-mini">{body}</div>
  );
}

// --- Старт: выбор файла --------------------------------------------------------------------------

function Start({ busy, fileName, onPick, onDrop }: { busy: boolean; fileName?: string; onPick: () => void; onDrop: (f: File | null) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="im-start">
      <div
        className={"im-drop" + (over ? " over" : "") + (busy ? " busy" : "")}
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
        <span className="im-drop-icon">
          <Svg paths={I_EXCEL} size={36} sw={1.5} />
        </span>
        {busy ? (
          <>
            <span style={css("font-size:17px;font-weight:500;color:var(--text)")}>Читаю файл…</span>
            <span style={css("font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%")}>{fileName}</span>
            <span className="im-progress">
              <span />
            </span>
          </>
        ) : (
          <>
            <span style={css("font-size:18px;font-weight:500;color:var(--text)")}>{over ? "Отпустите — прочитаем файл" : "Перетащите файл Excel сюда"}</span>
            <span style={css("font-size:13px;color:var(--text-3)")}>или нажмите, чтобы выбрать · формат .xlsx</span>
            <span className="im-pick">Выбрать файл</span>
          </>
        )}
      </div>

      <ImportHelp
        title="Как должен выглядеть файл"
        sub="первая строка — заголовки"
        cols={KNOWN}
        tips={[
          ["sheet", "Google Таблицы", "Файл → Скачать → .xlsx"],
          ["eye", "Сначала превью", "без «Да» не запишется"],
          ["undo", "Можно отменить", "одной кнопкой в истории"],
        ]}
      />
    </div>
  );
}

// --- Строки файла --------------------------------------------------------------------------------

function PreviewTable({ rows }: { rows: ImportRow[] }) {
  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [rows.length]);
  return (
    <div style={css("overflow-x:auto;border-top:1px solid var(--border-2)")}>
      <div style={{ minWidth: 1040 }}>
        <div className="im-row im-head">
          <span>Стр.</span>
          <span>Действие</span>
          <span>Клиент</span>
          <span>Товар и код</span>
          <span style={css("text-align:right")}>Кол.</span>
          <span style={css("text-align:right")}>Сумма</span>
          <span style={css("text-align:right")}>Выкуп</span>
          <span>Статус</span>
          <span>Оплата</span>
          <span>Дата</span>
        </div>
        {rows.length === 0 ? (
          <Empty icon="import" title="Нет строк в этой категории" />
        ) : (
          rows.slice(0, limit).map((r) => {
            const a = ACTION[r.action];
            const v = r.values;
            const notes = r.errors.length + r.warnings.length + r.changes.length;
            return (
              <div key={r.row} className="im-line" style={{ ["--im" as string]: a.dot }}>
                <div className="im-row">
                  <span style={css(NUM + ";color:var(--text-4)")}>{r.row}</span>
                  <span style={mix("display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;white-space:nowrap", { color: a.fg })}>
                    <span style={mix("width:7px;height:7px;border-radius:50%", { background: a.dot })} />
                    {a.label}
                  </span>
                  <span style={css("min-width:0")}>
                    <span style={css("display:flex;align-items:baseline;gap:6px;min-width:0")}>
                      <span style={css("font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{v?.customer_name || "—"}</span>
                      {r.new_customer && <span className="im-new">новый</span>}
                    </span>
                    <span style={css(NUM + ";display:block;font-size:11.5px;color:var(--text-4)")}>{v?.customer_phone}</span>
                  </span>
                  <span style={css("min-width:0")}>
                    <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{v?.name || "—"}</span>
                    <span style={css(CODE + ";display:block;font-size:11px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{v?.code || "без кода"}</span>
                  </span>
                  <span style={css(NUM + ";text-align:right;font-size:13px;color:var(--text-2)")}>{v?.qty ?? "—"}</span>
                  <span style={css(NUM + ";text-align:right;font-size:13px;color:var(--text)")}>{v ? som(v.price) : "—"}</span>
                  <span style={css(NUM + ";text-align:right;font-size:13px;color:var(--text-3)")}>{v?.real_price !== null && v?.real_price !== undefined ? som(v.real_price) : "—"}</span>
                  <span>{v && <StatusBadge status={v.status} size="sm" />}</span>
                  <span>{v && <StatusBadge status={v.paid_amount ? "partial" : v.payment} size="sm" label={v.paid_amount ? som(v.paid_amount) : undefined} />}</span>
                  <span style={css(NUM + ";font-size:12px;color:var(--text-3)")}>{v ? date(v.order_date) : "—"}</span>
                </div>
                {notes > 0 && (
                  <div className="im-notes">
                    {r.errors.map((e) => (
                      <span key={e} className="im-msg err">
                        ✕ {e}
                      </span>
                    ))}
                    {r.warnings.map((w) => (
                      <span key={w} className="im-msg warn">
                        ! {w}
                      </span>
                    ))}
                    {r.changes.map((c) => (
                      <span key={c.field} className="im-msg chg">
                        {r.action === "update" ? "изменится" : "отличается"}: {c.field} {String(c.from ?? "—")} → {String(c.to)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
        {rows.length > limit && (
          <div style={css("padding:12px;text-align:center")}>
            <HButton onClick={() => setLimit((l) => l + 200)} className="im-ghost" s="" hover="">
              Показать ещё ({rows.length - limit})
            </HButton>
          </div>
        )}
      </div>
    </div>
  );
}

// --- История ------------------------------------------------------------------------------------

function History({ toast }: { toast: Toast }) {
  const [rows, setRows] = useState<ImportBatch[] | null>(null);
  const [undo, setUndo] = useState<ImportBatch | null>(null);
  const [flt, setFlt] = useState<"all" | "live" | "undone">("all");
  const [all, setAll] = useState(false);
  const load = () =>
    listImports()
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  // группы по дням: «Сегодня», «Вчера», «29 сентября»
  const p2 = (n: number) => String(n).padStart(2, "0");
  const hm = (iso: string) => {
    const d = new Date(iso);
    return p2(d.getHours()) + ":" + p2(d.getMinutes());
  };
  const dayOf = (iso: string) => {
    const d = new Date(iso);
    const t = new Date();
    const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    if (d.toDateString() === t.toDateString()) return "Сегодня";
    if (d.toDateString() === y.toDateString()) return "Вчера";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(d.getFullYear() !== t.getFullYear() ? { year: "numeric" } : {}) });
  };
  const groups: [string, ImportBatch[]][] = [];
  const nUndone = (rows ?? []).filter((r) => r.undone_at).length;
  const nLive = (rows ?? []).length - nUndone;
  const picked = (rows ?? []).filter((r) => (flt === "all" ? true : flt === "live" ? !r.undone_at : !!r.undone_at));
  const LIMIT = 8;
  const shown = all ? picked : picked.slice(0, LIMIT);
  for (const r of shown) {
    const d = dayOf(r.created_at);
    const g = groups[groups.length - 1];
    if (g && g[0] === d) g[1].push(r);
    else groups.push([d, [r]]);
  }
  const n = (v: number) => v.toLocaleString("ru-RU");
  const UNDO = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14L4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3" />
    </svg>
  );

  return (
    <section id="im-history" className="im-card ihs" style={css("margin-top:16px;scroll-margin-top:90px")}>
      <div className="ihs-head">
        <span className="ihs-ttl">
          История импортов
          {rows && rows.length > 0 && <em>{rows.length}</em>}
        </span>
        {rows && rows.length > 0 && (
          <span className="ihs-flt" role="tablist">
            {(
              [
                ["all", "Все", rows.length],
                ["live", "Активные", nLive],
                ["undone", "Отменённые", nUndone],
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
      {!rows || rows.length === 0 ? (
        <Empty icon="import" title="Импортов ещё не было" text="Здесь появится каждый импорт — его можно будет отменить" />
      ) : (
        <div className="ihs-list">
          {groups.map(([day, list], gi) => (
            <div key={day} className="ihs-day">
              <div className="ihs-date">{day}</div>
              {list.map((r, k) => {
                const seg: [string, number, string][] = (
                  [
                    ["c", r.created_items, "новых"],
                    ["u", r.updated_items, "обновлено"],
                    ["s", r.skipped, "пропущено"],
                    ["e", r.errors, plural(r.errors, "ошибка", "ошибки", "ошибок")],
                  ] as [string, number, string][]
                ).filter((x) => x[1] > 0);
                return (
                  <div key={r.id} className={"ihs-row" + (r.undone_at ? " undone" : "") + (gi === 0 && k === 0 ? " fresh" : "")} style={{ ["--k" as string]: k }}>
                    <span className="ihs-time">{hm(r.created_at)}</span>
                    <span className="ihs-rail">
                      <i />
                    </span>
                    <span className="ihs-file">
                      <span className="ihs-ic">
                        <Svg paths={I_EXCEL} size={17} sw={1.7} />
                      </span>
                      <span className="ihs-fn">
                        <b title={r.filename}>{r.filename}</b>
                        <small>
                          <span className="ihs-tm">{hm(r.created_at)} · </span>лист «{r.sheet}» · {r.user_login ?? "—"}
                        </small>
                      </span>
                    </span>
                    <span className="ihs-res">
                      <span className="ihs-bar">
                        {seg.map(([c, v]) => (
                          <i key={c} className={c} style={{ flexGrow: v }} />
                        ))}
                      </span>
                      <span className="ihs-leg">
                        {seg.map(([c, v, l]) => (
                          <span key={c} className={c}>
                            <i />
                            <b>{n(v)}</b> {l}
                          </span>
                        ))}
                        <span className="tot">
                          из {n(r.rows_total)}<span className="ihs-tw"> {plural(r.rows_total, "строки", "строк", "строк")}</span>
                        </span>
                      </span>
                    </span>
                    <span className={"ihs-live" + (!r.undone_at && r.alive_items >= r.created_items ? " full" : "")} title={r.undone_at ? "Отменён " + shortDateTime(r.undone_at) : undefined}>
                      {r.undone_at && <Ring p={0} off />}
                      {r.undone_at ? (
                        <span>
                          <b>отменён</b>
                          <small>{shortDateTime(r.undone_at)}</small>
                        </span>
                      ) : (
                        <span>
                          <b>{n(r.alive_items)}</b>
                          <small>в системе</small>
                        </span>
                      )}
                    </span>
                    <span className="ihs-act">
                      {r.undone_at ? (
                        <span className="ihs-gone" title="Импорт отменён">
                          {UNDO}
                        </span>
                      ) : (
                        <button type="button" className="ihs-undo" onClick={() => setUndo(r)}>
                          {UNDO}
                          Отменить
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {picked.length > LIMIT && (
            <button type="button" className="ihs-more" onClick={() => setAll(!all)}>
              {all ? "Свернуть" : `Показать все · ещё ${picked.length - LIMIT}`}
            </button>
          )}
        </div>
      )}
      {undo && (
        <Confirm
          title="Отменить импорт?"
          confirmLabel="Отменить импорт"
          text={
            <>
              Записи, созданные импортом «{undo.filename}» ({undo.alive_items} шт.), и его оплаты будут скрыты из системы (мягкое удаление — в базе останутся). Изменения, внесённые в
              существующие записи в режиме «обновить», не откатываются.
            </>
          }
          onClose={() => setUndo(null)}
          onConfirm={async () => {
            await undoImport(undo.id);
            setUndo(null);
            toast("success", "Импорт отменён");
            emit("cargo:changed");
            load();
          }}
        />
      )}
    </section>
  );
}

/** Кольцо доли: сколько записей импорта ещё в системе; полное — с галочкой. */
function Ring({ p, off }: { p: number; off?: boolean }) {
  const v = Math.max(0, Math.min(1, p));
  return (
    <svg className={"ihs-ring" + (off ? " off" : "")} width="30" height="30" viewBox="0 0 36 36" aria-hidden>
      <circle cx="18" cy="18" r="15" className="bg" />
      {!off && <circle cx="18" cy="18" r="15" className="fg" pathLength={100} strokeDasharray={`${v * 100} 100`} />}
      {off ? <path d="M13.5 18.5l-3-3 3-3 M10.5 15.5h11a4 4 0 0 1 0 8h-2" className="ic" /> : v >= 1 ? <path d="M12.5 18.5l3.5 3.5 7.5-7.5" className="ic" /> : null}
    </svg>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Индекс колонки → буква как в Excel: 0 → A, 26 → AA. */
function colName(i: number): string {
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
