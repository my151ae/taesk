import type { JSONContent } from "@tiptap/react";

export const CARD_IMAGE_BUCKET = "card-images";
export const CARD_IMAGE_SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60 * 24;
export const CARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CARD_IMAGE_SIGN_MAX_PATHS = 50;
export const CARD_IMAGE_MAX_PATH_LENGTH = 512;

export const CARD_IMAGE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

const IMAGE_NODE_TYPE = "image";

type CardImageAttrs = {
  src?: string;
  storagePath?: string;
  alt?: string;
  title?: string;
};

export function isSupportedCardImageMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return (CARD_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(normalized);
}

export function cardImageExtensionFromMimeType(mimeType: string): string | null {
  switch (mimeType.trim().toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

export function buildCardImageStoragePrefix(boardId: string, cardId: string): string {
  return `boards/${boardId}/cards/${cardId}/`;
}

export function isCardImagePathForCard(path: string, boardId: string, cardId: string): boolean {
  return path.startsWith(buildCardImageStoragePrefix(boardId, cardId));
}

export function collectImageStoragePaths(content: JSONContent): string[] {
  const paths = new Set<string>();

  const visit = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== "object") return;

    if (node.type === IMAGE_NODE_TYPE) {
      const attrs = (node.attrs ?? {}) as CardImageAttrs;
      if (typeof attrs.storagePath === "string" && attrs.storagePath.length > 0) {
        paths.add(attrs.storagePath);
      }
    }

    if (Array.isArray(node.content)) {
      node.content.forEach((child) => visit(child as JSONContent));
    }
  };

  visit(content);
  return [...paths];
}

export function applySignedUrlsToContent(
  content: JSONContent,
  signedUrls: Record<string, string>
): { content: JSONContent; changed: boolean } {
  const cloned = JSON.parse(JSON.stringify(content)) as JSONContent;
  let changed = false;

  const visit = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== "object") return;

    if (node.type === IMAGE_NODE_TYPE) {
      const attrs = (node.attrs ?? {}) as CardImageAttrs;
      const storagePath = typeof attrs.storagePath === "string" ? attrs.storagePath : null;
      if (storagePath) {
        const signedUrl = signedUrls[storagePath];
        if (typeof signedUrl === "string" && signedUrl.length > 0 && attrs.src !== signedUrl) {
          node.attrs = {
            ...(node.attrs ?? {}),
            src: signedUrl,
          };
          changed = true;
        }
      }
    }

    if (Array.isArray(node.content)) {
      node.content.forEach((child) => visit(child as JSONContent));
    }
  };

  visit(cloned);

  if (!changed) {
    return { content, changed: false };
  }

  return { content: cloned, changed: true };
}
