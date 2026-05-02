import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { focusCropBounds, focusCropImage } from "../src/focus-crop.mjs";

test("focus crop treats normalized points as image-relative coordinates", () => {
  const bounds = focusCropBounds(1000, 800, [{ x: 0.5, y: 0.45 }], "tighter");
  assert.ok(bounds.left > 150, "crop should be centered near the finding, not pinned to the left edge");
  assert.ok(bounds.top > 100, "crop should be centered near the finding, not pinned to the top edge");
});

test("focus crop writes a same-size focused image variant", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-focus-crop-"));
  const inputPath = path.join(tempDir, "image.jpg");
  await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: "#111111",
    },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect x="148" y="104" width="28" height="28" fill="#ffffff"/></svg>',
        ),
        left: 0,
        top: 0,
      },
    ])
    .jpeg({ quality: 90 })
    .toFile(inputPath);

  const outputPath = await focusCropImage(inputPath, [{ x: 0.5, y: 0.49 }], {
    cropMode: "tighter",
    markupStyle: "focus-ring",
  });
  const metadata = await sharp(outputPath).metadata();

  assert.notEqual(outputPath, inputPath);
  assert.match(path.basename(outputPath), /focus-tighter-focus-ring/);
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 240);
});
