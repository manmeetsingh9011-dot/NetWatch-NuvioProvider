# NetWatch Nuvio Provider Addon 🎬

High-performance, zero-dependency streaming scrapers and direct link resolvers for the **[Nuvio Streaming App](https://github.com/nuvioapp)**.

---

## 🚀 Included Providers

| Provider | ID | Description | Supported Types | Special Features |
|---|---|---|---|---|
| **RogMovies** | `rogmovies` | Bollywood, Regional Indian Cinema & OTT Web Series | Movies, TV | Multi-CDN resolver (GoFile, R2, FSLv2 S3, PixelDrain, Workers CDN), Dual TMDB failover, Nexdrive episode isolation |
| **4KHDHub** | `4khdhub` | Hollywood & Multi-Audio Movies and Series in 4K, 1080p, and HDR | Movies, TV | DirectResolver fastpath (MD5 title hashing, token-free permanent static links, x-href Base64 bypass, in-memory L0 cache) |

---

## ✨ Features & Enhancements

- ⚡ **Zero External Dependencies:** Completely Cheerio-free and DOM-parser free. Powered by lightweight regex and string scanning for maximum speed on low-spec Android TV boxes, Firesticks, and mobile devices.
- 🎛️ **Configurable Sorting Settings:**
  - **Quality (High to Low) + Size:** Prioritizes 4K → 1080p → 720p → 480p, with largest bitrate/file size ranked highest within the same resolution.
  - **Size (Largest First):** Pure bitrate/file-size descending sort across all resolutions.
- 🔤 **Invisible Zero-Width Sorter:** Uses zero-width unicode characters (`\uFEFF` and `\u200B`) so Nuvio strictly sorts streams in descending order without displaying clutter on screen.
- 🔒 **GitHub & Secret Safe:** Dynamic TMDB API key resolution with Base64-obfuscated public fallback pool and custom user key support in Nuvio settings.

---

## 📦 Installation in Nuvio

1. Open **Nuvio** on your device.
2. Go to **Settings** → **Plugins / Addons** → **Add Plugin**.
3. Enter the manifest URL:
   ```text
   https://raw.githubusercontent.com/manmeetsingh9011-dot/NetWatch-NuvioProvider/main/manifest.json
   ```
4. Click **Install**.
