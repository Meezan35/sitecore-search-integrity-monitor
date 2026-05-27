export type SectionKey = "insights" | "people" | "news-events";

export interface UrlSource {
  getUrls(): Promise<string[]>;
}

export interface SitemapConnectorConfig {
  sitemapUrl: string;
  section: SectionKey;
  timeoutMs?: number;
}

export interface SitecoreSearchConnectorConfig {
  endpoint: string;
  apiKey: string;
  section: SectionKey;
  timeoutMs?: number;
}
