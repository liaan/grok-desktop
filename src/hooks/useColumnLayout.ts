import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  COLUMN_COLLAPSE_SLACK,
  collapsedColumnWidth,
  PANEL_WIDTH_DEFAULT,
  PANEL_WIDTH_MAX,
  PANEL_WIDTH_MIN,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clamp,
  displayedColumnWidth,
  maxPanelWidth,
  maxSidebarWidth,
  persistColumnLayout,
  readStoredColumnLayout,
  type ColumnLayoutState,
} from "../lib/column-layout";

type Side = "sidebar" | "panel";

type Drag = {
  side: Side;
  pointerId: number;
  startX: number;
  startWidth: number;
};

function windowWidth(): number {
  return typeof window === "undefined" ? 1440 : window.innerWidth;
}

export function useColumnLayout() {
  const [initial] = useState(readStoredColumnLayout);
  const [sidebarWidth, setSidebarWidth] = useState(initial.sidebarWidth);
  const [panelWidth, setPanelWidth] = useState(initial.panelWidth);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initial.sidebarCollapsed,
  );
  const [panelCollapsed, setPanelCollapsed] = useState(initial.panelCollapsed);
  const [resizing, setResizing] = useState<Side | null>(null);
  const [viewportWidth, setViewportWidth] = useState(windowWidth);

  const sidebarWidthRef = useRef(sidebarWidth);
  const panelWidthRef = useRef(panelWidth);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const panelCollapsedRef = useRef(panelCollapsed);
  sidebarWidthRef.current = sidebarWidth;
  panelWidthRef.current = panelWidth;
  sidebarCollapsedRef.current = sidebarCollapsed;
  panelCollapsedRef.current = panelCollapsed;

  const dragRef = useRef<Drag | null>(null);

  const persistNow = useCallback(() => {
    const next: ColumnLayoutState = {
      sidebarWidth: sidebarWidthRef.current,
      panelWidth: panelWidthRef.current,
      sidebarCollapsed: sidebarCollapsedRef.current,
      panelCollapsed: panelCollapsedRef.current,
    };
    persistColumnLayout(next);
  }, []);

  useEffect(() => {
    const onResize = () => setViewportWidth(windowWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const panelDisplayed = displayedColumnWidth(
    panelWidth,
    panelCollapsed,
    PANEL_WIDTH_MIN,
    PANEL_WIDTH_MAX,
    collapsedColumnWidth("panel"),
  );
  const sidebarDisplayed = displayedColumnWidth(
    sidebarWidth,
    sidebarCollapsed,
    SIDEBAR_WIDTH_MIN,
    SIDEBAR_WIDTH_MAX,
    collapsedColumnWidth("sidebar"),
  );

  const sidebarMaxNow = Math.min(
    SIDEBAR_WIDTH_MAX,
    maxSidebarWidth(viewportWidth, panelDisplayed),
  );
  const panelMaxNow = Math.min(
    PANEL_WIDTH_MAX,
    maxPanelWidth(viewportWidth, sidebarDisplayed),
  );

  const sidebarPx = sidebarCollapsed
    ? collapsedColumnWidth("sidebar")
    : clamp(sidebarWidth, SIDEBAR_WIDTH_MIN, sidebarMaxNow);
  const panelPx = panelCollapsed
    ? collapsedColumnWidth("panel")
    : clamp(panelWidth, PANEL_WIDTH_MIN, panelMaxNow);

  const applySidebar = useCallback(
    (raw: number) => {
      if (raw < SIDEBAR_WIDTH_MIN - COLUMN_COLLAPSE_SLACK) {
        setSidebarCollapsed(true);
        return;
      }
      const other = displayedColumnWidth(
        panelWidthRef.current,
        panelCollapsedRef.current,
        PANEL_WIDTH_MIN,
        PANEL_WIDTH_MAX,
        collapsedColumnWidth("panel"),
      );
      const max = Math.min(
        SIDEBAR_WIDTH_MAX,
        maxSidebarWidth(windowWidth(), other),
      );
      setSidebarCollapsed(false);
      setSidebarWidth(clamp(raw, SIDEBAR_WIDTH_MIN, max));
    },
    [],
  );

  const applyPanel = useCallback((raw: number) => {
    if (raw < PANEL_WIDTH_MIN - COLUMN_COLLAPSE_SLACK) {
      setPanelCollapsed(true);
      return;
    }
    const other = displayedColumnWidth(
      sidebarWidthRef.current,
      sidebarCollapsedRef.current,
      SIDEBAR_WIDTH_MIN,
      SIDEBAR_WIDTH_MAX,
      collapsedColumnWidth("sidebar"),
    );
    const max = Math.min(
      PANEL_WIDTH_MAX,
      maxPanelWidth(windowWidth(), other),
    );
    setPanelCollapsed(false);
    setPanelWidth(clamp(raw, PANEL_WIDTH_MIN, max));
  }, []);

  const onResizePointerDown = useCallback(
    (side: Side) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const collapsed =
        side === "sidebar"
          ? sidebarCollapsedRef.current
          : panelCollapsedRef.current;
      let startWidth: number;
      if (collapsed) {
        // From a rail, treat the start as the min so a short outward drag opens it.
        startWidth =
          side === "sidebar" ? SIDEBAR_WIDTH_MIN : PANEL_WIDTH_MIN;
      } else if (side === "sidebar") {
        const other = displayedColumnWidth(
          panelWidthRef.current,
          panelCollapsedRef.current,
          PANEL_WIDTH_MIN,
          PANEL_WIDTH_MAX,
          collapsedColumnWidth("panel"),
        );
        startWidth = clamp(
          sidebarWidthRef.current,
          SIDEBAR_WIDTH_MIN,
          Math.min(
            SIDEBAR_WIDTH_MAX,
            maxSidebarWidth(windowWidth(), other),
          ),
        );
      } else {
        const other = displayedColumnWidth(
          sidebarWidthRef.current,
          sidebarCollapsedRef.current,
          SIDEBAR_WIDTH_MIN,
          SIDEBAR_WIDTH_MAX,
          collapsedColumnWidth("sidebar"),
        );
        startWidth = clamp(
          panelWidthRef.current,
          PANEL_WIDTH_MIN,
          Math.min(PANEL_WIDTH_MAX, maxPanelWidth(windowWidth(), other)),
        );
      }
      dragRef.current = {
        side,
        pointerId: e.pointerId,
        startX: e.clientX,
        startWidth,
      };
      setResizing(side);
    },
    [],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.side === "sidebar") {
        applySidebar(drag.startWidth + (e.clientX - drag.startX));
      } else {
        applyPanel(drag.startWidth + (drag.startX - e.clientX));
      }
    },
    [applyPanel, applySidebar],
  );

  const endResizeDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      setResizing(null);
      persistNow();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [persistNow],
  );

  const resetSidebar = useCallback(() => {
    setSidebarCollapsed(false);
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
    sidebarCollapsedRef.current = false;
    sidebarWidthRef.current = SIDEBAR_WIDTH_DEFAULT;
    persistColumnLayout({
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      panelWidth: panelWidthRef.current,
      sidebarCollapsed: false,
      panelCollapsed: panelCollapsedRef.current,
    });
  }, []);

  const resetPanel = useCallback(() => {
    setPanelCollapsed(false);
    setPanelWidth(PANEL_WIDTH_DEFAULT);
    panelCollapsedRef.current = false;
    panelWidthRef.current = PANEL_WIDTH_DEFAULT;
    persistColumnLayout({
      sidebarWidth: sidebarWidthRef.current,
      panelWidth: PANEL_WIDTH_DEFAULT,
      sidebarCollapsed: sidebarCollapsedRef.current,
      panelCollapsed: false,
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => {
      sidebarCollapsedRef.current = !v;
      persistColumnLayout({
        sidebarWidth: sidebarWidthRef.current,
        panelWidth: panelWidthRef.current,
        sidebarCollapsed: !v,
        panelCollapsed: panelCollapsedRef.current,
      });
      return !v;
    });
  }, []);

  const togglePanel = useCallback(() => {
    setPanelCollapsed((v) => {
      panelCollapsedRef.current = !v;
      persistColumnLayout({
        sidebarWidth: sidebarWidthRef.current,
        panelWidth: panelWidthRef.current,
        sidebarCollapsed: sidebarCollapsedRef.current,
        panelCollapsed: !v,
      });
      return !v;
    });
  }, []);

  const cssVars = {
    "--sidebar-width": `${sidebarPx}px`,
    "--panel-width": `${panelPx}px`,
  } as CSSProperties;

  return {
    sidebarPx,
    panelPx,
    sidebarCollapsed,
    panelCollapsed,
    resizing,
    cssVars,
    toggleSidebar,
    togglePanel,
    resetSidebar,
    resetPanel,
    onSidebarResizeDown: onResizePointerDown("sidebar"),
    onPanelResizeDown: onResizePointerDown("panel"),
    onResizePointerMove,
    endResizeDrag,
    sidebarMin: SIDEBAR_WIDTH_MIN,
    sidebarMax: sidebarMaxNow,
    panelMin: PANEL_WIDTH_MIN,
    panelMax: panelMaxNow,
  };
}
