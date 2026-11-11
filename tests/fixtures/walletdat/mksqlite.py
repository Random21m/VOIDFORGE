"""Writes one SQLite wallet file the way Bitcoin Core's src/wallet/sqlite.cpp (tag v29.0) sets it up, for gen.mjs.
The table: CREATE TABLE main(key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL); PRAGMA application_id = the network's message
start read as a big-endian number (ReadBE32(Params().MessageStart())); PRAGMA user_version = 0 (WALLET_SCHEMA_VERSION).
Run by gen.mjs: python3 -I mksqlite.py job.json
"""
import json, sqlite3, struct, sys

job = json.load(open(sys.argv[1]))
con = sqlite3.connect(job["path"])
con.execute("PRAGMA page_size = %d" % job["page_size"])
app = struct.unpack(">i", bytes.fromhex(job["app_id"]))[0]   # sqlite.cpp: strprintf("%d", static_cast<int32_t>(app_id))
con.execute("CREATE TABLE main(key BLOB PRIMARY KEY NOT NULL, value BLOB NOT NULL)")
con.execute("PRAGMA application_id = %d" % app)
con.execute("PRAGMA user_version = 0")
con.executemany("INSERT INTO main VALUES (?, ?)", [(bytes.fromhex(k), bytes.fromhex(v)) for k, v in job["records"]])
con.commit()
con.close()
