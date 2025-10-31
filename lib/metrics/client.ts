import { track } from '@/lib/analytics';
import type { TraceStatus, TraceSummary, TraceStepSummary } from './types';

type TraceMark = {
  label: string;
  hrTime: number;
  timestamp: number;
  data?: Record<string, unknown>;
};

const getNow = (): number => Date.now();

const getHrNow = (): number => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

const generateTraceId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `trace_${Math.random().toString(16).slice(2)}${getNow().toString(16)}`;
};

const toStepSummaries = (
  marks: TraceMark[],
  hrStartedAt: number,
  hrFinishedAt: number
): TraceStepSummary[] =>
  marks.map((mark, index) => {
    const next = marks[index + 1];
    const nextHr = next?.hrTime ?? hrFinishedAt;
    const durationMs = Math.max(0, nextHr - mark.hrTime);
    const offsetMs = Math.max(0, mark.hrTime - hrStartedAt);

    return {
      label: mark.label,
      durationMs,
      offsetMs,
      success: true,
      count: typeof mark.data?.count === 'number' ? mark.data.count : undefined,
      error: undefined,
    };
  });

export interface ClientTrace {
  id: string;
  operation: string;
  metadata?: Record<string, unknown>;
  mark: (label: string, data?: Record<string, unknown>) => void;
  buildHeaders: (step?: string) => HeadersInit;
  finish: (status: TraceStatus, extra?: Record<string, unknown>) => TraceSummary;
}

export const createClientTrace = (
  operation: string,
  metadata?: Record<string, unknown>
): ClientTrace => {
  const id = generateTraceId();
  const startedAt = getNow();
  const hrStartedAt = getHrNow();
  const marks: TraceMark[] = [
    {
      label: 'start',
      hrTime: hrStartedAt,
      timestamp: startedAt,
    },
  ];

  const mark = (label: string, data?: Record<string, unknown>) => {
    marks.push({
      label,
      data,
      hrTime: getHrNow(),
      timestamp: getNow(),
    });
  };

  const buildHeaders = (step?: string): HeadersInit => {
    const headers: Record<string, string> = {
      'x-taesk-trace-id': id,
      'x-taesk-trace-op': operation,
    };

    if (typeof step === 'string' && step.length > 0) {
      headers['x-taesk-trace-step'] = step;
    }

    return headers;
  };

  const finish = (status: TraceStatus, extra?: Record<string, unknown>): TraceSummary => {
    const finishedAt = getNow();
    const hrFinishedAt = getHrNow();
    const durationMs = Math.max(0, hrFinishedAt - hrStartedAt);
    const steps = toStepSummaries(marks, hrStartedAt, hrFinishedAt);

    const summary: TraceSummary = {
      traceId: id,
      operation,
      status,
      durationMs,
      startedAt,
      finishedAt,
      metadata,
      steps,
      extra,
    };

    if (typeof window !== 'undefined') {
      const win = window as typeof window & {
        __TAESK_METRICS__?: {
          traces: TraceSummary[];
          byOperation: Record<string, TraceSummary[]>;
        };
      };

      if (!win.__TAESK_METRICS__) {
        win.__TAESK_METRICS__ = { traces: [], byOperation: {} };
      }

      win.__TAESK_METRICS__.traces.push(summary);
      if (!win.__TAESK_METRICS__.byOperation[operation]) {
        win.__TAESK_METRICS__.byOperation[operation] = [];
      }
      win.__TAESK_METRICS__.byOperation[operation].push(summary);

      try {
        track(`perf:${operation}`, {
          traceId: summary.traceId,
          status: summary.status,
          durationMs: summary.durationMs,
          metadata: summary.metadata,
          extra: summary.extra,
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[metrics.client] Failed to dispatch analytics event', error);
        }
      }
    }

    return summary;
  };

  return {
    id,
    operation,
    metadata,
    mark,
    buildHeaders,
    finish,
  };
};
