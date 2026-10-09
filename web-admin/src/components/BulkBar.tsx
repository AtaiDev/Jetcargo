/**
 * Массовые действия с выбранными товарами: смена статуса и отметка об оплате.
 *
 * Панель прилипает к низу экрана, пока что-то выбрано. Перед действием сервер
 * «примеряет» его (dry run) — в подтверждении видно, сколько товаров изменится,
 * какие пропустятся и почему, и какой долг останется. Выдача оформляется как
 * настоящая выдача (по одной на клиента) и попадает в историю выдач.
 */
import { useCallback, useEffect, useState } from "react";

import { apiError } from "../api/client";
import { bulkPay, bulkStatus, type BulkStatusResult, type Item, type ItemStatus } from "../api/domain";
import { MONO, css, mix } from "../design/css";

const NUM = "font-variant-numeric:tabular-nums;letter-spacing:-.01em";
import { Icon } from "../design/icons";
import { HButton, ModalCancel, ModalError, ModalShell, ST, btnPrimary, type ModalTone } from "../design/ui";
import { STATUS_LABEL, som } from "../lib/cargo";
import { emit } from "../lib/events";

type Toast = (kind: "success" | "error", text: string) => void;

/** Выбор товаров на экране. Сбрасывается сам при смене фильтров/страницы (resetKey). */
export function useSelection(resetKey: unknown) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  useEffect(() => setSelected(new Set()), [resetKey]);
  const onSelect = useCallback((ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, onSelect, clear };
}

type Pending =
  | { kind: "status"; status: ItemStatus; check: BulkStatusResult }
  | { kind: "pay"; count: number; amount: number };

export default function BulkBar({
  items,
  selected,
  onClear,
  toast,
}: {
  /** Товары на экране (из них берутся выбранные для сумм). */
  items: Item[];
  selected: Set<number>;
  onClear: () => void;
  toast: Toast;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = items.filter((i) => selected.has(i.id));
  if (!chosen.length && !pending) return null;

  const ids = chosen.map((i) => i.id);
  const sum = chosen.reduce((s, i) => s + i.sale, 0);
  const debt = chosen.reduce((s, i) => s + i.debt, 0);

  async function prepareStatus(status: ItemStatus) {
    setBusy(true);
    try {
      setPending({ kind: "status", status, check: await bulkStatus(ids, status, true) });
    } catch (e) {
      toast("error", apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function preparePay() {
    setBusy(true);
    try {
      const r = await bulkPay(ids, true);
      setPending({ kind: "pay", count: r.items, amount: r.amount });
    } catch (e) {
      toast("error", apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!pending) return;
    if (pending.kind === "status") {
      const r = await bulkStatus(ids, pending.status);
      toast(
        "success",
        pending.status === "issued"
          ? `Выдано товаров: ${r.changed}${r.customers > 1 ? ` (клиентов: ${r.customers})` : ""}`
          : `Статус «${STATUS_LABEL[pending.status]}»: ${r.changed} тов.`
      );
    } else {
      const r = await bulkPay(ids);
      toast("success", `Оплата принята: ${r.items} тов. на ${som(r.amount)}`);
    }
    setPending(null);
    onClear();
    emit("cargo:changed");
  }

  const statusBtn = (s: ItemStatus) => (
    <HButton
      key={s}
      disabled={busy}
      onClick={() => prepareStatus(s)}
      s={`height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap`}
      hover="background:rgba(255,255,255,.18)"
    >
      <span style={mix("width:7px;height:7px;border-radius:50%", { background: ST[s].dot })} />→ {STATUS_LABEL[s]}
    </HButton>
  );

  return (
    <>
      {chosen.length > 0 && (
        // Внешний слой на всю ширину центрирует панель; сама панель двигается только
        // по вертикали — поэтому при появлении нет рывка вбок.
        <div style={css("position:fixed;left:0;right:0;bottom:22px;z-index:50;display:flex;justify-content:center;padding:0 16px;pointer-events:none")}>
        <div
          style={css(
            "pointer-events:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center;max-width:100%;padding:10px 12px 10px 16px;border-radius:12px;background:var(--toast-bg);color:#fff;box-shadow:0 14px 40px rgba(0,0,0,.28);animation:barIn .28s cubic-bezier(.2,.8,.2,1) both"
          )}
        >
          <span style={css("font-size:13px;font-weight:600;white-space:nowrap")}>Выбрано: {chosen.length}</span>
          <span style={css("font-size:12px;opacity:.75;white-space:nowrap;" + MONO)}>
            {som(sum)}
            {debt > 0 ? ` · долг ${som(debt)}` : ""}
          </span>
          <span style={css("width:1px;height:22px;background:rgba(255,255,255,.2)")} />
          {(["in_stock", "issued", "ordered"] as ItemStatus[]).map(statusBtn)}
          {debt > 0 && (
            <HButton
              disabled={busy}
              onClick={preparePay}
              s="height:32px;padding:0 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(53,164,106,.35);color:#fff;font-size:12.5px;cursor:pointer;white-space:nowrap"
              hover="background:rgba(53,164,106,.55)"
            >
              ✓ Отметить оплаченными
            </HButton>
          )}
          <HButton
            onClick={onClear}
            s="height:32px;padding:0 10px;border:none;background:transparent;color:rgba(255,255,255,.7);font-size:12.5px;cursor:pointer;white-space:nowrap"
            hover="color:#fff"
          >
            ✕ Снять
          </HButton>
        </div>
        </div>
      )}

      {pending && <BulkModal pending={pending} chosen={chosen} onClose={() => setPending(null)} onRun={run} />}
    </>
  );
}

// --- Подтверждение массового действия -------------------------------------------------------

const TONE_OF: Record<ItemStatus, ModalTone> = { ordered: "amber", in_stock: "accent", issued: "green" };
const ICON_OF: Record<ItemStatus, string> = { ordered: "orders", in_stock: "receive", issued: "issue" };
const WHAT_HAPPENS: Record<ItemStatus, string> = {
  issued: "Оформится выдача — по одной на клиента: товары уйдут со склада и появятся в истории выдач.",
  in_stock: "Товары отметятся как принятые на склад — их можно будет выдать клиентам.",
  ordered: "Товары вернутся в статус «Заказан» — как будто ещё не приехали.",
};
/** Подсказка, когда ни один товар не подошёл. */
const CAN_DO: Record<ItemStatus, string> = {
  issued: "Выдать можно только товары, которые лежат на складе. Сначала примите их на «Приёме товара».",
  in_stock: "Выберите товары в другом статусе — те, что уже на складе, переводить не нужно.",
  ordered: "Выберите товары в другом статусе — заказанные уже в нём.",
};

/**
 * Что именно произойдёт: плитки с итогами, список товаров «было → станет», пропущенные с причинами
 * и предупреждение о долге. Если менять нечего — одно окно-пояснение с кнопкой «Понятно».
 */
function BulkModal({ pending, chosen, onClose, onRun }: { pending: Pending; chosen: Item[]; onClose: () => void; onRun: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onRun();
    } catch (e) {
      setError(apiError(e, "Не удалось выполнить"));
      setBusy(false);
    }
  }

  if (pending.kind === "pay") {
    const owing = chosen.filter((i) => i.debt > 0);
    return (
      <ModalShell
        title="Отметить оплаченными?"
        subtitle={
          <span style={css(NUM)}>
            {pending.count} {plural(pending.count, "товар", "товара", "товаров")} · остаток долга {som(pending.amount)}
          </span>
        }
        icon={<span style={css("font-size:17px;font-weight:500")}>с</span>}
        tone="green"
        onClose={onClose}
        width={520}
        footer={
          <>
            <ModalCancel>Отмена</ModalCancel>
            <HButton onClick={confirm} disabled={busy} s={btnPrimary + ";min-width:160px"} hover="background:var(--accent-hover)">
              {busy ? "Записываю…" : `Принять ${som(pending.amount)}`}
            </HButton>
          </>
        }
      >
        <div className="mf-body">
          <div className="mf-card" style={css("justify-content:space-between")}>
            <span style={css("font-size:12.5px;color:var(--text-3)")}>Будет записано оплат на</span>
            <span style={css(NUM + ";font-size:22px;font-weight:500;color:var(--green)")}>{som(pending.amount)}</span>
          </div>
          {owing.length > 0 && (
            <div>
              <div className="bk-label">Чей долг закроется</div>
              <div className="bk-list thin-scroll">
                {owing.map((i) => (
                  <div key={i.id} className="bk-row">
                    <ItemName i={i} />
                    <span />
                    <span style={css(NUM + ";font-size:13px;font-weight:500;color:var(--amber);white-space:nowrap")}>{som(i.debt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mf-hint">Оплаты попадут в финансы сегодняшним днём. Ошибочную оплату можно отменить в карточке товара.</div>
          <ModalError text={error} />
        </div>
      </ModalShell>
    );
  }

  const { status, check } = pending;
  const skippedIds = new Set(check.skipped.map((s) => s.id));
  const moving = chosen.filter((i) => !skippedIds.has(i.id));
  const n = check.changed;
  const sum = moving.reduce((s, i) => s + i.sale, 0);
  const things = (k: number) => `${k} ${plural(k, "товар", "товара", "товаров")}`;
  const title = !n ? "Нечего менять" : status === "issued" ? `Выдать ${things(n)}?` : `Перевести ${things(n)} в «${STATUS_LABEL[status]}»?`;

  return (
    <ModalShell
      title={title}
      subtitle={
        n ? (
          <span style={css(NUM)}>
            {status === "issued" && `${check.customers} ${plural(check.customers, "клиент", "клиента", "клиентов")} · `}
            на {som(sum)}
            {check.skipped.length > 0 && ` · ${check.skipped.length} пропустится`}
          </span>
        ) : (
          "Ни один из выбранных товаров не подходит для этого действия"
        )
      }
      icon={<Icon name={ICON_OF[status]} size={18} />}
      tone={n ? TONE_OF[status] : "amber"}
      onClose={onClose}
      width={560}
      footer={
        n ? (
          <>
            <ModalCancel>Отмена</ModalCancel>
            <HButton onClick={confirm} disabled={busy} s={btnPrimary + ";min-width:170px"} hover="background:var(--accent-hover)">
              {busy ? "Секунду…" : status === "issued" ? `Выдать ${things(n)}` : `Перевести ${things(n)}`}
            </HButton>
          </>
        ) : (
          <ModalCancel>Понятно</ModalCancel>
        )
      }
    >
      <div className="mf-body">
        {/* Итоги — когда менять нечего, они не нужны: всё объясняют причины ниже */}
        {n > 0 && (
          <div className="bk-stats">
            <div className="bk-stat">
              <span className="bk-stat-l">Изменится</span>
              <span className="bk-stat-v" style={{ color: n ? ST[status].fg : "var(--text-4)" }}>
                {n}
              </span>
            </div>
            <div className="bk-stat">
              <span className="bk-stat-l">Пропустится</span>
              <span className="bk-stat-v" style={{ color: check.skipped.length ? "var(--text-2)" : "var(--text-4)" }}>
                {check.skipped.length}
              </span>
            </div>
            {status === "issued" ? (
              <div className="bk-stat">
                <span className="bk-stat-l">Останется долг</span>
                <span className="bk-stat-v" style={{ color: check.debt > 0 ? "var(--amber)" : "var(--green)" }}>
                  {check.debt > 0 ? som(check.debt) : "нет"}
                </span>
              </div>
            ) : (
              <div className="bk-stat">
                <span className="bk-stat-l">На сумму</span>
                <span className="bk-stat-v">{som(sum)}</span>
              </div>
            )}
          </div>
        )}

        {/* Что изменится: было → станет */}
        {n > 0 && moving.length > 0 && (
          <div>
            <div className="bk-label">Что изменится</div>
            <div className="bk-list thin-scroll">
              {moving.map((i) => (
                <div key={i.id} className="bk-row">
                  <ItemName i={i} />
                  <span className="bk-flow">
                    <Dot c={ST[i.stage ?? i.status].dot} />
                    {ST[i.stage ?? i.status].label}
                    <span style={css("color:var(--text-4)")}>→</span>
                    <Dot c={ST[status].dot} />
                    <span style={{ color: ST[status].fg }}>{STATUS_LABEL[status]}</span>
                  </span>
                  <span style={css(NUM + ";font-size:13px;font-weight:500;color:var(--text);white-space:nowrap;text-align:right")}>{som(i.sale)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Пропущенные — с причинами */}
        {check.skipped.length > 0 && (
          <div>
            <div className="bk-label">{n ? "Пропустятся" : "Почему"}</div>
            {/* Сводка причин — чтобы с первого взгляда было ясно, что мешает */}
            <div className="bk-why">
              {[...check.skipped.reduce((m, s) => m.set(s.reason, (m.get(s.reason) ?? 0) + 1), new Map<string, number>())].map(([reason, k]) => (
                <span key={reason} className="bk-why-chip">
                  {reason}
                  <b>{k}</b>
                </span>
              ))}
            </div>
            <div className="bk-list bk-skip thin-scroll">
              {check.skipped.map((s) => (
                <div key={s.id} className="bk-row" style={css("grid-template-columns:minmax(0,1fr) auto")}>
                  <span style={css("min-width:0;font-size:13px;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{s.name}</span>
                  <span className="bk-reason">{s.reason}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {status === "issued" && check.debt > 0 && n > 0 && (
          <div className="bk-warn">
            У выдаваемых товаров останется долг <b>{som(check.debt)}</b> — он сохранится у клиентов, принять оплату можно позже.
          </div>
        )}
        {n > 0 ? (
          <div className="mf-hint">{WHAT_HAPPENS[status]}</div>
        ) : (
          <div className="mf-hint">{CAN_DO[status]}</div>
        )}
        <ModalError text={error} />
      </div>
    </ModalShell>
  );
}

function ItemName({ i }: { i: Item }) {
  return (
    <span style={css("min-width:0")}>
      <span style={css("display:block;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{i.name}</span>
      <span style={css("display:block;font-size:12px;color:var(--text-4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
        {i.customer_name}
        {i.code ? ` · ${i.code}` : ""}
      </span>
    </span>
  );
}

const Dot = ({ c }: { c: string }) => <span style={mix("width:7px;height:7px;border-radius:50%;flex:none", { background: c })} />;

function plural(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
