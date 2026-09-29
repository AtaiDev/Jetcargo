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
