/**
 * A VISIONOS master playlist (dQw4w9WgXcQ, 2026-11), trimmed: the avc1 variants, two
 * vp09 ones, both audio groups and two subtitle tracks. Signed path tokens
 * (expire, ei, ip, id, sig, lsig, ...) are placeholders. Test data only.
 */
export const VISIONOS_MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/233/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8",TYPE=AUDIO,GROUP-ID="233",NAME="Default",YT-EXT-ABSOLUTE-LOUDNESS=-13.010,DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/234/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8",TYPE=AUDIO,GROUP-ID="234",NAME="Default",YT-EXT-ABSOLUTE-LOUDNESS=-13.010,DEFAULT=YES,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_timedtext_playlist/expire/EXPIRE/id/VIDEO_ID/lang/en/sig/SIG/playlist/index.m3u8",TYPE=SUBTITLES,GROUP-ID="vtt",LANGUAGE="en",NAME="English",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_timedtext_playlist/expire/EXPIRE/id/VIDEO_ID/lang/es-419/sig/SIG/playlist/index.m3u8",TYPE=SUBTITLES,GROUP-ID="vtt",LANGUAGE="es-419",NAME="Español (Latinoamérica)",DEFAULT=NO,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=300694,CODECS="avc1.4D4015,mp4a.40.5",RESOLUTION=426x240,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="233",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/229/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=385245,CODECS="avc1.4D4015,mp4a.40.2",RESOLUTION=426x240,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/229/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=610616,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=640x360,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/230/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=862512,CODECS="avc1.4D401E,mp4a.40.2",RESOLUTION=854x480,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/231/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1248435,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/232/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=168130,CODECS="avc1.4D400C,mp4a.40.5",RESOLUTION=256x144,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="233",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/269/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4688074,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/270/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1763840,CODECS="vp09.00.40.08,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/614/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=19117677,CODECS="vp09.00.50.08,mp4a.40.2",RESOLUTION=3840x2160,FRAME-RATE=25,VIDEO-RANGE=SDR,YT-EXT-ABSOLUTE-LOUDNESS=-13.010,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/EXPIRE/ei/EI/ip/IP/id/VIDEO_ID/itag/625/source/youtube/sig/SIG/lsig/LSIG/playlist/index.m3u8

`;

const track = (lang: string, name: string, xtags: string, id: string, def = 'NO') =>
  `#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/manifest/hls_playlist/id/VIDEO_ID/itag/234/xtags/${lang}/playlist/index.m3u8",TYPE=AUDIO,GROUP-ID="234",LANGUAGE="${lang}",NAME="${name}",YT-EXT-XTAGS="${xtags}",YT-EXT-AUDIO-CONTENT-ID="${id}",YT-EXT-ABSOLUTE-LOUDNESS=-14.000,DEFAULT=${def},AUTOSELECT=YES`;

/**
 * A VISIONOS master of a dubbed video (0e3GPea1Tyg, 2026-11), trimmed to one
 * audio group and four of its 24 tracks: every track sits in the same group with
 * DEFAULT=NO, the Arabic dub first; the original is only marked by its NAME and
 * by `acont=original` inside YT-EXT-XTAGS (base64url protobuf). Test data only.
 */
export const DUBBED_MASTER = `#EXTM3U
#EXT-X-INDEPENDENT-SEGMENTS
${track('ar', 'العربية - dubbed', 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICYXI', 'ar.3')}
${track('de', 'Deutsch - dubbed', 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZGU', 'de.3')}
${track('es', 'Español - dubbed', 'Cg8KBWFjb250EgZkdWJiZWQKCgoEbGFuZxICZXM', 'es.3')}
${track('en-US', 'American English - original', 'ChEKBWFjb250EghvcmlnaW5hbAoNCgRsYW5nEgVlbi1VUw', 'en-US.4')}
#EXT-X-STREAM-INF:BANDWIDTH=4699793,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=24,VIDEO-RANGE=SDR,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE
https://manifest.googlevideo.com/api/manifest/hls_playlist/id/VIDEO_ID/itag/270/playlist/index.m3u8
`;
