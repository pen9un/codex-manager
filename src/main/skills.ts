import { homedir } from "node:os";
import { join, resolve, relative, sep } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { parse } from "@iarna/toml";
import { commitConfig, readConfig, type ConfigDocument } from "./configFile";
import { configPath } from "./codex";
import {
  importSkillDirectoryOrZip,
  exportSkillDirectories,
} from "./skillTransfer";
import type { ExtensionScope, SkillSummary } from "../shared/types";

export const skillRoots = (): Array<{
  path: string;
  scope: ExtensionScope;
}> => {
  const candidates = [
    { path: join(homedir(), ".agents", "skills"), scope: "user" as ExtensionScope },
    { path: join(homedir(), ".codex", "skills"), scope: "user" as ExtensionScope },
    { path: join(process.cwd(), ".agents", "skills"), scope: "project" as ExtensionScope },
    { path: join(process.cwd(), ".codex", "skills"), scope: "project" as ExtensionScope },
  ];
  const seen = new Set<string>();
  return candidates.filter((item) => { const key = resolve(item.path).toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
};
const inside = (root: string, target: string): boolean => {
  const r = relative(resolve(root), resolve(target));
  return (
    r === "" ||
    (!r.startsWith(`..${sep}`) && r !== ".." && !r.includes(`${sep}..${sep}`))
  );
};
const frontmatter = (text: string): { name: string; description: string } => {
  if (!text.startsWith("---")) return { name: "", description: "" };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { name: "", description: "" };
  const values = new Map<string, string>();
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) values.set(match[1], match[2].replace(/^['"]|['"]$/g, ""));
  }
  return {
    name: values.get("name") || "",
    description: values.get("description") || "",
  };
};
export async function listSkills(): Promise<SkillSummary[]> {
  let configured: any = {};
  try {
    configured = parse(await readFile(configPath(), "utf8"));
  } catch {
    configured = {};
  }
  const states = new Map<string, boolean>(
    (Array.isArray(configured.skills?.config) ? configured.skills.config : [])
      .filter((item: any) => typeof item?.path === "string")
      .map((item: any) => [resolve(item.path), item.enabled !== false]),
  );
  const result: SkillSummary[] = [];
  for (const root of skillRoots()) {
    let entries: string[] = [];
    try {
      entries = await readdir(root.path);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(root.path, entry);
      let info;
      try {
        info = await stat(dir);
      } catch {
        continue;
      }
      if (!info.isDirectory()) continue;
      const file = join(dir, "SKILL.md");
      let raw = "";
      try {
        raw = await readFile(file, "utf8");
      } catch {
        /* invalid skill is still shown */
      }
      const meta = frontmatter(raw);
      result.push({
        id: `${root.scope}:${resolve(dir)}`,
        name: meta.name || entry,
        description: meta.description || "缺少有效的 SKILL.md 元数据",
        path: dir,
        scope: root.scope,
        enabled: states.get(resolve(file)) ?? states.get(resolve(dir)) ?? true,
        valid: Boolean(raw && meta.name && meta.description),
        updatedAt: info.mtime.toISOString(),
      });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
export async function getSkillDetail(path: string): Promise<{ path: string; content: string; files: string[] }> {
  const valid = assertSkillPath(path);
  const content = await readFile(join(valid, "SKILL.md"), "utf8");
  const files = (await readdir(valid, { withFileTypes: true })).map((entry) => entry.name + (entry.isDirectory() ? "/" : ""));
  return { path: valid, content, files };
}
export function assertSkillPath(path: string): string {
  const found = skillRoots().find((root) => inside(root.path, path));
  if (!found) throw new Error("Skill 路径不在受支持的用户或项目目录中");
  return resolve(path);
}
export async function importSkill(
  source: string,
  name?: string,
  scope: ExtensionScope = "user",
): Promise<string> {
  const root = skillRoots().find((item) => item.scope === scope);
  if (!root) throw new Error(`未找到${scope === "project" ? "项目" : "用户"} Skill 目录`);
  return importSkillDirectoryOrZip(source, root.path, name);
}
export async function exportSkills(
  paths: string[],
  destination: string,
): Promise<number> {
  return exportSkillDirectories(
    paths,
    destination,
    skillRoots().map((root) => root.path),
  );
}
export async function setSkillEnabled(
  path: string,
  enabled: boolean,
): Promise<void> {
  if (typeof enabled !== "boolean") throw new Error("Skill 状态必须为布尔值");
  const valid = assertSkillPath(path);
  const skill = (await listSkills()).find(
    (item) => resolve(item.path) === valid,
  );
  if (!skill || !skill.valid)
    throw new Error("请选择包含有效 SKILL.md 的 Skill");
  const file = configPath();
  const before = await readConfig(file);
  const previous = (before.document.skills || {}) as ConfigDocument;
  const entries = Array.isArray(previous.config)
    ? (previous.config as ConfigDocument[])
    : [];
  const skillFile = join(valid, "SKILL.md");
  const config = entries.filter(
    (item) =>
      typeof item.path !== "string" ||
      ![valid, skillFile].includes(resolve(item.path)),
  );
  config.push({ path: skillFile, enabled });
  await commitConfig(
    file,
    before,
    { ...before.document, skills: { ...previous, config } },
    "skills",
  );
}
