import { spawn } from "node:child_process";
import { existsSync, statSync, unlinkSync, createReadStream } from "node:fs";
import type { ReadStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const COOKIES_PATH = join(process.cwd(), "cookies.txt");

// Checked at request time so server doesn't need restart after cookies.txt is added
function hasCookies(): boolean {
    try {
        return existsSync(COOKIES_PATH) && statSync(COOKIES_PATH).isFile();
    } catch {
        return false;
    }
}

function detectPlatform(url: string): "youtube" | "tiktok" | "twitter" | "other" {
    if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
    if (/tiktok\.com/i.test(url)) return "tiktok";
    if (/twitter\.com|x\.com/i.test(url)) return "twitter";
    return "other";
}

export function extractVideo(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const args = [
            "--no-playlist",
            "--no-warnings",
            // Prevents yt-dlp from making HTTP requests to validate format URLs
            // during metadata extraction, which caused "Requested format is not available"
            "--no-check-formats",
            "-J",
        ];

        if (hasCookies()) {
            args.push("--cookies", COOKIES_PATH);
        }

        args.push(url);

        const p = spawn("yt-dlp", args, { shell: false });
        console.log("[yt-dlp info] PID:", p.pid, "platform:", detectPlatform(url));

        let out = "";
        let err = "";

        const timeout = setTimeout(() => {
            p.kill();
            reject(new Error("yt-dlp timeout after 30s"));
        }, 30_000);

        p.stdout.on("data", (d) => { out += d.toString(); });
        p.stderr.on("data", (d) => {
            err += d.toString();
            console.error("[yt-dlp info stderr]:", d.toString().slice(0, 300));
        });

        p.on("close", (code) => {
            clearTimeout(timeout);
            if (code !== 0) return reject(new Error(err || "yt-dlp exited with error"));
            try {
                resolve(JSON.parse(out));
            } catch {
                reject(new Error("invalid json from yt-dlp"));
            }
        });

        p.on("error", (e) => { clearTimeout(timeout); reject(e); });
    });
}

export type DownloadResult = {
    stream: ReadStream;
    ext: string;
    cleanup: () => void;
};

export function downloadVideo(url: string, formatId: string): Promise<DownloadResult> {
    const platform = detectPlatform(url);

    // Build a format selector appropriate for each platform.
    // yt-dlp with -o - skips the merger post-processor (issue #12027), so we
    // download to a temp file instead and stream it after completion.
    let format: string;
    if (platform === "youtube") {
        // YouTube 1080p+ streams are video-only; append best available audio so
        // yt-dlp merges them into a single mp4 via ffmpeg before we stream it.
        format = `${formatId}+bestaudio[ext=m4a]/${formatId}+bestaudio/${formatId}`;
    } else if (platform === "tiktok") {
        // TikTok formats are pre-merged (video+audio). Watermarked ones start
        // with "download_addr" and are filtered out in /api/info, but guard anyway.
        format = formatId.startsWith("download_addr")
            ? "bestvideo[format_note!*=watermark]+bestaudio/best[format_note!*=watermark]/best"
            : formatId;
    } else {
        format = formatId;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const outTemplate = join(tmpdir(), `marin-${id}.%(ext)s`);

    return new Promise((resolve, reject) => {
        const args = [
            "--no-playlist",
            "--no-warnings",
            "--merge-output-format", "mp4",
            "-f", format,
            "-o", outTemplate,
        ];

        if (hasCookies()) {
            args.push("--cookies", COOKIES_PATH);
        }

        args.push(url);

        const p = spawn("yt-dlp", args, { shell: false });
        console.log("[yt-dlp download] PID:", p.pid, "format:", format);

        let err = "";
        p.stderr?.on("data", (d) => {
            err += d.toString();
            console.error("[yt-dlp download stderr]:", d.toString().slice(0, 300));
        });

        // 5-minute timeout for actual downloads
        const timeout = setTimeout(() => {
            p.kill();
            reject(new Error("download timeout after 5min"));
        }, 300_000);

        p.on("close", (code) => {
            clearTimeout(timeout);
            if (code !== 0) return reject(new Error(err || "yt-dlp download failed"));

            // yt-dlp chooses the extension; probe common ones
            const exts = ["mp4", "mkv", "webm", "m4a", "mp3"];
            let filePath: string | null = null;
            let ext = "mp4";

            for (const e of exts) {
                const candidate = join(tmpdir(), `marin-${id}.${e}`);
                if (existsSync(candidate)) {
                    filePath = candidate;
                    ext = e;
                    break;
                }
            }

            if (!filePath) return reject(new Error("output file not found after download"));

            const finalPath = filePath;
            let cleaned = false;
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                try { unlinkSync(finalPath); } catch {}
            };

            resolve({ stream: createReadStream(finalPath), ext, cleanup });
        });

        p.on("error", (e) => { clearTimeout(timeout); reject(e); });
    });
}
