/*
 * Canonical 48-team reference database for the WC26 sweepstake tracker.
 *
 * Each team has:
 *   id   - stable slug used by sweepstake.js to reference the team
 *   name - team name, matching ESPN's exact wording so live data maps 1:1
 *   flag - ISO 3166-1 alpha-2 code used for flagcdn.com images
 *          (England/Scotland use the GB sub-region codes)
 *
 * Matching to ESPN is by normalised name (see espn.js -> normalize).
 */
(function () {
  window.WC = window.WC || {};

  window.WC.TEAMS = [
    { id: "belgium", name: "Belgium", flag: "be" },
    { id: "austria", name: "Austria", flag: "at" },
    { id: "ghana", name: "Ghana", flag: "gh" },
    { id: "canada", name: "Canada", flag: "ca" },

    { id: "uzbekistan", name: "Uzbekistan", flag: "uz" },
    { id: "ecuador", name: "Ecuador", flag: "ec" },
    { id: "south-africa", name: "South Africa", flag: "za" },
    { id: "uruguay", name: "Uruguay", flag: "uy" },

    { id: "curacao", name: "Curaçao", flag: "cw" },
    { id: "sweden", name: "Sweden", flag: "se" },
    { id: "colombia", name: "Colombia", flag: "co" },
    { id: "england", name: "England", flag: "gb-eng" },

    { id: "bosnia", name: "Bosnia-Herzegovina", flag: "ba" },
    { id: "qatar", name: "Qatar", flag: "qa" },
    { id: "paraguay", name: "Paraguay", flag: "py" },
    { id: "jordan", name: "Jordan", flag: "jo" },

    { id: "spain", name: "Spain", flag: "es" },
    { id: "panama", name: "Panama", flag: "pa" },
    { id: "brazil", name: "Brazil", flag: "br" },
    { id: "ivory-coast", name: "Ivory Coast", flag: "ci" },

    { id: "france", name: "France", flag: "fr" },
    { id: "scotland", name: "Scotland", flag: "gb-sct" },
    { id: "new-zealand", name: "New Zealand", flag: "nz" },
    { id: "netherlands", name: "Netherlands", flag: "nl" },

    { id: "mexico", name: "Mexico", flag: "mx" },
    { id: "tunisia", name: "Tunisia", flag: "tn" },
    { id: "egypt", name: "Egypt", flag: "eg" },
    { id: "iraq", name: "Iraq", flag: "iq" },

    { id: "argentina", name: "Argentina", flag: "ar" },
    { id: "turkey", name: "Türkiye", flag: "tr" },
    { id: "australia", name: "Australia", flag: "au" },
    { id: "switzerland", name: "Switzerland", flag: "ch" },

    { id: "czechia", name: "Czechia", flag: "cz" },
    { id: "south-korea", name: "South Korea", flag: "kr" },
    { id: "japan", name: "Japan", flag: "jp" },
    { id: "morocco", name: "Morocco", flag: "ma" },

    { id: "algeria", name: "Algeria", flag: "dz" },
    { id: "croatia", name: "Croatia", flag: "hr" },
    { id: "senegal", name: "Senegal", flag: "sn" },
    { id: "portugal", name: "Portugal", flag: "pt" },

    { id: "norway", name: "Norway", flag: "no" },
    { id: "usa", name: "United States", flag: "us" },
    { id: "iran", name: "Iran", flag: "ir" },
    { id: "saudi-arabia", name: "Saudi Arabia", flag: "sa" },

    { id: "haiti", name: "Haiti", flag: "ht" },
    { id: "germany", name: "Germany", flag: "de" },
    { id: "cape-verde", name: "Cape Verde", flag: "cv" },
    { id: "dr-congo", name: "Congo DR", flag: "cd" },
  ];
})();
