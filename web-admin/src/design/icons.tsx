// Иконки — 1:1 из макета (пути и параметры обводки не менять).
import { createElement, type ReactElement } from "react";

type PathDef = [string, Record<string, unknown>];

export const ICONS: Record<string, PathDef[]> = {
  overview: [
    ["rect", { x: 3, y: 3, width: 7, height: 9, rx: 1 }],
    ["rect", { x: 14, y: 3, width: 7, height: 5, rx: 1 }],
    ["rect", { x: 14, y: 12, width: 7, height: 9, rx: 1 }],
    ["rect", { x: 3, y: 16, width: 7, height: 5, rx: 1 }],
  ],
  stock: [
    ["path", { d: "M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" }],
    ["path", { d: "m3.3 7 8.7 5 8.7-5" }],
    ["path", { d: "M12 22V12" }],
  ],
  bookings: [
    ["path", { d: "M8 2v4" }],
    ["path", { d: "M16 2v4" }],
    ["rect", { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
    ["path", { d: "M3 10h18" }],
    ["path", { d: "m9 16 2 2 4-4" }],
  ],
  products: [
    ["path", { d: "M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" }],
    ["circle", { cx: 7.5, cy: 7.5, r: 1.3, fill: "currentColor", stroke: "none" }],
  ],
  customers: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: 9, cy: 7, r: 4 }],
    ["path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }],
    ["path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }],
  ],
  requests: [
    ["polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12" }],
    ["path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }],
  ],
  reports: [
    ["path", { d: "M3 3v18h18" }],
    ["path", { d: "M18 17V9" }],
    ["path", { d: "M13 17V5" }],
    ["path", { d: "M8 17v-3" }],
  ],
  points: [
    ["path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" }],
    ["path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" }],
    ["path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M10 6h4" }],
    ["path", { d: "M10 10h4" }],
    ["path", { d: "M10 14h4" }],
  ],
  staff: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
    ["circle", { cx: 9, cy: 7, r: 4 }],
    ["polyline", { points: "16 11 18 13 22 9" }],
  ],
  audit: [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5" }],
    ["path", { d: "M12 7v5l4 2" }],
  ],
  categories: [
    ["path", { d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }],
  ],
  settings: [
    ["circle", { cx: 12, cy: 12, r: 3 }],
    ["path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" }],
  ],
  // --- Разделы Cargo ---
  receive: [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
    ["path", { d: "M8 7v10" }],
    ["path", { d: "M12 7v10" }],
    ["path", { d: "M17 7v10" }],
  ],
  issue: [
    ["path", { d: "m16 16 2 2 4-4" }],
    ["path", { d: "M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" }],
    ["path", { d: "m7.5 4.27 9 5.15" }],
    ["polyline", { points: "3.29 7 12 12 20.71 7" }],
    ["line", { x1: 12, x2: 12, y1: 22, y2: 12 }],
  ],
  orders: [
    ["rect", { width: 8, height: 4, x: 8, y: 2, rx: 1, ry: 1 }],
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M12 11h4" }],
    ["path", { d: "M12 16h4" }],
    ["path", { d: "M8 11h.01" }],
    ["path", { d: "M8 16h.01" }],
  ],
  warehouse: [
    ["path", { d: "M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" }],
    ["path", { d: "M6 18h12" }],
    ["path", { d: "M6 14h12" }],
    ["rect", { width: 12, height: 12, x: 6, y: 10 }],
  ],
  finance: [
    ["path", { d: "M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" }],
    ["path", { d: "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" }],
  ],
  "new-order": [
    ["rect", { width: 18, height: 18, x: 3, y: 3, rx: 2 }],
    ["path", { d: "M8 12h8" }],
    ["path", { d: "M12 8v8" }],
  ],
  batches: [
    ["path", { d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" }],
    ["path", { d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" }],
    ["path", { d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" }],
  ],
  import: [
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["polyline", { points: "17 8 12 3 7 8" }],
    ["line", { x1: 12, x2: 12, y1: 3, y2: 15 }],
  ],
  sun: [
    ["circle", { cx: 12, cy: 12, r: 4 }],
    ["path", { d: "M12 2v2" }],
    ["path", { d: "M12 20v2" }],
    ["path", { d: "m4.93 4.93 1.41 1.41" }],
    ["path", { d: "m17.66 17.66 1.41 1.41" }],
    ["path", { d: "M2 12h2" }],
    ["path", { d: "M20 12h2" }],
    ["path", { d: "m6.34 17.66-1.41 1.41" }],
    ["path", { d: "m19.07 4.93-1.41 1.41" }],
  ],
  moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }]],
};

/** Иконка навигации/раздела. */
export function Icon({ name, size = 18 }: { name: string; size?: number }): ReactElement {
  return <Svg paths={ICONS[name] ?? []} size={size} sw={1.6} />;
}

/** Произвольный SVG по набору путей (как this.svg в макете). */
export function Svg({
  paths,
  size = 16,
  sw = 1.8,
}: {
  paths: PathDef[];
  size?: number;
  sw?: number;
}): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d, i) => createElement(d[0], { key: i, ...d[1] }))}
    </svg>
  );
}

// Часто используемые в макете инлайн-иконки.
export const I_CLOCK: PathDef[] = [
  ["circle", { cx: 12, cy: 12, r: 10 }],
  ["path", { d: "M12 6v6l4 2" }],
];
export const I_CALENDAR: PathDef[] = [
  ["path", { d: "M8 2v4" }],
  ["path", { d: "M16 2v4" }],
  ["rect", { x: 3, y: 4, width: 18, height: 18, rx: 2 }],
  ["path", { d: "M3 10h18" }],
];
export const I_BOX: PathDef[] = ICONS.stock;
export const I_TRUCK: PathDef[] = ICONS.requests;
export const I_CHECK: PathDef[] = [["path", { d: "M20 6 9 17l-5-5" }]];
// Показать / скрыть пароль.
export const I_EYE: PathDef[] = [
  ["path", { d: "M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" }],
  ["circle", { cx: 12, cy: 12, r: 3 }],
];
export const I_EYE_OFF: PathDef[] = [
  ["path", { d: "M10.73 5.08A10.43 10.43 0 0 1 12 5c4.8 0 8.4 3 9.94 6.65a1 1 0 0 1 0 .7 10.75 10.75 0 0 1-1.44 2.49" }],
  ["path", { d: "M14.08 14.16a3 3 0 0 1-4.24-4.24" }],
  ["path", { d: "M17.48 17.5A10.75 10.75 0 0 1 2.06 12.35a1 1 0 0 1 0-.7 10.8 10.8 0 0 1 4.44-5.15" }],
  ["path", { d: "m2 2 20 20" }],
];
export const I_ALERT: PathDef[] = [
  ["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }],
  ["path", { d: "M12 9v4" }],
  ["path", { d: "M12 17h.01" }],
];

// Иконки, которые раньше объявлялись копиями по экранам. Одно объявление на всё приложение:
// иначе одна и та же галочка жила в трёх файлах и расходилась по толщине линий.
export const I_PLUS: PathDef[] = [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]];
export const I_MINUS: PathDef[] = [["path", { d: "M5 12h14" }]];
export const I_ARROW_RIGHT: PathDef[] = [["path", { d: "M5 12h14" }], ["path", { d: "m13 6 6 6-6 6" }]];
export const I_CLOSE: PathDef[] = [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]];
export const I_SEARCH: PathDef[] = [
  ["circle", { cx: 11, cy: 11, r: 8 }],
  ["path", { d: "m21 21-4.3-4.3" }],
];
export const I_BACK: PathDef[] = [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]];
export const I_USER: PathDef[] = [
  ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }],
  ["circle", { cx: 9, cy: 7, r: 4 }],
];
export const I_EXCEL: PathDef[] = [
  ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" }],
  ["path", { d: "M14 2v5h5" }],
  ["path", { d: "m9 13 6 6" }],
  ["path", { d: "m15 13-6 6" }],
];
export const I_SLIDERS: PathDef[] = [
  ["path", { d: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" }],
  ["path", { d: "M1 14h6M9 8h6M17 16h6" }],
];
// ИИ-ассистент: искра, отправка, корзина, новый чат.
export const I_SPARK: PathDef[] = [
  [
    "path",
    {
      d: "M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z",
    },
  ],
];
export const I_SEND: PathDef[] = [
  ["path", { d: "M22 2 11 13" }],
  ["path", { d: "M22 2 15 22l-4-9-9-4z" }],
];
export const I_TRASH: PathDef[] = [
  ["path", { d: "M3 6h18" }],
  ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
];
