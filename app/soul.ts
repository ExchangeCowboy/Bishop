export const SOUL_CHARACTER_LIMIT = 2_000;

export function validateSoul(content: string): number {
  const characters = Array.from(content).length;
  if (!content.trim()) throw new Error("soul.md must contain nonempty Markdown.");
  if (characters >= SOUL_CHARACTER_LIMIT) {
    throw new Error("soul.md must stay under 2,000 characters, including headings and whitespace. Consolidate it before saving.");
  }
  return characters;
}
