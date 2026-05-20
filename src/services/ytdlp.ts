import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export function extractVideo(url: string): Promise<any> {
    return new Promise((resolve, reject) => {

        const args = [
            "-J",
            "--no-playlist",
            "--no-warnings",
            "--cookies-from-browser",
            "chrome",
            url
        ];

        const p = spawn("yt-dlp", args, {
            shell: false
        });

        let out = "";
        let err = "";

        p.stdout.on("data", d => out += d.toString());
        p.stderr.on("data", d => err += d.toString());

        p.on("close", code => {
            if (code !== 0) {
                return reject(new Error(err));
            }

            try {
                resolve(JSON.parse(out));
            } catch {
                reject(new Error("invalid json"));
            }
        });

    });
}

export function downloadVideo(url: string, formatId: string): ChildProcess {
    return spawn("yt-dlp", [
        "-o", "-",
        "-f", formatId,
        "--no-playlist",
        "--no-warnings",
        "--cookies-from-browser",
        "chrome",
        url
    ], { shell: false });
}