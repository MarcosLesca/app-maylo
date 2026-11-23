// MayLo TV hub: pure registry logic (no Arduino dependencies, host-testable).
//
// - parseRegisterUrl: hand-written equivalent of
//     ^http://<ipv4>:87(6[5-9]|7[0-5])/tv/[A-Za-z0-9]{6}$
//   where every <ipv4> octet is 0-255 written without leading zeros.
// - parseRegisterBody: tiny strict JSON object parser for
//     {"url":"...","name":"...","members":["...", ...]}  (url required; name
//     and members optional; members is an array of at most kMaxMembers
//     strings; other keys must have string values and are ignored; duplicate
//     url/name/members keys rejected; body limited to kMaxBodyBytes).
// - Registry: up to kMaxPhones phones keyed by IPv4, last-seen in millis();
//   ages use unsigned subtraction, so a millis() wrap-around is harmless, and
//   entries older than kFreshMs are expired before they could wrap.
// - MemberList (S6): the ordered app members the hub always shows. A
//   registration with members replaces it; one without members adds its
//   name when missing and there is room. Serialized as NUL-terminated names
//   for Preferences.
#ifndef MAYLO_TV_HUB_REGISTER_VALIDATION_H
#define MAYLO_TV_HUB_REGISTER_VALIDATION_H

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

namespace tvhub {

// 1024 (was 512 before S6): url + name + 4 member names of 40 code points
// (up to 4 UTF-8 bytes each) need ~900 bytes.
static const size_t kMaxBodyBytes = 1024;
static const size_t kMaxPhones = 4;
static const size_t kMaxMembers = 4;
static const size_t kMaxNameChars = 40;                 // Unicode code points
static const size_t kNameCap = kMaxNameChars * 4 + 1;  // UTF-8 bytes + NUL
static const size_t kUrlCap = 48;  // "http://255.255.255.255:8775/tv/XXXXXX" is 37
static const uint32_t kFreshMs = 180000UL;
static const uint16_t kPortMin = 8765;
static const uint16_t kPortMax = 8775;
static const size_t kKeyLen = 6;

inline bool isDigit(char c) { return c >= '0' && c <= '9'; }

inline bool isAlnum(char c) {
  return isDigit(c) || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}

// One decimal octet: "0" or [1-9][0-9]{0,2} with value <= 255.
inline bool parseOctet(const char *s, size_t len, size_t *pos, uint8_t *out) {
  size_t p = *pos;
  if (p >= len || !isDigit(s[p])) return false;
  if (s[p] == '0') {
    if (p + 1 < len && isDigit(s[p + 1])) return false;  // leading zero
    *out = 0;
    *pos = p + 1;
    return true;
  }
  unsigned value = 0;
  size_t digits = 0;
  while (p < len && isDigit(s[p])) {
    if (digits == 3) return false;
    value = value * 10 + (unsigned)(s[p] - '0');
    ++digits;
    ++p;
  }
  if (value > 255) return false;
  *out = (uint8_t)value;
  *pos = p;
  return true;
}

// Returns true only when the whole string matches the S2 url pattern.
inline bool parseRegisterUrl(const char *s, size_t len, uint8_t ip[4], uint16_t *port, char key[kKeyLen + 1]) {
  static const char kScheme[] = "http://";
  const size_t schemeLen = sizeof(kScheme) - 1;
  if (s == NULL || len < schemeLen || memcmp(s, kScheme, schemeLen) != 0) return false;
  size_t p = schemeLen;
  for (int i = 0; i < 4; ++i) {
    if (i > 0) {
      if (p >= len || s[p] != '.') return false;
      ++p;
    }
    if (!parseOctet(s, len, &p, &ip[i])) return false;
  }
  // ":87" then (6[5-9]|7[0-5]) -> exactly four digits in 8765..8775.
  if (p + 5 > len || s[p] != ':') return false;
  ++p;
  unsigned value = 0;
  for (int i = 0; i < 4; ++i) {
    if (!isDigit(s[p + i])) return false;
    value = value * 10 + (unsigned)(s[p + i] - '0');
  }
  if (value < kPortMin || value > kPortMax) return false;
  p += 4;
  static const char kPath[] = "/tv/";
  const size_t pathLen = sizeof(kPath) - 1;
  if (p + pathLen > len || memcmp(s + p, kPath, pathLen) != 0) return false;
  p += pathLen;
  if (len - p != kKeyLen) return false;
  for (size_t i = 0; i < kKeyLen; ++i) {
    if (!isAlnum(s[p + i])) return false;
    key[i] = s[p + i];
  }
  key[kKeyLen] = '\0';
  *port = (uint16_t)value;
  return true;
}

// ---------------------------------------------------------------------------
// Tiny JSON string reader.

inline void skipWs(const char *s, size_t len, size_t *p) {
  while (*p < len && (s[*p] == ' ' || s[*p] == '\t' || s[*p] == '\n' || s[*p] == '\r')) ++*p;
}

inline int hexValue(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

inline bool readHex4(const char *s, size_t len, size_t *p, uint32_t *out) {
  if (*p + 4 > len) return false;
  uint32_t v = 0;
  for (int i = 0; i < 4; ++i) {
    int h = hexValue(s[*p + i]);
    if (h < 0) return false;
    v = (v << 4) | (uint32_t)h;
  }
  *p += 4;
  *out = v;
  return true;
}

// Appends a code point as UTF-8; false when it does not fit (cap includes NUL).
inline bool putUtf8(uint32_t cp, char *out, size_t cap, size_t *n) {
  char buf[4];
  size_t k;
  if (cp < 0x80) {
    buf[0] = (char)cp;
    k = 1;
  } else if (cp < 0x800) {
    buf[0] = (char)(0xC0 | (cp >> 6));
    buf[1] = (char)(0x80 | (cp & 0x3F));
    k = 2;
  } else if (cp < 0x10000) {
    buf[0] = (char)(0xE0 | (cp >> 12));
    buf[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
    buf[2] = (char)(0x80 | (cp & 0x3F));
    k = 3;
  } else {
    buf[0] = (char)(0xF0 | (cp >> 18));
    buf[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    buf[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    buf[3] = (char)(0x80 | (cp & 0x3F));
    k = 4;
  }
  if (*n + k >= cap) return false;
  memcpy(out + *n, buf, k);
  *n += k;
  return true;
}

// Length of a well-formed UTF-8 sequence starting at s[p], or 0.
inline size_t utf8SeqLen(const char *s, size_t len, size_t p) {
  unsigned char c = (unsigned char)s[p];
  size_t k;
  uint32_t cp;
  if (c < 0x80) return 1;
  if (c >= 0xC2 && c <= 0xDF) {
    k = 2;
    cp = c & 0x1F;
  } else if (c >= 0xE0 && c <= 0xEF) {
    k = 3;
    cp = c & 0x0F;
  } else if (c >= 0xF0 && c <= 0xF4) {
    k = 4;
    cp = c & 0x07;
  } else {
    return 0;
  }
  if (p + k > len) return 0;
  for (size_t i = 1; i < k; ++i) {
    unsigned char cc = (unsigned char)s[p + i];
    if ((cc & 0xC0) != 0x80) return 0;
    cp = (cp << 6) | (cc & 0x3F);
  }
  if ((k == 3 && cp < 0x800) || (k == 4 && (cp < 0x10000 || cp > 0x10FFFF))) return 0;
  if (cp >= 0xD800 && cp <= 0xDFFF) return 0;
  return k;
}

// Reads a JSON string starting at the opening quote. Decodes escapes into
// UTF-8. Rejects raw control characters, invalid UTF-8, lone surrogates and
// \u0000. When out == NULL the value is validated and skipped.
inline bool readJsonString(const char *s, size_t len, size_t *pos, char *out, size_t cap, size_t *outLen) {
  size_t p = *pos;
  if (p >= len || s[p] != '"') return false;
  ++p;
  size_t n = 0;
  char scratch[8];
  char *dst = out != NULL ? out : scratch;
  size_t dstCap = out != NULL ? cap : sizeof(scratch);
  while (p < len) {
    unsigned char c = (unsigned char)s[p];
    if (c == '"') {
      if (out != NULL) {
        out[n] = '\0';
        if (outLen != NULL) *outLen = n;
      }
      *pos = p + 1;
      return true;
    }
    if (c < 0x20) return false;
    uint32_t cp;
    if (c == '\\') {
      if (p + 1 >= len) return false;
      char e = s[p + 1];
      p += 2;
      switch (e) {
        case '"': cp = '"'; break;
        case '\\': cp = '\\'; break;
        case '/': cp = '/'; break;
        case 'b': cp = 0x08; break;
        case 'f': cp = 0x0C; break;
        case 'n': cp = 0x0A; break;
        case 'r': cp = 0x0D; break;
        case 't': cp = 0x09; break;
        case 'u': {
          if (!readHex4(s, len, &p, &cp)) return false;
          if (cp >= 0xDC00 && cp <= 0xDFFF) return false;
          if (cp >= 0xD800 && cp <= 0xDBFF) {
            uint32_t lo;
            if (p + 2 > len || s[p] != '\\' || s[p + 1] != 'u') return false;
            p += 2;
            if (!readHex4(s, len, &p, &lo) || lo < 0xDC00 || lo > 0xDFFF) return false;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          if (cp == 0) return false;
          break;
        }
        default: return false;
      }
      if (out == NULL) {
        size_t ignored = 0;
        if (!putUtf8(cp, dst, dstCap, &ignored)) return false;
      } else if (!putUtf8(cp, dst, dstCap, &n)) {
        return false;
      }
      continue;
    }
    size_t k = utf8SeqLen(s, len, p);
    if (k == 0) return false;
    if (out != NULL) {
      if (n + k >= cap) return false;
      memcpy(out + n, s + p, k);
      n += k;
    }
    p += k;
  }
  return false;  // unterminated
}

// Trims ASCII whitespace and keeps at most kMaxNameChars code points.
inline void normalizeName(char *name) {
  size_t len = strlen(name);
  size_t start = 0;
  while (start < len && (name[start] == ' ' || name[start] == '\t' || name[start] == '\n' || name[start] == '\r')) ++start;
  if (start > 0) {
    memmove(name, name + start, len - start + 1);
    len -= start;
  }
  size_t chars = 0;
  size_t i = 0;
  while (i < len) {
    if (((unsigned char)name[i] & 0xC0) != 0x80) {
      if (chars == kMaxNameChars) break;
      ++chars;
    }
    ++i;
  }
  len = i;
  while (len > 0 && (name[len - 1] == ' ' || name[len - 1] == '\t' || name[len - 1] == '\n' || name[len - 1] == '\r')) --len;
  name[len] = '\0';
}

struct RegisterRequest {
  char url[kUrlCap];
  char name[kNameCap];
  uint8_t ip[4];
  uint16_t port;
  char key[kKeyLen + 1];
  bool hasMembers;     // the body had a "members" array (possibly empty)
  size_t memberCount;  // normalized, non-empty, without repeats, in order
  char members[kMaxMembers][kNameCap];
};

inline bool nameListHas(const char (*names)[kNameCap], size_t count, const char *name) {
  for (size_t i = 0; i < count; ++i) {
    if (strcmp(names[i], name) == 0) return true;
  }
  return false;
}

// Reads ["a","b",...] at *pos: at most kMaxMembers strings (more is an error),
// each validated like name and normalized; empty and repeated names dropped.
inline bool readMemberArray(const char *s, size_t len, size_t *pos, char *scratch, size_t scratchCap,
                            RegisterRequest *out) {
  size_t p = *pos;
  if (p >= len || s[p] != '[') return false;
  ++p;
  skipWs(s, len, &p);
  if (p < len && s[p] == ']') {
    *pos = p + 1;
    return true;
  }
  size_t entries = 0;
  for (;;) {
    skipWs(s, len, &p);
    if (p >= len || s[p] != '"') return false;
    if (++entries > kMaxMembers) return false;
    if (!readJsonString(s, len, &p, scratch, scratchCap, NULL)) return false;
    normalizeName(scratch);  // <= kMaxNameChars code points, fits kNameCap
    if (scratch[0] != '\0' && !nameListHas(out->members, out->memberCount, scratch)) {
      memcpy(out->members[out->memberCount], scratch, strlen(scratch) + 1);
      ++out->memberCount;
    }
    skipWs(s, len, &p);
    if (p >= len) return false;
    if (s[p] == ',') {
      ++p;
      continue;
    }
    if (s[p] == ']') {
      ++p;
      break;
    }
    return false;
  }
  *pos = p;
  return true;
}

// Parses and validates a /register body (the remote-IP check is the caller's).
inline bool parseRegisterBody(const char *body, size_t len, RegisterRequest *out) {
  if (body == NULL || out == NULL || len == 0 || len > kMaxBodyBytes) return false;
  out->name[0] = '\0';
  out->hasMembers = false;
  out->memberCount = 0;
  // Strings are decoded here first; a decoded string is never longer than the
  // body, and names are trimmed to kMaxNameChars afterwards.
  char raw[kMaxBodyBytes + 1];
  bool haveUrl = false;
  bool haveName = false;
  size_t urlLen = 0;
  size_t p = 0;
  skipWs(body, len, &p);
  if (p >= len || body[p] != '{') return false;
  ++p;
  skipWs(body, len, &p);
  if (p < len && body[p] == '}') return false;  // url is required
  for (;;) {
    char keyBuf[16];
    size_t keyLen = 0;
    skipWs(body, len, &p);
    if (p >= len || body[p] != '"') return false;
    size_t keyStart = p;
    bool keyFits = readJsonString(body, len, &p, keyBuf, sizeof(keyBuf), &keyLen);
    if (!keyFits) {
      // Unknown long key: validate it without storing.
      p = keyStart;
      if (!readJsonString(body, len, &p, NULL, 0, NULL)) return false;
      keyLen = 0;
      keyBuf[0] = '\0';
    }
    skipWs(body, len, &p);
    if (p >= len || body[p] != ':') return false;
    ++p;
    skipWs(body, len, &p);
    if (keyLen == 7 && strcmp(keyBuf, "members") == 0) {
      if (out->hasMembers) return false;
      if (!readMemberArray(body, len, &p, raw, sizeof(raw), out)) return false;
      out->hasMembers = true;
    } else if (p >= len || body[p] != '"') {
      return false;  // every other value is a string
    } else if (keyLen == 3 && strcmp(keyBuf, "url") == 0) {
      if (haveUrl) return false;
      if (!readJsonString(body, len, &p, out->url, sizeof(out->url), &urlLen)) return false;
      haveUrl = true;
    } else if (keyLen == 4 && strcmp(keyBuf, "name") == 0) {
      if (haveName) return false;
      if (!readJsonString(body, len, &p, raw, sizeof(raw), NULL)) return false;
      normalizeName(raw);
      memcpy(out->name, raw, strlen(raw) + 1);  // <= kNameCap after normalize
      haveName = true;
    } else {
      if (!readJsonString(body, len, &p, NULL, 0, NULL)) return false;
    }
    skipWs(body, len, &p);
    if (p >= len) return false;
    if (body[p] == ',') {
      ++p;
      continue;
    }
    if (body[p] == '}') {
      ++p;
      break;
    }
    return false;
  }
  skipWs(body, len, &p);
  if (p != len) return false;  // trailing garbage
  if (!haveUrl) return false;
  if (!parseRegisterUrl(out->url, urlLen, out->ip, &out->port, out->key)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Members (S6).

struct MemberList {
  size_t count;
  char names[kMaxMembers][kNameCap];
};

inline void memberListInit(MemberList *list) { memset(list, 0, sizeof(*list)); }

// Applies an accepted registration: a non-empty members list replaces the
// known one (same order, authoritative); without one (old app), the phone's
// name is added when missing and there is room. Returns true only when the
// list changed, so flash is written only then. (Adding the name on top of a
// members list would make two phones with non-member names rewrite the list
// on every registration.)
inline bool memberListLearn(MemberList *list, const RegisterRequest &req) {
  MemberList next;
  memberListInit(&next);
  bool replace = req.hasMembers && req.memberCount > 0;
  if (replace) {
    for (size_t i = 0; i < req.memberCount && i < kMaxMembers; ++i) {
      memcpy(next.names[i], req.members[i], sizeof(next.names[i]));
    }
    next.count = req.memberCount < kMaxMembers ? req.memberCount : kMaxMembers;
  } else {
    for (size_t i = 0; i < list->count; ++i) memcpy(next.names[i], list->names[i], sizeof(next.names[i]));
    next.count = list->count;
  }
  if (!replace && req.name[0] != '\0' && next.count < kMaxMembers && !nameListHas(next.names, next.count, req.name)) {
    memcpy(next.names[next.count], req.name, sizeof(next.names[next.count]));
    ++next.count;
  }
  bool changed = next.count != list->count;
  for (size_t i = 0; !changed && i < next.count; ++i) changed = strcmp(next.names[i], list->names[i]) != 0;
  if (changed) memcpy(list, &next, sizeof(next));
  return changed;
}

// Largest serialized MemberList: every name with its NUL.
static const size_t kMembersBlobCap = kMaxMembers * kNameCap;

// Names one after the other, each followed by NUL. Returns the length (0 when
// the list is empty or cap is too small).
inline size_t memberListSerialize(const MemberList *list, char *out, size_t cap) {
  size_t n = 0;
  for (size_t i = 0; i < list->count; ++i) {
    size_t k = strlen(list->names[i]) + 1;
    if (n + k > cap) return 0;
    memcpy(out + n, list->names[i], k);
    n += k;
  }
  return n;
}

// Rebuilds a list from stored bytes, trusting nothing: each NUL-terminated
// name must be valid UTF-8 and is normalized; empty, repeated or extra names
// and an unterminated tail are dropped.
inline void memberListDeserialize(MemberList *list, const char *buf, size_t len) {
  memberListInit(list);
  size_t start = 0;
  for (size_t i = 0; i < len && list->count < kMaxMembers; ++i) {
    if (buf[i] != '\0') continue;
    size_t segLen = i - start;
    const char *seg = buf + start;
    start = i + 1;
    if (segLen == 0 || segLen >= kNameCap) continue;
    bool valid = true;
    for (size_t q = 0; q < segLen && valid;) {
      size_t k = utf8SeqLen(seg, segLen, q);
      if (k == 0) valid = false;
      q += k;
    }
    if (!valid) continue;
    char name[kNameCap];
    memcpy(name, seg, segLen);
    name[segLen] = '\0';
    normalizeName(name);
    if (name[0] == '\0' || nameListHas(list->names, list->count, name)) continue;
    memcpy(list->names[list->count], name, segLen + 1);
    ++list->count;
  }
}

inline bool sameIp(const uint8_t a[4], const uint8_t b[4]) {
  return a[0] == b[0] && a[1] == b[1] && a[2] == b[2] && a[3] == b[3];
}

// ---------------------------------------------------------------------------
// Registry.

// Elapsed ms between two millis() readings; correct across the 2^32 wrap.
inline uint32_t elapsedMs(uint32_t now, uint32_t then) { return (uint32_t)(now - then); }

struct Phone {
  bool used;
  uint8_t ip[4];
  uint32_t lastSeenMs;
  char url[kUrlCap];
  char name[kNameCap];
};

struct Registry {
  Phone phones[kMaxPhones];
};

inline void registryInit(Registry *r) { memset(r, 0, sizeof(*r)); }

// Drops entries not seen within kFreshMs. Call often (every loop) so no entry
// can live long enough for its elapsed time to wrap around.
inline void registryExpire(Registry *r, uint32_t nowMs) {
  for (size_t i = 0; i < kMaxPhones; ++i) {
    if (r->phones[i].used && elapsedMs(nowMs, r->phones[i].lastSeenMs) > kFreshMs) r->phones[i].used = false;
  }
}

// Inserts or refreshes the phone keyed by req.ip; when full, replaces the
// least recently seen one.
inline void registryUpsert(Registry *r, const RegisterRequest &req, uint32_t nowMs) {
  registryExpire(r, nowMs);
  Phone *slot = NULL;
  for (size_t i = 0; i < kMaxPhones && slot == NULL; ++i) {
    if (r->phones[i].used && sameIp(r->phones[i].ip, req.ip)) slot = &r->phones[i];
  }
  for (size_t i = 0; i < kMaxPhones && slot == NULL; ++i) {
    if (!r->phones[i].used) slot = &r->phones[i];
  }
  if (slot == NULL) {
    slot = &r->phones[0];
    for (size_t i = 1; i < kMaxPhones; ++i) {
      if (elapsedMs(nowMs, r->phones[i].lastSeenMs) > elapsedMs(nowMs, slot->lastSeenMs)) slot = &r->phones[i];
    }
  }
  slot->used = true;
  memcpy(slot->ip, req.ip, 4);
  slot->lastSeenMs = nowMs;
  memcpy(slot->url, req.url, sizeof(slot->url));
  memcpy(slot->name, req.name, sizeof(slot->name));
}

// Appends text as a JSON string body (without quotes). Returns false on overflow.
inline bool appendJsonEscaped(const char *text, char *out, size_t cap, size_t *n) {
  for (const unsigned char *c = (const unsigned char *)text; *c; ++c) {
    char buf[8];
    size_t k;
    if (*c == '"' || *c == '\\') {
      buf[0] = '\\';
      buf[1] = (char)*c;
      k = 2;
    } else if (*c < 0x20 || *c == '<' || *c == '>' || *c == '&') {
      static const char kHex[] = "0123456789abcdef";
      buf[0] = '\\';
      buf[1] = 'u';
      buf[2] = '0';
      buf[3] = '0';
      buf[4] = kHex[(*c >> 4) & 0x0F];
      buf[5] = kHex[*c & 0x0F];
      k = 6;
    } else {
      buf[0] = (char)*c;
      k = 1;
    }
    if (*n + k >= cap) return false;
    memcpy(out + *n, buf, k);
    *n += k;
  }
  out[*n] = '\0';
  return true;
}

inline bool appendRaw(const char *text, char *out, size_t cap, size_t *n) {
  size_t k = strlen(text);
  if (*n + k >= cap) return false;
  memcpy(out + *n, text, k);
  *n += k;
  out[*n] = '\0';
  return true;
}

// Fresh phones, most recent first, as {"phones":[{"url","name","ageSeconds"}]};
// with a member list, {"phones":[...],"members":["..."]} (S6).
// Returns the length written, or 0 if cap is too small.
inline size_t buildPhonesJson(Registry *r, uint32_t nowMs, char *out, size_t cap, const MemberList *members = NULL) {
  registryExpire(r, nowMs);
  size_t order[kMaxPhones];
  size_t count = 0;
  for (size_t i = 0; i < kMaxPhones; ++i) {
    if (r->phones[i].used) order[count++] = i;
  }
  for (size_t i = 1; i < count; ++i) {  // insertion sort by age ascending
    size_t v = order[i];
    size_t j = i;
    while (j > 0 && elapsedMs(nowMs, r->phones[order[j - 1]].lastSeenMs) > elapsedMs(nowMs, r->phones[v].lastSeenMs)) {
      order[j] = order[j - 1];
      --j;
    }
    order[j] = v;
  }
  size_t n = 0;
  if (cap == 0) return 0;
  out[0] = '\0';
  if (!appendRaw("{\"phones\":[", out, cap, &n)) return 0;
  for (size_t i = 0; i < count; ++i) {
    const Phone &ph = r->phones[order[i]];
    char age[16];
    snprintf(age, sizeof(age), "%lu", (unsigned long)(elapsedMs(nowMs, ph.lastSeenMs) / 1000UL));
    if (i > 0 && !appendRaw(",", out, cap, &n)) return 0;
    if (!appendRaw("{\"url\":\"", out, cap, &n)) return 0;
    if (!appendJsonEscaped(ph.url, out, cap, &n)) return 0;
    if (!appendRaw("\",\"name\":\"", out, cap, &n)) return 0;
    if (!appendJsonEscaped(ph.name, out, cap, &n)) return 0;
    if (!appendRaw("\",\"ageSeconds\":", out, cap, &n)) return 0;
    if (!appendRaw(age, out, cap, &n)) return 0;
    if (!appendRaw("}", out, cap, &n)) return 0;
  }
  if (!appendRaw("]", out, cap, &n)) return 0;
  if (members != NULL) {
    if (!appendRaw(",\"members\":[", out, cap, &n)) return 0;
    for (size_t i = 0; i < members->count; ++i) {
      if (i > 0 && !appendRaw(",", out, cap, &n)) return 0;
      if (!appendRaw("\"", out, cap, &n)) return 0;
      if (!appendJsonEscaped(members->names[i], out, cap, &n)) return 0;
      if (!appendRaw("\"", out, cap, &n)) return 0;
    }
    if (!appendRaw("]", out, cap, &n)) return 0;
  }
  if (!appendRaw("}", out, cap, &n)) return 0;
  return n;
}

// Worst case: phones 4 * (url 37 + name 40*6 escaped + ~45 framing) + 14 < 1400,
// members 4 * (40*6 escaped + 3) + 13 < 1000.
static const size_t kPhonesJsonCap = 2560;

}  // namespace tvhub

#endif  // MAYLO_TV_HUB_REGISTER_VALIDATION_H
