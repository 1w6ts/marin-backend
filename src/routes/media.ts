import express from "express";
import { extractVideo, downloadVideo } from "../services/ytdlp";

const router = express.Router();

router.post("/info", async (req, res) => {
    const url = req.body?.url;

    if (!url) {
        return res.status(400).json({ error: "missing url" });
    }

    try {
        const data = await extractVideo(url);

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

        proc.stdout.pipe(res);

        proc.stderr?.on("data", (chunk) => {
            console.error("yt-dlp stderr:", chunk.toString());
        });

        proc.on("error", (err) => {
            console.error("yt-dlp process error:", err);
            if (!res.headersSent) {
                res.status(500).json({ error: "download failed" });
            }
        });

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

export default router;