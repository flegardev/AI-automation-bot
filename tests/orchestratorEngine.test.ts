import { describe, it, expect } from "vitest";
import {
  calculateJitteredBackoffMs,
  TokenBucketRateLimiter,
  CircuitBreaker
} from "../src/utils/retry";
import { executeWorkflowJob } from "../src/services/orchestratorEngine";
import { type WorkflowJob, WorkflowJobSchema } from "../src/types/agent";

describe("AI Automation Bot Orchestrator Engine", () => {
  describe("Exponential Backoff with Full Jitter", () => {
    it("should generate bounded jittered backoff values", () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const backoff = calculateJitteredBackoffMs(attempt, 100, 1000);
        expect(backoff).toBeGreaterThanOrEqual(0);
        expect(backoff).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe("Token Bucket Rate Limiter", () => {
    it("should allow consuming within capacity and block when exhausted", () => {
      const limiter = new TokenBucketRateLimiter(3, 10);
      expect(limiter.tryConsume(1)).toBe(true);
      expect(limiter.tryConsume(1)).toBe(true);
      expect(limiter.tryConsume(1)).toBe(true);
      expect(limiter.tryConsume(1)).toBe(false); // Exhausted
    });
  });

  describe("Circuit Breaker State Machine", () => {
    it("should transition from CLOSED to OPEN after failure threshold is breached", () => {
      const cb = new CircuitBreaker(3, 1000);
      expect(cb.isExecutionAllowed()).toBe(true);

      cb.recordFailure();
      cb.recordFailure();
      expect(cb.isExecutionAllowed()).toBe(true);

      cb.recordFailure(); // 3rd failure triggers OPEN
      expect(cb.isExecutionAllowed()).toBe(false);
      expect(cb.getStatus().state).toBe("OPEN");
    });

    it("should reset to CLOSED upon recording success", () => {
      const cb = new CircuitBreaker(3, 1000);
      cb.recordFailure();
      cb.recordFailure();
      cb.recordSuccess();
      expect(cb.getStatus().consecutiveFailures).toBe(0);
      expect(cb.getStatus().state).toBe("CLOSED");
    });
  });

  describe("End-to-End Workflow Execution", () => {
    const createJob = (): WorkflowJob => ({
      id: "123e4567-e89b-12d3-a456-426614174000",
      title: "Automated Data Extraction Pipeline",
      steps: [
        {
          id: "step-1",
          title: "Scrape Content",
          role: "RESEARCHER",
          prompt: "Extract raw markdown text",
          status: "PENDING",
          retryCount: 0,
          maxRetries: 2
        },
        {
          id: "step-2",
          title: "Synthesize Summary",
          role: "ORCHESTRATOR",
          prompt: "Synthesize extracted insights",
          status: "PENDING",
          retryCount: 0,
          maxRetries: 2
        }
      ],
      createdAt: 1700000000000,
      status: "QUEUED",
      totalTokensUsed: 0,
      totalExecutionTimeMs: 0
    });

    it("should execute all steps successfully with mocked handler", async () => {
      const job = createJob();
      const mockHandler = async (step: any) => `Output for ${step.title}`;

      const result = await executeWorkflowJob(job, mockHandler);
      expect(result.status).toBe("SUCCESS");
      expect(result.steps[0]?.status).toBe("COMPLETED");
      expect(result.steps[1]?.status).toBe("COMPLETED");
      expect(result.steps[0]?.output).toBe("Output for Scrape Content");
      expect(() => WorkflowJobSchema.parse(result)).not.toThrow();
    });

    it("should retry transient failures and succeed", async () => {
      const job = createJob();
      let callCount = 0;

      const flakyHandler = async (step: any) => {
        if (step.id === "step-1" && callCount === 0) {
          callCount++;
          throw new Error("Rate limit 429 from LLM");
        }
        return "Flaky step recovered";
      };

      const result = await executeWorkflowJob(job, flakyHandler, {
        initialBackoffMs: 10,
        maxBackoffMs: 50
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.steps[0]?.retryCount).toBe(1);
      expect(result.steps[0]?.status).toBe("COMPLETED");
    });
  });
});
