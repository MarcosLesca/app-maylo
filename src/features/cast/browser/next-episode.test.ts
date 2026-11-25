import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DETECTOR_SCRIPT } from './detector-script.ts';
import { isNextEpisodeLink, NEXT_EPISODE_PATTERN, parseNextEpisodeMessage } from './next-episode.ts';

test('the detector runs the same next-episode wording inside the page', () => {
  assert.ok(DETECTOR_SCRIPT.includes(NEXT_EPISODE_PATTERN.source));
});

const link = (fields: Partial<{ text: string; rel: string; ariaLabel: string; href: string }>) => ({
  text: '',
  rel: '',
  ariaLabel: '',
  href: 'https://series.example.com/watch/4',
  pageUrl: 'https://series.example.com/watch/3',
  ...fields,
});

test('next-episode wording in the link text matches (es/en, case and arrows ignored)', () => {
  for (const text of [
    'Siguiente',
    'Siguiente episodio',
    'siguiente capítulo »',
    'Próximo episodio',
    'PROXIMO EPISODIO',
    'Next episode',
    'Next →',
    '» Siguiente',
  ]) {
    assert.equal(isNextEpisodeLink(link({ text })), true, text);
  }
});

test('rel=next and an aria-label with the wording match too', () => {
  assert.equal(isNextEpisodeLink(link({ rel: 'next' })), true);
  assert.equal(isNextEpisodeLink(link({ rel: 'nofollow next' })), true);
  assert.equal(isNextEpisodeLink(link({ ariaLabel: 'Ir al próximo episodio' })), false);
  assert.equal(isNextEpisodeLink(link({ ariaLabel: 'Próximo episodio' })), true);
});

test('other links, the same page and non-http links do not match', () => {
  for (const text of ['Inicio', 'Episodio 4', 'Nextflix originals', 'Anterior', 'Siguientes estrenos']) {
    assert.equal(isNextEpisodeLink(link({ text })), false, text);
  }
  assert.equal(isNextEpisodeLink(link({ text: 'Siguiente', href: 'https://series.example.com/watch/3#next' })), false);
  assert.equal(isNextEpisodeLink(link({ text: 'Siguiente', href: 'javascript:next()' })), false);
});

test('maylo-next messages are parsed; anything else is ignored', () => {
  assert.deepEqual(
    parseNextEpisodeMessage(
      JSON.stringify({
        type: 'maylo-next',
        url: 'https://series.example.com/watch/4',
        label: ' Siguiente episodio ',
        pageUrl: 'https://series.example.com/watch/3',
      }),
    ),
    { url: 'https://series.example.com/watch/4', label: 'Siguiente episodio', pageUrl: 'https://series.example.com/watch/3' },
  );
  assert.equal(parseNextEpisodeMessage(JSON.stringify({ type: 'maylo-next', url: 'javascript:x' })), null);
  assert.equal(parseNextEpisodeMessage(JSON.stringify({ type: 'maylo-video', url: 'https://a.com/x.mp4' })), null);
  assert.equal(parseNextEpisodeMessage('nope'), null);
});
