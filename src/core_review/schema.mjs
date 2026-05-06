export const CORE_REVIEW_DOMAINS = [
  { id: "breast", label: "Breast Imaging", abrCategory: "Breast imaging" },
  {
    id: "cardiovascular",
    label: "Cardiovascular Imaging",
    abrCategory: "Cardiovascular imaging",
  },
  {
    id: "ct",
    label: "Computed Tomography",
    abrCategory: "Computed tomography",
  },
  {
    id: "gi",
    label: "Gastrointestinal Imaging",
    abrCategory: "Gastrointestinal imaging",
  },
  {
    id: "gu",
    label: "Genitourinary Imaging",
    abrCategory: "Genitourinary imaging",
  },
  {
    id: "ir",
    label: "Interventional Radiology",
    abrCategory: "Interventional radiology",
  },
  {
    id: "mr",
    label: "Magnetic Resonance Imaging",
    abrCategory: "Magnetic resonance imaging",
  },
  {
    id: "msk",
    label: "Musculoskeletal Radiology",
    abrCategory: "Musculoskeletal radiology",
  },
  { id: "neuro", label: "Neuroradiology", abrCategory: "Neuroradiology" },
  {
    id: "nis",
    label: "Noninterpretive Skills",
    abrCategory: "Noninterpretive skills",
  },
  {
    id: "nuclear",
    label: "Nuclear Radiology",
    abrCategory: "Nuclear radiology",
  },
  {
    id: "pediatric",
    label: "Pediatric Radiology",
    abrCategory: "Pediatric radiology",
  },
  { id: "physics", label: "Physics", abrCategory: "Physics" },
  {
    id: "risc",
    label: "Radioisotope Safety Content",
    abrCategory: "Radioisotope Safety Content",
  },
  {
    id: "radiography_fluoroscopy",
    label: "Radiography/Fluoroscopy",
    abrCategory: "Radiography/fluoroscopy",
  },
  {
    id: "thoracic",
    label: "Thoracic Radiology",
    abrCategory: "Thoracic radiology",
  },
  { id: "ultrasound", label: "Ultrasound", abrCategory: "Ultrasound" },
];

export const CORE_REVIEW_QUESTION_TYPES = [
  {
    id: "single_best_answer",
    label: "Single Best Answer",
    officialPattern:
      "Most ABR computer-based items are standard multiple-choice questions.",
    answerShape: "One keyed option from a homogeneous option set.",
    generatorNotes: [
      "Ask one focused task.",
      "Use a complete stem that can pass the cover test.",
      "Avoid all/none of the above, negative phrasing, and clueing option length.",
    ],
  },
  {
    id: "image_hotspot",
    label: "Image Hotspot / Anatomy Localization",
    officialPattern:
      "ABR sample/readiness materials describe drag-and-drop anatomical localization.",
    answerShape:
      "One target region on an image, stored as normalized x/y/width/height.",
    generatorNotes: [
      "Use only when a finding or structure can be localized unambiguously.",
      "Require one target per item.",
      "Store image provenance and answer-region coordinates separately from the stem.",
    ],
  },
  {
    id: "gold_marker_abnormality",
    label: "Gold Marker Abnormality Localization",
    officialPattern:
      "Gold-marker questions ask the learner to place a marker on the abnormal finding.",
    answerShape:
      "One abnormality target region, stored as normalized image coordinates.",
    generatorNotes: [
      "Best for radiographs and other single-image cases with one visible abnormality.",
      "Use normalized coordinates so the answer remains valid after resizing.",
      "Store an accepted rectangle or center/radius target, plus optional finding labels for analytics.",
    ],
  },
  {
    id: "numeric_fill_blank",
    label: "Numeric Fill-in-the-Blank",
    officialPattern:
      "ABR item guidance describes rare numeric fill-in-the-blank items.",
    answerShape: "Numeric value or accepted range with required precision.",
    generatorNotes: [
      "Reserve for physics, dosimetry, nuclear medicine, or statistics calculations.",
      "State significant digits or units in the stem.",
      "Accept a tolerance range when rounding is expected.",
    ],
  },
  {
    id: "multi_correct",
    label: "Multiple Correct Options",
    officialPattern:
      "Useful sandbox type for practice even when not the default Core style.",
    answerShape:
      "Two or more keyed options from a longer homogeneous option set.",
    generatorNotes: [
      "Tell the learner how many options to select.",
      "Use at least twice as many options as correct answers.",
      "Grade all-or-none by default, with analytics tracking partial knowledge separately.",
    ],
  },
  {
    id: "linked_options",
    label: "Linked Options Set",
    officialPattern:
      "Classic review-bank pattern where several stems share one option list.",
    answerShape:
      "Multiple stems, each with one keyed option from a shared list.",
    generatorNotes: [
      "Keep every stem parallel in length and data type.",
      "Allow options to be used once, more than once, or not at all.",
      "Use for pattern-recognition drills and differential diagnosis sorting.",
    ],
  },
];

export const CORE_REVIEW_SCHEMA_SOURCES = [
  {
    label: "ABR Diagnostic Radiology certification page",
    url: "https://www.theabr.org/get-certified/diagnostic-radiology/#exam-preparation",
  },
  {
    label: "ABR Remote Qualifying (Core) Exam Guide",
    url: "https://www.theabr.org/DR-IRDR-Remote-Qualifying-Core-Exam-Guide",
  },
  {
    label: "ABR Qualifying (Core) Exam Domains",
    url: "https://www.theabr.org/wp-content/uploads/2025/07/Qualifying-Core-Exam-All-Domains-v3.pdf",
  },
  {
    label: "ABR Item Writers' Guide",
    url: "https://www.theabr.org/item-writers-guide-cbe",
  },
];

const DOMAIN_ALIASES = new Map(
  CORE_REVIEW_DOMAINS.flatMap((domain) => [
    [domain.id, domain.id],
    [domain.label.toLowerCase(), domain.id],
    [domain.abrCategory.toLowerCase(), domain.id],
  ]),
);

DOMAIN_ALIASES.set("cardiac", "cardiovascular");
DOMAIN_ALIASES.set("chest", "thoracic");
DOMAIN_ALIASES.set("noninterpretive", "nis");
DOMAIN_ALIASES.set("non-interpretive", "nis");
DOMAIN_ALIASES.set("musculoskeletal", "msk");
DOMAIN_ALIASES.set("peds", "pediatric");
DOMAIN_ALIASES.set("radioisotope safety", "risc");
DOMAIN_ALIASES.set("xray", "radiography_fluoroscopy");
DOMAIN_ALIASES.set("x-ray", "radiography_fluoroscopy");
DOMAIN_ALIASES.set("fluoro", "radiography_fluoroscopy");
DOMAIN_ALIASES.set("us", "ultrasound");

const QUESTION_TYPE_ALIASES = new Map(
  CORE_REVIEW_QUESTION_TYPES.flatMap((type) => [
    [type.id, type.id],
    [type.label.toLowerCase(), type.id],
  ]),
);

QUESTION_TYPE_ALIASES.set("mcq", "single_best_answer");
QUESTION_TYPE_ALIASES.set("multiple_choice", "single_best_answer");
QUESTION_TYPE_ALIASES.set("single-best-answer", "single_best_answer");
QUESTION_TYPE_ALIASES.set("drag_drop", "image_hotspot");
QUESTION_TYPE_ALIASES.set("drag-and-drop", "image_hotspot");
QUESTION_TYPE_ALIASES.set("point_click", "image_hotspot");
QUESTION_TYPE_ALIASES.set("hotspot", "image_hotspot");
QUESTION_TYPE_ALIASES.set("gold_marker", "gold_marker_abnormality");
QUESTION_TYPE_ALIASES.set("gold-marker", "gold_marker_abnormality");
QUESTION_TYPE_ALIASES.set("abnormality_marker", "gold_marker_abnormality");
QUESTION_TYPE_ALIASES.set(
  "abnormality-localization",
  "gold_marker_abnormality",
);
QUESTION_TYPE_ALIASES.set("fill_blank", "numeric_fill_blank");
QUESTION_TYPE_ALIASES.set("numeric", "numeric_fill_blank");
QUESTION_TYPE_ALIASES.set("select_all", "multi_correct");
QUESTION_TYPE_ALIASES.set("r_type", "linked_options");

export function normalizeCoreReviewDomain(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return DOMAIN_ALIASES.get(normalized) || "";
}

export function normalizeCoreReviewQuestionType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return QUESTION_TYPE_ALIASES.get(normalized) || "";
}

export function coreReviewSchemaSummary() {
  return {
    version: 1,
    purpose:
      "Core Review infrastructure for ABR Diagnostic Radiology Qualifying (Core) Exam style study and quiz generation.",
    domains: CORE_REVIEW_DOMAINS,
    questionTypes: CORE_REVIEW_QUESTION_TYPES,
    sources: CORE_REVIEW_SCHEMA_SOURCES,
    contentPolicy: {
      bundledContent:
        "The repository stores schema, ingestion, and quiz tooling only. Copyrighted qbanks/books should be ingested from user-provided local files and kept out of commits unless explicitly licensed.",
      generatedQuestions:
        "Generated questions should cite their source chunks, avoid copying protected prose, and be marked as practice material rather than official ABR content.",
    },
  };
}
