import {
  JPEG_QUALITY_MIN,
  MAX_SOURCE_IMAGE_BYTES,
  imageQualityLimits,
  nextJpegQuality,
  resolveImageQuality,
  scaleToMaxEdge,
  shouldReencodeImage,
  type ImageQuality,
} from "../../shared/image-compress.mjs";
import type { PromptImage } from "../vite-env";
import { uid } from "./timeline";

export type PendingImage = PromptImage & {
  id: string;
  previewUrl: string;
  name?: string;
  /** Original attach; kept so Higher detail can re-encode this send only. */
  source?: Blob;
};

function blobToBase64(blob: Blob): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      const data = comma >= 0 ? result.slice(comma + 1) : result;
      resolve({ data, mimeType: blob.type || "image/png" });
    };
    reader.onerror = () =>
      reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode image"));
      },
      "image/jpeg",
      quality / 100,
    );
  });
}

/**
 * Downscale + JPEG. Compact (default) is screenshot-sized; high is a
 * per-send opt-in. Already-small images stay as-is.
 */
export async function compressImageBlob(
  file: Blob,
  quality: ImageQuality | string = "compact",
): Promise<{ data: string; mimeType: string }> {
  const limits = imageQualityLimits(quality);
  if (typeof createImageBitmap !== "function") {
    return blobToBase64(file);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return blobToBase64(file);
  }

  try {
    if (
      !shouldReencodeImage({
        width: bitmap.width,
        height: bitmap.height,
        bytes: file.size,
        maxEdge: limits.maxEdge,
        targetBytes: limits.targetBytes,
      })
    ) {
      return blobToBase64(file);
    }

    const scaled = scaleToMaxEdge(
      bitmap.width,
      bitmap.height,
      limits.maxEdge,
    );
    const canvas = document.createElement("canvas");
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return blobToBase64(file);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, scaled.width, scaled.height);
    ctx.drawImage(bitmap, 0, 0, scaled.width, scaled.height);

    let jpegQuality = limits.jpegQuality;
    let out = await canvasToJpegBlob(canvas, jpegQuality);
    while (out.size > limits.targetBytes && jpegQuality > JPEG_QUALITY_MIN) {
      jpegQuality = nextJpegQuality(jpegQuality);
      out = await canvasToJpegBlob(canvas, jpegQuality);
    }
    return blobToBase64(out);
  } finally {
    bitmap.close();
  }
}

export function revokePendingImagePreview(img: PendingImage) {
  const url = img.previewUrl;
  if (url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
}

export {
  pendingImageFromBase64,
  previewCaptureRefuseError,
  previewCaptureToSubmit,
} from "../../shared/preview-capture.mjs";

export async function fileToPendingImage(
  file: Blob,
  name?: string,
): Promise<PendingImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached");
  }
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Image is too large (max 12 MB)");
  }
  const mimeType = file.type || "image/png";
  return {
    id: uid("img"),
    data: "",
    mimeType,
    previewUrl: URL.createObjectURL(file),
    name: name || (file instanceof File ? file.name : undefined),
    source: file,
  };
}

/** Encode attachments for ACP using this send's quality. */
export async function encodePendingImages(
  images: PendingImage[],
  quality: ImageQuality | string = "compact",
): Promise<PendingImage[]> {
  const q = resolveImageQuality(quality);
  const out: PendingImage[] = [];
  for (const img of images) {
    const src = img.source;
    if (!src) {
      out.push({
        id: img.id,
        data: img.data,
        mimeType: img.mimeType,
        previewUrl: img.previewUrl,
        name: img.name,
      });
      continue;
    }
    const encoded = await compressImageBlob(src, q);
    out.push({
      id: img.id,
      data: encoded.data,
      mimeType: encoded.mimeType,
      previewUrl: `data:${encoded.mimeType};base64,${encoded.data}`,
      name: img.name,
    });
  }
  return out;
}

/** Decode a list of image blobs; returns successes + first error message. */
export async function filesToPendingImages(
  files: ArrayLike<Blob | File>,
): Promise<{ images: PendingImage[]; error: string | null }> {
  const images: PendingImage[] = [];
  let error: string | null = null;
  for (const file of Array.from(files)) {
    try {
      images.push(
        await fileToPendingImage(
          file,
          file instanceof File ? file.name : undefined,
        ),
      );
    } catch (e: unknown) {
      if (!error) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return { images, error };
}
