import { readFile } from "node:fs/promises";
import type { ProviderInput } from "./types.ts";

const fields = ["instructions", "tools", "conversation"] as const;
export async function loadGuidance(file: string): Promise<string> {
  const text = (await readFile(file, "utf8")).trim();
  if (!text) throw new Error(`Guidance file is empty: ${file}.`);
  return text;
}
export async function loadHarness(file: string): Promise<string> {
  const template = (await readFile(file, "utf8")).trim();
  if (!template) throw new Error(`Harness instruction file is empty: ${file}.`);
  for (const name of fields) {
    if (template.split(`{{${name}}}`).length !== 2) {
      throw new Error(`Harness instructions must include {{${name}}} exactly once: ${file}.`);
    }
  }
  const unknown = template.match(/\{\{(?!instructions\}\}|tools\}\}|conversation\}\})[^{}]+\}\}/);
  if (unknown) throw new Error(`Unknown harness placeholder: ${unknown[0]}.`);
  return template;
}

export function renderHarness(template: string, input: ProviderInput): string {
  const values = {
    instructions: input.instructions,
    tools: JSON.stringify(input.tools),
    conversation: JSON.stringify(input.history),
  };
  // One pass prevents placeholder-looking text inside a message from being expanded.
  return template.replace(/\{\{(instructions|tools|conversation)\}\}/g,
    (_, name: keyof typeof values) => values[name]);
}
