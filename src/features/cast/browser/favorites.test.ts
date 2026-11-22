import assert from 'node:assert/strict';
import { test } from 'node:test';

import { favoriteKey, favoriteLabel, isFavorite, toFavoriteInput } from './favorites.ts';

test('a favorite keeps the page URL and a trimmed title, falling back to the host', () => {
  assert.deepEqual(toFavoriteInput('https://www.archive.org/details/x', '  Night of the Living Dead  '), {
    url: 'https://www.archive.org/details/x',
    title: 'Night of the Living Dead',
  });
  assert.deepEqual(toFavoriteInput('https://archive.org/details/x', '   '), {
    url: 'https://archive.org/details/x',
    title: 'archive.org',
  });
});

test('only http(s) pages can be favorites and titles are capped', () => {
  assert.equal(toFavoriteInput('about:blank', 'x'), null);
  assert.equal(toFavoriteInput('javascript:alert(1)', 'x'), null);
  assert.equal(toFavoriteInput('', 'x'), null);
  assert.equal(toFavoriteInput('https://a.com/', 'x'.repeat(300))?.title.length, 120);
});

test('favorites match ignoring the fragment, www, a trailing slash and host case', () => {
  const saved = [{ url: 'https://www.Archive.org/details/x/#top' }];
  assert.equal(isFavorite(saved, 'https://archive.org/details/x'), true);
  assert.equal(isFavorite(saved, 'https://archive.org/details/y'), false);
  assert.equal(isFavorite(saved, 'https://archive.org/details/x?season=2'), false);
  assert.equal(favoriteKey('http://a.com'), favoriteKey('http://A.com/'));
});

test('the list label is the title and the short host', () => {
  assert.deepEqual(favoriteLabel({ url: 'https://www.archive.org/details/x', title: 'Peli' }), {
    title: 'Peli',
    host: 'archive.org',
  });
});
