# X-Scraper-MCP

An MCP (Model Context Protocol) server that reads X/Twitter posts, threads, and user profiles — directly inside Claude Code, Cursor, or any MCP-compatible client.

No Twitter API key required. No third-party services. No ads.

Built as a replacement for services like [Unrollnow](https://unrollnow.com/) — paste an X link, get clean readable content.

## Tools

| Tool | Description |
|------|-------------|
| `read_tweet` | Fetch a single tweet. Returns text, media, polls, quotes, engagement stats, community notes. |
| `read_thread` | Unroll a full thread into readable markdown. Walks up to the root and discovers children via syndication. Supports multi-URL input. |
| `read_user` | Fetch a user profile — bio, follower counts, join date, verification status. |
| `download_media` | Download images/videos from a tweet to local filesystem. Returns file paths, dimensions, and sizes. |
| `analyze_media` | Extract text from images using OCR (Tesseract.js). Accepts local files or URLs. |

### URL Formats

All tools accept any X/Twitter URL format:
- `https://x.com/user/status/123`
- `https://twitter.com/user/status/123`
- `https://fxtwitter.com/user/status/123`
- `https://vxtwitter.com/user/status/123`
- `@username` or bare `username` (for `read_user`)
- Bare tweet ID: `123456789`

## Setup

### Prerequisites

- Node.js 18+
- npm

### Install

```bash
git clone https://github.com/wcfcarolina13/X-Scraper-MCP.git
cd X-Scraper-MCP
npm install
```

### Configure in Claude Code

Add to your project's `.mcp.json` (or `~/.claude/settings.json` for global access):

```json
{
  "mcpServers": {
    "fxtwitter": {
      "command": "npx",
      "args": ["tsx", "/path/to/X-Scraper-MCP/src/index.ts"]
    }
  }
}
```

Replace `/path/to/X-Scraper-MCP` with the actual path where you cloned the repo.

### Configure in Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "fxtwitter": {
      "command": "npx",
      "args": ["tsx", "/path/to/X-Scraper-MCP/src/index.ts"]
    }
  }
}
```

## Usage

Once configured, the tools are available in any Claude conversation:

**Read a single tweet:**
> "Read this tweet: https://x.com/jack/status/20"

**Unroll a thread:**
> "Unroll this thread: https://x.com/user/status/123456"

**Read a profile:**
> "Who is @elonmusk on X?"

**Download media from a tweet:**
> "Download the images from this tweet to /tmp/media: https://x.com/user/status/123"

**OCR an image:**
> "Analyze the text in /tmp/media/123_0.jpg"

### Thread Unrolling

`read_thread` uses three strategies to assemble a complete thread:

1. **Walk up** — From the given tweet, follows `replying_to_status` links to find the thread root.
2. **Syndication discovery** — Scrapes Twitter's embed timeline to find child tweets by the same author.
3. **Multi-URL input** — Accepts multiple URLs (comma or newline separated) and stitches them together.

**Best practice:** If you have the *last* tweet in a thread, provide that URL — walking up is 100% reliable. If you only have the first tweet, syndication discovery handles it for recent threads.

```
# Single URL
read_thread("https://x.com/user/status/111")

# Multiple URLs for guaranteed coverage
read_thread("https://x.com/user/status/111, https://x.com/user/status/222, https://x.com/user/status/333")
```

## How It Works

Uses the free [FxTwitter API](https://github.com/FixTweet/FxTwitter) — the same backend that powers fxtwitter.com embed links. No authentication needed, no rate limits enforced (just don't abuse it).

For thread child discovery, falls back to Twitter's [syndication timeline](https://syndication.twitter.com) which serves embedded tweet widgets and exposes recent tweet IDs for public accounts.

### Output Format

All output is clean markdown:

```markdown
### Tweet by @user (Display Name)

The tweet text here...

**Photos:** 2 image(s)
  - https://pbs.twimg.com/media/xxx.jpg (1024x768)
  - https://pbs.twimg.com/media/yyy.jpg (1024x768)

*1.2K likes · 340 retweets · 56 replies · 45.2K views*
*Wed Feb 19 04:17:27 +0000 2026*
*Source: Twitter for iPhone*
*URL: https://x.com/user/status/123*
```

## Optional: ScrapeBadger MCP

For richer Twitter data (search, trending, advanced thread traversal), you can add [ScrapeBadger MCP](https://github.com/scrape-badger/scrapebadger-mcp) alongside this server:

```json
{
  "mcpServers": {
    "fxtwitter": {
      "command": "npx",
      "args": ["tsx", "/path/to/X-Scraper-MCP/src/index.ts"]
    },
    "scrapebadger": {
      "command": "uvx",
      "args": ["scrapebadger-mcp"],
      "env": {
        "SCRAPEBADGER_API_KEY": "your_key_here"
      }
    }
  }
}
```

Get a free API key (1,000 credits) at [scrapebadger.com](https://scrapebadger.com).

## Limitations

- **Protected accounts** — Cannot access tweets from private/protected accounts (same as any logged-out view).
- **Thread discovery** — Syndication timeline only contains recent tweets. For old threads, provide the last tweet URL or multiple URLs.
- **No search** — FxTwitter API doesn't support tweet search. Use ScrapeBadger for that.
- **Rate limits** — FxTwitter asks for respectful usage. No hard limits, but hammering the API may get you blocked.

## License

MIT
