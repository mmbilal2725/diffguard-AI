const MINIMUM_POSTABLE_CONFIDENCE = 0.7;

export type PostableFindingCandidate = {
  confidence: number;
};

export function isPostableFinding(candidate: PostableFindingCandidate): boolean {
  return candidate.confidence >= MINIMUM_POSTABLE_CONFIDENCE;
}
