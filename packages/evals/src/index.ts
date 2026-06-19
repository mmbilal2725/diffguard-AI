export type PrecisionInput = {
  truePositives: number;
  falsePositives: number;
};

export function calculatePrecision(input: PrecisionInput): number {
  const postedFindings = input.truePositives + input.falsePositives;

  if (postedFindings === 0) {
    return 0;
  }

  return input.truePositives / postedFindings;
}
