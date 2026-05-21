import { api } from "./client";
import type { JobRun, JobRunHistory } from "./types";

export const jobsApi = {
  runForwardEtl: () =>
    api.post<JobRun>("/api/jobs/run-forward-etl", {}),

  getRun: (run_id: number) =>
    api.get<JobRun>(`/api/jobs/${run_id}`),

  recent: (limit = 10) =>
    api.get<JobRunHistory>(`/api/jobs?limit=${limit}`),
};
