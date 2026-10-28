import {
  isOrchestrationV2WorkActive,
  type OrchestrationV2ThreadProjection,
  type RunId,
} from "@t3tools/contracts";

export const ORIGINAL_CONVERSATION_ID = "default";

const idSets = new WeakMap<ReadonlyArray<{ readonly id: string }>, ReadonlySet<string>>();
const emptyIds: ReadonlySet<string> = new Set();

function idsOf(rows: ReadonlyArray<{ readonly id: string }> | undefined): ReadonlySet<string> {
  if (rows === undefined) return emptyIds;
  const cached = idSets.get(rows);
  if (cached !== undefined) return cached;
  const ids = new Set(rows.map((row) => row.id));
  idSets.set(rows, ids);
  return ids;
}

type ConversationProjection = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "runs" | "providerThreads"
> &
  Partial<OrchestrationV2ThreadProjection>;

export function threadConversationId(
  thread: Pick<ConversationProjection["thread"], "activeConversationId">,
): string {
  return thread.activeConversationId ?? ORIGINAL_CONVERSATION_ID;
}

export function conversationMatches(
  row: { readonly conversationId?: string | undefined },
  conversationId: string,
): boolean {
  return (row.conversationId ?? ORIGINAL_CONVERSATION_ID) === conversationId;
}

export function conversationHasStarted(projection: {
  readonly thread: Pick<
    ConversationProjection["thread"],
    "activeConversationId" | "historyOrigin" | "forkedFrom"
  >;
  readonly runs: ReadonlyArray<Pick<ConversationProjection["runs"][number], "conversationId">>;
}): boolean {
  const conversationId = threadConversationId(projection.thread);
  return (
    projection.runs.some((run) => conversationMatches(run, conversationId)) ||
    (conversationId === ORIGINAL_CONVERSATION_ID &&
      (projection.thread.historyOrigin === "v1_import" || projection.thread.forkedFrom !== null))
  );
}

export function conversationSwitchBlocked(
  projection: Pick<
    ConversationProjection,
    "runs" | "providerThreads" | "subagents" | "runtimeRequests"
  >,
): boolean {
  return (
    projection.runs.some(
      (run) =>
        run.status === "queued" ||
        run.status === "preparing" ||
        run.status === "starting" ||
        run.status === "running" ||
        run.status === "waiting" ||
        run.delegatedCompletion?.disposition === "open",
    ) ||
    projection.providerThreads.some((thread) => (thread.pendingBackgroundTasks?.length ?? 0) > 0) ||
    (projection.subagents?.some((agent) => isOrchestrationV2WorkActive(agent.status)) ?? false) ||
    (projection.runtimeRequests?.some((request) => request.status === "pending") ?? false)
  );
}

export function projectConversation<T extends ConversationProjection>(
  projection: T,
  conversationId = threadConversationId(projection.thread),
  previous?: { readonly source: T; readonly result: T; readonly conversationId: string },
): T {
  if (projection.thread.conversations === undefined) return projection;
  const reusable =
    previous?.conversationId === conversationId &&
    previous.source.runs === projection.runs &&
    previous.source.providerThreads === projection.providerThreads
      ? previous
      : undefined;
  const runs =
    reusable?.result.runs ??
    projection.runs.filter((run) => conversationMatches(run, conversationId));
  const runIds = idsOf(runs);
  const includesRun = (runId: RunId | null) =>
    runId === null ? conversationId === ORIGINAL_CONVERSATION_ID : runIds.has(runId);
  const providerThreads =
    reusable?.result.providerThreads ??
    projection.providerThreads.filter((thread) => conversationMatches(thread, conversationId));
  const providerThreadIds = idsOf(providerThreads);
  const nodes =
    reusable !== undefined && reusable.source.nodes === projection.nodes
      ? reusable.result.nodes
      : projection.nodes?.filter((row) => includesRun(row.runId));
  const nodeIds = idsOf(nodes);
  const filter = <Key extends keyof T, Row>(
    key: Key,
    rows: ReadonlyArray<Row> | undefined,
    predicate: (row: Row) => boolean,
  ) =>
    reusable !== undefined && reusable.source[key] === projection[key]
      ? reusable.result[key]
      : rows?.filter(predicate);
  return {
    ...projection,
    runs,
    providerThreads,
    attempts: filter("attempts", projection.attempts, (row) => includesRun(row.runId)),
    nodes,
    subagents: filter("subagents", projection.subagents, (row) => includesRun(row.runId)),
    messages: filter("messages", projection.messages, (row) => includesRun(row.runId)),
    turnItems: filter("turnItems", projection.turnItems, (row) => includesRun(row.runId)),
    plans: filter("plans", projection.plans, (row) => includesRun(row.runId)),
    checkpointScopes: filter("checkpointScopes", projection.checkpointScopes, (row) =>
      includesRun(row.runId),
    ),
    checkpoints: filter("checkpoints", projection.checkpoints, (row) => includesRun(row.runId)),
    providerSessions: filter("providerSessions", projection.providerSessions, (row) =>
      providerThreads.some((thread) => thread.providerSessionId === row.id),
    ),
    providerTurns: filter("providerTurns", projection.providerTurns, (row) =>
      providerThreadIds.has(row.providerThreadId),
    ),
    runtimeRequests:
      reusable?.source.nodes === projection.nodes
        ? filter("runtimeRequests", projection.runtimeRequests, (row) => nodeIds.has(row.nodeId))
        : projection.runtimeRequests?.filter((row) => nodeIds.has(row.nodeId)),
    contextHandoffs: filter("contextHandoffs", projection.contextHandoffs, (row) =>
      runIds.has(row.targetRunId),
    ),
    contextTransfers: filter("contextTransfers", projection.contextTransfers, (row) =>
      row.targetRunId === null
        ? conversationId === ORIGINAL_CONVERSATION_ID
        : runIds.has(row.targetRunId),
    ),
    visibleTurnItems: filter("visibleTurnItems", projection.visibleTurnItems, (row) =>
      row.sourceThreadId === projection.thread.id
        ? includesRun(row.item.runId)
        : conversationId === ORIGINAL_CONVERSATION_ID,
    ),
  };
}

export function createConversationProjector() {
  let previous:
    | {
        source: OrchestrationV2ThreadProjection;
        result: OrchestrationV2ThreadProjection;
        conversationId: string;
      }
    | undefined;
  return (source: OrchestrationV2ThreadProjection) => {
    const conversationId = threadConversationId(source.thread);
    if (previous?.source === source) return previous.result;
    const result = projectConversation(source, conversationId, previous);
    previous = { source, result, conversationId };
    return result;
  };
}
