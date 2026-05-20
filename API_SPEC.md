# Marin Backend API Specification

base url is saved in .env as CASCADE_URL

## Endpoints

### 1. Health Check

**GET** `/health`

Returns server status.

**Response — 200 OK**
```json
{
  "ok": true
}
```

---

### 2. Extract Video Info

**POST** `/api/info`

Accepts a video URL, runs yt-dlp in the backend to extract metadata and direct streamable URLs.

**Request Body**
```json
{
  "url": "string (required) — any URL supported by yt-dlp (YouTube, TikTok, etc.)"
}
```

**Success Response — 200 OK**
```json
{
  "title": "string | null",
  "thumbnail": "string | null — URL to the video thumbnail",
  "duration": "number | null — duration in seconds",
  "formats": [
    {
      "formatId": "string — yt-dlp format identifier",
      "ext": "string — file extension (mp4, webm, m4a, etc.)",
      "quality": "string | null — human readable quality label",
      "width": "number | null",
      "height": "number | null",
      "url": "string — direct CDN/stream URL (expires quickly)"
    }
  ]
}
```

- `formats` is filtered to only entries that have a usable `url`.
- The `url` fields are **short-lived** (often expire in ~6 hours). They should not be stored; fetch fresh via this endpoint when needed.

**Error Response — 400 Bad Request**
```json
{
  "error": "missing url"
}
```

**Error Response — 500 Internal Server Error**
```json
{
  "error": "yt-dlp failed",
  "detail": "string — underlying error message"
}
```

---

### 3. Download Video (Server-Proxied Stream)

**POST** `/api/download`

Streams the video file directly through the backend using yt-dlp. No CDN URLs needed. The backend pipes the video data to the client in real-time.

**Request Body**
```json
{
  "url": "string (required) — video URL",
  "formatId": "string (required) — format ID from /api/info response"
}
```

**Success Response — 200 OK**
- **Content-Type**: `application/octet-stream`
- **Content-Disposition**: `attachment`
- **Body**: Binary video stream

The response is a direct file download. The browser will prompt to save or stream the file.

**Error Response — 400 Bad Request**
```json
{
  "error": "missing url or formatId"
}
```

**Error Response — 500 Internal Server Error**
```json
{
  "error": "download failed",
  "detail": "string — error message"
}
```

or

```json
{
  "error": "yt-dlp exited with error"
}
```

---

## Key Behaviors for Frontend Implementation

1. **Two download methods available:**
   - **Direct CDN URLs** (from `/api/info`): Fast, but expire in ~6 hours. Good for quick previews or streaming in `<video>` tags.
   - **Server-proxied download** (from `/api/download`): Always works, never expires, but slower and uses backend bandwidth. Use this for actual downloads.

2. **Do not cache format URLs server-side or in a DB.** They expire. Always call `POST /api/info` to get fresh URLs.

3. **Client-side caching is fine** for the metadata response if you want to avoid re-fetching within a short session, but re-fetch before any download.

4. **No auth required.** The API is fully open.

5. **Backend is built for yt-dlp supported sites.** Primarily YouTube, but should handle anything yt-dlp can parse.

---

## Suggested Next.js UI Flow

1. **Input page** — text field for pasting a URL + submit button.

2. **Loading state** — while `POST /api/info` is in flight.

3. **Result page/component** — display:
   - title
   - thumbnail image
   - duration (formatted mm:ss)
   - a list/table of available formats with quality, extension, resolution
   - for each format:
     - **"Preview"** button — opens the CDN `url` in a new tab or `<video>` player
     - **"Download"** button — triggers `POST /api/download` with the `url` and `formatId`, initiating a browser download

4. **Download implementation**:
   ```ts
   async function downloadVideo(url: string, formatId: string) {
     const res = await fetch(`${API_BASE}/api/download`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ url, formatId }),
     });

     if (!res.ok) {
       const err = await res.json();
       throw new Error(err.error);
     }

     const blob = await res.blob();
     const downloadUrl = URL.createObjectURL(blob);
     const a = document.createElement("a");
     a.href = downloadUrl;
     a.download = `video.${formatId.includes("audio") ? "m4a" : "mp4"}`;
     a.click();
     URL.revokeObjectURL(downloadUrl);
   }
   ```

5. **Error handling** — show user-friendly messages for 400 and 500 responses.
