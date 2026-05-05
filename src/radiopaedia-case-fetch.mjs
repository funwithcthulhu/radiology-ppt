import path from "node:path";
import {
  cleanText,
  collapseWhitespace,
  dedupe,
  slugify,
  truncate,
} from "./utils.mjs";
import {
  buildImageCandidates,
  evaluateSelectedImages,
  imageCandidateCacheKey,
  normalizeImageCandidateBank,
  selectRelevantImages,
} from "./image-candidates.mjs";
import { maybeScoreSelectedImagesWithOllama } from "./ollama-review.mjs";
import { readCacheEntry, writeCacheEntry } from "./cache-store.mjs";
import { readRejectedFrameIds } from "./app-store.mjs";
import { emitProgress } from "./backend-events.mjs";
import {
  BASE_URL,
  absoluteUrl,
  downloadFile,
  fetchJson,
  fetchText,
} from "./providers/radiopaedia-provider.mjs";
import {
  buildClinicalHistoryText,
  buildPromptText,
  buildTeachingPoints,
  extractPatientData,
} from "./radiopaedia-case-text.mjs";

const CANDIDATE_BANK_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function extractFirst(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : null;
}

function licenseNameFromUrl(url) {
  if (!url) {
    return "Unknown license";
  }
  if (url.includes("by-nc-sa/4.0")) {
    return "CC BY-NC-SA 4.0";
  }
  if (url.includes("by-nc-sa/3.0")) {
    return "CC BY-NC-SA 3.0";
  }
  if (url.includes("by-sa/")) {
    return "CC BY-SA";
  }
  if (url.includes("creativecommons.org")) {
    return "Creative Commons";
  }
  return url;
}

async function fetchStudy(studyId, caseUrl) {
  emitProgress("Loading Radiopaedia study", { studyId });
  const studyUrl = `${BASE_URL}/studies/${studyId}/annotated_viewer_json?lang=us&only_findings=true`;
  const payload = await fetchJson(studyUrl, {
    referer: caseUrl,
  });

  return payload.study;
}

function createFooterText(caseData) {
  const parts = [
    "Radiopaedia",
    caseData.rid,
    caseData.author,
    caseData.licenseName,
    caseData.displayUrl,
  ].filter(Boolean);

  return parts.join(" • ");
}

function orderStudiesByPreference(studies, preferredModalities) {
  if (!preferredModalities.length) {
    return studies;
  }

  const matching = studies.filter((study) => preferredModalities.includes(study.modality));
  const other = studies.filter((study) => !preferredModalities.includes(study.modality));
  return matching.length ? matching.concat(other) : studies;
}

function validateCasePage({ request, caseTitle, rid, studyIds, description }) {
  const hasRealRid = /^rID-\d+$/i.test(rid);
  const hasStudies = studyIds.length > 0;
  if (hasRealRid && hasStudies) {
    return;
  }

  const requested = request.selectedCasePath || request.rawInput;
  throw new Error(
    `Could not validate "${requested}" as a real public Radiopaedia case with image studies. Check the URL, or pick the case again from search results.`,
  );
}

export async function fetchRadiopaediaCaseByPath(
  request,
  casePath,
  { cacheDir, imagesPerCase = 3, caseTitleHint = "" },
) {
  emitProgress("Loading Radiopaedia case", { casePath, request: request.rawInput });
  const caseUrl = absoluteUrl(casePath.includes("?") ? casePath : `${casePath}?lang=us`);
  const html = await fetchText(caseUrl);
  const displayUrl = (() => {
    const parsed = new URL(caseUrl);
    return `${parsed.host}${parsed.pathname}`;
  })();

  const caseTitle =
    cleanText(extractFirst(/<title>(.*?)\s+\|\s+Radiology Case\s+\|\s+Radiopaedia\.org<\/title>/i, html)) ||
    cleanText(caseTitleHint) ||
    request.diagnosis;
  const author = cleanText(extractFirst(/<meta\s+name="author"\s+content="([^"]+)"/i, html));
  const licenseUrl = extractFirst(/<link\s+rel="license"[^>]+href="([^"]+)"/i, html);
  const licenseName = licenseNameFromUrl(licenseUrl);
  const description = cleanText(
    extractFirst(/<meta\s+property="og:description"\s+content="([^"]+)"/i, html),
  );
  const patientData = extractPatientData(html);
  const ridMatch = extractFirst(/<meta\s+name='dc\.identifier'\s+content='[^']*(rID-\d+)'/i, html);
  const rid = ridMatch || "rID unavailable";
  const studyIds = dedupe([...html.matchAll(/\/studies\/(\d+)/g)].map((match) => match[1]));
  const caseSlug = slugify(caseTitle) || slugify(request.rawInput) || "radiopaedia-case";

  validateCasePage({ request, caseTitle, rid, studyIds, description });

  const studies = [];
  for (const studyId of studyIds.slice(0, 8)) {
    try {
      studies.push(await fetchStudy(studyId, caseUrl));
    } catch (error) {
      console.warn(`Warning: unable to load study ${studyId} for ${caseTitle}: ${error.message}`);
    }
  }

  const orderedStudies = orderStudiesByPreference(studies, request.preferredModalities);
  const preferredStudies = request.preferredModalities.length
    ? orderedStudies.filter((study) => request.preferredModalities.includes(study.modality))
    : orderedStudies;
  if (request.preferredModalities.length && !preferredStudies.length) {
    throw new Error(`No ${request.preferredModalities.join("/")} studies were found for "${caseTitle}".`);
  }

  const requestCandidateBank = normalizeImageCandidateBank(request.imageCandidateBank);
  const candidateCacheKey = imageCandidateCacheKey(casePath, request.preferredModalities);
  const cachedCandidateBank = requestCandidateBank.length
    ? []
    : normalizeImageCandidateBank(
        await readCacheEntry("image-candidates", candidateCacheKey, { ttlMs: CANDIDATE_BANK_CACHE_TTL_MS }),
      );
  let imageCandidates = cachedCandidateBank;
  if (!imageCandidates.length) {
    for (const study of preferredStudies) {
      imageCandidates.push(...buildImageCandidates(study));
    }
  }
  if (requestCandidateBank.length) {
    imageCandidates = requestCandidateBank;
  }

  const fallbackOgImage = extractFirst(/<meta\s+property="og:image"\s+content="([^"]+)"/i, html);
  if (!imageCandidates.length && fallbackOgImage) {
    imageCandidates.push({
      url: fallbackOgImage,
      label: "Key image",
      studyId: null,
      seriesId: null,
      modality: orderedStudies[0]?.modality ?? null,
    });
  }

  if (!imageCandidates.length) {
    throw new Error(`No usable images were found for "${caseTitle}".`);
  }

  const imageCandidateBank = normalizeImageCandidateBank(imageCandidates);
  if (imageCandidateBank.length && !requestCandidateBank.length && !cachedCandidateBank.length) {
    await writeCacheEntry("image-candidates", candidateCacheKey, imageCandidateBank);
  }
  const selectedImages = selectRelevantImages(imageCandidates, Math.max(1, imagesPerCase), {
    excludeFrameIds: dedupe([
      ...(request.excludeFrameIds || []),
      ...((request.includeFrameIds || []).length ? [] : await readRejectedFrameIds(casePath)),
    ]),
    includeFrameIds: request.includeFrameIds || [],
  });
  emitProgress("Selected case images", {
    caseTitle,
    selectedCount: selectedImages.length,
    candidateCount: imageCandidateBank.length,
  });
  const imageDir = path.join(cacheDir, "images", caseSlug);
  const images = [];

  for (let index = 0; index < selectedImages.length; index += 1) {
    const image = selectedImages[index];
    const parsedUrl = new URL(image.url);
    const extension = path.extname(parsedUrl.pathname) || ".jpg";
    const localPath = path.join(
      imageDir,
      `${String(index + 1).padStart(2, "0")}-${image.frameId}${extension}`,
    );

    await downloadFile(image.url, localPath);
    emitProgress("Downloaded case image", { caseTitle, frameId: image.frameId, index: index + 1 });
    images.push({
      ...image,
      localPath,
    });
  }

  await maybeScoreSelectedImagesWithOllama(images, request, caseTitle);
  const quality = evaluateSelectedImages(images, Math.max(1, imagesPerCase), request.difficulty);

  const findings = orderedStudies.map((study) => study.findings).find(Boolean) || "";
  const revealSummary = truncate(cleanText(findings || description), 440);
  const effectiveDiagnosis = request.originalInput ? caseTitle : request.diagnosis;
  const effectiveRawInput = request.originalInput
    ? collapseWhitespace([caseTitle, request.studyHint].filter(Boolean).join(", "))
    : request.rawInput;
  const promptText = buildPromptText(findings || description, effectiveDiagnosis, caseTitle);
  const modalitySummary = dedupe(orderedStudies.map((study) => study.modality).filter(Boolean)).join(", ") || "Unknown";
  const caseIntro = buildClinicalHistoryText({
    request,
    patientData,
  });
  const teachingPoints = buildTeachingPoints({
    request,
    description,
    findings,
    diagnosis: effectiveDiagnosis,
    caseTitle,
    modalitySummary,
    images,
  });

  return {
    casePath: casePath.includes("?") ? casePath : `${casePath}?lang=us`,
    rawInput: effectiveRawInput,
    originalInput: request.originalInput || null,
    requestId: request.requestId || null,
    diagnosisQuery: effectiveDiagnosis,
    studyHint: request.studyHint,
    coreReviewPlan: request.coreReviewPlan || null,
    caseTitle,
    caseUrl,
    author,
    licenseUrl,
    licenseName,
    rid,
    description,
    promptText,
    revealSummary: revealSummary || "Diagnosis sourced from the linked Radiopaedia case.",
    footerText: createFooterText({
      author,
      displayUrl,
      licenseName,
      rid,
    }),
    displayUrl,
    modalitySummary,
    studyCount: orderedStudies.length,
    patientData,
    caseIntro,
    teachingPoints,
    quality,
    images,
    imageCandidateBank,
  };
}
