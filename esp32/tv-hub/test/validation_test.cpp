// Host test for register_validation.h (not part of the Arduino build: the IDE
// only compiles the sketch folder root and src/).
//
//   g++ -std=c++11 -Wall -Wextra -o /tmp/validation_test esp32/tv-hub/test/validation_test.cpp && /tmp/validation_test
#include "../register_validation.h"

#include <stdio.h>
#include <string.h>

using namespace tvhub;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                              \
  do {                                                           \
    ++checks;                                                    \
    if (!(cond)) {                                               \
      ++failures;                                                \
      printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);     \
    }                                                            \
  } while (0)

static bool url(const char *s) {
  uint8_t ip[4];
  uint16_t port;
  char key[kKeyLen + 1];
  return parseRegisterUrl(s, strlen(s), ip, &port, key);
}

static bool body(const char *s, RegisterRequest *req) { return parseRegisterBody(s, strlen(s), req); }

static void testUrl() {
  CHECK(url("http://192.168.0.10:8765/tv/aB3xY9"));
  CHECK(url("http://0.0.0.0:8775/tv/000000"));
  CHECK(url("http://255.255.255.255:8770/tv/ZZZZZZ"));
  // ports: only 8765..8775
  CHECK(!url("http://192.168.0.10:8764/tv/aB3xY9"));
  CHECK(!url("http://192.168.0.10:8776/tv/aB3xY9"));
  CHECK(!url("http://192.168.0.10:08765/tv/aB3xY9"));
  CHECK(!url("http://192.168.0.10:87650/tv/aB3xY9"));
  CHECK(!url("http://192.168.0.10/tv/aB3xY9"));
  // ipv4
  CHECK(!url("http://256.1.1.1:8765/tv/aB3xY9"));
  CHECK(!url("http://192.168.0:8765/tv/aB3xY9"));
  CHECK(!url("http://192.168.0.1.2:8765/tv/aB3xY9"));
  CHECK(!url("http://192.168.00.1:8765/tv/aB3xY9"));
  CHECK(!url("http://1922.168.0.1:8765/tv/aB3xY9"));
  CHECK(!url("http://phone.local:8765/tv/aB3xY9"));
  // key: exactly 6 alnum, end of string
  CHECK(!url("http://192.168.0.10:8765/tv/aB3xY"));
  CHECK(!url("http://192.168.0.10:8765/tv/aB3xY9a"));
  CHECK(!url("http://192.168.0.10:8765/tv/aB3-Y9"));
  CHECK(!url("http://192.168.0.10:8765/tv/aB3xY9/"));
  CHECK(!url("http://192.168.0.10:8765/tv/aB3xY9?x"));
  CHECK(!url("https://192.168.0.10:8765/tv/aB3xY9"));
  CHECK(!url("HTTP://192.168.0.10:8765/tv/aB3xY9"));
  CHECK(!url(" http://192.168.0.10:8765/tv/aB3xY9"));
  CHECK(!url("http://192.168.0.10:8765/TV/aB3xY9"));
  CHECK(!url(""));

  uint8_t ip[4];
  uint16_t port = 0;
  char key[kKeyLen + 1];
  const char *s = "http://10.0.200.7:8772/tv/Key123";
  CHECK(parseRegisterUrl(s, strlen(s), ip, &port, key));
  CHECK(ip[0] == 10 && ip[1] == 0 && ip[2] == 200 && ip[3] == 7);
  CHECK(port == 8772);
  CHECK(strcmp(key, "Key123") == 0);
}

static void testBody() {
  RegisterRequest req;
  CHECK(body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"Marcos\"}", &req));
  CHECK(strcmp(req.url, "http://192.168.0.10:8765/tv/aB3xY9") == 0);
  CHECK(strcmp(req.name, "Marcos") == 0);
  CHECK(req.ip[3] == 10 && req.port == 8765);

  // whitespace, key order, unknown keys, escapes
  CHECK(body(" { \"name\" : \"  Mam\\u00e1 \\\"Ana\\\"  \" , \"x\":\"y\", \"url\" : \"http:\\/\\/192.168.0.10:8765\\/tv\\/aB3xY9\" } ", &req));
  CHECK(strcmp(req.name, "Mam\xc3\xa1 \"Ana\"") == 0);
  CHECK(strcmp(req.url, "http://192.168.0.10:8765/tv/aB3xY9") == 0);

  // name optional
  CHECK(body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\"}", &req));
  CHECK(req.name[0] == '\0');

  // name trimmed to 40 code points
  CHECK(body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"0123456789012345678901234567890123456789EXTRA\"}", &req));
  CHECK(strcmp(req.name, "0123456789012345678901234567890123456789") == 0);
  // 45 x "ñ" (2 bytes each) -> 40 code points, 80 bytes
  {
    char b[400];
    char n[200] = "";
    for (int i = 0; i < 45; ++i) strcat(n, "\xc3\xb1");
    snprintf(b, sizeof(b), "{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"%s\"}", n);
    CHECK(body(b, &req));
    CHECK(strlen(req.name) == 80);
  }

  // rejections
  CHECK(!body("", &req));
  CHECK(!body("{}", &req));
  CHECK(!body("[]", &req));
  CHECK(!body("{\"name\":\"x\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8799/tv/aB3xY9\",\"name\":\"x\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":1}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\"} x", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\"", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"a\\u0000b\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"a\\ud800b\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"a\nb\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"\xff\"}", &req));
  CHECK(!body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\\u0000\"}", &req));

  // body limit: 1024 accepted, 1025 rejected (raised from 512 for members, S6)
  CHECK(kMaxBodyBytes == 1024);
  {
    char b[1100];
    const char *head = "{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"";
    size_t n = strlen(head);
    memcpy(b, head, n);
    while (n < 1024 - 2) b[n++] = 'a';
    b[n++] = '"';
    b[n++] = '}';
    b[n] = '\0';
    CHECK(n == 1024);
    CHECK(parseRegisterBody(b, n, &req));
    CHECK(strlen(req.name) == 40);
    char c[1100];
    memcpy(c, b, n - 2);
    c[n - 2] = 'a';
    c[n - 1] = '"';
    c[n] = '}';
    c[n + 1] = '\0';
    CHECK(!parseRegisterBody(c, n + 1, &req));
  }
}

static const char *kUrlField = "\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\"";

// {"url":...,<rest>}
static bool bodyWith(const char *rest, RegisterRequest *req) {
  char b[1200];
  snprintf(b, sizeof(b), "{%s,%s}", kUrlField, rest);
  return body(b, req);
}

static void testMembers() {
  RegisterRequest req;

  // absent: old phones keep working
  CHECK(body("{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"Marcos\"}", &req));
  CHECK(!req.hasMembers && req.memberCount == 0);

  // order kept, names trimmed, empty and repeated names dropped
  CHECK(bodyWith("\"name\":\"Marcos\",\"members\":[\" Loana \",\"Marcos\",\"\",\"Loana\"]", &req));
  CHECK(req.hasMembers && req.memberCount == 2);
  CHECK(strcmp(req.members[0], "Loana") == 0 && strcmp(req.members[1], "Marcos") == 0);
  CHECK(strcmp(req.name, "Marcos") == 0);

  // members before url, whitespace inside the array, escapes decoded
  CHECK(body("{ \"members\" : [ \"Mam\\u00e1\" , \"B\" ] , \"url\":\"http://192.168.0.10:8765/tv/aB3xY9\"}", &req));
  CHECK(req.memberCount == 2 && strcmp(req.members[0], "Mam\xc3\xa1") == 0);

  // empty array is accepted (no members)
  CHECK(bodyWith("\"members\":[]", &req));
  CHECK(req.hasMembers && req.memberCount == 0);
  CHECK(bodyWith("\"members\":[ ]", &req));

  // each name cut at 40 code points like name
  {
    char rest[600];
    char n[200] = "";
    for (int i = 0; i < 45; ++i) strcat(n, "\xc3\xb1");
    snprintf(rest, sizeof(rest), "\"members\":[\"%s\",\"0123456789012345678901234567890123456789EXTRA\"]", n);
    CHECK(bodyWith(rest, &req));
    CHECK(req.memberCount == 2 && strlen(req.members[0]) == 80);
    CHECK(strcmp(req.members[1], "0123456789012345678901234567890123456789") == 0);
  }

  // 4 accepted, 5 rejected
  CHECK(bodyWith("\"members\":[\"A\",\"B\",\"C\",\"D\"]", &req));
  CHECK(req.memberCount == 4 && strcmp(req.members[3], "D") == 0);
  CHECK(!bodyWith("\"members\":[\"A\",\"B\",\"C\",\"D\",\"E\"]", &req));

  // four 40-emoji names plus a 40-emoji name fit in the 1024-byte body
  {
    char rest[1200];
    char e39[200] = "";
    for (int i = 0; i < 39; ++i) strcat(e39, "\xf0\x9f\x98\x80");
    snprintf(rest, sizeof(rest), "\"name\":\"%s%s\",\"members\":[\"%s%s\",\"%sa\",\"%sb\",\"%sc\"]", e39,
             "\xf0\x9f\x98\x80", e39, "\xf0\x9f\x98\x80", e39, e39, e39);
    char full[1300];
    snprintf(full, sizeof(full), "{%s,%s}", kUrlField, rest);
    CHECK(strlen(full) <= kMaxBodyBytes);
    CHECK(bodyWith(rest, &req));
    CHECK(req.memberCount == 4 && strlen(req.members[0]) == 160 && strlen(req.name) == 160);
    CHECK(strlen(req.members[3]) == 157);
  }

  // rejections: not an array of strings, bad strings, malformed arrays, duplicates
  CHECK(!bodyWith("\"members\":\"Loana\"", &req));
  CHECK(!bodyWith("\"members\":null", &req));
  CHECK(!bodyWith("\"members\":{}", &req));
  CHECK(!bodyWith("\"members\":[1]", &req));
  CHECK(!bodyWith("\"members\":[\"A\",null]", &req));
  CHECK(!bodyWith("\"members\":[[\"A\"]]", &req));
  CHECK(!bodyWith("\"members\":[\"A\",]", &req));
  CHECK(!bodyWith("\"members\":[,\"A\"]", &req));
  CHECK(!bodyWith("\"members\":[\"A\" \"B\"]", &req));
  CHECK(!bodyWith("\"members\":[\"A\"", &req));
  CHECK(!bodyWith("\"members\":[\"a\\u0000b\"]", &req));
  CHECK(!bodyWith("\"members\":[\"a\\ud800b\"]", &req));
  CHECK(!bodyWith("\"members\":[\"a\nb\"]", &req));
  CHECK(!bodyWith("\"members\":[\"\xff\"]", &req));
  CHECK(!bodyWith("\"members\":[\"A\"],\"members\":[\"B\"]", &req));
  // other unknown keys still only take strings
  CHECK(!bodyWith("\"x\":[\"A\"]", &req));
}

static RegisterRequest parsed(const char *rest) {
  RegisterRequest r;
  bool ok = bodyWith(rest, &r);
  CHECK(ok);
  return r;
}

static void testMemberList() {
  MemberList list;
  memberListInit(&list);

  // old phones: names are learned in arrival order, once
  CHECK(memberListLearn(&list, parsed("\"name\":\"Marcos\"")));
  CHECK(!memberListLearn(&list, parsed("\"name\":\"Marcos\"")));
  CHECK(!memberListLearn(&list, parsed("\"name\":\"\"")));
  CHECK(memberListLearn(&list, parsed("\"name\":\"Loana\"")));
  CHECK(list.count == 2 && strcmp(list.names[0], "Marcos") == 0 && strcmp(list.names[1], "Loana") == 0);

  // a members list replaces it (its order wins); the same list again is no change
  CHECK(memberListLearn(&list, parsed("\"name\":\"Marcos\",\"members\":[\"Loana\",\"Marcos\"]")));
  CHECK(list.count == 2 && strcmp(list.names[0], "Loana") == 0 && strcmp(list.names[1], "Marcos") == 0);
  CHECK(!memberListLearn(&list, parsed("\"name\":\"Loana\",\"members\":[\"Loana\",\"Marcos\"]")));
  // a name outside the sent members is not added (no rewrite ping-pong)
  CHECK(!memberListLearn(&list, parsed("\"name\":\"Tablet\",\"members\":[\"Loana\",\"Marcos\"]")));
  // an empty members array counts as none: the name is learned
  CHECK(memberListLearn(&list, parsed("\"name\":\"Tablet\",\"members\":[]")));
  CHECK(list.count == 3 && strcmp(list.names[2], "Tablet") == 0);
  // a renamed member replaces the old name
  CHECK(memberListLearn(&list, parsed("\"members\":[\"Loana\",\"Marquitos\"]")));
  CHECK(list.count == 2 && strcmp(list.names[1], "Marquitos") == 0);
  // full: an unknown name is not added
  CHECK(memberListLearn(&list, parsed("\"members\":[\"A\",\"B\",\"C\",\"D\"]")));
  CHECK(!memberListLearn(&list, parsed("\"name\":\"E\"")));
  CHECK(list.count == 4);

  // serialize / deserialize round trip
  char blob[kMembersBlobCap];
  size_t n = memberListSerialize(&list, blob, sizeof(blob));
  CHECK(n == 8 && memcmp(blob, "A\0B\0C\0D\0", 8) == 0);
  MemberList back;
  memberListDeserialize(&back, blob, n);
  CHECK(back.count == 4 && strcmp(back.names[3], "D") == 0);
  MemberList empty;
  memberListInit(&empty);
  CHECK(memberListSerialize(&empty, blob, sizeof(blob)) == 0);

  // stored bytes are not trusted: bad UTF-8, empty, repeated, untrimmed and
  // unterminated names are dropped or fixed
  const char bad[] = "Ana\0\xff\0\0Ana\0 Leo \0Tail";
  memberListDeserialize(&back, bad, sizeof(bad) - 1);
  CHECK(back.count == 2 && strcmp(back.names[0], "Ana") == 0 && strcmp(back.names[1], "Leo") == 0);
  memberListDeserialize(&back, "", 0);
  CHECK(back.count == 0);
}

static void testPhonesJsonMembers() {
  Registry reg;
  registryInit(&reg);
  MemberList list;
  memberListInit(&list);
  char json[kPhonesJsonCap];

  CHECK(buildPhonesJson(&reg, 1000, json, sizeof(json), &list) > 0);
  CHECK(strcmp(json, "{\"phones\":[],\"members\":[]}") == 0);

  memberListLearn(&list, parsed("\"members\":[\"Loana\",\"M<a\\\"r\"]"));
  registryUpsert(&reg, parsed("\"name\":\"Loana\""), 1000);
  buildPhonesJson(&reg, 3000, json, sizeof(json), &list);
  CHECK(strcmp(json,
               "{\"phones\":[{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"Loana\",\"ageSeconds\":2}],"
               "\"members\":[\"Loana\",\"M\\u003ca\\\"r\"]}") == 0);

  // worst case fits: 4 phones and 4 members of 40 escaped characters
  Registry full;
  registryInit(&full);
  MemberList big;
  memberListInit(&big);
  for (size_t i = 0; i < kMaxMembers; ++i) {
    for (size_t k = 0; k < kMaxNameChars - 1; ++k) big.names[i][k] = '<';
    big.names[i][kMaxNameChars - 1] = (char)('0' + i);
    big.names[i][kMaxNameChars] = '\0';
  }
  big.count = kMaxMembers;
  for (uint8_t i = 0; i < kMaxPhones; ++i) {
    RegisterRequest r;
    char b[300];
    snprintf(b, sizeof(b), "{\"url\":\"http://192.168.100.%u:8775/tv/aB3xY9\",\"name\":\"%s\"}", (unsigned)(200 + i),
             "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
    CHECK(parseRegisterBody(b, strlen(b), &r));
    registryUpsert(&full, r, 1000);
  }
  CHECK(buildPhonesJson(&full, 1000, json, sizeof(json), &big) > 0);
}

static RegisterRequest makeReq(uint8_t last, const char *name) {
  RegisterRequest r;
  char b[200];
  snprintf(b, sizeof(b), "{\"url\":\"http://192.168.0.%u:8765/tv/aB3xY9\",\"name\":\"%s\"}", (unsigned)last, name);
  bool ok = parseRegisterBody(b, strlen(b), &r);
  CHECK(ok);
  return r;
}

static void testRegistry() {
  Registry reg;
  registryInit(&reg);
  char json[kPhonesJsonCap];

  CHECK(buildPhonesJson(&reg, 1000, json, sizeof(json)) > 0);
  CHECK(strcmp(json, "{\"phones\":[]}") == 0);

  registryUpsert(&reg, makeReq(10, "A"), 1000);
  registryUpsert(&reg, makeReq(11, "B<"), 5000);
  buildPhonesJson(&reg, 7000, json, sizeof(json));
  CHECK(strcmp(json,
               "{\"phones\":[{\"url\":\"http://192.168.0.11:8765/tv/aB3xY9\",\"name\":\"B\\u003c\",\"ageSeconds\":2},"
               "{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"A\",\"ageSeconds\":6}]}") == 0);

  // same IP refreshes instead of adding
  registryUpsert(&reg, makeReq(10, "A2"), 8000);
  buildPhonesJson(&reg, 8000, json, sizeof(json));
  CHECK(strstr(json, "{\"phones\":[{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"A2\",\"ageSeconds\":0}") == json);
  CHECK(strstr(json, "\"A\"") == NULL);

  // max 4, the least recent is replaced
  registryUpsert(&reg, makeReq(12, "C"), 9000);
  registryUpsert(&reg, makeReq(13, "D"), 10000);
  registryUpsert(&reg, makeReq(14, "E"), 11000);
  buildPhonesJson(&reg, 11000, json, sizeof(json));
  CHECK(strstr(json, "\"B\\u003c\"") == NULL);
  CHECK(strstr(json, "\"E\"") != NULL && strstr(json, "\"A2\"") != NULL);

  // freshness: 180 s inclusive, 180.001 s expired
  Registry r2;
  registryInit(&r2);
  registryUpsert(&r2, makeReq(20, "F"), 0);
  buildPhonesJson(&r2, 180000, json, sizeof(json));
  CHECK(strstr(json, "\"ageSeconds\":180") != NULL);
  buildPhonesJson(&r2, 180001, json, sizeof(json));
  CHECK(strcmp(json, "{\"phones\":[]}") == 0);

  // millis() wrap-around
  Registry r3;
  registryInit(&r3);
  registryUpsert(&r3, makeReq(30, "G"), 0xFFFFF000UL);
  CHECK(elapsedMs(0x00001000UL, 0xFFFFF000UL) == 0x2000UL);
  buildPhonesJson(&r3, 0x00001000UL, json, sizeof(json));
  CHECK(strstr(json, "\"ageSeconds\":8") != NULL);  // 8192 ms
}

int main() {
  testUrl();
  testBody();
  testMembers();
  testMemberList();
  testRegistry();
  testPhonesJsonMembers();
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
