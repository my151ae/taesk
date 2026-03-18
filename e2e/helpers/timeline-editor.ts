import type { Page } from "@playwright/test";

export async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const target = document.querySelector(".ProseMirror[data-autofocus=\"true\"]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("Missing ProseMirror root for paste");
    }
    target.focus();
    const data = new DataTransfer();
    data.setData("text/plain", value);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, text);
}

export async function pasteImageFromBytes(
  page: Page,
  args: { bytes: number[]; mimeType: string; fileName: string }
): Promise<void> {
  await page.evaluate(({ bytes, mimeType, fileName }) => {
    const target = document.querySelector(".ProseMirror[data-autofocus=\"true\"]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("Missing ProseMirror root for paste");
    }
    target.focus();

    const data = new DataTransfer();
    const file = new File([new Uint8Array(bytes)], fileName, { type: mimeType });
    data.items.add(file);

    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, args);
}

export async function pasteImageBySize(
  page: Page,
  args: { size: number; mimeType: string; fileName: string }
): Promise<void> {
  await page.evaluate(({ size, mimeType, fileName }) => {
    const target = document.querySelector(".ProseMirror[data-autofocus=\"true\"]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("Missing ProseMirror root for paste");
    }
    target.focus();

    const data = new DataTransfer();
    const file = new File([new Uint8Array(size)], fileName, { type: mimeType });
    data.items.add(file);

    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, args);
}

export async function pasteHtmlImageFromDataUrl(
  page: Page,
  dataUrl: string
): Promise<void> {
  await page.evaluate((src) => {
    const target = document.querySelector(".ProseMirror[data-autofocus=\"true\"]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("Missing ProseMirror root for HTML image paste");
    }
    target.focus();
    const data = new DataTransfer();
    data.setData("text/html", `<img src="${src}" alt="pasted-html-image" />`);
    data.setData("text/plain", "");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, dataUrl);
}

export async function pasteHtmlWithPlainText(
  page: Page,
  args: { plainText: string; html: string }
): Promise<void> {
  await page.evaluate(({ plainText, html }) => {
    const target = document.querySelector(".ProseMirror[data-autofocus=\"true\"]");
    if (!(target instanceof HTMLElement)) {
      throw new Error("Missing ProseMirror root for HTML paste");
    }
    target.focus();
    const data = new DataTransfer();
    data.setData("text/plain", plainText);
    data.setData("text/html", html);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    target.dispatchEvent(event);
  }, args);
}
