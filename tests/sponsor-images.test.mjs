import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url),
  sharp = require("sharp"),
  helperSource = await readFile(new URL("../lib/sponsor-images.ts", import.meta.url), "utf8"),
  compiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
  helperModule = { exports: {} };
new Function("exports", "require", "module", compiled)(helperModule.exports, require, helperModule);
const { optimizeSponsorLogo } = helperModule.exports;

test("sponsor logo variants are capped to display size and encoded as WebP", { timeout: 30_000 }, async () => {
  const original = await sharp({
    create: { width: 2400, height: 1200, channels: 4, background: { r: 225, g: 25, b: 100, alpha: 0.65 } },
  }).png().toBuffer();
  const optimized = await optimizeSponsorLogo(original);
  const metadata = await sharp(optimized).metadata();

  assert.equal(metadata.format, "webp");
  assert.ok(metadata.width <= 640);
  assert.ok(metadata.height <= 240);
  assert.ok(optimized.length < original.length);
});
