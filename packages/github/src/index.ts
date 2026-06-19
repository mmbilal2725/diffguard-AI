export type PullRequestRef = {
  owner: string;
  repo: string;
  number: number;
};

export function buildPullRequestKey(ref: PullRequestRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}
