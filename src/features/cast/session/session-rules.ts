/** Pure rules of the cast session controller (cast-session.ts). No imports, tested in Node. */

/** True only on the poll where the cast turns ended, so the end is handled once. */
export function endedNow(wasEnded: boolean, ended: boolean): boolean {
  return ended && !wasEnded;
}

/**
 * How the session reads a TV browser receiver report: `own` (our video, or no
 * title reported), `stale` (another title before the TV ever showed ours: the
 * load is still pending, ignore it) or `superseded` (another title after ours was
 * shown: the other phone loaded something else, so this session is over).
 */
export function classifyReport(input: {
  title: string;
  reportedTitle: string | undefined;
  confirmed: boolean;
}): 'own' | 'stale' | 'superseded' {
  const reported = input.reportedTitle?.trim();
  if (!reported || reported === input.title.trim()) return 'own';
  return input.confirmed ? 'superseded' : 'stale';
}
