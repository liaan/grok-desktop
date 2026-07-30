import { uid } from "./timeline";
import type { PromptImage } from "../vite-env";

export type PendingImage = PromptImage & {
  id: string;
  previewUrl: string;
  name?: string;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

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

export async function fileToPendingImage(
  file: Blob,
  name?: string,
): Promise<PendingImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files can be attached");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large (max 12 MB)");
  }
  const { data, mimeType } = await blobToBase64(file);
  return {
    id: uid("img"),
    data,
    mimeType,
    previewUrl: `data:${mimeType};base64,${data}`,
    name: name || (file instanceof File ? file.name : undefined),
  };
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
