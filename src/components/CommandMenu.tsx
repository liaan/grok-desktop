import { useEffect, useRef } from "react";
import { commandDescription, type SlashCommand } from "../lib/commands";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();

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
      <div className="command-menu" role="listbox" aria-label={t("cmd.aria")}>
        <div className="command-menu-empty">{t("cmd.empty")}</div>
      </div>
    );
  }

  return (
    <div className="command-menu" role="listbox" aria-label={t("cmd.aria")}>
      <div className="command-menu-hint">{t("cmd.hint")}</div>
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
                    ? `${commandDescription(cmd, t)} · ${cmd.inputHint}`
                    : commandDescription(cmd, t)}
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
