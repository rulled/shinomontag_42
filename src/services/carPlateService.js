const ALLOWED_LETTERS = "АВЕКМНОРСТУХ";
const PLATE_REGEX = /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/;

const LATIN_TO_CYRILLIC = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};

function normalizeRuCarPlate(raw) {
  const value = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");

  if (!value) return "";

  let normalized = "";

  for (const char of value) {
    if (/\d/.test(char)) {
      normalized += char;
      continue;
    }

    const mapped = LATIN_TO_CYRILLIC[char] || char;
    if (!ALLOWED_LETTERS.includes(mapped)) {
      return null;
    }
    normalized += mapped;
  }

  return normalized;
}

function isValidRuCarPlate(raw) {
  const normalized = normalizeRuCarPlate(raw);
  return Boolean(normalized && PLATE_REGEX.test(normalized));
}

function formatRuCarPlate(raw) {
  const normalized = normalizeRuCarPlate(raw);
  if (!normalized || !PLATE_REGEX.test(normalized)) {
    return null;
  }

  return `${normalized.slice(0, 6)} ${normalized.slice(6)}`;
}

module.exports = {
  normalizeRuCarPlate,
  isValidRuCarPlate,
  formatRuCarPlate,
};

