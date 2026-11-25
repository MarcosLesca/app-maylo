import assert from 'node:assert/strict';
import { test } from 'node:test';

import { progressAction, progressKey, resumeOffer, shouldSaveProgress } from './progress-rules.ts';

test('the progress key is the normalized top page plus the title', () => {
  const key = progressKey('https://www.Series.example.com/watch/3/#player', '  Capítulo   3 ');
  assert.equal(key, 'https://series.example.com/watch/3|capítulo 3');
  assert.equal(progressKey('https://series.example.com/watch/3', 'CAPÍTULO 3'), key);
  // The query is part of the page (season/episode params).
  assert.notEqual(progressKey('https://series.example.com/watch?ep=4', 'Capítulo 3'), progressKey('https://series.example.com/watch?ep=3', 'Capítulo 3'));
  assert.equal(progressKey('about:blank', 'x'), null);
});

test('resume is offered between 30 s and 60 s before the end', () => {
  assert.equal(resumeOffer({ position_s: 1390, duration_s: 2700 }), 1390);
  assert.equal(resumeOffer({ position_s: 30, duration_s: 2700 }), null);
  assert.equal(resumeOffer({ position_s: 31, duration_s: 2700 }), 31);
  assert.equal(resumeOffer({ position_s: 2640, duration_s: 2700 }), null);
  assert.equal(resumeOffer({ position_s: 2639, duration_s: 2700 }), 2639);
  // Unknown duration: only the lower bound applies.
  assert.equal(resumeOffer({ position_s: 600, duration_s: null }), 600);
  assert.equal(resumeOffer(null), null);
});

test('progress is saved while playing and deleted at 95 % or when the video ended', () => {
  assert.equal(progressAction({ position: 600, duration: 2700, ended: false }), 'save');
  assert.equal(progressAction({ position: 2565, duration: 2700, ended: false }), 'delete');
  assert.equal(progressAction({ position: 2564, duration: 2700, ended: false }), 'save');
  assert.equal(progressAction({ position: 100, duration: 2700, ended: true }), 'delete');
  assert.equal(progressAction({ position: null, duration: 2700, ended: false }), 'skip');
  assert.equal(progressAction({ position: 600, duration: null, ended: false }), 'save');
});

test('progress is written every 10 s', () => {
  assert.equal(shouldSaveProgress(0, 10_000), true);
  assert.equal(shouldSaveProgress(5_000, 14_999), false);
  assert.equal(shouldSaveProgress(5_000, 15_000), true);
});
