export function tryParseJson<T = unknown>(candidate: string): T | null {
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const repaired = repairJson(candidate);
    try {
      return JSON.parse(repaired) as T;
    } catch {
      return null;
    }
  }
}

export function extractJson<T = unknown>(text: string): T | null {
  if (!text) return null;

  const codeBlock = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (codeBlock?.[1]) {
    const parsed = tryParseJson<T>(codeBlock[1].trim());
    if (parsed !== null) return parsed;
  }

  const brace = /\{[\s\S]*\}/.exec(text);
  if (brace?.[0]) {
    const parsed = tryParseJson<T>(brace[0].trim());
    if (parsed !== null) return parsed;
  }

  return tryParseJson<T>(text);
}

export function repairJson(input: string): string {
  let s = input.trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  s = s.replace(/,\s*([}\]])/g, "$1");
  s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  s = s.replace(/:\s*'([^']*)'/g, ': "$1"');
  const openBraces = (s.match(/\{/g) || []).length;
  const closeBraces = (s.match(/\}/g) || []).length;
  if (openBraces > closeBraces) s += "}".repeat(openBraces - closeBraces);
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) s += "]".repeat(openBrackets - closeBrackets);
  return s;
}

export function clamp(value: unknown, lo = 0, hi = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
