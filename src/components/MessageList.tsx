import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div className="tool-title">{item.title}</div>
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

export function MessageList({
  items,
  bottomRef,
}: {
  items: TimelineItem[];
  bottomRef: React.RefObject<HTMLDivElement | null>;
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
      {items.map((item) => {
        if (item.kind === "user") {
          return (
            <article key={item.id} className="msg user">
              <div className="meta">
                <span>You</span>
              </div>
              {item.images && item.images.length > 0 && (
                <div className="msg-images">
                  {item.images.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      className="msg-image"
                      title="Image attachment"
                      onClick={(e) => e.preventDefault()}
                    >
                      <img src={img.previewUrl} alt={`Attachment ${i + 1}`} />
                    </button>
                  ))}
                </div>
              )}
              {item.text ? <div className="body">{item.text}</div> : null}
            </article>
          );
        }
        if (item.kind === "assistant") {
          return (
            <article key={item.id} className="msg">
              <div className="meta">
                <span>Grok</span>
              </div>
              <div className="body">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {item.text}
                </ReactMarkdown>
              </div>
            </article>
          );
        }
        if (item.kind === "thought") {
          return (
            <article key={item.id} className="msg thought">
              <div className="meta">
                <span>Thinking</span>
              </div>
              <div className="body">{item.text}</div>
            </article>
          );
        }
        if (item.kind === "tool") {
          return (
            <article key={item.id} className="msg tool">
              <div className="meta">
                <span>Tool</span>
              </div>
              <ToolBody item={item} />
            </article>
          );
        }
        if (item.kind === "plan") {
          return (
            <article key={item.id} className="msg plan">
              <div className="meta">
                <span>Plan</span>
              </div>
              <div className="body">
                <ol>
                  {(item.entries as any[]).map((e, i) => (
                    <li key={i}>
                      {typeof e === "string"
                        ? e
                        : e?.content || JSON.stringify(e)}
                      {e?.status ? ` — ${e.status}` : ""}
                    </li>
                  ))}
                </ol>
              </div>
            </article>
          );
        }
        return (
          <article key={item.id} className="msg">
            <div className="meta">
              <span>System</span>
            </div>
            <div className="body">{item.text}</div>
          </article>
        );
      })}
      <div ref={bottomRef} />
    </>
  );
}
