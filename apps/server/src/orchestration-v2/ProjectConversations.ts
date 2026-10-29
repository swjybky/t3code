import { ThreadId, type ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export const list = Effect.fn("ProjectConversations.list")(function* (projectId: ProjectId) {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{
    readonly thread_id: string;
    readonly conversation_id: string;
    readonly title: string;
    readonly created_at: string;
    readonly active_conversation_id: string;
    readonly archived: number;
    readonly manageable: number;
  }>`
    SELECT t.thread_id,
      json_extract(conversation.value, '$.id') AS conversation_id,
      json_extract(conversation.value, '$.title') AS title,
      json_extract(conversation.value, '$.createdAt') AS created_at,
      COALESCE(json_extract(t.payload_json, '$.activeConversationId'), 'default') AS active_conversation_id,
      t.archived_at IS NOT NULL AS archived,
      NOT (json_extract(t.payload_json, '$.lineage.relationshipToParent') IS 'subagent'
        AND json_extract(t.payload_json, '$.creationSource') IS 'provider') AS manageable
    FROM orchestration_v2_projection_threads AS t,
      json_each(COALESCE(json_extract(t.payload_json, '$.conversations'),
        json_array(json_object('id', 'default', 'title', t.title, 'createdAt', t.created_at)))) AS conversation
    WHERE t.project_id = ${projectId} AND t.deleted_at IS NULL
      AND json_extract(conversation.value, '$.deletedAt') IS NULL
    ORDER BY julianday(json_extract(conversation.value, '$.createdAt')) DESC,
      t.thread_id DESC, conversation_id DESC
    LIMIT 10
  `;
  return rows.map((row) => ({
    threadId: ThreadId.make(row.thread_id),
    id: row.conversation_id,
    title: row.title,
    createdAt: row.created_at,
    activeConversationId: row.active_conversation_id,
    archived: Boolean(row.archived),
    manageable: Boolean(row.manageable),
  }));
}, NodeSqliteClient.readOnly);
