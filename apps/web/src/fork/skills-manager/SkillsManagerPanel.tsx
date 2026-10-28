import { useEffect, useRef, useState } from "react";

import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { RefreshIcon } from "../../components/ui/refresh-icon";
import { Toggle } from "../../components/ui/toggle";
import { ToggleGroup, Toggle as ToggleGroupItem } from "../../components/ui/toggle-group";
import {
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { labelForDriver } from "./catalog";
import {
  skillsManagerRequest,
  type ManagedSkill,
  type RecycledSkill,
  type SkillsManagerCatalog,
  type SkillsManagerRequest,
} from "./skillsClient";

const DRIVER_ORDER = [
  "agents",
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "opencode",
  "pi",
  "antigravity",
  "fx",
  "muse",
];

const DOT_DIRS: Readonly<Record<string, string>> = {
  agents: ".agents",
  codex: ".codex",
  claudeAgent: ".claude",
  cursor: ".cursor",
  grok: ".grok",
  opencode: ".opencode",
  pi: ".pi",
  antigravity: ".gemini",
  fx: ".fx",
  muse: ".muse",
};

type Collection = "user" | "project" | "bin";

function driverLabel(driver: string): string {
  return driver === "agents" ? "Agents" : labelForDriver(driver);
}

function sortDrivers(drivers: readonly string[]): string[] {
  return [...drivers].sort((left, right) => {
    const leftRank = DRIVER_ORDER.indexOf(left);
    const rightRank = DRIVER_ORDER.indexOf(right);
    const ranked =
      (leftRank === -1 ? DRIVER_ORDER.length : leftRank) -
      (rightRank === -1 ? DRIVER_ORDER.length : rightRank);
    return ranked === 0 ? left.localeCompare(right) : ranked;
  });
}

function visibleSkills(
  skills: readonly ManagedSkill[],
  enabledDrivers: ReadonlySet<string>,
): ManagedSkill[] {
  return skills.filter((skill) => enabledDrivers.has(skill.driver));
}

function matchesQuery(parts: readonly (string | undefined)[], query: string): boolean {
  if (query.length === 0) return true;
  return parts
    .filter((part) => part !== undefined)
    .join("\n")
    .toLowerCase()
    .includes(query);
}

function formatDeleted(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function ChoiceTabs({
  label,
  tabs,
  selected,
  onSelect,
}: {
  readonly label: string;
  readonly tabs: readonly { id: string; label: string; count: number }[];
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <Toggle
          key={tab.id}
          pressed={selected === tab.id}
          size="xs"
          variant="outline"
          onPressedChange={(pressed) => {
            if (pressed) onSelect(tab.id);
          }}
        >
          {tab.label}
          <span className="text-muted-foreground tabular-nums">{tab.count}</span>
        </Toggle>
      ))}
    </div>
  );
}

function SkillRows({
  skills,
  busy,
  onDelete,
}: {
  readonly skills: readonly ManagedSkill[];
  readonly busy: boolean;
  readonly onDelete: (skill: ManagedSkill) => void;
}) {
  return skills.map((skill) => (
    <SettingsRow
      key={skill.path}
      title={skill.name}
      {...(skill.description ? { description: skill.description } : {})}
      status={<span className="block font-mono break-all">{skill.path}</span>}
      control={
        <Button
          disabled={busy}
          size="xs"
          variant="ghost-destructive"
          onClick={() => onDelete(skill)}
        >
          Delete
        </Button>
      }
    />
  ));
}

export function SkillsManagerPanel() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const [catalog, setCatalog] = useState<SkillsManagerCatalog | null>(null);
  const [collection, setCollection] = useState<Collection>("user");
  const [driver, setDriver] = useState<string | null>(null);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const signedOut = error === "Sign in to manage skills.";
  const requestId = useRef(0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- load skill directories from the local server
  useEffect(() => {
    const id = requestId.current + 1;
    requestId.current = id;
    void skillsManagerRequest({ op: "list" })
      .then((next) => {
        if (requestId.current !== id) return;
        setCatalog(next);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (requestId.current !== id) return;
        const message = cause instanceof Error ? cause.message : "Could not load skills.";
        if (signedOut && message === "Sign in to manage skills.") return;
        setError(message);
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });
  }, [signedOut]);

  const enabledDrivers = new Set<string>(["agents"]);
  const primaryProviders =
    primaryEnvironmentId === null ? [] : (providersByEnvironment.get(primaryEnvironmentId) ?? []);
  for (const snapshot of primaryProviders) {
    if (snapshot.enabled) enabledDrivers.add(snapshot.driver);
  }

  const userSkills = visibleSkills(catalog?.user ?? [], enabledDrivers);
  const projects = (catalog?.projects ?? []).map((project) => ({
    ...project,
    skills: visibleSkills(project.skills, enabledDrivers),
  }));
  const projectSkills = projects.flatMap((project) => project.skills);
  const selectedProject = projects.find((project) => project.root === projectRoot) ?? null;
  const providerIds = sortDrivers([...enabledDrivers]);
  const normalizedQuery = query.trim().toLowerCase();

  async function mutate(request: SkillsManagerRequest) {
    setBusy(true);
    setError(null);
    try {
      setCatalog(await skillsManagerRequest(request));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update skills.");
    } finally {
      setBusy(false);
    }
  }

  const providerTabs = (skills: readonly ManagedSkill[]) =>
    providerIds.map((id) => ({
      id,
      label: driverLabel(id),
      count: skills.filter((skill) => skill.driver === id).length,
    }));

  const selectedSkills = (
    collection === "user" ? userSkills : (selectedProject?.skills ?? [])
  ).filter((skill) => skill.driver === driver);
  const listedSkills = selectedSkills.filter((skill) =>
    matchesQuery([skill.name, skill.description, skill.path, skill.dotDir], normalizedQuery),
  );
  const listedBin = (catalog?.bin ?? []).filter((entry) =>
    matchesQuery(
      [entry.name, entry.description, entry.originalPath, entry.projectTitle, entry.dotDir],
      normalizedQuery,
    ),
  );

  return (
    <SettingsPageContainer>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          aria-label="Skill collection"
          value={[collection]}
          variant="segmented"
          onValueChange={(next) => {
            const value = next[0];
            if (value !== "user" && value !== "project" && value !== "bin") return;
            if (value === collection) return;
            setCollection(value);
            setDriver(null);
            setQuery("");
          }}
        >
          <ToggleGroupItem value="user">
            User skills
            <span className="text-muted-foreground tabular-nums">{userSkills.length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="project">
            Project skills
            <span className="text-muted-foreground tabular-nums">{projectSkills.length}</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="bin">
            Recycle bin
            <span className="text-muted-foreground tabular-nums">{catalog?.bin.length ?? 0}</span>
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          disabled={busy || (loading && catalog === null)}
          size="sm"
          variant="outline"
          onClick={() => void mutate({ op: "list" })}
        >
          <RefreshIcon refreshing={busy} />
          Reload
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading && catalog === null ? (
        <p className="text-sm text-muted-foreground">Looking up skills…</p>
      ) : null}

      {catalog !== null && collection === "user" ? (
        <ChoiceTabs
          label="User skill providers"
          selected={driver}
          tabs={providerTabs(userSkills)}
          onSelect={setDriver}
        />
      ) : null}

      {catalog !== null && collection === "project" ? (
        projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Open a local project in T3 Code to manage its skills.
          </p>
        ) : (
          <>
            <ChoiceTabs
              label="Opened projects"
              selected={selectedProject?.root ?? null}
              tabs={projects.map((project) => ({
                id: project.root,
                label: project.title,
                count: project.skills.length,
              }))}
              onSelect={(root) => {
                setProjectRoot(root);
                setDriver(null);
                setQuery("");
              }}
            />
            {selectedProject ? (
              <ChoiceTabs
                label={`${selectedProject.title} providers`}
                selected={driver}
                tabs={providerTabs(selectedProject.skills)}
                onSelect={setDriver}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a project you have opened in T3 Code.
              </p>
            )}
            {selectedProject && driver === null ? (
              <p className="text-sm text-muted-foreground">Select a provider to see its skills.</p>
            ) : null}
          </>
        )
      ) : null}

      {driver !== null &&
      (collection === "user" || (collection === "project" && selectedProject !== null)) ? (
        <SettingsSection title={driverLabel(driver)}>
          <p className="px-3 py-3 font-mono text-xs text-muted-foreground sm:px-4">
            {DOT_DIRS[driver] ?? selectedSkills[0]?.dotDir ?? `.${driver}`}
          </p>
          {selectedSkills.length > 1 ? (
            <div className="px-3 pb-3 sm:px-4">
              <div className="w-56 max-w-full">
                <Input
                  aria-label="Filter skills"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter skills"
                  size="sm"
                  spellCheck={false}
                  value={query}
                />
              </div>
            </div>
          ) : null}
          {selectedSkills.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
              No skills in {DOT_DIRS[driver] ?? `.${driver}`} yet.
            </p>
          ) : listedSkills.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
              No skills match that filter.
            </p>
          ) : (
            <SkillRows
              busy={busy}
              skills={listedSkills}
              onDelete={(skill) => void mutate({ op: "trash", path: skill.path })}
            />
          )}
        </SettingsSection>
      ) : null}

      {collection === "user" && catalog !== null && driver === null ? (
        <p className="text-sm text-muted-foreground">Select a provider to see its skills.</p>
      ) : null}

      {collection === "bin" && catalog !== null ? (
        <SettingsSection title="Recycle bin">
          <p className="px-3 py-3 text-xs leading-normal text-muted-foreground sm:px-4">
            Deleted skills stay here until you restore them.
          </p>
          {catalog.bin.length > 1 ? (
            <div className="px-3 pb-3 sm:px-4">
              <div className="w-56 max-w-full">
                <Input
                  aria-label="Filter recycled skills"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter skills"
                  size="sm"
                  spellCheck={false}
                  value={query}
                />
              </div>
            </div>
          ) : null}
          {catalog.bin.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
              The recycle bin is empty.
            </p>
          ) : listedBin.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-muted-foreground sm:px-4">
              No skills match that filter.
            </p>
          ) : (
            listedBin.map((entry) => (
              <BinRow
                key={entry.id}
                busy={busy}
                entry={entry}
                onRestore={() => void mutate({ op: "restore", id: entry.id })}
              />
            ))
          )}
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}

function BinRow({
  entry,
  busy,
  onRestore,
}: {
  readonly entry: RecycledSkill;
  readonly busy: boolean;
  readonly onRestore: () => void;
}) {
  const place = entry.collection === "project" ? (entry.projectTitle ?? "Project") : "User skills";
  return (
    <SettingsRow
      title={entry.name}
      {...(entry.description ? { description: entry.description } : {})}
      status={
        <span className="block font-mono break-all">
          {place} · {entry.dotDir} · {formatDeleted(entry.deletedAt)} · {entry.originalPath}
        </span>
      }
      control={
        <Button disabled={busy} size="xs" variant="outline" onClick={onRestore}>
          Restore
        </Button>
      }
    />
  );
}
