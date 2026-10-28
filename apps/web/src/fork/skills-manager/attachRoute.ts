import { createRoute, type AnyRoute } from "@tanstack/react-router";

import { Route as SettingsRoute } from "../../routes/_chat.settings";
import { SkillsManagerPanel } from "./SkillsManagerPanel";

const skillsManagerRoute = createRoute({
  getParentRoute: () => SettingsRoute,
  path: "/skills-manager",
  component: SkillsManagerPanel,
});

interface RouteNode {
  readonly options?: { readonly id?: string; readonly path?: string };
  children?: readonly RouteNode[];
  addChildren?: (children: readonly RouteNode[]) => void;
}

function findSettingsRoute(route: RouteNode): RouteNode | undefined {
  if (route.options?.path === "/settings") return route;
  for (const child of route.children ?? []) {
    const found = findSettingsRoute(child);
    if (found) return found;
  }
  return undefined;
}

/** Adds the skills page beside the generated settings routes, leaving routeTree.gen.ts alone. */
export function attachSkillsManagerRoute<T extends AnyRoute>(routeTree: T): T {
  const settings = findSettingsRoute(routeTree as RouteNode);
  if (!settings?.addChildren) return routeTree;
  const children = settings.children ?? [];
  if (children.includes(skillsManagerRoute as RouteNode)) return routeTree;
  settings.addChildren([...children, skillsManagerRoute as RouteNode]);
  return routeTree;
}
