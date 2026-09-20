// Every threshold in the game. Placeholders to drive with, editable in the Tuning screen.
// Times of day are minutes from local midnight.

export const DEFAULTS = Object.freeze({
  // Speed compliance
  overToleranceKmh: 3, // "over" = limit + this (GPS speed noise)
  warnAfterS: 1, // continuous seconds over before the first warning (two fixes at 1 Hz)
  warnRepeatS: 10, // minimum gap between warnings
  dqAfterS: 5, // DQ clock trips here
  dqDrainRate: 0.5, // clock drains at this rate while under the limit
  maxAccuracyM: 25, // fixes worse than this are ignored; DQ clock freezes

  // Limits for roads without a maxspeed tag. Warn only, never DQ.
  assumedResidentialKmh: 50,
  assumedLivingStreetKmh: 20,
  // Mapper-declared defaults like maxspeed=EE:urban count as tagged.
  implicitUrbanKmh: 50,
  implicitRuralKmh: 90,

  // Sign-position slack: effective limit = highest within this window along the path
  slackBehindM: 60,
  slackAheadM: 30,

  // Markers
  activationRadiusM: 60,
  finalizationRadiusM: 40,
  minRadiusM: 30,
  minMarkerSeparationM: 500,

  // Start / finish
  startMinSpeedMs: 2.5, // ~9 km/h
  startMinFixes: 2, // consecutive fast fixes outside the circle confirm a start
  startConfirmWindowS: 15, // an unconfirmed crossing expires (parked GPS jitter)
  impreciseStartGapS: 5, // crossing interpolated over a longer gap gets flagged
  finishMinElapsedS: 60,
  finishMinDistanceFrac: 0.5, // of the straight-line A–B distance

  // GPS pauses (browser loses GPS when the page is hidden)
  gapFlagS: 10,
  gapAbortS: 120,
  stationaryAbortS: 1200,
  movingMinSpeedMs: 0.7, // below this, distance is not accumulated

  // Road matching
  matchRadiusM: 30,
  matchHeadingMaxDeg: 45,
  matchHeadingMinSpeedMs: 3,
  matchHeadingWeight: 0.4, // metres of score per degree of heading difference
  matchServicePenaltyM: 10,
  matchStickCurrentM: 8,
  matchStickConnectedM: 4,
  matchSwitchWins: 2,
  matchAmbiguityM: 10, // runner-up within this score → higher limit applies

  // Records
  recordWindowDays: 730,

  // Buckets, by local start time
  buckets: Object.freeze({
    amStart: 6 * 60 + 30,
    amEnd: 9 * 60 + 30,
    middayEnd: 15 * 60 + 30,
    pmEnd: 18 * 60 + 30,
    weekendDayStart: 7 * 60,
    weekendDayEnd: 20 * 60,
  }),
});

export function withOverrides(overrides = {}) {
  const { buckets, ...rest } = overrides;
  return Object.freeze({
    ...DEFAULTS,
    ...rest,
    buckets: Object.freeze({ ...DEFAULTS.buckets, ...(buckets || {}) }),
  });
}

export const KMH_PER_MS = 3.6;
