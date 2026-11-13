export function generateSlug(text: string): string {
  if (!text) return '';

  // Preserve the meaning of common symbols in human-readable URLs rather
  // than silently dropping them (e.g. "Food & Drinks" → "food-and-drinks").
  const symbolWords: ReadonlyArray<[RegExp, string]> = [
    [/&/g, ' and '],
    [/@/g, ' at '],
    [/\+/g, ' plus '],
    [/%/g, ' percent '],
    [/#/g, ' number '],
    [/₦/g, ' naira '],
    [/\$/g, ' dollars '],
    [/€/g, ' euros '],
    [/£/g, ' pounds '],
    [/=/g, ' equals '],
    [/\*/g, ' star '],
  ];

  let normalized = text.toString();
  for (const [symbol, word] of symbolWords) {
    normalized = normalized.replace(symbol, word);
  }

  return (
    normalized
      .normalize('NFD') // Split an accented letter in the base letter and the accent
      .replace(/[\u0300-\u036f]/g, '') // Remove all previously split accents
      .toLowerCase()
      .trim()
      .replace(/[’']/g, '') // "Women's" → "womens", not "women-s"
      // Remaining punctuation becomes a separator so words do not run together.
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple consecutive hyphens with a single hyphen
      .replace(/^-+|-+$/g, '')
  ); // Trim leading/trailing hyphens
}
