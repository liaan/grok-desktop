/**
 * Last-gate shrink for ACP prompt images (nativeImage).
 * Renderer compresses on send; this is the last gate.
 */
import { nativeImage } from "electron";
import {
  JPEG_QUALITY_MIN,
  imageQualityLimits,
  nextJpegQuality,
  scaleToMaxEdge,
  shouldReencodeImage,
} from "../shared/image-compress.mjs";

/**
 * @param {{ data?: string, mimeType?: string }} img
 * @param {string} [quality]
 * @returns {{ data: string, mimeType: string }}
 */
export function compressPromptImage(img, quality = "compact") {
  const limits = imageQualityLimits(quality);
  const data = String(img?.data || "");
  const mimeType = String(img?.mimeType || "image/png");
  if (!data) return { data, mimeType };

  let buf;
  try {
    buf = Buffer.from(data, "base64");
  } catch {
    return { data, mimeType };
  }
  if (!buf.length) return { data, mimeType };

  let ni;
  try {
    ni = nativeImage.createFromBuffer(buf);
  } catch {
    return { data, mimeType };
  }
  if (!ni || ni.isEmpty()) return { data, mimeType };

  const size = ni.getSize();
  if (
    !shouldReencodeImage({
      width: size.width,
      height: size.height,
      bytes: buf.length,
      maxEdge: limits.maxEdge,
      targetBytes: limits.targetBytes,
    })
  ) {
    return { data, mimeType };
  }

  const scaled = scaleToMaxEdge(size.width, size.height, limits.maxEdge);
  const resized =
    scaled.width !== size.width || scaled.height !== size.height
      ? ni.resize({
          width: scaled.width,
          height: scaled.height,
          quality: "good",
        })
      : ni;

  let jpegQuality = limits.jpegQuality;
  let jpeg = resized.toJPEG(jpegQuality);
  while (jpeg.length > limits.targetBytes && jpegQuality > JPEG_QUALITY_MIN) {
    jpegQuality = nextJpegQuality(jpegQuality);
    jpeg = resized.toJPEG(jpegQuality);
  }

  return {
    data: jpeg.toString("base64"),
    mimeType: "image/jpeg",
  };
}
