import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  exportSkillDirectories,
  importSkillDirectoryOrZip,
  isWithin,
  portablePath,
  skillArchiveEntries,
} from "../src/main/skillTransfer";

const skill = strToU8(
  "---\nname: example\ndescription: Local test skill\n---\n# Instructions\n",
);
describe("Skill import and export in isolated directories", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "codex-skill-transfer-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("round trips nested directories and binary resources without executing scripts", async () => {
    const source = join(root, "source");
    await mkdir(join(source, "assets", "empty"), { recursive: true });
    await writeFile(join(source, "SKILL.md"), skill);
    await writeFile(
      join(source, "assets", "binary.dat"),
      Buffer.from([0, 255, 1, 0]),
    );
    await writeFile(
      join(source, "danger.bat"),
      "echo should-not-run > side-effect.txt",
    );
    const imported = await importSkillDirectoryOrZip(
      source,
      join(root, "installed"),
    );
    expect(
      await exportSkillDirectories([imported], join(root, "export"), [
        join(root, "installed"),
      ]),
    ).toBe(1);
    expect(
      await readFile(join(root, "export", "source", "assets", "binary.dat")),
    ).toEqual(Buffer.from([0, 255, 1, 0]));
    expect(
      await readdir(join(root, "export", "source", "assets", "empty")),
    ).toEqual([]);
    expect(await readdir(root)).not.toContain("side-effect.txt");
  });

  it("imports a wrapped ZIP and excludes unrelated siblings", async () => {
    const zip = zipSync({
      "bundle/example/SKILL.md": skill,
      "bundle/example/assets/data.bin": new Uint8Array([7, 8]),
      "bundle/README.md": strToU8("not part of this skill"),
    });
    const source = join(root, "sample.zip");
    await writeFile(source, zip);
    const imported = await importSkillDirectoryOrZip(
      source,
      join(root, "installed"),
    );
    expect((await readdir(imported)).sort()).toEqual(
      ["SKILL.md", "assets"].sort(),
    );
    expect(await readFile(join(imported, "assets", "data.bin"))).toEqual(
      Buffer.from([7, 8]),
    );
  });

  it.each([
    "../escape",
    "C:\\escape",
    "\\server\\share",
    "a/../../escape",
    "file:stream",
    "NUL",
    "a/../b",
    "/absolute",
  ])("rejects unsafe portable path %s", (path) => {
    expect(() => portablePath(path)).toThrow();
  });

  it("rejects a malicious ZIP before any destination is published", async () => {
    const source = join(root, "bad.zip");
    await writeFile(
      source,
      zipSync({ "SKILL.md": skill, "..\\escape.txt": strToU8("bad") }),
    );
    await expect(
      importSkillDirectoryOrZip(source, join(root, "installed")),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(["bad.zip"]);
  });

  it("rejects archives containing multiple Skills or case collisions", () => {
    expect(() =>
      skillArchiveEntries(
        zipSync({ "a/SKILL.md": skill, "b/SKILL.md": skill }),
      ),
    ).toThrow();
    expect(() =>
      skillArchiveEntries(zipSync({ "SKILL.md": skill, "skill.md": skill })),
    ).toThrow();
  });

  it("refuses overwrite and leaves the existing directory byte-identical", async () => {
    const source = join(root, "one.zip");
    await writeFile(source, zipSync({ "SKILL.md": skill }));
    const target = await importSkillDirectoryOrZip(
      source,
      join(root, "installed"),
    );
    await expect(
      importSkillDirectoryOrZip(source, join(root, "installed")),
    ).rejects.toThrow("目标已存在");
    expect(await readFile(join(target, "SKILL.md"))).toEqual(
      Buffer.from(skill),
    );
    expect(await readdir(join(root, "installed"))).toEqual(["skill"]);
  });

  it("validates every selection before exporting and rejects self export", async () => {
    const source = join(root, "one.zip");
    await writeFile(source, zipSync({ "SKILL.md": skill }));
    const target = await importSkillDirectoryOrZip(
      source,
      join(root, "installed"),
    );
    await expect(
      exportSkillDirectories([target, root], join(root, "export"), [
        join(root, "installed"),
      ]),
    ).rejects.toThrow();
    expect(await readdir(root)).not.toContain("export");
    await expect(
      exportSkillDirectories([target], join(target, "export"), [
        join(root, "installed"),
      ]),
    ).rejects.toThrow();
    expect(isWithin(join(root, "installed"), root)).toBe(false);
  });
});
