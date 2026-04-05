import type {
  MatchResult,
  MatchAnalysis,
  RuleResult,
  TeamEnergyCard,
  TeamFlag,
} from "./types";

export function buildEnergyCards(results: MatchResult[]): Map<string, TeamEnergyCard> {
  const cards = new Map<string, TeamEnergyCard>();

  for (const match of results) {
    const homeCard = cards.get(match.home) ?? emptyCard(match.home);
    homeCard.lastHomeScore = match.homeScore;
    homeCard.lastHomeDate = match.date;
    homeCard.lastHomeSlot = match.slot;
    homeCard.lastGoalsScored = match.homeScore;
    homeCard.lastGoalsConceded = match.awayScore;
    homeCard.lastHomeTotalGoals = match.homeScore + match.awayScore;
    cards.set(match.home, homeCard);

    const awayCard = cards.get(match.away) ?? emptyCard(match.away);
    awayCard.lastAwayScore = match.awayScore;
    awayCard.lastAwayDate = match.date;
    awayCard.lastAwaySlot = match.slot;
    awayCard.lastGoalsScored = match.awayScore;
    awayCard.lastGoalsConceded = match.homeScore;
    awayCard.lastAwayTotalGoals = match.homeScore + match.awayScore;
    cards.set(match.away, awayCard);
  }

  for (const [, card] of cards) {
    card.flags = computeFlags(card);
  }

  return cards;
}

function emptyCard(team: string): TeamEnergyCard {
  return {
    team,
    lastHomeScore: null,
    lastAwayScore: null,
    lastHomeDate: null,
    lastAwayDate: null,
    lastHomeSlot: null,
    lastAwaySlot: null,
    lastGoalsConceded: null,
    lastGoalsScored: null,
    lastHomeTotalGoals: null,
    lastAwayTotalGoals: null,
    flags: [],
  };
}

function computeFlags(card: TeamEnergyCard): TeamFlag[] {
  const flags: TeamFlag[] = [];

  if (card.lastHomeScore === null && card.lastAwayScore === null) {
    flags.push("UNKNOWN");
    return flags;
  }

  if (card.lastHomeScore === 0) flags.push("HOME_ZERO_TRAP");
  if (card.lastAwayScore === 0) flags.push("AWAY_ZERO_TRAP");
  if (card.lastGoalsScored !== null && card.lastGoalsScored >= 3) flags.push("COOLDOWN");
  if (card.lastGoalsConceded !== null && card.lastGoalsConceded >= 4) flags.push("REPAIR");

  if (card.lastAwayScore === 1) flags.push("LOW_AWAY_ENERGY");
  if (card.lastHomeScore === 1) flags.push("LOW_HOME_ENERGY");

  if (flags.length === 0) flags.push("CLEAN");

  return flags;
}

export function analyzeMatch(
  homeTeam: string,
  awayTeam: string,
  slot: string,
  date: string,
  yesterdayResults: MatchResult[]
): MatchAnalysis {
  const energyCards = buildEnergyCards(yesterdayResults);
  const homeCard = energyCards.get(homeTeam);
  const awayCard = energyCards.get(awayTeam);

  const yesterdayRules = evaluateYesterdayRules(homeTeam, awayTeam, homeCard, awayCard, yesterdayResults);

  const instantSkipResult = checkInstantSkips(homeCard, awayCard, homeTeam, awayTeam, yesterdayResults);

  let yesterdayScore = 0;

  if (!instantSkipResult.skip) {
    yesterdayScore = Math.min(20, yesterdayRules.reduce((s, r) => s + r.points, 0));
  }

  const decision = resolveDecision(yesterdayScore, instantSkipResult.skip);
  const confidence = resolveConfidence(yesterdayScore, instantSkipResult.skip);

  return {
    homeTeam,
    awayTeam,
    slot,
    date,
    yesterdayScore,
    jsonScore: 0,
    totalScore: yesterdayScore,
    decision,
    confidence,
    instantSkip: instantSkipResult.skip,
    instantSkipReason: instantSkipResult.reason,
    yesterdayRules,
    jsonRules: [],
  };
}

function checkInstantSkips(
  homeCard: TeamEnergyCard | undefined,
  awayCard: TeamEnergyCard | undefined,
  homeTeam: string,
  awayTeam: string,
  yesterdayResults: MatchResult[]
): { skip: boolean; reason: string | null } {
  
  // Skip 1: Zero trap
  if (homeCard?.flags.includes("HOME_ZERO_TRAP")) {
    return { skip: true, reason: `${homeTeam} scored 0 at home yesterday` };
  }
  if (awayCard?.flags.includes("AWAY_ZERO_TRAP")) {
    return { skip: true, reason: `${awayTeam} scored 0 away yesterday` };
  }

  // Skip 2: Repair mode (conceded 4+)
  if (homeCard?.flags.includes("REPAIR")) {
    return { skip: true, reason: `${homeTeam} conceded 4+` };
  }
  if (awayCard?.flags.includes("REPAIR")) {
    return { skip: true, reason: `${awayTeam} conceded 4+` };
  }

  // Skip 3: Cooldown (scored 3+) - but now we allow it (high scoring)
  // REMOVED - cooldown teams actually score

  // NEW PATTERN: Score compression - after high score, flip position = under
  // Home team scored 3+ at home, now playing away
  if (homeCard && homeCard.lastHomeScore !== null && homeCard.lastHomeScore >= 3) {
    const hasAwayHistory = homeCard.lastAwayDate !== null;
    if (!hasAwayHistory) {
      return {
        skip: true,
        reason: `${homeTeam} scored ${homeCard.lastHomeScore} at home, now away — score compression`,
      };
    }
  }

  // Away team scored 3+ away, now playing home
  if (awayCard && awayCard.lastAwayScore !== null && awayCard.lastAwayScore >= 3) {
    const hasHomeHistory = awayCard.lastHomeDate !== null;
    if (!hasHomeHistory) {
      return {
        skip: true,
        reason: `${awayTeam} scored ${awayCard.lastAwayScore} away, now home — score compression`,
      };
    }
  }

  // NEW PATTERN: Position flip - high score at home, now away = under
  if (homeCard?.lastHomeDate !== null && homeCard?.lastAwayDate === null) {
    const homePrevHome = homeCard?.lastHomeScore ?? 0;
    if (homePrevHome >= 2) {
      return {
        skip: true,
        reason: `${homeTeam} scored ${homePrevHome} at home, now away — position flip risk`,
      };
    }
  }

  // Away team scored high, now home
  if (awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null) {
    const awayPrevAway = awayCard?.lastAwayScore ?? 0;
    if (awayPrevAway >= 2) {
      return {
        skip: true,
        reason: `${awayTeam} scored ${awayPrevAway} away, now home — position flip risk`,
      };
    }
  }

  // NEW PATTERN: Both low total goals in same position
  const bothHomeLow = homeCard?.lastHomeDate !== null && awayCard?.lastHomeDate !== null;
  if (bothHomeLow) {
    const homeTotal = homeCard?.lastHomeTotalGoals ?? 0;
    const awayTotal = awayCard?.lastHomeTotalGoals ?? 0;
    if (homeTotal <= 1 && awayTotal <= 1) {
      return {
        skip: true,
        reason: `Both low total at home (${homeTotal}, ${awayTotal})`,
      };
    }
  }

  const bothAwayLow = homeCard?.lastAwayDate !== null && awayCard?.lastAwayDate !== null;
  if (bothAwayLow) {
    const homeTotal = homeCard?.lastAwayTotalGoals ?? 0;
    const awayTotal = awayCard?.lastAwayTotalGoals ?? 0;
    if (homeTotal <= 1 && awayTotal <= 1) {
      return {
        skip: true,
        reason: `Both low total away (${homeTotal}, ${awayTotal})`,
      };
    }
  }

  // NEW PATTERN: Same fixture repeat with low score
  const sameFixture = yesterdayResults.find(
    (r) =>
      ((r.home === homeTeam && r.away === awayTeam) ||
        (r.home === awayTeam && r.away === homeTeam))
  );
  if (sameFixture) {
    const total = sameFixture.homeScore + sameFixture.awayScore;
    if (total <= 1) {
      return { skip: true, reason: `Same fixture yesterday scored ${total}` };
    }
  }

  // NEW PATTERN: Double position switch with high scores = unstable
  const homeSwitched = (homeCard?.lastHomeDate !== null && homeCard?.lastAwayDate === null) ||
    (homeCard?.lastAwayDate !== null && homeCard?.lastHomeDate === null);
  const awaySwitched = (awayCard?.lastHomeDate !== null && awayCard?.lastAwayDate === null) ||
    (awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null);
  if (homeSwitched && awaySwitched) {
    const homePrev = homeCard?.lastHomeScore ?? homeCard?.lastAwayScore ?? 0;
    const awayPrev = awayCard?.lastHomeScore ?? awayCard?.lastAwayScore ?? 0;
    if (homePrev >= 2 && awayPrev >= 2) {
      return {
        skip: true,
        reason: `Both scored 2+ but switched positions`,
      };
    }
  }

  // NEW PATTERN: Both drew (1:1 or 2:2) = draw trap
  const homeDrew = homeCard && 
    homeCard.lastGoalsScored !== null && 
    homeCard.lastGoalsConceded !== null &&
    homeCard.lastGoalsScored === homeCard.lastGoalsConceded;
  const awayDrew = awayCard && 
    awayCard.lastGoalsScored !== null && 
    awayCard.lastGoalsConceded !== null &&
    awayCard.lastGoalsScored === awayCard.lastGoalsConceded;
  if (homeDrew && awayDrew) {
    return {
      skip: true,
      reason: "Both teams drew yesterday — draw trap",
    };
  }

  return { skip: false, reason: null };
}

function evaluateYesterdayRules(
  homeTeam: string,
  awayTeam: string,
  homeCard: TeamEnergyCard | undefined,
  awayCard: TeamEnergyCard | undefined,
  yesterdayResults: MatchResult[]
): RuleResult[] {
  const rules: RuleResult[] = [];

  // A1 — Home team scored at home
  const homeScored = (homeCard?.lastHomeScore ?? 0) >= 1;
  rules.push({
    rule: "A1",
    label: "Home Team Scored",
    passed: homeScored,
    points: homeScored ? 2 : 0,
    maxPoints: 2,
    detail: homeScored
      ? `${homeTeam} scored ${homeCard?.lastHomeScore} at home`
      : `${homeTeam} scored 0 at home`,
  });

  // A2 — Away team scored
  const awayScored = (awayCard?.lastAwayScore ?? 0) >= 1;
  rules.push({
    rule: "A2",
    label: "Away Team Scored",
    passed: awayScored,
    points: awayScored ? 2 : 0,
    maxPoints: 2,
    detail: awayScored
      ? `${awayTeam} scored ${awayCard?.lastAwayScore} away`
      : `${awayTeam} scored 0 away`,
  });

  // A3 — Both teams scored (most important - OVER indicator)
  const bothScored = homeScored && awayScored;
  rules.push({
    rule: "A3",
    label: "Both Teams Scored",
    passed: bothScored,
    points: bothScored ? 4 : 0,
    maxPoints: 4,
    detail: bothScored
      ? "Both scored - high OVER probability"
      : "One or both failed to score",
  });

  // A4 — Total goals from both teams in last match >= 2
  const homeTotal = homeCard?.lastHomeTotalGoals ?? 0;
  const awayTotal = awayCard?.lastAwayTotalGoals ?? 0;
  const totalGoalsOk = (homeTotal + awayTotal) >= 2;
  rules.push({
    rule: "A4",
    label: "Total Goals >= 2",
    passed: totalGoalsOk,
    points: totalGoalsOk ? 2 : 0,
    maxPoints: 2,
    detail: `Total: ${homeTotal + awayTotal} goals`,
  });

  // A5 — No repair mode
  const homeRepair = homeCard?.flags.includes("REPAIR") ?? false;
  const awayRepair = awayCard?.flags.includes("REPAIR") ?? false;
  const noRepair = !homeRepair && !awayRepair;
  rules.push({
    rule: "A5",
    label: "No Repair Mode",
    passed: noRepair,
    points: noRepair ? 1 : 0,
    maxPoints: 1,
    detail: noRepair ? "No defense issues" : "Defense concerns",
  });

  // A6 — High scoring (cooldown = strong attack)
  const homeCooldown = homeCard?.flags.includes("COOLDOWN") ?? false;
  const awayCooldown = awayCard?.flags.includes("COOLDOWN") ?? false;
  rules.push({
    rule: "A6",
    label: "High Scoring Form",
    passed: homeCooldown || awayCooldown,
    points: (homeCooldown || awayCooldown) ? 3 : 0,
    maxPoints: 3,
    detail: homeCooldown || awayCooldown ? "Strong attack - OVER likely" : "Normal scoring",
  });

  // A7 — Both have data
  const homeHasData = homeCard?.lastHomeDate !== null || homeCard?.lastAwayDate !== null;
  const awayHasData = awayCard?.lastHomeDate !== null || awayCard?.lastAwayDate !== null;
  const bothHaveData = homeHasData && awayHasData;
  rules.push({
    rule: "A7",
    label: "Both Have History",
    passed: bothHaveData,
    points: bothHaveData ? 2 : 0,
    maxPoints: 2,
    detail: bothHaveData ? "Reliable data" : "Limited data",
  });

  // A8 — POSITIVE: Away team won away (momentum carry)
  const awayWonAway = awayCard && awayCard.lastAwayScore !== null && 
                      awayCard.lastAwayScore >= 1 && 
                      (awayCard.lastGoalsScored ?? 0) > (awayCard.lastGoalsConceded ?? 0);
  rules.push({
    rule: "A8",
    label: "Away Win Momentum",
    passed: !!awayWonAway,
    points: awayWonAway ? 2 : 0,
    maxPoints: 2,
    detail: awayWonAway ? "Away winner carries momentum" : "No away win momentum",
  });

  // A9 — POSITIVE: Home team won at home (strong home form)
  const homeWonHome = homeCard && homeCard.lastHomeScore !== null && 
                      homeCard.lastHomeScore >= 1 &&
                      (homeCard.lastGoalsScored ?? 0) > (homeCard.lastGoalsConceded ?? 0);
  rules.push({
    rule: "A9",
    label: "Home Win Form",
    passed: !!homeWonHome,
    points: homeWonHome ? 2 : 0,
    maxPoints: 2,
    detail: homeWonHome ? "Strong home form" : "No strong home form",
  });

  // A10 — POSITIVE: Both teams scored in DIFFERENT positions (balanced attack)
  const homeScoredAway = (homeCard?.lastAwayScore ?? 0) >= 1;
  const awayScoredHome = (awayCard?.lastHomeScore ?? 0) >= 1;
  const mixedScoring = (homeScored && awayScoredHome) || (awayScored && homeScoredAway);
  rules.push({
    rule: "A10",
    label: "Mixed Position Scoring",
    passed: mixedScoring,
    points: mixedScoring ? 2 : 0,
    maxPoints: 2,
    detail: mixedScoring ? "Both score in different positions - OVER likely" : "Limited mixed scoring",
  });

  return rules;
}

function resolveDecision(yesterdayScore: number, instantSkip: boolean): MatchAnalysis["decision"] {
  if (instantSkip) return "SKIP";
  if (yesterdayScore >= 14) return "LOCK";
  if (yesterdayScore >= 9) return "PICK";
  if (yesterdayScore >= 5) return "CONSIDER";
  return "SKIP";
}

function resolveConfidence(yesterdayScore: number, instantSkip: boolean): MatchAnalysis["confidence"] {
  if (instantSkip) return "LOW";
  if (yesterdayScore >= 14) return "HIGH";
  if (yesterdayScore >= 9) return "MEDIUM";
  return "LOW";
}

export function analyzeSlot(
  todayFixtures: { home: string; away: string }[],
  slot: string,
  date: string,
  yesterdayResults: MatchResult[]
): MatchAnalysis[] {
  return todayFixtures.map((fixture) => {
    return analyzeMatch(fixture.home, fixture.away, slot, date, yesterdayResults);
  });
}

export function parseResultsText(text: string, date: string, slot: string): MatchResult[] {
  const results: MatchResult[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^([A-Z]{2,5})\s+(\d+)[:\-\s](\d+)\s+([A-Z]{2,5})$/i);
    if (match) {
      const [, home, homeScore, awayScore, away] = match;
      results.push({
        home: home.toUpperCase(),
        away: away.toUpperCase(),
        homeScore: parseInt(homeScore),
        awayScore: parseInt(awayScore),
        totalGoals: parseInt(homeScore) + parseInt(awayScore),
        slot,
        date,
      });
    }
  }

  return results;
}