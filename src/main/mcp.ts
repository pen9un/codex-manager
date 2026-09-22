import { parse } from "@iarna/toml";
import { readFile, readdir } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import { configPath } from "./codex";
import { redactMcp, restoreMcpSecrets } from "./mcpSecrets";
import { commitConfig, readConfig } from "./configFile";
import type { McpServerSummary } from "../shared/types";

type AnyRecord = Record<string, any>;
const asRecord = (value: unknown): AnyRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : {};
export const redact = redactMcp;
export async function readMcp(): Promise<{
  servers: McpServerSummary[];
  raw: AnyRecord;
}> {
  let rawText = "";
  try {
    rawText = await readFile(configPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const document = asRecord(rawText ? parse(rawText) : {});
  const servers = asRecord(document.mcp_servers);
  return {
    raw: document,
    servers: Object.entries(servers).map(([name, value]) => {
      const item = asRecord(redactMcp(value));
      const transport = item.url ? "http" : "stdio";
      return {
        name,
        transport,
        enabled: item.enabled !== false,
        command: item.command,
        url: item.url,
        tools: Array.isArray(item.enabled_tools)
          ? item.enabled_tools
          : undefined,
        disabledTools: Array.isArray(item.disabled_tools)
          ? item.disabled_tools
          : undefined,
        approvalMode: ["auto", "prompt", "writes", "approve"].includes(
          item.default_tools_approval_mode,
        )
          ? item.default_tools_approval_mode
          : undefined,
        startupTimeoutSec:
          typeof item.startup_timeout_sec === "number"
            ? item.startup_timeout_sec
            : undefined,
        toolTimeoutSec:
          typeof item.tool_timeout_sec === "number"
            ? item.tool_timeout_sec
            : undefined,
        source: "config",
      };
    }),
  };
}
export function jsonToMcp(value: unknown): AnyRecord {
  const root = asRecord(value);
  const servers = asRecord(root.mcpServers || root.mcp_servers);
  if (!Object.keys(servers).length) throw new Error("JSON 中没有 mcpServers");
  const result: AnyRecord = {};
  for (const [name, item] of Object.entries(servers)) {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`MCP 名称非法：${name}`);
    const server = asRecord(item);
    if (!server.command && !server.url)
      throw new Error(`MCP「${name}」必须提供 command 或 url`);
    if (server.command && server.url)
      throw new Error(`MCP「${name}」不能同时提供 command 和 url`);
    if (
      server.default_tools_approval_mode !== undefined &&
      !["auto", "prompt", "writes", "approve"].includes(
        server.default_tools_approval_mode,
      )
    )
      throw new Error(`MCP「${name}」审批模式无效`);
    for (const key of ["startup_timeout_sec", "tool_timeout_sec"])
      if (
        server[key] !== undefined &&
        (!Number.isFinite(server[key]) || server[key] <= 0)
      )
        throw new Error(`MCP「${name}」超时必须为正数`);
    result[name] = { ...server };
  }
  return result;
}
export async function writeMcp(servers: AnyRecord): Promise<void> {
  const file = configPath();
  const before = await readConfig(file);
  await commitConfig(
    file,
    before,
    { ...before.document, mcp_servers: servers },
    "mcp",
  );
}
export async function mergeMcp(servers: AnyRecord): Promise<void> {
  const file = configPath();
  const before = await readConfig(file);
  const existing = asRecord(before.document.mcp_servers);
  const merged = { ...existing };
  for (const [name, server] of Object.entries(servers)) {
    merged[name] = restoreMcpSecrets(
      { ...asRecord(existing[name]), ...asRecord(server) },
      existing[name],
    );
  }
  jsonToMcp({ mcpServers: merged });
  await commitConfig(
    file,
    before,
    { ...before.document, mcp_servers: merged },
    "mcp",
  );
}
export async function getMcpDetail(name: string): Promise<AnyRecord> {
  const current = asRecord((await readMcp()).raw.mcp_servers);
  if (!Object.hasOwn(current, name)) throw new Error("MCP 不存在");
  return redact(current[name]);
}
export async function setMcpEnabled(
  name: string,
  enabled: boolean,
): Promise<void> {
  if (typeof enabled !== "boolean") throw new Error("启用状态必须为布尔值");
  const file = configPath();
  const before = await readConfig(file);
  const servers = asRecord(before.document.mcp_servers);
  if (!Object.hasOwn(servers, name)) throw new Error("MCP 不存在");
  await commitConfig(
    file,
    before,
    {
      ...before.document,
      mcp_servers: {
        ...servers,
        [name]: { ...asRecord(servers[name]), enabled },
      },
    },
    "mcp",
  );
}
export async function saveMcp(name: string, value: unknown): Promise<void> {
  const validated = jsonToMcp({ mcpServers: { [name]: value } });
  await mergeMcp(validated);
}
export async function removeMcp(name: string): Promise<void> {
  const file = configPath();
  const before = await readConfig(file);
  const servers = { ...asRecord(before.document.mcp_servers) };
  if (!Object.hasOwn(servers, name)) throw new Error("MCP 不存在");
  delete servers[name];
  await commitConfig(
    file,
    before,
    { ...before.document, mcp_servers: servers },
    "mcp",
  );
}
export async function listMcpBackups(): Promise<string[]> {
  const dir = dirname(configPath());
  try {
    return (await readdir(dir))
      .filter((name) => name.startsWith(`${basename(configPath())}.bak-`))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
export async function rollbackMcpBackup(name: string): Promise<void> {
  if (!/^config\.toml\.bak-[\w.-]+$/.test(name))
    throw new Error("备份名称非法");
  const source = join(dirname(configPath()), name);
  const before = await readConfig(configPath());
  const backup = await readConfig(source);
  if (backup.text === null) throw new Error("备份不存在，请重新加载");
  const servers = asRecord(backup.document.mcp_servers);
  if (Object.keys(servers).length) jsonToMcp({ mcpServers: servers });
  await commitConfig(configPath(), before, { ...before.document, mcp_servers: servers }, "rollback");
}
export async function diffMcpBackup(name: string): Promise<{ current: AnyRecord; backup: AnyRecord }> {
  if (!/^config\.toml\.bak-[\w.-]+$/.test(name)) throw new Error("备份名称非法");
  const source = join(dirname(configPath()), name);
  const [currentText, backupText] = await Promise.all([readFile(configPath(), "utf8").catch(() => ""), readFile(source, "utf8")]);
  return { current: redact(parse(currentText || "")), backup: redact(parse(backupText)) };
}
