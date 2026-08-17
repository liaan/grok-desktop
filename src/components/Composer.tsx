import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DESKTOP_COMMANDS,
  filterCommands,
  formatCommandInsert,
  isSlashMenuOpen,
  slashQuery,
  type SlashCommand,
} from "../lib/commands";
import type { ConnState } from "../lib/conn";
import {
  encodePendingImages,
  filesToPendingImages,
  revokePendingImagePreview,
  type PendingImage,
} from "../lib/pending-images";
import { CommandMenu } from "./CommandMenu";

export type QueuedPrompt = {
  id: string;
  text: string;
  images: PendingImage[];
  imageQuality?: "compact" | "high";
  at: number;
};

export type ComposerSubmit = {
  text: string;
  images: PendingImage[];
  mode: "auto" | "queue" | "now";
  imageQuality?: "compact" | "high";
};

const COMPOSER_HEIGHT_KEY = "grok-desktop-composer-height";
/** Default textarea height (matches previous CSS min-height). */
const COMPOSER_HEIGHT_DEFAULT = 72;
/** Floor so the field stays usable. */
const COMPOSER_HEIGHT_MIN = 72;
/**
 * Leave room for topbar, status bar, chrome, and a sliver of timeline.
 * Users can still pull nearly full-screen (~90vh of the window).
 */
function composerHeightMax(): number {
  if (typeof window === "undefined") return 720;
  return Math.max(
    COMPOSER_HEIGHT_MIN,
    Math.round(window.innerHeight * 0.9) - 120,
  );
}

function readStoredComposerHeight(): number {
  try {
    const raw = localStorage.getItem(COMPOSER_HEIGHT_KEY);
    if (!raw) return COMPOSER_HEIGHT_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return COMPOSER_HEIGHT_DEFAULT;
    return Math.min(composerHeightMax(), Math.max(COMPOSER_HEIGHT_MIN, Math.round(n)));
  } catch {
    return COMPOSER_HEIGHT_DEFAULT;
  }
}

function persistComposerHeight(px: number) {
  try {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(Math.round(px)));
  } catch {
    /* private mode / quota */
  }
}

/**
 * Draft composer: owns input, attachments, and slash menu so keystrokes do not
 * re-render the chat shell. Parent owns queue + agent delivery.
 */
export const Composer = memo(function Composer({
  conn,
  projectOpen,
  commands,
  promptQueue,
  onSubmit,
  onLocalCommand,
  onSendQueuedNow,
  onRemoveQueued,
  onError,
}: {
  conn: ConnState;
  projectOpen: boolean;
  commands: SlashCommand[];
  promptQueue: QueuedPrompt[];
  /** Return true when the draft should clear (accepted queue/delivery). */
  onSubmit: (payload: ComposerSubmit) => boolean | Promise<boolean>;
  /** Desktop-only slash (e.g. /new, /always-approve) — never reaches the agent. */
  onLocalCommand: (name: string, args?: string) => void;
  onSendQueuedNow: (id?: string) => void;
  onRemoveQueued: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [highDetail, setHighDetail] = useState(false);
  const [cmdIndex, setCmdIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [composerHeight, setComposerHeight] = useState(readStoredComposerHeight);
  const [resizing, setResizing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptQueueRef = useRef(promptQueue);
  promptQueueRef.current = promptQueue;
  const heightRef = useRef(composerHeight);
  heightRef.current = composerHeight;
  const resizeDragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  const menuOpen = isSlashMenuOpen(input) && !slashDismissed;
  const filteredCommands = useMemo(
    () => (menuOpen ? filterCommands(commands, slashQuery(input)) : []),
    [menuOpen, commands, input],
  );

  useEffect(() => {
    setCmdIndex(0);
    setSlashDismissed(false);
  }, [input]);

  useEffect(() => {
    if (cmdIndex >= filteredCommands.length) {
      setCmdIndex(Math.max(0, filteredCommands.length - 1));
    }
  }, [filteredCommands.length, cmdIndex]);

  // Keep height in range when the window is resized (e.g. maximize / dock).
  useEffect(() => {
    const onResize = () => {
      const max = composerHeightMax();
      setComposerHeight((h) => {
        const next = Math.min(max, Math.max(COMPOSER_HEIGHT_MIN, h));
        if (next !== h) persistComposerHeight(next);
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const clampComposerHeight = useCallback((px: number) => {
    return Math.min(
      composerHeightMax(),
      Math.max(COMPOSER_HEIGHT_MIN, Math.round(px)),
    );
  }, []);

  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      resizeDragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: heightRef.current,
      };
      setResizing(true);
    },
    [],
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      // Drag up grows the input (handle sits on the top edge).
      const next = clampComposerHeight(
        drag.startHeight + (drag.startY - e.clientY),
      );
      setComposerHeight(next);
    },
    [clampComposerHeight],
  );

  const endResizeDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      resizeDragRef.current = null;
      setResizing(false);
      persistComposerHeight(heightRef.current);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    [],
  );

  const onResizeDoubleClick = useCallback(() => {
    setComposerHeight(COMPOSER_HEIGHT_DEFAULT);
    persistComposerHeight(COMPOSER_HEIGHT_DEFAULT);
  }, []);

  const clearDraft = useCallback(() => {
    setPendingImages((prev) => {
      for (const img of prev) revokePendingImagePreview(img);
      return [];
    });
    setInput("");
    setHighDetail(false);
  }, []);

  const addImages = useCallback(
    async (files: ArrayLike<Blob | File>) => {
      const { images, error } = await filesToPendingImages(files);
      if (images.length) {
        setPendingImages((prev) => [...prev, ...images]);
      }
      if (error) onError(error);
    },
    [onError],
  );

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const next = prev.filter((img) => {
        if (img.id === id) revokePendingImagePreview(img);
        return img.id !== id;
      });
      if (next.length === 0) setHighDetail(false);
      return next;
    });
  }, []);

  const submit = useCallback(
    async (overrideText?: string, mode: ComposerSubmit["mode"] = "auto") => {
      const text = (overrideText !== undefined ? overrideText : input).trim();
      const draftImages = overrideText !== undefined ? [] : pendingImages;
      if (!text && draftImages.length === 0) return;
      if (conn === "connecting" || !projectOpen) return;

      // Desktop-local slash commands (do not send to agent)
      const localMatch = text.match(/^\/([^\s]+)(?:\s+(.*))?$/s);
      if (localMatch) {
        const name = localMatch[1].toLowerCase();
        const local = DESKTOP_COMMANDS.find(
          (c) => c.local && c.name.toLowerCase() === name,
        );
        if (local) {
          clearDraft();
          onLocalCommand(name, (localMatch[2] || "").trim());
          return;
        }
      }

      const imageQuality = highDetail ? "high" : "compact";
      let images = draftImages;
      if (draftImages.length) {
        try {
          images = await encodePendingImages(draftImages, imageQuality);
        } catch (e: unknown) {
          onError(e instanceof Error ? e.message : String(e));
          return;
        }
      }

      // Only wipe the draft after the parent accepts (queue / deliver / interject).
      const accepted = await onSubmit({
        text,
        images: images.map((img) => ({ ...img })),
        mode,
        imageQuality,
      });
      if (accepted) clearDraft();
    },
    [
      input,
      pendingImages,
      highDetail,
      conn,
      projectOpen,
      clearDraft,
      onLocalCommand,
      onError,
      onSubmit,
    ],
  );

  const applySlashCommand = useCallback(
    (cmd: SlashCommand, mode: "insert" | "run" = "run") => {
      if (cmd.local && !cmd.inputHint) {
        clearDraft();
        onLocalCommand(cmd.name);
        return;
      }
      if (mode === "insert" || cmd.inputHint) {
        setInput(formatCommandInsert(cmd));
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (!el) return;
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        });
        return;
      }
      void submit(`/${cmd.name}`, "auto");
    },
    [clearDraft, onLocalCommand, submit],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdIndex(
          (i) =>
            (i - 1 + filteredCommands.length) % filteredCommands.length,
        );
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cmd = filteredCommands[cmdIndex] || filteredCommands[0];
        if (cmd) applySlashCommand(cmd, "insert");
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredCommands[cmdIndex] || filteredCommands[0];
        if (cmd) applySlashCommand(cmd, "run");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit(undefined, "now");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (
        !input.trim() &&
        pendingImages.length === 0 &&
        promptQueueRef.current.length > 0
      ) {
        onSendQueuedNow();
        return;
      }
      void submit(undefined, "auto");
    }
  };

  const onPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles: File[] = [];
    const items = e.clipboardData?.items;
    if (items?.length) {
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
    }
    if (imageFiles.length === 0 && e.clipboardData?.files?.length) {
      for (const file of Array.from(e.clipboardData.files)) {
        if (file.type.startsWith("image/")) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;
    const hasText = Boolean(e.clipboardData?.getData("text/plain")?.trim());
    if (!hasText) e.preventDefault();
    await addImages(imageFiles);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length) await addImages(files);
  };

  const tall =
    composerHeight >= Math.min(composerHeightMax() * 0.45, 280);

  return (
    <div
      className={
        "composer" +
        (resizing ? " composer--resizing" : "") +
        (tall ? " composer--tall" : "")
      }
    >
      <div
        className="composer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize input"
        aria-valuemin={COMPOSER_HEIGHT_MIN}
        aria-valuemax={composerHeightMax()}
        aria-valuenow={composerHeight}
        title="Drag to resize input · double-click to reset"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResizeDrag}
        onPointerCancel={endResizeDrag}
        onDoubleClick={onResizeDoubleClick}
      >
        <span className="composer-resize-grip" aria-hidden />
      </div>
      <div
        className="composer-box"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => void onDrop(e)}
      >
        {menuOpen && (
          <CommandMenu
            items={filteredCommands}
            activeIndex={cmdIndex}
            onHover={setCmdIndex}
            onSelect={applySlashCommand}
          />
        )}
        {pendingImages.length > 0 && (
          <div className="composer-attach">
            <div className="composer-images">
              {pendingImages.map((img) => (
                <div key={img.id} className="composer-image">
                  <img src={img.previewUrl} alt={img.name || "Attached"} />
                  <button
                    type="button"
                    className="composer-image-remove"
                    title="Remove image"
                    onClick={() => removePendingImage(img.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <label className="composer-image-quality">
              <input
                type="checkbox"
                checked={highDetail}
                onChange={(e) => setHighDetail(e.target.checked)}
              />
              <span>
                <span className="composer-image-quality-label">
                  Higher detail
                </span>
                <span className="composer-image-quality-hint">
                  This send only · uses more tokens
                </span>
              </span>
            </label>
          </div>
        )}
        {promptQueue.length > 0 && (
          <div className="prompt-queue" aria-label="Queued follow-ups">
            <div className="prompt-queue-head">
              <span>
                Queue · {promptQueue.length} follow-up
                {promptQueue.length === 1 ? "" : "s"}
              </span>
              <span className="prompt-queue-hint">
                runs after this turn · Enter on empty = send top now
              </span>
            </div>
            <ul className="prompt-queue-list">
              {promptQueue.map((q, i) => (
                <li key={q.id} className="prompt-queue-item">
                  <span className="prompt-queue-idx">{i + 1}</span>
                  <span className="prompt-queue-text" title={q.text}>
                    {q.text ||
                      `(${q.images.length} image${q.images.length === 1 ? "" : "s"})`}
                  </span>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="Send now (stops current turn)"
                    disabled={conn === "connecting"}
                    onClick={() => onSendQueuedNow(q.id)}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    title="Remove from queue"
                    onClick={() => onRemoveQueued(q.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          style={{ height: composerHeight }}
          placeholder={
            conn === "busy"
              ? "Interject: Enter queues · Ctrl/⌘+Enter sends now (stops turn)…"
              : "Ask Grok… or type / for skills & commands (review, design, implement…)"
          }
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => void onPaste(e)}
          onKeyDown={onKeyDown}
          disabled={conn === "connecting"}
        />
        <div className="composer-actions">
          <div className="row" style={{ gap: 8, minWidth: 0 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void addImages(files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={conn === "connecting"}
              onClick={() => fileInputRef.current?.click()}
              title="Attach images"
            >
              Attach
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {conn === "busy"
                ? "Enter queue · Ctrl/⌘+Enter send now · Shift+Enter newline"
                : "/ commands · Enter send · Shift+Enter newline"}
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {conn === "busy" &&
              (input.trim() || pendingImages.length > 0) && (
                <button
                  type="button"
                  className="btn"
                  title="Stop current turn and send this message now"
                  onClick={() => void submit(undefined, "now")}
                >
                  Send now
                </button>
              )}
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void submit(undefined, conn === "busy" ? "queue" : "auto")
              }
              disabled={
                (!input.trim() && pendingImages.length === 0) ||
                conn === "connecting" ||
                !projectOpen
              }
            >
              {conn === "busy" ? "Queue" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
