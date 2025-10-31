export type TraceStatus = 'success' | 'error' | 'cancelled';

export type TraceStepSummary = {
  label: string;
  durationMs: number;
  offsetMs: number;
  success: boolean;
  count?: number;
  error?: string;
};

export type TraceSummary = {
  traceId: string;
  operation: string;
  status: TraceStatus;
  durationMs: number;
  startedAt: number;
  finishedAt: number;
  metadata?: Record<string, unknown>;
  steps: TraceStepSummary[];
  extra?: Record<string, unknown>;
};
