/** Collapse / expand a sidebar or files rail. */
export function ColToggle({
  collapsed,
  expandToward,
  labelExpand,
  labelCollapse,
  onClick,
}: {
  collapsed: boolean;
  /** Direction the column grows when expanding. */
  expandToward: "left" | "right";
  labelExpand: string;
  labelCollapse: string;
  onClick: () => void;
}) {
  const label = collapsed ? labelExpand : labelCollapse;
  const chevronRight =
    expandToward === "right" ? collapsed : !collapsed;
  return (
    <button
      type="button"
      className={"col-toggle" + (collapsed ? " col-toggle--expand" : "")}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      onClick={onClick}
    >
      <svg
        className="col-toggle-icon"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        aria-hidden
      >
        <polyline
          points={chevronRight ? "5 2.5 10 7 5 11.5" : "9 2.5 4 7 9 11.5"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
