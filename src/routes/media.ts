import express from "express";
import { extractVideo, downloadVideo } from "../services/ytdlp";

const router = express.Router();

const CONTENT_TYPES: Record<string, string> = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    webm: "video/webm",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
};

router.post("/info", async (req, res) => {
    const url = req.body?.url;

    if (!url) {
        return res.status(400).json({ error: "missing url" });
    }

    console.log("[/api/info] Extracting metadata for:", url);

    try {
        const data = await extractVideo(url);

        console.log("[/api/info] title:", data.title, "formats:", data.formats?.length);

        const formats = (data.formats || [])
            .filter((f: any) => {
                if (!f.url) return false;
                // Strip watermarked TikTok formats (format_note contains "watermark")
                if (f.format_note?.toLowerCase().includes("watermark")) return false;
                return true;
            })
            .map((f: any) => ({
                formatId: f.format_id,
                ext: f.ext,
                quality: f.format_note,
                width: f.width,
                height: f.height,
                hasAudio: !!f.acodec && f.acodec !== "none",
                hasVideo: !!f.vcodec && f.vcodec !== "none",
                filesize: f.filesize ?? f.filesize_approx ?? null,
                url: f.url,
            }));

        return res.json({
            title: data.title,
            thumbnail: data.thumbnail,
            duration: data.duration,
            formats,
        });

    } catch (err: any) {
        console.error("[/api/info] error:", err.message);
        return res.status(500).json({
            error: "yt-dlp failed",
            detail: err.message,
        });
    }
});

router.post("/download", async (req, res) => {
    const { url, formatId } = req.body;

    if (!url || !formatId) {
        return res.status(400).json({ error: "missing url or formatId" });
    }

    console.log("[/api/download] url:", url, "formatId:", formatId);

    try {
        // Downloads to a temp file first so yt-dlp can merge video+audio via
        // ffmpeg before we stream. Piping to stdout (-o -) skips the merger.
        const { stream, ext, cleanup } = await downloadVideo(url, formatId);

        res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="video.${ext}"`);

        stream.pipe(res);

        stream.on("end", cleanup);
        stream.on("error", (err) => {
            console.error("[/api/download] stream error:", err);
            cleanup();
            if (!res.headersSent) res.status(500).json({ error: "streaming failed" });
        });

        // Clean up temp file if client disconnects before stream ends
        res.on("close", cleanup);

    } catch (err: any) {
        console.error("[/api/download] error:", err.message);
        return res.status(500).json({
            error: "download failed",
            detail: err.message,
        });
    }
});

export default router;
