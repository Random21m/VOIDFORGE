/* Writes a Berkeley DB btree file the way Bitcoin Core's BDB wallet code opens it: one subdatabase named "main" of type
   DB_BTREE (bitcoin/bitcoin v29.0, src/wallet/bdb.cpp: pdb->open(nullptr, strFile.c_str(), "main", DB_BTREE, nFlags, 0)).
   For tests/walletdat.test.mjs only: it reads "KEYHEX VALUEHEX" lines on stdin and puts each pair.
   Build: gcc -O1 -o bdbwrite bdbwrite.c -ldb     Run: ./bdbwrite out.dat PAGESIZE LORDER(1234 or 4321) < records.txt */
#include <db.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int unhex(const char *s, unsigned char *out){ int n = 0; while(s[0] && s[1] && s[0] != ' ' && s[0] != '\n'){ unsigned v; if(sscanf(s, "%2x", &v) != 1) return -1; out[n++] = (unsigned char)v; s += 2; } return n; }
int main(int argc, char **argv){
  if(argc != 4){ fprintf(stderr, "usage: bdbwrite out.dat pagesize lorder\n"); return 2; }
  DB *db; int r = db_create(&db, NULL, 0); if(r){ fprintf(stderr, "db_create: %s\n", db_strerror(r)); return 1; }
  if((r = db->set_pagesize(db, (u_int32_t)atoi(argv[2])))){ fprintf(stderr, "set_pagesize: %s\n", db_strerror(r)); return 1; }
  if((r = db->set_lorder(db, atoi(argv[3])))){ fprintf(stderr, "set_lorder: %s\n", db_strerror(r)); return 1; }
  if((r = db->open(db, NULL, argv[1], "main", DB_BTREE, DB_CREATE | DB_EXCL, 0600))){ fprintf(stderr, "open: %s\n", db_strerror(r)); return 1; }
  static char line[2000000]; static unsigned char k[1000000], v[1000000];
  while(fgets(line, sizeof line, stdin)){
    char *sp = strchr(line, ' '); if(!sp) continue;
    int kl = unhex(line, k), vl = unhex(sp + 1, v); if(kl < 0 || vl < 0){ fprintf(stderr, "bad hex\n"); return 1; }
    DBT dk, dv; memset(&dk, 0, sizeof dk); memset(&dv, 0, sizeof dv); dk.data = k; dk.size = kl; dv.data = v; dv.size = vl;
    if((r = db->put(db, NULL, &dk, &dv, DB_NOOVERWRITE))){ fprintf(stderr, "put: %s\n", db_strerror(r)); return 1; }
  }
  if((r = db->close(db, 0))){ fprintf(stderr, "close: %s\n", db_strerror(r)); return 1; }
  return 0;
}
