import sharp from "sharp";

// Sponsor logos render at about 240 CSS pixels wide. This 480px variant stays
// crisp on 2x screens while avoiding excess pixels in the previous 640px assets.
const SPONSOR_LOGO_MAX_WIDTH = 480;
const SPONSOR_LOGO_MAX_HEIGHT = 200;

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

export async function optimizePracticalImage(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 960, height: 720, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78, effort: 4 })
    .toBuffer();
}
