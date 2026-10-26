# VidFind

Search public videos and watch them on VidFind using the browser's native video
player. Search results link to a server-rendered `/watch` page with public MP4
sources from the publisher. No video-site embed or API key is required.

## Run

Use Node.js 18 or newer. There are no runtime dependencies.

```sh
npm start
```

Open `http://localhost:3000`. `PORT` defaults to 3000; Render supplies it
automatically. For Render, leave the root directory blank, use `npm install` as
the build command and `node server.js` as the start command.

## Catalog and filtering

- NASA's Image and Video Library supplies science and space videos.
- Internet Archive search is restricted to Prelinger Archives, FedFlix,
  Computer Chronicles, Net Café, NASA Archive, TED Talks and Academic Films.
- Explicit terms in queries, titles, descriptions, subjects and collection
  metadata are filtered. Sensitive/restricted flags are checked, and the
  publisher and collection checks run again before playback. These conservative
  metadata checks are not frame-by-frame content classification and cannot
  guarantee every publisher has labeled every video correctly.
- The catalog is smaller than a general video search. Results must advertise
  an MP4-compatible format; playback also requires a public MP4 in the manifest.
- Publisher files stay on their original hosts. A user's network filter must
  allow those hosts, including any Internet Archive storage redirect. VidFind
  does not proxy video bytes, extract videos from other sites or change filters.
- Videos stream online. This does not make the catalog available offline.
- No credentials or paid service are required. An old `YOUTUBE_API_KEY` or
  `SAFE_SEARCH` setting is unused by this version.

## Reliability

Search has both a JSON API and server-rendered HTML results. If the browser
cannot read a background response, it opens the HTML results page. Watch pages
and the native player also work without JavaScript. Pagination tracks each
publisher separately. Provider responses are cached for five minutes in a
bounded in-memory cache; requests time out, rate-limit cooldowns are respected,
and a partial provider outage is shown to the user.

```sh
npm test
```

Tests use local publisher fixtures and do not require network access.

Official API references:

- https://archive.org/help/aboutsearch.htm
- https://archive.org/developers/md-read.html
- https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
