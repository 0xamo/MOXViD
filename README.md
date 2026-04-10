# MOXViD

Standalone Stremio addon for movie, series, and anime streams.

Current provider set:

- `Scrennnifu`
- `Wind`
- `Voxzer`
- `MOX`
- `VidLink`
- `AllAnime`
- `AnimeCloud`

What it does:

- accepts Cinemeta movie IDs like `tt0169547`
- accepts Cinemeta episode IDs like `tt0944947:1:1`
- resolves IMDb -> TMDB when needed
- keeps stream titles short like `1080p`, `720p EN`, `1080p MULTI`, `1080p MP4`
- builds local multi-audio playlists for `Scrennnifu`
- proxies `AnimeCloud` through a local `.mp4` route for better Stremio compatibility

## Run

```bash
cd MOXViD
npm install
npm start
```

Then open:

```text
http://127.0.0.1:7005/manifest.json
```

You can also override the port:

```bash
PORT=7014 npm start
```

## Publish

This folder is ready to be its own GitHub repo.

Important:

- Stremio cannot install directly from a GitHub repo page.
- You need to host the addon and install the hosted `manifest.json` URL.

Fastest path:

1. Put `MOXViD` in its own GitHub repo.
2. Deploy it to Render.
3. Install:
   `https://your-render-service.onrender.com/manifest.json`

## Repo Tree

```text
MOXViD/
├── .dockerignore
├── .gitignore
├── Dockerfile
├── README.md
├── index.js
├── package.json
└── render.yaml
```

## Deploy

Docker:

```bash
cd MOXViD
docker build -t moxvid .
docker run -p 7005:7005 moxvid
```

Render:

- push this folder as its own repo
- create a new Web Service on Render
- Render can use `render.yaml`
- install the hosted manifest URL in Stremio

## Notes

- `TMDB_API_KEY` can be overridden with an environment variable
- `GET /health` returns a simple health response
- some providers are source-dependent and may appear or disappear per title
