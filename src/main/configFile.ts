import { parse, stringify } from "@iarna/toml";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";

export type ConfigDocument = ReturnType<typeof parse>;
export interface ConfigSnapshot {
  text: string | null;
  document: ConfigDocument;
}
const pending = new Map<string, Promise<unknown>>();

export async function readConfig(file: string): Promise<ConfigSnapshot> {
  let text: string;
  try {
    if ((await lstat(file)).isSymbolicLink())
      throw new Error("配置文件是符号链接，请编辑实际配置文件");
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { text: null, document: {} };
    throw error;
  }
  try {
    return { text, document: parse(text) };
  } catch {
    throw new Error("Codex 配置 TOML 格式无效，请修复后重试；未修改原文件");
  }
}

export async function commitConfig(
  file: string,
  before: ConfigSnapshot,
  document: ConfigDocument,
  kind = "config",
): Promise<string | undefined> {
  const run = async (): Promise<string | undefined> => {
    const text = stringify(document);
    parse(text);
    const current = await readConfig(file);
    if (before.text !== current.text)
      throw new Error("配置已被其他操作修改，请重新加载后再保存");
    if (text === before.text) return undefined;
    await mkdir(dirname(file), { recursive: true });
    const id = `${Date.now()}-${randomUUID()}`;
    const backup =
      before.text === null ? undefined : `${file}.bak-${kind}-${id}`;
    if (backup)
      await writeFile(backup, before.text!, { flag: "wx", mode: 0o600 });
    const temp = `${file}.tmp-${id}`;
    try {
      await writeFile(temp, text, { flag: "wx", mode: 0o600 });
      if ((await readConfig(file)).text !== before.text)
        throw new Error("保存期间配置发生变化，请重新加载");
      await rename(temp, file);
      return backup;
    } finally {
      await rm(temp, { force: true });
    }
  };
  const previous = pending.get(file) || Promise.resolve();
  const current = previous.catch(() => undefined).then(run);
  pending.set(file, current);
  try {
    return await current;
  } finally {
    if (pending.get(file) === current) pending.delete(file);
  }
}
