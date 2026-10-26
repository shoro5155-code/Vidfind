# VidFind — your own video search website

Visitors type a search on **your** page. Your server quietly asks YouTube's official
search API for matching videos and shows them on your page, where they also play.
Nobody is sent to Google or YouTube.

```
Visitor's browser  →  your server (/api/search)  →  YouTube Data API
        ↑                                                  │
        └──────────── results shown on your page ←─────────┘
```

## 1. Get a free API key (about 5 minutes)

1. Go to https://console.cloud.google.com and sign in.
2. Create a new project (any name).
3. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and click **Enable**.
4. Open **APIs & Services → Credentials → Create credentials → API key**. Copy the key.

The free quota allows roughly 100 searches per day. You can request more from Google later.

## 2. Run it on your computer

You need Node.js 18 or newer (https://nodejs.org). No other installs are needed.

Mac / Linux:
```
YOUTUBE_API_KEY=paste_your_key_here node server.js
```

Windows (PowerShell):
```
$env:YOUTUBE_API_KEY="paste_your_key_here"; node server.js
```

Open http://localhost:3000 and search.

## 3. Put it online

The application files must be extracted in the GitHub repository root. Uploading
only `vidfind.zip` does not give Render the files it needs to build and start.

For the existing Render web service, use:

- Runtime / language: **Node**
- Root directory: leave blank (the repository root)
- Build command: `npm install`
- Start command: `node server.js`
- Environment variable: `YOUTUBE_API_KEY`, with the private Google Cloud API key

Commands are case-sensitive. Save the settings and environment variable, then
deploy the latest commit. Keep the key on the server only; never put it in the HTML,
the ZIP, or the GitHub repository. Render supplies `PORT` automatically.

## Notes

- Safe search is **off** by default. To turn it back on, set the environment variable
  `SAFE_SEARCH` to `moderate` or `strict` (same way you set the API key).
- To show more results per page, change `maxResults` in `server.js` (max 50).
- Want web pages or images too? Swap the API call for a general search API such as
  Brave Search API or Google Programmable Search; the front end stays almost the same.
