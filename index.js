const http = require("http");

const PORT = Number(process.env.PORT || 7005);
const HOST = process.env.HOST || "0.0.0.0";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
const TMDB_API_KEY =
  process.env.TMDB_API_KEY || "e6333b32409e02a4a6eba6fb7ff866bb";
const TMDB_FALLBACK_API_KEY = "439c478a771f35c05022f9feabcca01c";

const NOTORRENT_API = "https://addon-osvh.onrender.com";
const VIDLINK_API = "https://vidlink.pro";
const MULTI_DECRYPT_API = "https://enc-dec.app/api";
const ALLANIME_API = "https://api.allanime.day/api";
const MALSYNC_API = "https://api.malsync.moe";
const KITSU_API = "https://kitsu.io/api/edge";
const CINEMETA_API = "https://v3-cinemeta.strem.io";
const DYNAMIC_URLS_API =
  "https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json";
const ALLWISH_API = "https://all-wish.me";
const VIDSRCCC_API = "https://vidsrc.cc";
const VIXSRC_API = "https://vixsrc.to";
const VIDEASY_API = "https://api.videasy.net";
const WITANIME_BACKEND = "http://145.241.158.129:3111";
const ANIMECLOUD_BACKEND = "http://145.241.158.129:3112/animecloud/streams";
const ANIMEKAI_DB_API = "https://enc-dec.app/db/kai";
const ANIMEKAI_AJAX = "https://animekai.to/ajax";
const XPASS_API = "https://play.xpass.top";
const HIANIME_APIS = [
  "https://hianimes.su",
  "https://hianimes.biz",
  "https://hianime.ws",
  "https://hianimez.ro",
  "https://hianime.lc",
];
const KIRMZI_BASE = "https://v3.kirmzi.space";
const KIRMZI_ALBA_BASE = "https://w.shadwo.pro/albaplayer";
const KIRMZI_T123_BASE = "https://turkish123.ac";
const NETMIRROR_BASE = "https://net51.cc";

const manifest = {
  id: "org.codex.moxvid",
  version: "0.6.2",
  name: "MOXViD",
  description:
    "Stremio addon using Nightbreeze, Wind, Voxzer, MOX, Scrennnifu, Vixsrc, Videasy, AllAnime, and AnimeCloud.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  idPrefixes: ["tt", "kitsu"],
  catalogs: [],
};

let dynamicUrlsCache = null;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function normalizeHeaders(headers = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "user-agent": USER_AGENT,
      accept: "*/*",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      accept: "application/json,text/plain,*/*",
      ...(options.headers || {}),
    },
  });
  return JSON.parse(text);
}

function parseSeriesResourceId(rawId) {
  const decoded = decodeURIComponent(rawId);
  const match = decoded.match(/^(.+):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    imdbId: match[1],
    season: Number(match[2]),
    episode: Number(match[3]),
  };
}

function isKitsuId(id) {
  return /^kitsu:\d+$/i.test(String(id || ""));
}

function getKitsuNumericId(id) {
  const match = String(id || "").match(/^kitsu:(\d+)$/i);
  return match ? match[1] : null;
}

async function resolveTmdbDetails(imdbId, mediaType) {
  const findUrl = `https://api.themoviedb.org/3/find/${encodeURIComponent(
    imdbId
  )}?external_source=imdb_id&api_key=${TMDB_API_KEY}`;
  const findPayload = await fetchJson(findUrl);
  const resultList =
    mediaType === "movie" ? findPayload.movie_results : findPayload.tv_results;
  const media = resultList && resultList[0];

  if (!media?.id) {
    throw new Error(`TMDB ${mediaType} not found for ${imdbId}`);
  }

  const detailsUrl =
    mediaType === "movie"
      ? `https://api.themoviedb.org/3/movie/${media.id}?api_key=${TMDB_API_KEY}`
      : `https://api.themoviedb.org/3/tv/${media.id}?api_key=${TMDB_API_KEY}`;
  const details = await fetchJson(detailsUrl);

  return {
    imdbId,
    mediaType,
    tmdbId: String(media.id),
    title:
      mediaType === "movie"
        ? details.title || details.original_title
        : details.name || details.original_name,
    originalTitle:
      mediaType === "movie"
        ? details.original_title || details.title
        : details.original_name || details.name,
    year:
      mediaType === "movie"
        ? Number(String(details.release_date || "").slice(0, 4)) || null
        : Number(String(details.first_air_date || "").slice(0, 4)) || null,
    firstAirDate:
      mediaType === "movie" ? details.release_date || null : details.first_air_date || null,
    genres: details.genres || [],
  };
}

async function resolveKitsuDetails(kitsuId, mediaTypeHint) {
  const numericId = getKitsuNumericId(kitsuId);
  if (!numericId) {
    throw new Error(`Unsupported Kitsu id: ${kitsuId}`);
  }

  const payload = await fetchJson(`${KITSU_API}/anime/${numericId}`);
  const anime = payload?.data;
  const attrs = anime?.attributes || {};
  const subtype = String(attrs.subtype || "").toLowerCase();
  const startDate = attrs.startDate || null;
  const chosenMediaType =
    mediaTypeHint === "movie" || subtype === "movie" ? "movie" : "series";

  return {
    imdbId: kitsuId,
    mediaType: chosenMediaType,
    tmdbId: null,
    title:
      attrs.canonicalTitle ||
      attrs.titles?.en ||
      attrs.titles?.en_jp ||
      attrs.titles?.en_us ||
      attrs.titles?.ja_jp ||
      null,
    originalTitle:
      attrs.titles?.ja_jp ||
      attrs.canonicalTitle ||
      attrs.titles?.en_jp ||
      attrs.titles?.en ||
      null,
    year: Number(String(startDate || "").slice(0, 4)) || null,
    firstAirDate: startDate,
    genres: [],
    isKitsu: true,
    kitsuId: numericId,
    subtype,
  };
}

async function resolveMediaContext(inputId, mediaType) {
  if (isKitsuId(inputId)) {
    return resolveKitsuDetails(inputId, mediaType);
  }
  return resolveTmdbDetails(inputId, mediaType);
}

async function fetchCinemetaMeta(imdbId, mediaType) {
  if (!String(imdbId || "").startsWith("tt")) return null;
  const type = mediaType === "movie" ? "movie" : "series";
  try {
    const payload = await fetchJson(
      `${CINEMETA_API}/meta/${type}/${encodeURIComponent(imdbId)}.json`
    );
    return payload?.meta || null;
  } catch (_) {
    return null;
  }
}

function detectAnimeFromContext(tmdb, animeIds, cinemetaMeta) {
  if (tmdb.isKitsu) return true;
  const genres = (cinemetaMeta?.genre || cinemetaMeta?.genres || []).map((genre) =>
    String(genre).toLowerCase()
  );
  const country = String(cinemetaMeta?.country || "").toLowerCase();
  const tmdbGenres = (tmdb?.genres || []).map((genre) =>
    String(genre?.name || genre).toLowerCase()
  );
  const hasAnimeIds = !!(animeIds?.anilistId || animeIds?.malId);
  const looksJapaneseAnimated =
    genres.includes("animation") && country.includes("japan");
  const tmdbSuggestsAnimation = tmdbGenres.includes("animation");
  return looksJapaneseAnimated || (hasAnimeIds && tmdbSuggestsAnimation);
}

function looksPotentiallyAnime(tmdb, cinemetaMeta) {
  if (tmdb?.isKitsu) return true;
  const genres = (cinemetaMeta?.genre || cinemetaMeta?.genres || []).map((genre) =>
    String(genre).toLowerCase()
  );
  const country = String(cinemetaMeta?.country || "").toLowerCase();
  const tmdbGenres = (tmdb?.genres || []).map((genre) =>
    String(genre?.name || genre).toLowerCase()
  );
  const hasAnimation = genres.includes("animation") || tmdbGenres.includes("animation");
  const isJapanese = country.includes("japan");
  return hasAnimation && isJapanese;
}

function mapCinemetaEpisodeToAbsolute(meta, season, episode) {
  if (!meta?.videos?.length || season == null || episode == null) return null;

  const mainEpisodes = meta.videos
    .filter((video) => Number(video?.season) > 0)
    .sort((a, b) => {
      const as = Number(a?.season || 0);
      const bs = Number(b?.season || 0);
      if (as !== bs) return as - bs;
      return Number(a?.number || 0) - Number(b?.number || 0);
    });

  const index = mainEpisodes.findIndex(
    (video) => Number(video?.season) === Number(season) && Number(video?.number) === Number(episode)
  );

  return index >= 0 ? index + 1 : null;
}

function getSeasonName(month) {
  const seasons = [
    "Winter",
    "Winter",
    "Spring",
    "Spring",
    "Spring",
    "Summer",
    "Summer",
    "Summer",
    "Fall",
    "Fall",
    "Fall",
    "Winter",
  ];
  if (!month || month < 1 || month > 12) return null;
  return seasons[month - 1];
}

async function resolveAnimeIds({ title, originalTitle, year, firstAirDate, mediaType }) {
  const season = mediaType === "movie" ? "" : getSeasonName(Number(String(firstAirDate || "").split("-")[1]));
  const seasonYear =
    mediaType === "movie"
      ? year
      : Number(String(firstAirDate || "").split("-")[0]) || year || null;

  const query = `
    query (
      $page: Int = 1
      $search: String
      $sort: [MediaSort] = [POPULARITY_DESC, SCORE_DESC]
      $type: MediaType
      $season: MediaSeason
      $seasonYear: Int
      $format: [MediaFormat]
    ) {
      Page(page: $page, perPage: 20) {
        media(
          search: $search
          sort: $sort
          type: $type
          season: $season
          seasonYear: $seasonYear
          format_in: $format
        ) {
          id
          idMal
        }
      }
    }
  `;

  const titles = [title, originalTitle].filter(Boolean);
  const attempts = [
    {
      season: season || undefined,
      seasonYear: seasonYear || undefined,
      format: mediaType === "movie" ? ["MOVIE"] : ["TV", "ONA", "TV_SHORT", "SPECIAL"],
    },
    {
      season: undefined,
      seasonYear: seasonYear || undefined,
      format: mediaType === "movie" ? ["MOVIE"] : ["TV", "ONA", "TV_SHORT", "SPECIAL"],
    },
    {
      season: undefined,
      seasonYear: undefined,
      format: undefined,
    },
  ];

  for (const candidate of titles) {
    for (const attempt of attempts) {
      const variables = {
        search: candidate,
        sort: "SEARCH_MATCH",
        type: "ANIME",
        season: attempt.season,
        seasonYear: attempt.seasonYear,
        format: attempt.format,
      };

      try {
        const payload = await fetchJson("https://graphql.anilist.co", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            query,
            variables,
          }),
        });

        const first = payload?.data?.Page?.media?.[0];
        if (first?.id || first?.idMal) {
          return {
            anilistId: first.id || null,
            malId: first.idMal || null,
          };
        }
      } catch (_) {
        // Best effort; keep trying alternate titles.
      }
    }
  }

  return {
    anilistId: null,
    malId: null,
  };
}

async function fetchMalSyncMeta(malId) {
  if (!malId) {
    return {
      title: null,
      animepaheUrl: null,
      animepaheTitle: null,
      hianimeurl: null,
    };
  }

  let payload = null;
  try {
    payload = await fetchJson(`${MALSYNC_API}/mal/anime/${malId}`);
  } catch (_) {
    return {
      title: null,
      animepaheUrl: null,
      animepaheTitle: null,
      hianimeurl: null,
    };
  }
  const sites = payload?.Sites || {};

  const zoroValues = Object.values(sites.Zoro || {});
  const animepaheValues = Object.values(sites.animepahe || {});

  const hianimeurl =
    zoroValues.find((entry) => entry && typeof entry.url === "string")?.url || null;
  const animepaheUrl =
    animepaheValues.find((entry) => entry && typeof entry.url === "string")?.url || null;
  const animepaheTitle =
    animepaheValues.find((entry) => entry && typeof entry.title === "string")?.title || null;

  return {
    title: payload?.title || null,
    animepaheUrl,
    animepaheTitle,
    hianimeurl,
  };
}

async function getDynamicUrls() {
  if (dynamicUrlsCache) return dynamicUrlsCache;
  dynamicUrlsCache = await fetchJson(DYNAMIC_URLS_API);
  return dynamicUrlsCache;
}

function parseQualityFromText(text) {
  const match = String(text || "").match(/(\d{3,4})/);
  return match ? Number(match[1]) : null;
}

function dedupeStreams(streams) {
  const seen = new Set();
  const deduped = [];

  for (const stream of streams) {
    const key = `${stream.name}|${stream.title}|${stream.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(stream);
  }

  return deduped;
}

function orderStreams(streams, isAnime) {
  const xpassFamily = [];
  const videasyNames = new Set(["10017", "SuNCren", "Wrong", "Lizer", "ArCh", "Videasy"]);
  const isVideasyFamily = (name) =>
    videasyNames.has(String(name || "")) || /\.workers\.dev$/i.test(String(name || ""));
  const animePriority = [
    "Nightbreeze",
    "Voxzer",
    "MOX",
    "Scrennnifu",
    "Vixsrc",
    "Videasy",
    "AllAnime",
    "AnimeCloud",
    "Wind",
  ];
  const standardPriority = [
    "Nightbreeze",
    "Voxzer",
    "MOX",
    "Scrennnifu",
    "Vixsrc",
    "Videasy",
    "AnimeCloud",
    "AllAnime",
    "Wind",
  ];
  const priority = isAnime ? animePriority : standardPriority;
  const priorityMap = new Map(priority.map((name, index) => [name, index]));

  return [...streams].sort((a, b) => {
    const aName = String(a.name || "");
    const bName = String(b.name || "");
    const aBase =
      aName.startsWith("Xpass ") || xpassFamily.includes(aName) ? "Xpass" : aName;
    const bBase =
      bName.startsWith("Xpass ") || xpassFamily.includes(bName) ? "Xpass" : bName;
    const normalizedABase = isVideasyFamily(aName) ? "Videasy" : aBase;
    const normalizedBBase = isVideasyFamily(bName) ? "Videasy" : bBase;
    const ap = priorityMap.get(normalizedABase) ?? 999;
    const bp = priorityMap.get(normalizedBBase) ?? 999;
    if (ap !== bp) return ap - bp;
    if (normalizedABase === "Videasy" && normalizedBBase === "Videasy" && aName !== bName) {
      return aName.localeCompare(bName);
    }
    if (aBase === "Xpass" && bBase === "Xpass") {
      const aServerOrder = xpassFamily.indexOf(aName);
      const bServerOrder = xpassFamily.indexOf(bName);
      if (aServerOrder !== -1 || bServerOrder !== -1) {
        return (aServerOrder === -1 ? 999 : aServerOrder) - (bServerOrder === -1 ? 999 : bServerOrder);
      }
      const aServer = Number(aName.match(/^Xpass\s+(\d+)/i)?.[1] || 999);
      const bServer = Number(bName.match(/^Xpass\s+(\d+)/i)?.[1] || 999);
      if (aServer !== bServer) return aServer - bServer;
    }
    const aq = a.quality || 0;
    const bq = b.quality || 0;
    return bq - aq;
  });
}

function buildStream(provider, title, url, quality, extra = {}) {
  return {
    name: provider,
    title,
    url,
    behaviorHints: {
      notWebReady: true,
      ...(extra.behaviorHints || {}),
    },
    externalUrl: extra.externalUrl,
    quality,
  };
}

function detectCamSource(...parts) {
  const text = parts
    .map((part) => String(part || "").toLowerCase())
    .join(" ");
  return /\b(cam|hdcam|hd-cam|ts|telesync|tc|telecine|hqcam|hdts)\b/.test(text);
}

function normalizeStreamTitle(stream) {
  const quality = stream?.quality || parseQualityFromText(stream?.title) || null;
  if (!quality) return "Auto";
  const cam = detectCamSource(stream?.title, stream?.name, stream?.url, stream?.externalUrl);
  return cam ? `${quality}p CAM` : `${quality}p`;
}

function getLogoSvg() {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">`,
    `<defs>`,
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="#ff3d71"/>`,
    `<stop offset="1" stop-color="#6b5bff"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect x="0" y="0" width="256" height="256" rx="56" fill="url(#g)"/>`,
    `<circle cx="86" cy="120" r="22" fill="#fff" opacity="0.9"/>`,
    `<circle cx="170" cy="120" r="22" fill="#fff" opacity="0.9"/>`,
    `<path d="M78 170c16 18 32 26 50 26s34-8 50-26" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>`,
    `</svg>`,
  ].join("");
}

function normalizeXpassStreams(streams, publicBaseUrl, xpassContext) {
  const allowedHosts = ["https://tik.1x2.space", "https://vip.1x2.space"];
  const filteredStreams = streams.filter((stream) =>
    allowedHosts.some((host) => String(stream?.url || "").startsWith(host))
  );
  const labelStats = new Map();
  const preferredNames = ["TikViD", "VipViD"];
  filteredStreams.forEach((stream, index) => {
    const rawLabel = String(stream.xpassLabel || "").trim() || "Auto";
    const current = labelStats.get(rawLabel) || {
      bestQuality: -1,
      firstIndex: index,
    };
    current.bestQuality = Math.max(current.bestQuality, stream.quality || 0);
    current.firstIndex = Math.min(current.firstIndex, index);
    labelStats.set(rawLabel, current);
  });

  const serverMap = new Map(
    [...labelStats.entries()]
      .sort((a, b) => {
        if (a[1].bestQuality !== b[1].bestQuality) {
          return b[1].bestQuality - a[1].bestQuality;
        }
        return a[1].firstIndex - b[1].firstIndex;
      })
      .map(([label], index) => [label, index + 1])
  );

  const normalized = filteredStreams.map((stream) => {
    const rawLabel = String(stream.xpassLabel || "").trim() || "Auto";
    const serverNumber = serverMap.get(rawLabel);
    const qualityLabel = stream.quality ? `${stream.quality}p` : "Auto";
    const isCam = detectCamSource(rawLabel, stream.url, stream.externalUrl);
    const providerName = /mov/i.test(rawLabel)
      ? "TikViD"
      : /tik/i.test(rawLabel)
      ? "TikViD"
      : /vid/i.test(rawLabel)
      ? "VipViD"
      : /vip/i.test(rawLabel)
      ? "VipViD"
      : preferredNames[(serverNumber || 1) - 1] || `Xpass ${serverNumber}`;
    const proxiedUrl =
      publicBaseUrl && xpassContext
        ? buildXpassPlayUrl({
            publicBaseUrl,
            tmdbId: xpassContext.tmdbId,
            mediaType: xpassContext.mediaType,
            season: xpassContext.season,
            episode: xpassContext.episode,
            providerName,
            quality: stream.quality || 0,
          })
        : stream.url;
    return {
      ...stream,
      name: providerName,
      url: proxiedUrl,
      behaviorHints: {
        ...(stream.behaviorHints || {}),
        notWebReady: false,
      },
      title: [qualityLabel, isCam ? "CAM" : null]
        .filter(Boolean)
        .join(" "),
      serverOrder: serverNumber,
    };
  });

  return normalized.sort((a, b) => {
    const aq = a.quality || 0;
    const bq = b.quality || 0;
    if (aq !== bq) return bq - aq;
    return (a.serverOrder || 999) - (b.serverOrder || 999);
  });
}

async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseM3u8Variants(masterUrl, headers = {}) {
  try {
    const playlist = await fetchText(masterUrl, { headers });
    const lines = playlist.split(/\r?\n/);
    const variants = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.startsWith("#EXT-X-STREAM-INF")) continue;

      const resolutionMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
      let next = lines[i + 1] || "";

      if (!next || next.startsWith("#")) continue;
      if (!/^https?:/i.test(next)) {
        next = new URL(next, masterUrl).toString();
      }

      variants.push({
        url: next,
        quality: resolutionMatch ? Number(resolutionMatch[1]) : null,
        bandwidth: bandwidthMatch ? Number(bandwidthMatch[1]) : null,
      });
    }

    return variants;
  } catch (_) {
    return [];
  }
}

async function parseM3u8MasterDetails(masterUrl, headers = {}) {
  try {
    const playlist = await fetchText(masterUrl, { headers });
    const lines = playlist.split(/\r?\n/);
    const audioTracks = [];
    const variants = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-MEDIA") && /TYPE=AUDIO/i.test(line)) {
        const groupId = line.match(/GROUP-ID="([^"]+)"/i)?.[1] || null;
        const name = line.match(/NAME="([^"]+)"/i)?.[1] || null;
        const language = line.match(/LANGUAGE="([^"]+)"/i)?.[1] || null;
        const uri = line.match(/URI="([^"]+)"/i)?.[1] || null;
        const isDefault = /DEFAULT=YES/i.test(line);
        if (uri) {
          audioTracks.push({
            groupId,
            name,
            language,
            isDefault,
            url: absoluteUrl(uri, masterUrl),
          });
        }
        continue;
      }

      if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
      const resolutionMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
      const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
      const audioGroup = line.match(/AUDIO="([^"]+)"/i)?.[1] || null;
      let next = lines[i + 1] || "";
      if (!next || next.startsWith("#")) continue;
      if (!/^https?:/i.test(next)) next = absoluteUrl(next, masterUrl);

      variants.push({
        url: next,
        quality: resolutionMatch ? Number(resolutionMatch[1]) : null,
        bandwidth: bandwidthMatch ? Number(bandwidthMatch[1]) : null,
        audioGroup,
      });
    }

    return { audioTracks, variants };
  } catch (_) {
    return { audioTracks: [], variants: [] };
  }
}

function encodeUrlParam(value) {
  return Buffer.from(String(value || ""), "utf8").toString("base64url");
}

function decodeUrlParam(value) {
  return Buffer.from(String(value || ""), "base64url").toString("utf8");
}

function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/+$/, "");
  }
  const forwardedProto = req?.headers?.["x-forwarded-proto"];
  const forwardedHost = req?.headers?.["x-forwarded-host"];
  const host = forwardedHost || req?.headers?.host || `127.0.0.1:${PORT}`;
  const proto = forwardedProto || (String(host).includes("127.0.0.1") || String(host).includes("localhost") ? "http" : "https");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function buildMoxMergedPlaylistUrl({ videoUrl, audioTracks, quality, publicBaseUrl }) {
  const params = new URLSearchParams({
    video: encodeUrlParam(videoUrl),
    audios: encodeUrlParam(JSON.stringify(audioTracks || [])),
    quality: String(quality),
  });
  return `${publicBaseUrl}/hls/mox.m3u8?${params.toString()}`;
}

function buildAnimeCloudProxyUrl(targetUrl, publicBaseUrl) {
  const params = new URLSearchParams({
    url: encodeUrlParam(targetUrl),
  });
  return `${publicBaseUrl}/proxy/animecloud.mp4?${params.toString()}`;
}

function buildVidLinkProxyUrl(targetUrl, publicBaseUrl) {
  const params = new URLSearchParams({
    url: encodeUrlParam(targetUrl),
  });
  return `${publicBaseUrl}/proxy/vidlink.m3u8?${params.toString()}`;
}

function buildVixsrcProxyUrl(targetUrl, publicBaseUrl) {
  const params = new URLSearchParams({
    url: encodeUrlParam(targetUrl),
  });
  return `${publicBaseUrl}/proxy/vixsrc.m3u8?${params.toString()}`;
}

function buildXpassProxyUrl(targetUrl, publicBaseUrl) {
  const params = new URLSearchParams({
    url: encodeUrlParam(targetUrl),
  });
  return `${publicBaseUrl}/proxy/xpass.m3u8?${params.toString()}`;
}

function buildXpassPlayUrl({ publicBaseUrl, tmdbId, mediaType, season, episode, providerName, quality }) {
  const params = new URLSearchParams({
    tmdbId: String(tmdbId),
    mediaType: String(mediaType),
    provider: String(providerName),
    quality: String(quality || 0),
  });
  if (mediaType !== "movie") {
    params.set("season", String(Number(season || 1)));
    params.set("episode", String(Number(episode || 1)));
  }
  return `${publicBaseUrl}/play/xpass.m3u8?${params.toString()}`;
}

function buildSingleVariantMasterPlaylist({ videoUrl, audioTracks, quality }) {
  const bandwidthMap = {
    1080: 6000000,
    720: 3000000,
    480: 1500000,
    360: 800000,
  };
  const resolutionMap = {
    1080: "1920x1080",
    720: "1280x720",
    480: "854x480",
    360: "640x360",
  };
  const bandwidth = bandwidthMap[quality] || 1500000;
  const resolution = resolutionMap[quality] || "854x480";
  const tracks = Array.isArray(audioTracks) ? audioTracks.filter((track) => track?.url) : [];
  if (!tracks.length) {
    return [
      "#EXTM3U",
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}`,
      videoUrl,
      "",
    ].join("\n");
  }

  const mediaLines = tracks.map((track, index) => {
    const language = String(track.language || "und").toLowerCase();
    const name = String(track.name || track.language || `Audio ${index + 1}`).replace(/"/g, "");
    const flags = [
      `TYPE=AUDIO`,
      `GROUP-ID="audio"`,
      `NAME="${name}"`,
      `DEFAULT=${track.isDefault || index === 0 ? "YES" : "NO"}`,
      `AUTOSELECT=YES`,
      `LANGUAGE="${language}"`,
      `URI="${track.url}"`,
    ];
    return `#EXT-X-MEDIA:${flags.join(",")}`;
  });

  return [
    "#EXTM3U",
    ...mediaLines,
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution},AUDIO="audio"`,
    videoUrl,
    "",
  ].join("\n");
}

function keepBestWindLadder(streams) {
  const nonWind = [];
  const windGroups = new Map();

  for (const stream of streams) {
    if (stream?.name !== "Wind") {
      nonWind.push(stream);
      continue;
    }

    const groupKey = String(stream.externalUrl || stream.url || "");
    if (!windGroups.has(groupKey)) {
      windGroups.set(groupKey, []);
    }
    windGroups.get(groupKey).push(stream);
  }

  if (!windGroups.size) {
    return streams;
  }
  const firstWindGroup = [...windGroups.values()][0];
  return [...nonWind, ...firstWindGroup];
}

async function getNoTorrentStreams(imdbId, mediaType, season, episode, publicBaseUrl) {
  const url =
    mediaType === "movie"
      ? `${NOTORRENT_API}/stream/movie/${encodeURIComponent(imdbId)}.json`
      : `${NOTORRENT_API}/stream/series/${encodeURIComponent(
          `${imdbId}:${season}:${episode}`
        )}.json`;

  const payload = await fetchJson(url);
  const streams = [];
  for (const stream of payload.streams || []) {
    if (!stream?.url) continue;
    if (/aqua-vulture-337623\.hostingersite\.com/i.test(stream.url)) continue;
    const sourceText = `${stream.title || ""} ${stream.name || ""}`;
    const lang = /\bMULTI\b/i.test(sourceText)
      ? "MULTI"
      : /\bENGLISH\b/i.test(sourceText)
      ? "EN"
      : "";
    if (!lang) continue;

    const sourceName = /scrennnifu\.click/i.test(stream.url)
      ? "Scrennnifu"
      : /p\.10020\.workers\.dev\/nightbreeze17\.site/i.test(stream.url)
      ? "Nightbreeze"
      : /wind\.10018\.workers\.dev/i.test(stream.url)
      ? "Wind"
      : /(?:^https?:\/\/)?(?:astream-[^/]+\.)?voxzer\.org/i.test(stream.url)
      ? "Voxzer"
      : "MOX";

    const isSplitAudioHls = /scrennnifu\.click/i.test(stream.url);
    if (isSplitAudioHls) {
      const details = await parseM3u8MasterDetails(stream.url).catch(() => ({
        audioTracks: [],
        variants: [],
      }));
      const variants = details.variants.filter((variant) => variant.quality);
      const groupedAudio = new Map();
      for (const track of details.audioTracks) {
        const key = track.groupId || "__default__";
        if (!groupedAudio.has(key)) groupedAudio.set(key, []);
        groupedAudio.get(key).push(track);
      }

      const emitted = [];
      for (const variant of variants) {
        const candidateTracks =
          groupedAudio.get(variant.audioGroup || "__default__") ||
          groupedAudio.get("__default__") ||
          details.audioTracks;
        const tracksToUse = (candidateTracks.length ? candidateTracks : details.audioTracks)
          .filter((track, index, allTracks) =>
            allTracks.findIndex(
              (candidate) =>
                candidate.url === track.url &&
                (candidate.language || "") === (track.language || "") &&
                (candidate.name || "") === (track.name || "")
            ) === index
          )
          .slice(0, 6);
        const languages = tracksToUse
          .map((track) => String(track.language || "").trim().toUpperCase())
          .filter(Boolean);
        const audioLabel =
          tracksToUse.length > 1
            ? "MULTI"
            : languages[0] || String(tracksToUse[0]?.name || lang || "Audio").toUpperCase();
        emitted.push(
          buildStream(
            sourceName,
            [`${variant.quality}p`, audioLabel].filter(Boolean).join(" "),
            buildMoxMergedPlaylistUrl({
              videoUrl: variant.url,
              audioTracks: tracksToUse.map((track) => ({
                url: track.url,
                language: track.language || "",
                name: track.name || "",
                isDefault: !!track.isDefault,
              })),
              quality: variant.quality,
              publicBaseUrl,
            }),
            variant.quality,
            {
              externalUrl: stream.externalUrl || stream.url,
              behaviorHints: stream.behaviorHints || {},
            }
          )
        );
      }

      if (emitted.length) {
        streams.push(...emitted);
      }
      continue;
    }

    const variants = await parseM3u8Variants(stream.url).catch(() => []);
    if (variants.length) {
      streams.push(
        ...variants.map((variant) =>
          buildStream(
            sourceName,
            [variant.quality ? `${variant.quality}p` : "Auto", lang].filter(Boolean).join(" "),
            variant.url,
            variant.quality,
            {
              externalUrl: stream.externalUrl || stream.url,
              behaviorHints: stream.behaviorHints || {},
            }
          )
        )
      );
      continue;
    }

    const quality = parseQualityFromText(sourceText);
    streams.push(
      buildStream(
        sourceName,
        [quality ? `${quality}p` : "Auto", lang].filter(Boolean).join(" "),
        stream.url,
        quality,
        {
          externalUrl: stream.externalUrl,
          behaviorHints: stream.behaviorHints || {},
        }
      )
    );
  }

  return keepBestWindLadder(streams);
}

async function getVidLinkStreams(tmdbId, mediaType, season, episode, publicBaseUrl) {
  const encoded = await fetchJson(
    `${MULTI_DECRYPT_API}/enc-vidlink?text=${encodeURIComponent(tmdbId)}`
  );
  const token = encoded?.result;
  if (!token) throw new Error("VidLink token not found");

  const headers = {
    "User-Agent": USER_AGENT,
    Connection: "keep-alive",
    Referer: `${VIDLINK_API}/`,
    Origin: VIDLINK_API,
    Accept: "application/json,*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate",
  };

  const apiUrl =
    mediaType === "movie"
      ? `${VIDLINK_API}/api/b/movie/${token}`
      : `${VIDLINK_API}/api/b/tv/${token}/${season}/${episode}`;

  const payload = await fetchJson(apiUrl, { headers });
  const externalUrl =
    mediaType === "movie"
      ? `${VIDLINK_API}/movie/${tmdbId}`
      : `${VIDLINK_API}/tv/${tmdbId}/${season}/${episode}`;

  const qualityMap = payload?.stream?.qualities;
  const qualityStreams = [];
  if (qualityMap && typeof qualityMap === "object") {
    for (const [key, value] of Object.entries(qualityMap)) {
      const streamUrl = value?.url;
      if (!streamUrl) continue;
      const normalizedQuality =
        String(key).match(/(\d{3,4})/)?.[1] || parseQualityFromText(key) || parseQualityFromText(value?.quality);
      qualityStreams.push(
        buildStream(
          "VidLink",
          normalizedQuality ? `${normalizedQuality}p` : "Auto",
          buildVidLinkProxyUrl(streamUrl, publicBaseUrl),
          normalizedQuality ? Number(normalizedQuality) : null,
          { externalUrl }
        )
      );
    }
  }
  if (qualityStreams.length) {
    return qualityStreams.sort((a, b) => (b.quality || 0) - (a.quality || 0));
  }

  const playlist = payload?.stream?.playlist;
  if (!playlist) throw new Error("VidLink playlist not found");

  const variants = await parseM3u8Variants(playlist, headers);
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        "VidLink",
        variant.quality ? `${variant.quality}p` : "Auto",
        buildVidLinkProxyUrl(variant.url, publicBaseUrl),
        variant.quality,
        { externalUrl }
      )
    );
  }

  return [buildStream("VidLink", "Auto", buildVidLinkProxyUrl(playlist, publicBaseUrl), null, { externalUrl })];
}

async function getVixsrcStreams(tmdbId, mediaType, season, episode, publicBaseUrl) {
  const pageUrl =
    mediaType === "movie"
      ? `${VIXSRC_API}/movie/${tmdbId}`
      : `${VIXSRC_API}/tv/${tmdbId}/${season}/${episode}`;

  const html = await fetchText(pageUrl, {
    headers: {
      Referer: `${VIXSRC_API}/`,
      Origin: VIXSRC_API,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  let masterPlaylistUrl = null;

  if (html.includes("window.masterPlaylist")) {
    const urlMatch = html.match(/url:\s*['"]([^'"]+)['"]/);
    const tokenMatch = html.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
    const expiresMatch = html.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);
    if (urlMatch && tokenMatch && expiresMatch) {
      const baseUrl = urlMatch[1];
      const token = tokenMatch[1];
      const expires = expiresMatch[1];
      masterPlaylistUrl = baseUrl.includes("?")
        ? `${baseUrl}&token=${token}&expires=${expires}&h=1&lang=en`
        : `${baseUrl}?token=${token}&expires=${expires}&h=1&lang=en`;
    }
  }

  if (!masterPlaylistUrl) {
    const directMatch = html.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/i);
    if (directMatch) {
      masterPlaylistUrl = directMatch[1];
    }
  }

  if (!masterPlaylistUrl) {
    const scriptBlocks = html.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    for (const script of scriptBlocks) {
      const streamMatch = script.match(/['"]?(https?:\/\/[^'"\s]+(?:\.m3u8|playlist)[^'"\s]*)/i);
      if (streamMatch) {
        masterPlaylistUrl = streamMatch[1];
        break;
      }
    }
  }

  if (!masterPlaylistUrl) {
    return [];
  }

  const headers = {
    Referer: `${VIXSRC_API}/`,
    Origin: VIXSRC_API,
  };

  const variants = await parseM3u8Variants(masterPlaylistUrl, headers);
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        "Vixsrc",
        normalizeStreamTitle({ quality: variant.quality }),
        buildVixsrcProxyUrl(variant.url, publicBaseUrl),
        variant.quality,
        {
          externalUrl: pageUrl,
          behaviorHints: {
            notWebReady: false,
          },
        }
      )
    );
  }

  return [
    buildStream(
      "Vixsrc",
      "Auto",
      buildVixsrcProxyUrl(masterPlaylistUrl, publicBaseUrl),
      null,
      {
        externalUrl: pageUrl,
        behaviorHints: {
          notWebReady: false,
        },
      }
    ),
  ];
}

function encodeVideasyTitle(title) {
  return encodeURIComponent(encodeURIComponent(String(title || ""))).replace(/\+/g, "%20");
}

function getVideasySourceName(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, "");
    if (
      /vidplus\.dev$/i.test(hostname) ||
      /uskevinpowell89\.workers\.dev$/i.test(hostname) ||
      /i-cdn-0\.kessy412lad\.com$/i.test(hostname)
    ) {
      return null;
    }
    if (/begin\.10017\.workers\.dev$/i.test(hostname)) {
      return "10017";
    }
    if (/main-mp4\.jamesuncren\.workers\.dev$/i.test(hostname)) {
      return "SuNCren";
    }
    if (/lizer123\.site$/i.test(hostname)) {
      return "Lizer";
    }
    if (/i-?arch-?400/i.test(hostname)) {
      return "ArCh";
    }
    if (/wrong/i.test(hostname)) {
      return "Wrong";
    }
    const parts = hostname.split(".").filter(Boolean);
    if (parts.length >= 4 && hostname.endsWith(".workers.dev")) {
      const label = parts[0]
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      return /wrong/i.test(label) ? "Wrong" : label;
    }
    if (parts.length >= 3) {
      const label = parts[0]
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
      if (/lizer123/i.test(label)) return "Lizer";
      if (/wrong/i.test(label)) return "Wrong";
      if (/arch\s*400/i.test(label)) return "ArCh";
      return label;
    }
    return hostname;
  } catch (_) {
    return "Videasy";
  }
}

async function getVideasyStreams(title, tmdbId, imdbId, year, mediaType, season, episode) {
  if (!title) return [];

  const headers = {
    Accept: "*/*",
    "User-Agent": USER_AGENT,
    Origin: "https://cineby.gd",
    Referer: "https://cineby.gd/",
  };
  const servers = [
    "myflixerzupcloud",
    "1movies",
    "moviebox",
    "primewire",
    "m4uhd",
    "hdmovie",
    "cdn",
    "primesrcme",
  ];

  const encodedTitle = encodeVideasyTitle(title);
  const allStreams = [];

  for (const server of servers) {
    const queryParts = [
      `title=${encodedTitle}`,
      `mediaType=${encodeURIComponent(mediaType === "movie" ? "movie" : "tv")}`,
      `year=${encodeURIComponent(String(year || ""))}`,
      `tmdbId=${encodeURIComponent(String(tmdbId || ""))}`,
      `imdbId=${encodeURIComponent(String(imdbId || ""))}`,
    ];
    if (mediaType !== "movie") {
      queryParts.push(`episodeId=${encodeURIComponent(String(Number(episode || 1)))}`);
      queryParts.push(`seasonId=${encodeURIComponent(String(Number(season || 1)))}`);
    }

    const encryptedText = await fetchText(`${VIDEASY_API}/${server}/sources-with-title?${queryParts.join("&")}`, {
      headers,
    }).catch(() => null);
    if (!encryptedText) continue;

    const payload = await fetchJson(`${MULTI_DECRYPT_API}/dec-videasy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: encryptedText,
        id: tmdbId,
      }),
    }).catch(() => null);

    const sources = payload?.result?.sources;
    if (!Array.isArray(sources) || !sources.length) continue;

    for (const source of sources) {
      const sourceUrl = source?.url;
      if (!sourceUrl) continue;
      const quality = parseQualityFromText(source?.quality) || null;
      const typeLabel = sourceUrl.includes(".m3u8")
        ? "HLS"
        : /\.(mp4|mkv)(\?|$)/i.test(sourceUrl)
        ? "MP4"
        : null;
      const providerName = getVideasySourceName(sourceUrl);
      if (!providerName) continue;
      allStreams.push(
        buildStream(
          providerName,
          [quality ? `${quality}p` : "Auto", typeLabel].filter(Boolean).join(" "),
          sourceUrl,
          quality,
          {
            externalUrl: sourceUrl,
            behaviorHints: {
              proxyHeaders: {
                request: headers,
              },
            },
          }
        )
      );
    }
  }

  // Some Videasy hosts (e.g. ArCh) return many near-duplicate Auto playlists.
  // Keep only the first one to reduce noise.
  let seenArch = false;
  return allStreams.filter((stream) => {
    if (stream.name !== "ArCh") return true;
    if (seenArch) return false;
    seenArch = true;
    return true;
  });
}

function extractXpassBackups(html) {
  const raw =
    String(html || "").match(/var backups=(\[[\s\S]*?])<\/script>/i)?.[1] ||
    String(html || "").match(/var backups=(\[[\s\S]*?])\s*var /i)?.[1];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed
          .map((entry) => ({
            name: String(entry?.name || "").trim(),
            url: String(entry?.url || "").trim(),
          }))
          .filter((entry) => entry.name && entry.url)
      : [];
  } catch (_) {
    return [];
  }
}

async function getXpassStreams(tmdbId, mediaType, season, episode, publicBaseUrl) {
  const embedUrl =
    mediaType === "movie"
      ? `${XPASS_API}/e/movie/${tmdbId}`
      : `${XPASS_API}/e/tv/${tmdbId}/${season}/${episode}`;
  const html = await fetchText(embedUrl, {
    headers: {
      Referer: `${XPASS_API}/`,
      Origin: XPASS_API,
    },
  });
  const backups = extractXpassBackups(html).slice(0, 3);
  const settled = await Promise.allSettled(
    backups.map(async (backup) => {
      const fullUrl = /^https?:/i.test(backup.url)
        ? backup.url
        : `${XPASS_API}${backup.url}`;
      const payload = await fetchJson(fullUrl, {
        headers: {
          Referer: `${XPASS_API}/`,
          Origin: XPASS_API,
        },
      });
      const sources = payload?.playlist?.[0]?.sources;
      if (!Array.isArray(sources)) return [];

      const sourceSettled = await Promise.allSettled(
        sources.map(async (source) => {
          const file = String(source?.file || "").trim();
          if (!/^https?:/i.test(file)) return [];
          const label = String(source?.label || backup.name || "Auto").trim();
          const lowerType = String(source?.type || "").toLowerCase();
          const isM3u8 = lowerType.includes("hls") || file.includes(".m3u8");

          if (isM3u8) {
            const variants = await parseM3u8Variants(file, {
              Referer: `${XPASS_API}/`,
              Origin: XPASS_API,
            });
            if (variants.length) {
              return variants.map((variant) => ({
                ...buildStream(
                  "Xpass",
                  [variant.quality ? `${variant.quality}p` : "Auto", label].filter(Boolean).join(" "),
                  variant.url,
                  variant.quality,
                  {
                    externalUrl: embedUrl,
                    behaviorHints: {
                      proxyHeaders: {
                        request: {
                          Referer: `${XPASS_API}/`,
                          Origin: XPASS_API,
                        },
                      },
                    },
                  }
                ),
                xpassLabel: label,
              }));
            }
          }

          return [
            {
              ...buildStream("Xpass", label, file, parseQualityFromText(label), {
                externalUrl: embedUrl,
                behaviorHints: {
                  proxyHeaders: {
                    request: {
                      Referer: `${XPASS_API}/`,
                      Origin: XPASS_API,
                    },
                  },
                },
              }),
              xpassLabel: label,
            },
          ];
        })
      );

      return sourceSettled
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value);
    })
  );

  return normalizeXpassStreams(
    settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value)
  , publicBaseUrl, { tmdbId, mediaType, season, episode });
}

function extractVidLinkRequestHeaders(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    const rawHeaders = parsed.searchParams.get("headers");
    const requestHeaders = rawHeaders ? JSON.parse(rawHeaders) : {};
    return Object.fromEntries(
      Object.entries(requestHeaders || {})
        .filter(([, value]) => typeof value === "string" && value)
        .map(([key, value]) => [String(key), String(value)])
    );
  } catch (_) {
    return {};
  }
}

function buildAbsoluteProxyUrl(baseUrl, relativeUrl, publicBaseUrl) {
  const absolute = new URL(relativeUrl, baseUrl);
  const base = new URL(baseUrl);
  const isRelative = !/^https?:/i.test(String(relativeUrl || ""));
  if (
    isRelative &&
    !absolute.search &&
    base.searchParams.has("headers")
  ) {
    absolute.searchParams.set("headers", base.searchParams.get("headers"));
  }
  if (
    isRelative &&
    !absolute.searchParams.has("host") &&
    base.searchParams.has("host")
  ) {
    absolute.searchParams.set("host", base.searchParams.get("host"));
  }
  return buildVidLinkProxyUrl(absolute.toString(), publicBaseUrl);
}

function buildAbsoluteProxyUrlWith(playlistUrl, relativeUrl, publicBaseUrl, proxyBuilder) {
  const absolute = new URL(relativeUrl, playlistUrl);
  return proxyBuilder(absolute.toString(), publicBaseUrl);
}

function rewriteM3u8ForProxyWith(playlist, baseUrl, publicBaseUrl, proxyBuilder) {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.startsWith("#")) {
        const uriMatch = line.match(/URI="([^"]+)"/);
        if (!uriMatch) return line;
        const proxied = buildAbsoluteProxyUrlWith(baseUrl, uriMatch[1], publicBaseUrl, proxyBuilder);
        return line.replace(uriMatch[1], proxied);
      }
      return buildAbsoluteProxyUrlWith(baseUrl, line, publicBaseUrl, proxyBuilder);
    })
    .join("\n");
}

function rewriteM3u8ForProxy(playlist, baseUrl, publicBaseUrl) {
  return rewriteM3u8ForProxyWith(playlist, baseUrl, publicBaseUrl, buildVidLinkProxyUrl);
}

function base64ToBytes(base64) {
  const normalized = String(base64 || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(Buffer.from(normalized, "base64"));
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .replace(/\b(tv|dub|sub|subbed|dubbed|season|part|movie|specials?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleScore(candidate, query) {
  const a = normalizeText(candidate);
  const b = normalizeText(query);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b)) return 90;
  if (b.includes(a)) return 85;
  const aWords = new Set(a.split(" ").filter(Boolean));
  const bWords = b.split(" ").filter(Boolean);
  let matched = 0;
  for (const word of bWords) {
    if (aWords.has(word)) matched += 1;
  }
  return Math.round((matched / Math.max(1, bWords.length)) * 70);
}

function absoluteUrl(url, baseUrl) {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).toString();
  } catch (_) {
    return url;
  }
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function qualityRank(quality) {
  const text = String(quality || "").toLowerCase();
  if (text.includes("4k") || text.includes("2160")) return 2160;
  const match = text.match(/(\d{3,4})/);
  return match ? Number(match[1]) : 0;
}

async function extractMegaCloudStreams(embedUrl, providerName, typeLabel = "") {
  const page = await fetchText(embedUrl, {
    headers: {
      Referer: "https://megacloud.blog/",
      "x-requested-with": "XMLHttpRequest",
    },
  });
  const nonce =
    page.match(/\b[a-zA-Z0-9]{48}\b/)?.[0] ||
    (() => {
      const match = page.match(
        /\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/
      );
      return match ? `${match[1]}${match[2]}${match[3]}` : null;
    })();
  const id = embedUrl.split("/").pop()?.split("?")[0];
  if (!nonce || !id) return [];

  const sourcePayload = await fetchJson(
    `https://megacloud.blog/embed-2/v3/e-1/getSources?id=${encodeURIComponent(
      id
    )}&_k=${encodeURIComponent(nonce)}`,
    {
      headers: {
        Referer: "https://megacloud.blog/",
        "x-requested-with": "XMLHttpRequest",
      },
    }
  );

  const firstFile = sourcePayload?.sources?.[0]?.file;
  if (!firstFile) return [];

  const directHls = firstFile.includes(".m3u8")
    ? firstFile
    : await (async () => {
        try {
          const keys = await fetchJson(
            "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json"
          );
          const secret = keys?.mega;
          if (!secret) return null;
          const decodeText = await fetchText(
            `https://script.google.com/macros/s/AKfycbxHbYHbrGMXYD2-bC-C43D3njIbU-wGiYQuJL61H4vyy6YVXkybMNNEPJNPPuZrD1gRVA/exec?encrypted_data=${encodeURIComponent(
              firstFile
            )}&nonce=${encodeURIComponent(nonce)}&secret=${encodeURIComponent(secret)}`
          );
          return decodeText.match(/"file":"(.*?)"/)?.[1] || null;
        } catch (_) {
          return null;
        }
      })();

  if (!directHls) return [];

  const variants = await parseM3u8Variants(directHls, {
    Referer: "https://megacloud.blog/",
    Origin: "https://megacloud.blog",
  });
  const subtitles = (sourcePayload?.tracks || [])
    .filter((track) => track?.file && /(captions|subtitles)/i.test(track?.kind || ""))
    .map((track) => `${track.label || "Sub"}: ${track.file}`);
  const suffix = typeLabel ? ` ${typeLabel}` : "";
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        providerName,
        `${providerName}${suffix} ${variant.quality ? `${variant.quality}p` : "Auto"}`,
        variant.url,
        variant.quality,
        {
          externalUrl: embedUrl,
          behaviorHints: subtitles.length
            ? { filename: subtitles.slice(0, 2).join(" | ") }
            : {},
        }
      )
    );
  }

  return [
    buildStream(providerName, `${providerName}${suffix} Auto`, directHls, null, {
      externalUrl: embedUrl,
    }),
  ];
}

function generateAllWishVrf(episodeId) {
  const secretKey = "ysJhV6U27FVIjjuk";
  const encodedId = encodeURIComponent(episodeId)
    .replace(/%21/g, "!")
    .replace(/%27/g, "'")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%7E/g, "~")
    .replace(/%2A/g, "*");
  const keyCodes = Array.from(secretKey).map((char) => char.charCodeAt(0));
  const dataCodes = Array.from(encodedId).map((char) => char.charCodeAt(0));
  const state = Array.from({ length: 256 }, (_, index) => index);
  let a = 0;
  for (let i = 0; i <= 255; i += 1) {
    a = (a + state[i] + keyCodes[i % keyCodes.length]) % 256;
    [state[i], state[a]] = [state[a], state[i]];
  }
  const out = [];
  let i = 0;
  a = 0;
  for (let r = 0; r < dataCodes.length; r += 1) {
    i = (i + 1) % 256;
    a = (a + state[i]) % 256;
    [state[i], state[a]] = [state[a], state[i]];
    const k = state[(state[i] + state[a]) % 256];
    out.push((dataCodes[r] ^ k) & 0xff);
  }
  const base1 = bytesToBase64Url(out);
  const step2 = Array.from(Buffer.from(base1, "latin1")).map((value, index) => {
    const offsets = { 1: 3, 7: 5, 2: -4, 4: -2, 6: 4, 0: -3, 3: 2, 5: 5 };
    return (value + (offsets[index % 8] || 0)) & 0xff;
  });
  const base2 = bytesToBase64Url(step2);
  return Array.from(base2)
    .map((char) => {
      if (char >= "A" && char <= "Z") {
        return String.fromCharCode(((char.charCodeAt(0) - 65 + 13) % 26) + 65);
      }
      if (char >= "a" && char <= "z") {
        return String.fromCharCode(((char.charCodeAt(0) - 97 + 13) % 26) + 97);
      }
      return char;
    })
    .join("");
}

function parseAllWishItems(html, query) {
  const matches = [];
  const regex =
    /<div[^>]+class="item"[\s\S]*?<div[^>]+class="name"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    matches.push({
      url: absoluteUrl(match[1], ALLWISH_API),
      title: stripHtml(match[2]),
      score: titleScore(stripHtml(match[2]), query),
    });
  }
  return matches.sort((a, b) => b.score - a.score);
}

async function extractAllWishZen(url, label) {
  const pageHtml = await fetchText(url);
  const videoB64 = pageHtml.match(/video_b64:\s*"([^"]+)"/)?.[1];
  const keyB64 = pageHtml.match(/enc_key_b64:\s*"([^"]+)"/)?.[1];
  const ivB64 = pageHtml.match(/iv_b64:\s*"([^"]+)"/)?.[1];
  if (!videoB64 || !keyB64 || !ivB64 || !globalThis.crypto?.subtle) return [];
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    base64ToBytes(keyB64),
    { name: "AES-CBC" },
    false,
    ["decrypt"]
  );
  const decrypted = await globalThis.crypto.subtle.decrypt(
    { name: "AES-CBC", iv: base64ToBytes(ivB64) },
    key,
    base64ToBytes(videoB64)
  );
  const bytes = new Uint8Array(decrypted);
  const pad = bytes[bytes.length - 1];
  const playlist = new TextDecoder().decode(bytes.slice(0, bytes.length - pad)).trim();
  if (!playlist) return [];
  const variants = await parseM3u8Variants(playlist, {
    Referer: "https://player.sgsgsgsr.site/",
    Origin: "https://player.sgsgsgsr.site",
  });
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        "AllWish",
        `AllWish ${label} ${variant.quality ? `${variant.quality}p` : "Auto"}`,
        variant.url,
        variant.quality,
        { externalUrl: url }
      )
    );
  }
  return [buildStream("AllWish", `AllWish ${label} Auto`, playlist, null, { externalUrl: url })];
}

async function extractAllWishMegaPlay(url, label) {
  const pageHtml = await fetchText(url, {
    headers: {
      Referer: "https://megaplay.buzz/",
      "x-requested-with": "XMLHttpRequest",
    },
  });
  const id = pageHtml.match(/id=["']megaplay-player["'][^>]*data-id=["']([^"']+)["']/i)?.[1];
  if (!id) return [];
  const sourceJson = await fetchJson(
    `https://megaplay.buzz/stream/getSources?id=${encodeURIComponent(id)}&id=${encodeURIComponent(id)}`,
    {
      headers: {
        Referer: "https://megaplay.buzz/",
        "x-requested-with": "XMLHttpRequest",
      },
    }
  );
  const file = sourceJson?.sources?.file;
  if (!file) return [];
  const variants = await parseM3u8Variants(file, {
    Referer: "https://megaplay.buzz/",
    Origin: "https://megaplay.buzz",
  });
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        "AllWish",
        `AllWish ${label} ${variant.quality ? `${variant.quality}p` : "Auto"}`,
        variant.url,
        variant.quality,
        { externalUrl: url }
      )
    );
  }
  return [buildStream("AllWish", `AllWish ${label} Auto`, file, null, { externalUrl: url })];
}

async function getAllWishStreams(tmdb, mediaType, season, episode, animeEpisode) {
  if (mediaType !== "movie" && mediaType !== "series") return [];
  if (tmdb.genres?.length && !tmdb.genres.some((genre) => genre.id === 16)) return [];
  const queries = [tmdb.title, tmdb.originalTitle].filter(
    (value, index, array) => value && array.indexOf(value) === index
  );
  let match = null;
  for (const query of queries) {
    const html = await fetchText(`${ALLWISH_API}/filter?keyword=${encodeURIComponent(query)}&page=1`);
    match = parseAllWishItems(html, query)[0] || null;
    if (match?.url) break;
  }
  if (!match?.url) return [];

  const detailHtml = await fetchText(match.url);
  const showId =
    detailHtml.match(/<main[^>]+data-id=["']([^"']+)["']/i)?.[1] ||
    detailHtml.match(/data-id=["']([^"']+)["']/i)?.[1];
  if (!showId) return [];

  const vrf = generateAllWishVrf(showId);
  const episodeList = await fetchJson(
    `${ALLWISH_API}/ajax/episode/list/${encodeURIComponent(showId)}?vrf=${encodeURIComponent(vrf)}`,
    { headers: { "x-requested-with": "XMLHttpRequest" } }
  ).catch(() => null);
  const episodeHtml = episodeList?.result || "";
  const targetEpisode = mediaType === "movie" ? 1 : Number(animeEpisode || episode || 1);
  let selected = null;
  for (const matchEp of episodeHtml.matchAll(
    /data-slug=["'](\d+)["'][^>]*data-ids=["']([^"']+)["'][^>]*data-sub=["'](\d)["'][^>]*data-dub=["'](\d)["']/gi
  )) {
    if (mediaType === "movie" || Number(matchEp[1]) === targetEpisode) {
      selected = {
        ids: matchEp[2],
        hasSub: matchEp[3] === "1",
        hasDub: matchEp[4] === "1",
      };
      break;
    }
  }
  if (!selected?.ids) return [];

  const serverList = await fetchJson(
    `${ALLWISH_API}/ajax/server/list?servers=${encodeURIComponent(selected.ids)}`,
    { headers: { "x-requested-with": "XMLHttpRequest" } }
  ).catch(() => null);
  const html = serverList?.result || "";
  const streams = [];
  for (const section of html.matchAll(
    /<div[^>]+class="server-type"[^>]*data-type=["']([^"']+)["'][\s\S]*?<div[^>]+class="server-list"[\s\S]*?<\/div>\s*<\/div>/gi
  )) {
    const type = section[1];
    if (type === "sub" && !selected.hasSub) continue;
    if (type === "dub" && !selected.hasDub) continue;
    for (const server of section[0].matchAll(
      /<div[^>]+class="server"[^>]*data-link-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi
    )) {
      const serverId = server[1];
      const serverName = stripHtml(server[2]);
      const serverPayload = await fetchJson(
        `${ALLWISH_API}/ajax/server?get=${encodeURIComponent(serverId)}`,
        { headers: { "x-requested-with": "XMLHttpRequest" } }
      ).catch(() => null);
      const realUrl = serverPayload?.result?.url;
      if (!realUrl) continue;
      const label = type === "dub" ? "DUB" : "SUB";
      if (/megaplay\.buzz/i.test(realUrl)) {
        streams.push(...(await extractAllWishMegaPlay(realUrl, label).catch(() => [])));
      } else if (
        /player\.sgsgsgsr\.site|zencloudz\.cc/i.test(realUrl) ||
        /zen/i.test(serverName)
      ) {
        streams.push(...(await extractAllWishZen(realUrl, label).catch(() => [])));
      } else if (realUrl.includes(".m3u8")) {
        streams.push(buildStream("AllWish", `AllWish ${label} Auto`, realUrl, null, { externalUrl: realUrl }));
      }
    }
  }
  return streams;
}

async function getHiAnimeStreams({ malSync, mediaType, episode }) {
  const hianimeUrl = malSync?.hianimeurl;
  if (!hianimeUrl) return [];
  const hiId = hianimeUrl.split("/").filter(Boolean).pop()?.split("-").pop();
  if (!hiId) return [];

  for (const api of HIANIME_APIS) {
    try {
      const listPayload = await fetchJson(`${api}/ajax/v2/episode/list/${encodeURIComponent(hiId)}`, {
        headers: {
          "x-requested-with": "XMLHttpRequest",
          Referer: `${api}/`,
        },
      });
      const targetEpisode = String(mediaType === "movie" ? 1 : episode || 1);
      const epId = listPayload?.html
        ?.match(new RegExp(`data-number=["']${targetEpisode}["'][^>]*data-id=["']([^"']+)["']`, "i"))
        ?.[1];
      if (!epId) continue;

      const serversPayload = await fetchJson(
        `${api}/ajax/v2/episode/servers?episodeId=${encodeURIComponent(epId)}`,
        {
          headers: {
            "x-requested-with": "XMLHttpRequest",
            Referer: `${api}/`,
          },
        }
      );

      const results = [];
      for (const server of (serversPayload?.html || "").matchAll(
        /<div[^>]+class="server-item"[^>]*data-id=["']([^"']+)["'][^>]*data-type=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi
      )) {
        const serverId = server[1];
        const type = server[2];
        const sourcePayload = await fetchJson(
          `${api}/ajax/v2/episode/sources?id=${encodeURIComponent(serverId)}`,
          {
            headers: {
              "x-requested-with": "XMLHttpRequest",
              Referer: `${api}/`,
            },
          }
        ).catch(() => null);
        const link = sourcePayload?.link;
        if (!link || !/megacloud/i.test(link)) continue;
        results.push(...(await extractMegaCloudStreams(link, "HiAnime", type.toUpperCase()).catch(() => [])));
      }
      if (results.length) return results;
    } catch (_) {
      // Try next mirror.
    }
  }
  return [];
}

async function encKai(text) {
  const payload = await fetchJson(
    `${MULTI_DECRYPT_API}/enc-kai?text=${encodeURIComponent(text)}`
  );
  return payload?.result || null;
}

async function decKai(text) {
  const payload = await fetchJson(`${MULTI_DECRYPT_API}/dec-kai`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  return payload?.result || null;
}

async function getAnimeKaiStreams({ imdbId, tmdb, animeIds, mediaType, episode }) {
  const anilistId = animeIds?.anilistId;
  if (!anilistId) return [];
  const dbEntry = await fetchJson(
    `${ANIMEKAI_DB_API}/find?anilist_id=${encodeURIComponent(anilistId)}`
  ).catch(() => null);
  const dbData = Array.isArray(dbEntry) ? dbEntry[0] : null;
  if (!dbData) return [];

  let token = null;
  const targetEpisode = String(mediaType === "movie" ? 1 : episode || 1);
  const seasons = dbData.episodes || {};
  for (const seasonMap of Object.values(seasons)) {
    if (seasonMap?.[targetEpisode]?.token) {
      token = seasonMap[targetEpisode].token;
      break;
    }
  }
  if (!token) return [];

  const encToken = await encKai(token);
  if (!encToken) return [];
  const serverListPayload = await fetchJson(
    `${ANIMEKAI_AJAX}/links/list?token=${encodeURIComponent(token)}&_=${encodeURIComponent(encToken)}`
  ).catch(() => null);
  const parsedServers = await parseHtmlPayload(serverListPayload?.result || "").catch(() => null);
  if (!parsedServers?.result) return [];

  const allStreams = [];
  for (const [serverType, serverGroup] of Object.entries(parsedServers.result || {})) {
    for (const serverData of Object.values(serverGroup || {})) {
      const lid = serverData?.lid;
      const serverName = serverData?.name || serverData?.label || "Server";
      if (!lid) continue;
      try {
        const encLid = await encKai(lid);
        if (!encLid) continue;
        const embedPayload = await fetchJson(
          `${ANIMEKAI_AJAX}/links/view?id=${encodeURIComponent(lid)}&_=${encodeURIComponent(encLid)}`
        );
        const decrypted = await decKai(embedPayload?.result);
        const embedUrl = decrypted?.url;
        if (!embedUrl) continue;
        if (/mega(up|\.live|\.cx)/i.test(embedUrl)) {
          const streams = await extractMegaUpStreams(embedUrl, `AnimeKai ${serverName}`);
          allStreams.push(...streams);
        } else if (embedUrl.includes(".m3u8")) {
          const variants = await parseM3u8Variants(embedUrl);
          if (variants.length) {
            allStreams.push(
              ...variants.map((variant) =>
                buildStream(
                  "AnimeKai",
                  `AnimeKai ${serverType.toUpperCase()} ${variant.quality ? `${variant.quality}p` : "Auto"}`,
                  variant.url,
                  variant.quality,
                  { externalUrl: embedUrl }
                )
              )
            );
          } else {
            allStreams.push(
              buildStream(
                "AnimeKai",
                `AnimeKai ${serverType.toUpperCase()} Auto`,
                embedUrl,
                null,
                { externalUrl: embedUrl }
              )
            );
          }
        }
      } catch (_) {
        // Ignore broken AnimeKai server.
      }
    }
  }

  return allStreams;
}

async function getVidsrcCCStreams(tmdb, imdbId, mediaType, season, episode) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const embedUrl =
    mediaType === "movie"
      ? `${VIDSRCCC_API}/v2/embed/${type}/${encodeURIComponent(imdbId)}`
      : `${VIDSRCCC_API}/v2/embed/${type}/${encodeURIComponent(imdbId)}/${season}/${episode}`;
  const html = await fetchText(embedUrl, {
    headers: {
      Referer: `${VIDSRCCC_API}/`,
    },
  });
  const v = html.match(/var v = "(.*?)";/)?.[1];
  const userId = html.match(/var userId = "(.*?)";/)?.[1];
  const movieId = html.match(/var movieId = "(.*?)";/)?.[1];
  if (!v || !userId || !movieId) return [];

  const vrfPayload = await fetchJson(
    `${MULTI_DECRYPT_API}/enc-vidsrc?user_id=${encodeURIComponent(userId)}&movie_id=${encodeURIComponent(movieId)}`
  ).catch(() => null);
  const encrypted = vrfPayload?.result;
  if (!encrypted) return [];

  let serversUrl = `${VIDSRCCC_API}/api/${movieId}/servers?id=${encodeURIComponent(
    movieId
  )}&type=${type}&v=${encodeURIComponent(v)}&vrf=${encodeURIComponent(
    encrypted
  )}&imdbId=${encodeURIComponent(imdbId)}`;
  if (mediaType !== "movie") {
    serversUrl += `&season=${season}&episode=${episode}`;
  }
  const serverData = await fetchJson(serversUrl, {
    headers: { Referer: `${VIDSRCCC_API}/` },
  }).catch(() => null);
  const servers = serverData?.data || [];
  const vidPlay = servers.find((server) => server?.name === "VidPlay")?.hash;
  if (!vidPlay) return [];

  const sourcePayload = await fetchJson(`${VIDSRCCC_API}/api/source/${vidPlay}`, {
    headers: { Referer: `${VIDSRCCC_API}/` },
  }).catch(() => null);
  const streamUrl = sourcePayload?.data?.source;
  if (!streamUrl) return [];
  const variants = await parseM3u8Variants(streamUrl, { Referer: `${VIDSRCCC_API}/` });
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        "VidsrcCC",
        `VidsrcCC ${variant.quality ? `${variant.quality}p` : "Auto"}`,
        variant.url,
        variant.quality,
        { externalUrl: embedUrl }
      )
    );
  }
  return [buildStream("VidsrcCC", "VidsrcCC Auto", streamUrl, null, { externalUrl: embedUrl })];
}

function normalizeForeignStreams(providerName, streams, fallbackTitle) {
  return (streams || [])
    .filter((stream) => stream?.url)
    .map((stream) => {
      const quality =
        typeof stream.quality === "string"
          ? qualityRank(stream.quality)
          : parseQualityFromText(`${stream.quality || ""} ${stream.name || ""} ${stream.title || ""}`);
      const titleParts = [
        stream.quality && qualityRank(stream.quality)
          ? `${qualityRank(stream.quality)}p`
          : quality
          ? `${quality}p`
          : null,
        stream.name && !stream.name.toLowerCase().includes(providerName.toLowerCase())
          ? stripHtml(stream.name)
          : null,
      ].filter(Boolean);
      return buildStream(providerName, titleParts.join(" "), stream.url, quality || null, {
        externalUrl: stream.externalUrl || stream.url,
        behaviorHints: stream.headers ? { proxyHeaders: JSON.stringify(stream.headers) } : {},
      });
    });
}

async function getWitAnimeStreams(tmdbId, mediaType, season, episode, imdbId) {
  const type = mediaType === "movie" ? "movie" : "tv";
  const idsToTry = [
    mediaType === "movie"
      ? String(tmdbId)
      : `${tmdbId}:${Number(season || 1)}:${Number(episode || 1)}`,
  ];
  if (imdbId) {
    idsToTry.push(
      mediaType === "movie"
        ? String(imdbId)
        : `${imdbId}:${Number(season || 1)}:${Number(episode || 1)}`
    );
  }

  for (const id of idsToTry) {
    const payload = await fetchJson(
      `${WITANIME_BACKEND}/streams/${type}/${encodeURIComponent(id)}.json`
    ).catch(() => null);
    const streams = normalizeForeignStreams("WitAnime", payload?.streams || []);
    if (streams.length) return streams;
  }
  return [];
}

async function getAnimeCloudStreams(tmdbId, mediaType, season, episode, publicBaseUrl) {
  const url = `${ANIMECLOUD_BACKEND}?tmdbId=${encodeURIComponent(tmdbId)}&mediaType=${encodeURIComponent(
    mediaType === "movie" ? "movie" : "tv"
  )}&season=${encodeURIComponent(Number(season || 1))}&episode=${encodeURIComponent(
    Number(episode || 1)
  )}`;
  const payload = await fetchJson(url).catch(() => null);
  return normalizeForeignStreams("AnimeCloud", payload?.streams || []).map((stream) => ({
    ...stream,
    title: stream.title === "Auto" ? "Auto MP4" : `${stream.title} MP4`,
    url: buildAnimeCloudProxyUrl(stream.url, publicBaseUrl),
    behaviorHints: {
      ...(stream.behaviorHints || {}),
      notWebReady: false,
    },
  }));
}

function unpackPackedScript(packed) {
  const match = packed.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/
  );
  if (!match) return "";
  let p = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const a = Number(match[2]);
  let c = Number(match[3]);
  const k = match[4].split("|");

  function baseEncode(value, base) {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (value === 0) return "0";
    let result = "";
    while (value > 0) {
      result = chars[value % base] + result;
      value = Math.floor(value / base);
    }
    return result;
  }

  const dict = {};
  while (c--) {
    const encoded = baseEncode(c, a);
    dict[encoded] = k[c] || encoded;
  }

  return p.replace(/\b(\w+)\b/g, (full) => (dict[full] !== undefined ? dict[full] : full));
}

function extractPackedBlock(html) {
  const start = html.indexOf("eval(function(p,a,c,k,e,d)");
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < html.length; i += 1) {
    if (html[i] === "(") depth += 1;
    else if (html[i] === ")") {
      depth -= 1;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return "";
}

function deriveUrlsetVariants(masterUrl) {
  const match = masterUrl.match(
    /^(.+_),([a-zA-Z]+(?:,[a-zA-Z]+)*),\.urlset\/master\.m3u8(\?.+)?$/
  );
  if (!match) return [];
  const base = match[1];
  const suffixes = match[2].split(",");
  const query = match[3] || "";
  const qualityMap = { x: 1080, h: 720, n: 480, l: 360 };
  return suffixes
    .map((suffix) => ({
      url: `${base}${suffix}/index-v1-a1.m3u8${query}`,
      quality: qualityMap[suffix] || null,
    }))
    .filter((variant) => variant.quality)
    .sort((a, b) => b.quality - a.quality);
}

async function getKirmziStreams(tmdb, season, episode) {
  const searchTerms = [tmdb.originalTitle, tmdb.title].filter(Boolean);
  for (const term of searchTerms) {
    try {
      const searchHtml = await fetchText(`${KIRMZI_T123_BASE}/?s=${encodeURIComponent(term)}`);
      const showSlug =
        searchHtml.match(/href="https:\/\/turkish123\.ac\/([a-z0-9-]+)\/"/i)?.[1] || null;
      if (!showSlug) continue;
      let absoluteEpisode = Number(episode || 1);
      if (Number(season || 1) > 1) {
        for (let s = 1; s < Number(season); s += 1) {
          const seasonInfo = await fetchJson(
            `https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdb.tmdbId)}/season/${s}?api_key=${TMDB_FALLBACK_API_KEY}`
          ).catch(() => null);
          absoluteEpisode += Number(seasonInfo?.episodes?.length || 0);
        }
      }
      const episodeHtml = await fetchText(
        `${KIRMZI_T123_BASE}/${showSlug}-episode-${absoluteEpisode}/`
      );
      const embeds = [
        ...episodeHtml.matchAll(
          /iframe[^>]*src="(https?:\/\/(?:tukipasti|kitraskimisi|engifuosi|rufiiguta|lajkema)[^"]+)"/gi
        ),
      ].map((match) => match[1]);
      for (const embedUrl of embeds) {
        const embedHtml = await fetchText(embedUrl).catch(() => "");
        const direct =
          embedHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/)?.[0] ||
          (() => {
            const packed = extractPackedBlock(embedHtml);
            const unpacked = packed ? unpackPackedScript(packed) : "";
            return unpacked.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/)?.[0] || null;
          })();
        if (!direct) continue;
        const derived = deriveUrlsetVariants(direct);
        if (derived.length) {
          return derived.map((variant) =>
            buildStream("Kirmzi", `Kirmzi ${variant.quality}p`, variant.url, variant.quality, {
              externalUrl: embedUrl,
            })
          );
        }
        return [buildStream("Kirmzi", "Kirmzi Auto", direct, null, { externalUrl: embedUrl })];
      }
    } catch (_) {
      // Try next term.
    }
  }
  return [];
}

let netMirrorCookie = "";
let netMirrorCookieTime = 0;

async function getNetMirrorCookie() {
  const now = Date.now();
  if (netMirrorCookie && now - netMirrorCookieTime < 15 * 60 * 60 * 1000) {
    return netMirrorCookie;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${NETMIRROR_BASE}/tv/p.php`, {
      method: "POST",
      headers: { "user-agent": USER_AGENT, accept: "*/*" },
    }).catch(() => null);
    if (!response?.ok) continue;
    const text = await response.text().catch(() => "");
    const setCookie = response.headers.get("set-cookie") || "";
    const cookie = setCookie.match(/t_hash_t=([^;]+)/)?.[1];
    if (cookie && text.includes('"r":"n"')) {
      netMirrorCookie = cookie;
      netMirrorCookieTime = now;
      return cookie;
    }
  }
  return null;
}

async function netMirrorSearch(query, platform, cookie) {
  const ottMap = { netflix: "nf", primevideo: "pv", disney: "hs" };
  const ott = ottMap[platform] || "nf";
  const cookieHeader = `t_hash_t=${cookie}; user_token=233123f803cf02184bf6c67e149cdd50; hd=on; ott=${ott}`;
  const endpoint =
    platform === "primevideo"
      ? `${NETMIRROR_BASE}/pv/search.php`
      : platform === "disney"
      ? `${NETMIRROR_BASE}/mobile/hs/search.php`
      : `${NETMIRROR_BASE}/search.php`;
  const payload = await fetchJson(
    `${endpoint}?s=${encodeURIComponent(query)}&t=${Math.floor(Date.now() / 1000)}`,
    {
      headers: {
        Cookie: cookieHeader,
        Referer: `${NETMIRROR_BASE}/tv/home`,
      },
    }
  ).catch(() => null);
  return payload?.searchResult || [];
}

async function netMirrorPlaylist(contentId, title, platform, cookie) {
  const ottMap = { netflix: "nf", primevideo: "pv", disney: "hs" };
  const ott = ottMap[platform] || "nf";
  const cookieHeader = `t_hash_t=${cookie}; user_token=233123f803cf02184bf6c67e149cdd50; hd=on; ott=${ott}`;
  const endpoint =
    platform === "primevideo"
      ? `${NETMIRROR_BASE}/pv/playlist.php`
      : platform === "disney"
      ? `${NETMIRROR_BASE}/mobile/hs/playlist.php`
      : `${NETMIRROR_BASE}/tv/playlist.php`;
  const payload = await fetchJson(
    `${endpoint}?id=${encodeURIComponent(contentId)}&t=${encodeURIComponent(
      title
    )}&tm=${Math.floor(Date.now() / 1000)}`,
    {
      headers: {
        Cookie: cookieHeader,
        Referer: `${NETMIRROR_BASE}/tv/home`,
      },
    }
  ).catch(() => null);
  return Array.isArray(payload) ? payload : [];
}

function getNetMirrorUrlBase(platform) {
  return platform === "primevideo"
    ? `${NETMIRROR_BASE}/pv`
    : platform === "disney"
    ? `${NETMIRROR_BASE}/mobile/hs`
    : NETMIRROR_BASE;
}

async function getNetMirrorStreams(tmdb, mediaType, season, episode) {
  const cookie = await getNetMirrorCookie();
  if (!cookie) return [];
  const title = tmdb.title || tmdb.originalTitle;
  const queries = Array.from(
    new Set([tmdb.year ? `${title} ${tmdb.year}` : null, title].filter(Boolean))
  );
  const platforms = ["netflix", "primevideo", "disney"];
  for (const platform of platforms) {
    for (const query of queries) {
      const results = await netMirrorSearch(query, platform, cookie).catch(() => []);
      const selected = results
        .map((item) => ({
          id: item?.id,
          title: item?.t,
          score: titleScore(item?.t, title),
        }))
        .filter((item) => item.id && item.score >= 60)
        .sort((a, b) => b.score - a.score)[0];
      if (!selected?.id) continue;
      const playlist = await netMirrorPlaylist(selected.id, title, platform, cookie);
      const streams = [];
      for (const item of playlist) {
        for (const source of item?.sources || []) {
          let url = source?.file || "";
          if (!url) continue;
          if (url.startsWith("/")) {
            url = `${getNetMirrorUrlBase(platform)}${url}`;
          }
          const quality =
            parseQualityFromText(source?.label || source?.file || "") ||
            qualityRank(source?.label || "");
          streams.push(
            buildStream(
              "NetMirror",
              `${platform} ${quality ? `${quality}p` : "Auto"}`,
              url,
              quality || null,
              { externalUrl: url }
            )
          );
        }
      }
      if (streams.length) return streams;
    }
  }
  return [];
}

async function encryptMoviesFlix(text) {
  const payload = await fetchJson(
    `${MULTI_DECRYPT_API}/enc-movies-flix?text=${encodeURIComponent(text)}`
  );
  return payload?.result;
}

async function parseHtmlPayload(html) {
  const payload = await fetchJson(`${MULTI_DECRYPT_API}/parse-html`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ text: html }),
  });
  return payload;
}

async function decryptMoviesFlix(text) {
  const payload = await fetchJson(`${MULTI_DECRYPT_API}/dec-movies-flix`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  return payload?.result?.url || null;
}

async function extractMegaUpStreams(embedUrl, providerName) {
  const mediaUrl = embedUrl.replace("/e/", "/media/").replace("/e2/", "/media/");
  const resultPayload = await fetchJson(mediaUrl, {
    headers: {
      Referer: "https://animekai.to/",
      Accept: "application/json,text/plain,*/*",
    },
  });
  const encoded = resultPayload?.result;
  if (!encoded) return [];

  const decoded = await fetchJson("https://enc-dec.app/api/dec-mega", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: encoded,
      agent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
    }),
  });

  const firstFile = decoded?.result?.sources?.[0]?.file;
  if (!firstFile) return [];

  const variants = await parseM3u8Variants(firstFile, { Referer: "https://megaup.live" });
  if (variants.length) {
    return variants.map((variant) =>
      buildStream(
        providerName,
        `${providerName} ${variant.quality ? `${variant.quality}p` : "Auto"}`,
        variant.url,
        variant.quality,
        {
          externalUrl: embedUrl,
        }
      )
    );
  }

  return [
    buildStream(providerName, `${providerName} Auto`, firstFile, null, {
      externalUrl: embedUrl,
    }),
  ];
}

function extractYflixServers(root) {
  const list = [];
  const defaultObj = root?.result?.default || {};
  for (const value of Object.values(defaultObj)) {
    if (value?.lid && value?.name) {
      list.push({
        lid: value.lid,
        name: value.name,
      });
    }
  }
  return list;
}

async function getYflixStreams(tmdbId, season, episode) {
  const findPayload = await fetchJson(
    `https://enc-dec.app/db/flix/find?tmdb_id=${encodeURIComponent(tmdbId)}`
  );
  const contentId = findPayload?.[0]?.info?.flix_id;
  if (!contentId) throw new Error("YFlix content id not found");

  const encId = await encryptMoviesFlix(contentId);
  const seasonText = season == null ? "1" : String(season);
  const episodeText = episode == null ? "1" : String(episode);
  const episodesResp = await fetchJson(
    `${YFLIX_API}/ajax/episodes/list?id=${contentId}&_=${encodeURIComponent(encId)}`
  );
  const episodesObj = await parseHtmlPayload(episodesResp?.result || "");
  const eid =
    episodesObj?.result?.[seasonText]?.[episodeText]?.eid ||
    episodesObj?.result?.[seasonText]?.[episodeText]?.id;
  if (!eid) throw new Error("YFlix episode id not found");

  const encTargetId = await encryptMoviesFlix(eid);
  const serversResp = await fetchJson(
    `${YFLIX_API}/ajax/links/list?eid=${encodeURIComponent(
      eid
    )}&_=${encodeURIComponent(encTargetId)}`
  );
  const serversObj = await parseHtmlPayload(serversResp?.result || "");
  const servers = extractYflixServers(serversObj);
  const allStreams = [];

  for (const server of servers) {
    const encLid = await encryptMoviesFlix(server.lid);
    const embedResp = await fetchJson(
      `${YFLIX_API}/ajax/links/view?id=${encodeURIComponent(
        server.lid
      )}&_=${encodeURIComponent(encLid)}`
    );
    const encryptedEmbed = embedResp?.result;
    if (!encryptedEmbed) continue;

    const embedUrl = await decryptMoviesFlix(encryptedEmbed);
    if (!embedUrl || !/mega(up|\.|up\.live)/i.test(embedUrl)) continue;

    const megaupStreams = await extractMegaUpStreams(
      embedUrl,
      `YFlix ${server.name}`
    );
    allStreams.push(...megaupStreams);
  }

  if (!allStreams.length) {
    throw new Error("YFlix streams not found");
  }

  return allStreams;
}

async function getAnimePaheStreams(animepaheUrl, episode) {
  if (!animepaheUrl) return [];

  const headers = {
    Cookie: "__ddg2_=1234567890",
  };

  const page = await fetchText(animepaheUrl, { headers });
  const ogMatch = page.match(
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i
  );
  const resolvedUrl = ogMatch ? ogMatch[1] : animepaheUrl;
  const id = resolvedUrl.split("/").filter(Boolean).pop();
  if (!id) return [];

  const releasePayload = await fetchJson(
    `${ANIMEPAHE_API}/api?m=release&id=${encodeURIComponent(
      id
    )}&sort=episode_asc&page=1`,
    { headers }
  );
  const releases = releasePayload?.data || [];
  const session =
    episode == null
      ? releases[0]?.session
      : releases[Math.max(0, episode - 1)]?.session;
  if (!session) return [];

  const playPage = await fetchText(`${ANIMEPAHE_API}/play/${id}/${session}`, {
    headers,
  });
  const regex =
    /<button[^>]*data-resolution=["']([^"']+)["'][^>]*data-src=["']([^"']+)["'][^>]*>/gi;
  const allStreams = [];

  for (const match of playPage.matchAll(regex)) {
    const qualityText = match[1];
    const sourceUrl = match[2];
    if (!/kwik\.cx/i.test(sourceUrl)) continue;

    try {
      const kwikPage = await fetchText(sourceUrl, { headers: { Referer: sourceUrl } });
      const scriptMatch = kwikPage.match(/source=\s*'(.*?m3u8.*?)'/);
      const playlist = scriptMatch?.[1];
      if (!playlist) continue;

      const variants = await parseM3u8Variants(playlist, { Referer: sourceUrl });
      if (variants.length) {
        for (const variant of variants) {
          allStreams.push(
            buildStream(
              "AnimePahe",
              `AnimePahe ${variant.quality ? `${variant.quality}p` : qualityText}`,
              variant.url,
              variant.quality,
              { externalUrl: sourceUrl }
            )
          );
        }
      } else {
        allStreams.push(
          buildStream(
            "AnimePahe",
            `AnimePahe ${qualityText}`,
            playlist,
            parseQualityFromText(qualityText),
            { externalUrl: sourceUrl }
          )
        );
      }
    } catch (_) {
      // Ignore broken buttons and keep the successful ones.
    }
  }

  return allStreams;
}

function decryptHex(input) {
  const hexString = input.startsWith("-") ? input.slice(input.lastIndexOf("-") + 1) : input;
  const bytes = [];
  for (let i = 0; i < hexString.length; i += 2) {
    const byte = Number.parseInt(hexString.slice(i, i + 2), 16);
    bytes.push(byte ^ 56);
  }
  return String.fromCharCode(...bytes);
}

function fixAllAnimePath(sourceUrl) {
  if (sourceUrl.includes(".json?")) return `https://allanime.day${sourceUrl}`;
  const uri = new URL(sourceUrl, "https://allanime.day");
  return `https://allanime.day${uri.pathname}.json?${uri.searchParams.toString()}`;
}

async function getAllAnimeStreams(title, year, episode, mediaType) {
  const type = episode == null || mediaType === "movie" ? "Movie" : "TV";
  const queryhash =
    "a24c500a1b765c68ae1d8dd85174931f661c71369c89b92b88b75a725afc471c";
  const ephash =
    "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec";

  const searchVariables = {
    search: {
      types: [type],
      query: title,
    },
    limit: 26,
    page: 1,
    translationType: "sub",
    countryOrigin: "ALL",
  };

  const searchUrl = `${ALLANIME_API}?variables=${encodeURIComponent(
    JSON.stringify(searchVariables)
  )}&extensions=${encodeURIComponent(
    JSON.stringify({
      persistedQuery: {
        version: 1,
        sha256Hash: queryhash,
      },
    })
  )}`;

  const searchPayload = await fetchJson(searchUrl, {
    headers: {
      Referer: "https://allmanga.to",
    },
  });

  const showId = searchPayload?.data?.shows?.edges?.[0]?._id;
  if (!showId) return [];

  const allStreams = [];

  for (const translationType of ["sub"]) {
    const epVariables = {
      showId,
      translationType,
      episodeString: String(episode || 1),
    };
    const epUrl = `${ALLANIME_API}?variables=${encodeURIComponent(
      JSON.stringify(epVariables)
    )}&extensions=${encodeURIComponent(
      JSON.stringify({
        persistedQuery: {
          version: 1,
          sha256Hash: ephash,
        },
      })
    )}`;

    const epPayload = await fetchJson(epUrl, {
      headers: {
        Referer: "https://allmanga.to",
      },
    });

    const sourceUrls = epPayload?.data?.episode?.sourceUrls || [];

    for (const source of sourceUrls) {
      const sourceUrl = source?.sourceUrl;
      if (!sourceUrl) continue;

      if (/^https?:/i.test(sourceUrl)) {
        if (sourceUrl.includes(".m3u8")) {
          allStreams.push(
            buildStream(
              "AllAnime",
              translationType.toUpperCase(),
              sourceUrl,
              null,
              { externalUrl: sourceUrl }
            )
          );
        }
        continue;
      }

      const decoded = sourceUrl.startsWith("--") ? decryptHex(sourceUrl) : sourceUrl;
      const fixedLink = fixAllAnimePath(decoded);

      try {
        const payload = await fetchJson(fixedLink, {
          headers: {
            "app-version": "android_c-247",
            platformstr: "android_c",
            Referer: "https://allmanga.to",
          },
        });

        for (const link of payload?.links || []) {
          const directLink = link?.link;
          if (!directLink) continue;
          const isHls = link?.hls === true || directLink.includes(".m3u8");
          if (!isHls) continue;

          const variants = await parseM3u8Variants(directLink, {
            Referer: link?.headers?.Referer || "https://allanime.day",
          });

          if (variants.length) {
            for (const variant of variants) {
              allStreams.push(
                buildStream(
                  "AllAnime",
                  [variant.quality ? `${variant.quality}p` : "Auto", translationType.toUpperCase()]
                    .filter(Boolean)
                    .join(" "),
                  variant.url,
                  variant.quality,
                  { externalUrl: directLink }
                )
              );
            }
          } else {
            allStreams.push(
              buildStream(
                "AllAnime",
                ["Auto", translationType.toUpperCase()].join(" "),
                directLink,
                null,
                { externalUrl: directLink }
              )
            );
          }
        }
      } catch (_) {
        // Ignore broken source urls and keep going.
      }
    }
  }

  return allStreams;
}

async function getKaidoStreams(hianimeurl, animeTitle, episode) {
  const urls = await getDynamicUrls();
  const kaidoBase = urls?.kaido;
  if (!kaidoBase && !hianimeurl) return [];

  const base = kaidoBase || new URL(hianimeurl).origin;
  const headers = {
    "X-Requested-With": "XMLHttpRequest",
  };

  let id = null;
  if (hianimeurl) {
    id = hianimeurl.split("/").filter(Boolean).pop()?.split("-").pop() || null;
  }

  if (!id && animeTitle) {
    const searchUrl = `${base}/search?keyword=${encodeURIComponent(animeTitle)}&page=1`;
    const searchHtml = await fetchText(searchUrl);
    const match = searchHtml.match(/href="[^"]*?-(\d+)"/);
    id = match?.[1] || null;
  }

  if (!id) return [];

  const episodesPayload = await fetchJson(`${base}/ajax/episode/list/${id}`, { headers });
  const episodeHtml = episodesPayload?.html || "";
  const episodeRegex = /data-number="(\d+)"[^>]*data-id="([^"]+)"/g;
  let episodeId = null;
  for (const match of episodeHtml.matchAll(episodeRegex)) {
    if (Number(match[1]) === Number(episode || 1)) {
      episodeId = match[2];
      break;
    }
  }
  if (!episodeId) return [];

  const serversPayload = await fetchJson(
    `${base}/ajax/episode/servers?episodeId=${encodeURIComponent(episodeId)}`,
    { headers }
  );
  const serversHtml = serversPayload?.html || "";
  const serverRegex =
    /class="item server-item"[^>]*data-id="([^"]+)"[^>]*data-type="([^"]+)"[^>]*>(.*?)</g;
  const allStreams = [];

  for (const match of serversHtml.matchAll(serverRegex)) {
    const serverId = match[1];
    const type = match[2];

    try {
      const sourcePayload = await fetchJson(
        `${base}/ajax/episode/sources?id=${encodeURIComponent(serverId)}`,
        { headers }
      );
      const embedUrl = sourcePayload?.link;
      if (!embedUrl) continue;

      if (/mega(up|\.live|\.cx)/i.test(embedUrl)) {
        const streams = await extractMegaUpStreams(embedUrl, `Kaido ${type.toUpperCase()}`);
        allStreams.push(...streams);
      } else if (embedUrl.includes(".m3u8")) {
        allStreams.push(
          buildStream(
            "Kaido",
            `Kaido ${type.toUpperCase()}`,
            embedUrl,
            null,
            { externalUrl: embedUrl }
          )
        );
      }
    } catch (_) {
      // Ignore broken Kaido servers and keep going.
    }
  }

  return allStreams;
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, "").trim();
}

async function gatherStreams({ imdbId, mediaType, season, episode, publicBaseUrl }) {
  const tmdb = await resolveMediaContext(imdbId, mediaType);
  const cinemetaMeta =
    !tmdb.isKitsu && mediaType === "series"
      ? await fetchCinemetaMeta(imdbId, mediaType)
      : null;
  const shouldResolveAnimeIds = looksPotentiallyAnime(tmdb, cinemetaMeta);
  const animeIds = shouldResolveAnimeIds
    ? await resolveAnimeIds(tmdb)
    : { anilistId: null, malId: null };
  const isAnime = detectAnimeFromContext(tmdb, animeIds, cinemetaMeta);
  const malSync = isAnime
    ? await fetchMalSyncMeta(animeIds.malId)
    : {
        title: null,
        animepaheUrl: null,
        animepaheTitle: null,
        hianimeurl: null,
      };
  const mappedAnimeEpisode =
    isAnime && mediaType === "series"
      ? mapCinemetaEpisodeToAbsolute(cinemetaMeta, season, episode) || episode
      : episode;

  const canUseImdbSources = String(imdbId || "").startsWith("tt");
  const canUseTmdbSources = !!tmdb.tmdbId;

  const jobs = [
    {
      name: "NoTorrent",
      run: () =>
        canUseImdbSources ? getNoTorrentStreams(imdbId, mediaType, season, episode, publicBaseUrl) : [],
    },
    {
      name: "Videasy",
      run: () =>
        canUseTmdbSources
          ? getVideasyStreams(
              tmdb.originalTitle || tmdb.title,
              tmdb.tmdbId,
              imdbId,
              tmdb.year,
              mediaType,
              season,
              episode
            )
          : [],
    },
    {
      name: "Vixsrc",
      run: () =>
        canUseTmdbSources
          ? getVixsrcStreams(tmdb.tmdbId, mediaType, season, episode, publicBaseUrl)
          : [],
    },
    {
      name: "AnimeCloud",
      run: () =>
        canUseTmdbSources && isAnime
          ? getAnimeCloudStreams(tmdb.tmdbId, mediaType, season, episode, publicBaseUrl)
          : [],
    },
    {
      name: "AllAnime",
      run: () =>
        isAnime && animeIds.anilistId
          ? getAllAnimeStreams(
              malSync.title || tmdb.originalTitle || tmdb.title,
              tmdb.year,
              mediaType === "movie" ? null : mappedAnimeEpisode,
              mediaType
            )
          : [],
    },
  ];

  const settled = await Promise.allSettled(
    jobs.map(async (job) => ({
      name: job.name,
      streams: await withTimeout(job.run(), 12000, job.name),
    }))
  );

  const successful = settled
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value.streams);

  const errors = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason?.message)
    .filter(Boolean);

  const streams = orderStreams(dedupeStreams(successful), isAnime).map((stream) => ({
    name: stream.name,
    title: normalizeStreamTitle(stream),
    url: stream.url,
    externalUrl: stream.externalUrl,
    behaviorHints: stream.behaviorHints,
  }));

  return {
    meta: {
      imdbId,
      mediaType,
      tmdbId: tmdb.tmdbId,
      kitsuId: tmdb.kitsuId || null,
      title: tmdb.title,
      year: tmdb.year,
      isAnime,
      cinemetaId: cinemetaMeta?.id || null,
      mappedAnimeEpisode: mappedAnimeEpisode || null,
      malId: animeIds.malId,
      anilistId: animeIds.anilistId,
      hianimeurl: malSync.hianimeurl,
      animepaheUrl: malSync.animepaheUrl,
    },
    streams,
    errors,
  };
}

async function handleMovieStreamRequest(req, res, movieId) {
  try {
    const payload = await gatherStreams({
      imdbId: movieId,
      mediaType: "movie",
      publicBaseUrl: getPublicBaseUrl(req),
    });
    sendJson(res, 200, {
      streams: payload.streams,
      error: payload.streams.length ? undefined : payload.errors[0],
    });
  } catch (error) {
    sendJson(res, 200, {
      streams: [],
      error: error.message,
    });
  }
}

async function handleSeriesStreamRequest(req, res, seriesId, season, episode) {
  try {
    const payload = await gatherStreams({
      imdbId: seriesId,
      mediaType: "series",
      season,
      episode,
      publicBaseUrl: getPublicBaseUrl(req),
    });
    sendJson(res, 200, {
      streams: payload.streams,
      error: payload.streams.length ? undefined : payload.errors[0],
    });
  } catch (error) {
    sendJson(res, 200, {
      streams: [],
      error: error.message,
    });
  }
}

async function handleAnimeStreamRequest(req, res, animeId, season, episode) {
  await handleSeriesStreamRequest(req, res, animeId, season, episode);
}

async function handleMovieDebugRequest(req, res, movieId) {
  try {
    const payload = await gatherStreams({
      imdbId: movieId,
      mediaType: "movie",
      publicBaseUrl: getPublicBaseUrl(req),
    });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
    });
  }
}

async function handleSeriesDebugRequest(req, res, seriesId, season, episode) {
  try {
    const payload = await gatherStreams({
      imdbId: seriesId,
      mediaType: "series",
      season,
      episode,
      publicBaseUrl: getPublicBaseUrl(req),
    });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message,
    });
  }
}

async function handleAnimeDebugRequest(req, res, animeId, season, episode) {
  await handleSeriesDebugRequest(req, res, animeId, season, episode);
}

function handleMoxHlsRequest(res, requestUrl) {
  try {
    const videoUrl = decodeUrlParam(requestUrl.searchParams.get("video"));
    const rawAudios = decodeUrlParam(requestUrl.searchParams.get("audios") || "");
    const quality = Number(requestUrl.searchParams.get("quality") || 0);
    const audioTracks = rawAudios ? JSON.parse(rawAudios) : [];
    if (!videoUrl || !quality) {
      res.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Invalid MOX HLS request");
      return;
    }
    const playlist = buildSingleVariantMasterPlaylist({
      videoUrl,
      audioTracks,
      quality,
    });

    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
    });
    res.end(playlist);
  } catch (error) {
    res.writeHead(500, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`MOX HLS error: ${stripHtml(error.message)}`);
  }
}

async function handleAnimeCloudProxyRequest(req, res, requestUrl) {
  try {
    const encodedUrl = requestUrl.searchParams.get("url");
    const targetUrl = encodedUrl ? decodeUrlParam(encodedUrl) : "";
    if (!targetUrl) {
      res.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Missing AnimeCloud target URL");
      return;
    }

    const upstreamHeaders = {
      "user-agent": USER_AGENT,
      accept: req.headers.accept || "*/*",
    };
    if (req.headers.range) {
      upstreamHeaders.range = req.headers.range;
    }

    // Some HLS hosts reject HEAD on playlists even though players probe with it.
    // We always fetch upstream with GET and answer HEAD locally.
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    };

    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) headers["Content-Length"] = contentLength;
    if (contentRange) headers["Content-Range"] = contentRange;

    res.writeHead(upstream.status, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.writeHead(502, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`AnimeCloud proxy error: ${stripHtml(error.message)}`);
  }
}

async function handleVidLinkProxyRequest(req, res, requestUrl) {
  try {
    const encodedUrl = requestUrl.searchParams.get("url");
    const targetUrl = encodedUrl ? decodeUrlParam(encodedUrl) : "";
    if (!targetUrl) {
      res.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Missing VidLink target URL");
      return;
    }

    const extraHeaders = extractVidLinkRequestHeaders(targetUrl);
    const upstreamHeaders = {
      "user-agent": USER_AGENT,
      accept: req.headers.accept || "*/*",
      ...Object.fromEntries(
        Object.entries(extraHeaders).map(([key, value]) => [String(key).toLowerCase(), value])
      ),
    };
    if (req.headers.range) {
      upstreamHeaders.range = req.headers.range;
    }

    // Xpass playlist hosts often reject HEAD even though players probe with it.
    // Fetch with GET upstream and satisfy HEAD locally.
    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      const body = await upstream.text().catch(() => "");
      res.end(body);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const isPlaylist =
      /\.m3u8($|\?)/i.test(targetUrl) ||
      /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

    if (isPlaylist && req.method !== "HEAD") {
      const playlist = await upstream.text();
      const rewritten = rewriteM3u8ForProxy(playlist, targetUrl, getPublicBaseUrl(req));
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      });
      res.end(rewritten);
      return;
    }

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": contentType || "application/octet-stream",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    };

    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) headers["Content-Length"] = contentLength;
    if (contentRange) headers["Content-Range"] = contentRange;

    res.writeHead(upstream.status, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.writeHead(502, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`VidLink proxy error: ${stripHtml(error.message)}`);
  }
}

async function handleVixsrcProxyRequest(req, res, requestUrl) {
  try {
    const encodedUrl = requestUrl.searchParams.get("url");
    const targetUrl = encodedUrl ? decodeUrlParam(encodedUrl) : "";
    if (!targetUrl) {
      res.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Missing Vixsrc target URL");
      return;
    }

    if (req.method === "HEAD") {
      const contentType = /\.m3u8($|\?)/i.test(targetUrl)
        ? "application/vnd.apple.mpegurl; charset=utf-8"
        : "application/octet-stream";
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      res.end();
      return;
    }

    const upstreamHeaders = {
      "user-agent": USER_AGENT,
      accept: req.headers.accept || "*/*",
      referer: `${VIXSRC_API}/`,
      origin: VIXSRC_API,
    };
    if (req.headers.range) {
      upstreamHeaders.range = req.headers.range;
    }

    const upstream = await fetch(targetUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      const body = await upstream.text().catch(() => "");
      res.end(body);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const isPlaylist =
      /\.m3u8($|\?)/i.test(targetUrl) ||
      /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

    if (isPlaylist) {
      const playlist = await upstream.text();
      const rewritten = rewriteM3u8ForProxyWith(
        playlist,
        targetUrl,
        getPublicBaseUrl(req),
        buildVixsrcProxyUrl
      );
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      });
      res.end(rewritten);
      return;
    }

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": contentType || "application/octet-stream",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    };

    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) headers["Content-Length"] = contentLength;
    if (contentRange) headers["Content-Range"] = contentRange;

    res.writeHead(upstream.status, headers);

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.writeHead(502, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`Vixsrc proxy error: ${stripHtml(error.message)}`);
  }
}

async function handleXpassProxyRequest(req, res, requestUrl) {
  try {
    const encodedUrl = requestUrl.searchParams.get("url");
    const targetUrl = encodedUrl ? decodeUrlParam(encodedUrl) : "";
    if (!targetUrl) {
      res.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Missing Xpass target URL");
      return;
    }

    if (req.method === "HEAD") {
      const contentType = /\.m3u8($|\?)/i.test(targetUrl)
        ? "application/vnd.apple.mpegurl; charset=utf-8"
        : "application/octet-stream";
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      res.end();
      return;
    }

    const upstreamHeaders = {
      "user-agent": USER_AGENT,
      accept: req.headers.accept || "*/*",
      referer: `${XPASS_API}/`,
      origin: XPASS_API,
    };
    if (req.headers.range) {
      upstreamHeaders.range = req.headers.range;
    }

    const upstream = await fetch(targetUrl, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: upstreamHeaders,
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": upstream.headers.get("content-type") || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      const body = await upstream.text().catch(() => "");
      res.end(body);
      return;
    }

    const contentType = upstream.headers.get("content-type") || "";
    const isPlaylist =
      /\.m3u8($|\?)/i.test(targetUrl) ||
      /mpegurl|vnd\.apple\.mpegurl/i.test(contentType);

    if (isPlaylist && req.method !== "HEAD") {
      const playlist = await upstream.text();
      const rewritten = rewriteM3u8ForProxyWith(playlist, targetUrl, getPublicBaseUrl(req), buildXpassProxyUrl);
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      });
      res.end(rewritten);
      return;
    }

    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
      "Content-Type": contentType || "application/octet-stream",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    };

    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) headers["Content-Length"] = contentLength;
    if (contentRange) headers["Content-Range"] = contentRange;

    res.writeHead(upstream.status, headers);

    if (!upstream.body) {
      res.end();
      return;
    }

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.writeHead(502, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`Xpass proxy error: ${stripHtml(error.message)}`);
  }
}

async function handleXpassPlayRequest(req, res, requestUrl) {
  try {
    const tmdbId = requestUrl.searchParams.get("tmdbId");
    const mediaType = requestUrl.searchParams.get("mediaType");
    const season = Number(requestUrl.searchParams.get("season") || 1);
    const episode = Number(requestUrl.searchParams.get("episode") || 1);
    const provider = String(requestUrl.searchParams.get("provider") || "");
    const quality = Number(requestUrl.searchParams.get("quality") || 0);

    if (!tmdbId || !mediaType || !provider) {
      res.writeHead(400, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Invalid Xpass play request");
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Accept-Ranges": "bytes",
      });
      res.end();
      return;
    }

    const freshStreams = await getXpassStreams(
      tmdbId,
      mediaType,
      season,
      episode,
      null
    );
    const match =
      freshStreams.find((stream) => stream.name === provider && Number(stream.quality || 0) === quality) ||
      freshStreams.find((stream) => stream.name === provider) ||
      null;

    if (!match?.url) {
      res.writeHead(404, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Fresh Xpass stream not found");
      return;
    }

    const proxied = new URL(buildXpassProxyUrl(match.url, getPublicBaseUrl(req)));
    await handleXpassProxyRequest(req, res, proxied);
  } catch (error) {
    res.writeHead(502, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/plain; charset=utf-8",
    });
    res.end(`Xpass play error: ${stripHtml(error.message)}`);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 404, { error: "Missing URL" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      });
      res.end();
      return;
    }

    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/logo.svg") {
      res.writeHead(200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      res.end(getLogoSvg());
      return;
    }

    if (requestUrl.pathname === "/manifest.json") {
      const baseUrl = getPublicBaseUrl(req);
      sendJson(res, 200, {
        ...manifest,
        logo: `${baseUrl}/logo.svg`,
      });
      return;
    }

    if (requestUrl.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        name: manifest.name,
        version: manifest.version,
      });
      return;
    }

    if (requestUrl.pathname === "/hls/mox.m3u8") {
      handleMoxHlsRequest(res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/proxy/animecloud.mp4") {
      await handleAnimeCloudProxyRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/proxy/vidlink.m3u8") {
      await handleVidLinkProxyRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/proxy/vixsrc.m3u8") {
      await handleVixsrcProxyRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/proxy/xpass.m3u8") {
      await handleXpassProxyRequest(req, res, requestUrl);
      return;
    }

    if (requestUrl.pathname === "/play/xpass.m3u8") {
      await handleXpassPlayRequest(req, res, requestUrl);
      return;
    }

    const streamMovieMatch = requestUrl.pathname.match(/^\/stream\/movie\/([^/]+)\.json$/);
    if (streamMovieMatch) {
      await handleMovieStreamRequest(req, res, decodeURIComponent(streamMovieMatch[1]));
      return;
    }

    const streamSeriesMatch = requestUrl.pathname.match(
      /^\/stream\/series\/([^/]+)\.json$/
    );
    if (streamSeriesMatch) {
      const parsed = parseSeriesResourceId(streamSeriesMatch[1]);
      if (!parsed) {
        sendJson(res, 400, { error: "Invalid series resource id" });
        return;
      }
      await handleSeriesStreamRequest(
        req,
        res,
        parsed.imdbId,
        parsed.season,
        parsed.episode
      );
      return;
    }

    const streamAnimeMatch = requestUrl.pathname.match(
      /^\/stream\/anime\/([^/]+)\.json$/
    );
    if (streamAnimeMatch) {
      const parsed = parseSeriesResourceId(streamAnimeMatch[1]);
      if (!parsed) {
        sendJson(res, 400, { error: "Invalid anime resource id" });
        return;
      }
      await handleAnimeStreamRequest(
        req,
        res,
        parsed.imdbId,
        parsed.season,
        parsed.episode
      );
      return;
    }

    const debugMovieMatch = requestUrl.pathname.match(/^\/debug\/movie\/([^/]+)\.json$/);
    if (debugMovieMatch) {
      await handleMovieDebugRequest(req, res, decodeURIComponent(debugMovieMatch[1]));
      return;
    }

    const debugSeriesMatch = requestUrl.pathname.match(/^\/debug\/series\/([^/]+)\.json$/);
    if (debugSeriesMatch) {
      const parsed = parseSeriesResourceId(debugSeriesMatch[1]);
      if (!parsed) {
        sendJson(res, 400, { error: "Invalid series resource id" });
        return;
      }
      await handleSeriesDebugRequest(
        req,
        res,
        parsed.imdbId,
        parsed.season,
        parsed.episode
      );
      return;
    }

    const debugAnimeMatch = requestUrl.pathname.match(/^\/debug\/anime\/([^/]+)\.json$/);
    if (debugAnimeMatch) {
      const parsed = parseSeriesResourceId(debugAnimeMatch[1]);
      if (!parsed) {
        sendJson(res, 400, { error: "Invalid anime resource id" });
        return;
      }
      await handleAnimeDebugRequest(
        req,
        res,
        parsed.imdbId,
        parsed.season,
        parsed.episode
      );
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 500, {
      error: stripHtml(error.message),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MOXViD addon listening on http://${HOST}:${PORT}/manifest.json`);
});
