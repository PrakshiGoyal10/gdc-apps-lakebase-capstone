import { api } from "./client";
import type { GenieMessage } from "./types";

export const genieApi = {
  start: (content: string) =>
    api.post<GenieMessage>("/api/genie/conversations", { content }),

  send: (conv_id: string, content: string) =>
    api.post<GenieMessage>(`/api/genie/conversations/${conv_id}/messages`, { content }),

  poll: (conv_id: string, msg_id: string) =>
    api.get<GenieMessage>(`/api/genie/conversations/${conv_id}/messages/${msg_id}`),
};
