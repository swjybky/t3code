import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandId,
  isProviderNativeSubagentThread,
  type OrchestrationV2Command,
  type OrchestrationV2ProjectConversation,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  conversationHasStarted,
  conversationSwitchBlocked,
  ORIGINAL_CONVERSATION_ID,
} from "@t3tools/shared/threadConversations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as DateTime from "effect/DateTime";
import { HistoryIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { refreshArchivedThreadsForEnvironment } from "../../lib/archivedThreadsState";
import { cn, randomUUID } from "../../lib/utils";
import { useQuietThreadProjection } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ToolbarButton } from "../ui/toggle";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";

const conversationKey = (threadId: string, conversationId: string) =>
  JSON.stringify([threadId, conversationId]);

export function ThreadConversations({ threadRef }: { threadRef: ScopedThreadRef }) {
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const command = orchestrationEnvironment.v2.dispatchCommand;
  const canOperate = useAtomValue(command.permissionAtom(threadRef.environmentId));
  const dispatch = useAtomCommand(command, { reportFailure: false });
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const projectHistory = useEnvironmentQuery(
    historyOpen && projection !== undefined && config?.projectConversations === true
      ? orchestrationEnvironment.v2.projectConversations({
          environmentId: threadRef.environmentId,
          input: { projectId: projection.thread.projectId },
        })
      : null,
  );
  if (projection === undefined || config?.threadConversations !== true) return null;
  const thread = projection.thread;
  const currentId = thread.activeConversationId ?? ORIGINAL_CONVERSATION_ID;
  const localConversations = thread.conversations ?? [
    {
      id: ORIGINAL_CONVERSATION_ID,
      title: thread.title,
      createdAt: DateTime.formatIso(thread.createdAt),
    },
  ];
  const conversations: ReadonlyArray<OrchestrationV2ProjectConversation> =
    config.projectConversations === true
      ? (projectHistory.data ?? [])
      : localConversations
          .filter(
            (conversation) => !("deletedAt" in conversation) || conversation.deletedAt == null,
          )
          .toReversed()
          .slice(0, 10)
          .map((conversation) => ({
            ...conversation,
            threadId: thread.id,
            activeConversationId: currentId,
            archived: thread.archivedAt !== null,
            manageable: !isProviderNativeSubagentThread(thread),
          }));
  const busy = conversationSwitchBlocked(projection);
  const disabled =
    pending ||
    busy ||
    !canOperate ||
    thread.archivedAt !== null ||
    isProviderNativeSubagentThread(thread);

  const send = async (input: OrchestrationV2Command, title: string) => {
    const result = await dispatch({ environmentId: threadRef.environmentId, input });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title,
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
    if (historyOpen && config.projectConversations === true) projectHistory.refresh();
    return result._tag === "Success";
  };

  const performChange = async (
    type: "create" | "select" | "delete" | "restore",
    conversation: Pick<
      OrchestrationV2ProjectConversation,
      "threadId" | "id" | "activeConversationId"
    >,
  ) =>
    send(
      {
        type: "thread.metadata.update",
        commandId: CommandId.make(randomUUID()),
        threadId: conversation.threadId,
        conversation: {
          type,
          conversationId: conversation.id,
          expectedConversationId: conversation.activeConversationId,
        },
      },
      {
        create: "创建对话失败",
        select: "切换对话失败",
        delete: "删除对话失败",
        restore: "恢复对话失败",
      }[type],
    );

  const selectConversation = async (conversation: OrchestrationV2ProjectConversation) => {
    if (pending || !canOperate) return;
    const sameThread = conversation.threadId === threadRef.threadId;
    if (sameThread && conversation.id !== currentId && disabled) return;
    setPending(true);
    try {
      if (conversation.archived) {
        const restored = await send(
          {
            type: "thread.unarchive",
            commandId: CommandId.make(randomUUID()),
            threadId: conversation.threadId,
          },
          "恢复线程失败",
        );
        if (!restored) return;
        refreshArchivedThreadsForEnvironment(threadRef.environmentId);
      }
      const selected = await performChange("select", {
        ...conversation,
        activeConversationId: sameThread ? currentId : conversation.activeConversationId,
      });
      if (!selected) return;
      if (!sameThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams({
            environmentId: threadRef.environmentId,
            threadId: conversation.threadId,
          }),
        });
      }
    } finally {
      setPending(false);
    }
  };

  const deleteConversation = async (conversation: OrchestrationV2ProjectConversation) => {
    if (
      pending ||
      !canOperate ||
      conversation.archived ||
      !conversation.manageable ||
      (conversation.threadId === threadRef.threadId && busy)
    )
      return;
    setPending(true);
    try {
      const deleted = await performChange("delete", {
        ...conversation,
        activeConversationId:
          conversation.threadId === threadRef.threadId
            ? currentId
            : conversation.activeConversationId,
      });
      if (!deleted) return;
      const toastId = toastManager.add({
        type: "success",
        title: "已删除对话",
        data: {
          threadRef: { environmentId: threadRef.environmentId, threadId: conversation.threadId },
        },
        actionProps: {
          children: "撤销",
          onClick: () => {
            toastManager.close(toastId);
            setPending(true);
            void performChange("restore", conversation).finally(() => setPending(false));
          },
        },
      });
    } finally {
      setPending(false);
    }
  };

  const createConversation = async () => {
    if (disabled || !conversationHasStarted(projection)) return;
    setPending(true);
    try {
      await performChange("create", {
        threadId: threadRef.threadId,
        id: randomUUID(),
        activeConversationId: currentId,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      aria-label="对话管理"
      data-panel-layout-controls
    >
      <Menu open={historyOpen} onOpenChange={setHistoryOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger render={<ToolbarButton pressed={historyOpen} aria-label="历史对话" />} />
            }
          >
            <HistoryIcon className="size-4" aria-hidden />
          </TooltipTrigger>
          <TooltipPopup>历史对话</TooltipPopup>
        </Tooltip>
        <MenuPopup align="end" className="w-72">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">历史对话</div>
          {config.projectConversations === true && projectHistory.data === null ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {projectHistory.error ? "无法加载历史对话，请重新打开重试。" : "正在加载历史对话…"}
            </p>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">暂无历史对话</p>
          ) : null}
          <MenuRadioGroup
            value={conversationKey(threadRef.threadId, currentId)}
            onValueChange={(value) => {
              const conversation = conversations.find(
                (row) => conversationKey(row.threadId, row.id) === value,
              );
              if (conversation !== undefined) void selectConversation(conversation);
            }}
          >
            {conversations.map((conversation) => {
              const sameThread = conversation.threadId === threadRef.threadId;
              const selected = sameThread && conversation.id === currentId;
              return (
                <div
                  key={conversationKey(conversation.threadId, conversation.id)}
                  className={cn(
                    "flex items-center rounded-sm pe-1 has-[[data-highlighted]]:bg-accent",
                    selected && "bg-foreground/[0.08]",
                  )}
                >
                  <MenuRadioItem
                    variant="plain"
                    value={conversationKey(conversation.threadId, conversation.id)}
                    disabled={pending || !canOperate || (sameThread && !selected && disabled)}
                    closeOnClick
                    className="min-w-0 flex-1"
                  >
                    <div className="min-w-0">
                      <div className="line-clamp-2 break-words">{conversation.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(conversation.createdAt).toLocaleString()}
                        {conversation.archived ? " · 已归档，点击恢复" : null}
                      </div>
                    </div>
                  </MenuRadioItem>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <MenuItem
                          variant="destructive-icon"
                          aria-label={`删除对话：${conversation.title}`}
                          disabled={
                            pending ||
                            !canOperate ||
                            conversation.archived ||
                            !conversation.manageable ||
                            (sameThread && busy)
                          }
                          closeOnClick={false}
                          onClick={() => void deleteConversation(conversation)}
                        />
                      }
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </TooltipTrigger>
                    <TooltipPopup>删除对话</TooltipPopup>
                  </Tooltip>
                </div>
              );
            })}
          </MenuRadioGroup>
          {busy ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              当前任务结束后可切换此线程的对话
            </p>
          ) : null}
        </MenuPopup>
      </Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <ToolbarButton
              aria-label="新建对话"
              disabled={disabled}
              onClick={() => void createConversation()}
            />
          }
        >
          <PlusIcon className="size-4" aria-hidden />
        </TooltipTrigger>
        <TooltipPopup>{busy ? "当前任务结束后可新建对话" : "新建对话"}</TooltipPopup>
      </Tooltip>
    </div>
  );
}
