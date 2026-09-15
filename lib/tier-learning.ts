import { supabaseAdmin } from "./supabase-admin";

export type LearnableTier = "S" | "A" | "B" | "C" | "D";

export type TierLearningInput = {
  authorId: string | null;
  adultScore: number;
  creatorScore: number;
  possiblySensitive: boolean;
};

type TierLearningSample = TierLearningInput & {
  tier: LearnableTier;
  value: number;
};

export type TierLearningModel = {
  samples: TierLearningSample[];
  trainedAt: string;
};

export type LearnedTierPrediction = {
  tier: LearnableTier;
  value: number;
  confidence: number;
  sampleCount: number;
  sameAuthorSamples: number;
};

const LEARNABLE_TIERS = ["S", "A", "B", "C", "D"] as const;
const MIN_TRAINING_SAMPLES = 100;
const MAX_TRAINING_SAMPLES = 1000;
const NEIGHBOR_COUNT = 25;
const MODEL_CACHE_MS = 60 * 60 * 1000;

const TIER_VALUE: Record<LearnableTier, number> = {
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  D: 1,
};

let cachedModel: TierLearningModel | null = null;
let cachedAt = 0;

function isLearnableTier(value: unknown): value is LearnableTier {
  return (LEARNABLE_TIERS as readonly unknown[]).includes(value);
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueToTier(value: number): LearnableTier {
  if (value >= 4.5) return "S";
  if (value >= 3.5) return "A";
  if (value >= 2.5) return "B";
  if (value >= 1.5) return "C";
  return "D";
}

function distance(a: TierLearningInput, b: TierLearningInput) {
  const adultDifference = a.adultScore - b.adultScore;
  const creatorDifference = a.creatorScore - b.creatorScore;
  const sensitiveDifference = a.possiblySensitive === b.possiblySensitive ? 0 : 1;

  return Math.sqrt(
    2 * adultDifference * adultDifference +
      1.5 * creatorDifference * creatorDifference +
      0.35 * sensitiveDifference
  );
}

export async function loadTierLearningModel(): Promise<TierLearningModel | null> {
  const now = Date.now();
  if (cachedAt > 0 && now - cachedAt < MODEL_CACHE_MS) return cachedModel;

  const { data, error } = await supabaseAdmin()
    .from("posts")
    .select(
      "author_id,adult_score,creator_score,possibly_sensitive,manual_tier,manual_reviewed_at"
    )
    .in("manual_tier", [...LEARNABLE_TIERS])
    .eq("content_category", "PASS")
    .eq("moderation_blocked", false)
    .not("adult_score", "is", null)
    .not("creator_score", "is", null)
    .order("manual_reviewed_at", { ascending: false })
    .limit(MAX_TRAINING_SAMPLES);

  if (error) throw error;

  const samples: TierLearningSample[] = [];
  for (const row of data ?? []) {
    const adultScore = finiteNumber(row.adult_score);
    const creatorScore = finiteNumber(row.creator_score);
    if (
      adultScore === null ||
      creatorScore === null ||
      !isLearnableTier(row.manual_tier)
    ) {
      continue;
    }

    samples.push({
      authorId: row.author_id ? String(row.author_id) : null,
      adultScore,
      creatorScore,
      possiblySensitive: row.possibly_sensitive === true,
      tier: row.manual_tier,
      value: TIER_VALUE[row.manual_tier],
    });
  }

  cachedAt = now;
  cachedModel =
    samples.length >= MIN_TRAINING_SAMPLES
      ? { samples, trainedAt: new Date(now).toISOString() }
      : null;

  return cachedModel;
}

export function predictLearnedTier(
  model: TierLearningModel | null,
  input: TierLearningInput
): LearnedTierPrediction | null {
  if (!model || model.samples.length < MIN_TRAINING_SAMPLES) return null;

  const neighbors = model.samples
    .map((sample) => ({ sample, distance: distance(sample, input) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, NEIGHBOR_COUNT);

  if (neighbors.length === 0) return null;

  let weightedTotal = 0;
  let totalWeight = 0;
  for (const neighbor of neighbors) {
    const weight = 1 / (0.08 + neighbor.distance);
    weightedTotal += neighbor.sample.value * weight;
    totalWeight += weight;
  }
  const neighborValue = weightedTotal / totalWeight;

  const sameAuthor = input.authorId
    ? model.samples.filter((sample) => sample.authorId === input.authorId)
    : [];
  const sameAuthorValue =
    sameAuthor.length >= 3
      ? sameAuthor.reduce((sum, sample) => sum + sample.value, 0) /
        sameAuthor.length
      : null;

  const value =
    sameAuthorValue === null
      ? neighborValue
      : sameAuthorValue * 0.7 + neighborValue * 0.3;
  const averageNeighborDistance =
    neighbors.reduce((sum, neighbor) => sum + neighbor.distance, 0) /
    neighbors.length;
  const distanceConfidence = Math.max(
    0.2,
    Math.min(0.65, 0.65 - averageNeighborDistance * 0.45)
  );
  const confidence =
    sameAuthor.length >= 3
      ? Math.min(0.85, 0.55 + sameAuthor.length * 0.02)
      : distanceConfidence;

  return {
    tier: valueToTier(value),
    value: Number(value.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    sampleCount: model.samples.length,
    sameAuthorSamples: sameAuthor.length,
  };
}

const RULE_TIER_VALUE: Record<string, number> = {
  S: 5,
  "A+": 4.5,
  A: 4,
  "B+": 3.5,
  B: 3,
  C: 2,
  "D+": 1.5,
  D: 1,
  NONE: 0,
};

const LEARNED_TIER_SCORE: Record<LearnableTier, number> = {
  S: 0.95,
  A: 0.8,
  B: 0.67,
  C: 0.55,
  D: 0.42,
};

export function blendRuleAndLearnedTier(
  rule: { score: number; tier: string },
  prediction: LearnedTierPrediction | null
) {
  if (!prediction || rule.tier === "X") return rule;

  const ruleValue = RULE_TIER_VALUE[rule.tier] ?? prediction.value;
  const learningWeight = 0.35 + prediction.confidence * 0.3;
  const blendedValue =
    ruleValue * (1 - learningWeight) + prediction.value * learningWeight;
  const tier = valueToTier(blendedValue);

  return {
    score: LEARNED_TIER_SCORE[tier],
    tier,
  };
}
