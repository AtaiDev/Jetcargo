/**
 * Сквозной поиск в шапке: клиенты и товары по имени, телефону, коду товара, названию.
 * Запрос уходит с задержкой (debounce), результаты — выпадающим списком.
 * Клиент → его карточка; товар → карточка товара поверх текущего экрана (openItem). Ctrl+K — фокус.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { globalSearch, type SearchResults } from "../api/domain";
import { MONO, css } from "../design/css";
import { I_SEARCH, Svg } from "../design/icons";
import { HButton, StatusBadge } from "../design/ui";
import { som } from "../lib/cargo";
import { openItem, useDebounced } from "../lib/events";

const EMPTY: SearchResults = { query: "", customers: [], items: [] };

export default function GlobalSearch() {
  const nav = useNavigate();
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

  const total = res.customers.length + res.items.length;
  const reset = () => {
    setOpen(false);
    setQ("");
  };

  function enter() {
    if (res.customers[0]) {
      reset();
      nav(`/customers/${res.customers[0].id}`);
    } else if (res.items[0]) {
      openItem(res.items[0].id);
      reset();
    }
  }

  return (
    <div ref={boxRef} style={css("position:relative;width:280px")}>
      <span style={css("position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--text-4);display:flex")}>
        <Svg paths={I_SEARCH} size={15} />
      </span>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => term.length >= 2 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") enter();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Имя, телефон, код, товар…  Ctrl+K"
        style={css("width:100%;height:34px;padding:0 10px 0 30px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2);font-size:12.5px;outline:none")}
      />

      {open && term.length >= 2 && (
        <div
          style={css(
            "position:absolute;top:40px;right:0;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.16);z-index:40;overflow:hidden;animation:pop .12s ease;max-height:460px;overflow-y:auto;width:400px"
          )}
        >
          {total === 0 ? (
            <div style={css("padding:18px;text-align:center;color:var(--text-4);font-size:12.5px")}>Ничего не найдено</div>
          ) : (
            <>
              {res.customers.length > 0 && (
                <Group title="Клиенты">
                  {res.customers.map((c) => (
                    <Row
                      key={c.id}
                      onClick={() => {
                        reset();
                        nav(`/customers/${c.id}`);
                      }}
                    >
                      <span style={css("min-width:0")}>
                        <span style={css("display:block;font-size:13px;font-weight:600")}>{c.name}</span>
                        <span style={css("font-size:11.5px;color:var(--text-3);" + MONO)}>
                          {c.phone} · {c.items} тов.
                        </span>
                      </span>
                      {c.debt > 0 && <span style={css("font-size:11.5px;color:var(--amber);" + MONO)}>долг {som(c.debt)}</span>}
                    </Row>
                  ))}
                </Group>
              )}
              {res.items.length > 0 && (
                <Group title="Товары">
                  {res.items.map((i) => (
                    <Row
                      key={i.id}
                      onClick={() => {
                        openItem(i.id);
                        reset();
                      }}
                    >
                      <span style={css("min-width:0")}>
                        <span style={css("display:block;font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{i.name}</span>
                        <span style={css("font-size:11.5px;color:var(--text-3)")}>
                          {i.customer_name} · <span style={css(MONO)}>{i.code || "без кода"}</span>
                        </span>
                      </span>
                      <StatusBadge status={i.status} size="sm" dot={false} />
                    </Row>
                  ))}
                </Group>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={css(
          "padding:7px 12px;background:var(--surface-2);border-bottom:1px solid var(--border-2);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-4)"
        )}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <HButton
      onClick={onClick}
      s="width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:none;border-bottom:1px solid var(--border-2);background:transparent;cursor:pointer;text-align:left"
      hover="background:var(--accent-tint2)"
    >
      {children}
    </HButton>
  );
}
