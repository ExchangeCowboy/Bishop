import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateSoul } from "./soul.ts";
import { validateMemory } from "./memory.ts";

/** Editable behavior lives in Markdown, not in application source. */
export async function loadPersonality(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map(entry => entry.name).sort();
  if (!files.length) throw new Error(`No personality Markdown files found in ${directory}.`);
  const parts = [];
  for (const file of files) {
    const raw = await readFile(join(directory, file), "utf8");
    if (file.toLowerCase() === "soul.md") validateSoul(raw);
    if (file.toLowerCase() === "memory.md") validateMemory(raw);
    const content = raw.trim();
    if (!content) throw new Error(`Personality file is empty: ${file}.`);
    parts.push(content);
  }
  return parts.join("\n\n");
}
