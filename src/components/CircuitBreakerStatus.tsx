import React from "react";
import { type CircuitBreakerStatus as CBStatus } from "../types/agent";

export interface CircuitBreakerStatusProps {
  status: CBStatus;
  availableTokens: number;
}

export const CircuitBreakerStatus: React.FC<CircuitBreakerStatusProps> = ({
  status,
  availableTokens
}) => {
  const isHealthy = status.state === "CLOSED";

  return (
    <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between text-xs">
      <div className="flex items-center gap-3">
        <div
          className={`w-3 h-3 rounded-full ${
            isHealthy
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
              : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
          }`}
        />
        <div>
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Circuit State: {status.state}
          </span>
          <span className="text-slate-400 ml-2 font-mono">
            Failures: {status.consecutiveFailures}/{status.failureThreshold}
          </span>
        </div>
      </div>
      <div className="font-mono text-slate-600 dark:text-slate-400">
        Rate Limit Tokens: <strong className="text-blue-600 dark:text-blue-400">{availableTokens}</strong>
      </div>
    </div>
  );
};
