// Writes the Damascus method's generated docs from the page itself, so they always say what the page says (v2.14.0):
//   docs/damascus-kit.html, docs/damascus-kit-24.html  the printable kit (quick guide, Hammer, Anvil and Forge sheets, word table,
//                                                       backup card, trial checklist), 12 and 24 words; prints on Letter or A4
//   docs/damascus-examples.md                           the three worked examples, worked out in full
// Run from the repository: node tools/damascus/build-docs.mjs     (tests/vfmethod.test.mjs checks the files are up to date)
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPage, ready, readHtml } from "../../tests/harness.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const w = await ready(loadPage(readHtml()));
writeFileSync(path.join(root, "docs", "damascus-kit.html"), w.dmKitFile(12));
writeFileSync(path.join(root, "docs", "damascus-kit-24.html"), w.dmKitFile(24));
writeFileSync(path.join(root, "docs", "damascus-examples.md"), await w.dmExamplesMd());
console.log("wrote docs/damascus-kit.html, docs/damascus-kit-24.html, docs/damascus-examples.md");
