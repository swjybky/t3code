/** `.agent` is Antigravity's legacy directory. `.agents` is the shared catalog. */
const AGENTS_DOT_DIR = ".agents";

const DOT_DIR_OWNERS = [
  { driver: "codex", label: "Codex", dotDirs: [".codex"] },
  { driver: "claudeAgent", label: "Claude", dotDirs: [".claude"] },
  { driver: "cursor", label: "Cursor", dotDirs: [".cursor"] },
  { driver: "grok", label: "Grok", dotDirs: [".grok"] },
  { driver: "opencode", label: "OpenCode", dotDirs: [".opencode"] },
  { driver: "pi", label: "Pi", dotDirs: [".pi"] },
  { driver: "antigravity", label: "Antigravity", dotDirs: [".gemini", ".agent"] },
  { driver: "fx", label: "fx", dotDirs: [".fx"] },
  { driver: "muse", label: "Muse", dotDirs: [".muse"] },
] as const;

const KNOWN_DOT_DIRS = new Set<string>(DOT_DIR_OWNERS.flatMap((owner) => [...owner.dotDirs]));

const PROJECT_SCOPES = new Set(["project", "workspace", "local", "repo", "repository"]);

const DRIVER_RANK = new Map<string, number>(
  DOT_DIR_OWNERS.map((owner, index) => [owner.driver, index]),
);

export interface SkillSource {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly path: string;
  readonly enabled: boolean;
  readonly scope?: string | undefined;
  readonly environmentId: string;
  readonly environmentLabel?: string | undefined;
}

export interface ConfiguredProvider {
  readonly driver: string;
  readonly label: string;
}

export interface WorkspaceRoot {
  readonly environmentId: string;
  readonly root: string;
  readonly projectName: string;
}

export interface CatalogSkill {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
  readonly path: string;
  readonly enabled: boolean;
  readonly environmentId: string;
  readonly environmentLabel?: string | undefined;
  readonly projectName?: string | undefined;
}

export interface SkillCatalogGroup {
  readonly id: string;
  readonly label: string;
  readonly dotDir: string;
  readonly skills: readonly CatalogSkill[];
}

export interface SkillCatalog {
  readonly user: readonly SkillCatalogGroup[];
  readonly project: readonly SkillCatalogGroup[];
}

export function labelForDriver(driver: string, displayName?: string): string {
  return DOT_DIR_OWNERS.find((owner) => owner.driver === driver)?.label ?? displayName ?? driver;
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.length === 0 ? "/" : normalized;
}

function dotDirsForDriver(driver: string): readonly string[] {
  return DOT_DIR_OWNERS.find((owner) => owner.driver === driver)?.dotDirs ?? [`.${driver}`];
}

function skillDotDir(path: string, extraDotDirs: ReadonlySet<string>): string | null {
  const segments = normalizePath(path).split("/");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    if (segment === AGENTS_DOT_DIR) return AGENTS_DOT_DIR;
    if (segment === ".config" && segments[index + 1] === "opencode") return ".opencode";
    if (KNOWN_DOT_DIRS.has(segment) || extraDotDirs.has(segment)) return segment;
  }
  return null;
}

function matchingProject(
  skill: SkillSource,
  workspaceRoots: readonly WorkspaceRoot[],
): WorkspaceRoot | undefined {
  const path = normalizePath(skill.path);
  let match: WorkspaceRoot | undefined;
  let matchLength = -1;
  for (const root of workspaceRoots) {
    if (root.environmentId !== skill.environmentId) continue;
    const normalizedRoot = normalizePath(root.root);
    const inside = path === normalizedRoot || path.startsWith(`${normalizedRoot}/`);
    if (!inside || normalizedRoot.length <= matchLength) continue;
    match = root;
    matchLength = normalizedRoot.length;
  }
  return match;
}

function isProjectScope(scope: string | undefined): boolean {
  return scope !== undefined && PROJECT_SCOPES.has(scope.trim().toLowerCase());
}

function preferSkill(current: CatalogSkill, next: CatalogSkill): CatalogSkill {
  const description = current.description ?? next.description;
  const displayName = current.displayName ?? next.displayName;
  const projectName = current.projectName ?? next.projectName;
  const environmentLabel = current.environmentLabel ?? next.environmentLabel;
  return {
    name: current.name,
    path: current.path,
    enabled: current.enabled || next.enabled,
    environmentId: current.environmentId,
    ...(description ? { description } : {}),
    ...(displayName ? { displayName } : {}),
    ...(projectName ? { projectName } : {}),
    ...(environmentLabel ? { environmentLabel } : {}),
  };
}

function sortSkills(skills: readonly CatalogSkill[]): CatalogSkill[] {
  return [...skills].sort((left, right) =>
    (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name),
  );
}

export function buildSkillCatalog(input: {
  readonly providers: readonly ConfiguredProvider[];
  readonly skills: readonly SkillSource[];
  readonly workspaceRoots: readonly WorkspaceRoot[];
  readonly otherWorkspaceRoots?: readonly WorkspaceRoot[];
}): SkillCatalog {
  if (input.providers.length === 0) return { user: [], project: [] };

  const providers = [...input.providers].sort((left, right) => {
    const rank = (DRIVER_RANK.get(left.driver) ?? 1_000) - (DRIVER_RANK.get(right.driver) ?? 1_000);
    return rank === 0 ? left.label.localeCompare(right.label) : rank;
  });
  const extraDotDirs = new Set<string>();
  const driverByDotDir = new Map<string, string>();
  for (const provider of providers) {
    for (const dotDir of dotDirsForDriver(provider.driver)) {
      if (!KNOWN_DOT_DIRS.has(dotDir)) extraDotDirs.add(dotDir);
      if (!driverByDotDir.has(dotDir)) driverByDotDir.set(dotDir, provider.driver);
    }
  }

  const buckets = new Map<string, Map<string, CatalogSkill>>();
  const bucket = (driver: string, collection: "user" | "project") => {
    const id = `${collection}:${driver}`;
    const existing = buckets.get(id);
    if (existing) return existing;
    const created = new Map<string, CatalogSkill>();
    buckets.set(id, created);
    return created;
  };

  for (const skill of input.skills) {
    const dotDir = skillDotDir(skill.path, extraDotDirs);
    if (!dotDir) continue;
    const driver = dotDir === AGENTS_DOT_DIR ? "agents" : driverByDotDir.get(dotDir);
    if (!driver) continue;
    const project = matchingProject(skill, input.workspaceRoots);
    const outsideSelection =
      !project &&
      (matchingProject(skill, input.otherWorkspaceRoots ?? []) !== undefined ||
        (input.workspaceRoots.length > 0 && isProjectScope(skill.scope)));
    if (outsideSelection) continue;
    const next: CatalogSkill = {
      name: skill.name,
      path: skill.path,
      enabled: skill.enabled,
      environmentId: skill.environmentId,
      ...(skill.displayName ? { displayName: skill.displayName } : {}),
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.environmentLabel ? { environmentLabel: skill.environmentLabel } : {}),
      ...(project ? { projectName: project.projectName } : {}),
    };
    const collection = project ? "project" : "user";
    const skills = bucket(driver, collection);
    const key = `${skill.environmentId}:${normalizePath(skill.path)}`;
    const previous = skills.get(key);
    skills.set(key, previous ? preferSkill(previous, next) : next);
  }

  const skillsFor = (driver: string, collection: "user" | "project") =>
    sortSkills([...(buckets.get(`${collection}:${driver}`)?.values() ?? [])]);

  const toGroups = (collection: "user" | "project"): SkillCatalogGroup[] => [
    {
      id: "agents",
      label: "Agents",
      dotDir: AGENTS_DOT_DIR,
      skills: skillsFor("agents", collection),
    },
    ...providers.map((provider) => ({
      id: provider.driver,
      label: provider.label,
      dotDir: dotDirsForDriver(provider.driver)[0] ?? `.${provider.driver}`,
      skills: skillsFor(provider.driver, collection),
    })),
  ];

  return { user: toGroups("user"), project: toGroups("project") };
}
