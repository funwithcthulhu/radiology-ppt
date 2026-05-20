import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  coreReviewCaseCountForTotal,
  coreReviewStandaloneQuestionCountsForTotal,
  normalizeCaseRequestEntries,
  normalizePreparedItems,
} from "../src/backend-api.mjs";
import { readRandomHistory } from "../src/app-store.mjs";
import { ingestCoreReviewSources } from "../src/core_review/index.mjs";

test("backend API normalizes request rows and render payloads", () => {
  const requests = normalizeCaseRequestEntries([
    "multiple sclerosis, mri brain",
    "multiple sclerosis, mri brain",
    {
      requestMode: "random",
      rawInput: "random neuro",
      randomCount: 2,
      randomSystems: ["Central Nervous System"],
      randomSystemMode: "all",
    },
  ]);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].diagnosis, "multiple sclerosis");
  assert.equal(requests[1].randomSpec?.count, 2);

  const prepared = normalizePreparedItems({
    items: [
      {
        request: { rawInput: "appendicitis", diagnosis: "appendicitis" },
        caseData: { caseTitle: "Appendicitis", images: [] },
      },
    ],
  });

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].caseData.caseTitle, "Appendicitis");
});

test("backend API drops empty rows but keeps repeated random rows", () => {
  const requests = normalizeCaseRequestEntries([
    "",
    "   ",
    null,
    "random",
    "random",
    "appendicitis, ct abdomen",
    "appendicitis, ct abdomen",
  ]);

  assert.equal(requests.length, 3);
  assert.equal(requests.filter((request) => request.randomSpec).length, 2);
  assert.equal(
    requests.filter((request) => request.diagnosis === "appendicitis").length,
    1,
  );
});

test("backend API parses request-list imports and rejects PDF fragments", () => {
  const csvRequests = normalizeCaseRequestEntries(
    "diagnosis,study hint\nappendicitis,ct abdomen\nmultiple sclerosis,mri brain",
  );
  assert.equal(csvRequests.length, 2);
  assert.equal(csvRequests[0].diagnosis, "appendicitis");
  assert.equal(csvRequests[0].studyHint, "ct abdomen");
  assert.equal(csvRequests[1].diagnosis, "multiple sclerosis");

  const urlRequests = normalizeCaseRequestEntries([
    "https://radiopaedia.org/cases/colonic-diverticulosis-1?lang=us",
  ]);
  assert.equal(urlRequests.length, 1);
  assert.equal(urlRequests[0].requestMode, "manual");
  assert.equal(urlRequests[0].diagnosis, "colonic diverticulosis");

  assert.throws(
    () => normalizeCaseRequestEntries(["endobj", "xref", "%%EOF"]),
    /Unsupported request-list import/,
  );
});

test("Core Review total item count reserves NIS and physics inside requested total", () => {
  assert.deepEqual(coreReviewStandaloneQuestionCountsForTotal(50), {
    nis: 2,
    physics: 2,
  });
  assert.equal(coreReviewCaseCountForTotal(50), 46);
  assert.deepEqual(coreReviewStandaloneQuestionCountsForTotal(25), {
    nis: 2,
    physics: 2,
  });
  assert.equal(coreReviewCaseCountForTotal(25), 21);
  assert.deepEqual(coreReviewStandaloneQuestionCountsForTotal(10), {
    nis: 1,
    physics: 1,
  });
  assert.equal(coreReviewCaseCountForTotal(10), 8);
  assert.deepEqual(coreReviewStandaloneQuestionCountsForTotal(3), {
    nis: 0,
    physics: 0,
  });
  assert.equal(coreReviewCaseCountForTotal(3), 3);
});

test("prepared item normalization rejects malformed render payloads", () => {
  assert.throws(
    () => normalizePreparedItems({}),
    /Prepared input must contain an array/,
  );

  const prepared = normalizePreparedItems([
    {
      request: {
        requestMode: "manual",
        rawInput: "Manual URL",
        selectedCasePath:
          "https://radiopaedia.org/cases/example-case-1?lang=us",
      },
      caseData: {
        caseTitle: "Example case",
        images: [],
      },
    },
    {
      request: { rawInput: "" },
      caseData: { caseTitle: "" },
    },
  ]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].request.rawInput, "Manual URL");
  assert.equal(prepared[0].request.diagnosis, "example case");
});

test("PowerPoint render rejects missing case identity before generation", async () => {
  const { renderPowerPoint, tempDir } = await loadRenderPowerPoint(
    "missing-case-identity",
  );

  await assert.rejects(
    () =>
      renderPowerPoint(
        {
          items: [
            {
              request: { rawInput: "appendicitis" },
              caseData: {
                rawInput: "appendicitis",
                diagnosisQuery: "appendicitis",
                images: [],
              },
            },
          ],
        },
        {
          out: path.join(tempDir, "outputs", "missing-identity.pptx"),
          title: "Missing Identity Test",
        },
      ),
    (error) => {
      assert.match(error.message, /Cannot render PowerPoint/);
      assert.match(error.message, /Case 1 is missing a case title/);
      assert.match(error.message, /Case 1 is missing a case identifier/);
      return true;
    },
  );
});

test("PowerPoint render rejects missing and unsupported image assets", async () => {
  const { renderPowerPoint, tempDir } = await loadRenderPowerPoint(
    "invalid-image-assets",
  );
  const missingImagePath = path.join(tempDir, "images", "missing.png");

  await assert.rejects(
    () =>
      renderPowerPoint(
        {
          items: [
            {
              request: { rawInput: "appendicitis" },
              caseData: renderCaseData({
                images: [
                  { label: "No local path" },
                  {
                    localPath: "https://example.com/image.png",
                    label: "Remote image URL",
                  },
                  { localPath: missingImagePath, label: "Missing file" },
                ],
              }),
            },
          ],
        },
        {
          out: path.join(tempDir, "outputs", "invalid-assets.pptx"),
          title: "Invalid Assets Test",
        },
      ),
    (error) => {
      assert.match(error.message, /Cannot render PowerPoint/);
      assert.match(
        error.message,
        /Image 1 for case "Appendicitis" is missing a localPath/,
      );
      assert.match(
        error.message,
        /Image 2 for case "Appendicitis" uses an unsupported image path/,
      );
      assert.match(
        error.message,
        /Image 3 for case "Appendicitis" was not found/,
      );
      assert.match(error.message, /missing\.png/);
      return true;
    },
  );
});

test("PowerPoint render rejects empty render input and empty cases clearly", async () => {
  const { renderPowerPoint, tempDir } =
    await loadRenderPowerPoint("empty-render-input");

  await assert.rejects(
    () =>
      renderPowerPoint(
        { items: [] },
        {
          out: path.join(tempDir, "outputs", "empty-list.pptx"),
          title: "Empty List Test",
        },
      ),
    /No prepared cases were provided for render/,
  );

  await assert.rejects(
    () =>
      renderPowerPoint(
        {
          items: [
            {
              request: { rawInput: "empty case" },
              caseData: {},
            },
          ],
        },
        {
          out: path.join(tempDir, "outputs", "empty-case.pptx"),
          title: "Empty Case Test",
        },
      ),
    (error) => {
      assert.match(error.message, /Cannot render PowerPoint/);
      assert.match(error.message, /Case 1 is missing a case title/);
      assert.match(error.message, /Case 1 is missing a case identifier/);
      assert.match(error.message, /Case 1 is missing an images array/);
      return true;
    },
  );
});

test("PowerPoint render rejects directory output paths before export", async () => {
  const { renderPowerPoint, tempDir } =
    await loadRenderPowerPoint("directory-output-path");
  const outputPath = path.join(tempDir, "outputs", "blocked.pptx");
  await fs.mkdir(outputPath, { recursive: true });

  await assert.rejects(
    () =>
      renderPowerPoint(
        {
          items: [
            {
              request: { rawInput: "appendicitis" },
              caseData: renderCaseData(),
            },
          ],
        },
        {
          out: outputPath,
          title: "Directory Output Path Test",
        },
      ),
    (error) => {
      assert.match(error.message, /Cannot render PowerPoint/);
      assert.match(error.message, /output path is a directory/);
      assert.match(error.message, /blocked\.pptx/);
      return true;
    },
  );
});

test("PowerPoint render does not write random history a second time", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-render-history-"),
  );
  process.env.RADIOLOGY_PPT_APP_ROOT = tempDir;
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  const moduleUrl = new URL(
    `../src/backend-api.mjs?render-history=${Date.now()}`,
    import.meta.url,
  );
  const { renderPowerPoint } = await import(moduleUrl.href);
  const outputPath = path.join(tempDir, "outputs", "render-history-test.pptx");

  const result = await renderPowerPoint(
    {
      items: [
        {
          request: {
            rawInput: "random",
            originalInput: "random",
            selectedCasePath: "/cases/example-case",
          },
          caseData: {
            rawInput: "Example case",
            diagnosisQuery: "Example case",
            studyHint: "",
            caseTitle: "Example case",
            casePath: "/cases/example-case?lang=us",
            caseUrl: "https://radiopaedia.org/cases/example-case?lang=us",
            author: "",
            licenseName: "",
            licenseUrl: "",
            rid: "",
            modalitySummary: "MRI",
            studyCount: 1,
            caseIntro: "",
            teachingPoints: [],
            revealSummary: "Example summary.",
            footerText: "",
            patientData: {},
            images: [],
          },
        },
      ],
    },
    {
      out: outputPath,
      title: "Render history test",
    },
  );

  assert.equal(result.outputPath, outputPath);
  await fs.access(outputPath);
  assert.deepEqual(await readRandomHistory({ limit: 10 }), []);
});

test("PowerPoint render can source Core Review questions from the imported library", async () => {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "radiology-render-core-library-"),
  );
  process.env.RADIOLOGY_PPT_APP_ROOT = tempDir;
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  const libraryDir = path.join(tempDir, "library", "board-review");
  await fs.mkdir(libraryDir, { recursive: true });
  await ingestCoreReviewSources(
    [
      await writeImportedSource(
        tempDir,
        "nis-communication-notes.md",
        "Critical results should be directly communicated to the responsible clinician and documented.",
      ),
    ],
    {
      outputPath: path.join(libraryDir, "corpus.json"),
      domain: "nis",
    },
  );

  const moduleUrl = new URL(
    `../src/backend-api.mjs?core-library=${Date.now()}`,
    import.meta.url,
  );
  const { renderPowerPoint } = await import(moduleUrl.href);
  const outputPath = path.join(tempDir, "outputs", "core-library-test.pptx");

  const result = await renderPowerPoint(
    {
      items: [
        {
          request: {
            rawInput: "appendicitis",
            diagnosis: "appendicitis",
          },
          caseData: {
            rawInput: "Appendicitis",
            diagnosisQuery: "Appendicitis",
            studyHint: "",
            caseTitle: "Appendicitis",
            casePath: "/cases/example-case",
            caseUrl: "https://radiopaedia.org/cases/example-case",
            author: "",
            licenseName: "",
            licenseUrl: "",
            rid: "",
            modalitySummary: "CT",
            studyCount: 1,
            caseIntro: "",
            teachingPoints: [],
            revealSummary: "Example summary.",
            footerText: "",
            patientData: {},
            images: [],
          },
        },
      ],
    },
    {
      out: outputPath,
      title: "Imported Library Review",
      deckMode: "core-review",
      coreReviewQuestionSource: "library",
    },
  );

  assert.equal(result.outputPath, outputPath);
  const pptx = await fs.readFile(outputPath);
  const slideText = readAllSlideText(pptx);
  assert.match(slideText, /communication notes/i);
});

async function writeImportedSource(tempDir, fileName, text) {
  const filePath = path.join(tempDir, fileName);
  await fs.writeFile(filePath, text, "utf8");
  return filePath;
}

async function loadRenderPowerPoint(name) {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), `radiology-${name}-`),
  );
  process.env.RADIOLOGY_PPT_APP_ROOT = tempDir;
  process.env.RADIOLOGY_PPT_DATABASE_PATH = path.join(tempDir, "state.sqlite");

  const moduleUrl = new URL(
    `../src/backend-api.mjs?${name}=${Date.now()}-${Math.random()}`,
    import.meta.url,
  );
  const { renderPowerPoint } = await import(moduleUrl.href);
  return { renderPowerPoint, tempDir };
}

function renderCaseData(overrides = {}) {
  return {
    rawInput: "appendicitis",
    diagnosisQuery: "appendicitis",
    studyHint: "",
    caseTitle: "Appendicitis",
    casePath: "/cases/appendicitis-validation",
    caseUrl: "https://radiopaedia.org/cases/appendicitis-validation",
    author: "",
    licenseName: "",
    licenseUrl: "",
    rid: "",
    modalitySummary: "CT",
    studyCount: 1,
    caseIntro: "",
    teachingPoints: [],
    revealSummary: "Example summary.",
    footerText: "",
    patientData: {},
    images: [],
    ...overrides,
  };
}

function readAllSlideText(buffer) {
  return listZipEntries(buffer)
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
    .sort((left, right) => slideNumber(left) - slideNumber(right))
    .map((entry) => decodeXmlText(readZipEntryText(buffer, entry)))
    .join("\n\n");
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
    entries.push(
      buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength),
    );
    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntryText(buffer, entryName) {
  return readZipEntry(buffer, entryName).toString("utf8");
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
