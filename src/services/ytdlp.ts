import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const COOKIES_PATH = join(process.cwd(), "cookies.txt");
console.log("Cookies path resolved to:", COOKIES_PATH, "exists:", existsSync(COOKIES_PATH));

export function extractVideo(url: string): Promise<any> {
    return new Promise((resolve, reject) => {

        const args = [
            "-J",
            "--no-playlist",
            "--no-warnings",
            url
        ];

        if (existsSync(COOKIES_PATH)) {
            args.push("--cookies", COOKIES_PATH);
        }

        const p = spawn("yt-dlp", args, {
            shell: false
        });

        console.log("[yt-dlp] Process spawned with PID:", p.pid);

        let out = "";
        let err = "";

        const timeout = setTimeout(() => {
            p.kill();
            console.error("[yt-dlp] Timeout after 30s");
            reject(new Error("yt-dlp timeout after 30s"));
        }, 30000);

        p.stdout.on("data", d => {
            console.log("[yt-dlp stdout]:", d.toString().slice(0, 200));
            out += d.toString();
        });
        p.stderr.on("data", d => {
            console.log("[yt-dlp stderr]:", d.toString().slice(0, 200));
            err += d.toString();
        });

        p.on("close", code => {
            clearTimeout(timeout);
            if (code !== 0) {
                return reject(new Error(err));
            }

            try {
                resolve(JSON.parse(out));
            } catch {
                reject(new Error("invalid json"));
            }
        });

        p.on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
        });

    });
}

export function downloadVideo(url: string, formatId: string): ChildProcess {
    const args = [
        "-o", "-",
        "-f", formatId,
        "--no-playlist",
        "--no-warnings",
        url
    ];

    if (existsSync(COOKIES_PATH)) {
        args.push("--cookies", COOKIES_PATH);
    }

    return spawn("yt-dlp", args, { shell: false });
}