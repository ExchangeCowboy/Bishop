export const MEMORY_CHARACTER_LIMIT = 4_000;

export function validateMemory(content: string): number {
  const characters = Array.from(content).length;
  if (!content.trim()) throw new Error("memory.md must contain nonempty Markdown. Use a heading alone to clear saved facts.");
  if (characters >= MEMORY_CHARACTER_LIMIT) {
    throw new Error("memory.md must stay under 4,000 characters, including headings and whitespace. Consolidate it before saving.");
  }
  return characters;
}
