import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";

export type Skill = { name: string; description: string; hash: string; content: string };
const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function checkName(name: string): void {
  if (!validName.test(name) || name.length > 63) throw new Error("Use a lowercase skill name with hyphens, under 64 characters.");
}
function scalar(text: string): string {
  return text.startsWith('"') ? JSON.parse(text) as string : text;
}
export function parseSkill(content: string): Skill {
  if (content.length > 32_000) throw new Error("Skill exceeds 32,000 characters; move detail to references.");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
  if (!frontmatter) throw new Error("Skill requires YAML frontmatter.");
  const get = (key: string) => {
    const match = new RegExp(`^${key}: (.+)$`, "m").exec(frontmatter[1]);
    if (!match) throw new Error(`Skill requires ${key}.`);
    const value = scalar(match[1].trim());
    if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${key}.`);
    return value;
  };
  const name = get("name"), description = get("description");
  checkName(name);
  if (description.length > 400) throw new Error("Keep the skill description under 400 characters.");
  if (!content.slice(frontmatter[0].length).trim()) throw new Error("Skill body is empty.");
  return { name, description, content, hash: createHash("sha256").update(content).digest("hex") };
}

export class Skills {
  root: string;
  revisions: string;
  constructor(root: string, revisions: string) { this.root = root; this.revisions = revisions; }
  async contained(path: string): Promise<void> {
    const base = await realpath(this.root), target = await realpath(path);
    const rel = relative(base, target);
    if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) {
      throw new Error("Skill path resolves outside the skill library.");
    }
  }
  async load(name: string): Promise<Skill> {
    checkName(name);
    const file = join(this.root, name, "SKILL.md");
    await this.contained(file);
    const skill = parseSkill(await readFile(file, "utf8"));
    if (skill.name !== name) throw new Error("Skill folder and frontmatter name disagree.");
    return skill;
  }
  async catalog(): Promise<{ name: string; description: string }[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const catalog = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !validName.test(entry.name)) continue;
      const { name, description } = await this.load(entry.name);
      catalog.push({ name, description });
    }
    return catalog;
  }
  async save(name: string, description: string, body: string): Promise<Skill> {
    checkName(name);
    const content = `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;
    const skill = parseSkill(content);
    await mkdir(this.root, { recursive: true });
    const directory = join(this.root, name);
    await mkdir(directory, { recursive: true });
    await this.contained(directory);
    const file = join(directory, "SKILL.md");
    try {
      const existing = await this.load(name);
      await mkdir(this.revisions, { recursive: true });
      await writeFile(join(this.revisions, `${name}-${existing.hash}.md`), existing.content, { flag: "w" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Reject a symlinked SKILL.md before writing; library is trusted local storage.
    try { await this.contained(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await writeFile(file, content, "utf8");
    return skill;
  }
}
