import { shouldRenderDiff } from "../lib/line-diff";
import {
  formatCommandDetail,
  formatToolCard,
  toolCardHeading,
  type ToolCard,
  type ToolDisplay,
} from "../lib/tool-display";
import { usePrivacy } from "../lib/privacy-context";
import { DiffView } from "./DiffView";

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
  const { redact } = usePrivacy();
  const heading = card.heading ? redact(card.heading) : undefined;
  const detail = card.detailDisplay ? redact(card.detailDisplay) : undefined;
  const fullTitle = card.fullTitle ? redact(card.fullTitle) : undefined;
  const detailTitle = card.detail ? redact(card.detail) : undefined;
  const metaText = meta ? redact(meta) : undefined;

  return (
    <div className={`tool-card-view ${className}`.trim()}>
      <div className="tool-card-action">{card.action}</div>
      {heading ? (
        <div className="tool-card-heading" title={fullTitle}>
          {heading}
        </div>
      ) : null}
      {detail ? (
        <pre className="tool-input tool-card-detail" title={detailTitle}>
          {detail}
        </pre>
      ) : null}
      {shouldRenderDiff(card.diff) && card.diff ? (
        <DiffView diff={card.diff} />
      ) : null}
      {metaText ? <div className="tool-card-meta">{metaText}</div> : null}
    </div>
  );
}
