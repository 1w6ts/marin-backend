# Backend Implementation Guide for AI

## Overview

This is a Node.js/Express backend that provides video metadata extraction and download functionality using yt-dlp. It serves as a proxy between a frontend and yt-dlp, handling YouTube authentication via cookies.

## Tech Stack

- **Runtime**: Node.js 22 with Bun
- **Framework**: Express 5
- **Video Downloader**: yt-dlp (CLI tool)
- **Language**: TypeScript
- **Container**: Docker

## Project Structure

```
marin-backend/
├── src/
│   ├── marin.ts          # Main Express server entry point
│   ├── routes/
│   │   └── media.ts      # API route handlers (/api/info, /api/download)
│   └── services/
│       └── ytdlp.ts      # yt-dlp wrapper functions
├── cookies.txt           # YouTube authentication cookies (gitignored)
├── Dockerfile            # Container build definition
├── docker-compose.yml    # Container orchestration
├── tsconfig.json         # TypeScript configuration
└── package.json          # Dependencies
```

## Server Setup (src/marin.ts)

```typescript
import express from "express";
import helmet from "helmet";
import cors from "cors";
import mediaRoute from "./routes/media";

const app = express();

// Security middleware
app.use(helmet());

// CORS enabled for all origins
app.use(cors());

// JSON body parsing
app.use(express.json());

// Health check endpoint
app.get("/health", (_, res) => {
    res.json({ ok: true });
});

// Mount API routes under /api
app.use("/api", mediaRoute);

// Server listens on port 9000
app.listen(9000, () => {
    console.log("running on 9000");
});
```

**Key Points:**
- Port: 9000 (configurable via environment if needed)
- CORS: Enabled for all origins (suitable for public API)
- Security: Helmet middleware for HTTP headers
- Routes: All API endpoints are under `/api`

## yt-dlp Service (src/services/ytdlp.ts)

This module wraps yt-dlp CLI commands in Node.js child processes.

### Cookie Handling

```typescript
const COOKIES_PATH = join(process.cwd(), "cookies.txt");
const cookiesFileExists = existsSync(COOKIES_PATH) && statSync(COOKIES_PATH).isFile();
```

- Checks if `cookies.txt` exists and is a file (not directory)
- If cookies exist, passes `--cookies <path>` to yt-dlp
- Cookies are optional — API works without them but may hit YouTube bot detection

### extractVideo Function

```typescript
export function extractVideo(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const args = [
            "-J",                    // JSON output (metadata only)
            "--no-playlist",         // Don't download entire playlists
            "--no-warnings",         // Suppress warning messages
            url
        ];

        if (cookiesFileExists) {
            args.push("--cookies", COOKIES_PATH);
        }

        const p = spawn("yt-dlp", args, { shell: false });

        // 30-second timeout to prevent hanging
        const timeout = setTimeout(() => {
            p.kill();
            reject(new Error("yt-dlp timeout after 30s"));
        }, 30000);

        // Capture stdout (JSON metadata)
        p.stdout.on("data", d => out += d.toString());

        // Capture stderr (errors)
        p.stderr.on("data", d => err += d.toString());

        p.on("close", code => {
            clearTimeout(timeout);
            if (code !== 0) {
                return reject(new Error(err));
            }
            resolve(JSON.parse(out));
        });
    });
}
```

**Behavior:**
- Uses `-J` flag to get JSON metadata only (no download)
- 30-second timeout prevents indefinite hanging
- Returns parsed JSON with video info and available formats
- Errors if yt-dlp exits with non-zero code

### downloadVideo Function

```typescript
export function downloadVideo(url: string, formatId: string): ChildProcess {
    const args = [
        "-o", "-",                // Output to stdout (stream)
        "-f", formatId,           // Specific format to download
        "--no-playlist",
        "--no-warnings",
        url
    ];

    if (cookiesFileExists) {
        args.push("--cookies", COOKIES_PATH);
    }

    return spawn("yt-dlp", args, { shell: false });
}
```

**Behavior:**
- Uses `-o -` to output video to stdout (streaming)
- Downloads specific format via `-f <formatId>`
- Returns ChildProcess (not Promise) for streaming
- Caller must pipe stdout to HTTP response

## API Routes (src/routes/media.ts)

### POST /api/info

Extracts video metadata without downloading.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=..."
}
```

**Response:**
```json
{
  "title": "Video Title",
  "thumbnail": "https://...",
  "duration": 180,
  "formats": [
    {
      "formatId": "137",
      "ext": "mp4",
      "quality": "1080p",
      "width": 1920,
      "height": 1080,
      "url": "https://googlevideo.com/..."
    }
  ]
}
```

**Implementation:**
```typescript
router.post("/info", async (req, res) => {
    const url = req.body?.url;

    if (!url) {
        return res.status(400).json({ error: "missing url" });
    }

    try {
        const data = await extractVideo(url);

        // Filter formats to only those with direct URLs
        const formats = (data.formats || [])
            .filter((f: any) => f.url)
            .map((f: any) => ({
                formatId: f.format_id,
                ext: f.ext,
                quality: f.format_note,
                width: f.width,
                height: f.height,
                url: f.url
            }));

        return res.json({
            title: data.title,
            thumbnail: data.thumbnail,
            duration: data.duration,
            formats
        });

    } catch (err: any) {
        return res.status(500).json({
            error: "yt-dlp failed",
            detail: err.message
        });
    }
});
```

**Key Points:**
- Returns only formats with usable `url` fields
- Formats array is simplified to essential fields
- `url` fields are short-lived CDN URLs (expire in ~6 hours)

### POST /api/download

Streams video file directly through the backend.

**Request:**
```json
{
  "url": "https://youtube.com/watch?v=...",
  "formatId": "137"
}
```

**Response:**
- **Content-Type**: `application/octet-stream`
- **Content-Disposition**: `attachment`
- **Body**: Binary video stream

**Implementation:**
```typescript
router.post("/download", async (req, res) => {
    const { url, formatId } = req.body;

    if (!url || !formatId) {
        return res.status(400).json({ error: "missing url or formatId" });
    }

    try {
        const proc = downloadVideo(url, formatId);

        if (!proc.stdout) {
            return res.status(500).json({ error: "failed to spawn yt-dlp" });
        }

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", "attachment");

        // Pipe yt-dlp stdout directly to HTTP response
        proc.stdout.pipe(res);

        // Log stderr for debugging
        proc.stderr?.on("data", (chunk) => {
            console.error("yt-dlp stderr:", chunk.toString());
        });

        // Handle process errors
        proc.on("error", (err) => {
            console.error("yt-dlp process error:", err);
            if (!res.headersSent) {
                res.status(500).json({ error: "download failed" });
            }
        });

        // Handle process exit
        proc.on("close", (code) => {
            if (code !== 0 && !res.headersSent) {
                res.status(500).json({ error: "yt-dlp exited with error" });
            }
        });

    } catch (err: any) {
        return res.status(500).json({
            error: "download failed",
            detail: err.message
        });
    }
});
```

**Key Points:**
- Streams data in real-time (no file storage)
- Uses server bandwidth (unlike direct CDN URLs)
- Never expires (unlike CDN URLs)
- Error handling for process crashes

## Docker Configuration

### Dockerfile

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /marin-bgdoc

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    unzip \
 && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L \
https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
-o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Install dependencies
COPY package*.json ./
RUN bun install

# Copy source code
COPY . .

# Build TypeScript
RUN bun run build

EXPOSE 9000

CMD ["bun", "start"]
```

**Key Points:**
- Base: Node.js 22 slim (smaller image)
- Workdir: `/marin-bgdoc`
- Dependencies: ffmpeg (for video processing), python3, yt-dlp, bun
- Build: TypeScript compilation to `dist/`
- Runtime: `bun start` runs `dist/marin.js`

### docker-compose.yml

```yaml
services:
  api:
    build: .
    container_name: marin-api
    ports:
      - "9000:9000"
    restart: unless-stopped
    environment:
      NODE_ENV: production
    volumes:
      - ./cookies.txt:/marin-bgdoc/cookies.txt
    init: true
```

**Key Points:**
- Port mapping: 9000:9000 (host:container)
- Volume: Mounts cookies.txt from host to container
- Restart: Automatically restarts on crash
- Init: Uses init process for proper signal handling

## Cookies Setup

### Why Cookies Are Needed

YouTube may block requests without authentication due to bot detection. Cookies from a logged-in YouTube session bypass this.

### How to Get Cookies

1. Install "Get cookies.txt" browser extension (Chrome/Firefox)
2. Go to YouTube while logged in
3. Export cookies as `cookies.txt`
4. Place file at project root

### Cookie File Format

Netscape HTTP Cookie File format:
```
# Netscape HTTP Cookie File
.youtube.com	TRUE	/	TRUE	<timestamp>	SID	<value>
.youtube.com	TRUE	/	TRUE	<timestamp>	__Secure-3PSID	<value>
...
```

### Security

- `cookies.txt` is in `.gitignore` (never commit credentials)
- Volume mount in Docker allows local file updates without rebuild
- Cookies are optional — API works without them but may fail for some videos

## Error Handling

### Common Errors

1. **"Sign in to confirm you're not a bot"**
   - Cause: Missing or expired cookies
   - Fix: Re-export fresh cookies.txt

2. **"Requested format is not available"**
   - Cause: Frontend passing invalid formatId
   - Fix: Frontend should use formatId from `/api/info` response

3. **"yt-dlp timeout after 30s"**
   - Cause: yt-dlp hanging (network issues, slow video)
   - Fix: Increase timeout or check network connectivity

4. **"Is a directory" (cookies.txt)**
   - Cause: Docker volume mount created directory instead of file
   - Fix: Remove directory and recreate file, then restart container

## Development vs Production

### Development (Local)

```bash
bun run dev  # Uses tsx watch for hot reload
```

- Runs on port 9000
- Hot reload enabled
- Uses local cookies.txt if present

### Production (Docker)

```bash
docker-compose up -d --build
```

- Runs in container
- Port 9000 exposed
- Cookies mounted via volume
- Auto-restart on crash

## API Specification Summary

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/health` | GET | Health check | None |
| `/api/info` | POST | Get video metadata | Cookies (optional) |
| `/api/download` | POST | Download video stream | Cookies (optional) |

## Environment Variables

Currently no required environment variables, but you may add:

- `PORT`: Server port (default: 9000)
- `NODE_ENV`: Environment (development/production)

## Testing the Backend

### Health Check
```bash
curl http://localhost:9000/health
# Response: {"ok": true}
```

### Get Video Info
```bash
curl -X POST http://localhost:9000/api/info \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ"}'
```

### Download Video
```bash
curl -X POST http://localhost:9000/api/download \
  -H "Content-Type: application/json" \
  -d '{"url": "https://youtube.com/watch?v=dQw4w9WgXcQ", "formatId": "137"}' \
  --output video.mp4
```

## Important Notes for Implementation

1. **No File Storage**: The `/api/download` endpoint streams directly to client — no files are saved to disk
2. **Format IDs Must Match**: Frontend must use exact `formatId` from `/api/info` response
3. **Cookies Are Optional**: API works without cookies but may fail for some YouTube videos
4. **Timeout Protection**: 30-second timeout prevents hanging processes
5. **Streaming Architecture**: Downloads are streamed, not buffered — efficient for large files
6. **CORS Enabled**: All origins allowed for frontend flexibility
