import { describe, expect, it } from "vitest";
import { shellConversationFields } from "./threadConversations";

const conversation = (id: string, deletedAt?: string) => ({
  id,
  title: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...(deletedAt === undefined ? {} : { deletedAt }),
});

describe("shellConversationFields", () => {
  it("omits single, deleted-down and legacy threads", () => {
    expect(shellConversationFields({})).toEqual({});
    expect(shellConversationFields({ conversations: [conversation("default")] })).toEqual({});
    expect(
      shellConversationFields({
        conversations: [conversation("default"), conversation("a", "2026-01-02T00:00:00.000Z")],
      }),
    ).toEqual({});
  });

  it("lists live conversations with the active id", () => {
    const fields = shellConversationFields({
      activeConversationId: "a",
      conversations: [conversation("default"), conversation("a"), conversation("b", "x")],
    });
    expect(fields.activeConversationId).toBe("a");
    expect(fields.conversations?.map((c) => c.id)).toEqual(["default", "a"]);
  });
});
