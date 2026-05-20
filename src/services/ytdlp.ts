import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COOKIES_PATH = join(__dirname, "../../cookies.txt");

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