import express from "express";
import { extractVideo } from "../services/ytdlp";

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

export default router;