import { createRouter, RouterHistory } from "@tanstack/react-router";

import { attachSkillsManagerRoute } from "./fork/skills-manager/attachRoute";
import { routeTree } from "./routeTree.gen";

export function getRouter(history: RouterHistory) {
  return createRouter({
    routeTree: attachSkillsManagerRoute(routeTree),
    history,
    context: {},
    defaultPreload: "intent",
  });
}

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
