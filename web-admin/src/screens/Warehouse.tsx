/**
 * Склад: что ожидается, что лежит на складе, что готово к выдаче — и история сканирований.
 * Обновляется сам после сканирования/выдачи (в том числе из другой вкладки) и раз в 20 секунд.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { listItems, listScans, type ItemList, type ItemQuery, type Page as PageOf, type ScanRow } from "../api/domain";
import { Empty, Pager, Tabs } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import ItemTable from "../components/ItemTable";
import Select from "../components/Select";
import { MONO, css, mix } from "../design/css";
import { Icon } from "../design/icons";
import { PANEL, Page, PrimaryAction, SearchInput, THEAD, Toolbar } from "../design/table";
import { ModalError, ST, SkeletonRows, chipStyle, HButton } from "../design/ui";
import { SCAN_LABEL, dateTime, som } from "../lib/cargo";
import { useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type Filter = "all" | "expected" | "in_stock" | "ready" | "paid" | "unpaid" | "debt";

const FILTERS: { key: Filter; label: string; q: ItemQuery }[] = [
  { key: "all", label: "Все", q: { status: "active" } },
  { key: "expected", label: "Ожидаются", q: { status: "ordered" } },
  { key: "in_stock", label: "На складе", q: { status: "in_stock", sort: "arrived" } },
  { key: "ready", label: "Готовы к выдаче", q: { pay: "ready", sort: "arrived" } },
  { key: "paid", label: "Оплаченные", q: { status: "active", pay: "paid" } },
  { key: "unpaid", label: "Неоплаченные", q: { status: "active", pay: "unpaid" } },
  { key: "debt", label: "С долгом", q: { status: "active", pay: "debt" } },
];

const LIMIT = 50;

export default function Warehouse({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "scans" ? "scans" : "items";
  return (
    <Page size="wide">
      <div style={css("margin-bottom:14px")}>
        <Tabs<"items" | "scans">
          value={tab}
          onChange={(v) => setParams(v === "scans" ? { tab: "scans" } : {}, { replace: true })}
          tabs={[
            { key: "items", label: "Товары" },
            { key: "scans", label: "История сканирований" },
          ]}
        />
      </div>
      {tab === "items" ? <Items isDesktop={isDesktop} toast={toast} /> : <Scans toast={toast} />}
    </Page>
  );
}

function Items({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>("in_stock");
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ItemList | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const sel = useSelection(`${filter}|${q}|${offset}`);

  const load = useCallback(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    listItems({ ...f.q, q, limit: LIMIT, offset })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить склад")));
  }, [filter, q, offset]);

  useEffect(load, [load]);
  useEffect(() => setOffset(0), [filter, q]);
  useRefresh(load);
  useEffect(() => {
    const t = window.setInterval(load, 20000);
    return () => window.clearInterval(t);
  }, [load]);

  const t = data?.totals;
  return (
    <>
      <Toolbar
        left={
          <div style={css("display:flex;flex-wrap:wrap;gap:6px")}>
            {FILTERS.map((f) => (
              <HButton key={f.key} onClick={() => setFilter(f.key)} s={chipStyle(filter === f.key)} hover="border-color:var(--accent)">
                {f.label}
              </HButton>
            ))}
          </div>
        }
        search={<SearchInput value={query} onChange={setQuery} placeholder="Клиент, телефон, код…" />}
        actions={
          <PrimaryAction onClick={() => nav("/receive")} icon={<Icon name="receive" size={15} />}>
            Принять товар
          </PrimaryAction>
        }
      />

      {t && (
        <div style={css("display:flex;flex-wrap:wrap;gap:18px;font-size:12px;color:var(--text-3);margin:-4px 2px 10px")}>
          <span>
            Товаров: <b style={css(MONO + ";color:var(--text)")}>{t.items}</b>
          </span>
          <span>
            <span style={mix("display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px", { background: ST.ordered.dot })} />
            ожидается <b style={css(MONO + ";color:var(--text)")}>{t.ordered}</b>
          </span>
          <span>
            <span style={mix("display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:5px", { background: ST.in_stock.dot })} />
            на складе <b style={css(MONO + ";color:var(--text)")}>{t.in_stock}</b>
          </span>
          <span>
            Стоимость: <b style={css(MONO + ";color:var(--text)")}>{som(t.sale)}</b>
          </span>
          <span>
            Долг: <b style={css(MONO + ";color:" + (t.debt > 0 ? "var(--amber)" : "var(--text)"))}>{som(t.debt)}</b>
          </span>
        </div>
      )}

      {error && <ModalError text={error} />}
      {!data && !error ? (
        <SkeletonRows rows={6} />
      ) : (
        data && (
          <ItemTable
            rows={data.rows}
            isDesktop={isDesktop}
            columns={["customer", "item", "qty", "sale", "pay", "status", "arrived"]}
            onOpen={setOpen}
            selected={sel.selected}
            onSelect={sel.onSelect}
            empty={
              <Empty
                icon="warehouse"
                title={filter === "in_stock" ? "На складе пусто" : "Ничего не найдено"}
                text="Товары попадают на склад, когда их код сканируют в разделе «Приём товара»"
              />
            }
            footer={<Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
          />
        )
      )}
      {data && <BulkBar items={data.rows} selected={sel.selected} onClear={sel.clear} toast={toast} />}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </>
  );
}

const RESULT_TONE: Record<string, string> = {
  arrived: "var(--accent-strong)",
  already_in_stock: "var(--amber)",
  already_issued: "var(--text-3)",
  not_found: "var(--danger)",
};

function Scans({ toast }: { toast: Toast }) {
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 250);
  const [result, setResult] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<PageOf<ScanRow> | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    listScans({ q, result, limit: LIMIT, offset })
      .then(setData)
      .catch((e) => setError(apiError(e)));
  }, [q, result, offset]);
  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, result]);
  useRefresh(load);

  const GRID = "140px 1.2fr 170px 1.5fr 1.3fr 60px 90px";
  return (
    <>
      <Toolbar
        left={
          <Select
            value={result}
            onChange={setResult}
            width={190}
            height={34}
            fontSize={12.5}
            highlight={!!result}
            ariaLabel="Результат сканирования"
            options={[{ value: "", label: "Все результаты" }, ...Object.entries(SCAN_LABEL).map(([k, v]) => ({ value: k, label: v }))]}
          />
        }
        search={<SearchInput value={query} onChange={setQuery} placeholder="Код, товар, клиент…" />}
      />
      {error && <ModalError text={error} />}
      {!data ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          <div style={css(PANEL)}>
            <div style={mix(THEAD, { gridTemplateColumns: GRID })}>
              {["Когда", "Код", "Результат", "Товар", "Клиент", "Скан №", "Сотрудник"].map((h) => (
                <div key={h} style={css("padding:9px 12px")}>
                  {h}
                </div>
              ))}
            </div>
            {data.rows.length === 0 ? (
              <Empty icon="receive" title="Сканирований пока нет" text="Каждое сканирование сохраняется здесь навсегда — повторные не перезаписывают старые" />
            ) : (
              data.rows.map((s) => (
                <div
                  key={s.id}
                  onClick={() => s.order_item_id && setOpen(s.order_item_id)}
                  className={s.order_item_id ? "row-click" : ""}
                  style={mix("display:grid;border-bottom:1px solid var(--hover);align-items:center;font-size:12.5px", { gridTemplateColumns: GRID })}
                >
                  <div style={css("padding:8px 12px;" + MONO + ";font-size:11.5px;color:var(--text-3)")}>{dateTime(s.scanned_at)}</div>
                  <div style={css("padding:8px 12px;" + MONO + ";font-weight:600;overflow:hidden;text-overflow:ellipsis")}>{s.code}</div>
                  <div style={mix("padding:8px 12px;font-size:11.5px;font-weight:600", { color: RESULT_TONE[s.result] })}>{SCAN_LABEL[s.result]}</div>
                  <div style={css("padding:8px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.item_name ?? "—"}</div>
                  <div style={css("padding:8px 12px;min-width:0")}>
                    <div style={css("white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.customer_name ?? "—"}</div>
                    {s.customer_phone && <div style={css(MONO + ";font-size:11px;color:var(--text-3)")}>{s.customer_phone}</div>}
                  </div>
                  <div style={css("padding:8px 12px;" + MONO + ";color:var(--text-3)")}>{s.order_item_id ? `№${s.scan_no}` : "—"}</div>
                  <div style={css("padding:8px 12px;" + MONO + ";font-size:11.5px;color:var(--text-3)")}>{s.user_login ?? "—"}</div>
                </div>
              ))
            )}
          </div>
          <Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />
        </>
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </>
  );
}
