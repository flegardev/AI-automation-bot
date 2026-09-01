# 🎓 AI Automation Bot Orchestrator — Beginner's Learning Guide

## What This Project Does
**ai-automation-bot** is a fault-tolerant AI multi-agent workflow orchestrator featuring exponential backoff with full jitter, token bucket rate limiting, circuit breaker state machines, and Zod runtime schema validation.

---

## 🗺️ Architecture Map

```
CORE AGENT DOMAIN & SCHEMAS
  │  (src/types/agent.ts - Step Status, Circuit Breaker State, WorkflowJob Zod Schemas)
  ▼
FAULT TOLERANCE & RESILIENCE ENGINES
  │  ├── Exponential Backoff with Jitter (src/utils/retry.ts)
  │  ├── Token Bucket Rate Limiter (src/services/orchestratorEngine.ts)
  │  └── Circuit Breaker State Machine (CLOSED -> OPEN -> HALF_OPEN)
  ▼
WORKFLOW ORCHESTRATION PIPELINE
  │  ├── executeWorkflowJob (src/services/orchestratorEngine.ts)
  │  └── useAgentWorkflow (src/hooks/useAgentWorkflow.ts)
  ▼
RELIABILITY & INVARIANT TESTS
     (tests/orchestratorEngine.test.ts - Vitest Fault Recovery & Circuit Breaker Invariants)
```

---

## 🎯 Core Files to Study First (Recommended Learning Order)

1. [`src/services/orchestratorEngine.ts`](file:///C:/Users/tinif/repos/ai-automation-bot/src/services/orchestratorEngine.ts)
   - **Why study first**: Teaches how to implement circuit breaker patterns, token bucket rate limiting, and resilient multi-step job pipelines.
2. [`src/types/agent.ts`](file:///C:/Users/tinif/repos/ai-automation-bot/src/types/agent.ts)
   - **Why study next**: Shows how Zod schemas guard data boundaries across autonomous agents.
3. [`src/utils/retry.ts`](file:///C:/Users/tinif/repos/ai-automation-bot/src/utils/retry.ts)
   - **Why study third**: Demonstrates mathematical full jitter exponential backoff formulas for distributed system calls.

---

## 🛠️ How to Run & Verify

```bash
npm test
npm run typecheck
npm run build
```
