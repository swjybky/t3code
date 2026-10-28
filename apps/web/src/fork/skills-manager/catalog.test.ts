import { describe, expect, it } from "vite-plus/test";

import { buildSkillCatalog, type ConfiguredProvider, type SkillSource } from "./catalog";

const providers: readonly ConfiguredProvider[] = [
  { driver: "pi", label: "Pi" },
  { driver: "grok", label: "Grok" },
];

function skill(patch: Partial<SkillSource> & Pick<SkillSource, "name" | "path">): SkillSource {
  return {
    enabled: true,
    environmentId: "local",
    ...patch,
  };
}

describe("buildSkillCatalog", () => {
  it("keeps Agents separate and groups the rest by configured provider directories", () => {
    const catalog = buildSkillCatalog({
      providers,
      workspaceRoots: [{ environmentId: "local", root: "/work/t3code", projectName: "t3code" }],
      skills: [
        skill({
          name: "shared",
          path: "/home/dev/.agents/skills/shared/SKILL.md",
          scope: "user",
        }),
        skill({
          name: "deploy",
          path: "/work/t3code/.agents/skills/deploy/SKILL.md",
          scope: "project",
        }),
        skill({
          name: "pi-user",
          path: "/home/dev/.pi/agent/skills/pi-user/SKILL.md",
        }),
        skill({
          name: "pi-project",
          path: "/work/t3code/.pi/skills/pi-project/SKILL.md",
        }),
        skill({
          name: "grok-user",
          path: "/home/dev/.grok/skills/grok-user/SKILL.md",
          scope: "user",
        }),
        skill({
          name: "cursor-only",
          path: "/home/dev/.cursor/skills/cursor-only/SKILL.md",
        }),
        skill({
          name: "codex-via-cursor",
          path: "/home/dev/.codex/skills/codex-via-cursor/SKILL.md",
        }),
      ],
    });

    expect(
      catalog.user.map((group) => [group.label, group.skills.map((entry) => entry.name)]),
    ).toEqual([
      ["Agents", ["shared"]],
      ["Grok", ["grok-user"]],
      ["Pi", ["pi-user"]],
    ]);
    expect(
      catalog.project.map((group) => [group.label, group.skills.map((entry) => entry.name)]),
    ).toEqual([
      ["Agents", ["deploy"]],
      ["Grok", []],
      ["Pi", ["pi-project"]],
    ]);
  });

  it("sends Antigravity's legacy directory to Antigravity, not Agents", () => {
    const catalog = buildSkillCatalog({
      providers: [{ driver: "antigravity", label: "Antigravity" }],
      workspaceRoots: [{ environmentId: "local", root: "/work/app", projectName: "app" }],
      skills: [
        skill({ name: "shared", path: "/work/app/.agents/skills/shared/SKILL.md" }),
        skill({ name: "legacy", path: "/work/app/.agent/skills/legacy/SKILL.md" }),
        skill({ name: "gemini", path: "/home/dev/.gemini/config/skills/gemini/SKILL.md" }),
      ],
    });

    expect(
      catalog.project.find((group) => group.id === "agents")?.skills.map((entry) => entry.name),
    ).toEqual(["shared"]);
    expect(
      catalog.project
        .find((group) => group.id === "antigravity")
        ?.skills.map((entry) => entry.name),
    ).toEqual(["legacy"]);
    expect(
      catalog.user.find((group) => group.id === "antigravity")?.skills.map((entry) => entry.name),
    ).toEqual(["gemini"]);
  });

  it("reads OpenCode skills from .config/opencode", () => {
    const catalog = buildSkillCatalog({
      providers: [{ driver: "opencode", label: "OpenCode" }],
      workspaceRoots: [],
      skills: [
        skill({
          name: "review",
          path: "/home/dev/.config/opencode/skills/review/SKILL.md",
        }),
      ],
    });

    expect(
      catalog.user.find((group) => group.id === "opencode")?.skills.map((entry) => entry.name),
    ).toEqual(["review"]);
  });

  it("merges the same path and keeps a later description", () => {
    const catalog = buildSkillCatalog({
      providers,
      workspaceRoots: [],
      skills: [
        skill({ name: "ship", path: "/home/dev/.pi/skills/ship/SKILL.md", enabled: false }),
        skill({
          name: "ship",
          path: "/home/dev/.pi/skills/ship/SKILL.md",
          description: "Ship the change",
          enabled: true,
        }),
      ],
    });

    expect(catalog.user.find((group) => group.id === "pi")?.skills).toEqual([
      {
        name: "ship",
        path: "/home/dev/.pi/skills/ship/SKILL.md",
        description: "Ship the change",
        enabled: true,
        environmentId: "local",
      },
    ]);
  });

  it("leaves skills from other checkouts out of the selected project", () => {
    const catalog = buildSkillCatalog({
      providers,
      workspaceRoots: [{ environmentId: "local", root: "/work/t3code", projectName: "t3code" }],
      otherWorkspaceRoots: [{ environmentId: "local", root: "/work/other", projectName: "other" }],
      skills: [
        skill({ name: "here", path: "/work/t3code/.pi/skills/here/SKILL.md", scope: "project" }),
        skill({ name: "there", path: "/work/other/.pi/skills/there/SKILL.md", scope: "project" }),
        skill({ name: "home", path: "/home/dev/.pi/agent/skills/home/SKILL.md", scope: "user" }),
      ],
    });

    expect(
      catalog.project.find((group) => group.id === "pi")?.skills.map((entry) => entry.name),
    ).toEqual(["here"]);
    expect(
      catalog.user.find((group) => group.id === "pi")?.skills.map((entry) => entry.name),
    ).toEqual(["home"]);
  });

  it("returns nothing when no provider is configured", () => {
    expect(
      buildSkillCatalog({
        providers: [],
        workspaceRoots: [],
        skills: [skill({ name: "shared", path: "/home/dev/.agents/skills/shared/SKILL.md" })],
      }),
    ).toEqual({ user: [], project: [] });
  });
});
