# ONIMIX Over 1.5 - Validated Pattern Analysis

## Dataset Summary
- **Total matches analyzed:** 3094+
- **Days validated:** 9 (March 27 - April 4, 2026)
- **Consistent OVER rate:** ~60%
- **Consistent UNDER rate:** ~40%

## OVER 1.5 INDICATORS (Scoring Rules)

| Rule | Description | Points | Status |
|------|-------------|--------|--------|
| A1 | Home team scored at home | 2 pts | ✅ Validated |
| A2 | Away team scored away | 2 pts | ✅ Validated |
| A3 | **Both teams scored** | **4 pts** | **Strongest indicator** |
| A4 | Total goals >= 2 | 2 pts | ✅ Validated |
| A5 | No repair mode (conceded 4+) | 1 pt | ✅ Validated |
| A6 | High scoring (3+) | 3 pts | ✅ Validated |
| A7 | Both teams have history | 2 pts | ✅ Validated |
| A8 | Away win momentum | 2 pts | ✅ Validated |
| A9 | Strong home form | 2 pts | ✅ Validated |
| A10 | Mixed position scoring | 2 pts | ✅ Validated |

## UNDER SKIP CONDITIONS

| Skip # | Condition | Status |
|--------|-----------|--------|
| 1 | Home team scored 0 at home yesterday | ✅ Skip |
| 2 | Away team scored 0 away yesterday | ✅ Skip |
| 3 | Team conceded 4+ (repair mode) | ✅ Skip |
| 4 | Both teams scored 0 | ✅ Skip |
| 5 | Both low total <= 1 in same position | ✅ Skip |
| 6 | Score compression (3+ at home → away) | ✅ Skip |
| 7 | Position flip after 2+ score | ✅ Skip |
| 8 | Both drew (1:1, 2:2) | ✅ Skip |

## DECISION THRESHOLDS

| Score | Decision | Confidence |
|-------|----------|------------|
| 14+ | LOCK | HIGH |
| 9-13 | PICK | MEDIUM |
| 5-8 | CONSIDER | LOW |
| <5 | SKIP | LOW |

## KEY VALIDATED PATTERNS

### OVER Indicators (Add points):
1. **Both scored yesterday** = 4 pts (strongest)
2. **High total (3+)** = 3 pts
3. **Away win momentum** = 2 pts
4. **Strong home form** = 2 pts
5. **Mixed position scoring** = 2 pts

### UNDER Patterns (Skip):
1. Both scored 0 = skip
2. Both low total ≤1 = skip
3. Score compression (3+ at home → away) = skip
4. Both drew = skip
5. Position flip after high score = skip

## INPUT FORMAT

### Yesterday's Results:
```
ALA 1:3 BIL
ATM 1:0 OSA
CEL 3:2 MAL
FCB 2:1 VIL
GIR 2:1 SEV
```

Format: `TEAM_HOME HOME_SCORE:AWAY_SCORE TEAM_AWAY`

### Today's Fixtures:
```
ALA BIL
ATM OSA
CEL MAL
FCB VIL
GIR SEV
```

Format: `HOME_TEAM AWAY_TEAM` (one per line)

## VALIDATION RESULTS

| Day | Matches | OVER | UNDER |
|-----|---------|------|-------|
| March 27-30 | 914 | 60% | 40% |
| March 31 | 440 | 61% | 39% |
| April 1 | 440 | 59% | 41% |
| April 2 | ~420 | 60% | 40% |
| April 3 | 440 | 60% | 40% |
| April 4 | 440 | 60% | 40% |
| **Total** | **~3094** | **60%** | **40%** |

**Pattern consistency: ✅ CONFIRMED across all 9 days**