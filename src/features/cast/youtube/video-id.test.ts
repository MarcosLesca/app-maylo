import assert from 'node:assert/strict';
import { test } from 'node:test';

import { youtubeTitle, youtubeVideoId, youtubeWatchUrl } from './video-id.ts';

const ID = 'jNQXAC9IVRw';

test('youtubeVideoId reads watch pages on www, m and bare youtube.com, with extra params', () => {
  assert.equal(youtubeVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(youtubeVideoId(`https://m.youtube.com/watch?v=${ID}&t=42s&pp=ygUDem9v`), ID);
  assert.equal(youtubeVideoId(`https://youtube.com/watch?feature=share&v=${ID}#comments`), ID);
  assert.equal(youtubeVideoId(`http://music.youtube.com/watch?v=${ID}&list=RD${ID}`), ID);
});

test('youtubeVideoId reads youtu.be links and shorts', () => {
  assert.equal(youtubeVideoId(`https://youtu.be/${ID}`), ID);
  assert.equal(youtubeVideoId(`https://youtu.be/${ID}?si=abc&t=10`), ID);
  assert.equal(youtubeVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(youtubeVideoId(`https://m.youtube.com/shorts/${ID}?feature=share`), ID);
});

test('youtubeVideoId is null for anything that is not one YouTube video', () => {
  assert.equal(youtubeVideoId('https://m.youtube.com/'), null);
  assert.equal(youtubeVideoId('https://www.youtube.com/results?search_query=zoo'), null);
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?list=PL123'), null);
  assert.equal(youtubeVideoId(`https://example.com/watch?v=${ID}`), null);
  assert.equal(youtubeVideoId(`https://notyoutube.com/watch?v=${ID}`), null);
  assert.equal(youtubeVideoId(`https://youtu.be/${ID}/extra`), null);
  assert.equal(youtubeVideoId(`ftp://youtu.be/${ID}`), null);
  assert.equal(youtubeVideoId('not a url'), null);
  assert.equal(youtubeVideoId(''), null);
});

test('youtubeWatchUrl is the canonical watch page of the id', () => {
  assert.equal(youtubeWatchUrl(ID), `https://www.youtube.com/watch?v=${ID}`);
  assert.equal(youtubeVideoId(youtubeWatchUrl(ID)), ID);
});

test('youtubeTitle drops the " - YouTube" suffix and the unread-count prefix of the page title', () => {
  assert.equal(youtubeTitle('Big Buck Bunny 60fps 4K - YouTube'), 'Big Buck Bunny 60fps 4K');
  assert.equal(youtubeTitle('(3) Me at the zoo - YouTube'), 'Me at the zoo');
  assert.equal(youtubeTitle('  Solo el título  '), 'Solo el título');
  assert.equal(youtubeTitle('YouTube'), '');
  assert.equal(youtubeTitle(''), '');
});

test('look-alike hosts, embeds and trailing slashes', () => {
  assert.equal(youtubeVideoId('https://m.youtube.com/shorts/aqz-KE-bpKQ/'), 'aqz-KE-bpKQ');
  assert.equal(youtubeVideoId('https://youtu.be/aqz-KE-bpKQ?si=x'), 'aqz-KE-bpKQ');
  for (const u of ['https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ', 'https://notyoutube.com/watch?v=aqz-KE-bpKQ', 'https://www.youtube.com/embed/aqz-KE-bpKQ'])
    assert.equal(youtubeVideoId(u), null, u);
});
