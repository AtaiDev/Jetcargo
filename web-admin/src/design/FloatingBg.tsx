/**
 * Фон приложения за всеми блоками — живое поле точек (см. DotField): у курсора линза,
 * по клику волна, в покое по полю проходит полоса. Цвет точек — цвет текста темы.
 */
import DotField from "./DotField";

export default function FloatingBg() {
  return <DotField className="app-bg app-field" />;
}
