import type { PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "../lib/i18n";

export function ColumnResizeHandle({
  side,
  collapsed,
  width,
  min,
  max,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onDoubleClick,
}: {
  side: "sidebar" | "panel";
  collapsed: boolean;
  width: number;
  min: number;
  max: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  const { t } = useI18n();
  const label =
    side === "sidebar" ? t("resize.sidebar") : t("resize.panel");
  return (
    <div
      className={
        "col-resize" +
        (side === "sidebar" ? " col-resize--sidebar" : " col-resize--panel") +
        (collapsed ? " col-resize--collapsed" : "")
      }
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      title={t("resize.hint")}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <span className="col-resize-grip" aria-hidden>
        <span />
        <span />
      </span>
    </div>
  );
}
