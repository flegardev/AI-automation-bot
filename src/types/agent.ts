import { z } from "zod";

export const AgentRoleSchema = z.enum([
  "ORCHESTRATOR",
  "RESEARCHER",
  "CODER",
  "DATA_ANALYST",
  "CRITIC_REVIEWER",
  "SAFETY_GUARD"
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const StepStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "RETRYING",
  "SKIPPED",
  "CIRCUIT_BROKEN"
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const CircuitBreakerStateSchema = z.enum(["CLOSED", "OPEN", "HALF_OPEN"]);
export type CircuitBreakerState = z.infer<typeof CircuitBreakerStateSchema>;

/**
 * Single step within an AI workflow pipeline
 */
export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  role: AgentRoleSchema,
  prompt: z.string().min(1),
  status: StepStatusSchema.default("PENDING"),
  retryCount: z.number().int().min(0).default(0),
  maxRetries: z.number().int().min(0).default(3),
  output: z.string().optional(),
  error: z.string().optional(),
  executionTimeMs: z.number().min(0).optional()
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/**
 * End-to-end multi-step workflow execution
 */
export const WorkflowJobSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(WorkflowStepSchema).min(1),
  createdAt: z.number().int().positive(),
  completedAt: z.number().int().positive().optional(),
  status: z.enum(["QUEUED", "IN_PROGRESS", "SUCCESS", "PARTIAL_FAILURE", "TERMINATED"]),
  totalTokensUsed: z.number().int().min(0).default(0),
  totalExecutionTimeMs: z.number().min(0).default(0)
});
export type WorkflowJob = z.infer<typeof WorkflowJobSchema>;

/**
 * Circuit Breaker Diagnostics Snapshot
 */
export const CircuitBreakerStatusSchema = z.object({
  state: CircuitBreakerStateSchema,
  consecutiveFailures: z.number().int().min(0),
  failureThreshold: z.number().int().positive(),
  lastFailureTimestamp: z.number().int().min(0),
  resetTimeoutMs: z.number().int().positive()
});
export type CircuitBreakerStatus = z.infer<typeof CircuitBreakerStatusSchema>;
