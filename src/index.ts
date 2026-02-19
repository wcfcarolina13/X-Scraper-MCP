#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = "https://api.fxtwitter.com";

// ── Types ──────────────────────────────────────────────────────────────────

interface FxTweetAuthor {
  id: string;
  name: string;
  screen_name: string;
  avatar_url: string;
  description: string;
  location: string;
  url: string;
  followers: number;
  following: number;
  joined: string;
  likes: number;
  tweets: number;
  protected: boolean;
  website?: { url: string; display_url: string };
}

interface FxTweetMedia {
  photos?: Array<{ url: string; width: number; height: number }>;
  videos?: Array<{
    url: string;
    thumbnail_url: string;
    width: number;
    height: number;
    type: string;
  }>;
}

interface FxTweetPollChoice {
  label: string;
  count: number;
  percentage: number;
}

interface FxTweet {
  id: string;
  url: string;
  text: string;
  author: FxTweetAuthor;
  replies: number;
  retweets: number;
  likes: number;
  bookmarks?: number;
  views: number | null;
  created_at: string;
  created_timestamp: number;
  lang: string;
  replying_to: string | null;
  replying_to_status: string | null;
  source: string;
  media?: FxTweetMedia;
  quote?: FxTweet;
  poll?: { choices: FxTweetPollChoice[]; total_votes: number; ends_at: string };
  is_note_tweet?: boolean;
  community_note?: { text: string } | null;
}

interface FxTweetResponse {
  code: number;
  message: string;
  tweet: FxTweet | null;
}

interface FxUserResponse {
  code: number;
  message: string;
  user: FxTweetAuthor | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract tweet ID and optional username from various X/Twitter URL formats.
 * Supports: x.com, twitter.com, fxtwitter.com, vxtwitter.com, fixvx.com
 */
function parseTweetUrl(input: string): { username: string; tweetId: string } | null {
  // If it's just a numeric ID
  if (/^\d+$/.test(input.trim())) {
    return { username: "i", tweetId: input.trim() };
  }

  const patterns = [
    /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|fxtwitter\.com|vxtwitter\.com|fixvx\.com)\/(\w+)\/status\/(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      return { username: match[1], tweetId: match[2] };
    }
  }
  return null;
}

/**
 * Extract username from various X/Twitter profile URL formats.
 */
function parseUserUrl(input: string): string | null {
  // If it starts with @, strip it
  if (input.startsWith("@")) return input.slice(1);

  // If it's just a plain username (no slashes, no dots)
  if (/^\w+$/.test(input.trim())) return input.trim();

  const match = input.match(
    /(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com|fxtwitter\.com)\/(\w+)\/?$/i
  );
  return match ? match[1] : null;
}

async function fetchTweet(username: string, tweetId: string): Promise<FxTweetResponse> {
  const url = `${API_BASE}/${username}/status/${tweetId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FxTwitter API returned ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<FxTweetResponse>;
}

async function fetchUser(username: string): Promise<FxUserResponse> {
  const url = `${API_BASE}/${username}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`FxTwitter API returned ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<FxUserResponse>;
}

/**
 * Fetch the syndication embed timeline for a user and extract tweet IDs
 * that belong to a given conversation. This is the only free way to discover
 * child tweets in a thread without Twitter API v2 access.
 */
async function fetchThreadChildrenViaSyndication(
  screenName: string,
  conversationRootId: string
): Promise<string[]> {
  try {
    const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${screenName}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Extract tweet IDs from the timeline HTML — they appear in data-tweet-id or /status/ID patterns
    const idPattern = /\/status\/(\d+)/g;
    const foundIds = new Set<string>();
    let match;
    while ((match = idPattern.exec(html)) !== null) {
      foundIds.add(match[1]);
    }

    // Also try data-tweet-id attributes
    const dataPattern = /data-tweet-id="(\d+)"/g;
    while ((match = dataPattern.exec(html)) !== null) {
      foundIds.add(match[1]);
    }

    // Filter: only return IDs that are newer than the conversation root
    // (thread children are always posted after the root)
    const rootBigInt = BigInt(conversationRootId);
    return Array.from(foundIds)
      .filter((id) => BigInt(id) > rootBigInt)
      .sort((a, b) => {
        const diff = BigInt(a) - BigInt(b);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      });
  } catch {
    return [];
  }
}

/**
 * Parse multiple URLs/IDs from a string (comma, newline, or space separated).
 */
function parseMultipleUrls(input: string): Array<{ username: string; tweetId: string }> {
  const results: Array<{ username: string; tweetId: string }> = [];
  // Split on commas, newlines, or spaces (but not spaces within URLs)
  const parts = input.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    // Each part might have spaces around it or be a full URL
    const tokens = part.split(/\s+/);
    for (const token of tokens) {
      const parsed = parseTweetUrl(token);
      if (parsed) results.push(parsed);
    }
  }
  return results;
}

function formatNumber(n: number | null | undefined): string {
  if (n == null) return "N/A";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatTweet(tweet: FxTweet, index?: number): string {
  const parts: string[] = [];

  // Header
  const prefix = index != null ? `### Tweet ${index + 1}` : `### Tweet`;
  parts.push(`${prefix} by @${tweet.author.screen_name} (${tweet.author.name})`);
  parts.push("");

  // Text
  parts.push(tweet.text);
  parts.push("");

  // Poll
  if (tweet.poll) {
    parts.push("**Poll:**");
    for (const choice of tweet.poll.choices) {
      const bar = "█".repeat(Math.round(choice.percentage / 5)) +
        "░".repeat(20 - Math.round(choice.percentage / 5));
      parts.push(`  ${bar} ${choice.percentage}% — ${choice.label} (${formatNumber(choice.count)})`);
    }
    parts.push(`  Total votes: ${formatNumber(tweet.poll.total_votes)}`);
    parts.push("");
  }

  // Media
  if (tweet.media) {
    if (tweet.media.photos?.length) {
      parts.push(`**Photos:** ${tweet.media.photos.length} image(s)`);
      for (const photo of tweet.media.photos) {
        parts.push(`  - ${photo.url} (${photo.width}x${photo.height})`);
      }
      parts.push("");
    }
    if (tweet.media.videos?.length) {
      parts.push(`**Videos:** ${tweet.media.videos.length} video(s)`);
      for (const video of tweet.media.videos) {
        parts.push(`  - ${video.type}: ${video.url}`);
      }
      parts.push("");
    }
  }

  // Quote tweet
  if (tweet.quote) {
    parts.push("**Quoted tweet:**");
    parts.push(`> @${tweet.quote.author.screen_name}: ${tweet.quote.text}`);
    parts.push("");
  }

  // Community note
  if (tweet.community_note) {
    parts.push(`**Community Note:** ${tweet.community_note.text}`);
    parts.push("");
  }

  // Engagement
  const stats = [
    `${formatNumber(tweet.likes)} likes`,
    `${formatNumber(tweet.retweets)} retweets`,
    `${formatNumber(tweet.replies)} replies`,
    `${formatNumber(tweet.views)} views`,
  ].join(" · ");
  parts.push(`*${stats}*`);

  // Timestamp
  parts.push(`*${tweet.created_at}*`);
  parts.push(`*Source: ${tweet.source}*`);
  parts.push(`*URL: ${tweet.url}*`);

  return parts.join("\n");
}

function formatUser(user: FxTweetAuthor): string {
  const parts: string[] = [];
  parts.push(`## @${user.screen_name} (${user.name})`);
  parts.push("");
  if (user.description) {
    parts.push(user.description);
    parts.push("");
  }
  if (user.location) parts.push(`**Location:** ${user.location}`);
  if (user.website) parts.push(`**Website:** ${user.website.display_url} (${user.website.url})`);
  parts.push(`**Joined:** ${user.joined}`);
  parts.push("");
  parts.push(`**Followers:** ${formatNumber(user.followers)} · **Following:** ${formatNumber(user.following)}`);
  parts.push(`**Tweets:** ${formatNumber(user.tweets)} · **Likes:** ${formatNumber(user.likes)}`);
  parts.push("");
  parts.push(`**Profile:** ${user.url}`);
  if (user.protected) parts.push("*This account is protected.*");
  return parts.join("\n");
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "fxtwitter",
  version: "1.0.0",
});

// ── read_tweet ─────────────────────────────────────────────────────────────

server.tool(
  "read_tweet",
  "Fetch and display a single X/Twitter post. Accepts any URL format (x.com, twitter.com, fxtwitter.com) or just a tweet ID.",
  {
    url: z.string().describe("X/Twitter URL or tweet ID (e.g. https://x.com/user/status/123 or just 123)"),
  },
  async ({ url }) => {
    const parsed = parseTweetUrl(url);
    if (!parsed) {
      return {
        content: [{ type: "text" as const, text: `Could not parse tweet URL or ID: ${url}` }],
        isError: true,
      };
    }

    try {
      const data = await fetchTweet(parsed.username, parsed.tweetId);
      if (data.code !== 200 || !data.tweet) {
        return {
          content: [{ type: "text" as const, text: `FxTwitter API error: ${data.message} (code ${data.code})` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: formatTweet(data.tweet) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error fetching tweet: ${err}` }],
        isError: true,
      };
    }
  }
);

// ── read_thread ────────────────────────────────────────────────────────────

server.tool(
  "read_thread",
  `Unroll an X/Twitter thread into readable markdown.

USAGE MODES:
1. Single URL (any tweet in the thread) — walks up to the root, then tries to discover children via syndication timeline.
2. Multiple URLs — provide several tweet URLs from the thread (comma or newline separated). All will be fetched, deduped, and ordered chronologically. Best results when you include the LAST tweet URL.

TIP: If you have the first tweet of a thread and it says "1/↓", try providing the URL of the LAST tweet in the thread for best results (the tool walks upward perfectly). You can also provide multiple URLs.`,
  {
    urls: z.string().describe(
      "One or more X/Twitter URLs or tweet IDs, separated by commas or newlines. " +
      "E.g. 'https://x.com/user/status/111, https://x.com/user/status/222' or just a single URL."
    ),
    max_tweets: z
      .number()
      .optional()
      .default(50)
      .describe("Maximum number of tweets to fetch (default 50, to avoid infinite loops)"),
  },
  async ({ urls, max_tweets }) => {
    const parsedUrls = parseMultipleUrls(urls);
    if (parsedUrls.length === 0) {
      return {
        content: [{ type: "text" as const, text: `Could not parse any tweet URLs from: ${urls}` }],
        isError: true,
      };
    }

    try {
      // Fetch all explicitly provided tweets
      const fetchedTweets = new Map<string, FxTweet>();

      for (const p of parsedUrls) {
        if (fetchedTweets.has(p.tweetId)) continue;
        try {
          const data = await fetchTweet(p.username, p.tweetId);
          if (data.code === 200 && data.tweet) {
            fetchedTweets.set(data.tweet.id, data.tweet);
          }
        } catch {
          // Skip failed fetches
        }
      }

      if (fetchedTweets.size === 0) {
        return {
          content: [{ type: "text" as const, text: `Could not fetch any of the provided tweets.` }],
          isError: true,
        };
      }

      // Determine the author from the first successfully fetched tweet
      const firstTweet = fetchedTweets.values().next().value!;
      const authorScreenName = firstTweet.author.screen_name;

      // Walk UP from every fetched tweet to find ancestors
      for (const tweet of Array.from(fetchedTweets.values())) {
        let current = tweet;
        let safety = 0;
        while (current.replying_to_status && safety < max_tweets) {
          safety++;
          if (fetchedTweets.has(current.replying_to_status)) break; // already have it
          try {
            const parentData = await fetchTweet(
              current.replying_to || authorScreenName,
              current.replying_to_status
            );
            if (parentData.code !== 200 || !parentData.tweet) break;
            // Only follow self-replies (same author = thread)
            if (parentData.tweet.author.screen_name.toLowerCase() !== authorScreenName.toLowerCase()) break;
            fetchedTweets.set(parentData.tweet.id, parentData.tweet);
            current = parentData.tweet;
          } catch {
            break;
          }
        }
      }

      // Step 3: Try to discover thread children via syndication timeline
      // Find the root tweet (earliest by ID)
      const allTweetsSorted = Array.from(fetchedTweets.values()).sort((a, b) => {
        const diff = BigInt(a.id) - BigInt(b.id);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      });
      const rootTweet = allTweetsSorted[0];

      let syndicationUsed = false;
      const candidateIds = await fetchThreadChildrenViaSyndication(
        authorScreenName,
        rootTweet.id
      );

      if (candidateIds.length > 0) {
        syndicationUsed = true;
        for (const candidateId of candidateIds) {
          if (fetchedTweets.has(candidateId)) continue;
          if (fetchedTweets.size >= max_tweets) break;
          try {
            const data = await fetchTweet(authorScreenName, candidateId);
            if (data.code !== 200 || !data.tweet) continue;
            // Must be same author
            if (data.tweet.author.screen_name.toLowerCase() !== authorScreenName.toLowerCase()) continue;
            // Must be a reply to something already in our thread (self-reply chain)
            if (data.tweet.replying_to_status && fetchedTweets.has(data.tweet.replying_to_status)) {
              fetchedTweets.set(data.tweet.id, data.tweet);
            }
          } catch {
            continue;
          }
        }
      }

      // Build final sorted thread
      const threadTweets = Array.from(fetchedTweets.values()).sort((a, b) => {
        const diff = BigInt(a.id) - BigInt(b.id);
        return diff < 0n ? -1 : diff > 0n ? 1 : 0;
      });

      if (threadTweets.length === 1) {
        const tweet = threadTweets[0];
        const hint = tweet.replying_to_status
          ? ""
          : tweet.replies > 0
          ? `\n\n💡 **Tip:** This looks like the first tweet of a thread (${tweet.replies} replies). To unroll the full thread, provide the URL of the **last** tweet in the thread, or multiple tweet URLs from the thread.`
          : "";
        return {
          content: [{
            type: "text" as const,
            text: `# Single Tweet\n\n${formatTweet(tweet)}${hint}`,
          }],
        };
      }

      // Format the thread
      const parts: string[] = [];
      parts.push(`# Thread by @${authorScreenName} (${threadTweets.length} tweets)`);
      parts.push(`*Unrolled from ${parsedUrls.length} provided URL(s)*`);
      parts.push("");
      parts.push("---");
      parts.push("");

      for (let i = 0; i < threadTweets.length; i++) {
        parts.push(formatTweet(threadTweets[i], i));
        parts.push("");
        parts.push("---");
        parts.push("");
      }

      // Summary stats
      const totalLikes = threadTweets.reduce((sum, t) => sum + t.likes, 0);
      const totalRetweets = threadTweets.reduce((sum, t) => sum + t.retweets, 0);
      parts.push(`**Thread stats:** ${threadTweets.length} tweets · ${formatNumber(totalLikes)} total likes · ${formatNumber(totalRetweets)} total retweets`);

      if (syndicationUsed) {
        parts.push("");
        parts.push("*Thread children discovered via syndication timeline.*");
      }

      return {
        content: [{ type: "text" as const, text: parts.join("\n") }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error unrolling thread: ${err}` }],
        isError: true,
      };
    }
  }
);

// ── read_user ──────────────────────────────────────────────────────────────

server.tool(
  "read_user",
  "Fetch an X/Twitter user profile. Accepts a URL, @handle, or plain username.",
  {
    user: z.string().describe("X/Twitter profile URL, @handle, or username"),
  },
  async ({ user }) => {
    const username = parseUserUrl(user);
    if (!username) {
      return {
        content: [{ type: "text" as const, text: `Could not parse username from: ${user}` }],
        isError: true,
      };
    }

    try {
      const data = await fetchUser(username);
      if (data.code !== 200 || !data.user) {
        return {
          content: [{ type: "text" as const, text: `FxTwitter API error: ${data.message} (code ${data.code})` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: formatUser(data.user) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error fetching user: ${err}` }],
        isError: true,
      };
    }
  }
);

// ── Start Server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FxTwitter MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
