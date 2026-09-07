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
import {
  previewCaptureRefuseError,
  previewCaptureToSubmit,
  type PendingImage,
} from "../lib/pending-images";
import { isAuthError, type ConnState } from "../lib/conn";
import {
  appendUserMessage,
  claimQueuedUserMessage,
  finalizeOpenTools,
  removeQueuedUserMessage,
  restoreQueuedUserMessage,
  removeUserInterjection,
  uid,
} from "../lib/timeline";
import {
  interjectRpcFollowUp,
  midTurnAction,
} from "../../shared/prompt-delivery.mjs";
import type { TimelineImage, TimelineItem } from "../vite-env";

type DeliverPayload = {
  text: string;
  images: PendingImage[];
  imageQuality?: "compact" | "high";
  timelineText?: string;
  queueId?: string;
};

function userBubbleText(payload: {
  text: string;
  timelineText?: string;
}): string {
  return String(payload.timelineText || payload.text || "").trim();
}

/**
 * Mid-turn queue + session/prompt delivery (CLI-style Enter / Ctrl+Enter).
 * Preview screenshots use mode "interject" while a turn is running.
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
  const deliverRef = useRef<(payload: DeliverPayload) => Promise<void>>(
    async () => {},
  );

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
    (
      text: string,
      images: PendingImage[],
      imageQuality: "compact" | "high" = "compact",
      timelineText?: string,
    ) => {
      const item: QueuedPrompt = {
        id: uid("q"),
        text,
        images: images.map((img) => ({ ...img })),
        imageQuality,
        timelineText,
        at: Date.now(),
      };
      setPromptQueue((prev) => {
        const next = [...prev, item];
        promptQueueRef.current = next;
        return next;
      });
      const shown = String(timelineText || text || "").trim();
      setItems((prev) =>
        appendUserMessage(prev, {
          text: shown || text,
          images: item.images.map((img) => ({
            mimeType: img.mimeType,
            previewUrl: img.previewUrl,
          })),
          queued: true,
          queueId: item.id,
        }),
      );
      return item;
    },
    [setItems],
  );

  const removeQueued = useCallback((id: string) => {
    setPromptQueue((prev) => {
      const next = prev.filter((q) => q.id !== id);
      promptQueueRef.current = next;
      return next;
    });
    if (sendNowRef.current?.id === id) sendNowRef.current = null;
    setItems((prev) => removeQueuedUserMessage(prev, id));
  }, [setItems]);

  const deliverPrompt = useCallback(
    async (payload: DeliverPayload) => {
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
      const queueId = String(payload.queueId || "").trim();
      setItems((prev) => {
        if (queueId) {
          const claimed = claimQueuedUserMessage(prev, queueId);
          if (claimed !== prev) return claimed;
        }
        return appendUserMessage(prev, {
          text: userBubbleText(payload) || text,
          images: timelineImages,
          optimistic: true,
        });
      });
      const stale = () =>
        openingRef.current || deliveryGenRef.current !== gen;
      try {
        await window.grokDesktop.prompt(text, {
          images: images.map(({ data, mimeType }) => ({ data, mimeType })),
          imageQuality: payload.imageQuality || "compact",
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
            imageQuality: nextNow.imageQuality,
            timelineText: nextNow.timelineText,
            queueId: nextNow.id,
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
            imageQuality: queued.imageQuality,
            timelineText: queued.timelineText,
            queueId: queued.id,
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

  const deliverInterject = useCallback(
    async (payload: DeliverPayload): Promise<"ok" | "queue" | "error"> => {
      const text = payload.text.trim();
      const images = payload.images;
      const imageQuality = payload.imageQuality || "compact";
      if (!text && images.length === 0) return "error";

      const interjectionId = uid("ij");
      const gen = deliveryGenRef.current;
      const timelineImages: TimelineImage[] = images.map((img) => ({
        mimeType: img.mimeType,
        previewUrl: img.previewUrl,
      }));
      pinToBottom();
      const queueId = String(payload.queueId || "").trim();
      setItems((prev) => {
        if (queueId) {
          const claimed = claimQueuedUserMessage(prev, queueId, {
            interjectionId,
          });
          if (claimed !== prev) return claimed;
        }
        return appendUserMessage(prev, {
          text: userBubbleText(payload) || text,
          images: timelineImages,
          optimistic: true,
          interjectionId,
        });
      });
      const stale = () =>
        openingRef.current || deliveryGenRef.current !== gen;
      const revertBubble = () => {
        if (queueId) {
          setItems((prev) => restoreQueuedUserMessage(prev, queueId));
          return;
        }
        setItems((prev) => removeUserInterjection(prev, interjectionId));
      };
      try {
        const result = await window.grokDesktop.interject(text, {
          images: images.map(({ data, mimeType }) => ({ data, mimeType })),
          imageQuality,
          interjectionId,
        });
        if (stale()) {
          revertBubble();
          return "error";
        }
        const follow = interjectRpcFollowUp(result);
        if (follow === "ok") return "ok";
        revertBubble();
        if (follow === "queue") {
          if (queueId) return "queue";
          if (!busyRef.current) {
            void deliverPrompt({
              text,
              images,
              imageQuality,
              timelineText: payload.timelineText,
            });
            return "ok";
          }
          enqueuePrompt(text, images, imageQuality, payload.timelineText);
          return "queue";
        }
        const fail =
          result && typeof result === "object"
            ? String(
                (result as { error?: string; reason?: string }).error ||
                  (result as { reason?: string }).reason ||
                  "Interject failed",
              )
            : "Interject failed";
        setError(fail);
        return "error";
      } catch (e: unknown) {
        revertBubble();
        if (stale()) return "error";
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        return "error";
      }
    },
    [
      busyRef,
      openingRef,
      enqueuePrompt,
      deliverPrompt,
      pinToBottom,
      setError,
      setItems,
    ],
  );

  /**
   * Accept composer submit. Returns true when the draft should clear
   * (queued, interject, or delivered). False when refused (opening / no project).
   */
  const submitFromComposer = useCallback(
    async ({
      text,
      images,
      mode,
      imageQuality = "compact",
      timelineText,
    }: ComposerSubmit): Promise<boolean> => {
      if (!project || openingRef.current || conn === "connecting") {
        return false;
      }
      if (!text && images.length === 0) return false;

      const action = midTurnAction(
        mode,
        busyRef.current || conn === "busy",
      );
      if (action === "send-now") {
        const item = enqueuePrompt(
          text,
          images,
          imageQuality,
          timelineText,
        );
        sendNowRef.current = item;
        setItems((prev) => finalizeOpenTools(prev, "cancelled"));
        void window.grokDesktop.cancel();
        return true;
      }
      if (action === "queue") {
        enqueuePrompt(text, images, imageQuality, timelineText);
        return true;
      }
      if (action === "interject") {
        void deliverInterject({ text, images, imageQuality, timelineText });
        return true;
      }

      // Do not await the full turn — Composer clears the draft on this true.
      // deliverPrompt owns busy/queue drain for the rest of the turn.
      void deliverPrompt({ text, images, imageQuality, timelineText });
      return true;
    },
    [
      project,
      openingRef,
      conn,
      busyRef,
      enqueuePrompt,
      setItems,
      deliverInterject,
      deliverPrompt,
    ],
  );

  const submitPreviewCapture = useCallback(
    (payload: {
      data?: unknown;
      mimeType?: unknown;
      text?: unknown;
    }) => {
      const parsed = previewCaptureToSubmit(payload);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      const busy = busyRef.current || conn === "busy";
      void submitFromComposer({
        ...parsed.submit,
        mode: busy ? "interject" : "auto",
      }).then((ok) => {
        if (!ok) setError(previewCaptureRefuseError(project));
      });
    },
    [project, submitFromComposer, setError, busyRef, conn],
  );

  useEffect(() => {
    return window.grokDesktop.on("preview:viewport-capture", (payload) => {
      submitPreviewCapture(payload);
    });
  }, [submitPreviewCapture]);

  const sendQueuedNow = useCallback(
    (id?: string) => {
      if (openingRef.current) return;
      const list = promptQueueRef.current;
      const item = id ? list.find((q) => q.id === id) : list[0];
      if (!item) return;
      const payload: DeliverPayload = {
        text: item.text,
        images: item.images,
        imageQuality: item.imageQuality,
        timelineText: item.timelineText,
        queueId: item.id,
      };
      const take = () => {
        const next = promptQueueRef.current.filter((q) => q.id !== item.id);
        promptQueueRef.current = next;
        setPromptQueue(next);
      };
      const restore = () => {
        if (promptQueueRef.current.some((q) => q.id === item.id)) return;
        const next = [item, ...promptQueueRef.current];
        promptQueueRef.current = next;
        setPromptQueue(next);
      };
      if (busyRef.current) {
        take();
        void deliverInterject(payload).then((follow) => {
          if (follow !== "ok") restore();
        });
        return;
      }
      take();
      void deliverPrompt(payload);
    },
    [busyRef, openingRef, deliverInterject, deliverPrompt],
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
