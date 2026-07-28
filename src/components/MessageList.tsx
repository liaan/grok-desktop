import { Fragment, type ReactNode, type RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  matchSlashCommand,
  parseSlashInvocation,
  type SlashCommand,
} from "../lib/commands";
import {
  formatClock,
  formatDayLabel,
  formatFullTimestamp,
  sameCalendarDay,
} from "../lib/time";
import type { PermissionRequest, TimelineItem } from "../vite-env";
import { formatOptionLabel } from "../lib/timeline";
import { classifyOptionId } from "../../shared/permission-options.mjs";
import { usePrivacy } from "../lib/privacy-context";
import { buildToolCard, ToolCardView } from "./ToolCardView";

function ToolBody({ item }: { item: Extract<TimelineItem, { kind: "tool" }> }) {
  const { redact } = usePrivacy();
  const card = buildToolCard({
    title: item.title,
    raw: item.raw,
    content: item.content,
  });

  return (
    <div className="tool-body">
      <div className="tool-header">
        <div className="tool-title-wrap">
          <ToolCardView card={card} />
        </div>
        <span className={`tool-status ${item.status}`}>{item.status}</span>
      </div>
      {card.output ? (
        <pre className="tool-output" title="Output">
          {redact(card.output)}
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
  const { redact } = usePrivacy();
  const displayText = redact(text);
  const inv = parseSlashInvocation(text);
  const isCmd = Boolean(inv);
  const matched = inv
    ? matchSlashCommand(inv.name, knownCommands)
    : undefined;
  const badge = sourceBadgeLabel(matched);
  const restLines =
    inv && displayText.includes("\n")
      ? displayText.slice(displayText.indexOf("\n") + 1)
      : "";

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
      {displayText ? (
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
            {inv.args ? (
              <div className="cmd-args">{redact(inv.args)}</div>
            ) : null}
            {restLines ? <div className="cmd-rest">{restLines}</div> : null}
          </div>
        ) : (
          <div className="body">{displayText}</div>
        )
      ) : null}
    </article>
  );
}

function PendingApprovalCard({
  request,
  onPermission,
}: {
  request: PermissionRequest;
  onPermission?: (reqId: string, optionId: string | "cancelled") => void;
}) {
  const tool = request.params?.toolCall;
  const options = request.params?.options?.length
    ? request.params.options
    : [
        { optionId: "allow-once", name: "Allow once" },
        { optionId: "reject", name: "Reject" },
      ];
  const card = buildToolCard({
    title: tool?.title,
    kind: tool?.kind,
    raw: tool?.rawInput,
  });

  return (
    <article
      className="msg pending-approval"
      role="status"
      aria-live="polite"
    >
      <div className="meta">
        <span className="meta-role">Approval</span>
        <span className="pending-approval-pill">Waiting</span>
      </div>
      <div className="body pending-approval-body">
        <div className="pending-approval-title">
          Waiting for tool approval…
        </div>
        <ToolCardView card={card} />
        {onPermission ? (
          <div className="perm-actions">
            {options.map((opt) => {
              const cls = classifyOptionId(opt.optionId, options);
              const allow =
                cls === "allow_once" || cls === "allow_always";
              return (
                <button
                  key={opt.optionId}
                  type="button"
                  className={allow ? "btn primary" : "btn"}
                  onClick={() => onPermission(request.reqId, opt.optionId)}
                >
                  {formatOptionLabel(opt.optionId, opt.name)}
                </button>
              );
            })}
            <button
              type="button"
              className="btn danger"
              onClick={() => onPermission(request.reqId, "cancelled")}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="pending-approval-hint">Waiting for approval…</div>
        )}
      </div>
    </article>
  );
}

export function MessageList({
  items,
  bottomRef,
  knownCommands = [],
  pendingPermissions = [],
  onPermission,
  onAllowAllPermissions,
}: {
  items: TimelineItem[];
  bottomRef: RefObject<HTMLDivElement | null>;
  /** Skills + agent + desktop commands for slash recognition in user bubbles */
  knownCommands?: SlashCommand[];
  /** Open session/request_permission gates (renderer-only; not from ACP timeline) */
  pendingPermissions?: PermissionRequest[];
  onPermission?: (reqId: string, optionId: string | "cancelled") => void;
  /** Batch-approve every open request (multi-edit batches) */
  onAllowAllPermissions?: () => void;
}) {
  if (items.length === 0 && pendingPermissions.length === 0) {
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
    <MessageListBody
      items={items}
      bottomRef={bottomRef}
      knownCommands={knownCommands}
      pendingPermissions={pendingPermissions}
      onPermission={onPermission}
      onAllowAllPermissions={onAllowAllPermissions}
    />
  );
}

function MessageListBody({
  items,
  bottomRef,
  knownCommands,
  pendingPermissions,
  onPermission,
  onAllowAllPermissions,
}: {
  items: TimelineItem[];
  bottomRef: RefObject<HTMLDivElement | null>;
  knownCommands: SlashCommand[];
  pendingPermissions: PermissionRequest[];
  onPermission?: (reqId: string, optionId: string | "cancelled") => void;
  onAllowAllPermissions?: () => void;
}) {
  const { redact } = usePrivacy();

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
                    {redact(item.text)}
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
                <div className="body">{redact(item.text)}</div>
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
                        {redact(
                          typeof e === "string"
                            ? e
                            : e?.content || JSON.stringify(e),
                        )}
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
              <div className="body">{redact(item.text)}</div>
            </article>
          </Fragment>
        );
      })}
      {pendingPermissions.length > 1 && onAllowAllPermissions ? (
        <div className="perm-batch-inline" role="region" aria-label="Batch approvals">
          <p className="perm-batch-hint">
            {pendingPermissions.length} tools waiting — Allow all grants each
            once so multi-edit batches do not stall.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => onAllowAllPermissions()}
          >
            Allow all ({pendingPermissions.length})
          </button>
        </div>
      ) : null}
      {pendingPermissions.map((p) => (
        <PendingApprovalCard
          key={p.reqId}
          request={p}
          onPermission={onPermission}
        />
      ))}
      <div ref={bottomRef} />
    </>
  );
}
