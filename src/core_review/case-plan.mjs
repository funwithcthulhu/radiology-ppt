import fs from "node:fs/promises";
import { CORE_REVIEW_DOMAINS, normalizeCoreReviewDomain } from "./schema.mjs";
import { collapseWhitespace, dedupe, slugify } from "../utils.mjs";

export const CORE_REVIEW_CASE_SOURCES = [
  {
    label: "ABR Diagnostic Radiology Qualifying (Core) Exam",
    url: "https://www.theabr.org/diagnostic-radiology/initial-certification/core-exam",
  },
  {
    label: "ABR Qualifying (Core) Exam Domains",
    url: "https://www.theabr.org/wp-content/uploads/2025/07/Qualifying-Core-Exam-All-Domains-v3.pdf",
  },
];

const NON_CASE_DOMAINS = new Set(["nis", "physics", "risc"]);
const CASE_DOMAIN_IDS = CORE_REVIEW_DOMAINS
  .map((domain) => domain.id)
  .filter((domain) => !NON_CASE_DOMAINS.has(domain));

const DOMAIN_WEIGHTS = {
  neuro: 1.2,
  thoracic: 1.0,
  gi: 1.0,
  gu: 0.95,
  msk: 1.0,
  pediatric: 0.85,
  breast: 0.55,
  cardiovascular: 0.55,
  nuclear: 0.45,
  ultrasound: 0.55,
  radiography_fluoroscopy: 0.45,
  ir: 0.35,
  ct: 0.6,
  mr: 0.6,
};

const DEFAULT_SYSTEMS_BY_DOMAIN = {
  breast: ["Breast"],
  cardiovascular: ["Cardiac", "Vascular"],
  ct: ["Chest", "Gastrointestinal", "Hepatobiliary", "Urogenital", "Trauma"],
  gi: ["Gastrointestinal", "Hepatobiliary"],
  gu: ["Urogenital", "Gynaecology", "Obstetrics"],
  ir: ["Interventional", "Vascular"],
  mr: ["Central Nervous System", "Musculoskeletal", "Gastrointestinal", "Urogenital"],
  msk: ["Musculoskeletal"],
  neuro: ["Central Nervous System", "Head & Neck", "Spine"],
  nuclear: ["Gastrointestinal", "Hepatobiliary", "Urogenital", "Chest", "Oncology"],
  pediatric: ["Paediatrics"],
  radiography_fluoroscopy: ["Gastrointestinal", "Chest", "Paediatrics"],
  thoracic: ["Chest"],
  ultrasound: ["Urogenital", "Gynaecology", "Obstetrics", "Vascular", "Paediatrics", "Hepatobiliary"],
};

const DEFAULT_CORE_REVIEW_CASES = [
  caseItem("neuro", "acute ischemic stroke", "brain", ["CT", "MRI"], { topicFocus: "vascular" }),
  caseItem("neuro", "hypertensive intracerebral hemorrhage", "brain", ["CT", "MRI"], { topicFocus: "vascular" }),
  caseItem("neuro", "subarachnoid hemorrhage", "brain", ["CT", "Angiography"], { topicFocus: "vascular" }),
  caseItem("neuro", "subdural hematoma", "brain", ["CT", "MRI"], { topicFocus: "trauma" }),
  caseItem("neuro", "epidural hematoma", "brain", ["CT"], { topicFocus: "trauma" }),
  caseItem("neuro", "glioblastoma", "brain", ["MRI", "CT"], { topicFocus: "tumor" }),
  caseItem("neuro", "meningioma", "brain", ["MRI", "CT"], { topicFocus: "tumor" }),
  caseItem("neuro", "vestibular schwannoma", "internal auditory canal", ["MRI"], { topicFocus: "tumor" }),
  caseItem("neuro", "pituitary macroadenoma", "sella", ["MRI", "CT"], { topicFocus: "tumor" }),
  caseItem("neuro", "multiple sclerosis", "brain and spine", ["MRI"]),
  caseItem("neuro", "cerebral venous thrombosis", "brain", ["MRI", "CT"], { topicFocus: "vascular" }),
  caseItem("neuro", "normal pressure hydrocephalus", "brain", ["CT", "MRI"]),

  caseItem("thoracic", "pneumonia", "chest", ["X-ray", "CT"], { topicFocus: "infection" }),
  caseItem("thoracic", "pneumothorax", "chest", ["X-ray", "CT"]),
  caseItem("thoracic", "tension pneumothorax", "chest", ["X-ray", "CT"]),
  caseItem("thoracic", "pulmonary edema", "chest", ["X-ray", "CT"]),
  caseItem("thoracic", "pulmonary embolism", "chest", ["CT"], { topicFocus: "vascular" }),
  caseItem("thoracic", "lung cancer", "chest", ["CT", "X-ray"], { topicFocus: "tumor" }),
  caseItem("thoracic", "pleural effusion", "chest", ["X-ray", "CT"]),
  caseItem("thoracic", "empyema", "chest", ["CT", "X-ray"], { topicFocus: "infection" }),
  caseItem("thoracic", "interstitial lung disease", "chest", ["CT", "X-ray"]),
  caseItem("thoracic", "sarcoidosis", "chest", ["X-ray", "CT"]),
  caseItem("thoracic", "tuberculosis", "chest", ["X-ray", "CT"], { topicFocus: "infection" }),
  caseItem("thoracic", "atelectasis", "chest", ["X-ray", "CT"]),

  caseItem("cardiovascular", "aortic dissection", "aorta", ["CT", "MRI"], { topicFocus: "vascular" }),
  caseItem("cardiovascular", "aortic aneurysm", "aorta", ["CT", "Ultrasound"], { topicFocus: "vascular" }),
  caseItem("cardiovascular", "pericardial effusion", "heart", ["CT", "X-ray", "Ultrasound"]),
  caseItem("cardiovascular", "coarctation of the aorta", "thoracic aorta", ["CT", "MRI"], { topicFocus: "congenital" }),
  caseItem("cardiovascular", "hypertrophic cardiomyopathy", "heart", ["MRI"]),
  caseItem("cardiovascular", "coronary artery anomaly", "coronary arteries", ["CT"], { topicFocus: "congenital" }),
  caseItem("cardiovascular", "cardiac sarcoidosis", "heart", ["MRI", "PET"]),
  caseItem("cardiovascular", "pulmonary arterial hypertension", "heart and pulmonary arteries", ["CT", "MRI"]),

  caseItem("gi", "appendicitis", "right lower quadrant", ["CT", "Ultrasound"], { topicFocus: "infection" }),
  caseItem("gi", "diverticulitis", "colon", ["CT"], { topicFocus: "infection" }),
  caseItem("gi", "small bowel obstruction", "small bowel", ["CT", "X-ray"]),
  caseItem("gi", "sigmoid volvulus", "colon", ["X-ray", "CT"]),
  caseItem("gi", "cecal volvulus", "colon", ["X-ray", "CT"]),
  caseItem("gi", "mesenteric ischemia", "bowel and mesenteric vessels", ["CT", "Angiography"], { topicFocus: "vascular" }),
  caseItem("gi", "Crohn disease", "small bowel", ["CT", "MRI", "Fluoroscopy"]),
  caseItem("gi", "ulcerative colitis", "colon", ["CT", "Fluoroscopy"]),
  caseItem("gi", "pancreatitis", "pancreas", ["CT", "MRI"]),
  caseItem("gi", "acute cholecystitis", "gallbladder", ["Ultrasound", "CT", "Nuclear Medicine"], { topicFocus: "infection" }),
  caseItem("gi", "choledocholithiasis", "bile ducts", ["Ultrasound", "MRI"]),
  caseItem("gi", "hepatocellular carcinoma", "liver", ["CT", "MRI"], { topicFocus: "tumor" }),
  caseItem("gi", "cirrhosis", "liver", ["Ultrasound", "CT", "MRI"]),
  caseItem("gi", "colonic carcinoma", "colon", ["CT", "Fluoroscopy"], { topicFocus: "tumor" }),

  caseItem("gu", "obstructing ureteric stone", "urinary tract", ["CT", "Ultrasound"]),
  caseItem("gu", "pyelonephritis", "kidney", ["CT", "Ultrasound"], { topicFocus: "infection" }),
  caseItem("gu", "renal abscess", "kidney", ["CT", "Ultrasound"], { topicFocus: "infection" }),
  caseItem("gu", "renal cell carcinoma", "kidney", ["CT", "MRI", "Ultrasound"], { topicFocus: "tumor" }),
  caseItem("gu", "renal angiomyolipoma", "kidney", ["CT", "MRI", "Ultrasound"], { topicFocus: "tumor" }),
  caseItem("gu", "bladder carcinoma", "bladder", ["CT", "MRI", "Ultrasound"], { topicFocus: "tumor" }),
  caseItem("gu", "prostate cancer", "prostate", ["MRI", "Nuclear Medicine"], { topicFocus: "tumor" }),
  caseItem("gu", "testicular torsion", "testis", ["Ultrasound"], { topicFocus: "vascular" }),
  caseItem("gu", "ovarian torsion", "adnexa", ["Ultrasound", "CT", "MRI"], { topicFocus: "vascular" }),
  caseItem("gu", "ectopic pregnancy", "pelvis", ["Ultrasound"], { ageGroup: "adult" }),
  caseItem("gu", "endometrial carcinoma", "uterus", ["MRI", "Ultrasound"], { topicFocus: "tumor" }),
  caseItem("gu", "placenta accreta spectrum", "placenta", ["Ultrasound", "MRI"], { topicFocus: "vascular" }),

  caseItem("msk", "osteomyelitis", "bone", ["MRI", "X-ray", "CT"], { topicFocus: "infection" }),
  caseItem("msk", "septic arthritis", "joint", ["MRI", "Ultrasound"], { topicFocus: "infection" }),
  caseItem("msk", "avascular necrosis", "hip", ["MRI", "X-ray"], { topicFocus: "vascular" }),
  caseItem("msk", "osteosarcoma", "bone", ["X-ray", "MRI"], { topicFocus: "tumor" }),
  caseItem("msk", "Ewing sarcoma", "bone", ["X-ray", "MRI"], { topicFocus: "tumor" }),
  caseItem("msk", "giant cell tumor", "bone", ["X-ray", "MRI"], { topicFocus: "tumor" }),
  caseItem("msk", "bone metastases", "bone", ["X-ray", "MRI", "Nuclear Medicine"], { topicFocus: "tumor" }),
  caseItem("msk", "rotator cuff tear", "shoulder", ["MRI", "Ultrasound"]),
  caseItem("msk", "ACL tear", "knee", ["MRI"]),
  caseItem("msk", "meniscal tear", "knee", ["MRI"]),
  caseItem("msk", "scaphoid fracture", "wrist", ["X-ray", "CT"], { topicFocus: "trauma" }),
  caseItem("msk", "slipped capital femoral epiphysis", "hip", ["X-ray"], { ageGroup: "pediatric" }),
  caseItem("msk", "ankylosing spondylitis", "spine", ["X-ray", "MRI"]),
  caseItem("msk", "rheumatoid arthritis", "hands", ["X-ray", "Ultrasound"]),

  caseItem("pediatric", "intussusception", "abdomen", ["Ultrasound", "Fluoroscopy"], { ageGroup: "pediatric" }),
  caseItem("pediatric", "malrotation with midgut volvulus", "upper GI tract", ["Fluoroscopy", "Ultrasound"], { ageGroup: "pediatric" }),
  caseItem("pediatric", "pyloric stenosis", "stomach", ["Ultrasound"], { ageGroup: "pediatric" }),
  caseItem("pediatric", "necrotizing enterocolitis", "abdomen", ["X-ray"], { ageGroup: "neonatal" }),
  caseItem("pediatric", "developmental dysplasia of the hip", "hip", ["Ultrasound", "X-ray"], { ageGroup: "pediatric" }),
  caseItem("pediatric", "Wilms tumor", "kidney", ["Ultrasound", "CT", "MRI"], { ageGroup: "pediatric", topicFocus: "tumor" }),
  caseItem("pediatric", "neuroblastoma", "abdomen", ["CT", "MRI", "Nuclear Medicine"], { ageGroup: "pediatric", topicFocus: "tumor" }),
  caseItem("pediatric", "medulloblastoma", "posterior fossa", ["MRI"], { ageGroup: "pediatric", topicFocus: "tumor" }),
  caseItem("pediatric", "retinoblastoma", "orbit", ["MRI", "Ultrasound"], { ageGroup: "pediatric", topicFocus: "tumor" }),
  caseItem("pediatric", "congenital diaphragmatic hernia", "chest and abdomen", ["X-ray", "CT"], { ageGroup: "neonatal", topicFocus: "congenital" }),
  caseItem("pediatric", "meconium ileus", "abdomen", ["X-ray", "Fluoroscopy"], { ageGroup: "neonatal" }),
  caseItem("pediatric", "biliary atresia", "hepatobiliary system", ["Ultrasound", "Nuclear Medicine"], { ageGroup: "pediatric" }),

  caseItem("breast", "invasive ductal carcinoma", "breast", ["Mammography", "Ultrasound", "MRI"], { topicFocus: "tumor" }),
  caseItem("breast", "ductal carcinoma in situ", "breast", ["Mammography", "MRI"], { topicFocus: "tumor" }),
  caseItem("breast", "fibroadenoma", "breast", ["Ultrasound", "Mammography"]),
  caseItem("breast", "simple breast cyst", "breast", ["Ultrasound", "Mammography"]),
  caseItem("breast", "fat necrosis", "breast", ["Mammography", "Ultrasound"]),
  caseItem("breast", "radial scar", "breast", ["Mammography", "MRI"]),
  caseItem("breast", "intraductal papilloma", "breast", ["Ultrasound", "MRI"]),
  caseItem("breast", "breast abscess", "breast", ["Ultrasound", "Mammography"], { topicFocus: "infection" }),

  caseItem("nuclear", "parathyroid adenoma", "neck", ["Nuclear Medicine", "Ultrasound"]),
  caseItem("nuclear", "bone metastases", "skeleton", ["Nuclear Medicine", "MRI"], { topicFocus: "tumor" }),
  caseItem("nuclear", "acute cholecystitis", "gallbladder", ["Nuclear Medicine", "Ultrasound"], { topicFocus: "infection" }),
  caseItem("nuclear", "renal obstruction", "urinary tract", ["Nuclear Medicine", "Ultrasound"]),
  caseItem("nuclear", "thyroid cancer metastases", "neck and chest", ["Nuclear Medicine", "Ultrasound"], { topicFocus: "tumor" }),
  caseItem("nuclear", "neuroendocrine tumor metastases", "abdomen", ["Nuclear Medicine", "CT"], { topicFocus: "tumor" }),

  caseItem("ultrasound", "deep vein thrombosis", "lower extremity veins", ["Ultrasound"], { topicFocus: "vascular" }),
  caseItem("ultrasound", "thyroid nodule", "thyroid", ["Ultrasound"], { topicFocus: "tumor" }),
  caseItem("ultrasound", "gallstones", "gallbladder", ["Ultrasound"]),
  caseItem("ultrasound", "ectopic pregnancy", "pelvis", ["Ultrasound"]),
  caseItem("ultrasound", "ovarian torsion", "adnexa", ["Ultrasound"], { topicFocus: "vascular" }),
  caseItem("ultrasound", "testicular torsion", "testis", ["Ultrasound"], { topicFocus: "vascular" }),
  caseItem("ultrasound", "hydronephrosis", "kidney", ["Ultrasound"]),
  caseItem("ultrasound", "appendicitis in children", "right lower quadrant", ["Ultrasound"], { ageGroup: "pediatric", topicFocus: "infection" }),

  caseItem("radiography_fluoroscopy", "achalasia", "esophagus", ["Fluoroscopy"]),
  caseItem("radiography_fluoroscopy", "esophageal carcinoma", "esophagus", ["Fluoroscopy", "CT"], { topicFocus: "tumor" }),
  caseItem("radiography_fluoroscopy", "malrotation", "upper GI tract", ["Fluoroscopy"], { ageGroup: "pediatric" }),
  caseItem("radiography_fluoroscopy", "small bowel obstruction", "abdomen", ["X-ray", "Fluoroscopy"]),
  caseItem("radiography_fluoroscopy", "aspiration", "swallowing study", ["Fluoroscopy"]),
  caseItem("radiography_fluoroscopy", "Hirschsprung disease", "colon", ["Fluoroscopy"], { ageGroup: "pediatric" }),

  caseItem("ir", "active arterial bleeding", "arteries", ["CT", "Angiography"], { topicFocus: "vascular" }),
  caseItem("ir", "pseudoaneurysm", "arteries", ["Ultrasound", "CT", "Angiography"], { topicFocus: "vascular" }),
  caseItem("ir", "portal hypertension", "portal venous system", ["Ultrasound", "CT", "Angiography"], { topicFocus: "vascular" }),
  caseItem("ir", "hepatocellular carcinoma", "liver", ["CT", "MRI", "Angiography"], { topicFocus: "tumor" }),
  caseItem("ir", "uterine fibroids", "uterus", ["MRI", "Ultrasound", "Angiography"]),
  caseItem("ir", "peripheral arterial disease", "lower extremity arteries", ["Ultrasound", "CT", "Angiography"], { topicFocus: "vascular" }),

  caseItem("ct", "adrenal adenoma", "adrenal gland", ["CT", "MRI"]),
  caseItem("ct", "adrenal hemorrhage", "adrenal gland", ["CT", "MRI"], { topicFocus: "trauma" }),
  caseItem("ct", "bowel perforation", "abdomen", ["CT", "X-ray"]),
  caseItem("ct", "splenic laceration", "spleen", ["CT"], { topicFocus: "trauma" }),
  caseItem("ct", "renal trauma", "kidney", ["CT"], { topicFocus: "trauma" }),
  caseItem("ct", "pulmonary embolism", "pulmonary arteries", ["CT"], { topicFocus: "vascular" }),

  caseItem("mr", "cholangiocarcinoma", "bile ducts", ["MRI", "CT"], { topicFocus: "tumor" }),
  caseItem("mr", "perianal fistula", "pelvis", ["MRI"]),
  caseItem("mr", "prostate cancer", "prostate", ["MRI"], { topicFocus: "tumor" }),
  caseItem("mr", "uterine fibroid degeneration", "uterus", ["MRI", "Ultrasound"]),
  caseItem("mr", "stress fracture", "bone", ["MRI", "X-ray"], { topicFocus: "trauma" }),
  caseItem("mr", "spinal epidural abscess", "spine", ["MRI"], { topicFocus: "infection" }),
];

function caseItem(domain, diagnosis, anatomy, modalities, options = {}) {
  return {
    domain,
    diagnosis,
    anatomy,
    modalities,
    ...options,
  };
}

export function normalizeCoreReviewCaseDomain(value) {
  const text = collapseWhitespace(value).toLowerCase();
  if (!text || ["general", "mixed", "all", "core", "core review"].includes(text)) {
    return "";
  }
  const normalized = normalizeCoreReviewDomain(text);
  return normalized && !NON_CASE_DOMAINS.has(normalized) ? normalized : "";
}

function normalizeCaseMix(value) {
  const text = collapseWhitespace(value).toLowerCase();
  if (["even", "even-domain", "even_domain", "balanced"].includes(text)) {
    return "even";
  }
  if (["focused", "focus", "domain", "single-domain", "single_domain"].includes(text)) {
    return "focused";
  }
  return "blueprint";
}

function normalizeModalityMix(value) {
  const text = collapseWhitespace(value).toLowerCase();
  if (["classic", "classic-modality", "classic_modality", "primary"].includes(text)) {
    return "classic";
  }
  if (["any", "none", "unfiltered"].includes(text)) {
    return "any";
  }
  return "mixed";
}

function boundedInteger(rawValue, defaultValue, minimum, maximum) {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

function stringArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value.split(/[;,]/);
  }
  return [];
}

function normalizeCaseBankItem(item, index, sourceId) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const domain = normalizeCoreReviewCaseDomain(item.domain || item.coreReviewDomain || item.section || "");
  const diagnosis = collapseWhitespace(item.diagnosis || item.name || item.query || item.title || "");
  if (!domain || !diagnosis) {
    return null;
  }

  const modalities = dedupe(
    stringArray(item.modalities || item.modality)
      .map((value) => collapseWhitespace(value))
      .filter(Boolean),
  );
  const systems = dedupe(
    stringArray(item.systems || item.searchSystems || DEFAULT_SYSTEMS_BY_DOMAIN[domain] || [])
      .map((value) => collapseWhitespace(value))
      .filter(Boolean),
  );
  const id = collapseWhitespace(item.id || `${sourceId}-${domain}-${slugify(diagnosis)}-${index + 1}`);

  return {
    id,
    sourceId,
    domain,
    diagnosis,
    searchQuery: collapseWhitespace(item.searchQuery || item.query || diagnosis),
    anatomy: collapseWhitespace(item.anatomy || item.region || ""),
    studyHint: collapseWhitespace(item.studyHint || ""),
    modalities,
    systems,
    ageGroup: collapseWhitespace(item.ageGroup || ""),
    topicFocus: collapseWhitespace(item.topicFocus || ""),
    difficulty: collapseWhitespace(item.difficulty || ""),
  };
}

function normalizeCaseBank(rawCases, sourceId) {
  const seen = new Set();
  const normalized = [];
  for (const [index, rawCase] of rawCases.entries()) {
    const item = normalizeCaseBankItem(rawCase, index, sourceId);
    if (!item) {
      continue;
    }
    let id = item.id;
    if (seen.has(id)) {
      id = `${id}-${index + 1}`;
    }
    seen.add(id);
    normalized.push({ ...item, id });
  }
  return normalized;
}

export async function loadCoreReviewCaseBank(caseBankPath = "") {
  const resolvedPath = collapseWhitespace(caseBankPath);
  if (!resolvedPath) {
    return {
      title: "Bundled CORE review diagnosis seed list",
      path: "",
      cases: normalizeCaseBank(DEFAULT_CORE_REVIEW_CASES, "bundled-core-case-bank"),
      sources: CORE_REVIEW_CASE_SOURCES,
    };
  }

  const raw = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
  const rawCases = Array.isArray(raw) ? raw : raw.cases || raw.diagnoses || [];
  if (!Array.isArray(rawCases)) {
    throw new Error("Core Review case bank JSON must be an array or contain a cases array.");
  }

  return {
    title: collapseWhitespace(raw.title || "Custom CORE review diagnosis list"),
    path: resolvedPath,
    cases: normalizeCaseBank(rawCases, "custom-core-case-bank"),
    sources: Array.isArray(raw.sources) ? raw.sources : [],
  };
}

function createSeededRandom(seed) {
  let state = 2166136261;
  const text = collapseWhitespace(seed || "core-review-case-plan");
  for (let index = 0; index < text.length; index += 1) {
    state ^= text.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, rng) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function groupByDomain(cases, rng) {
  const buckets = new Map();
  for (const item of cases) {
    if (!buckets.has(item.domain)) {
      buckets.set(item.domain, []);
    }
    buckets.get(item.domain).push(item);
  }
  for (const [domain, items] of buckets.entries()) {
    buckets.set(domain, shuffle(items, rng));
  }
  return buckets;
}

function buildDomainSequence(buckets, count, caseMix, focusDomain, rng) {
  const domains = CASE_DOMAIN_IDS.filter((domain) => buckets.has(domain));
  const usableCaseMix = focusDomain && caseMix === "focused" ? "focused" : caseMix;
  if (usableCaseMix === "focused" && buckets.has(focusDomain)) {
    return Array.from({ length: count }, () => focusDomain);
  }

  const weighted = [];
  for (const domain of domains) {
    const repeats = usableCaseMix === "even" ? 1 : Math.max(1, Math.round((DOMAIN_WEIGHTS[domain] || 0.5) * 10));
    for (let index = 0; index < repeats; index += 1) {
      weighted.push(domain);
    }
  }
  const shuffled = shuffle(weighted, rng);
  return Array.from({ length: count }, (_, index) => shuffled[index % shuffled.length]);
}

function nextCaseForDomain(domain, buckets, cursors, usedIds) {
  const items = buckets.get(domain) || [];
  if (!items.length) {
    return null;
  }

  const start = cursors.get(domain) || 0;
  for (let offset = 0; offset < items.length; offset += 1) {
    const cursor = start + offset;
    const item = items[cursor % items.length];
    if (!usedIds.has(item.id)) {
      cursors.set(domain, cursor + 1);
      return item;
    }
  }

  const item = items[start % items.length];
  cursors.set(domain, start + 1);
  return item;
}

function fallbackNextUnusedCase(buckets, cursors, usedIds) {
  for (const domain of CASE_DOMAIN_IDS) {
    const item = nextCaseForDomain(domain, buckets, cursors, usedIds);
    if (item && !usedIds.has(item.id)) {
      return item;
    }
  }
  return null;
}

function chooseModality(item, planIndex, modalityMix) {
  if (modalityMix === "any") {
    return "";
  }
  if (!item.modalities.length) {
    return "";
  }
  if (modalityMix === "classic") {
    return item.modalities[0];
  }
  return item.modalities[planIndex % item.modalities.length];
}

function buildStudyHint(item, modality) {
  if (item.studyHint) {
    return item.studyHint;
  }
  return collapseWhitespace([modality, item.anatomy].filter(Boolean).join(" "));
}

function requestFromCase(item, planIndex, options) {
  const modality = chooseModality(item, planIndex, options.modalityMix);
  const studyHint = buildStudyHint(item, modality);
  const rawInput = collapseWhitespace([item.searchQuery, studyHint].filter(Boolean).join(", "));
  return {
    requestId: `core-review-${planIndex + 1}`,
    requestMode: "specific",
    rawInput,
    diagnosis: item.searchQuery,
    modality,
    anatomy: item.anatomy,
    studyHint,
    searchSystems: item.systems,
    ageGroup: item.ageGroup,
    topicFocus: item.topicFocus,
    difficulty: item.difficulty,
    requestedImagesPerCase: options.imagesPerCase,
    includeClinicalHistory: options.useClinicalHistory,
    useOllamaAssist: options.useOllamaAssist,
    ollamaModel: options.ollamaModel,
    allowAlternateModality: options.allowAlternateModality,
    coreReviewPlan: {
      planIndex: planIndex + 1,
      sourceId: item.sourceId,
      seedCaseId: item.id,
      domain: item.domain,
      caseMix: options.caseMix,
      modalityMix: options.modalityMix,
      anatomyPrompt: item.anatomy,
    },
  };
}

function buildSummary(entries, requestedCaseCount, domain, caseMix, modalityMix) {
  const labelByDomain = new Map(CORE_REVIEW_DOMAINS.map((item) => [item.id, item.label]));
  const domainLabel = domain ? labelByDomain.get(domain) || domain : "mixed CORE domains";
  const countText =
    entries.length === requestedCaseCount
      ? `${entries.length} planned case request(s)`
      : `${requestedCaseCount} requested case(s), ${entries.length} candidate request(s)`;
  return `${countText}, ${domainLabel}, ${caseMix} case mix, ${modalityMix} modality hints`;
}

export async function buildCoreReviewCasePlan(args = {}) {
  const caseCount = boundedInteger(args.caseCount || args.count, 50, 1, 150);
  const candidateCaseCount = boundedInteger(
    args.candidateCaseCount || args.planningCaseCount || caseCount,
    caseCount,
    caseCount,
    300,
  );
  const domain = normalizeCoreReviewCaseDomain(args.domain || args.coreReviewDomain || "");
  const caseMix = normalizeCaseMix(args.caseMix || args.mix || "");
  const modalityMix = normalizeModalityMix(args.modalityMix || "");
  const seed = collapseWhitespace(args.seed || `${domain || "mixed"}|${caseMix}|${modalityMix}|${caseCount}`);
  const rng = createSeededRandom(seed);
  const caseBank = await loadCoreReviewCaseBank(args.caseBankPath || "");
  const cases = caseBank.cases.filter((item) => !domain || caseMix !== "focused" || item.domain === domain);
  if (!cases.length) {
    throw new Error("No CORE review case-bank entries matched the requested settings.");
  }

  const buckets = groupByDomain(cases, rng);
  const domainSequence = buildDomainSequence(buckets, candidateCaseCount, caseMix, domain, rng);
  const cursors = new Map();
  const usedIds = new Set();
  const selected = [];

  for (const nextDomain of domainSequence) {
    let item = nextCaseForDomain(nextDomain, buckets, cursors, usedIds);
    if (item && usedIds.has(item.id)) {
      item = fallbackNextUnusedCase(buckets, cursors, usedIds) || item;
    }
    if (!item) {
      continue;
    }
    selected.push(item);
    usedIds.add(item.id);
  }

  const options = {
    imagesPerCase: boundedInteger(args.imagesPerCase, 3, 1, 8),
    useClinicalHistory: Boolean(args.useClinicalHistory),
    useOllamaAssist: Boolean(args.useOllamaAssist),
    ollamaModel: collapseWhitespace(args.ollamaModel || ""),
    caseMix,
    modalityMix,
    allowAlternateModality: args.allowAlternateModality !== false,
  };
  const entries = selected.map((item, index) => requestFromCase(item, index, options));

  return {
    version: 1,
    deckMode: "core-review",
    requestedCaseCount: caseCount,
    plannedCaseCount: entries.length,
    domain: domain || "",
    caseMix,
    modalityMix,
    seed,
    caseBankTitle: caseBank.title,
    caseBankPath: caseBank.path,
    sources: [...CORE_REVIEW_CASE_SOURCES, ...(caseBank.sources || [])],
    summary: buildSummary(entries, caseCount, domain, caseMix, modalityMix),
    entries,
  };
}
