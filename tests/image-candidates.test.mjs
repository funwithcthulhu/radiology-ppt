import test from "node:test";
import assert from "node:assert/strict";
import {
  buildImageCandidates,
  evaluateSelectedImages,
  normalizeImageCandidateBank,
  selectRelevantImages,
} from "../src/image-candidates.mjs";

function demoStudy() {
  return {
    id: 101,
    modality: "MRI",
    case_key_image_id: 2,
    series: [
      {
        series_id: 7,
        specifics: "T1",
        perspective: "Axial",
        encodings: {
          thumbnailed_files: [
            { original: "one.jpg" },
            { original: "two.jpg" },
            { original: "three.jpg" },
          ],
        },
        frames: [
          { id: 1, current: false, width: 512, height: 512 },
          { id: 2, current: true, width: 512, height: 512 },
          { id: 3, current: false, width: 512, height: 512 },
        ],
        annotations: [
          {
            arrow_positions: [{ slice_idx: 1, x: 0.5, y: 0.45 }],
            label_positions: [],
          },
        ],
      },
    ],
  };
}

test("builds scored candidates from annotated study frames", () => {
  const candidates = buildImageCandidates(demoStudy());
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].frameId, 2);
  assert.equal(candidates[0].isAnnotated, true);
  assert.ok(candidates[0].relevantScore > 400);
  assert.equal(candidates[0].audit.provider, "radiopaedia");
  assert.ok(candidates[0].audit.reasons.includes("contains Radiopaedia annotation"));
});

test("does not reselect excluded image frames", () => {
  const candidates = buildImageCandidates(demoStudy());
  const selected = selectRelevantImages(candidates, 1, { excludeFrameIds: [2] });
  assert.deepEqual(selected, []);
});

test("can explicitly select requested image frames before filling remaining slots", () => {
  const candidates = [
    { frameId: "1", seriesId: "a", viewSignature: "a", relevantScore: 500, url: "https://example.com/1.jpg" },
    { frameId: "2", seriesId: "b", viewSignature: "b", relevantScore: 120, url: "https://example.com/2.jpg" },
    { frameId: "3", seriesId: "c", viewSignature: "c", relevantScore: 450, url: "https://example.com/3.jpg" },
  ];

  const selected = selectRelevantImages(candidates, 2, { includeFrameIds: ["2"] });

  assert.equal(selected[0].frameId, "2");
  assert.equal(selected.length, 2);
  assert.equal(selected[0].audit.selectedReason, "explicitly requested plus ranked fill");
  assert.match(selected[0].selectionExplanation, /explicitly requested/);
  assert.ok(selected.some((candidate) => candidate.frameId === "1" || candidate.frameId === "3"));
});

test("normalizes candidate banks and drops local paths", () => {
  const bank = normalizeImageCandidateBank([{ url: "https://example.test/a.jpg", frameId: "a", localPath: "cached.jpg" }]);
  assert.equal(bank.length, 1);
  assert.equal(bank[0].frameId, "a");
  assert.equal(bank[0].localPath, undefined);
  assert.deepEqual(bank[0].audit, {});
  assert.match(bank[0].selectionExplanation, /Candidate/);
});

test("flags weak image sets for teaching use", () => {
  const quality = evaluateSelectedImages([], 3);
  assert.equal(quality.shouldReroll, true);
  assert.match(quality.summary, /Only 0/);
});

test("ignores malformed frame metadata without throwing", () => {
  const candidates = buildImageCandidates({
    id: 202,
    modality: "CT",
    case_key_image_id: 99,
    series: [
      {
        series_id: 1,
        specifics: "Portal venous",
        perspective: "Axial",
        encodings: {
          thumbnailed_files: [{ original: "one.jpg" }, null, { original: "" }, { original: "extra.jpg" }],
        },
        frames: [
          { id: 10, current: true, width: 512, height: 512 },
          null,
          { id: 12, current: false, width: 512, height: 512 },
        ],
        annotations: [
          {
            arrow_positions: [
              { slice_idx: 0, x: 0.5, y: 0.5 },
              { slice_idx: 10, x: 0.5, y: 0.5 },
            ],
            label_positions: [{ slice_idx: -1, x: 0.2, y: 0.2 }],
          },
        ],
      },
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].frameId, 10);
  assert.equal(candidates[0].isAnnotated, true);
});

test("does not re-add excluded frames while filling explicit selections", () => {
  const candidates = [
    { frameId: "keep", seriesId: "a", viewSignature: "a", relevantScore: 500, url: "https://example.com/a.jpg" },
    { frameId: "reject", seriesId: "b", viewSignature: "b", relevantScore: 700, url: "https://example.com/b.jpg" },
    { frameId: "fallback", seriesId: "c", viewSignature: "c", relevantScore: 300, url: "https://example.com/c.jpg" },
  ];

  const selected = selectRelevantImages(candidates, 2, {
    includeFrameIds: ["keep", "reject"],
    excludeFrameIds: ["reject"],
  });

  assert.deepEqual(selected.map((candidate) => candidate.frameId), ["keep", "fallback"]);
});

test("difficulty changes weak-image warnings predictably", () => {
  const images = [
    {
      frameId: "adequate",
      relevantScore: 130,
      isAnnotated: false,
      isKeyImage: false,
    },
  ];

  const easy = evaluateSelectedImages(images, 2, "easy");
  const hard = evaluateSelectedImages(images, 2, "hard");

  assert.equal(easy.shouldReroll, true);
  assert.match(easy.summary, /Easy mode/);
  assert.equal(hard.warnings.some((warning) => /Easy mode/.test(warning)), false);
});
