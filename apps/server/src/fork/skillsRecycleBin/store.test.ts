// @effect-diagnostics nodeBuiltinImport:off -- Builds a disposable skill tree for the recycle bin.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";

import { runSkillsBin, SkillsBinError, type OpenedProject } from "./store.ts";

async function writeSkill(directory: string, name: string, description?: string) {
  await NodeFSP.mkdir(directory, { recursive: true });
  const descriptionLine = description === undefined ? "" : `\ndescription: ${description}`;
  await NodeFSP.writeFile(
    NodePath.join(directory, "SKILL.md"),
    `---\nname: ${name}${descriptionLine}\n---\n\n# ${name}\n`,
  );
}

it("lists opened-project skills separately and moves a skill through the recycle bin", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-bin-"));
  const home = NodePath.join(root, "home");
  const project = NodePath.join(root, "project");
  const binRoot = NodePath.join(root, "bin");
  const projects: readonly OpenedProject[] = [{ root: project, title: "Demo" }];
  const context = { home, binRoot, projects };
  try {
    await writeSkill(NodePath.join(home, ".agents", "skills", "browser"), "Browser", "Opens pages");
    await writeSkill(NodePath.join(home, ".grok", "skills", "search"), "Search");
    await writeSkill(NodePath.join(home, ".agent", "skills", "not-user"), "Not user");
    await writeSkill(NodePath.join(home, "notes"), "Notes");
    await writeSkill(
      NodePath.join(project, ".agents", "skills", "group", "review"),
      "Review",
      "Checks a diff",
    );
    await writeSkill(NodePath.join(project, ".agent", "skills", "legacy"), "Legacy");
    await writeSkill(NodePath.join(root, "elsewhere"), "Elsewhere");

    const listed = await runSkillsBin(context, { op: "list" });
    expect(listed.user.map((skill) => skill.name)).toEqual(["Browser", "Search"]);
    expect(listed.user.find((skill) => skill.name === "Browser")).toMatchObject({
      description: "Opens pages",
      driver: "agents",
      dotDir: ".agents",
    });
    expect(listed.user.find((skill) => skill.name === "Search")?.driver).toBe("grok");
    expect(listed.projects).toEqual([
      expect.objectContaining({
        title: "Demo",
        skills: [
          expect.objectContaining({ name: "Legacy", driver: "antigravity", dotDir: ".agent" }),
          expect.objectContaining({
            name: "Review",
            driver: "agents",
            description: "Checks a diff",
          }),
        ],
      }),
    ]);

    const browser = listed.user.find((skill) => skill.name === "Browser");
    expect(browser).toBeDefined();
    const trashed = await runSkillsBin(context, { op: "trash", path: browser?.path ?? "" });
    expect(trashed.user.map((skill) => skill.name)).toEqual(["Search"]);
    expect(trashed.bin).toHaveLength(1);
    expect(trashed.bin[0]).toMatchObject({
      name: "Browser",
      collection: "user",
      driver: "agents",
    });
    await expect(NodeFSP.stat(browser?.directory ?? "")).rejects.toThrow();
    const saved = await NodeFSP.readFile(
      NodePath.join(binRoot, trashed.bin[0]?.id ?? "", "skill", "SKILL.md"),
      "utf8",
    );
    expect(saved).toContain("name: Browser");

    const restored = await runSkillsBin(context, { op: "restore", id: trashed.bin[0]?.id ?? "" });
    expect(restored.bin).toEqual([]);
    expect(restored.user.map((skill) => skill.name)).toEqual(["Browser", "Search"]);
    const restoredFile = await NodeFSP.readFile(browser?.path ?? "", "utf8");
    expect(restoredFile).toContain("name: Browser");
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});

it("refuses paths outside a skill directory and an occupied restore destination", async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-skills-bin-"));
  const home = NodePath.join(root, "home");
  const binRoot = NodePath.join(root, "bin");
  const context = { home, binRoot, projects: [] };
  try {
    await writeSkill(NodePath.join(home, ".agents", "skills"), "Root itself");
    await writeSkill(NodePath.join(home, ".codex", "skills", "dash"), "Dash");
    await writeSkill(NodePath.join(root, "loose"), "Loose");

    await expect(
      runSkillsBin(context, {
        op: "trash",
        path: NodePath.join(home, ".agents", "skills", "SKILL.md"),
      }),
    ).rejects.toBeInstanceOf(SkillsBinError);
    await expect(
      runSkillsBin(context, { op: "trash", path: NodePath.join(root, "loose", "SKILL.md") }),
    ).rejects.toBeInstanceOf(SkillsBinError);
    await expect(
      NodeFSP.stat(NodePath.join(home, ".codex", "skills", "dash", "SKILL.md")),
    ).resolves.toBeDefined();

    const listed = await runSkillsBin(context, { op: "list" });
    const dash = listed.user.find((skill) => skill.name === "Dash");
    const trashed = await runSkillsBin(context, { op: "trash", path: dash?.path ?? "" });
    await writeSkill(NodePath.join(home, ".codex", "skills", "dash"), "Replacement");
    await expect(
      runSkillsBin(context, { op: "restore", id: trashed.bin[0]?.id ?? "" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await NodeFSP.readFile(NodePath.join(home, ".codex", "skills", "dash", "SKILL.md"), "utf8"),
    ).toContain("name: Replacement");
    const stillBinned = await runSkillsBin(context, { op: "list" });
    expect(stillBinned.bin.map((entry) => entry.name)).toEqual(["Dash"]);
  } finally {
    await NodeFSP.rm(root, { recursive: true, force: true });
  }
});
