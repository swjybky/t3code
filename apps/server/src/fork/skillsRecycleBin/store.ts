// @effect-diagnostics nodeBuiltinImport:off globalDate:off -- Skill directories live outside project roots, so this moves them with Node's filesystem.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export interface OpenedProject {
  readonly root: string;
  readonly title: string;
}

export interface ManagedSkill {
  readonly name: string;
  readonly description?: string;
  readonly path: string;
  readonly directory: string;
  readonly driver: string;
  readonly dotDir: string;
}

export interface ManagedProjectSkills {
  readonly root: string;
  readonly title: string;
  readonly skills: readonly ManagedSkill[];
}

export interface RecycledSkill {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly originalPath: string;
  readonly driver: string;
  readonly dotDir: string;
  readonly collection: "user" | "project";
  readonly projectRoot?: string;
  readonly projectTitle?: string;
  readonly deletedAt: string;
}

export interface SkillsManagerCatalog {
  readonly user: readonly ManagedSkill[];
  readonly projects: readonly ManagedProjectSkills[];
  readonly bin: readonly RecycledSkill[];
}

export class SkillsBinError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SkillsBinError";
    this.status = status;
  }
}

interface SkillRoot {
  readonly segments: readonly string[];
  readonly driver: string;
  readonly dotDir: string;
  readonly where: "user" | "project" | "both";
}

const SKILL_ROOTS: readonly SkillRoot[] = [
  { segments: [".agents", "skills"], driver: "agents", dotDir: ".agents", where: "both" },
  { segments: [".pi", "agent", "skills"], driver: "pi", dotDir: ".pi", where: "both" },
  { segments: [".pi", "skills"], driver: "pi", dotDir: ".pi", where: "both" },
  { segments: [".grok", "skills"], driver: "grok", dotDir: ".grok", where: "both" },
  { segments: [".cursor", "skills"], driver: "cursor", dotDir: ".cursor", where: "both" },
  {
    segments: [".cursor", "skills-cursor"],
    driver: "cursor",
    dotDir: ".cursor",
    where: "user",
  },
  { segments: [".claude", "skills"], driver: "claudeAgent", dotDir: ".claude", where: "both" },
  { segments: [".codex", "skills"], driver: "codex", dotDir: ".codex", where: "both" },
  { segments: [".opencode", "skills"], driver: "opencode", dotDir: ".opencode", where: "both" },
  {
    segments: [".config", "opencode", "skills"],
    driver: "opencode",
    dotDir: ".opencode",
    where: "user",
  },
  {
    segments: [".gemini", "config", "skills"],
    driver: "antigravity",
    dotDir: ".gemini",
    where: "user",
  },
  {
    segments: [".gemini", "antigravity-cli", "skills"],
    driver: "antigravity",
    dotDir: ".gemini",
    where: "user",
  },
  { segments: [".gemini", "skills"], driver: "antigravity", dotDir: ".gemini", where: "project" },
  { segments: [".agent", "skills"], driver: "antigravity", dotDir: ".agent", where: "project" },
  { segments: [".fx", "skills"], driver: "fx", dotDir: ".fx", where: "both" },
  { segments: [".muse", "skills"], driver: "muse", dotDir: ".muse", where: "both" },
];

const SKILL_FILE = "SKILL.md";
const MAX_SKILLS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SkillMatch {
  readonly collection: "user" | "project";
  readonly driver: string;
  readonly dotDir: string;
  readonly skillRoot: string;
  readonly projectRoot?: string;
  readonly projectTitle?: string;
}

interface BinMeta {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly originalDirectory: string;
  readonly driver: string;
  readonly dotDir: string;
  readonly collection: "user" | "project";
  readonly projectRoot?: string;
  readonly projectTitle?: string;
  readonly deletedAt: string;
}

interface BinContext {
  readonly home: string;
  readonly binRoot: string;
  readonly projects: readonly OpenedProject[];
}

let pending: Promise<void> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = pending.then(operation, operation);
  pending = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function skillsBinRoot(baseDir: string): string {
  return NodePath.join(baseDir, "skills-recycle-bin");
}

export function skillsUserHome(): string {
  return NodeOS.homedir();
}

export function runSkillsBin(context: BinContext, body: unknown): Promise<SkillsManagerCatalog> {
  return exclusive(() => dispatch(context, body));
}

async function dispatch(context: BinContext, body: unknown): Promise<SkillsManagerCatalog> {
  const request = readRequest(body);
  const resolved = { ...context, projects: await usableProjects(context) };
  if (request.op === "trash") {
    await trashSkill(resolved, request.path);
  } else if (request.op === "restore") {
    await restoreSkill(resolved, request.id);
  }
  return listCatalog(resolved);
}

function readRequest(
  body: unknown,
): { op: "list" } | { op: "trash"; path: string } | { op: "restore"; id: string } {
  if (typeof body !== "object" || body === null) {
    throw new SkillsBinError("The request was not valid.");
  }
  const op = "op" in body ? body.op : undefined;
  if (op === "list") return { op };
  if (
    op === "trash" &&
    "path" in body &&
    typeof body.path === "string" &&
    body.path.length < 4096
  ) {
    return { op, path: body.path };
  }
  if (
    op === "restore" &&
    "id" in body &&
    typeof body.id === "string" &&
    UUID_PATTERN.test(body.id)
  ) {
    return { op, id: body.id };
  }
  throw new SkillsBinError("The request was not valid.");
}

async function listCatalog(context: BinContext): Promise<SkillsManagerCatalog> {
  const home = NodePath.resolve(context.home);
  const projects = context.projects;
  const user = await scanBase(home, "user", context.binRoot);
  const projectSkills: ManagedProjectSkills[] = [];
  for (const project of projects) {
    projectSkills.push({
      root: project.root,
      title: project.title,
      skills: (await scanBase(project.root, "project", context.binRoot)).sort(byName),
    });
  }
  return {
    user: user.sort(byName),
    projects: projectSkills.sort((left, right) => left.title.localeCompare(right.title)),
    bin: await listBin(context),
  };
}

async function usableProjects(context: BinContext): Promise<OpenedProject[]> {
  const home = NodePath.resolve(context.home);
  const blocked = new Set([home, NodePath.parse(home).root, NodePath.resolve(context.binRoot)]);
  const seen = new Set<string>();
  const projects: OpenedProject[] = [];
  for (const project of [...context.projects].sort((left, right) =>
    left.title.localeCompare(right.title),
  )) {
    const root = NodePath.resolve(project.root);
    if (blocked.has(root) || isInside(context.binRoot, root) || seen.has(root)) continue;
    if (!(await exists(root))) continue;
    const real = await NodeFSP.realpath(root).catch(() => null);
    if (real === null || seen.has(real) || isInside(context.binRoot, real)) continue;
    seen.add(root);
    seen.add(real);
    projects.push({ root: real, title: project.title });
  }
  return projects;
}

async function scanBase(
  base: string,
  where: "user" | "project",
  binRoot: string,
): Promise<ManagedSkill[]> {
  const skills: ManagedSkill[] = [];
  for (const root of SKILL_ROOTS) {
    if (root.where !== "both" && root.where !== where) continue;
    if (skills.length >= MAX_SKILLS) break;
    const skillRoot = NodePath.join(base, ...root.segments);
    if (!(await exists(skillRoot))) continue;
    const realRoot = await NodeFSP.realpath(skillRoot).catch(() => null);
    if (realRoot === null || isInside(binRoot, realRoot)) continue;
    await walkSkills(realRoot, realRoot, 0, skills, binRoot, root);
  }
  return skills;
}

async function walkSkills(
  skillRoot: string,
  directory: string,
  depth: number,
  skills: ManagedSkill[],
  binRoot: string,
  root: SkillRoot,
): Promise<void> {
  if (skills.length >= MAX_SKILLS || depth > 4 || isInside(binRoot, directory)) return;
  const entries = await NodeFSP.readdir(directory, { withFileTypes: true }).catch(() => null);
  if (entries === null) return;
  if (entries.some((entry) => entry.isFile() && entry.name === SKILL_FILE)) {
    const realDirectory = await NodeFSP.realpath(directory).catch(() => null);
    if (
      realDirectory === null ||
      realDirectory === skillRoot ||
      !isInside(skillRoot, realDirectory) ||
      isInside(binRoot, realDirectory)
    ) {
      return;
    }
    const meta = await readSkillMeta(realDirectory);
    skills.push({
      name: meta.name,
      ...(meta.description === undefined ? {} : { description: meta.description }),
      path: NodePath.join(realDirectory, SKILL_FILE),
      directory: realDirectory,
      driver: root.driver,
      dotDir: root.dotDir,
    });
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) {
      continue;
    }
    await walkSkills(
      skillRoot,
      NodePath.join(directory, entry.name),
      depth + 1,
      skills,
      binRoot,
      root,
    );
  }
}

async function trashSkill(context: BinContext, skillPath: string): Promise<void> {
  const resolved = NodePath.resolve(skillPath);
  if (NodePath.basename(resolved) !== SKILL_FILE) {
    throw new SkillsBinError("Choose a skill file to move into the recycle bin.");
  }
  const directory = await NodeFSP.realpath(NodePath.dirname(resolved)).catch(() => null);
  const file = await NodeFSP.realpath(resolved).catch(() => null);
  if (directory === null || file === null || NodePath.dirname(file) !== directory) {
    throw new SkillsBinError("That skill is no longer on disk.");
  }
  const match = matchSkillDirectory(directory, context);
  if (match === null || isInside(context.binRoot, directory)) {
    throw new SkillsBinError("That path is not a skill this app can move.");
  }
  const id = NodeCrypto.randomUUID();
  const itemDir = NodePath.join(context.binRoot, id);
  const payload = NodePath.join(itemDir, "skill");
  const meta = await readSkillMeta(directory);
  const record: BinMeta = {
    id,
    name: meta.name,
    ...(meta.description === undefined ? {} : { description: meta.description }),
    originalDirectory: directory,
    driver: match.driver,
    dotDir: match.dotDir,
    collection: match.collection,
    ...(match.projectRoot === undefined ? {} : { projectRoot: match.projectRoot }),
    ...(match.projectTitle === undefined ? {} : { projectTitle: match.projectTitle }),
    deletedAt: new Date().toISOString(),
  };
  await NodeFSP.mkdir(itemDir, { recursive: true });
  try {
    await moveDir(directory, payload);
    await NodeFSP.writeFile(NodePath.join(itemDir, "meta.json"), JSON.stringify(record), "utf8");
  } catch (error) {
    if ((await exists(payload)) && !(await exists(directory))) {
      await moveDir(payload, directory).catch(() => undefined);
    }
    await NodeFSP.rm(itemDir, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof SkillsBinError) throw error;
    throw new SkillsBinError("Could not move that skill into the recycle bin.", 500);
  }
}

async function restoreSkill(context: BinContext, id: string): Promise<void> {
  const itemDir = NodePath.join(context.binRoot, id);
  const payload = NodePath.join(itemDir, "skill");
  const meta = await readMeta(itemDir);
  if (meta === null || !(await exists(payload))) {
    throw new SkillsBinError("That recycled skill is no longer in the bin.");
  }
  const realPayload = await NodeFSP.realpath(payload).catch(() => null);
  if (realPayload === null || !isInside(itemDir, realPayload)) {
    throw new SkillsBinError("That recycled skill is no longer in the bin.");
  }
  const destination = NodePath.resolve(meta.originalDirectory);
  const match = matchSkillDirectory(destination, context);
  if (
    match === null ||
    isInside(context.binRoot, destination) ||
    !isInsideOrEqual(match.skillRoot, NodePath.dirname(destination))
  ) {
    throw new SkillsBinError(
      "The original location is no longer a skill directory this app can restore to.",
    );
  }
  if (await exists(destination)) {
    throw new SkillsBinError("A skill is already at the original path.", 409);
  }
  await NodeFSP.mkdir(NodePath.dirname(destination), { recursive: true });
  try {
    await moveDir(realPayload, destination);
  } catch (error) {
    if (error instanceof SkillsBinError) throw error;
    throw new SkillsBinError("Could not restore that skill.", 500);
  }
  await NodeFSP.rm(itemDir, { recursive: true, force: true }).catch(() => undefined);
}

async function listBin(context: BinContext): Promise<RecycledSkill[]> {
  const entries = await NodeFSP.readdir(context.binRoot, { withFileTypes: true }).catch(() => []);
  const recycled: RecycledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_PATTERN.test(entry.name)) continue;
    const itemDir = NodePath.join(context.binRoot, entry.name);
    const meta = await readMeta(itemDir);
    if (meta === null || !(await exists(NodePath.join(itemDir, "skill")))) continue;
    recycled.push({
      id: meta.id,
      name: meta.name,
      ...(meta.description === undefined ? {} : { description: meta.description }),
      originalPath: NodePath.join(meta.originalDirectory, SKILL_FILE),
      driver: meta.driver,
      dotDir: meta.dotDir,
      collection: meta.collection,
      ...(meta.projectRoot === undefined ? {} : { projectRoot: meta.projectRoot }),
      ...(meta.projectTitle === undefined ? {} : { projectTitle: meta.projectTitle }),
      deletedAt: meta.deletedAt,
    });
  }
  return recycled.sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
}

function matchSkillDirectory(directory: string, context: BinContext): SkillMatch | null {
  const resolved = NodePath.resolve(directory);
  if (isInside(context.binRoot, resolved)) return null;
  const projects = [...context.projects].sort(
    (left, right) => NodePath.resolve(right.root).length - NodePath.resolve(left.root).length,
  );
  for (const project of projects) {
    const root = NodePath.resolve(project.root);
    if (root === NodePath.resolve(context.home) || root === NodePath.parse(root).root) continue;
    const match = matchUnder(root, resolved, "project");
    if (match !== null) {
      return { ...match, projectRoot: root, projectTitle: project.title };
    }
  }
  return matchUnder(NodePath.resolve(context.home), resolved, "user");
}

function matchUnder(base: string, directory: string, where: "user" | "project"): SkillMatch | null {
  const relative = NodePath.relative(base, directory);
  if (relative.startsWith("..") || NodePath.isAbsolute(relative)) return null;
  const parts = relative.split(NodePath.sep).filter((part) => part.length > 0);
  let best: SkillRoot | null = null;
  for (const root of SKILL_ROOTS) {
    if (root.where !== "both" && root.where !== where) continue;
    if (parts.length <= root.segments.length) continue;
    const matches = root.segments.every((segment, index) => parts[index] === segment);
    if (!matches) continue;
    if (best === null || root.segments.length > best.segments.length) best = root;
  }
  if (best === null) return null;
  return {
    collection: where,
    driver: best.driver,
    dotDir: best.dotDir,
    skillRoot: NodePath.join(base, ...best.segments),
  };
}

async function readSkillMeta(directory: string): Promise<{ name: string; description?: string }> {
  const text = await NodeFSP.readFile(NodePath.join(directory, SKILL_FILE), "utf8")
    .then((value) => value.slice(0, 8192))
    .catch(() => "");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  const name = frontmatterField(frontmatter, "name") ?? NodePath.basename(directory);
  const description = frontmatterField(frontmatter, "description");
  return description === undefined ? { name } : { name, description };
}

function frontmatterField(frontmatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(frontmatter);
  const captured = match?.[1];
  if (captured === undefined) return undefined;
  const raw = captured.trim().replace(/^['"]|['"]$/g, "");
  if (raw.length === 0 || raw === ">" || raw === "|" || raw === ">-" || raw === "|-") {
    return undefined;
  }
  return raw.slice(0, 400);
}

async function readMeta(itemDir: string): Promise<BinMeta | null> {
  const raw = await NodeFSP.readFile(NodePath.join(itemDir, "meta.json"), "utf8").catch(() => null);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    if (!("id" in parsed) || typeof parsed.id !== "string" || !UUID_PATTERN.test(parsed.id)) {
      return null;
    }
    if (!("name" in parsed) || typeof parsed.name !== "string" || parsed.name.length === 0) {
      return null;
    }
    if (!("originalDirectory" in parsed) || typeof parsed.originalDirectory !== "string") {
      return null;
    }
    if (!("driver" in parsed) || typeof parsed.driver !== "string") return null;
    if (!("dotDir" in parsed) || typeof parsed.dotDir !== "string") return null;
    if (
      !("collection" in parsed) ||
      (parsed.collection !== "user" && parsed.collection !== "project")
    ) {
      return null;
    }
    if (!("deletedAt" in parsed) || typeof parsed.deletedAt !== "string") return null;
    return {
      id: parsed.id,
      name: parsed.name,
      ...("description" in parsed && typeof parsed.description === "string"
        ? { description: parsed.description }
        : {}),
      originalDirectory: parsed.originalDirectory,
      driver: parsed.driver,
      dotDir: parsed.dotDir,
      collection: parsed.collection,
      ...("projectRoot" in parsed && typeof parsed.projectRoot === "string"
        ? { projectRoot: parsed.projectRoot }
        : {}),
      ...("projectTitle" in parsed && typeof parsed.projectTitle === "string"
        ? { projectTitle: parsed.projectTitle }
        : {}),
      deletedAt: parsed.deletedAt,
    };
  } catch {
    return null;
  }
}

async function moveDir(from: string, to: string): Promise<void> {
  try {
    await NodeFSP.rename(from, to);
  } catch (error) {
    if (!isCrossDevice(error)) throw error;
    await NodeFSP.cp(from, to, { recursive: true, errorOnExist: true });
    await NodeFSP.rm(from, { recursive: true, force: true });
  }
}

function isCrossDevice(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EXDEV";
}

async function exists(target: string): Promise<boolean> {
  try {
    await NodeFSP.stat(target);
    return true;
  } catch {
    return false;
  }
}

function isInside(parent: string, child: string): boolean {
  const relative = NodePath.relative(NodePath.resolve(parent), NodePath.resolve(child));
  return relative.length > 0 && !relative.startsWith("..") && !NodePath.isAbsolute(relative);
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = NodePath.relative(NodePath.resolve(parent), NodePath.resolve(child));
  return relative.length === 0 || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
}

function byName(left: ManagedSkill, right: ManagedSkill): number {
  return left.name.localeCompare(right.name);
}
