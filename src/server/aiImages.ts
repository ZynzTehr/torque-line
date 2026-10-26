import "server-only";
import { ALLOWED_IMAGE_TYPES, imageBlock, type ImageType } from "@/ai/tasks";
import { invalid, type Failure } from "./result";

export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_IMAGES = 5;

/** Validate an uploaded photo and turn it into a model image block. Browser-declared types are checked against the bytes. */
export async function fileToImageBlock(file: unknown) {
  if (!(file instanceof File) || file.size === 0) return invalid("Choose a photo.");
  if (file.size > MAX_IMAGE_BYTES) return invalid("That photo is too large. Try again; photos are resized before upload.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES.includes(type)) return invalid("Use a JPEG, PNG, WebP, or GIF photo.");
  return { ok: true as const, block: imageBlock(type, Buffer.from(bytes).toString("base64")) };
}

function sniffImageType(b: Uint8Array): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

export type ImageFailure = Failure;
