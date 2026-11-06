// Automated checks for voidforge.html. Run: npm i jsdom && node tests/test.js [path/to/voidforge.html]
const {JSDOM}=require('jsdom'); const fs=require('fs'); const path=require('path'); const nc=require('crypto');
const file=process.argv[2]||path.join(__dirname,'..','voidforge.html');
const html=fs.readFileSync(file,'utf8');
// Removes every <script ...>...</script> block by position (no regular expression), for tests that scan the page text.
function stripScripts(h){ let out='', i=0; for(;;){ const a=h.toLowerCase().indexOf('<script', i); if(a<0){ out+=h.slice(i); break; } out+=h.slice(i,a); const b=h.toLowerCase().indexOf('</script', a); if(b<0) break; const c=h.indexOf('>', b); if(c<0) break; i=c+1; } return out; }
let failed=0; const ok=(c,m)=>{ console.log((c?'PASS ':'FAIL ')+m); if(!c) failed++; };
const eq=(a,b,m)=>ok(a===b, m+(a===b?'':` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

function load(opts={}){ 
  const errors=[]; const st={blob:null,printed:0,clip:[],confirms:0,alerts:[]};
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.org/',
    beforeParse(w){
      Object.defineProperty(w,'crypto',{value:nc.webcrypto});
      if(!w.TextEncoder) w.TextEncoder=TextEncoder; if(!w.TextDecoder) w.TextDecoder=TextDecoder; // older jsdom omits these; real browsers have them
      w.alert=m=>st.alerts.push(m); w.confirm=()=>{st.confirms++;return opts.confirm!==false;};
      w.addEventListener('error',e=>errors.push(e.message));
      w.URL.createObjectURL=b=>{st.blob=b;return 'blob:x';}; w.URL.revokeObjectURL=()=>{};
      w.HTMLAnchorElement.prototype.click=function(){}; w.Element.prototype.scrollIntoView=function(){};
      if(opts.offline) Object.defineProperty(w.navigator,'onLine',{configurable:true,get:()=>false});
      if(opts.ack) w.sessionStorage.setItem('voidforge-ack','1');
      if(opts.focusSpy){ st.focus=[]; w.HTMLElement.prototype.focus=function(o){ st.focus.push([this.id,o]); }; }
      w.print=()=>{ st.printed++; st.printHTML=w.document.getElementById('printOnly').textContent; st.printCells=[...w.document.querySelectorAll('#printOnly .ps-cell')].map(c=>c.textContent); st.printClass=w.document.body.className; st.printQrText=w.document.getElementById('printQr').textContent; st.printQrHTML=w.document.getElementById('printQr').innerHTML; };
      Object.defineProperty(w.navigator,'clipboard',{value:{writeText:async t=>{st.clip.push(t);}}});
    }});
  const w=dom.window; return {w,ready:()=>w.selfTestDone,d:w.document,$:id=>w.document.getElementById(id),st,errors,
    set(v){ this.$('rolls').value=v; this.$('rolls').oninput(); },
    mode(m){ const e=this.d.querySelector(`input[name=mode][value=${m}]`); e.checked=true; e.onchange(); },
    words(n){ const e=this.d.querySelector(`input[name=words][value="${n}"]`); e.checked=true; e.onchange(); }};
}
const blobText=(w,b)=>b.text?b.text():new Promise((res,rej)=>{const r=new w.FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(b);});
const rnd=(n,k)=>Array.from({length:n},()=>String(k===2?nc.randomInt(2):1+nc.randomInt(6))).join('');

(async()=>{
  let t=load(); await t.ready(); await t.ready();
  // --- self-test (known-answer vectors) ---
  await t.w.runSelfTests();
  ok(/^ALL \d+ TESTS PASSED/.test(t.$('testResults').textContent),'in-page SELF-TEST passes: '+t.$('testResults').textContent.split('\n')[0]);
  // address finder
  { const AB='abandon '.repeat(11)+'about'; t.$('phrase').value=AB; t.$('verifyPass').value='';
    const C=async(x,r)=>{ t.$('checkAddr').value=x; await t.w.checkAddress(r); return [t.$('addrCheckStatus').textContent,t.$('addrCheckStatus').className]; };
    let [tx,cl]=await C('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',4); ok(/^FOUND: this SegWit address is receive address #0 \(m\/84'\/0'\/0'\/0\/0\)/.test(tx)&&/ok/.test(cl),'address finder: SegWit receive #0 found');
    [tx,cl]=await C('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',4); ok(/receive address #1 /.test(tx),'address finder: SegWit receive #1 found');
    [tx,cl]=await C('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',4); ok(/^FOUND: this Taproot address is receive address #0 \(m\/86'\/0'\/0'\/0\/0\)/.test(tx),'address finder: Taproot receive #0 found');
    [tx,cl]=await C('bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7',4); ok(/change address #0 /.test(tx),'address finder: Taproot change #0 found');
    [tx,cl]=await C('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',4); ok(/^NOT FOUND in indices 0 to 3 /.test(tx)&&/bad/.test(cl),'address finder: another address is NOT FOUND');
    [tx,cl]=await C('hello',4); ok(/Enter a bc1q/.test(tx),'address finder: rejects text that is not an address');
    t.$('phrase').value='abandon abandon'; [tx,cl]=await C('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',4); ok(/valid seed phrase/.test(tx),'address finder: needs a valid phrase');
    t.$('phrase').value=''; t.$('checkAddr').value=''; t.$('addrCheckStatus').textContent=''; }
  // Try accounts 0 to 20 (v1.33.0): finds which account an address belongs to, with and without the passphrase
  { const AB='abandon '.repeat(11)+'about'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const addrAt=async(pw,purpose,type,coin,acct,chain,i)=>{ const seed=await t.w.mnemonicToSeed(AB,pw); let [k,c]=await t.w.masterFromSeed(seed); for(const [n,h] of [[purpose,true],[coin,true],[acct,true],[chain,false],[i,false]]) [k,c]=await t.w.ckdPriv(k,c,n,h); return t.w.addressFromKey(type,k,coin===1?'test':'main'); };
    const st=()=>[t.$('addrCheckStatus').textContent,t.$('addrCheckStatus').className];
    const run=async(pw,x,mx,dp)=>{ t.$('phrase').value=AB; t.$('verifyPass').value=pw; t.$('checkAddr').value=x; await t.w.checkAllAccounts(mx,dp); return st(); };
    let [tx,cl]=await run('',await addrAt('',84,'wpkh',0,2,0,1),3,2);
    ok(/^FOUND: this SegWit address is receive address #1 \(m\/84'\/0'\/2'\/0\/1\) of account 2 of these words, without passphrase\. Put 2 in the account box/.test(tx)&&/ok/.test(cl),'try accounts: SegWit account 2 found');
    [tx,cl]=await run('',await addrAt('',86,'tr',0,3,1,0),3,2); ok(/^FOUND: this Taproot address is change address #0 \(m\/86'\/0'\/3'\/1\/0\) of account 3 /.test(tx),'try accounts: the last account in the range (Taproot change) is searched');
    [tx,cl]=await run('TREZOR',await addrAt('TREZOR',49,'sh-wpkh',0,1,0,0),3,2); ok(/^FOUND: this Nested SegWit address is receive address #0 \(m\/49'\/0'\/1'\/0\/0\) of account 1 of these words, with passphrase\./.test(tx),'try accounts: the passphrase variant is searched');
    [tx,cl]=await run('',await addrAt('',44,'pkh',1,0,0,0),3,2); ok(/^FOUND: this Testnet Legacy address is receive address #0 \(m\/44'\/1'\/0'\/0\/0\) of account 0 /.test(tx),'try accounts: testnet addresses say Testnet');
    [tx,cl]=await run('',await addrAt('',84,'wpkh',0,5,0,0),2,2); ok(/^NOT FOUND in accounts 0 to 2 \(first 2 receive and change addresses of each, without passphrase\)\. Things to check: .*type it in the box above/.test(tx)&&/bad/.test(cl),'try accounts: an account beyond the range is NOT FOUND, with what to check');
    [tx,cl]=await run('',await addrAt('',84,'wpkh',0,0,0,3),2,2); ok(/^NOT FOUND in accounts 0 to 2 \(first 2 /.test(tx),'try accounts: an address beyond the depth is NOT FOUND');
    [tx,cl]=await run('TREZOR',await addrAt('',84,'wpkh',0,5,0,0),1,1); ok(/without passphrase and with passphrase\)\. Things to check: .*\(you typed one; try another spelling\)/.test(tx),'try accounts: NOT FOUND names both variants when a passphrase was typed');
    [tx,cl]=await run('','hello',2,2); ok(/^Enter a bc1q/.test(tx),'try accounts: rejects text that is not an address');
    t.$('phrase').value='abandon abandon'; t.$('checkAddr').value='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; await t.w.checkAllAccounts(2,2); ok(/valid seed phrase/.test(t.$('addrCheckStatus').textContent),'try accounts: needs a valid phrase');
    { t.$('phrase').value=AB; t.$('verifyPass').value=''; t.$('checkAddr').value=await addrAt('',84,'wpkh',0,15,0,0);
      const p1=t.w.checkAllAccounts(20,5); for(let n=0;n<500&&t.$('checkAcctsStop').disabled;n++) await sleep(10);
      ok(!t.$('checkAcctsStop').disabled&&t.$('checkAddrBtn').disabled&&t.$('checkAcctsBtn').disabled,'try accounts: while searching, STOP is on and the search buttons are off');
      const before=t.$('addrCheckStatus').textContent; await t.w.checkAllAccounts(0,1); ok(t.$('addrCheckStatus').textContent===before||/^Searching /.test(t.$('addrCheckStatus').textContent),'try accounts: a second press while searching does nothing');
      ok(!t.$('checkAcctsStop').disabled,'try accounts: the busy search is not disturbed by a second press');
      t.$('checkAcctsStop').click(); await p1; [tx,cl]=st();
      ok(/^Stopped\./.test(tx)&&t.$('checkAcctsStop').disabled&&!t.$('checkAddrBtn').disabled&&!t.$('checkAcctsBtn').disabled,'try accounts: STOP ends the search and turns the buttons back on'); }
    { t.$('phrase').value=AB; t.$('verifyPass').value=''; t.$('checkAddr').value=await addrAt('',84,'wpkh',0,0,0,0); t.$('addrCheckStatus').textContent='';
      t.$('checkAcctsBtn').click(); for(let n=0;n<500&&!/FOUND/.test(t.$('addrCheckStatus').textContent);n++) await sleep(20);
      ok(/^FOUND: this SegWit address is receive address #0 /.test(t.$('addrCheckStatus').textContent),'try accounts: the TRY ACCOUNTS 0 TO 20 button starts the search'); }
    t.w.setGate('fail','SELF-TEST FAILED','bad'); ok(t.$('checkAcctsBtn').disabled&&t.$('checkAddrBtn').disabled,'try accounts: a failed self-test disables the button'); t.w.setGate('pass','SELF-TEST PASSED','good'); ok(!t.$('checkAcctsBtn').disabled,'try accounts: a passed self-test enables the button');
    t.$('phrase').value=''; t.$('checkAddr').value=''; t.$('verifyPass').value=''; t.$('addrCheckStatus').textContent=''; }
  // SeedQR / CompactSeedQR input and BIP85 child seeds
  { const AB='abandon '.repeat(11)+'about'; const V=async x=>{ t.$('phrase').value=x; await t.w.verify(); return [t.$('verifyStatus').textContent.split('\n')[0], t.$('phrase').value]; };
    let [m,box]=await V('0000'.repeat(11)+'0003'); ok(/^Valid 12-word BIP39 phrase \(read from a SeedQR digit string\)/.test(m)&&box===AB,'VERIFY reads a SeedQR digit string and shows the words');
    [m,box]=await V('7f'.repeat(16)); ok(/CompactSeedQR hex/.test(m)&&box==='legal winner thank year wave sausage worth useful legal winner thank yellow','VERIFY reads CompactSeedQR hex and shows the words');
    [m]=await V('2048'+'0000'.repeat(11)); ok(/above 2047/.test(m),'SeedQR number above 2047 is rejected');
    [m]=await V('0000'.repeat(12)); ok(/Checksum failed/.test(m),'SeedQR with a bad checksum is rejected');
    [m]=await V(AB); ok(/^Valid 12-word BIP39 phrase$/.test(m),'plain words still verify as before');
    t.$('phrase').value=AB; t.$('verifyPass').value=''; t.$('childWords').value='12'; t.$('childIndex').value='0';
    await t.w.deriveChild(); ok(/prosper short ramp prepare exchange stove life snack client enough purpose fold/.test(t.$('childOut').textContent.replace(/\s+/g,' ').replace(/\d+\. /g,'')),'BIP85 child seed 0 (12 words) for abandon..about');
    t.$('childIndex').value='abc'; await t.w.deriveChild(); ok(/whole number/.test(t.$('childStatus').textContent)&&t.$('childOut').textContent==='','BIP85 rejects a bad index and clears the output');
    t.$('childIndex').value='0'; await t.w.deriveChild(); t.$('childIndex').dispatchEvent(new t.w.Event('input')); ok(t.$('childOut').textContent==='','BIP85 output is cleared when the index is edited');
    { // BIP85 applications in the card (v1.29.0): the card shows what the engine makes, with the right settings
      t.$('phrase').value=AB; t.$('verifyPass').value=''; t.$('childIndex').value='3';
      const CA=async(app,set)=>{ t.$('childApp').value=app; t.w.childAppChange(); if(set) set(); await t.w.deriveChild(); return [t.$('childStatus').textContent,t.$('childStatus').className,t.$('childOut').textContent]; };
      const vis=(id)=>t.$(id).style.display!=='none';
      t.$('childApp').value='words'; t.w.childAppChange(); ok(vis('childWords')&&!vis('childLen')&&!vis('childSides')&&!vis('childRolls'),'BIP85 card: seed words show only the word count');
      t.$('childApp').value='pwd85'; t.w.childAppChange(); ok(!vis('childWords')&&vis('childLen')&&t.$('childLen').value==='20'&&/10 to 80/.test(t.$('childLen').getAttribute('aria-label'))&&!vis('childSides'),'BIP85 card: a password shows its length, defaulting to at least 128 bits');
      t.$('childApp').value='dice'; t.w.childAppChange(); ok(!vis('childLen')&&vis('childSides')&&vis('childRolls'),'BIP85 card: dice show sides and rolls');
      for(const [app,len,head,re] of [['wif',0,/^BITCOIN CORE HD SEED \(BIP85 application 2, index 3, WIF private key\)/,/^[KL][1-9A-HJ-NP-Za-km-z]{51}$/],['xprv',0,/^MASTER XPRV \(BIP85 application 32, index 3\)/,/^xprv[1-9A-HJ-NP-Za-km-z]{107}$/],
          ['hex',17,/^HEX \(BIP85, 17 bytes, index 3\)/,/^[0-9a-f]{34}$/],['pwd64',86,/^PASSWORD \(BIP85 Base64, 86 characters, index 3\)/,/^[A-Za-z0-9+\/]{86}$/],['pwd85',10,/^PASSWORD \(BIP85 Base85, 10 characters, index 3\)/,/^\S{10}$/]]){
        const [st,c,o]=await CA(app,()=>{ if(len) t.$('childLen').value=String(len); }); const val=o.split('\n')[2], exp=await t.w.mnemonicBip85App(AB,'',app,3,len||undefined);
        ok(/ok/.test(c)&&head.test(o)&&re.test(val)&&val===exp&&/index 3, derived from the parent words\./.test(st),'BIP85 card: '+app+' shows the engine\'s value with its settings ('+val.slice(0,8)+'...)'); }
      { const [,,o]=await CA('xprv'); const fp=o.match(/Master fingerprint of this xprv: ([0-9a-f]{8})/); const x=o.split('\n')[2]; ok(fp&&fp[1]===(await (async()=>{ const raw=await t.w.base58decode(x); return t.w.hex(t.w.ripemd160(await t.w.sha256bytes(t.w.pubkeyBytes(BigInt('0x'+t.w.hex(raw.slice(46,78)))))).slice(0,4)); })()),'BIP85 card: the xprv comes with its master fingerprint'); }
      { const [st,c,o]=await CA('dice',()=>{ t.$('childSides').value='20'; t.$('childRolls').value='7'; }); const v=o.split('\n')[2].split(',').map(Number);
        ok(/ok/.test(c)&&/^DICE ROLLS \(BIP85, a 20-sided die numbered 0 to 19, 7 rolls, index 3\)/.test(o)&&v.length===7&&v.every(x=>Number.isInteger(x)&&x>=0&&x<20)&&o.split('\n')[2]===await t.w.mnemonicBip85App(AB,'','dice',3,20,7)&&/start at 0/.test(o),'BIP85 card: dice rolls are in range, numbered from 0'); }
      for(const [app,set,re,what] of [['hex',()=>{t.$('childLen').value='15';},/the length must be 16 to 64 bytes/,'hex shorter than 16 bytes'],['hex',()=>{t.$('childLen').value='65';},/16 to 64 bytes/,'hex longer than 64 bytes'],
          ['pwd64',()=>{t.$('childLen').value='19';},/20 to 86 characters/,'Base64 password shorter than 20'],['pwd85',()=>{t.$('childLen').value='81';},/10 to 80 characters/,'Base85 password longer than 80'],['pwd85',()=>{t.$('childLen').value='x';},/The length must be a whole number/,'a length that is not a number'],
          ['dice',()=>{t.$('childSides').value='1';},/2 to 2147483647 sides/,'a 1-sided die'],['dice',()=>{t.$('childSides').value='2147483648';},/2 to 2147483647 sides/,'a die with 2^31 sides'],['dice',()=>{t.$('childSides').value='6'; t.$('childRolls').value='0';},/1 to 1000/,'zero rolls'],['dice',()=>{t.$('childRolls').value='1001';},/1 to 1000/,'more than 1000 rolls']]){
        const [st,c,o]=await CA(app,set); ok(re.test(st)&&/bad/.test(c)&&o==='','BIP85 card refuses '+what); }
      await CA('hex'); t.$('childLen').dispatchEvent(new t.w.Event('input')); ok(t.$('childOut').textContent==='','BIP85 card: editing the length clears the output');
      await CA('dice'); t.$('childRolls').dispatchEvent(new t.w.Event('input')); ok(t.$('childOut').textContent==='','BIP85 card: editing the rolls clears the output');
      await CA('wif'); t.$('childApp').value='hex'; t.w.childAppChange(); ok(t.$('childOut').textContent===''&&t.$('childStatus').textContent==='','BIP85 card: choosing another type clears the output');
      t.$('childApp').value='words'; t.w.childAppChange(); t.$('childIndex').value='0'; }
    t.$('phrase').value='abandon abandon'; await t.w.deriveChild(); ok(/valid parent seed phrase/.test(t.$('childStatus').textContent),'BIP85 needs a valid parent phrase');
    t.$('phrase').value=''; t.$('childOut').textContent=''; t.$('childStatus').textContent=''; t.$('verifyStatus').textContent=''; }
    { // Check your download (v1.27.3): hash and CID computed in the page, compared with what is pasted
      const bytes=Buffer.from('VOIDFORGE test file é\n'+'x'.repeat(5000)), U=new Uint8Array(bytes), sha=nc.createHash('sha256').update(bytes).digest('hex');
      const r0=await t.w.dlCheck(U,''); ok(r0.hash===sha&&r0.verdict==='none','download check: SHA-256 equals Node\'s own for the same bytes, and with nothing pasted it only reports');
      eq(t.w.dlCid(new Uint8Array(Buffer.from('2e5ae17a178fafdbde51c3958c6c6d579579622b27a9feeabe5e91cbce579fde','hex'))),'bafkreibollqxuf4pv7n54uodswggy3kxsv4wekzhvh7ovps6shf44v473y','download check: CID of the published v1.27.0 hash is the published v1.27.0 CID');
      ok((await t.w.dlCheck(U,sha)).verdict==='match'&&(await t.w.dlCheck(U,sha.toUpperCase()+'  voidforge.html\n')).verdict==='match'&&(await t.w.dlCheck(U,'sha256 '+sha+' and '+r0.cid)).verdict==='match','download check: bare hash, upper case, a SHA256SUMS line, or hash plus CID all match');
      ok((await t.w.dlCheck(U,r0.cid)).verdict==='match','download check: a CID alone matches');
      const bad=sha.slice(0,63)+(sha[63]==='0'?'1':'0');
      ok((await t.w.dlCheck(U,bad)).verdict==='mismatch'&&(await t.w.dlCheck(U,sha+' '+bad)).verdict==='mismatch'&&(await t.w.dlCheck(U,r0.cid.slice(0,-1)+(r0.cid.endsWith('a')?'b':'a'))).verdict==='mismatch','download check: one wrong character, or one wrong value among right ones, is NO MATCH');
      const flipped=new Uint8Array(U); flipped[100]^=1; ok((await t.w.dlCheck(flipped,sha)).verdict==='mismatch','download check: a file changed by one bit is NO MATCH');
      ok((await t.w.dlCheck(U,'not a hash at all 1234')).verdict==='none'&&(await t.w.dlCheck(U,sha.slice(0,40))).verdict==='none','download check: text that is not a full hash is ignored (it reports, and never says MATCH)');
      ok((await t.w.dlCheck(U,r0.cid.slice(0,20))).verdict==='none','download check: a truncated bafk... string is ignored, not treated as a real CID');
      // through the real file box
      const F=new t.w.File([bytes],'voidforge.html'); Object.defineProperty(t.$('dlFile'),'files',{value:[F],configurable:true}); t.$('dlPaste').value=sha; await t.w.dlPick();
      ok(/^MATCH/.test(t.$('dlStatus').textContent)&&t.$('dlStatus').classList.contains('ok')&&t.$('dlOut').textContent.includes(sha)&&t.$('dlOut').textContent.includes(r0.cid),'download check: choosing a file shows MATCH, the hash and the CID');
      t.$('dlPaste').value=bad; await t.w.dlPick(); ok(/^NO MATCH/.test(t.$('dlStatus').textContent)&&t.$('dlStatus').classList.contains('bad'),'download check: a wrong published hash shows NO MATCH in red');
      Object.defineProperty(t.$('dlFile'),'files',{value:[{name:'big.bin',size:64*1024*1024+1}],configurable:true}); await t.w.dlPick(); ok(/larger than 64 MB/.test(t.$('dlStatus').textContent)&&t.$('dlOut').style.display==='none','download check: a file over 64 MB is refused');
      Object.defineProperty(t.$('dlFile'),'files',{value:[F],configurable:true}); t.$('dlPaste').value=sha; await t.w.dlPick(); // repopulate dlOut/dlStatus with real content so CLEAR is actually exercised, not just finding them already empty
      t.w.dlClear(); ok(t.$('dlPaste').value===''&&t.$('dlStatus').textContent===''&&t.$('dlOut').textContent===''&&t.$('dlOut').style.display==='none','download check: CLEAR empties the box, status and output');
      ok(/id="dlBox"/.test(html)&&!/localStorage|sessionStorage|indexedDB|XMLHttpRequest|fetch\(/.test((html.match(/function dlCheck[\s\S]*?function clearChild/)||[''])[0]),'download check: the tool stores nothing and uses no network'); }
    { // Support this project (v1.27.3): optional, text plus a QR drawn by the page, no links, nothing sent
      const box=t.$('supportBox'), addr=t.$('supportAddr').textContent, code=t.$('supportLnurl').textContent.trim();
      ok(box&&!box.open&&/Support this project/.test(box.querySelector('summary').textContent)&&/Optional/.test(box.querySelector('summary').textContent),'support: a closed, optional "Support this project" box in ABOUT & HELP');
      ok(addr==='dev@breez.tips'&&code==='LNURL1DP68GURN8GHJ7CNJV4JH5TN5D9C8XTMVDE6HYMRS9AJX2ASZ5RD0C','support: the Lightning address and payment code are exactly the maintainer\'s');
      const svg=t.$('supportQr').querySelector('svg'); ok(svg&&svg.querySelector('path')&&t.w.qrMatrix(code).rows.length>=21,'support: the QR is drawn by the page from the payment code');
      ok(box.querySelectorAll('a, [href], img, iframe, script').length===0&&/never goes online/.test(box.textContent)&&/never send seed words/i.test(box.textContent),'support: no link, image or script in the box, and it says nothing is sent and never to send seed words');
      t.st.clip.length=0; const b=box.querySelectorAll('button'); b[0].click(); await new Promise(r=>setTimeout(r,20)); b[1].click(); await new Promise(r=>setTimeout(r,20)); const c1=t.st.clip[0], copied=t.st.clip[1];
      ok(b.length===2&&c1==='dev@breez.tips'&&copied===code,'support: COPY copies the address and the payment code exactly'); }
    { // The dog logo is gone in the redesign: no picture is built into the file any more
      ok(!t.$('ownerLogo')&&t.w.document.querySelectorAll('img').length===0&&!/ownerLogo|data:image\/jpeg/.test(html),'owner logo: removed in the redesign, the file holds no picture'); }
    { // Translation and passphrase notes (v1.29.0): browsers are asked not to translate (a translated seed word is a wrong seed word), and the passphrase help warns about hardware wallet limits
      const d=t.w.document, m=d.querySelector('meta[name="google"]'), adv=t.$('passphrase').closest('details');
      ok(d.documentElement.getAttribute('translate')==='no'&&d.documentElement.getAttribute('lang')==='en'&&!!m&&m.getAttribute('content')==='notranslate','translation: the page asks browsers not to translate it');
      ok(!!adv&&/Some hardware wallets limit how long a passphrase can be or which characters it can use, so test a small amount on your device before you rely on it\./.test(adv.textContent)&&!/\b(Trezor|Ledger|Coldcard|Jade)\b/.test(adv.textContent),'passphrase: help warns that some hardware wallets limit length or characters (no vendor claims)'); }
    { // Calmer first screen (v1.33.0): one GUIDE ME button, seed buttons only once there is a seed, one "More options" box, no second warning note
      const d=t.w.document, gb=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()==='GUIDE ME'), gn=t.$('guideNew'), css=[...d.querySelectorAll('style')].map(x=>x.textContent).join('\n');
      ok(gb.length===1&&gb[0].id==='guideBtn'&&!!gn&&!gn.querySelector('button')&&/^New here\? Open MENU at the top and press GUIDE ME to be walked through making a seed one screen at a time\.$/.test(gn.textContent.trim()),'calmer page: one GUIDE ME button; the "New here?" line points to it as plain text');
      ok(!d.querySelector('.forge-note')&&!/keep clipboard history off, and restart when you are done/.test(d.body.textContent.split('<script')[0]),'calmer page: no second "Making real keys?" note next to FORGE SEED (the amber banner says it)');
      ok(/body:not\(\.has-seed\) \.seed-actions, body:not\(\.has-seed\) \.print-btn \{ display: none; \}/.test(css)&&!!d.querySelector('.btn-row.seed-actions #abbrBtn')&&d.querySelectorAll('.seed-actions button').length===5,'calmer page: the five seed buttons and PRINT SEED are hidden until there is a seed');
      ok(!/#rollCount \{ display: none; \}/.test(css)&&!!t.$('rollCount'),'calmer page: one column, so the roll count stays beside the box on every screen size');
      { const css=html.match(/<style>[\s\S]*?<\/style>/)[0]; ok(/@media \(max-width: 559px\) \{ #wordGrid, #cardGen \.gen-right #wordGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/.test(css)&&/\.wcell \{ animation: none; box-shadow: none; font-size: 18px; font-weight: 700; padding: 10px 12px; min-width: 0; \}/.test(css)&&/@media \(max-width: 400px\) \{ \.wcell \{ font-size: 16px;/.test(css)&&/@media \(max-width: 345px\) \{ \.wcell \{ font-size: 14\.5px;/.test(css),'seed words: two columns below 560px and smaller type on narrow phones, so long words stay inside their boxes'); }
      { const rs=t.$('rollStats'); ok(!!rs&&rs.previousElementSibling.id==='ignoredNote'&&t.$('advanced').closest('#genRight')!==null&&t.$('advanced').previousElementSibling.classList.contains('seed-actions')&&t.$('advanced').nextElementSibling.querySelector('#fingerprint')!==null,'order: roll entry, then the roll history and fairness chart; then FORGE and the words, then the passphrase box, then the fingerprints'); ok(!!rs&&rs.tagName==='DETAILS'&&!rs.open&&rs.contains(t.$('rollChart'))&&rs.contains(t.$('rollHistory'))&&rs.contains(t.$('diceVisual')),'tucked away: roll history and the fairness chart live in one closed box'); { const css=html.match(/<style>[\s\S]*?<\/style>/)[0]; ok(/#rollStats \{ margin-top: 10px; padding: 8px 12px; font-size: 13px; \}/.test(css)&&/#rollStats > summary \{ cursor: pointer; font-weight: 600; \}/.test(css),'tucked away: the roll history box is styled like the More options and Advanced options boxes'); } }
      ok(!t.$('moreBox')&&!t.$('demoBox')&&!t.$('demoOn')&&![...t.d.querySelectorAll('.tag-note')].some(e=>/DEMO/.test(e.textContent)),'no demo box and no More options box: the grey live words replaced the demo');
      { const tabs=[...t.d.querySelectorAll('#methodTabs button')]; ok(tabs.map(b=>b.textContent).join('|')==='Dice|Coin|Word draw'&&tabs.every(b=>b.getAttribute('role')==='tab')&&tabs[0].getAttribute('aria-selected')==='true'&&t.$('wordSel').options.length===2&&t.$('wordSel').value==='12'&&/50 dice rolls/.test(t.$('lenNote').textContent)&&!t.d.body.classList.contains('m-words'),'make tab: Dice, Coin and Word draw tabs with one Seed length menu (12 or 24), Dice and 12 words by default'); }
      ok(!/Enter your rolls or flips, generate the seed, then compare/.test(d.querySelector('footer').textContent)&&/VOIDFORGE v\d+\.\d+\.\d+/.test(d.querySelector('footer').textContent),'calmer page: the footer is two lines'); }
    { // The seed buttons follow the seed (v1.33.0)
      const keepT=t; t=load(); await t.ready(); const b=()=>t.d.body.classList.contains('has-seed');
      ok(!b(),'has-seed: not set on a fresh page'); t.set(rnd(50)); await t.w.generate(); ok(b(),'has-seed: set after FORGE');
      t.set(rnd(10)); ok(!b(),'has-seed: cleared when the rolls change and the old seed is dropped');
      t.set(rnd(50)); await t.w.generate(); ok(b(),'has-seed: set again after a new FORGE'); t.w.wipeSeed(); ok(!b(),'has-seed: cleared by CLEAR ALL'); t=keepT; }
    { // Page icon (v1.28.0): the gold die logo is built into the file as data: links (no network), an SVG and a 32px PNG, and the About page calls the online copy practice-only
      const ic=[...t.w.document.querySelectorAll('link[rel~="icon"]')], hs=ic.map(l=>l.getAttribute('href')||'');
      const svg=hs.find(h=>/^data:image\/svg\+xml,/.test(h)), png=hs.find(h=>/^data:image\/png;base64,/.test(h));
      const svgText=svg?decodeURIComponent(svg.slice(svg.indexOf(',')+1)):'', pb=png?Buffer.from(png.slice(png.indexOf(',')+1),'base64'):Buffer.alloc(0);
      ok(ic.length===2&&hs.every(h=>h.startsWith('data:'))&&(svgText.match(/<circle/g)||[]).length===5&&/^<svg[^>]*viewBox="0 0 64 64"/.test(svgText)&&/fill="#E3B83F"/.test(svgText)&&pb.subarray(1,4).toString()==='PNG'&&pb.readUInt32BE(16)===32&&pb.readUInt32BE(20)===32,'page icon: a data: SVG with the five-pip die and a 32x32 PNG are built in, and no icon link points to the network');
      ok(!t.w.document.querySelector('link[rel~="apple-touch-icon"], link[rel="manifest"]')&&/never from a website\. Check the file.s SHA256 first \(see the README\)\. The online copy on the project page is for practice only\. Its address is random21m\.github\.io\/VOIDFORGE, the only link on this page/.test(t.w.document.body.textContent),'page icon: nothing else is linked, and the About page says the online copy is for practice only'); }
    { // Every main "go" action across the page is a primary (cyan) button, not grey "secondary" -- a uniform rule, not just START DRILL (v1.27.3)
      const primaryIds=['forgeBtn','prStart','prCheckBtn','checkAddrBtn','checkAcctsBtn','reforgeWordsBtn','psbtBtn','cmpBtn','childBtn','wpBtn','reuseBtn','sigBtn'];
      const missing=primaryIds.filter(id=>{ const b=t.$(id); return !b || b.classList.contains('secondary') || b.classList.contains('btn-clear'); });
      ok(missing.length===0,'every main action button (FORGE SEED, START PRACTICE, CHECK MY PAPER, CHECK ADDRESS, TRY ACCOUNTS, Reforge SEARCH, INSPECT, COMPARE, DERIVE CHILD SEED, OPEN WATCH-ONLY, CHECK KEYS, VERIFY SIGNATURE) is the gold primary style, none grey (missing: '+missing.join(', ')+')');
      const drillBtn=[...t.$('drillStart').querySelectorAll('button')][0];
      ok(drillBtn&&drillBtn.textContent.trim()==='START DRILL'&&!drillBtn.classList.contains('secondary'),'START DRILL is also the cyan primary style');
      const css=html.match(/<style>[\s\S]*?<\/style>/)[0];
      ok(/button \{[^}]*background: linear-gradient\(90deg, var\(--accent\)/.test(css),'the primary button style is still the cyan gradient that every unclassed button inherits');
      // and the small helper actions (COPY, SHOW QR, HIDE, PRINT, UNDO) stay the quieter grey secondary style, so the primary ones still stand out
      const helperBtns=[...t.w.document.querySelectorAll('button.secondary.small')];
      ok(helperBtns.length>=20&&helperBtns.every(b=>b.classList.contains('secondary')),'helper buttons like COPY, SHOW QR and HIDE stay the quieter grey secondary style, so the primary actions still stand out'); }
    { // Bitcoin dictionary (v1.27.3): offline glossary with search
      const box=t.$('dictBox'), items=[...t.$('dictList').querySelectorAll('.dict-item')], names=items.map(e=>e.querySelector('dt').textContent), def=e=>e.querySelector('dd').firstChild.textContent;
      const q=async v=>{ t.$('dictSearch').value=v; t.w.dictFilter(); return items.filter(e=>e.style.display!=='none').map(e=>e.querySelector('dt').textContent); };
      ok(box&&!box.open&&/Bitcoin dictionary/.test(box.querySelector('summary').textContent)&&items.length>=250,'dictionary: a closed "Bitcoin dictionary" box with 250+ entries');
      const col=new Intl.Collator('en',{numeric:true,sensitivity:'base'}); ok(names.every((n,k)=>k===0||col.compare(names[k-1],n)<=0)&&new Set(names.map(n=>n.toLowerCase())).size===names.length,'dictionary: entries run A to Z (numbers in order) and no term is listed twice');
      ok(items.every(e=>def(e).length>=25&&def(e).length<=330&&e.querySelector('dt').textContent.length<=45)&&!items.some(e=>/[<>]|http|www\./i.test(e.textContent)),'dictionary: every entry has a short plain definition, and none holds a link or markup');
      ok(t.$('dictCount').textContent===items.length+' entries, A to Z','dictionary: the count line starts with all entries');
      { const wl=items.find(e=>e.querySelector('dt').textContent==='Wordlist'), notes=items.filter(e=>/^In VOIDFORGE: ./.test((e.querySelector('dd small')||{}).textContent||'')); ok(wl&&/^In VOIDFORGE: SHOW FIRST 4 LETTERS/.test((wl.querySelector('dd small')||{}).textContent||'')&&notes.length>=20,'dictionary: entries say where the term appears in VOIDFORGE ('+notes.length+' do)'); }
      const x=await q('xpub'); ok(x.length>=1&&x.length<=5&&x.includes('Extended public key (xpub, ypub, zpub)'),'dictionary: searching xpub finds the extended public key entry');
      eq((await q('GAP  LIMIT')).join('|'),'Gap limit','dictionary: search ignores capitals and extra spaces');
      ok((await q('second tool')).includes('Second tool')&&(await q('restore drill')).includes('Restore drill'),'dictionary: search also finds words inside the text');
      ok((await q('zzzzqq')).length===0&&/No entry matches/.test(t.$('dictCount').textContent),'dictionary: a search with no match says so');
      ok((await q('bip')).length>=7&&/ of \d+ entries/.test(t.$('dictCount').textContent),'dictionary: the count line shows how many matched'); 
      eq((await q('')).length,items.length,'dictionary: clearing the search shows everything again');
      const dice=items.find(e=>e.querySelector('dt').textContent==='Dice entropy').textContent; ok(dice.includes(String(Math.round(50*Math.log2(6))))&&dice.includes(String(Math.round(99*Math.log2(6)/8)*8)),'dictionary: the dice figures (about 129 and 256 bits) match the arithmetic');
      const dictFacts=[['Base85',/85 different characters/],['Base85',/RFC 1924/],['SHAKE256',/SHA-3 family/],['BIP85',/passwords or dice rolls/],['Wordlist',/2048/],['Wordlist',/first four letters/],['Fingerprint (master fingerprint)',/Eight characters/],['Satoshi (sat)',/hundred-millionth/],['Gap limit',/usually 20/],['Passphrase (the 25th word)',/completely different wallet/],['Testnet',/tb1/],['Taproot',/bc1p/],['Native SegWit',/bc1q/],['Legacy address',/starting with 1\./],['Nested SegWit',/starting with 3\./],['BIP39',/12 or 24 words/],['BIP85',/child seed/],['BIP84',/m\/84'\/0'\/0'/],['BIP86',/m\/86'\/0'\/0'/],['PBKDF2',/2048 rounds/],['Dice entropy',/2\.58 bits/],['Coin flip entropy',/128 flips.*256/],['OP_RETURN',/never be spent/],['Bit',/128 bits.*256/],['Block',/ten minutes/],['Fee (miner fee)',/inputs minus the outputs/],['Bitcoin',/21 million/],['Halving',/210,000/],['Difficulty',/2016 blocks/],['Virtual byte (vByte) and weight',/4,000,000/],['Genesis block',/3 January 2009/],['Whitepaper',/31 October 2008/],['Block header',/80-byte/],['WIF (Wallet Import Format)',/5, K or L/],['P2WPKH',/bc1q/],['P2TR',/bc1p/],['BIP44',/m\/44'\/0'\/0'/],['BIP49',/m\/49'\/0'\/0'/],['Bitcoin Pizza Day',/10,000 bitcoin/],['Byte',/32 bytes.*16 bytes/],['P2PKH',/starting with 1/],['P2SH',/starting with 3/],['BIP125',/replace-by-fee/],['BIP350',/bech32m/],['Block reward',/50 bitcoin/]];
      ok(dictFacts.every(([n,re])=>{ const e=items.find(x=>x.querySelector('dt').textContent===n); return e&&re.test(e.textContent); }),'dictionary: key facts in the entries are right (2048 words, 20-address gap limit, tb1/bc1p/bc1q, 2.58 bits per roll, ...)');
      ok((await q('safety wall')).join()==='Hardened path (the \' mark)'&&(await q('green self-test passed')).includes('Self-test')&&(await q('sha256sums')).includes('SHA256SUMS'),'dictionary: search finds words in the definition and in the "In VOIDFORGE" note');
      { const chips=[...t.$('dictCats').querySelectorAll('button')], cats=['All','Basics','Keys & seeds','Wallets & backups','Addresses & scripts','Transactions','Network & mining','Standards (BIPs)','Lightning & layers','Privacy & security','Units & math','Culture & markets','VOIDFORGE'];
        eq(chips.map(b=>b.textContent).join('|'),cats.join('|'),'dictionary: a topic button for every category, "All" first');
        ok(items.every(e=>cats.slice(1).includes(e.dataset.c))&&cats.slice(1).every(c=>items.filter(e=>e.dataset.c===c).length>=3),'dictionary: every entry is in a known topic and every topic has at least 3 entries');
        t.$('dictSearch').value=''; chips.find(b=>b.textContent==='Lightning & layers').click(); const li=items.filter(e=>e.style.display!=='none');
        ok(li.length>=8&&li.every(e=>e.dataset.c==='Lightning & layers')&&chips.filter(b=>b.getAttribute('aria-pressed')==='true').length===1&&/ of \d+ entries/.test(t.$('dictCount').textContent),'dictionary: a topic button shows only that topic and shows as pressed');
        t.$('dictSearch').value='channel'; t.w.dictFilter(); const lc=items.filter(e=>e.style.display!=='none').map(e=>e.querySelector('dt').textContent); ok(lc.includes('Lightning channel')&&!lc.includes('Wallet file'),'dictionary: topic and search work together');
        t.$('dictSearch').value='zzzzqq'; t.w.dictFilter(); ok(/No entry matches .zzzzqq. in Lightning & layers\./.test(t.$('dictCount').textContent),'dictionary: the no-match line names the topic');
        chips[0].click(); t.$('dictSearch').value=''; t.w.dictFilter(); eq(items.filter(e=>e.style.display!=='none').length,items.length,'dictionary: All shows everything again');
        // keeping it up to date: every BIP or SLIP the page text mentions has an entry
        const body=stripScripts(html).split('\n').filter(l=>!/<li><b>\d+\.\d+\.\d+<\/b>/.test(l)).join('\n'), nums=new Set(), re=/\b(BIP|SLIP)[- ]?0*(\d+)\b/g; let mm; while((mm=re.exec(body))) nums.add(mm[1]+mm[2]);
        const missing=[...nums].filter(k=>!names.some(n=>{ const m=/^(BIP|SLIP)/.exec(k)[1], d=k.slice(m.length); return new RegExp('\\b'+m+'[- ]?0*'+d+'\\b','i').test(n)||(m==='BIP'&&new RegExp('\\b'+d+'\\b').test(n)&&/BIP/.test(n)); }));
        ok(nums.size>=8&&missing.length===0,'dictionary: every BIP or SLIP named in the page has an entry (missing: '+(missing.join(', ')||'none')+')'); }
      ok(box.querySelectorAll('a, [href], img, iframe, script').length===0&&!/localStorage|sessionStorage|indexedDB|XMLHttpRequest|fetch\(/.test((html.match(/function buildDict[\s\S]*?\n\/\/ Support this project/)||[''])[0]),'dictionary: no link, image or script, and nothing stored or fetched'); }
  // SELF-TEST button toggles: press again hides the results without CLEAR
  t.w.toggleSelfTests();
  ok(t.$('testResults').textContent==='','SELF-TEST button: press while results are shown hides them');
  await t.w.toggleSelfTests();
  ok(/^ALL \d+ TESTS PASSED/.test(t.$('testResults').textContent),'SELF-TEST button: press again shows them');
  t.w.toggleSelfTests();
  ok(t.$('testResults').textContent==='','SELF-TEST button: second press hides the results');
  // CLEAR is red, SELF-TEST is green, and both stay readable in dark and light themes (v1.26.2)
  { const css=html.match(/<style>[\s\S]*?<\/style>/)[0], hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
    const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
    const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const mix=(fg,a,bg)=>fg.map((v,i)=>v*a+bg[i]*(1-a));
    const btn=(fn)=>[...t.w.document.querySelectorAll('button')].find(b=>b.getAttribute('onclick')===fn);
    const clr=btn('clearAll()'), st=btn('toggleSelfTests()');
    ok(clr&&clr.textContent.trim()==='CLEAR'&&clr.classList.contains('btn-clear')&&!clr.classList.contains('secondary'),'CLEAR button uses the red style');
    ok(st&&st.textContent.trim()==='SELF-TEST'&&st.classList.contains('btn-test')&&st.classList.contains('small')&&!st.classList.contains('secondary'),'SELF-TEST button uses the green style');
    ok(/\n  button\.btn-clear \{[^}]*color: var\(--bad-text\)[^}]*border: 1px solid var\(--bad-text\)/.test(css),'red style: red text and red border');
    ok(/\n  button\.btn-test \{[^}]*color: var\(--ok-text\)[^}]*border: 1px solid var\(--ok-text\)/.test(css),'green style: green text and green border');
    ok(/body\.light button\.btn-clear \{[^}]*color: var\(--bad-text\)/.test(css)&&/body\.light button\.btn-test \{[^}]*color: var\(--ok-text\)/.test(css),'light theme keeps the red and green text (not overridden to white)');
    const tok=(re)=>re.exec(css)[1];
    const dark={bad:tok(/:root \{[^}]*--bad-text: (#[0-9a-f]{6})/),ok:tok(/:root \{ --ok-text: (#[0-9a-f]{6})/),surf:tok(/--surface2: (#[0-9a-f]{6})/)};
    const light={bad:tok(/body\.light \{[^}]*--bad-text: (#[0-9a-f]{6})/),ok:tok(/body\.light \{ --ok-text: (#[0-9a-f]{6})/),surf:tok(/body\.light \{[^}]*--surface2: (#[0-9a-f]{6})/)};
    const worst=Math.min(
      cr(hex(dark.bad),mix(hex(dark.bad),.08,hex(dark.surf))), cr(hex(dark.ok),mix(hex(dark.ok),.12,hex(dark.surf))),
      cr(hex(light.bad),mix(hex(light.bad),.04,hex(light.surf))), cr(hex(light.ok),mix(hex(light.ok),.08,hex(light.surf))));
    ok(worst>=4.5,'red and green button text keeps contrast >= 4.5:1 in both themes (worst '+worst.toFixed(2)+')'); }
  // --- RIPEMD-160 fuzz vs Node ---
  let bad=0; for(let n=0;n<300;n++){ const b=nc.randomBytes(n<130?n:nc.randomInt(0,2000));
    if(Buffer.from(t.w.ripemd160(new t.w.Uint8Array(b))).toString('hex')!==nc.createHash('ripemd160').update(b).digest('hex')) bad++; }
  eq(bad,0,'RIPEMD-160 fuzz mismatches');
  // --- dice flow, SeedSigner published example ---
  t.set('65515223131652132161133154444123616466443112153441'); await t.w.generate();
  eq(t.$('genResult').textContent,'hole luggage safe present express tragic orbit shed switch metal identify path\n\nPassphrase: none','dice 50 rolls -> SeedSigner mnemonic, with an explicit "Passphrase: none" line');
  ok(/8d9cced8/.test(t.$('fingerprint').textContent),'dice 50 rolls -> SeedSigner fingerprint');
  // --- passphrase: masked, not shown/copied/printed/saved ---
  eq(t.$('passphrase').type,'password','passphrase input is masked');
  t.$('passphrase').value='TREZOR'; t.$('passphrase2').value='TREZORX'; await t.w.generate();
  ok(/do not match/.test(t.$('genResult').textContent)&&t.$('genResult').dataset.seed==='1'&&!/[0-9a-f]{8}/.test(t.$('fingerprint').textContent)&&/do not match/.test(t.$('fingerprint').textContent)&&t.$('address').textContent==='','mismatched passphrase boxes: the words still show (they do not depend on the passphrase), but no fingerprint or address is shown');
  ok(t.$('fpIcon').textContent===''&&t.$('fpIcon').innerHTML==='','mismatched passphrase leaves no fingerprint picture showing');
  ok(t.$('watchBox').style.display==='none'&&t.$('wZpub').textContent==='','mismatched passphrase leaves no watch-only export showing');
  t.$('passphrase2').value='TREZOR'; await t.w.generate();
  ok(/bc1q[0-9a-z]{38}/.test(t.$('address').textContent)&&/\(with passphrase\)/.test(t.$('address').textContent),'first receive address shown (with passphrase)');
  ok(/f00e80ca \(with passphrase\)/.test(t.$('fingerprint').textContent),'fingerprint reflects passphrase');
  ok(!t.$('genResult').textContent.includes('TREZOR'),'passphrase text not shown in result');
  // --- coin mode 1/0 ---
  t.mode('coin'); const C128="01001110000101011011111010111010111101101111110000011010011111111011000111011111011101110110111001010001000001100110010101001110";
  t.set(C128); await t.w.generate();
  ok(t.$('genResult').textContent.startsWith('trigger soccer priority image feature romance whisper jar crush sleep super potato'),'coin 128 flips (1/0) vector');
  t.set('HTHT'+C128.slice(0,50)); eq(t.$('rollCount').textContent.split(' ')[0],'50','letters ignored in coin mode');
  t.set('1'.repeat(128)); ok(/non-random/.test(t.$('entropyStatus').textContent),'all-ones flagged as non-random');
  // --- hardening: attributes ---
  for(const id of ['rolls','phrase','passphrase','note']){
    const e=t.$(id); ok(e.getAttribute('spellcheck')==='false'&&e.getAttribute('autocomplete')&&e.getAttribute('autocapitalize')==='off',`#${id} has spellcheck/autocomplete/autocapitalize off`);
  }
  // --- online banner ---
  ok(t.$('onlineWarn').style.display==='block'&&/ONLINE/.test(t.$('onlineWarn').textContent),'online banner shown when navigator.onLine');
  Object.defineProperty(t.w.navigator,'onLine',{value:false,configurable:true}); t.w.dispatchEvent(new t.w.Event('offline'));
  eq(t.$('onlineWarn').style.display,'none','online banner hides when offline');
  // --- passphrase toggle ---
  const btn=[...t.d.querySelectorAll('button')].find(b=>b.textContent==='SHOW'); t.w.togglePassphrase(btn);
  ok(t.$('passphrase').type==='text'&&btn.textContent==='HIDE','passphrase SHOW toggles visibility');
  t=load(); await t.ready(); t.set(rnd(50)); await t.w.generate();
  // --- print: only words + fingerprint, never passphrase, cleans up ---
  t=load(); await t.ready(); t.set(rnd(50)); t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate();
  const words=t.$('genResult').textContent.split('\n')[0];
  t.w.printSeed();
  ok(t.st.printed===1&&t.st.printCells.length===12&&words.split(' ').every((w,i)=>t.st.printCells[i]===String(i+1).padStart(2,'0')+w)&&!t.st.printHTML.includes('SECRETPASS')&&/print-seed/.test(t.st.printClass),'PRINT SEED prints numbered words + fingerprint only, no passphrase');
  t.w.dispatchEvent(new t.w.Event('afterprint')); ok(t.$('printOnly').textContent===''&&!t.d.body.classList.contains('print-seed'),'print area cleaned up after printing');
  { // Stamp sheet (v1.34.0): the first 4 letters of each word in capitals, for metal plates
    const p0=t.st.printed; t.st.alerts.length=0; t.w.printStamp(); const cells=t.st.printCells.slice(), txt=t.st.printHTML;
    ok(t.st.printed===p0+1&&cells.length===12&&words.split(' ').every((w,i)=>cells[i]===String(i+1).padStart(2,'0')+w.slice(0,4).toUpperCase())&&/print-seed/.test(t.st.printClass)&&/^VOIDFORGE STAMP SHEET/.test(txt),'PRINT STAMP SHEET prints each word as its first 4 letters in capitals');
    ok(!txt.includes('SECRETPASS')&&/Passphrase used: YES/.test(txt)&&txt.includes(t.$('fingerprint').textContent)&&/Reforge/.test(txt)&&/No two BIP39 words start with the same 4 letters/.test(txt),'stamp sheet: fingerprint, passphrase yes/no without the passphrase, and how to get the words back');
    t.w.dispatchEvent(new t.w.Event('afterprint')); ok(t.$('printOnly').textContent==='','stamp sheet is cleaned up after printing');
    ok(!!t.$('stampBtn')&&/printStamp/.test(t.$('stampBtn').getAttribute('onclick')),'PRINT STAMP SHEET button is on the page'); }
  { // Wallet view (v2.1.0): any valid 12 to 24 word phrase typed in the Check tab
    const AB='abandon '.repeat(11)+'about', sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async f=>{ for(let n=0;n<400&&!f();n++) await sleep(25); return f(); };
    const rows=()=>[...t.$('wvList').querySelectorAll('li')].map(li=>li.textContent);
    const pick=(id,v)=>{ t.$(id).value=v; t.$(id).dispatchEvent(new t.w.Event(id==='wvAcct'?'input':'change',{bubbles:true})); };
    const t0=t; t=load(); await t.ready();
    ok(t.$('walletView').style.display==='none','wallet view: hidden until a phrase is checked');
    t.$('phrase').value=AB; t.$('verifyPass').value=''; await t.w.verify(); await until(()=>rows().length===10);
    ok(t.$('walletView').style.display!=='none'&&/73c5da0a/.test(t.$('wvFp').textContent)&&t.$('wvIcon').innerHTML.includes('<svg'),'wallet view: opens after VERIFY with the master fingerprint and its picture');
    ok(rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&t.$('wvList').querySelectorAll('li button.qr-mini').length===10&&rows().every(a=>/^bc1q/.test(a)),'wallet view: the published first SegWit address, ten rows, each with a QR button');
    ok(/imported/i.test(t.$('wvBanner').textContent)&&/not made by this page/.test(t.$('wvBanner').textContent),'wallet view: says plainly that these words were imported, not made here');
    pick('wvType','tr'); await until(()=>/^bc1p/.test(rows()[0]||'')); ok(rows()[0]==='bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr','wallet view: the published first Taproot (BIP86) address');
    pick('wvType','pkh'); await until(()=>/^1/.test(rows()[0]||'')); ok(rows()[0]==='1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA','wallet view: the published first Legacy (BIP44) address');
    pick('wvType','sh-wpkh'); await until(()=>/^3/.test(rows()[0]||'')); ok(rows()[0]==='37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf','wallet view: the published first Nested SegWit (BIP49) address');
    pick('wvType','wpkh'); pick('wvNet','test'); await until(()=>/^tb1q/.test(rows()[0]||'')); ok(/TESTNET/.test(t.$('wvPath').textContent)&&/^tb1q/.test(rows()[0]),'wallet view: testnet gives tb1 addresses and a TESTNET note');
    pick('wvNet','main'); await until(()=>/^bc1q/.test(rows()[0]||''));
    const first=rows().slice(); t.$('wvNext').click(); await until(()=>rows()[0]!==first[0]); const second=rows().slice();
    ok(second.length===10&&!second.some(a=>first.includes(a))&&/addresses 10 to 19/.test(t.$('wvPath').textContent)&&!t.$('wvPrev').disabled,'wallet view: NEXT 10 shows addresses 10 to 19');
    t.$('wvPrev').click(); await until(()=>rows()[0]===first[0]); ok(t.$('wvPrev').disabled&&rows().join()===first.join(),'wallet view: PREVIOUS 10 comes back, and is off at the start');
    pick('wvAcct','2'); await until(()=>rows()[0]!==first[0]); const acc2=rows()[0]; pick('wvChain','1'); await until(()=>rows()[0]!==acc2);
    ok(/m\/84'\/0'\/2'\/1\/index/.test(t.$('wvPath').textContent)&&/Change/.test(t.$('wvPath').textContent),'wallet view: account and change chain are in the path');
    pick('wvAcct','abc'); await sleep(50); ok(/whole number/.test(t.$('wvErr').textContent)&&t.$('wvList').textContent==='','wallet view: a bad account number is refused and no stale addresses stay');
    pick('wvAcct','0'); pick('wvChain','0'); await until(()=>rows()[0]===first[0]);
    // QR on a row, SeedQR for 12 words, recovery sheet
    t.$('wvList').querySelector('li button.qr-mini').click(); ok(t.$('wvqBox').style.display==='block'&&t.$('wvqImg').innerHTML.includes('<svg')&&t.$('wvqCap').textContent.includes(first[0]),'wallet view: the QR button shows that address as a QR code');
    t.d.querySelector('#wvSqBtns button').click(); ok(t.$('wvsBox').style.display==='block'&&/SECRET/.test(t.$('wvsCap').textContent)&&/12 words/.test(t.$('wvsCap').textContent),'wallet view: SeedQR for 12 words, marked SECRET');
    const p0=t.st.printed; t.w.printRecoverySheet(); const rtxt=t.st.printHTML;
    ok(t.st.printed===p0+1&&/^VOIDFORGE RECOVERY SHEET/.test(rtxt)&&rtxt.includes('73c5da0a')&&rtxt.includes(first[0])&&!/abandon/.test(rtxt)&&/Passphrase used: NO/.test(rtxt),'recovery sheet: fingerprint, type, path and first addresses; never the words');
    t.w.dispatchEvent(new t.w.Event('afterprint'));
    t.$('phrase').value=AB+' '; t.$('phrase').dispatchEvent(new t.w.Event('input',{bubbles:true}));
    ok(t.$('walletView').style.display==='none'&&t.$('wvList').textContent===''&&t.$('wvsImg').textContent===''&&t.$('wvqImg').textContent===''&&t.$('wvFp').textContent==='','wallet view: editing the words wipes the whole view');
    // a passphrase changes the wallet, and the recovery sheet never prints it
    t.$('phrase').value=AB; t.$('verifyPass').value='SECRETPASS'; await t.w.verify(); await until(()=>rows().length===10);
    ok(rows()[0]!==first[0]&&!/73c5da0a/.test(t.$('wvFp').textContent)&&/with passphrase/.test(t.$('wvFp').textContent),'wallet view: with a passphrase it is a different wallet and says so');
    t.w.printRecoverySheet(); ok(!t.st.printHTML.includes('SECRETPASS')&&/Passphrase used: YES/.test(t.st.printHTML),'recovery sheet: says a passphrase was used, never prints it'); t.w.dispatchEvent(new t.w.Event('afterprint'));
    // other lengths: 24 words has SeedQR, 15 does not
    const e24=await t.w.entropyToMnemonic(new Uint8Array(32)), e15=await t.w.entropyToMnemonic(new Uint8Array(20));
    t.$('verifyPass').value=''; t.$('phrase').value=e24; await t.w.verify(); await until(()=>rows().length===10);
    ok(t.$('wvSqBtns').style.display!=='none'&&/24 words/.test(t.$('wvSqNote').textContent),'wallet view: 24 words offer SeedQR');
    t.$('phrase').value=e15; await t.w.verify(); await until(()=>rows().length===10);
    ok(t.$('wvSqBtns').style.display==='none'&&/No SeedQR exists for 15 words/.test(t.$('wvSqNote').textContent),'wallet view: 15 words say plainly that no SeedQR exists');
    t.$('phrase').value='abandon abandon'; await t.w.verify(); ok(t.$('walletView').style.display==='none','wallet view: an invalid phrase opens nothing');
    t.$('phrase').value=AB; await t.w.verify(); await until(()=>rows().length===10); t.w.wipeSeed(); ok(t.$('walletView').style.display==='none'&&t.$('wvList').textContent==='','wallet view: CLEAR ALL wipes it'); t=t0; }
  { // v2.2.0: watch-only view, Electrum warning, payment request, backup checklist, key-reuse check
    const AB='abandon '.repeat(11)+'about', sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async f=>{ for(let n=0;n<400&&!f();n++) await sleep(25); return f(); };
    const t0=t; t=load(); await t.ready(); t.st.alerts.length=0;
    const rows=()=>[...t.$('wvList').querySelectorAll('li')].map(li=>li.textContent);
    const pick=(id,v)=>{ t.$(id).value=v; t.$(id).dispatchEvent(new t.w.Event('change',{bubbles:true})); };
    const openW=async v=>{ t.$('wpIn').value=v; t.$('wpIn').dispatchEvent(new t.w.Event('input',{bubbles:true})); await t.w.openWatchOnly(); };
    // watch-only: the published BIP84 zpub of abandon...about
    const ZPUB='zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    await openW(ZPUB); await until(()=>rows().length===10);
    ok(rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&t.$('wvType').disabled&&t.$('wvType').value==='wpkh'&&t.$('wvNet').disabled,'watch-only: the published zpub gives the published first address, type and network locked');
    ok(/Watch-only/.test(t.$('wvBanner').textContent)&&t.$('wvSqBlock').style.display==='none'&&t.$('wvSheetBtn').style.display==='none'&&/not known/.test(t.$('wvFp').textContent),'watch-only: says so, no SeedQR and no recovery sheet, and no made-up fingerprint');
    ok(t.$('wvList').querySelectorAll('li button.qr-mini').length===10,'watch-only: a QR button on every row');
    const XPUB86='xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
    await openW(XPUB86); await until(()=>rows().length===10);
    ok(!t.$('wvType').disabled&&/does not say which address type/.test(t.$('wpStatus').textContent),'watch-only: a plain xpub lets you pick the type and says why');
    pick('wvType','tr'); await until(()=>/^bc1p/.test(rows()[0]||'')); ok(rows()[0]==='bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr','watch-only: the published BIP86 xpub as Taproot gives the published first address');
    { const seed=await t.w.mnemonicToSeed(AB,''), wo=await t.w.watchOnlyFromSeed(seed,'wpkh',0,'main'), desc=wo.receive;
      await openW(desc); await until(()=>rows().length===10);
      ok(t.$('wvAcct').value==='0'&&t.$('wvAcct').disabled,'watch-only: the account number is read from the descriptor path (0h gives 0)');
      ok(rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&/73c5da0a/.test(t.$('wvFp').textContent)&&t.$('wvIcon').innerHTML.includes('<svg')&&/\[73c5da0a\/84'\/0'\/0'\]\/0\/index/.test(t.$('wvPath').textContent),'watch-only: a descriptor gives the fingerprint, its picture and the key origin in the path');
      await openW(wo.change); await until(()=>rows().length===10&&t.$('wvChain').value==='1'); const ch1=rows()[0]; await openW(desc); await until(()=>rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
      ok(t.$('wvChain').value==='0'&&ch1!==rows()[0]&&/Change/.test('Change'),'watch-only: a /1/* descriptor opens change addresses, and a /0/* one goes back to receive');
      await openW(desc.slice(0,-1)+(desc.slice(-1)==='a'?'b':'a')); ok(/checksum/.test(t.$('wpStatus').textContent)&&t.$('walletView').style.display==='none','watch-only: a wrong descriptor checksum is refused');
      await openW('sh(wpkh('+ZPUB+'/0/*))'); ok(/but the key is a zpub/.test(t.$('wpStatus').textContent),'watch-only: a descriptor type that does not match the key is refused'); }
    await openW('xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu'); ok(/PRIVATE/.test(t.$('wpStatus').textContent)&&t.$('walletView').style.display==='none','watch-only: a private key is refused');
    await openW('wsh(sortedmulti(2,'+ZPUB+','+XPUB86+'))'); ok(/multisig/.test(t.$('wpStatus').textContent),'watch-only: a multisig descriptor points to the multisig tool');
    await openW(ZPUB); await until(()=>rows().length===10); t.$('wpIn').value+=' '; t.$('wpIn').dispatchEvent(new t.w.Event('input',{bubbles:true}));
    ok(t.$('walletView').style.display==='none'&&!t.$('wvType').disabled&&!t.$('wvAcct').disabled&&t.$('wvSqBlock').style.display!=='none','watch-only: editing the key wipes the view and puts the controls back');
    // Electrum seed warning
    { const r=await t.w.checkPhrase('wild father tree among universe such mobile favorite target dynamic credit identify');
      ok(!r.ok&&/Electrum seed \(SegWit type\)/.test(r.msg),'Electrum: the Electrum SegWit example seed is recognised and named');
      const r2=await t.w.checkPhrase('abandon '.repeat(11)+'abandon'); ok(!r2.ok&&!/Electrum/.test(r2.msg),'Electrum: an ordinary bad phrase gets no Electrum note');
      const r3=await t.w.checkPhrase(AB); ok(r3.ok&&!/Electrum/.test(r3.msg),'Electrum: a valid BIP39 phrase is never called Electrum');
      ok(await t.w.electrumSeedType('say brain hammer whip plug sad budget improve scout myself interest input')==='two-factor (2FA)'&&await t.w.electrumSeedType('neglect morning hat science deputy alarm seed eager cover letter pencil second')==='two-factor (2FA) SegWit'&&await t.w.electrumSeedType('shoulder between fitness double soap point region fade rose guide kitten loud')===null,'Electrum: two-factor types are named, and a phrase whose hash starts 103 is not Electrum'); }
    // payment request (BIP-21)
    { const A=t.w.bip21Amount; ok(A('0.0015').v==='0.0015'&&A('1').v==='1'&&A('1.10000000').v==='1.1'&&A('21000000').v==='21000000'&&A('').v===''&&!A('0').ok&&!A('1.123456789').ok&&!A('21000000.00000001').ok&&!A('1,5').ok&&!A('-1').ok,'payment request: amounts are checked (8 decimals, above 0, at most 21 million)');
      ok(t.w.bip21Uri('bc1qx','0.5','Café & tea','Thanks!')==='bitcoin:bc1qx?amount=0.5&label=Caf%C3%A9%20%26%20tea&message=Thanks!','payment request: link is built and encoded as BIP-21 says');
      t.$('phrase').value=AB; t.$('verifyPass').value=''; await t.w.verify(); await until(()=>rows().length===10);
      t.$('wvList').querySelector('li button.qr-mini').click(); t.$('wvqAmt').value='0.0015'; t.$('wvqLbl').value='Rent'; t.$('wvqAmt').dispatchEvent(new t.w.Event('input'));
      const uri='bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.0015&label=Rent', d=t.d.createElement('div'); d.innerHTML=t.w.qrSvg(t.w.qrMatrix(uri).rows);
      ok(t.$('wvqUri').textContent===uri&&t.$('wvqImg').innerHTML===d.innerHTML&&/Payment request/.test(t.$('wvqCap').textContent),'payment request: the QR becomes the bitcoin: link');
      t.$('wvqAmt').value='0.123456789'; t.$('wvqAmt').dispatchEvent(new t.w.Event('input')); ok(/8 decimals/.test(t.$('wvqUri').textContent),'payment request: a bad amount is explained');
      t.w.hideAddrQr('wvq'); ok(t.$('wvqAmt').value===''&&t.$('wvqLbl').value===''&&t.$('wvqBox').style.display==='none','payment request: HIDE QR clears the request'); }
    // backup checklist
    { t.$('verifyPass').value=''; t.set(rnd(50)); await t.w.generate(); await t.w.eval('passWork');
      const chk=id=>t.$(id).checked;
      ok(t.$('bkList').style.display!=='none'&&!chk('bk1')&&!chk('bk2')&&/0 of 4/.test(t.$('bkNote').textContent),'checklist: appears with the words, nothing ticked');
      const words=t.$('genResult').textContent.split('\n')[0]; t.w.drillStart(); t.$('drillWords').value=words; await t.w.drillCheck(); t.w.drillEnd();
      ok(chk('bk2')&&/1 of 4/.test(t.$('bkNote').textContent),'checklist: a passed restore drill ticks itself');
      t.$('bk1').checked=true; t.$('bk3').checked=true; t.w.bkUpdate();
      t.$('phrase').value=words; await t.w.verify(); await until(()=>rows().length===10); t.w.printRecoverySheet(); t.w.dispatchEvent(new t.w.Event('afterprint'));
      ok(chk('bk4')&&/All four done/.test(t.$('bkNote').textContent),'checklist: printing the recovery sheet for these words ticks itself');
      t.$('passphrase').value='x'; t.$('passphrase2').value='x'; t.$('passphrase').dispatchEvent(new t.w.Event('input',{bubbles:true})); await t.w.rePass();
      ok(!chk('bk2')&&!chk('bk4')&&chk('bk1'),'checklist: a passphrase change unticks the drill and the sheet (they were for the old wallet)');
      t.w.wipeSeed(); ok(t.$('bkList').style.display==='none'&&!chk('bk1'),'checklist: CLEAR ALL clears and hides it'); }
    // key-reuse check
    { const seed=await t.w.mnemonicToSeed(AB,''), a0=await t.w.watchOnlyFromSeed(seed,'wpkh',0,'main'), a1=await t.w.watchOnlyFromSeed(seed,'wpkh',1,'main');
      const run=async v=>{ t.$('reuseIn').value=v; await t.w.checkKeyReuse(); return t.$('reuseStatus').textContent; };
      let r=await run(a0.receive); ok(/1 public key found in 1 line\. No reused key/.test(r)&&/ok/.test(t.$('reuseStatus').className),'key reuse: one clean descriptor passes');
      r=await run(a0.receive+'\n'+a0.change); ok(/No reused key/.test(r),'key reuse: the receive and change descriptors of one wallet are not reuse');
      r=await run(a0.receive+'\npkh('+a0.xpub+'/0/*)'); ok(/appears in 2 different wallets \(lines 1 and 2\)/.test(r),'key reuse: one key in two different wallets is found');
      r=await run('wsh(sortedmulti(2,'+a0.xpub+'/0/*,'+a0.xpub+'/0/*))'); ok(/appears 2 times in one descriptor \(line 1\)/.test(r),'key reuse: one key twice in one multisig is found');
      r=await run('wsh(sortedmulti(2,'+a0.receive.replace(/\/0\/\*$/,'')+','+a1.receive.replace(/\/0\/\*$/,'')+'))'); ok(/2 different keys come from the same master fingerprint 73c5da0a/.test(r),'key reuse: two multisig keys from one seed are found');
      r=await run('wpkh([73c5da0a/84h/0h/0h]'+a1.xpub+'/0/*)\nwpkh([73c5da0a/84h/0h/0h]'+a0.xpub+'/0/*)'); ok(/is given with different keys/.test(r),'key reuse: one fingerprint and path with two different keys is found');
      r=await run(a0.zpub+'\n'+a0.xpub); ok(/appears in 2 different wallets/.test(r),'key reuse: the same key written as zpub and as xpub counts as the same key');
      r=await run('wpkh(xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu/0/*)'); ok(/PRIVATE/.test(r),'key reuse: private keys are refused');
      r=await run('hello'); ok(/No extended public keys/.test(r),'key reuse: nothing to check is explained'); }
    t=t0; }
  { // Roll sheet (v1.34.0): a blank numbered sheet for dice or coin, sized to the chosen mode and word count
    const setMode=m=>{ t.d.querySelector('input[name="mode"][value="'+m+'"]').checked=true; }, setWords=n=>{ t.d.querySelector('input[name="words"][value="'+n+'"]').checked=true; };
    const sheet=()=>{ const p0=t.st.printed; t.w.printRollSheet(); const r={n:t.st.printed-p0,cells:t.st.printCells.slice(),txt:t.st.printHTML,cls:t.st.printClass}; t.w.dispatchEvent(new t.w.Event('afterprint')); return r; };
    let r=sheet(); ok(r.n===1&&r.cells.length===60&&r.cells.every((c,i)=>c===String(i+1))&&/^VOIDFORGE DICE ROLL SHEET/.test(r.txt)&&/50 rolls for a 12-word seed/.test(r.txt)&&/Roll one die and write its number \(1 to 6\)/.test(r.txt)&&/print-seed/.test(r.cls)&&!/1 means/.test(r.txt),'PRINT ROLL SHEET: 50 numbered boxes for 12 words of dice, then 10 more');
    ok(/Extra rolls \(optional\)\. Every one you type in counts\. Exactly 50 gives the same words as SeedSigner and Coldcard; with more, only Coldcard makes the same words\./.test(r.txt),'roll sheet: the extra boxes are optional and the sheet says who makes the same words');
    setWords(24); r=sheet(); ok(r.cells.length===109&&/99 rolls for a 24-word seed/.test(r.txt),'roll sheet: 99 boxes for 24 words of dice');
    setMode('coin'); r=sheet(); ok(r.cells.length===266&&/Exactly 256 is the method in SeedSigner's coin-flip code; with more, that code makes different words\./.test(r.txt)&&/^VOIDFORGE COIN FLIP SHEET/.test(r.txt)&&/256 flips for a 24-word seed/.test(r.txt)&&/1 means: ______   0 means: ______/.test(r.txt)&&/write 1 or 0/.test(r.txt),'roll sheet: 256 boxes for 24 words of coin flips, with the sides to fill in');
    setWords(12); r=sheet(); ok(r.cells.length===138,'roll sheet: 128 boxes for 12 words of coin flips, then 10 more');
    setMode('dice'); r=sheet(); ok(/as secret as your seed/.test(r.txt)&&/shred/.test(r.txt)&&t.$('printOnly').textContent===''&&!t.d.body.classList.contains('print-seed'),'roll sheet: warns that a filled sheet is secret, and is cleaned up after printing');
    ok(!!t.$('rollSheetBtn')&&/printRollSheet/.test(t.$('rollSheetBtn').getAttribute('onclick')),'PRINT ROLL SHEET button is on the page'); }
  { // Auto-clear (v1.34.0): optional wipe after idle time or when the tab is hidden (on a fresh page, so the wipe does not disturb the tests that follow)
    const keepT=t; t=load(); await t.ready();
    const sel=t.$('autoIdle'), chk=t.$('autoHide'), note=()=>t.$('autoNote').textContent, now=()=>Date.now(), MIN=60000;
    const arm=async()=>{ t.set(rnd(50)); t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate(); t.$('verifyPass').value='VP'; t.$('reforgeWordsInput').value='abandon ?'; t.$('drillWords').value='abandon'; t.$('prInput').value='abandon'; t.$('checkAddr').value='bc1qx'; const ro=t.$('reforgeOut'); ro.textContent='found'; ro.style.display=''; const co=t.$('childOut'); co.textContent='child words'; co.style.display=''; };
    const left=()=>['rolls','passphrase','passphrase2','verifyPass','reforgeWordsInput','drillWords','prInput','checkAddr'].filter(id=>t.$(id).value);
    ok(sel.value==='0'&&!chk.checked&&[...sel.options].map(o=>o.value).join()==='0,2,5,10,30'&&t.$('autoClearBox').tagName==='DETAILS'&&!t.$('autoClearBox').open,'auto-clear: off by default, with never / 2 / 5 / 10 / 30 minutes to pick');
    ok(t.w.autoWipe('test')===false&&note()==='','auto-clear: with nothing on the page, a wipe does nothing and says nothing');
    await arm(); ok(t.w.autoWipe('because of a test')===true,'auto-clear: a wipe with secrets on the page reports it');
    ok(left().length===0&&!t.w.hasSeed()&&t.$('childOut').textContent===''&&t.$('reforgeOut').textContent===''&&t.$('reforgeOut').style.display==='none'&&/^Wiped automatically because of a test at /.test(note()),'auto-clear: seed, rolls, passphrases, typed words, Reforge and child outputs are all wiped and the note says why (left: '+left().join(',')+')');
    ok(t.w.autoWipe('x')===false&&/because of a test/.test(note()),'auto-clear: a second wipe with nothing left changes nothing');
    // idle timer
    let cleared=0; const ci=t.w.clearInterval; t.w.clearInterval=x=>{ cleared++; return ci.call(t.w,x); };
    sel.value='5'; sel.dispatchEvent(new t.w.Event('change')); ok(/^Auto-clear is ON: after 5 minutes with no activity\.$/.test(note())&&t.w.eval('autoTimer')!==null,'auto-clear: choosing 5 minutes turns it on and starts the timer');
    await arm(); t.w.autoCheck(now()+4*MIN); ok(t.w.hasSeed()&&left().length>0,'auto-clear: nothing is wiped before the idle time is up');
    t.w.autoCheck(now()+6*MIN); ok(!t.w.hasSeed()&&left().length===0&&/^Wiped automatically after 5 minutes with no activity at /.test(note()),'auto-clear: everything is wiped once the idle time is up');
    for(const ev of ['keydown','pointerdown','input','touchstart','wheel']){ await arm(); t.w.eval('autoLast = 0'); t.d.dispatchEvent(new t.w.Event(ev,{bubbles:true})); t.w.autoCheck(now()+4*MIN); ok(t.w.hasSeed(),'auto-clear: a '+ev+' counts as activity and restarts the idle time'); }
    sel.value='0'; sel.dispatchEvent(new t.w.Event('change')); ok(note()==='Auto-clear is off.'&&t.w.eval('autoTimer')===null&&cleared===1,'auto-clear: choosing never turns it off and stops the timer');
    await arm(); t.w.eval('autoLast = 0'); t.w.autoCheck(now()+999*MIN); ok(t.w.hasSeed(),'auto-clear: "never" never wipes');
    // tab hidden
    const hide=v=>{ Object.defineProperty(t.d,'hidden',{value:v,configurable:true}); t.d.dispatchEvent(new t.w.Event('visibilitychange')); };
    hide(true); ok(t.w.hasSeed(),'auto-clear: leaving the tab wipes nothing while that option is off'); hide(false);
    chk.checked=true; chk.dispatchEvent(new t.w.Event('change')); ok(/^Auto-clear is ON: when you leave this tab\.$/.test(note()),'auto-clear: ticking the tab option turns it on');
    hide(false); ok(t.w.hasSeed(),'auto-clear: coming back to the tab wipes nothing');
    hide(true); ok(!t.w.hasSeed()&&left().length===0&&/^Wiped automatically because you left this tab at /.test(note()),'auto-clear: leaving the tab wipes everything when that option is on'); hide(false);
    sel.value='10'; sel.dispatchEvent(new t.w.Event('change')); ok(/^Auto-clear is ON: after 10 minutes with no activity and when you leave this tab\.$/.test(note()),'auto-clear: the note lists both settings');
    sel.value='0'; sel.dispatchEvent(new t.w.Event('change')); chk.checked=false; chk.dispatchEvent(new t.w.Event('change')); t.w.clearInterval=ci; t=keepT; }
  // --- SeedQR / CompactSeedQR on screen, by hand and on paper ---
  { const keepT=t; t=load(); await t.ready(); t.set(rnd(50)); t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate(); const sw=t.$('genResult').textContent.split('\n')[0];
    const sz=()=>{ const v=t.$('sqImg').querySelector('svg'); return v?Math.round(v.viewBox.baseVal.width)-8:0; }, gc=()=>t.$('sqGuideCaption').textContent;
    ok(t.$('seedQrBox').style.display==='','SeedQR box appears after FORGE');
    t.w.showSeedQr('seedqr'); ok(sz()===25&&t.$('sqBox').style.display===''&&/^SeedQR for these 12 words, 25 x 25 squares/.test(t.$('sqCaption').textContent),'SEEDQR draws a 25 x 25 code for 12 words');
    t.w.showSeedQr('compact'); ok(sz()===21&&/^CompactSeedQR for these 12 words, 21 x 21 squares/.test(t.$('sqCaption').textContent),'COMPACTSEEDQR draws a 21 x 21 code for 12 words');
    t.w.hideSeedQr(); ok(t.$('sqImg').innerHTML===''&&t.$('sqBox').style.display==='none'&&t.$('sqCaption').textContent==='','HIDE removes the SeedQR');
    t.st.alerts.length=0; const p0=t.st.printed; t.w.printSeedQr(); ok(t.st.printed===p0&&/Press SHOW SEEDQR/.test(t.st.alerts.join('|')),'PRINT THIS QR needs a shown code first');
    t.w.showSeedQr('seedqr'); t.w.printSeedQr();
    ok(t.st.printed===p0+1&&/print-qr/.test(t.st.printClass)&&/VOIDFORGE SEEDQR \(12 words, 25 x 25 squares\)/.test(t.st.printQrText)&&/<svg/.test(t.st.printQrHTML)&&!t.st.printQrText.includes('SECRETPASS')&&!t.st.printQrText.includes(sw.split(' ').slice(0,3).join(' ')),'PRINT THIS QR prints the code, no words and no passphrase');
    t.w.dispatchEvent(new t.w.Event('afterprint')); ok(t.$('printQr').textContent===''&&!t.d.body.classList.contains('print-qr'),'SeedQR print area cleaned up after printing');
    // by hand: 7 x 7 blocks, mini-map, grey squares outside the code
    t.w.showSeedQr('seedqr'); t.w.openSqGuide();
    ok(t.$('sqGuide').style.display===''&&/^Block 1 of 16: rows 1 to 7, columns 1 to 7 of the 25 x 25 grid/.test(gc())&&!!t.$('sqGuideImg').querySelector('svg')&&!!t.$('sqMini').querySelector('svg'),'COPY BY HAND opens block 1 of 16 with a mini-map');
    t.w.sqGuideBlock(1); ok(/^Block 2 of 16: rows 1 to 7, columns 8 to 14/.test(gc()),'NEXT BLOCK moves right');
    for(let i=0;i<2;i++) t.w.sqGuideBlock(1); ok(/^Block 4 of 16: rows 1 to 7, columns 22 to 25/.test(gc())&&/Grey squares are outside the code/.test(gc()),'the last block of a row is cut at the edge of the code');
    ok(!!t.$('sqGuideImg').querySelector('path[fill="#c8c8c8"]')&&/^M/.test(t.$('sqGuideImg').querySelector('path[fill="#c8c8c8"]').getAttribute('d')),'squares outside the code are drawn grey');
    t.w.sqGuideBlock(1); ok(/^Block 5 of 16: rows 8 to 14, columns 1 to 7/.test(gc()),'blocks continue on the next row of blocks');
    t.w.sqGuideBlock(-1); ok(/^Block 4 of 16/.test(gc()),'PREVIOUS BLOCK moves back');
    t.w.openSqGuide(); t.w.sqGuideBlock(-1); ok(/^Block 16 of 16: rows 22 to 25, columns 22 to 25/.test(gc()),'PREVIOUS BLOCK wraps from the first block to the last');
    t.w.sqGuideBlock(1); ok(/^Block 1 of 16/.test(gc()),'NEXT BLOCK wraps from the last block to the first');
    t.w.sqGuideFull(); ok(/^Whole SeedQR grid, 25 x 25 squares/.test(gc())&&t.$('sqGuideImg').querySelectorAll('text').length===50&&t.$('sqMini').innerHTML==='','WHOLE GRID shows all 25 column and 25 row numbers');
    t.w.showSeedQr('compact'); ok(t.$('sqGuide').style.display==='none'&&t.$('sqGuideImg').innerHTML===''&&t.$('sqMini').innerHTML==='','showing another code closes the guide');
    t.w.openSqGuide(); ok(/^Block 1 of 9: rows 1 to 7, columns 1 to 7 of the 21 x 21 grid/.test(gc()),'CompactSeedQR (21 x 21) has 9 blocks of 7 x 7');
    t.w.hideSeedQr(); ok(t.$('sqGuide').style.display==='none','HIDE also closes the guide');
    t.st.alerts.length=0; t.w.openSqGuide(); ok(/Press SHOW SEEDQR/.test(t.st.alerts.join('|')),'COPY BY HAND needs a shown code first');
    t.w.showSeedQr('seedqr'); const p1=t.st.printed; t.w.printSqGuide();
    ok(t.st.printed===p1+1&&/print-qr/.test(t.st.printClass)&&/HAND-COPY GUIDE \(12 words, 25 x 25 squares\)/.test(t.st.printQrText)&&/Row 1: /.test(t.st.printQrText)&&/Row 25: /.test(t.st.printQrText)&&!/Row 26/.test(t.st.printQrText)&&!t.st.printQrText.includes('SECRETPASS')&&!t.st.printQrText.includes(sw.split(' ').slice(0,3).join(' ')),'PRINT HAND-COPY GUIDE prints the grid and 25 row lists, no words and no passphrase');
    t.w.dispatchEvent(new t.w.Event('afterprint'));
    const c0=t.st.confirms; t.w.printSqBlank(); ok(t.st.printed===p1+2&&t.st.confirms===c0&&/BLANK 25 x 25 GRID/.test(t.st.printQrText)&&!/Row 1: /.test(t.st.printQrText),'PRINT BLANK GRID prints without asking (nothing secret) and has no row lists');
    { const d=t.st.printQrHTML.match(/<path d="([^"]*)" fill="#000"/); ok(!!d&&d[1]==='','the blank grid has no filled squares'); }
    t.w.dispatchEvent(new t.w.Event('afterprint'));
    t.w.showSeedQr('compact'); t.set(rnd(50)); await t.w.generate(); ok(t.$('sqImg').innerHTML===''&&t.$('sqBox').style.display==='none','a new FORGE removes the old SeedQR');
    t.w.showSeedQr('seedqr'); t.w.openSqGuide(); t.w.clearAll(); ok(t.$('sqImg').innerHTML===''&&t.$('sqGuideImg').innerHTML===''&&t.$('sqMini').innerHTML===''&&t.$('seedQrBox').style.display==='none','CLEAR removes the SeedQR and the guide and hides the box');
    t.st.alerts.length=0; t.w.showSeedQr('seedqr'); ok(t.$('sqImg').innerHTML===''&&/Generate a seed first/.test(t.st.alerts.join('|')),'SHOW SEEDQR needs a seed first');
    t.words(24); t.set(rnd(99)); await t.w.generate(); t.w.showSeedQr('seedqr'); ok(sz()===29&&/24 words, 29 x 29/.test(t.$('sqCaption').textContent),'SEEDQR is 29 x 29 for 24 words'); t.w.openSqGuide(); ok(/^Block 1 of 25: rows 1 to 7, columns 1 to 7 of the 29 x 29/.test(gc()),'29 x 29 has 25 blocks'); for(let i=0;i<4;i++) t.w.sqGuideBlock(1); ok(/^Block 5 of 25: rows 1 to 7, columns 29 to 29/.test(gc()),'the last block column of a 29 x 29 code is one square wide'); t.w.showSeedQr('compact'); ok(sz()===25,'COMPACTSEEDQR is 25 x 25 for 24 words'); t.words(12);  t=keepT; }
  // --- "How your seed was made" explainer ---
  { const keepT=t; t=load(); await t.ready(); t.set(rnd(50)); t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate();
    const wd=t.$('genResult').textContent.split('\n')[0].split(' '), ex=()=>t.$('exOut');
    ok(t.$('explainBox').style.display===''&&!t.$('explainBox').open&&ex().style.display==='none'&&ex().textContent==='','explainer box appears closed after FORGE, with nothing shown');
    await t.w.showExplain();
    const cells=[...ex().querySelectorAll('.ex-cell b')].map(e=>e.textContent);
    ok(cells.length===12&&cells.every((c,i)=>c===(i+1)+'. '+wd[i]),'explainer lists the 12 words in order');
    ok(ex().querySelectorAll('.ex-step').length===5&&!!ex().querySelector('.ex-ok')&&!ex().querySelector('.ex-bad'),'explainer shows five steps and says the words match');
    ok(!ex().textContent.includes('SECRETPASS')&&!ex().querySelector('a,script,img,form,input'),'explainer never shows the passphrase and has no links or inputs');
    ok(/50 dice rolls/.test(ex().textContent)&&/roughly 129 bits/.test(ex().textContent),'explainer counts the rolls and the bits');
    ok([...ex().querySelectorAll('.ex-cell')].every(c=>{ const m=c.textContent.match(/number (\d+)/); return m&&parseInt(c.querySelector('code').textContent,2)===+m[1]; }),'explainer numbers match the word list');
    ok(ex().querySelectorAll('.ex-cs').length>=2&&[...ex().querySelectorAll('.ex-cs')].some(e=>/^[01]{4}$/.test(e.textContent)),'explainer marks the 4 checksum bits');
    t.w.hideExplain(); ok(ex().style.display==='none'&&ex().textContent==='','HIDE removes the explainer steps');
    t.st.alerts.length=0; await t.w.showExplain(); ok(ex().textContent===''&&/Forge a seed first/.test(t.st.alerts.join('|')),'SHOW THE STEPS needs a seed first (after HIDE the steps are gone)');
    await t.w.generate(); ok(ex().textContent===''&&t.$('explainBox').style.display==='','a new FORGE clears the old steps');
    await t.w.showExplain(); t.w.clearAll(); await new Promise(r=>setTimeout(r,20)); ok(ex().textContent===''&&t.$('explainBox').style.display==='none','CLEAR removes the explainer and hides its box');
    t.words(24); t.set(rnd(99)); await t.w.generate(); await t.w.showExplain();
    const c24=[...ex().querySelectorAll('.ex-cell')]; ok(c24.length===24&&/99 dice rolls/.test(ex().textContent)&&/^[01]{8}$/.test(c24[23].querySelector('.ex-cs').textContent)&&!!ex().querySelector('.ex-ok'),'explainer for 24 words: 24 pieces, 8 checksum bits, words match');
    t=keepT; }
  // --- download seed: confirm, no passphrase ---
  t.w.downloadSeed(); const txt=await blobText(t.w,t.st.blob);
  ok(t.st.confirms>=2&&txt.includes(words)&&!txt.includes('SECRETPASS'),'DOWNLOAD seed asks first and omits passphrase');
  { // stale-result guard (v1.26.1): what is on screen always belongs to the inputs that made it
    const g=load(); await g.ready(); await g.ready();
    const seedOn=()=>g.$('genResult').dataset.seed==='1', fpOn=()=>/[0-9a-f]{8}/.test(g.$('fingerprint').textContent), adOn=()=>/bc1q/.test(g.$('address').textContent);
    const first=()=>g.$('genResult').textContent.split('\n')[0];
    const forge=async(r,pw='')=>{ g.mode('dice'); g.words(12); g.set(r); g.$('passphrase').value=pw; g.$('passphrase2').value=pw; await g.w.generate(); };
    const typePass=(v)=>{ g.$('passphrase').value=v; g.$('passphrase').dispatchEvent(new g.w.Event('input',{bubbles:true})); };
    const R1=rnd(50,6); await forge(R1); const W1=first();
    ok(seedOn()&&fpOn()&&adOn()&&g.d.querySelectorAll('#wordGrid .wcell').length===12,'stale guard: a made seed shows words, fingerprint and address');
    g.w.updateCount(); g.w.hideExplain(); g.w.updateCount(); typePass(''); g.set(R1+'x y z'); ok(seedOn()&&first()===W1&&fpOn()&&adOn(),'stale guard: no change (same passphrase, ignored characters, explainer closed) keeps the result');
    typePass('abc'); ok(seedOn()&&first()===W1&&!fpOn()&&!adOn()&&g.$('watchBox').style.display==='none'&&!g.$('wZpub').textContent&&/do not match/.test(g.$('fingerprint').textContent),'passphrase after FORGE: typing it in one box keeps the words but clears fingerprint, address and watch-only keys until the confirm box agrees');
    g.$('passphrase2').value='abc'; g.$('passphrase2').dispatchEvent(new g.w.Event('input',{bubbles:true})); await g.w.eval('passWork'); ok(seedOn()&&first()===W1&&fpOn()&&adOn()&&/with passphrase/.test(g.$('fingerprint').textContent)&&/Without the passphrase: [0-9a-f]{8}/.test(g.$('fpBase').textContent)&&g.$('fpBaseRow').style.display==='flex'&&g.$('fpBaseIcon').innerHTML!==''&&g.$('fpIcon').innerHTML!==''&&g.$('watchBox').style.display===''&&/used \(3 characters/.test(g.$('genResult').textContent),'passphrase after FORGE: once both boxes agree the same words get the with-passphrase wallet, and the plain fingerprint and picture are shown beside it');
    { const fpWith=g.$('fingerprint').textContent, base=g.$('fpBase').textContent.match(/[0-9a-f]{8}/)[0]; typePass(''); g.$('passphrase2').value=''; g.$('passphrase2').dispatchEvent(new g.w.Event('input',{bubbles:true})); await g.w.eval('passWork'); ok(seedOn()&&first()===W1&&fpOn()&&g.$('fingerprint').textContent.includes(base)&&!/with passphrase/.test(g.$('fingerprint').textContent)&&g.$('fpBaseRow').style.display==='none'&&g.$('fpBase').textContent===''&&fpWith!==g.$('fingerprint').textContent,'passphrase after FORGE: clearing both boxes goes back to the plain wallet and hides the second fingerprint'); }
    g.st.alerts.length=0; typePass('q'); g.w.downloadSeed(); g.w.printSeed(); g.w.printSeedQr(); ok(g.st.alerts.length===3&&g.st.alerts.every(m=>/do not match/.test(m)),'passphrase after FORGE: DOWNLOAD and the print sheets wait while the two boxes disagree'); typePass('');
    g.set(R1.slice(0,40)); g.st.alerts.length=0; g.w.downloadSeed(); ok(g.st.alerts.some(m=>/Generate a seed first/.test(m)),'stale guard: DOWNLOAD refuses after the rolls changed');
    typePass(''); g.set(R1); await g.w.generate(); ok(seedOn()&&first()===W1,'stale guard: pressing FORGE again with the same rolls gives the same words');
    g.set(R1.slice(0,49)+(R1[49]==='1'?'2':'1')); ok(!seedOn()&&!fpOn()&&!adOn(),'stale guard: changing a roll after FORGE clears the result');
    await forge(R1); g.set(R1.slice(0,-1)); ok(!seedOn()&&!fpOn()&&!adOn(),'stale guard: removing a roll after FORGE clears the result');
    await forge(R1); g.w.undoRoll(); ok(!seedOn(),'stale guard: UNDO after FORGE clears the result');
    { // v1.29.1 run counter: an edit, or CLEAR ALL, while FORGE is still working out the fingerprint and addresses must not let the old run write them back
      const mid=async(act,cond=()=>/computing/.test(g.$('fingerprint').textContent))=>{ g.mode('dice'); g.words(12); g.set(R1); g.$('passphrase').value=''; g.$('passphrase2').value=''; const p=g.w.generate(); for(let i=0;i<5000&&!cond();i++) await new Promise(r=>setTimeout(r,0)); const saw=cond(); act(); await p; await new Promise(r=>setTimeout(r,400)); return saw; };
      ok(await mid(()=>typePass('abc')), 'run counter: the edit really landed while the fingerprint was still being computed');
      ok(seedOn()&&!fpOn()&&!adOn()&&g.$('addrList').textContent===''&&!/computing/.test(g.$('fingerprint').textContent),'run counter: an edit during FORGE leaves no old fingerprint, address or address list behind');
      typePass(''); await g.w.eval('passWork'); ok(await mid(()=>typePass('abc'),()=>/Master fingerprint: [0-9a-f]{8}/.test(g.$('fingerprint').textContent)&&g.$('address').textContent===''), 'run counter: an edit lands after the fingerprint is shown and before the first address');
      ok(seedOn()&&!fpOn()&&!adOn()&&g.$('addrList').textContent==='','run counter: an edit before the first address leaves no old address or list behind');
      typePass(''); await g.w.eval('passWork'); ok(await mid(()=>typePass('abc'),()=>/bc1q/.test(g.$('address').textContent)&&g.$('addrList').textContent===''), 'run counter: an edit lands after the first address is shown and before the address list');
      ok(seedOn()&&!fpOn()&&!adOn()&&g.$('addrList').textContent==='','run counter: an edit before the address list leaves no old list behind');
      typePass(''); await g.w.eval('passWork'); await mid(()=>g.w.wipeSeed());
      ok(!seedOn()&&!fpOn()&&!adOn()&&g.$('addrList').textContent==='','run counter: CLEAR ALL during FORGE leaves no old fingerprint, address or address list behind');
      typePass(''); await forge(R1); ok(seedOn()&&fpOn()&&adOn(),'run counter: a normal FORGE afterwards still shows its fingerprint and address'); }
    await forge(R1); g.words(24); ok(!seedOn()&&!fpOn()&&g.d.querySelectorAll('#wordGrid .wcell').length===24&&g.d.querySelectorAll('#wordGrid .wcell:not(.empty)').length===0,'stale guard: changing the word count after FORGE clears the result');
    await forge(R1); g.mode('coin'); ok(!seedOn()&&!fpOn(),'stale guard: switching dice/coin after FORGE clears the result'); g.mode('dice');
    await forge(R1,'p1'); g.$('passphrase2').value='p2'; g.$('passphrase2').dispatchEvent(new g.w.Event('input',{bubbles:true})); await g.w.eval('passWork'); ok(seedOn()&&first()===W1&&!fpOn(),'passphrase after FORGE: editing the confirm box so it disagrees clears the fingerprint but keeps the words');
    { const sp=R1.replace(/(.)/g,'$1 '); await forge(sp); g.w.downloadSeed(); const txt=await blobText(g.w,g.st.blob); ok(txt.endsWith('Input: '+R1)||txt.includes('Input: '+R1+'\n'),'stale guard: the saved file records the rolls that made the words (cleaned), not what is typed now'); }
    { const A11='abandon '.repeat(11); g.$('wdLen').value='12'; g.$('wdWords').value=A11; g.$('wdFlips').value='0000000'; g.$('passphrase').value=''; g.$('passphrase2').value=''; g.w.wdUpdate(); await g.w.wdGenerate();
      ok(seedOn()&&/abandon/.test(first()),'stale guard: a seed from the Word draw box exists');
      g.set(rnd(10,6)); g.mode('coin'); g.mode('dice'); ok(seedOn(),'stale guard: the rolls box and the dice/coin choice do not matter to a Word draw seed');
      typePass('zzz'); await g.w.eval('passWork'); ok(seedOn()&&!fpOn(),'passphrase after FORGE: a passphrase edit keeps a Word draw seed too (fingerprint waits for the confirm box)');
      g.words(24); ok(!seedOn(),'stale guard: changing the word count clears a Word draw seed, as it does a dice seed (v2.3.0)'); g.words(12); typePass(''); }
    // --- restore drill (v1.27.0) ---
    { const body=g.d.body, dr=(id)=>g.$(id), st=()=>dr('drillStatus').textContent, typed=(w,pw)=>{ dr('drillWords').value=w; dr('drillPass').value=pw||''; };
      const vis=(id)=>g.w.getComputedStyle(g.$(id)).display;
      await forge(R1); const W=W1.split(' ');
      ok(dr('drillBox').style.display==='','drill: the card appears once a seed exists');
      g.w.drillEnd(); await g.w.drillCheck(); ok(/Press START DRILL/.test(st()),'drill: CHECK before START asks you to start');
      g.w.drillStart(); ok(body.classList.contains('drill-on')&&dr('drillRun').style.display===''&&dr('drillStart').style.display==='none'&&/Type your 12 words/.test(dr('drillLabel').textContent),'drill: START hides the words on screen and opens the typing box');
      ok(dr('drillPassRow').style.display==='none','drill: no passphrase box when the seed has no passphrase');
      typed(W.slice(0,11).join(' ')); await g.w.drillCheck(); ok(/typed 11 words, but this seed has 12/.test(st())&&dr('drillStatus').classList.contains('bad'),'drill: wrong word count is reported');
      typed(W.slice(0,3).concat(['zzzzz'],W.slice(4)).join(' ')); await g.w.drillCheck(); ok(/Word 4 is not in the BIP39 list/.test(st()),'drill: a word that is not in the list is reported by position');
      { const bad=W.slice(); bad[2]=W[2]==='abandon'?'ability':'abandon'; bad[6]=W[6]==='zoo'?'zone':'zoo'; typed(bad.join(' ')); await g.w.drillCheck();
        const MSG='Word 3 and 7 do not match your seed. Look at those words on your paper. (The page will not show you the right word: the point is to test the paper.)', rest=st().replace(MSG,''); /* the fixed message has ordinary words in it (and, not, match, look, ...) that can also be seed words, so only what is left after it is checked */
        ok(st().includes(MSG)&&!new RegExp('\\b'+W[2]+'\\b').test(rest)&&!new RegExp('\\b'+W[6]+'\\b').test(rest),'drill: wrong words are reported by position and the right words are never shown'); }
      { const bad=W.slice(); bad[11]=W[11]==='abandon'?'ability':'abandon'; typed(bad.join(' ')); await g.w.drillCheck(); ok(/Word 12 does not match/.test(st()),'drill: a single wrong word uses the singular'); }
      typed(W.join(' ')+' '); dr('drillWords').value='  '+W.join('\n').toUpperCase()+'  '; await g.w.drillCheck();
      ok(/Drill passed/.test(st())&&/master fingerprint [0-9a-f]{8}/.test(st())&&dr('drillStatus').classList.contains('ok'),'drill: the right words pass (any spacing and capitals) and show the fingerprint');
      typed(W.join(' '),'oops'); await g.w.drillCheck(); ok(/this seed was made without a passphrase/.test(st()),'drill: a passphrase typed for a seed without one is flagged');
      g.w.drillEnd(); ok(!body.classList.contains('drill-on')&&dr('drillWords').value===''&&dr('drillStatus').textContent===''&&dr('drillRun').style.display==='none'&&dr('drillStart').style.display==='','drill: END DRILL shows the words again and wipes what you typed');
      // with a passphrase
      await forge(R1,'my pass'); const WP=first().split(' ');
      g.w.drillStart(); ok(dr('drillPassRow').style.display==='','drill: a passphrase box appears when the seed has a passphrase');
      typed(WP.join(' '),''); await g.w.drillCheck(); ok(/The words match, but the passphrase does not\./.test(st()),'drill: right words with no passphrase typed is not enough');
      typed(WP.join(' '),'My pass'); await g.w.drillCheck(); ok(/The words match, but the passphrase does not\./.test(st()),'drill: the passphrase is case sensitive');
      typed(WP.join(' '),'my pass'); await g.w.drillCheck(); ok(/Drill passed\. Every word and the passphrase matches/.test(st()),'drill: words and passphrase together pass');
      // anything that changes or clears the seed ends the drill
      g.set(R1.slice(0,49)+(R1[49]==='1'?'2':'1')); ok(!body.classList.contains('drill-on')&&dr('drillWords').value==='','drill: changing the rolls ends the drill and wipes the typed words');
      await forge(R1); g.w.drillStart(); typed(W.join(' ')); typePass('q'); ok(!body.classList.contains('drill-on')&&dr('drillWords').value==='','drill: changing the passphrase ends the drill');
      await forge(R1); g.w.drillStart(); typed(W.join(' ')); g.w.wipeSeed(); ok(!body.classList.contains('drill-on')&&dr('drillWords').value===''&&dr('drillBox').style.display==='none','drill: CLEAR ends the drill and hides the card');
      g.st.alerts.length=0; g.w.drillStart(); ok(g.st.alerts.some(m=>/Make the seed first/.test(m))&&!body.classList.contains('drill-on'),'drill: START refuses when there is no seed');
      // while the drill runs, nothing on screen shows the words
      await forge(R1); g.w.drillStart(); const css=html.match(/<style>[\s\S]*?<\/style>/)[0];
      ok(/body\.drill-on #wordGrid, body\.drill-on #genResult[^{]*\{ visibility: hidden; \}/.test(css)&&/body\.drill-on \.needs-words[^{]*\.print-btn[^{]*#seedQrBox[^{]*#explainBox \{ display: none !important; \}/.test(css),'drill: the CSS hides the word grid, the result text, the buttons that show words, the print button, the Seed QR and the explainer');
      ok(['abbrBtn'].every(id=>g.$(id).classList.contains('needs-words'))&&[...g.d.querySelectorAll('button')].filter(b=>/^(SEND TO CHECK|DOWNLOAD)$/.test(b.textContent)).every(b=>b.classList.contains('needs-words')),'drill: SHOW FIRST 4 LETTERS, SEND TO CHECK and DOWNLOAD are marked as word-showing buttons');
      g.w.drillEnd(); }
    ok(g.errors.length===0,'stale guard: no page errors'); }
  // --- download tool: clean copy, no seed ---
  t.w.downloadTool(); const page=await blobText(t.w,t.st.blob);
  ok(!page.includes(words.split(' ').slice(0,4).join(' ')),'DOWNLOAD FOR USB copy contains no generated seed');
  ok(!page.includes('SECRETPASS'),'DOWNLOAD FOR USB copy contains no passphrase');
  // --- clear wipes everything ---
  t.$('phrase').value='abandon '.repeat(11)+'about'; await t.w.verify(); await t.w.runSelfTests(); t.w.clearAll(); await new Promise(r=>setTimeout(r,20));
  ok(t.$('phrase').value===''&&t.$('verifyStatus').textContent===''&&t.$('testResults').textContent===''&&t.$('genResult').textContent==='—'&&t.$('passphrase').value==='','CLEAR wipes rolls, passphrase, verify box, results');
  ok(t.st.clip.includes(''),'CLEAR attempts to clear the clipboard');

  // ===== v1.1 additions =====
  t=load(); await t.ready();
  ok(/SELF-TEST PASSED/.test(t.$('selfTestBadge').textContent)&&!t.$('forgeBtn').disabled&&!t.$('verifyBtn').disabled,'auto self-test runs on load and enables the tool');
  // v1.4: address, passphrase confirm, tap buttons
  { t.set('65515223131652132161133154444123616466443112153441'); t.$('passphrase').value=''; t.$('passphrase2').value=''; await t.w.generate();
    ok(/bc1q[0-9a-z]{38}/.test(t.$('address').textContent),'first receive address is shown after FORGE');
    ok(!/with passphrase/.test(t.$('address').textContent),'no passphrase label when no passphrase');
    { const wb=t.$('watchBox'); ok(wb.style.display===''&&/^zpub[1-9A-HJ-NP-Za-km-z]{100,}$/.test(t.$('wZpub').textContent)&&/^wpkh\(\[[0-9a-f]{8}\/84h\/0h\/0h\]xpub[1-9A-HJ-NP-Za-km-z]+\/0\/\*\)#[a-z0-9]{8}$/.test(t.$('wDescR').textContent)&&/\/1\/\*\)#/.test(t.$('wDescC').textContent),'watch-only box shows zpub and receive/change descriptors after FORGE'); }
    ok(/^sp1q[02-9ac-hj-np-z]{112}$/.test(t.$('spAddr').textContent),'silent payments: mainnet shows an sp1q address (116 characters)');
    { const set=async(ty,ne,ac)=>{ t.$('wType').value=ty; t.$('wNet').value=ne; t.$('wAcct').value=ac; await t.w.refreshWatch(); };
      await set('wpkh','test','0'); ok(/^vpub/.test(t.$('wZpub').textContent)&&/^tb1q/.test(t.$('wFirst').textContent)&&/84h\/1h\/0h/.test(t.$('wDescR').textContent)&&/Testnet|vpub/.test(t.$('wKeyLabel').textContent),'testnet native SegWit shows vpub, tb1q address and a 1h coin type');
      ok(t.$('wTestBan').style.display===''&&/TESTNET/.test(t.$('wTestBan').textContent),'watch-only: testnet shows the loud banner');
      ok(/^tsp1q[02-9ac-hj-np-z]{112}$/.test(t.$('spAddr').textContent)&&t.$('spBox').style.display==='','silent payments: testnet shows a tsp1q address (117 characters)');
      { const [l1,l2]=t.$('coreCmd').textContent.split('\n'); const arr=JSON.parse(l2.split("importdescriptors '")[1].slice(0,-1)); ok(t.$('coreBox').style.display===''&&/^bitcoin-cli createwallet "voidforge-watch" true true "" false true$/.test(l1)&&/-rpcwallet=voidforge-watch importdescriptors '/.test(l2)&&arr.length===2&&arr[0].desc===t.$('wDescR').textContent&&arr[1].desc===t.$('wDescC').textContent&&arr[0].internal===false&&arr[1].internal===true&&arr.every(x=>x.timestamp==='now'&&x.active===true&&x.range[0]===0&&x.range[1]===999&&x.next_index===0),'Bitcoin Core guide: empty watch-only wallet, then receive and change descriptors imported with the right flags and birthday now'); }
      t.$('coreWhen').value='0'; t.w.updateCore(); ok(JSON.parse(t.$('coreCmd').textContent.split("importdescriptors '")[1].slice(0,-1)).every(x=>x.timestamp===0),'Bitcoin Core guide: a used wallet scans from the beginning (timestamp 0)'); t.$('coreWhen').value='now'; t.w.updateCore();
      await set('ms-wsh','main','0'); ok(/^Zpub/.test(t.$('wZpub').textContent)&&/^\[[0-9a-f]{8}\/48h\/0h\/0h\/2h\]xpub/.test(t.$('wDescR').textContent)&&t.$('wFirstGroup').style.display==='none'&&t.$('wDescGroupC').style.display==='none'&&t.$('wQrC').style.display==='none'&&/cosigner/.test(t.$('wKeyLabel').textContent),'multisig cosigner shows Zpub with origin and hides the change descriptor and first address');
      ok(t.$('wTestBan').style.display==='none'&&t.$('coreBox').style.display==='none'&&t.$('coreCmd').textContent==='','Bitcoin Core guide and testnet banner: hidden for a mainnet multisig cosigner key');
      ok(t.$('spBox').style.display==='none','silent payments: hidden for a multisig cosigner key');
      await set('ms-sh-wsh','test','1'); ok(/^Upub/.test(t.$('wZpub').textContent)&&/\/48h\/1h\/1h\/1h\]tpub/.test(t.$('wDescR').textContent),'testnet nested multisig cosigner shows Upub and a tpub origin key');
      await set('wpkh','main','0'); ok(/^zpub/.test(t.$('wZpub').textContent)&&t.$('wFirstGroup').style.display===''&&t.$('wDescGroupC').style.display===''&&t.$('wQrC').style.display==='','going back to mainnet native SegWit restores the usual boxes'); }
    { const RF=async(x,chk,pw)=>{ t.$('reforgeWordsInput').value=x; t.$('reforgeWordsCheck').value=chk||''; t.$('reforgeWordsPass').value=pw||''; await t.w.reforgeWords(); return [t.$('reforgeStatus').textContent,t.$('reforgeStatus').className,t.$('reforgeOut').textContent,t.$('reforgeOut').style.display]; };
      const AB='abandon '.repeat(11)+'about', ZP='zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs', A0='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', TZ='bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu';
      let [a,c,o,d]=await RF('abandon '.repeat(11)+'?'); ok(/^128 words fit at position 12 of this 12-word phrase/.test(a)&&/ok/.test(c)&&d==='block'&&o.split(/\s+/).length===128&&/(^|\s)about(\s|$)/.test(o),'Reforge: 11 words and ? list the 128 possible last words (what Find the last word did)');
      [a,c,o,d]=await RF('abandon '.repeat(23)+'?'); ok(/^8 words fit at position 24 of this 24-word phrase/.test(a)&&/(^|\s)art(\s|$)/.test(o),'Reforge: 23 words and ? list the 8 possible last words');
      [a,c,o,d]=await RF('abandon abandon abandon zoo abandon abandon abandon abandon abandon abandon abandon about',ZP); ok(/^FOUND and confirmed: this phrase gives the zpub zpub6rFR7y4Q\.\.\., without a passphrase/.test(a)&&/ok/.test(c)&&d==='block'&&/matches the account key m\/84'\/0'\/0'\. Changed: word 4 \(zoo\) is abandon\./.test(o)&&/12\. about/.test(o),'Reforge: a wrong word is found and confirmed by the zpub, and the change is shown');
      [a,c,o,d]=await RF('abandon '.repeat(10)+'about abandon',A0); ok(/^FOUND and confirmed/.test(a)&&/receive address #0 \(m\/84'\/0'\/0'\/0\/0\)/.test(o)&&/word 11 \(about\) is abandon; word 12 \(abandon\) is about/.test(o),'Reforge: two swapped words are found by an address');
      [a,c,o,d]=await RF('abandon '.repeat(10)+'abou',A0); ok(/^FOUND and confirmed/.test(a)&&/the missing word is word \d+, abandon/.test(o)&&/read word 11 'abou' as 'about'/.test(a),'Reforge: a missing word at an unknown place is found, and a 4-letter word is read');
      [a,c,o,d]=await RF('abandon '.repeat(11)+'?',TZ,'TREZOR'); ok(/^FOUND and confirmed.*with the passphrase you typed/.test(a)&&/12\. about/.test(o),'Reforge: the passphrase is used (published TREZOR vector)');
      [a,c,o,d]=await RF('abandon '.repeat(11)+'?','73c5da0a'); ok(/^FOUND one phrase with the master fingerprint 73c5da0a, without a passphrase, after comparing all 128 valid phrases/.test(a)&&/about 1 in 33,554,432/.test(a)&&/check an address with it/.test(a),'Reforge: a fingerprint match says how likely a coincidence is and asks for an address check');
      [a,c,o,d]=await RF('abandon '.repeat(11)+'?',TZ); ok(/^NOT FOUND\. None of the 128 valid phrases \(every word at position 12\) gives the address bc1qv5rmq/.test(a)&&/without a passphrase/.test(a)&&/receive addresses 0 to 9 of account 0/.test(a)&&/bad/.test(c)&&o===''&&d==='none','Reforge: says NOT FOUND, and exactly what it searched, when nothing matches');
      [a]=await RF(AB,A0.slice(0,-1)+'v'); ok(/^That address has a typo/.test(a),'Reforge: an address with a typo is refused before any search');
      [a]=await RF(AB,'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'); ok(/is not an account key \(it is 0 levels deep, not 3\)/.test(a),'Reforge: a master xpub (not an account key) is refused with the reason');
      [a]=await RF(AB,'hello'); ok(/^Check against: type a master fingerprint/.test(a),'Reforge: an unreadable check value is refused');
      [a]=await RF(AB); ok(/as typed have a valid checksum \(that alone does not prove they are your words\)/.test(a)&&/needs something to check against/.test(a),'Reforge: a full phrase with nothing to check against says its checksum is valid');
      [a]=await RF('abandon '.repeat(11)+'zoo'); ok(/as typed do NOT have a valid checksum/.test(a),'Reforge: ... and says so when the checksum is wrong');
      [a]=await RF('? ? ? '+'abandon '.repeat(9)); ok(/at most 2 unknown words, and 3 are unknown \(1, 2, 3\)/.test(a),'Reforge: refuses 3 unknown words, saying which');
      [a]=await RF('abandon '.repeat(10)); ok(/^Type 12, 15, 18, 21 or 24 words .*You typed 10\./.test(a),'Reforge: rejects a word count it cannot search');
      [a]=await RF('abandon '.repeat(11)); ok(/missing word at an unknown place/.test(a)&&/type \? at the end instead/.test(a),'Reforge: 11 words with nothing to check against explain the ? for a last word');
      [a]=await RF('? ? '+'abandon '.repeat(10)); ok(/^Two unknown words give about 262,144 valid phrases, too many to list/.test(a),'Reforge: two unknown words need something to check against');
      [a]=await RF('abandon '.repeat(10)+'? ?','',''); ok(/too many to list/.test(a),'Reforge: ... also when one of them is the last word');
      [a]=await RF('aban '.repeat(11)+'abou'); ok(/12 words were read from their first letters \(for example word 1 'aban' as 'abandon'\)/.test(a),'Reforge: reads 4-letter backups');
      [a,c,o]=await RF('abandon abandon constructor '+'abandon '.repeat(8)+'about'); ok(/fit at position 3/.test(a)&&/word 3 'constructor' is not a BIP39 word, so it is treated as unknown/.test(a),'Reforge: a typed word that is not on the list becomes unknown (even an object property name)');
      ok(!t.$('reforgeWordsBtn').disabled&&t.$('reforgeStopBtn').disabled,'Reforge: SEARCH is ready and STOP is off when no search runs');
      await RF('abandon '.repeat(11)+'?'); t.$('reforgeWordsInput').dispatchEvent(new t.w.Event('input')); ok(t.$('reforgeOut').textContent===''&&t.$('reforgeOut').style.display==='none'&&t.$('reforgeStatus').textContent==='','Reforge: editing the words clears the result');
      await RF('abandon '.repeat(11)+'?'); t.$('reforgeWordsPass').dispatchEvent(new t.w.Event('input')); ok(t.$('reforgeOut').textContent==='','Reforge: editing the passphrase clears the result');
      { t.$('reforgeWordsInput').value='? '+'abandon '.repeat(10)+'?'; t.$('reforgeWordsCheck').value=ZP; t.$('reforgeWordsPass').value='';
        const run=t.w.reforgeWords(); await new Promise(r=>setTimeout(r,300)); const busy=t.$('reforgeWordsBtn').disabled&&!t.$('reforgeStopBtn').disabled; t.w.reforgeStop(); await run;
        ok(busy&&/^STOPPED in step 1 after checking [\d,]+ of 4,194,304 phrases; nothing was compared yet\. The search is NOT complete and found nothing so far\./.test(t.$('reforgeStatus').textContent)&&!t.$('reforgeWordsBtn').disabled&&t.$('reforgeStopBtn').disabled,'Reforge: STOP ends a long search and says it is not complete'); }
      await RF('abandon abandon abandon zoo abandon abandon abandon abandon abandon abandon abandon about',ZP,'x'); t.w.reforgeClear(); ok(['reforgeWordsInput','reforgeWordsCheck','reforgeWordsPass'].every(id=>t.$(id).value==='')&&t.$('reforgeOut').textContent===''&&t.$('reforgeStatus').textContent==='','Reforge: CLEAR empties the words, check value, passphrase and result');
      t.$('reforgeWordsInput').value='abandon'; const pr=t.w.document.querySelector('input[name="reforgeMode"][value="pass"]'); pr.checked=true; t.w.reforgeModeChange(); ok(t.$('reforgeWordsPanel').style.display==='none'&&t.$('reforgePassPanel').style.display==='', 'Reforge: the Passphrase mode shows its own panel');
      t.w.document.querySelector('input[name="reforgeMode"][value="words"]').checked=true; t.w.reforgeModeChange(); t.$('reforgeWordsInput').value=''; }
    { const RP=async(x,pieces,chk,typo)=>{ t.$('reforgePassWords').value=x; t.$('reforgePassInput').value=pieces; t.$('reforgePassCheck').value=chk||''; t.$('reforgePassTypos').checked=!!typo; await t.w.reforgePassphrase(); return [t.$('reforgeStatus').textContent,t.$('reforgeStatus').className,t.$('reforgeOut').textContent]; };
      const AB='abandon '.repeat(11)+'about', TZ='bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu', A0='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
      let [a,c,o]=await RP(AB,'trezor',TZ); ok(/^FOUND and confirmed: the passphrase below, with these words, gives the address bc1qv5rmq/.test(a)&&/ok/.test(c)&&/^“TREZOR”  matches the receive address #0 \(m\/84'\/0'\/0'\/0\/0\)\./.test(o)&&/capitals and any spaces count/.test(o),'Reforge passphrase: the UPPERCASE form of a guess is found (published TREZOR vector)');
      [a,c,o]=await RP(AB,'tre\nzor',TZ); ok(/^“TREZOR”/.test(o),'Reforge passphrase: two pieces are joined');
      [a,c,o]=await RP(AB,'  trezor ',TZ); ok(/^“TREZOR”/.test(o),'Reforge passphrase: a line with spaces at its ends is also tried without them');
      [a,c,o]=await RP(AB,'TREZRO',TZ,true); ok(/^“TREZOR”/.test(o),'Reforge passphrase: one typo (two letters swapped) is found when one typo is ticked');
      [a,c,o]=await RP(AB,'TREZRO',TZ); ok(/^NOT FOUND\. None of the 4 passphrases tried \(no passphrase, your lines alone and joined in twos and threes, in four letter cases\) gives the address/.test(a)&&/or tick one typo\./.test(a)&&/bad/.test(c)&&o==='','Reforge passphrase: ... and not without it, and NOT FOUND says what was tried');
      [a,c,o]=await RP(AB,'anything',A0); ok(/^FOUND and confirmed: these words with NO passphrase give the address bc1qcr8/.test(a)&&/^\(no passphrase\)  matches/.test(o),'Reforge passphrase: says plainly when the wallet uses no passphrase');
      [a]=await RP(AB,'trezor','73c5da0a'); ok(/^FOUND: these words with NO passphrase give the master fingerprint 73c5da0a, after trying all 4\./.test(a)&&/about 1 in 1,073,741,824\)/.test(a),'Reforge passphrase: a fingerprint search tries everything and gives the odds');
      [a]=await RP('aban '.repeat(11)+'abou','trezor',TZ); ok(/^FOUND and confirmed/.test(a)&&/12 words were read from their first letters/.test(a),'Reforge passphrase: the words may be 4-letter forms');
      [a]=await RP(AB.replace('about','zoo'),'trezor',TZ); ok(/^Type all 12, 15, 18, 21 or 24 of your seed words first, as a valid phrase\. Reforge cannot search for wrong words and an unknown passphrase at the same time/.test(a),'Reforge passphrase: needs the full, valid phrase');
      [a]=await RP(AB,'',TZ); ok(/^Type at least one passphrase guess or piece/.test(a),'Reforge passphrase: needs at least one guess');
      [a]=await RP(AB,'trezor',''); ok(/^Reforge needs something to check each passphrase against/.test(a),'Reforge passphrase: needs something to check against');
      [a]=await RP(AB,Array.from({length:21},(_,i)=>'p'+i).join('\n'),TZ); ok(/^Type at most 20 lines; you typed 21\./.test(a),'Reforge passphrase: at most 20 lines');
      [a]=await RP(AB,Array.from({length:20},(_,i)=>'piece'+i).join('\n'),TZ,true); ok(/^That gives more than 1,000,000 passphrases to try, too many for a browser\. Use fewer lines or untick one typo\./.test(a),'Reforge passphrase: refuses more than 1,000,000 tries, before starting');
      { // the candidate list, against an independent re-implementation of the documented rules
        const pieces=['ab','Cd',' e '], F=(x)=>{ const r=[]; for(const y of x.trim()!==x?[x,x.trim()]:[x]){ const l=y.toLowerCase(); r.push(y,l,y.toUpperCase(),l.charAt(0).toUpperCase()+l.slice(1)); } return r; };
        const want=new Set(['']), B=[...pieces]; for(const a1 of pieces) for(const b1 of pieces) if(a1!==b1) for(const sp of ['',' ']) B.push(a1+sp+b1);
        for(const a1 of pieces) for(const b1 of pieces) for(const c1 of pieces) if(a1!==b1&&a1!==c1&&b1!==c1) for(const sp of ['',' ']) B.push(a1+sp+b1+sp+c1);
        B.forEach(b1=>F(b1).forEach(f=>want.add(f))); const got=t.w.reforgePassCandidates(pieces.join('\n'),false);
        ok(got.length===want.size&&got.every(x=>want.has(x))&&got[0]===''&&got[1]==='ab','Reforge passphrase: the guesses tried are exactly no passphrase, each line, pairs and triples, in four cases (independent re-implementation)');
        const T=new Set(want); for(const x of want){ const cc=Array.from(x); for(let i=0;i<cc.length;i++){ T.add(cc.slice(0,i).concat(cc.slice(i+1)).join('')); T.add(cc.slice(0,i+1).concat(cc.slice(i)).join('')); if(i+1<cc.length) T.add(cc.slice(0,i).concat([cc[i+1],cc[i]],cc.slice(i+2)).join('')); const fl=cc[i]===cc[i].toLowerCase()?cc[i].toUpperCase():cc[i].toLowerCase(); T.add(cc.slice(0,i).concat([fl],cc.slice(i+1)).join('')); } }
        const gt=t.w.reforgePassCandidates(pieces.join('\n'),true); ok(gt.length===T.size&&gt.every(x=>T.has(x)),'Reforge passphrase: with one typo, exactly each guess with one character missing, doubled, swapped or in the other case is added'); }
      { t.$('reforgePassWords').value=AB; t.$('reforgePassInput').value=Array.from({length:20},(_,i)=>'w'+i).join('\n'); t.$('reforgePassCheck').value='73c5da0a'; t.$('reforgePassTypos').checked=false;
        const run=t.w.reforgePassphrase(); await new Promise(r=>setTimeout(r,400)); const busy=t.$('reforgePassBtn').disabled&&!t.$('reforgePassStopBtn').disabled&&t.$('reforgeWordsBtn').disabled; t.w.reforgeStop(); await run;
        ok(busy&&/^FOUND: these words with NO passphrase|^STOPPED after trying [\d,]+ of 43,361 passphrases\. The search is NOT complete/.test(t.$('reforgeStatus').textContent)&&!t.$('reforgePassBtn').disabled&&t.$('reforgePassStopBtn').disabled,'Reforge passphrase: STOP ends a long search and says it is not complete'); }
      await RP(AB,'trezor',TZ); t.$('reforgePassInput').dispatchEvent(new t.w.Event('input')); ok(t.$('reforgeOut').textContent===''&&t.$('reforgeStatus').textContent==='','Reforge passphrase: editing the guesses clears the result');
      await RP(AB,'trezor',TZ,true); t.w.reforgeClear(); ok(['reforgePassWords','reforgePassInput','reforgePassCheck'].every(id=>t.$(id).value==='')&&!t.$('reforgePassTypos').checked&&t.$('reforgeOut').textContent==='','Reforge passphrase: CLEAR empties the words, guesses, check value and the typo box'); }
    { const P1="cHNidP8BAHECAAAAAaurq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urAgAAAAD/////AqCGAQAAAAAAFgAU1L4sXWjQfnhBc67qrnReNudrsjoIRgIAAAAAABYAFKPGse5KSdnyrzs4ApdHRPupJBZKAAAAAAABAR+Q0AMAAAAAABYAFJ1pVHSjA6xtdNF5bTdS8HiVkYvSAAAiAgKYnAt2y1Y5cf3JvvMewGw1YPMknW7p5dg8V2JVluBfbxhPv3VmVAAAgAAAAIAAAACAAQAAAAMAAAAA", P2="cHNidP8BAFUCAAAAARhB+qPFBDEXmeBmw7H0eMAxgXzTM6d5etkICbpnLkhZAQAAAAD/////ASC/AgAAAAAAGXapFA7T+zB3AaajntisR/jg/BhY0ZpQiKwAAAAAAAEAdwIAAAABzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc0AAAAAAP////8C4JMEAAAAAAAZdqkUHP7zVxqtW/FhdOnTmSitGlcWdpOIrDDmAgAAAAAAGXapFGcMqnnlHXjtDFg7if852cSbcZnniKwAAAAAAAA=";
      const PS=async(x)=>{ t.$('psbtInput').value=x; await t.w.runPsbt(); return [t.$('psbtStatus').textContent,t.$('psbtStatus').className,t.$('psbtOut').textContent,t.$('psbtOut').style.display]; };
      let [a,c,o,d]=await PS(P1); ok(/^Read OK/.test(a)&&/ok/.test(c)&&d==='block'&&/INPUT 0: 0\.00250000 BTC \(250000 sats\)/.test(o)&&/OUTPUT 0: 0\.00100000 BTC/.test(o)&&/OUTPUT 1: 0\.00149000 BTC/.test(o)&&/FEE: 0\.00001000 BTC \(1000 sats\)/.test(o),'PSBT inspector shows inputs, outputs and fee');
      ok(/coin abababababababababababababababababababababababababababababababab:2/.test(o)&&/finalized|0 signatures so far/.test(o),'PSBT inspector shows the coin being spent and the signature state');
      ok(/OUTPUT 1:[\s\S]*fingerprint 4fbf7566[\s\S]*change/.test(o)&&/OUTPUT 0:[\s\S]*no wallet key information/.test(o),'PSBT inspector marks the output with wallet key information as likely change');
      { const bin=Buffer.from(P1,'base64'); [a,c,o]=await PS(bin.toString('hex')); ok(/^Read OK/.test(a)&&/FEE: 0\.00001000 BTC/.test(o),'PSBT inspector accepts hex too'); }
      [a,c,o,d]=await PS(P2); ok(/INPUT 0: 0\.00190000 BTC/.test(o)&&/FEE: 0\.00010000 BTC/.test(o)&&/from 1[1-9A-HJ-NP-Za-km-z]+/.test(o),'PSBT inspector reads the amount from a full previous transaction (legacy input)');
      [a,c,o,d]=await PS('not a psbt!!'); ok(/Paste the PSBT as base64/.test(a)&&/bad/.test(c)&&d==='none','PSBT inspector rejects text that is not a PSBT');
      [a,c,o,d]=await PS(Buffer.from('hello world, this is not psbt').toString('base64')); ok(/not a PSBT/.test(a)&&d==='none','PSBT inspector rejects data without the PSBT marker');
      [a,c,o,d]=await PS(P1.slice(0,60)); ok(/cut short|damaged|No unsigned/.test(a)&&/bad/.test(c)&&d==='none','PSBT inspector rejects a cut-off PSBT');
      t.$('psbtNet').value='test'; [a,c,o]=await PS(P1); ok(/to tb1q/.test(o),'PSBT inspector shows testnet addresses when Testnet is chosen'); t.$('psbtNet').value='main';
      await PS(P1); t.$('psbtInput').dispatchEvent(new t.w.Event('input')); ok(t.$('psbtOut').textContent===''&&t.$('psbtStatus').textContent==='','editing the PSBT clears the report');
      { const F=new t.w.File([Buffer.from(P1,'base64')],'a.psbt'); await t.w.onPsbtFile(F); ok(/^Read OK/.test(t.$('psbtStatus').textContent)&&/FEE: 0\.00001000 BTC/.test(t.$('psbtOut').textContent),'PSBT inspector reads a .psbt file'); }
      { const F=new t.w.File([P1],'b.txt'); await t.w.onPsbtFile(F); ok(/^Read OK/.test(t.$('psbtStatus').textContent),'PSBT inspector reads a text file holding base64'); }
      { const CM=async(x,y)=>{ t.$('cmpA').value=x; t.$('cmpB').value=y; await t.w.runCompare(); return [t.$('cmpStatus').textContent,t.$('cmpStatus').className,t.$('cmpOut').textContent,t.$('cmpOut').style.display]; };
        let [a2,c2,o2,d2]=await CM(P1,P1); ok(/^Compared/.test(a2)&&/ok/.test(c2)&&d2==='block'&&/SIGNER CHECK: unchanged/.test(o2)&&/transaction ID is the same/.test(o2),'compare: the same transaction twice is reported unchanged');
        [a2,c2,o2,d2]=await CM(P1,P2); ok(/DIFFERENT/.test(o2)&&/does not spend any of the same coins/.test(o2)&&/does NOT look like a plain fee bump/.test(o2),'compare: two unrelated transactions are reported as changed, not a fee bump');
        [a2,c2,o2,d2]=await CM('not a psbt!!',P1); ok(/^First transaction: /.test(a2)&&/bad/.test(c2)&&d2==='none','compare: a bad first transaction is named');
        [a2,c2,o2,d2]=await CM(P1,P1.slice(0,60)); ok(/^Second transaction: /.test(a2)&&/bad/.test(c2)&&d2==='none','compare: a bad second transaction is named');
        await CM(P1,P1); t.$('cmpB').dispatchEvent(new t.w.Event('input')); ok(t.$('cmpOut').textContent===''&&t.$('cmpStatus').textContent==='','compare: editing a box clears the result');
        await CM(P1,P1); t.$('cmpA').dispatchEvent(new t.w.Event('input')); ok(t.$('cmpOut').textContent==='','compare: editing the first box clears the result');
        t.w.clearCompare(true); ok(t.$('cmpA').value===''&&t.$('cmpB').value===''&&t.$('cmpOut').textContent==='','compare: CLEAR empties both boxes and the result'); }
      t.w.clearPsbt(true); ok(t.$('psbtInput').value===''&&t.$('psbtOut').textContent==='','CLEAR empties the PSBT box and report'); }
    ok(/without warranty/.test(t.$('disclaimer').textContent)&&/Lost words or passphrase mean lost funds/.test(t.$('disclaimer').textContent)&&/provided &ldquo;as is&rdquo;|provided \u201cas is\u201d/.test(t.w.document.body.innerHTML.replace(/&ldquo;|&rdquo;/g,'\u201c')),'disclaimer is shown under the top warning and in Security notes');
    await new Promise(r=>setTimeout(r,50));
    { const before=t.$('fpIcon').innerHTML; await t.w.sendToVerify(); await new Promise(r=>setTimeout(r,80));
      ok(before.length>100&&t.$('fpIcon').innerHTML===before,'master fingerprint picture stays after SEND TO CHECK / VERIFY (verify used to wipe it)');
      ok(!!t.$('vIcon0').querySelector('svg'),'verify draws its own fingerprint picture'); }
    { const ic=t.$('fpIcon'); ok(!!ic.querySelector('svg')&&ic.querySelectorAll('rect').length>32&&!/https?:|xmlns/.test(ic.innerHTML),'fingerprint picture (LifeHash) is drawn next to the fingerprint, with no URL or namespace in the markup'); }
    { t.w.showQr('wZpub','zpub'); const img=t.$('qrImg'); ok(t.$('qrBox').style.display===''&&img.querySelector('svg')&&img.querySelector('svg path')&&/QR code for the zpub/.test(t.$('qrCaption').textContent)&&!/https?:|xmlns/.test(img.innerHTML),'SHOW QR draws a QR code for the zpub with no URL or namespace in the markup');
      t.w.hideQr(); ok(t.$('qrBox').style.display==='none'&&t.$('qrImg').innerHTML==='','HIDE QR removes the code');
      t.w.showQr('wDescC','change descriptor'); ok(!!t.$('qrImg').querySelector('svg'),'QR code for the change descriptor also draws'); }
    const st=t.$('genResult').textContent; t.$('passphrase').value='x'; t.$('passphrase2').value=''; await t.w.generate(); ok(/do not match/.test(t.$('genResult').textContent),'passphrase vs empty confirm is a mismatch');
    t.$('passphrase').value=''; t.$('passphrase2').value='';
    t.$('phrase').value='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'; await t.w.verify();
    ok(/bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/.test(t.$('verifyStatus').textContent),'VERIFY shows the published BIP84 first address for abandon...about');
    // VERIFY with and without a passphrase
    t.$('verifyPass').value='TREZOR'; await t.w.verify(); { const vs=t.$('verifyStatus').textContent;
      ok(/Without passphrase: fingerprint 73c5da0a \| first address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/.test(vs),'VERIFY shows the without-passphrase fingerprint and address');
      ok(/With passphrase \(6 characters, not shown\): fingerprint b4e3f5ed \| first address bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu/.test(vs)&&!vs.includes('TREZOR'),'VERIFY shows the with-passphrase fingerprint and address without revealing the passphrase'); }
    t.$('verifyPass').value=''; await t.w.verify(); ok(/No passphrase entered/.test(t.$('verifyStatus').textContent)&&!/With passphrase/.test(t.$('verifyStatus').textContent),'VERIFY without a passphrase says none was entered');
    // match a recorded fingerprint/address against with / without passphrase
    { const M=async(rec,pw)=>{ t.$('verifyPass').value=pw; t.$('verifyRecorded').value=rec; await t.w.verify(); return t.$('verifyMatch').textContent; };
      ok(/^MATCH \(without passphrase\)/.test(await M('73c5da0a','')),'recorded fingerprint without passphrase -> MATCH (without)');
      ok(/^MATCH \(with passphrase\)/.test(await M('b4e3f5ed','TREZOR')),'recorded fingerprint with passphrase -> MATCH (with)');
      ok(/^MATCH \(with passphrase\)/.test(await M('BC1QV5RMQ0KT9YZ3PM36WVZCT7P3X6MTGEHJUL0FEU ','TREZOR')),'recorded address (upper case, spaces) with passphrase -> MATCH (with)');
      ok(/^MATCH \(without passphrase\)/.test(await M('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu','TREZOR')),'recorded no-passphrase address still matches (without) when a passphrase is typed');
      ok(/^NO MATCH:/.test(await M('deadbeef','TREZOR')),'recorded value matching neither -> NO MATCH');
      ok(/^NO MATCH without a passphrase/.test(await M('b4e3f5ed',''))&&/type it in the passphrase box/.test(t.$('verifyMatch').textContent),'with-passphrase backup but no passphrase typed -> asks for the passphrase');
      ok(/^Not recognized/.test(await M('hello','')),'garbage recorded value -> not recognized');
      eq(await M('','TREZOR'),'','empty recorded box shows no match line'); }
    t.$('verifyRecorded').value='';
    t.$('verifyPass').value='TREZOR'; t.w.toggleVerifyPassphrase(t.d.querySelector('button[onclick^="toggleVerifyPassphrase"]')); ok(t.$('verifyPass').type==='text','VERIFY passphrase SHOW toggle works'); t.w.toggleVerifyPassphrase(t.d.querySelector('button[onclick^="toggleVerifyPassphrase"]'));
    t.$('verifyPass').value='';
    t.$('rolls').value=''; t.w.updateCount();
    const taps=[...t.d.querySelectorAll('#tapRow button')]; ok(taps.length===6,'six dice tap buttons in dice mode');
    ok(taps.every((b,i)=>b.querySelectorAll('svg circle').length===i+1&&b.textContent.trim()===String(i+1)),'each dice button draws a face with the right number of pips and shows its number');
    ok(taps.length===6&&taps.every((b,i)=>{ const r=b.querySelector('svg rect'), c=[...b.querySelectorAll('svg circle')]; return r&&/fill:var\(--surface\)/.test(r.getAttribute('style'))&&/stroke:var\(--accent\)/.test(r.getAttribute('style'))&&c.length===i+1&&c.every(x=>/fill:var\(--accent\)/.test(x.getAttribute('style'))); }),'dice buttons: unchanged outline die with accent pips');
    taps[0].onclick(); taps[5].onclick(); taps[2].onclick(); eq(t.$('rolls').value,'163','tap buttons append rolls and update the counter'); ok(/3 \/ 50/.test(t.$('rollCount').textContent),'counter updates after taps');
    const coin=t.d.querySelector('input[name="mode"][value="coin"]'); t.$('rolls').value=''; coin.checked=true; t.w.onModeChange();
    const ct=[...t.d.querySelectorAll('#tapRow button')]; ok(ct.length===2&&ct[0].dataset.v==='1'&&ct[1].dataset.v==='0'&&/HEADS/.test(ct[0].textContent)&&/TAILS/.test(ct[1].textContent),'coin mode shows 1 and 0 tap buttons');
    ok(!!ct[0].querySelector('svg g.btc')&&ct[0].querySelectorAll('svg g.btc path').length===2&&!ct[0].querySelector('svg g.sat')&&!!ct[1].querySelector('svg g.sat')&&ct[1].querySelectorAll('svg g.sat rect').length===5&&ct[0].querySelector('svg g.btc').getAttribute('stroke-width')==='7'&&[...ct[1].querySelectorAll('svg g.sat rect')].every(r=>Math.min(+r.getAttribute('width'),+r.getAttribute('height'))===7)&&/rotate\(10 /.test(ct[0].querySelector('svg g.btc').getAttribute('transform'))&&/rotate\(10 /.test(ct[1].querySelector('svg g.sat').getAttribute('transform'))&&!ct.some(b=>b.querySelector('svg text, radialGradient')),'coin faces: heads shows the Bitcoin sign, tails shows the sat sign, same line thickness, both tilted the same way, flat gold with no gradient or letters');
    ct[1].onclick(); ct[0].onclick(); eq(t.$('rolls').value,'01','coin taps append flips');
    const dice=t.d.querySelector('input[name="mode"][value="dice"]'); t.$('rolls').value=''; dice.checked=true; t.w.onModeChange();
    t.$('passphrase').value='a'; t.$('passphrase2').value='a'; t.w.togglePassphrase(t.d.querySelector('button[onclick^="togglePassphrase"]')); ok(t.$('passphrase').type==='text'&&t.$('passphrase2').type==='text','SHOW reveals both passphrase boxes');
  }
  // v1.5.0: layout and clarity
  { t.set('65515223131652132161133154444123616466443112153441'); t.$('passphrase').value=''; t.$('passphrase2').value=''; await t.w.generate();
    const cells=[...t.d.querySelectorAll('#wordGrid .wcell')];
    ok(cells.length===12&&cells[0].textContent==='1.hole'&&cells[11].textContent==='12.path'&&t.$('wordGrid').style.display==='grid','seed words show as a numbered grid');
    ok(t.$('genResult').classList.contains('sr')&&t.$('genResult').dataset.seed==='1','plain-text result is kept (screen-reader only) and flagged as a seed');
    ok(/Passphrase: none/.test(t.$('passNote').textContent)&&/Write these 12 words down in order/.test(t.$('nextStep').textContent),'visible passphrase note and next-step line');
    // mismatch: error shown, grid hidden, advanced opens, error text is NOT treated as a seed
    t.$('advanced').open=false; t.$('passphrase').value='a'; t.$('passphrase2').value='b'; t.w.updateAdvSummary(); await t.w.generate();
    ok(t.$('genResult').dataset.seed==='1'&&/PASSPHRASE SET/.test(t.$('advSummary').textContent)&&/do not match/.test(t.$('passNote').textContent)&&!/[0-9a-f]{8}/.test(t.$('fingerprint').textContent),'mismatch: the words show, the passphrase note says the boxes do not match, no fingerprint, and the box is flagged');
    t.st.alerts.length=0; await t.w.sendToVerify(); t.w.printSeed(); t.w.downloadSeed();
    ok(t.st.alerts.length===2&&t.st.alerts.every(m=>/do not match/.test(m)),'after a mismatch PRINT and DOWNLOAD refuse (SEND TO CHECK still sends the words, which do not depend on the passphrase)');
    t.$('passphrase').value=''; t.$('passphrase2').value=''; t.w.updateAdvSummary(); ok(!/PASSPHRASE SET/.test(t.$('advSummary').textContent),'advanced summary flag clears');
    t.$('rolls').value='123'; t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent,'Enter 47 more rolls (3 of 50).','too few rolls: plain message');
    // v2.3.0: more than the minimum is allowed and every roll is hashed (as Coldcard does); expected words from Node's SHA-256 and the BIP39 list
    { const WL=t.w.eval('WORDLIST'), bits=b=>[...b].map(x=>x.toString(2).padStart(8,'0')).join('');
      const mnFrom=(rolls,wc)=>{ const ent=nc.createHash('sha256').update(rolls).digest().subarray(0,wc===24?32:16), cs=bits(nc.createHash('sha256').update(ent).digest()).slice(0,ent.length/4); return (bits(ent)+cs).match(/.{11}/g).map(b=>WL[parseInt(b,2)]).join(' '); };
      const R53=rnd(53,6); t.$('rolls').value=R53; t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent.split('\n')[0],mnFrom(R53,12),'more rolls than needed: 53 rolls make 12 words from the SHA-256 of all 53');
      ok(/^Every roll counts: all 53 are hashed\. Coldcard makes the same words from these rolls; SeedSigner takes exactly 50, so it would make different words\.$/.test(t.$('countNote').textContent),'more rolls: the note says every roll counts, Coldcard matches and SeedSigner does not');
      const R50=rnd(50,6); t.$('rolls').value=R50; t.w.updateCount(); ok(t.$('countNote').textContent==='Exactly 50 rolls: SeedSigner and Coldcard make the same words from these rolls.','exactly the minimum: the note says SeedSigner and Coldcard match');
      t.$('rolls').value=R50.slice(0,49); t.w.updateCount(); ok(t.$('countNote').textContent==='','below the minimum: no note');
      t.$('rolls').value=rnd(100,6); t.w.updateCount(); ok(!/twice/.test(t.$('countNote').textContent),'twice the minimum exactly: no double-paste note');
      t.$('rolls').value=rnd(101,6); t.w.updateCount(); ok(/all 101 are hashed\..* That is more than twice the 50 needed: fine if you rolled them all, but if you pasted them, check nothing went in twice\.$/.test(t.$('countNote').textContent),'more than twice the minimum: a gentle double-paste note');
      t.words(24); const R140=rnd(140,6); t.$('rolls').value=R140; t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent.split('\n')[0],mnFrom(R140,24),'more rolls: 140 rolls make 24 words from the SHA-256 of all 140');
      ok(/SeedSigner takes exactly 99/.test(t.$('countNote').textContent)&&/dice rolls or more$/.test(t.$('lenNote').textContent)&&/^99 dice rolls or more$/.test(t.$('lenNote').textContent),'24 words: the note and the length line say 99 or more');
      t.mode('coin'); const C130=rnd(130,2); t.words(12); t.$('rolls').value=C130; t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent.split('\n')[0],mnFrom(C130,12),'more flips: 130 flips make 12 words from the SHA-256 of all 130');
      ok(t.$('countNote').textContent==='Every flip counts: all 130 are hashed. SeedSigner\'s coin-flip code takes exactly 128 flips, so it would make different words.','more flips: the note names SeedSigner\'s coin-flip code only (Coldcard has no coin mode)');
      t.$('rolls').value=rnd(128,2); t.w.updateCount(); ok(t.$('countNote').textContent==='Exactly 128 flips: the same SHA-256 method as SeedSigner\'s coin-flip code (its device menus make seeds from dice).'&&t.$('lenNote').textContent==='128 coin flips or more','exactly 128 flips: SeedSigner matches');
      t.$('rolls').value=rnd(257,2); t.w.updateCount(); ok(/more than twice the 128 needed: fine if you flipped them all/.test(t.$('countNote').textContent),'more than twice the flips: the double-paste note says flipped');
      t.mode('dice'); t.words(12); t.$('rolls').value=''; t.w.updateCount(); ok(/You need at least <b id="gNeed">50<\/b> <span id="gUnit">rolls<\/span>; more are fine, and every one counts\./.test(html),'guide: at least 50, more are fine'); }
    t.$('rolls').value='1'.repeat(49); t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent,'Enter 1 more roll (49 of 50).','one roll short: singular');

    // roll chart: counts per face, display only
    t.$('rolls').value=''; t.w.updateCount(); eq(t.$('rollChart').style.display,'none','chart hidden when empty');
    t.$('rolls').value='1122223 6x6 6'; t.w.updateCount();
    const nums=[...t.$('rollChart').querySelectorAll('.rc-num')].map(e=>e.textContent).join(',');
    eq(nums,'2,4,1,0,0,3','chart counts per dice face (1..6), ignoring invalid characters');
    eq(t.$('rollChart').querySelectorAll('.rc-bar').length,6,'chart has six bars for dice');
    eq(t.$('rollChart').querySelectorAll('img,script,a').length,0,'chart contains no images, scripts or links');
    // five addresses, 4-letter view, guide
    t.$('rolls').value='65515223131652132161133154444123616466443112153441'; t.w.updateCount(); await t.w.generate();
    eq(t.$('addrList').querySelectorAll('li').length,5,'five receive addresses are listed after FORGE');
    ok(t.$('addrList').querySelector('li').textContent===/First receive address[^:]*: (bc1[0-9a-z]+)/.exec(t.$('address').textContent)[1],'first listed address equals the single first-address line');
    eq(t.$('addrBox').style.display,'','address list is shown after FORGE');
    { const tr=[...t.$('trList').querySelectorAll('li')].map(x=>x.textContent);
      ok(tr.length===5&&tr.every(x=>/^bc1p[0-9a-z]{58}$/.test(x))&&new Set(tr).size===5,'five distinct Taproot (bc1p) addresses are listed after FORGE');
      eq(t.$('trBox').style.display,'','Taproot list is shown after FORGE'); }
    eq(t.$('checkGuide').style.display,'','second-tool guide is shown after FORGE');
    const full=[...t.$('wordGrid').querySelectorAll('.wtxt')].map(e=>e.textContent);
    t.w.toggleAbbr();
    const abbr=[...t.$('wordGrid').querySelectorAll('.wtxt')].map(e=>e.textContent);
    ok(abbr.every((a,i)=>a===full[i].slice(0,4)),'4-letter view shows only the first four letters of each word');
    ok(new Set(abbr).size===abbr.length,'4-letter abbreviations are all distinct in this phrase');
    eq(t.$('genResult').textContent.split('\n')[0],full.join(' '),'4-letter view does not change the stored phrase');
    t.w.toggleAbbr();
    ok([...t.$('wordGrid').querySelectorAll('.wtxt')].map(e=>e.textContent).join(' ')===full.join(' '),'toggling again restores the full words');
    t.w.clearAll(); eq(t.$('addrBox').style.display,'none','address list is hidden after CLEAR');
    ok(t.$('statusLine').contains(t.$('netTag'))&&t.$('statusLine').contains(t.$('selfTestBadge')),'network tag and self-test badge share one status line');
    ok(/^NETWORK: (ONLINE|OFFLINE)$/.test(t.$('netTag').textContent),'network tag is short');
    t.$('rolls').value=''; t.w.updateCount();
  }
  // v1.4.2: explicit passphrase line in print and download
  { t.set('65515223131652132161133154444123616466443112153441'); t.$('passphrase').value=''; t.$('passphrase2').value=''; await t.w.generate(); t.w.printSeed();
    ok(/Passphrase used: NO/.test(t.st.printHTML),'print says Passphrase used: NO when none');
    t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate(); t.w.printSeed();
    ok(/Passphrase used: YES/.test(t.st.printHTML)&&!t.st.printHTML.includes('SECRETPASS'),'print says Passphrase used: YES without printing it');
    t.w.downloadSeed(); const dtxt=await blobText(t.w,t.st.blob); ok(/Passphrase used: YES/.test(dtxt)&&!dtxt.includes('SECRETPASS'),'download says Passphrase used: YES without saving it');
    t.$('passphrase').value=''; t.$('passphrase2').value=''; }
  // item 1: patterns
  ok(t.$('noJs').style.display==='none','script-not-running notice is hidden once the script has run');
  ok(t.d.querySelector('#topbar h1').textContent==='VOIDFORGE'&&!t.d.querySelector('.subtitle'),'header: the name VOIDFORGE, no second subtitle line');
  ok(t.$('coinHint').style.display==='none','coin hint hidden in dice mode');
  { const coin=t.d.querySelector('input[name="mode"][value="coin"]'); coin.checked=true; t.w.onModeChange(); ok(t.$('coinHint').style.display==='block'&&/heads = 1/.test(t.$('coinHint').textContent),'coin mode shows which side is 1 and to record the string'); const dice=t.d.querySelector('input[name="mode"][value="dice"]'); dice.checked=true; t.w.onModeChange(); ok(t.$('coinHint').style.display==='none','coin hint hides again in dice mode'); }
  ok(/^NETWORK: (ONLINE|OFFLINE)/.test(t.$('netTag').textContent),'network tag is always visible');
  t.$('rolls').value='1'.repeat(0)+'123456'.repeat(8)+'12'; t.$('rolls').oninput();
  ok(/\u2248 129 bits/.test(t.$('bitsNote').textContent)&&/IF every roll was fair/.test(t.$('bitsNote').textContent),'bits note shows about 129 bits for 50 rolls with fairness caveat');
  t.$('rolls').value=''; t.$('rolls').oninput();
  ok(t.$('bitsNote').textContent==='','bits note empty with no input');
  const pat={'123456 repeated':['123456'.repeat(9),'dice'],'sorted blocks':['1'.repeat(10)+'2'.repeat(10)+'3'.repeat(10)+'4'.repeat(10),'dice'],'25x1+25x6':['1'.repeat(25)+'6'.repeat(25),'dice']};
  for(const [k,[v]] of Object.entries(pat)){ t.set(v); ok(/non-random/.test(t.$('entropyStatus').textContent),'pattern flagged: '+k); }
  t.set('65515223131652132161133154444123616466443112153441'); ok(/No obvious problems/.test(t.$('entropyStatus').textContent),'SeedSigner example input not flagged');
  t.set('1'.repeat(50)); t.$('forgeBtn').onclick=null; t.st.confirms=0;
  const tc=load({confirm:false}); await tc.ready(); tc.set('123456'.repeat(9).slice(0,50)); tc.d.querySelector('input[name=words][value="12"]').checked=true; await tc.w.generate();
  ok(tc.st.confirms===1&&tc.$('genResult').textContent==='—','FORGE on non-random input asks first and can be cancelled');
  // item 2: no crypto.subtle
  { const errs=[]; const dom=new (require('jsdom').JSDOM)(html,{runScripts:'dangerously',url:'https://x.org/',beforeParse(w){Object.defineProperty(w,'crypto',{value:{}});if(!w.TextEncoder)w.TextEncoder=TextEncoder;w.alert=m=>errs.push(m);w.addEventListener('error',e=>errs.push(e.message));}});
    await new Promise(r=>setTimeout(r,50)); const d=dom.window.document;
    ok(d.getElementById('fatalWarn').style.display==='block'&&d.getElementById('forgeBtn').disabled,'missing crypto.subtle: red banner shown, FORGE disabled');
    ok(!errs.some(e=>/Cannot read/.test(e)),'missing crypto.subtle: no uncaught exception'); }
  // item 3: failed self-test disables the tool (tamper the wordlist)
  { const bad=html.replace('"abandon","ability"','"abandon","abilityX"'); const dom=new (require('jsdom').JSDOM)(bad,{runScripts:'dangerously',url:'https://x.org/',beforeParse(w){Object.defineProperty(w,'crypto',{value:nc.webcrypto});if(!w.TextEncoder)w.TextEncoder=TextEncoder;w.alert=()=>{};}});
    await dom.window.selfTestDone; const d=dom.window.document;
    ok(/FAILED/.test(d.getElementById('selfTestBadge').textContent)&&d.getElementById('forgeBtn').disabled&&d.getElementById('verifyBtn').disabled,'tampered wordlist: self-test fails and tool is disabled'); }
  // item 4: ignored characters + mode switch
  t.set('1234 5670 89'); ok(/Ignored 4 invalid/.test(t.$('ignoredNote').textContent),'invalid characters are reported: '+t.$('ignoredNote').textContent);
  t.set('123456'); let c=t.d.querySelector('input[name=mode][value=coin]'); c.checked=true; c.onchange(); ok(t.$('rolls').value==='','mode switch clears entered rolls');
  const tm=load({confirm:false}); await tm.ready(); tm.set('123456'); c=tm.d.querySelector('input[name=mode][value=coin]'); c.checked=true; c.onchange();
  ok(tm.$('rolls').value==='123456'&&tm.d.querySelector('input[name=mode][value=dice]').checked,'cancelling a mode switch keeps rolls and mode');
  // item 5 & 6: CSP, no links
  ok(/Content-Security-Policy/.test(html)&&/default-src 'none'/.test(html),'CSP meta present with default-src none');
  { const anchors=html.replace(/const WORDLIST = \[.*?\];/s,'').match(/<a\s[^>]*>/gi)||[]; ok(anchors.length===1&&anchors[0]==='<a href="https://random21m.github.io/VOIDFORGE/" target="_blank" rel="noopener noreferrer">','page contains exactly one link: the online practice copy, opening in a new tab with noopener noreferrer'); }
  // v1.2: only 12/24 words, no copy-seed button
  eq([...t.d.querySelectorAll('input[name=words]')].map(e=>e.value).join(','),'12,24','only 12 and 24 word options are offered');
  ok(![...t.d.querySelectorAll('button')].some(b=>/COPY SEED/.test(b.textContent))&&typeof t.w.copyResult==='undefined','no copy-seed button or function');
  { const pb=t.$('privacyBox'); ok(!!pb&&/Privacy/.test(pb.querySelector('summary').textContent)&&pb.querySelectorAll('ul li').length===7&&!pb.querySelector('a,script,img,form,input'),'privacy box has seven points (one is the session note for the start notice) and no links or inputs');
    const keys=[...html.matchAll(/localStorage\.setItem\("([^"]+)"/g)].map(m=>m[1]).sort().join(',');
    ok(keys==='voidforge-big,voidforge-theme'&&/Only two things are remembered/.test(pb.textContent),'privacy box: the page stores exactly the theme and text size, as the box says');
    ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(html.replace(/const WORDLIST = \[.*?\];/s,'')),'privacy box: no network calls in the page'); }
  { const sb=t.$('safetyBox'); ok(!!sb&&/Browser safety checklist/.test(sb.querySelector('summary').textContent)&&sb.querySelectorAll('ol li').length===8&&!sb.querySelector('script,img,form,input')&&sb.querySelectorAll('a').length===1,'browser safety checklist has eight items and no links or inputs');
    ok(/offline/i.test(sb.querySelectorAll('ol li')[0].textContent)&&/clipboard/i.test(sb.textContent)&&/translation/i.test(sb.textContent)&&/restart/i.test(sb.textContent),'checklist covers going offline, clipboard, translation and restarting'); }
  { const B=t.d.body; if(!t.w.Element.prototype.scrollIntoView) t.w.Element.prototype.scrollIntoView=function(){};
    ok(!B.classList.contains('guided')&&!t.d.querySelector('.gh')&&/GUIDE ME/.test(t.$('guideBtn').textContent),'guide is off by default and hides nothing');
    t.w.toggleGuide(); t.w.guideStep(-4); ok(B.classList.contains('guided')&&t.$('rolls').classList.contains('gh')&&!t.$('wordRadios').classList.contains('gh'),'GUIDE ME shows one screen at a time');
    t.$('rolls').value=''; t.w.guideStep(1); ok(t.$('gNext').disabled,'guide: NEXT is locked until enough rolls');
    { const gx=t.$('gExit'); ok(!!gx&&t.$('guidePanel').contains(gx)&&/EXIT GUIDE/.test(gx.textContent)&&!gx.closest('.gstep')&&!gx.disabled,'guide: an EXIT GUIDE button sits in the always-visible top of the guide panel, not inside one step');
      for(const n of [1,2,3,4,5]){ t.w.guideN=n; t.w.guideRender(); ok(t.$('guidePanel').contains(gx)&&gx.offsetParent!==undefined&&!gx.closest('.gh'),'guide step '+n+': EXIT GUIDE is still there'); }
      t.w.guideN=3; t.w.guideRender(); gx.click(); ok(!B.classList.contains('guided')&&!t.d.querySelector('.gh')&&/GUIDE ME/.test(t.$('guideBtn').textContent)&&t.$('guideBtn').getAttribute('aria-pressed')==='false','clicking EXIT GUIDE turns the guide off and shows everything again');
      t.w.toggleGuide(); }
    t.w.toggleGuide(); ok(!t.d.querySelector('.gh')&&!B.classList.contains('guided'),'turning the guide off shows everything again');
    const terms=[...t.d.querySelectorAll('.term')]; ok(terms.length>=6&&terms.every(e=>e.tabIndex===0&&e.dataset.tip.length>40),'explained words are focusable and have a plain explanation');
    t.w.toggleSize(); ok(B.classList.contains('big'),'TEXT A+ enlarges the page'); t.w.toggleSize(); ok(!B.classList.contains('big'),'TEXT A- restores it'); }
  {
    { const css=html.match(/<style>[\s\S]*?<\/style>/)[0], hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
      const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
      const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const tags=[...t.w.document.querySelectorAll('.tag-rec')], opts=[...t.w.document.querySelectorAll('option.opt-rec')];
      // every "recommended" label on a screen (not the changelog or help text) is a badge or a coloured option
      const labels=[...t.w.document.querySelectorAll('summary, option')].filter(e=>/recommended/i.test(e.textContent));
      ok(tags.length===2&&opts.length===1&&labels.length===3&&labels.every(e=>e.querySelector('.tag-rec')||e.classList.contains('opt-rec')),'recommended: every RECOMMENDED label is an amber badge (or an amber option in the menu)');
      const tok=(blk,n)=>{ const m=new RegExp(n+': (#[0-9a-fA-F]{6})').exec(blk); return m?m[1]:'#000000'; };
      const rootBlk=[...css.matchAll(/\n  :root \{[^}]*\}/g)].pop()[0], lightBlk=[...css.matchAll(/\n  body\.light \{[^}]*\}/g)].pop()[0];
      for(const [nm,blk] of [['dark',rootBlk],['light',lightBlk]]){
        const bg=hex(tok(blk,'--bg')), sf=hex(tok(blk,'--surface'));
        const pairs=[['--text',bg],['--muted',bg],['--muted',sf],['--goldtx',bg],['--warn-text',sf],['--bad-text',sf],['--ok-text',sf]];
        ok(pairs.every(([k,b2])=>cr(hex(tok(blk,k)),b2)>=4.5)&&cr(hex(tok(blk,'--btntx')),hex(tok(blk,'--btn')))>=4.5,'colours ('+nm+'): text, grey text, gold, red and green words and the gold button label all keep contrast >= 4.5:1'); }
      ok(/\.tag, body\.light \.tag \{ border: 0; background: none;/.test(css)&&/\.tag-rec, body\.light \.tag-rec \{ color: var\(--warn-text\); background: none; \}/.test(css)&&/\.opt-rec \{[^}]*color: var\(--warn-text\)/.test(css),'labels: RECOMMENDED, SECRET, PUBLIC and the grey ones are plain coloured words (no pill, border or fill)');
      { const notes=[...t.w.document.querySelectorAll('.tag-note')], ros=[...t.w.document.querySelectorAll('.tag-ro')];
        ok(notes.length===2&&notes.every(e=>/^ADVANCED$/.test(e.textContent))&&![...t.w.document.querySelectorAll('summary')].some(e=>/\((demo only|advanced)/i.test(e.textContent)),'tags: ADVANCED is a grey label, not plain (brackets) in the headings');
        ok(ros.filter(e=>e.textContent==='NEW').length===2,'tags: every "NEW" badge (Multisig header and Silent Payment address) looks the same -- the same grey tag-ro style, not two different colours for the same word');
 }
    }
    ok(/#statusLine \{ position: relative; z-index: 1;/.test(html),'status line sits above the page background');
    { const die=t.$('brandDie'), h=t.d.querySelector('#topbar h1'); ok(!!die&&die.querySelectorAll('.dp').length===5&&die.querySelectorAll('.db').length===1&&!!h&&h.textContent==='VOIDFORGE'&&/#topbar h1[^{]*\{[^}]*color: var\(--goldtx\)[^}]*filter: none/.test(html)&&!t.$('logo')&&!/\n  \.logo \{/.test(html)&&typeof t.w.rollLogo==='undefined','header: one flat golden die and the gold name VOIDFORGE (the rolling 3D dice are gone)'); }
    t.$('rolls').value=''; }
  { // Word draw: words drawn from physical tiles + coin flips -> standard BIP39, known answers
    const wd=async(len,words,flips,pw='')=>{ t.$('wdLen').value=String(len); t.$('wdWords').value=words; t.$('wdFlips').value=flips; t.$('passphrase').value=pw; t.$('passphrase2').value=pw; t.w.wdUpdate(); const dis=t.$('wdBtn').disabled; await t.w.wdGenerate(); return {dis,res:t.$('genResult').textContent.split('\n')[0]}; };
    const A11='abandon '.repeat(11);
    let r=await wd(12,A11,'0000000'); ok(!r.dis&&r.res===A11+'about','word draw: eleven "abandon" + flips 0000000 gives the known all-zero seed');
    ok(/73c5da0a/.test(t.$('fingerprint').textContent)&&t.$('explainBox').style.display==='none'&&/How your last word was made/.test(t.$('wdOut').textContent)&&/number 3 = {1,2}00000000011|about/.test(t.$('wdOut').textContent),'word draw: uses the usual fingerprint tools and shows how the last word was made');
    r=await wd(12,'legal winner thank year wave sausage worth useful legal winner thank','1111111'); ok(r.res==='legal winner thank year wave sausage worth useful legal winner thank yellow','word draw: second known seed ends in "yellow"');
    r=await wd(12,'lega WINN thank,year wave saus worth usef legal winner THANK','1111111'); ok(r.res==='legal winner thank year wave sausage worth useful legal winner thank yellow','word draw: four-letter abbreviations, commas and capitals are accepted');
    r=await wd(24,'abandon '.repeat(23),'000'); ok(!r.dis&&r.res==='abandon '.repeat(23)+'art','word draw: 24 words, 23 drawn + 3 flips, known all-zero seed');
    r=await wd(12,A11,'000000'); ok(r.dis&&/6 \/ 7 flips/.test(t.$('wdCount').textContent),'word draw: one flip short keeps the button off');
    r=await wd(12,'abandon '.repeat(10),'0000000'); ok(r.dis&&/10 \/ 11 words/.test(t.$('wdCount').textContent),'word draw: one word short keeps the button off');
    r=await wd(12,'abandon '.repeat(12),'0000000'); ok(r.dis&&/Too many words/.test(t.$('wdMsg').textContent),'word draw: too many words is explained');
    r=await wd(12,A11.replace('abandon abandon','abandon zzzz'),'0000000'); ok(r.dis&&/Word 2 \(zzzz\) is not a BIP39 word/.test(t.$('wdMsg').textContent),'word draw: an unknown word is named');
    t.$('wdFlips').value='10x1 011'; t.w.wdUpdate(); ok(t.$('wdFlips').value==='101011'&&/6 \/ 7 flips/.test(t.$('wdCount').textContent),'word draw: only 1 and 0 count as flips');
    await wd(12,A11,'0000000'); t.$('passphrase2').value='different'; await t.w.wdGenerate(); ok(/do not match/.test(t.$('genResult').textContent),'word draw: mismatched passphrases are refused');
    await wd(12,'legal winner thank year wave sausage worth useful legal winner thank','1111111','secret pass'); ok(/Passphrase: used/.test(t.$('genResult').textContent)&&!/73c5da0a/.test(t.$('fingerprint').textContent),'word draw: the passphrase makes a different wallet');
    t.w.clearAll(); await new Promise(x=>setTimeout(x,30)); ok(t.$('wdWords').value===''&&t.$('wdFlips').value===''&&t.$('wdOut').textContent===''&&t.$('wdOut').style.display==='none','CLEAR wipes the word draw boxes and steps');
    t.$('passphrase').value=''; t.$('passphrase2').value=''; }
  { let threw=false; try{ await t.w.rollsToMnemonic('1'.repeat(62),15);}catch(e){threw=true;} ok(threw,'15-word generation is rejected'); }
  ok(/Recovery notes/.test(html)&&/move the funds/.test(html),'changelog has recovery notes for removed modes');
  ok((await t.w.checkPhrase('abandon '.repeat(14)+'address')).ok,'VERIFY still accepts 15-word phrases from other tools');
  { const r=await t.w.checkPhrase('constructor '+'abandon '.repeat(10)+'about'); ok(!r.ok&&/^Unknown word: constructor \(word 1\): no BIP39 word is close\. /.test(r.msg),'VERIFY reports a JavaScript property name typed as a word as an unknown word (v1.28.0)'); }
  { const tcn=load(); await tcn.ready(); tcn.mode('coin'); tcn.set('0101'); await tcn.w.generate(); ok(/flips/.test(tcn.$('genResult').textContent)&&!/rolls/.test(tcn.$('genResult').textContent),'coin-mode length message says flips'); }
  { const ts=load(); await ts.ready(); ts.set(rnd(50)); await ts.w.generate(); const w0=ts.$('genResult').textContent.split('\n')[0];
    await ts.w.sendToVerify();
    ok(ts.$('phrase').value===w0&&/Valid 12-word/.test(ts.$('verifyStatus').textContent),'SEND TO VERIFY fills the VERIFY box and validates the seed');
    ok(ts.st.clip.length===0,'SEND TO VERIFY does not touch the clipboard');
    const te=load(); await te.ready(); await te.w.sendToVerify(); ok(te.st.alerts.length===1&&te.$('phrase').value==='','SEND TO VERIFY with no seed alerts and does nothing'); }
  { // Multisig wizard: three known seeds -> known descriptor and addresses (made with @scure/bip32 + btc-signer), wipes, refusals
    const tm=load(); await tm.ready(); const $=tm.$, A11='abandon '.repeat(11);
    const mk=async(words,flips)=>{ $('wdLen').value='12'; $('wdWords').value=words; $('wdFlips').value=flips; tm.w.wdUpdate(); await tm.w.wdGenerate(); await new Promise(r=>setTimeout(r,1200)); };
    const seeds=[[A11,'0000000'],['legal winner thank year wave sausage worth useful legal winner thank','1111111'],['zoo '.repeat(11).trim(),'1111111']];
    ok($('msBanner').style.display==='none'&&$('msBox').open===false,'multisig: no banner until setup is started');
    $('msN').value='3'; tm.w.msUpdateM(); eq($('msM').value,'2','multisig: 3 keys default to 2-of-3');
    $('msN').value='5'; tm.w.msUpdateM(); eq($('msMr').value,$('msM').value,'multisig slider: M handle follows M'); eq($('msNr').value,'5','multisig slider: N handle follows N');
    $('msMr').value='5'; $('msMr').oninput(); eq($('msN').value,'5','multisig slider: M at the top keeps N'); $('msNr').value='9'; $('msNr').oninput(); eq($('msN').value,'9','multisig slider: dragging N sets N');
    $('msMr').value='12'; $('msMr').oninput(); eq($('msN').value,'12','multisig slider: M cannot pass N, so N is pushed up');
    $('msNr').value='4'; $('msNr').oninput(); eq($('msM').value,'3','multisig slider: shrinking N below M resets M to a majority'); eq($('msBig').firstChild.textContent,'3-of-4','multisig slider: big label shows M-of-N');
    $('msN').value='4'; $('msM').value='9'; tm.w.msMNote(); eq($('msM').value,'4','multisig slider: M never above N');
    $('msN').value='99'; $('msN').onchange(); eq($('msN').value,'15','multisig: N is capped at 15');
    tm.w.document.querySelector('.ms-preset[data-n="5"]').onclick(); eq($('msM').value+'/'+$('msN').value,'3/5','multisig: preset 3-of-5 fills both numbers');
    $('msN').value='3'; tm.w.msUpdateM();
    $('msN').value='20'; $('msM').value='2'; tm.w.msStart(); ok(tm.w.eval('ms')===null&&/from 2 to 15/.test($('msErr').textContent),'multisig: more than 15 keys is refused at start'); $('msN').value='3'; tm.w.msUpdateM();
    $('msM').value='1'; tm.w.msMNote(); ok(/not real multisig protection/.test($('msMNote').textContent),'multisig: 1-of-N is called out as weak');
    $('msM').value='3'; tm.w.msMNote(); ok(/lose even one/.test($('msMNote').textContent),'multisig: N-of-N warns that one lost key loses the money');
    $('msM').value='1'; tm.w.msStart(); ok(tm.w.eval('ms')===null&&/at least 2/.test($('msErr').textContent),'multisig: 1-of-N is refused at start');
    $('msM').value='2'; $('msAcct').value='x'; tm.w.msStart(); ok(tm.w.eval('ms')===null&&/whole number/.test($('msErr').textContent),'multisig: bad account is refused');
    $('msAcct').value='0'; tm.w.msStart();
    ok($('msBanner').style.display===''&&/KEY 1 OF 3/.test($('msBanTitle').textContent)&&$('msAddBtn').disabled===true,'multisig: banner shows "Key 1 of 3", button off until a seed exists');
    await tm.w.msAddMade(); ok(/Make the seed first/.test($('msBanErr').textContent),'multisig: adding with no seed is explained');
    await mk(...seeds[0]); ok($('msAddBtn').disabled===false,'multisig: button turns on once the seed is made');
    $('rolls').value='1234'; await tm.w.msAddMade();
    ok(tm.w.eval('ms.keys.length')===1&&!tm.w.hasSeed()&&$('rolls').value===''&&$('genResult').textContent==='—'&&$('watchBox').style.display==='none','multisig: ADD keeps only the public key and wipes seed, rolls, results and watch-only box');
    ok(/KEY 2 OF 3/.test($('msBanTitle').textContent)&&tm.d.querySelectorAll('.ms-slot.done').length===1,'multisig: moves on to key 2');
    await mk(...seeds[0]); await tm.w.msAddMade();
    ok(tm.w.eval('ms.keys.length')===1&&/same key as key 1/.test($('msBanErr').textContent)&&tm.w.hasSeed(),'multisig: the same seed twice is refused and the seed stays on screen');
    await mk(...seeds[1]); await tm.w.msAddMade();
    // outside keys: refusals
    tm.w.msUsePaste(); const paste=async(t,fp)=>{ $('msPaste').value=t; $('msPasteFp').value=fp||''; await tm.w.msAddPasted(); return $('msRunErr').textContent; };
    const goodX='xpub6FHZCoNb3tg3o1GAJQxSwgFNF8mLRtTk2GgkF7n5rwzoxBhUEdFWa8cyZRHqytAzKZWsKz8627cQEMCCfR5GDSv6yXegqirpgDUX41Pxybr';
    ok(/fingerprint is 8 characters/.test(await paste(goodX,'')),'multisig paste: a missing fingerprint is explained');
    ok(/seed words/.test(await paste('abandon '.repeat(11)+'about','aaaaaaaa')),'multisig paste: seed words are refused');
    ok(/PRIVATE key/.test(await paste('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi','aaaaaaaa')),'multisig paste: private keys are refused');
    ok(/typo|checksum/.test(await paste(goodX.slice(0,-1)+(goodX.endsWith('r')?'s':'r'),'aaaaaaaa')),'multisig paste: a typo is caught by the checksum');
    ok(/not at the expected place/.test(await paste('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8','aaaaaaaa')),'multisig paste: a master key is not accepted as a cosigner key');
    ok(/not the one this wallet uses/.test(await paste('[aaaaaaaa/48h/0h/1h/2h]'+goodX,'')),'multisig paste: a different account in the path is refused');
    ok(tm.w.eval('ms.keys.length')===2,'multisig paste: nothing was added by the refused keys');
    ok(await paste('['+'3f635a63/48\'/0\'/0\'/2\']'+goodX+'/0/*','')==='','multisig paste: a normal [fingerprint/path]xpub/0/* line is accepted');
    ok(tm.w.eval('ms.keys.length')===3&&tm.w.eval('ms.done')===true,'multisig: third key completes the wallet');
    // the seed from key 2 is still on screen (never added twice); wallet result
    const d=$('msDescR').textContent, K=['[3f635a63/48h/0h/0h/2h]xpub6FHZCoNb3tg3o1GAJQxSwgFNF8mLRtTk2GgkF7n5rwzoxBhUEdFWa8cyZRHqytAzKZWsKz8627cQEMCCfR5GDSv6yXegqirpgDUX41Pxybr/0/*','[73c5da0a/48h/0h/0h/2h]xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf/0/*'];
    ok(d.startsWith('wsh(sortedmulti(2,'+K[0]+','+K[1]+',')&&/\/0\/\*\)\)#[a-z0-9]{8}$/.test(d),'multisig: descriptor has the known keys in sorted order and a checksum');
    eq($('msAddrs').textContent,'bc1qea2gkgeszr7wm66x2ejkgdxm9nhg9462sszn75zmkhazev0t02vs70kkll'+'bc1qa0sj5tjwunnxyhmkgd85548gwqv2r0tc6vjs9c3yy2j7gjea72hs9dvptd'+'bc1qmes7qgkj4fedgj86er5z2yx2hyfjwaw9rmhsap30ul42xl4eayrsx3qsm0','multisig: first 3 addresses equal the independent library');
    ok($('msOneDev').style.display==='none','multisig: one-device warning is hidden when a key came from elsewhere');
    ok($('msBanner').style.display==='none','multisig: banner goes away when finished');
    tm.w.msShowQr(); ok($('msQrBox').style.display===''&&/81 x 81/.test($('msQrCaption').textContent),'multisig: descriptor QR shows');
    tm.w.msPrint(); ok(tm.st.printed===1&&/NO seed words/.test(tm.d.getElementById('printQr').textContent)&&tm.d.getElementById('printQr').textContent.includes(d)&&!/abandon|legal winner/.test(tm.d.getElementById('printQr').textContent),'multisig: recovery sheet prints the descriptor and no seed words');
    tm.w.clearAll(); ok(tm.w.eval('ms')===null&&$('msDescR').textContent===''&&$('msRun').style.display==='none','multisig: CLEAR ALL forgets the whole setup');
    // all made here -> one-device warning; testnet banner
    const t2=load(); await t2.ready(); t2.$('msN').value='2'; t2.w.msUpdateM(); t2.$('msNet').value='test'; t2.$('msType').value='ms-sh-wsh'; t2.w.msStart();
    ok(t2.$('msTestBan').style.display===''&&/TESTNET/.test(t2.$('msBanTitle').textContent),'multisig: testnet is shown loudly');
    for(const [w0,f0] of [seeds[0],seeds[1]]){ t2.$('wdLen').value='12'; t2.$('wdWords').value=w0; t2.$('wdFlips').value=f0; t2.w.wdUpdate(); await t2.w.wdGenerate(); await new Promise(r=>setTimeout(r,1200)); await t2.w.msAddMade(); }
    ok(t2.w.eval('ms.done')&&t2.$('msOneDev').style.display===''&&/^sh\(wsh\(sortedmulti\(2,/.test(t2.$('msDescR').textContent)&&/^2/.test(t2.$('msAddrs').textContent)&&/tpub/.test(t2.$('msDescR').textContent),'multisig: 2-of-2 testnet nested: sh(wsh()), 2... addresses, tpub keys, one-device warning');
    const t3=load(); await t3.ready(); t3.w.msStart(); t3.w.msCancel(); ok(t3.w.eval('ms')===null,'multisig: START OVER with nothing collected just resets');
    { const t4=load(); await t4.ready(); const ids=()=>[...t4.d.querySelectorAll('.card')].map(c=>c.id).join(','); const before=ids();
      t4.w.msStart(); ok(t4.$('cardMulti').nextElementSibling===t4.$('cardGen')&&/(^|,)cardMulti,cardGen/.test(ids()),'multisig: while setting up, the card sits directly above the seed maker');
      t4.w.msCancel(); ok(ids()===before&&t4.w.eval('ms')===null,'multisig: START OVER puts the card back where it was');
      t4.w.msStart(); t4.w.msReset(); ok(ids()===before,'multisig: CLEAR ALL also puts the card back'); }

  }
  { const tp=load(); await tp.ready(); const $=tp.$;
    eq((await tp.w.practiceMake(new tp.w.Uint8Array(16))).join(' '),'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about','practice: the phrase is a valid 12-word BIP39 phrase made from the entropy');
    const E=['abandon','ability','able','about'];
    ok(tp.w.practiceCompare(E,'abandon ability able about').ok&&tp.w.practiceCompare(E,'  ABANDON  ability\nable about ').ok,'practice: a correct copy matches (case and spacing do not matter)');
    ok(/Word 3 does not match/.test(tp.w.practiceCompare(E,'abandon ability zoo about').msg)&&/Words 2, 4 do not match/.test(tp.w.practiceCompare(E,'abandon zoo able zoo').msg),'practice: wrong words are named by position');
    ok(/typed 3 words; the practice phrase has 4/.test(tp.w.practiceCompare(E,'abandon ability able').msg)&&/typed 5 words/.test(tp.w.practiceCompare(E,'abandon ability able about zoo').msg)&&/typed 1 word;/.test(tp.w.practiceCompare(E,'abandon').msg),'practice: a missing or extra word is reported by count');
    ok(!tp.w.practiceCompare(E,'ability abandon able about').ok,'practice: right words in the wrong order do not match');
    await tp.w.practiceStart(); const words=tp.w.eval('practice.words');
    ok(words.length===12&&$('prWords').children.length===12&&$('prShow').style.display==='block'&&$('prCheck').style.display==='none'&&/Never fund this phrase/.test($('prShow').textContent),'practice: START shows 12 numbered words with a never-fund warning');
    ok(words.every(w=>tp.w.eval('WORD_MAP')[w]!==undefined),'practice: every word is a real BIP39 word');
    tp.w.practiceHide(); ok($('prWords').textContent===''&&$('prShow').style.display==='none'&&$('prCheck').style.display==='block'&&!$('practiceBox').textContent.includes(words.join(' ')),'practice: HIDE removes the words from the practice box');
    $('prInput').value=words.join(' '); tp.w.practiceCheck(); ok(/ok/.test($('prStatus').className)&&/matches, word for word/.test($('prStatus').textContent),'practice: the correct paper copy is confirmed');
    $('prInput').value=words.map((w,i)=>i===4?'zoo':w).join(' '); tp.w.practiceCheck(); ok(/bad/.test($('prStatus').className)&&/Word 5 does not match/.test($('prStatus').textContent),'practice: a wrong word is flagged');
    $('prInput').dispatchEvent(new tp.w.Event('input')); eq($('prStatus').textContent,'','practice: typing clears the result');
    tp.w.practicePeek(); ok($('prWords').children.length===12&&$('prShow').style.display==='block','practice: SHOW THE WORDS AGAIN brings them back');
    tp.w.practiceHide(); tp.w.practiceClear(); ok(tp.w.eval('practice')===null&&$('prWords').textContent===''&&$('prInput').value===''&&$('prShow').style.display==='none'&&$('prCheck').style.display==='none','practice: CLEAR forgets the phrase and empties the page');
    tp.w.practiceCheck(); tp.w.practiceHide(); tp.w.practicePeek(); ok($('prShow').style.display==='none'&&$('prCheck').style.display==='none','practice: buttons do nothing before a practice starts');
    const PH=['legal winner thank year wave sausage worth useful legal winner thank yellow','letter advice cage absurd amount doctor acoustic avoid letter advice cage above','ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic','gravity machine north sort system female filter attitude volume fold club still','hamster diagram private dutch cause delay private meat slide toddler razor blue','scheme spot photo card baby mountain device kick cradle pact join borrow'];
    tp.w.eval('practiceNext=0'); const a=[]; for(let i=0;i<8;i++){ await tp.w.practiceStart(); a.push(tp.w.eval('practice.words.join(" ")')); }
    ok(a.slice(0,6).join('|')===PH.join('|')&&a[6]===PH[0]&&a[7]===PH[1],'practice: START steps through the six published BIP39 test phrases, in order, then starts over (no random numbers)');
    ok(!/getRandomValues|Math\.random|\.randomUUID|msCrypto/.test(html.replace(/const WORDLIST = \[.*?\];/s,'')),'the page contains no browser random-number call at all'); }
  // ---- v1.25.0 layout: tabs, Your seed panel, step bar, word slots, dice wait ----
  { const tl=load({focusSpy:true}); await tl.ready(); const T=(n)=>tl.$('tp-'+n), on=(n)=>!T(n).classList.contains('tab-off'), sel=(n)=>tl.$('tab-'+n).getAttribute('aria-selected');
    ok(['make','check','tools','about'].every(n=>on(n)===(n==='make')&&sel(n)===String(n==='make')),'tabs: Make a seed is open first, the other three are hidden');
    ok(tl.$('tabs').getAttribute('role')==='tablist'&&[...tl.$('tabs').querySelectorAll('button')].every(b=>b.getAttribute('role')==='tab'&&tl.$(b.getAttribute('aria-controls')).getAttribute('role')==='tabpanel'),'tabs: proper tablist, tab and tabpanel roles');
    tl.w.showTab('check'); ok(on('check')&&!on('make')&&sel('check')==='true'&&sel('make')==='false'&&tl.$('tab-check').tabIndex===0&&tl.$('tab-make').tabIndex===-1,'tabs: showTab opens one and closes the rest');
    tl.$('tab-tools').dispatchEvent(new tl.w.MouseEvent('click',{bubbles:true})); ok(on('tools')&&!on('check'),'tabs: clicking a tab opens it');
    tl.w.showTab('nonsense'); ok(on('tools'),'tabs: an unknown tab name changes nothing');
    { const bar=tl.$('tabs'); tl.w.showTab('make'); tl.$('tab-make').focus&&0;
      const key=(k)=>{ bar.dispatchEvent(new tl.w.KeyboardEvent('keydown',{key:k,bubbles:true})); }; Object.defineProperty(tl.d,'activeElement',{configurable:true,get:()=>tl.$('tab-'+['make','check','tools','about'].find(n=>tl.$('tab-'+n).tabIndex===0))});
      key('ArrowRight'); ok(on('check'),'tabs: right arrow moves to the next tab'); key('ArrowLeft'); ok(on('make'),'tabs: left arrow moves back');
      key('ArrowLeft'); ok(on('about'),'tabs: left arrow wraps from the first to the last'); key('ArrowRight'); ok(on('make'),'tabs: right arrow wraps from the last to the first');
      key('End'); ok(on('about'),'tabs: End opens the last tab'); key('Home'); ok(on('make'),'tabs: Home opens the first tab'); key('x'); ok(on('make'),'tabs: other keys do nothing'); }
    // jumping to something in another tab opens that tab first
    tl.w.jumpTo('cardCheck'); ok(on('check'),'jumpTo opens the tab that holds the target (Check a backup)');
    tl.w.jumpTo('cardGen'); ok(on('make'),'jumpTo opens Make a seed'); tl.w.jumpTo('cardMulti'); ok(on('tools'),'jumpTo opens Extra tools for the multisig card');
    tl.w.jumpTo('beforeCard'); ok(on('about'),'jumpTo opens About for the safety card'); tl.w.showTab('make');
    tl.$('strip').querySelector('button').click(); ok(on('about')&&/Read before real keys/.test(tl.$('strip').textContent),'the one-line notice opens About & help');
    ok(tl.w.document.querySelector('.strip b').textContent==='Educational, not independently audited.','the one-line notice says the app is educational and not audited');
    tl.w.showTab('make');
    // SEND TO CHECK moves you to the Check tab
    { const AB='abandon '.repeat(11)+'about'; tl.$('phrase').value=''; const tf2=tl; tf2.set(rnd(50,6)); tf2.$('forgeBtn').disabled=false; await tf2.w.generate(); ok(on('make')&&tf2.w.hasSeed(),'forge keeps you on Make a seed'); await tf2.w.sendToVerify(); ok(on('check')&&tf2.$('phrase').value.split(' ').length===12,'SEND TO CHECK opens the Check tab with the words in the box'); }
    // every control from earlier versions is still in exactly one tab or in the page frame
    { const ids=['brandDie','menuBox','rolls','forgeBtn','genResult','wordGrid','fingerprint','address','passphrase','passphrase2','note','phrase','verifyPass','verifyRecorded','checkAddr','psbtInput','cmpA','cmpB','msN','msM','msBox','wdBox','methodTabs','wordSel','advanced','addrBox','explainBox','seedQrBox','watchBox','about','beforeCard','disclaimer','safetyBox','privacyBox','multiHelp','practiceBox','psbtBox','fpIcon','guidePanel','tapRow','testResults','printOnly','printQr','netTag','selfTestBadge'];
      const missing=ids.filter(id=>!tl.$(id)); ok(missing.length===0,'feature inventory: every earlier control and section is still on the page'+(missing.length?' (missing '+missing.join(', ')+')':''));
      const homeless=['rolls','forgeBtn','phrase','psbtInput','cmpA','msN','about','beforeCard','disclaimer'].filter(id=>!tl.$(id).closest('.tabpanel')); ok(homeless.length===0,'feature inventory: every tool lives inside a tab'+(homeless.length?' ('+homeless.join(', ')+')':''));
      ok(['printOnly','printQr'].every(id=>!tl.$(id).closest('.tabpanel')),'printing works from any tab: the print sheets sit outside the tabs');
      const btns=[...tl.d.querySelectorAll('button')].filter(b=>!b.closest('.tabpanel')&&!b.closest('#startGate')&&!b.closest('#tabs')).map(b=>b.textContent.trim().replace(/\s+/g,' ')).sort().join('|');
      eq(btns,['DARK','DOWNLOAD FOR USB','END SESSION','GUIDE ME','PRINT SEED','PRINT STAMP SHEET','TEXT A+','Read before real keys \u2192'].sort().join('|'),'page frame holds exactly the top buttons and the notice link'); }
    // the three warnings and the disclaimer moved to About, with their text intact
    ok(/AIR-GAPPED USE ONLY/.test(tl.$('tp-about').textContent)&&/not been independently audited/.test(tl.$('disclaimer').textContent)&&tl.$('beforeCard').querySelectorAll('.sg-item').length===3,'About & help holds the air-gap warning, the disclaimer and the three computer-memory warnings');
    ok(!tl.$('tp-make').contains(tl.$('about'))&&tl.$('tp-tools').contains(tl.$('cardMulti'))&&tl.$('tp-tools').contains(tl.$('cardTools'))&&tl.$('tp-check').contains(tl.$('cardCheck')),'each card sits in the right tab');
  }
  { const tc=load(); await tc.ready(); const big=()=>tc.$('bigCount'), sub=()=>tc.$('bigSub');
    ok(big().textContent==='0 / 50'&&/short/.test(big().className)&&/50 more rolls to go/.test(sub().textContent)&&/short/.test(sub().className),'counter: starts at 0 / 50, red, with how many rolls are left');
    tc.set(rnd(20,6)); ok(big().textContent==='20 / 50'&&/short/.test(big().className)&&/30 more rolls to go/.test(sub().textContent)&&/short/.test(tc.$('rollCount').className),'counter: stays red below the target');
    tc.set(rnd(49,6)); ok(big().textContent==='49 / 50'&&/short/.test(big().className)&&/1 more rolls? to go|1 more roll/.test(sub().textContent),'counter: still red one roll short');
    tc.set(rnd(50,6)); ok(big().textContent==='50 / 50'&&/met/.test(big().className)&&!/short/.test(big().className)&&/Enough rolls\. Press FORGE SEED\./.test(sub().textContent)&&/met/.test(tc.$('rollCount').className)&&/met/.test(sub().className),'counter: turns green at the target and says what to do next');
    ok(/\.big-count\.met::before\s*\{\s*content:\s*"\\2713/.test(html),'counter: the tick is in the stylesheet');
    tc.set(rnd(51,6)); ok(/met/.test(big().className)&&big().textContent==='51 / 50','counter: still green when over the target (the forge button asks to remove extra)');
    tc.words(24); ok(big().textContent==='51 / 99'&&/short/.test(big().className)&&/48 more rolls to go/.test(sub().textContent),'counter: follows the 24-word target (99 rolls)');
    tc.mode('coin'); tc.words(12); tc.set(rnd(128,2)); ok(big().textContent==='128 / 128'&&/met/.test(big().className)&&/Enough flips/.test(sub().textContent),'counter: coin mode counts flips (128 for 12 words)');
    tc.set(rnd(100,2)); ok(/28 more flips to go/.test(sub().textContent),'counter: says flips in coin mode');
    // step bar
    const cur=()=>[...tc.d.querySelectorAll('#stepBar li')].map(l=>l.className||'-').join(',');
    tc.mode('dice'); tc.set(''); ok(cur()==='done,cur,-,-,-'&&tc.d.querySelectorAll('#stepBar li[aria-current]').length===1,'step bar: Choose done, Roll current, one step marked current');
    { const why=()=>tc.$('stepWhy').textContent; ok(/SHA-256, so nothing hidden/.test(why()),'step help: Roll step explains that only SHA-256 is applied'); tc.set(rnd(50,6)); ok(/Press FORGE SEED to turn your rolls into the BIP39 words/.test(why()),'step help: Forge step says what FORGE does'); tc.$('forgeBtn').disabled=false; await tc.w.generate(); ok(/passphrase is optional and makes a completely different wallet/.test(why()),'step help: Passphrase step says what a passphrase does'); tc.w.wipeSeed(); ok(/SHA-256, so nothing hidden/.test(why()),'step help: back to the Roll text after wiping'); tc.set(''); }
    tc.set(rnd(50,6)); ok(cur()==='done,done,cur,-,-','step bar: Forge is current once there are enough rolls');
    tc.$('forgeBtn').disabled=false; await tc.w.generate(); ok(cur()==='done,done,done,cur,-'&&/Seed made/.test(sub().textContent),'step bar: Passphrase (optional) is current after forging');
    tc.w.wipeSeed(); ok(cur()==='done,cur,-,-,-'&&big().textContent==='0 / 50','step bar and counter go back to the start after wiping');
  }
  { const ts=load(); await ts.ready(); const cells=()=>[...ts.$('wordGrid').children];
    ok(cells().length===12&&cells().every(c=>c.classList.contains('empty')&&/^\d+\.$/.test(c.firstChild.textContent)&&c.lastChild.textContent==='\u2014')&&cells().map(c=>c.firstChild.textContent).join(' ')===Array.from({length:12},(_,i)=>(i+1)+'.').join(' '),'slots: twelve numbered empty slots show before anything is made');
    ok(ts.$('wordGrid').classList.contains('slots')&&!/display:\s*grid/.test(ts.$('wordGrid').getAttribute('style')||''),'slots: shown by a class, not by the inline style that reveals the secret note');
    ok(/#wordGrid\[style\*="display: grid"\] \+ #secretNote/.test(html)&&!/display:\s*grid/.test(ts.$('wordGrid').getAttribute('style')||''),'slots: the secret note rule still keys on real words only');
    ts.words(24); ok(cells().length===24&&cells()[23].firstChild.textContent==='24.','slots: 24 slots when 24 words are chosen'); ts.words(12); ok(cells().length===12,'slots: back to 12');
    ok(!ts.$('wordGrid').hasAttribute('data-seed')&&!ts.$('genResult').dataset.seed&&ts.$('genResult').classList.contains('nores'),'slots: the empty result box is hidden until there is something to say');
    ts.set(rnd(50,6)); ts.$('forgeBtn').disabled=false; await ts.w.generate(); const words=ts.$('genResult').textContent.split('\n')[0].split(' ');
    ok(cells().length===12&&cells().every(c=>!c.classList.contains('empty'))&&cells().map(c=>c.lastChild.textContent).join(' ')===words.join(' ')&&!ts.$('wordGrid').classList.contains('slots')&&ts.$('wordGrid').style.display==='grid','slots: forging fills them with the real words, in order, and drops the empty state');
    ok(!ts.$('genResult').classList.contains('nores'),'slots: the result box shows once there is a seed'); ts.words(24); ok(!ts.$('genResult').dataset.seed&&cells().length===24&&cells().every(c=>c.classList.contains('empty'))&&/changed the rolls/.test(ts.$('genResult').textContent),'slots: changing the length after FORGE clears the old 12 words and shows 24 empty slots (no stale seed under a different length)');
    ts.w.wipeSeed(); ok(cells().length===24&&cells().every(c=>c.classList.contains('empty'))&&!cells().some(c=>words.includes(c.lastChild.textContent)&&c.lastChild.textContent!=='\u2014')&&!ts.$('wordGrid').textContent.includes(words[0]+words[1]),'slots: wiping brings back empty slots and leaves none of the old words in the page');
    ts.set('555'); await ts.w.generate(); ok(cells().every(c=>c.classList.contains('empty'))&&!ts.$('genResult').classList.contains('nores')&&/more rolls/.test(ts.$('genResult').textContent),'slots: an "enter more rolls" message shows in the result box and the slots stay empty');
  }
  ok([['make','MAKE','MAKE A SEED'],['check','CHECK','CHECK A BACKUP'],['tools','TOOLS','EXTRA TOOLS'],['about','ABOUT','ABOUT & HELP']].every(([t,sh,fl])=>html.includes('data-tab="'+t+'" aria-label="'+fl+'"><span class="lg">')&&html.includes('<span class="sh">'+sh+'</span>')),'tabs: every tab has a full name (screen readers, wide screens) and a short name for phones');
  { const tf2=load(); await tf2.ready(); const mk=(c)=>c.map((n,i)=>String(i+1).repeat(n)).join('');
    // reference values from scipy.stats.chisquare (independent library)
    const D=[[[5,5,5,5,5,5],0,1],[[8,6,4,5,3,4],3.2,0.669183],[[10,6,5,4,3,2],8,0.156236],[[12,8,4,3,2,1],17.6,0.003492],[[15,12,9,6,3,0],21,0.00081],[[20,5,2,1,1,1],56.4,0]];
    ok(D.every(([c,x,pv])=>{const r=tf2.w.faceTest(mk(c),false);return Math.abs(r.chi-x)<1e-6&&Math.abs(r.p-pv)<2e-6&&r.df===5;}),'fairness test: dice chi-square and p-value match scipy (5 degrees of freedom)');
    const C=[[[15,5],5,0.025347],[[10,10],0,1],[[16,4],7.2,0.00729],[[18,2],12.8,0.000347]];
    ok(C.every(([c,x,pv])=>{const r=tf2.w.faceTest('1'.repeat(c[0])+'0'.repeat(c[1]),true);return Math.abs(r.chi-x)<1e-6&&Math.abs(r.p-pv)<2e-6&&r.df===1;}),'fairness test: coin chi-square and p-value match scipy (1 degree of freedom)');
    const show=(v,coin)=>{ if(coin) tf2.w.document.querySelector('input[name="mode"][value="coin"]').click(); tf2.set(v); return (tf2.$('rcStat')||{}).textContent||''; };
    tf2.w.confirm=()=>true; tf2.w.document.querySelector('input[name="mode"][value="dice"]').checked=true;
    ok(show(mk([4,4,4,4,4,4].map(x=>x+1)).slice(0,29))==='','fairness test: not shown before 30 rolls');
    ok(/\u03c7\u00b2 = 0\.00, 5 degrees of freedom, p \u2248 1\.000\. Nothing unusual\./.test(show(mk([5,5,5,5,5,5]))),'fairness test: even counts say nothing unusual, with the numbers');
    ok(/p \u2248 0\.156\. Nothing unusual/.test(show(mk([10,6,5,4,3,2]))),'fairness test: p 0.156 is nothing unusual');
    ok(/Mildly unusual: a fair die does this about 1 time in 20/.test(show(mk([12,8,4,3,2,1]))),'fairness test: p between 0.001 and 0.05 is mildly unusual');
    ok(/p \u2248 below 0\.001\. Strong sign/.test(show(mk([20,5,2,1,1,1]))),'fairness test: tiny p is a strong sign');
    ok(/cannot prove fairness/.test(tf2.$('rcStat').textContent),'fairness test: says it cannot prove fairness');
    tf2.set(''); tf2.w.document.querySelector('input[name="mode"][value="coin"]').click(); tf2.w.document.querySelector('input[name="mode"][value="coin"]').dispatchEvent(new tf2.w.Event('change',{bubbles:true}));
    tf2.set('1'.repeat(14)+'0'.repeat(5)); ok(!tf2.$('rcStat'),'fairness test: coin test waits for 20 flips');
    tf2.set('1'.repeat(15)+'0'.repeat(5)); ok(/\u03c7\u00b2 = 5\.00, 1 degree of freedom, p \u2248 0\.025\. Mildly unusual: a fair coin does this/.test((tf2.$('rcStat')||{}).textContent||''),'fairness test: coin result with its numbers and the word coin'); }

  { const tw=load(); await tw.ready(); const F=(x)=>tw.w.wdFindWord(x);
    // reference words from the python-mnemonic library's English list
    const W=[["1","abandon",1],["2048","zoo",2048],["257","cactus",257],["680","female",680],["3 A 7","female",680],["3-a-7","female",680],["1 0 0","abandon",1],["8 F F","zoo",2048],["2 0 0","cactus",257],["300","century",300],[" 300 ","century",300]];
    ok(W.every(([i,wd,n])=>{const r=F(i);return r.word===wd&&r.idx===n-1&&r.msg==='Word '+n+': '+wd;}),'word finder: numbers and D8 + hex dice give the right BIP39 words');
    ok(['9 0 0','0 0 0','3 G 7','abc','3 A','3 A 7 7','-'].every(x=>F(x).word===undefined&&F(x).idx===undefined&&F(x).msg==='Type a number from 1 to 2048, a D8 roll (1-8) then two hex digits (0-F) like 3 A 7, or a BitBox02 diceware roll like 2143 2 T.'),'word finder: bad entries give a hint and no word');
    ok(['0','2049','99999'].every(x=>F(x).msg==='A word number is between 1 and 2048.'&&F(x).idx===undefined),'word finder: out-of-range numbers are explained');
    ok(F('').msg===''&&F('   ').msg==='','word finder: empty entry says nothing');
    tw.w.document.getElementById('wdFind').value='3 A 7'; tw.w.wdFind(); ok(tw.$('wdFound').textContent==='Word 680: female','word finder: shows the word on the page');
    ok(tw.$('wdFind').closest('#tp-make')!==null,'word finder: lives in the Make a seed tab'); }
  { // v2.3.0 BitBox02 diceware: the table code in the word finder, ADD WORD, and the 24th word from 3 flips (T = 1, H = 0)
    const tb=load(); await tb.ready(); const F=x=>tb.w.wdFindWord(x), WL=tb.w.eval('WORDLIST');
    const bbIdx=(c)=>{ const d=c.slice(0,5).split('').map(Number); return (((d[0]-1)*64+(d[1]-1)*16+(d[2]-1)*4+(d[3]-1))*8)+(d[4]-1)*2+(c[5]==='T'?1:0); };
    // the printed table rows that BitBox publishes: 1111 = abandon ... abstract, 2111 starts at divorce, 4444 ends at zoo
    ok(['1111 1 H','1111 1 T','1111 2 H','1111 2 T','1111 3 H','1111 3 T','1111 4 H','1111 4 T'].map(x=>F(x).word).join(' ')==='abandon ability able about above absent absorb abstract','BitBox02 table: row 1111 is abandon to abstract, in the printed order');
    ok(F('2111 1 H').word==='divorce'&&F('4444 4 T').word==='zoo'&&F('4444 4 H').word==='zone'&&F('1112 1 H').word==='absurd'&&F('1234 1 H').word==='brand'&&F('1234 4 T').word==='brief'&&F('3412 1 H').word==='rain'&&F('3412 4 T').word==='rapid','BitBox02 table: rows 2111, 4444, 1234 (brand to brief) and 3412 (rain to rapid) match the printed table');
    let all=true; const seen=new Set(); for(let a=1;a<=4;a++)for(let b2=1;b2<=4;b2++)for(let c=1;c<=4;c++)for(let d=1;d<=4;d++)for(let e=1;e<=4;e++)for(const f of 'HT'){ const code=''+a+b2+c+d+e+f, r=F(code.slice(0,4)+' '+code[4]+' '+f); if(r.idx!==bbIdx(code)||r.word!==WL[bbIdx(code)]) all=false; seen.add(r.idx); }
    ok(all&&seen.size===2048,'BitBox02 table: all 2048 codes give 2048 different words, by the published formula');
    ok(F('2143-2-t').word===F('2143 2 T').word&&F('21432T').word===F('2143 2 T').word&&F(' 2143 2 t ').msg==='Word '+(bbIdx('21432T')+1)+': '+WL[bbIdx('21432T')],'BitBox02 table: spaces, dashes and lower case are fine');
    ok(F('11111').msg==='A word number is between 1 and 2048.'&&['5111 1 H','1111 5 H','1111 1 X','1111 1','1111 1 HT','0111 1 H'].every(x=>F(x).word===undefined&&/BitBox02 diceware roll like 2143 2 T/.test(F(x).msg)),'BitBox02 table: a die above 4, a missing coin or a wrong letter is refused');
    // ADD WORD and Enter
    tb.$('wdFind').value='1111 1 H'; ok(tb.w.wdAddFound()===true&&tb.$('wdWords').value==='abandon'&&tb.$('wdFind').value===''&&tb.$('wdFound').textContent==='Added word 1: abandon. BitBox02 diceware makes 24 words: choose 24 words above.','ADD WORD: adds the word, empties the finder, and says BitBox02 needs 24 words while 12 are chosen');
    tb.$('wdFind').value='3 A 7'; tb.w.wdFind(); ok(tb.$('wdFound').textContent==='Word 680: female','word finder: the 24-word hint is only for BitBox02 codes'); tb.$('wdFind').value='';
    tb.$('wdFind').value='4444 4 T'; tb.$('wdFind').dispatchEvent(new tb.w.KeyboardEvent('keydown',{key:'Enter',bubbles:true})); ok(tb.$('wdWords').value==='abandon zoo'&&/2 \/ 11 words/.test(tb.$('wdCount').textContent),'ADD WORD: Enter in the finder adds the next word and the count follows');
    tb.$('wdFind').value='5555 5 H'; ok(tb.w.wdAddFound()===false&&tb.$('wdWords').value==='abandon zoo'&&/BitBox02/.test(tb.$('wdFound').textContent),'ADD WORD: a bad entry adds nothing and shows the hint');
    ok(!!tb.$('wdAddBtn')&&tb.$('wdAddBtn').className==='secondary small'&&tb.$('wdAddBtn').closest('#wdBox'),'ADD WORD: a plain button in the Word draw box');
    // the 24th word: official BitBox vector (23 x violin) and a random seed, checked with Node's SHA-256
    { const cand=(idx,i)=>{ const bits=idx.map(n=>n.toString(2).padStart(11,'0')).join('')+i.toString(2).padStart(3,'0'), ent=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2))); return WL[(i<<8)|nc.createHash('sha256').update(ent).digest()[0]]; };
      const viol=Array(23).fill(WL.indexOf('violin')); ok([0,1,2,3,4,5,6,7].map(i=>cand(viol,i)).join(' ')==='boss coyote dry habit panel regular speed winter','BitBox02 last word: the reference calculation matches BitBox\'s own test vector');
      tb.w.setMethod('words'); tb.$('wdLen').value='24'; tb.$('wordSel').value='24'; tb.$('wordSel').dispatchEvent(new tb.w.Event('change')); tb.$('wdWords').value=''; const codes=[], idx=[];
      for(let k=0;k<23;k++){ const c=Array.from({length:5},()=>1+nc.randomInt(4)).join('')+(nc.randomInt(2)?'T':'H'); codes.push(c); idx.push(bbIdx(c)); tb.$('wdFind').value=c.slice(0,4)+' '+c[4]+' '+c[5]; tb.w.wdAddFound(); }
      const flipsHT=['H','T','T'].map(()=>nc.randomInt(2)?'T':'H').join(''), i=parseInt(flipsHT.replace(/T/g,'1').replace(/H/g,'0'),2);
      tb.$('wdFlips').value=flipsHT.replace(/T/g,'1').replace(/H/g,'0'); tb.w.wdUpdate(); ok(!tb.$('wdBtn').disabled,'BitBox02: 23 table words and 3 flips unlock MAKE SEED FROM WORDS');
      await tb.w.wdGenerate(); const got=tb.$('genResult').textContent.split('\n')[0].split(' ');
      ok(got.length===24&&got.slice(0,23).join(' ')===idx.map(n=>WL[n]).join(' ')&&got[23]===cand(idx,i),'BitBox02: the 24th word is the candidate BitBox shows for '+flipsHT+' (T = 1, H = 0)'); }
    { // v2.3.0 review fix: a Word draw seed is cleared when its words, flips or length change afterwards
      const made=tb.$('genResult').textContent.split('\n')[0]; ok(tb.w.hasSeed()&&made.split(' ').length===24,'Word draw: the BitBox02 seed is made');
      const fl=tb.$('wdFlips').value; tb.$('wdFlips').value=fl==='111'?'000':'111'; tb.$('wdFlips').oninput&&tb.$('wdFlips').oninput(); tb.w.wdUpdate();
      ok(!tb.w.hasSeed()&&/You changed the words, the coin flips or the word count after MAKE SEED FROM WORDS/.test(tb.$('genResult').textContent)&&tb.$('wdOut').textContent===''&&tb.$('wdOut').style.display==='none','Word draw: changing the flips after the seed was made clears it and the last-word steps');
      tb.$('wdFlips').value=fl; tb.w.wdUpdate(); await tb.w.wdGenerate(); ok(tb.w.hasSeed()&&tb.$('genResult').textContent.split('\n')[0]===made,'Word draw: the same words and flips make the same seed again');
      tb.$('wdFind').value='1111 1 H'; tb.w.wdAddFound(); ok(!tb.w.hasSeed(),'Word draw: adding a word after the seed was made clears it');
      tb.$('wdWords').value=made.split(' ').slice(0,23).join(' '); tb.w.wdUpdate(); await tb.w.wdGenerate(); tb.words(12); ok(!tb.w.hasSeed(),'Word draw: changing the word count clears the seed'); }
    ok(/Using BitBox02&rsquo;s diceware table\?/.test(html)&&/T as 1 and H as 0/.test(html)&&/HHH picks the first, TTT the eighth/.test(html),'BitBox02: the Word draw box explains the table codes and the 3 flips'); }
  { // v2.3.0 Verify a signed message: official BIP-322 vectors (bitcoin/bips) and Bitcoin Core's classic test vector, through the page
    const ts=load(); await ts.ready(); const V=(a,m,sg)=>ts.w.verifyMessage(a,m,sg);
    const CORE=['mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB','This is just a test message','INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0='];
    const W1='bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', SE='smpAkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=';
    const SH=['smpAkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=','smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy'];
    const TR=['bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler','No prefix fallback','AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R'];
    let r=await V(...CORE); ok(r.state==='valid'&&!r.variant&&/^VALID: the key of mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB signed exactly this message\.\nFormat: classic \(BIP-137\), Legacy \(m\.\.\. or n\.\.\.\)\.\nA signature shows that whoever holds/.test(r.text),'signed message: Bitcoin Core\'s test vector is VALID, names the address, testnet labels');
    r=await V('1BquDSCmzyqhKnMXByiDQEFbY3DkMRi1XP','recid two','IQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEjRWeJCrze8='); ok(r.state==='valid'&&/Legacy \(1\.\.\.\)/.test(r.text),'signed message: recovery id 2 (R.x = r + n), checked with @noble/curves');
    r=await V(CORE[0],CORE[1],Buffer.from([0x2b,...Buffer.from(CORE[2],'base64').subarray(1)]).toString('base64')); ok(r.state==='error'&&/damaged: its first byte must be 27 to 42/.test(r.text),'signed message: a classic signature with a bad first byte is called damaged');
    r=await V(CORE[0],CORE[1],'AAAA'); ok(r.state==='error'&&/not a classic signature/.test(r.text),'signed message: a short signature for a 1... address is refused');
    r=await V(CORE[0],CORE[1]+'.',CORE[2]); ok(r.state==='invalid'&&/^NOT VALID: this signature does not match this address and this message\./.test(r.text),'signed message: one character more is NOT VALID');
    r=await V(CORE[0],CORE[1]+'\r\n',CORE[2]); ok(r.state==='valid'&&r.variant===true&&/^VALID, after a small change to the message: the key of mpLQ/.test(r.text),'signed message: a trailing line break is accepted, with a clear warning');
    r=await V('mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxC',CORE[1],CORE[2]); ok(r.state==='error'&&/checksum does not match/.test(r.text),'signed message: an address with a typo is refused');
    r=await V(W1,'',SE); ok(r.state==='valid'&&/BIP-322 simple, Native SegWit \(bc1q\.\.\.\)/.test(r.text)&&r.text.includes(W1),'signed message: BIP-322 simple P2WPKH, empty message (official vector)');
    // every official BIP-322 vector (bitcoin/bips bip-0322/*.json): simple ones VALID (or CANNOT CHECK for multisig), full and proof-of-funds
    // CANNOT CHECK with and without their prefix, every error case never VALID
    { const VB=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','bip322-basic-test-vectors.json'),'utf8')), VG=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','bip322-generated-test-vectors.json'),'utf8'));
      let bad=[], n=0;
      for(const v of [...VB.simple,...VG.simple]) for(const sg of v.bip322_signatures){ n++; const want=/p2wsh/.test(v.type)?'cannot':'valid'; for(const x of [sg, sg.startsWith('smp')?sg.slice(3):'smp'+sg]){ const g=(await V(v.address,v.message,x)).state; if(g!==want) bad.push(v.type+' '+g); } }
      for(const v of [...VG.full,...VG.proof_of_funds]) for(const sg of v.bip322_signatures){ n++; for(const x of [sg, /^(ful|pof)/.test(sg)?sg.slice(3):sg]){ const g=(await V(v.address,v.message,x)).state; if(g!=='cannot') bad.push(v.type+' full '+g+(x===sg?'':' (no prefix)')); } }
      for(const v of [...VB.error,...VG.error]){ n++; const g=(await V(v.address,v.message,v.signature)).state; if(g==='valid') bad.push('error case '+v.description); }
      ok(n===59&&bad.length===0,'signed message: all '+n+' official BIP-322 vectors give the right result, with and without the prefix ('+(bad.join('; ')||'no mismatches')+')'); }
    for(const sg of SH){ r=await V(W1,'Hello World',sg); ok(r.state==='valid','signed message: BIP-322 simple P2WPKH "Hello World" (official vector, '+sg.slice(3,10)+'...)'); }
    r=await V(W1,'Hello World',SH[0].slice(3)); ok(r.state==='valid'&&/without the smp prefix/.test(r.text),'signed message: a BIP-322 signature without the smp prefix is read as simple');
    r=await V(W1,'Wrong message that was not signed',SE); ok(r.state==='invalid','signed message: official vector, wrong message is NOT VALID');
    r=await V(...TR); ok(r.state==='valid'&&/BIP-322 simple, Taproot/.test(r.text),'signed message: BIP-322 simple Taproot (official vector)');
    r=await V(TR[0],'No prefix fallback!',TR[2]); ok(r.state==='invalid','signed message: Taproot with another message is NOT VALID');
    r=await V(W1,'','smpAA=='); ok(r.state==='invalid','signed message: an empty witness is NOT VALID (official vector)');
    r=await V(W1,'','not-valid-base64!!!'); ok(r.state==='error'&&/not valid base64/.test(r.text),'signed message: not base64 is refused');
    r=await V(W1,'','fooAA=='); ok(r.state==='error','signed message: an unknown prefix is refused');
    r=await V(W1,'',''); ok(r.state==='error'&&r.text==='Paste the signature.','signed message: an empty signature is refused');
    r=await V('bc1qp0ahvfh83088w49k405szqgg4f3pptr7p2g06tdxfjcd40z4lh4q95lsz9','',SE); ok(r.state==='cannot'&&/single-key addresses only/.test(r.text),'signed message: a multisig (P2WSH) address is "cannot check", never valid');
    r=await V('bc1pyrgrm6cu6n54jrvkdjd9rvyd3xfyu84s2623awu2srn6mxhscwpsm5644w','incorrect prefix','fulAUDZwFXUp+adN+/UZj5dVrGAbB3zKs1Vcalz5fCF9srxS63eSWNGvH1NYbrBkPt1BJDUyWUz9zgUxfc63/QheT6M'); ok(r.state==='cannot'&&/“full” signature/.test(r.text),'signed message: a "full" signature is "cannot check"');
    r=await V(TR[0],'x',CORE[2]); ok(r.state==='cannot'&&/do not use the classic signature format/.test(r.text),'signed message: a classic signature for a Taproot address is "cannot check"');
    r=await V('hello','x',CORE[2]); ok(r.state==='error','signed message: not an address');
    // the page itself: fill the boxes, press VERIFY SIGNATURE
    const box=ts.$('sigBox'), btn=ts.$('sigBtn'); ok(!!box&&box.closest('#cardTools')&&/READ ONLY/.test(box.querySelector('summary').textContent)&&btn.textContent==='VERIFY SIGNATURE'&&!btn.classList.contains('secondary')&&/never signs/.test(box.textContent),'signed message: a READ ONLY box in Extra tools with a gold VERIFY SIGNATURE button');
    ts.$('sigAddr').value=CORE[0]; ts.$('sigMsg').value=CORE[1]; ts.$('sigSig').value=CORE[2]; r=await ts.w.verifyMessageUi(); ok(r.state==='valid'&&ts.$('sigStatus').className==='status ok'&&/^VALID/.test(ts.$('sigStatus').textContent),'signed message: VALID shows in green');
    ts.$('sigMsg').value=CORE[1]+'\n'; r=await ts.w.verifyMessageUi(); ok(r.state==='valid'&&ts.$('sigStatus').className==='status warn'&&/^VALID, after a small change/.test(ts.$('sigStatus').textContent),'signed message: a match only after a small change shows in amber, not green');
    ok(/\n  \.status\.warn \{ color: var\(--warn-text\); \}/.test(html),'signed message: the amber is the warning colour');
    ts.$('sigMsg').value='changed'; ts.$('sigMsg').dispatchEvent(new ts.w.Event('input')); ok(ts.$('sigStatus').textContent==='','signed message: editing a box clears the old result');
    r=await ts.w.verifyMessageUi(); ok(ts.$('sigStatus').className==='status bad'&&/^NOT VALID/.test(ts.$('sigStatus').textContent),'signed message: NOT VALID shows in red');
    ts.$('sigAddr').value='bc1qp0ahvfh83088w49k405szqgg4f3pptr7p2g06tdxfjcd40z4lh4q95lsz9'; ts.$('sigSig').value=SE; r=await ts.w.verifyMessageUi(); ok(ts.$('sigStatus').className==='status'&&/^CANNOT CHECK/.test(ts.$('sigStatus').textContent),'signed message: "cannot check" is neither green nor red');
    ts.$('sigAddr').value=''; ts.$('sigSig').value=''; ts.$('sigMsg').value='-----BEGIN BITCOIN SIGNED MESSAGE-----\n'+CORE[1]+'\n-----BEGIN BITCOIN SIGNATURE-----\n'+CORE[0]+'\n'+CORE[2]+'\n-----END BITCOIN SIGNATURE-----\n';
    r=await ts.w.verifyMessageUi(); ok(r.state==='valid'&&ts.$('sigAddr').value===CORE[0]&&ts.$('sigMsg').value===CORE[1]&&ts.$('sigSig').value===CORE[2]&&/^Read the address, message and signature from the signed-message block\.\nVALID/.test(ts.$('sigStatus').textContent),'signed message: a pasted signed-message block fills the three boxes and is checked');
    // a block never replaces an address (or signature) the user typed
    const BLOCK='-----BEGIN BITCOIN SIGNED MESSAGE-----\n'+CORE[1]+'\n-----BEGIN BITCOIN SIGNATURE-----\n'+CORE[0]+'\n'+CORE[2]+'\n-----END BITCOIN SIGNATURE-----\n';
    ts.$('sigAddr').value=W1; ts.$('sigSig').value=''; ts.$('sigMsg').value=BLOCK; r=await ts.w.verifyMessageUi();
    ok(r.state==='error'&&ts.$('sigAddr').value===W1&&ts.$('sigMsg').value===BLOCK&&ts.$('sigStatus').className==='status bad'&&/^NOT CHECKED: the signed-message block is for mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB, not for the address you typed \(bc1q9vza/.test(ts.$('sigStatus').textContent),'signed message: a block for another address is NOT CHECKED and changes nothing you typed');
    ts.$('sigAddr').value=''; ts.$('sigSig').value=SE; ts.$('sigMsg').value=BLOCK; r=await ts.w.verifyMessageUi(); ok(r.state==='error'&&/has a different signature from the one you typed/.test(ts.$('sigStatus').textContent)&&ts.$('sigSig').value===SE,'signed message: a block with another signature than the one typed is NOT CHECKED');
    ts.$('sigAddr').value=CORE[0].toLowerCase()===CORE[0]?CORE[0]:CORE[0]; ts.$('sigSig').value=''; ts.$('sigMsg').value=BLOCK; r=await ts.w.verifyMessageUi(); ok(r.state==='valid','signed message: a block for the same address as typed is checked');
    ts.$('sigAddr').value=''; ts.$('sigSig').value=''; ts.$('sigMsg').value='-----BEGIN BITCOIN SIGNED MESSAGE----- \r\n'+CORE[1]+'\r\n-----BEGIN SIGNATURE-----\r\nVersion: Bitcoin-qt (1.0)\r\nAddress: '+CORE[0]+'\r\n\r\n'+CORE[2]+'\r\n-----END BITCOIN SIGNED MESSAGE-----';
    r=await ts.w.verifyMessageUi(); ok(r.state==='valid'&&ts.$('sigAddr').value===CORE[0],'signed message: a block with Version: and Address: header lines (and Windows line breaks) is read');
    ts.w.clearSig(); ok(['sigAddr','sigMsg','sigSig','sigStatus'].every(id=>(ts.$(id).value||ts.$(id).textContent||'')===''),'signed message: CLEAR empties the box');
    ok(!/signMessage|function sign[A-Z]|privateKey/.test((html.match(/\/\/ ===== Verify a signed message[\s\S]*?function clearSig/)||[''])[0]),'signed message: the code only verifies (nothing that signs)'); }
  { // v2.3.0 Keystone dice rules: every 6 counts as 0, 50 / 100 rolls or more, at most 256
    const tk=load(); await tk.ready(); const WL=tk.w.eval('WORDLIST'), bits=b=>[...b].map(x=>x.toString(2).padStart(8,'0')).join('');
    const mnK=(rolls,wc)=>{ const ent=nc.createHash('sha256').update(rolls.replace(/6/g,'0')).digest().subarray(0,wc===24?32:16), cs=bits(nc.createHash('sha256').update(ent).digest()).slice(0,ent.length/4); return (bits(ent)+cs).match(/.{11}/g).map(b=>WL[parseInt(b,2)]).join(' '); };
    const rules=v=>{ tk.$('diceRules').value=v; tk.$('diceRules').dispatchEvent(new tk.w.Event('change')); };
    ok(tk.$('rulesRow').style.display===''&&tk.$('diceRules').value==='std'&&[...tk.$('diceRules').options].map(o=>o.textContent).join('|')==='SeedSigner and Coldcard|Keystone'&&tk.$('rulesNote').textContent==='','Keystone: a Dice rules menu, SeedSigner and Coldcard by default');
    rules('keystone'); ok(tk.$('rulesNote').textContent==='each 6 counts as 0; 50 to 256 rolls'&&tk.$('lenNote').textContent==='50 to 256 dice rolls','Keystone: the menu and the length line say each 6 counts as 0, 50 to 256 rolls');
    const R50='65515223131652132161133154444123616466443112153441'; tk.set(R50); await tk.w.generate(); eq(tk.$('genResult').textContent.split('\n')[0],'tip toward alcohol rule pave weird quarter guilt orange vacuum blast maple','Keystone: 50 rolls with 6 as 0 (vector from an independent Python BIP39)');
    ok(tk.$('countNote').textContent==='Keystone rules: every 6 counts as 0 and all 50 rolls are hashed, so a Keystone wallet makes the same words from these rolls.','Keystone: the note says a Keystone wallet makes the same words');
    { let okAll=true; for(let k=0;k<6;k++){ const n=50+nc.randomInt(207), r=rnd(n,6); tk.set(r); await tk.w.generate(); if(tk.$('genResult').textContent.split('\n')[0]!==mnK(r,12)) okAll=false; } ok(okAll,'Keystone: random 50 to 256 rolls match SHA-256 of the rolls with 6 as 0'); }
    tk.words(24); ok(tk.$('lenNote').textContent==='100 to 256 dice rolls'&&tk.$('bigCount').textContent.endsWith(' / 100'),'Keystone: 24 words need 100 rolls, not 99');
    tk.set(rnd(99,6)); await tk.w.generate(); eq(tk.$('genResult').textContent,'Enter 1 more roll (99 of 100).','Keystone: 99 rolls are one short for 24 words');
    const R100=rnd(100,6); tk.set(R100); await tk.w.generate(); eq(tk.$('genResult').textContent.split('\n')[0],mnK(R100,24),'Keystone: 100 rolls make 24 words from SHA-256 with 6 as 0');
    const R256=rnd(256,6); tk.set(R256); ok(!/remove/.test(tk.$('countNote').textContent),'Keystone: 256 rolls are allowed'); await tk.w.generate(); eq(tk.$('genResult').textContent.split('\n')[0],mnK(R256,24),'Keystone: 256 rolls make 24 words');
    { const ow=tk.w.document.querySelectorAll('#wordGrid .wcell.pv').length; tk.set(R256+'3'); await new Promise(r2=>setTimeout(r2,60)); ok(!tk.w.guideCanNext(2)&&tk.d.querySelectorAll('#wordGrid .wcell.pv').length===0,'Keystone: above 256 rolls the guide does not go on and no preview words show'); tk.set(R256); ok(tk.w.guideCanNext(2),'Keystone: 256 rolls let the guide go on'); }
    { const pc=tk.st.printed; tk.w.printRollSheet(); const txt=tk.st.printHTML; tk.w.dispatchEvent(new tk.w.Event('afterprint')); ok(tk.st.printed===pc+1&&/Keystone dice rules \(each 6 counts as 0, at most 256 rolls\): a Keystone wallet makes the same words\./.test(txt)&&/Dice rules: Keystone \(each 6 counts as 0\)/.test(txt)&&!/SeedSigner/.test(txt)&&/100 rolls for a 24-word seed/.test(txt),'Keystone: the roll sheet names the Keystone rules and does not mention SeedSigner or Coldcard'); }
    tk.set(R256+'3'); ok(tk.$('countNote').textContent==='Keystone takes at most 256 rolls: remove 1.'&&tk.$('bigSub').textContent==='Keystone takes at most 256: remove 1'&&/short/.test(tk.$('bigCount').className),'Keystone: 257 rolls are one too many');
    await tk.w.generate(); ok(/^Keystone takes at most 256 rolls\. Remove 1 \(257 of 256\), or choose SeedSigner and Coldcard dice rules\.$/.test(tk.$('genResult').textContent)&&!tk.w.hasSeed(),'Keystone: FORGE refuses 257 rolls and says why');
    tk.words(12); const R60=rnd(60,6); tk.set(R60); await tk.w.generate(); const made=tk.$('genResult').textContent.split('\n')[0];
    rules('std'); ok(!tk.w.hasSeed()&&/You changed the rolls/.test(tk.$('genResult').textContent),'Keystone: changing the dice rules after FORGE clears the words');
    await tk.w.generate(); ok(tk.$('genResult').textContent.split('\n')[0]!==made||!/6/.test(R60),'Keystone: the standard rules give different words when there is a 6');
    rules('keystone'); tk.set(R60); await new Promise(r=>setTimeout(r,30)); tk.set(R60.slice(0,55)); await new Promise(r=>setTimeout(r,60));
    ok([...tk.d.querySelectorAll('#wordGrid .wcell span')].map(x=>x.textContent).join(' ')===mnK(R60.slice(0,55),12),'Keystone: the grey preview words follow the Keystone rules');
    tk.set(R60); await tk.w.generate(); await tk.w.showExplain(); const ex=tk.$('exOut').textContent; ok(/Keystone dice rules: every 6 is written as 0/.test(ex)&&/These words match the seed above/.test(ex),'Keystone: How your seed was made shows the 6-as-0 step and matches');
    tk.st.blob=null; tk.w.downloadSeed(); const dl=await blobText(tk.w,tk.st.blob); ok(/Dice rules: Keystone \(each 6 counts as 0 before hashing\)/.test(dl),'Keystone: the downloaded file says Keystone rules were used');
    tk.mode('coin'); ok(tk.$('rulesRow').style.display==='none'&&!tk.w.keystoneOn()&&tk.$('lenNote').textContent==='128 coin flips or more','Keystone: the menu is hidden and off in coin mode');
    tk.mode('dice'); ok(tk.$('rulesRow').style.display===''&&tk.w.keystoneOn(),'Keystone: back to dice, the choice is kept');
    tk.w.setMethod('words'); ok(tk.$('rulesRow').style.display==='none','Keystone: the menu is hidden in Word draw'); tk.w.setMethod('dice'); }
  ok(/#cardGen \.gen-right \{ grid-column: 2; grid-row: 1 \/ span 2;[^}]*position: sticky/.test(html)&&/#cardGen \.gen-bottom \{ grid-column: 1; grid-row: 2;/.test(html),'layout: the sticky Your seed panel sits beside all the content and never slides over it (QR codes were hidden behind it)');
  { const tg=load(); await tg.ready(); const g=tg.$('startGate'), body=g.querySelector('.sg-body'), go=tg.$('sgGo');
    ok(!!body&&!body.contains(go)&&go.parentNode.classList.contains('sg-box')&&body.parentNode.classList.contains('sg-box'),'start notice: the I understand button sits outside the scrolling text, so it is always on screen (phones could not reach it)');
    ok(/#startGate \.sg-box \{[^}]*max-height: 100%; overflow: hidden; display: flex; flex-direction: column;/.test(html)&&/#startGate \.sg-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/.test(html)&&/#startGate \.sg-go, #startGate \.sg-foot \{ flex: none; \}/.test(html),'start notice: the box fits the screen, only the text scrolls, the button and footer never shrink or scroll away');
    ok(/#startGate \{ position: fixed; top: 0; right: 0; bottom: 0; left: 0;/.test(html)&&!/inset:/.test(html),'start notice: covers the screen with top/right/bottom/left (the inset shorthand fails on iOS before 14.1)');
    ok(tg.d.body.classList.contains('js-ok')&&/\n  #startGate \{ position: fixed;[^}]*display: none;/.test(html)&&/body\.js-ok #startGate \{ display: flex; \}/.test(html),'start notice: only shown once the script has run, so a phone that blocks scripts shows the red warning instead of a dead button');
    ok((html.match(/\n  #startGate \{/g)||[]).length===1&&!/#startGate[^{]*\{[^}]*display:[^;}]*!important/.test(html),'start notice: nothing forces the notice to show when the script has not run');
    ok(body.getAttribute('tabindex')==='0'&&/things to know/.test(body.getAttribute('aria-label')||''),'start notice: the scrolling text is reachable by keyboard and named'); }
  ok(/\.tabpanel \[id\] \{ scroll-margin-top: 84px; \}/.test(html),'layout: every section keeps clear of the sticky tab bar when the page jumps to it');
  ok(/@media \(min-width: 861px\) \{ #cardGen \.gen-right \{ max-height: calc\(100vh - 92px\); overflow-y: auto;/.test(html),'layout: a tall Your seed panel scrolls inside itself so its bottom buttons (COPY, DOWNLOAD) stay reachable');
  ok(/#qrBox, #sqBox, #msQrBox \{ scroll-margin: 80px 0 20px; \}/.test(html),'layout: QR boxes keep clear of the sticky tab bar when scrolled to');
  { const tq=load(); await tq.ready(); const seen=[]; const spy=(id)=>{const el=tq.$(id); el.scrollIntoView=(o)=>seen.push([id,o&&o.block]);};
    ['qrBox','sqBox'].forEach(spy); tq.w.document.getElementById('wDescR').textContent='wpkh(x)'; tq.w.showQr('wDescR','receive descriptor');
    ok(seen.length===1&&seen[0][0]==='qrBox'&&seen[0][1]==='nearest','QR: showing the watch-only QR scrolls it fully into view');
    tq.set(rnd(50)); await tq.w.generate(); tq.w.showSeedQr('seedqr'); ok(seen.length===2&&seen[1][0]==='sqBox'&&seen[1][1]==='nearest','QR: showing the SeedQR scrolls it fully into view'); }
  ok(/\.tabs button\[aria-selected="true"\], body\.light \.tabs button\[aria-selected="true"\][^{]*\{[^}]*border-bottom-color: var\(--gold\)/.test(html),'tabs: the selected tab is marked with a gold underline in both themes');
  { const td=load(); await td.ready(); ok(td.d.body.classList.contains('dice-wait')&&!!td.$('startGate'),'dice: held back while the notice is open');
    td.w.startGateClose(); ok(!td.d.body.classList.contains('dice-wait'),'dice: released when the notice is closed with the button');
    const te=load(); await te.ready(); te.d.dispatchEvent(new te.w.KeyboardEvent('keydown',{key:'Escape'})); ok(!te.d.body.classList.contains('dice-wait'),'dice: released when the notice is closed with Escape');
    const tn=load(); await tn.ready(); tn.$('startGate').remove(); tn.d.dispatchEvent(new tn.w.Event('DOMContentLoaded')); ok(!tn.d.body.classList.contains('dice-wait'),'dice: not held back if there is no notice'); }
{ const tf=load({focusSpy:true}); await tf.ready(); await new Promise(r=>setTimeout(r,100));
    ok(tf.st.focus.some(x=>x[0]==='sgGo'&&x[1]&&x[1].preventScroll===true)&&!tf.st.focus.some(x=>x[0]==='rolls'),'opening the page focuses the notice button (not the rolls box) without scrolling');
    tf.st.focus.length=0; tf.w.startGateClose(); const f=tf.st.focus.find(x=>x[0]==='rolls'); ok(!!f&&f[1]&&f[1].preventScroll===true&&!tf.$('startGate'),'closing the notice removes it and focuses the rolls box without scrolling the page down to it');
    { tf.st.focus.length=0; tf.w.matchMedia=q=>({matches:/pointer:\s*coarse/.test(q)}); tf.w.startGateClose(); ok(!tf.st.focus.some(x=>x[0]==='rolls'),'closing the notice on a phone or tablet (touch pointer) does not focus the rolls box, so the on-screen keyboard stays down');
      tf.st.focus.length=0; tf.w.matchMedia=()=>({matches:false}); tf.w.startGateClose(); ok(tf.st.focus.some(x=>x[0]==='rolls'),'closing the notice with a mouse still focuses the rolls box'); delete tf.w.matchMedia; }
    { const tg=load(); await tg.ready(); const g=tg.$('startGate'); ok(!!g&&g.getAttribute('role')==='dialog'&&g.getAttribute('aria-modal')==='true'&&/educational tool/.test(g.textContent)&&/not been independently audited/.test(g.textContent)&&g.querySelectorAll('.sg-item').length===3&&/swap files, hibernation/.test(g.textContent)&&/Clipboard history/.test(g.textContent)&&/restart the computer/.test(g.textContent),'notice: educational, not audited, and the three warnings with what to do');
      ok(g.querySelectorAll('.sg-fix').length===3&&/I understand, let's go/.test(tg.$('sgGo').textContent),'notice: each warning has a fix and one button closes it');
      tg.d.dispatchEvent(new tg.w.KeyboardEvent('keydown',{key:'Escape'})); ok(!tg.$('startGate'),'notice: Escape closes it');
      const t5=load(); await t5.ready(); ok(!!t5.$('startGate'),'notice: shows again each time the file is opened');
      // v2.3.0: once per browser session while offline, every load while online; END SESSION forgets it
      ok(tg.w.sessionStorage.length===0,'notice: closed while online, nothing is stored');
      { const to=load({offline:true}); await to.ready(); to.w.startGateClose(); ok(to.w.sessionStorage.getItem('voidforge-ack')==='1'&&to.w.sessionStorage.length===1,'notice: closed while offline, a single "1" goes in this tab\'s session storage and nothing else'); }
      { const ta=load({offline:true,ack:true,focusSpy:true}); await ta.ready(); ok(!ta.$('startGate')&&!ta.d.body.classList.contains('dice-wait')&&!ta.d.body.classList.contains('sg-skip')&&ta.st.focus.some(x=>x[0]==='rolls'),'notice: offline and already read in this session, it does not show again and the dice are ready');
        const tb=load({offline:true}); await tb.ready(); ok(!!tb.$('startGate')&&tb.d.body.classList.contains('dice-wait'),'notice: offline, it still shows the first time in a session');
        const tc2=load({ack:true}); await tc2.ready(); ok(!!tc2.$('startGate')&&tc2.d.body.classList.contains('dice-wait'),'notice: online, it shows on every load even if read before in this session');
        ok(/body\.js-ok\.sg-skip #startGate \{ display: none; \}/.test(html)&&/if\(startGateSkip\(\)\) document\.body\.classList\.add\("sg-skip"\);/.test(html),'notice: when skipped it is hidden from the first paint, so it never flashes');
        const tx=load({offline:true,ack:true}); tx.w.Storage.prototype.getItem=()=>{ throw new Error('blocked'); }; ok(tx.w.ackSeen()===false,'notice: blocked storage counts as not read, so the notice shows'); }
      // END SESSION (MENU)
      { const te=load({confirm:false,offline:true}); await te.ready(); let reloads=0; te.w.endSessionReload=()=>{ reloads++; }; te.w.startGateClose(); te.set(rnd(50,6)); await te.w.generate();
        ok(te.w.endSession()===null&&te.w.hasSeed()&&te.w.sessionStorage.getItem('voidforge-ack')==='1'&&reloads===0,'END SESSION: Cancel keeps everything');
        const b=te.$('endSessionBtn'); ok(!!b&&b.closest('#menuBox')&&b.className==='btn-clear'&&b.textContent==='END SESSION'&&b.previousElementSibling&&b.previousElementSibling.classList.contains('theme-toggle'),'END SESSION: a red button, last in the MENU');
        const t2=load(); await t2.ready(); let r2=0; t2.w.endSessionReload=()=>{ r2++; }; t2.w.startGateClose(); t2.set(rnd(99,6)); t2.words(24); t2.set(rnd(99,6)); await t2.w.generate();
        t2.$('passphrase').value='secret pass'; t2.$('phrase').value='abandon '.repeat(11)+'about'; t2.$('verifyPass').value='x'; t2.$('msAcct').value='7'; t2.$('msN').value='5'; t2.$('bk1').checked=true; t2.$('autoHide').checked=true; t2.$('reuseIn').value='wpkh(xpub)'; t2.$('wpIn').value='zpub';
        t2.st.clip.length=0; const p=t2.w.endSession(); ok(!!p&&typeof p.then==='function','END SESSION: confirmed, it wipes and then reloads');
        ok(!t2.w.hasSeed()&&t2.$('rolls').value===''&&t2.$('passphrase').value===''&&t2.$('phrase').value===''&&t2.$('verifyPass').value===''&&t2.$('reuseIn').value===''&&t2.$('wpIn').value==='','END SESSION: rolls, words, passphrases and every typed box are wiped');
        ok(t2.$('msAcct').value===t2.$('msAcct').defaultValue&&t2.$('msN').value==='3'&&!t2.$('bk1').checked&&!t2.$('autoHide').checked&&t2.d.querySelector('input[name=words][value="12"]').checked,'END SESSION: boxes, ticks and choices go back to how the page opened (so a browser refilling them on reload gets the defaults)');
        ok(t2.w.sessionStorage.getItem('voidforge-ack')===null&&t2.st.clip.includes(''),'END SESSION: forgets that the notice was read and clears the clipboard');
        await p; ok(r2===1,'END SESSION: the page reloads once the clipboard is cleared');
        ok(/function endSessionReload\(\)\{ location\.reload\(\); \}/.test(html),'END SESSION: the reload is a real page reload (the notice shows again, script memory starts fresh)'); }
      ok(/BEFORE YOU MAKE REAL KEYS/.test(tg.$('beforeCard').textContent)&&tg.$('beforeCard').querySelectorAll('.sg-item').length===3&&tg.$('beforeCard').closest('#tp-about')!==null&&/Read before real keys/.test(tg.$('strip').textContent),'the three warnings live in the About tab, reached from the one-line notice'); } }
  { const tc=load(); await tc.ready(); const h=await tc.w.sha256bytes(new TextEncoder().encode('123456'));
    const m24=await tc.w.entropyToMnemonic(h), m12=await tc.w.entropyToMnemonic(h.slice(0,16));
    ok(m24==='mirror reject rookie talk pudding throw happy era myth already payment own sentence push head sting video explain letter bomb casual hotel rather garment'&&m12==='mirror reject rookie talk pudding throw happy era myth already payment owner','Coldcard compatibility: its documented example (rolls 123456) gives the same 24 and 12 words'); }
  // ===== v2.4.0: one-page prints, roll sheet extras, CHECK A BACKUP backups, QR and child prints, dice test, keyboard entry, typo helper, explain an address, summary =====
  { const css=html.slice(0,html.indexOf('</style>'));
    ok(/@page \{ margin: 12mm; \}/.test(css)&&/body\.print-seed > :not\(#printOnly\), body\.print-qr > :not\(#printQr\) \{ display: none !important; \}/.test(css)&&!/body\.print-seed \* \{ visibility: hidden/.test(css)&&!/body\.print-qr \* \{ visibility: hidden/.test(css),'print: everything but the sheet is removed from the layout (display: none), so no blank pages are printed');
    const tp=load(); await tp.ready(); ok(tp.$('printOnly').parentElement===tp.d.body&&tp.$('printQr').parentElement===tp.d.body,'print: both print areas sit directly in the page body, so the rule above leaves only the sheet');
    ok(/print\.test\.mjs/.test(fs.readFileSync(path.join(__dirname,'..','.github','workflows','test.yml'),'utf8')),'print: the one-page print test runs in GitHub'); }
  { const t4=load(); await t4.ready(); const $=t4.$, w=t4.w; w.startGateClose();
    const opts=()=>[...$('rsExtra').options].map(o=>o.value).join();
    const sheet=()=>{ const p0=t4.st.printed; w.printRollSheet(); const r={n:t4.st.printed-p0,cells:t4.st.printCells.slice(),txt:t4.st.printHTML,wide:t4.d.querySelectorAll('#printOnly .ps-roll20').length}; w.dispatchEvent(new w.Event('afterprint')); return r; };
    eq(opts(),'0,10,25,50','roll sheet: the extra-box menu offers none, 10, 25 or 50'); eq($('rsExtra').value,'10','roll sheet: 10 extra boxes by default (as in v2.3.0)');
    for(const [x,n] of [['0',50],['25',75],['50',100]]){ $('rsExtra').value=x; const r=sheet(); ok(r.n===1&&r.cells.length===n&&r.cells[n-1]===String(n)&&(x==='0')===!/Extra rolls \(optional\)/.test(r.txt),'roll sheet: '+x+' extra boxes gives '+n+' boxes in all'+(x==='0'?', with no extra-rolls note':'')); }
    $('diceRules').value='keystone'; $('diceRules').dispatchEvent(new w.Event('change')); ok(opts()==='0,10,25,50,max','roll sheet: with Keystone dice rules the menu adds "Extra up to 256"');
    $('rsExtra').value='max'; let r=sheet(); ok(r.cells.length===256&&r.cells[255]==='256'&&r.wide===2,'roll sheet: Keystone maximum fills the sheet to 256 boxes, in the compact 20-column layout');
    $('wordSel').value='24'; $('wordSel').dispatchEvent(new w.Event('change')); r=sheet(); ok(r.cells.length===256,'roll sheet: Keystone maximum for 24 words is also 256 boxes in all');
    $('rsExtra').value='50'; r=sheet(); ok(r.cells.length===150&&r.wide===0,'roll sheet: Keystone 100 + 50 extra stays in the 10-column layout');
    $('diceRules').value='std'; $('diceRules').dispatchEvent(new w.Event('change')); $('rsExtra').value='max'; $('diceRules').value='keystone'; $('diceRules').dispatchEvent(new w.Event('change')); $('rsExtra').value='max'; $('diceRules').value='std'; $('diceRules').dispatchEvent(new w.Event('change'));
    ok(opts()==='0,10,25,50'&&$('rsExtra').value==='10','roll sheet: leaving Keystone rules removes "up to 256" and goes back to 10 extra boxes');
    t4.mode('coin'); $('rsExtra').value='50'; r=sheet(); ok(r.cells.length===306&&r.wide===2,'roll sheet: 24-word coin sheet with 50 extra (306 boxes) uses the compact layout');
    $('rsExtra').value='25'; eq(w.rsExtraCount(256),25,'roll sheet: without Keystone rules there is no Keystone cap'); }
  { const t5=load(); await t5.ready(); const $=t5.$, w=t5.w; w.startGateClose();
    // Word draw sheet
    let p0=t5.st.printed; w.printWordSheet(); ok(t5.st.printed===p0+1&&t5.st.printCells.length===18&&t5.st.printCells[10]==='11'&&t5.st.printCells[11]==='Flip 1'&&t5.st.printCells[17]==='Flip 7'&&/^VOIDFORGE WORD DRAW SHEET/.test(t5.st.printHTML)&&/as secret as your seed/.test(t5.st.printHTML),'word draw sheet: 11 word boxes and 7 flip boxes for 12 words, with the secret warning'); w.dispatchEvent(new w.Event('afterprint'));
    $('wdLen').value='24'; p0=t5.st.printed; w.printWordSheet(); ok(t5.st.printCells.length===26&&t5.st.printCells[23]==='Flip 1'&&t5.st.printCells[25]==='Flip 3','word draw sheet: 23 word boxes and 3 flip boxes for 24 words'); w.dispatchEvent(new w.Event('afterprint')); $('wdLen').value='12';
    ok($('printOnly').textContent===''&&!t5.d.body.classList.contains('print-seed'),'word draw sheet: wiped after printing');
    // dice test
    t5.set(rnd(50,6)); const before=$('rolls').value; $('diceTest').checked=true; t5.st.confirms=0; w.diceTestToggle();
    ok(t5.st.confirms===1&&$('rolls').value===''&&$('forgeBtn').disabled&&$('diceTestBan').style.display===''&&$('rollStats').open,'dice test: turning it on asks, clears the rolls, turns FORGE off and shows the banner');
    t5.set(rnd(40,6)); ok(/^40 rolls tested: /.test($('diceTestNote').textContent)&&$('countNote').textContent===''&&$('bitsNote').textContent===''&&$('bigSub').textContent==='Dice test: no seed is made.'&&$('rollCount').textContent==='40 rolls tested','dice test: the notes say what the test found, and nothing about seeds');
    ok(t5.d.querySelectorAll('#wordGrid .wcell.pv').length===0,'dice test: no words are previewed');
    t5.st.alerts.length=0; await w.generate(); ok(!w.hasSeed()&&/dice test is on/.test(t5.st.alerts.join('|')),'dice test: FORGE refuses while the test is on');
    t5.set('1'.repeat(120)); ok(/the checks above found a problem/.test($('diceTestNote').textContent),'dice test: an obviously unfair run is called a problem');
    t5.set('123456'.repeat(4)); ok(/^24 rolls so far\. .*starts at 30/.test($('diceTestNote').textContent),'dice test: below 30 rolls it asks for more');
    $('diceTest').checked=false; w.diceTestToggle(); ok($('rolls').value===''&&!$('forgeBtn').disabled&&$('diceTestBan').style.display==='none'&&$('diceTestNote').textContent==='','dice test: turning it off clears the test rolls and turns FORGE back on');
    const t6=load({confirm:false}); await t6.ready(); t6.w.startGateClose(); t6.set('123'); t6.$('diceTest').checked=true; t6.w.diceTestToggle(); ok(!t6.$('diceTest').checked&&t6.$('rolls').value==='123'&&!t6.$('forgeBtn').disabled,'dice test: Cancel keeps the rolls and leaves the test off');
    // keyboard entry on the tap buttons
    const key=(k)=>{ const b=t5.d.querySelector('#tapRow button'); const e=new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true}); b.dispatchEvent(e); return e.defaultPrevented; };
    t5.set(''); key('3'); key('6'); const k7=key('7'); key('1'); const kb=key('Backspace'); key('Tab');
    ok($('rolls').value==='36'&&!k7&&kb,'keyboard: with a tap button focused, 1 to 6 add rolls, other keys are ignored, Backspace undoes');
    const ctrl=new w.KeyboardEvent('keydown',{key:'2',ctrlKey:true,bubbles:true}); t5.d.querySelector('#tapRow button').dispatchEvent(ctrl); eq($('rolls').value,'36','keyboard: Ctrl+number is left to the browser');
    t5.set(''); t5.mode('coin'); key('1'); key('0'); key('2'); eq($('rolls').value,'10','keyboard: coin mode takes only 1 and 0');
    ok(/press 1 on the keyboard; Backspace undoes the last one/.test(t5.d.querySelector('#tapRow button').title),'keyboard: the tap buttons say the keys work'); }
  { const t7=load(); await t7.ready(); const $=t7.$, w=t7.w; w.startGateClose();
    // typo helper and 4-letter forms
    let r=await w.checkPhrase('abandon '.repeat(10)+'abandn about'); ok(!r.ok&&r.msg==='Unknown word: abandn (word 11): closest BIP39 word abandon. Check it on your backup.','typo helper: one unknown word gets the closest BIP39 word');
    r=await w.checkPhrase('abandon '.repeat(10)+'zzzzz xyzzy'); ok(!r.ok&&/^Unknown words: zzzzz \(word 11\): no BIP39 word is close; xyzzy \(word 12\): closest BIP39 word dizzy\. Check them on your backup\.$/.test(r.msg),'typo helper: several unknown words are listed together');
    r=await w.checkPhrase('aban '.repeat(11)+'abou'); ok(r.ok&&r.expanded&&r.mnemonic==='abandon '.repeat(11)+'about'&&/12 words read from the first letters/.test(r.msg),'4-letter forms (as on a metal plate) are read as the full words');
    r=await w.checkPhrase('abandon '.repeat(11)+'abou'); ok(r.ok&&/\(1 word read from the first letters\)/.test(r.msg),'one 4-letter word says "1 word"');
    r=await w.checkPhrase('abandon '.repeat(12)); ok(!r.ok&&/^Checksum failed\. Every word is a BIP39 word, so one is probably wrong, missing or out of order: Reforge in EXTRA TOOLS can search for it\.$/.test(r.msg),'typo helper: a failed checksum points to Reforge');
    eq(w.wordFromPrefix('aba'),null,'4-letter forms: 3 letters are never expanded'); eq(w.wordFromPrefix('abandonx'),null,'4-letter forms: text longer than the word is not expanded');
    eq(w.closestWords('adress').join(),'address,dress','typo helper: closest words by one edit'); eq(w.closestWords('abandoon').join(),'abandon','typo helper: an extra letter'); eq(w.wordDistance('abandon','abnadon',3),1,'typo helper: two swapped letters count as one edit');
    $('phrase').value='aban '.repeat(11)+'abou'; await w.verify(); eq($('phrase').value,'abandon '.repeat(11)+'about','VERIFY writes the full words back into the box after reading 4-letter forms');
    // CHECK A BACKUP backups
    const mn='legal winner thank year wave sausage worth useful legal winner thank yellow'; $('phrase').value=mn; await w.openWalletView(mn,'');
    w.wvAbbr(); ok($('wvAbbrGrid').classList.contains('on')&&[...t7.d.querySelectorAll('#wvAbbrGrid .wtxt')].map(e=>e.textContent).join(' ')===mn.split(' ').map(x=>x.slice(0,4)).join(' ')&&$('wvAbbrBtn').textContent==='HIDE FIRST 4 LETTERS','check: SHOW FIRST 4 LETTERS shows the first 4 letters of the checked words');
    w.wvAbbr(); ok(!$('wvAbbrGrid').classList.contains('on')&&$('wvAbbrGrid').textContent===''&&$('wvAbbrBtn').textContent==='SHOW FIRST 4 LETTERS','check: pressed again, the letters are wiped from the screen');
    let p0=t7.st.printed; w.printSeed('check'); ok(t7.st.printed===p0+1&&t7.st.printCells.join(' ')===mn.split(' ').map((x,i)=>String(i+1).padStart(2,'0')+x).join(' ')&&/Master fingerprint: [0-9a-f]{8}/.test(t7.st.printHTML)&&/Passphrase used: NO/.test(t7.st.printHTML)&&/against your first backup/.test(t7.st.printHTML)&&!/Rolls \/ flips/.test(t7.st.printHTML),'check: PRINT WORDS prints the checked words with their fingerprint'); w.dispatchEvent(new w.Event('afterprint'));
    p0=t7.st.printed; w.printStamp('check'); ok(t7.st.printed===p0+1&&t7.st.printCells[0]==='01LEGA'&&/^VOIDFORGE STAMP SHEET/.test(t7.st.printHTML),'check: PRINT STAMP SHEET prints the checked words as 4 capital letters'); w.dispatchEvent(new w.Event('afterprint'));
    t7.st.alerts.length=0; p0=t7.st.printed; w.printSeedQr('check'); ok(t7.st.printed===p0&&/Press SHOW SEEDQR/.test(t7.st.alerts.join('|')),'check: PRINT THIS QR needs a shown SeedQR');
    w.wvSeedQr('compact'); w.printSeedQr('check'); ok(t7.st.printed===p0+1&&/^VOIDFORGE COMPACTSEEDQR \(12 words, 21 x 21 squares\)/.test(t7.st.printQrText)&&/<svg/.test(t7.st.printQrHTML),'check: PRINT THIS QR prints the shown CompactSeedQR of the checked words'); w.dispatchEvent(new w.Event('afterprint'));
    w.printSqGuide('check'); ok(/HAND-COPY GUIDE \(12 words, 21 x 21 squares\)/.test(t7.st.printQrText)&&/Row 21: /.test(t7.st.printQrText),'check: the hand-copy guide is printed for the checked words'); w.dispatchEvent(new w.Event('afterprint'));
    w.printSqBlank('check'); ok(/^VOIDFORGE BLANK 21 x 21 GRID FOR COMPACTSEEDQR/.test(t7.st.printQrText),'check: the blank grid matches the shown code'); w.dispatchEvent(new w.Event('afterprint'));
    w.wvSeedQrHide(); t7.st.alerts.length=0; p0=t7.st.printed; w.printSqBlank('check'); ok(t7.st.printed===p0&&t7.st.alerts.length===1,'check: after HIDE nothing SeedQR-related prints');
    w.wvAbbr(true); w.clearWalletView(); t7.st.alerts.length=0; p0=t7.st.printed; w.printSeed('check'); w.printStamp('check');
    ok(t7.st.printed===p0&&t7.st.alerts.length===2&&/Check a seed phrase first/.test(t7.st.alerts[0])&&$('wvAbbrGrid').textContent==='','check: when the checked words are cleared, nothing prints and the letters are gone');
    // explain an address
    const X=async a=>{ $('checkAddr').value=a; await w.explainAddrUi(); return [$('addrExplain').className,$('addrExplain').textContent]; };
    let [c,x]=await X('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'); ok(c==='status ok'&&/^Native SegWit address \(P2WPKH\) on Bitcoin mainnet .*Nobody can spend from it with the address alone\.In the dictionary: Native SegWit · P2WPKH$/.test(x),'explain: a bc1q address');
    [c,x]=await X('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'); ok(c==='status ok'&&/^Taproot address \(P2TR\)/.test(x),'explain: a bc1p address');
    [c,x]=await X('bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'); ok(/^SegWit script address \(P2WSH\)/.test(x),'explain: a P2WSH address');
    [c,x]=await X('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'); ok(/on testnet or signet \(practice coins, worthless\)/.test(x),'explain: testnet');
    [c,x]=await X('BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'); ok(c==='status ok','explain: an all-capitals bc1 address is valid');
    [c,x]=await X('bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); ok(c==='status bad'&&/mixes capital and small letters/.test(x),'explain: mixed case is refused');
    [c,x]=await X('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv'); ok(c==='status bad'&&/checksum does not match/.test(x),'explain: a typo in a bc1 address');
    [c,x]=await X('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'); ok(/^Legacy address \(P2PKH\) on Bitcoin mainnet/.test(x),'explain: a 1 address');
    [c,x]=await X('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'); ok(/^Script address \(P2SH\) on Bitcoin mainnet/.test(x),'explain: a 3 address');
    [c,x]=await X('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn'); ok(/^Legacy address \(P2PKH\) on testnet/.test(x),'explain: an m address is testnet');
    [c,x]=await X('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3'); ok(c==='status bad'&&/checksum does not match/.test(x),'explain: a typo in a 1 address');
    [c,x]=await X('bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.1'); ok(c==='status ok'&&/payment request \(BIP-21\)/.test(x)&&/BIP21/.test(x),'explain: a bitcoin: link');
    [c,x]=await X('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'); ok(c==='status bad'&&/PRIVATE KEY \(WIF\)/.test(x),'explain: a private key is called out');
    [c,x]=await X('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'); ok(c==='status warn'&&/extended PUBLIC key/.test(x),'explain: an xpub is explained as public but not an address');
    [c,x]=await X('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'); ok(c==='status bad'&&/extended PRIVATE key/.test(x),'explain: an xprv is called out');
    [c,x]=await X('abandon '.repeat(11)+'about'); ok(c==='status bad'&&/SEED WORDS/.test(x),'explain: seed words are called out');
    [c,x]=await X('wpkh([d34db33f/84h/0h/0h]xpub6/0/*)'); ok(c==='status warn'&&/descriptor/.test(x),'explain: a descriptor');
    [c,x]=await X('lnbc1pvjluezsp5zyg3zyg3zyg'); ok(c==='status warn'&&/Lightning invoice/.test(x),'explain: a Lightning invoice');
    [c,x]=await X('hello'); ok(c==='status bad'&&/Not a Bitcoin address/.test(x),'explain: other text');
    [c,x]=await X(''); ok(c==='status'&&x==='','explain: an empty box shows nothing');
    const sp=(await (async()=>{ const seed=await w.mnemonicToSeed('abandon '.repeat(11)+'about',''); return w.spAddressFromSeed(seed,'main',0); })());
    [c,x]=await X(sp); ok(c==='status ok'&&/^Silent Payment address \(BIP-352\) on Bitcoin mainnet/.test(x),'explain: a Silent Payment address');
    [c,x]=await X(sp.slice(0,-1)+(sp.endsWith('q')?'p':'q')); ok(c==='status bad'&&/Silent Payment address/.test(x),'explain: a typo in a Silent Payment address');
    // dictionary links
    const names=new Set(w.eval('DICT').map(e=>e[0])), targets=[...html.matchAll(/dictGo\('([^']+)'\)/g)].map(m=>m[1]), found=[...html.matchAll(/terms: (?:terms\.concat\()?\[([^\]]*)\]/g)].flatMap(m=>[...m[1].matchAll(/"([^"]+)"/g)].map(y=>y[1]));
    ok(targets.length===10&&found.length>25&&targets.concat(found).every(n=>names.has(n)),'dictionary links: every name the guide and the explanations link to is a dictionary entry');
    [c,x]=await X('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'); $('addrExplain').querySelector('button.dict-link').click();
    ok(!$('tp-about').classList.contains('tab-off')&&$('dictBox').open&&t7.d.querySelector('.dict-item.dict-hit dt').textContent==='Native SegWit'&&t7.d.querySelectorAll('.dict-hit').length===1,'dictionary links: a link opens the dictionary at that entry');
    ok(t7.d.querySelectorAll('#whatBox .what-list li').length===10&&t7.d.querySelectorAll('#whatBox .tag-secret').length===6&&t7.d.querySelectorAll('#whatBox .tag-public').length===3,'"What can someone do with this?": 10 items, 6 secret, 3 public, 1 private'); }
  { const t8=load(); await t8.ready(); const $=t8.$, w=t8.w; w.startGateClose();
    t8.set('1'.repeat(25)+'2'.repeat(25)); await w.generate(); await w.passWork; await new Promise(r=>setTimeout(r,50));
    ok(/^This seed: 12 words from 50 dice rolls, SeedSigner and Coldcard dice rules, passphrase none, fingerprint [0-9a-f]{8}\.$/.test($('sumLine').textContent),'summary: one line at the top of the checklist says how the seed was made');
    let p0=t8.st.printed; w.printSummary(); const words=$('genResult').textContent.split('\n')[0].split(' ');
    ok(t8.st.printed===p0+1&&/^VOIDFORGE SEED SUMMARY/.test(t8.st.printHTML)&&/Seed length: 12 words\nMade from: 50 dice rolls, SeedSigner and Coldcard dice rules\nStrength: the words hold 128 bits of randomness \(about 129 bits went in/.test(t8.st.printHTML)&&/Master fingerprint: [0-9a-f]{8}/.test(t8.st.printHTML)&&/First receive address \(BIP84/.test(t8.st.printHTML)&&words.every(x=>!new RegExp('\\b'+x+'\\b').test(t8.st.printHTML.replace(/Made with VOIDFORGE.*/,'').replace(/[A-Z][a-z]+.*?:/g,''))),'summary: PRINT SUMMARY SHEET prints how the seed was made, the fingerprint and first address, and no words');
    ok($('bk4').checked,'summary: printing it ticks the checklist'); w.dispatchEvent(new w.Event('afterprint'));
    ok(t8.d.querySelectorAll('#printOnly .ps-lh svg').length===0,'summary: wiped after printing');
    w.wipeSeed&&w.wipeSeed(); ok($('sumLine').textContent==='','summary: cleared with the seed');
    t8.mode('coin'); t8.set(rnd(140,2)); await w.generate(); await w.passWork; ok(/^This seed: 12 words from 140 coin flips, passphrase none/.test($('sumLine').textContent),'summary: a coin seed says coin flips');
    // QR prints
    t8.mode('dice'); t8.set(rnd(50,6)); await w.generate(); await w.passWork; await new Promise(r=>setTimeout(r,50));
    w.showQr('wZpub','public key'); p0=t8.st.printed; w.printShownQr(); ok(t8.st.printed===p0+1&&/^VOIDFORGE ACCOUNT PUBLIC KEY/.test(t8.st.printQrText)&&t8.st.printQrText.includes($('wZpub').textContent)&&/PUBLIC: no seed words/.test(t8.st.printQrText)&&/<svg/.test(t8.st.printQrHTML),'QR prints: the watch-only key QR prints with its text'); w.dispatchEvent(new w.Event('afterprint'));
    w.showQr('wDescR','receive descriptor'); w.printShownQr(); ok(/^VOIDFORGE RECEIVE DESCRIPTOR/.test(t8.st.printQrText)&&t8.st.printQrText.includes($('wDescR').textContent),'QR prints: the descriptor QR'); w.dispatchEvent(new w.Event('afterprint'));
    w.hideQr(); t8.st.alerts.length=0; p0=t8.st.printed; w.printShownQr(); ok(t8.st.printed===p0&&/SHOW QR/.test(t8.st.alerts[0]),'QR prints: nothing prints after HIDE QR');
    const a0=t8.d.querySelector('#addrList [data-addr]').getAttribute('data-addr'); w.showAddrQr('aq',a0); w.printAddrQr('aq'); ok(/^VOIDFORGE RECEIVE ADDRESS/.test(t8.st.printQrText)&&t8.st.printQrText.includes('Address: '+a0)&&!/Payment link/.test(t8.st.printQrText),'QR prints: an address QR'); w.dispatchEvent(new w.Event('afterprint'));
    $('aqAmt').value='0.5'; w.drawAddrQr('aq'); w.printAddrQr('aq'); ok(/^VOIDFORGE PAYMENT REQUEST/.test(t8.st.printQrText)&&t8.st.printQrText.includes('Payment link: bitcoin:'+a0+'?amount=0.5'),'QR prints: a payment request'); w.dispatchEvent(new w.Event('afterprint'));
    w.hideAddrQr('aq'); t8.st.alerts.length=0; w.printAddrQr('aq'); ok(t8.st.alerts.length===1,'QR prints: nothing after HIDE QR');
    // child seed print
    $('phrase').value='abandon '.repeat(11)+'about'; $('childApp').value='words'; w.childAppChange(); $('childWords').value='12'; await w.deriveChild();
    ok($('childPrintRow').style.display===''&&$('childPrintBtn').textContent==='PRINT CHILD SEED','child: a print button appears with the result');
    const cw=$('childOut').textContent.match(/\d+\. [a-z]+/g).map(s=>s.split(' ')[1]);
    p0=t8.st.printed; w.printChild(); ok(t8.st.printed===p0+1&&t8.st.printCells.join(' ')===cw.map((x,i)=>String(i+1).padStart(2,'0')+x).join(' ')&&/^VOIDFORGE CHILD SEED \(BIP85\)/.test(t8.st.printHTML)&&/from the parent wallet 73c5da0a, index 0/.test(t8.st.printHTML),'child: PRINT CHILD SEED prints the child words and what recreates them'); w.dispatchEvent(new w.Event('afterprint'));
    $('childApp').value='pwd64'; w.childAppChange(); $('childLen').value='21'; await w.deriveChild(); ok($('childPrintBtn').textContent==='PRINT PASSWORD','child: the button names what it prints');
    w.printChild(); const pw=t8.d.querySelector('#printOnly .ps-secret'); ok(!!pw&&pw.textContent.length===21&&$('childOut').textContent.includes(pw.textContent)&&/^VOIDFORGE CHILD PASSWORD \(BIP85\)/.test(t8.st.printHTML),'child: a password prints in one box'); w.dispatchEvent(new w.Event('afterprint'));
    w.clearChild(); t8.st.alerts.length=0; w.printChild(); ok($('childPrintRow').style.display==='none'&&/DERIVE first/.test(t8.st.alerts[0]),'child: HIDE removes the button and the printable result'); }
  // ===== v2.4.0 review fixes =====
  { const t9=load(); await t9.ready(); const $=t9.$, w=t9.w; w.startGateClose();
    t9.set(rnd(50,6)); await w.generate(); await w.passWork; await new Promise(r=>setTimeout(r,50));
    // QR prints describe the code that was shown, and a change of network hides it at once
    w.showQr('wZpub','public key'); const snap=w.eval('qrShown'); $('wNet').value='test'; const rw=w.refreshWatch(); let p0=t9.st.printed; t9.st.alerts.length=0; w.printShownQr();
    ok(t9.st.printed===p0&&w.eval('qrShown')===null&&$('qrBox').style.display==='none','QR prints: changing the network hides the shown code at once, so it cannot print with the wrong label'); await rw;
    w.showQr('wDescR','receive descriptor'); w.printShownQr(); ok(/^VOIDFORGE RECEIVE DESCRIPTOR \(TESTNET\)/.test(t9.st.printQrText)&&/\]tpub/.test(t9.st.printQrText),'QR prints: a testnet descriptor is printed as testnet'); w.dispatchEvent(new w.Event('afterprint'));
    $('wType').value='ms-wsh'; $('wNet').value='main'; await w.refreshWatch(); w.showQr('wDescR','x'); w.printShownQr();
    ok(/^VOIDFORGE COSIGNER KEY WITH ORIGIN/.test(t9.st.printQrText)&&/Address type: Multisig cosigner/.test(t9.st.printQrText),'QR prints: a cosigner key is printed as a cosigner key, not a descriptor'); w.dispatchEvent(new w.Event('afterprint'));
    $('wType').value='wpkh'; await w.refreshWatch();
    eq([15,16,22,23,40].map(v=>String(w.qrPrintSize({version:v}))).join(),'false,pq-ms,pq-ms,pq-ms pq-ms-l,pq-ms pq-ms-l','QR prints: big codes print smaller so the sheet stays one page');
    // a payment request too long for a QR code leaves nothing stale
    const a0=t9.d.querySelector('#addrList [data-addr]').getAttribute('data-addr'); w.showAddrQr('aq',a0); $('aqMsg').value='Rent'; w.drawAddrQr('aq'); $('aqMsg').value='x'.repeat(3000); w.drawAddrQr('aq');
    t9.st.alerts.length=0; p0=t9.st.printed; w.printAddrQr('aq'); ok(t9.st.printed===p0&&$('aqImg').textContent===''&&/unavailable/.test($('aqUri').textContent),'payment request: too long for a QR code, the old code is removed and nothing prints'); w.hideAddrQr('aq'); $('aqMsg').value='';
    // summary: says why when the passphrase boxes differ; cleared with the seed
    $('passphrase').value='a'; $('passphrase2').value='b'; t9.st.alerts.length=0; p0=t9.st.printed; w.printSummary(); ok(t9.st.printed===p0&&/do not match/.test(t9.st.alerts.join()),'summary: with different passphrase boxes it says so and prints nothing');
    $('passphrase').value=''; $('passphrase2').value=''; await w.rePass(); t9.set(rnd(51,6)); ok(!w.hasSeed()&&$('sumLine').textContent==='','summary: the line goes with the seed when the rolls change');
    // child: HIDE or new parent words stop a result from appearing; CLEAR ALL removes it
    $('phrase').value='abandon '.repeat(11)+'about'; $('childApp').value='words'; w.childAppChange(); $('childWords').value='12';
    let dp=w.deriveChild(); w.clearChild(); await dp; ok($('childOut').textContent===''&&$('childPrintRow').style.display==='none','child: HIDE pressed while it works shows nothing afterwards');
    await w.deriveChild(); $('phrase').value='legal winner thank year wave sausage worth useful legal winner thank yellow'; $('phrase').dispatchEvent(new w.Event('input'));
    ok($('childOut').textContent===''&&w.eval('childCtx')===null,'child: cleared when the parent words change');
    $('phrase').value='abandon '.repeat(11)+'about'; await w.deriveChild(); $('checkAddr').value='5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'; await w.explainAddrUi(); t9.st.confirms=0; w.clearAll();
    ok($('childOut').textContent===''&&$('childPrintRow').style.display==='none'&&$('checkAddr').value===''&&$('addrExplain').textContent==='','CLEAR ALL: removes the child result, the address box and its explanation');
    ok(/no copy or save; a print button \(v2\.4\.0\)/.test(t9.d.querySelector('#childBox').textContent),'child: the box says it can be printed');
    // explainer: more secrets pasted by mistake, and Silent Payment contents
    const X=async a=>{ const r=await w.explainAddress(a); return r?r.level+' '+r.text:''; };
    for(const [a,re] of [['1. legal 2. winner 3. thank 4. year 5. wave 6. sausage',/^bad These look like SEED WORDS/],['lega winn than year wave saus',/^bad These look like SEED WORDS/],['0'.repeat(96),/^bad These look like SeedQR digits/],['ab'.repeat(32),/^bad This is 64 hex characters/],['lnurl1dp68gurn8ghj7',/^warn This is an LNURL/],['lntbs1pjqqqqqpp5',/^warn This is a Lightning invoice/],['WSH(SORTEDMULTI(2,A,B))',/^warn This is a descriptor/],['6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg',/^bad This is a password-protected PRIVATE KEY \(BIP-38\)/],['S6c56bnXQiBjk9mqSYE7ykVQ7NzrRy',/^bad This is a mini PRIVATE KEY/],['S6c56bnXQiBjk9mqSYE7ykVQ7NzrRz',/^bad Not a valid address/],['send me the money by friday please now',/^bad Not a Bitcoin address/]])
      ok(re.test(await X(a)),'explain: '+a.slice(0,24));
    const B32='qpzry9x8gf2tvdw0s3jn54khce6mua7l', toW=(n)=>{ const out=[]; let acc=0,bits=0; for(let i=0;i<n;i++){ acc=(acc<<8)|(i&255); bits+=8; while(bits>=5){ bits-=5; out.push((acc>>bits)&31); } acc&=(1<<bits)-1; } if(bits) out.push((acc<<(5-bits))&31); return out; };
    ok(/^bad .*contents are not two keys/.test(await X(w.bech32mText('sp',[0,...toW(2)])))&&/^bad .*contents are not two keys/.test(await X(w.bech32mText('sp',[31,...toW(66)])))&&/^ok Silent Payment address/.test(await X(w.bech32mText('sp',[1,...toW(70)])))&&/^bad .*contents are not two keys/.test(await X(w.bech32mText('sp',[1,...toW(60)]))),'explain: a Silent Payment address must hold two keys (66 bytes; version 31 is reserved)'); }
  // item 8: changelog
  ok(/Changelog/.test(html)&&/Breaking/.test(html),'changelog documents the H/T breaking change');

  // --- no network / external references ---
  const src=html.replace(/const WORDLIST = \[.*?\];/s,'');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|<script[^>]+src=|<link(?! rel="icon" type="image\/[a-z+]+"(?: sizes="\d+x\d+")? href="data:)|@import/.test(src),'no network APIs or external resources');
  const urls=[...src.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]); ok(urls.every(u=>u.startsWith('https://github.com/Random21m/voidforge')||u==='https://random21m.github.io/VOIDFORGE/'),'only URL is the GitHub link: '+urls.join(', '));
  ok(t.errors.length===0,'no uncaught page errors '+JSON.stringify(t.errors));
  console.log(failed?`\n${failed} CHECK(S) FAILED`:'\nALL CHECKS PASSED'); process.exit(failed?1:0);
})();
