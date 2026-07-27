import {
  formatCommandDetail,
  formatToolCard,
  toolCardHeading,
  type ToolCard,
  type ToolDisplay,
} from "../lib/tool-display";

export type BuiltToolCard = ToolCard &
  ToolDisplay & {
    detailDisplay?: string;
    heading?: string;
  };

/**
 * Shared action / summary / $command layout for Approvals, pending banners,
 * and timeline tool rows.
 */
export function buildToolCard(item: {
  title?: string | null;
  kind?: string | null;
  raw?: unknown;
  content?: unknown;
}): BuiltToolCard {
  const card = formatToolCard(item);
  return {
    ...card,
    detailDisplay: formatCommandDetail(card),
    heading: toolCardHeading(card),
  };
}

export function ToolCardView({
  card,
  meta,
  className = "",
}: {
  card: ReturnType<typeof buildToolCard>;
  /** Optional meta line under the detail (kind · id) */
  meta?: string;
  className?: string;
}) {
  return (
    <div className={`tool-card-view ${className}`.trim()}>
      <div className="tool-card-action">{card.action}</div>
      {card.heading ? (
        <div className="tool-card-heading" title={card.fullTitle}>
          {card.heading}
        </div>
      ) : null}
      {card.detailDisplay ? (
        <pre className="tool-input tool-card-detail" title={card.detail}>
          {card.detailDisplay}
        </pre>
      ) : null}
      {meta ? <div className="tool-card-meta">{meta}</div> : null}
    </div>
  );
}
