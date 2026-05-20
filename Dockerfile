FROM node:22-bookworm-slim

WORKDIR /marin-bgdoc

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
 && rm -rf /var/lib/apt/lists/*

RUN curl -L \
https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
-o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp

COPY package*.json ./

RUN bun install

COPY . .

RUN bun run build

EXPOSE 9090

CMD ["bun", "start"]