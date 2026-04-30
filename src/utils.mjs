export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function dedupe(values) {
  return [...new Set(values)];
}

export function collapseWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function stripTags(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function cleanText(value) {
  return collapseWhitespace(decodeHtmlEntities(stripTags(value)));
}

export function truncate(value, maxLength) {
  const text = collapseWhitespace(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactTerms(text, terms) {
  let output = String(text ?? "");
  const phrases = dedupe(
    terms
      .flatMap((term) => {
        const normalized = collapseWhitespace(term);
        if (!normalized) {
          return [];
        }
        const pieces = normalized.split(/\s+/).filter((item) => item.length >= 5);
        return [normalized, ...pieces];
      })
      .filter((term) => term.length >= 5),
  );

  for (const term of phrases) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "ig");
    output = output.replace(pattern, "[diagnosis hidden]");
  }

  return collapseWhitespace(output);
}

export function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
