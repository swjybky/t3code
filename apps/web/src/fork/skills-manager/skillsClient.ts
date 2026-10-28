import { readDesktopPrimaryBearerToken } from "../../environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "../../environments/primary/target";

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

export type SkillsManagerRequest =
  | { readonly op: "list" }
  | { readonly op: "trash"; readonly path: string }
  | { readonly op: "restore"; readonly id: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSkill(value: unknown): value is ManagedSkill {
  if (!isRecord(value)) return false;
  if (typeof value.name !== "string" || typeof value.path !== "string") return false;
  if (typeof value.directory !== "string" || typeof value.driver !== "string") return false;
  if (typeof value.dotDir !== "string") return false;
  return value.description === undefined || typeof value.description === "string";
}

function isCatalog(value: unknown): value is SkillsManagerCatalog {
  if (!isRecord(value) || !Array.isArray(value.user) || !value.user.every(isSkill)) return false;
  if (!Array.isArray(value.projects) || !Array.isArray(value.bin)) return false;
  const projects = value.projects.every(
    (project) =>
      isRecord(project) &&
      typeof project.root === "string" &&
      typeof project.title === "string" &&
      Array.isArray(project.skills) &&
      project.skills.every(isSkill),
  );
  const bin = value.bin.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      typeof entry.name === "string" &&
      typeof entry.originalPath === "string" &&
      typeof entry.driver === "string" &&
      typeof entry.dotDir === "string" &&
      (entry.collection === "user" || entry.collection === "project") &&
      typeof entry.deletedAt === "string",
  );
  return projects && bin;
}

export async function skillsManagerRequest(
  body: SkillsManagerRequest,
): Promise<SkillsManagerCatalog> {
  let url: string;
  try {
    url = resolvePrimaryEnvironmentHttpUrl("/api/fork/skills-manager");
  } catch {
    throw new Error("This computer's server is not available.");
  }
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  const bearerToken = await readDesktopPrimaryBearerToken().catch(() => null);
  if (bearerToken) {
    headers.authorization = `Bearer ${bearerToken}`;
  }
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("Restart the app server, then open Skills Manager again.");
    }
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Could not update skills (${response.status}).`;
    throw new Error(message);
  }
  if (!isCatalog(payload)) {
    throw new Error("The server returned an unexpected response.");
  }
  return payload;
}
