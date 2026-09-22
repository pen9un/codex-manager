import { constants } from "node:fs";
import {
  lstat,
  readdir,
  readFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { unzipSync } from "fflate";

const MAX_FILES = 4000;
const MAX_BYTES = 64 * 1024 * 1024;
type Entry = { path: string; data?: Uint8Array };

// Reject Windows drive paths, ADS, ambiguous names and traversal on every platform.
export function portablePath(value: string): string {
  const path = value.replace(/\\/g, "/");
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = trimmed.split("/");
  if (
    !trimmed ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[<>:"|?*\x00-\x1f]/.test(part) ||
        /[ .]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new Error("目录包含不安全或不兼容的路径");
  }
  return parts.join("/");
}

export function isWithin(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (!isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith("../") &&
      !rel.startsWith("..\\"))
  );
}

async function absent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`目标已存在：${basename(path)}`);
}

async function directoryEntries(source: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  let size = 0;
  async function walk(dir: string, prefix = "", depth = 0): Promise<void> {
    if (depth > 32) throw new Error("Skill 目录层级过深");
    for (const name of await readdir(dir)) {
      const path = portablePath(prefix ? `${prefix}/${name}` : name);
      const fullPath = join(dir, name);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink())
        throw new Error("导入导出暂不支持符号链接，请使用实际文件目录");
      if (entries.length >= MAX_FILES) throw new Error("Skill 文件数超过限制");
      if (info.isDirectory()) {
        entries.push({ path });
        await walk(fullPath, path, depth + 1);
      } else if (info.isFile()) {
        if (info.size > MAX_BYTES || size + info.size > MAX_BYTES)
          throw new Error("Skill 总大小超过 64 MB");
        const data = await readFile(fullPath, {
          flag: constants.O_RDONLY | constants.O_NOFOLLOW,
        });
        size += data.byteLength;
        if (size > MAX_BYTES) throw new Error("Skill 总大小超过 64 MB");
        entries.push({ path, data });
      } else throw new Error("Skill 包含不支持的文件类型");
    }
  }
  await walk(source);
  return entries;
}

export function skillArchiveEntries(bytes: Uint8Array): {
  name: string;
  entries: Entry[];
} {
  if (bytes.byteLength > MAX_BYTES) throw new Error("ZIP 大小超过 64 MB");
  let total = 0;
  let count = 0;
  const seen = new Set<string>();
  const unpacked = unzipSync(bytes, {
    filter: (entry) => {
      const safe = portablePath(entry.name).toLowerCase();
      if (seen.has(safe)) throw new Error("ZIP 存在重名或大小写冲突路径");
      seen.add(safe);
      if (++count > MAX_FILES || (total += entry.originalSize) > MAX_BYTES)
        throw new Error("ZIP 解压大小或文件数超过限制");
      return true;
    },
  });
  const names = Object.keys(unpacked);
  const roots = names.filter((name) =>
    /(^|\/)SKILL\.md$/.test(name.replace(/\\/g, "/")),
  );
  if (roots.length !== 1)
    throw new Error("ZIP 必须包含且仅包含一个 Skill（SKILL.md）");
  const root = portablePath(roots[0]).slice(0, -"SKILL.md".length);
  const entries: Entry[] = [];
  for (const raw of names) {
    const path = portablePath(raw);
    // A ZIP may have a wrapper directory; unrelated siblings are not imported.
    if (root && !path.startsWith(root)) continue;
    const rel = root ? path.slice(root.length) : path;
    if (!rel) continue;
    entries.push({
      path: portablePath(rel),
      ...(raw.endsWith("/") ? {} : { data: unpacked[raw] }),
    });
  }
  return {
    name: root ? root.split("/").filter(Boolean).at(-1)! : "skill",
    entries,
  };
}

async function publish(
  root: string,
  name: string,
  entries: Entry[],
): Promise<string> {
  if (portablePath(name).includes("/"))
    throw new Error("Skill 名称不能包含目录");
  if (!entries.some((entry) => entry.path === "SKILL.md" && entry.data?.length))
    throw new Error("Skill 缺少非空的 SKILL.md");
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink())
    throw new Error("目标目录不能是符号链接");
  const target = join(root, name);
  await absent(target);
  const stage = await mkdtemp(join(root, ".skill-import-"));
  try {
    for (const entry of entries) {
      const dest = join(stage, portablePath(entry.path));
      if (!isWithin(stage, dest)) throw new Error("目标路径越界");
      await mkdir(entry.data ? dirname(dest) : dest, { recursive: true });
      if (entry.data) await writeFile(dest, entry.data, { flag: "wx" });
    }
    await absent(target);
    await rename(stage, target);
    return target;
  } finally {
    // Only this operation's freshly created staging directory can be removed.
    if (isWithin(root, stage) && basename(stage).startsWith(".skill-import-"))
      await rm(stage, { recursive: true, force: true });
  }
}

export async function importSkillDirectoryOrZip(
  source: string,
  root: string,
  name?: string,
): Promise<string> {
  const info = await lstat(source);
  if (info.isSymbolicLink())
    throw new Error("请选择实际 Skill 目录或 ZIP 文件");
  if (info.isDirectory())
    return publish(
      root,
      name || basename(source),
      await directoryEntries(source),
    );
  if (!info.isFile() || !source.toLowerCase().endsWith(".zip"))
    throw new Error("请选择 Skill 目录或 ZIP 文件");
  if (info.size > MAX_BYTES) throw new Error("ZIP 大小超过 64 MB");
  const archive = skillArchiveEntries(await readFile(source));
  return publish(root, name || archive.name, archive.entries);
}

export async function exportSkillDirectories(
  paths: string[],
  destination: string,
  roots: string[],
): Promise<number> {
  if (!paths.length) throw new Error("请先选择 Skill");
  const names = new Set<string>();
  const prepared: { name: string; entries: Entry[] }[] = [];
  for (const path of paths) {
    const source = resolve(path);
    if (
      !roots.some((root) => isWithin(root, source) && resolve(root) !== source)
    )
      throw new Error("Skill 路径越界");
    if (isWithin(source, destination))
      throw new Error("导出目标不能位于源 Skill 中");
    const info = await lstat(source);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("请选择实际 Skill 目录");
    const name = basename(source);
    if (names.has(name.toLowerCase()))
      throw new Error("选择的 Skills 存在同名目录，请分开导出");
    names.add(name.toLowerCase());
    await absent(join(destination, name));
    prepared.push({ name, entries: await directoryEntries(source) });
  }
  let count = 0;
  try {
    for (const item of prepared) {
      await publish(destination, item.name, item.entries);
      count++;
    }
  } catch (error) {
    throw new Error(
      `已导出 ${count}/${prepared.length} 个 Skill；${error instanceof Error ? error.message : "写入失败"}`,
    );
  }
  return count;
}
