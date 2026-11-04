import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyMemberQuery } from './member-access.ts';

test('a returned row means the user is a member, with its avatar', () => {
  assert.deepEqual(classifyMemberQuery({ data: { display_name: 'Loana', avatar: 'dumbbell' }, error: null }), {
    kind: 'member',
    member: { displayName: 'Loana', avatar: 'dumbbell' },
  });
});

test('an unknown avatar falls back to the mustache', () => {
  const result = classifyMemberQuery({ data: { display_name: 'Marcos', avatar: 'unexpected' }, error: null });
  assert.equal(result.kind === 'member' && result.member.avatar, 'mustache');
});

test('no row and no error means the user is not a member', () => {
  assert.deepEqual(classifyMemberQuery({ data: null, error: null }), { kind: 'not_member' });
});

test('a query error is reported as an error with its message, not as "not a member"', () => {
  assert.deepEqual(classifyMemberQuery({ data: null, error: { message: 'permission denied for table app_members' } }), {
    kind: 'error',
    message: 'permission denied for table app_members',
  });
});
