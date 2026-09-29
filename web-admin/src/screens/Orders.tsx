/**
 * Заказы: все товары клиентов с вкладками по статусу, фильтрами оплаты и дат,
 * быстрым поиском и быстрым добавлением. Клик по строке — карточка товара.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiError } from "../api/client";
import { listItems, type ItemList, type ItemQuery } from "../api/domain";
import { Empty, Pager, Tabs } from "../components/cargo";
import BulkBar, { useSelection } from "../components/BulkBar";
import ItemModal from "../components/ItemModal";
import ItemTable from "../components/ItemTable";
import Select from "../components/Select";
import { MONO, css } from "../design/css";
import { Page, PrimaryAction, SearchInput, Toolbar } from "../design/table";
import { ModalError, ST, SkeletonRows } from "../design/ui";
import { monthStartIso, som, todayIso } from "../lib/cargo";
import { useDebounced, useRefresh } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;
type StatusTab = "" | "ordered" | "in_stock" | "issued";
type PayFilter = "" | "unpaid" | "partial" | "paid" | "debt";
type DateFilter = "" | "today" | "7" | "month";

const LIMIT = 50;

export default function Orders({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "") as StatusTab;
  const pay = (params.get("pay") ?? "") as PayFilter;
  const [dateF, setDateF] = useState<DateFilter>("");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const q = useDebounced(query.trim(), 250);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ItemList | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const nav = useNavigate();
  const sel = useSelection(`${status}|${pay}|${q}|${dateF}|${offset}`);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setOffset(0);
  };

  const load = useCallback(() => {
    const p: ItemQuery = { status, pay, q, limit: LIMIT, offset };
    if (dateF === "today") p.date_from = todayIso();
    if (dateF === "7") p.date_from = todayIso(-6);
    if (dateF === "month") p.date_from = monthStartIso();
    listItems(p)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить заказы")));
  }, [status, pay, q, dateF, offset]);

  useEffect(load, [load]);
  useEffect(() => setOffset(0), [q, dateF]);
  useRefresh(load);

  const t = data?.totals;
  return (
    <Page size="wide">

      <Toolbar
        left={
          <Tabs<StatusTab>
            value={status}
            onChange={(v) => setParam("status", v)}
            tabs={[
              { key: "", label: "Все", count: data?.counts.all },
              { key: "ordered", label: "Заказаны", count: data?.counts.ordered, dot: ST.ordered.dot },
              { key: "in_stock", label: "На складе", count: data?.counts.in_stock, dot: ST.in_stock.dot },
              { key: "issued", label: "Выданы", count: data?.counts.issued, dot: ST.issued.dot },
            ]}
          />
        }
        search={<SearchInput value={query} onChange={setQuery} placeholder="Имя, телефон, код, товар…" width={260} />}
        actions={
          <>
            <Select
              value={pay}
              onChange={(v) => setParam("pay", v)}
              width={156}
              height={34}
              fontSize={12.5}
              highlight={!!pay}
              ariaLabel="Оплата"
              options={[
                { value: "", label: "Любая оплата" },
                { value: "unpaid", label: "Не оплачено", dot: ST.unpaid.dot },
                { value: "partial", label: "Частично", dot: ST.partial.dot },
                { value: "paid", label: "Оплачено", dot: ST.paid.dot },
                { value: "debt", label: "С долгом", dot: "var(--danger-dot)" },
              ]}
            />
            <Select<DateFilter>
              value={dateF}
              onChange={setDateF}
              width={136}
              height={34}
              fontSize={12.5}
              highlight={!!dateF}
              ariaLabel="Дата"
              options={[
                { value: "", label: "Все даты" },
                { value: "today", label: "Сегодня" },
                { value: "7", label: "7 дней" },
                { value: "month", label: "Этот месяц" },
              ]}
            />
            <PrimaryAction onClick={() => nav("/new-order")}>Новый заказ</PrimaryAction>
          </>
        }
      />

      {t && t.items > 0 && (
        <div style={css("display:flex;flex-wrap:wrap;gap:18px;font-size:12px;color:var(--text-3);margin:-4px 2px 10px")}>
          <span>
            Найдено: <b style={css(MONO + ";color:var(--text)")}>{t.items}</b>
          </span>
          <span>
            Сумма: <b style={css(MONO + ";color:var(--text)")}>{som(t.sale)}</b>
          </span>
          <span>
            Оплачено: <b style={css(MONO + ";color:var(--green)")}>{som(t.paid)}</b>
          </span>
          <span>
            Долг: <b style={css(MONO + ";color:" + (t.debt > 0 ? "var(--amber)" : "var(--text)"))}>{som(t.debt)}</b>
          </span>
          <span>
            Выкуп: <b style={css(MONO + ";color:var(--text)")}>{t.with_cost ? som(t.cost) : "—"}</b>
          </span>
          <span>
            Прибыль: <b style={css(MONO + ";color:" + (t.profit < 0 ? "var(--danger)" : "var(--green)"))}>{t.with_cost ? som(t.profit) : "—"}</b>
            {t.with_cost < t.items && <span style={css("color:var(--text-4)")}> (по {t.with_cost} из {t.items} — у остальных нет реальной цены)</span>}
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
            columns={["date", "customer", "item", "qty", "sale", "profit", "pay", "status"]}
            onOpen={setOpen}
            selected={sel.selected}
            onSelect={sel.onSelect}
            empty={
              <Empty
                icon="orders"
                title={q || status || pay || dateF ? "Ничего не найдено" : "Заказов пока нет"}
                text={q || status || pay || dateF ? "Измените фильтры или поиск" : "Нажмите «Новый заказ» или загрузите Excel в разделе «Импорт»"}
              />
            }
            footer={<Pager total={data.total} offset={offset} limit={LIMIT} onChange={setOffset} />}
          />
        )
      )}

      {data && <BulkBar items={data.rows} selected={sel.selected} onClear={sel.clear} toast={toast} />}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </Page>
  );
}
