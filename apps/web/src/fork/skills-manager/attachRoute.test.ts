import { createMemoryHistory } from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { getRouter } from "../../router";
import { SKILLS_MANAGER_PATH } from "./labels";

describe("skills manager route", () => {
  it("is registered under settings without a generated route file", () => {
    const router = getRouter(createMemoryHistory({ initialEntries: [SKILLS_MANAGER_PATH] }));
    const routes = router.routesByPath as unknown as Record<string, unknown>;
    expect(routes[SKILLS_MANAGER_PATH]).toBeDefined();
  });
});
