import type { PointerEvent as ReactPointerEvent } from "react";

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
  const label =
    side === "sidebar" ? "Resize left sidebar" : "Resize files panel";
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
      title="Drag to resize · double-click to reset width"
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
