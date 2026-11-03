const UNCENSORED = new Set(["無修正", "无修正", "무수정", "uncensored"]);
export function canonicalTagName(name: string) {
  const normalized = name.normalize("NFKC").trim();
  return UNCENSORED.has(normalized.toLowerCase()) ? "無修正" : name.normalize("NFC").trim();
}
