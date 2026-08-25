import React from "react";
import { type WorkflowJob } from "../types/agent";

export interface WorkflowStatusCardProps {
  job: WorkflowJob;
}

export const WorkflowStatusCard: React.FC<WorkflowStatusCardProps> = ({ job }) => {
  const isComplete = job.status === "SUCCESS";
  const isFailed = job.status === "TERMINATED" || job.status === "PARTIAL_FAILURE";

  return (
    <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">{job.title}</h2>
          <p className="text-xs text-slate-400 font-mono">Job ID: {job.id}</p>
        </div>
        <span
          className={`text-xs px-3 py-1 rounded-full font-bold uppercase ${
            isComplete
              ? "bg-emerald-100 text-emerald-700"
              : isFailed
              ? "bg-rose-100 text-rose-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {job.status.replace("_", " ")}
        </span>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Execution Steps ({job.steps.length})</h3>
        {job.steps.map((s, idx) => (
          <div
            key={s.id}
            className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs"
          >
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 flex items-center justify-center bg-slate-200 dark:bg-slate-700 rounded-full font-mono font-bold">
                {idx + 1}
              </span>
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">{s.title}</div>
                <div className="text-[10px] text-slate-400 font-mono">Role: {s.role}</div>
              </div>
            </div>
            <div className="text-right">
              <span
                className={`font-semibold ${
                  s.status === "COMPLETED"
                    ? "text-emerald-600"
                    : s.status === "FAILED" || s.status === "CIRCUIT_BROKEN"
                    ? "text-rose-600"
                    : "text-amber-600"
                }`}
              >
                {s.status}
              </span>
              {s.retryCount > 0 && <span className="text-[10px] text-slate-400 ml-1">({s.retryCount} retries)</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
