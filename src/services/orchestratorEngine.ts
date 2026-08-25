import {
  type WorkflowJob,
  type WorkflowStep,
  WorkflowJobSchema
} from "../types/agent";
import {
  CircuitBreaker,
  TokenBucketRateLimiter,
  calculateJitteredBackoffMs
} from "../utils/retry";

export type StepExecutionHandler = (
  step: WorkflowStep,
  previousOutputs: Record<string, string>
) => Promise<string>;

export interface OrchestrationEngineOptions {
  circuitBreaker?: CircuitBreaker;
  rateLimiter?: TokenBucketRateLimiter;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Executes a multi-step AI workflow with full circuit-breaker, rate-limiting, and retry protections
 */
export async function executeWorkflowJob(
  job: WorkflowJob,
  stepHandler: StepExecutionHandler,
  options: OrchestrationEngineOptions = {}
): Promise<WorkflowJob> {
  const circuitBreaker = options.circuitBreaker ?? new CircuitBreaker(5, 30000);
  const rateLimiter = options.rateLimiter ?? new TokenBucketRateLimiter(60, 10);
  const maxRetries = options.maxRetries ?? 3;
  const initialBackoffMs = options.initialBackoffMs ?? 100;
  const maxBackoffMs = options.maxBackoffMs ?? 2000;

  const previousOutputs: Record<string, string> = {};
  const updatedSteps: WorkflowStep[] = [];

  let jobFailed = false;
  const startTime = Date.now();

  for (let i = 0; i < job.steps.length; i++) {
    const currentStep = { ...job.steps[i]! };

    // If a preceding step failed, skip subsequent steps
    if (jobFailed) {
      currentStep.status = "SKIPPED";
      updatedSteps.push(currentStep);
      continue;
    }

    // 1. Circuit Breaker Pre-flight Check
    if (!circuitBreaker.isExecutionAllowed()) {
      currentStep.status = "CIRCUIT_BROKEN";
      currentStep.error = "Circuit breaker is OPEN. Upstream LLM services are temporarily halted.";
      jobFailed = true;
      updatedSteps.push(currentStep);
      continue;
    }

    // 2. Rate Limiting Check
    if (!rateLimiter.tryConsume(1)) {
      currentStep.status = "FAILED";
      currentStep.error = "Rate limit exceeded. Token bucket depleted.";
      jobFailed = true;
      updatedSteps.push(currentStep);
      continue;
    }

    // 3. Execution with Retry Loop & Backoff
    let stepSuccess = false;
    let attempt = 0;
    const stepStart = Date.now();

    while (attempt <= maxRetries && !stepSuccess) {
      try {
        currentStep.status = attempt === 0 ? "RUNNING" : "RETRYING";
        currentStep.retryCount = attempt;

        const output = await stepHandler(currentStep, previousOutputs);

        currentStep.output = output;
        currentStep.status = "COMPLETED";
        currentStep.error = undefined;
        currentStep.executionTimeMs = Date.now() - stepStart;
        previousOutputs[currentStep.id] = output;

        circuitBreaker.recordSuccess();
        stepSuccess = true;
      } catch (err) {
        attempt += 1;
        circuitBreaker.recordFailure();

        if (attempt <= maxRetries) {
          const backoff = calculateJitteredBackoffMs(attempt, initialBackoffMs, maxBackoffMs);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        } else {
          currentStep.status = "FAILED";
          currentStep.error = err instanceof Error ? err.message : "Unknown execution failure.";
          currentStep.executionTimeMs = Date.now() - stepStart;
          jobFailed = true;
        }
      }
    }

    updatedSteps.push(currentStep);
  }

  const finalStatus = jobFailed
    ? updatedSteps.some((s) => s.status === "COMPLETED")
      ? "PARTIAL_FAILURE"
      : "TERMINATED"
    : "SUCCESS";

  const completedJob: WorkflowJob = {
    ...job,
    steps: updatedSteps,
    status: finalStatus,
    completedAt: Date.now(),
    totalExecutionTimeMs: Date.now() - startTime
  };

  return WorkflowJobSchema.parse(completedJob);
}
