import type { AgentRun, ImprovementIssue, IssueDelta, RunComparison } from "./types";

function sorted(values: IssueDelta[]): IssueDelta[] {
  return values.sort((left, right) => {
    const leftIssue = left.current ?? left.previous;
    const rightIssue = right.current ?? right.previous;
    return (leftIssue?.category ?? "").localeCompare(rightIssue?.category ?? "") ||
      (leftIssue?.url ?? "").localeCompare(rightIssue?.url ?? "") ||
      (leftIssue?.code ?? "").localeCompare(rightIssue?.code ?? "");
  });
}

export function compareIssueSets(
  runAId: string,
  previousIssues: ImprovementIssue[],
  runBId: string,
  currentIssues: ImprovementIssue[],
): RunComparison {
  const previous = new Map(previousIssues.map((issue) => [issue.fingerprint, issue]));
  const current = new Map(currentIssues.map((issue) => [issue.fingerprint, issue]));
  const improved: IssueDelta[] = [];
  const newIssues: IssueDelta[] = [];
  const unresolved: IssueDelta[] = [];

  for (const [fingerprint, issue] of previous) {
    const next = current.get(fingerprint);
    if (next) unresolved.push({ fingerprint, status: "unresolved", previous: issue, current: next });
    else improved.push({ fingerprint, status: "improved", previous: issue });
  }
  for (const [fingerprint, issue] of current) {
    if (!previous.has(fingerprint)) newIssues.push({ fingerprint, status: "new", current: issue });
  }
  return {
    runAId,
    runBId,
    improved: sorted(improved),
    newIssues: sorted(newIssues),
    unresolved: sorted(unresolved),
    summary: {
      improved: improved.length,
      newIssues: newIssues.length,
      unresolved: unresolved.length,
    },
  };
}

export function compareRuns(runA: AgentRun, runB: AgentRun): RunComparison {
  return compareIssueSets(runA.id, runA.issues, runB.id, runB.issues);
}
