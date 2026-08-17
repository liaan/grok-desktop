export type ImageQuality = "compact" | "high";

export const IMAGE_QUALITIES: ImageQuality[];
export const COMPACT_IMAGE_EDGE: number;
export const COMPACT_TARGET_BYTES: number;
export const MAX_IMAGE_EDGE: number;
export const TARGET_IMAGE_BYTES: number;
export const MAX_SOURCE_IMAGE_BYTES: number;
export const JPEG_QUALITY_START: number;
export const JPEG_QUALITY_MIN: number;

export function resolveImageQuality(value: unknown): ImageQuality;

export function imageQualityLimits(quality: unknown): {
  maxEdge: number;
  targetBytes: number;
  jpegQuality: number;
};

export function scaleToMaxEdge(
  width: number,
  height: number,
  maxEdge?: number,
): { width: number; height: number };

export function shouldReencodeImage(info?: {
  width?: number;
  height?: number;
  bytes?: number;
  maxEdge?: number;
  targetBytes?: number;
}): boolean;

export function nextJpegQuality(quality: number): number;
