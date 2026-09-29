/**
 * Массовые действия с выбранными товарами: смена статуса и отметка об оплате.
 *
 * Панель прилипает к низу экрана, пока что-то выбрано. Перед действием сервер
 * «примеряет» его (dry run) — в подтверждении видно, сколько товаров изменится,
 * какие пропустятся и почему, и какой долг останется. Выдача оформляется как
 * настоящая выдача (по одной на клиента) и попадает в историю выдач.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { apiError } from "../api/client";
import { bulkPay, bulkStatus, type BulkStatusResult, type Item, type ItemStatus } from "../api/domain";
import { MONO, css, mix } from "../design/css";
import { HButton, ST } from "../design/ui";
import { STATUS_LABEL, som } from "../lib/cargo";
import { emit } from "../lib/events";
import { Confirm } from "./cargo";

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

      {pending?.kind === "status" && (
        <Confirm
          title={pending.status === "issued" ? "Выдать выбранные товары?" : `Перевести в «${STATUS_LABEL[pending.status]}»?`}
          danger={false}
          confirmLabel={pending.check.changed ? (pending.status === "issued" ? "Выдать" : "Перевести") : "Понятно"}
          onClose={() => setPending(null)}
          onConfirm={pending.check.changed ? run : async () => setPending(null)}
          text={<StatusCheck status={pending.status} check={pending.check} />}
        />
      )}
      {pending?.kind === "pay" && (
        <Confirm
          title="Отметить оплаченными?"
          danger={false}
          confirmLabel="Принять оплату"
          onClose={() => setPending(null)}
          onConfirm={run}
          text={
            <>
              По <b>{pending.count}</b> товарам будет записана оплата остатка долга — всего <b style={css(MONO)}>{som(pending.amount)}</b>.
              Оплаты попадут в финансы сегодняшним днём; ошибочную оплату можно отменить в карточке товара.
            </>
          }
        />
      )}
    </>
  );
}

function StatusCheck({ status, check }: { status: ItemStatus; check: BulkStatusResult }): ReactNode {
  return (
    <div style={css("display:flex;flex-direction:column;gap:8px")}>
      {check.changed ? (
        <div>
          Изменится: <b>{check.changed}</b> тов.
          {status === "issued" && (
            <>
              {" "}
              — оформится выдача{check.customers > 1 ? ` для ${check.customers} клиентов` : ""}, товары уйдут со склада и появятся в истории
              выдач.
            </>
          )}
        </div>
      ) : (
        <div>Ни один из выбранных товаров не подходит для этого действия.</div>
      )}
      {status === "issued" && check.debt > 0 && (
        <div style={css("color:var(--amber)")}>
          У выдаваемых товаров останется долг <b style={css(MONO)}>{som(check.debt)}</b> — он сохранится у клиентов.
        </div>
      )}
      {check.skipped.length > 0 && (
        <div>
          <div style={css("color:var(--text-3)")}>Пропустятся ({check.skipped.length}):</div>
          <div style={css("max-height:140px;overflow:auto;font-size:12px;margin-top:4px")}>
            {check.skipped.map((s) => (
              <div key={s.id}>
                {s.name} — <span style={css("color:var(--text-3)")}>{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
