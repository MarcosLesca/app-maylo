import assert from 'node:assert/strict';
import { test } from 'node:test';

import { displayAddress, resolveAddress, SEARCH_URL } from './address.ts';

test('a full http(s) URL is opened as typed', () => {
  assert.equal(resolveAddress('https://archive.org/details/x'), 'https://archive.org/details/x');
  assert.equal(resolveAddress('  http://example.com  '), 'http://example.com');
});

test('a bare domain or host with path gets https://', () => {
  assert.equal(resolveAddress('archive.org/details/night'), 'https://archive.org/details/night');
  assert.equal(resolveAddress('cinecalidad.am'), 'https://cinecalidad.am');
  assert.equal(resolveAddress('192.168.1.50:8080/video'), 'https://192.168.1.50:8080/video');
  assert.equal(resolveAddress('localhost:3000'), 'https://localhost:3000');
});

test('text that is not a URL becomes a web search', () => {
  assert.equal(resolveAddress('night of the living dead'), `${SEARCH_URL}night%20of%20the%20living%20dead`);
  assert.equal(resolveAddress('peliculas'), `${SEARCH_URL}peliculas`);
  assert.equal(resolveAddress('ver.en la tele'), `${SEARCH_URL}ver.en%20la%20tele`);
  assert.equal(resolveAddress('¿qué es a&b?'), `${SEARCH_URL}%C2%BFqu%C3%A9%20es%20a%26b%3F`);
});

test('empty input resolves to nothing', () => {
  assert.equal(resolveAddress('   '), null);
});

test('the address pill shows the URL without scheme, www or a lone trailing slash', () => {
  assert.equal(displayAddress('https://archive.org/details/night_of_the_living_dead'), 'archive.org/details/night_of_the_living_dead');
  assert.equal(displayAddress('https://www.google.com/'), 'google.com');
  assert.equal(displayAddress('about:blank'), 'about:blank');
});
