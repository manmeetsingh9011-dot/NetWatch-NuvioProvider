/**
 * Chaupal Nuvio Provider
 *
 * Chaupal is an Indian OTT platform for Punjabi, Haryanvi & Bhojpuri content.
 * Requires a paid Chaupal account.
 *
 * Auth flow (OTP-based, no password):
 *   1. POST /service/api/auth/get/otp  {context:"signin", email} → OTP sent to email
 *   2. POST /service/api/auth/verify/otp {context:"signin", email, otp} → session-id
 *
 * Stream flow:
 *   3. GET /service/api/v1/page/content?path=search/<title>  → find slug
 *   4. GET /service/api/v1/page/stream?path=<slug>&device_supported_features=HD,SD,adaptivedvr
 *      → MPD URL + Widevine license URL + DRM token
 *
 * API base : https://chaupalapi.revlet.net
 * Required headers: tenant-code, box-id, session-id
 */

var API_BASE    = "https://chaupalapi.revlet.net";
var TENANT_CODE = "chaupal";
// Stable device UUID — does not need to be real hardware, just consistent per install
var BOX_ID      = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
var UA          = "Mozilla/5.0 (Linux; Android 10; Nuvio) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36";

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64decode(str) {
    if (typeof atob === "function") {
        try { return atob(str); } catch(e) {}
    }
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    var output = "";
    str = String(str || "").replace(/=+$/, "");
    for (var bc = 0, bs, buffer, idx = 0; buffer = str.charAt(idx++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
        buffer = chars.indexOf(buffer);
    }
    return output;
}

function getTmdbKey() {
    try {
        if (typeof globalThis !== "undefined") {
            if (globalThis.TMDB_API_KEY) return globalThis.TMDB_API_KEY;
            if (globalThis.TMDB_KEY) return globalThis.TMDB_KEY;
        }
        if (typeof window !== "undefined") {
            if (window.TMDB_API_KEY) return window.TMDB_API_KEY;
            if (window.TMDB_KEY) return window.TMDB_KEY;
        }
        var s = null;
        if (typeof globalThis !== "undefined") s = globalThis.SCRAPER_SETTINGS || globalThis.SETTINGS;
        if (!s && typeof window !== "undefined") s = window.SCRAPER_SETTINGS || window.SETTINGS;
        if (s && (s.tmdbKey || s.tmdb_key || s.apiKey || s.api_key)) {
            return s.tmdbKey || s.tmdb_key || s.apiKey || s.api_key;
        }
    } catch(e) {}
    var pool = [
        "ZjE1YWFmOWNmMDVmMTRlY2UzMDliNjhjYWQwMWNlMjU=",
        "NDM5YzQ3OGE3NzFmMzVjMDUwMjJmOWZlYWJjY2EwMWM="
    ];
    return b64decode(pool[Math.floor(Math.random() * pool.length)]);
}

function getInvertedSortTag(score, maxScore) {
    var inv = maxScore - score;
    var hex = ("00000" + inv.toString(16)).slice(-5);
    return hex.split("").map(function(c) {
        return String.fromCharCode(0x2000 + parseInt(c, 16));
    }).join("") + "\u200B";
}

function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pad(n) { return n < 10 ? "0" + n : "" + n; }

// ── Settings ──────────────────────────────────────────────────────────────────

function onSettings() {
    return [
        {
            type: "text",
            key: "email",
            name: "chaupal_email",
            label: "Chaupal Email",
            hint: "Your Chaupal account email address",
            default: ""
        },
        {
            type: "text",
            key: "otp",
            name: "chaupal_otp",
            label: "OTP Code",
            hint: "Enter OTP sent to your email (request it first via 'Send OTP' button)",
            default: ""
        },
        {
            type: "select",
            key: "quality",
            name: "stream_quality",
            label: "Stream Quality",
            options: [
                { label: "HD (1080p)", value: "HD" },
                { label: "SD (480p)",  value: "SD" }
            ],
            default: "HD"
        }
    ];
}

function resolveSettings(custom) {
    var s = custom;
    if (!s) {
        try {
            if (typeof globalThis !== "undefined" && globalThis.SCRAPER_SETTINGS) s = globalThis.SCRAPER_SETTINGS;
            if (!s && typeof window !== "undefined" && window.SCRAPER_SETTINGS) s = window.SCRAPER_SETTINGS;
        } catch(e) {}
    }
    return {
        email:   (s && (s.chaupal_email  || s.email))   || "",
        otp:     (s && (s.chaupal_otp    || s.otp))     || "",
        quality: (s && (s.stream_quality || s.quality)) || "HD"
    };
}

// ── Entry point ───────────────────────────────────────────────────────────────

function getStreams(tmdbId, mediaType, season, episode) {
    var rawId = tmdbId;
    if (typeof tmdbId === "object" && tmdbId !== null) {
        rawId = tmdbId.tmdbId || tmdbId.id || tmdbId.imdbId || tmdbId.imdb_id || tmdbId;
    }
    var cleanId = String(rawId || "").replace(/^(?:tmdb|imdb):/i, "").trim();
    var type = (mediaType === "tv" || mediaType === "series") ? "tv" : "movie";
    var ep   = parseInt(episode, 10) || 1;
    var sea  = parseInt(season, 10)  || 1;

    var settings = resolveSettings();

    if (!settings.email) {
        console.warn("[chaupal] No email set — configure email in provider settings");
        return Promise.resolve([]);
    }

    if (!settings.otp) {
        // No OTP yet — trigger OTP send and return empty (user will re-run after entering OTP)
        console.log("[chaupal] No OTP set — requesting OTP for: " + settings.email);
        return sendOtp(settings.email).then(function(ok) {
            if (ok) console.log("[chaupal] OTP sent to " + settings.email + " — enter it in provider settings and try again");
            return [];
        });
    }

    console.log("[chaupal] " + type + " id=" + cleanId + (type === "tv" ? " S" + pad(sea) + "E" + pad(ep) : ""));

    // Get TMDB title first
    var tmdbKey = getTmdbKey();
    var isImdb  = cleanId.indexOf("tt") === 0;
    var tmdbEndpoint = type === "tv" ? "tv" : "movie";
    var tmdbPath = isImdb
        ? "/3/find/" + cleanId + "?api_key=" + tmdbKey + "&external_source=imdb_id"
        : "/3/" + tmdbEndpoint + "/" + cleanId + "?api_key=" + tmdbKey;

    var tmdbHosts = ["https://api.themoviedb.org", "https://api.tmdb.org"];

    function tryTmdb(idx) {
        if (idx >= tmdbHosts.length) return Promise.resolve([]);
        return fetchJson(tmdbHosts[idx] + tmdbPath, {})
        .then(function(data) {
            var item = data;
            if (isImdb) {
                var results = type === "tv" ? (data.tv_results || []) : (data.movie_results || []);
                if (!results.length) results = (data.movie_results || []).concat(data.tv_results || []);
                item = results[0] || {};
            }
            var title   = item.title || item.name || "";
            var rawDate = item.release_date || item.first_air_date || "";
            var year    = rawDate ? rawDate.substring(0, 4) : "";
            if (!title) { console.log("[chaupal] TMDB no title"); return []; }
            console.log("[chaupal] title=" + title + " year=" + year);
            return loginAndFetch(title, year, type, sea, ep, settings);
        })
        .catch(function(e) {
            console.log("[chaupal] TMDB " + tmdbHosts[idx] + " failed: " + e.message);
            return tryTmdb(idx + 1);
        });
    }

    return tryTmdb(0);
}

// ── OTP Send ──────────────────────────────────────────────────────────────────

function sendOtp(email) {
    var url  = API_BASE + "/service/api/auth/get/otp";
    var body = JSON.stringify({ context: "signin", email: email });
    return fetchJson(url, {
        method: "POST",
        body: body,
        headers: buildHeaders(null, true)
    })
    .then(function(data) {
        if (data && data.status) {
            console.log("[chaupal] OTP sent — referenceId=" + (data.response && data.response.referenceId));
            return true;
        }
        console.error("[chaupal] OTP send failed: " + JSON.stringify(data && data.error));
        return false;
    })
    .catch(function(e) {
        console.error("[chaupal] OTP send error: " + e.message);
        return false;
    });
}

// ── Login with OTP ────────────────────────────────────────────────────────────

function loginWithOtp(email, otp) {
    var url  = API_BASE + "/service/api/auth/verify/otp";
    var body = JSON.stringify({
        context: "signin",
        email:   email,
        otp:     parseInt(otp, 10)
    });
    return fetchJson(url, {
        method:  "POST",
        body:    body,
        headers: buildHeaders(null, true)
    })
    .then(function(data) {
        if (!data || !data.status) {
            var msg = (data && data.error && data.error.message) || "unknown";
            console.error("[chaupal] OTP verify failed: " + msg);
            return null;
        }
        var resp = data.response || {};
        // session-id is in sessionDetails.sessionId
        var sd  = resp.sessionDetails || {};
        var sid = sd.sessionId || sd.session_id || resp.session_id || resp.sessionId || null;
        // fallback: scan for any UUID in response
        if (!sid) {
            var str = JSON.stringify(resp);
            var m = str.match(/"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
            if (m) sid = m[1];
        }
        if (!sid) {
            console.error("[chaupal] No session-id in response: " + JSON.stringify(resp).substring(0, 200));
            return null;
        }
        // Also grab the box-id from response if server assigned one
        var boxId = sd.boxId || sd.box_id || BOX_ID;
        console.log("[chaupal] Login OK session=" + sid.substring(0, 8) + "...");
        return { sessionId: sid, boxId: boxId };
    })
    .catch(function(e) {
        console.error("[chaupal] OTP verify error: " + e.message);
        return null;
    });
}

// ── Main flow ─────────────────────────────────────────────────────────────────

function loginAndFetch(title, year, type, season, episode, settings) {
    return loginWithOtp(settings.email, settings.otp)
    .then(function(auth) {
        if (!auth) {
            console.error("[chaupal] Login failed — check OTP in settings");
            return [];
        }
        return searchAndStream(title, year, type, season, episode, auth.sessionId, auth.boxId, settings);
    });
}

// ── Search ────────────────────────────────────────────────────────────────────

function searchAndStream(title, year, type, season, episode, sessionId, boxId, settings) {
    var query = encodeURIComponent(title);
    var url   = API_BASE + "/service/api/v1/page/content?path=search%2F" + query + "&count=20";

    return fetchJson(url, { headers: buildHeaders(sessionId, false, boxId) })
    .then(function(data) {
        if (!data || !data.status) {
            console.log("[chaupal] Search failed");
            return [];
        }

        var items = [];
        var resp  = data.response || {};
        var rails = resp.rails || resp.items || resp.containers || resp.sections || [];

        if (Array.isArray(rails)) {
            rails.forEach(function(rail) {
                var list = rail.items || rail.contents || rail.data || [];
                if (Array.isArray(list)) list.forEach(function(i) { items.push(i); });
            });
        }
        if (!items.length && Array.isArray(resp)) items = resp;

        if (!items.length) {
            // Fallback: try direct slug from title
            console.log("[chaupal] Search empty — trying direct slug");
            var slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            var path = (type === "movie") ? "movie/play/" + slug : "show/play/" + slug + "/season/" + season + "/episode/" + episode;
            return fetchStreamByPath(path, sessionId, boxId, settings, { title: title, slug: slug }, type, season, episode);
        }

        var best = pickBestMatch(items, title, year, type);
        if (!best) {
            console.log("[chaupal] No match in search results");
            return [];
        }
        console.log("[chaupal] Matched: " + best.title + " slug=" + best.slug);

        var streamPath = buildStreamPath(best.slug, type, season, episode);
        return fetchStreamByPath(streamPath, sessionId, boxId, settings, best, type, season, episode);
    })
    .catch(function(e) {
        console.error("[chaupal] Search error: " + e.message);
        return [];
    });
}

function pickBestMatch(items, title, year, type) {
    var normTitle = norm(title);
    var best = null, bestScore = -1;

    items.forEach(function(item) {
        var iTitle = item.title || item.name || item.content_title || "";
        var iSlug  = item.slug  || item.path || item.content_path || item.permalink || "";
        var iType  = item.content_type || item.type || "";
        var iYear  = item.release_year || item.year || (item.release_date || "").substring(0, 4) || "";

        if (!iSlug) return;
        var normI = norm(iTitle);
        var score = 0;

        if (normI === normTitle) score += 100;
        else if (normI.indexOf(normTitle) !== -1 || normTitle.indexOf(normI) !== -1) score += 50;
        else return;

        if (year && iYear && String(iYear) === String(year)) score += 20;
        if (type === "movie" && (iType === "movie" || iSlug.indexOf("movie") !== -1)) score += 10;
        if (type === "tv"    && (iType === "series" || iType === "tv" || iSlug.indexOf("show") !== -1)) score += 10;

        if (score > bestScore) { bestScore = score; best = { title: iTitle, slug: iSlug, raw: item }; }
    });

    return best;
}

function buildStreamPath(slug, type, season, episode) {
    slug = slug.replace(/^https?:\/\/[^/]+/, "").replace(/^\//, "");

    if (type === "movie") {
        if (slug.indexOf("movie/play/") === 0) return slug;
        if (slug.indexOf("movie/") === 0) return "movie/play/" + slug.replace("movie/", "");
        return "movie/play/" + slug;
    } else {
        var base = slug;
        if (base.indexOf("show/play/") !== 0 && base.indexOf("show/") === 0) {
            base = "show/play/" + base.replace("show/", "");
        } else if (base.indexOf("show/") !== 0) {
            base = "show/play/" + base;
        }
        return base + "/season/" + season + "/episode/" + episode;
    }
}

// ── Stream fetch ──────────────────────────────────────────────────────────────

function fetchStreamByPath(streamPath, sessionId, boxId, settings, match, type, season, episode) {
    var url = API_BASE + "/service/api/v1/page/stream?path=" + encodeURIComponent(streamPath) + "&device_supported_features=HD%2CSD%2Cadaptivedvr";
    console.log("[chaupal] stream API: " + url);

    return fetchJson(url, { headers: buildHeaders(sessionId, false, boxId) })
    .then(function(data) {
        if (!data || !data.status) {
            var code = (data && data.error && data.error.code) || 0;
            var msg  = (data && data.error && data.error.message) || "unknown";
            if (code === 402) {
                console.warn("[chaupal] Subscription required for this content");
            } else if (code === 401) {
                console.error("[chaupal] Session expired — OTP may have been used already");
            } else {
                console.error("[chaupal] Stream API error " + code + ": " + msg);
            }
            return [];
        }

        var resp    = data.response || {};
        var status  = resp.streamStatus || {};
        var streams = resp.streams || [];
        var attrs   = resp.pageAttributes || {};

        if (!status.hasAccess) {
            console.warn("[chaupal] No access — subscription required");
            return [];
        }

        if (!streams.length) {
            console.log("[chaupal] No streams in response");
            return [];
        }

        return buildResults(streams, attrs, settings, match, type, season, episode);
    })
    .catch(function(e) {
        console.error("[chaupal] Stream fetch error: " + e.message);
        return [];
    });
}

function buildResults(streams, attrs, settings, match, type, season, episode) {
    var results  = [];
    var prefQual = settings.quality || "HD";
    var isTv     = type === "tv";
    var showTitle = match.title || "";
    var lang      = attrs.language || "";
    var pgRating  = attrs.pgRatingTitle || "";

    // Sort: widevine first, then preferred quality
    streams.sort(function(a, b) {
        var drmRank = function(s) { return s.streamType === "widevine" ? 2 : s.streamType === "playready" ? 1 : 0; };
        var qRank   = function(s) { return (s.params && s.params.quality === prefQual) ? 1 : 0; };
        return (drmRank(b) + qRank(b)) - (drmRank(a) + qRank(a));
    });

    streams.forEach(function(s) {
        if (!s.url) return;
        // Only Widevine and PlayReady — what Android Media3 handles
        if (s.streamType !== "widevine" && s.streamType !== "playready") return;

        var quality = (s.params && s.params.quality) || "HD";
        var licUrl  = (s.keys && s.keys.licenseKey) || "";
        var isHD    = quality === "HD";

        // Fix http → https on license URL
        licUrl = licUrl.replace(/^http:/, "https:");

        var score   = (isHD ? 2 : 1) * 10 + (s.streamType === "widevine" ? 1 : 0);
        var sortTag = getInvertedSortTag(score, 99);

        var lines = [];
        if (isTv && showTitle) {
            lines.push("\uD83D\uDCE1 " + showTitle + " \u2022 S" + pad(season) + "E" + pad(episode));
        }
        var qParts = [isHD ? "1080p HD" : "480p SD"];
        if (lang) qParts.push(lang);
        lines.push("\uD83C\uDFAC " + qParts.join(" \u2022 "));
        lines.push("\uD83D\uDD12 " + (s.streamType === "widevine" ? "Widevine" : "PlayReady") + " \u2022 DASH");
        if (pgRating) lines.push("\uD83D\uDEA8 " + pgRating);
        lines.push("\uD83D\uDCFA Source: Chaupal");

        results.push({
            name:    sortTag + lines.join("\n"),
            title:   "Chaupal \u2022 " + quality + " \u2022 " + (s.streamType === "widevine" ? "Widevine" : "PlayReady"),
            url:     s.url,
            quality: isHD ? "1080p" : "480p",
            drm: {
                type:       s.streamType === "widevine" ? "widevine" : "playready",
                licenseUrl: licUrl,
                headers:    {}
            },
            // Sprite VTT for seek preview
            subtitleUrl: s.thumbnailSeekPreview || undefined
        });
    });

    console.log("[chaupal] Returning " + results.length + " streams");
    return results;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function buildHeaders(sessionId, isPost, boxId) {
    var h = {
        "tenant-code": TENANT_CODE,
        "box-id":      boxId || BOX_ID,
        "accept":      "application/json, text/plain, */*",
        "origin":      "https://www.chaupal.com",
        "referer":     "https://www.chaupal.com/",
        "user-agent":  UA
    };
    if (sessionId) h["session-id"] = sessionId;
    if (isPost)    h["content-type"] = "application/json";
    return h;
}

function fetchJson(url, options) {
    var opts    = options || {};
    var headers = opts.headers || buildHeaders(null);
    return fetch(url, {
        method:  opts.method || "GET",
        headers: headers,
        body:    opts.body || undefined
    })
    .then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
        return r.json();
    });
}
