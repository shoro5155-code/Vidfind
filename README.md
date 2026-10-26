# VidFind

Search YouTube and watch eligible videos inside VidFind using YouTube's official
embedded player. Switch to **Direct videos** for public MP4s from NASA and
selected Internet Archive collections. Search and watch pages are rendered by
the server so ordinary links continue to work without JavaScript.

## Run and deploy

Use Node.js 18 or newer. There are no runtime dependencies.

```sh
npm start
```

Set `YOUTUBE_API_KEY` privately on the server to enable YouTube search. Never put
it in HTML or the repository. Direct-video search still works without a key.
`PORT` defaults to 3000; Render supplies it automatically. Render uses a blank
root directory, `npm install` as the build command and `node server.js` as the
start command. The existing Render service already has the key configured.

## YouTube

- YouTube is the default source. Searches use `safeSearch=strict` and request
  videos that can be embedded and played outside YouTube. Metadata filtering
  also applies. There is no switch to lower these search restrictions.
- A selected video is checked again for public visibility, embedding permission
  and availability before the player is rendered.
- The default player is YouTube's privacy-enhanced embed. **Try standard player**
  switches to the other official embed domain while staying on VidFind.
- Both players send the required page-origin referrer. The server and iframe
  use `strict-origin-when-cross-origin` on YouTube watch pages.
- Playback still comes from YouTube servers. A network filter must allow it;
  allowing VidFind alone does not guarantee YouTube playback. No video files are
  extracted, downloaded, proxied or stored by VidFind.
- Private, unavailable, restricted or non-embeddable videos are not playable.
  Broad search does not promise every video in YouTube's catalog.
- The API key is never included in browser responses or raw error messages.
  Search results and metadata have a five-minute, bounded in-memory cache.
- The Privacy page and footer identify the providers and link to their policies.
  The local YouTube logo is the unmodified official branding SVG from gstatic.

## Direct videos

NASA's Image and Video Library supplies science and space videos. Internet
Archive searches are limited to Prelinger Archives, FedFlix, Computer Chronicles,
Net Café, NASA Archive, TED Talks and Academic Films. Metadata restrictions apply
both at search time and again before playback. Public MP4 files play in the
browser's native video player. These sources cover a smaller catalog and still
require access to the publisher's file host, including Archive storage redirects.

## Reliability and testing

If the browser cannot read a background search response, it opens the normal
HTML results page with the same query, source and pagination. Direct-video
pagination tracks each publisher separately. Provider timeouts and rate limits
produce readable errors; partial direct-provider outages are reported.

```sh
npm test
```

Tests use local publisher fixtures and do not require network access or real
credentials. They cover both sources, HTML fallback, search restrictions,
pagination, both official embed URLs, referrer policy, unavailable videos and
key protection.

Official API references:

- https://developers.google.com/youtube/v3/docs/search/list
- https://developers.google.com/youtube/v3/docs/videos/list
- https://support.google.com/youtube/answer/171780
- https://archive.org/help/aboutsearch.htm
- https://archive.org/developers/md-read.html
- https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
