import { useEffect, useRef } from "react";
import type { SlashCommand } from "../lib/commands";

export function CommandMenu({
  items,
  activeIndex,
  onSelect,
  onHover,
}: {
  items: SlashCommand[];
  activeIndex: number;
  /** insert = Tab/click; run = Enter */
  onSelect: (cmd: SlashCommand, mode: "insert" | "run") => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>(
      `[data-cmd-index="${activeIndex}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, items.length]);

  if (items.length === 0) {
    return (
      <div className="command-menu" role="listbox" aria-label="Slash commands">
        <div className="command-menu-empty">No matching commands</div>
      </div>
    );
  }

  return (
    <div className="command-menu" role="listbox" aria-label="Slash commands">
      <div className="command-menu-hint">
        Skills &amp; commands · ↑↓ · Enter run · Tab/click complete · Esc dismiss
      </div>
      <ul className="command-menu-list" ref={listRef}>
        {items.map((cmd, i) => {
          const active = i === activeIndex;
          return (
            <li key={`${cmd.source}:${cmd.name}`}>
              <button
                type="button"
                role="option"
                data-cmd-index={i}
                aria-selected={active}
                className={`command-menu-item ${active ? "active" : ""}`}
                onMouseEnter={() => onHover(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => onSelect(cmd, "insert")}
              >
                <span className="command-menu-name">/{cmd.name}</span>
                <span className="command-menu-desc">
                  {cmd.inputHint
                    ? `${cmd.description} · ${cmd.inputHint}`
                    : cmd.description}
                </span>
                <span className={`command-menu-badge ${cmd.source}`}>
                  {cmd.source === "desktop"
                    ? "app"
                    : cmd.source === "skill"
                      ? "skill"
                      : "agent"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
