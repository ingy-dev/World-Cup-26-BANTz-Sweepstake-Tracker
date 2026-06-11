/*
 * The sweepstake draw - the single source of truth for the tracker.
 *
 * participants[].teams reference team ids from src/data/teams.js
 * participants[].better is the person who drew this participant in the
 *   "Sweepception" side bet (secret-santa style).
 *
 * To update after a re-draw: edit this file and redeploy. Nothing else needed.
 */
(function () {
  window.WC = window.WC || {};

  window.WC.SWEEPSTAKE = {
    payouts: { main: 60, side: 30, currency: "GBP", symbol: "£" },
    titles: {
      main: "BANTz World Cup '26",
      side: "World Cup '26 Sweepception",
    },
    // A distinct colour per participant for owner chips / accents.
    participants: [
      { name: "Ingy",     color: "#e63946", teams: ["belgium", "austria", "ghana", "canada"],              better: "Pippa" },
      { name: "Prudence", color: "#f4a261", teams: ["uzbekistan", "ecuador", "south-africa", "uruguay"],    better: "Jonny" },
      { name: "Bernard",  color: "#2a9d8f", teams: ["curacao", "sweden", "colombia", "england"],            better: "Rosie" },
      { name: "Jethro",   color: "#e9c46a", teams: ["bosnia", "qatar", "paraguay", "jordan"],               better: "Conor" },
      { name: "Rachel",   color: "#8338ec", teams: ["spain", "panama", "brazil", "ivory-coast"],            better: "Jethro" },
      { name: "Rosie",    color: "#ff6b9d", teams: ["france", "scotland", "new-zealand", "netherlands"],    better: "Gemma" },
      { name: "Jonny",    color: "#3a86ff", teams: ["mexico", "tunisia", "egypt", "iraq"],                  better: "Bernard" },
      { name: "Sinclair", color: "#06d6a0", teams: ["argentina", "turkey", "australia", "switzerland"],     better: "Alice" },
      { name: "Stuart",   color: "#fb5607", teams: ["czechia", "south-korea", "japan", "morocco"],          better: "Ricki" },
      { name: "Ricki",    color: "#ffbe0b", teams: ["algeria", "croatia", "senegal", "portugal"],           better: "Rachel" },
      { name: "Gemma",    color: "#4cc9f0", teams: ["norway", "usa", "iran", "saudi-arabia"],               better: "Sinclair" },
      { name: "Pippa",    color: "#c1121f", teams: ["haiti", "germany", "cape-verde", "dr-congo"],          better: "Ingy" },
    ],
  };
})();
