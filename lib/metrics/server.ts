import { performance } from 'node:perf_hooks';
import type { TraceStatus, TraceSummary, TraceStepSummary } from './types';

type HeadersLike = {
  get(name: string): string | null | undefined;
};

type ServerTrace = {
  id: string;
  operation: string;
  metadata?: Record<string, unknown>;
  steps: TraceStepSummary[];
  startedAt: number;
  hrStartedAt: number;
};

const generateTraceId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `trace_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
};

export const createServerTrace = (
  headers: HeadersLike,
  operation: string,
  metadata?: Record<string, unknown>
): ServerTrace => {
  const traceId = headers.get('x-taesk-trace-id') ?? generateTraceId();

  return {
    id: traceId,
    operation,
    metadata,
    steps: [],
    startedAt: Date.now(),
    hrStartedAt: performance.now(),
  };
};

export const measureStep = async <T>(
  trace: ServerTrace,
  label: string,
  fn: () => Promise<T>,
  options?: { countResolver?: (result: T) => number }
): Promise<T> => {
  const hrStartedAt = performance.now();
  const offsetMs = Math.max(0, hrStartedAt - trace.hrStartedAt);

  try {
    const result = await fn();
    const durationMs = Math.max(0, performance.now() - hrStartedAt);
    const count = options?.countResolver ? options.countResolver(result) : undefined;

    trace.steps.push({
      label,
      durationMs,
      offsetMs,
      success: true,
      count: typeof count === 'number' ? count : undefined,
    });

    return result;
  } catch (error) {
    const durationMs = Math.max(0, performance.now() - hrStartedAt);

    trace.steps.push({
      label,
      durationMs,
      offsetMs,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
};

export const finalizeServerTrace = (
  trace: ServerTrace,
  status: TraceStatus,
  extra?: Record<string, unknown>
): TraceSummary => {
  const hrFinishedAt = performance.now();
  const finishedAt = Date.now();
  const durationMs = Math.max(0, hrFinishedAt - trace.hrStartedAt);

  const summary: TraceSummary = {
    traceId: trace.id,
    operation: trace.operation,
    status,
    durationMs,
    startedAt: trace.startedAt,
    finishedAt,
    metadata: trace.metadata,
    steps: trace.steps,
    extra,
  };

  try {
    console.info('[metrics.server]', JSON.stringify(summary));
  } catch {
    // noop
  }

  return summary;
};
