/**
 * Сквозной поиск в шапке: клиенты и товары по имени, телефону, коду товара, названию.
 * Запрос уходит с задержкой (debounce), результаты — выпадающим списком.
 * Клиент → его карточка; товар → карточка товара поверх текущего экрана (openItem). Ctrl+K — фокус.
 * Открыта карточка клиента и найден его товар — строка подсвечивается прямо в списке,
 * а клик по такому товару прокручивает к ней (focusItem).
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { globalSearch, type SearchResults } from "../api/domain";
import { css } from "../design/css";
import { I_BOX, I_SEARCH, Svg } from "../design/icons";
import { ST } from "../design/ui";
import { som } from "../lib/cargo";
import { focusItem, itemMatches, openItem, setSearchHits, useDebounced } from "../lib/events";

const EMPTY: SearchResults = { query: "", customers: [], items: [] };

/**
 * finder — вид для окна «Поиск» (кнопка в панели, Ctrl+K): поле крупнее, сразу в фокусе,
 * результаты под полем, а не всплывающим списком; onDone — закрыть окно после выбора.
 */
export default function GlobalSearch({ finder, onDone }: { finder?: boolean; onDone?: () => void } = {}) {
  const nav = useNavigate();
  const loc = useLocation();
  // Клиент, чья карточка открыта: его товары из поиска показываем прямо в списке.
  const hereId = Number(loc.pathname.match(/\/customers\/(\d+)\/?$/)?.[1] ?? 0) || null;
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 200);
  const [res, setRes] = useState<SearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (term.length < 2) {
      setRes(EMPTY);
      return;
    }
    let alive = true;
    globalSearch(term)
      .then((r) => {
        if (!alive) return;
        setRes(r);
        setOpen(true);
      })
      .catch(() => alive && setRes(EMPTY));
    return () => {
      alive = false;
    };
  }, [term]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Найденное — открытой карточке клиента, чтобы подсветить строки. Пустой запрос — снять подсветку.
  // Подсвечиваем только найденные по коду или названию — не все товары клиента, найденного по телефону.
  useEffect(() => {
    if (term.length < 2) setSearchHits({ query: "", ids: [] });
    else if (res.query === term) setSearchHits({ query: term, ids: res.items.filter((i) => itemMatches(i, term)).map((i) => i.id) });
  }, [term, res]);

  const total = res.customers.length + res.items.length;
  const isHere = (i: { customer_id: number }) => hereId !== null && i.customer_id === hereId;
  function pickItem(i: { id: number; customer_id: number }) {
    if (isHere(i)) {
      // Товар этого клиента — не открываем поверх, а показываем, где он в списке.
      setOpen(false);
      focusItem(i.id);
      onDone?.();
    } else {
      openItem(i.id);
      reset();
    }
  }
  const reset = () => {
    setOpen(false);
    setQ("");
    onDone?.();
  };
  // выбор стрелками ↑↓: подсвеченная строка, Enter — открыть её
  const [hi, setHi] = useState(0);
  const resBox = useRef<HTMLDivElement>(null);
  useEffect(() => setHi(0), [res]);
  useEffect(() => {
    resBox.current?.querySelector(".gs-row.on")?.scrollIntoView({ block: "nearest" });
  }, [hi]);
  useEffect(() => {
    if (finder) inputRef.current?.focus();
  }, [finder]);

  function openAt(k: number) {
    const c = res.customers[k];
    if (c) {
      reset();
      nav(`/customers/${c.id}`);
      return;
    }
    const it = res.items[k - res.customers.length];
    if (it) pickItem(it);
  }
  function enter() {
    openAt(Math.min(hi, Math.max(0, total - 1)));
  }

  return (
    <div ref={boxRef} className={finder ? "gs-finder gs-root" : "gs-root"} style={finder ? undefined : css("position:relative;width:280px")}>
      <span className={finder ? "gs-ico" : undefined} style={finder ? undefined : css("position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--text-4);display:flex")}>
        <Svg paths={I_SEARCH} size={finder ? 19 : 15} sw={2.2} />
      </span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => term.length >= 2 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && total) {
            e.preventDefault();
            setHi((h) => Math.min(total - 1, h + 1));
          }
          if (e.key === "ArrowUp" && total) {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          }
          if (e.key === "Enter") enter();
          if (e.key === "Escape") {
            if (finder) onDone?.();
            else setOpen(false);
          }
        }}
        placeholder={finder ? "Имя, телефон, код товара или название…" : "Имя, телефон, код, товар…  Ctrl+K"}
        className={finder ? "gs-input" : undefined}
        style={finder ? undefined : css("width:100%;height:34px;padding:0 10px 0 30px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);font-size:12.5px;outline:none")}
      />
      {finder && <kbd className="gs-esc">Esc</kbd>}
      {finder && term.length < 2 && (
        <p className="gs-hint">
          <Svg paths={I_SEARCH} size={14} sw={2} />
          Начните печатать — от 2 символов: имя или телефон клиента, код или название товара
        </p>
      )}

      {open && term.length >= 2 && (
        <div
          ref={resBox}
          className={finder ? "gs-res" : "gs-res gs-pop"}
          style={
            finder
              ? undefined
              : css(
                  "position:absolute;top:40px;right:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.16);z-index:40;overflow:hidden;animation:pop .12s ease;max-height:460px;overflow-y:auto;width:400px"
                )
          }
        >
          {total === 0 ? (
            <div className="gs-none">
              <span>
                <Svg paths={I_SEARCH} size={18} sw={2} />
              </span>
              Ничего не найдено по «{term}»
            </div>
          ) : (
            <>
              {res.customers.length > 0 && (
                <Group title="Клиенты" count={res.customers.length}>
                  {res.customers.map((c, k) => (
                    <Row
                      key={c.id}
                      on={hi === k}
                      onHover={() => setHi(k)}
                      onClick={() => {
                        reset();
                        nav(`/customers/${c.id}`);
                      }}
                    >
                      <span className="gs-av">{letters(c.name)}</span>
                      <span className="gs-t">
                        <b>{c.name}</b>
                        <small>
                          <span className="m">{c.phone || "без телефона"}</span> · {c.items} тов.
                        </small>
                      </span>
                      <span className="gs-r">
                        {c.debt > 0 && <span className="gs-debt">долг {som(c.debt)}</span>}
                        <Go />
                      </span>
                    </Row>
                  ))}
                </Group>
              )}
              {res.items.length > 0 && (
                <Group title="Товары" count={res.items.length}>
                  {res.items.map((i, k) => {
                    const idx = res.customers.length + k;
                    const stage = (i.stage ?? i.status) as keyof typeof ST;
                    return (
                      <Row key={i.id} on={hi === idx} onHover={() => setHi(idx)} onClick={() => pickItem(i)}>
                        <span className="gs-ic">
                          <Svg paths={I_BOX} size={16} sw={2} />
                        </span>
                        <span className="gs-t">
                          <b>{i.name}</b>
                          <small>
                            {i.customer_name} · <span className="m">{i.code || "без кода"}</span>
                          </small>
                        </span>
                        <span className="gs-r">
                          {isHere(i) && (
                            <span className="gs-here" title="Товар этого клиента — нажмите, чтобы показать в списке">
                              ↓ в списке
                            </span>
                          )}
                          <span className={"gs-st " + String(stage)}>
                            <i />
                            {ST[stage]?.label ?? String(stage)}
                          </span>
                          <Go />
                        </span>
                      </Row>
                    );
                  })}
                </Group>
              )}
            </>
          )}
          {finder && total > 0 && (
            <div className="gs-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> выбрать
              </span>
              <span>
                <kbd>Enter</kbd> открыть
              </span>
              <span>
                <kbd>Esc</kbd> закрыть
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const letters = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function Go() {
  return (
    <span className="gs-go" aria-hidden>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </span>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="gs-grp-w">
      <div className="gs-grp">
        {title}
        <em>{count}</em>
      </div>
      {children}
    </div>
  );
}

function Row({ on, onHover, onClick, children }: { on: boolean; onHover: () => void; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={"gs-row" + (on ? " on" : "")} onMouseMove={onHover} onClick={onClick}>
      {children}
    </button>
  );
}
