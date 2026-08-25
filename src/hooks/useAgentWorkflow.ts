import { useState, useCallback } from "react";
import { type WorkflowJob } from "../types/agent";
import { executeWorkflowJob, type StepExecutionHandler } from "../services/orchestratorEngine";
import { CircuitBreaker, TokenBucketRateLimiter } from "../utils/retry";

export function useAgentWorkflow() {
  const [currentJob, setCurrentJob] = useState<WorkflowJob | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [circuitBreaker] = useState(() => new CircuitBreaker(4, 15000));
  const [rateLimiter] = useState(() => new TokenBucketRateLimiter(50, 10));

  const runWorkflow = useCallback(
    async (job: WorkflowJob, stepHandler: StepExecutionHandler) => {
      setIsRunning(true);
      setCurrentJob(job);

      try {
        const result = await executeWorkflowJob(job, stepHandler, {
          circuitBreaker,
          rateLimiter
        });
        setCurrentJob(result);
        return result;
      } finally {
        setIsRunning(false);
      }
    },
    [circuitBreaker, rateLimiter]
  );

  return {
    currentJob,
    isRunning,
    circuitBreakerStatus: circuitBreaker.getStatus(),
    availableTokens: rateLimiter.getAvailableTokens(),
    runWorkflow
  };
}
