import sharp from "sharp";

const SPONSOR_LOGO_MAX_WIDTH = 640;
const SPONSOR_LOGO_MAX_HEIGHT = 240;

export async function optimizeSponsorLogo(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: SPONSOR_LOGO_MAX_WIDTH,
      height: SPONSOR_LOGO_MAX_HEIGHT,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer();
}
