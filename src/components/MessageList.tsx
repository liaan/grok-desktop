import { Fragment, type ReactNode, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  matchSlashCommand,
  parseSlashInvocation,
  type SlashCommand,
} from "../lib/commands";
import { formatToolCard } from "../lib/tool-display";
import {
  formatClock,
  formatDayLabel,
  formatFullTimestamp,
  sameCalendarDay,
} from "../lib/time";
import type { TimelineItem } from "../vite-env";

function ToolBody({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const card = formatToolCard({
    title: item.title,
    kind: undefined,
    raw: item.raw,
    content: item.content,
  });
  const detail =
    card.detail &&
    (card.isCommand && !card.detail.startsWith("$")
      ? `$ ${card.detail}`
      : card.detail);

  return (
    <div className="tool-body">
      <div className="tool-header">
        <div className="tool-title-wrap">
          <div className="tool-action-label">{card.action}</div>
          <div
            className="tool-title"
            title={card.fullTitle || item.title}
          >
            {card.summary ||
              (card.fullTitle && card.fullTitle.length < 80
                ? card.fullTitle
                : card.detail
                  ? ""
                  : item.title)}
          </div>
          {card.subtitle && card.subtitle !== card.summary ? (
            <div className="tool-subtitle" title={card.subtitle}>
              {card.subtitle}
            </div>
          ) : null}
        </div>
        <span className={`tool-status ${item.status}`}>{item.status}</span>
      </div>
      {detail ? (
        <pre className="tool-input" title="Input">
          {detail}
        </pre>
      ) : null}
      {card.output ? (
        <pre className="tool-output" title="Output">
          {card.output}
        </pre>
      ) : null}
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

/** Only allow http(s) remote images; block data:/file: model-driven egress. */
function MarkdownImage({ src, alt }: { src?: string; alt?: string }) {
  if (!src || !/^https?:\/\//i.test(src)) {
    return (
      <span className="md-img-blocked" title={src || ""}>
        [{alt || "image blocked"}]
      </span>
    );
  }
  return <img src={src} alt={alt || ""} loading="lazy" />;
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

function sourceBadgeLabel(cmd?: SlashCommand): string {
  if (!cmd) return "slash";
  if (cmd.local || cmd.source === "desktop") return "app";
  if (cmd.source === "skill") return "skill";
  return "command";
}

/** User bubble: plain chat or highlighted /skill invocation (parse once). */
function UserMessage({
  text,
  images,
  at,
  knownCommands,
}: {
  text: string;
  images?: Extract<TimelineItem, { kind: "user" }>["images"];
  at?: number;
  knownCommands: SlashCommand[];
}) {
  const inv = parseSlashInvocation(text);
  const isCmd = Boolean(inv);
  const matched = inv
    ? matchSlashCommand(inv.name, knownCommands)
    : undefined;
  const badge = sourceBadgeLabel(matched);
  const restLines =
    inv && text.includes("\n") ? text.slice(text.indexOf("\n") + 1) : "";

  return (
    <article className={`msg user ${isCmd ? "user-command" : ""}`}>
      <MsgMeta role={isCmd ? "You · command" : "You"} at={at} />
      {images && images.length > 0 && (
        <div className="msg-images">
          {images.map((img, j) => (
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
      {text ? (
        inv ? (
          <div className="body body-command">
            <div
              className={`cmd-invocation ${matched ? "cmd-known" : "cmd-unknown"}`}
              title={
                matched
                  ? `${matched.description}${matched.local ? " (handled in app)" : " (sent to agent)"}`
                  : "Looks like a slash command — agent will interpret it"
              }
            >
              <span className={`cmd-badge ${badge}`}>{badge}</span>
              <code className="cmd-name">/{inv.name}</code>
              {matched ? (
                <span className="cmd-picked">
                  {matched.local ? "app command" : "skill / command"}
                </span>
              ) : (
                <span className="cmd-picked cmd-picked-soft">slash</span>
              )}
            </div>
            {inv.args ? <div className="cmd-args">{inv.args}</div> : null}
            {restLines ? <div className="cmd-rest">{restLines}</div> : null}
          </div>
        ) : (
          <div className="body">{text}</div>
        )
      ) : null}
    </article>
  );
}

export function MessageList({
  items,
  bottomRef,
  knownCommands = [],
}: {
  items: TimelineItem[];
  bottomRef: RefObject<HTMLDivElement | null>;
  /** Skills + agent + desktop commands for slash recognition in user bubbles */
  knownCommands?: SlashCommand[];
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
              <UserMessage
                text={item.text || ""}
                images={item.images}
                at={item.at}
                knownCommands={knownCommands}
              />
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
                    components={{ a: MarkdownLink, img: MarkdownImage }}
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
