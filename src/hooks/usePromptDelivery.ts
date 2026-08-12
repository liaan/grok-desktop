import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { ComposerSubmit, QueuedPrompt } from "../components/Composer";
import type { PendingImage } from "../lib/pending-images";
import { isAuthError, type ConnState } from "../lib/conn";
import { finalizeOpenTools, uid } from "../lib/timeline";
import type { TimelineImage, TimelineItem } from "../vite-env";

/**
 * Mid-turn queue + session/prompt delivery (CLI-style Enter / Ctrl+Enter).
 * Owns promptQueue state; App only wires Composer + pinToBottom.
 */
export function usePromptDelivery(opts: {
  project: string | null;
  conn: ConnState;
  busyRef: MutableRefObject<boolean>;
  openingRef: MutableRefObject<boolean>;
  pinToBottom: () => void;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setItems: Dispatch<SetStateAction<TimelineItem[]>>;
  refreshAuth: () => void;
}) {
  const {
    project,
    conn,
    busyRef,
    openingRef,
    pinToBottom,
    setConn,
    setError,
    setItems,
    refreshAuth,
  } = opts;

  const [promptQueue, setPromptQueue] = useState<QueuedPrompt[]>([]);
  const promptQueueRef = useRef<QueuedPrompt[]>([]);
  const sendNowRef = useRef<QueuedPrompt | null>(null);
  const deliveryGenRef = useRef(0);
  const deliverRef = useRef<(payload: {
    text: string;
    images: PendingImage[];
  }) => Promise<void>>(async () => {});

  useEffect(() => {
    promptQueueRef.current = promptQueue;
  }, [promptQueue]);

  const clearPromptQueue = useCallback(() => {
    deliveryGenRef.current += 1;
    setPromptQueue([]);
    promptQueueRef.current = [];
    sendNowRef.current = null;
  }, []);

  const enqueuePrompt = useCallback(
    (text: string, images: PendingImage[]) => {
      const item: QueuedPrompt = {
        id: uid("q"),
        text,
        images: images.map((img) => ({ ...img })),
        at: Date.now(),
      };
      setPromptQueue((prev) => {
        const next = [...prev, item];
        promptQueueRef.current = next;
        return next;
      });
      return item;
    },
    [],
  );

  const removeQueued = useCallback((id: string) => {
    setPromptQueue((prev) => {
      const next = prev.filter((q) => q.id !== id);
      promptQueueRef.current = next;
      return next;
    });
    if (sendNowRef.current?.id === id) sendNowRef.current = null;
  }, []);

  const deliverPrompt = useCallback(
    async (payload: { text: string; images: PendingImage[] }) => {
      if (!project || busyRef.current || openingRef.current) return;
      const text = payload.text.trim();
      const images = payload.images;
      if (!text && images.length === 0) return;

      const gen = deliveryGenRef.current;
      pinToBottom();
      busyRef.current = true;
      setConn("busy");
      const timelineImages: TimelineImage[] = images.map((img) => ({
        mimeType: img.mimeType,
        previewUrl: img.previewUrl,
      }));
      setItems((prev) => [
        ...prev,
        {
          id: uid("user"),
          kind: "user",
          text:
            text ||
            (images.length
              ? `(${images.length} image${images.length > 1 ? "s" : ""})`
              : ""),
          images: timelineImages.length ? timelineImages : undefined,
          optimistic: true,
          at: Date.now(),
        },
      ]);
      const stale = () =>
        openingRef.current || deliveryGenRef.current !== gen;
      try {
        await window.grokDesktop.prompt(text, {
          images: images.map(({ data, mimeType }) => ({ data, mimeType })),
        });
        if (stale()) return;
        setItems((prev) => finalizeOpenTools(prev, "completed"));
        setConn("online");
      } catch (e: unknown) {
        if (stale()) return;
        const msg = e instanceof Error ? e.message : String(e);
        const cancelled = /cancel/i.test(msg);
        if (cancelled) {
          setItems((prev) => finalizeOpenTools(prev, "cancelled"));
          setConn("online");
        } else {
          setConn("error");
          setError(msg);
          setItems((prev) => [
            ...finalizeOpenTools(prev, "failed"),
            {
              id: uid("sys"),
              kind: "system",
              text: `Error: ${msg}`,
              at: Date.now(),
            },
          ]);
          if (isAuthError(msg)) refreshAuth();
        }
      } finally {
        busyRef.current = false;
        if (stale()) return;
        const nextNow = sendNowRef.current;
        if (nextNow) {
          sendNowRef.current = null;
          setPromptQueue((prev) => {
            const next = prev.filter((q) => q.id !== nextNow.id);
            promptQueueRef.current = next;
            return next;
          });
          void deliverRef.current({
            text: nextNow.text,
            images: nextNow.images,
          });
          return;
        }
        const queued = promptQueueRef.current[0];
        if (queued) {
          setPromptQueue((prev) => {
            const next = prev.slice(1);
            promptQueueRef.current = next;
            return next;
          });
          void deliverRef.current({
            text: queued.text,
            images: queued.images,
          });
        }
      }
    },
    [
      project,
      busyRef,
      openingRef,
      pinToBottom,
      setConn,
      setError,
      setItems,
      refreshAuth,
    ],
  );

  deliverRef.current = deliverPrompt;

  /**
   * Accept composer submit. Returns true when the draft should clear
   * (queued, interject, or delivered). False when refused (opening / no project).
   */
  const submitFromComposer = useCallback(
    async ({ text, images, mode }: ComposerSubmit): Promise<boolean> => {
      if (!project || openingRef.current || conn === "connecting") {
        return false;
      }
      if (!text && images.length === 0) return false;

      if (busyRef.current) {
        if (mode === "now") {
          const item = enqueuePrompt(text, images);
          sendNowRef.current = item;
          setItems((prev) => finalizeOpenTools(prev, "cancelled"));
          void window.grokDesktop.cancel();
          return true;
        }
        enqueuePrompt(text, images);
        return true;
      }

      // Do not await the full turn — Composer clears the draft on this true.
      // deliverPrompt owns busy/queue drain for the rest of the turn.
      void deliverPrompt({ text, images });
      return true;
    },
    [
      project,
      openingRef,
      conn,
      busyRef,
      enqueuePrompt,
      setItems,
      deliverPrompt,
    ],
  );

  const sendQueuedNow = useCallback(
    (id?: string) => {
      if (openingRef.current) return;
      const list = promptQueueRef.current;
      const item = id ? list.find((q) => q.id === id) : list[0];
      if (!item) return;
      sendNowRef.current = item;
      if (busyRef.current) {
        setItems((prev) => finalizeOpenTools(prev, "cancelled"));
        void window.grokDesktop.cancel();
      } else {
        setPromptQueue((prev) => {
          const next = prev.filter((q) => q.id !== item.id);
          promptQueueRef.current = next;
          return next;
        });
        void deliverPrompt({ text: item.text, images: item.images });
      }
    },
    [busyRef, openingRef, setItems, deliverPrompt],
  );

  return {
    promptQueue,
    promptQueueRef,
    sendNowRef,
    clearPromptQueue,
    removeQueued,
    submitFromComposer,
    sendQueuedNow,
  };
}
