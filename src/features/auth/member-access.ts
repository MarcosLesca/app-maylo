export type MemberAvatar = 'mustache' | 'dumbbell';

export type Member = {
  displayName: string;
  avatar: MemberAvatar;
};

/**
 * Outcome of looking up the signed-in user in the members allowlist.
 * "not_member" and "error" are kept apart on purpose: a network or
 * permission failure must not be reported as "you have no access".
 */
export type MemberAccess =
  | { kind: 'member'; member: Member }
  | { kind: 'not_member' }
  | { kind: 'error'; message: string };

type MemberQueryResult = {
  data: { display_name: string; avatar: string } | null;
  error: { message: string } | null;
};

export function classifyMemberQuery({ data, error }: MemberQueryResult): MemberAccess {
  if (error) return { kind: 'error', message: error.message };
  if (!data) return { kind: 'not_member' };
  return {
    kind: 'member',
    member: { displayName: data.display_name, avatar: data.avatar === 'dumbbell' ? 'dumbbell' : 'mustache' },
  };
}
