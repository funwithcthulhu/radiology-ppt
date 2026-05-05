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

test("core review mode renders mixed case exercises and standalone review prompts", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-core-review-"));
  const imagePath = path.join(tempDir, "review-image.png");
  const outputPath = path.join(tempDir, "core-review.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  }).png().toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "chiari i malformation, mri brain",
        diagnosisQuery: "Chiari I malformation",
        studyHint: "mri brain",
        caseTitle: "Chiari I malformation",
        caseUrl: "https://radiopaedia.org/cases/chiari-i-malformation",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-10",
        patientData: { age: "17", gender: "female" },
        caseIntro: "The patient is a 17-year-old female.",
        revealSummary: "Inferior cerebellar tonsillar ectopia extends below the foramen magnum.",
        footerText: "Radiopaedia • rID-10",
        images: [
          {
            localPath: imagePath,
            label: "MRI • Sagittal T1",
            focusPoints: [{ x: 250, y: 168, kind: "arrow", label: "Cerebellar tonsil" }],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
        teachingPoints: ["Crowding at the foramen magnum is a classic morphologic clue."],
      },
      {
        rawInput: "vestibular schwannoma, mri iac",
        diagnosisQuery: "Vestibular schwannoma",
        studyHint: "mri iac",
        caseTitle: "Vestibular schwannoma",
        caseUrl: "https://radiopaedia.org/cases/vestibular-schwannoma",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-11",
        patientData: { age: "52", gender: "male" },
        caseIntro: "The patient is a 52-year-old male.",
        revealSummary: "Enhancing mass expands the internal auditory canal and CPA cistern.",
        footerText: "Radiopaedia • rID-11",
        images: [
          {
            localPath: imagePath,
            label: "MRI • Axial postcontrast",
            focusPoints: [{ x: 320, y: 210, kind: "arrow", label: "CPA-IAC mass" }],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
        teachingPoints: ["CPA masses should be localized relative to the IAC and cisternal component."],
      },
      {
        rawInput: "acute ischemic stroke, mri brain",
        diagnosisQuery: "acute ischemic stroke",
        studyHint: "mri brain",
        caseTitle: "acute ischemic stroke",
        caseUrl: "https://radiopaedia.org/cases/acute-ischemic-stroke",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-12",
        patientData: { age: "69", gender: "female" },
        revealSummary: "Diffusion restriction in a vascular territory is typical of acute infarct.",
        footerText: "Radiopaedia • rID-12",
        images: [{ localPath: imagePath, label: "MRI • DWI" }],
        coreReviewPlan: { domain: "neuro", anatomyPrompt: "brain" },
      },
      {
        rawInput: "rotator cuff tear, mri shoulder",
        diagnosisQuery: "rotator cuff tear",
        studyHint: "mri shoulder",
        caseTitle: "rotator cuff tear",
        caseUrl: "https://radiopaedia.org/cases/rotator-cuff-tear",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-13",
        revealSummary: "Full-thickness supraspinatus tendon tear with fluid signal defect.",
        footerText: "Radiopaedia • rID-13",
        images: [
          {
            localPath: imagePath,
            label: "MRI • Coronal T2",
            focusPoints: [{ x: 314, y: 210, kind: "arrow", label: "Supraspinatus tendon" }],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
        coreReviewPlan: { domain: "msk", anatomyPrompt: "shoulder" },
      },
    ],
    deckTitle: "Core Review Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
    coreReviewQuestions: [
      {
        id: "nis-regression",
        type: "single_best_answer",
        domain: "nis",
        stem: "Which communication step is best for an unexpected life-threatening finding?",
        options: [
          { id: "A", text: "Wait for the routine final report" },
          { id: "B", text: "Directly contact the responsible clinician and document the communication" },
          { id: "C", text: "Leave a nonurgent inbox message only" },
          { id: "D", text: "Rely on the technologist to relay the result" },
        ],
        answerKey: "B",
        explanation: "Critical results need direct, timely communication.",
        references: [{ label: "ABR NIS study guide", url: "https://www.theabr.org/nis-study-guide" }],
      },
      {
        id: "physics-regression",
        type: "numeric_fill_blank",
        domain: "physics",
        stem: "After two half-lives, what percentage of the original activity remains?",
        numericAnswer: { value: 25, tolerance: 0.1, units: "%" },
        explanation: "Two half-lives leave one quarter of the original activity.",
        references: [{ label: "ABR Physics study guide", url: "https://www.theabr.org/physics-study-guide" }],
      },
    ],
    includeTeachingPoints: true,
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);
  const firstSlideText = decodeXmlText(readZipEntryText(pptx, "ppt/slides/slide1.xml"));

  assert.match(firstSlideText, /What is the diagnosis\?/);
  assert.doesNotMatch(firstSlideText, /\bA\./);
  assert.match(allSlideText, /Structure \/ Finding/);
  assert.match(allSlideText, /Pin the abnormality\./);
  const abnormalityAnswerSlideText = readSlideTexts(pptx).find((text) => /Abnormality \/ Finding/.test(text)) || "";
  assert.match(abnormalityAnswerSlideText, /Vestibular schwannoma/);
  assert.match(abnormalityAnswerSlideText, /Marked region: CPA-IAC mass/);
  assert.match(allSlideText, /What is the most likely diagnosis\?/);
  assert.match(allSlideText, /What is the diagnosis\?/);
  assert.match(allSlideText, /Pin: Supraspinatus tendon\./);
  assert.match(allSlideText, /Which communication step is best for an unexpected life-threatening finding\?/);
  assert.match(allSlideText, /After two half-lives, what percentage of the original activity remains\?/);
  assert.match(allSlideText, /Core Review Notes/);
  assert.doesNotMatch(allSlideText, /Open response\. State the diagnosis before advancing\./);
  assert.doesNotMatch(allSlideText, /What structure or finding is indicated by the marker\?/);

  const presentationXml = readZipEntryText(pptx, "ppt/presentation.xml");
  const notesMasterIndex = presentationXml.indexOf("<p:notesMasterIdLst");
  const slideListIndex = presentationXml.indexOf("<p:sldIdLst");
  assert.ok(
    notesMasterIndex < 0 || slideListIndex < 0 || notesMasterIndex < slideListIndex,
    "notes master list should appear before slide list in presentation.xml",
  );

  const slideXmlEntries = listZipEntries(pptx).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry));
  for (const entry of slideXmlEntries) {
    const slideXml = readZipEntryText(pptx, entry);
    assert.equal(
      /\b(?:x|y|cx|cy)="-?\d+\.\d+"/.test(slideXml),
      false,
      `${entry} should not contain fractional OpenXML coordinates`,
    );
  }

  const notesSlideXmlEntries = listZipEntries(pptx).filter((entry) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry));
  assert.ok(notesSlideXmlEntries.length > 0, "core review slides should retain speaker notes");
  for (const entry of notesSlideXmlEntries) {
    const notesSlideXml = readZipEntryText(pptx, entry);
    assert.equal(
      /<p14:creationId\b/.test(notesSlideXml),
      false,
      `${entry} should not contain duplicate PowerPoint creation metadata`,
    );
    assert.equal(
      /\b(?:x|y|cx|cy)="-?\d+\.\d+"/.test(notesSlideXml),
      false,
      `${entry} should not contain fractional OpenXML coordinates`,
    );
  }

  const packageEntries = new Set(listZipEntries(pptx));
  const contentTypesXml = readZipEntryText(pptx, "[Content_Types].xml");
  const danglingContentTypeOverrides = [...contentTypesXml.matchAll(/<Override\b[^>]*\bPartName="\/([^"]+)"/g)]
    .map((match) => match[1])
    .filter((partName) => !packageEntries.has(partName));
  assert.deepEqual(danglingContentTypeOverrides, [], "content type overrides should only reference packaged parts");
});

test("core review avoids pin-abnormality prompts without localized annotations", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-core-unannotated-pin-"));
  const imagePath = path.join(tempDir, "unannotated.png");
  const outputPath = path.join(tempDir, "unannotated-pin.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  }).png().toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        studyHint: "cta chest",
        caseTitle: "pulmonary embolism",
        caseUrl: "https://radiopaedia.org/cases/pulmonary-embolism",
        footerText: "Radiopaedia • rID-20",
        images: [{ localPath: imagePath, label: "CTA chest" }],
      },
      {
        rawInput: "rotator cuff tear, mri shoulder",
        diagnosisQuery: "rotator cuff tear",
        studyHint: "mri shoulder",
        caseTitle: "rotator cuff tear",
        caseUrl: "https://radiopaedia.org/cases/rotator-cuff-tear",
        footerText: "Radiopaedia • rID-21",
        images: [{ localPath: imagePath, label: "MRI shoulder" }],
        coreReviewPlan: { domain: "msk", anatomyPrompt: "shoulder" },
      },
    ],
    deckTitle: "Unannotated Pin Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);

  assert.doesNotMatch(allSlideText, /Pin the abnormality\./);
  assert.doesNotMatch(allSlideText, /Abnormality \/ Finding/);
  assert.match(allSlideText, /What is the diagnosis\?/);
});

test("core review diagnosis choices prefer plausible same-region distractors", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "radiology-deck-core-distractors-"));
  const imagePath = path.join(tempDir, "pelvis.png");
  const outputPath = path.join(tempDir, "plausible-distractors.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  }).png().toFile(imagePath);

  const baseCase = {
    caseUrl: "https://radiopaedia.org/cases/example",
    author: "Test Author",
    licenseName: "CC BY-NC-SA 3.0",
    images: [{ localPath: imagePath, label: "MRI" }],
  };

  await buildDeck({
    cases: [
      {
        ...baseCase,
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        studyHint: "CTA chest",
        caseTitle: "pulmonary embolism",
        coreReviewPlan: { domain: "thoracic", anatomyPrompt: "chest" },
      },
      {
        ...baseCase,
        rawInput: "rotator cuff tear, mri shoulder",
        diagnosisQuery: "Rotator cuff tear",
        studyHint: "MRI shoulder",
        caseTitle: "Rotator cuff tear",
        coreReviewPlan: { domain: "msk", anatomyPrompt: "shoulder" },
      },
      {
        ...baseCase,
        rawInput: "perianal fistula, mri pelvis",
        diagnosisQuery: "Perianal fistula",
        studyHint: "MRI pelvis",
        caseTitle: "Perianal fistula",
        modalitySummary: "MRI pelvis",
        systems: ["Gastrointestinal", "Urogenital"],
        coreReviewPlan: { domain: "mr", anatomyPrompt: "pelvis" },
      },
      {
        ...baseCase,
        rawInput: "obstructing ureteric stone, ct abdomen pelvis",
        diagnosisQuery: "obstructing ureteric stone",
        studyHint: "CT abdomen pelvis",
        caseTitle: "obstructing ureteric stone",
        coreReviewPlan: { domain: "gu", anatomyPrompt: "urinary tract" },
      },
    ],
    deckTitle: "Core Review Distractor Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
  });

  const pptx = await fs.readFile(outputPath);
  const diagnosisSlideText = readSlideTexts(pptx).find((text) =>
    /What is the most likely diagnosis\?/.test(text) && /Perianal fistula/.test(text),
  );
  assert.ok(diagnosisSlideText, "perianal fistula should receive the diagnosis MCQ slot in this regression");
  assert.match(diagnosisSlideText, /Perianal fistula/);
  assert.match(
    diagnosisSlideText,
    /Perianal abscess|Hidradenitis suppurativa|Pilonidal sinus disease|Low rectal carcinoma/,
  );
  assert.doesNotMatch(diagnosisSlideText, /pulmonary embolism|Rotator cuff tear|obstructing ureteric stone/i);
});

function readZipEntryText(buffer, entryName) {
  const entry = readZipEntry(buffer, entryName);
  return entry.toString("utf8");
}

function readAllSlideText(buffer) {
  return readSlideTexts(buffer).join("\n\n");
}

function readSlideTexts(buffer) {
  return listZipEntries(buffer)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => slideNumber(left) - slideNumber(right))
    .map((entry) => decodeXmlText(readZipEntryText(buffer, entry)));
}

function slideNumber(entryName) {
  return Number(/slide(\d+)\.xml$/.exec(entryName)?.[1] || 0);
}

function listZipEntries(buffer) {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;
  const end = centralDirectoryOffset + centralDirectorySize;
  const entries = [];

  while (offset < end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      break;
    }

    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
    entries.push(fileName);

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
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
