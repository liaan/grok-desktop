import { useMemo, useState } from "react";
import {
  countDiffLines,
  DIFF_COLLAPSE_LINES,
  sliceStructuredDiff,
  type DiffLine,
  type StructuredDiff,
} from "../lib/line-diff";
import { usePrivacy } from "../lib/privacy-context";

function lineMark(kind: DiffLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "del") return "-";
  return " ";
}

export function DiffView({
  diff,
  className = "",
}: {
  diff: StructuredDiff;
  className?: string;
}) {
  const { redact } = usePrivacy();
  const [expanded, setExpanded] = useState(false);
  const totalLines = countDiffLines(diff);
  const large = totalLines > DIFF_COLLAPSE_LINES;
  const truncated = diff.files.some((f) => f.truncated);

  const shown = useMemo(
    () => (expanded || !large ? diff : sliceStructuredDiff(diff, DIFF_COLLAPSE_LINES)),
    [diff, expanded, large],
  );

  return (
    <div
      className={`diff-view ${expanded ? "is-expanded" : ""} ${className}`.trim()}
    >
      {shown.files.map((file, fi) => (
        <div key={file.path || fi} className="diff-file">
          {file.path ? (
            <div className="diff-path" title={redact(file.path)}>
              {redact(file.path)}
            </div>
          ) : null}
          {file.hunks.map((hunk, hi) => (
            <div key={hi} className="diff-hunk">
              <div className="diff-hunk-header">
                {`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`}
              </div>
              {hunk.lines.map((line, li) => (
                <div
                  key={li}
                  className={`diff-line diff-line-${line.kind}`}
                >
                  <span className="diff-gutter" aria-hidden="true">
                    {lineMark(line.kind)}
                  </span>
                  <span className="diff-text">{redact(line.text)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {truncated ? <div className="diff-truncated">… (truncated)</div> : null}
      {large ? (
        <button
          type="button"
          className="btn btn-sm ghost diff-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
