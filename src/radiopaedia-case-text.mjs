import { cleanText, collapseWhitespace, redactTerms, truncate } from "./utils.mjs";
import { normalizePhrase, normalizedDifficulty } from "./request-parser.mjs";

const RADIOLOGY_TEACHING_PATTERN =
  /\b(?:ct|mri|mr\b|x-?ray|radiograph|ultrasound|sonograph|fluoro|pet|spect|nuclear|mammograph|angiograph|t1|t2|flair|dwi|adc|diffusion|enhanc|attenuat|density|signal|hyperintense|hypointense|calcif|restricted|rim|mass|lesion|tract|fistula|abscess|opening|sphincter|secondary|branch|extension|compartment|origin|margin|edema|fat|fluid|cystic|solid|obstruction|perforation|ischemia|hemorrhage|infarct|thrombosis|filling defect|classification|staging|report|differential|mimic|complication)\b/i;
const LOW_VALUE_TEACHING_PATTERN =
  /\b(?:surgically proved|pathologically proved|biopsy proved|histologically proved|this case is best reviewed|focus on the|teaching example|selected images?|patient presented|clinical history|diagnosed with|improved|improving|worsened|worsening|unchanged|interval|follow-?up|post(?:operative|op)?|post resection|status post|after resection|prior resection|treated with|underwent|re-demonstrat(?:ed|es)|again seen)\b/i;

const CORE_REVIEW_PEARL_GROUPS = [
  {
    patterns: [/\bperianal\b/i, /\bfistula(?:-in-ano)?\b/i, /\banal fistula\b/i],
    points: [
      "MRI CORE discriminator: classify the tract by sphincter relationship: intersphincteric, transsphincteric, suprasphincteric, or extrasphincteric.",
      "Report the internal opening, external sphincter involvement, abscess, horseshoe extension, and secondary tracts because these change operative planning.",
      "Active fistula usually appears T2/STIR hyperintense with enhancement; simple scar or treated tract is less T2 bright and should not be overcalled as active disease.",
    ],
  },
  {
    patterns: [/\brotator cuff\b/i, /\bsupraspinatus\b/i, /\bsubscapularis\b/i, /\bshoulder\b/i],
    points: [
      "MRI/US CORE discriminator: a full-thickness cuff tear has fluid-signal communication from articular to bursal surface.",
      "Report tendon involved, tear size, retraction, muscle atrophy, and fatty infiltration because these determine repairability.",
      "Common mimics include tendinosis, partial-thickness tear, calcific tendinopathy, and subacromial-subdeltoid bursitis.",
    ],
  },
  {
    patterns: [/\bureter(?:ic|al)? stone\b/i, /\burolithiasis\b/i, /\bobstructing.*stone\b/i, /\bhydronephrosis\b/i],
    points: [
      "CT CORE discriminator: identify the obstructing calculus and the level of obstruction; secondary signs include hydronephrosis, hydroureter, and periureteric stranding.",
      "Report infected obstruction red flags such as fever context, pyonephrosis, gas, or marked inflammatory change because urgent decompression may be needed.",
      "Mimics include phleboliths, papillary necrosis, ureteral stricture, and upper tract urothelial carcinoma.",
    ],
  },
  {
    patterns: [/\bpulmonary embol/i, /\bpulmonary arteries?\b/i],
    points: [
      "CTA CORE discriminator: acute PE is an intraluminal pulmonary arterial filling defect, often central or eccentric within contrast-opacified blood.",
      "Always assess right heart strain: RV/LV ratio, septal bowing, reflux into hepatic veins, and pulmonary artery enlargement.",
      "Mimics include respiratory motion, streak artifact, flow-related mixing artifact, pulmonary vein thrombus, and lymph nodes adjacent to arteries.",
    ],
  },
  {
    patterns: [/\bvestibular schwannoma\b/i, /\bacoustic neuroma\b/i, /\binternal auditory canal\b/i, /\bcpa\b/i],
    points: [
      "MRI CORE discriminator: vestibular schwannoma typically enhances and expands the internal auditory canal with a CPA cisternal component.",
      "Key differential is CPA meningioma, which more often has a broad dural base, dural tail, calcification, or hyperostosis.",
      "Report extension to the fundus, cochlear aperture/labyrinth involvement, brainstem mass effect, and hydrocephalus.",
    ],
  },
  {
    patterns: [/\bchiari\b/i, /\bcerebellar tonsil/i, /\bforamen magnum\b/i],
    points: [
      "MRI CORE discriminator: Chiari I is tonsillar descent with crowding at the foramen magnum; measure descent but emphasize CSF effacement and morphology.",
      "Look for associated syringohydromyelia and craniocervical junction abnormalities because they alter management.",
      "Important mimics include intracranial hypotension, tonsillar ectopia without crowding, and mass-related downward herniation.",
    ],
  },
  {
    patterns: [/\bacute ischemic stroke\b/i, /\binfarct\b/i, /\bischemic stroke\b/i],
    points: [
      "CORE discriminator: restricted diffusion with low ADC confirms acute infarct; match the pattern to an arterial territory or embolic distribution.",
      "On CT/CTA, report hemorrhage exclusion, large-vessel occlusion, ASPECTS/early ischemic change, and salvageable tissue when perfusion is available.",
      "Mimics include seizure-related diffusion change, hypoglycemia, encephalitis, migraine, and demyelination.",
    ],
  },
  {
    patterns: [/\bsubdural\b/i, /\bsubdural hematoma\b/i, /\bsubdural haematoma\b/i, /\bextra-axial hemorrhage\b/i],
    points: [
      "CT CORE discriminator: subdural hematoma is crescentic extra-axial blood that can cross sutures but is limited by dural reflections.",
      "Report acute versus chronic density, maximal thickness, midline shift, herniation, and sulcal or ventricular effacement because these drive urgency.",
      "Key mimics include epidural hematoma, subdural hygroma, prominent CSF spaces from atrophy, and empyema when diffusion restriction or infection is present.",
    ],
  },
  {
    patterns: [/\bappendicitis\b/i, /\bright lower quadrant\b/i, /\brlq\b/i],
    points: [
      "CT/US CORE discriminator: appendiceal dilation with wall thickening, hyperemia/enhancement, periappendiceal inflammation, or appendicolith supports appendicitis.",
      "Report perforation signs: abscess, extraluminal gas, phlegmon, or diffuse peritonitis.",
      "Mimics include terminal ileitis, epiploic appendagitis, cecal diverticulitis, mesenteric adenitis, and ovarian pathology.",
    ],
  },
  {
    patterns: [/\bcholecystitis\b/i, /\bcholedocholithiasis\b/i, /\bgallstones?\b/i, /\bbile duct\b/i],
    points: [
      "Ultrasound CORE discriminator for acute cholecystitis: stones plus wall thickening, distention, pericholecystic fluid, and sonographic Murphy sign.",
      "For biliary obstruction, localize intrahepatic versus extrahepatic ductal dilation and look for choledocholithiasis or obstructing mass.",
      "HIDA is most useful when ultrasound is equivocal; nonvisualization of the gallbladder supports cystic duct obstruction.",
    ],
  },
  {
    patterns: [/\bovarian torsion\b/i, /\badnexa/i, /\bectopic pregnancy\b/i],
    points: [
      "Ultrasound CORE discriminator for torsion: enlarged edematous ovary, peripheral follicles, twisted pedicle, and abnormal or asymmetric Doppler flow.",
      "Normal Doppler flow does not exclude torsion because dual ovarian blood supply can preserve arterial flow.",
      "Mimics include hemorrhagic cyst, tubo-ovarian abscess, endometrioma, and ectopic pregnancy.",
    ],
  },
  {
    patterns: [/\brenal cell carcinoma\b/i, /\bangiomyolipoma\b/i, /\brenal mass\b/i],
    points: [
      "Renal mass CORE discriminator: macroscopic fat strongly suggests angiomyolipoma, while enhancing solid renal mass is RCC until proven otherwise.",
      "Report enhancement, venous invasion, collecting-system involvement, perinephric extension, nodes, and metastases for staging.",
      "Mimics include lipid-poor angiomyolipoma, oncocytoma, renal abscess, lymphoma, and urothelial carcinoma.",
    ],
  },
  {
    patterns: [/\bosteosarcoma\b/i, /\bewing\b/i, /\bgiant cell tumor\b/i, /\bbone metastases\b/i],
    points: [
      "Bone tumor CORE approach: localize by patient age, bone, epiphyseal/metaphyseal/diaphyseal location, matrix, zone of transition, and periosteal reaction.",
      "MRI defines marrow and soft-tissue extent; radiographs remain the board-relevant first discriminator for matrix and aggressiveness.",
      "Do not miss infection and stress injury as tumor mimics, especially when marrow edema is disproportionate to a subtle cortical finding.",
    ],
  },
  {
    patterns: [/\bintussusception\b/i, /\bmalrotation\b/i, /\bmidgut volvulus\b/i, /\bpyloric stenosis\b/i],
    points: [
      "Pediatric abdomen CORE approach: know the age-specific diagnosis and first-line modality: ultrasound for intussusception/pyloric stenosis, upper GI for malrotation.",
      "For malrotation with volvulus, the board-critical finding is abnormal duodenojejunal junction position or corkscrew duodenum; do not rely only on SMA/SMV orientation.",
      "For intussusception, report lead point suspicion, obstruction, free fluid, or ischemia because these affect reduction safety.",
    ],
  },
];

function extractFirst(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

export function extractPatientData(html) {
  const text = cleanText(html);
  const patientSection = extractFirst(
    /\bPatient Data\b(.*?)(?:\bFrom the case:|\bCase Discussion\b|\bDiscussion\b|\bFindings\b|\bImaging\b|$)/i,
    text,
  ) || "";
  const source = patientSection || text;
  const age = cleanText(extractFirst(/\bAge:\s*(.*?)(?=\s+(?:Gender|Sex):|$)/i, source));
  const gender = cleanText(extractFirst(/\b(?:Gender|Sex):\s*(.*?)(?=\s+(?:From the case:|Case Discussion|Discussion|Findings|Imaging|CT|MRI|X-ray|Ultrasound|Fluoroscopy|PET|$))/i, source));
  return {
    age: scrubPatientDataValue(age),
    gender: scrubPatientDataValue(gender),
  };
}

function scrubPatientDataValue(value) {
  return collapseWhitespace(value)
    .replace(/\b(?:Presentation|From the case:|Case Discussion|Discussion|Findings|Imaging)\b.*$/i, "")
    .replace(/[.;:,]+$/g, "")
    .trim();
}

function formatPatientAgeForIntro(age) {
  const text = scrubPatientDataValue(age);
  if (!text) {
    return "";
  }

  const numericOnly = /^(\d+(?:\.\d+)?)$/.exec(text);
  if (numericOnly) {
    return `${numericOnly[1]}-year-old`;
  }

  const unitMatch = /^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|weeks?|wks?|w|days?|d)(?:\s*old)?$/i.exec(text);
  if (unitMatch) {
    const unitMap = {
      y: "year",
      yr: "year",
      yrs: "year",
      year: "year",
      years: "year",
      m: "month",
      mo: "month",
      mos: "month",
      month: "month",
      months: "month",
      w: "week",
      wk: "week",
      wks: "week",
      week: "week",
      weeks: "week",
      d: "day",
      day: "day",
      days: "day",
    };
    const unit = unitMap[unitMatch[2].toLowerCase()] || unitMatch[2].toLowerCase();
    return `${unitMatch[1]}-${unit}-old`;
  }

  if (/^(adult|pediatric|paediatric|neonatal|infant|child|adolescent|elderly)$/i.test(text)) {
    return text.toLowerCase().replace("paediatric", "pediatric");
  }

  return text;
}

function formatPatientGenderForIntro(gender) {
  const text = scrubPatientDataValue(gender).toLowerCase();
  if (!text) {
    return "";
  }
  if (/^m(?:ale)?$/.test(text)) {
    return "male";
  }
  if (/^f(?:emale)?$/.test(text)) {
    return "female";
  }
  return text;
}

function articleForPhrase(phrase) {
  return /^(?:8|11|18|adult|elderly|infant|adolescent|[aeiou])/i.test(phrase) ? "an" : "a";
}

function buildDemographicIntro(patientData) {
  const age = formatPatientAgeForIntro(patientData?.age);
  const gender = formatPatientGenderForIntro(patientData?.gender);

  if (age && gender) {
    return `The patient is ${articleForPhrase(age)} ${age} ${gender}.`;
  }
  if (age) {
    return `The patient is ${articleForPhrase(age)} ${age} patient.`;
  }
  if (gender) {
    return `The patient is ${gender}.`;
  }
  return "";
}

export function buildClinicalHistoryText({ request, patientData }) {
  if (!request.includeClinicalHistory) {
    return "";
  }
  if (normalizedDifficulty(request.difficulty) === "hard") {
    return "";
  }

  return buildDemographicIntro(patientData);
}

function cleanRedactedTeachingText(text) {
  return cleanText(text)
    .replace(/\[[^\]]*hidden[^\]]*\]/gi, " ")
    .replace(/\bcase of\s+(?:acute|chronic|typical|classic)\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "case ")
    .replace(/\bcase of\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "case ")
    .replace(/\btypical\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "typical presentation ")
    .replace(/\bconsistent\s+(?=with\b|without\b|in\b|on\b|for\b|$)/gi, "consistent appearance ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[,.;:\-\s]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function sentenceSafeTrim(text, maxLength = 220) {
  const clean = collapseWhitespace(text);
  if (clean.length <= maxLength) {
    return clean;
  }

  const withoutTerminal = clean.replace(/[.!?]+$/u, "");
  const boundary = withoutTerminal.lastIndexOf(" ", maxLength - 1);
  const cutAt = boundary >= Math.floor(maxLength * 0.6) ? boundary : maxLength - 1;
  return withoutTerminal.slice(0, cutAt).trim();
}

function normalizeTeachingPoint(sentence) {
  return sentenceSafeTrim(cleanRedactedTeachingText(sentence))
    .replace(/(?:\.\.\.|…)+$/g, "")
    .replace(/[;:,]+$/g, ".")
    .replace(/(?<![.!?])$/u, ".")
    .trim();
}

function sourceSentences(...values) {
  return values
    .filter(Boolean)
    .flatMap((text) => cleanText(text).split(/(?<=[.!?])\s+/))
    .map(collapseWhitespace)
    .filter(Boolean);
}

function isCoreReviewRequest(request) {
  return Boolean(request?.coreReviewPlan || request?.deckMode === "core-review");
}

function diagnosisSearchText({ diagnosis, caseTitle, request, modalitySummary }) {
  return [
    diagnosis,
    caseTitle,
    request?.diagnosis,
    request?.rawInput,
    request?.studyHint,
    request?.coreReviewPlan?.domain,
    request?.coreReviewPlan?.anatomyPrompt,
    modalitySummary,
  ]
    .filter(Boolean)
    .join(" ");
}

function curatedCoreReviewPearls(context) {
  const text = diagnosisSearchText(context);
  for (const group of CORE_REVIEW_PEARL_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(text))) {
      return group.points;
    }
  }
  return [];
}

function isRadiologySpecificTeachingPoint(point) {
  return RADIOLOGY_TEACHING_PATTERN.test(point) && !LOW_VALUE_TEACHING_PATTERN.test(point);
}

function addUniqueTeachingPoint(points, seen, point) {
  const normalized = normalizeTeachingPoint(point);
  const key = normalizePhrase(normalized);
  if (!normalized || normalized.length < 18 || seen.has(key)) {
    return;
  }
  seen.add(key);
  points.push(normalized);
}

function buildCoreReviewTeachingPoints(context) {
  const bullets = [];
  const seen = new Set();

  for (const pearl of curatedCoreReviewPearls(context)) {
    addUniqueTeachingPoint(bullets, seen, pearl);
    if (bullets.length >= 3) {
      return bullets;
    }
  }

  for (const sentence of sourceSentences(context.findings, context.description)) {
    const bullet = normalizeTeachingPoint(redactTerms(sentence, [context.diagnosis, context.caseTitle]));
    if (!isRadiologySpecificTeachingPoint(bullet)) {
      continue;
    }
    addUniqueTeachingPoint(bullets, seen, bullet);
    if (bullets.length >= 3) {
      break;
    }
  }

  return bullets.slice(0, 3);
}

export function buildTeachingPoints({ request, description, findings, diagnosis, caseTitle, modalitySummary, images }) {
  if (isCoreReviewRequest(request)) {
    return buildCoreReviewTeachingPoints({
      request,
      description,
      findings,
      diagnosis,
      caseTitle,
      modalitySummary,
      images,
    });
  }

  const bullets = [];
  const seen = new Set();

  for (const sentence of sourceSentences(findings, description)) {
    const bullet = normalizeTeachingPoint(redactTerms(sentence, [diagnosis, caseTitle]));
    const key = normalizePhrase(bullet);
    if (!bullet || bullet.length < 18 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    bullets.push(bullet);
    if (bullets.length >= 3) {
      break;
    }
  }

  if (bullets.length < 2 && request.studyHint) {
    const studyBullet = `Focus on the ${request.studyHint} images where the abnormality is most conspicuous.`;
    const key = normalizePhrase(studyBullet);
    if (!seen.has(key)) {
      seen.add(key);
      bullets.push(studyBullet);
    }
  }

  if (bullets.length < 3 && modalitySummary) {
    const modalityBullet = `This case is best reviewed as a ${modalitySummary} teaching example with ${images.length} selected image${images.length === 1 ? "" : "s"}.`;
    const key = normalizePhrase(modalityBullet);
    if (!seen.has(key)) {
      seen.add(key);
      bullets.push(modalityBullet);
    }
  }

  return bullets.slice(0, 3);
}

export function buildPromptText(rawText, diagnosis, caseTitle) {
  const cleaned = cleanText(rawText);
  if (!cleaned) {
    return "Review the images on the next slide and identify the most likely diagnosis.";
  }

  const redacted = redactTerms(cleaned, [diagnosis, caseTitle]);
  if (!redacted || redacted === cleaned || redacted.length < 50) {
    return "Review the images on the next slide and identify the most likely diagnosis.";
  }

  return truncate(redacted, 430);
}
