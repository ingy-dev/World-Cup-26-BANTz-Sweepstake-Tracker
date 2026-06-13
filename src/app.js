/*
 * Main application: wires the sweepstake draw + ESPN live data into the
 * wall-chart UI (groups, knockouts, leaderboard, my teams).
 */
(function () {
  var TEAMS = window.WC.TEAMS;
  var SWEEP = window.WC.SWEEPSTAKE;
  var espn = window.WC.espn;
  var normalize = espn.normalize;

  // ---------------------------------------------------------------------------
  // Lookups derived from the static draw
  // ---------------------------------------------------------------------------

  var teamById = {};
  var canonicalByNorm = {}; // normalised name/alias -> canonical team
  TEAMS.forEach(function (t) {
    teamById[t.id] = t;
    canonicalByNorm[normalize(t.name)] = t;
    (t.aliases || []).forEach(function (a) { canonicalByNorm[normalize(a)] = t; });
  });

  var ownerByTeamId = {}; // canonical team id -> participant
  SWEEP.participants.forEach(function (p) {
    p.teams.forEach(function (tid) { ownerByTeamId[tid] = p; });
  });

  // The participant each better is assigned to (better name -> participant bet on)
  var participantByBetter = {};
  SWEEP.participants.forEach(function (p) {
    participantByBetter[normalize(p.better)] = p;
  });

  // All people (players + betters), de-duplicated by normalised name
  var peopleByNorm = {};
  SWEEP.participants.forEach(function (p) {
    peopleByNorm[normalize(p.name)] = { name: p.name, isPlayer: true };
  });
  SWEEP.participants.forEach(function (p) {
    var key = normalize(p.better);
    if (!peopleByNorm[key]) peopleByNorm[key] = { name: p.better, isPlayer: false };
  });
  var people = Object.keys(peopleByNorm).map(function (k) { return peopleByNorm[k]; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });

  function canonicalFromEspnName(name) {
    return canonicalByNorm[normalize(name)] || null;
  }
  function ownerForCanonical(canon) {
    return canon ? ownerByTeamId[canon.id] || null : null;
  }
  function fmtMoney(amount) {
    return (SWEEP.payouts.symbol || "£") + amount;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ---------------------------------------------------------------------------
  // App state
  // ---------------------------------------------------------------------------

  var state = {
    tab: localStorage.getItem("wc26.tab") || "wallchart",
    person: localStorage.getItem("wc26.person") || "",
    groups: [],
    matches: [],
    loading: true,
    error: "",
    lastUpdated: null,
    feed: { eventId: null, commentary: [], keyEvents: [] }, // live feed for the active match
    feedMode: localStorage.getItem("wc26.feed") || "commentary", // "commentary" | "keyEvents"
    selectedMatchId: null, // which live match the feed follows (null = first live)
  };

  // Derived analysis (rebuilt whenever data changes)
  var analysis = {
    canonicalToEspn: {}, // canonical id -> standings team (incl group)
    matchesByEspnId: {}, // espnId -> [match]
    teamState: {}, // canonical id -> { alive, eliminated, champion, stage, ... }
    knockoutStarted: false,
    champion: null, // { canon, participant }
  };

  var ROUND_LABEL = {
    group: "Group stage", r32: "Round of 32", r16: "Round of 16",
    qf: "Quarter-final", sf: "Semi-final", third: "Third place", final: "Final",
  };
  var ROUND_ORDER = { group: 0, r32: 1, r16: 2, qf: 3, sf: 4, third: 5, final: 6 };

  // Order teams within a group: ESPN rank when available, otherwise the usual
  // football tiebreakers (points -> goal difference -> goals scored).
  function compareGroupTeams(a, b) {
    if (a.rank && b.rank && a.rank !== b.rank) return a.rank - b.rank;
    if (b.points !== a.points) return b.points - a.points;
    if (b.gd !== a.gd) return b.gd - a.gd;
    return (b.gf || 0) - (a.gf || 0);
  }

  // ---------------------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------------------

  function rebuildAnalysis() {
    var a = {
      canonicalToEspn: {}, matchesByEspnId: {}, teamState: {},
      knockoutStarted: false, knockoutDrawn: false, champion: null,
    };

    // Map standings teams to canonical ids
    var espnIdToCanon = {};
    state.groups.forEach(function (g) {
      g.teams.forEach(function (t) {
        var canon = canonicalFromEspnName(t.name);
        if (canon) {
          a.canonicalToEspn[canon.id] = Object.assign({ group: g.name }, t);
          espnIdToCanon[t.espnId] = canon;
        }
      });
    });

    // Index matches by team & detect knockout state.
    // NOTE: the full schedule includes future knockout *slots* before the draw,
    // so "knockoutStarted" (any knockout fixture exists) is only used for the
    // bracket view. Elimination uses "knockoutDrawn" - a knockout match that
    // actually has two real teams assigned.
    state.matches.forEach(function (m) {
      if (m.round !== "group") {
        a.knockoutStarted = true;
        if (m.home && m.away && m.home.espnId && m.away.espnId) a.knockoutDrawn = true;
      }
      [m.home, m.away].forEach(function (c) {
        if (!c || !c.espnId) return;
        (a.matchesByEspnId[c.espnId] = a.matchesByEspnId[c.espnId] || []).push(m);
      });
    });

    // Champion = winner of a completed final
    var finalMatch = state.matches.filter(function (m) { return m.round === "final" && m.completed; })[0];
    if (finalMatch) {
      var champComp = [finalMatch.home, finalMatch.away].filter(function (c) { return c && c.winner; })[0];
      if (champComp) {
        var champCanon = espnIdToCanon[champComp.espnId] || canonicalFromEspnName(champComp.name);
        if (champCanon) a.champion = { canon: champCanon, participant: ownerForCanonical(champCanon) };
      }
    }

    // Per-team state for every team that belongs to a participant
    SWEEP.participants.forEach(function (p) {
      p.teams.forEach(function (tid) {
        var canon = teamById[tid];
        var standing = a.canonicalToEspn[tid] || null;
        var espnId = standing ? standing.espnId : null;
        var ms = (espnId && a.matchesByEspnId[espnId]) || [];

        var isChampion = !!(a.champion && a.champion.canon && a.champion.canon.id === tid);
        var inKnockout = ms.some(function (m) { return m.round !== "group"; });
        var lostKnockout = ms.some(function (m) {
          if (m.round === "group" || !m.completed) return false;
          var other = (m.home && m.home.espnId === espnId) ? m.away : m.home;
          return other && other.winner;
        });

        // A team is eliminated only when it is genuinely knocked out:
        //  - it lost a completed knockout match, or
        //  - the knockout draw is set and it didn't make it (finished its
        //    group and isn't in any knockout match).
        var groupComplete = !!(standing && standing.played >= 3);
        var eliminated = false;
        if (lostKnockout) eliminated = true;
        else if (a.knockoutDrawn && groupComplete && !inKnockout) eliminated = true;

        // Furthest round the team appears in
        var stage = "group";
        ms.forEach(function (m) { if (ROUND_ORDER[m.round] > ROUND_ORDER[stage]) stage = m.round; });

        a.teamState[tid] = {
          canon: canon,
          standing: standing,
          espnId: espnId,
          alive: !eliminated,
          eliminated: eliminated,
          champion: isChampion,
          inKnockout: inKnockout,
          stage: stage,
          group: standing ? standing.group : "",
        };
      });
    });

    analysis = a;
  }

  // ---------------------------------------------------------------------------
  // Small render helpers
  // ---------------------------------------------------------------------------

  function flagImg(canon, espnLogo, sizeClass) {
    if (canon && canon.flag) {
      var fallback = espnLogo ? " onerror=\"this.onerror=null;this.src='" + esc(espnLogo) + "'\"" : "";
      return '<img class="flag ' + (sizeClass || "") + '" loading="lazy" ' +
        'src="https://flagcdn.com/w80/' + esc(canon.flag) + '.png"' + fallback +
        ' alt="">';
    }
    if (espnLogo) return '<img class="flag ' + (sizeClass || "") + '" loading="lazy" src="' + esc(espnLogo) + '" alt="">';
    return '<span class="flag flag-blank ' + (sizeClass || "") + '"></span>';
  }

  function ownerChip(participant) {
    if (!participant) return "";
    return '<span class="owner-chip" style="--c:' + esc(participant.color) + '">' +
      '<span class="owner-dot"></span>' + esc(participant.name) + "</span>";
  }

  // Stacked label: participant name with their Sweepception better below in
  // smaller text. align is "left" or "right".
  function ownerLabel(participant, align) {
    if (!participant) return "";
    return '<span class="owner-label owner-label--' + (align || "left") + '" style="--c:' + esc(participant.color) + '">' +
      '<span class="ol-name">' + esc(participant.name) + "</span>" +
      '<span class="ol-better">' + esc(participant.better) + "</span>" +
      "</span>";
  }

  function teamStatusBadge(ts) {
    if (!ts) return '<span class="badge badge-alive">Still In Play</span>';
    if (ts.champion) return '<span class="badge badge-champ">Champion</span>';
    if (ts.eliminated) return '<span class="badge badge-out">Eliminated</span>';
    return '<span class="badge badge-alive">Still In Play</span>';
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  // Live Now / Up Next: leads with the players + betters rather than teams.
  function renderLiveNow() {
    if (!state.matches.length) return "";
    var live = state.matches.filter(function (m) { return m.state === "in" && m.home && m.away; });
    var mode, list, title;
    if (live.length) {
      mode = "live"; list = live; title = "Live Now";
    } else {
      var now = Date.now();
      var upcoming = state.matches.filter(function (m) {
        return m.state === "pre" && m.home && m.away && new Date(m.dateISO).getTime() >= now - 3600000;
      }).sort(function (a, b) { return new Date(a.dateISO) - new Date(b.dateISO); });
      if (!upcoming.length) return "";
      mode = "next"; list = [upcoming[0]]; title = "Up Next";
    }
    var cards = list.map(function (m) { return liveCard(m, mode); }).join("");
    var feed = mode === "live" ? renderMatchFeed() : "";
    return '<section class="livenow' + (mode === "live" ? " is-live" : "") + '">' +
      '<div class="livenow-head">' + (mode === "live" ? '<span class="ln-dot"></span>' : "") +
      "<h2>" + esc(title) + "</h2></div>" +
      '<div class="livenow-cards">' + cards + "</div>" + feed + "</section>";
  }

  // Icon for a feed line, based on ESPN's play/event type (and text fallback).
  function commentaryIcon(type, text) {
    var t = ((type || "") + " " + (text || "")).toLowerCase();
    if (t.indexOf("goal") !== -1) return "⚽";
    if (t.indexOf("penalt") !== -1) return "🎯";
    if (t.indexOf("yellow") !== -1) return "🟨";
    if (t.indexOf("red card") !== -1 || t.indexOf("red-card") !== -1) return "🟥";
    if (t.indexOf("substitut") !== -1 || t.indexOf("sub") !== -1) return "🔁";
    if (t.indexOf("extra") !== -1) return "⏱️";
    if (t.indexOf("full-time") !== -1 || t.indexOf("fulltime") !== -1 ||
        t.indexOf("match end") !== -1 || t.indexOf("ends") !== -1) return "🏁";
    if (t.indexOf("half-time") !== -1 || t.indexOf("halftime") !== -1) return "⏸️";
    if (t.indexOf("kick off") !== -1 || t.indexOf("kickoff") !== -1 || t.indexOf("begins") !== -1) return "▶️";
    if (t.indexOf("shootout") !== -1) return "🎯";
    if (t.indexOf("corner") !== -1) return "🚩";
    return "•";
  }

  // Short label for a match (abbreviations + live score), used by the selector.
  function matchLabel(m) {
    var h = (m.home.abbr || (m.home.name || "").slice(0, 3)).toUpperCase();
    var a = (m.away.abbr || (m.away.name || "").slice(0, 3)).toUpperCase();
    var score = (m.home.score == null ? 0 : m.home.score) + "-" + (m.away.score == null ? 0 : m.away.score);
    return esc(h + " " + score + " " + a);
  }

  // Live feed (commentary / key events) for the active live match, with a match
  // selector when several are live and a Commentary / Key events toggle.
  function renderMatchFeed() {
    var live = liveMatches();
    if (!live.length) return "";
    var active = activeFeedMatch();
    if (!active) return "";

    var selector = live.length > 1
      ? '<div class="feed-matches">' + live.map(function (m) {
          return '<button class="feed-match' + (m.id === active.id ? " active" : "") +
            '" data-match="' + esc(m.id) + '">' + matchLabel(m) + "</button>";
        }).join("") + "</div>"
      : "";

    var hc = canonicalFromEspnName(active.home.name);
    var ac = canonicalFromEspnName(active.away.name);
    var heading = esc((hc ? hc.name : active.home.name)) + " v " + esc(ac ? ac.name : active.away.name);

    var feedMode = state.feedMode === "keyEvents" ? "keyEvents" : "commentary";
    var toggle = '<div class="cm-toggle">' +
      '<button class="cm-tab' + (feedMode === "commentary" ? " active" : "") + '" data-feed="commentary">Commentary</button>' +
      '<button class="cm-tab' + (feedMode === "keyEvents" ? " active" : "") + '" data-feed="keyEvents">Key events</button>' +
      "</div>";

    var body;
    if (!state.feed || state.feed.eventId !== active.id) {
      // A different match was just selected; its summary is still loading.
      body = '<p class="muted small cm-empty">Loading commentary…</p>';
    } else {
      var list = feedMode === "keyEvents" ? (state.feed.keyEvents || []) : (state.feed.commentary || []);
      var limit = feedMode === "keyEvents" ? 8 : 5;
      if (!list.length) {
        body = '<p class="muted small cm-empty">' +
          (feedMode === "keyEvents" ? "No key events yet." : "No commentary yet.") + "</p>";
      } else {
        body = '<ul class="cm-list">' + list.slice(0, limit).map(function (c) {
          var isGoal = c.scoring || (c.type || "").toLowerCase().indexOf("goal") !== -1;
          return '<li class="cm-item' + (isGoal ? " cm-goal" : "") + '">' +
            '<span class="cm-clock">' + esc(c.clock || "") + "</span>" +
            '<span class="cm-icon">' + commentaryIcon(c.type, c.text) + "</span>" +
            '<span class="cm-text">' + esc(c.text) + "</span>" +
            "</li>";
        }).join("") + "</ul>";
      }
    }

    return '<div class="commentary">' + selector +
      '<div class="commentary-head"><span class="cm-title">' + heading + "</span>" + toggle + "</div>" +
      body + "</div>";
  }

  function liveCard(m, mode) {
    var mid = mode === "live"
      ? '<div class="lc-score live">' + (m.home.score == null ? 0 : m.home.score) +
        '<span class="lc-dash">–</span>' + (m.away.score == null ? 0 : m.away.score) + "</div>" +
        '<div class="lc-status live">' + esc(m.statusShort || "Live") + "</div>"
      : '<div class="lc-vs">v</div><div class="lc-status">' + esc(shortDate(m.dateISO)) + "</div>";
    return '<div class="live-card">' +
      '<div class="live-card-top">' +
        liveSide(m.home, "home") +
        '<div class="lc-mid">' + mid + "</div>" +
        liveSide(m.away, "away") +
      "</div>" +
      liveScorersRow(m) +
      "</div>";
  }

  function goalLine(g) {
    var suffix = g.og ? " (OG)" : (g.pen ? " (P)" : "");
    return '<span class="lc-goal">' + esc(g.name) +
      (g.clock ? " " + esc(g.clock) : "") + suffix + "</span>";
  }

  // Goalscorers sit in their own row below the main card so owner/team
  // columns stay the same height on both sides.
  function liveScorersRow(m) {
    var homeGoals = (m.home && m.home.goals) || [];
    var awayGoals = (m.away && m.away.goals) || [];
    if (!homeGoals.length && !awayGoals.length) return "";
    return '<div class="lc-scorers-row">' +
      '<div class="lc-scorers lc-scorers-home">' + homeGoals.map(goalLine).join("") + "</div>" +
      '<div class="lc-scorers-mid"></div>' +
      '<div class="lc-scorers lc-scorers-away">' + awayGoals.map(goalLine).join("") + "</div>" +
      "</div>";
  }

  function liveSide(c, side) {
    var canon = canonicalFromEspnName(c.name);
    var owner = ownerForCanonical(canon);
    var color = owner ? owner.color : "#ffffff";
    var ownerHtml = owner
      ? '<span class="lc-player">' + esc(owner.name) + "</span><span class=\"lc-better\">" + esc(owner.better) + "</span>"
      : '<span class="lc-player">—</span>';
    return '<div class="lc-side lc-' + side + '" style="--c:' + esc(color) + '">' +
      '<div class="lc-owner">' + ownerHtml + "</div>" +
      '<div class="lc-team">' + flagImg(canon, c.logo, "flag-sm") +
      "<span>" + esc(canon ? canon.name : c.name) + "</span></div>" +
      "</div>";
  }

  function renderWallChart() {
    if (!state.groups.length) {
      return '<p class="muted center">Waiting for ESPN to publish the group tables…</p>';
    }
    var espnIdToGroup = {};
    state.groups.forEach(function (g) {
      g.teams.forEach(function (t) { espnIdToGroup[t.espnId] = g.name; });
    });

    var html = '<div class="groups-grid">';
    state.groups.forEach(function (g) {
      html += '<section class="group-card">';
      html += '<h3 class="group-title">' + esc(g.name) + "</h3>";
      html += '<table class="standings"><thead><tr>' +
        "<th></th><th class=col-team>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>" +
        "</tr></thead><tbody>";
      // Sort live so the group leader is always on top.
      var sortedTeams = g.teams.slice().sort(compareGroupTeams);
      sortedTeams.forEach(function (t, idx) {
        var canon = canonicalFromEspnName(t.name);
        var owner = ownerForCanonical(canon);
        var position = t.rank || idx + 1;
        var qual = position <= 2 ? " qualifying" : "";
        html += '<tr class="' + (owner ? "owned" : "") + qual + '"' +
          (owner ? ' style="--c:' + esc(owner.color) + '"' : "") + ">";
        html += "<td class=rank>" + position + "</td>";
        html += '<td class="col-team"><span class="team-cell">' +
          flagImg(canon, t.logo, "flag-sm") +
          '<span class="team-name">' + esc(canon ? canon.name : t.name) + "</span>" +
          ownerLabel(owner, "right") +
          "</span></td>";
        html += "<td>" + t.played + "</td><td>" + t.wins + "</td><td>" + t.draws + "</td><td>" + t.losses + "</td>";
        html += "<td>" + (t.gd > 0 ? "+" + t.gd : t.gd) + "</td><td class=pts>" + t.points + "</td>";
        html += "</tr>";
      });
      html += "</tbody></table>";

      // Group fixtures/results
      var groupMatches = state.matches.filter(function (m) {
        return m.round === "group" && m.home && espnIdToGroup[m.home.espnId] === g.name;
      });
      if (groupMatches.length) {
        html += '<ul class="fixtures">';
        groupMatches.forEach(function (m) { html += fixtureRow(m); });
        html += "</ul>";
      }
      html += "</section>";
    });
    html += "</div>";
    return html;
  }

  function fixtureRow(m) {
    var hc = canonicalFromEspnName(m.home.name);
    var ac = canonicalFromEspnName(m.away.name);
    var ho = ownerForCanonical(hc);
    var ao = ownerForCanonical(ac);
    var live = m.state === "in";
    var score = m.state === "pre"
      ? '<span class="fx-time">' + esc(shortDate(m.dateISO)) + "</span>"
      : '<span class="fx-score' + (live ? " live" : "") + '">' + (m.home.score == null ? "-" : m.home.score) +
        "<span class=fx-dash>–</span>" + (m.away.score == null ? "-" : m.away.score) + "</span>";
    return '<li class="fixture' + (live ? " is-live" : "") + '">' +
      '<span class="fx-team fx-home">' +
        '<span class="fx-line">' + esc(hc ? hc.name : m.home.name) + flagImg(hc, m.home.logo, "flag-xs") + "</span>" +
        ownerLabel(ho, "right") +
      "</span>" +
      '<span class="fx-mid">' + score +
        (live ? '<span class="fx-status live">' + esc(m.statusShort) + "</span>"
              : m.completed ? '<span class="fx-status">FT</span>' : "") +
      "</span>" +
      '<span class="fx-team fx-away">' +
        '<span class="fx-line">' + flagImg(ac, m.away.logo, "flag-xs") + esc(ac ? ac.name : m.away.name) + "</span>" +
        ownerLabel(ao, "left") +
      "</span>" +
      "</li>";
  }

  function shortDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
        d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  function renderBracket() {
    var rounds = ["r32", "r16", "qf", "sf", "final"];
    var byRound = {};
    rounds.concat(["third"]).forEach(function (r) { byRound[r] = []; });
    state.matches.forEach(function (m) { if (byRound[m.round]) byRound[m.round].push(m); });

    if (!analysis.knockoutStarted) {
      return '<div class="bracket-empty">' +
        "<h3>Knockouts begin 28 June</h3>" +
        '<p class="muted">Once the group stage ends, the Round of 32 bracket will appear here and fill in automatically as matches finish.</p>' +
        "</div>";
    }

    var html = '<div class="bracket">';
    rounds.forEach(function (r) {
      html += '<div class="bracket-col"><h4 class="bracket-round">' + esc(ROUND_LABEL[r]) + "</h4>";
      if (!byRound[r].length) {
        html += '<p class="muted small">To be decided</p>';
      } else {
        byRound[r].forEach(function (m) { html += bracketMatch(m); });
      }
      html += "</div>";
    });
    html += "</div>";

    if (byRound.third.length) {
      html += '<div class="third-place"><h4 class="bracket-round">Third place</h4>';
      byRound.third.forEach(function (m) { html += bracketMatch(m); });
      html += "</div>";
    }
    return html;
  }

  function bracketMatch(m) {
    var showScore = m.state !== "pre";
    return '<div class="bm' + (m.state === "in" ? " is-live" : "") + '">' +
      bracketSide(m.home, showScore) + bracketSide(m.away, showScore) +
      '<div class="bm-status">' + esc(m.state === "pre" ? shortDate(m.dateISO) : (m.statusShort || (m.completed ? "FT" : ""))) + "</div>" +
      "</div>";
  }

  function bracketSide(c, showScore) {
    if (!c) return '<div class="bm-side empty">TBD</div>';
    var canon = canonicalFromEspnName(c.name);
    var owner = ownerForCanonical(canon);
    return '<div class="bm-side' + (c.winner ? " winner" : "") + '">' +
      flagImg(canon, c.logo, "flag-xs") +
      '<span class="bm-stack">' +
        '<span class="bm-name">' + esc(canon ? canon.name : c.name) + "</span>" +
        (owner ? '<span class="bm-owner" style="--c:' + esc(owner.color) + '">' +
          esc(owner.name) +
          '<span class="bm-better"> · ' + esc(owner.better) + "</span></span>" : "") +
      "</span>" +
      '<span class="bm-score">' + (showScore && c.score != null ? c.score : "") + "</span>" +
      "</div>";
  }

  function participantSummary(p) {
    var alive = 0, eliminated = 0, played = 0, points = 0, gd = 0, koGd = 0, koGf = 0, best = "group", isChamp = false;
    p.teams.forEach(function (tid) {
      var ts = analysis.teamState[tid];
      if (!ts) return;
      if (ts.champion) isChamp = true;
      if (ts.eliminated) eliminated++; else alive++;
      if (ts.standing) {
        played += ts.standing.played || 0;
        points += ts.standing.points || 0;
        gd += ts.standing.gd || 0;
      }
      // Knockout form: goal difference / goals scored across completed
      // knockout matches (group games are excluded).
      if (ts.espnId) {
        (analysis.matchesByEspnId[ts.espnId] || []).forEach(function (m) {
          if (m.round === "group" || !m.completed) return;
          var mine = (m.home && m.home.espnId === ts.espnId) ? m.home : m.away;
          var opp = (m.home && m.home.espnId === ts.espnId) ? m.away : m.home;
          if (mine && opp && mine.score != null && opp.score != null) {
            koGd += mine.score - opp.score;
            koGf += mine.score;
          }
        });
      }
      if (ROUND_ORDER[ts.stage] > ROUND_ORDER[best]) best = ts.stage;
    });
    return { alive: alive, eliminated: eliminated, played: played, points: points, gd: gd, koGd: koGd, koGf: koGf, best: best, isChamp: isChamp };
  }

  function renderLeaderboard() {
    var rows = SWEEP.participants.map(function (p) {
      return { p: p, s: participantSummary(p) };
    });
    rows.sort(function (x, y) {
      if (x.s.isChamp !== y.s.isChamp) return x.s.isChamp ? -1 : 1;
      // Post-elimination: teams still alive and furthest round reached dominate.
      if (y.s.alive !== x.s.alive) return y.s.alive - x.s.alive;
      if (ROUND_ORDER[y.s.best] !== ROUND_ORDER[x.s.best]) return ROUND_ORDER[y.s.best] - ROUND_ORDER[x.s.best];
      // Knockout form: how convincingly their teams are winning in the
      // knockouts (zero during the group stage, so groups fall through below).
      if (y.s.koGd !== x.s.koGd) return y.s.koGd - x.s.koGd;
      if (y.s.koGf !== x.s.koGf) return y.s.koGf - x.s.koGf;
      // Group-stage differentiator: points, then goal difference - so winning
      // teams push you up the board.
      if (y.s.points !== x.s.points) return y.s.points - x.s.points;
      return y.s.gd - x.s.gd;
    });

    var champ = analysis.champion;
    var mainWinner = champ ? champ.participant : null;
    var sideWinner = mainWinner ? mainWinner.better : null;

    var html = "";
    html += '<div class="pots">';
    html += potCard(SWEEP.titles.main, fmtMoney(SWEEP.payouts.main),
      mainWinner ? mainWinner.name : (rows[0] ? rows[0].p.name + " (leading)" : "TBD"),
      mainWinner ? "Champion: " + (champ.canon ? champ.canon.name : "") : "Leading on teams remaining, then points, then GD",
      !!mainWinner);
    html += potCard(SWEEP.titles.side, fmtMoney(SWEEP.payouts.side),
      sideWinner ? sideWinner : (rows[0] ? participantBetter(rows[0].p) + " (leading)" : "TBD"),
      sideWinner ? "Bet on the winner, " + mainWinner.name : "Better of the leading player",
      !!sideWinner);
    html += "</div>";

    // Show the knockout-form column only once knockout matches are under way.
    var koStarted = state.matches.some(function (m) { return m.round !== "group" && m.completed; });

    html += '<table class="leaderboard"><thead><tr>' +
      "<th>#</th><th class=col-team>Player</th>" +
      '<th title="Total matches played by this player\'s teams">MP</th>' +
      "<th>Pts</th><th>GD</th>" +
      '<th title="Teams still in the tournament">Alive</th>' +
      "<th>Furthest</th>" +
      (koStarted ? '<th title="Goal difference across knockout matches">KO GD</th>' : "") +
      "<th class=col-team>Sweepception better</th>" +
      "</tr></thead><tbody>";
    rows.forEach(function (r, i) {
      html += '<tr style="--c:' + esc(r.p.color) + '"' + (r.s.isChamp ? ' class="champ-row"' : "") + ">";
      html += "<td class=rank>" + (i + 1) + "</td>";
      html += '<td class="col-team"><span class="owner-chip" style="--c:' + esc(r.p.color) + '"><span class="owner-dot"></span>' + esc(r.p.name) + (r.s.isChamp ? " 🏆" : "") + "</span></td>";
      html += '<td class="num muted">' + r.s.played + "</td>";
      html += '<td class="num strong">' + r.s.points + "</td>";
      html += '<td class="num muted">' + (r.s.gd > 0 ? "+" + r.s.gd : r.s.gd) + "</td>";
      html += '<td class="num"><span class="lb-track">' + r.s.alive + '<span class="lb-track-total">/' + r.p.teams.length + "</span></span></td>";
      html += "<td>" + esc(ROUND_LABEL[r.s.best]) + "</td>";
      if (koStarted) html += '<td class="num strong">' + (r.s.koGd > 0 ? "+" + r.s.koGd : r.s.koGd) + "</td>";
      html += "<td class=col-team>" + esc(r.p.better) + "</td>";
      html += "</tr>";
    });
    html += "</tbody></table>";
    return html;
  }

  function participantBetter(p) { return p ? p.better : ""; }

  function potCard(title, amount, winner, sub, decided) {
    return '<div class="pot' + (decided ? " decided" : "") + '">' +
      '<div class="pot-amount">' + esc(amount) + "</div>" +
      '<div class="pot-title">' + esc(title) + "</div>" +
      '<div class="pot-winner">' + esc(winner) + "</div>" +
      '<div class="pot-sub muted">' + esc(sub) + "</div>" +
      "</div>";
  }

  function renderMyTeams() {
    var options = '<option value="">— pick your name —</option>' +
      people.map(function (pe) {
        return '<option value="' + esc(pe.name) + '"' + (pe.name === state.person ? " selected" : "") + ">" + esc(pe.name) + "</option>";
      }).join("");

    var html = '<div class="myteams-pick"><label for="person-select">Who are you?</label>' +
      '<select id="person-select">' + options + "</select></div>";

    if (!state.person) {
      html += '<p class="muted center">Pick your name to see every team you have riding — your own picks and the player you drew in the Sweepception.</p>';
      return html;
    }

    var key = normalize(state.person);
    var asPlayer = SWEEP.participants.filter(function (p) { return normalize(p.name) === key; })[0] || null;
    var betOn = participantByBetter[key] || null;

    // Two columns, each self-contained: team picks on top, then that
    // category's upcoming fixtures, then its match history. Left = the original
    // sweepstake (their own picks), right = the Sweepception (their draw).
    html += '<div class="myteams-sections">';

    html += '<div class="myteams-col">';
    html += '<section class="myteams-block"><h3>Your picks <span class="muted">(' + SWEEP.titles.main + ")</span></h3>";
    if (asPlayer) {
      html += teamCardList(asPlayer.teams, asPlayer);
    } else {
      html += '<p class="muted">You\'re not a player in the main sweep.</p>';
    }
    html += "</section>";
    if (asPlayer) html += myMatchesBlocks(asPlayer.teams);
    html += "</div>";

    html += '<div class="myteams-col">';
    html += '<section class="myteams-block"><h3>Your Sweepception ';
    if (betOn) {
      html += '<span class="muted">(you drew ' + esc(betOn.name) + ")</span></h3>";
      html += teamCardList(betOn.teams, betOn);
    } else {
      html += '<span class="muted">(side bet)</span></h3><p class="muted">You weren\'t assigned a player in the Sweepception.</p>';
    }
    html += "</section>";
    if (betOn) html += myMatchesBlocks(betOn.teams);
    html += "</div>";

    html += "</div>";

    // Personal payout watch
    var champ = analysis.champion;
    if (champ && champ.participant) {
      var winsMain = asPlayer && champ.participant.name === asPlayer.name;
      var winsSide = betOn && champ.participant.name === betOn.name;
      if (winsMain || winsSide) {
        html += '<div class="you-won">🎉 ';
        var bits = [];
        if (winsMain) bits.push("the " + fmtMoney(SWEEP.payouts.main) + " " + SWEEP.titles.main);
        if (winsSide) bits.push("the " + fmtMoney(SWEEP.payouts.side) + " " + SWEEP.titles.side);
        html += "You win " + bits.join(" AND ") + "!</div>";
      }
    }
    return html;
  }

  function teamCardList(teamIds, owner) {
    var html = '<ul class="team-cards">';
    teamIds.forEach(function (tid) {
      var canon = teamById[tid];
      var ts = analysis.teamState[tid];
      var logo = ts && ts.standing ? ts.standing.logo : "";
      html += '<li class="team-card' + (ts && ts.eliminated ? " is-out" : "") + (ts && ts.champion ? " is-champ" : "") + '">' +
        flagImg(canon, logo, "flag-md") +
        '<span class="tc-name">' + esc(canon ? canon.name : tid) + "</span>" +
        teamStatusBadge(ts) +
        "</li>";
    });
    html += "</ul>";
    return html;
  }

  // Upcoming + match-history blocks for one category of teams (either the
  // person's own sweepstake picks or their Sweepception draw). Reuses the
  // group-stage fixture layout and shows the owner (username + Sweepception
  // better) of whoever their teams are up against. Matches are grouped by round,
  // so this automatically rolls from the group stage into the knockouts as the
  // schedule fills in.
  function myMatchesBlocks(teamIds) {
    var mineSet = {};
    teamIds.forEach(function (tid) {
      var ts = analysis.teamState[tid];
      if (ts && ts.espnId) mineSet[ts.espnId] = true;
    });

    var byId = {};
    Object.keys(mineSet).forEach(function (espnId) {
      (analysis.matchesByEspnId[espnId] || []).forEach(function (m) {
        if (m.home && m.away) byId[m.id] = m;
      });
    });
    var all = Object.keys(byId).map(function (k) { return byId[k]; });
    var history = all.filter(function (m) { return m.completed || m.state === "in" || m.state === "post"; });
    var upcoming = all.filter(function (m) { return m.state === "pre"; });
    history.sort(function (a, b) { return new Date(b.dateISO) - new Date(a.dateISO); });
    upcoming.sort(function (a, b) { return new Date(a.dateISO) - new Date(b.dateISO); });

    var roundsAsc = ["group", "r32", "r16", "qf", "sf", "third", "final"];

    function block(heading, list, empty, asc) {
      var inner = "";
      if (!list.length) {
        inner = '<p class="muted small">' + esc(empty) + "</p>";
      } else {
        var order = asc ? roundsAsc : roundsAsc.slice().reverse();
        order.forEach(function (r) {
          var rows = list.filter(function (m) { return m.round === r; });
          if (!rows.length) return;
          inner += '<div class="mm-round"><span class="mm-round-label">' + esc(ROUND_LABEL[r]) + "</span>";
          inner += '<ul class="fixtures">';
          rows.forEach(function (m) { inner += myMatchRow(m, mineSet); });
          inner += "</ul></div>";
        });
      }
      return '<section class="myteams-block"><h3>' + esc(heading) + "</h3>" + inner + "</section>";
    }

    return block("Upcoming matches", upcoming, "No upcoming fixtures right now — check back once the next round is drawn.", true) +
      block("Match history", history, "None of these teams have kicked off yet.", false);
  }

  // A single fixture row from the perspective of a person's team(s). Identical
  // layout to the group-stage fixtures, but highlights the team(s) they own.
  function myMatchRow(m, mineSet) {
    var hc = canonicalFromEspnName(m.home.name);
    var ac = canonicalFromEspnName(m.away.name);
    var ho = ownerForCanonical(hc);
    var ao = ownerForCanonical(ac);
    var live = m.state === "in";
    var homeMine = m.home.espnId && mineSet[m.home.espnId];
    var awayMine = m.away.espnId && mineSet[m.away.espnId];
    var score = m.state === "pre"
      ? '<span class="fx-time">' + esc(shortDate(m.dateISO)) + "</span>"
      : '<span class="fx-score' + (live ? " live" : "") + '">' + (m.home.score == null ? "-" : m.home.score) +
        "<span class=fx-dash>–</span>" + (m.away.score == null ? "-" : m.away.score) + "</span>";
    return '<li class="fixture' + (live ? " is-live" : "") + '">' +
      '<span class="fx-team fx-home' + (homeMine ? " fx-mine" : "") + '">' +
        '<span class="fx-line">' + esc(hc ? hc.name : m.home.name) + flagImg(hc, m.home.logo, "flag-xs") + "</span>" +
        ownerLabel(ho, "right") +
      "</span>" +
      '<span class="fx-mid">' + score +
        (live ? '<span class="fx-status live">' + esc(m.statusShort) + "</span>"
              : m.completed ? '<span class="fx-status">FT</span>' : "") +
      "</span>" +
      '<span class="fx-team fx-away' + (awayMine ? " fx-mine" : "") + '">' +
        '<span class="fx-line">' + flagImg(ac, m.away.logo, "flag-xs") + esc(ac ? ac.name : m.away.name) + "</span>" +
        ownerLabel(ao, "left") +
      "</span>" +
      "</li>";
  }

  // ---------------------------------------------------------------------------
  // Shell render
  // ---------------------------------------------------------------------------

  var TABS = [
    { id: "wallchart", label: "Group Stage" },
    { id: "bracket", label: "Knockouts" },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "myteams", label: "My Teams" },
  ];

  function render() {
    var root = document.getElementById("app");
    var champ = analysis.champion;

    var header = '<header class="site-header">' +
      '<div class="brand">' +
      '<div class="brand-kicker">FIFA World Cup 2026 · USA · Canada · Mexico</div>' +
      "<h1>" + esc(SWEEP.titles.main) + "</h1>" +
      '<div class="brand-sub">+ ' + esc(SWEEP.titles.side) + " side bet</div>" +
      "</div>" +
      '<div class="header-meta">' +
      '<div class="live-dot' + (hasLive() ? " on" : "") + '"></div>' +
      '<span class="updated">' + (state.lastUpdated ? "Updated " + timeAgo(state.lastUpdated) : "Loading…") + "</span>" +
      '<button id="refresh-btn" class="btn-refresh" title="Refresh now">↻</button>' +
      "</div>" +
      "</header>";

    var banner = "";
    if (state.error) {
      banner = '<div class="banner error">⚠ ' + esc(state.error) + "</div>";
    } else if (champ && champ.participant) {
      banner = '<div class="banner win">🏆 ' + esc(champ.canon.name) + " are World Champions — " +
        esc(champ.participant.name) + " wins " + fmtMoney(SWEEP.payouts.main) + ", " +
        esc(champ.participant.better) + " wins " + fmtMoney(SWEEP.payouts.side) + " (Sweepception)!</div>";
    }

    var tabs = '<nav class="tabs">' + TABS.map(function (t) {
      return '<button class="tab' + (state.tab === t.id ? " active" : "") + '" data-tab="' + t.id + '">' + esc(t.label) + "</button>";
    }).join("") + "</nav>";

    var body = '<main class="content">';
    if (state.loading && !state.groups.length) {
      body += '<div class="loading"><div class="spinner"></div><p>Loading live World Cup data…</p></div>';
    } else if (state.tab === "wallchart") {
      body += renderWallChart();
    } else if (state.tab === "bracket") {
      body += renderBracket();
    } else if (state.tab === "leaderboard") {
      body += renderLeaderboard();
    } else if (state.tab === "myteams") {
      body += renderMyTeams();
    }
    body += "</main>";

    var footer = '<footer class="site-footer muted">' +
      "Live data from ESPN · auto-refreshes every 45s · not affiliated with FIFA" +
      "</footer>";

    root.innerHTML = header + banner + renderLiveNow() + tabs + body + footer;
    attachHandlers();
  }

  function attachHandlers() {
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (btn) {
      btn.addEventListener("click", function () {
        state.tab = btn.getAttribute("data-tab");
        localStorage.setItem("wc26.tab", state.tab);
        render();
      });
    });
    var refresh = document.getElementById("refresh-btn");
    if (refresh) refresh.addEventListener("click", function () { loadAll(true); });
    Array.prototype.forEach.call(document.querySelectorAll(".cm-tab"), function (btn) {
      btn.addEventListener("click", function () {
        state.feedMode = btn.getAttribute("data-feed");
        localStorage.setItem("wc26.feed", state.feedMode);
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".feed-match"), function (btn) {
      btn.addEventListener("click", function () {
        state.selectedMatchId = btn.getAttribute("data-match");
        refreshFeed();
        render();
      });
    });
    var sel = document.getElementById("person-select");
    if (sel) sel.addEventListener("change", function () {
      state.person = sel.value;
      localStorage.setItem("wc26.person", state.person);
      render();
    });
  }

  function hasLive() {
    return state.matches.some(function (m) { return m.state === "in"; });
  }

  function timeAgo(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return "just now";
    if (s < 60) return s + "s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + "m ago";
    return Math.round(m / 60) + "h ago";
  }

  // ---------------------------------------------------------------------------
  // Data loading + polling
  // ---------------------------------------------------------------------------

  function mergeTodayMatches(today) {
    var byId = {};
    state.matches.forEach(function (m) { byId[m.id] = m; });
    today.forEach(function (m) { if (m.home && m.away) byId[m.id] = m; });
    state.matches = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      return new Date(a.dateISO) - new Date(b.dateISO);
    });
  }

  // All matches currently in play (sorted by kickoff, as state.matches is).
  function liveMatches() {
    return state.matches.filter(function (m) {
      return m.state === "in" && m.home && m.away;
    });
  }

  // The live match the feed follows: the user's selection if still live,
  // otherwise the first live match.
  function activeFeedMatch() {
    var live = liveMatches();
    if (!live.length) return null;
    if (state.selectedMatchId) {
      var sel = live.filter(function (m) { return m.id === state.selectedMatchId; })[0];
      if (sel) return sel;
    }
    return live[0];
  }

  // Pull the live feed (commentary + key events) for the active live match;
  // clear it when nothing is live.
  function refreshFeed() {
    var m = activeFeedMatch();
    if (!m) {
      if (state.feed.eventId || state.feed.commentary.length || state.feed.keyEvents.length) {
        state.feed = { eventId: null, commentary: [], keyEvents: [] };
        render();
      }
      return;
    }
    espn.fetchMatchFeed(m.id).then(function (feed) {
      state.feed = { eventId: m.id, commentary: feed.commentary, keyEvents: feed.keyEvents };
      render();
    });
  }

  function loadAll(force) {
    state.error = "";
    if (force) { state.loading = true; render(); }
    return Promise.all([espn.fetchStandings(), espn.fetchAllMatches()])
      .then(function (res) {
        state.groups = res[0] || [];
        state.matches = res[1] || [];
        state.loading = false;
        state.lastUpdated = Date.now();
        rebuildAnalysis();
        render();
        refreshFeed();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = "Couldn't reach the live data feed. Retrying shortly… (" + err.message + ")";
        render();
      });
  }

  function poll() {
    Promise.all([espn.fetchStandings(), espn.fetchTodayMatches()])
      .then(function (res) {
        if (res[0] && res[0].length) state.groups = res[0];
        if (res[1]) mergeTodayMatches(res[1]);
        state.lastUpdated = Date.now();
        state.error = "";
        rebuildAnalysis();
        render();
        refreshFeed();
      })
      .catch(function () { /* keep showing last good data */ });
  }

  // Boot
  render();
  loadAll(false).then(function () {
    setInterval(poll, 45000);
    // Refresh the "updated Xs ago" label periodically
    setInterval(function () {
      var el = document.querySelector(".updated");
      if (el && state.lastUpdated) el.textContent = "Updated " + timeAgo(state.lastUpdated);
    }, 15000);
  });
})();
