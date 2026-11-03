import sharp from "sharp";

const MAX_OUTPUT_EDGE = 1200;
// X投稿用は、元画像から内容が推測できない強さを優先する。
// 1ブロックを大きくして、以前の薄いモザイクより粗くする。
const MOSAIC_BLOCK_SIZE = 48;

export async function applyPromotionMosaic(bytes: Uint8Array) {
  const normalized = await sharp(bytes)
    .rotate()
    .resize({
      width: MAX_OUTPUT_EDGE,
      height: MAX_OUTPUT_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .jpeg({ quality: 86 })
    .toBuffer({ resolveWithObject: true });

  const width = normalized.info.width;
  const height = normalized.info.height;
  const mosaicWidth = Math.max(32, Math.round(width / MOSAIC_BLOCK_SIZE));
  const mosaicHeight = Math.max(32, Math.round(height / MOSAIC_BLOCK_SIZE));

  return sharp(normalized.data)
    .resize(mosaicWidth, mosaicHeight, { fit: "fill", kernel: "nearest" })
    .resize(width, height, { fit: "fill", kernel: "nearest" })
    .blur(12)
    .jpeg({ quality: 80 })
    .toBuffer();
}
