import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectConversations from "./ProjectConversations.ts";

const layerTest = Layer.mergeAll(
  ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory)),
  SqlitePersistence.layerMemory,
);

it.effect(
  "lists the ten newest conversations across a project, including legacy and archived threads",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const projectId = ProjectId.make("project:history");
      const date = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;
      const thread = (id: string, day: number): OrchestrationV2AppThread => {
        const threadId = ThreadId.make(id);
        const now = DateTime.makeUnsafe(date(day));
        const instanceId = ProviderInstanceId.make("codex");
        return {
          id: threadId,
          projectId,
          title: id,
          createdBy: "user",
          creationSource: "web",
          providerInstanceId: instanceId,
          modelSelection: { instanceId, model: "test" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
          lastVisitedAt: null,
          deletedAt: null,
        };
      };
      const conversation = (day: number) => ({
        id: `c${day}`,
        title: `Conversation ${day}`,
        createdAt: date(day),
      });
      const first = {
        ...thread("thread:first", 1),
        activeConversationId: "c8",
        conversations: Array.from({ length: 8 }, (_, index) => conversation(index + 1)),
      };
      const second = {
        ...thread("thread:second", 9),
        activeConversationId: "c13",
        conversations: Array.from({ length: 5 }, (_, index) => ({
          ...conversation(index + 9),
          ...(index === 3 ? { deletedAt: date(20) } : {}),
        })),
      };
      const archived = {
        ...thread("thread:archived", 14),
        archivedAt: DateTime.makeUnsafe(date(15)),
      };
      const other = { ...thread("thread:other", 28), projectId: ProjectId.make("project:other") };
      const deleted = { ...thread("thread:deleted", 29), deletedAt: DateTime.makeUnsafe(date(30)) };
      for (const row of [first, second, thread("thread:legacy", 11), archived, other, deleted]) {
        yield* store.apply({
          id: EventId.make(`event:${row.id}`),
          type: "thread.created",
          threadId: row.id,
          occurredAt: row.createdAt,
          payload: row,
        });
      }

      const result = yield* ProjectConversations.list(projectId);
      assert.equal(result.length, 10);
      assert.deepEqual(
        result.map((row) => `${row.threadId}:${row.id}`),
        [
          "thread:archived:default",
          "thread:second:c13",
          "thread:second:c11",
          "thread:legacy:default",
          "thread:second:c10",
          "thread:second:c9",
          "thread:first:c8",
          "thread:first:c7",
          "thread:first:c6",
          "thread:first:c5",
        ],
      );
      assert.equal(result[0]?.archived, true);
      assert.equal(result[0]?.title, "thread:archived");
      assert.equal(result[2]?.activeConversationId, "c13");

      const secondAfterDeletion = {
        ...second,
        activeConversationId: "c11",
        conversations: second.conversations.map((row) =>
          row.id === "c13" ? { ...row, deletedAt: date(21) } : row,
        ),
      };
      yield* store.apply({
        id: EventId.make("event:delete-conversation"),
        type: "thread.metadata-updated",
        threadId: second.id,
        occurredAt: second.createdAt,
        payload: secondAfterDeletion,
      });
      const afterDeletion = yield* ProjectConversations.list(projectId);
      assert.equal(afterDeletion.length, 10);
      assert.isFalse(afterDeletion.some((row) => row.threadId === second.id && row.id === "c13"));
      assert.equal(afterDeletion.at(-1)?.id, "c4");
      assert.equal(afterDeletion.find((row) => row.id === "c11")?.activeConversationId, "c11");

      yield* store.apply({
        id: EventId.make("event:restore-conversation"),
        type: "thread.metadata-updated",
        threadId: second.id,
        occurredAt: second.createdAt,
        payload: second,
      });
      assert.deepEqual(yield* ProjectConversations.list(projectId), result);

      const nativeId = ThreadId.make("thread:native");
      const native = {
        ...thread(nativeId, 16),
        creationSource: "provider" as const,
        lineage: {
          parentThreadId: first.id,
          relationshipToParent: "subagent" as const,
          rootThreadId: first.id,
        },
      };
      yield* store.apply({
        id: EventId.make("event:native-thread"),
        type: "thread.created",
        threadId: nativeId,
        occurredAt: native.createdAt,
        payload: native,
      });
      const withNative = yield* ProjectConversations.list(projectId);
      assert.equal(withNative[0]?.threadId, nativeId);
      assert.isFalse(withNative[0]?.manageable);
    }).pipe(Effect.provide(layerTest)),
);
