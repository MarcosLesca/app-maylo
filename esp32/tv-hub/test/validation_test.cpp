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

  // body limit: 512 accepted, 513 rejected
  {
    char b[600];
    const char *head = "{\"url\":\"http://192.168.0.10:8765/tv/aB3xY9\",\"name\":\"";
    size_t n = strlen(head);
    memcpy(b, head, n);
    while (n < 512 - 2) b[n++] = 'a';
    b[n++] = '"';
    b[n++] = '}';
    b[n] = '\0';
    CHECK(n == 512);
    CHECK(parseRegisterBody(b, n, &req));
    CHECK(strlen(req.name) == 40);
    char c[600];
    memcpy(c, b, n - 2);
    c[n - 2] = 'a';
    c[n - 1] = '"';
    c[n] = '}';
    c[n + 1] = '\0';
    CHECK(!parseRegisterBody(c, n + 1, &req));
  }
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
  testRegistry();
  printf("%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
