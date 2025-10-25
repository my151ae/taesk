/**
 * Favicon badge fallback renderer
 * Re-draws the existing favicon onto a canvas and overlays a red badge so that
 * browsers without the App Badging API (Firefox, desktop tabs, Linux, etc.) still
 * surface unread counts.
 */

type IconSnapshot = {
  el: HTMLLinkElement;
  href: string;
  created?: boolean;
};

const originalIcons: IconSnapshot[] = [];
const generatedIcons = new Set<HTMLLinkElement>();
let baseIconSrc: string | null = null;
let baseImage: HTMLImageElement | null = null;
let baseImagePromise: Promise<HTMLImageElement | null> | null = null;

function isDomAvailable(): boolean {
  return typeof document !== 'undefined';
}

function collectOriginalIcons() {
  if (!isDomAvailable() || originalIcons.length > 0) {
    return;
  }

  const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]'));
  links.forEach((el) => {
    originalIcons.push({ el, href: el.href });
  });

  if (!baseIconSrc && links[0]) {
    baseIconSrc = links[0].href;
  }
}

function loadBaseImage(src: string): Promise<HTMLImageElement | null> {
  if (!isDomAvailable()) {
    return Promise.resolve(null);
  }

  if (baseImage && baseImage.src === src && baseImage.complete) {
    return Promise.resolve(baseImage);
  }

  if (baseImagePromise) {
    return baseImagePromise;
  }

  baseImagePromise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      baseImage = img;
      resolve(img);
      baseImagePromise = null;
    };
    img.onerror = () => {
      console.warn('[FaviconBadge] Failed to load base icon, using fallback shape');
      resolve(null);
      baseImagePromise = null;
    };
    img.src = src;
  });

  return baseImagePromise;
}

export function setupFaviconBadge(baseHref?: string): void {
  if (!isDomAvailable()) {
    return;
  }

  collectOriginalIcons();
  if (baseHref) {
    baseIconSrc = baseHref;
  }

  if (!baseIconSrc) {
    baseIconSrc = '/icon?size=64';
  }

  void loadBaseImage(baseIconSrc);
}

function ensureIconLink(size: number): HTMLLinkElement | null {
  if (!isDomAvailable()) {
    return null;
  }

  const selector = size ? `link[rel*="icon"][sizes="${size}x${size}"]` : 'link[rel="icon"]';
  let link = document.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    if (size) {
      link.sizes = `${size}x${size}`;
    }
    document.head.appendChild(link);
    generatedIcons.add(link);
  }
  return link;
}

function canvasToDataURL(source: HTMLCanvasElement, size: number): string {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const target = document.createElement('canvas');
  target.width = size * dpr;
  target.height = size * dpr;
  const ctx = target.getContext('2d');
  if (!ctx) {
    return source.toDataURL('image/png');
  }
  ctx.drawImage(
    source,
    0,
    0,
    source.width,
    source.height,
    0,
    0,
    target.width,
    target.height,
  );
  return target.toDataURL('image/png');
}

function drawBadge(ctx: CanvasRenderingContext2D, size: number, count: number) {
  const radius = Math.max(10, size * 0.28);
  const offset = Math.max(2, size * 0.06);
  const centerX = size - radius + offset;
  const centerY = radius + offset;

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  const label = count > 99 ? '99+' : String(count);

  if (size <= 16) {
    return; // dot only to avoid illegible text
  }

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = count > 99 ? size * 0.34 : count > 9 ? size * 0.4 : size * 0.5;
  ctx.font = `bold ${fontSize}px 'Inter', 'Segoe UI', system-ui`;
  ctx.fillText(label, centerX, centerY + 1);
}

async function renderBadgeCanvas(count: number): Promise<HTMLCanvasElement | null> {
  if (!isDomAvailable()) {
    return null;
  }

  const size = 64;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.scale(dpr, dpr);

  const img = baseIconSrc ? await loadBaseImage(baseIconSrc) : null;
  if (img) {
    ctx.drawImage(img, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#0ea5e9';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    ctx.fillRect(size * 0.15, size * 0.18, size * 0.14, size * 0.62);
    ctx.fillRect(size * 0.43, size * 0.18, size * 0.14, size * 0.62);
    ctx.fillRect(size * 0.71, size * 0.18, size * 0.14, size * 0.62);
  }

  if (count > 0) {
    drawBadge(ctx, size, count);
  }

  return canvas;
}

export async function setFaviconBadge(count: number): Promise<void> {
  if (!isDomAvailable()) {
    return;
  }

  collectOriginalIcons();
  if (!baseIconSrc) {
    baseIconSrc = originalIcons[0]?.href ?? '/icon?size=64';
  }

  const canvas = await renderBadgeCanvas(count);
  if (!canvas) {
    return;
  }

  const iconLinks = document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]');
  const data32 = canvasToDataURL(canvas, 32);
  const data16 = canvasToDataURL(canvas, 16);

  iconLinks.forEach((link) => {
    const sizes = link.getAttribute('sizes');
    if (sizes === '16x16') {
      link.href = data16;
    } else if (sizes === '32x32') {
      link.href = data32;
    } else {
      link.href = data32;
    }
  });

  const link16 = ensureIconLink(16);
  const link32 = ensureIconLink(32);
  if (link16) {
    link16.href = data16;
  }
  if (link32) {
    link32.href = data32;
  }
}

export function clearFaviconBadge(): void {
  if (!isDomAvailable()) {
    return;
  }

  if (originalIcons.length === 0) {
    return;
  }

  originalIcons.forEach(({ el, href }) => {
    try {
      el.href = href;
    } catch (error) {
      console.warn('[FaviconBadge] Failed to restore icon', error);
    }
  });

  generatedIcons.forEach((el) => {
    if (el.parentElement) {
      el.parentElement.removeChild(el);
    }
  });
  generatedIcons.clear();
}
