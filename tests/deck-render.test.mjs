import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

function tinyPdfBuffer(text) {
  const escaped = String(text).replace(/[()\\]/g, "\\$&");
  const stream = `BT /F1 24 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test("renders teaching point bullets as complete PowerPoint text", async () => {
  const { buildDeck } = await import("../src/deck.mjs");

  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-render-"),
  );
  const imagePath = path.join(tempDir, "image.png");
  const outputPath = path.join(tempDir, "teaching-points.pptx");
  await sharp({
    create: {
      width: 640,
      height: 480,
      channels: 3,
      background: "#111111",
    },
  })
    .png()
    .toFile(imagePath);

  const teachingPoint =
    "An ovoid shaped lesion in the splenium of the corpus callosum shows high signal intensity on T2-weighted and FLAIR sequences with restricted diffusion and low ADC values.";

  await buildDeck({
    cases: [
      {
        rawInput: "CLOCC, mri brain",
        diagnosisQuery: "Cytotoxic lesion of the corpus callosum",
        studyHint: "mri brain",
        caseTitle: "Cytotoxic lesions of the corpus callosum (CLOCCs)",
        caseUrl:
          "https://radiopaedia.org/cases/cytotoxic-lesions-of-the-corpus-callosum-cloccs-10",
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
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-aspect-"),
  );
  const imagePath = path.join(tempDir, "wide-image.png");
  const outputPath = path.join(tempDir, "aspect-ratio.pptx");

  await sharp({
    create: {
      width: 1200,
      height: 300,
      channels: 3,
      background: "#222222",
    },
  })
    .png()
    .toFile(imagePath);

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
  const imageExt = /<p:pic>[\s\S]*?<a:ext cx="(\d+)" cy="(\d+)"/.exec(
    imageSlideXml,
  );
  assert.ok(imageExt, "image extent should exist on the image slide");

  const ratio = Number(imageExt[1]) / Number(imageExt[2]);
  assert.ok(
    ratio > 3.8 && ratio < 4.2,
    `expected a 4:1 image ratio, got ${ratio}`,
  );
});

test("normalizes embedded media extensions to match image bytes", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-media-ext-"),
  );
  const imagePath = path.join(tempDir, "radiopaedia-served-png.jpeg");
  const outputPath = path.join(tempDir, "media-extension.pptx");

  await sharp({
    create: {
      width: 480,
      height: 360,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "media mismatch",
        diagnosisQuery: "Media mismatch",
        caseTitle: "Media extension mismatch",
        caseUrl: "https://radiopaedia.org/cases/example",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-000001",
        revealSummary: "Diagnosis sourced from the linked Radiopaedia case.",
        footerText: "Radiopaedia • rID-000001 • Test Author • CC BY-NC-SA 3.0",
        images: [
          { localPath: imagePath, label: "PNG body delivered from a JPEG URL" },
        ],
        teachingPoints: [
          "PowerPoint media part extensions should match the actual embedded image bytes.",
        ],
      },
    ],
    deckTitle: "Media Extension Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
  });

  const pptx = await fs.readFile(outputPath);
  const mediaEntries = listZipEntries(pptx).filter((entry) =>
    /^ppt\/media\/[^/]+$/.test(entry),
  );
  assert.ok(
    mediaEntries.some((entry) => entry.endsWith(".png")),
    "PNG image should be embedded with a .png part name",
  );

  for (const entry of mediaEntries) {
    const bytes = readZipEntry(pptx, entry);
    const isPng = bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (isPng) {
      assert.match(
        entry,
        /\.png$/i,
        `${entry} contains PNG bytes but is not named .png`,
      );
    }
    if (isJpeg) {
      assert.match(
        entry,
        /\.jpe?g$/i,
        `${entry} contains JPEG bytes but is not named .jpg/.jpeg`,
      );
    }
  }
});

test("cleans generated image normalization files when deck write fails", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-temp-cleanup-"),
  );
  const imagePath = path.join(tempDir, "png-served-as-jpeg.jpeg");
  const normalizedImagePath = `${imagePath}.pptx.png`;
  const outputPath = path.join(tempDir, "blocked-output.pptx");
  await fs.mkdir(outputPath, { recursive: true });

  await sharp({
    create: {
      width: 480,
      height: 360,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  await assert.rejects(
    () =>
      buildDeck({
        cases: [
          {
            rawInput: "media mismatch",
            diagnosisQuery: "Media mismatch",
            caseTitle: "Media extension mismatch",
            caseUrl: "https://radiopaedia.org/cases/example",
            author: "Test Author",
            licenseName: "CC BY-NC-SA 3.0",
            rid: "rID-000001",
            revealSummary: "Diagnosis sourced from the linked Radiopaedia case.",
            footerText:
              "Radiopaedia • rID-000001 • Test Author • CC BY-NC-SA 3.0",
            images: [
              {
                localPath: imagePath,
                label: "PNG body delivered from a JPEG URL",
              },
            ],
            teachingPoints: [],
          },
        ],
        deckTitle: "Failed Write Cleanup Regression",
        outputPath,
        scratchDir: path.join(tempDir, "scratch"),
      }),
    (error) => {
      assert.match(error.message, /Could not write PowerPoint output/);
      assert.match(error.message, /blocked-output\.pptx/);
      return true;
    },
  );

  await assert.rejects(
    () => fs.access(normalizedImagePath),
    (error) => error?.code === "ENOENT",
  );
});

test("case intro slide hides unsafe finding text", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-safe-intro-"),
  );
  const imagePath = path.join(tempDir, "image.png");
  const outputPath = path.join(tempDir, "safe-intro.pptx");

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: "#111111",
    },
  })
    .png()
    .toFile(imagePath);

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
  const caseSlideText = decodeXmlText(
    readZipEntryText(pptx, "ppt/slides/slide1.xml"),
  );

  assert.match(caseSlideText, /Case 1/);
  assert.equal(caseSlideText.includes("lateral projection"), false);
});

test("renders cases with no selected images instead of crashing", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-no-images-"),
  );
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
  const imageSlideText = decodeXmlText(
    readZipEntryText(pptx, "ppt/slides/slide2.xml"),
  );

  assert.match(imageSlideText, /No selected images for this case\./);
});

test("core review mode renders mixed case exercises and standalone review prompts", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-review-"),
  );
  const imagePath = path.join(tempDir, "review-image.png");
  const outputPath = path.join(tempDir, "core-review.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

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
        revealSummary:
          "Inferior cerebellar tonsillar ectopia extends below the foramen magnum.",
        footerText: "Radiopaedia • rID-10",
        images: [
          {
            localPath: imagePath,
            label: "MRI • Sagittal T1",
            focusPoints: [
              { x: 250, y: 168, kind: "arrow", label: "Cerebellar tonsil" },
            ],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
        teachingPoints: [
          "Crowding at the foramen magnum is a classic morphologic clue.",
        ],
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
        revealSummary:
          "Enhancing mass expands the internal auditory canal and CPA cistern.",
        footerText: "Radiopaedia • rID-11",
        images: [
          {
            localPath: imagePath,
            label: "MRI • Axial postcontrast",
            focusPoints: [
              { x: 320, y: 210, kind: "arrow", label: "CPA-IAC mass" },
            ],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
        teachingPoints: [
          "CPA masses should be localized relative to the IAC and cisternal component.",
        ],
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
        revealSummary:
          "Diffusion restriction in a vascular territory is typical of acute infarct.",
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
        revealSummary:
          "Full-thickness supraspinatus tendon tear with fluid signal defect.",
        footerText: "Radiopaedia • rID-13",
        images: [
          {
            localPath: imagePath,
            label: "MRI • Coronal T2",
            focusPoints: [
              { x: 314, y: 210, kind: "arrow", label: "Supraspinatus tendon" },
            ],
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
          {
            id: "B",
            text: "Directly contact the responsible clinician and document the communication",
          },
          { id: "C", text: "Leave a nonurgent inbox message only" },
          { id: "D", text: "Rely on the technologist to relay the result" },
        ],
        answerKey: "B",
        explanation: "Critical results need direct, timely communication.",
        references: [
          {
            label: "ABR NIS study guide",
            url: "https://www.theabr.org/nis-study-guide",
          },
        ],
      },
      {
        id: "physics-regression",
        type: "numeric_fill_blank",
        domain: "physics",
        stem: "After two half-lives, what percentage of the original activity remains?",
        numericAnswer: { value: 25, tolerance: 0.1, units: "%" },
        explanation:
          "Two half-lives leave one quarter of the original activity.",
        references: [
          {
            label: "ABR Physics study guide",
            url: "https://www.theabr.org/physics-study-guide",
          },
        ],
      },
    ],
    includeTeachingPoints: true,
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);
  const firstSlideText = decodeXmlText(
    readZipEntryText(pptx, "ppt/slides/slide1.xml"),
  );

  assert.match(firstSlideText, /What is the diagnosis\?/);
  assert.doesNotMatch(firstSlideText, /\bA\./);
  assert.match(allSlideText, /Structure \/ Finding/);
  assert.match(allSlideText, /Pin the abnormality\./);
  const abnormalityAnswerSlideText =
    readSlideTexts(pptx).find((text) => /Abnormality \/ Finding/.test(text)) ||
    "";
  assert.match(abnormalityAnswerSlideText, /Vestibular schwannoma/);
  assert.match(abnormalityAnswerSlideText, /Marked region: CPA-IAC mass/);
  assert.match(allSlideText, /What is the most likely diagnosis\?/);
  assert.match(allSlideText, /What is the diagnosis\?/);
  assert.match(allSlideText, /Pin: Supraspinatus tendon\./);
  assert.match(
    allSlideText,
    /Which communication step is best for an unexpected life-threatening finding\?/,
  );
  assert.match(
    allSlideText,
    /After two half-lives, what percentage of the original activity remains\?/,
  );
  assert.match(allSlideText, /Core Review Notes/);
  assert.doesNotMatch(
    allSlideText,
    /Open response\. State the diagnosis before advancing\./,
  );
  assert.doesNotMatch(
    allSlideText,
    /What structure or finding is indicated by the marker\?/,
  );

  const presentationXml = readZipEntryText(pptx, "ppt/presentation.xml");
  const notesMasterIndex = presentationXml.indexOf("<p:notesMasterIdLst");
  const slideListIndex = presentationXml.indexOf("<p:sldIdLst");
  assert.ok(
    notesMasterIndex < 0 ||
      slideListIndex < 0 ||
      notesMasterIndex > slideListIndex,
    "notes master list should remain after slide list for desktop PowerPoint compatibility",
  );

  const slideXmlEntries = listZipEntries(pptx).filter((entry) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(entry),
  );
  for (const entry of slideXmlEntries) {
    const slideXml = readZipEntryText(pptx, entry);
    assert.equal(
      /\b(?:x|y|cx|cy)="-?\d+\.\d+"/.test(slideXml),
      false,
      `${entry} should not contain fractional OpenXML coordinates`,
    );
  }

  const notesSlideXmlEntries = listZipEntries(pptx).filter((entry) =>
    /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(entry),
  );
  assert.ok(
    notesSlideXmlEntries.length > 0,
    "core review slides should retain speaker notes",
  );
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
  const danglingContentTypeOverrides = [
    ...contentTypesXml.matchAll(/<Override\b[^>]*\bPartName="\/([^"]+)"/g),
  ]
    .map((match) => match[1])
    .filter((partName) => !packageEntries.has(partName));
  assert.deepEqual(
    danglingContentTypeOverrides,
    [],
    "content type overrides should only reference packaged parts",
  );
});

test("core review standalone MCQs keep long stems separate from answer choices", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-long-standalone-"),
  );
  const imagePath = path.join(tempDir, "long-question.png");
  const outputPath = path.join(tempDir, "long-standalone.pptx");
  const stem =
    "A patient develops limited urticaria shortly after iodinated contrast administration but remains hemodynamically stable without respiratory symptoms. Which immediate management is most appropriate?";

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "appendicitis, ct abdomen pelvis",
        diagnosisQuery: "appendicitis",
        caseTitle: "appendicitis",
        caseUrl: "https://radiopaedia.org/cases/appendicitis",
        footerText: "Radiopaedia • rID-test",
        images: [{ localPath: imagePath, label: "CT abdomen pelvis" }],
      },
    ],
    deckTitle: "Long Standalone Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
    theme: "conference-dark",
    coreReviewQuestions: [
      {
        id: "nis-long-layout",
        type: "single_best_answer",
        domain: "nis",
        stem,
        options: [
          {
            id: "A",
            text: "Recognize a mild allergic-like reaction, assess for progression, and provide symptomatic treatment or observation as needed",
          },
          { id: "B", text: "Initiate chest compressions immediately" },
          {
            id: "C",
            text: "Send the patient home without assessment because hives are always self-limited",
          },
          {
            id: "D",
            text: "Assume this is vasovagal syncope and place the patient in Trendelenburg position",
          },
        ],
        answerKey: "A",
        explanation:
          "Limited urticaria without airway or hemodynamic symptoms is a mild allergic-like reaction.",
        references: [{ label: "ABR NIS study guide" }],
      },
    ],
  });

  const pptx = await fs.readFile(outputPath);
  const standaloneSlide = readSlideXmlEntries(pptx).find(
    ({ text }) =>
      /Review 1 .* NIS/.test(text) && text.includes("limited urticaria"),
  );
  assert.ok(standaloneSlide, "expected the long standalone NIS question slide");

  const stemBounds = textBoxBoundsForText(
    standaloneSlide.xml,
    /A patient develops limited urticaria/,
  );
  const firstOptionBounds = textBoxBoundsForText(
    standaloneSlide.xml,
    /A\. Recognize a mild allergic-like reaction/,
  );

  assert.ok(stemBounds, "stem text box should be present");
  assert.ok(firstOptionBounds, "first option text box should be present");
  assert.ok(
    stemBounds.y + stemBounds.cy < firstOptionBounds.y,
    "long standalone stem should end before answer choices begin",
  );
});

test("core review renders source-grounded PDF questions with imported PDF images", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const { ingestCoreReviewPdfs } = await import(
    "../src/core_review/pdf-ingest.mjs"
  );
  const { buildCoreReviewQuestionBankFromCorpus } = await import(
    "../src/core_review/source-bank.mjs"
  );
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-pdf-question-image-"),
  );
  const pdfPath = path.join(tempDir, "physics-source.pdf");
  const corpusPath = path.join(tempDir, "pdf-corpus.json");
  const outputPath = path.join(tempDir, "pdf-question-image.pptx");

  await fs.writeFile(
    pdfPath,
    tinyPdfBuffer(
      "Increasing distance reduces detector exposure when other acquisition settings are unchanged.",
    ),
  );
  const corpus = await ingestCoreReviewPdfs([pdfPath], {
    outputPath: corpusPath,
    domain: "physics",
    noCopySource: true,
    noExtractImages: true,
  });
  const questionBank = buildCoreReviewQuestionBankFromCorpus(corpus, {
    title: "Imported PDF Question Images",
  });
  const question = questionBank.questions.find((item) => item.image?.localPath);
  assert.ok(question, "expected a source-grounded PDF question with an image");

  await buildDeck({
    cases: [
      {
        rawInput: "core review anchor",
        diagnosisQuery: "core review anchor",
        caseTitle: "Core review anchor",
        caseUrl: "https://radiopaedia.org/cases/example",
        author: "Test Author",
        licenseName: "CC BY-NC-SA 3.0",
        rid: "rID-pdf-question",
        revealSummary: "Anchor case for imported PDF source questions.",
        footerText: "Radiopaedia rID-pdf-question",
        images: [],
        coreReviewPlan: { domain: "physics" },
      },
    ],
    deckTitle: "Imported PDF Question Image Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
    coreReviewQuestions: [question],
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);
  assert.match(allSlideText, /What effect is described/);
  assert.match(allSlideText, /Increasing distance reduces detector exposure/);

  const mediaEntries = listZipEntries(pptx).filter((entry) =>
    /^ppt\/media\/[^/]+\.(?:png|jpeg|jpg)$/.test(entry),
  );
  assert.ok(
    mediaEntries.length >= 1,
    "expected the source-grounded PDF question slide to embed the imported PDF page image",
  );
  const mediaBytes = readZipEntry(pptx, mediaEntries[0]);
  assert.equal(
    mediaBytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    true,
    "expected the embedded PDF question image to be a PNG asset",
  );
});

test("core review avoids pin-abnormality prompts without localized annotations", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-unannotated-pin-"),
  );
  const imagePath = path.join(tempDir, "unannotated.png");
  const outputPath = path.join(tempDir, "unannotated-pin.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

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

test("core review honors review-stage slide type overrides", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-review-overrides-"),
  );
  const imagePath = path.join(tempDir, "override.png");
  const outputPath = path.join(tempDir, "overrides.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  const image = { localPath: imagePath, label: "CT abdomen" };
  await buildDeck({
    cases: [
      {
        rawInput: "appendicitis, ct abdomen pelvis",
        diagnosisQuery: "appendicitis",
        caseTitle: "appendicitis",
        caseUrl: "https://radiopaedia.org/cases/appendicitis",
        images: [image],
        coreReviewExerciseType: "diagnosis_mcq",
      },
      {
        rawInput: "diverticulitis, ct abdomen pelvis",
        diagnosisQuery: "diverticulitis",
        caseTitle: "diverticulitis",
        caseUrl: "https://radiopaedia.org/cases/diverticulitis",
        images: [image],
      },
      {
        rawInput: "small bowel obstruction, ct abdomen pelvis",
        diagnosisQuery: "small bowel obstruction",
        caseTitle: "small bowel obstruction",
        caseUrl: "https://radiopaedia.org/cases/small-bowel-obstruction",
        images: [image],
      },
      {
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        caseTitle: "pulmonary embolism",
        caseUrl: "https://radiopaedia.org/cases/pulmonary-embolism",
        images: [image],
        coreReviewExerciseType: "pin_abnormality",
      },
    ],
    deckTitle: "Core Review Override Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
  });

  const pptx = await fs.readFile(outputPath);
  const slideTexts = readSlideTexts(pptx);
  const case1QuestionText =
    slideTexts.find((text) => /Case 1 .* Diagnosis Question/.test(text)) || "";
  const case4QuestionText =
    slideTexts.find((text) => /Case 4 .* Pin Abnormality/.test(text)) || "";
  const case4AnswerSlide = readSlideXmlEntries(pptx).find(
    ({ text }) => /Case 4/.test(text) && /Abnormality \/ Finding/.test(text),
  );

  assert.match(case1QuestionText, /What is the most likely diagnosis\?/);
  assert.match(case1QuestionText, /\bA\./);
  assert.match(case4QuestionText, /Pin the abnormality\./);
  assert.ok(
    case4AnswerSlide,
    "override pin-abnormality answers should include a follow-up answer slide",
  );
  assert.match(
    case4AnswerSlide.xml,
    /prst="ellipse"/,
    "unannotated override pins should include a moveable marker",
  );
  assert.doesNotMatch(case4QuestionText, /pulmonary embolism/i);
});

test("core review does not render answer-only structure cards as case exercises", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-answer-card-"),
  );
  const imagePath = path.join(tempDir, "renal.png");
  const outputPath = path.join(tempDir, "answer-card.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  const baseCase = {
    caseUrl: "https://radiopaedia.org/cases/example",
    footerText: "Radiopaedia • rID-test",
    images: [{ localPath: imagePath, label: "CT" }],
  };

  await buildDeck({
    cases: [
      {
        ...baseCase,
        rawInput: "chiari i malformation",
        diagnosisQuery: "chiari i malformation",
        caseTitle: "chiari i malformation",
      },
      {
        ...baseCase,
        rawInput: "pulmonary embolism",
        diagnosisQuery: "pulmonary embolism",
        caseTitle: "pulmonary embolism",
      },
      {
        ...baseCase,
        rawInput: "appendicitis",
        diagnosisQuery: "appendicitis",
        caseTitle: "appendicitis",
      },
      {
        ...baseCase,
        rawInput: "supraspinatus tear",
        diagnosisQuery: "supraspinatus tear",
        caseTitle: "supraspinatus tear",
        images: [
          {
            localPath: imagePath,
            label: "MRI shoulder",
            focusPoints: [{ x: 320, y: 210, label: "supraspinatus tendon" }],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
      },
      {
        ...baseCase,
        rawInput: "subdural hematoma",
        diagnosisQuery: "subdural hematoma",
        caseTitle: "subdural hematoma",
      },
      {
        ...baseCase,
        rawInput: "renal cell carcinoma",
        diagnosisQuery: "renal cell carcinoma",
        caseTitle: "renal cell carcinoma",
        coreReviewPlan: { domain: "gu", anatomyPrompt: "kidney" },
      },
    ],
    deckTitle: "Answer Card Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
  });

  const pptx = await fs.readFile(outputPath);
  const slideTexts = readSlideTexts(pptx);
  const case6QuestionText =
    slideTexts.find((text) => /Case 6 .* Diagnosis Question/.test(text)) || "";
  const case6AnswerCardText = slideTexts.find(
    (text) =>
      /Case 6/.test(text) &&
      /Structure \/ Finding/.test(text) &&
      /Renal cell carcinoma/i.test(text),
  );

  assert.match(case6QuestionText, /What is the diagnosis\?/);
  assert.equal(
    case6AnswerCardText,
    undefined,
    "case 6 should not start as an answer-only structure/finding card",
  );
});

test("core review does not reveal pathology labels in pin anatomy prompts", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-pathology-pin-"),
  );
  const imagePath = path.join(tempDir, "head.png");
  const outputPath = path.join(tempDir, "pathology-pin.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  const baseCase = {
    caseUrl: "https://radiopaedia.org/cases/example",
    images: [{ localPath: imagePath, label: "CT" }],
  };

  await buildDeck({
    cases: [
      {
        ...baseCase,
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        caseTitle: "pulmonary embolism",
      },
      {
        ...baseCase,
        rawInput: "perianal fistula, mri pelvis",
        diagnosisQuery: "perianal fistula",
        caseTitle: "perianal fistula",
        images: [
          {
            localPath: imagePath,
            label: "MRI pelvis",
            focusPoints: [{ x: 320, y: 210, label: "fistula" }],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
      },
      {
        ...baseCase,
        rawInput: "appendicitis, ct abdomen pelvis",
        diagnosisQuery: "appendicitis",
        caseTitle: "appendicitis",
      },
      {
        ...baseCase,
        rawInput: "subdural hematoma, ct head",
        diagnosisQuery: "subdural hematoma",
        caseTitle: "subdural hematoma",
        images: [
          {
            localPath: imagePath,
            label: "CT head",
            focusPoints: [{ x: 180, y: 120, label: "subdural collection" }],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
      },
    ],
    deckTitle: "Pathology Pin Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);
  const case4QuestionText =
    readSlideTexts(pptx).find((text) =>
      /Case 4 .* Pin Abnormality/.test(text),
    ) || "";

  assert.match(case4QuestionText, /Pin the abnormality\./);
  assert.doesNotMatch(allSlideText, /Pin: subdural collection/i);
  assert.doesNotMatch(allSlideText, /Case 4 .* Pin Anatomy/);
});

test("core review treats calcification labels as abnormality pins", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-calcification-pin-"),
  );
  const imagePath = path.join(tempDir, "chest-ct.png");
  const outputPath = path.join(tempDir, "calcification-pin.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  const baseCase = {
    caseUrl: "https://radiopaedia.org/cases/example",
    images: [{ localPath: imagePath, label: "CT chest" }],
  };

  await buildDeck({
    cases: [
      {
        ...baseCase,
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        caseTitle: "pulmonary embolism",
      },
      {
        ...baseCase,
        rawInput: "perianal fistula, mri pelvis",
        diagnosisQuery: "perianal fistula",
        caseTitle: "perianal fistula",
      },
      {
        ...baseCase,
        rawInput: "appendicitis, ct abdomen pelvis",
        diagnosisQuery: "appendicitis",
        caseTitle: "appendicitis",
      },
      {
        ...baseCase,
        rawInput: "cardiac calcification, ct chest",
        diagnosisQuery: "cardiac calcification",
        caseTitle: "cardiac calcification",
        images: [
          {
            localPath: imagePath,
            label: "CT chest",
            focusPoints: [
              { x: 330, y: 195, label: "saddle shaped calcification" },
            ],
            frameWidth: 640,
            frameHeight: 420,
          },
        ],
      },
    ],
    deckTitle: "Calcification Pin Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);
  const case4QuestionText =
    readSlideTexts(pptx).find((text) =>
      /Case 4 .* Pin Abnormality/.test(text),
    ) || "";
  const case4AnswerSlideText =
    readSlideTexts(pptx).find(
      (text) => /Case 4/.test(text) && /Abnormality \/ Finding/.test(text),
    ) || "";

  assert.match(case4QuestionText, /Pin the abnormality\./);
  assert.doesNotMatch(allSlideText, /Pin: saddle shaped calcification/i);
  assert.doesNotMatch(allSlideText, /Case 4 .* Pin Anatomy/);
  assert.match(
    case4AnswerSlideText,
    /Marked region: saddle shaped calcification/i,
  );
});

test("core review broad regional anatomy prompts ask to pin the abnormality", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-broad-pin-"),
  );
  const imagePath = path.join(tempDir, "chest.png");
  const outputPath = path.join(tempDir, "broad-pin.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  const baseCase = {
    caseUrl: "https://radiopaedia.org/cases/example",
    footerText: "Radiopaedia • rID-test",
    images: [{ localPath: imagePath, label: "Chest radiograph" }],
  };

  await buildDeck({
    cases: [
      {
        ...baseCase,
        rawInput: "appendicitis, ct abdomen pelvis",
        diagnosisQuery: "appendicitis",
        caseTitle: "appendicitis",
      },
      {
        ...baseCase,
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        caseTitle: "pulmonary embolism",
      },
      {
        ...baseCase,
        rawInput: "renal cell carcinoma, ct abdomen",
        diagnosisQuery: "renal cell carcinoma",
        caseTitle: "renal cell carcinoma",
      },
      {
        ...baseCase,
        rawInput: "lung cancer left lower lobe retrocardiac, chest radiograph",
        diagnosisQuery: "lung cancer left lower lobe retrocardiac",
        studyHint: "Chest radiograph",
        caseTitle: "lung cancer left lower lobe retrocardiac",
        coreReviewPlan: { domain: "thoracic", anatomyPrompt: "chest" },
      },
    ],
    deckTitle: "Broad Pin Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
    theme: "conference-dark",
  });

  const pptx = await fs.readFile(outputPath);
  const allSlideText = readAllSlideText(pptx);
  const case4QuestionText =
    readSlideTexts(pptx).find((text) =>
      /Case 4 .* Pin Abnormality/.test(text),
    ) || "";
  const case4AnswerSlide = readSlideXmlEntries(pptx).find(
    ({ text }) =>
      /Case 4/.test(text) &&
      /Abnormality \/ Finding/.test(text) &&
      /Moveable marker/.test(text),
  );

  assert.match(case4QuestionText, /Pin the abnormality\./);
  assert.ok(
    case4AnswerSlide,
    "unannotated abnormality answers should include a moveable marker instruction",
  );
  assert.match(
    case4AnswerSlide.xml,
    /prst="ellipse"/,
    "answer slide should include a draggable marker shape",
  );
  assert.doesNotMatch(allSlideText, /Pin: chest\./i);
  assert.doesNotMatch(allSlideText, /Case 4 .* Pin Anatomy/);
  assert.doesNotMatch(allSlideText, /Marked region: chest/i);
});

test("core review diagnosis choices use clean sentence-case display labels", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-choice-labels-"),
  );
  const imagePath = path.join(tempDir, "hip.png");
  const outputPath = path.join(tempDir, "choice-labels.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  await buildDeck({
    cases: [
      {
        rawInput: "pulmonary embolism, cta chest",
        diagnosisQuery: "pulmonary embolism",
        studyHint: "CTA chest",
        caseTitle: "pulmonary embolism",
        caseUrl: "https://radiopaedia.org/cases/pulmonary-embolism",
        images: [{ localPath: imagePath, label: "CTA chest" }],
      },
      {
        rawInput: "rotator cuff tear, mri shoulder",
        diagnosisQuery: "rotator cuff tear",
        studyHint: "MRI shoulder",
        caseTitle: "rotator cuff tear",
        caseUrl: "https://radiopaedia.org/cases/rotator-cuff-tear",
        images: [{ localPath: imagePath, label: "MRI shoulder" }],
      },
      {
        rawInput: "avascular necrosis - hip, mri hip",
        diagnosisQuery: "avascular necrosis - hip",
        studyHint: "MRI hip",
        caseTitle: "avascular necrosis - hip",
        caseUrl: "https://radiopaedia.org/cases/avascular-necrosis-hip",
        images: [{ localPath: imagePath, label: "MRI hip" }],
        coreReviewPlan: { domain: "msk", anatomyPrompt: "hip" },
      },
    ],
    deckTitle: "Choice Label Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
    coreReviewCaseBank: [
      { caseTitle: "osteosarcoma", domain: "msk", anatomy: "bone" },
      {
        caseTitle: "slipped capital femoral epiphysis",
        domain: "msk",
        anatomy: "hip",
      },
      { caseTitle: "rotator cuff tear", domain: "msk", anatomy: "shoulder" },
    ],
  });

  const pptx = await fs.readFile(outputPath);
  const diagnosisSlideText = readSlideTexts(pptx).find(
    (text) =>
      /What is the most likely diagnosis\?/.test(text) &&
      /Avascular necrosis/.test(text),
  );

  assert.ok(
    diagnosisSlideText,
    "avascular necrosis should receive the diagnosis MCQ slot",
  );
  assert.match(diagnosisSlideText, /Avascular necrosis/);
  assert.doesNotMatch(diagnosisSlideText, /Avascular necrosis - hip/i);
  assert.doesNotMatch(diagnosisSlideText, /\b[A-D]\. [a-z]/);
});

test("core review diagnosis choices prefer plausible same-region distractors", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-distractors-"),
  );
  const imagePath = path.join(tempDir, "pelvis.png");
  const outputPath = path.join(tempDir, "plausible-distractors.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

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
  const diagnosisSlideText = readSlideTexts(pptx).find(
    (text) =>
      /What is the most likely diagnosis\?/.test(text) &&
      /Perianal fistula/.test(text),
  );
  assert.ok(
    diagnosisSlideText,
    "perianal fistula should receive the diagnosis MCQ slot in this regression",
  );
  assert.match(diagnosisSlideText, /Perianal fistula/);
  assert.match(
    diagnosisSlideText,
    /Perianal abscess|Hidradenitis suppurativa|Pilonidal sinus disease|Low rectal carcinoma/,
  );
  assert.doesNotMatch(
    diagnosisSlideText,
    /pulmonary embolism|Rotator cuff tear|obstructing ureteric stone/i,
  );
});

test("core review wrist diagnosis choices do not fall back to shoulder or hip distractors", async () => {
  const { buildDeck } = await import("../src/deck.mjs");
  const sharp = (await import("sharp")).default;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-deck-core-wrist-distractors-"),
  );
  const imagePath = path.join(tempDir, "wrist.png");
  const outputPath = path.join(tempDir, "wrist-distractors.pptx");

  await sharp({
    create: {
      width: 640,
      height: 420,
      channels: 3,
      background: "#202020",
    },
  })
    .png()
    .toFile(imagePath);

  const baseCase = {
    caseUrl: "https://radiopaedia.org/cases/example",
    author: "Test Author",
    licenseName: "CC BY-NC-SA 3.0",
    images: [{ localPath: imagePath, label: "X-ray" }],
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
        rawInput: "scaphoid fracture, wrist radiograph",
        diagnosisQuery: "Scaphoid fracture",
        studyHint: "Wrist radiograph",
        caseTitle: "Scaphoid fracture",
        coreReviewPlan: { domain: "msk", anatomyPrompt: "wrist" },
      },
      {
        ...baseCase,
        rawInput: "avascular necrosis - hip, mri hip",
        diagnosisQuery: "avascular necrosis - hip",
        studyHint: "MRI hip",
        caseTitle: "avascular necrosis - hip",
        coreReviewPlan: { domain: "msk", anatomyPrompt: "hip" },
      },
    ],
    deckTitle: "Wrist Distractor Regression",
    outputPath,
    scratchDir: path.join(tempDir, "scratch"),
    deckMode: "core-review",
    coreReviewCaseBank: [
      { caseTitle: "rotator cuff tear", domain: "msk", anatomy: "shoulder" },
      { caseTitle: "avascular necrosis - hip", domain: "msk", anatomy: "hip" },
      { caseTitle: "rheumatoid arthritis", domain: "msk", anatomy: "hands" },
    ],
  });

  const pptx = await fs.readFile(outputPath);
  const diagnosisSlideText = readSlideTexts(pptx).find(
    (text) =>
      /What is the most likely diagnosis\?/.test(text) &&
      /Scaphoid fracture/.test(text),
  );

  assert.ok(
    diagnosisSlideText,
    "scaphoid fracture should receive the diagnosis MCQ slot",
  );
  assert.match(
    diagnosisSlideText,
    /Lunate dislocation|Perilunate dislocation|Scapholunate ligament injury|Kienbock disease|Distal radius fracture/,
  );
  assert.doesNotMatch(
    diagnosisSlideText,
    /Rotator cuff tear|Avascular necrosis|Transient osteoporosis|Slipped capital/i,
  );
});

function readZipEntryText(buffer, entryName) {
  const entry = readZipEntry(buffer, entryName);
  return entry.toString("utf8");
}

function readAllSlideText(buffer) {
  return readSlideTexts(buffer).join("\n\n");
}

function readSlideXmlEntries(buffer) {
  return listZipEntries(buffer)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => slideNumber(left) - slideNumber(right))
    .map((entry) => {
      const xml = readZipEntryText(buffer, entry);
      return { entry, xml, text: decodeXmlText(xml) };
    });
}

function readSlideTexts(buffer) {
  return readSlideXmlEntries(buffer).map(({ text }) => text);
}

function textBoxBoundsForText(slideXml, pattern) {
  const shapes = slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
  for (const shape of shapes) {
    if (!pattern.test(decodeXmlText(shape))) {
      continue;
    }
    const bounds =
      /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"/.exec(
        shape,
      );
    if (bounds) {
      return {
        x: Number(bounds[1]),
        y: Number(bounds[2]),
        cx: Number(bounds[3]),
        cy: Number(bounds[4]),
      };
    }
  }
  return null;
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
    const fileName = buffer.toString(
      "utf8",
      offset + 46,
      offset + 46 + fileNameLength,
    );
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
    const fileName = buffer.toString(
      "utf8",
      offset + 46,
      offset + 46 + fileNameLength,
    );

    if (fileName === entryName) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart =
        localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      return compressionMethod === 8
        ? zlib.inflateRawSync(compressed)
        : compressed;
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
