import { Fragment, type ReactNode, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  formatClock,
  formatDayLabel,
  formatFullTimestamp,
  sameCalendarDay,
} from "../lib/time";
import type { TimelineItem } from "../vite-env";

function ToolBody({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const raw =
    item.raw !== undefined
      ? typeof item.raw === "string"
        ? item.raw
        : JSON.stringify(item.raw, null, 2)
      : null;
  const content =
    item.content !== undefined
      ? typeof item.content === "string"
        ? item.content
        : JSON.stringify(item.content, null, 2)
      : null;

  return (
    <div>
      <div className="tool-header">
        <div className="tool-title" title={item.title}>
          {item.title}
        </div>
        <span className={`tool-status ${item.status}`}>{item.status}</span>
      </div>
      {raw && (
        <pre style={{ marginTop: 8, maxHeight: 160, overflow: "auto" }}>{raw}</pre>
      )}
      {content && (
        <pre style={{ marginTop: 8, maxHeight: 180, overflow: "auto" }}>
          {content}
        </pre>
      )}
    </div>
  );
}

function MarkdownLink({
  href,
  children,
}: {
  href?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//i.test(href)) {
          void window.grokDesktop.openExternal(href);
        }
      }}
    >
      {children}
    </a>
  );
}

function MsgMeta({ role, at }: { role: string; at?: number }) {
  const clock = formatClock(at);
  return (
    <div className="meta">
      <span className="meta-role">{role}</span>
      {clock ? (
        <time
          className="meta-time"
          dateTime={at ? new Date(at).toISOString() : undefined}
          title={formatFullTimestamp(at)}
        >
          {clock}
        </time>
      ) : null}
    </div>
  );
}

function DayDivider({ at }: { at: number }) {
  const label = formatDayLabel(at);
  if (!label) return null;
  return (
    <div className="day-divider" role="separator">
      <span>{label}</span>
    </div>
  );
}

export function MessageList({
  items,
  bottomRef,
}: {
  items: TimelineItem[];
  bottomRef: RefObject<HTMLDivElement | null>;
}) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <h2>What should we build?</h2>
        <p>
          This desktop app is a GUI on top of the Grok agent backbone
          (<code>grok agent stdio</code> + ACP). Skills, MCP, auth, and models still
          come from your Grok install.
        </p>
      </div>
    );
  }

  return (
    <>
      {items.map((item, i) => {
        const prev = i > 0 ? items[i - 1] : null;
        const showDay =
          typeof item.at === "number" &&
          (!prev ||
            typeof prev.at !== "number" ||
            !sameCalendarDay(prev.at, item.at));

        const day =
          showDay && typeof item.at === "number" ? (
            <DayDivider at={item.at} />
          ) : null;

        if (item.kind === "user") {
          return (
            <Fragment key={item.id}>
              {day}
              <article className="msg user">
                <MsgMeta role="You" at={item.at} />
                {item.images && item.images.length > 0 && (
                  <div className="msg-images">
                    {item.images.map((img, j) => (
                      <button
                        key={j}
                        type="button"
                        className="msg-image"
                        title="Image attachment"
                        onClick={(e) => e.preventDefault()}
                      >
                        <img src={img.previewUrl} alt={`Attachment ${j + 1}`} />
                      </button>
                    ))}
                  </div>
                )}
                {item.text ? <div className="body">{item.text}</div> : null}
              </article>
            </Fragment>
          );
        }
        if (item.kind === "assistant") {
          return (
            <Fragment key={item.id}>
              {day}
              <article className="msg">
                <MsgMeta role="Grok" at={item.at} />
                <div className="body markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ a: MarkdownLink }}
                  >
                    {item.text}
                  </ReactMarkdown>
                </div>
              </article>
            </Fragment>
          );
        }
        if (item.kind === "thought") {
          return (
            <Fragment key={item.id}>
              {day}
              <article className="msg thought">
                <MsgMeta role="Thinking" at={item.at} />
                <div className="body">{item.text}</div>
              </article>
            </Fragment>
          );
        }
        if (item.kind === "tool") {
          return (
            <Fragment key={item.id}>
              {day}
              <article className="msg tool">
                <MsgMeta role="Tool" at={item.at} />
                <ToolBody item={item} />
              </article>
            </Fragment>
          );
        }
        if (item.kind === "plan") {
          return (
            <Fragment key={item.id}>
              {day}
              <article className="msg plan">
                <MsgMeta role="Plan" at={item.at} />
                <div className="body">
                  <ol>
                    {(item.entries as any[]).map((e, j) => (
                      <li key={j}>
                        {typeof e === "string"
                          ? e
                          : e?.content || JSON.stringify(e)}
                        {e?.status ? ` — ${e.status}` : ""}
                      </li>
                    ))}
                  </ol>
                </div>
              </article>
            </Fragment>
          );
        }
        return (
          <Fragment key={item.id}>
            {day}
            <article className="msg">
              <MsgMeta role="System" at={item.at} />
              <div className="body">{item.text}</div>
            </article>
          </Fragment>
        );
      })}
      <div ref={bottomRef} />
    </>
  );
}
