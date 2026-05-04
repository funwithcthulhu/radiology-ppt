import { collapseWhitespace, dedupe } from "./utils.mjs";
import { IMAGE_BASE_URL } from "./radiopaedia-client.mjs";
import { normalizedDifficulty } from "./request-parser.mjs";

export function buildImageCandidates(study) {
  const candidates = [];
  const studyHasAnnotations = (study.series ?? []).some((series) => {
    const frames = series.frames ?? [];
    return extractSeriesAnnotationIndices(series, frames.length).length > 0;
  });

  for (const series of study.series ?? []) {
    const files = series.encodings?.thumbnailed_files ?? [];
    const frames = series.frames ?? [];
    const usableLength = Math.min(files.length, frames.length);

    if (!usableLength) {
      continue;
    }

    const currentIndex = Math.max(0, frames.findIndex((frame) => frame?.current));
    const keyImageIndex = frames.findIndex((frame) => frame?.id === study.case_key_image_id);
    const annotationIndices = extractSeriesAnnotationIndices(series, usableLength);
    const candidateIndices = buildRelevantFrameIndices({
      usableLength,
      currentIndex,
      keyImageIndex,
      annotationIndices,
      studyHasAnnotations,
    });

    for (const index of candidateIndices) {
      const frame = frames[index];
      const file = files[index];
      const fileName = file?.original ?? file?.small ?? file?.thumb;

      if (!frame?.id || !fileName) {
        continue;
      }

      const annotationDistance = nearestDistance(index, annotationIndices);
      const isAnnotated = annotationIndices.includes(index);
      const isKeyImage = Number.isInteger(keyImageIndex) && index === keyImageIndex;
      const isCurrent = index === currentIndex;
      const focusPoints = extractFrameFocusPoints(series, index);
      const relevance = computeFrameRelevanceAudit({
        index,
        currentIndex,
        keyImageIndex,
        annotationIndices,
        annotationDistance,
        studyHasAnnotations,
      });
      candidates.push({
        url: `${IMAGE_BASE_URL}/${frame.id}/${fileName}`,
        label: [study.modality, series.specifics, series.perspective].filter(Boolean).join(" • "),
        studyId: study.id,
        seriesId: series.series_id,
        modality: study.modality,
        frameId: frame.id,
        sliceIndex: index,
        viewSignature: [series.specifics, series.perspective].filter(Boolean).join(" • "),
        annotationDistance,
        hasSeriesAnnotations: annotationIndices.length > 0,
        isAnnotated,
        isKeyImage,
        isCurrent,
        focusPoints,
        frameWidth: frame.width,
        frameHeight: frame.height,
        relevantScore: relevance.score,
        audit: {
          provider: "radiopaedia",
          candidateSource: relevance.candidateSource,
          scoreComponents: relevance.components,
          reasons: relevance.reasons,
          studyHasAnnotations,
          annotationDistance,
        },
      });
    }
  }

  return dedupe(candidates.map((candidate) => JSON.stringify(candidate))).map((value) => JSON.parse(value));
}

function extractFrameFocusPoints(series, frameIndex) {
  const points = [];

  for (const annotation of series.annotations ?? []) {
    const arrowPoints = (annotation.arrow_positions ?? [])
      .filter((position) => position?.slice_idx === frameIndex)
      .map((position) => ({ x: position.x, y: position.y, kind: "arrow" }));
    const labelPoints = (annotation.label_positions ?? [])
      .filter((position) => position?.slice_idx === frameIndex)
      .map((position) => ({ x: position.x, y: position.y, kind: "label" }));

    if (arrowPoints.length) {
      points.push(...arrowPoints);
    } else {
      points.push(...labelPoints);
    }
  }

  return points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function extractSeriesAnnotationIndices(series, usableLength) {
  return dedupe(
    (series.annotations ?? [])
      .flatMap((annotation) => [
        ...(annotation.label_positions ?? []).map((position) => position?.slice_idx),
        ...(annotation.arrow_positions ?? []).map((position) => position?.slice_idx),
      ])
      .filter((value) => Number.isInteger(value) && value >= 0 && value < usableLength),
  ).sort((left, right) => left - right);
}

function nearestDistance(index, targets) {
  if (!targets.length) {
    return null;
  }
  return Math.min(...targets.map((target) => Math.abs(target - index)));
}

function buildRelevantFrameIndices({ usableLength, currentIndex, keyImageIndex, annotationIndices, studyHasAnnotations }) {
  const indices = [];

  if (annotationIndices.length) {
    indices.push(...annotationIndices);
    if (Number.isInteger(keyImageIndex) && keyImageIndex >= 0 && annotationIndices.includes(keyImageIndex)) {
      indices.push(keyImageIndex);
    }
    if (Number.isInteger(currentIndex) && currentIndex >= 0 && annotationIndices.includes(currentIndex)) {
      indices.push(currentIndex);
    }
  } else if (!studyHasAnnotations) {
    indices.push(
      currentIndex - 1,
      currentIndex,
      currentIndex + 1,
    );
    if (Number.isInteger(keyImageIndex) && keyImageIndex >= 0) {
      indices.unshift(keyImageIndex);
    }
  } else {
    if (Number.isInteger(keyImageIndex) && keyImageIndex >= 0) {
      indices.push(keyImageIndex);
    }
    if (Number.isInteger(currentIndex) && currentIndex >= 0) {
      indices.push(currentIndex);
    }
  }

  return dedupe(
    indices.filter((value) => Number.isInteger(value) && value >= 0 && value < usableLength),
  );
}

function computeFrameRelevanceAudit({ index, currentIndex, keyImageIndex, annotationIndices, annotationDistance, studyHasAnnotations }) {
  let score = 0;
  const components = [];
  const reasons = [];
  let candidateSource = "ranked-neighbor";

  if (annotationIndices.includes(index)) {
    score += 420;
    components.push({ name: "annotation", value: 420 });
    reasons.push("contains Radiopaedia annotation");
    candidateSource = "annotation";
  }

  if (Number.isInteger(keyImageIndex) && index === keyImageIndex) {
    score += 160;
    components.push({ name: "key-image", value: 160 });
    reasons.push("matches Radiopaedia key image");
    candidateSource = candidateSource === "annotation" ? "annotation-key-image" : "key-image";
  } else if (annotationDistance !== null) {
    const value = Math.max(0, 70 - annotationDistance * 30);
    score += value;
    components.push({ name: "annotation-proximity", value });
    reasons.push("near annotated slice");
  } else if (!studyHasAnnotations) {
    const value = Math.max(0, 58 - Math.abs(index - currentIndex) * 18);
    score += value;
    components.push({ name: "current-slice-proximity", value });
    reasons.push("near current viewer slice");
  } else if (index === currentIndex) {
    score += 8;
    components.push({ name: "current-slice", value: 8 });
    reasons.push("current viewer slice");
  } else {
    score -= 30;
    components.push({ name: "weak-unannotated-slice", value: -30 });
    reasons.push("weak unannotated slice");
  }

  return {
    score,
    components,
    reasons,
    candidateSource,
  };
}

function pickDistinctImages(imageCandidates, desiredCount) {
  const sorted = [...imageCandidates].sort(
    (left, right) =>
      right.relevantScore - left.relevantScore ||
      left.seriesId - right.seriesId ||
      left.sliceIndex - right.sliceIndex,
  );

  const selected = [];
  const usedFrames = new Set();
  const usedSeries = new Set();
  const usedViews = new Set();

  const pick = (predicate) => {
    for (const candidate of sorted) {
      if (selected.length >= desiredCount) {
        return;
      }
      if (usedFrames.has(candidate.frameId) || !predicate(candidate)) {
        continue;
      }

      selected.push(candidate);
      usedFrames.add(candidate.frameId);
      usedSeries.add(candidate.seriesId);
      usedViews.add(candidate.viewSignature);
    }
  };

  pick((candidate) => candidate.relevantScore >= 150 && !usedSeries.has(candidate.seriesId));
  pick((candidate) => candidate.relevantScore >= 150 && !usedViews.has(candidate.viewSignature));
  pick((candidate) => candidate.relevantScore >= 150);
  pick((candidate) => !usedSeries.has(candidate.seriesId));
  pick((candidate) => !usedViews.has(candidate.viewSignature));
  pick(() => true);

  return selected.slice(0, desiredCount);
}

export function selectRelevantImages(imageCandidates, desiredCount, { excludeFrameIds = [], includeFrameIds = [] } = {}) {
  const excluded = new Set((excludeFrameIds ?? []).map((value) => String(value)));
  const candidatePool = excluded.size
    ? imageCandidates.filter((candidate) => !excluded.has(String(candidate.frameId)))
    : imageCandidates;
  const included = new Set((includeFrameIds ?? []).map((value) => String(value)).filter(Boolean));
  if (included.size) {
    const requestedCandidates = candidatePool.filter((candidate) => included.has(String(candidate.frameId)));
    const requestedSelection = pickDistinctImages(requestedCandidates, Math.min(desiredCount, requestedCandidates.length));
    if (requestedSelection.length >= desiredCount) {
      return annotateSelections(requestedSelection.slice(0, desiredCount), "explicitly requested frame");
    }

    const selectedFrames = new Set(requestedSelection.map((candidate) => String(candidate.frameId)));
    const remainingSelection = selectRelevantImages(
      candidatePool.filter((candidate) => !selectedFrames.has(String(candidate.frameId))),
      desiredCount - requestedSelection.length,
      { excludeFrameIds: [] },
    );
    return annotateSelections([...requestedSelection, ...remainingSelection].slice(0, desiredCount), "explicitly requested plus ranked fill");
  }

  const effectivePool = candidatePool;
  if (!effectivePool.length) {
    return [];
  }

  const annotatedCandidates = effectivePool.filter((candidate) => candidate.isAnnotated);
  if (annotatedCandidates.length) {
    return annotateSelections(
      pickDistinctImages(annotatedCandidates, Math.min(desiredCount, annotatedCandidates.length)),
      "annotated frame",
    );
  }

  const strongCandidates = effectivePool.filter(
    (candidate) => candidate.isKeyImage || candidate.isCurrent || candidate.relevantScore >= 40,
  );
  const selected = pickDistinctImages(strongCandidates.length ? strongCandidates : effectivePool, desiredCount);

  while (
    selected.length > 1 &&
    !selected[selected.length - 1].isAnnotated &&
    !selected[selected.length - 1].isKeyImage &&
    selected[selected.length - 1].relevantScore < 40
  ) {
    selected.pop();
  }

  return annotateSelections(selected.slice(0, desiredCount), "ranked relevance");
}

function annotateSelections(images, reason) {
  return images.map((image, index) => ({
    ...image,
    selectionExplanation: explainImageSelection(image, reason, index + 1),
    audit: {
      ...(image.audit || {}),
      selected: true,
      selectedRank: index + 1,
      selectedReason: reason,
    },
  }));
}

export function explainImageSelection(image, selectedReason = "", selectedRank = null) {
  const reasons = Array.isArray(image.audit?.reasons) ? image.audit.reasons : [];
  const reasonText = dedupe([
    collapseWhitespace(selectedReason),
    ...reasons.map((reason) => collapseWhitespace(reason)),
  ].filter(Boolean)).join("; ");
  const score = Number.isFinite(image.relevantScore) ? `score ${Math.round(image.relevantScore)}` : "unscored";
  const rankText = Number.isInteger(selectedRank) ? `rank ${selectedRank}, ` : "";
  const source = collapseWhitespace(image.audit?.candidateSource || "");
  const sourceText = source ? ` from ${source}` : "";
  return collapseWhitespace(
    `Selected ${rankText}${score}${sourceText}${reasonText ? `: ${reasonText}.` : "."}`,
  );
}

function explainImageCandidate(image) {
  const reasons = Array.isArray(image.audit?.reasons) ? image.audit.reasons : [];
  const reasonText = dedupe(reasons.map((reason) => collapseWhitespace(reason)).filter(Boolean)).join("; ");
  const score = Number.isFinite(image.relevantScore) ? `score ${Math.round(image.relevantScore)}` : "unscored";
  const source = collapseWhitespace(image.audit?.candidateSource || "");
  const sourceText = source ? ` from ${source}` : "";
  return collapseWhitespace(
    `Candidate ${score}${sourceText}${reasonText ? `: ${reasonText}.` : "."}`,
  );
}

function serializeImageCandidate(candidate) {
  return {
    url: candidate.url,
    label: candidate.label || "",
    studyId: candidate.studyId ?? null,
    seriesId: candidate.seriesId ?? null,
    frameId: candidate.frameId ?? "",
    modality: candidate.modality ?? null,
    plane: candidate.plane ?? "",
    sliceIndex: candidate.sliceIndex ?? null,
    relevantScore: Number.isFinite(candidate.relevantScore) ? candidate.relevantScore : 0,
    isAnnotated: Boolean(candidate.isAnnotated),
    isKeyImage: Boolean(candidate.isKeyImage),
    isCurrent: Boolean(candidate.isCurrent),
    viewSignature: candidate.viewSignature || "",
    focusPoints: Array.isArray(candidate.focusPoints) ? candidate.focusPoints : [],
    selectionExplanation: candidate.selectionExplanation || explainImageCandidate(candidate),
    audit: candidate.audit && typeof candidate.audit === "object" ? candidate.audit : {},
  };
}

export function normalizeImageCandidateBank(candidates) {
  if (!Array.isArray(candidates)) {
    return [];
  }
  return candidates
    .filter((candidate) => candidate && typeof candidate === "object" && candidate.url)
    .map((candidate) => ({
      ...serializeImageCandidate(candidate),
      localPath: undefined,
    }));
}

export function imageCandidateCacheKey(casePath, preferredModalities = []) {
  return {
    casePath: collapseWhitespace(casePath).replace(/\?.*$/, ""),
    preferredModalities: dedupe((preferredModalities || []).map((value) => collapseWhitespace(value)).filter(Boolean)),
  };
}

function imageStrengthScore(image) {
  const ollamaBonus = Number.isFinite(image.ollamaScore) ? image.ollamaScore * 8 : 0;
  return image.relevantScore + ollamaBonus + (image.isAnnotated ? 120 : 0) + (image.isKeyImage ? 40 : 0);
}

export function evaluateSelectedImages(images, requestedCount, difficulty = "") {
  const strongImages = images.filter((image) => image.isAnnotated || image.isKeyImage || imageStrengthScore(image) >= 180);
  const adequateImages = images.filter((image) => image.isAnnotated || image.isKeyImage || imageStrengthScore(image) >= 120);
  const warnings = [];
  const difficultyMode = normalizedDifficulty(difficulty);

  if (images.length < Math.min(requestedCount, 2)) {
    warnings.push(`Only ${images.length} clearly relevant image${images.length === 1 ? "" : "s"} found.`);
  }
  if (!adequateImages.length) {
    warnings.push("Selected images do not convincingly show the relevant pathology.");
  } else if (difficultyMode !== "hard" && requestedCount >= 3 && strongImages.length < 2) {
    warnings.push("The image set is still weak for a 3-image teaching slide.");
  }
  if (difficultyMode === "easy" && strongImages.length < Math.min(requestedCount, 2)) {
    warnings.push("Easy mode prefers cases with at least two very conspicuous teaching images.");
  }

  return {
    requestedCount,
    selectedCount: images.length,
    strongCount: strongImages.length,
    adequateCount: adequateImages.length,
    overallScore:
      images.reduce((sum, image) => sum + imageStrengthScore(image), 0) +
      strongImages.length * 120 +
      adequateImages.length * 40,
    shouldReroll: warnings.length > 0,
    warnings,
    summary: warnings.length
      ? warnings.join(" ")
      : `${images.length} relevant image${images.length === 1 ? "" : "s"} selected.`,
  };
}
