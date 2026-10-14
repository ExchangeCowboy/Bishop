import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { parse as parseToml } from "smol-toml";
import { parseConfig } from "../app/config.ts";

async function replace(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function completeOnboarding(configFile: string): Promise<{ saved: true; first_run: false }> {
  const content = await readFile(configFile, "utf8");
  const config = parseConfig(parseToml(content.replace(/^\uFEFF/, "")));
  if (!config.onboarding?.first_run) throw new Error("Onboarding is not pending. Set onboarding.first_run = true to run it again.");
  // Edit only the setting, retaining comments and every other section.
  let inOnboarding = false;
  const updated = content.split(/(?<=\n)/).map(line => {
    if (/^\s*\[/.test(line)) inOnboarding = /^\s*\[onboarding\]\s*(?:#.*)?(?:\r?\n)?$/.test(line);
    return inOnboarding ? line.replace(/^(\s*first_run\s*=\s*)true\b/, "$1false") : line;
  }).join("");
  if (parseConfig(parseToml(updated.replace(/^\uFEFF/, ""))).onboarding?.first_run !== false) {
    throw new Error("Use a [onboarding] section with first_run = true in the TOML config.");
  }
  await replace(configFile, updated);
  return { saved: true, first_run: false };
}
