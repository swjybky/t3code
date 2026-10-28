import { useAtomValue } from "@effect/atom-react";
import {
  CommandId,
  isProviderNativeSubagentThread,
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
import { cn, randomUUID } from "../../lib/utils";
import { useQuietThreadProjection } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { ToolbarButton } from "../ui/toggle";
import { Menu, MenuItem, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";

export function ThreadConversations({ threadRef }: { threadRef: ScopedThreadRef }) {
  const projection = useQuietThreadProjection(threadRef)?.projection;
  const config = useAtomValue(serverEnvironment.configValueAtom(threadRef.environmentId));
  const command = orchestrationEnvironment.v2.dispatchCommand;
  const canOperate = useAtomValue(command.permissionAtom(threadRef.environmentId));
  const updateMetadata = useAtomCommand(command, {
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  if (projection === undefined || config?.threadConversations !== true) return null;
  const thread = projection.thread;
  const currentId = thread.activeConversationId ?? ORIGINAL_CONVERSATION_ID;
  const conversations = thread.conversations?.filter(
    (conversation) => conversation.deletedAt == null,
  ) ?? [
    {
      id: ORIGINAL_CONVERSATION_ID,
      title: thread.title,
      createdAt: DateTime.formatIso(thread.createdAt),
    },
  ];
  const busy = conversationSwitchBlocked(projection);
  const disabled =
    pending ||
    busy ||
    !canOperate ||
    thread.archivedAt !== null ||
    isProviderNativeSubagentThread(thread);
  const performChange = async (
    type: "create" | "select" | "delete" | "restore",
    conversationId: string,
  ) => {
    setPending(true);
    const result = await updateMetadata({
      environmentId: threadRef.environmentId,
      input: {
        type: "thread.metadata.update",
        commandId: CommandId.make(randomUUID()),
        threadId: threadRef.threadId,
        conversation: { type, conversationId, expectedConversationId: currentId },
      },
    });
    setPending(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: {
          create: "创建对话失败",
          select: "切换对话失败",
          delete: "删除对话失败",
          restore: "恢复对话失败",
        }[type],
        description: error instanceof Error ? error.message : "请稍后重试。",
      });
    }
    return result._tag === "Success";
  };
  const changeConversation = async (
    type: "create" | "select" | "delete",
    conversationId: string,
  ) => {
    if (
      disabled ||
      (type === "select" && conversationId === currentId) ||
      (type === "create" && !conversationHasStarted(projection))
    )
      return;
    const success = await performChange(type, conversationId);
    if (success && type === "delete") {
      const toastId = toastManager.add({
        type: "success",
        title: "已删除对话",
        data: { threadRef },
        actionProps: {
          children: "撤销",
          onClick: () => {
            toastManager.close(toastId);
            void performChange("restore", conversationId);
          },
        },
      });
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
          <MenuRadioGroup
            value={currentId}
            onValueChange={(value) => {
              if (typeof value === "string") void changeConversation("select", value);
            }}
          >
            {conversations.toReversed().map((conversation) => (
              <div
                key={conversation.id}
                className={cn(
                  "flex items-center rounded-sm pe-1 has-[[data-highlighted]]:bg-accent",
                  conversation.id === currentId && "bg-foreground/[0.08]",
                )}
              >
                <MenuRadioItem
                  variant="plain"
                  value={conversation.id}
                  disabled={disabled}
                  closeOnClick
                  className="min-w-0 flex-1"
                >
                  <div className="min-w-0">
                    <div className="line-clamp-2 break-words">{conversation.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(conversation.createdAt).toLocaleString()}
                    </div>
                  </div>
                </MenuRadioItem>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <MenuItem
                        variant="destructive-icon"
                        aria-label={`删除对话：${conversation.title}`}
                        disabled={disabled}
                        closeOnClick={false}
                        onClick={() => void changeConversation("delete", conversation.id)}
                      />
                    }
                  >
                    <Trash2Icon className="size-4" aria-hidden />
                  </TooltipTrigger>
                  <TooltipPopup>删除对话</TooltipPopup>
                </Tooltip>
              </div>
            ))}
          </MenuRadioGroup>
          {busy ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">当前任务结束后可切换对话</p>
          ) : null}
        </MenuPopup>
      </Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <ToolbarButton
              aria-label="新建对话"
              disabled={disabled}
              onClick={() => void changeConversation("create", randomUUID())}
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
