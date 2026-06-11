/*
 * ESPN data layer.
 *
 * Uses ESPN's free, public, no-key endpoints (they send
 * `access-control-allow-origin: *`, so they are callable straight from the
 * browser):
 *   - standings: grouped league tables (Group A-L)
 *   - scoreboard: per-day fixtures, live scores and knockout matches
 *
 * Completed match days are cached in localStorage so repeat loads are fast and
 * light; today/future and in-progress days are always re-fetched.
 */
(function () {
  window.WC = window.WC || {};

  var BASE = "https://site.api.espn.com/apis";
  var STANDINGS_URL = BASE + "/v2/sports/soccer/fifa.world/standings?season=2026";
  var SCOREBOARD_URL = BASE + "/site/v2/sports/soccer/fifa.world/scoreboard?dates=";
  var CACHE_PREFIX = "wc26.day.";

  // --- helpers ---------------------------------------------------------------

  function normalize(str) {
    return (str || "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  // Tournament window: 11 Jun 2026 -> 19 Jul 2026 (inclusive).
  function tournamentDates() {
    var dates = [];
    var start = Date.UTC(2026, 5, 11);
    var end = Date.UTC(2026, 6, 19);
    for (var t = start; t <= end; t += 86400000) {
      var d = new Date(t);
      dates.push(
        "" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate())
      );
    }
    return dates;
  }

  function todayKey() {
    var d = new Date();
    return "" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());
  }

  // Map an ESPN event to our simplified match shape.
  function parseRound(ev, dateKey) {
    var slug = (ev.season && ev.season.slug) || "";
    var map = {
      "group-stage": "group",
      "round-of-32": "r32",
      "round-of-16": "r16",
      "quarterfinals": "qf",
      "semifinals": "sf",
      "3rd-place": "third",
      "third-place": "third",
      "final": "final",
    };
    if (map[slug]) return map[slug];

    // Fallback: derive from the matchday date.
    var n = parseInt(dateKey, 10);
    if (n <= 20260627) return "group";
    if (n <= 20260703) return "r32";
    if (n <= 20260708) return "r16";
    if (n <= 20260712) return "qf";
    if (n <= 20260716) return "sf";
    if (n === 20260718) return "third";
    return "final";
  }

  function parseCompetitor(c) {
    var team = c.team || {};
    return {
      espnId: team.id,
      name: team.displayName || team.name || "",
      abbr: team.abbreviation || "",
      logo: team.logo || (team.logos && team.logos[0] && team.logos[0].href) || "",
      color: team.color || "",
      score: c.score != null && c.score !== "" ? parseInt(c.score, 10) : null,
      winner: !!c.winner,
      homeAway: c.homeAway,
      penScore: c.shootoutScore != null ? c.shootoutScore : null,
    };
  }

  function parseEvent(ev, dateKey) {
    var comp = (ev.competitions && ev.competitions[0]) || {};
    var status = (comp.status || ev.status || {}).type || {};
    var competitors = (comp.competitors || []).map(parseCompetitor);
    var home = competitors.filter(function (c) { return c.homeAway === "home"; })[0] || competitors[0];
    var away = competitors.filter(function (c) { return c.homeAway === "away"; })[0] || competitors[1];
    return {
      id: ev.id,
      dateISO: ev.date,
      round: parseRound(ev, dateKey),
      state: status.state || "pre", // pre | in | post
      completed: !!status.completed,
      statusDetail: status.shortDetail || status.detail || status.description || "",
      statusShort: status.shortDetail || "",
      venue: (comp.venue && comp.venue.fullName) || "",
      home: home || null,
      away: away || null,
    };
  }

  // --- network ---------------------------------------------------------------

  function getJSON(url) {
    return fetch(url, { headers: { Accept: "application/json" } }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " for " + url);
      return r.json();
    });
  }

  function fetchStandings() {
    return getJSON(STANDINGS_URL).then(function (data) {
      var children = data.children || [];
      return children.map(function (g) {
        var entries = (g.standings && g.standings.entries) || [];
        var teams = entries.map(function (e) {
          var stats = {};
          (e.stats || []).forEach(function (s) {
            var v = s.value;
            if (v == null && s.displayValue != null) v = parseFloat(s.displayValue);
            stats[s.name] = isNaN(v) ? 0 : (v || 0);
          });
          var note = e.note || {};
          var gd = stats.pointDifferential;
          if (gd == null) gd = (stats.pointsFor || 0) - (stats.pointsAgainst || 0);
          return {
            espnId: e.team.id,
            name: e.team.displayName || e.team.name,
            logo: (e.team.logos && e.team.logos[0] && e.team.logos[0].href) || "",
            played: stats.gamesPlayed || 0,
            wins: stats.wins || 0,
            draws: stats.ties || 0,
            losses: stats.losses || 0,
            gf: stats.pointsFor || 0,
            ga: stats.pointsAgainst || 0,
            gd: gd || 0,
            points: stats.points || 0,
            rank: note.rank || stats.rank || null,
            advanceColor: note.color || "",
            advanceText: note.description || "",
          };
        });
        return { name: g.name, abbreviation: g.abbreviation, teams: teams };
      });
    });
  }

  function fetchDay(dateKey) {
    var isPastFinalised = false;
    try {
      var cached = localStorage.getItem(CACHE_PREFIX + dateKey);
      if (cached) {
        var obj = JSON.parse(cached);
        // Only trust the cache for days where every match is finished.
        if (obj && obj.finalised && dateKey < todayKey()) {
          return Promise.resolve(obj.matches);
        }
      }
    } catch (e) { /* ignore cache errors */ }

    return getJSON(SCOREBOARD_URL + dateKey)
      .then(function (data) {
        var events = data.events || [];
        var matches = events.map(function (ev) { return parseEvent(ev, dateKey); });
        var finalised = matches.length > 0 && matches.every(function (m) { return m.completed; });
        try {
          localStorage.setItem(
            CACHE_PREFIX + dateKey,
            JSON.stringify({ finalised: finalised, matches: matches })
          );
        } catch (e) { /* storage full / disabled */ }
        return matches;
      })
      .catch(function () { return []; });
  }

  // Fetch every match in the tournament (deduped by id).
  function fetchAllMatches() {
    var dates = tournamentDates();
    return Promise.all(dates.map(fetchDay)).then(function (perDay) {
      var byId = {};
      perDay.forEach(function (matches) {
        matches.forEach(function (m) {
          if (!m.home || !m.away) return;
          byId[m.id] = m; // later days overwrite earlier (handles UTC overlap)
        });
      });
      return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
        return new Date(a.dateISO) - new Date(b.dateISO);
      });
    });
  }

  // Re-fetch only the current day (cheap, for live polling).
  function fetchTodayMatches() {
    return fetchDay(todayKey());
  }

  window.WC.espn = {
    normalize: normalize,
    fetchStandings: fetchStandings,
    fetchAllMatches: fetchAllMatches,
    fetchTodayMatches: fetchTodayMatches,
    tournamentDates: tournamentDates,
  };
})();
