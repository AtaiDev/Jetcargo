/**
 * Импорт Excel: файл → превью (ничего не пишется) → подтверждение → импорт.
 *
 * Превью показывает, что именно произойдёт: новые записи, обновления (только если
 * включено), дубликаты (пропускаются), ошибки и предупреждения по каждой строке.
 * Существующие записи по умолчанию не меняются. Любой импорт можно отменить.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { apiError } from "../api/client";
import {
  commitImport,
  listImports,
  previewImport,
  undoImport,
  type ImportBatch,
  type ImportField,
  type ImportOptions,
  type ImportPreview,
  type ImportRow,
  type ItemStatus,
} from "../api/domain";
import { Confirm, Empty, Tabs } from "../components/cargo";
import Select from "../components/Select";
import { MONO, css, mix } from "../design/css";
import { I_EXCEL, Icon, Svg } from "../design/icons";
import { PANEL, Page, THEAD } from "../design/table";
import { HButton, ModalError, StatusBadge, ST, btnGhost, btnPrimary } from "../design/ui";
import { STATUS_LABEL, date, dateTime, som } from "../lib/cargo";
import { emit } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type RowFilter = "all" | ImportRow["action"] | "warn";

const ACTION: Record<ImportRow["action"], { label: string; fg: string; bg: string }> = {
  new: { label: "Новая", fg: "var(--green)", bg: "var(--green-tint)" },
  update: { label: "Обновится", fg: "var(--accent-strong)", bg: "var(--accent-tint)" },
  duplicate: { label: "Дубликат", fg: "var(--text-3)", bg: "var(--muted-bg)" },
  error: { label: "Ошибка", fg: "var(--danger)", bg: "var(--danger-tint)" },
};

export default function Import({ toast }: { toast: Toast }) {
  const [file, setFile] = useState<File | null>(null);
  const [opts, setOpts] = useState<ImportOptions>({ on_duplicate: "skip" });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RowFilter>("all");
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<string>("");
  const [historyKey, setHistoryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (f: File, o: ImportOptions) => {
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
    },
    []
  );

  function pickFile(f: File | null) {
    setDone("");
    setFile(f);
    setPreview(null);
    const o: ImportOptions = { on_duplicate: "skip" };
    setOpts(o);
    if (f) run(f, o);
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
    setDone(`Импортировано: новых ${r.counts.new}, обновлено ${r.counts.update}, пропущено дубликатов ${r.counts.duplicate}, с ошибками ${r.counts.error}`);
    toast("success", "Импорт выполнен");
    emit("cargo:changed");
    setHistoryKey((k) => k + 1);
    run(file, o); // превью обновится: теперь эти строки — дубликаты
  }

  const cnt = preview?.counts;
  const rows = (preview?.rows ?? []).filter((r) =>
    filter === "all" ? true : filter === "warn" ? r.warnings.length > 0 : r.action === filter
  );
  const toWrite = (cnt?.new ?? 0) + (cnt?.update ?? 0);

  return (
    <Page size="wide">
      {/* Шаг 1 — файл */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pickFile(e.dataTransfer.files?.[0] ?? null);
        }}
        style={css(
          "background:var(--surface);border:1.5px dashed var(--border-strong);border-radius:12px;padding:18px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap"
        )}
      >
        <span style={css("display:flex;color:var(--green)")}>
          <Svg paths={I_EXCEL} size={30} sw={1.5} />
        </span>
        <div style={css("flex:1;min-width:220px")}>
          <div style={css("font-size:14px;font-weight:600")}>{file ? file.name : "Перетащите файл Excel сюда или выберите"}</div>
          <div style={css("font-size:12px;color:var(--text-3);margin-top:2px")}>
            Формат .xlsx. Из Google Таблиц: Файл → Скачать → Microsoft Excel. Сначала будет превью — ничего не запишется без подтверждения.
          </div>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx" style={css("display:none")} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
        <HButton onClick={() => inputRef.current?.click()} s={btnGhost} hover="border-color:var(--accent)">
          {file ? "Другой файл" : "Выбрать файл"}
        </HButton>
      </div>

      {error && (
        <div style={css("margin-top:12px")}>
          <ModalError text={error} />
        </div>
      )}
      {done && (
        <div style={css("margin-top:12px;padding:11px 14px;border-radius:9px;background:var(--green-tint);color:var(--green);font-size:13px;font-weight:500")}>✓ {done}</div>
      )}
      {busy && <div style={css("margin-top:12px;font-size:12.5px;color:var(--text-3)")}>Читаю файл…</div>}

      {preview && cnt && (
        <div style={css("display:flex;flex-direction:column;gap:14px;margin-top:14px")}>
          {/* Шаг 2 — настройки */}
          <div style={css(PANEL + ";padding:14px 16px;display:flex;flex-direction:column;gap:12px")}>
            <div style={css("display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end")}>
              <div>
                <span style={css("display:block;font-size:11.5px;color:var(--text-2);margin-bottom:4px")}>Лист</span>
                <Select
                  value={preview.sheet}
                  onChange={changeSheet}
                  width={200}
                  ariaLabel="Лист"
                  menuMinWidth={220}
                  options={preview.sheets.map((s) => ({ value: s.name, label: s.name, hint: `${s.rows} строк` }))}
                />
              </div>
              <div>
                <span style={css("display:block;font-size:11.5px;color:var(--text-2);margin-bottom:4px")}>Статус, если в строке не указан</span>
                <Select<ItemStatus>
                  value={preview.default_status}
                  onChange={(v) => change({ ...opts, sheet: preview.sheet, mapping: preview.mapping, default_status: v })}
                  width={170}
                  ariaLabel="Статус по умолчанию"
                  options={(["ordered", "in_stock", "issued"] as ItemStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s], dot: ST[s].dot }))}
                />
              </div>
              <div>
                <span style={css("display:block;font-size:11.5px;color:var(--text-2);margin-bottom:4px")}>Если запись уже есть в системе</span>
                <Select<"skip" | "update">
                  value={opts.on_duplicate ?? "skip"}
                  onChange={(v) => change({ ...opts, sheet: preview.sheet, mapping: preview.mapping, on_duplicate: v })}
                  width={290}
                  ariaLabel="Дубликаты"
                  options={[
                    { value: "skip", label: "Пропустить (не менять существующие)" },
                    { value: "update", label: "Обновить отличающиеся поля" },
                  ]}
                />
              </div>
              <span style={css("font-size:11.5px;color:var(--text-4)")}>строка заголовков: {preview.header_row}</span>
            </div>

            <div>
              <div style={css("font-size:12px;font-weight:600;margin-bottom:6px")}>Сопоставление колонок</div>
              <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px")}>
                {preview.fields.map((f) => {
                  const v = preview.mapping[f.key];
                  const missing = f.required && (v === null || v === undefined);
                  return (
                    <div key={f.key} style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
                      <span style={mix("font-size:11.5px", { color: missing ? "var(--danger)" : "var(--text-2)" })}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </span>
                      <Select
                        value={v === null || v === undefined ? "" : String(v)}
                        onChange={(x) => setMapping(f.key, x)}
                        height={32}
                        fontSize={12.5}
                        invalid={missing}
                        ariaLabel={f.label}
                        options={[
                          { value: "", label: "— не импортировать —" },
                          ...preview.headers.flatMap((h, i) => (h ? [{ value: String(i), label: h, hint: colName(i) }] : [])),
                        ]}
                      />
                    </div>
                  );
                })}
              </div>
              <div style={css("font-size:11.5px;color:var(--text-4);margin-top:6px;line-height:1.5")}>
                «Сумма» — цена для клиента (по ней считаются оплата и долг). «Реальная цена» — за сколько товар выкуплен на маркетплейсе;
                прибыль = Сумма − Реальная цена.
              </div>
            </div>
          </div>

          {/* Шаг 3 — итог превью */}
          <div style={css("display:flex;flex-wrap:wrap;gap:10px")}>
            <Count label="Строк в файле" value={cnt.total} />
            <Count label="Новых записей" value={cnt.new} color="var(--green)" />
            <Count label="Обновится" value={cnt.update} color="var(--accent-strong)" />
            <Count label="Дубликатов (пропуск)" value={cnt.duplicate} color="var(--text-3)" />
            <Count label="С ошибками (пропуск)" value={cnt.error} color={cnt.error ? "var(--danger)" : undefined} />
            <Count label="С предупреждениями" value={cnt.warnings} color={cnt.warnings ? "var(--amber)" : undefined} />
            <Count label="Новых клиентов" value={cnt.new_customers} />
          </div>

          {preview.missing_required.length > 0 && <ModalError text={`Не сопоставлены обязательные поля: ${preview.missing_required.join(", ")}`} />}

          <div style={css("display:flex;flex-wrap:wrap;gap:10px;align-items:center")}>
            <Tabs<RowFilter>
              value={filter}
              onChange={setFilter}
              tabs={[
                { key: "all", label: "Все", count: cnt.total },
                { key: "new", label: "Новые", count: cnt.new },
                { key: "update", label: "Обновятся", count: cnt.update },
                { key: "duplicate", label: "Дубликаты", count: cnt.duplicate },
                { key: "error", label: "Ошибки", count: cnt.error },
                { key: "warn", label: "Предупреждения", count: cnt.warnings },
              ]}
            />
            <div style={css("flex:1")} />
            <HButton
              disabled={!toWrite || preview.missing_required.length > 0 || busy}
              onClick={() => setConfirm(true)}
              s={btnPrimary + ";height:40px;opacity:" + (toWrite && !preview.missing_required.length ? 1 : 0.5)}
              hover="background:var(--accent-hover)"
            >
              Импортировать {toWrite ? `(${toWrite})` : ""}
            </HButton>
          </div>

          <PreviewTable rows={rows} />
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
              . Дубликаты ({cnt.duplicate}) и строки с ошибками ({cnt.error}) будут пропущены. Существующие данные не удаляются; импорт можно
              отменить в истории ниже.
            </>
          }
          onClose={() => setConfirm(false)}
          onConfirm={doImport}
        />
      )}
    </Page>
  );
}

function Count({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={css("flex:1;min-width:130px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 13px")}>
      <div style={css("font-size:11.5px;color:var(--text-3)")}>{label}</div>
      <div style={mix(MONO + ";font-size:20px;font-weight:600", { color: color ?? "var(--text)" })}>{value}</div>
    </div>
  );
}

function PreviewTable({ rows }: { rows: ImportRow[] }) {
  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [rows.length]);
  const GRID = "54px 96px 1.2fr 1.6fr 1fr 44px 90px 90px 96px 96px 84px";
  return (
    <div style={css(PANEL + ";overflow:auto")}>
      <div style={{ minWidth: 1100 }}>
        <div style={mix(THEAD, { gridTemplateColumns: GRID })}>
          {["Стр.", "Действие", "Клиент", "Товар", "Код", "Кол", "Сумма", "Выкуп", "Статус", "Оплата", "Дата"].map((h) => (
            <div key={h} style={css("padding:8px 10px")}>
              {h}
            </div>
          ))}
        </div>
        {rows.length === 0 ? (
          <Empty icon="import" title="Нет строк в этой категории" />
        ) : (
          rows.slice(0, limit).map((r) => {
            const a = ACTION[r.action];
            const v = r.values;
            return (
              <div key={r.row} style={css("border-bottom:1px solid var(--hover);font-size:12px")}>
                <div style={mix("display:grid;align-items:center", { gridTemplateColumns: GRID })}>
                  <div style={css("padding:7px 10px;" + MONO + ";color:var(--text-4)")}>{r.row}</div>
                  <div style={css("padding:7px 10px")}>
                    <span style={mix("font-size:11px;font-weight:600;padding:2px 8px;border-radius:12px", { color: a.fg, background: a.bg })}>{a.label}</span>
                  </div>
                  <div style={css("padding:7px 10px;min-width:0")}>
                    <div style={css("font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                      {v?.customer_name || "—"}
                      {r.new_customer && <span style={css("color:var(--green);font-size:10.5px;margin-left:5px")}>новый</span>}
                    </div>
                    <div style={css(MONO + ";font-size:10.5px;color:var(--text-4)")}>{v?.customer_phone}</div>
                  </div>
                  <div style={css("padding:7px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{v?.name || "—"}</div>
                  <div style={css("padding:7px 10px;" + MONO + ";font-size:11px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis")}>{v?.code || "—"}</div>
                  <div style={css("padding:7px 10px;" + MONO)}>{v?.qty ?? "—"}</div>
                  <div style={css("padding:7px 10px;" + MONO)}>{v ? som(v.price) : "—"}</div>
                  <div style={css("padding:7px 10px;" + MONO)}>{v?.real_price !== null && v?.real_price !== undefined ? som(v.real_price) : "—"}</div>
                  <div style={css("padding:7px 10px")}>{v && <StatusBadge status={v.status} size="sm" />}</div>
                  <div style={css("padding:7px 10px")}>{v && <StatusBadge status={v.paid_amount ? "partial" : v.payment} size="sm" label={v.paid_amount ? som(v.paid_amount) : undefined} />}</div>
                  <div style={css("padding:7px 10px;" + MONO + ";font-size:11px;color:var(--text-3)")}>{v ? date(v.order_date) : "—"}</div>
                </div>
                {(r.errors.length > 0 || r.warnings.length > 0 || r.changes.length > 0) && (
                  <div style={css("padding:0 10px 7px 64px;display:flex;flex-direction:column;gap:2px;font-size:11.5px")}>
                    {r.errors.map((e) => (
                      <span key={e} style={css("color:var(--danger)")}>✕ {e}</span>
                    ))}
                    {r.warnings.map((w) => (
                      <span key={w} style={css("color:var(--amber)")}>! {w}</span>
                    ))}
                    {r.changes.map((c) => (
                      <span key={c.field} style={css("color:var(--accent-strong)")}>
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
          <div style={css("padding:10px;text-align:center")}>
            <HButton onClick={() => setLimit((l) => l + 200)} s={btnGhost + ";height:30px;font-size:12px"} hover="border-color:var(--accent)">
              Показать ещё ({rows.length - limit})
            </HButton>
          </div>
        )}
      </div>
    </div>
  );
}

function History({ toast }: { toast: Toast }) {
  const [rows, setRows] = useState<ImportBatch[] | null>(null);
  const [undo, setUndo] = useState<ImportBatch | null>(null);
  const load = () =>
    listImports()
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  return (
    <div style={css("margin-top:22px")}>
      <div style={css("font-size:13px;font-weight:600;margin:0 2px 8px")}>История импортов</div>
      <div style={css(PANEL)}>
        {!rows || rows.length === 0 ? (
          <Empty icon="import" title="Импортов ещё не было" />
        ) : (
          rows.map((r) => (
            <div
              key={r.id}
              style={mix("display:grid;grid-template-columns:130px 1.5fr 2fr 130px;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--hover);font-size:12.5px", r.undone_at ? { opacity: 0.55 } : {})}
            >
              <span style={css(MONO + ";font-size:11.5px;color:var(--text-3)")}>{dateTime(r.created_at)}</span>
              <div style={css("min-width:0")}>
                <div style={css("font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;gap:6px;align-items:center")}>
                  <Icon name="import" size={13} /> {r.filename}
                </div>
                <div style={css("font-size:11px;color:var(--text-4)")}>
                  лист «{r.sheet}» · {r.user_login ?? "—"}
                </div>
              </div>
              <span style={css("color:var(--text-2);font-size:12px")}>
                новых {r.created_items}, обновлено {r.updated_items}, пропущено {r.skipped}, ошибок {r.errors}
                {r.undone_at ? ` · отменён ${dateTime(r.undone_at)}` : ` · сейчас в системе ${r.alive_items}`}
              </span>
              <span style={css("text-align:right")}>
                {!r.undone_at && (
                  <HButton onClick={() => setUndo(r)} s="border:1px solid var(--border);background:var(--surface);border-radius:7px;padding:4px 10px;font-size:12px;cursor:pointer;color:var(--text-2)" hover="border-color:var(--danger-border);color:var(--danger)">
                    Отменить импорт
                  </HButton>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      {undo && (
        <Confirm
          title="Отменить импорт?"
          confirmLabel="Отменить импорт"
          text={
            <>
              Записи, созданные импортом «{undo.filename}» ({undo.alive_items} шт.), и его оплаты будут скрыты из системы (мягкое удаление — в
              базе останутся). Изменения, внесённые в существующие записи в режиме «обновить», не откатываются.
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
    </div>
  );
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
