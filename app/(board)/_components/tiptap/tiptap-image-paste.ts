import {
  cardImageExtensionFromMimeType,
  isSupportedCardImageMimeType,
} from "@/lib/tiptap-images";

export async function parseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    if (typeof body?.error?.message === "string" && body.error.message.trim()) {
      return body.error.message;
    }
  } catch {
    // ignore parse error
  }
  return fallback;
}

export function extractImageFilesFromClipboard(
  clipboardData: DataTransfer | null
): File[] {
  return Array.from(clipboardData?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file && file.type.startsWith("image/"));
}

export function extractImageFilesFromClipboardHtml(html: string): File[] {
  if (!html || typeof html !== "string") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const imageSources = Array.from(doc.querySelectorAll("img"))
    .map((element) => element.getAttribute("src") ?? "")
    .filter((value) => value.startsWith("data:image/"));

  const files: File[] = [];
  imageSources.forEach((source, index) => {
    const match = source.match(
      /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i
    );
    if (!match) return;
    const mimeType = match[1].toLowerCase();
    if (!isSupportedCardImageMimeType(mimeType)) return;

    const extension = cardImageExtensionFromMimeType(mimeType) ?? "img";
    try {
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      files.push(
        new File([bytes], `pasted-html-${Date.now()}-${index}.${extension}`, {
          type: mimeType,
        })
      );
    } catch {
      // ignore malformed data url
    }
  });

  return files;
}
