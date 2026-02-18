import {
  createCommentNotifications,
  createNotification,
  generateNotificationMessage,
} from "@/lib/server/notifications";

type CardMeta = {
  title: string | null;
  short_id: string | null;
  slug: string | null;
};

type NotifyCommentCreatedArgs = {
  cardId: string;
  boardId: string;
  commentId: string;
  senderId: string;
  senderName: string;
  mentions: string[];
  parentId: string | null;
  replyToAuthorId: string | null;
  notificationBody: string;
  cardMeta: CardMeta;
};

export async function notifyCommentCreated({
  cardId,
  boardId,
  commentId,
  senderId,
  senderName,
  mentions,
  parentId,
  replyToAuthorId,
  notificationBody,
  cardMeta,
}: NotifyCommentCreatedArgs) {
  const mentionRecipients =
    parentId && replyToAuthorId
      ? mentions.filter((id) => id !== replyToAuthorId)
      : mentions;

  if (mentionRecipients.length > 0) {
    await createCommentNotifications(
      {
        event: "mention",
        commentId,
        cardId,
        boardId,
        senderId,
        recipientIds: mentionRecipients,
        commentBody: notificationBody,
        cardShortId: cardMeta.short_id,
        cardSlug: cardMeta.slug,
      },
      senderName
    );
  }

  if (!parentId || !replyToAuthorId || replyToAuthorId === senderId) {
    return;
  }

  const snippet = notificationBody.replace(/\s+/g, " ").trim();
  const preview = snippet.length > 140 ? `${snippet.slice(0, 140).trim()}…` : snippet;

  const payload = {
    comment_id: commentId,
    card_id: cardId,
    card_short_id: cardMeta.short_id ?? null,
    card_slug: cardMeta.slug ?? null,
    board_id: boardId,
    sender_id: senderId,
    sender_name: senderName,
    card_title: cardMeta.title || "Untitled",
    comment_body: notificationBody,
    message: preview
      ? `${generateNotificationMessage("comment_replied", {
          sender_name: senderName,
          card_title: cardMeta.title,
        })}: ${preview}`
      : generateNotificationMessage("comment_replied", {
          sender_name: senderName,
          card_title: cardMeta.title,
        }),
  };

  await createNotification({
    type: "comment_replied",
    recipientId: replyToAuthorId,
    payload,
  });
}
