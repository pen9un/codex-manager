import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@iarna/toml";
const fixture = vi.hoisted(() => ({ path: "" }));
vi.mock("../src/main/codex", () => ({ configPath: () => fixture.path }));
import { getMcpDetail, mergeMcp, readMcp } from "../src/main/mcp";
import { SECRET_PLACEHOLDER } from "../src/main/mcpSecrets";

describe("MCP editing preserves credentials and unrelated settings", () => {
  let dir: string;
  const original =
    'model = "fixture-model"\n[mcp_servers.docs]\ncommand = "node"\nargs = ["server.js", "--port", "1234"]\n[mcp_servers.docs.env]\nAPI_KEY = "private-test-value"\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "codex-mcp-config-"));
    fixture.path = join(dir, "config.toml");
    await writeFile(fixture.path, original);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns editable parameters without exposing environment secrets", async () => {
    const detail = await getMcpDetail("docs");
    expect(detail.args).toEqual(["server.js", "--port", "1234"]);
    expect(detail.env.API_KEY).toBe(SECRET_PLACEHOLDER);
  });

  it("preserves masked secrets when editing timeouts and keeps other services", async () => {
    const detail = await getMcpDetail("docs");
    await mergeMcp({ docs: { ...detail, tool_timeout_sec: 45 } });
    const saved = parse(await readFile(fixture.path, "utf8")) as any;
    expect(saved.model).toBe("fixture-model");
    expect(saved.mcp_servers.docs.args).toEqual([
      "server.js",
      "--port",
      "1234",
    ]);
    expect(saved.mcp_servers.docs.env.API_KEY).toBe("private-test-value");
    expect(saved.mcp_servers.docs.tool_timeout_sec).toBe(45);
    expect(saved.mcp_servers.other.url).toBe("https://example.test/mcp");
    const backup = (await readdir(dir)).find((name) =>
      name.startsWith("config.toml.bak-mcp-"),
    )!;
    expect(await readFile(join(dir, backup), "utf8")).toBe(original);
  });

  it("preserves omitted fields in partial import and rejects unknown masked credentials", async () => {
    await mergeMcp({ docs: { command: "node", enabled: false } });
    const { raw } = await readMcp();
    expect(raw.mcp_servers.docs.args).toEqual(["server.js", "--port", "1234"]);
    const before = await readFile(fixture.path, "utf8");
    await expect(
      mergeMcp({
        newServer: { command: "node", env: { API_KEY: SECRET_PLACEHOLDER } },
      }),
    ).rejects.toThrow("脱敏");
    expect(await readFile(fixture.path, "utf8")).toBe(before);
  });
});
