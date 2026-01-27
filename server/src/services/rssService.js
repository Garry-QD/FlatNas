import RSSParser from "rss-parser";
import { RSS_CACHE_TTL } from "../config/constants.js";

const rssParser = new RSSParser();
const RSS_CACHE = new Map();

export const fetchRssFeed = async (url) => {
  if (!url) throw new Error("URL required");

  // Check Cache
  const cached = RSS_CACHE.get(url);
  if (cached && Date.now() - cached.ts < RSS_CACHE_TTL) {
    return cached.data;
  }

  try {
    const feed = await Promise.race([
      rssParser.parseURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 10000)),
    ]);

    // Save to Cache
    RSS_CACHE.set(url, { data: feed, ts: Date.now() });
    return feed;
  } catch (err) {
    // Fallback to Stale Cache
    if (cached) {
      console.warn(`[RSS] Using stale cache for ${url}`);
      return cached.data;
    }
    throw err;
  }
};

export const getHotNews = async (type = "news") => {
  // Logic from server.js for specific feeds like chinanews/huxiu
  const urls = {
    news: "https://www.chinanews.com.cn/rss/scroll-news.xml",
    huxiu: "https://www.huxiu.com/rss/0.xml",
  };

  const url = urls[type];
  if (!url) throw new Error(`Unknown hot news type: ${type}`);

  const feed = await fetchRssFeed(url);
  return (feed.items || [])
    .slice(0, 50)
    .map((i) => ({ title: i.title, url: i.link, time: i.pubDate }));
};
