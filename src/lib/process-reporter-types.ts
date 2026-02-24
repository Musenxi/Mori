export interface ProcessReporterIncomingPayload {
  timestamp?: number;
  key?: string;
  process?: string;
  media?: {
    title?: string;
    artist?: string;
  };
  meta?: {
    iconUrl?: string;
    iconBase64?: string;
    description?: string;
  };
}

export interface ProcessReporterStatusSnapshot {
  process: string | null;
  description: string | null;
  mediaTitle: string | null;
  mediaArtist: string | null;
  updatedAt: number;
  sourceTimestamp: number | null;
  staleAt: number;
}

export interface ProcessReporterStatusResponse {
  ok: boolean;
  data: ProcessReporterStatusSnapshot | null;
  stale: boolean;
  enabled: boolean;
}
