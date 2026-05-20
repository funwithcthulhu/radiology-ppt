import { collapseWhitespace } from "../utils.mjs";

const CAPTION_PATTERN =
  /^(?:fig(?:ure)?\.?\s*([a-z]?\d+[a-z]?)|image\s*([a-z]?\d+[a-z]?)|case\s*([a-z]?\d+[a-z]?)|table\s*([a-z]?\d+[a-z]?))\b[:.)\-\s]*/i;
const KNOWN_SECTION_HEADING_PATTERN =
  /^(?:abstract|approach|background|case|clinical|discussion|diagnosis|findings|imaging|key points?|learning objectives?|management|overview|pearls?|pitfalls?|presentation|summary|technique|treatment)\b/i;

function numberOrNull(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeMaxChars(value, fallback = 900) {
  return Math.max(240, Number.parseInt(value, 10) || fallback);
}

function captionNumber(value) {
  const match = String(value || "").match(CAPTION_PATTERN);
  if (!match) {
    return null;
  }
  const raw = match.slice(1).find(Boolean) || "";
  return numberOrNull(raw.replace(/^\D+/, ""));
}

function normalizeTextLines(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((rawText, index) => ({
      index,
      text: collapseWhitespace(rawText),
    }));
}

function titleCaseRatio(words) {
  const candidates = words.filter((word) => /[a-z]/i.test(word));
  if (!candidates.length) {
    return 0;
  }
  const titled = candidates.filter(
    (word) =>
      /^[A-Z][a-z0-9()/+-]*$/.test(word) ||
      /^[A-Z0-9()/+-]{2,}$/.test(word),
  );
  return titled.length / candidates.length;
}

function uppercaseRatio(text) {
  const letters = String(text || "").replace(/[^a-z]/gi, "");
  if (!letters.length) {
    return 0;
  }
  return letters.replace(/[^A-Z]/g, "").length / letters.length;
}

export function isPdfCaptionLine(text) {
  return CAPTION_PATTERN.test(collapseWhitespace(text));
}

export function isLikelyPdfSectionHeading(text) {
  const clean = collapseWhitespace(text);
  if (!clean || clean.length > 90 || isPdfCaptionLine(clean)) {
    return false;
  }

  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 12) {
    return false;
  }
  if (KNOWN_SECTION_HEADING_PATTERN.test(clean)) {
    return true;
  }
  if (/^(?:\d+(?:\.\d+)*|[A-Z])[\s.)-]+[A-Z]/.test(clean)) {
    return true;
  }
  if (/[.!?]$/.test(clean)) {
    return false;
  }

  return uppercaseRatio(clean) >= 0.65 || titleCaseRatio(words) >= 0.65;
}

function splitLongText(text, maxChars) {
  const clean = collapseWhitespace(text);
  if (!clean || clean.length <= maxChars) {
    return clean ? [clean] : [];
  }

  const pieces = clean
    .split(/(?<=[.?!])\s+(?=[A-Z0-9(])/)
    .map((piece) => piece.trim())
    .filter(Boolean);
  const sourcePieces = pieces.length > 1 ? pieces : clean.split(/\s+/);
  const chunks = [];
  let current = "";
  for (const piece of sourcePieces) {
    const next = current ? `${current} ${piece}` : piece;
    if (next.length <= maxChars || !current) {
      current = next;
      continue;
    }
    chunks.push(current.trim());
    current = piece;
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

function chunkLines(unit, maxChars) {
  const chunks = [];
  let current = [];
  let currentLength = 0;

  function pushCurrent(reason = unit.reason) {
    if (!current.length) {
      return;
    }
    const text = current.map((line) => line.text).join("\n").trim();
    const base = {
      ...unit,
      reason,
      lineStart: current[0].index,
      lineEnd: current[current.length - 1].index,
    };
    for (const piece of splitLongText(text, maxChars)) {
      chunks.push({ ...base, text: piece });
    }
    current = [];
    currentLength = 0;
  }

  for (const line of unit.lines) {
    const nextLength = currentLength + line.text.length + (current.length ? 1 : 0);
    if (current.length && nextLength > maxChars) {
      pushCurrent("size_split");
    }
    current.push(line);
    currentLength += line.text.length + (current.length > 1 ? 1 : 0);
  }
  pushCurrent();
  return chunks;
}

function pageCaptionCandidates(lines) {
  return lines
    .filter((line) => line.text && isPdfCaptionLine(line.text))
    .map((line) => ({
      text: line.text.slice(0, 500),
      lineIndex: line.index,
      number: captionNumber(line.text),
    }));
}

function nearestCaptions(chunk, captions) {
  const center = (chunk.lineStart + chunk.lineEnd) / 2;
  return captions
    .map((caption) => ({
      ...caption,
      distance: Math.min(
        Math.abs(caption.lineIndex - chunk.lineStart),
        Math.abs(caption.lineIndex - chunk.lineEnd),
        Math.abs(caption.lineIndex - center),
      ),
      inside:
        caption.lineIndex >= chunk.lineStart && caption.lineIndex <= chunk.lineEnd,
    }))
    .sort((left, right) => {
      if (left.inside !== right.inside) {
        return left.inside ? -1 : 1;
      }
      if (left.distance !== right.distance) {
        return left.distance - right.distance;
      }
      return left.lineIndex - right.lineIndex;
    })
    .slice(0, 8);
}

function layoutUnitsForPage(pageText) {
  const lines = normalizeTextLines(pageText);
  const units = [];
  let activeHeading = "";
  let current = null;

  function startUnit(line, reason, sectionHeading = activeHeading) {
    current = {
      reason,
      sectionHeading,
      lines: line ? [line] : [],
    };
  }

  function pushCurrent() {
    if (current?.lines?.length) {
      units.push(current);
    }
    current = null;
  }

  for (const line of lines) {
    if (!line.text) {
      pushCurrent();
      continue;
    }

    const isCaption = isPdfCaptionLine(line.text);
    const isHeading = isLikelyPdfSectionHeading(line.text);
    if (isHeading) {
      pushCurrent();
      activeHeading = line.text;
      startUnit(line, "section_heading", activeHeading);
      continue;
    }

    if (isCaption) {
      pushCurrent();
      startUnit(line, "caption", activeHeading);
      pushCurrent();
      continue;
    }

    if (!current) {
      startUnit(line, "paragraph", activeHeading);
      continue;
    }
    if (current.reason === "section_heading") {
      pushCurrent();
      startUnit(line, "paragraph", activeHeading);
      continue;
    }
    current.lines.push(line);
  }
  pushCurrent();

  return {
    lines,
    units,
    captions: pageCaptionCandidates(lines),
  };
}

function assetSortKey(asset) {
  return [
    String(asset?.type || ""),
    Number.isFinite(asset?.imageIndex) ? asset.imageIndex : 9999,
    String(asset?.id || ""),
  ].join(":");
}

function pageAssetsFor(pageNumber, assets) {
  return assets
    .filter((asset) => Number(asset?.pageNumber || 0) === pageNumber)
    .sort((left, right) => assetSortKey(left).localeCompare(assetSortKey(right)));
}

function inferredImageIndex(asset, index) {
  return Number.isInteger(asset?.imageIndex) && asset.imageIndex > 0
    ? asset.imageIndex
    : index + 1;
}

function confidenceFromScore(score, reason) {
  if (reason === "caption_number") {
    return 0.95;
  }
  if (reason === "caption_proximity") {
    if (score >= 80) {
      return 0.88;
    }
    if (score >= 60) {
      return 0.78;
    }
    return 0.58;
  }
  if (reason === "same_page_embedded") {
    if (score >= 50) {
      return 0.74;
    }
    if (score >= 35) {
      return 0.64;
    }
    return 0.42;
  }
  if (reason === "same_page_fallback") {
    return 0.72;
  }
  if (reason === "page_render_backup") {
    return 0.35;
  }
  return 0.5;
}

function scoreEmbeddedAsset(asset, assetIndex, assetCount, chunk, captions, lineCount) {
  const imageIndex = inferredImageIndex(asset, assetIndex);
  const anchorLine =
    lineCount > 0 ? ((imageIndex - 0.5) / Math.max(assetCount, 1)) * lineCount : 0;
  const rankedCaptions = captions.length ? captions : chunk.captionCandidates;
  const bestCaption = rankedCaptions[0] || null;
  const matchingCaption = rankedCaptions.find(
    (caption) =>
      caption.number &&
      caption.number === imageIndex &&
      (caption.inside || caption.distance <= 4 || chunk.reason === "caption"),
  );
  const chunkCenter = (chunk.lineStart + chunk.lineEnd) / 2;
  const captionDistance = bestCaption
    ? Math.abs(bestCaption.lineIndex - anchorLine)
    : Math.abs(chunkCenter - anchorLine);
  const proximityScore = Math.max(0, 40 - captionDistance);
  const score =
    (matchingCaption ? 120 : 0) +
    (bestCaption?.inside ? 45 : 0) +
    (chunk.reason === "caption" ? 35 : 0) +
    proximityScore +
    Math.max(0, 20 - Math.abs(chunkCenter - anchorLine));

  const reason = matchingCaption
    ? "caption_number"
    : bestCaption
      ? "caption_proximity"
      : "same_page_embedded";
  return {
    assetId: asset.id,
    type: asset.type,
    score: Math.round(score),
    confidence: confidenceFromScore(score, reason),
    confidenceSource: "pdf_layout_v1",
    reason,
    caption: matchingCaption?.text || bestCaption?.text || "",
  };
}

function assetMatchesForChunk(chunk, pageAssets, lineCount) {
  const embeddedAssets = pageAssets.filter((asset) => asset.type === "embedded_image");
  const pageRender = pageAssets.find((asset) => asset.type === "page_render");
  const matches = [];

  if (embeddedAssets.length) {
    const scored = embeddedAssets
      .map((asset, index) =>
        scoreEmbeddedAsset(
          asset,
          index,
          embeddedAssets.length,
          chunk,
          chunk.captionCandidates,
          lineCount,
        ),
      )
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return String(left.assetId).localeCompare(String(right.assetId));
      });
    if (scored[0]?.assetId && scored[0].confidence >= 0.6) {
      matches.push({
        ...scored[0],
        priority: 1,
      });
    }
  }

  if (pageRender?.id) {
    matches.push({
      assetId: pageRender.id,
      type: pageRender.type,
      score: embeddedAssets.length ? 5 : 25,
      reason: embeddedAssets.length ? "page_render_backup" : "same_page_fallback",
      confidence: confidenceFromScore(
        embeddedAssets.length ? 5 : 25,
        embeddedAssets.length ? "page_render_backup" : "same_page_fallback",
      ),
      confidenceSource: "pdf_layout_v1",
      caption: "",
      priority: matches.length + 1,
    });
  }

  return matches;
}

export function buildPdfLayoutChunks(pages, options = {}) {
  const sourceId = collapseWhitespace(options.sourceId) || "pdf-source";
  const sourceTitle = collapseWhitespace(options.title) || "Imported PDF";
  const maxChars = safeMaxChars(
    options.layoutMaxChars || options.maxChars,
    options.maxChars ? Number.parseInt(options.maxChars, 10) : 900,
  );
  const assets = Array.isArray(options.assets) ? options.assets : [];
  const chunks = [];

  for (const page of pages || []) {
    const pageNumber = Number.parseInt(page?.num || page?.pageNumber || 1, 10) || 1;
    const layout = layoutUnitsForPage(page?.text || "");
    const pageAssets = pageAssetsFor(pageNumber, assets);
    const pageChunks = layout.units.flatMap((unit) => chunkLines(unit, maxChars));

    pageChunks.forEach((chunk, index) => {
      const captionCandidates = nearestCaptions(chunk, layout.captions);
      const chunkWithCaptions = {
        ...chunk,
        captionCandidates,
      };
      const assetMatches = assetMatchesForChunk(
        chunkWithCaptions,
        pageAssets,
        layout.lines.length,
      );
      const primaryAssetMatch =
        assetMatches.find((match) => match.confidence >= 0.6) ||
        assetMatches[0] ||
        null;
      const chunkOrdinal = chunks.length + 1;
      chunks.push({
        id: `${sourceId}:page-${String(pageNumber).padStart(4, "0")}:chunk-${String(index + 1).padStart(3, "0")}`,
        sourceId,
        index: chunkOrdinal - 1,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        domain: collapseWhitespace(options.domain).toLowerCase(),
        tags: Array.isArray(options.tags) ? options.tags : [],
        text: chunk.text,
        sectionHeading: chunk.sectionHeading || "",
        layout: {
          strategy: "pdf_layout_v1",
          reason: chunk.reason,
          pageNumber,
          chunkIndex: index,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
        },
        assetIds: assetMatches.map((match) => match.assetId).filter(Boolean),
        assetMatches,
        imageMatchConfidence: primaryAssetMatch?.confidence ?? 0,
        imageMatchConfidenceSource: primaryAssetMatch?.confidenceSource || "",
        imageMatchReason: primaryAssetMatch?.reason || "",
        captionCandidates: captionCandidates.map((caption) => caption.text),
        sourceLocator: {
          sourceTitle,
          page: pageNumber,
          section: chunk.sectionHeading || "",
          caption: primaryAssetMatch?.caption || "",
          imageMatchReason: primaryAssetMatch?.reason || "",
        },
      });
    });
  }

  return chunks;
}
