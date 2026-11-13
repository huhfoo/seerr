export interface ReleaseResult {
  guid: string;
  indexerId: number;
  title: string;
  releaseGroup?: string;
  customFormatScore?: number;
  customFormats?: { id: number; name: string }[];
  indexer: string;
  size: number;
  protocol: string;
  quality?: { quality: { name: string } };
  seeders?: number;
  leechers?: number;
  age?: number;
  rejected: boolean;
  rejections?: string[];
}

export interface ReleaseEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  hasFile: boolean;
  monitored: boolean;
}

export interface PreparedSeriesResponse {
  mediaId: number;
  episodes: ReleaseEpisode[];
}
