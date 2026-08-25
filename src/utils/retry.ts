import { type CircuitBreakerState, type CircuitBreakerStatus } from "../types/agent";

export interface RetryOptions {
  maxRetries: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
  backoffFactor?: number;
}

/**
 * Calculates exponential backoff duration with full jitter to avoid thundering herds
 */
export function calculateJitteredBackoffMs(
  attempt: number,
  initialBackoffMs: number = 500,
  maxBackoffMs: number = 8000,
  factor: number = 2
): number {
  const exponential = initialBackoffMs * Math.pow(factor, attempt);
  const capped = Math.min(maxBackoffMs, exponential);
  // Full jitter: random uniformly between 0 and capped
  return Math.floor(Math.random() * capped);
}

/**
 * Token Bucket Rate Limiter
 */
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRatePerMs: number;
  private tokens: number;
  private lastRefillTimestamp: number;

  constructor(capacity: number, refillTokensPerSecond: number) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillRatePerMs = refillTokensPerSecond / 1000;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = Math.max(0, now - this.lastRefillTimestamp);
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillRatePerMs);
    this.lastRefillTimestamp = now;
  }

  public tryConsume(tokensRequested: number = 1): boolean {
    this.refill();
    if (this.tokens >= tokensRequested) {
      this.tokens -= tokensRequested;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/**
 * Fault-Tolerant Circuit Breaker State Machine
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures: number = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private lastFailureTimestamp: number = 0;

  constructor(failureThreshold: number = 5, resetTimeoutMs: number = 30000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  public getStatus(): CircuitBreakerStatus {
    this.evaluateState();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      failureThreshold: this.failureThreshold,
      lastFailureTimestamp: this.lastFailureTimestamp,
      resetTimeoutMs: this.resetTimeoutMs
    };
  }

  public isExecutionAllowed(): boolean {
    this.evaluateState();
    return this.state !== "OPEN";
  }

  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = "CLOSED";
  }

  public recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureTimestamp = Date.now();
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
    }
  }

  private evaluateState(): void {
    if (this.state === "OPEN") {
      const now = Date.now();
      if (now - this.lastFailureTimestamp >= this.resetTimeoutMs) {
        this.state = "HALF_OPEN";
      }
    }
  }
}
