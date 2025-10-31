import type { Page } from '@playwright/test';

type ClientTraceSummary = {
  traceId: string;
  durationMs: number;
  status: string;
  startedAt: number;
  finishedAt: number;
  metadata?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

type OperationTraceGroup = {
  operation: string;
  traces: ClientTraceSummary[];
};

export async function dumpClientMetrics(
  page: Page,
  operations: string[] = ['board-load']
): Promise<void> {
  const metrics = await page.evaluate((ops) => {
    const win = window as typeof window & {
      __TAESK_METRICS__?: {
        byOperation: Record<string, Array<{
          traceId: string;
          durationMs: number;
          status: string;
          startedAt: number;
          finishedAt: number;
          metadata?: Record<string, unknown>;
          extra?: Record<string, unknown>;
        }>>;
      };
    };

    if (!win.__TAESK_METRICS__) {
      return [];
    }

    const groups: OperationTraceGroup[] = [];

    for (const operation of ops) {
      const traces = win.__TAESK_METRICS__.byOperation?.[operation] ?? [];
      if (!traces.length) continue;
      groups.push({
        operation,
        traces: traces.map((trace) => ({
          traceId: trace.traceId,
          durationMs: trace.durationMs,
          status: trace.status,
          startedAt: trace.startedAt,
          finishedAt: trace.finishedAt,
          metadata: trace.metadata ?? undefined,
          extra: trace.extra ?? undefined,
        })),
      });
    }

    return groups;
  }, operations);

  for (const group of metrics as OperationTraceGroup[]) {
    console.log(
      `METRICS_JSON ${JSON.stringify({
        operation: group.operation,
        traces: group.traces,
      })}`
    );
  }
}
