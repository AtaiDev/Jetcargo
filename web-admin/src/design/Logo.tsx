/**
 * Знак Jetcargo: верхняя наклонная планка + ножка «J» с наклонным основанием.
 * Перерисован в вектор по фирменному логотипу (оригинал — design/jetcargo-logo.jpg).
 * Цвет — currentColor: в светлой теме знак тёмный, в тёмной — светлый.
 */
export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 92) / 94}
      viewBox="0 0 94 92"
      fill="currentColor"
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      <path d="M26 0H94L75 22H8Z" />
      <path d="M61 31H74V81Q74 91 64 91H0L8 79H50Q56 79 56 73V36Z" />
    </svg>
  );
}

/**
 * Печать Jetcargo: двойной круг, надпись по кругу и знак в центре.
 * Фон приложения за всеми блоками — бледная, медленно плывёт (стили .app-seal). Цвет — currentColor.
 */
export function LogoSeal({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <defs>
        <path id="jc-seal-ring" d="M100 100m-80 0a80 80 0 1 1 160 0a80 80 0 1 1-160 0" />
      </defs>
      <circle cx="100" cy="100" r="97" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="100" cy="100" r="92" stroke="currentColor" strokeWidth="1" />
      <circle cx="100" cy="100" r="64" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 5" strokeLinecap="round" />
      <g className="seal-ring">
        <text fill="currentColor" fontSize="13.5" fontWeight="600" letterSpacing="2.4">
          <textPath href="#jc-seal-ring" textLength="498" lengthAdjust="spacing">
            JETCARGO ✦ УПРАВЛЕНИЕ КАРГО ✦ JETCARGO ✦ УПРАВЛЕНИЕ КАРГО ✦
          </textPath>
        </text>
      </g>
      <g transform="translate(100 98) scale(0.62) translate(-47 -46)" fill="currentColor">
        <path d="M26 0H94L75 22H8Z" />
        <path d="M61 31H74V81Q74 91 64 91H0L8 79H50Q56 79 56 73V36Z" />
      </g>
    </svg>
  );
}
