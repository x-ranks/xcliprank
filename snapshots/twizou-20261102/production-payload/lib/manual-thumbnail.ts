import sharp from "sharp";
import { createHash } from "node:crypto";

export const MANUAL_IMAGE_INPUT_BYTES = 3 * 1024 * 1024;
export const MANUAL_IMAGE_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;

// Produce a bounded, metadata-free image. This function does not write files.
export async function prepareManualThumbnail(dataUrl: unknown) {
  if (typeof dataUrl !== "string" || dataUrl.length > Math.ceil(MANUAL_IMAGE_INPUT_BYTES / 3) * 4 + 64)
    throw Error("MANUAL_IMAGE_TOO_LARGE");
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw Error("MANUAL_IMAGE_INVALID");
  const input = Buffer.from(match[2], "base64");
  if (!input.length || input.length > MANUAL_IMAGE_INPUT_BYTES || input.toString("base64") !== match[2])
    throw Error("MANUAL_IMAGE_INVALID");
  let output: Buffer;
  try {
    const image = sharp(input, { limitInputPixels: MAX_PIXELS, animated: false, failOn: "error" });
    const meta = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || meta.format !== match[1] ||
        !meta.width || !meta.height || (meta.pages ?? 1) !== 1 || meta.width * meta.height > MAX_PIXELS)
      throw Error("MANUAL_IMAGE_INVALID");
    output = await image.rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 }).toBuffer();
  } catch { throw Error("MANUAL_IMAGE_INVALID"); }
  if (!output.length || output.length > MANUAL_IMAGE_OUTPUT_BYTES) throw Error("MANUAL_IMAGE_TOO_LARGE");
  return { bytes: output, sha256: createHash("sha256").update(output).digest("hex"), contentType: "image/webp" as const };
}
