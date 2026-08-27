export type PreviewCaptureImage = {
  id: string;
  data: string;
  mimeType: string;
  previewUrl: string;
  name?: string;
};

export type PreviewCaptureSubmit = {
  text: string;
  images: PreviewCaptureImage[];
  mode: "auto";
  imageQuality: "compact";
};

export function pendingImageFromBase64(
  data: string,
  mimeType: string,
  name?: string,
): PreviewCaptureImage;

export function previewCaptureToSubmit(payload: {
  data?: unknown;
  mimeType?: unknown;
  text?: unknown;
}):
  | { ok: true; submit: PreviewCaptureSubmit }
  | { ok: false; error: string };

export function previewCaptureRefuseError(project: string | null): string;
