import { AuthFilesystemWriteScope, sessionGrantsScope } from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

import * as EnvironmentAuth from "../../auth/EnvironmentAuth.ts";
import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { runSkillsBin, SkillsBinError, skillsBinRoot, skillsUserHome } from "./store.ts";

const JSON_MAX_BODY_BYTES = 256 * 1024;
const NO_STORE = { "cache-control": "no-store" };

const jsonError = (message: string, status: number) =>
  HttpServerResponse.json({ message }, { status, headers: NO_STORE });

const binFailure = (cause: unknown): SkillsBinError =>
  cause instanceof SkillsBinError
    ? cause
    : new SkillsBinError("Could not update the recycle bin.", 500);

export const layer = HttpRouter.add(
  "POST",
  "/api/fork/skills-manager",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* auth.authenticateHttpRequest(request).pipe(Effect.option);
    if (session._tag === "None") {
      return yield* jsonError("Sign in to manage skills.", 401);
    }
    if (
      !sessionGrantsScope(
        { authenticated: true, scopes: session.value.scopes },
        AuthFilesystemWriteScope,
      )
    ) {
      return yield* jsonError("This session cannot change files.", 403);
    }
    if (Number(request.headers["content-length"] ?? "0") > JSON_MAX_BODY_BYTES) {
      return yield* jsonError("The request was not valid.", 400);
    }
    const body = yield* request.json.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(JSON_MAX_BODY_BYTES)),
      Effect.option,
    );
    if (body._tag === "None") {
      return yield* jsonError("The request was not valid.", 400);
    }

    const config = yield* ServerConfig.ServerConfig;
    const projects = yield* ProjectStore.ProjectStoreV2;
    const listed = yield* Effect.result(projects.list());
    if (Result.isFailure(listed)) {
      yield* Effect.logWarning("Skills Manager could not read opened projects.");
      return yield* jsonError("Could not read opened projects.", 500);
    }

    const catalog = yield* Effect.result(
      Effect.tryPromise({
        try: () =>
          runSkillsBin(
            {
              home: skillsUserHome(),
              binRoot: skillsBinRoot(config.baseDir),
              projects: listed.success.map((project) => ({
                root: project.workspaceRoot,
                title: project.title,
              })),
            },
            body.value,
          ),
        catch: binFailure,
      }),
    );
    if (Result.isFailure(catalog)) {
      if (catalog.failure.status >= 500) {
        yield* Effect.logWarning("Skills Manager could not update the recycle bin.");
      }
      return yield* jsonError(catalog.failure.message, catalog.failure.status);
    }
    return yield* HttpServerResponse.json(catalog.success, { headers: NO_STORE });
  }),
);
