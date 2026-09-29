/**
 * Финансы: сумма заказов, оплаты, долги, выкуп и прибыль за период,
 * помесячная динамика, должники и журнал поступлений.
 *
 * Сумма заказов — «Сумма» по дате заказа. Поступления — по дате оплаты.
 * Прибыль = Сумма − Реальная цена (выкуп), только где реальная цена указана.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiError } from "../api/client";
import { getFinance, type DashboardWidget, type Finance as FinanceData } from "../api/domain";
import { Empty, PeriodPicker, periodOf, type Period } from "../components/cargo";
import ItemModal from "../components/ItemModal";
import { MONO, css, mix } from "../design/css";
import { PANEL, Page, StatTile, THEAD } from "../design/table";
import { ModalError, SkeletonRows } from "../design/ui";
import { METHOD_LABEL, date, dateTime, som } from "../lib/cargo";
import { useRefresh } from "../lib/events";
import WidgetRenderer from "./overview/WidgetRenderer";

type Toast = (kind: "success" | "error", text: string) => void;

export default function Finance({ isDesktop, toast }: { isDesktop: boolean; toast: Toast }) {
  const nav = useNavigate();
  const [period, setPeriod] = useState<Period>(() => periodOf("month"));
  const [data, setData] = useState<FinanceData | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(() => {
    getFinance({ date_from: period.date_from, date_to: period.date_to })
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(apiError(e, "Не удалось загрузить финансы")));
  }, [period.date_from, period.date_to]);
  useEffect(load, [load]);
  useRefresh(load);

  // График по месяцам — тот же рендерер, что и на обзоре.
  const chart = useMemo<DashboardWidget | null>(() => {
    if (!data) return null;
    const first = data.months.findIndex((m) => m.items > 0);
    const rows = first < 0 ? [] : data.months.slice(first);
    return {
      id: -1,
      key: "finance_months",
      title: "",
      chart: "bar",
      span: 3,
      is_builtin: true,
      error: null,
      data: {
        dataset: "items",
        dimensions: [{ key: "month", label: "Месяц", kind: "category" }],
        measures: [
          { key: "sale", label: "Сумма заказов", format: "money" },
          { key: "paid", label: "Оплачено", format: "money" },
          { key: "profit", label: "Прибыль", format: "money" },
        ],
        rows: rows as unknown as Record<string, string | number>[],
      },
      series: [
        { measure: "sale", label: "Сумма заказов", color: "accent", type: "bar", axis: null },
        { measure: "paid", label: "Оплачено", color: "green", type: "bar", axis: null },
        { measure: "profit", label: "Прибыль (где указана реальная цена)", color: "violet", type: "line", axis: null },
      ],
    };
  }, [data]);

  const t = data?.totals;
  const note = t ? (t.items ? `по ${t.with_cost} из ${t.items} товаров` : "нет товаров") : "";
  // Наценка = прибыль / выкуп (только по товарам, где реальная цена указана).
  const margin = t && t.with_cost && t.cost > 0 ? Math.round((t.profit / t.cost) * 100) : null;

  return (
    <Page size="wide">
      <div style={css("margin-bottom:14px")}>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {error && <ModalError text={error} />}
      {!data || !t ? (
        !error && <SkeletonRows rows={5} />
      ) : (
        <div style={css("display:flex;flex-direction:column;gap:14px")}>
          <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px")}>
            <StatTile label="Сумма заказов" value={som(t.sale)} />
            <StatTile label="Оплачено" value={som(t.paid)} color="var(--green)" />
            <StatTile label="Не оплачено" value={som(t.debt)} color={t.debt > 0 ? "var(--danger)" : undefined} />
            <StatTile label="Поступило денег" value={som(data.cash_in.amount)} color="var(--green)" />
            <StatTile label="Долги клиентов (всего)" value={som(t.debts_total)} color={t.debts_total > 0 ? "var(--amber)" : undefined} />
            <StatTile label={`Выкуп (реальная цена) · ${note}`} value={t.with_cost ? som(t.cost) : "—"} />
            <StatTile label={`Прибыль · ${note}`} value={t.with_cost ? som(t.profit) : "—"} color={t.profit < 0 ? "var(--danger)" : "var(--green)"} />
            <StatTile label="Наценка на выкуп" value={margin === null ? "—" : `${margin}%`} />
          </div>
          {t.items > 0 && t.with_cost < t.items && (
            <div style={css("font-size:12px;color:var(--text-3);background:var(--surface-2);border:1px dashed var(--border-strong);border-radius:8px;padding:9px 12px")}>
              Реальная цена (выкуп) указана не у всех товаров ({t.with_cost} из {t.items}) — прибыль посчитана только по ним, остальное не
              выдумывается. Указать реальную цену можно в карточке товара.
            </div>
          )}

          <section style={css(PANEL)}>
            <div style={css("padding:12px 16px;border-bottom:1px solid var(--border-2);font-size:13.5px;font-weight:600")}>По месяцам</div>
            <div style={css("padding:14px 16px")}>{chart && <WidgetRenderer widget={chart} />}</div>
            {data.months.some((m) => m.items > 0) && (
              <div>
                <div style={mix(THEAD, { gridTemplateColumns: "1fr repeat(5, 1fr)" })}>
                  {["Месяц", "Сумма заказов", "Оплачено", "Долг", "Выкуп", "Прибыль"].map((h, i) => (
                    <div key={h} style={mix("padding:8px 14px", { textAlign: i ? "right" : "left" })}>
                      {h}
                    </div>
                  ))}
                </div>
                {data.months
                  .filter((m) => m.items > 0)
                  .reverse()
                  .map((m) => (
                    <div key={m.month} style={css("display:grid;grid-template-columns:1fr repeat(5, 1fr);border-bottom:1px solid var(--hover);font-size:12.5px;" + MONO)}>
                      <div style={css("padding:8px 14px;font-family:inherit")}>{m.month_label}</div>
                      <div style={css("padding:8px 14px;text-align:right")}>{som(m.sale)}</div>
                      <div style={css("padding:8px 14px;text-align:right;color:var(--green)")}>{som(m.paid)}</div>
                      <div style={mix("padding:8px 14px;text-align:right", { color: m.debt > 0 ? "var(--amber)" : "var(--text-4)" })}>{som(m.debt)}</div>
                      <div style={css("padding:8px 14px;text-align:right;color:var(--text-2)")}>{m.with_cost ? som(m.cost) : "—"}</div>
                      <div style={css("padding:8px 14px;text-align:right")}>{m.with_cost ? som(m.profit) : "—"}</div>
                    </div>
                  ))}
              </div>
            )}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: isDesktop ? "1fr 1fr" : "1fr", gap: 14 }}>
            <ListPanel
              title="Должники"
              meta={`${data.debtors.length} ${plural(data.debtors.length, "клиент", "клиента", "клиентов")}`}
              total={som(data.debtors.reduce((s, d) => s + d.debt, 0))}
              totalColor="var(--danger)"
              isDesktop={isDesktop}
              footer="только невыданные товары · клик — карточка клиента"
            >
              {data.debtors.length === 0 ? (
                <Empty icon="customers" title="Долгов нет" />
              ) : (
                data.debtors.map((d, i) => {
                  const max = data.debtors[0]?.debt || 1;
                  return (
                    <div
                      key={d.id}
                      onClick={() => nav(`/customers/${d.id}`)}
                      className="row-click"
                      style={mix("display:grid;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border-2)", {
                        gridTemplateColumns: isDesktop ? "22px 32px minmax(0,1fr) 128px" : "16px 30px minmax(0,1fr) 88px",
                      })}
                    >
                      <span style={css(MONO + ";font-size:11px;color:var(--text-4);text-align:right")}>{i + 1}</span>
                      <Avatar name={d.name} tone="danger" />
                      <div style={css("min-width:0")}>
                        <div style={css("font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{d.name}</div>
                        <div style={css("font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                          <span style={css(MONO)}>{d.phone || "—"}</span> · {d.items} {plural(d.items, "товар", "товара", "товаров")} · с {date(d.oldest).slice(0, 5)}
                        </div>
                      </div>
                      <div style={css("display:flex;flex-direction:column;align-items:flex-end;gap:5px")}>
                        <span style={css(MONO + ";font-weight:700;font-size:13.5px;color:var(--danger);white-space:nowrap")}>{som(d.debt)}</span>
                        <span style={css("width:100%;height:4px;border-radius:3px;background:var(--border-2);overflow:hidden")}>
                          <span style={mix("display:block;height:100%;border-radius:3px;background:var(--danger-dot)", { width: `${Math.max(4, (d.debt / max) * 100)}%` })} />
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </ListPanel>

            <ListPanel
              title="Поступления"
              meta={`${data.cash_in.count} ${plural(data.cash_in.count, "оплата", "оплаты", "оплат")}`}
              total={som(data.cash_in.amount)}
              totalColor="var(--green)"
              isDesktop={isDesktop}
              footer={
                data.cash_in.count > data.payments.length
                  ? `показаны последние ${data.payments.length} из ${data.cash_in.count} · клик — карточка товара`
                  : "клик — карточка товара"
              }
            >
              {data.payments.length === 0 ? (
                <Empty icon="finance" title="Оплат за период нет" />
              ) : (
                data.payments.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setOpen(p.item_id)}
                    className="row-click"
                    style={mix("display:grid;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border-2)", {
                      gridTemplateColumns: isDesktop ? "46px 32px minmax(0,1fr) auto 96px" : "40px minmax(0,1fr) 80px",
                    })}
                  >
                    <div style={css("text-align:center;line-height:1.25")}>
                      <div style={css(MONO + ";font-size:12px;font-weight:600")}>{dateTime(p.paid_at).slice(0, 5)}</div>
                      <div style={css(MONO + ";font-size:10.5px;color:var(--text-4)")}>{dateTime(p.paid_at).slice(11)}</div>
                    </div>
                    {isDesktop && <Avatar name={p.customer_name} tone="green" />}
                    <div style={css("min-width:0")}>
                      <div style={css("font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.customer_name}</div>
                      <div style={css("font-size:11.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{p.item_name}</div>
                    </div>
                    {isDesktop && (
                      <span style={css("font-size:10.5px;font-weight:600;color:var(--text-2);background:var(--muted-bg);padding:2px 8px;border-radius:10px;white-space:nowrap")}>
                        {METHOD_LABEL[p.method] ?? p.method}
                      </span>
                    )}
                    <span style={css(MONO + ";font-weight:700;font-size:13.5px;text-align:right;color:var(--green);white-space:nowrap")}>+{som(p.amount)}</span>
                  </div>
                ))
              )}
            </ListPanel>
          </div>
        </div>
      )}
      {open !== null && <ItemModal id={open} toast={toast} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Кружок с первой буквой имени. */
function Avatar({ name, tone }: { name: string; tone: "danger" | "green" }) {
  const bg = tone === "danger" ? "var(--danger-tint)" : "var(--green-tint)";
  const fg = tone === "danger" ? "var(--danger)" : "var(--green)";
  return (
    <span
      style={mix("width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:700;flex:none", {
        background: bg,
        color: fg,
      })}
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * Панель-список одинаковой высоты: шапка (название, количество, итог), прокручиваемое
 * тело и подпись снизу. Две панели рядом всегда ровные, сколько бы строк ни было.
 */
function ListPanel({
  title,
  meta,
  total,
  totalColor,
  footer,
  isDesktop,
  children,
}: {
  title: string;
  meta: string;
  total: string;
  totalColor: string;
  footer: string;
  isDesktop: boolean;
  children: React.ReactNode;
}) {
  return (
    <section style={mix(PANEL + ";display:flex;flex-direction:column", { height: isDesktop ? 520 : 440 })}>
      <div style={css("display:flex;align-items:center;gap:10px;padding:13px 16px;border-bottom:1px solid var(--border)")}>
        <span style={css("font-size:14px;font-weight:700")}>{title}</span>
        <span style={css("font-size:11.5px;color:var(--text-3);background:var(--hover);padding:2px 8px;border-radius:10px;white-space:nowrap")}>{meta}</span>
        <span style={css("flex:1")} />
        <span style={mix(MONO + ";font-size:15px;font-weight:700;white-space:nowrap", { color: totalColor })}>{total}</span>
      </div>
      <div style={css("flex:1;min-height:0;overflow-y:auto")}>{children}</div>
      <div style={css("padding:8px 16px;border-top:1px solid var(--border-2);background:var(--surface-2);font-size:11px;color:var(--text-4)")}>{footer}</div>
    </section>
  );
}
