import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

test("renders teaching point bullets as complete PowerPoint text", async () => {
  const { buildDeck } = await import("../src/deck.mjs");

  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-render-"));
  const imagePath = path.join(tempDir, "image.png");
  const outputPath = path.join(tempDir, "teaching-points.pptx");
  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: "#111111",
    },
  }).png().toFile(imagePath);

  const teachingPoint =
    "An ovoid shaped lesion in the splenium of the corpus callosum shows high signal intensity on T2-weighted and FLAIR sequences with restricted diffusion and low ADC values.";

  await buildDeck({
    cases: [
      {
        rawInput: "CLOCC, mri brain",
        diagnosisQuery: "Cytotoxic lesion of the corpus callosum",
        studyHint: "mri brain",
        caseTitle: "Cytotoxic lesions of the corpus callosum (CLOCCs)",
        caseUrl: "https://radiopaedia.org/cases/cytotoxic-lesions-of-the-corpus-callosum-cloccs-10",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-233373",
        patientData: { age: "35", gender: "female" },
        caseIntro: "The patient is a 35-year-old female.",
        revealSummary: "Diagnosis sourced from the linked Radiopaedia case.",
        footerText: "Radiopaedia • rID-233373 • Test Author • CC BY-NC-SA 3.0",
        images: [{ localPath: imagePath, label: "MRI • FLAIR • Axial" }],
        teachingPoints: [
          teachingPoint,
          "CLOCCs are clinicoradiologic lesions that can be associated with seizures, infection, medications, metabolic disturbances, and trauma.",
          "Follow-up imaging often demonstrates interval resolution when the underlying trigger improves.",
        ],
      },
    ],
    deckTitle: "Teaching Point Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    includeTeachingPoints: true,
  });

  const pptx = await fs.readFile(outputPath);
  const teachingSlideXml = readZipEntryText(pptx, "ppt/slides/slide4.xml");
  const slideText = decodeXmlText(teachingSlideXml);

  assert.match(slideText, /Teaching Points/);
  assert.match(slideText, /low ADC values\./);
  assert.equal(slideText.includes("restric..."), false);
  assert.equal(slideText.includes("…"), false);
  assert.equal(slideText.includes(teachingPoint), true);
});

test("preserves image aspect ratio on image slides", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-aspect-"));
  const imagePath = path.join(tempDir, "wide-image.png");
  const outputPath = path.join(tempDir, "aspect-ratio.pptx");

  await sharp({
    create: {
      width: 1200,
      height: 300,
      channels: 3,
      background: "#222222",
    },
  }).png().toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "wide image",
        diagnosisQuery: "Wide image",
        caseTitle: "Wide image aspect test",
        caseUrl: "https://radiopaedia.org/cases/example",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-1",
        patientData: {},
        caseIntro: "",
        revealSummary: "The diagnosis slide has a short summary.",
        footerText: "Radiopaedia • rID-1",
        images: [{ localPath: imagePath, label: "Wide image" }],
        teachingPoints: [],
      },
    ],
    deckTitle: "Aspect Ratio Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
  });

  const pptx = await fs.readFile(outputPath);
  const imageSlideXml = readZipEntryText(pptx, "ppt/slides/slide2.xml");
  const imageExt = /<p:pic>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/.exec(imageSlideXml);
  assert.ok(imageExt, "image extent should exist on the image slide");

  const ratio = Number(imageExt[1]) / Number(imageExt[2]);
  assert.ok(ratio > 3.8 && ratio < 4.2, `expected a 4:1 image ratio, got ${ratio}`);
});

test("case intro slide hides unsafe finding text", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-safe-intro-"));
  const imagePath = path.join(tempDir, "image.png");
  const outputPath = path.join(tempDir, "safe-intro.pptx");

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: "#111111",
    },
  }).png().toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "example",
        diagnosisQuery: "example",
        caseTitle: "Hidden diagnosis",
        caseUrl: "https://radiopaedia.org/cases/example",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-2",
        patientData: {},
        caseIntro: "The lateral projection is normal.",
        revealSummary: "Short diagnosis summary.",
        footerText: "Radiopaedia • rID-2",
        images: [{ localPath: imagePath, label: "Image" }],
        teachingPoints: [],
      },
    ],
    deckTitle: "Safe Intro Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
  });

  const pptx = await fs.readFile(outputPath);
  const caseSlideText = decodeXmlText(readZipEntryText(pptx, "ppt/slides/slide1.xml"));

  assert.match(caseSlideText, /Case 1/);
  assert.equal(caseSlideText.includes("lateral projection"), false);
});

test("renders cases with no selected images instead of crashing", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-no-images-"));
  const outputPath = path.join(tempDir, "no-images.pptx");

  await buildDeck({
    cases: [
      {
        rawInput: "example",
        diagnosisQuery: "example",
        caseTitle: "No-image case",
        caseUrl: "https://radiopaedia.org/cases/example",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-3",
        patientData: { age: "8", gender: "female" },
        caseIntro: "The patient is an 8-year-old female.",
        revealSummary: "Diagnosis summary.",
        footerText: "Radiopaedia • rID-3",
        images: [],
        teachingPoints: [],
      },
    ],
    deckTitle: "No Images Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
  });

  const pptx = await fs.readFile(outputPath);
  const imageSlideText = decodeXmlText(readZipEntryText(pptx, "ppt/slides/slide2.xml"));

  assert.match(imageSlideText, /No selected images for this case\./);
});

function readZipEntryText(buffer, entryName) {
  const entry = readZipEntry(buffer, entryName);
  return entry.toString("utf8");
}

function readZipEntry(buffer, entryName) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    if (fileName === entryName) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      return compressionMethod === 8 ? zlib.inflateRawSync(compressed) : compressed;
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found: ${entryName}`);
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record was not found.");
}

function decodeXmlText(xml) {
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
