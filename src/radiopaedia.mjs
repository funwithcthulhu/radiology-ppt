import { dedupe } from "./utils.mjs";
import { parseCaseRequest } from "./request-parser.mjs";
import { emitProgress } from "./backend-events.mjs";
import { fetchRadiopaediaCaseByPath } from "./radiopaedia-case-fetch.mjs";
import {
  comparableCasePath,
  inspectRadiopaediaCaseCandidates,
} from "./radiopaedia-search.mjs";

export { buildTeachingPoints } from "./radiopaedia-case-text.mjs";
export {
  buildCaseSearchUrl,
  expandCaseRequests,
  inspectRadiopaediaCaseCandidates,
  parseCaseSearchResults,
  parseCaseSystemsFromHtml,
  saveRandomHistory,
  searchCasePath,
} from "./radiopaedia-search.mjs";

export async function fetchRadiopaediaCase(input, { cacheDir, imagesPerCase = 3, maxFallbackAttempts = null }) {
  const request = parseCaseRequest(input);
  const fallbackCandidates = Array.isArray(request.fallbackCandidates) ? request.fallbackCandidates : [];
  const excludedPaths = new Set((request.excludeCasePaths ?? []).map((value) => comparableCasePath(value)).filter(Boolean));
  const candidateQueue = [];

  if (request.selectedCasePath && !excludedPaths.has(comparableCasePath(request.selectedCasePath))) {
    candidateQueue.push(request.selectedCasePath);
  }

  for (const candidate of fallbackCandidates) {
    if (candidate?.casePath && !excludedPaths.has(comparableCasePath(candidate.casePath))) {
      candidateQueue.push(candidate.casePath);
    }
  }

  if (!candidateQueue.length) {
    const probe = await inspectRadiopaediaCaseCandidates(request, { limit: 6 });
    for (const candidate of probe.candidates) {
      if (!excludedPaths.has(comparableCasePath(candidate.casePath))) {
        candidateQueue.push(candidate.casePath);
      }
    }
  }

  const dedupedQueue = dedupe(candidateQueue);
  if (!dedupedQueue.length) {
    throw new Error(`No Radiopaedia case results found for "${request.rawInput}".`);
  }

  const fallbackLimit =
    Number.isInteger(maxFallbackAttempts) && maxFallbackAttempts >= 0 ? maxFallbackAttempts : Number.POSITIVE_INFINITY;
  if (Number.isFinite(fallbackLimit) && fallbackCandidates.length > fallbackLimit) {
    emitProgress("Limiting fallback case search", {
      request: request.rawInput,
      fallbackAttempts: fallbackLimit,
      availableFallbacks: fallbackCandidates.length,
    });
  }

  let lastError = null;
  let bestCase = null;
  const attemptErrors = [];
  let fallbackAttempts = 0;
  for (const candidatePath of dedupedQueue) {
    const isPrimarySelection = candidatePath === request.selectedCasePath;
    if (!isPrimarySelection && fallbackAttempts >= fallbackLimit) {
      break;
    }
    if (!isPrimarySelection) {
      fallbackAttempts += 1;
    }

    const caseTitleHint =
      isPrimarySelection
        ? request.selectedCaseTitle || request.diagnosis
        : fallbackCandidates.find((candidate) => candidate.casePath === candidatePath)?.title || "";

    try {
      const caseData = await fetchRadiopaediaCaseByPath(request, candidatePath, {
        cacheDir,
        imagesPerCase,
        caseTitleHint,
      });
      if (!bestCase || caseData.quality.overallScore > bestCase.quality.overallScore) {
        bestCase = caseData;
      }
      if (!caseData.quality.shouldReroll) {
        return caseData;
      }
    } catch (error) {
      lastError = error;
      attemptErrors.push({
        casePath: candidatePath,
        primarySelection: isPrimarySelection,
        message: error.message,
      });
    }
  }

  if (bestCase) {
    return bestCase;
  }

  if (attemptErrors.length) {
    const reasons = dedupe(attemptErrors.map((attempt) => attempt.message).filter(Boolean)).slice(0, 3);
    const reasonText = reasons.length ? ` ${reasons.join(" ")}` : "";
    throw new Error(
      `No suitable Radiopaedia case could be prepared for "${request.rawInput}" after trying ${attemptErrors.length} candidate${attemptErrors.length === 1 ? "" : "s"}.${reasonText}`,
    );
  }

  throw lastError || new Error(`No Radiopaedia case results found for "${request.rawInput}".`);
}
