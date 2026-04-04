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
    homeCard.lastGoalsConceeded = match.awayScore;
    cards.set(match.home, homeCard);

    const awayCard = cards.get(match.away) ?? emptyCard(match.away);
    awayCard.lastAwayScore = match.awayScore;
    awayCard.lastAwayDate = match.date;
    awayCard.lastAwaySlot = match.slot;
    awayCard.lastGoalsScored = match.awayScore;
    awayCard.lastGoalsConceeded = match.homeScore;
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
    lastGoalsConceeded: null,
    lastGoalsScored: null,
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
  if (card.lastGoalsConceeded !== null && card.lastGoalsConceeded >= 4) flags.push("REPAIR");

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
    yesterdayScore = Math.min(18, yesterdayRules.reduce((s, r) => s + r.points, 0));
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
    return { skip: true, reason: `${homeTeam} scored 0 at home yesterday — zero trap` };
  }
  if (awayCard?.flags.includes("AWAY_ZERO_TRAP")) {
    return { skip: true, reason: `${awayTeam} scored 0 away yesterday — zero trap` };
  }

  // Skip 2: Repair mode
  if (homeCard?.flags.includes("REPAIR")) {
    return { skip: true, reason: `${homeTeam} in REPAIR MODE (conceded 4+)` };
  }
  if (awayCard?.flags.includes("REPAIR")) {
    return { skip: true, reason: `${awayTeam} in REPAIR MODE (conceded 4+)` };
  }

  // Skip 3: Cooldown
  if (homeCard?.flags.includes("COOLDOWN")) {
    return { skip: true, reason: `${homeTeam} in COOLDOWN (scored 3+)` };
  }
  if (awayCard?.flags.includes("COOLDOWN")) {
    return { skip: true, reason: `${awayTeam} in COOLDOWN (scored 3+)` };
  }

  // Skip 8: Both teams played AWAY yesterday and both scored ≤1
  const homeWasAway = homeCard?.lastAwayDate !== null && homeCard?.lastHomeDate === null;
  const awayWasAway = awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null;
  if (homeWasAway && awayWasAway) {
    const homeAwayScore = homeCard?.lastAwayScore ?? 0;
    const awayAwayScore = awayCard?.lastAwayScore ?? 0;
    if (homeAwayScore <= 1 && awayAwayScore <= 1) {
      return {
        skip: true,
        reason: `Both teams scored ≤1 away yesterday (${homeTeam}: ${homeAwayScore}, ${awayTeam}: ${awayAwayScore})`,
      };
    }
  }

  // Skip 13: Home team was AWAY yesterday with ≤1, now HOME
  const homeSwitchedFromAway =
    homeCard?.lastAwayDate !== null && homeCard?.lastHomeDate === null;
  if (homeSwitchedFromAway) {
    const homePrevAwayScore = homeCard?.lastAwayScore ?? 0;
    if (homePrevAwayScore <= 1) {
      return {
        skip: true,
        reason: `${homeTeam} scored ${homePrevAwayScore} away yesterday, now HOME — position switch low energy`,
      };
    }
  }

  // Skip 14: Strong home (2+) switching to AWAY vs weak away (≤1) switching to HOME
  const homeSwitchedFromHome =
    homeCard?.lastHomeDate !== null && homeCard?.lastAwayDate === null;
  const awaySwitchedFromAway =
    awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null;
  if (homeSwitchedFromHome && awaySwitchedFromAway) {
    const homePrevHomeScore = homeCard?.lastHomeScore ?? 0;
    const awayPrevAwayScore = awayCard?.lastAwayScore ?? 0;
    if (homePrevHomeScore >= 2 && awayPrevAwayScore <= 1) {
      return {
        skip: true,
        reason: `${homeTeam} scored ${homePrevHomeScore} at home → away, ${awayTeam} scored ${awayPrevAwayScore} away → home — overconfidence trap`,
      };
    }
  }

  // Skip 15: Away team scored 1 at home yesterday, now AWAY
  const awaySwitchedFromHome =
    awayCard?.lastHomeDate !== null && awayCard?.lastAwayDate === null;
  if (awaySwitchedFromHome) {
    const awayPrevHomeScore = awayCard?.lastHomeScore ?? 0;
    if (awayPrevHomeScore === 1) {
      return {
        skip: true,
        reason: `${awayTeam} scored 1 at home yesterday, now AWAY — weak form in both positions`,
      };
    }
  }

  // Skip 17: Both teams played HOME yesterday and both scored ≤1
  const bothHome = homeCard?.lastHomeDate !== null && awayCard?.lastHomeDate !== null;
  if (bothHome) {
    const homePrevHomeScore = homeCard?.lastHomeScore ?? 0;
    const awayPrevHomeScore = awayCard?.lastHomeScore ?? 0;
    if (homePrevHomeScore <= 1 && awayPrevHomeScore <= 1) {
      return {
        skip: true,
        reason: `Both teams scored ≤1 at home yesterday (${homeTeam}: ${homePrevHomeScore}, ${awayTeam}: ${awayPrevHomeScore})`,
      };
    }
  }

  // Skip 18: Both teams scored 2+ yesterday but BOTH switched positions
  const homeSwitched = (homeCard?.lastHomeDate !== null && homeCard?.lastAwayDate === null) ||
    (homeCard?.lastAwayDate !== null && homeCard?.lastHomeDate === null);
  const awaySwitched = (awayCard?.lastHomeDate !== null && awayCard?.lastAwayDate === null) ||
    (awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null);
  if (homeSwitched && awaySwitched) {
    const homePrevScore = homeCard?.lastHomeScore ?? homeCard?.lastAwayScore ?? 0;
    const awayPrevScore = awayCard?.lastHomeScore ?? awayCard?.lastAwayScore ?? 0;
    if (homePrevScore >= 2 && awayPrevScore >= 2) {
      return {
        skip: true,
        reason: `Both scored 2+ yesterday but switched positions — double position switch`,
      };
    }
  }

  // Skip 19: Home team scored 2+ AWAY yesterday, now HOME with ≤1
  const homeStrongAwayToWeakHome =
    homeCard?.lastAwayDate !== null && homeCard?.lastHomeDate === null;
  if (homeStrongAwayToWeakHome) {
    const homePrevAway = homeCard?.lastAwayScore ?? 0;
    const homePrevHome = homeCard?.lastHomeScore;
    if (homePrevAway >= 2 && (homePrevHome === null || homePrevHome <= 1)) {
      return {
        skip: true,
        reason: `${homeTeam} scored ${homePrevAway} away → now HOME (${homePrevHome ?? 0}) — strong-away-to-weak-home`,
      };
    }
  }

  // Skip 20: Both same position yesterday with both 2+, both low today
  const bothHomeS20 = homeCard?.lastHomeDate !== null && awayCard?.lastHomeDate !== null;
  const bothAwayS20 = homeCard?.lastAwayDate !== null && awayCard?.lastAwayDate !== null;
  if (bothHomeS20 || bothAwayS20) {
    const homePrevSame = bothHomeS20 ? (homeCard?.lastHomeScore ?? 0) : (homeCard?.lastAwayScore ?? 0);
    const awayPrevSame = bothAwayS20 ? (awayCard?.lastHomeScore ?? 0) : (awayCard?.lastAwayScore ?? 0);
    if (homePrevSame >= 2 && awayPrevSame >= 2) {
      return {
        skip: true,
        reason: `Both scored 2+ in same position yesterday — high-form collapse trap`,
      };
    }
  }

  // Skip 6: Same fixture yesterday with ≤1 total goal
  const sameFixture = yesterdayResults.find(
    (r) =>
      ((r.home === homeTeam && r.away === awayTeam) ||
        (r.home === awayTeam && r.away === homeTeam))
  );
  if (sameFixture) {
    const total = sameFixture.homeScore + sameFixture.awayScore;
    if (total <= 1) {
      return { skip: true, reason: `Same fixture yesterday scored only ${total} total goals` };
    }
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

  // A1 — Home zero trap clear
  const homeZero = homeCard?.lastHomeScore === 0;
  rules.push({
    rule: "A1",
    label: "Home Zero Trap Clear",
    passed: !homeZero,
    points: !homeZero ? 3 : 0,
    maxPoints: 3,
    detail: homeZero
      ? `${homeTeam} scored 0 at home`
      : `${homeTeam} scored ${homeCard?.lastHomeScore ?? "?"} at home — clear`,
  });

  // A2 — Away zero trap clear
  const awayZero = awayCard?.lastAwayScore === 0;
  rules.push({
    rule: "A2",
    label: "Away Zero Trap Clear",
    passed: !awayZero,
    points: !awayZero ? 3 : 0,
    maxPoints: 3,
    detail: awayZero
      ? `${awayTeam} scored 0 away`
      : `${awayTeam} scored ${awayCard?.lastAwayScore ?? "?"} away — clear`,
  });

  // A3 — Position switch zero trap
  const homeSwitchedFromAway = homeCard?.lastAwayScore === 0 && homeCard?.lastHomeScore === null;
  const awaySwitchedFromHome = awayCard?.lastHomeScore === 0 && awayCard?.lastAwayScore === null;
  const switchZeroClear = !homeSwitchedFromAway && !awaySwitchedFromHome;
  rules.push({
    rule: "A3",
    label: "Position Switch Zero Clear",
    passed: switchZeroClear,
    points: switchZeroClear ? 2 : 0,
    maxPoints: 2,
    detail: switchZeroClear
      ? "No position-switched zero trap"
      : `Position switch zero: ${homeSwitchedFromAway ? homeTeam : awayTeam}`,
  });

  // A4 — No cooldown or repair
  const hasCooldown = homeCard?.flags.includes("COOLDOWN") || awayCard?.flags.includes("COOLDOWN");
  const hasRepair = homeCard?.flags.includes("REPAIR") || awayCard?.flags.includes("REPAIR");
  const a4Pass = !hasCooldown && !hasRepair;
  rules.push({
    rule: "A4",
    label: "No Cooldown / Repair",
    passed: a4Pass,
    points: a4Pass ? 3 : 0,
    maxPoints: 3,
    detail: a4Pass
      ? "Neither team on cooldown or repair"
      : `${hasCooldown ? "COOLDOWN" : "REPAIR"} active`,
  });

  // A5 — Same pair repeat check
  const samePair = yesterdayResults.find(
    (r) =>
      (r.home === homeTeam && r.away === awayTeam) ||
      (r.home === awayTeam && r.away === homeTeam)
  );
  let a6Pass = true;
  let a6Detail = "No same-pair repeat";
  if (samePair) {
    const total = samePair.homeScore + samePair.awayScore;
    if (total <= 1) {
      a6Pass = false;
      a6Detail = `Same pair: ${samePair.homeScore}:${samePair.awayScore} (${total} goals)`;
    } else {
      a6Detail = `Same pair: ${samePair.homeScore}:${samePair.awayScore} — acceptable`;
    }
  }
  rules.push({
    rule: "A5",
    label: "Same Pair Repeat Check",
    passed: a6Pass,
    points: a6Pass ? 2 : 0,
    maxPoints: 2,
    detail: a6Detail,
  });

  // A6 — Both teams home yesterday
  const bothHome = homeCard?.lastHomeDate !== null && awayCard?.lastHomeDate !== null;
  if (bothHome) {
    const bothScored = (homeCard?.lastHomeScore ?? 0) >= 1 && (awayCard?.lastHomeScore ?? 0) >= 1;
    rules.push({
      rule: "A6",
      label: "Both Teams Home Yesterday Scored",
      passed: bothScored,
      points: bothScored ? 2 : 0,
      maxPoints: 2,
      detail: bothScored
        ? `${homeTeam}: ${homeCard?.lastHomeScore}, ${awayTeam}: ${awayCard?.lastHomeScore} at home`
        : "One or both scored 0 at home",
    });
  }

  // A7 — Both teams away yesterday
  const homeWasAwayOnly = homeCard?.lastAwayDate !== null && homeCard?.lastHomeDate === null;
  const awayWasAwayOnly = awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null;
  if (homeWasAwayOnly && awayWasAwayOnly) {
    const homeAway = homeCard?.lastAwayScore ?? 0;
    const awayAway = awayCard?.lastAwayScore ?? 0;
    const bothScored2Plus = homeAway >= 2 && awayAway >= 2;
    const onlyOneStrong = (homeAway >= 2 && awayAway === 1) || (homeAway === 1 && awayAway >= 2);
    const bothLow = homeAway <= 1 && awayAway <= 1;
    const a7Points = bothScored2Plus ? 2 : onlyOneStrong ? 1 : 0;
    rules.push({
      rule: "A7",
      label: "Both Teams Away Yesterday — Energy Check",
      passed: !bothLow,
      points: a7Points,
      maxPoints: 2,
      detail: bothLow
        ? `DANGER: Both scored ≤1 away (${homeTeam}: ${homeAway}, ${awayTeam}: ${awayAway})`
        : bothScored2Plus
        ? `Both scored 2+ away — strong`
        : `Mixed: ${homeTeam}: ${homeAway}, ${awayTeam}: ${awayAway}`,
    });
  } else if (homeCard?.lastAwayDate !== null || awayCard?.lastAwayDate !== null) {
    const awayTeamAwayScore = awayCard?.lastAwayScore ?? null;
    if (awayTeamAwayScore !== null) {
      const passed = awayTeamAwayScore >= 1;
      rules.push({
        rule: "A7",
        label: "Away Team Away Score Yesterday",
        passed,
        points: passed ? (awayTeamAwayScore >= 2 ? 2 : 1) : 0,
        maxPoints: 2,
        detail: `${awayTeam} scored ${awayTeamAwayScore} away yesterday`,
      });
    }
  }

  // A8 — Unknown team energy check
  const homeUnknown = homeCard?.flags.includes("UNKNOWN") ?? true;
  const awayUnknown = awayCard?.flags.includes("UNKNOWN") ?? true;
  if (homeUnknown || awayUnknown) {
    const unknownTeams = [homeUnknown ? homeTeam : null, awayUnknown ? awayTeam : null]
      .filter(Boolean)
      .join(", ");
    rules.push({
      rule: "A8",
      label: "Unknown Team Energy",
      passed: false,
      points: 0,
      maxPoints: 3,
      detail: `${unknownTeams} — no yesterday data`,
    });
  } else {
    rules.push({
      rule: "A8",
      label: "Both Teams Have Yesterday Data",
      passed: true,
      points: 3,
      maxPoints: 3,
      detail: `Both have same-slot history`,
    });
  }

  // A9 — Consecutive away low energy for away team
  const awayConsecutiveAway = awayCard?.lastAwayDate !== null && awayCard?.lastHomeDate === null;
  if (awayConsecutiveAway) {
    const a9AwayScore = awayCard?.lastAwayScore ?? 0;
    const consecutiveLow = a9AwayScore <= 1;
    rules.push({
      rule: "A9",
      label: "Consecutive Away Low Energy",
      passed: !consecutiveLow,
      points: consecutiveLow ? 0 : 2,
      maxPoints: 2,
      detail: consecutiveLow
        ? `TRAP: ${awayTeam} away both days (${a9AwayScore}) — low energy`
        : `${awayTeam} scored ${a9AwayScore} away yesterday — sufficient`,
    });
  }

  return rules;
}

function resolveDecision(yesterdayScore: number, instantSkip: boolean): MatchAnalysis["decision"] {
  if (instantSkip) return "SKIP";
  if (yesterdayScore >= 14) return "LOCK";
  if (yesterdayScore >= 10) return "PICK";
  if (yesterdayScore >= 6) return "CONSIDER";
  return "SKIP";
}

function resolveConfidence(yesterdayScore: number, instantSkip: boolean): MatchAnalysis["confidence"] {
  if (instantSkip) return "LOW";
  if (yesterdayScore >= 14) return "HIGH";
  if (yesterdayScore >= 10) return "MEDIUM";
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