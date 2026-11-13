// Automated checks for voidforge.html. Run: npm i jsdom && node tests/test.js [path/to/voidforge.html]
const {JSDOM}=require('jsdom'); const fs=require('fs'); const path=require('path'); const nc=require('crypto');
const file=process.argv[2]||path.join(__dirname,'..','voidforge.html');
const html=fs.readFileSync(file,'utf8');
// Removes every <script ...>...</script> block by position (no regular expression), for tests that scan the page text.
function stripScripts(h){ let out='', i=0; for(;;){ const a=h.toLowerCase().indexOf('<script', i); if(a<0){ out+=h.slice(i); break; } out+=h.slice(i,a); const b=h.toLowerCase().indexOf('</script', a); if(b<0) break; const c=h.indexOf('>', b); if(c<0) break; i=c+1; } return out; }
let failed=0; const ok=(c,m)=>{ console.log((c?'PASS ':'FAIL ')+m); if(!c) failed++; };
const eq=(a,b,m)=>ok(a===b, m+(a===b?'':` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`));

// Every window load() makes stays open (with its timers) until it is closed, and an open window keeps its memory: about 50 MB
// each, so the 80 windows of this file need far more than the 4 GB heap of package.json and the GitHub workflow. sweep(t), run
// between the top-level parts of this file, closes every window except the main one (t): a part's own windows are its own, so no
// later part can use them. Each part runs as its own async function (await (async()=>{ ... })()): a variable of a block in one long
// async function stays in that function's suspended frame after the block ends, and so kept every window of every part alive.
// Work a page started and was still finishing (an await on hashing) can run on after its window is closed and then fails, with no
// document: that rejection is ignored only when it is exactly that failure (reading a property of the missing document or of
// what it held) and of an error type of a closed window (kept in a WeakSet, so they do not keep it in memory). Any other unhandled
// rejection still stops the run, and the main function has a .catch at the end: a check that fails by throwing stops the run with
// exit code 1 (v2.16.1 second review: a live window's own failure, or the main flow's, is never taken for a closed window's).
const OPEN=new Set(), CLOSED=new WeakSet();
// A closed window is freed only by V8's last-resort collection (the one it makes just before running out of heap; an ordinary major
// GC keeps the window's context), so sweep asks for one after closing windows (the gc function, made available here without a
// command-line flag). Without it the heap climbs to the 4 GB limit before anything is freed.
const fullGc=(()=>{ try{ require('v8').setFlagsFromString('--expose-gc'); const g=require('vm').runInNewContext('gc'); return ()=>{ try{ g({type:'major',flavor:'last-resort'}); }catch(e){ g(); } }; }catch(e){ return ()=>{}; } })();
function sweep(...keep){ const k=new Set(keep.filter(Boolean).map(x=>x.w)); let n0=0; for(const w of OPEN) if(!k.has(w)){ for(const n of ['Error','TypeError','RangeError','ReferenceError','SyntaxError']) if(w[n]) CLOSED.add(w[n]); try{ w.close(); }catch(e){} OPEN.delete(w); n0++; } if(n0) fullGc(); }
const NO_DOC=/^Cannot read properties of (null|undefined) \(reading '(getElementById|querySelector|querySelectorAll|body|head|documentElement|createElement|activeElement|defaultView|dataset|classList|style|value|textContent)'\)$/;
process.on('unhandledRejection',(e)=>{ if(e&&e.constructor&&CLOSED.has(e.constructor)&&e.constructor.name==='TypeError'&&NO_DOC.test(e.message)) return; throw e; });
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
  const w=dom.window; OPEN.add(w); return {w,ready:()=>w.selfTestDone,d:w.document,$:id=>w.document.getElementById(id),st,errors,
    set(v){ this.$('rolls').value=v; this.$('rolls').oninput(); },
    mode(m){ const e=this.d.querySelector(`input[name=mode][value=${m}]`); e.checked=true; e.onchange(); },
    words(n){ const e=this.d.querySelector(`input[name=words][value="${n}"]`); e.checked=true; e.onchange(); }};
}
const t9StepCur=(t)=>{ const c=t.d.querySelector('#stepBar li.cur'); return c?c.getAttribute('data-s'):''; };
const blobText=(w,b)=>b.text?b.text():new Promise((res,rej)=>{const r=new w.FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(b);});
const rnd=(n,k)=>Array.from({length:n},()=>String(k===2?nc.randomInt(2):1+nc.randomInt(6))).join('');

(async()=>{
  let t=load(); await t.ready(); await t.ready();
  // --- self-test (known-answer vectors) ---
  await t.w.runSelfTests();
  ok(/^ALL \d+ TESTS PASSED/.test(t.$('testResults').textContent),'in-page SELF-TEST passes: '+t.$('testResults').textContent.split('\n')[0]);
  // address finder
  sweep(t);
  await (async()=>{ const AB='abandon '.repeat(11)+'about'; t.$('phrase').value=AB; t.$('verifyPass').value='';
    const C=async(x,r)=>{ t.$('checkAddr').value=x; await t.w.checkAddress(r); return [t.$('addrCheckStatus').textContent,t.$('addrCheckStatus').className]; };
    let [tx,cl]=await C('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',4); ok(/^FOUND: this SegWit address is receive address #0 \(m\/84'\/0'\/0'\/0\/0\)/.test(tx)&&/ok/.test(cl),'address finder: SegWit receive #0 found');
    [tx,cl]=await C('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g',4); ok(/receive address #1 /.test(tx),'address finder: SegWit receive #1 found');
    [tx,cl]=await C('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',4); ok(/^FOUND: this Taproot address is receive address #0 \(m\/86'\/0'\/0'\/0\/0\)/.test(tx),'address finder: Taproot receive #0 found');
    [tx,cl]=await C('bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7',4); ok(/change address #0 /.test(tx),'address finder: Taproot change #0 found');
    [tx,cl]=await C('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',4); ok(/^NOT FOUND in indices 0 to 3 /.test(tx)&&/bad/.test(cl),'address finder: another address is NOT FOUND');
    [tx,cl]=await C('hello',4); ok(/Enter a bc1q/.test(tx),'address finder: rejects text that is not an address');
    t.$('phrase').value='abandon abandon'; [tx,cl]=await C('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',4); ok(/valid seed phrase/.test(tx),'address finder: needs a valid phrase');
    t.$('phrase').value=''; t.$('checkAddr').value=''; t.$('addrCheckStatus').textContent=''; })();
  // Try accounts 0 to 20 (v1.33.0): finds which account an address belongs to, with and without the passphrase
  sweep(t);
  await (async()=>{ const AB='abandon '.repeat(11)+'about'; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
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
    t.$('phrase').value=''; t.$('checkAddr').value=''; t.$('verifyPass').value=''; t.$('addrCheckStatus').textContent=''; })();
  // SeedQR / CompactSeedQR input and BIP85 child seeds
  sweep(t);
  await (async()=>{ const AB='abandon '.repeat(11)+'about'; const V=async x=>{ t.$('phrase').value=x; await t.w.verify(); return [t.$('verifyStatus').textContent.split('\n')[0], t.$('phrase').value]; };
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
    t.$('phrase').value=''; t.$('childOut').textContent=''; t.$('childStatus').textContent=''; t.$('verifyStatus').textContent=''; })();
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
      ok(addr==='keywest@strike.me'&&code==='LNURL1DP68GURN8GHJ7UM5WF5KKEFWD4JJ7TNHV4KXCTTTDEHHWM30D3H82UNVWQHKKETEWAJHXAQ6MZ0AF','support: the Lightning address and payment code are exactly the maintainer\'s');
      const svg=t.$('supportQr').querySelector('svg'); ok(svg&&svg.querySelector('path')&&t.w.qrMatrix(code).rows.length>=21,'support: the QR is drawn by the page from the payment code');
      ok(box.querySelectorAll('a, [href], img, iframe, script').length===0&&/never goes online/.test(box.textContent)&&/never send seed words/i.test(box.textContent),'support: no link, image or script in the box, and it says nothing is sent and never to send seed words');
      t.st.clip.length=0; const b=box.querySelectorAll('button'); b[0].click(); await new Promise(r=>setTimeout(r,20)); b[1].click(); await new Promise(r=>setTimeout(r,20)); const c1=t.st.clip[0], copied=t.st.clip[1];
      ok(b.length===2&&c1==='keywest@strike.me'&&copied===code,'support: COPY copies the address and the payment code exactly');
      // v2.16.1: a DONATE button at the bottom of every tab opens the box in ABOUT & HELP
      const db=t.$('supportBtn'); t.w.showTab('make'); box.open=false; db.click();
      ok(db&&db.textContent.trim()==='DONATE'&&db.closest('footer')&&!t.$('tp-about').classList.contains('tab-off')&&box.open,'support: DONATE (in the footer, on every tab) opens Support this project in ABOUT & HELP');
      box.open=false; t.w.showTab('make'); }
    { // The dog logo is gone in the redesign. v2.14.0: the only pictures are the creator's profile picture next to the Damascus method's
      // creator line (top of the Damascus tab and ABOUT & HELP), one small WebP built into the file as a data: URI
      const im=[...t.w.document.querySelectorAll('img')], src=im.map(i=>i.getAttribute('src')||'');
      ok(!t.$('ownerLogo')&&!/ownerLogo|data:image\/jpeg/.test(html)&&im.length===2&&im.every(i=>i.className==='vf-creator-pic'&&i.closest('.vf-creator'))&&src[0]===src[1]&&/^data:image\/webp;base64,/.test(src[0])&&src[0].length<8000,'owner logo: removed in the redesign; the only picture is the small creator picture by the Damascus creator line (twice, a data: URI)'); }
    { // Translation and passphrase notes (v1.29.0): browsers are asked not to translate (a translated seed word is a wrong seed word), and the passphrase help warns about hardware wallet limits
      const d=t.w.document, m=d.querySelector('meta[name="google"]'), adv=t.$('passphrase').closest('details');
      ok(d.documentElement.getAttribute('translate')==='no'&&d.documentElement.getAttribute('lang')==='en'&&!!m&&m.getAttribute('content')==='notranslate','translation: the page asks browsers not to translate it');
      ok(!!adv&&/Some hardware wallets limit how long a passphrase can be or which characters it can use, so test a small amount on your device before you rely on it\./.test(adv.textContent)&&!/\b(Trezor|Ledger|Coldcard|Jade)\b/.test(adv.textContent),'passphrase: help warns that some hardware wallets limit length or characters (no vendor claims)'); }
    { // Calmer first screen (v1.33.0): one GUIDE ME button, seed buttons only once there is a seed, one "More options" box, no second warning note
      const d=t.w.document, gb=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()==='GUIDE ME'), gn=t.$('guideNew'), css=[...d.querySelectorAll('style')].map(x=>x.textContent).join('\n');
      ok(gb.length===1&&gb[0].id==='guideBtn'&&!!gn&&!gn.querySelector('button')&&/^New here\? Open MENU at the top and press GUIDE ME to be walked through making a seed one screen at a time\.$/.test(gn.textContent.trim()),'calmer page: one GUIDE ME button; the "New here?" line points to it as plain text');
      ok(!d.querySelector('.forge-note')&&!/keep clipboard history off, and restart when you are done/.test(d.body.textContent.split('<script')[0]),'calmer page: no second "Making real keys?" note next to FORGE SEED (the amber banner says it)');
      ok(/body:not\(\.has-seed\) \.seed-actions, body:not\(\.has-seed\) \.print-btn \{ display: none; \}/.test(css)&&!!d.querySelector('.btn-row.seed-actions #abbrBtn')&&d.querySelectorAll('.seed-actions button').length===6,'calmer page: the six seed buttons (v2.16.1: LOAD INTO THE PRACTICE SIGNER) and PRINT SEED are hidden until there is a seed');
      ok(!/#rollCount \{ display: none; \}/.test(css)&&!!t.$('rollCount'),'calmer page: one column, so the roll count stays beside the box on every screen size');
      { const css=html.match(/<style>[\s\S]*?<\/style>/)[0]; ok(/@media \(max-width: 559px\) \{ #wordGrid, #cardGen \.gen-right #wordGrid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \} \}/.test(css)&&/\.wcell \{ animation: none; box-shadow: none; font-size: 18px; font-weight: 700; padding: 10px 12px; min-width: 0; \}/.test(css)&&/@media \(max-width: 400px\) \{ \.wcell \{ font-size: 16px;/.test(css)&&/@media \(max-width: 345px\) \{ \.wcell \{ font-size: 14\.5px;/.test(css),'seed words: two columns below 560px and smaller type on narrow phones, so long words stay inside their boxes'); }
      { const rs=t.$('rollStats'); ok(!!rs&&rs.previousElementSibling.id==='ignoredNote'&&t.$('advanced').closest('#genRight')!==null&&t.$('advanced').previousElementSibling.classList.contains('seed-actions')&&t.$('advanced').nextElementSibling.querySelector('#fingerprint')!==null,'order: roll entry, then the roll history and fairness chart; then FORGE and the words, then the passphrase box, then the fingerprints'); ok(!!rs&&rs.tagName==='DETAILS'&&!rs.open&&rs.contains(t.$('rollChart'))&&rs.contains(t.$('rollHistory'))&&rs.contains(t.$('diceVisual')),'tucked away: roll history and the fairness chart live in one closed box'); { const css=html.match(/<style>[\s\S]*?<\/style>/)[0]; ok(/#rollStats \{ margin-top: 10px; padding: 8px 12px; font-size: 13px; \}/.test(css)&&/#rollStats > summary \{ cursor: pointer; font-weight: 600; \}/.test(css),'tucked away: the roll history box is styled like the More options and Advanced options boxes'); } }
      ok(!t.$('moreBox')&&!t.$('demoBox')&&!t.$('demoOn')&&![...t.d.querySelectorAll('.tag-note')].some(e=>/DEMO/.test(e.textContent)),'no demo box and no More options box: the gray live words replaced the demo');
      { const tabs=[...t.d.querySelectorAll('#methodTabs button')]; ok(tabs.map(b=>b.textContent).join('|')==='Dice|Coin|Word draw|Cards & hex|Damascus'&&tabs.every(b=>b.getAttribute('role')==='tab')&&tabs[0].getAttribute('aria-selected')==='true'&&t.$('wordSel').options.length===5&&t.$('wordSel').value==='12'&&/50 dice rolls/.test(t.$('lenNote').textContent)&&!t.d.body.classList.contains('m-words'),'make tab: Dice, Coin, Word draw, Cards & hex and Damascus tabs with one Seed length menu (12 to 24 words, v2.10.0), Dice and 12 words by default'); }
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
    { // Every main "go" action across the page is a primary (cyan) button, not gray "secondary" -- a uniform rule, not just START DRILL (v1.27.3)
      const primaryIds=['forgeBtn','prStart','prCheckBtn','checkAddrBtn','checkAcctsBtn','reforgeWordsBtn','psbtBtn','cmpBtn','childBtn','wpBtn','reuseBtn','sigBtn'];
      const missing=primaryIds.filter(id=>{ const b=t.$(id); return !b || b.classList.contains('secondary') || b.classList.contains('btn-clear'); });
      ok(missing.length===0,'every main action button (FORGE SEED, START PRACTICE, CHECK MY PAPER, CHECK ADDRESS, TRY ACCOUNTS, Reforge SEARCH, INSPECT, COMPARE, DERIVE CHILD SEED, OPEN WATCH-ONLY, CHECK KEYS, VERIFY SIGNATURE) is the gold primary style, none gray (missing: '+missing.join(', ')+')');
      const drillBtn=[...t.$('drillStart').querySelectorAll('button')][0];
      ok(drillBtn&&drillBtn.textContent.trim()==='START DRILL'&&!drillBtn.classList.contains('secondary'),'START DRILL is also the cyan primary style');
      const css=html.match(/<style>[\s\S]*?<\/style>/)[0];
      ok(/button \{[^}]*background: linear-gradient\(90deg, var\(--accent\)/.test(css),'the primary button style is still the cyan gradient that every unclassed button inherits');
      // and the small helper actions (COPY, SHOW QR, HIDE, PRINT, UNDO) stay the quieter gray secondary style, so the primary ones still stand out
      const helperBtns=[...t.w.document.querySelectorAll('button.secondary.small')];
      ok(helperBtns.length>=20&&helperBtns.every(b=>b.classList.contains('secondary')),'helper buttons like COPY, SHOW QR and HIDE stay the quieter gray secondary style, so the primary actions still stand out'); }
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
  sweep(t);
  await (async()=>{ const css=html.match(/<style>[\s\S]*?<\/style>/)[0], hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
    const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
    const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const mix=(fg,a,bg)=>fg.map((v,i)=>v*a+bg[i]*(1-a));
    const btn=(fn)=>[...t.w.document.querySelectorAll('button')].find(b=>b.getAttribute('onclick')===fn);
    const clr=btn('clearAll()'), st=btn('toggleSelfTests()');
    ok(clr&&clr.textContent.trim()==='CLEAR ALL'&&clr.classList.contains('btn-clear')&&!clr.classList.contains('secondary'),'CLEAR button uses the red style');
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
    ok(worst>=4.5,'red and green button text keeps contrast >= 4.5:1 in both themes (worst '+worst.toFixed(2)+')'); })();
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
  sweep(t);
  await (async()=>{ // Stamp sheet (v1.34.0): the first 4 letters of each word in capitals, for metal plates
    const p0=t.st.printed; t.st.alerts.length=0; t.w.printStamp(); const cells=t.st.printCells.slice(), txt=t.st.printHTML;
    ok(t.st.printed===p0+1&&cells.length===12&&words.split(' ').every((w,i)=>cells[i]===String(i+1).padStart(2,'0')+w.slice(0,4).toUpperCase())&&/print-seed/.test(t.st.printClass)&&/^VOIDFORGE STAMP SHEET/.test(txt),'PRINT STAMP SHEET prints each word as its first 4 letters in capitals');
    ok(!txt.includes('SECRETPASS')&&/Passphrase used: YES/.test(txt)&&txt.includes(t.$('fingerprint').textContent)&&/into VERIFY in CHECK A BACKUP/.test(txt)&&/No two BIP39 words start with the same 4 letters/.test(txt),'stamp sheet: fingerprint, passphrase yes/no without the passphrase, and how to get the words back');
    t.w.dispatchEvent(new t.w.Event('afterprint')); ok(t.$('printOnly').textContent==='','stamp sheet is cleaned up after printing');
    ok(!!t.$('stampBtn')&&/printStamp/.test(t.$('stampBtn').getAttribute('onclick')),'PRINT STAMP SHEET button is on the page'); })();
  sweep(t);
  await (async()=>{ // Wallet view (v2.1.0): any valid 12 to 24 word phrase typed in the Check tab
    const AB='abandon '.repeat(11)+'about', sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async f=>{ for(let n=0;n<400&&!f();n++) await sleep(25); return f(); };
    const rows=()=>[...t.$('wvList').querySelectorAll('li')].map(li=>li.textContent);
    const pick=(id,v)=>{ t.$(id).value=v; t.$(id).dispatchEvent(new t.w.Event(id==='wvAcct'?'input':'change',{bubbles:true})); };
    const t0=t; t=load(); await t.ready();
    ok(t.$('walletView').style.display==='none','wallet view: hidden until a phrase is checked');
    t.$('phrase').value=AB; t.$('verifyPass').value=''; await t.w.verify(); await until(()=>rows().length===20);
    ok(t.$('walletView').style.display!=='none'&&/73c5da0a/.test(t.$('wvFp').textContent)&&t.$('wvIcon').innerHTML.includes('<svg'),'wallet view: opens after VERIFY with the master fingerprint and its picture');
    ok(rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&rows()[10]==='bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el'&&t.$('wvChain').value==='both'&&t.$('wvList').querySelectorAll('li button.qr-mini').length===20&&rows().every(a=>/^bc1q/.test(a)),'wallet view: the published first SegWit receive and change addresses, 10 receive and 10 change rows by default (v2.16.0), each with a QR button');
    ok(/imported/i.test(t.$('wvBanner').textContent)&&/not made by this page/.test(t.$('wvBanner').textContent),'wallet view: says plainly that these words were imported, not made here');
    pick('wvType','tr'); await until(()=>/^bc1p/.test(rows()[0]||'')); ok(rows()[0]==='bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr','wallet view: the published first Taproot (BIP86) address');
    pick('wvType','pkh'); await until(()=>/^1/.test(rows()[0]||'')); ok(rows()[0]==='1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA','wallet view: the published first Legacy (BIP44) address');
    pick('wvType','sh-wpkh'); await until(()=>/^3/.test(rows()[0]||'')); ok(rows()[0]==='37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf','wallet view: the published first Nested SegWit (BIP49) address');
    pick('wvType','wpkh'); pick('wvNet','test'); await until(()=>/^tb1q/.test(rows()[0]||'')); ok(/TESTNET/.test(t.$('wvPath').textContent)&&/^tb1q/.test(rows()[0]),'wallet view: testnet gives tb1 addresses and a TESTNET note');
    pick('wvNet','main'); await until(()=>/^bc1q/.test(rows()[0]||''));
    const first=rows().slice(); t.$('wvNext').click(); await until(()=>rows()[0]!==first[0]); const second=rows().slice();
    ok(second.length===20&&!second.some(a=>first.includes(a))&&/addresses 10 to 19/.test(t.$('wvPath').textContent)&&!t.$('wvPrev').disabled,'wallet view: NEXT 10 shows addresses 10 to 19');
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
    t.$('phrase').value=AB; t.$('verifyPass').value='SECRETPASS'; await t.w.verify(); await until(()=>rows().length===20);
    ok(t.$('wvChain').value==='both'&&rows().length===20,'wallet view: a wallet opened after Receive was picked starts again on 10 receive and 10 change addresses');
    ok(rows()[0]!==first[0]&&!/73c5da0a/.test(t.$('wvFp').textContent)&&/with passphrase/.test(t.$('wvFp').textContent),'wallet view: with a passphrase it is a different wallet and says so');
    t.w.printRecoverySheet(); ok(!t.st.printHTML.includes('SECRETPASS')&&/Passphrase used: YES/.test(t.st.printHTML),'recovery sheet: says a passphrase was used, never prints it'); t.w.dispatchEvent(new t.w.Event('afterprint'));
    // other lengths: 24 words has SeedQR, 15 does not
    const e24=await t.w.entropyToMnemonic(new Uint8Array(32)), e15=await t.w.entropyToMnemonic(new Uint8Array(20));
    t.$('verifyPass').value=''; t.$('phrase').value=e24; await t.w.verify(); await until(()=>rows().length===20);
    ok(t.$('wvSqBtns').style.display!=='none'&&/24 words/.test(t.$('wvSqNote').textContent),'wallet view: 24 words offer SeedQR');
    t.$('phrase').value=e15; await t.w.verify(); await until(()=>rows().length===20);
    ok(t.$('wvSqBtns').style.display==='none'&&/No SeedQR exists for 15 words/.test(t.$('wvSqNote').textContent),'wallet view: 15 words say plainly that no SeedQR exists');
    t.$('phrase').value='abandon abandon'; await t.w.verify(); ok(t.$('walletView').style.display==='none','wallet view: an invalid phrase opens nothing');
    t.$('phrase').value=AB; await t.w.verify(); await until(()=>rows().length===20); t.w.wipeSeed(); ok(t.$('walletView').style.display==='none'&&t.$('wvList').textContent==='','wallet view: CLEAR ALL wipes it'); t=t0; })();
  sweep(t);
  await (async()=>{ // v2.2.0: watch-only view, Electrum warning, payment request, backup checklist, key-reuse check
    const AB='abandon '.repeat(11)+'about', sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const until=async f=>{ for(let n=0;n<400&&!f();n++) await sleep(25); return f(); };
    const t0=t; t=load(); await t.ready(); t.st.alerts.length=0;
    const rows=()=>[...t.$('wvList').querySelectorAll('li')].map(li=>li.textContent);
    const pick=(id,v)=>{ t.$(id).value=v; t.$(id).dispatchEvent(new t.w.Event('change',{bubbles:true})); };
    const openW=async v=>{ t.$('wpIn').value=v; t.$('wpIn').dispatchEvent(new t.w.Event('input',{bubbles:true})); await t.w.openWatchOnly(); };
    // watch-only: the published BIP84 zpub of abandon...about
    const ZPUB='zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
    await openW(ZPUB); await until(()=>rows().length===20);
    ok(rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&t.$('wvType').disabled&&t.$('wvType').value==='wpkh'&&t.$('wvNet').disabled,'watch-only: the published zpub gives the published first address, type and network locked');
    ok(/Watch-only/.test(t.$('wvBanner').textContent)&&t.$('wvSqBlock').style.display==='none'&&t.$('wvSheetBtn').style.display==='none'&&/not known/.test(t.$('wvFp').textContent),'watch-only: says so, no SeedQR and no recovery sheet, and no made-up fingerprint');
    ok(t.$('wvChain').value==='both'&&t.$('wvList').querySelectorAll('li button.qr-mini').length===20,'watch-only: a plain zpub opens on 10 receive and 10 change addresses, with a QR button on every row');
    const XPUB86='xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ';
    await openW(XPUB86); await until(()=>rows().length===20);
    ok(!t.$('wvType').disabled&&/does not say which address type/.test(t.$('wpStatus').textContent),'watch-only: a plain xpub lets you pick the type and says why');
    pick('wvType','tr'); await until(()=>/^bc1p/.test(rows()[0]||'')); ok(rows()[0]==='bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr','watch-only: the published BIP86 xpub as Taproot gives the published first address');
    { const seed=await t.w.mnemonicToSeed(AB,''), wo=await t.w.watchOnlyFromSeed(seed,'wpkh',0,'main'), desc=wo.receive;
      await openW(desc); await until(()=>rows().length===10);
      ok(t.$('wvAcct').value==='0'&&t.$('wvAcct').disabled,'watch-only: the account number is read from the descriptor path (0h gives 0)');
      ok(rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&/73c5da0a/.test(t.$('wvFp').textContent)&&t.$('wvIcon').innerHTML.includes('<svg')&&/\[73c5da0a\/84'\/0'\/0'\]\/0\/index/.test(t.$('wvPath').textContent),'watch-only: a descriptor gives the fingerprint, its picture and the key origin in the path');
      await openW(wo.change); await until(()=>rows().length===10&&t.$('wvChain').value==='1'); const ch1=rows()[0]; await openW(desc); await until(()=>rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
      ok(t.$('wvChain').value==='0'&&ch1!==rows()[0]&&/Change/.test('Change'),'watch-only: a /1/* descriptor opens change addresses, and a /0/* one goes back to receive');
      for(const [end,what] of [['/<0;1>/*)','/<0;1>/*'],[')','no ending']]){ await openW(desc.replace(/#.*$/,'').replace('/0/*)',end)); await until(()=>rows().length===20);
        ok(t.$('wvChain').value==='both'&&rows()[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&rows()[10]==='bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el','watch-only: a descriptor with '+what+' opens 10 receive and 10 change addresses'); }
      await openW(desc.slice(0,-1)+(desc.slice(-1)==='a'?'b':'a')); ok(/checksum/.test(t.$('wpStatus').textContent)&&t.$('walletView').style.display==='none','watch-only: a wrong descriptor checksum is refused');
      await openW('sh(wpkh('+ZPUB+'/0/*))'); ok(/but the key is a zpub/.test(t.$('wpStatus').textContent),'watch-only: a descriptor type that does not match the key is refused'); }
    await openW('xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu'); ok(/PRIVATE/.test(t.$('wpStatus').textContent)&&t.$('walletView').style.display==='none','watch-only: a private key is refused');
    await openW('wsh(sortedmulti(2,'+ZPUB+','+XPUB86+'))'); ok(/multisig/.test(t.$('wpStatus').textContent),'watch-only: a multisig descriptor points to the multisig tool');
    await openW(ZPUB); await until(()=>rows().length===20); t.$('wpIn').value+=' '; t.$('wpIn').dispatchEvent(new t.w.Event('input',{bubbles:true}));
    ok(t.$('walletView').style.display==='none'&&!t.$('wvType').disabled&&!t.$('wvAcct').disabled&&t.$('wvSqBlock').style.display!=='none','watch-only: editing the key wipes the view and puts the controls back');
    // Electrum seed warning
    { const r=await t.w.checkPhrase('wild father tree among universe such mobile favorite target dynamic credit identify');
      ok(!r.ok&&/Electrum seed \(SegWit type\)/.test(r.msg),'Electrum: the Electrum SegWit example seed is recognized and named');
      const r2=await t.w.checkPhrase('abandon '.repeat(11)+'abandon'); ok(!r2.ok&&!/Electrum/.test(r2.msg),'Electrum: an ordinary bad phrase gets no Electrum note');
      const r3=await t.w.checkPhrase(AB); ok(r3.ok&&!/Electrum/.test(r3.msg),'Electrum: a valid BIP39 phrase is never called Electrum');
      ok(await t.w.electrumSeedType('say brain hammer whip plug sad budget improve scout myself interest input')==='two-factor (2FA)'&&await t.w.electrumSeedType('neglect morning hat science deputy alarm seed eager cover letter pencil second')==='two-factor (2FA) SegWit'&&await t.w.electrumSeedType('shoulder between fitness double soap point region fade rose guide kitten loud')===null,'Electrum: two-factor types are named, and a phrase whose hash starts 103 is not Electrum'); }
    // payment request (BIP21)
    { const A=t.w.bip21Amount; ok(A('0.0015').v==='0.0015'&&A('1').v==='1'&&A('1.10000000').v==='1.1'&&A('21000000').v==='21000000'&&A('').v===''&&!A('0').ok&&!A('1.123456789').ok&&!A('21000000.00000001').ok&&!A('1,5').ok&&!A('-1').ok,'payment request: amounts are checked (8 decimals, above 0, at most 21 million)');
      ok(t.w.bip21Uri('bc1qx','0.5','Café & tea','Thanks!')==='bitcoin:bc1qx?amount=0.5&label=Caf%C3%A9%20%26%20tea&message=Thanks!','payment request: link is built and encoded as BIP21 says');
      t.$('phrase').value=AB; t.$('verifyPass').value=''; await t.w.verify(); await until(()=>rows().length===20);
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
      t.$('phrase').value=words; await t.w.verify(); await until(()=>rows().length===20); t.w.printRecoverySheet(); t.w.dispatchEvent(new t.w.Event('afterprint'));
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
    t=t0; })();
  sweep(t);
  await (async()=>{ // Roll sheet (v1.34.0): a blank numbered sheet for dice or coin, sized to the chosen mode and word count
    const setMode=m=>{ t.d.querySelector('input[name="mode"][value="'+m+'"]').checked=true; }, setWords=n=>{ t.d.querySelector('input[name="words"][value="'+n+'"]').checked=true; };
    const sheet=()=>{ const p0=t.st.printed; t.w.printRollSheet(); const r={n:t.st.printed-p0,cells:t.st.printCells.slice(),txt:t.st.printHTML,cls:t.st.printClass}; t.w.dispatchEvent(new t.w.Event('afterprint')); return r; };
    let r=sheet(); ok(r.n===1&&r.cells.length===60&&r.cells.every((c,i)=>c===String(i+1))&&/^VOIDFORGE DICE ROLL SHEET/.test(r.txt)&&/50 rolls for a 12-word seed/.test(r.txt)&&/Roll one die and write its number \(1 to 6\)/.test(r.txt)&&/print-seed/.test(r.cls)&&!/1 means/.test(r.txt),'PRINT ROLL SHEET: 50 numbered boxes for 12 words of dice, then 10 more');
    ok(/Extra rolls \(optional\)\. Every one you type in counts\. Exactly 50 gives the same words as SeedSigner and Coldcard; with more, only Coldcard makes the same words\./.test(r.txt),'roll sheet: the extra boxes are optional and the sheet says who makes the same words');
    setWords(24); r=sheet(); ok(r.cells.length===109&&/99 rolls for a 24-word seed/.test(r.txt),'roll sheet: 99 boxes for 24 words of dice');
    setMode('coin'); r=sheet(); ok(r.cells.length===266&&/Exactly 256 is the method in SeedSigner's coin-flip code; with more, that code makes different words\./.test(r.txt)&&/^VOIDFORGE COIN FLIP SHEET/.test(r.txt)&&/256 flips for a 24-word seed/.test(r.txt)&&/1 means: ______   0 means: ______/.test(r.txt)&&/write 1 or 0/.test(r.txt),'roll sheet: 256 boxes for 24 words of coin flips, with the sides to fill in');
    setWords(12); r=sheet(); ok(r.cells.length===138,'roll sheet: 128 boxes for 12 words of coin flips, then 10 more');
    setMode('dice'); r=sheet(); ok(/as secret as your seed/.test(r.txt)&&/shred/.test(r.txt)&&t.$('printOnly').textContent===''&&!t.d.body.classList.contains('print-seed'),'roll sheet: warns that a filled sheet is secret, and is cleaned up after printing');
    ok(!!t.$('rollSheetBtn')&&/printRollSheet/.test(t.$('rollSheetBtn').getAttribute('onclick')),'PRINT ROLL SHEET button is on the page'); })();
  sweep(t);
  await (async()=>{ // Auto-clear (v1.34.0): optional wipe after idle time or when the tab is hidden (on a fresh page, so the wipe does not disturb the tests that follow)
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
    sel.value='0'; sel.dispatchEvent(new t.w.Event('change')); chk.checked=false; chk.dispatchEvent(new t.w.Event('change')); t.w.clearInterval=ci; t=keepT; })();
  // --- SeedQR / CompactSeedQR on screen, by hand and on paper ---
  sweep(t);
  await (async()=>{ const keepT=t; t=load(); await t.ready(); t.set(rnd(50)); t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate(); const sw=t.$('genResult').textContent.split('\n')[0];
    const sz=()=>{ const v=t.$('sqImg').querySelector('svg'); return v?Math.round(v.viewBox.baseVal.width)-8:0; }, gc=()=>t.$('sqGuideCaption').textContent;
    ok(t.$('seedQrBox').style.display==='','SeedQR box appears after FORGE');
    t.w.showSeedQr('seedqr'); ok(sz()===25&&t.$('sqBox').style.display===''&&/^SeedQR for these 12 words, 25 x 25 squares/.test(t.$('sqCaption').textContent),'SEEDQR draws a 25 x 25 code for 12 words');
    t.w.showSeedQr('compact'); ok(sz()===21&&/^CompactSeedQR for these 12 words, 21 x 21 squares/.test(t.$('sqCaption').textContent),'COMPACTSEEDQR draws a 21 x 21 code for 12 words');
    t.w.hideSeedQr(); ok(t.$('sqImg').innerHTML===''&&t.$('sqBox').style.display==='none'&&t.$('sqCaption').textContent==='','HIDE removes the SeedQR');
    t.st.alerts.length=0; const p0=t.st.printed; t.w.printSeedQr(); ok(t.st.printed===p0&&/Press SHOW SEEDQR/.test(t.st.alerts.join('|')),'PRINT THIS QR needs a shown code first');
    t.w.showSeedQr('seedqr'); t.w.printSeedQr();
    ok(t.st.printed===p0+1&&/print-qr/.test(t.st.printClass)&&/VOIDFORGE SEEDQR \(12 words, 25 x 25 squares\)/.test(t.st.printQrText)&&/<svg/.test(t.st.printQrHTML)&&!t.st.printQrText.includes('SECRETPASS')&&!t.st.printQrText.includes(sw.split(' ').slice(0,3).join(' ')),'PRINT THIS QR prints the code, no words and no passphrase');
    t.w.dispatchEvent(new t.w.Event('afterprint')); ok(t.$('printQr').textContent===''&&!t.d.body.classList.contains('print-qr'),'SeedQR print area cleaned up after printing');
    // by hand: 7 x 7 blocks, mini-map, gray squares outside the code
    t.w.showSeedQr('seedqr'); t.w.openSqGuide();
    ok(t.$('sqGuide').style.display===''&&/^Block 1 of 16: rows 1 to 7, columns 1 to 7 of the 25 x 25 grid/.test(gc())&&!!t.$('sqGuideImg').querySelector('svg')&&!!t.$('sqMini').querySelector('svg'),'COPY BY HAND opens block 1 of 16 with a mini-map');
    t.w.sqGuideBlock(1); ok(/^Block 2 of 16: rows 1 to 7, columns 8 to 14/.test(gc()),'NEXT BLOCK moves right');
    for(let i=0;i<2;i++) t.w.sqGuideBlock(1); ok(/^Block 4 of 16: rows 1 to 7, columns 22 to 25/.test(gc())&&/Gray squares are outside the code/.test(gc()),'the last block of a row is cut at the edge of the code');
    ok(!!t.$('sqGuideImg').querySelector('path[fill="#c8c8c8"]')&&/^M/.test(t.$('sqGuideImg').querySelector('path[fill="#c8c8c8"]').getAttribute('d')),'squares outside the code are drawn gray');
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
    t.words(24); t.set(rnd(99)); await t.w.generate(); t.w.showSeedQr('seedqr'); ok(sz()===29&&/24 words, 29 x 29/.test(t.$('sqCaption').textContent),'SEEDQR is 29 x 29 for 24 words'); t.w.openSqGuide(); ok(/^Block 1 of 25: rows 1 to 7, columns 1 to 7 of the 29 x 29/.test(gc()),'29 x 29 has 25 blocks'); for(let i=0;i<4;i++) t.w.sqGuideBlock(1); ok(/^Block 5 of 25: rows 1 to 7, columns 29 to 29/.test(gc()),'the last block column of a 29 x 29 code is one square wide'); t.w.showSeedQr('compact'); ok(sz()===25,'COMPACTSEEDQR is 25 x 25 for 24 words'); t.words(12);  t=keepT; })();
  // --- "How your seed was made" explainer ---
  sweep(t);
  await (async()=>{ const keepT=t; t=load(); await t.ready(); t.set(rnd(50)); t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate();
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
    t=keepT; })();
  // --- download seed: confirm, no passphrase ---
  t.w.downloadSeed(); const txt=await blobText(t.w,t.st.blob);
  ok(t.st.confirms>=2&&txt.includes(words)&&!txt.includes('SECRETPASS'),'DOWNLOAD seed asks first and omits passphrase');
  sweep(t);
  await (async()=>{ // stale-result guard (v1.26.1): what is on screen always belongs to the inputs that made it
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
    ok(g.errors.length===0,'stale guard: no page errors'); })();
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
  sweep(t);
  await (async()=>{ t.set('65515223131652132161133154444123616466443112153441'); t.$('passphrase').value=''; t.$('passphrase2').value=''; await t.w.generate();
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
  })();
  // v1.5.0: layout and clarity
  sweep(t);
  await (async()=>{ t.set('65515223131652132161133154444123616466443112153441'); t.$('passphrase').value=''; t.$('passphrase2').value=''; await t.w.generate();
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
    // ten receive and ten change addresses (v2.8.1), 4-letter view, guide
    t.$('rolls').value='65515223131652132161133154444123616466443112153441'; t.w.updateCount(); await t.w.generate();
    eq(t.$('addrList').querySelectorAll('li').length,10,'ten receive addresses are listed after FORGE');
    { const rc=[...t.$('addrList').children].map(x=>x.textContent), ch=[...t.$('chList').children].map(x=>x.textContent), tc=[...t.$('trChList').children].map(x=>x.textContent);
      ok(ch.length===10&&ch.every(x=>/^bc1q[0-9a-z]{38}$/.test(x))&&new Set(rc.concat(ch)).size===20,'ten change addresses are listed after FORGE, none of them a receive address');
      ok(tc.length===10&&tc.every(x=>/^bc1p[0-9a-z]{58}$/.test(x))&&new Set(tc).size===10,'ten Taproot change addresses are listed after FORGE'); }
    ok(t.$('addrList').querySelector('li').textContent===/First receive address[^:]*: (bc1[0-9a-z]+)/.exec(t.$('address').textContent)[1],'first listed address equals the single first-address line');
    eq(t.$('addrBox').style.display,'','address list is shown after FORGE');
    { const tr=[...t.$('trList').querySelectorAll('li')].map(x=>x.textContent);
      ok(tr.length===10&&tr.every(x=>/^bc1p[0-9a-z]{58}$/.test(x))&&new Set(tr).size===10,'ten distinct Taproot (bc1p) receive addresses are listed after FORGE');
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
  })();
  // v1.4.2: explicit passphrase line in print and download
  sweep(t);
  await (async()=>{ t.set('65515223131652132161133154444123616466443112153441'); t.$('passphrase').value=''; t.$('passphrase2').value=''; await t.w.generate(); t.w.printSeed();
    ok(/Passphrase used: NO/.test(t.st.printHTML),'print says Passphrase used: NO when none');
    t.$('passphrase').value='SECRETPASS'; t.$('passphrase2').value='SECRETPASS'; await t.w.generate(); t.w.printSeed();
    ok(/Passphrase used: YES/.test(t.st.printHTML)&&!t.st.printHTML.includes('SECRETPASS'),'print says Passphrase used: YES without printing it');
    t.w.downloadSeed(); const dtxt=await blobText(t.w,t.st.blob); ok(/Passphrase used: YES/.test(dtxt)&&!dtxt.includes('SECRETPASS'),'download says Passphrase used: YES without saving it');
    t.$('passphrase').value=''; t.$('passphrase2').value=''; })();
  // item 1: patterns
  ok(t.$('noJs').style.display==='none','script-not-running notice is hidden once the script has run');
  ok(t.d.querySelector('#topbar h1').textContent==='VOIDFORGE'&&!t.d.querySelector('.subtitle'),'header: the name VOIDFORGE, no second subtitle line');
  ok(t.$('coinHint').style.display==='none','coin hint hidden in dice mode');
  sweep(t);
  await (async()=>{ const coin=t.d.querySelector('input[name="mode"][value="coin"]'); coin.checked=true; t.w.onModeChange(); ok(t.$('coinHint').style.display==='block'&&/heads = 1/.test(t.$('coinHint').textContent),'coin mode shows which side is 1 and to record the string'); const dice=t.d.querySelector('input[name="mode"][value="dice"]'); dice.checked=true; t.w.onModeChange(); ok(t.$('coinHint').style.display==='none','coin hint hides again in dice mode'); })();
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
  sweep(t);
  await (async()=>{ const errs=[]; const dom=new (require('jsdom').JSDOM)(html,{runScripts:'dangerously',url:'https://x.org/',beforeParse(w){Object.defineProperty(w,'crypto',{value:{}});if(!w.TextEncoder)w.TextEncoder=TextEncoder;w.alert=m=>errs.push(m);w.addEventListener('error',e=>errs.push(e.message));}});
    await new Promise(r=>setTimeout(r,50)); const d=dom.window.document;
    ok(d.getElementById('fatalWarn').style.display==='block'&&d.getElementById('forgeBtn').disabled,'missing crypto.subtle: red banner shown, FORGE disabled');
    ok(!errs.some(e=>/Cannot read/.test(e)),'missing crypto.subtle: no uncaught exception'); })();
  // item 3: failed self-test disables the tool (tamper the wordlist)
  sweep(t);
  await (async()=>{ const bad=html.replace('"abandon","ability"','"abandon","abilityX"'); const dom=new (require('jsdom').JSDOM)(bad,{runScripts:'dangerously',url:'https://x.org/',beforeParse(w){Object.defineProperty(w,'crypto',{value:nc.webcrypto});if(!w.TextEncoder)w.TextEncoder=TextEncoder;w.alert=()=>{};}});
    await dom.window.selfTestDone; const d=dom.window.document;
    ok(/FAILED/.test(d.getElementById('selfTestBadge').textContent)&&d.getElementById('forgeBtn').disabled&&d.getElementById('verifyBtn').disabled,'tampered wordlist: self-test fails and tool is disabled'); })();
  // item 4: ignored characters + mode switch
  t.set('1234 5670 89'); ok(/Ignored 4 invalid/.test(t.$('ignoredNote').textContent),'invalid characters are reported: '+t.$('ignoredNote').textContent);
  t.set('123456'); let c=t.d.querySelector('input[name=mode][value=coin]'); c.checked=true; c.onchange(); ok(t.$('rolls').value==='','mode switch clears entered rolls');
  const tm=load({confirm:false}); await tm.ready(); tm.set('123456'); c=tm.d.querySelector('input[name=mode][value=coin]'); c.checked=true; c.onchange();
  ok(tm.$('rolls').value==='123456'&&tm.d.querySelector('input[name=mode][value=dice]').checked,'cancelling a mode switch keeps rolls and mode');
  // item 5 & 6: CSP, no links
  ok(/Content-Security-Policy/.test(html)&&/default-src 'none'/.test(html),'CSP meta present with default-src none');
  sweep(t);
  await (async()=>{ const anchors=html.replace(/const WORDLIST = \[.*?\];/s,'').match(/<a\s[^>]*>/gi)||[]; ok(anchors.length===1&&anchors[0]==='<a href="https://random21m.github.io/VOIDFORGE/" target="_blank" rel="noopener noreferrer">','page contains exactly one link: the online practice copy, opening in a new tab with noopener noreferrer'); })();
  // v1.2: only 12/24 words, no copy-seed button
  eq([...t.d.querySelectorAll('input[name=words]')].map(e=>e.value).join(','),'12,15,18,21,24','the 12, 15, 18, 21 and 24 word options are offered (v2.10.0)');
  ok(![...t.d.querySelectorAll('button')].some(b=>/COPY SEED/.test(b.textContent))&&typeof t.w.copyResult==='undefined','no copy-seed button or function');
  sweep(t);
  await (async()=>{ const pb=t.$('privacyBox'); ok(!!pb&&/Privacy/.test(pb.querySelector('summary').textContent)&&pb.querySelectorAll('ul li').length===7&&!pb.querySelector('a,script,img,form,input'),'privacy box has seven points (one is the session note for the start notice) and no links or inputs');
    const keys=[...html.matchAll(/localStorage\.setItem\("([^"]+)"/g)].map(m=>m[1]).sort().join(',');
    ok(keys==='voidforge-big,voidforge-theme'&&/Only two things are remembered/.test(pb.textContent),'privacy box: the page stores exactly the theme and text size, as the box says');
    ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(html.replace(/const WORDLIST = \[.*?\];/s,'')),'privacy box: no network calls in the page'); })();
  sweep(t);
  await (async()=>{ const sb=t.$('safetyBox'); ok(!!sb&&/Browser safety checklist/.test(sb.querySelector('summary').textContent)&&sb.querySelectorAll('ol li').length===8&&!sb.querySelector('script,img,form,input')&&sb.querySelectorAll('a').length===1,'browser safety checklist has eight items and no links or inputs');
    ok(/offline/i.test(sb.querySelectorAll('ol li')[0].textContent)&&/clipboard/i.test(sb.textContent)&&/translation/i.test(sb.textContent)&&/restart/i.test(sb.textContent),'checklist covers going offline, clipboard, translation and restarting'); })();
  sweep(t);
  await (async()=>{ const B=t.d.body; if(!t.w.Element.prototype.scrollIntoView) t.w.Element.prototype.scrollIntoView=function(){};
    ok(!B.classList.contains('guided')&&!t.d.querySelector('.gh')&&/GUIDE ME/.test(t.$('guideBtn').textContent),'guide is off by default and hides nothing');
    t.w.toggleGuide(); t.w.guideStep(-4); ok(B.classList.contains('guided')&&t.$('rolls').classList.contains('gh')&&!t.$('wordRadios').classList.contains('gh'),'GUIDE ME shows one screen at a time');
    t.$('rolls').value=''; t.w.guideStep(1); ok(t.$('gNext').disabled,'guide: NEXT is locked until enough rolls');
    { const gx=t.$('gExit'); ok(!!gx&&t.$('guidePanel').contains(gx)&&/EXIT GUIDE/.test(gx.textContent)&&!gx.closest('.gstep')&&!gx.disabled,'guide: an EXIT GUIDE button sits in the always-visible top of the guide panel, not inside one step');
      for(const n of [1,2,3,4,5]){ t.w.guideN=n; t.w.guideRender(); ok(t.$('guidePanel').contains(gx)&&gx.offsetParent!==undefined&&!gx.closest('.gh'),'guide step '+n+': EXIT GUIDE is still there'); }
      t.w.guideN=3; t.w.guideRender(); gx.click(); ok(!B.classList.contains('guided')&&!t.d.querySelector('.gh')&&/GUIDE ME/.test(t.$('guideBtn').textContent)&&t.$('guideBtn').getAttribute('aria-pressed')==='false','clicking EXIT GUIDE turns the guide off and shows everything again');
      t.w.toggleGuide(); }
    t.w.toggleGuide(); ok(!t.d.querySelector('.gh')&&!B.classList.contains('guided'),'turning the guide off shows everything again');
    const terms=[...t.d.querySelectorAll('.term')]; ok(terms.length>=6&&terms.every(e=>e.tabIndex===0&&e.dataset.tip.length>40),'explained words are focusable and have a plain explanation');
    t.w.toggleSize(); ok(B.classList.contains('big'),'TEXT A+ enlarges the page'); t.w.toggleSize(); ok(!B.classList.contains('big'),'TEXT A- restores it'); })();
  sweep(t);
  await (async()=>{
    { const css=html.match(/<style>[\s\S]*?<\/style>/)[0], hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
      const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
      const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const tags=[...t.w.document.querySelectorAll('.tag-rec')], opts=[...t.w.document.querySelectorAll('option.opt-rec')];
      // every "recommended" label on a screen (not the changelog or help text) is a badge or a colored option
      const labels=[...t.w.document.querySelectorAll('summary, option')].filter(e=>/recommended/i.test(e.textContent));
      ok(tags.length===3&&opts.length===1&&labels.length===4&&labels.every(e=>e.querySelector('.tag-rec')||e.classList.contains('opt-rec')),'recommended: every RECOMMENDED label is an amber badge (or an amber option in the menu)');
      const tok=(blk,n)=>{ const m=new RegExp(n+': (#[0-9a-fA-F]{6})').exec(blk); return m?m[1]:'#000000'; };
      const rootBlk=[...css.matchAll(/\n  :root \{[^}]*\}/g)].pop()[0], lightBlk=[...css.matchAll(/\n  body\.light \{[^}]*\}/g)].pop()[0];
      for(const [nm,blk] of [['dark',rootBlk],['light',lightBlk]]){
        const bg=hex(tok(blk,'--bg')), sf=hex(tok(blk,'--surface'));
        const pairs=[['--text',bg],['--muted',bg],['--muted',sf],['--goldtx',bg],['--warn-text',sf],['--bad-text',sf],['--ok-text',sf]];
        ok(pairs.every(([k,b2])=>cr(hex(tok(blk,k)),b2)>=4.5)&&cr(hex(tok(blk,'--btntx')),hex(tok(blk,'--btn')))>=4.5,'colors ('+nm+'): text, gray text, gold, red and green words and the gold button label all keep contrast >= 4.5:1'); }
      ok(/\.tag, body\.light \.tag \{ border: 0; background: none;/.test(css)&&/\.tag-rec, body\.light \.tag-rec \{ color: var\(--warn-text\); background: none; \}/.test(css)&&/\.opt-rec \{[^}]*color: var\(--warn-text\)/.test(css),'labels: RECOMMENDED, SECRET, PUBLIC and the gray ones are plain colored words (no pill, border or fill)');
      { const notes=[...t.w.document.querySelectorAll('.tag-note')], ros=[...t.w.document.querySelectorAll('.tag-ro')];
        ok(notes.length===3&&notes.every(e=>/^ADVANCED$/.test(e.textContent))&&![...t.w.document.querySelectorAll('summary')].some(e=>/\((demo only|advanced)/i.test(e.textContent)),'tags: ADVANCED is a gray label, not plain (brackets) in the headings');
        ok(ros.filter(e=>e.textContent==='NEW').length===2&&!ros.some(e=>e.textContent==='PRACTICE ONLY')&&t.w.document.querySelector('#ssBox > summary .tag-secret').textContent==='SECRET','tags: every "NEW" badge (Multisig header, Silent Payment address) looks the same gray tag-ro style, and the practice signer is SECRET (v2.16.1: it takes any seed)');
 }
    }
    ok(/#statusLine \{ position: relative; z-index: 1;/.test(html),'status line sits above the page background');
    { const die=t.$('brandDie'), h=t.d.querySelector('#topbar h1'); ok(!!die&&die.querySelectorAll('.dp').length===5&&die.querySelectorAll('.db').length===1&&!!h&&h.textContent==='VOIDFORGE'&&/#topbar h1[^{]*\{[^}]*color: var\(--goldtx\)[^}]*filter: none/.test(html)&&!t.$('logo')&&!/\n  \.logo \{/.test(html)&&typeof t.w.rollLogo==='undefined','header: one flat golden die and the gold name VOIDFORGE (the rolling 3D dice are gone)'); }
    t.$('rolls').value=''; })();
  sweep(t);
  await (async()=>{ // Word draw: words drawn from physical tiles + coin flips -> standard BIP39, known answers
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
    t.$('passphrase').value=''; t.$('passphrase2').value=''; })();
  sweep(t);
  await (async()=>{ let threw=false; try{ await t.w.rollsToMnemonic('1'.repeat(62),13);}catch(e){threw=true;} ok(threw,'a 13-word seed (not a BIP39 length) is rejected'); })();
  sweep(t);
  await (async()=>{ const {entropyToMnemonic:e2m}=require('@scure/bip39'), {wordlist:wl}=require('@scure/bip39/wordlists/english'), R='352614'.repeat(17), nc2=require('crypto');   // v2.10.0 release run: every length keeps the right number of hash bytes
    const got=[]; for(const [n,b] of [[12,16],[15,20],[18,24],[21,28],[24,32]]) got.push((await t.w.rollsToMnemonic(R,n))===e2m(nc2.createHash('sha256').update(R).digest().subarray(0,b),wl));
    ok(got.every(Boolean),'dice seeds of 12, 15, 18, 21 and 24 words are the first 128, 160, 192, 224 and 256 bits of SHA-256 of the rolls (checked with @scure)'); })();
  ok(/Recovery notes/.test(html)&&/move the funds/.test(html),'changelog has recovery notes for removed modes');
  ok((await t.w.checkPhrase('abandon '.repeat(14)+'address')).ok,'VERIFY still accepts 15-word phrases from other tools');
  sweep(t);
  await (async()=>{ const r=await t.w.checkPhrase('constructor '+'abandon '.repeat(10)+'about'); ok(!r.ok&&/^Unknown word: constructor \(word 1\): no BIP39 word is close\. /.test(r.msg),'VERIFY reports a JavaScript property name typed as a word as an unknown word (v1.28.0)'); })();
  sweep(t);
  await (async()=>{ const tcn=load(); await tcn.ready(); tcn.mode('coin'); tcn.set('0101'); await tcn.w.generate(); ok(/flips/.test(tcn.$('genResult').textContent)&&!/rolls/.test(tcn.$('genResult').textContent),'coin-mode length message says flips'); })();
  sweep(t);
  await (async()=>{ const ts=load(); await ts.ready(); ts.set(rnd(50)); await ts.w.generate(); const w0=ts.$('genResult').textContent.split('\n')[0];
    await ts.w.sendToVerify();
    ok(ts.$('phrase').value===w0&&/Valid 12-word/.test(ts.$('verifyStatus').textContent),'SEND TO CHECK fills the VERIFY box and validates the seed');
    ok(ts.st.clip.length===0,'SEND TO CHECK does not touch the clipboard');
    const te=load(); await te.ready(); await te.w.sendToVerify(); ok(te.st.alerts.length===1&&te.$('phrase').value==='','SEND TO CHECK with no seed alerts and does nothing'); })();
  sweep(t);
  await (async()=>{ // Multisig wizard: three known seeds -> known descriptor and addresses (made with @scure/bip32 + btc-signer), wipes, refusals
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
    eq([...$('msAddrs').children].slice(0,3).map(li=>li.textContent).join(''),'bc1qea2gkgeszr7wm66x2ejkgdxm9nhg9462sszn75zmkhazev0t02vs70kkll'+'bc1qa0sj5tjwunnxyhmkgd85548gwqv2r0tc6vjs9c3yy2j7gjea72hs9dvptd'+'bc1qmes7qgkj4fedgj86er5z2yx2hyfjwaw9rmhsap30ul42xl4eayrsx3qsm0','multisig: the first 3 receive addresses equal the independent library');
    ok($('msAddrs').children.length===10&&$('msChange').children.length===10&&new Set([...$('msAddrs').children,...$('msChange').children].map(li=>li.textContent)).size===20,'multisig: 10 receive and 10 change addresses, all different');
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

  })();
  sweep(t);
  await (async()=>{ const tp=load(); await tp.ready(); const $=tp.$;
    eq((await tp.w.practiceMake(new tp.w.Uint8Array(16))).join(' '),'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about','practice: the phrase is a valid 12-word BIP39 phrase made from the entropy');
    const E=['abandon','ability','able','about'];
    ok(tp.w.practiceCompare(E,'abandon ability able about').ok&&tp.w.practiceCompare(E,'  ABANDON  ability\nable about ').ok,'practice: a correct copy matches (case and spacing do not matter)');
    ok(/Word 3 does not match/.test(tp.w.practiceCompare(E,'abandon ability zoo about').msg)&&/Words 2, 4 do not match/.test(tp.w.practiceCompare(E,'abandon zoo able zoo').msg),'practice: wrong words are named by position');
    ok(/typed 3 words; the public test seed has 4/.test(tp.w.practiceCompare(E,'abandon ability able').msg)&&/typed 5 words/.test(tp.w.practiceCompare(E,'abandon ability able about zoo').msg)&&/typed 1 word;/.test(tp.w.practiceCompare(E,'abandon').msg),'practice: a missing or extra word is reported by count');
    ok(!tp.w.practiceCompare(E,'ability abandon able about').ok,'practice: right words in the wrong order do not match');
    await tp.w.practiceStart(); const words=tp.w.eval('practice.words');
    ok(words.length===12&&$('prWords').children.length===12&&$('prShow').style.display==='block'&&$('prCheck').style.display==='none'&&/Never put money on this public test seed/.test($('prShow').textContent)&&!!$('prShow').querySelector('.ms-test'),'practice: START shows 12 numbered words with a never-fund warning');
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
    ok(!/getRandomValues|Math\.random|\.randomUUID|msCrypto/.test(html.replace(/const WORDLIST = \[.*?\];/s,'')),'the page contains no browser random-number call at all'); })();
  // ---- v1.25.0 layout: tabs, Your seed panel, step bar, word slots, dice wait ----
  sweep(t);
  await (async()=>{ const tl=load({focusSpy:true}); await tl.ready(); const T=(n)=>tl.$('tp-'+n), on=(n)=>!T(n).classList.contains('tab-off'), sel=(n)=>tl.$('tab-'+n).getAttribute('aria-selected');
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
    { const AB='abandon '.repeat(11)+'about'; tl.$('phrase').value=''; const tf2=tl; tf2.set(rnd(50,6)); tf2.$('forgeBtn').disabled=false; await tf2.w.generate(); ok(on('make')&&tf2.w.hasSeed(),'forge keeps you on Make a seed');
      // v2.16.1 (an intermittent e2e failure): FORGE SEED goes on after the words show (address lists, then the watch-only box); a tab
      // opened in that time stays open, and back on Make a seed it still lands on YOUR SEED. The tab is clicked during the last step.
      { const rw0=tf2.w.refreshWatch, P=tf2.w.Element.prototype, siv=P.scrollIntoView; let to=null; P.scrollIntoView=function(){ to=this.id; };
        const during=async(pick)=>{ let n=0; to=null; tf2.w.refreshWatch=function(...a){ if(!n++) for(const k of pick) tf2.$('tab-'+k).dispatchEvent(new tf2.w.MouseEvent('click',{bubbles:true})); return rw0.apply(this,a); }; try{ tf2.set(rnd(50,6)); await tf2.w.generate(); } finally { tf2.w.refreshWatch=rw0; } return n; };
        try {
          let n=await during(['check']); ok(n===1&&tf2.w.hasSeed()&&on('check')&&!on('make')&&to!=='seedHead','a tab opened while FORGE SEED finishes stays open: no late jump back to YOUR SEED (v2.16.1)');
          tf2.w.showTab('make'); n=await during(['tools','make']); ok(n===1&&tf2.w.hasSeed()&&on('make')&&to==='seedHead','back on Make a seed before FORGE SEED finishes: it still lands on YOUR SEED (v2.16.1)');
        } finally { if(siv) P.scrollIntoView=siv; else delete P.scrollIntoView; tf2.w.showTab('make'); } }
      await tf2.w.sendToVerify(); ok(on('check')&&tf2.$('phrase').value.split(' ').length===12,'SEND TO CHECK opens the Check tab with the words in the box'); }
    // every control from earlier versions is still in exactly one tab or in the page frame
    { const ids=['brandDie','menuBox','rolls','forgeBtn','genResult','wordGrid','fingerprint','address','passphrase','passphrase2','note','phrase','verifyPass','verifyRecorded','checkAddr','psbtInput','cmpA','cmpB','msN','msM','msBox','wdBox','methodTabs','wordSel','advanced','addrBox','explainBox','seedQrBox','watchBox','about','beforeCard','disclaimer','safetyBox','privacyBox','multiHelp','practiceBox','psbtBox','fpIcon','guidePanel','tapRow','testResults','printOnly','printQr','netTag','selfTestBadge'];
      const missing=ids.filter(id=>!tl.$(id)); ok(missing.length===0,'feature inventory: every earlier control and section is still on the page'+(missing.length?' (missing '+missing.join(', ')+')':''));
      const homeless=['rolls','forgeBtn','phrase','psbtInput','cmpA','msN','about','beforeCard','disclaimer'].filter(id=>!tl.$(id).closest('.tabpanel')); ok(homeless.length===0,'feature inventory: every tool lives inside a tab'+(homeless.length?' ('+homeless.join(', ')+')':''));
      ok(['printOnly','printQr'].every(id=>!tl.$(id).closest('.tabpanel')),'printing works from any tab: the print sheets sit outside the tabs');
      const btns=[...tl.d.querySelectorAll('button')].filter(b=>!b.closest('.tabpanel')&&!b.closest('#startGate')&&!b.closest('#tabs')).map(b=>b.textContent.trim().replace(/\s+/g,' ')).sort().join('|');
      eq(btns,['DARK','DOWNLOAD FOR USB','END SESSION','GUIDE ME','PRINT SEED','PRINT STAMP SHEET','TEXT A+','Read before real keys \u2192','Turn practice mode off','IS ANYTHING WATCHING THIS PAGE?','I FOUND A BITCOIN BACKUP','CHECK THE WORDS','OPEN THE WALLET DETECTIVE','CLOSE','OPEN PRACTICE SIGNER','PRACTICE SIGNER','SHOW','DONATE'].sort().join('|'),'page frame holds exactly the top buttons, the notice link, the practice banner\'s off switch (v2.5.0; hidden unless practice mode is on), Heir mode with its three buttons, the watch check in the MENU (v2.8.0), the practice signer card and MENU entry (v2.14.0), SHOW on the re-hide notice (v2.15.0), and DONATE in the footer (v2.16.1)'); }
    // the three warnings and the disclaimer moved to About, with their text intact
    ok(/AIR-GAPPED USE ONLY/.test(tl.$('tp-about').textContent)&&/not been independently audited/.test(tl.$('disclaimer').textContent)&&tl.$('beforeCard').querySelectorAll('.sg-item').length===3,'About & help holds the air-gap warning, the disclaimer and the three computer-memory warnings');
    ok(!tl.$('tp-make').contains(tl.$('about'))&&tl.$('tp-tools').contains(tl.$('cardMulti'))&&tl.$('tp-tools').contains(tl.$('cardTools'))&&tl.$('tp-check').contains(tl.$('cardCheck')),'each card sits in the right tab');
  })();
  sweep(t);
  await (async()=>{ const tc=load(); await tc.ready(); const big=()=>tc.$('bigCount'), sub=()=>tc.$('bigSub');
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
  })();
  sweep(t);
  await (async()=>{ const ts=load(); await ts.ready(); const cells=()=>[...ts.$('wordGrid').children];
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
  })();
  ok([['make','MAKE','MAKE A SEED'],['check','CHECK','CHECK A BACKUP'],['tools','TOOLS','EXTRA TOOLS'],['about','ABOUT','ABOUT & HELP']].every(([t,sh,fl])=>html.includes('data-tab="'+t+'" aria-label="'+fl+'"><span class="lg">')&&html.includes('<span class="sh">'+sh+'</span>')),'tabs: every tab has a full name (screen readers, wide screens) and a short name for phones');
  sweep(t);
  await (async()=>{ const tf2=load(); await tf2.ready(); const mk=(c)=>c.map((n,i)=>String(i+1).repeat(n)).join('');
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
    tf2.set('1'.repeat(15)+'0'.repeat(5)); ok(/\u03c7\u00b2 = 5\.00, 1 degree of freedom, p \u2248 0\.025\. Mildly unusual: a fair coin does this/.test((tf2.$('rcStat')||{}).textContent||''),'fairness test: coin result with its numbers and the word coin'); })();

  sweep(t);
  await (async()=>{ const tw=load(); await tw.ready(); const F=(x)=>tw.w.wdFindWord(x);
    // reference words from the python-mnemonic library's English list
    const W=[["1","abandon",1],["2048","zoo",2048],["257","cactus",257],["680","female",680],["3 A 7","female",680],["3-a-7","female",680],["1 0 0","abandon",1],["8 F F","zoo",2048],["2 0 0","cactus",257],["300","century",300],[" 300 ","century",300]];
    ok(W.every(([i,wd,n])=>{const r=F(i);return r.word===wd&&r.idx===n-1&&r.msg==='Word '+n+': '+wd;}),'word finder: numbers and D8 + hex dice give the right BIP39 words');
    ok(['9 0 0','0 0 0','3 G 7','abc','3 A','3 A 7 7','-'].every(x=>F(x).word===undefined&&F(x).idx===undefined&&F(x).msg==='Type a number from 1 to 2048, a D8 roll (1-8) then two hex digits (0-F) like 3 A 7, or a BitBox02 diceware roll like 2143 2 T.'),'word finder: bad entries give a hint and no word');
    ok(['0','2049','99999'].every(x=>F(x).msg==='A word number is between 1 and 2048.'&&F(x).idx===undefined),'word finder: out-of-range numbers are explained');
    ok(F('').msg===''&&F('   ').msg==='','word finder: empty entry says nothing');
    tw.w.document.getElementById('wdFind').value='3 A 7'; tw.w.wdFind(); ok(tw.$('wdFound').textContent==='Word 680: female','word finder: shows the word on the page');
    ok(tw.$('wdFind').closest('#tp-make')!==null,'word finder: lives in the Make a seed tab'); })();
  sweep(t);
  await (async()=>{ // v2.3.0 BitBox02 diceware: the table code in the word finder, ADD WORD, and the 24th word from 3 flips (T = 1, H = 0)
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
      tb.$('wdFlips').value=flipsHT.replace(/T/g,'1').replace(/H/g,'0'); tb.w.wdUpdate(); ok(!tb.$('wdBtn').disabled,'BitBox02: 23 table words and 3 flips unlock FORGE SEED');
      await tb.w.wdGenerate(); const got=tb.$('genResult').textContent.split('\n')[0].split(' ');
      ok(got.length===24&&got.slice(0,23).join(' ')===idx.map(n=>WL[n]).join(' ')&&got[23]===cand(idx,i),'BitBox02: the 24th word is the candidate BitBox shows for '+flipsHT+' (T = 1, H = 0)'); }
    { // v2.3.0 review fix: a Word draw seed is cleared when its words, flips or length change afterwards
      const made=tb.$('genResult').textContent.split('\n')[0]; ok(tb.w.hasSeed()&&made.split(' ').length===24,'Word draw: the BitBox02 seed is made');
      const fl=tb.$('wdFlips').value; tb.$('wdFlips').value=fl==='111'?'000':'111'; tb.$('wdFlips').oninput&&tb.$('wdFlips').oninput(); tb.w.wdUpdate();
      ok(!tb.w.hasSeed()&&/You changed the words, the coin flips or the word count after FORGE SEED/.test(tb.$('genResult').textContent)&&tb.$('wdOut').textContent===''&&tb.$('wdOut').style.display==='none','Word draw: changing the flips after the seed was made clears it and the last-word steps');
      tb.$('wdFlips').value=fl; tb.w.wdUpdate(); await tb.w.wdGenerate(); ok(tb.w.hasSeed()&&tb.$('genResult').textContent.split('\n')[0]===made,'Word draw: the same words and flips make the same seed again');
      tb.$('wdFind').value='1111 1 H'; tb.w.wdAddFound(); ok(!tb.w.hasSeed(),'Word draw: adding a word after the seed was made clears it');
      tb.$('wdWords').value=made.split(' ').slice(0,23).join(' '); tb.w.wdUpdate(); await tb.w.wdGenerate(); tb.words(12); ok(!tb.w.hasSeed(),'Word draw: changing the word count clears the seed'); }
    ok(/Using BitBox02&rsquo;s diceware table\?/.test(html)&&/T as 1 and H as 0/.test(html)&&/HHH picks the first, TTT the eighth/.test(html),'BitBox02: the Word draw box explains the table codes and the 3 flips'); })();
  sweep(t);
  await (async()=>{ // v2.3.0 Verify a signed message: official BIP322 vectors (bitcoin/bips) and Bitcoin Core's classic test vector, through the page
    const ts=load(); await ts.ready(); const V=(a,m,sg)=>ts.w.verifyMessage(a,m,sg);
    const CORE=['mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB','This is just a test message','INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0='];
    const W1='bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l', SE='smpAkcwRAIgM2gBAQqvZX15ZiysmKmQpDrG83avLIT492QBzLnQIxYCIBaTpOaD20qRlEylyxFSeEA2ba9YOixpX8z46TSDtS40ASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=';
    const SH=['smpAkcwRAIgZRfIY3p7/DoVTty6YZbWS71bc5Vct9p9Fia83eRmw2QCICK/ENGfwLtptFluMGs2KsqoNSk89pO7F29zJLUx9a/sASECx/EgAxlkQpQ9hYjgGu6EBCPMVPwVIVJqO4XCsMvViHI=','smpAkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScOjf1lAqIUIQtr3zKNeavYabHyR8eGhowEhAsfxIAMZZEKUPYWI4BruhAQjzFT8FSFSajuFwrDL1Yhy'];
    const TR=['bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler','No prefix fallback','AUCJYOwOjxYAvatTAGYaVlNXBVyFuc4MwNQkOuK2tl8xhfKDONd0NjfYyNSYcRqeCp8hsAnCEPHAVEkO9h6vbQ/R'];
    let r=await V(...CORE); ok(r.state==='valid'&&!r.variant&&/^VALID: the key of mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB signed exactly this message\.\nFormat: classic \(BIP137\), Legacy \(m\.\.\. or n\.\.\.\)\.\nA signature shows that whoever holds/.test(r.text),'signed message: Bitcoin Core\'s test vector is VALID, names the address, testnet labels');
    r=await V('1BquDSCmzyqhKnMXByiDQEFbY3DkMRi1XP','recid two','IQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEjRWeJCrze8='); ok(r.state==='valid'&&/Legacy \(1\.\.\.\)/.test(r.text),'signed message: recovery id 2 (R.x = r + n), checked with @noble/curves');
    r=await V(CORE[0],CORE[1],Buffer.from([0x2b,...Buffer.from(CORE[2],'base64').subarray(1)]).toString('base64')); ok(r.state==='error'&&/damaged: its first byte must be 27 to 42/.test(r.text),'signed message: a classic signature with a bad first byte is called damaged');
    r=await V(CORE[0],CORE[1],'AAAA'); ok(r.state==='error'&&/not a classic signature/.test(r.text),'signed message: a short signature for a 1... address is refused');
    r=await V(CORE[0],CORE[1]+'.',CORE[2]); ok(r.state==='invalid'&&/^NOT VALID: this signature does not match this address and this message\./.test(r.text),'signed message: one character more is NOT VALID');
    r=await V(CORE[0],CORE[1]+'\r\n',CORE[2]); ok(r.state==='valid'&&r.variant===true&&/^VALID, after a small change to the message: the key of mpLQ/.test(r.text),'signed message: a trailing line break is accepted, with a clear warning');
    r=await V('mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxC',CORE[1],CORE[2]); ok(r.state==='error'&&/checksum does not match/.test(r.text),'signed message: an address with a typo is refused');
    r=await V(W1,'',SE); ok(r.state==='valid'&&/BIP322 simple, Native SegWit \(bc1q\.\.\.\)/.test(r.text)&&r.text.includes(W1),'signed message: BIP322 simple P2WPKH, empty message (official vector)');
    // every official BIP322 vector (bitcoin/bips bip-0322/*.json): simple ones VALID (or CANNOT CHECK for multisig), full and proof-of-funds
    // CANNOT CHECK with and without their prefix, every error case never VALID
    { const VB=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','bip322-basic-test-vectors.json'),'utf8')), VG=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','bip322-generated-test-vectors.json'),'utf8'));
      let bad=[], n=0;
      for(const v of [...VB.simple,...VG.simple]) for(const sg of v.bip322_signatures){ n++; const want=/p2wsh/.test(v.type)?'cannot':'valid'; for(const x of [sg, sg.startsWith('smp')?sg.slice(3):'smp'+sg]){ const g=(await V(v.address,v.message,x)).state; if(g!==want) bad.push(v.type+' '+g); } }
      for(const v of [...VG.full,...VG.proof_of_funds]) for(const sg of v.bip322_signatures){ n++; for(const x of [sg, /^(ful|pof)/.test(sg)?sg.slice(3):sg]){ const g=(await V(v.address,v.message,x)).state; if(g!=='cannot') bad.push(v.type+' full '+g+(x===sg?'':' (no prefix)')); } }
      for(const v of [...VB.error,...VG.error]){ n++; const g=(await V(v.address,v.message,v.signature)).state; if(g==='valid') bad.push('error case '+v.description); }
      ok(n===59&&bad.length===0,'signed message: all '+n+' official BIP322 vectors give the right result, with and without the prefix ('+(bad.join('; ')||'no mismatches')+')'); }
    for(const sg of SH){ r=await V(W1,'Hello World',sg); ok(r.state==='valid','signed message: BIP322 simple P2WPKH "Hello World" (official vector, '+sg.slice(3,10)+'...)'); }
    r=await V(W1,'Hello World',SH[0].slice(3)); ok(r.state==='valid'&&/without the smp prefix/.test(r.text),'signed message: a BIP322 signature without the smp prefix is read as simple');
    r=await V(W1,'Wrong message that was not signed',SE); ok(r.state==='invalid','signed message: official vector, wrong message is NOT VALID');
    r=await V(...TR); ok(r.state==='valid'&&/BIP322 simple, Taproot/.test(r.text),'signed message: BIP322 simple Taproot (official vector)');
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
    ok(/\n  \.status\.warn \{ color: var\(--warn-text\); \}/.test(html),'signed message: the amber is the warning color');
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
    ok(!/signMessage|function sign[A-Z]|privateKey/.test((html.match(/\/\/ ===== Verify a signed message[\s\S]*?function clearSig/)||[''])[0]),'signed message: the code only verifies (nothing that signs)'); })();
  sweep(t);
  await (async()=>{ // v2.3.0 Keystone dice rules: every 6 counts as 0, 50 / 100 rolls or more, at most 256
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
    ok([...tk.d.querySelectorAll('#wordGrid .wcell span')].map(x=>x.textContent).join(' ')===mnK(R60.slice(0,55),12),'Keystone: the gray preview words follow the Keystone rules');
    tk.set(R60); await tk.w.generate(); await tk.w.showExplain(); const ex=tk.$('exOut').textContent; ok(/Keystone dice rules: every 6 is written as 0/.test(ex)&&/These words match the seed above/.test(ex),'Keystone: How your seed was made shows the 6-as-0 step and matches');
    tk.st.blob=null; tk.w.downloadSeed(); const dl=await blobText(tk.w,tk.st.blob); ok(/Dice rules: Keystone \(each 6 counts as 0 before hashing\)/.test(dl),'Keystone: the downloaded file says Keystone rules were used');
    tk.mode('coin'); ok(tk.$('rulesRow').style.display==='none'&&!tk.w.keystoneOn()&&tk.$('lenNote').textContent==='128 coin flips or more','Keystone: the menu is hidden and off in coin mode');
    tk.mode('dice'); ok(tk.$('rulesRow').style.display===''&&tk.w.keystoneOn(),'Keystone: back to dice, the choice is kept');
    tk.w.setMethod('words'); ok(tk.$('rulesRow').style.display==='none','Keystone: the menu is hidden in Word draw'); tk.w.setMethod('dice'); })();
  ok(/#cardGen \.gen-right \{ grid-column: 2; grid-row: 1 \/ span 2;[^}]*position: sticky/.test(html)&&/#cardGen \.gen-bottom \{ grid-column: 1; grid-row: 2;/.test(html),'layout: the sticky Your seed panel sits beside all the content and never slides over it (QR codes were hidden behind it)');
  sweep(t);
  await (async()=>{ const tg=load(); await tg.ready(); const g=tg.$('startGate'), body=g.querySelector('.sg-body'), go=tg.$('sgGo');
    ok(!!body&&!body.contains(go)&&go.parentNode.classList.contains('sg-box')&&body.parentNode.classList.contains('sg-box'),'start notice: the I understand button sits outside the scrolling text, so it is always on screen (phones could not reach it)');
    ok(/#startGate \.sg-box \{[^}]*max-height: 100%; overflow: hidden; display: flex; flex-direction: column;/.test(html)&&/#startGate \.sg-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/.test(html)&&/#startGate \.sg-go, #startGate \.sg-foot \{ flex: none; \}/.test(html),'start notice: the box fits the screen, only the text scrolls, the button and footer never shrink or scroll away');
    ok(/#startGate \{ position: fixed; top: 0; right: 0; bottom: 0; left: 0;/.test(html)&&!/inset:/.test(html),'start notice: covers the screen with top/right/bottom/left (the inset shorthand fails on iOS before 14.1)');
    ok(tg.d.body.classList.contains('js-ok')&&/\n  #startGate \{ position: fixed;[^}]*display: none;/.test(html)&&/body\.js-ok #startGate \{ display: flex; \}/.test(html),'start notice: only shown once the script has run, so a phone that blocks scripts shows the red warning instead of a dead button');
    ok((html.match(/\n  #startGate \{/g)||[]).length===1&&!/#startGate[^{]*\{[^}]*display:[^;}]*!important/.test(html),'start notice: nothing forces the notice to show when the script has not run');
    ok(body.getAttribute('tabindex')==='0'&&/things to know/.test(body.getAttribute('aria-label')||''),'start notice: the scrolling text is reachable by keyboard and named'); })();
  ok(/\.tabpanel \[id\] \{ scroll-margin-top: 84px; \}/.test(html),'layout: every section keeps clear of the sticky tab bar when the page jumps to it');
  ok(/@media \(min-width: 861px\) \{ #cardGen \.gen-right \{ max-height: calc\(100vh - 92px\); overflow-y: auto;/.test(html),'layout: a tall Your seed panel scrolls inside itself so its bottom buttons (COPY, DOWNLOAD) stay reachable');
  ok(/#qrBox, #sqBox, #msQrBox \{ scroll-margin: 80px 0 20px; \}/.test(html),'layout: QR boxes keep clear of the sticky tab bar when scrolled to');
  sweep(t);
  await (async()=>{ const tq=load(); await tq.ready(); const seen=[]; const spy=(id)=>{const el=tq.$(id); el.scrollIntoView=(o)=>seen.push([id,o&&o.block]);};
    ['qrBox','sqBox'].forEach(spy); tq.w.document.getElementById('wDescR').textContent='wpkh(x)'; tq.w.showQr('wDescR','receive descriptor');
    ok(seen.length===1&&seen[0][0]==='qrBox'&&seen[0][1]==='nearest','QR: showing the watch-only QR scrolls it fully into view');
    tq.set(rnd(50)); await tq.w.generate(); tq.w.showSeedQr('seedqr'); ok(seen.length===2&&seen[1][0]==='sqBox'&&seen[1][1]==='nearest','QR: showing the SeedQR scrolls it fully into view'); })();
  ok(/\.tabs button\[aria-selected="true"\], body\.light \.tabs button\[aria-selected="true"\][^{]*\{[^}]*border-bottom-color: var\(--gold\)/.test(html),'tabs: the selected tab is marked with a gold underline in both themes');
  sweep(t);
  await (async()=>{ const td=load(); await td.ready(); ok(td.d.body.classList.contains('dice-wait')&&!!td.$('startGate'),'dice: held back while the notice is open');
    td.w.startGateClose(); ok(!td.d.body.classList.contains('dice-wait'),'dice: released when the notice is closed with the button');
    const te=load(); await te.ready(); te.d.dispatchEvent(new te.w.KeyboardEvent('keydown',{key:'Escape'})); ok(!te.d.body.classList.contains('dice-wait'),'dice: released when the notice is closed with Escape');
    const tn=load(); await tn.ready(); tn.$('startGate').remove(); tn.d.dispatchEvent(new tn.w.Event('DOMContentLoaded')); ok(!tn.d.body.classList.contains('dice-wait'),'dice: not held back if there is no notice'); })();
{ const tf=load({focusSpy:true}); await tf.ready(); await new Promise(r=>setTimeout(r,100));
    ok(tf.st.focus.some(x=>x[0]==='sgGo'&&x[1]&&x[1].preventScroll===true)&&!tf.st.focus.some(x=>x[0]==='rolls'),'opening the page focuses the notice button (not the rolls box) without scrolling');
    tf.st.focus.length=0; tf.w.startGateClose(); const f=tf.st.focus.find(x=>x[0]==='rolls'); ok(!!f&&f[1]&&f[1].preventScroll===true&&!tf.$('startGate'),'closing the notice removes it and focuses the rolls box without scrolling the page down to it');
    { tf.st.focus.length=0; tf.w.matchMedia=q=>({matches:/pointer:\s*coarse/.test(q)}); tf.w.startGateClose(); ok(!tf.st.focus.some(x=>x[0]==='rolls'),'closing the notice on a phone or tablet (touch pointer) does not focus the rolls box, so the on-screen keyboard stays down');
      tf.st.focus.length=0; tf.w.matchMedia=()=>({matches:false}); tf.w.startGateClose(); ok(tf.st.focus.some(x=>x[0]==='rolls'),'closing the notice with a mouse still focuses the rolls box'); delete tf.w.matchMedia; }
    { const tg=load(); await tg.ready(); const g=tg.$('startGate'); ok(!!g&&g.getAttribute('role')==='dialog'&&g.getAttribute('aria-modal')==='true'&&/educational tool/.test(g.textContent)&&/not been independently audited/.test(g.textContent)&&g.querySelectorAll('.sg-item').length===3&&/swap files, hibernation/.test(g.textContent)&&/Clipboard history/.test(g.textContent)&&/restart the computer/.test(g.textContent),'notice: educational, not audited, and the three warnings with what to do');
      ok(g.querySelectorAll('.sg-fix').length===3&&/I understand, let\u2019s go/.test(tg.$('sgGo').textContent),'notice: each warning has a fix and one button closes it');
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
  sweep(t);
  await (async()=>{ const tc=load(); await tc.ready(); const h=await tc.w.sha256bytes(new TextEncoder().encode('123456'));
    const m24=await tc.w.entropyToMnemonic(h), m12=await tc.w.entropyToMnemonic(h.slice(0,16));
    ok(m24==='mirror reject rookie talk pudding throw happy era myth already payment own sentence push head sting video explain letter bomb casual hotel rather garment'&&m12==='mirror reject rookie talk pudding throw happy era myth already payment owner','Coldcard compatibility: its documented example (rolls 123456) gives the same 24 and 12 words'); })();
  // ===== v2.4.0: one-page prints, roll sheet extras, CHECK A BACKUP backups, QR and child prints, dice test, keyboard entry, typo helper, explain an address, summary =====
  sweep(t);
  await (async()=>{ const css=html.slice(0,html.indexOf('</style>'));
    ok(/@page \{ margin: 12mm; \}/.test(css)&&/body\.print-seed > :not\(#printOnly\), body\.print-qr > :not\(#printQr\) \{ display: none !important; \}/.test(css)&&!/body\.print-seed \* \{ visibility: hidden/.test(css)&&!/body\.print-qr \* \{ visibility: hidden/.test(css),'print: everything but the sheet is removed from the layout (display: none), so no blank pages are printed');
    const tp=load(); await tp.ready(); ok(tp.$('printOnly').parentElement===tp.d.body&&tp.$('printQr').parentElement===tp.d.body,'print: both print areas sit directly in the page body, so the rule above leaves only the sheet');
    ok(/node tests\/print\.test\.mjs/.test(fs.readFileSync(path.join(__dirname,'..','.github','workflows','tests.yml'),'utf8')),'print: the one-page print test is in the GitHub Actions test workflow'); })();
  // the online practice copy (GitHub Pages from v2.15.0): the wrapper names only GitHub addresses, and the demo serves the released file only after SHA256SUMS and CID.txt check out
  sweep(t);
  await (async()=>{ const dir=path.join(__dirname,'..','demo'), idx=fs.readFileSync(path.join(dir,'index.html'),'utf8'), ci=fs.readFileSync(path.join(__dirname,'..','.github','workflows','pages.yml'),'utf8');
    const links=[...idx.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]);
    ok(links.length===1&&links[0]==='https://github.com/Random21m/VOIDFORGE/releases'&&/Only trust this address: <b>random21m\.github\.io\/VOIDFORGE<\/b>/.test(idx)&&!/gitlab/i.test(idx),'demo: the wrapper links only to the GitHub releases page and names the GitHub demo address');
    ok(!fs.existsSync(path.join(dir,'voidforge.html'))&&/sha256sum -c SHA256SUMS[\s\S]*CID\.txt[\s\S]*cp voidforge\.html public\/voidforge\.html[\s\S]*actions\/upload-pages-artifact@[\s\S]*actions\/deploy-pages@/.test(ci)&&/branches: \[main\]/.test(ci)&&/if: github\.ref == 'refs\/heads\/main'/.test(ci)&&!fs.existsSync(path.join(__dirname,'..','.gitlab-ci.yml')),'demo: GitHub Pages copies the released file from main, after checking SHA256SUMS and CID.txt (and .gitlab-ci.yml is gone)'); })();
  sweep(t);
  await (async()=>{ const t4=load(); await t4.ready(); const $=t4.$, w=t4.w; w.startGateClose();
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
    $('rsExtra').value='25'; eq(w.rsExtraCount(256),25,'roll sheet: without Keystone rules there is no Keystone cap'); })();
  sweep(t);
  await (async()=>{ const t5=load(); await t5.ready(); const $=t5.$, w=t5.w; w.startGateClose();
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
    ok(/press 1 on the keyboard; Backspace undoes the last one/.test(t5.d.querySelector('#tapRow button').title),'keyboard: the tap buttons say the keys work'); })();
  sweep(t);
  await (async()=>{ const t7=load(); await t7.ready(); const $=t7.$, w=t7.w; w.startGateClose();
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
    [c,x]=await X('bitcoin:bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu?amount=0.1'); ok(c==='status ok'&&/payment request \(BIP21\)/.test(x)&&/BIP21/.test(x),'explain: a bitcoin: link');
    [c,x]=await X('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'); ok(c==='status bad'&&/PRIVATE KEY \(WIF\)/.test(x),'explain: a private key is called out');
    [c,x]=await X('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'); ok(c==='status warn'&&/extended PUBLIC key/.test(x),'explain: an xpub is explained as public but not an address');
    [c,x]=await X('xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'); ok(c==='status bad'&&/extended PRIVATE key/.test(x),'explain: an xprv is called out');
    [c,x]=await X('abandon '.repeat(11)+'about'); ok(c==='status bad'&&/SEED WORDS/.test(x),'explain: seed words are called out');
    [c,x]=await X('wpkh([d34db33f/84h/0h/0h]xpub6/0/*)'); ok(c==='status warn'&&/descriptor/.test(x),'explain: a descriptor');
    [c,x]=await X('lnbc1pvjluezsp5zyg3zyg3zyg'); ok(c==='status warn'&&/Lightning invoice/.test(x),'explain: a Lightning invoice');
    [c,x]=await X('hello'); ok(c==='status bad'&&/Not a Bitcoin address/.test(x),'explain: other text');
    [c,x]=await X(''); ok(c==='status'&&x==='','explain: an empty box shows nothing');
    const sp=(await (async()=>{ const seed=await w.mnemonicToSeed('abandon '.repeat(11)+'about',''); return w.spAddressFromSeed(seed,'main',0); })());
    [c,x]=await X(sp); ok(c==='status ok'&&/^Silent Payment address \(BIP352\) on Bitcoin mainnet/.test(x),'explain: a Silent Payment address');
    [c,x]=await X(sp.slice(0,-1)+(sp.endsWith('q')?'p':'q')); ok(c==='status bad'&&/Silent Payment address/.test(x),'explain: a typo in a Silent Payment address');
    // dictionary links
    const names=new Set(w.eval('DICT').map(e=>e[0])), targets=[...html.matchAll(/dictGo\('([^']+)'\)/g)].map(m=>m[1]), found=[...html.matchAll(/terms: (?:terms\.concat\()?\[([^\]]*)\]/g)].flatMap(m=>[...m[1].matchAll(/"([^"]+)"/g)].map(y=>y[1]));
    ok(targets.length===10&&found.length>25&&targets.concat(found).every(n=>names.has(n)),'dictionary links: every name the guide and the explanations link to is a dictionary entry');
    [c,x]=await X('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'); $('addrExplain').querySelector('button.dict-link').click();
    ok(!$('tp-about').classList.contains('tab-off')&&$('dictBox').open&&t7.d.querySelector('.dict-item.dict-hit dt').textContent==='Native SegWit'&&t7.d.querySelectorAll('.dict-hit').length===1,'dictionary links: a link opens the dictionary at that entry');
    ok(t7.d.querySelectorAll('#whatBox .what-list li').length===10&&t7.d.querySelectorAll('#whatBox .tag-secret').length===6&&t7.d.querySelectorAll('#whatBox .tag-public').length===3,'"What can someone do with this?": 10 items, 6 secret, 3 public, 1 private'); })();
  sweep(t);
  await (async()=>{ const t8=load(); await t8.ready(); const $=t8.$, w=t8.w; w.startGateClose();
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
    w.clearChild(); t8.st.alerts.length=0; w.printChild(); ok($('childPrintRow').style.display==='none'&&/DERIVE first/.test(t8.st.alerts[0]),'child: HIDE removes the button and the printable result'); })();
  // ===== v2.4.0 review fixes =====
  sweep(t);
  await (async()=>{ const t9=load(); await t9.ready(); const $=t9.$, w=t9.w; w.startGateClose();
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
    ok(/no copy or save; its print button prints it on one sheet, after asking/.test(t9.d.querySelector('#childBox').textContent),'child: the box says it can be printed');
    // explainer: more secrets pasted by mistake, and Silent Payment contents
    const X=async a=>{ const r=await w.explainAddress(a); return r?r.level+' '+r.text:''; };
    for(const [a,re] of [['1. legal 2. winner 3. thank 4. year 5. wave 6. sausage',/^bad These look like SEED WORDS/],['lega winn than year wave saus',/^bad These look like SEED WORDS/],['0'.repeat(96),/^bad These look like SeedQR digits/],['ab'.repeat(32),/^bad This is 64 hex characters/],['lnurl1dp68gurn8ghj7',/^warn This is an LNURL/],['lntbs1pjqqqqqpp5',/^warn This is a Lightning invoice/],['WSH(SORTEDMULTI(2,A,B))',/^warn This is a descriptor/],['6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg',/^bad This is a password-protected PRIVATE KEY \(BIP38\)/],['S6c56bnXQiBjk9mqSYE7ykVQ7NzrRy',/^bad This is a mini PRIVATE KEY/],['S6c56bnXQiBjk9mqSYE7ykVQ7NzrRz',/^bad Not a valid address/],['send me the money by friday please now',/^bad Not a Bitcoin address/]])
      ok(re.test(await X(a)),'explain: '+a.slice(0,24));
    const B32='qpzry9x8gf2tvdw0s3jn54khce6mua7l', toW=(n)=>{ const out=[]; let acc=0,bits=0; for(let i=0;i<n;i++){ acc=(acc<<8)|(i&255); bits+=8; while(bits>=5){ bits-=5; out.push((acc>>bits)&31); } acc&=(1<<bits)-1; } if(bits) out.push((acc<<(5-bits))&31); return out; };
    ok(/^bad .*contents are not two keys/.test(await X(w.bech32mText('sp',[0,...toW(2)])))&&/^bad .*contents are not two keys/.test(await X(w.bech32mText('sp',[31,...toW(66)])))&&/^ok Silent Payment address/.test(await X(w.bech32mText('sp',[1,...toW(70)])))&&/^bad .*contents are not two keys/.test(await X(w.bech32mText('sp',[1,...toW(60)]))),'explain: a Silent Payment address must hold two keys (66 bytes; version 31 is reserved)'); })();
  // ===== v2.4.0 second review fixes =====
  sweep(t);
  await (async()=>{ const ta=load(); await ta.ready(); const $=ta.$, w=ta.w; w.startGateClose();
    const X=async a=>{ const r=await w.explainAddress(a); return r?r.level+' '+r.text:''; };
    ok(/^bad This descriptor holds a PRIVATE key/.test(await X('wpkh([73c5da0a/84h/0h/0h]xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi/0/*)'))&&/^bad This descriptor holds a PRIVATE key/.test(await X('wpkh(KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn)'))&&/^warn This is a descriptor/.test(await X('wpkh(xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8/0/*)')),'explain: a descriptor with an xprv or a WIF key is called SECRET; one with an xpub is not');
    ok(!/^ok/.test(await X(w.bech32Encode('constructor',0,new Uint8Array(20))))&&!/^ok/.test(await X(w.bech32Encode('__proto__',0,new Uint8Array(20)))),'explain: object property names are not networks');
    ok(/^bad These look like SeedQR digits/.test(await X('7'.repeat(72)))&&/^bad This is 128 hex characters.*a BIP39 seed/.test(await X('ab'.repeat(64)))&&/^bad This is 56 hex characters/.test(await X('ab'.repeat(28))),'explain: SeedQR digits for 18 words and seed hex are called out');
    ok(/Its payments cannot be looked up from the address/.test(await X(await w.spAddressFromSeed(await w.mnemonicToSeed('abandon '.repeat(11)+'about',''),'main',0))),'explain: a Silent Payment address is not said to be traceable');
    w.eval('selfTestState = "fail"'); $('checkAddr').value='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; await w.explainAddrUi(); ok(/self-test has not passed/.test($('addrExplain').textContent),'explain: not while the self-test has not passed'); w.eval('selfTestState = "pass"');
    $('checkAddr').value='1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'; const e1=w.explainAddrUi(); $('checkAddr').value='abandon '.repeat(11)+'about'; const e2=w.explainAddrUi(); await e1; await e2;
    ok(/^These look like SEED WORDS/.test($('addrExplain').textContent),'explain: an older, slower answer never replaces a newer one');
    let r=await w.checkPhrase('fals '+'abandon '.repeat(11)); ok(/Some were read from their first letters \(word 1 'fals' as 'false'\); check those first\.$/.test(r.msg),'typo helper: a failed checksum names the words read from their first letters');
    // dice test with a seed on screen
    ta.set(rnd(50,6)); await w.generate(); const msgs=[]; w.confirm=m=>{ msgs.push(m); return true; }; $('diceTest').checked=true; w.diceTestToggle();
    ok(/The seed words on screen, made from these rolls, are cleared too/.test(msgs.join())&&!w.hasSeed()&&$('genResult').textContent==='—','dice test: says it clears the seed on screen, and leaves no "press FORGE again" message');
    ta.set(rnd(60,6)); ok(t9StepCur(ta)==='2'&&/^Dice test: /.test($('stepWhy').textContent)&&!w.guideCanNext(2),'dice test: the step bar stays on rolling and the guide does not move on to FORGE');
    $('diceTest').checked=false; w.diceTestToggle();
    // keyboard repeat
    const kd=(o)=>{ const e=new w.KeyboardEvent('keydown',Object.assign({key:'5',bubbles:true,cancelable:true},o)); ta.d.querySelector('#tapRow button').dispatchEvent(e); };
    ta.set(''); kd({}); kd({repeat:true}); kd({repeat:true}); eq($('rolls').value,'5','keyboard: a held key adds one roll');
    // SEND TO CHECK and VERIFY races
    $('phrase').value='abandon '.repeat(11)+'about'; $('childApp').value='words'; w.childAppChange(); await w.deriveChild(); ta.set(rnd(50,6)); await w.generate(); await w.sendToVerify();
    ok(w.eval('childCtx')===null&&$('childOut').textContent==='','SEND TO CHECK: clears a child seed made from the old words');
    $('phrase').value='legal winner thank year wave sausage worth useful legal winner thank yellow'; const vp=w.verify(); w.wipeSeed(); await vp;
    ok(w.eval('wvCtx')===null&&$('verifyStatus').textContent===''&&$('walletView').style.display==='none','VERIFY: CLEAR ALL while it works leaves nothing behind');
    // QR sheets: footers, account, address path and network
    ta.set(rnd(50,6)); await w.generate(); await w.passWork; await new Promise(r=>setTimeout(r,50));
    w.showQr('spAddr','x'); w.printShownQr(); ok(/made to be shared and reused/.test(ta.st.printQrText)&&!/keep it private/.test(ta.st.printQrText),'QR prints: the Silent Payment sheet says it is made to be shared'); w.dispatchEvent(new w.Event('afterprint'));
    $('wType').value='ms-wsh'; await w.refreshWatch(); w.showQr('wZpub','x'); w.printShownQr(); ok(/^VOIDFORGE COSIGNER PUBLIC KEY/.test(ta.st.printQrText)&&/one cosigner key of a multisig wallet/.test(ta.st.printQrText),'QR prints: the cosigner key sheet says what it is'); w.dispatchEvent(new w.Event('afterprint'));
    $('wType').value='wpkh'; $('wAcct').value='4'; await w.refreshWatch(); w.showQr('wZpub','x'); w.printShownQr(); ok(/Account number: 4\n/.test(ta.st.printQrText),'QR prints: the account number'); w.dispatchEvent(new w.Event('afterprint')); $('wAcct').value='0'; await w.refreshWatch();
    ta.d.querySelector('#trList button.qr-mini').click(); w.printAddrQr('aq'); ok(ta.st.printQrText.includes("Path: m/86'/0'/0'/0/0\n"),'address QR: a Taproot address sheet has its path'); w.dispatchEvent(new w.Event('afterprint')); w.hideAddrQr('aq');
    $('phrase').value='legal winner thank year wave sausage worth useful legal winner thank yellow'; await w.openWalletView($('phrase').value,''); $('wvChain').value='1'; $('wvNet').value='test'; await w.wvRefresh();
    ta.d.querySelector('#wvList button.qr-mini').click(); w.printAddrQr('wvq'); ok(/^VOIDFORGE CHANGE ADDRESS \(TESTNET\)/.test(ta.st.printQrText)&&ta.st.printQrText.includes("Path: m/84'/1'/0'/1/0\nNetwork: TESTNET"),'address QR: a testnet change address is named so, with its path'); w.dispatchEvent(new w.Event('afterprint'));
    $('wpIn').value='xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'; await w.openWatchOnly(); ta.d.querySelector('#wvList button.qr-mini').click(); w.printAddrQr('wvq');
    ok(!/not known/.test(ta.st.printQrText)&&/^VOIDFORGE RECEIVE ADDRESS/.test(ta.st.printQrText),'address QR: an unknown fingerprint is left out'); w.dispatchEvent(new w.Event('afterprint'));
    // child naming, page text
    $('phrase').value='abandon '.repeat(11)+'about'; $('childApp').value='hex'; w.childAppChange(); $('childLen').value='32'; await w.deriveChild(); w.printChild(); ok(/^VOIDFORGE CHILD HEX \(BIP85\)/.test(ta.st.printHTML),'child print: hex is named as hex'); w.dispatchEvent(new w.Event('afterprint'));
    ok(/\ndocument\.getElementById\("diceTest"\)\.checked = false;\nupdateLabels\(\);/.test(html)&&/id="diceTest" autocomplete="off"/.test(html),'dice test: always starts off, even in a browser that restores form state');
    { const D=w.eval('DICT'), b38=D.find(e=>e[0]==='BIP38'); ok(!!b38&&/starts with 6P/.test(b38[1])&&/^6P/.test('6PRVWUbkzzsbcVac2qwfssoUJAN1Xhrg6bNk8J7Nzm5H7kxEbn2Nh2ZoGg')&&D.some(e=>e[0]==='Stamp sheet'),'dictionary: BIP38 (locked keys start with 6P) and Stamp sheet'); }
    ok(!/\(v2\.4\.0\)/.test(ta.d.querySelector('#childBox').textContent)&&/Nothing on its own/.test(ta.$('whatBox').textContent)&&/xpub, zpub or public descriptor/.test(ta.$('whatBox').textContent),'page text: no version numbers in the child box; the guide wording'); })();
  // ===== v2.4.0: no red flash while the page loads =====
  sweep(t);
  await (async()=>{ const css=html.match(/<style>[\s\S]*?<\/style>/)[0], main=html.indexOf('<script>',html.indexOf('</style>'));
    ok(html.indexOf('document.documentElement.classList.add("js");')>0&&html.indexOf('document.documentElement.classList.add("js");')<html.indexOf('<style>'),'first paint: a tiny script in the head marks that scripts can run, before any style applies');
    ok(/\n  html\.js #noJs \{ display: none; \}\n/.test(css)&&/\n  html\.js body:not\(\.js-ok\) \.container \{ visibility: hidden; \}\n/.test(css),'first paint: the script-not-running notice and the half-built page stay hidden while the main script loads');
    ok(/<div id="noJs" role="alert">/.test(html)&&/\n  #onlineWarn, #fatalWarn, #noJs \{ background: transparent;/.test(css),'first paint: the script-not-running notice looks like the other warnings (no bright red box)');
    ok(html.indexOf('<div id="startGate"')>0&&html.indexOf('<div id="startGate"')<main,'first paint: the start notice is in the page before the main script, so it appears in the same moment as the page');
    const tj=load(); await tj.ready(); ok(tj.d.documentElement.classList.contains('js')&&tj.d.body.classList.contains('js-ok'),'first paint: after a normal load the page is marked as running');
    const z=html.indexOf('</script>',main), empty=html.slice(0,main)+'<script>\n'+html.slice(z);
    const dom=new JSDOM(empty,{runScripts:'dangerously',url:'https://example.org/'}); await new Promise(r=>setTimeout(r,30));
    ok(!dom.window.document.documentElement.classList.contains('js')&&!dom.window.document.body.classList.contains('js-ok')&&!!dom.window.document.getElementById('noJs'),'first paint: if the main script does not run, the notice and the page come back');
    dom.window.close(); })();
  // ===== v2.5.0: backup plan and stress test, wallet birthday, practice mode, watch-only file, passphrase warning, secrets not selectable =====
  sweep(t);
  await (async()=>{ const today=(()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
    const nextYear=(()=>{ const d=new Date(); const n=new Date(d.getFullYear()+1,d.getMonth(),d.getDate()); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); })();
    const css=html.slice(0,html.indexOf('</style>'));
    ok(html.indexOf('<li><b>2.5.0</b>')>0&&html.indexOf('<li><b>2.5.0</b>')<html.indexOf('<li><b>2.4.0</b>'),'v2.5.0: the changelog lists 2.5.0 first');
    // secrets cannot be highlighted
    ok(/\n  #wordGrid, #genResult, #wvAbbrGrid, #childOut, #exOut, #reforgeOut, #dpOut \{ -webkit-user-select: none; user-select: none; \}\n/.test(css),'secrets on screen: the seed words (also the hidden copy), the 4-letter grid, child outputs, Reforge results, the explainer and the dice passphrase cannot be highlighted');
    const tq=load({confirm:true}); await tq.ready(); const $=tq.$, w=tq.w; w.startGateClose();
    // passphrase warning
    const PW=(id,v)=>{ $(id).value=v; $(id).dispatchEvent(new w.Event('input')); if(id==='passphrase') w.updateAdvSummary(); return $(id==='passphrase'?'passWarn':'verifyPassWarn').textContent; };
    eq(PW('passphrase','correct horse'),'','passphrase warning: none for an ordinary passphrase');
    for(const [v,re,m] of [[' lead',/starts with a space/,'a leading space'],['trail ',/ends with a space/,'a trailing space'],['a  b',/two spaces in a row/,'two spaces in a row'],['﻿bom',/invisible character/,'a byte-order mark'],['a​b',/invisible character/,'a zero-width space'],['a‎b',/invisible character/,'a left-to-right mark'],['a\tb',/tab or a line break/,'a tab'],['x ',/ends with a space/,'a thin space at the end (a space after NFKD)'],['a  b',/two spaces in a row/,'a non-breaking space next to a space (two spaces after NFKD)']])
      ok(re.test(PW('passphrase',v))&&/used exactly as typed/.test($('passWarn').textContent),'passphrase warning: '+m);
    eq(PW('passphrase','a b'),'','passphrase warning: none for a single non-breaking space between words (BIP39 NFKD makes it an ordinary space, the same wallet)');
    eq(PW('passphrase','café'),'','passphrase warning: none for an accented letter (NFKD splits it, but nothing hidden is added)');
    ok(/tab or a line break/.test(w.passHiddenNote('a\nb'))&&w.passHiddenNote('ok')==='','passphrase warning: a line break (pasted where a box keeps it) is named too');
    ok(/starts with a space, ends with a space and has two spaces in a row/.test(PW('passphrase','  x  ')),'passphrase warning: several problems are listed in one sentence');
    ok(PW('passphrase',' x')&&$('passphrase').value===' x','passphrase warning: the passphrase itself is never changed');
    ok(/starts with a space/.test(PW('verifyPass',' x')),'passphrase warning: also under the CHECK A BACKUP passphrase');
    w.wipeSeed(); ok($('passWarn').textContent===''&&$('verifyPassWarn').textContent==='','passphrase warning: cleared with the passphrase');
    // backup plan: stress test rules
    const ST=(o)=>w.planStress(Object.assign({copies:[],pass:'none',know:false},o)).map(r=>r.event+'='+r.v).join('|');
    const P=(m,h)=>({m,home:h==='home',where:''});
    eq(ST({copies:[P('paper','home')]}),'A fire or flood at home=lost|A burglar searches your home=thief|You die or cannot act=lost|You forget the passphrase=na|Your hardware wallet or phone is lost or broken=safe|The only copy is lost or damaged=lost','stress test: one paper copy at home, no passphrase, nobody told');
    eq(ST({copies:[P('paper','home'),P('metal','away')],pass:'away',know:true}),'A fire or flood at home=safe|A burglar searches your home=safe|Someone finds a copy away from home=check|You die or cannot act=check|You forget the passphrase=safe|Your hardware wallet or phone is lost or broken=safe','stress test: a copy at home and one away, passphrase written and kept away, someone told (they also need to find the passphrase note)');
    eq(ST({copies:[P('paper','home'),P('paper','away')],pass:'mem',know:true}),'A fire or flood at home=safe|A burglar searches your home=safe|Someone finds a copy away from home=safe|You die or cannot act=lost|You forget the passphrase=lost|Your hardware wallet or phone is lost or broken=safe','stress test: a memorised passphrase is lost with you');
    eq(ST({copies:[P('metal','home')],pass:'same',know:true}),'A fire or flood at home=safe|A burglar searches your home=thief|You die or cannot act=safe|You forget the passphrase=safe|Your hardware wallet or phone is lost or broken=safe|The only copy is lost or damaged=lost','stress test: metal survives a fire, but a passphrase on the same paper helps a thief');
    eq(ST({copies:[P('paper','home'),P('paper','away')],pass:'home',know:true}),'A fire or flood at home=lost|A burglar searches your home=thief|Someone finds a copy away from home=safe|You die or cannot act=check|You forget the passphrase=safe|Your hardware wallet or phone is lost or broken=safe','stress test: the only passphrase note at home is lost in a fire and helps a burglar');
    eq(ST({copies:[P('metal','home'),P('paper','home')],pass:'mem',know:true}),'A fire or flood at home=safe|A burglar searches your home=lost|You die or cannot act=lost|You forget the passphrase=lost|Your hardware wallet or phone is lost or broken=safe','stress test: every copy at home, so a burglary can take your only copies');
    eq(ST({copies:[P('paper','away'),P('paper','away')],pass:'none',know:true}),'A fire or flood at home=safe|A burglar searches your home=safe|Someone finds a copy away from home=thief|You die or cannot act=safe|You forget the passphrase=na|Your hardware wallet or phone is lost or broken=safe','stress test: copies away from home with no passphrase can be taken by whoever finds one');
    eq(ST({}),'Where are the words?=lost|A burglar searches your home=safe|You die or cannot act=lost|You forget the passphrase=na|Your hardware wallet or phone is lost or broken=lost','stress test: no copy listed');
    ok(w.planStress({copies:[P('paper','home')],pass:'none',know:false}).filter(r=>r.v==='lost'||r.v==='thief').every(r=>r.fix.length>10),'stress test: every bad case comes with a fix');
    ok(['home','away'].every(pa=>{ const d=w.planStress({copies:[P('paper','home'),P('metal','away')],pass:pa,know:true}).find(r=>r.event==='You die or cannot act'); return d.v==='check'&&/passphrase note/.test(d.text)&&/passphrase note/.test(d.fix); }),'stress test: with a written passphrase, the family also needs to find the passphrase note');
    ok(/a passphrase makes a new wallet, so the money then has to be moved to it/.test(w.planStress({copies:[P('paper','home')],pass:'none',know:true})[1].fix)&&/move the money at once/.test(w.planStress({copies:[P('paper','home')],pass:'mem',know:true}).find(r=>r.event==='A burglar searches your home').text),'stress test: the fixes say a passphrase makes a new wallet, and to move the money at once when the only copies are stolen');
    // the box on the page
    ok($('planBox')&&$('planBox').tagName==='DETAILS'&&!$('planBox').open&&$('planBox').closest('#tp-check')!==null&&/NO WORDS, KEEP PRIVATE/.test($('planBox').querySelector('summary').textContent)&&$('planBox').querySelector('summary .tag').classList.contains('tag-private'),'backup plan: a closed box in CHECK A BACKUP, marked NO WORDS, KEEP PRIVATE');
    ok($('plPrint')&&$('plPrint').classList.contains('secondary')&&$('planBox').querySelectorAll('button:not(.secondary)').length===0,'backup plan: PRINT BACKUP PLAN is a gray helper button, like every other PRINT button');
    eq($('plTest').querySelectorAll('li').length,6,'backup plan: the stress test shows from the start (one paper copy at home by default)');
    ok(new RegExp('Next check-up: '+nextYear).test($('plNext').textContent)&&/4 of 6 cases/.test($('plNext').textContent),'backup plan: it says how many cases go wrong and when the next check-up is');
    $('plM2').value='metal'; $('plM2').dispatchEvent(new w.Event('change')); ok(/A fire or flood at home\. The copy away from home survives/.test($('plTest').textContent),'backup plan: the stress test updates as the boxes change');
    // print: refusals, then a good plan
    const PR=async()=>{ const p0=tq.st.printed; await w.printPlan(); const r={n:tq.st.printed-p0,txt:tq.st.printHTML,st:$('plStatus').textContent}; w.dispatchEvent(new w.Event('afterprint')); return r; };
    $('plFp').value='12345'; let r=await PR(); ok(r.n===0&&/8 letters and digits/.test(r.st),'backup plan: a malformed fingerprint is refused');
    $('plFp').value='73c5da0a'; $('plNote').value='abandon '.repeat(11)+'about'; r=await PR(); ok(r.n===0&&/seed words/.test(r.st),'backup plan: seed words in a box are never printed');
    $('plNote').value='keep this: '+'legal winner thank year wave sausage worth useful legal winner thank yellow'; r=await PR(); ok(r.n===0&&/seed words/.test(r.st),'backup plan: seed words inside a sentence are never printed');
    $('plNote').value=''; $('plW2').value='xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'; r=await PR(); ok(r.n===0&&/looks like a private key/.test(r.st),'backup plan: a private key in a box is never printed');
    $('plW2').value='legal winner thank year wave sausage'; $('plW3').value='worth useful legal winner thank yellow'; $('plM3').value='paper'; r=await PR(); ok(r.n===0&&/seed words/.test(r.st),'backup plan: seed words split across two boxes are never printed'); $('plW3').value=''; $('plM3').value='';
    for(const [s,k,m] of [['LEGA WINN THAN YEAR WAVE SAUS WORT USEF LEGA WINN THAN YELL','seed words','the 4-letter forms of 12 words'],['legal wnner thank year wave sausage worth useful legal winner thank yellow','seed words','12 words with one misspelt'],
      ['w1 legal w2 winner w3 thank w4 year w5 wave w6 sausage w7 worth w8 useful w9 legal w10 winner w11 thank w12 yellow','seed words','numbered words (w1, w2...)'],['1st legal 2nd winner 3rd thank 4th year 5th wave 6th sausage 7th worth 8th useful 9th legal 10th winner 11th thank 12th yellow','seed words','numbered words (1st, 2nd...)'],
      ['legal winner thank year wave and sausage worth useful legal winner thank yellow','seed words','12 words with one other word among them'],
      ['0123 4567 8901 2345 6789 0123 4567 8901 2345 6789 0123 4567','SeedQR digits or a key written as numbers','SeedQR digits in groups of 4'],['0c1e-24e5-9177-79d2-97e1-4d45-bce6-5a6b-0c1e-24e5-9177-79d2-97e1-4d45-bce6-5a6b','SeedQR digits or a key written as numbers','hex in groups'],
      ['passphrase: correct horse battery staple','a passphrase or password','"passphrase:" followed by text'],['Password = hunter2','a passphrase or password','"Password =" followed by text'],['the PIN: 1234','a passphrase or password','"PIN:" followed by text'],
      ['KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617','a private key','a WIF private key'],['wpkh(xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi/84h/0h/0h/0/*)','a private key','a private descriptor']])
      eq(await w.planSecret(s),k,'backup plan: refused: '+m);
    for(const s of ['Please call my sister Anna when the time comes and tell her where the metal plate is kept.','The steel plate is in the gun safe in the garage, behind the toolbox, under the old winter blanket.','Visit the bank, open the box, take out the sealed envelope, bring it home, and follow the instructions inside it carefully please.',
      'Coldcard Mk4 in the drawer of the office desk; PIN is in the password manager under Coldcard (not written here).','Contact: jane.doe@example.com or +1 555 0100. Website: https://sparrowwallet.com/docs/ for help.','Safe deposit box 0042 at First National, 123 Main St, Springfield. Account 9876543210.',
      'Rechtsanwaltskanzlei Mustermann','C:\\Users\\me\\Documents\\VeryLongFolderName','bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq','zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs'])
      eq(await w.planSecret(s),'','backup plan: an ordinary note prints: '+s.slice(0,40));
    $('plW2').value='bank safe deposit box'; $('plNote').value='Ask my brother at the bank about the box. The wallet app is Sparrow, and nobody genuine ever asks for the words.';
    $('plKnow').value='yes'; $('plPass').value='away'; $('plApp').value='Sparrow'; $('plBorn').value='2024-02-29'; $('plW1').value='home safe';
    r=await PR(); ok(r.n===1&&/^VOIDFORGE BACKUP PLAN/.test(r.txt)&&/Master fingerprint: +73c5da0a/.test(r.txt)&&/Wallet made on: +2024-02-29/.test(r.txt)&&/1\. Paper, at home: home safe\n2\. Metal, away from home: bank safe deposit box/.test(r.txt)&&/Someone trusted knows this plan exists: YES/.test(r.txt),'backup plan: an ordinary note with a few dictionary words prints, with the copies and the people');
    ok(new RegExp('Next check-up due: '+nextYear).test(r.txt)&&/1\. Find each copy on this plan/.test(r.txt)&&/Checked on:/.test(r.txt)&&/CHECK     Someone finds a copy away from home/.test(r.txt)&&/CHECK     You die or cannot act/.test(r.txt)&&/3\. The master fingerprint must equal the one on this plan\. \(Without the passphrase it is different: that is normal\.\)\n4\. Press END SESSION/.test(r.txt)&&!/abandon|legal winner/.test(r.txt),'backup plan: the sheet has the stress test, the next check-up and the yearly routine');
    ok(/^Sent to the printer/.test($('plStatus').textContent),'backup plan: it says the plan was sent to the printer');
    w.planClear(); ok($('plFp').value===''&&$('plM1').value==='paper'&&$('plM2').value===''&&$('plL2').value==='away'&&$('plNote').value===''&&$('plStatus').textContent==='','backup plan: CLEAR puts every box back');
    // birthday + planOpen from a seed made here
    tq.set(rnd(50,6)); await w.generate(); await new Promise(r=>setTimeout(r,50));
    eq(w.eval('sumCtx.date'),today,'wallet birthday: a seed made here is dated today');
    { const p0=tq.st.printed; w.printSummary(); ok(tq.st.printed===p0+1&&new RegExp('Wallet made on: '+today+' \\(its birthday, by this computer\'s clock').test(tq.st.printHTML)&&!/Date made:/.test(tq.st.printHTML),'wallet birthday: on the summary sheet, filled in'); w.dispatchEvent(new w.Event('afterprint')); }
    ok(!!$('planGoBtn')&&$('planGoBtn').closest('#bkList')!==null,'backup plan: the backup checklist has PLAN WHERE THE COPIES GO');
    $('planBox').open=false; w.planOpen(); const fpNow=($('fingerprint').textContent.match(/^Master fingerprint: ([0-9a-f]{8})/)||[])[1];
    ok($('planBox').open&&$('plFp').value===fpNow&&$('plBorn').value===today&&tq.d.querySelector('[aria-selected="true"]').id==='tab-check','backup plan: opened from the checklist it fills in the fingerprint and the birthday');
    $('plFp').value='aaaaaaaa'; w.planFill(); eq($('plFp').value,'aaaaaaaa','backup plan: it never overwrites a typed fingerprint');
    await w.sendToVerify(); await w.openWalletView($('genResult').textContent.split('\n')[0],$('passphrase').value);
    eq($('wvBorn').value,today,'wallet birthday: the wallet made here gets its birthday in Open this wallet');
    { const p0=tq.st.printed; w.printRecoverySheet(); ok(tq.st.printed===p0+1&&new RegExp('Wallet made on: '+today+'\\n').test(tq.st.printHTML),'wallet birthday: on the recovery sheet'); w.dispatchEvent(new w.Event('afterprint')); }
    $('wvBorn').value=''; { w.printRecoverySheet(); ok(/Wallet made on: ____________\n/.test(tq.st.printHTML),'wallet birthday: a blank line to fill in when it is not known'); w.dispatchEvent(new w.Event('afterprint')); }
    w.clearWalletView(); eq($('wvBorn').value,'','wallet birthday: cleared with the wallet view');
    // practice mode
    const {HDKey}=require('@scure/bip32'); const {mnemonicToSeedSync}=require('@scure/bip39'); const btc=require('@scure/btc-signer');
    const words=$('genResult').textContent.split('\n')[0];
    const tb=HDKey.fromMasterSeed(mnemonicToSeedSync(words,'')).derive("m/84'/1'/0'/0/0"), tbAddr=btc.p2wpkh(tb.publicKey,btc.TEST_NETWORK).address;
    const until=async(f)=>{ for(let k=0;k<480&&!f();k++) await new Promise(r=>setTimeout(r,50)); };   // up to 24 s: a busy machine took 12 s here
    const NETS5=['wNet','wvNet','psbtNet','cmpNet','msNet'], locked=()=>NETS5.every(id=>$(id).value==='test'&&$(id).disabled);
    const tbList=(ws,pass,pur,n,ch=0)=>Array.from({length:n},(_,i)=>{ const k=HDKey.fromMasterSeed(mnemonicToSeedSync(ws,pass)).derive("m/"+pur+"'/1'/0'/"+ch+"/"+i); return pur===84?btc.p2wpkh(k.publicKey,btc.TEST_NETWORK).address:btc.p2tr(k.publicKey.slice(1),undefined,btc.TEST_NETWORK).address; });
    $('wNet').value='main'; $('cmpNet').value='main';
    w.practiceMode(true); await until(()=>$('address').textContent.endsWith(tbAddr)&&$('wFirst').textContent.split('\n')[0]===tbAddr);
    ok(tq.d.body.classList.contains('practice')&&$('practiceMode').checked&&locked(),'practice mode: every network menu is on Testnet and locked');
    ok(/^First receive address, TESTNET \(practice coins only\), BIP84, m\/84'\/1'\/0'\/0\/0: tb1/.test($('address').textContent)&&$('address').textContent.endsWith(tbAddr),'practice mode: the first address shown is the test-network one (checked with @scure)');
    { const L=[...$('addrList').children].map(li=>li.textContent), T=[...$('trList').children].map(li=>li.textContent);
      eq(L.join(' ')+' | '+T.join(' '),tbList(words,'',84,10).join(' ')+' | '+tbList(words,'',86,10).join(' '),'practice mode: the receive lists are the test-network addresses (checked with @scure)');
      eq([...$('chList').children].map(li=>li.textContent).join(' ')+' | '+[...$('trChList').children].map(li=>li.textContent).join(' '),tbList(words,'',84,10,1).join(' ')+' | '+tbList(words,'',86,10,1).join(' '),'practice mode: the change lists are the test-network change addresses (checked with @scure)'); }
    ok(/^vpub/.test($('wZpub').textContent)&&$('wFirst').textContent.split('\n')[0]===tbAddr,'practice mode: the watch-only box follows it');
    ok(/body\.practice #practiceBan \{ display: block;/.test(css)&&!/practice[^{]*::before/.test(css),'practice mode: a banner on the page; seed backups print as usual (no practice line on them)');
    { $('addrList').querySelector('button').click(); const p0=tq.st.printed; w.printAddrQr('aq'); ok(tq.st.printed===p0+1&&/^VOIDFORGE RECEIVE ADDRESS \(TESTNET\)/.test(tq.st.printQrText)&&/Path: m\/84'\/1'\/0'\/0\/0/.test(tq.st.printQrText)&&/Network: TESTNET \(practice coins only\)/.test(tq.st.printQrText)&&tq.st.printQrText.includes('Address: '+tbAddr),'practice mode: a printed address sheet says TESTNET, with the test-network path'); w.dispatchEvent(new w.Event('afterprint')); w.hideAddrQr('aq'); }
    // FORGE, a new passphrase, VERIFY and a mainnet watch-only key: practice stays on the test network
    tq.set(rnd(50,6)); await w.generate(); const words2=$('genResult').textContent.split('\n')[0], tb2=tbList(words2,'',84,1)[0];
    await until(()=>$('address').textContent.endsWith(tb2)&&$('wFirst').textContent.split('\n')[0]===tb2);
    ok(locked()&&$('address').textContent.endsWith(tb2)&&$('wFirst').textContent.split('\n')[0]===tb2&&/^vpub/.test($('wZpub').textContent)&&$('addrList').firstChild.textContent===tb2,'practice mode: FORGE while it is on shows test-network addresses everywhere, menus still locked');
    $('passphrase').value='pr'; $('passphrase2').value='pr'; await w.rePass(); const tb3=tbList(words2,'pr',84,1)[0];
    await until(()=>$('address').textContent.includes(tb3)&&$('wFirst').textContent.split('\n')[0]===tb3);
    ok(locked()&&/TESTNET \(practice coins only\)/.test($('address').textContent)&&$('address').textContent.includes(tb3+' (with passphrase)')&&$('wFirst').textContent.split('\n')[0]===tb3,'practice mode: a new passphrase keeps it on the test network');
    await w.sendToVerify(); $('verifyPass').value='pr'; await w.verify(); await until(()=>/With passphrase.*test network/.test($('verifyStatus').textContent));
    ok(locked()&&$('verifyStatus').textContent.includes(tb2+' (test network)')&&$('verifyStatus').textContent.includes(tb3+' (test network)')&&!/bc1q/.test($('verifyStatus').textContent),'practice mode: VERIFY gives the test-network first addresses, with and without the passphrase');
    ok(!/PUBLIC PRACTICE PHRASE/.test($('verifyStatus').textContent),'practice mode: VERIFY does not call a new seed a practice phrase');
    $('passphrase').value=''; $('passphrase2').value=''; $('verifyPass').value=''; await w.rePass();
    $('wpIn').value='zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs'; await w.openWatchOnly();
    ok(/Practice mode is on, so only test-network keys/.test($('wpStatus').textContent)&&!(w.eval('wvCtx')&&w.eval('wvCtx.kind')==='pub')&&locked(),'practice mode: a mainnet watch-only key is refused while it is on');
    $('wpIn').value=$('wZpub').textContent; await w.openWatchOnly();
    ok(w.eval('wvCtx')&&w.eval('wvCtx.kind')==='pub'&&w.eval('wvCtx.net')==='test'&&locked(),'practice mode: a test-network watch-only key opens');
    w.clearWalletView(); ok(locked(),'practice mode: closing a wallet view keeps the menu on Testnet and locked');
    w.practiceMode(false); await until(()=>/^zpub/.test($('wZpub').textContent)&&/bc1q/.test($('address').textContent));
    ok(!tq.d.body.classList.contains('practice')&&!$('practiceMode').checked&&NETS5.every(id=>$(id).value==='main'&&!$(id).disabled)&&/^First receive address \(BIP84, m\/84'\/0'\/0'\/0\/0\): bc1q/.test($('address').textContent)&&/^zpub/.test($('wZpub').textContent)&&/^bc1q/.test($('addrList').firstChild.textContent),'practice mode: off puts every menu back on Mainnet and the addresses back on the real network');
    { $('cmpNet').value='test'; w.practiceMode(true); w.practiceMode(false); eq($('cmpNet').value,'test','practice mode: off puts back the network each menu had before'); $('cmpNet').value='main'; }
    // a multisig wallet in progress: practice mode cannot change
    { const al=[]; w.alert=(m)=>al.push(m); w.eval('ms = {keys: [], done: false}'); w.practiceMode(true); ok(!w.eval('practiceOn')&&!$('practiceMode').checked&&/multisig wallet is being made or shown/.test(al[0]||''),'practice mode: refused while a multisig wallet is being made'); w.eval('ms = null'); }
    // the practice wallet
    await w.practiceWallet(); await until(()=>/tb1q/.test($('wvList').textContent));
    ok(tq.d.querySelector('[aria-selected="true"]').id==='tab-check'&&$('phrase').value==='legal winner thank year wave sausage worth useful legal winner thank yellow'&&/tb1q/.test($('wvList').textContent)&&!/bc1q/.test($('wvList').textContent)&&$('wvNet').value==='test','practice mode: OPEN A PRACTICE WALLET opens a public practice phrase on the test network');
    ok(/PUBLIC PRACTICE PHRASE/.test($('verifyStatus').textContent),'practice mode: VERIFY says the words are a public practice phrase');
    w.practiceMode(false); await until(()=>$('phrase').value==='');
    ok($('phrase').value===''&&$('walletView').style.display==='none'&&$('verifyStatus').textContent==='','practice mode: turning it off closes the practice wallet, so a public phrase is never shown on the real network');
    // watch-only file
    tq.set(rnd(50,6)); await w.generate(); await new Promise(r=>setTimeout(r,100));
    const CS=(()=>{ const IN="0123456789()[],'/*abcdefgh@:$%{}IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~ijklmnopqrstuvwxyzABCDEFGH`#\"\\ ", CH='qpzry9x8gf2tvdw0s3jn54khce6mua7l', G=[0xf5dee51989n,0xa9fdca3312n,0x1bab10e32dn,0x3706b1677an,0x644d626ffdn];
      const pm=(s)=>{ let c=1n; for(const v of s){ const c0=c>>35n; c=((c&0x7ffffffffn)<<5n)^BigInt(v); for(let i=0;i<5;i++) if((c0>>BigInt(i))&1n) c^=G[i]; } return c; };
      return (d)=>{ const sym=[]; const grp=[]; for(const ch of d){ const v=IN.indexOf(ch); sym.push(v&31); grp.push(v>>5); if(grp.length===3){ sym.push(grp[0]*9+grp[1]*3+grp[2]); grp.length=0; } } if(grp.length===1) sym.push(grp[0]); else if(grp.length===2) sym.push(grp[0]*3+grp[1]); const c=pm(sym.concat([0,0,0,0,0,0,0,0]))^1n; let out=''; for(let j=0;j<8;j++) out+=CH[Number((c>>(5n*BigInt(7-j)))&31n)]; return out; }; })();
    for(const ty of ['wpkh','tr','sh-wpkh','pkh']){
      $('wType').value=ty; await w.refreshWatch(); const txt=w.watchFileText(), lines=txt.split('\n'), live=lines.filter(l=>l.trim()&&!l.startsWith('#'));
      const recv=$('wDescR').textContent, body=recv.replace(/#[a-z0-9]{8}$/,'').replace('/0/*)','/<0;1>/*)');
      ok(live.length===1&&live[0]===body+'#'+CS(body),'watch-only file ('+ty+'): one line Sparrow reads, the receive-and-change descriptor with a correct checksum (independent BIP380 code)');
      ok(txt.includes('# Receive descriptor: '+recv)&&txt.includes('# Change descriptor:  '+$('wDescC').textContent)&&$('wFirst').textContent.split('\n').every((a,i)=>txt.includes('#   '+i+': '+a))&&new RegExp('Made on: '+today).test(txt),'watch-only file ('+ty+'): the separate descriptors, the first addresses and the birthday as comments');
      ok(ty==='tr'?/Electrum cannot open Taproot wallets/.test(txt)&&!/master key\):/.test(txt):txt.includes('master key): '+$('wZpub').textContent),'watch-only file ('+ty+'): the Electrum line fits the address type');
    }
    $('wType').value='ms-wsh'; await w.refreshWatch(); ok(w.watchFileText()===''&&$('wSaveRow').style.display==='none','watch-only file: not offered for a multisig cosigner key');
    $('wType').value='wpkh'; await w.refreshWatch(); tq.st.blob=null; w.saveWatchFile(); const ft=await blobText(w,tq.st.blob); ok(ft===w.watchFileText()&&/^# VOIDFORGE watch-only wallet\. Public keys only/.test(ft)&&!ft.includes(words.split(' ')[0]+' '+words.split(' ')[1]),'watch-only file: SAVE WATCH-ONLY FILE saves it, with no seed words in it');
    $('wNet').value='test'; await w.refreshWatch(); ok(/Network: TESTNET \(practice coins only\)/.test(w.watchFileText())&&/tpub/.test(w.watchFileText()),'watch-only file: testnet keys say so');
    $('wNet').value='main';
  })();
  // ===== v2.6.0: animated QR (UR + BBQr), UR/BBQr paste, custom paths, read-only private keys, check an address before you pay, future spending cost =====
  sweep(t);
  await (async()=>{ const t6=load({confirm:true}); await t6.ready(); const $=t6.$, w=t6.w; w.startGateClose();
    const {HDKey}=require('@scure/bip32'); const {mnemonicToSeedSync}=require('@scure/bip39'); const btc=require('@scure/btc-signer'); const zlib=require('zlib'), nc=require('crypto');
    const until=async(f)=>{ for(let k=0;k<120&&!f();k++) await new Promise(r=>setTimeout(r,50)); };
    ok(html.indexOf('<li><b>2.6.0</b>')>0&&html.indexOf('<li><b>2.6.0</b>')<html.indexOf('<li><b>2.5.0</b>'),'v2.6.0: the changelog lists 2.6.0 first');
    // --- check an address before you pay ---
    const PAY=async(a,b)=>{ $('payA').value=a; $('payB').value=b; await w.payCompare(); return {st:$('payOut').textContent, cls:$('payOut').className, x:[...$('payDiff').children].map(r=>r.querySelectorAll('.pd-x').length)}; };
    const A='bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
    let r=await PAY(A,A.toUpperCase()); ok(/^SAME ADDRESS: all 42 characters match\.$/.test(r.st)&&r.cls==='status ok'&&r.x.length===0,'pay check: a bech32 address matches its capital-letter form (bech32 ignores case)');
    r=await PAY('bitcoin:'+A+'?amount=0.1&label=Jo',' '+A.slice(0,20)+' '+A.slice(20)+' '); ok(/^SAME ADDRESS/.test(r.st),'pay check: a bitcoin: link and spaces inside a pasted address are read');
    const B=A.slice(0,8)+'qqqq'+A.slice(12); r=await PAY(B,A);
    ok(/^DIFFERENT ADDRESSES: 4 characters differ\. Do not pay/.test(r.st)&&/the first 8 and the last 30 characters match but the middle does not\. That is exactly how address poisoning/.test(r.st)&&/The address you are about to pay is not valid/.test(r.st)&&r.cls==='status bad'&&r.x.join()==='4,4','pay check: a look-alike in the middle is called out, with the 4 different characters marked on both lines');
    r=await PAY(A.slice(0,41)+'x',A); ok(/^DIFFERENT ADDRESSES: 1 character differs\./.test(r.st)&&!/address poisoning/.test(r.st),'pay check: one character (singular), and no look-alike warning when only the end differs');
    r=await PAY('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2','1bvbmseystwetqtfn5au4m4gfg7xjanvn2'); ok(/^DIFFERENT ADDRESSES/.test(r.st),'pay check: a Base58 address is case-sensitive');
    r=await PAY('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2','1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'); ok(/^SAME ADDRESS: all 34 characters match/.test(r.st),'pay check: the same legacy address');
    r=await PAY('bc1qnotanaddress','bc1qnotanaddress'); ok(r.cls==='status bad'&&/^The two match, but this is not a valid address you can pay/.test(r.st),'pay check: two copies of a broken address match but are not called payable');
    r=await PAY(A,''); ok(r.st===''&&r.x.length===0,'pay check: nothing is said until both boxes have an address');
    // --- what will spending cost later? (standard sizes: 1 input, 2 outputs) ---
    eq(['pkh','sh-wpkh','wpkh','tr'].map(t=>w.costEstimate(t,1,2).vb).join(),'226,166,141,154','spending cost: 1 input and 2 outputs is 226 vB (legacy), 166 (nested), 141 (native SegWit), 154 (Taproot)');
    eq(w.costEstimate('wpkh',100,1).vb,Math.ceil(10.5+100*68+31),'spending cost: 100 deposits use a 1-byte input count until 253 (then 3 bytes)');
    eq(w.costEstimate('wpkh',300,1).vb,Math.ceil(12.5+300*68+31),'spending cost: 300 deposits use the 3-byte input count');
    eq(w.costEstimate('wpkh',1,2).fees.map(f=>f.sats).join(),'141,705,2820,14100','spending cost: the fee at 1, 5, 20 and 100 sat/vB');
    $('costType').value='wpkh'; $('costOut').value='2'; $('costN').value='50'; $('costN').dispatchEvent(new w.Event('input'));
    ok(/^Spending 50 deposits in one payment costs about 24\.6 times as much as spending one/.test($('costStatus').textContent)&&/Size: about 3,473 vB \(each deposit adds about 68 vB\)/.test($('costOut2').textContent)&&/A deposit smaller than 1,360 sats costs more to spend than it is worth at 20 sat\/vB/.test($('costOut2').textContent),'spending cost: the box gives the size, the fees and when a small deposit is not worth spending');
    $('costN').value='0'; $('costN').dispatchEvent(new w.Event('input')); ok(/whole number of deposits from 1 to 5000/.test($('costStatus').textContent)&&$('costOut2').style.display==='none','spending cost: 0 deposits is refused');
    $('costN').value=''; $('costN').dispatchEvent(new w.Event('input'));
    // --- custom account paths ---
    eq(JSON.stringify(w.parsePath("m/0'")),'[[0,true]]','custom path: m/0\'');
    eq(JSON.stringify(w.parsePath('m/44h/0H/1h/7')),'[[44,true],[0,true],[1,true],[7,false]]','custom path: h or H also means hardened');
    ok(w.parsePath('m/x')===null&&w.parsePath('m/1//2')===null&&w.parsePath('m'+'/1'.repeat(11))===null&&w.parsePath('m/2147483648')===null&&JSON.stringify(w.parsePath('m'))==='[]','custom path: anything that is not a path of at most 10 steps below 2^31 is refused');
    const M12='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const ref=(m,pp,path,type,net)=>{ const k=HDKey.fromMasterSeed(mnemonicToSeedSync(m,'')).derive(pp+'/'+path), N=net==='test'?btc.TEST_NETWORK:btc.NETWORK; return type==='wpkh'?btc.p2wpkh(k.publicKey,N).address:type==='pkh'?btc.p2pkh(k.publicKey,N).address:btc.p2tr(k.publicKey.slice(1),undefined,N).address; };
    $('phrase').value=M12; $('verifyPass').value=''; await w.openWalletView(M12,''); await until(()=>$('wvList').children.length===20);
    const def=[...$('wvList').children].map(li=>li.firstChild.textContent);
    $('wvPathIn').value="m/84'/0'/0'"; $('wvPathIn').dispatchEvent(new w.Event('input')); await w.wvRefresh(); eq([...$('wvList').children].map(li=>li.firstChild.textContent).join(),def.join(),'custom path: m/84\'/0\'/0\' gives the same addresses as the default');
    ok(def[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu','custom path: the default is the BIP84 test vector address');
    $('wvPathIn').value="m/0'"; $('wvPathIn').dispatchEvent(new w.Event('input')); await w.wvRefresh();
    eq([...$('wvList').children].map(li=>li.firstChild.textContent).slice(0,3).join(),[0,1,2].map(i=>ref(M12,"m/0'",'0/'+i,'wpkh')).join(),'custom path: m/0\' (as some older apps used) gives the addresses @scure derives');
    ok(/m\/0'\/0\/index/.test($('wvPath').textContent)&&$('wvAcct').disabled,'custom path: the path is shown, and the account box is not used');
    $('wvType').value='pkh'; await w.wvRefresh(); eq([...$('wvList').children][1].firstChild.textContent,ref(M12,"m/0'",'0/1','pkh'),'custom path: any address type along the path');
    $('wvChain').value='1'; await w.wvRefresh(); eq([...$('wvList').children][0].firstChild.textContent,ref(M12,"m/0'",'1/0','pkh'),'custom path: change addresses along the path');
    $('wvChain').value='both'; $('wvType').value='wpkh';
    $('wvPathIn').value="m/84'/0'/x"; $('wvPathIn').dispatchEvent(new w.Event('input')); await w.wvRefresh(); ok(/The path must look like/.test($('wvErr').textContent)&&$('wvList').children.length===0,'custom path: a bad path shows no addresses and says how to write one');
    $('wvPathIn').value=''; $('wvPathIn').dispatchEvent(new w.Event('input')); await w.wvRefresh(); ok(!$('wvAcct').disabled&&$('wvErr').textContent==='','custom path: empty box goes back to the account number');
    w.clearWalletView(); eq($('wvPathIn').value,'','custom path: cleared with the wallet view');
    // --- open a private key, read only ---
    const PK=async(v)=>{ $('pkIn').value=v; $('pkIn').dispatchEvent(new w.Event('input')); await w.openPrivateKey(); await until(()=>!w.eval('wvCtx')||$('wvList').children.length>0); return {st:$('pkStatus').textContent, cls:$('pkStatus').className, list:[...$('wvList').children].map(li=>li.firstChild.textContent), fp:$('wvFp').textContent}; };
    const root=HDKey.fromMasterSeed(mnemonicToSeedSync(M12,''));
    r=await PK('zprvAWgYBBk7JR8Gjrh4UJQ2uJdG1r3WNRRfURiABBE3RvMXYSrRJL62XuezvGdPvG6GFBZduosCc1YP5wixPox7zhZLfiUm8aunE96BBa4Kei5');
    ok(r.cls==='status ok'&&/master private key/.test(r.st)&&r.list[0]==='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'&&r.fp==='Master fingerprint: 73c5da0a'&&$('wvType').value==='wpkh'&&$('walletView').classList.contains('wv-secret'),'private key: the BIP84 zprv opens as a master key (fingerprint 73c5da0a, first address from the BIP84 test vector)');
    ok(/^SECRET, read only/.test($('wvBanner').textContent)&&$('wvSheetBtn').style.display==='none'&&$('wvNet').disabled,'private key: a SECRET banner, no recovery sheet, and the network is the key\'s own');
    const acctX=root.derive("m/44'/0'/0'").privateExtendedKey; r=await PK(acctX); $('wvType').value='pkh'; await w.wvRefresh();
    ok(/at depth 3/.test(r.st)&&/does not say its address type/.test(r.st)&&[...$('wvList').children][0].firstChild.textContent===ref(M12,"m/44'/0'/0'",'0/0','pkh')&&/Master fingerprint: not known/.test($('wvFp').textContent),'private key: an account xprv (depth 3) lists its addresses (checked with @scure)');
    const wif=btc.WIF().encode(root.derive("m/84'/0'/0'/0/0").privateKey); r=await PK(wif);
    eq(r.list.join(),[btc.p2wpkh(root.derive("m/84'/0'/0'/0/0").publicKey).address,btc.p2tr(root.derive("m/84'/0'/0'/0/0").publicKey.slice(1)).address,btc.p2sh(btc.p2wpkh(root.derive("m/84'/0'/0'/0/0").publicKey)).address,btc.p2pkh(root.derive("m/84'/0'/0'/0/0").publicKey).address].join(),'private key: a compressed WIF gives its 4 addresses: native SegWit, Taproot, nested, legacy (checked with @scure)');
    r=await PK('5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'); ok(r.list.length===1&&r.list[0]==='1GAehh7TsJAHuUAeKZcXf5CnwuGuGgyX2S'&&/uncompressed/.test(r.st),'private key: the uncompressed WIF example has only its legacy address (1GAehh7T...)');
    r=await PK('S6c56bnXQiBjk9mqSYE7ykVQ7NzrRy'); ok(/Casascius mini key/.test(r.st)&&r.list.length===1&&r.list[0]==='1CciesT23BNionJeXrbxmjc7ywfiyM4oLW','private key: the Casascius mini key example gives its one legacy address (1CciesT2...)');
    r=await PK('S6c56bnXQiBjk9mqSYE7ykVQ7NzrRz'); ok(r.cls==='status bad'&&/built-in check fails/.test(r.st)&&!w.eval('wvCtx'),'private key: a mini key with a wrong character is refused');
    r=await PK('xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'); ok(r.cls==='status bad'&&/public key/.test(r.st),'private key: an xpub is sent to the watch-only box instead');
    r=await PK('hello'); ok(r.cls==='status bad'&&!w.eval('wvCtx'),'private key: other text is refused');
    r=await PK(wif); $('pkIn').value=wif+'x'; $('pkIn').dispatchEvent(new w.Event('input')); ok(!w.eval('wvCtx')&&$('walletView').style.display==='none','private key: editing the box closes the open key');
    r=await PK(wif); { const oc=w.confirm; w.confirm=()=>true; w.clearAll(); w.confirm=oc; } ok($('pkIn').value===''&&!w.eval('wvCtx')&&$('pkIn').type==='password','private key: CLEAR ALL wipes the key and hides the box again');
    ok(/"pkIn"/.test(html.match(/const AUTO_FIELDS = \[[^\]]*\]/)[0]),'private key: auto-clear wipes the key box too');
    w.practiceMode(true); r=await PK(wif); ok(r.cls==='status bad'&&/Practice mode is on, so only test-network private keys/.test(r.st)&&!w.eval('wvCtx'),'private key: in practice mode a mainnet key is refused');
    { const twif=btc.WIF(btc.TEST_NETWORK).encode(root.derive("m/84'/1'/0'/0/0").privateKey); r=await PK(twif); ok(r.cls==='status ok'&&/^tb1q/.test(r.list[0])&&r.list[0]===btc.p2wpkh(root.derive("m/84'/1'/0'/0/0").publicKey,btc.TEST_NETWORK).address,'private key: in practice mode a testnet WIF key opens, with test-network addresses'); }
    w.practiceMode(false); ok(!w.eval('wvCtx')&&/private key view was closed/.test($('pkStatus').textContent),'private key: changing practice mode closes an open key (it keeps its own network)');
    $('pkIn').value='';
    // --- UR and BBQr text ---
    const msg=Array.from(nc.randomBytes(700)), cb=w.eval('CB').bytes(msg), parts=w.urEncode('bytes',cb,200);
    ok(parts.length===4&&parts.every((p,i)=>p.startsWith('ur:bytes/'+(i+1)+'-4/')),'UR: a 700-byte message becomes 4 parts, numbered 1-4');
    { const sh=[parts[2],parts[0],parts[3],parts[1],parts[0]]; const d=w.urDecodeFrames(sh); ok(d.type==='bytes'&&JSON.stringify(Array.from(d.msg))===JSON.stringify(cb),'UR: parts in any order, repeated, join back to the message'); }
    { let e=''; try { w.urDecodeFrames([parts[0],parts[2]]); } catch(x){ e=x.message; } ok(/UR parts missing: 2, 4 of 4/.test(e),'UR: says which parts are missing'); }
    { const bad=parts[1].slice(0,-6)+(parts[1].slice(-6,-4)==='ae'?'ad':'ae')+parts[1].slice(-4); let e=''; try { w.urDecodeFrames([parts[0],bad,parts[2],parts[3]]); } catch(x){ e=x.message; } ok(/checksum does not match|not Bytewords|different QR codes|damaged/.test(e),'UR: a part copied wrongly is caught by its checksum'); }
    { let e=''; try { w.urDecodeFrames([parts[0],w.urEncode('crypto-psbt',cb,200)[1]]); } catch(x){ e=x.message; } ok(/different types/.test(e),'UR: parts of different types are not mixed'); }
    ok(w.urEncode('bytes',w.eval('CB').bytes([1,2,3]),200).length===1&&/^ur:bytes\/[a-z]+$/.test(w.urEncode('bytes',w.eval('CB').bytes([1,2,3]),200)[0]),'UR: a short message is one part with no numbers');
    const bb=w.bbqrEncode('P',Uint8Array.from(msg),480); ok(bb.length===3&&bb.every((p,i)=>p.startsWith('B$2P03'+String(i).padStart(2,'0')))&&bb.slice(0,-1).every(p=>p.length===bb[0].length),'BBQr: Base32 parts with the header B$2P, the count and the part number, split evenly');
    { const d=w.bbqrDecodeFrames([bb[2],bb[0],bb[1]]); ok(d.fileType==='P'&&Buffer.from(d.bytes).equals(Buffer.from(msg)),'BBQr: parts in any order join back'); }
    { const z=zlib.deflateRawSync(Buffer.from('wsh(sortedmulti(2,'.repeat(40)),{windowBits:10}), b32=w.base32Encode(z), p1='B$ZU0100'+b32; eq(new TextDecoder().decode(w.bbqrDecodeFrames([p1]).bytes),'wsh(sortedmulti(2,'.repeat(40),'BBQr: Z parts (compressed, as Coldcard writes them) are read'); }
    { const h='B$HT0100'+Buffer.from('0200').toString('hex').toUpperCase(); eq(Buffer.from(w.bbqrDecodeFrames([h]).bytes).toString(),'0200','BBQr: H parts (hex) are read'); }
    { let e=''; try { w.bbqrDecodeFrames([bb[0],bb[2]]); } catch(x){ e=x.message; } ok(/BBQr parts missing: 2 of 3/.test(e),'BBQr: says which parts are missing'); }
    { let e=''; try { w.qrTextDecode(parts[0]+'\nhello'); } catch(x){ e=x.message; } ok(/mixes QR parts with other text/.test(e)&&w.qrTextDecode('cHNidP8B')===null,'QR text: parts mixed with other text are refused; ordinary text is left alone'); }
    // --- PSBT pasted as UR or BBQr parts ---
    { const known=html.match(/inspectPsbt\(psbtFromText\("(cHNidP8B[A-Za-z0-9+/=]+)"\)/)[1], raw=Buffer.from(known,'base64');
      const urP=w.urEncode('crypto-psbt',w.eval('CB').bytes(Array.from(raw)),40); ok(urP.length>1&&Buffer.from(w.psbtFromText(urP.join('\n'))).equals(raw),'PSBT paste: animated UR crypto-psbt parts (one per line) give the PSBT');
      ok(Buffer.from(w.psbtFromText(w.bbqrEncode('P',raw,160).join(' '))).equals(raw),'PSBT paste: BBQr P parts give the PSBT');
      { let e=''; try { w.psbtFromText(w.urEncode('crypto-output',w.eval('CB').bytes([1,2]),200)[0]); } catch(x){ e=x.message; } ok(/not a PSBT \(crypto-psbt\)/.test(e),'PSBT paste: a UR that is not a PSBT says so'); }
      { let e=''; try { w.psbtFromText(w.bbqrEncode('J',raw,160).join(' ')); } catch(x){ e=x.message; } ok(/file type J, not a PSBT/.test(e),'PSBT paste: a BBQr of another file type says so'); }
    }
    // --- animated QR for a multisig wallet ---
    const cos=Array.from({length:3},()=>{ const m=HDKey.fromMasterSeed(nc.randomBytes(32)); return {fp:m.fingerprint.toString(16).padStart(8,'0'), xpub:m.derive("m/48'/0'/0'/2'").publicExtendedKey}; });
    await w.eval(`(async (cos) => { ms = { m: 2, n: 3, type: 'ms-wsh', net: 'main', account: 0, keys: [], mode: 'paste', busy: false, done: false }; for (const c of cos) ms.keys.push({ fp: c.fp, path: '48h/0h/0h/2h', key: await parseExtendedKey(c.xpub), xpub: c.xpub, src: 'pasted' }); await msFinish(); })`)(cos);
    ok(w.eval('ms && ms.done')&&$('msAnimBox').style.display==='none','animated QR: hidden until a format is picked');
    await w.msAnim('ur'); const urParts=w.eval('animCtx.parts');
    { const d=w.urDecodeFrames(urParts.map(p=>p.toLowerCase())); ok($('msAnimBox').style.display===''&&d.type==='crypto-output'&&JSON.stringify(Array.from(d.msg))===JSON.stringify(w.eval('cryptoOutputMultisig')('ms-wsh',2,w.eval('ms.keys').map(k=>({fp:k.fp,path:k.path,key:k.key})),'main'))&&/^Part 1 of \d+$/.test($('msAnimCount').textContent)&&/Sparrow, SeedSigner and Nunchuk/.test($('msAnimCap').textContent),'animated QR (Sparrow, SeedSigner, Nunchuk): the frames join to the wallet\'s crypto-output'); }
    ok(urParts.every(p=>p===p.toUpperCase())&&$('msAnimImg').querySelector('svg')!==null,'animated QR: frames are capital letters (the compact QR mode) and one is drawn');
    await w.msAnim('bbqr'); { const d=w.bbqrDecodeFrames(w.eval('animCtx.parts')), txt=new TextDecoder().decode(d.bytes); ok(d.fileType==='U'&&/^wsh\(sortedmulti\(2,\[/.test(txt)&&txt.includes('/<0;1>/*')&&/#[a-z0-9]{8}$/.test(txt)&&cos.every(c=>txt.includes(c.xpub)),'animated QR (Coldcard Q): BBQr text of the receive-and-change descriptor, with its checksum'); }
    await w.msAnim('cc'); { const d=w.urDecodeFrames(w.eval('animCtx.parts').map(p=>p.toLowerCase())), b=w.cborRead(d.msg,0).v, txt=new TextDecoder().decode(b);
      ok(d.type==='bytes'&&/^# Coldcard Multisig setup file/.test(txt)&&/\nPolicy: 2 of 3\n/.test(txt)&&/\nDerivation: m\/48'\/0'\/0'\/2'\n/.test(txt)&&/\nFormat: P2WSH\n/.test(txt)&&cos.every(c=>txt.includes(c.fp.toUpperCase()+': '+c.xpub)),'animated QR (Keystone, Passport): UR bytes of the Coldcard setup file'); }
    { const seen=new Set(); for(let k=0;k<14;k++){ seen.add(w.eval('animCtx.i')); await new Promise(r=>setTimeout(r,50)); } const moved=seen.size>1&&w.eval('animCtx.frames.length')>1; $('msAnimPause').click(); const held=new Set(); for(let k=0;k<14;k++){ held.add(w.eval('animCtx.i')); await new Promise(r=>setTimeout(r,50)); } ok(moved&&w.eval('animCtx.paused')&&held.size===1&&/\(paused\)/.test($('msAnimCount').textContent),'animated QR: it moves on by itself, and PAUSE holds it'); $('msAnimPause').click(); }
    w.msReset(); ok($('msAnimBox').style.display==='none'&&$('msAnimImg').textContent===''&&w.eval('animTimer')===null&&w.eval('animCtx')===null,'animated QR: START OVER stops it and removes the frames');
    t6.w.close();
  })();
  sweep(t);
  await (async()=>{ // v2.6.0 review fixes: CLEAR ALL wipes Reforge and every box, practice-mode COPY ADDRESS and recorded-address check, Word draw download, P2WSH, password managers
    const r=load(); await r.ready(); const $=r.$, w=r.w, AB='abandon '.repeat(11)+'about', sleep=ms=>new Promise(x=>setTimeout(x,ms));
    const MAIN0='bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', TEST0='tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', MAINP='bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu'; // @scure: m/84'/0'/0'/0/0, m/84'/1'/0'/0/0, and m/84'/0'/0'/0/0 with passphrase TREZOR
    const P2WSH='bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'; // BIP173 sample: version 0, 32-byte program
    // CLEAR ALL
    for(const id of w.eval('AUTO_FIELDS')){ const e=$(id); if(e) e.value='secret'; } $('reforgeOut').textContent='FOUND'; $('reforgeOut').style.display=''; $('reforgePassTypos').checked=true;
    w.clearAll(); await sleep(20);
    { const left=w.eval('AUTO_FIELDS').filter(id=>$(id)&&$(id).value); ok(left.length===0&&$('reforgeOut').textContent===''&&$('reforgeOut').style.display==='none'&&!$('reforgePassTypos').checked,'CLEAR ALL: wipes the Reforge words, passphrases, guesses and result, the practice words and every box auto-clear wipes (left: '+left.join(',')+')'); }
    // practice mode: COPY ADDRESS
    w.practiceMode(true); r.set(rnd(50)); await w.generate();
    { const a=($('address').textContent.match(/: (tb1q[0-9a-z]+)/)||[])[1]; w.copyAddress(r.d.createElement('button')); await sleep(20); ok(!!a&&r.st.clip[r.st.clip.length-1]===a&&!r.st.alerts.includes('Generate a seed first'),'practice mode: COPY ADDRESS copies the test-network address'); }
    // VERIFY: a recorded first address is compared on its own network
    eq(await w.firstAddressOn('main',AB,''),MAIN0,'first address on the main network matches @scure');
    eq(await w.firstAddressOn('test',AB,''),TEST0,'first address on the test network matches @scure');
    const VR=async(rec,pw='')=>{ $('phrase').value=AB; $('verifyPass').value=pw; $('verifyRecorded').value=rec; await w.verify(); return $('verifyMatch').textContent; };
    ok(/^MATCH \(without passphrase\): your first address matches/.test(await VR(MAIN0)),'practice mode: a recorded bc1q address is compared with the real address, not the test-network one');
    ok(/^MATCH \(without passphrase\)/.test(await VR(TEST0)),'practice mode: a recorded tb1q address matches the test-network address');
    ok(/^MATCH \(with passphrase\)/.test(await VR(MAINP,'TREZOR')),'practice mode: a recorded bc1q address made with the passphrase matches');
    ok(/^NO MATCH/.test(await VR('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')),'practice mode: another address still gives NO MATCH');
    w.practiceMode(false);
    ok(/^MATCH \(without passphrase\)/.test(await VR(TEST0)),'a recorded tb1q address matches with practice mode off');
    ok(/^MATCH \(without passphrase\)/.test(await VR(MAIN0)),'a recorded bc1q address still matches with practice mode off');
    ok(/^NO MATCH/.test(await VR('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')),'a recorded tb1q address of other words gives NO MATCH');
    eq(w.classifyRecorded(TEST0),'addr','a tb1q address is read as a first address');
    // download: a Word draw seed never gets the rolls box as its input
    r.set(rnd(50)); $('wdLen').value='12'; $('wdWords').value='zoo abandon wolf ability yard absent window absorb wrist abstract year'; $('wdFlips').value='1 0 1 1 0 0 1'; w.wdUpdate(); await w.wdGenerate();
    { const typed=$('rolls').value; w.downloadSeed(); const txt=await blobText(w,r.st.blob); ok(/\nInput: Word draw \(the words above were drawn by hand, not made from rolls\); coin flips for the last word: 1011001$/.test(txt)&&!txt.includes(typed),'download: a Word draw seed says it was drawn by hand and gives its coin flips, never what is in the rolls box'); }
    // P2WSH (multisig) addresses
    $('phrase').value=AB; $('verifyPass').value=''; $('checkAddr').value=P2WSH; await w.checkAddress();
    ok(/^This is a script address \(P2WSH\), as a multisig wallet uses/.test($('addrCheckStatus').textContent)&&/bad/.test($('addrCheckStatus').className),'CHECK ADDRESS: a P2WSH (multisig) address is named as a script address, not searched');
    await w.checkAllAccounts(2,2); ok(/^This is a script address \(P2WSH\)/.test($('addrCheckStatus').textContent),'Try accounts 0 to 20: a P2WSH address is named as a script address, not reported NOT FOUND');
    $('checkAddr').value=P2WSH.toUpperCase(); await w.checkAddress(); ok(/^This is a script address \(P2WSH\)/.test($('addrCheckStatus').textContent),'CHECK ADDRESS: a P2WSH address in capitals is named too');
    ok(w.scriptAddrNote(MAIN0)===null&&w.scriptAddrNote(TEST0)===null&&w.scriptAddrNote('bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler')===null,'a single-key SegWit or a Taproot address is not called a script address');
    $('checkAddr').value=MAIN0; await w.checkAddress(); ok(/^FOUND: this SegWit address is receive address #0/.test($('addrCheckStatus').textContent),'CHECK ADDRESS: a single-key address is still found');
    // password managers
    { const ids=['passphrase','passphrase2','verifyPass','reforgeWordsPass','drillPass','pkIn','s39Pass','s39mPass','s39mPass2','dbKey','ppA','ppB','ewPass','wdatPass'];   /* v2.15.0: ppA, ppB: Practice your passphrase; v2.16.0: ewPass, the Electrum wallet password; wdatPass, the wallet.dat passphrase */ ok(ids.every(id=>{ const e=$(id); return e.getAttribute('data-lpignore')==='true'&&e.getAttribute('data-1p-ignore')==='true'&&e.getAttribute('data-bwignore')==='true'&&e.getAttribute('data-form-type')==='other'; })&&[...r.d.querySelectorAll('input[type=password]')].every(e=>ids.includes(e.id)),'password managers: every secret box (passphrases, private key) tells password-manager extensions to ignore it'); }
    ok(['passphrase','passphrase2','verifyPass','reforgeWordsPass'].every(id=>$(id).getAttribute('autocomplete')==='new-password'),'passphrase boxes keep autocomplete="new-password", so a saved password is never filled in as a passphrase');
    r.w.close(); })();
  sweep(t);
  await (async()=>{ // v2.7.0: dice passphrase, check your device's dice (and the test card), two wallets side by side, Roll together. Expected values from @scure.
    const {entropyToMnemonic,mnemonicToSeedSync}=require('@scure/bip39'); const {wordlist}=require('@scure/bip39/wordlists/english'); const {HDKey}=require('@scure/bip32');
    const {bech32}=require('@scure/base'); const {ripemd160}=require('@noble/hashes/ripemd160'); const {sha256:nsha}=require('@noble/hashes/sha256');
    const shaB=s=>nc.createHash('sha256').update(s).digest(), sleep=ms=>new Promise(x=>setTimeout(x,ms)), until=async f=>{ for(let k=0;k<200&&!f();k++) await sleep(50); };
    const fpS=(m,p)=>HDKey.fromMasterSeed(mnemonicToSeedSync(m,p)).fingerprint.toString(16).padStart(8,'0');
    const adS=(m,p,coin,hrp)=>{ const k=HDKey.fromMasterSeed(mnemonicToSeedSync(m,p)).derive(`m/84'/${coin}'/0'/0/0`); return bech32.encode(hrp,[0,...bech32.toWords(ripemd160(nsha(k.publicKey)))]); };
    const dpExp=(r,n)=>{ const b=[...shaB(r)].map(x=>x.toString(2).padStart(8,'0')).join(''); return Array.from({length:n},(_,i)=>wordlist[parseInt(b.slice(i*11,i*11+11),2)]).join(' '); };
    const dcExp=(r,wc,six)=>entropyToMnemonic(shaB(six?r.replace(/6/g,'0'):r).subarray(0,wc===12?16:32),wordlist);
    const words=t=>[...t.matchAll(/\d+\. ([a-z]+)/g)].map(m=>m[1]).join(' ');
    const r=load(); await r.ready(); const $=r.$, w=r.w, AB='abandon '.repeat(11)+'about';
    // --- dice passphrase ---
    ok(w.dpNeed(4)===18&&w.dpNeed(6)===26&&w.dpNeed(8)===35,'dice passphrase: 4, 6 or 8 words need 18, 26 or 35 rolls (11 bits a word, log2(6) a roll)');
    ok($('dpWords').value==='6'&&$('dpCount').textContent==='0 / 26 rolls'&&$('dpBox').closest('#advanced')!==null,'dice passphrase: in Passphrase and note, 6 words by default');
    const P1='25163452616341525364152634', P2='4152635241625361425362415362415263524';
    eq([...$('dpWords').options].map(o=>o.value).join(),'6,8','dice passphrase: 6 or 8 words only (4 words, 44 bits, could be searched by someone with the seed words)');
    for(const [n,rolls] of [[6,P1],[8,P2.slice(0,35)],[6,P2]]){ $('dpWords').value=String(n); w.dpClear(true); $('dpRolls').value=rolls; await w.dpMake(); eq($('dpOut').textContent,dpExp(rolls,n),'dice passphrase: '+n+' words from '+rolls.length+' rolls equal the SHA-256 of the rolls, 11 bits a word'); }
    ok(/^6 words, about 66 bits, from 37 rolls\. Write the passphrase down exactly/.test($('dpStatus').textContent)&&/These rolls make the passphrase again, so shred them/.test($('dpStatus').textContent)&&$('dpUseRow').style.display==='','dice passphrase: says the bits (at most 11 a word), that the rolls are as secret as the passphrase, and shows USE AS PASSPHRASE');
    $('dpRolls').value=P1.slice(0,25); $('dpRolls').dispatchEvent(new w.Event('input')); ok($('dpOut').textContent===''&&$('dpUseRow').style.display==='none'&&$('dpCount').textContent==='25 / 26 rolls','dice passphrase: editing the rolls drops the old passphrase');
    await w.dpMake(); ok($('dpOut').textContent===''&&/^Roll 1 more \(25 of 26\) for 6 words\.$/.test($('dpStatus').textContent),'dice passphrase: too few rolls make nothing and say how many more');
    r.set(rnd(50)); await w.generate(); const seedR=$('rolls').value;
    $('dpRolls').value=seedR.slice(5,31); await w.dpMake(); ok($('dpOut').textContent===''&&/These rolls are in the seed box above/.test($('dpStatus').textContent),'dice passphrase: rolls taken from the seed box are refused');
    { const sw=$('genResult').textContent.split('\n')[0]; $('dpRolls').value=P1; await w.dpMake(); w.dpUse(); const pp=dpExp(P1,6);
      await until(()=>$('fingerprint').textContent.includes(fpS(sw,pp)));
      ok($('passphrase').value===pp&&$('passphrase2').value===pp&&$('fingerprint').textContent.includes(fpS(sw,pp))&&/PASSPHRASE SET/.test($('advSummary').textContent)&&/now in both passphrase boxes \(press SHOW there to see it again\)/.test($('dpStatus').textContent),'dice passphrase: USE AS PASSPHRASE fills both boxes and the fingerprint becomes the wallet with that passphrase');
      ok($('dpOut').textContent===''&&$('dpOut').style.display==='none'&&$('dpRolls').value===''&&$('dpUseRow').style.display==='none','dice passphrase: after USE AS PASSPHRASE the words and rolls leave the box, so only the masked passphrase boxes hold it'); }
    ok(/#reforgeOut, #dpOut \{ -webkit-user-select: none; user-select: none; \}/.test(html),'dice passphrase: the passphrase on screen cannot be highlighted, like the seed words');
    ok(/\n  body\.drill-on #dpBox \{ display: none !important; \}/.test(html),'dice passphrase: the restore drill hides the dice passphrase box, so the drill cannot be passed from the screen');
    // --- check your device's dice ---
    const C=w.eval('DC_CARD_ROLLS'); ok(/^[1-6]{100}$/.test(C),'device dice: the test card has 100 rolls');
    const DC=async(dev,wc,rolls)=>{ $('dcDev').value=dev; $('dcLen').value=String(wc); w.dcClear(true); $('dcRolls').value=rolls; await w.dcCheck(); return words($('dcOut').textContent); };
    eq(await DC('seedsigner',12,C.slice(0,50)),dcExp(C.slice(0,50),12,false),'device dice: SeedSigner, 12 words from exactly 50 rolls');
    eq(await DC('seedsigner',24,C.slice(0,99)),dcExp(C.slice(0,99),24,false),'device dice: SeedSigner, 24 words from exactly 99 rolls');
    eq(await DC('coldcard',12,C.slice(0,73)),dcExp(C.slice(0,73),12,false),'device dice: Coldcard hashes every roll (73 rolls)');
    eq(await DC('keystone',12,C.slice(0,50)),dcExp(C.slice(0,50),12,true),'device dice: Keystone counts each 6 as 0 (12 words)');
    eq(await DC('keystone',24,C),dcExp(C,24,true),'device dice: Keystone, 24 words from 100 rolls');
    ok(await DC('seedsigner',12,C.slice(0,51))===''&&/^SeedSigner takes exactly 50 rolls for 12 words: remove 1\.$/.test($('dcStatus').textContent),'device dice: SeedSigner refuses more than exactly 50 rolls');
    ok(await DC('keystone',24,C.slice(0,99))===''&&/^Keystone asks for at least 100 rolls for 24 words/.test($('dcStatus').textContent),'device dice: Keystone needs 100 rolls for 24 words, not 99');
    { await DC('seedsigner',12,C.slice(0,50)); ok(/first check that you typed the same rolls in the same order/.test($('dcStatus').textContent)&&/a firmware update can change them/.test($('dcStatus').textContent)&&/If it still differs, do not trust the device with your money/.test($('dcStatus').textContent),'device dice: before "do not trust", the result says to check the rolls and that firmware updates can change the rules'); }
    { $('dcDev').value='bitbox02'; $('dcLen').value='12'; $('dcRolls').value=C.slice(0,50); const run=w.dcCheck(); w.practiceMode(true); await run; const o=$('dcOut').textContent; w.practiceMode(false);
      ok(o===''||(/m\/84'\/0'\/0'\/0\/0/.test(o)&&/bc1q/.test(o)&&!/TESTNET|tb1q/.test(o)),'device dice: practice mode switched on during the check: no result of the old network stays on screen (fixes release: it is cleared), and never a mixed one'); }
    ok(await DC('keystone',12,C+C+C.slice(0,57))===''&&/^Keystone takes at most 256 rolls: remove 1\.$/.test($('dcStatus').textContent),'device dice: Keystone takes at most 256 rolls');
    { const m=dcExp(C.slice(0,50),12,false); await DC('bitbox02',12,C.slice(0,50)); const o=$('dcOut').textContent;
      ok(/^TEST ONLY: these words are not secret\. Never send money to this wallet\./.test(o)&&o.includes(adS(m,'',0,'bc'))&&/BitBox02 takes no dice rolls\. To check that it uses the words you give it, restore these 12 test words/.test($('dcStatus').textContent)&&/test once with your own throwaway rolls too/.test($('dcStatus').textContent),'device dice: BitBox02 restores the test words and compares the first receive address; the public card rolls are flagged');
      w.practiceMode(true); await DC('bitbox02',12,C.slice(0,50)); const ot=$('dcOut').textContent; ok(ot.includes(adS(m,'',1,'tb'))&&!ot.includes(adS(m,'',0,'bc'))&&/TESTNET/.test(ot),'device dice: in practice mode the address is on the test network'); w.practiceMode(false); }
    { $('dcDev').value='keystone'; $('dcLen').value='24'; w.dcFill(); ok($('dcRolls').value===C&&$('dcCount').textContent==='100 / 100 rolls (100 to 256 for Keystone)','device dice: USE THE TEST CARD ROLLS fills exactly the rolls the device needs'); }
    { $('dcRolls').value='15263443625115263443625115263443625115263443625115'; $('dcDev').value='coldcard';   // v2.17.0: fixed throwaway rolls (random ones failed about 1 run in 27, when one face passed Coldcard's 30% limit) $('dcLen').value='12'; await w.dcCheck(); ok(!/public test card rolls/.test($('dcStatus').textContent)&&/New Seed Words, Advanced, 12 Word Dice Roll/.test($('dcStatus').textContent),'device dice: own throwaway rolls are not called the public card rolls; Coldcard menu named'); }
    { const p0=r.st.printed; await w.printDiceCard(); const t=r.st.printHTML, ws=words(t);
      const want=[dcExp(C.slice(0,50),12,false),dcExp(C.slice(0,99),24,false),dcExp(C.slice(0,50),12,true),dcExp(C,24,true)].join(' ');
      ok(r.st.printed===p0+1&&/^VOIDFORGE DICE TEST CARD/.test(t)&&ws===want&&t.includes(C.slice(0,10)+' '+C.slice(10,20))&&t.includes(adS(dcExp(C.slice(0,50),12,false),'',0,'bc'))&&/TEST ONLY\. These rolls and words are printed for anyone to see/.test(t),'test card: the public rolls and, for SeedSigner/Coldcard and Keystone, 12 and 24 words and first addresses');
      w.dispatchEvent(new w.Event('afterprint')); ok($('printOnly').textContent===''&&!r.d.body.classList.contains('print-seed'),'test card: cleaned up after printing'); }
    ok(!$('dpBtn').classList.contains('secondary')&&!$('dcBtn').classList.contains('secondary')&&[...$('dcBox').querySelectorAll('button')].filter(b=>/PRINT/.test(b.textContent)).every(b=>b.classList.contains('secondary')),'buttons: MAKE PASSPHRASE and SHOW EXPECTED WORDS are gold; PRINT TEST CARD is gray');
    // --- two wallets side by side ---
    $('phrase').value=AB; $('verifyPass').value='TREZOR'; await w.verify(); await until(()=>$('wvDecoy').style.display==='');
    ok($('wvD0').textContent==='Fingerprint '+fpS(AB,'')&&$('wvD0a').textContent==='First address: '+adS(AB,'',0,'bc')&&$('wvD1').textContent==='Fingerprint '+fpS(AB,'TREZOR')&&$('wvD1a').textContent==='First address: '+adS(AB,'TREZOR',0,'bc'),'two wallets side by side: without and with the passphrase, fingerprint and first address each');
    ok(/Someone who finds only the words opens the wallet on the left, never the one on the right/.test($('wvDecoy').textContent),'two wallets side by side: plain explanation');
    w.practiceMode(true); await until(()=>/test network/.test($('wvD1a').textContent));
    ok($('wvD0a').textContent==='First address (test network): '+adS(AB,'',1,'tb')&&$('wvD1a').textContent==='First address (test network): '+adS(AB,'TREZOR',1,'tb'),'two wallets side by side: practice mode switches both to the test network');
    w.practiceMode(false); await until(()=>/^First address: bc1/.test($('wvD1a').textContent)); ok($('wvD1a').textContent==='First address: '+adS(AB,'TREZOR',0,'bc'),'two wallets side by side: and back');
    $('verifyPass').value=''; await w.verify(); await sleep(50); ok($('wvDecoy').style.display==='none'&&$('wvD0').textContent==='','two wallets side by side: not shown without a passphrase');
    { $('verifyPass').value='TREZOR'; const v=w.verify(); await until(()=>$('walletView').style.display===''); $('wvType').value='tr'; $('wvType').dispatchEvent(new w.Event('change')); await v; await until(()=>$('wvDecoy').style.display===''&&$('wvD1a').textContent!=='');
      ok($('wvDecoy').style.display===''&&$('wvD1a').textContent==='First address: '+adS(AB,'TREZOR',0,'bc'),'two wallets side by side: changing the address type while they are worked out does not lose them');
      $('wvType').value='wpkh'; $('wvType').dispatchEvent(new w.Event('change')); $('verifyPass').value=''; }
    // --- Roll together ---
    { const rt=$('rollTogether'); ok(!!rt&&rt.previousElementSibling.id==='rollStats'&&/hashing only mixes the rolls; it cannot add randomness\. So let each die roll the full count on its own \(50 for 12 words, 99 for 24\)/.test(rt.textContent)&&/the words are random as long as one of the dice is fair/.test(rt.textContent)&&/Everyone who sees all the rolls can make the seed again/.test(rt.textContent),'Roll together: a short guide after Your rolls: each die rolls the full count, then one fair die is enough; everyone who sees the rolls can make the seed'); }
    // --- every wipe ---
    $('dpRolls').value=P1; await w.dpMake(); $('dcRolls').value=C.slice(0,50); $('dcDev').value='seedsigner'; $('dcLen').value='12'; await w.dcCheck();
    w.clearAll(); await sleep(20); ok(!$('dpRolls').value&&!$('dpOut').textContent&&$('dpUseRow').style.display==='none'&&!$('dcRolls').value&&!$('dcOut').textContent,'CLEAR ALL wipes the dice passphrase and the device check');
    $('dpRolls').value=P1; await w.dpMake(); ok(w.autoWipe('test')===true&&!$('dpRolls').value&&!$('dpOut').textContent,'auto-clear wipes the dice passphrase');
    // --- dictionary ---
    { const names=w.eval('DICT').map(e=>e[0]); ok(['Device dice check','Dice passphrase','Roll together','Decoy wallet'].every(n=>names.includes(n)),'dictionary: Device dice check, Dice passphrase, Roll together and Decoy wallet'); }
    r.w.close(); })();
  sweep(t);
  await (async()=>{ // v2.8.0: Wallet Detective, Is anything watching this page?, Heir mode. Expected addresses from @scure and node's own PBKDF2.
    const {mnemonicToSeedSync}=require('@scure/bip39'); const {HDKey}=require('@scure/bip32');
    const {bech32,base58check,bech32m}=require('@scure/base'); const {ripemd160}=require('@noble/hashes/ripemd160'); const {sha256:nsha}=require('@noble/hashes/sha256');
    const b58=base58check(nsha), h160=b=>ripemd160(nsha(b)), sleep=ms=>new Promise(x=>setTimeout(x,ms));
    const enc=(type,pub,test)=>type==='wpkh'?bech32.encode(test?'tb':'bc',[0,...bech32.toWords(h160(pub))]):type==='pkh'?b58.encode(Uint8Array.of(test?0x6f:0,...h160(pub))):b58.encode(Uint8Array.of(test?0xc4:5,...h160(Uint8Array.of(0,20,...h160(pub)))));
    const ref=(root,path,type,test)=>enc(type,root.derive(path).publicKey,test);
    const bip=(m,p)=>HDKey.fromMasterSeed(mnemonicToSeedSync(m,p));
    const elRoot=(m,saltPass)=>HDKey.fromMasterSeed(nc.pbkdf2Sync(Buffer.from(m),Buffer.from('electrum'+saltPass),2048,64,'sha512'));
    const r=load(); await r.ready(); const $=r.$, w=r.w, AB='abandon '.repeat(11)+'about';
    const EL_STD='cycle rocket west magnet parrot shuffle foot correct salt library feed song', EL_SW='bitter grass shiver impose acquire brush forget axis eager alone wine silver';
    const DF=async(words,pass,addr)=>{ $('phrase').value=words; $('verifyPass').value=pass; $('detAddr').value=addr; await w.detFind(); return {st:$('detStatus').textContent, cls:$('detStatus').className, out:$('detOut').textContent, shown:$('detOut').style.display!=='none'}; };
    eq(html.match(/<div class="ft-name">VOIDFORGE <span>(v[\d.]+)<\/span>/)[1],'v2.17.0','v2.17.0: the footer shows the new version');
    ok(html.indexOf('<li><b>2.8.0</b>')>0&&html.indexOf('<li><b>2.8.0</b>')<html.indexOf('<li><b>2.7.0</b>'),'v2.8.0: the changelog lists 2.8.0 first');
    // --- Wallet Detective ---
    ok(!$('detBtn').disabled&&!$('detListBtn').disabled&&$('detStop').disabled&&$('detBtn').className===''&&$('detListBtn').className==='secondary small','Wallet Detective: FIND MY WALLET is the gold main button, enabled after the self-test; LIST and STOP are gray');
    { const pos=['addrCheckStatus','detBlock'].map(id=>html.indexOf('id="'+id+'"')); ok(pos[0]>0&&pos[1]>pos[0]&&$('detBlock').closest('#tp-check'),'Wallet Detective: in CHECK A BACKUP, after the address check'); }
    let d=await DF(AB,'',ref(bip(AB,''),"m/0'/1/7",'wpkh'));
    ok(d.cls==='status ok'&&d.shown&&d.out.startsWith('FOUND: '+ref(bip(AB,''),"m/0'/1/7",'wpkh')+" is change address #7 (m/0'/1/7) of these words, without a passphrase.")&&/derivation path m\/0'\./.test(d.out)&&/Apps that use these settings: BRD \(Breadwallet\) after it moved to SegWit, and BlueWallet's Breadwallet type\./.test(d.out),'Wallet Detective: finds a native SegWit change address on the old m/0\' path and names BRD and BlueWallet (address from @scure)');
    ok(/script type|Script Type to Native Segwit \(P2WPKH\)/.test(d.out)&&/Mnemonic Words \(BIP39\)/.test(d.out)&&/if it is not m\/0', change it to m\/0' and press Import Custom Derivation Keystore; if it already is, press Import Keystore\. Then press Apply\./.test(d.out)&&!/Use passphrase\?/.test(d.out),'Wallet Detective: Sparrow steps with the exact labels, the custom derivation button, and no passphrase step without one');
    d=await DF(AB,'',ref(bip(AB,''),"m/44'/0'/0'/0/3",'wpkh'));
    ok(/receive address #3 \(m\/44'\/0'\/0'\/0\/3\)/.test(d.out)&&/Apps that use these settings: BitPay and Copay, which keep native SegWit wallets on the BIP44 path\./.test(d.out)&&!/unusual mix/.test(d.out),'Wallet Detective: a native SegWit address on the BIP44 path is BitPay/Copay (address from @scure)');
    d=await DF(AB,'',ref(bip(AB,''),"m/84'/0'/0'/0/2",'sh-wpkh'));
    ok(/receive address #2 \(m\/84'\/0'\/0'\/0\/2\)/.test(d.out)&&/This is an unusual mix: a nested SegWit \(3\.\.\.\) address on the BIP84 path\./.test(d.out)&&!/Apps that use these settings/.test(d.out)&&/Script Type to Nested Segwit \(P2SH-P2WPKH\)/.test(d.out),'Wallet Detective: an address type on a path no listed app uses is found and called an unusual mix');
    d=await DF(AB,'Secret',ref(bip(AB,'Secret'),"m/49'/0'/0'/0/0",'sh-wpkh'));
    ok(/receive address #0 \(m\/49'\/0'\/0'\/0\/0\) of these words, with the passphrase\./.test(d.out)&&/BIP39 seed words with the passphrase/.test(d.out)&&/tick Use passphrase\? and type the passphrase/.test(d.out)&&/Apps that use these settings: Sparrow, BlueWallet, Trezor Suite/.test(d.out),'Wallet Detective: with the passphrase, BIP49, and the Sparrow passphrase step');
    d=await DF(AB,'Secret',ref(bip(AB,''),"m/44'/0'/0'/1/4",'pkh'));
    ok(/change address #4 \(m\/44'\/0'\/0'\/1\/4\) of these words, without a passphrase\./.test(d.out)&&/It was found WITHOUT the passphrase you typed\. Leave the passphrase out in the wallet app\./.test(d.out),'Wallet Detective: tries without the typed passphrase too, and says so when that is the match');
    d=await DF(AB,'',ref(bip(AB,''),"m/84'/0'/2147483646'/0/1",'wpkh'));
    ok(/\(m\/84'\/0'\/2147483646'\/0\/1\)/.test(d.out)&&/Samourai Wallet and Ashigaru \(Whirlpool post-mix\), Sparrow \(Whirlpool\) and Passport \(post-mix\)/.test(d.out),'Wallet Detective: finds a Whirlpool post-mix address (address from @scure)');
    d=await DF(AB,'',ref(bip(AB,''),"m/0/5",'pkh'));
    ok(/\(m\/0\/5\)/.test(d.out)&&/Edge, for old Airbitz wallets/.test(d.out)&&/open it in Edge\. Other apps, Sparrow among them, may not accept the root path m/.test(d.out)&&!/To open it in Sparrow/.test(d.out),'Wallet Detective: finds the root m/0/i path of old Airbitz wallets');
    d=await DF(AB,'',ref(bip(AB,''),"m/84'/0'/0'/0/31",'wpkh'));
    ok(/receive address #31 /.test(d.out)&&/It is address #31\. Many apps stop looking after 20 unused addresses in a row, so raise the app's gap limit \(in Sparrow: the Settings tab, Advanced\.\.\., Gap limit\)/.test(d.out),'Wallet Detective: address #31 is found and the gap limit is explained');
    d=await DF(AB,'',ref(bip(AB,''),"m/84'/0'/2'/0/0",'wpkh'));
    ok(/\(m\/84'\/0'\/2'\/0\/0\)/.test(d.out)&&/It is in account 2, not account 0\./.test(d.out),'Wallet Detective: finds account 2');
    // Electrum seeds, with Electrum's own test wallets and a passphrase (Electrum lower-cases it; some apps use it as typed)
    d=await DF(EL_STD,'','1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D');
    ok(/change address #0 \(m\/1\/0\)/.test(d.out)&&/an Electrum seed \(not BIP39\), address type legacy \(1\.\.\.\), Electrum's own derivation/.test(d.out)&&/To open it in Electrum \(Sparrow and most other apps cannot open Electrum seeds\): File, New\/Restore, type a wallet name, Next, Standard wallet, I already have a seed, and type the words\.$/m.test(d.out),'Wallet Detective: an Electrum standard seed (Electrum test wallet) and the Electrum steps');
    { const want=ref(elRoot(EL_SW,'my pass'),"m/0'/0/9",'wpkh'); d=await DF(EL_SW,'My  Pass ',want);
      ok(/receive address #9 \(m\/0'\/0\/9\) of these words, with the passphrase\./.test(d.out)&&/press Options, tick “Extend this seed with custom words” and press OK; type the passphrase on the Seed Extension page \(Electrum ignores capital letters in it\)/.test(d.out)&&!/exactly as typed/.test(d.out),'Wallet Detective: an Electrum SegWit seed with a passphrase normalized as Electrum does (lower case, spaces collapsed; node PBKDF2 + @scure)'); }
    { const want=ref(elRoot(EL_SW,'My Pass'),"m/0'/0/1",'wpkh'); d=await DF(EL_SW,'My Pass',want);
      ok(/receive address #1 /.test(d.out)&&/It matched with the passphrase used exactly as typed/.test(d.out)&&/Electrum itself cannot open it from these words/.test(d.out)&&!/To open it in Electrum/.test(d.out),'Wallet Detective: an Electrum seed whose passphrase was used as typed (as Sparrow imports it) is found and explained'); }
    // refusals
    d=await DF('','',ref(bip(AB,''),"m/84'/0'/0'/0/0",'wpkh')); ok(d.cls==='status bad'&&/^First type the seed words in the box at the top of CHECK A BACKUP\./.test(d.st)&&!d.shown,'Wallet Detective: asks for the words first');
    d=await DF(AB,'',''); ok(d.cls==='status bad'&&/^Type one address this wallet received to, or press LIST FIRST ADDRESSES/.test(d.st),'Wallet Detective: asks for an address');
    d=await DF(AB,'',bech32.encode('bc',[0,...bech32.toWords(nsha(Uint8Array.of(1,2,3)))])); ok(/script address \(P2WSH\)/.test(d.st),'Wallet Detective: a multisig script address is refused with the reason');
    { const a=ref(bip(AB,''),"m/84'/0'/0'/0/0",'wpkh'); d=await DF(AB,'',a.slice(0,-1)+(a.endsWith('q')?'p':'q')); ok(/typo/.test(d.st)&&d.cls==='status bad','Wallet Detective: an address with a typo is refused'); }
    d=await DF(AB,'','73c5da0a'); ok(/not a key or a fingerprint/.test(d.st),'Wallet Detective: a fingerprint is not an address');
    d=await DF('zoo '.repeat(19)+'zoo','',ref(bip(AB,''),"m/84'/0'/0'/0/0",'wpkh')); ok(/SLIP39 \(Shamir\) share of 20 words/.test(d.st),'Wallet Detective: 20 words are named as a SLIP39 share');
    { const tf='ketchup cost faint boil dwarf occur clean category solve extend garlic miss';   // HMAC-SHA512('Seed version', words) starts with 101: a 2FA seed
      d=await DF(tf,'',ref(bip(AB,''),"m/84'/0'/0'/0/0",'wpkh')); ok(/two-factor \(2FA\) seed/.test(d.st)&&/Restore 2FA wallet, Disable opens it without the TrustedCoin service/.test(d.st),'Wallet Detective: an Electrum two-factor seed is sent to Electrum'); }
    // NOT FOUND, and the STOP button
    d=await DF(AB,'',ref(bip(AB,''),"m/84'/0'/0'/0/150",'wpkh'));
    ok(d.cls==='status bad'&&/^NOT FOUND in the settings of the well-known wallet apps \(BIP39 paths: accounts 0 to 9 and the first 100 addresses of account 0 where apps use this address type, the first 20 elsewhere; without a passphrase\)/.test(d.st)&&/Muun, Bitkey/.test(d.st)&&!d.shown,'Wallet Detective: NOT FOUND says what was searched and what else to check');
    { $('detAddr').value=ref(bip(AB,''),"m/84'/0'/0'/0/150",'wpkh'); const p=w.detFind(); await sleep(300); ok($('detStop').disabled===false&&$('detBtn').disabled,'Wallet Detective: STOP is on and FIND is off while it searches'); await w.detFind(); ok(/^A search is still ending\./.test($('detStatus').textContent),'Wallet Detective: pressing FIND during a search says so'); w.detStop(); await p;
      ok($('detStatus').textContent==='Stopped. Nothing was found before you stopped it.'&&!$('detBtn').disabled&&$('detStop').disabled,'Wallet Detective: STOP ends the search'); }
    { $('detAddr').value=ref(bip(AB,''),"m/84'/0'/0'/0/150",'wpkh'); const p=w.detFind(); await sleep(300); $('phrase').value=AB+' '; $('phrase').dispatchEvent(new w.Event('input')); await p;
      ok($('detStatus').textContent===''&&!$('detOut').textContent&&$('detAddr').value!==''&&!$('detBtn').disabled,'Wallet Detective: editing the words during a search stops it and leaves no old result'); }
    // practice mode
    w.practiceMode(true); d=await DF(AB,'',ref(bip(AB,''),"m/84'/0'/0'/0/0",'wpkh')); ok(/^Practice mode is on, so the Detective searches only test-network addresses/.test(d.st),'Wallet Detective: practice mode refuses a real address');
    d=await DF(AB,'',ref(bip(AB,''),"m/84'/1'/0'/0/4",'wpkh',true)); ok(/receive address #4 \(m\/84'\/1'\/0'\/0\/4\)/.test(d.out)&&/This is a test-network address, so switch the app to testnet first/.test(d.out),'Wallet Detective: practice mode finds a test-network address on coin type 1 (address from @scure)');
    $('detAddr').value=''; await w.detList(); ok(/on the test network \(practice mode\)/.test($('detStatus').textContent)&&$('detOut').textContent.includes(ref(bip(AB,''),"m/84'/1'/0'/0/0",'wpkh',true))&&(()=>{ const a=[...$('detOut').textContent.matchAll(/^  ([0-9a-zA-Z]{26,})$/gm)].map(m=>m[1]); return a.length>=8&&a.every(s=>/^(tb1|[2mn])/.test(s)); })(),'Wallet Detective: LIST in practice mode shows only test-network addresses');
    w.practiceMode(false); ok($('detStatus').textContent===''&&!$('detOut').textContent,'Wallet Detective: turning practice mode off clears the result');
    // LIST FIRST ADDRESSES
    $('phrase').value=AB; $('verifyPass').value=''; $('detAddr').value=''; await w.detList();
    { const o=$('detOut').textContent, R=bip(AB,'');
      const want=[["m/84'/0'/0'/0/0",'wpkh'],["m/49'/0'/0'/0/0",'sh-wpkh'],["m/44'/0'/0'/0/0",'pkh'],["m/44'/0'/0'/0/0",'wpkh'],["m/0'/0/0",'pkh'],["m/0'/0/0",'wpkh'],["m/0/0",'pkh']].map(([p,t])=>ref(R,p,t));
      ok(want.every(a=>o.includes('\n  '+a+'\n'))&&o.includes('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr')&&!/Electrum seed/.test(o)&&/A watch-only wallet in Sparrow connected to your own node is more private\.$/.test(o)&&/^The first receive address of each common setting, without a passphrase\./.test($('detStatus').textContent),'Wallet Detective: LIST FIRST ADDRESSES gives the first address of each setting (from @scure; BIP86 from its test vector), no Electrum rows for a BIP39 phrase'); }
    $('phrase').value=EL_SW; await w.detList(); ok($('detOut').textContent.includes("Electrum seed, SegWit, native SegWit (bc1q...), m/0'/0/0\n  bc1q3g5tmkmlvxryhh843v4dz026avatc0zzr6h3af")&&!/BIP84/.test($('detOut').textContent),'Wallet Detective: LIST for an Electrum seed shows the Electrum address (Electrum test wallet)');
    // wipes
    $('detAddr').value='x'; w.clearAll(); await sleep(20); ok(!$('detAddr').value&&!$('detOut').textContent&&!$('detStatus').textContent,'CLEAR ALL wipes the Wallet Detective');
    // --- Is anything watching this page? ---
    ok(!html.includes('<script id=')&&(html.match(/<script>/g)||[]).length===8&&(html.match(/<style>/g)||[]).length===1,'watch check: the page has exactly eight scripts (two of its own and six of the practice signer) and one style sheet, which it knows as its own');
    { const own=w.eval('VF_OWN_DATA'), names=w.eval('WATCH_NAMES'), found=new Set();
      for(const m of html.matchAll(/data-([a-z0-9][a-z0-9-]*)/g)) if(!names.some(([re])=>re.test('data-'+m[1]))) found.add(m[1]);
      for(const m of html.matchAll(/dataset\.([a-zA-Z]+)/g)) found.add(m[1].replace(/[A-Z]/g,c=>'-'+c.toLowerCase()));
      const miss=[...found].filter(x=>!own.includes(x)); ok(miss.length===0,'watch check: VF_OWN_DATA lists every data- attribute the page uses'+(miss.length?' (missing: '+miss.join(', ')+')':'')); }
    { const signs=w.watchSigns(); ok(signs.length===0&&$('watchWarn').style.display!=='block','watch check: after using the Detective, the wallet view and the lists, the page itself leaves no sign'+(signs.length?' (got: '+signs.join(' | ')+')':'')); }
    w.watchCheck(); ok($('watchStatus').textContent==='NO SIGN FOUND of extensions, translators or other scripts on this page right now.'&&/^That does not make it safe\. This check can only find signs\./.test($('watchOut').textContent)&&!/\bis safe\b|\bsafe\./i.test($('watchStatus').textContent),'watch check: with no sign it says NO SIGN FOUND and that this does not make it safe');
    $('menuBox').open=true; $('watchMenuBtn').click(); ok(!$('menuBox').open&&!$('tp-about').classList.contains('tab-off')&&$('watchStatus').textContent!=='','watch check: the MENU button opens ABOUT & HELP and runs the check');
    r.w.close(); })();
  sweep(t);
  await (async()=>{ // watch check with simulated extensions: each sign is named, the banner shows, and a removed script is still remembered
    const sleep=ms=>new Promise(x=>setTimeout(x,ms)); const T=async(f)=>{ const t=load(); await t.ready(); f(t.w,t.d,t.$); await sleep(450); const s=t.w.watchSigns(), b=t.$('watchWarn'); const res={s:s.join('\n'), banner:b.style.display==='block', btxt:b.textContent, t}; return res; };
    let x=await T((w,d,$)=>{ $('phrase').setAttribute('data-gramm','false'); d.body.appendChild(d.createElement('grammarly-extension')); });
    ok(/An attribute data-gramm on the page, as Grammarly \(a writing assistant\) adds\./.test(x.s)&&/An element <grammarly-extension> that this page never makes/.test(x.s)&&x.banner&&/^Something else may be reading or changing this page\. An attribute data-gramm .* \(and 1 more sign\) Browser extensions can read everything typed here, including seed words\. WHAT TO DO$/.test(x.btxt),'watch check: a writing assistant\'s attribute and element are found and the warning shows at the top');
    x.t.$('watchWarn').querySelector('button').click(); ok(/^2 SIGNS FOUND/.test(x.t.$('watchStatus').textContent)&&/private window with every extension turned off/.test(x.t.$('watchOut').textContent)&&/can never show that nothing is watching/.test(x.t.$('watchOut').textContent),'watch check: WHAT TO DO lists the signs, the fix and the limits'); x.t.w.close();
    x=await T((w,d)=>{ const s=d.createElement('script'); s.src='chrome-extension://abc/inject.js'; d.head.appendChild(s); s.remove(); w.ethereum={}; });
    ok(/A script this page does not have \(from chrome-extension:\/\/abc\/inject\.js\)\. It was added and then removed again\./.test(x.s)&&/an object named “ethereum”, which crypto wallet extensions \(such as MetaMask\) add/.test(x.s),'watch check: a script added and removed at once, and a wallet extension object, are found'); x.t.w.close();
    x=await T((w,d)=>{ d.documentElement.classList.add('translated-ltr'); d.documentElement.lang='de'; const f=d.createElement('font'); f.textContent='Hallo'; d.body.appendChild(f); });
    ok(/The page was translated \(its language is now “de”\)/.test(x.s)&&/Text wrapped in <font> tags, as page translators do\./.test(x.s),'watch check: translation is found'); x.t.w.close();
    x=await T((w,d)=>{ d.body.appendChild(d.createElement('iframe')); const st=d.createElement('style'); st.className='darkreader'; d.head.appendChild(st); const l=d.createElement('link'); l.rel='stylesheet'; l.href='https://x.example/a.css'; d.head.appendChild(l); d.body.appendChild(d.createElement('div')).attachShadow({mode:'open'}); d.body.setAttribute('data-darkreader-mode','dynamic'); });
    ok(/A frame or embedded object \(<iframe>\)/.test(x.s)&&/A style sheet this page does not have \(class darkreader\)/.test(x.s)&&/A link to a file outside this page \(https:\/\/x\.example\/a\.css\)/.test(x.s)&&/An element with its own hidden content \(<div>\)/.test(x.s)&&/data-darkreader-mode on the page, as Dark Reader/.test(x.s),'watch check: frames, style sheets, outside links, hidden content and a restyler are found'); x.t.w.close();
    x=await T((w,d,$)=>{ $('verifyPass').setAttribute('data-unknown-helper','1'); Object.defineProperty(w.navigator,'webdriver',{configurable:true,get:()=>true}); });
    ok(/An attribute data-unknown-helper that this page never sets, probably added by a browser extension\./.test(x.s)&&/controlled by automation software/.test(x.s),'watch check: an unknown attribute and automation are found'); x.t.w.close();
    x=await T((w,d)=>{ d.body.appendChild(d.createElement('div')); d.documentElement.appendChild(d.createElement('span')); });
    ok(/An element \(<div>\) added straight into the page after it opened/.test(x.s)&&/An element \(<span>\) added straight into the page after it opened/.test(x.s),'watch check: elements added straight under <body> or <html> after the page opened are found'); x.t.w.close();
    x=await T((w)=>{ for(let i=0;i<500;i++) w.document.body.appendChild(w.document.createElement('x-y')); });
    ok(x.t.w.vfWatchSeen.length<=200,'watch check: the early notes are capped at 200'); x.t.w.close(); })();
  sweep(t);
  await (async()=>{ // Heir mode
    const t=load(); await t.ready(); const $=t.$, w=t.w;
    ok($('heirCard').style.display==='none'&&$('heirBtn').getAttribute('aria-expanded')==='false'&&$('heirBtn').className==='small'&&$('heirNew').closest('header'),'Heir mode: a gold I FOUND A BITCOIN BACKUP button under the title; the help is closed at first');
    $('heirBtn').click(); ok($('heirCard').style.display===''&&$('heirBtn').getAttribute('aria-expanded')==='true','Heir mode: the button opens the help');
    const tx=$('heirCard').textContent.replace(/\s+/g,' ');
    ok(/You found a Bitcoin backup\. Take your time\./.test(tx)&&/Nothing here is urgent\./.test(tx)&&/Never give them to anyone/.test(tx)&&/12 or 24 words/.test(tx)&&/multisig/.test(tx)&&/xpub, ypub or zpub/.test(tx)&&/VOIDFORGE BACKUP PLAN sheet/.test(tx)&&/Recovery services/.test(tx)&&/Nobody genuine will ever ask for the words/.test(tx)&&/An estate lawyer needs to know the wallet exists, never the words\./.test(tx),'Heir mode: what each backup is, the steps, and the scam warnings');
    ok(/#heirCard \{ font-size: 18px; line-height: 1\.6; \}/.test(html),'Heir mode: large text');
    [...$('heirCard').querySelectorAll('button')].find(b=>b.textContent==='OPEN THE WALLET DETECTIVE').click(); ok(!$('tp-check').classList.contains('tab-off'),'Heir mode: OPEN THE WALLET DETECTIVE goes to CHECK A BACKUP');
    [...$('heirCard').querySelectorAll('button')].find(b=>b.textContent==='CHECK THE WORDS').click(); ok(!$('tp-check').classList.contains('tab-off'),'Heir mode: CHECK THE WORDS goes to CHECK A BACKUP');
    [...$('heirCard').querySelectorAll('button')].find(b=>b.textContent==='CLOSE').click(); ok($('heirCard').style.display==='none'&&$('heirBtn').getAttribute('aria-expanded')==='false','Heir mode: CLOSE hides it');
    ok(/Family: open voidforge\.html, press I FOUND A BITCOIN BACKUP\./.test(html),'Heir mode: the printed backup plan points family to it');
    { const names=w.eval('DICT').map(e=>e[0]); ok(['Browser extension','Heir mode','Wallet Detective'].every(n=>names.includes(n)),'dictionary: Browser extension, Heir mode and Wallet Detective'); }
    w.close(); })();
  sweep(t);
  await (async()=>{ // fixes release (v2.8.1): the full review's findings and the Test upgrade's. Expected values from @scure and btc-signer.
    const {mnemonicToSeedSync}=require('@scure/bip39'); const {HDKey}=require('@scure/bip32'); const btc=require('@scure/btc-signer');
    const sleep=ms=>new Promise(x=>setTimeout(x,ms)), r=load(); await r.ready(); const $=r.$, w=r.w, AB='abandon '.repeat(11)+'about';
    const root=HDKey.fromMasterSeed(mnemonicToSeedSync(AB,'')), fp=root.fingerprint, H=0x80000000, k=(p)=>root.derive(p).publicKey, att=HDKey.fromMasterSeed(nc.randomBytes(32)).derive('m/0/0').publicKey;
    const PSBT=async(tx,ver=0,words='',net='main')=>{ $('phrase').value=words; $('verifyPass').value=''; $('psbtInput').value=Buffer.from(tx.toPSBT(ver)).toString('base64'); $('psbtNet').value=net; await w.runPsbt(); return {out:$('psbtOut').textContent, st:$('psbtStatus').textContent}; };
    const mk=()=>{ const t=new btc.Transaction(); t.addInput({txid:nc.randomBytes(32), index:0, witnessUtxo:{script:btc.p2wpkh(k("m/84'/0'/0'/0/0")).script, amount:150000n}}); return t; };
    // 1. PSBT change marks (review H1)
    { const t=mk(), path=(c,i)=>[84+H,H,H,c,i];
      t.addOutput({script:btc.p2wpkh(k("m/84'/0'/0'/1/0")).script, amount:50000n, bip32Derivation:[[k("m/84'/0'/0'/1/0"),{fingerprint:fp, path:path(1,0)}]]});
      t.addOutput({script:btc.p2wpkh(att).script, amount:99000n, bip32Derivation:[[att,{fingerprint:fp, path:path(1,1)}]]});
      let x=await PSBT(t);
      ok(!/matches the wallet typed above/.test(x.out)&&(x.out.match(/NOT checked: such a mark can be forged/g)||[]).length===2&&/The change marks were NOT checked/.test(x.out),'PSBT change: without the words, a change mark is called unchecked and forgeable, never "matches the wallet"');
      x=await PSBT(t,0,AB);
      ok(/OUTPUT 0[\s\S]*CHANGE, CHECKED: paid to this wallet's own key at m\/84'\/0'\/0'\/1\/0/.test(x.out)&&/OUTPUT 1[\s\S]*WARNING: marked as this wallet's change \(fingerprint 73c5da0a\), but it is NOT paid to this wallet's key\. Do not sign\./.test(x.out)&&/FAIL  1 output claims to be this wallet's change but is NOT paid/.test(x.out)&&/VERDICT: NO CLEAN VERDICT/.test(x.out),'PSBT change: with the words typed, real change is checked and a forged mark (attacker key, victim fingerprint) fails the verdict'); }
    { const t=mk(); t.addOutput({script:btc.p2wpkh(att).script, amount:99000n, bip32Derivation:[[k("m/84'/0'/0'/1/2"),{fingerprint:fp, path:[84+H,H,H,1,2]}]]});
      const x=await PSBT(t,0,AB); ok(/Do not sign/.test(x.out)&&/NO CLEAN VERDICT/.test(x.out),'PSBT change: the wallet\'s real key record on a single-key output paid elsewhere is a forged mark'); }
    { const t=mk(), kt=root.derive("m/86'/0'/0'/1/0"), xo=kt.publicKey.slice(1);
      t.addOutput({script:btc.p2tr(xo).script, amount:60000n, tapBip32Derivation:[[xo,{hashes:[], der:{fingerprint:fp, path:[86+H,H,H,1,0]}}]]});
      const x=await PSBT(t,0,AB); ok(/CHANGE, CHECKED: paid to this wallet's own key at m\/86'\/0'\/0'\/1\/0/.test(x.out),'PSBT change: Taproot change (tap key record) is checked against the tweaked key'); }
    { const t=mk(), other=HDKey.fromMasterSeed(nc.randomBytes(32)).derive("m/48'/0'/0'/2'/0/0").publicKey, mine=k("m/48'/0'/0'/2'/0/0");
      t.addOutput({script:btc.p2wsh(btc.p2ms(1,[mine,other].sort(Buffer.compare))).script, amount:70000n, bip32Derivation:[[mine,{fingerprint:fp, path:[48+H,H,H,2+H,0,0]}]]});
      const x=await PSBT(t,0,AB); ok(/said to hold this wallet's key at m\/48'\/0'\/0'\/2'\/0\/0 among several keys/.test(x.out)&&/NO CLEAN VERDICT/.test(x.out)&&!/CHANGE, CHECKED/.test(x.out),'PSBT change: a multisig output said to hold this wallet\'s key is not trusted (review of the fixes: a forger can use a script address too)'); }
    // 1b. review of the fixes: script outputs, address types, the compare tool, caveats
    { const t=mk(), mine=k("m/84'/0'/0'/1/3"); t.addOutput({script:btc.p2tr(att.slice(1)).script, amount:99000n, bip32Derivation:[[mine,{fingerprint:fp, path:[84+H,H,H,1,3]}]]});
      const x=await PSBT(t,0,AB); ok(/WARNING/.test(x.out)&&/NO CLEAN VERDICT/.test(x.out)&&!/CHANGE, CHECKED/.test(x.out),'PSBT change: the wallet\'s real key record on someone else\'s Taproot address fails the verdict'); }
    { const t=mk(), mine=k("m/84'/0'/0'/1/3"); t.addOutput({script:btc.p2wsh(btc.p2ms(1,[mine,att].sort(Buffer.compare))).script, amount:99000n, bip32Derivation:[[mine,{fingerprint:fp, path:[84+H,H,H,1,3]}]]});
      const x=await PSBT(t,0,AB); ok(/said to hold this wallet's key at m\/84'\/0'\/0'\/1\/3 among several keys/.test(x.out)&&/FAIL  1 output claims to hold this wallet's key among several keys/.test(x.out)&&/NO CLEAN VERDICT/.test(x.out),'PSBT change: a script (multisig) output said to hold this wallet\'s key is not trusted and fails the verdict'); }
    { const t=mk(), mine=k("m/84'/0'/0'/1/4"); t.addOutput({script:btc.p2pkh(mine).script, amount:99000n, bip32Derivation:[[mine,{fingerprint:fp, path:[84+H,H,H,1,4]}]]});
      const x=await PSBT(t,0,AB); ok(/paid to this wallet's key at m\/84'\/0'\/0'\/1\/4, but as Legacy/.test(x.out)&&/NO CLEAN VERDICT/.test(x.out)&&!/CHANGE, CHECKED/.test(x.out),'PSBT change: the wallet\'s key paid as an address type its path does not watch (BIP84 key, legacy address) fails'); }
    { const t=mk(); t.addOutput({script:btc.p2wpkh(att).script, amount:149000n, bip32Derivation:[[att,{fingerprint:0xdeadbeef, path:[84+H,H,H,1,0]}]]});
      const x=await PSBT(t,0,AB); ok(/VERDICT: no problems found/.test(x.out)&&/Not every change mark could be checked/.test(x.out),'PSBT change: a clean verdict says when a mark of another wallet was not checked'); }
    { const base=()=>{ const t=new btc.Transaction(); t.addInput({txid:'22'.repeat(32), index:0, witnessUtxo:{script:btc.p2wpkh(k("m/84'/0'/0'/0/0")).script, amount:150000n}, sequence:0xfffffffd}); return t; };
      const A=base(); A.addOutputAddress(btc.p2wpkh(k("m/84'/0'/0'/0/9")).address,100000n); A.addOutput({script:btc.p2wpkh(att).script, amount:49000n});
      const B=base(); B.addOutputAddress(btc.p2wpkh(k("m/84'/0'/0'/0/9")).address,100000n); B.addOutput({script:btc.p2wpkh(att).script, amount:48000n, bip32Derivation:[[att,{fingerprint:fp, path:[84+H,H,H,1,1]}]]});
      $('phrase').value=AB; $('verifyPass').value=''; $('cmpA').value=Buffer.from(A.toPSBT(0)).toString('base64'); $('cmpB').value=Buffer.from(B.toPSBT(0)).toString('base64'); $('cmpNet').value='main'; await w.runCompare();
      const o=$('cmpOut').textContent; ok(/FAIL  The output that got smaller .* is marked as this wallet's change, but it is NOT paid to this wallet's key\. Do not sign\./.test(o)&&!/it looks like a plain fee bump/.test(o)&&/does NOT look like a plain fee bump/.test(o),'compare: a forged change mark on the output that shrank fails, and it is not called a plain fee bump'); }
    // the full previous transaction is checked even when a witness UTXO is there too; duplicate records and impossible locktimes are refused
    { const prev=new btc.Transaction({allowUnknownOutputs:true}); prev.addOutput({script:btc.p2wpkh(k("m/84'/0'/0'/0/0")).script, amount:300000n}); prev.addInput({txid:nc.randomBytes(32), index:0, finalScriptSig:new Uint8Array([0])});
      const t=new btc.Transaction(); t.addInput({txid:prev.id, index:0, nonWitnessUtxo:prev.toBytes(true,false), witnessUtxo:{script:btc.p2wpkh(k("m/84'/0'/0'/0/0")).script, amount:300000n}}); t.addOutputAddress(btc.p2wpkh(att).address,100000n);
      const bad=Buffer.from(t.toPSBT(0)), amt=Buffer.alloc(8); amt.writeBigUInt64LE(300000n); bad.writeBigUInt64LE(900000n, bad.indexOf(amt));
      const res=await w.inspectPsbt(new Uint8Array(bad),'main'); ok(res.ins[0].prevMismatch===true&&res.ins[0].amount===null,'PSBT: a wrong full previous transaction is caught even when a witness UTXO is also given'); }
    { const t=mk(); t.addOutputAddress(btc.p2wpkh(att).address,100000n); const p=Buffer.from(t.toPSBT(0)), end=p.length-1, rec=Buffer.from([0x01,0x00,0x01,0x51]);   // the same record twice in the last output's map
      let msg=''; try { await w.inspectPsbt(new Uint8Array(Buffer.concat([p.slice(0,end), rec, rec, p.slice(end)])),'main'); } catch(e) { msg=e.message; }
      let once=''; try { await w.inspectPsbt(new Uint8Array(Buffer.concat([p.slice(0,end), rec, p.slice(end)])),'main'); } catch(e) { once=e.message; }
      ok(/same record twice/.test(msg)&&once==='','PSBT: a record that appears twice is refused, as wallets refuse it'); }
    { let t; try { t=new btc.Transaction({PSBTVersion:2}); t.addInput({txid:nc.randomBytes(32), index:0, witnessUtxo:{script:btc.p2wpkh(att).script, amount:150000n}, requiredHeightLocktime:800000}); t.addInput({txid:nc.randomBytes(32), index:1, witnessUtxo:{script:btc.p2wpkh(att).script, amount:150000n}, requiredTimeLocktime:1700000000});
      t.addOutputAddress(btc.p2wpkh(att).address,100000n); } catch(e) { t=null; } let bytes=null, msg=''; try { bytes=t&&t.toPSBT(2); } catch(e) { bytes=null; }
      if(bytes){ try { await w.inspectPsbt(bytes,'main'); } catch(e) { msg=e.message; } ok(/cannot be signed: one input needs a block-height locktime and another a time locktime/.test(msg),'PSBT version 2: inputs that need a height and a time locktime are refused (no transaction can meet both)'); }
      else ok(true,'PSBT version 2: btc-signer itself refuses mixed locktime requirements'); }
    { const t=mk(); t.addOutputAddress(btc.p2wpkh(att).address, 100000n);
      const v0=await w.inspectPsbt(t.toPSBT(0),'main'), v2=await w.inspectPsbt(t.toPSBT(2),'main');
      ok(v2.psbtVersion===2&&v2.txid===v0.txid&&v2.fee===v0.fee&&v2.outs[0].address===v0.outs[0].address&&v2.ins[0].txid===v0.ins[0].txid,'PSBT version 2: read like version 0 (outputs, fee, inputs, transaction ID; built with btc-signer)');
      const x=await PSBT(t,2); ok(/^PSBT version 2\. Transaction version 2/.test(x.out)&&/FEE: 0\.00050000 BTC \(50000 sats\)/.test(x.out),'PSBT version 2: the report says so and shows the fee'); }
    // 3. the previous transaction must be the one the input spends (review L3)
    { const prev=new btc.Transaction({allowUnknownOutputs:true}); prev.addOutputAddress('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',300000n); prev.addInput({txid:nc.randomBytes(32), index:0, finalScriptSig:new Uint8Array([0])});
      const t=new btc.Transaction(); t.addInput({txid:prev.id, index:0, nonWitnessUtxo:prev.toBytes(true,false)}); t.addOutputAddress(btc.p2wpkh(att).address, 100000n);
      const good=t.toPSBT(0), bad=Buffer.from(good), amt=Buffer.alloc(8); amt.writeBigUInt64LE(300000n); const at=bad.indexOf(amt); Buffer.alloc(8).fill(0).copy(bad,at); bad.writeBigUInt64LE(900000n,at);   // the attacker raises the previous amount
      const okRes=await w.inspectPsbt(good,'main'), res=await w.inspectPsbt(new Uint8Array(bad),'main');
      $('phrase').value=''; $('psbtInput').value=bad.toString('base64'); $('psbtNet').value='main'; await w.runPsbt(); const out=$('psbtOut').textContent;
      ok(at>0&&okRes.ins[0].amount===300000n&&res.ins[0].amount===null&&res.ins[0].prevMismatch===true&&/NOT the one being spent/.test(out)&&/NO CLEAN VERDICT/.test(out),'PSBT: a previous transaction changed after the fact gives no amount and fails the verdict (the honest one is read)'); }
    // 4. the self-test gate covers signed messages and multisig (review M1)
    { const t2=load(); ok(t2.$('sigBtn').disabled&&t2.$('msStartBtn').disabled,'gate: VERIFY SIGNATURE and START MULTISIG SETUP are off until the self-test passes'); await t2.ready();
      ok(!t2.$('sigBtn').disabled&&!t2.$('msStartBtn').disabled,'gate: they are on once it passes');
      t2.w.eval('selfTestState = "fail"'); t2.st.alerts.length=0; await t2.w.verifyMessageUi(); t2.w.msStart();
      ok(t2.st.alerts.length===2&&!t2.$('sigStatus').textContent,'gate: with a failed self-test, signed-message checking and multisig setup refuse'); t2.w.close(); }
    // 5. no old result after an edit (review M2, M3)
    { $('phrase').value=AB; $('verifyPass').value=''; $('checkAddr').value=k("m/84'/0'/0'/0/0")&&btc.p2wpkh(k("m/84'/0'/0'/0/0")).address; $('checkAcct').value='0'; await w.checkAddress(5);
      const was=$('addrCheckStatus').textContent; $('checkAddr').value='bc1qxyz'; $('checkAddr').dispatchEvent(new w.Event('input'));
      ok(/^FOUND/.test(was)&&$('addrCheckStatus').textContent==='','Is this address mine: editing the address clears the old FOUND');
      $('verifyRecorded').value='73c5da0a'; await w.verify(); const m=$('verifyMatch').textContent; $('verifyRecorded').value='deadbeef'; $('verifyRecorded').dispatchEvent(new w.Event('input'));
      ok(/^MATCH/.test(m)&&$('verifyMatch').textContent==='','VERIFY: editing the recorded value clears the old MATCH'); }
    // 6. practice mode leaves no address of the old network (review M4)
    { $('verifyRecorded').value=''; await w.verify(); $('childApp').value='words'; await w.deriveChild(); $('dcDev').value='seedsigner'; $('dcLen').value='12'; $('dcRolls').value=w.eval('DC_CARD_ROLLS').slice(0,50); await w.dcCheck();
      const before=[$('verifyStatus').textContent,$('childOut').textContent,$('dcOut').textContent].map(s=>/bc1q/.test(s));
      w.practiceMode(true); await sleep(50);
      ok(before.every(Boolean)&&!/bc1q/.test($('verifyStatus').textContent)&&/press VERIFY again/.test($('verifyStatus').textContent)&&!$('childOut').textContent&&!$('dcOut').textContent,'practice mode: VERIFY\'s lines, the child seed and the device dice check of the old network are cleared');
      w.practiceMode(false); }
    // 7. testnet values in VERIFY's recorded box (review L4)
    { const tpub=HDKey.fromMasterSeed(mnemonicToSeedSync(AB,''),{private:0x04358394,public:0x043587cf}).derive("m/44'/1'/0'").publicExtendedKey, tb=btc.p2tr(root.derive("m/86'/1'/0'/0/2").publicKey.slice(1),undefined,btc.TEST_NETWORK).address;
      $('verifyRecorded').value=tpub; await w.verify(); const a=$('verifyMatch').textContent; $('verifyRecorded').value=tb; await w.verify(); const b=$('verifyMatch').textContent;
      ok(/^MATCH \(without passphrase\)/.test(a)&&/account key at m\/44'\/1'\/0'/.test(a)&&/^MATCH \(without passphrase\)/.test(b),'VERIFY: a tpub and a tb1p address from the wallet app are recognized and matched on the test network'); $('verifyRecorded').value=''; }
    // 8. Uprv is a private key (review L2), and Coldcard refuses lopsided rolls (Test upgrade, vendor source)
    { const uprv=await w.base58check(Uint8Array.from([0x02,0x42,0x85,0xb5,...new Uint8Array(74)])); ok(/^Uprv/.test(uprv)&&(await w.descriptorHasSecret('wsh(sortedmulti(2,'+uprv+'))'))===true,'keys: Uprv (SLIP132) is known as a private key'); }
    { const sk='1'.repeat(20)+'23456'.repeat(6); $('dcDev').value='coldcard'; $('dcLen').value='12'; $('dcRolls').value=sk; await w.dcCheck();
      ok(/^Coldcard refuses these rolls: 1 is 20 of the 50 rolls, more than 30%/.test($('dcStatus').textContent)&&!$('dcOut').textContent,'device dice: Coldcard refuses rolls where one face is over 30%, as its code does');
      $('dcDev').value='keystone'; await w.dcCheck(); ok(/Keystone will warn that they look uneven; it still makes the words/.test($('dcStatus').textContent)&&!!$('dcOut').textContent,'device dice: Keystone warns about such rolls but still makes the words'); }
    // 9. FORGE: a roll typed while the words are worked out clears them (review L1); the words come from memory, not the screen (L6)
    { w.clearAll(); w.showTab('make'); const e=w.document.querySelector('input[name=words][value="12"]'); e.checked=true; e.onchange();
      $('rolls').value='3'.repeat(25)+'4'.repeat(25); $('rolls').oninput(); const g=w.generate(); $('rolls').value+='5'; await g;
      ok(!w.hasSeed()&&/You changed the rolls/.test($('genResult').textContent),'FORGE: a roll typed while the words are worked out clears them at once');
      $('rolls').value='3'.repeat(25)+'4'.repeat(25); $('rolls').oninput(); await w.generate(); const words=$('genResult').textContent.split('\n')[0];
      $('genResult').firstChild.textContent='zoo '.repeat(11)+'wrong'; ok(w.printSrc('make').words.join(' ')===words,'seed words: printing uses the words in memory, not text changed on the screen'); }
    // 10. CLEAR ALL also empties the public boxes (review L5), and the wipe leaves no rolls or passphrase in memory (Test upgrade, memory test)
    { for(const id of ['psbtInput','cmpA','cmpB','sigAddr','sigMsg','sigSig','reuseIn','wpIn','payA','payB','dlPaste']) $(id).value='x';
      $('passphrase').value=$('passphrase2').value='Secret1'; await w.generate(); w.clearAll(); await sleep(20);
      ok(['psbtInput','cmpA','cmpB','sigAddr','sigMsg','sigSig','reuseIn','wpIn','payA','payB','dlPaste'].every(id=>$(id).value===''),'CLEAR ALL empties the transaction, signature, descriptor, pay-check and download-check boxes');
      ok(w.eval('seedSig')===null&&w.eval('passKey')===null&&w.eval('exCtx')===null&&w.eval('madeMnemonic')==='','CLEAR ALL leaves no rolls, passphrase or words in the page\'s state'); }
    r.w.close(); })();
  // v2.9.0: Cards & hex (expected words from @scure and Node's SHA-256; same text and method as Ian Coleman's BIP39 tool)
  sweep(t);
  await (async()=>{ const {entropyToMnemonic}=require('@scure/bip39'); const {wordlist}=require('@scure/bip39/wordlists/english');
    const r=load(); await r.ready(); const w=r.w, $=r.$; const SU={C:'♣',D:'♦',H:'♥',S:'♠'};
    const cs=t=>t.split(' ').map(x=>x[0]+SU[x[1]]).join(' '), expC=(t,n)=>entropyToMnemonic(nc.createHash('sha256').update(cs(t),'utf8').digest().subarray(0,n===24?32:16),wordlist);
    const C25='KS 3D 9H AC TC 5S JD 2H 8C QS 4D 7H 6C AH TS 9D 3C KH 5D JS 2S 8H QC 4H 7S', first=()=>$('genResult').textContent.split('\n')[0];
    eq(expC('AS 2C TD',12),'embody only exact pride episode winter estate perfect security often scout tiger','cards: the research vector (A♠ 2♣ T♦, 12 words) agrees with @scure');
    w.setMethod('cards'); ok(w.document.body.classList.contains('m-cards')&&$('cdBox').open,'cards: the Cards & hex tab opens its box');
    $('cdCards').value=C25.split(' ').slice(0,24).join(' '); w.cdUpdate(); ok($('cdBtn').disabled&&/^24 cards so far\. 1 more to go\./.test($('cdCount').textContent),'cards: 24 cards are not enough for 12 words (127 bits)');
    $('cdCards').value=C25.toLowerCase().replace(/t/g,'10'); w.cdUpdate(); ok(!$('cdBtn').disabled,'cards: 25 cards, lower case and 10 for T, are enough');
    await w.cdGenerate(); eq(first(),expC(C25,12),'cards: FORGE SEED gives the words of SHA-256 of A♠ 2♣ ... text');
    w.downloadSeed(); const dl=r.st.blob?await blobText(w,r.st.blob):''; ok(/Input: Playing cards: K♠ 3♦ 9♥ A♣ T♣/.test(dl),'cards: DOWNLOAD names the cards as the input');
    ok(/^Made from: 25 playing cards/.test(w.seedSummary().lines[1]),'cards: the summary sheet says 25 playing cards');
    $('cdCards').value='KS QH XZ'; w.cdUpdate(); ok(/“XZ” is not a card/.test($('cdMsg').textContent)&&!w.hasSeed(),'cards: a word that is not a card is named, and the old seed is cleared');
    $('cdCards').value=''; $('cdHex').value='00112233445566778899aabbccddeeff'; w.cdUpdate(); await w.cdHexGenerate();
    eq(first(),entropyToMnemonic(Buffer.from('00112233445566778899aabbccddeeff','hex'),wordlist),'hex: 32 hex digits are the entropy itself (raw, as Ian Coleman\'s tool with Hexadecimal)');
    $('cdHex').value='00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'; w.cdUpdate(); ok(/choose 24 words above/.test($('cdMsg').textContent),'hex: 64 digits with 12 words chosen ask for 24 words');
    $('cdHex').value='ab'; w.clearAll(); ok($('cdCards').value===''&&$('cdHex').value==='','CLEAR ALL empties the cards and hex boxes');
    ok(/\["Card entropy"/.test(html)&&/\["Hex entropy"/.test(html),'dictionary: Card entropy and Hex entropy');
    r.w.close(); })();
  // v2.10.0: signature checks in Inspect a transaction and Compare two transactions (PSBTs signed by @scure/btc-signer)
  sweep(t);
  await (async()=>{ const btc=require('@scure/btc-signer'); const {secp256k1}=require('@noble/curves/secp256k1');
    const r=load(); await r.ready(); const w=r.w, $=r.$, sleep=ms=>new Promise(z=>setTimeout(z,ms));
    const k=nc.createHash('sha256').update('v2.10.0 unit').digest(), pub=secp256k1.getPublicKey(k,true), p=btc.p2wpkh(pub);
    const mk=()=>{ const tx=new btc.Transaction(); tx.addInput({txid:new Uint8Array(32).fill(9),index:0,witnessUtxo:{script:p.script,amount:100000n}}); tx.addOutput({script:btc.p2wpkh(secp256k1.getPublicKey(nc.createHash('sha256').update('pay').digest(),true)).script,amount:99000n}); return tx; };
    const t1=mk(); t1.signIdx(k,0); const part=Buffer.from(t1.toPSBT(0)).toString('base64');
    const inspect=async(v)=>{ $('psbtInput').value=v; $('psbtNet').value='main'; await w.runPsbt(); return $('psbtOut').textContent; };
    let out=await inspect(part);
    ok(/\n   signatures: VALID: the signature matches this transaction and the coin it spends\./.test(out)&&/OK    Every signature found was checked and is valid \(1 signature\)\./.test(out),'signature check: a partly signed PSBT says VALID for its input and OK in the checks');
    ok(/VERDICT: no problems found/.test(out),'signature check: a valid signature and nothing else wrong give a clean verdict');
    const sp=[...$('psbtOut').querySelectorAll('span')]; ok(sp.length===1&&sp[0].className==='sv-ok'&&sp[0].textContent==='VALID','signature check: the word VALID is shown in green (class sv-ok)');
    // one byte of the signature changed: INVALID, red, a FAIL that blocks the verdict
    { const t=btc.Transaction.fromPSBT(t1.toPSBT(0)), ps=t.getInput(0).partialSig[0], s2=Uint8Array.from(ps[1]); s2[10]^=1; t.updateInput(0,{partialSig:undefined},true); t.updateInput(0,{partialSig:[[ps[0],s2]]},true);
      out=await inspect(Buffer.from(t.toPSBT(0)).toString('base64'));
      ok(/signatures: INVALID\. Do not broadcast: this signature does not match/.test(out)&&/FAIL  INVALID SIGNATURE on input 0\. Do not broadcast: this signature does not match\./.test(out)&&/NO CLEAN VERDICT/.test(out),'signature check: a changed signature is INVALID, with a FAIL and NO CLEAN VERDICT');
      ok($('psbtOut').querySelector('span.sv-bad').textContent==='INVALID','signature check: the word INVALID is shown in red (class sv-bad)'); }
    // the coin described two ways: a wrong amount could be hidden
    { const fund=btc.RawTx.encode({version:2,segwitFlag:false,inputs:[{txid:new Uint8Array(32).fill(1),index:0,finalScriptSig:new Uint8Array(0),sequence:0xffffffff}],outputs:[{amount:100000n,script:p.script}],witnesses:[],lockTime:0});
      const id=nc.createHash('sha256').update(nc.createHash('sha256').update(fund).digest()).digest().reverse();
      const t=new btc.Transaction(); t.addInput({txid:id,index:0,witnessUtxo:{script:p.script,amount:100001n}}); t.addOutput({script:p.script,amount:90000n}); t.signIdx(k,0);
      // btc-signer refuses to write a PSBT whose two coin records disagree, so this one is written by hand: the full previous
      // transaction (100000 sats) and a short record that says 100001 sats, with the signature made for 100001
      const vi=n=>n<0xfd?[n]:[0xfd,n&255,n>>8], kv=(k2,v)=>[...vi(k2.length),...k2,...vi(v.length),...v], [ppub,psig]=t.getInput(0).partialSig[0], wu=[0xa1,0x86,1,0,0,0,0,0,p.script.length,...p.script];
      out=await inspect(Buffer.from(Uint8Array.from([0x70,0x73,0x62,0x74,0xff,...kv([0],t.unsignedTx),0,...kv([0],fund),...kv([1],wu),...kv([2,...ppub],psig),0,0])).toString('base64'));
      ok(/FAIL  Input 0: the PSBT describes the coin being spent in two different ways \(amount or script\)\. A wrong amount could be hidden: do not sign\./.test(out)&&/signatures: NOT CHECKED: the PSBT describes the coin it spends in two different ways/.test(out),'signature check: a short coin record that disagrees with the full previous transaction is caught (a wrong amount could be hidden)'); }
    // a raw signed transaction alone: NOT CHECKED in gray; with the PSBT it came from in Compare: VALID
    const t2=mk(); t2.signIdx(k,0); t2.finalize(); const raw=t2.hex;
    out=await inspect(raw);
    ok(/signatures: NOT CHECKED: cannot check without the coins it spends\./.test(out)&&/NOTE  The signatures of input 0 were NOT CHECKED .*a raw transaction does not carry the coins it spends/.test(out)&&$('psbtOut').querySelector('span.sv-na').textContent==='NOT CHECKED','signature check: a raw transaction alone is NOT CHECKED (gray, with why)');
    $('cmpA').value=part; $('cmpB').value=raw; $('cmpNet').value='main'; await w.runCompare(); const c=$('cmpOut').textContent;
    ok(/  signatures \(first, input 0\): VALID/.test(c)&&/  signatures \(second, input 0\): VALID/.test(c)&&$('cmpOut').querySelectorAll('span.sv-ok').length===2,'signature check: Compare checks the raw transaction with the coin named in the PSBT');
    { const t=btc.Transaction.fromRaw(t2.extract()), o=t.getOutput(0); t.updateOutput(0,{amount:o.amount-1n},true); $('cmpB').value=t.hex; await w.runCompare();
      ok(/  signatures \(second, input 0\): INVALID/.test($('cmpOut').textContent)&&/^INVALID SIGNATURE FOUND: do not broadcast\. /m.test($('cmpOut').textContent),'signature check: Compare says INVALID SIGNATURE FOUND when the second transaction\'s signature does not match'); }
    // a stale result is never shown: the input changes while the check runs
    { $('psbtInput').value=part; const run=w.runPsbt(); await sleep(0); $('psbtInput').value='x'; $('psbtInput').dispatchEvent(new w.Event('input')); await run;
      ok($('psbtOut').textContent===''&&$('psbtOut').style.display==='none'&&!/VALID/.test($('psbtStatus').textContent),'signature check: editing the PSBT while signatures are checked drops the old result'); }
    { $('cmpA').value=part; $('cmpB').value=raw; const run=w.runCompare(); await sleep(0); $('cmpB').value='y'; $('cmpB').dispatchEvent(new w.Event('input')); await run;
      ok($('cmpOut').textContent==='','signature check: editing Compare while signatures are checked drops the old result'); }
    // an unsigned PSBT: no signature line, no signature check line
    out=await inspect(Buffer.from(mk().toPSBT(0)).toString('base64')); ok(!/signatures:/.test(out)&&!/Every signature found/.test(out),'signature check: an unsigned PSBT gets no signature lines');
    // the self-test gate and CLEAR
    w.setGate('fail','SELF-TEST FAILED','bad'); $('psbtOut').textContent=''; $('psbtInput').value=part; await w.runPsbt(); ok($('psbtOut').textContent==='','signature check: nothing runs before the self-test passes'); w.setGate('pass','SELF-TEST PASSED','good');
    await inspect(part); w.clearPsbt(true); ok($('psbtOut').textContent===''&&$('psbtInput').value==='','signature check: CLEAR empties the result and the box');
    { // review fix: a legacy (P2PKH) signature with only the short coin record is valid, but its amount is not covered: said so
      const priv=new Uint8Array(32); priv[31]=77; const pub=secp256k1.getPublicKey(priv,true), sp=btc.p2pkh(pub), wpk=btc.p2wpkh(pub);
      const prev=new btc.Transaction({allowLegacyWitnessUtxo:true}); prev.addInput({txid:new Uint8Array(32).fill(0xbb),index:0}); prev.addOutput({script:sp.script,amount:50000n}); const prevBytes=prev.toBytes(true,false);
      const mkL=(full)=>{ const q=new btc.Transaction({allowLegacyWitnessUtxo:true}); q.addInput(full?{txid:prev.id,index:0,nonWitnessUtxo:prevBytes}:{txid:prev.id,index:0,witnessUtxo:{script:sp.script,amount:50000n}}); q.addOutput({script:wpk.script,amount:40000n}); q.signIdx(priv,0); return q.toPSBT(0); };
      const chk=async(b)=>{ const res=await w.inspectPsbt(w.Uint8Array.from(b),'main'); await w.psbtSigCheck(res); return res.ins[0].sv; };
      const R1=await chk(mkL(false)), R2=await chk(mkL(true));
      ok(R1.state==='valid'&&R1.amountOpen&&/does not cover the amount/.test(w.svText(R1))&&R2.state==='valid'&&!R2.amountOpen,'signature check: a legacy signature with only the short coin record is VALID but says its amount is not checked (review fix)'); }
    ok(/whether each signature is <b>valid<\/b>/.test(html)&&/\["Signature hash \(digest\)"/.test(html)&&/\["Low-S rule"/.test(html)&&/\["Strict DER"/.test(html)&&/\["NULLDUMMY"/.test(html)&&/\["BIP143"/.test(html),'signature check: the help text and the dictionary (Signature hash, Low-S rule, Strict DER, NULLDUMMY, BIP143)');
    r.w.close(); })();
  // v2.10.0: Make new SLIP39 shares from dice (expected wallet from @scure/bip32 and btc-signer; the words themselves are checked
  // against the reference implementation in tests/slip39.test.mjs)
  sweep(t);
  await (async()=>{ const {HDKey}=require('@scure/bip32'); const btc=require('@scure/btc-signer');
    const r=load(); await r.ready(); const w=r.w, $=r.$, d=r.d;
    const mode=m=>{ d.querySelector('input[name=s39Mode][value='+m+']').checked=true; w.s39ModeChange(); };
    const R='123456'.repeat(9), ms=nc.createHash('sha256').update(R).digest().subarray(0,16), root=HDKey.fromMasterSeed(ms);
    const at=(p)=>btc.p2wpkh(root.derive(p).publicKey).address;
    ok($('s39MakePanel').style.display==='none'&&$('s39CombinePanel').style.display===''&&d.querySelector('input[name=s39Mode]:checked').value==='combine','SLIP39 make: the box opens on Check or combine shares');
    mode('make'); ok($('s39MakePanel').style.display===''&&$('s39CombinePanel').style.display==='none','SLIP39 make: choosing Make new SLIP39 shares from dice shows its panel');
    ok(!$('s39mBtn').disabled,'SLIP39 make: MAKE THE SHARES is on once the self-test passes');
    w.setGate('fail','SELF-TEST FAILED','bad'); ok($('s39mBtn').disabled,'SLIP39 make: a failed self-test turns MAKE THE SHARES off'); w.setGate('pass','SELF-TEST PASSED','good');
    w.eval('selfTestState = "fail"'); $('s39mRolls').value=R; await w.s39mUi(); w.eval('selfTestState = "pass"'); ok($('s39mOut').textContent===''&&$('s39mStatus').textContent==='','SLIP39 make: nothing is made while the self-test has not passed');
    ok($('s39mT').value==='2'&&$('s39mN').value==='3'&&$('s39mBits').value==='128'&&$('s39mExt').checked&&$('s39mExp').value==='1'&&!$('s39mAdv').checked,'SLIP39 make: defaults are 2 of 3, 20 words, extendable, iteration exponent 1');
    ok(/This cannot turn seed words you already have into shares\./.test($('s39MakePanel').textContent)&&/not the same wallet as BIP39 words/.test($('s39MakePanel').textContent),'SLIP39 make: says in one line that it does not convert existing words');
    ok(/it is not a BIP39 passphrase/.test($('s39MakePanel').textContent),'SLIP39 make: explains the SLIP39 passphrase is not a BIP39 passphrase');
    ok(!/never makes them/.test(html)&&/It can also make a new wallet as SLIP39 shares from your own dice rolls/.test(html),'SLIP39: the box no longer says it never makes shares');
    $('s39mRolls').value=R.slice(0,49); await w.s39mUi(); ok(/^Not made: Roll a die at least 50 times/.test($('s39mStatus').textContent)&&$('s39mOut').style.display==='none','SLIP39 make: 49 rolls are not enough');
    $('s39mRolls').value=R; $('s39mPass').value='abc'; $('s39mPass2').value='abd'; await w.s39mUi(); ok(/the two passphrases do not match/.test($('s39mStatus').textContent)&&!w.eval('s39mCtx'),'SLIP39 make: the two passphrase boxes must match');
    $('s39mPass').value=''; $('s39mPass2').value=''; await w.s39mUi();
    const want=await w.slip39Make(R,{bits:128,groupThreshold:1,groups:[[2,3]],passphrase:''}), out=$('s39mOut').textContent, info=$('s39mInfo').textContent;
    const shown=out.split('\n\n').map(b=>b.split('\n').slice(1).join(' ').replace(/\s*\d+\.\s+/g,' ').trim());
    ok(shown.length===3&&shown.join('|')===want.groups[0].join('|')&&/^SHARE 1 OF 3  \(Any 2 of the 3 shares open the wallet; fewer reveal nothing\.\)\n 1\. clogs /.test(out),'SLIP39 make: the 3 shares are shown, numbered, as slip39Make makes them');
    const fp=root.fingerprint.toString(16).padStart(8,'0');
    ok(new RegExp('^3 shares made from your 54 rolls and checked: .* master fingerprint '+fp+'\\. Any 2 of the 3 shares open the wallet; fewer reveal nothing\\. Every share of this backup begins with “clogs premium”\\. No passphrase\\.').test($('s39mStatus').textContent)&&/status ok/.test($('s39mStatus').className),'SLIP39 make: the status names the fingerprint (from @scure), the rule and the first two words');
    const rec=Array.from({length:10},(_,i)=>"0/"+i+(i<10?" ".repeat(5-String("0/"+i).length):"")+at("m/84'/0'/0'/0/"+i)).join('\n'), chg=Array.from({length:10},(_,i)=>"1/"+i+"  "+at("m/84'/0'/0'/1/"+i)).join('\n');
    ok(info.startsWith('Master fingerprint: '+fp+'\n\nFirst 10 receive addresses (native SegWit, m/84\'/0\'/0\'/0/0 to 0/9):\n'+rec+'\n\nFirst 10 change addresses (native SegWit, m/84\'/0\'/0\'/1/0 to 1/9):\n'+chg+'\n\nFirst Taproot address (m/86\'/0\'/0\'/0/0): '+btc.p2tr(root.derive("m/86'/0'/0'/0/0").publicKey.slice(1)).address),'SLIP39 make: the fingerprint, 10 receive and 10 change addresses and the first Taproot address equal @scure (master secret as the BIP32 seed)');
    ok(!d.querySelector('#s39MakePanel button[onclick*="opy"]')&&/user-select:\s*none/.test($('s39mOut').getAttribute('style'))&&/SECRET/.test(d.querySelector('#s39Box summary').textContent),'SLIP39 make: the shares are SECRET, not selectable and have no COPY button');
    ok($('s39mPrintRow').style.display===''&&d.querySelector('#s39mPrintRow button').className==='secondary small'&&d.querySelector('#s39mPrintRow button').textContent==='PRINT THE SHARES'&&$('s39mBtn').className==='','SLIP39 make: MAKE THE SHARES is the gold main button, PRINT THE SHARES gray');
    const c0=r.st.confirms, p0=r.st.printed; w.printS39Shares(); const pc=d.querySelectorAll('#printOnly .ps-part').length, ptxt=r.st.printHTML||'';
    ok(r.st.confirms===c0+1&&r.st.printed===p0+1&&/^VOIDFORGE SLIP39 SHARE 1 OF 3SECRET\. One share of a SLIP39 \(Shamir\) backup\. Any 2 of the 3 shares open the wallet/.test(ptxt)&&/Master fingerprint of the wallet: /.test(ptxt)&&/Passphrase: none/.test(ptxt),'SLIP39 make: PRINT asks first, then prints the shares');
    ok(pc===3&&r.st.printCells.length===60,'SLIP39 make: one sheet per share (3 sheets, 20 words each)'); w.dispatchEvent(new w.Event('afterprint'));
    { const t2=load({confirm:false}); await t2.ready(); t2.d.querySelector('input[name=s39Mode][value=make]').checked=true; t2.w.s39ModeChange(); t2.$('s39mRolls').value=R; await t2.w.s39mUi(); const n0=t2.st.printed; t2.w.printS39Shares(); ok(t2.st.printed===n0&&t2.st.confirms===1,'SLIP39 make: saying no to the question prints nothing'); t2.w.close(); }
    for(const [id,ev] of [['s39mRolls','input'],['s39mPass','input'],['s39mPass2','input'],['s39mGroups','input'],['s39mBits','change'],['s39mT','change'],['s39mN','change'],['s39mGT','change'],['s39mExt','change'],['s39mExp','change']]){
      await w.s39mUi(); $(id).dispatchEvent(new w.Event(ev)); ok($('s39mOut').textContent===''&&$('s39mInfo').textContent===''&&$('s39mPrintRow').style.display==='none'&&!w.eval('s39mCtx'),'SLIP39 make: changing '+id+' clears the shares on screen'); }
    $('s39mAdv').checked=true; w.s39mAdvChange(); ok($('s39mAdvPanel').style.display===''&&$('s39mT').style.display==='none','SLIP39 make: Advanced: groups shows the group boxes');
    $('s39mGroups').value='1 of 1\n3 of 5\n2/6'; $('s39mGT').value='2'; $('s39mPass').value='TREZOR'; $('s39mPass2').value='TREZOR'; await w.s39mUi();
    const g=await w.slip39Make(R,{bits:128,groupThreshold:2,groups:[[1,1],[3,5],[2,6]],passphrase:'TREZOR'});
    ok(/^12 shares made/.test($('s39mStatus').textContent)&&/The wallet opens with 2 of the 3 groups/.test($('s39mStatus').textContent)&&/only with the passphrase you typed/.test($('s39mStatus').textContent)&&/GROUP 2 OF 3, SHARE 1 OF 5  \(Group 2 needs any 3 of its 5 shares\. The wallet opens with 2 of the 3 groups complete; fewer reveal nothing\.\)/.test($('s39mOut').textContent)&&$('s39mOut').textContent.split('\n\n').map(b=>b.split('\n').slice(1).join(' ').replace(/\s*\d+\.\s+/g,' ').trim()).join('|')===g.groups.flat().join('|'),'SLIP39 make: groups (1 of 1, 3 of 5, 2 of 6; 2 groups needed) with a passphrase');
    const fc=await w.slip39Combine([g.groups[2][4],g.groups[0][0],g.groups[2][1]],'TREZOR'); ok(fc.ok&&Buffer.from(fc.masterSecret).equals(ms),'SLIP39 make: those shares combine in CHECK AND COMBINE to the same secret');
    w.printS39Shares(); ok(d.querySelectorAll('#printOnly .ps-part').length===12&&/Passphrase: YES \(not printed here\)/.test(r.st.printHTML)&&!/TREZOR/.test(r.st.printHTML),'SLIP39 make: 12 sheets, and the passphrase is never printed'); w.dispatchEvent(new w.Event('afterprint'));
    $('s39mGroups').value='2 of 3\nthree of five'; await w.s39mUi(); ok(/^Not made: Group 2 \("three of five"\) is not written as/.test($('s39mStatus').textContent),'SLIP39 make: a group that is not "T of N" is named');
    $('s39mGroups').value='1 of 2'; $('s39mGT').value='1'; await w.s39mUi(); ok(/with 1 share needed, make just 1 share \(1 of 1\)/.test($('s39mStatus').textContent),'SLIP39 make: 1 of 2 is refused, as SLIP39 requires');
    $('s39mAdv').checked=false; w.s39mAdvChange(); $('s39mT').value='1'; $('s39mN').value='1'; $('s39mBits').value='256'; $('s39mRolls').value='5'.repeat(99); $('s39mPass').value=''; $('s39mPass2').value=''; await w.s39mUi();
    ok(/^1 share made from your 99 rolls/.test($('s39mStatus').textContent)&&/This one share opens the wallet on its own, like seed words\./.test($('s39mStatus').textContent)&&$('s39mOut').textContent.split('\n').length===12,'SLIP39 make: 1 of 1 with 33 words (11 lines of 3 words)');
    $('s39mPass').value='x'; $('s39mPass2').value='x'; w.clearAll(); ok($('s39mRolls').value===''&&$('s39mPass').value===''&&$('s39mPass2').value===''&&$('s39mOut').textContent===''&&!w.eval('s39mCtx'),'SLIP39 make: CLEAR ALL wipes the rolls, passphrases and shares');
    $('s39mRolls').value=R; ok(w.eval('AUTO_FIELDS').includes('s39mRolls')&&w.eval('AUTO_FIELDS').includes('s39mPass')&&w.eval('AUTO_FIELDS').includes('s39mPass2')&&w.eval('autoHasSecrets()'),'SLIP39 make: auto-clear knows the rolls and passphrase boxes');
    await w.s39mUi(); w.s39mClear(); ok($('s39mRolls').value===''&&$('s39mOut').textContent===''&&$('s39mStatus').textContent==='','SLIP39 make: CLEAR empties the panel');
    $('s39mRolls').value=R; await w.s39mUi(); mode('combine'); ok($('s39mRolls').value===''&&!w.eval('s39mCtx')&&$('s39MakePanel').style.display==='none','SLIP39 make: switching back to Check or combine shares wipes the made shares');
    ok(/\["Extendable backup \(SLIP39\)"/.test(html)&&/\["Iteration exponent \(SLIP39\)"/.test(html)&&/\["Master secret \(SLIP39\)"/.test(html)&&/and makes new ones from dice; the Wallet Detective names them/.test(html),'dictionary: Extendable backup, Iteration exponent, Master secret (SLIP39) and SLIP39 updated');
    r.w.close(); })();
  // v2.10.0: BIP138 encrypted descriptor backups. Official test vectors from bitcoin/bips (pinned in tests/fixtures/bip138/SOURCE.json),
  // addresses from embit (tests/fixtures/gen_bip138.py), ChaCha20-Poly1305 from Node's crypto, keys from @scure/bip32.
  sweep(t);
  await (async()=>{ const FX=path.join(__dirname,'fixtures','bip138'), SRC=JSON.parse(fs.readFileSync(path.join(FX,'SOURCE.json'),'utf8')), V=n=>JSON.parse(fs.readFileSync(path.join(FX,n),'utf8'));
    const {HDKey}=require('@scure/bip32'); const {mnemonicToSeedSync}=require('@scure/bip39');
    ok(SRC.commit==='346008db8943cb90c1e091eaac8277066d4dbee7'&&Object.keys(SRC.files).length===10&&Object.entries(SRC.files).every(([n,h])=>nc.createHash('sha256').update(fs.readFileSync(path.join(FX,n))).digest('hex')===h),'BIP138 vectors: all 10 files are the pinned bitcoin/bips ones (SHA-256 checked)');
    const r=load(); await r.ready(); const w=r.w, $=r.$, U=h=>Uint8Array.from(Buffer.from(h,'hex')), H=b=>Buffer.from(b).toString('hex'), te=s=>new w.TextEncoder().encode(s);
    const thr=async f=>{ try { await f(); return null; } catch(e) { return e.message; } };
    const parsePath=s=>s.split('/').slice(1).map(c=>/'$/.test(c)?parseInt(c,10)+0x80000000:parseInt(c,10));
    // ChaCha20-Poly1305
    { const cv=V('chacha20poly1305_encryption.json'); let good=0, refused=0;
      for(const v of cv){ if(v.ciphertext){ if(H(w.b138Seal(U(v.secret),U(v.nonce),U(v.plaintext)))===v.ciphertext) good++; } else if(await thr(()=>w.b138Encode([U('e6642fd69bd211f93f7f1f36ca51a26a5290eb2dd1b0d8279a87bb0d480c8443')],[],U(v.plaintext),U(v.nonce),[]))) refused++; }
      ok(good===3&&refused===2,'BIP138 vectors: ChaCha20-Poly1305 (3 ciphertexts; an empty payload and an all-zero nonce are refused)');
      let same=0; for(let i=0;i<40;i++){ const k=nc.randomBytes(32), n=nc.randomBytes(12), p=nc.randomBytes(i*13+1), c=nc.createCipheriv('chacha20-poly1305',k,n,{authTagLength:16}); const want=Buffer.concat([c.update(p),c.final(),c.getAuthTag()]);
        const got=w.b138Seal(new Uint8Array(k),new Uint8Array(n),new Uint8Array(p)), back=w.b138Unseal(new Uint8Array(k),new Uint8Array(n),got); if(H(got)===want.toString('hex')&&back&&H(back)===p.toString('hex')) same++; }
      ok(same===40,'ChaCha20-Poly1305: 40 random messages (1 to 508 bytes) match Node\'s crypto, and open again');
      const k=new Uint8Array(32).fill(7), n=new Uint8Array(12).fill(1), s=w.b138Seal(k,n,te('descriptor')); const s2=Uint8Array.from(s); s2[3]^=1; const k2=Uint8Array.from(k); k2[0]^=1;
      ok(w.b138Unseal(k,n,s2)===null&&w.b138Unseal(k2,n,s)===null&&w.b138Unseal(k,n,s.slice(0,10))===null,'ChaCha20-Poly1305: a changed byte, a wrong key or a cut-short text does not open'); }
    // secrets, content types, payloads, paths, secret lists
    { const ev=V('encryption_secret.json'); let n=0; for(const v of ev){ const o=await w.b138Secret(v.keys.map(k=>U(k).slice(1))); if(H(o.s)===v.decryption_secret&&JSON.stringify(o.cs.map(H))===JSON.stringify(v.individual_secrets)) n++; }
      ok(n===ev.length,'BIP138 vectors: decryption secret and individual secrets ('+n+' of '+ev.length+', sorting, repeats and keys with one x coordinate)'); }
    { const cv=V('content_type.json'); let n=0; for(const v of cv){ let okv; try { w.b138Ctype(U(v.content),0); okv=true; } catch(e) { okv=false; } if(okv===v.valid) n++; }
      ok(n===cv.length,'BIP138 vectors: content types ('+n+' of '+cv.length+' valid or refused as they should be)');
      const pv=V('payload.json'); const a=w.b138Items(U(pv[0].payload)); ok(a.length===1&&a[0].type===3&&H(a[0].data)==='61'&&!!(await thr(()=>w.b138Items(U(pv[1].payload)))),'BIP138 vectors: payloads (bytes after the 0x00 end are ignored; no item is refused)'); }
    { const dv=V('derivation_path.json'); let n=0; for(const v of dv){ let got; try { got=H(w.b138PathsBytes(v.paths.map(parsePath))); } catch(e) { got=null; } if(got===v.expected) n++; }
      ok(n===dv.length,'BIP138 vectors: derivation paths ('+n+' of '+dv.length+', sorted, without repeats, 255 at most)');
      const sv=V('individual_secrets.json'); let m=0; for(const v of sv){ let got; try { got=H(w.b138SecretsBytes(v.secrets.map(U))); } catch(e) { got=null; } if(got===v.expected) m++; }
      ok(m===sv.length,'BIP138 vectors: individual secret lists ('+m+' of '+sv.length+')'); }
    // whole backups: encode, the Base64 text, parse, open with each key, trailing bytes, an all-zero nonce
    { const bv=V('encrypted_backup.json'); let enc=0, b64=0, open=0, zero=0, trail=0;
      for(const v of bv){
        const keys=v.keys.map(k=>U(k).slice(1)), paths=v.derivation_paths.map(parsePath), dec=v.decoy_individual_secrets.map(U);
        const items=[[v.content,v.plaintext],...(v.extra||[]).map(e=>[e.content,e.plaintext])];
        const payload=w.concatBytes(...items.map(([c,p])=>w.b138Item(U(c),te(p))));
        if(v.valid===false){ if(/nonce is all zeros/.test(await thr(()=>w.b138Parse(U(v.expected))))) zero++; continue; }
        const b=await w.b138Encode(keys,paths,payload,U(v.nonce),dec); if(H(b)===v.expected) enc++; if(w.base64Encode(b)===v.expected_base64) b64++;
        const f=w.b138Parse(U(v.expected+(v.trailing||''))); let all=true; for(const k of keys){ const o=await w.b138TryKeys(f,[{xonly:k}]); const it=o?w.b138Items(o.pt):[]; if(!o||it.length!==items.length||it.some((x,i)=>new w.TextDecoder().decode(x.data)!==items[i][1])) all=false; } if(all) open++;
        if(v.trailing) trail++;
      }
      ok(enc===6&&b64===6,'BIP138 vectors: all 6 backups are made byte for byte (binary and Base64), with common paths left out');
      ok(open===6&&trail===1,'BIP138 vectors: each backup opens with each of its keys and gives every content item back, bytes after the end ignored');
      ok(zero===1,'BIP138 vectors: a backup with an all-zero nonce is refused'); }
    // recipients (key selection), descriptor and policy documents
    { const kv=V('recipient_keys.json'); let n=0; const bad=[];
      for(const v of kv){ const o=await w.b138Recipients(v.descriptors); const got=o.keys.length?o.keys.map(H):null; if(JSON.stringify(got)===JSON.stringify(v.expected_keys)) n++; else bad.push(v.description); }
      ok(n===kv.length,'BIP138 vectors: which keys can open a backup ('+n+' of '+kv.length+': bare xpubs, plain keys and exposed roots left out, MuSig participants kept)'+(bad.length?' '+bad.join('; '):''));
      const o=await w.b138Recipients(['wsh(or_i(pk(tpubDEPBvXvhta3pjVaKokqC3eeMQnszj9ehFaA2zD5nSdkaccwGAizu8jVB2NeSpvmP2P52MBoZvNCixqXRJnTyXx51FQzARR63tjxQSyP3Btw/0/*),pk(tpubDEPBvXvhta3pjVaKokqC3eeMQnszj9ehFaA2zD5nSdkaccwGAizu8jVB2NeSpvmP2P52MBoZvNCixqXRJnTyXx51FQzARR63tjxQSyP3Btw)))']);
      ok(o.keys.length===0&&o.notes.some(x=>/no derivation step/.test(x)),'BIP138: a left-out key is named, so its holder knows it cannot open the backup');
      const dv=V('bip380_descriptor_backup.json'); let d=0; for(const v of dv){ const c=w.b138Content([{type:1,bip:380,data:te(JSON.stringify(v.document))}]); if(c.sets.length===1&&c.sets[0].desc===v.document.descriptor_sets[0].descriptor&&(c.sets[0].change||undefined)===v.document.descriptor_sets[0].change_descriptor) d++; }
      ok(d===dv.length,'BIP138 vectors: BIP380 descriptor documents (with a change descriptor, multipath, receive only)');
      const pv=V('bip388.json'); let p=0; for(const v of pv){ let okv; try { okv=w.b138Content([{type:1,bip:388,data:te(JSON.stringify(v.document))}]).sets.length>0; } catch(e) { okv=false; } if(okv===v.valid) p++; }
      const one=w.b138Content([{type:1,bip:388,data:te(JSON.stringify(pv[0].document))}]).sets[0].desc;
      ok(p===pv.length&&one===w.descriptorChecksum('pkh('+pv[0].document.keys[0]+'/<0;1>/*)'),'BIP138 vectors: BIP388 wallet policy documents (version, keys and policy checked; @0/** becomes /<0;1>/*)'); }
    // descriptor addresses against embit
    { const A=V('addresses.json'); let n=0, bad=0; for(const v of A.vectors){ for(let i=0;i<3;i++){ n++; if(await w.b138Address(v.desc,0,i,v.net)!==v.receive[i]) bad++; } for(let i=0;i<v.change.length;i++){ n++; if(await w.b138Address(v.desc,1,i,v.net)!==v.change[i]) bad++; } }
      ok(bad===0&&A.vectors.length>=40,'descriptor addresses: '+n+' addresses of '+A.vectors.length+' descriptors (single key, multisig, miniscript, Taproot trees) equal embit\'s'); }
    // the Multisig wallet card: SAVE ENCRYPTED DESCRIPTOR BACKUP, then CHECK A BACKUP opens it with any one key
    const M3=['abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about','legal winner thank year wave sausage worth useful legal winner thank yellow','letter advice cage absurd amount doctor acoustic avoid letter advice cage above'];
    const cos=M3.map(m=>{ const rt=HDKey.fromMasterSeed(mnemonicToSeedSync(m,'')); return {fp:rt.fingerprint.toString(16).padStart(8,'0'), x:rt.derive("m/48'/0'/0'/2'").publicExtendedKey}; });
    $('msN').value='3'; $('msM').value='2'; w.msUpdateM(); $('msAcct').value='0'; $('msType').value='ms-wsh'; $('msNet').value='main'; w.msStart(); w.msUsePaste();
    for(const c of cos){ $('msPaste').value='['+c.fp+'/48h/0h/0h/2h]'+c.x; $('msPasteFp').value=''; await w.msAddPasted(); }
    ok(w.eval('ms.done')&&$('msbBox').offsetParent!==undefined&&$('msDone').style.display==='','multisig card: the finished wallet shows the encrypted backup panel');
    ok($('msbBtn').textContent==='SAVE ENCRYPTED DESCRIPTOR BACKUP'&&!$('msbBtn').classList.contains('secondary'),'multisig card: SAVE ENCRYPTED DESCRIPTOR BACKUP is a gold main button');
    r.st.blob=null; await w.b138MakeUi('msb'); ok(/Roll a die at least 50 times/.test($('msbStatus').textContent)&&!r.st.blob,'backup: without dice rolls nothing is made (VOIDFORGE never makes the nonce up)');
    $('msbRolls').value='3'.repeat(49); await w.b138MakeUi('msb'); ok(/at least 50 times/.test($('msbStatus').textContent),'backup: 49 rolls are not enough');
    const R50='16354216535241263542163542165432163542165342165432'; $('msbRolls').value=R50; await w.b138MakeUi('msb');
    const file=await new Promise((res,rej)=>{ const fr=new w.FileReader(); fr.onload=()=>res(new Uint8Array(fr.result)); fr.onerror=rej; fr.readAsArrayBuffer(r.st.blob); }), b64=$('msbText').textContent;
    ok(/^SAVED: voidforge-descriptor-backup\.bip138 \(\d+ bytes, BIP138\)\. Any one of these 3 keys opens it \(fingerprint /.test($('msbStatus').textContent)&&/The file lists 5 entries/.test($('msbStatus').textContent),'backup: 50 rolls save the .bip138 file; any one of the 3 keys opens it, and 5 entries hide the count');
    ok(Buffer.from(file.slice(0,7)).toString('hex')==='424950313338'+'01'&&w.base64Encode(file)===b64&&/^QklQMTM4/.test(b64),'backup: the file starts with BIP138 version 1, and the text shown is its Base64');
    { const f=w.b138Parse(file), want=w.descriptorChecksum(w.eval('ms.descR').replace(/#[a-z0-9]{8}$/,'').split('/0/*').join('/<0;1>/*'));
      // an independent reader: s from Node's SHA-256 over the keys, then Node's ChaCha20-Poly1305
      const tg=(t,m)=>{ const th=nc.createHash('sha256').update(t).digest(); return nc.createHash('sha256').update(Buffer.concat([th,th,m])).digest(); };
      const xs=cos.map(c=>Buffer.from(HDKey.fromExtendedKey(c.x).publicKey.slice(1))).sort(Buffer.compare), s=tg('BIP138_DECRYPTION_SECRET',Buffer.concat(xs));
      const d=nc.createDecipheriv('chacha20-poly1305',s,Buffer.from(f.nonce),{authTagLength:16}); d.setAuthTag(Buffer.from(f.sealed.slice(-16))); const pt=Buffer.concat([d.update(Buffer.from(f.sealed.slice(0,-16))),d.final()]);
      const cs=xs.map(x=>{ const si=tg('BIP138_INDIVIDUAL_SECRET',x); return Buffer.from(s.map((b,i)=>b^si[i])).toString('hex'); });
      const L=Buffer.byteLength(want), csz=L<253?Buffer.from([L]):Buffer.from([0xfd,L&255,L>>8]);
      ok(pt.equals(Buffer.concat([Buffer.from('01017c','hex'),csz,Buffer.from(want)])),'backup: an independent reader (Node\'s SHA-256 and ChaCha20-Poly1305) gets the multipath descriptor back');
      ok(cs.every(c=>f.secrets.some(x=>H(x)===c))&&f.paths.length===0&&f.secrets.map(H).join()===[...f.secrets.map(H)].sort().join(),'backup: the 3 real entries are there, sorted with 2 decoys; the common BIP48 path is not written'); }
    $('msbRolls').value=R50; await w.b138MakeUi('msb'); const again=$('msbText').textContent; $('msbRolls').value=R50.replace(/^1/,'2'); await w.b138MakeUi('msb'); const other=$('msbText').textContent;
    ok(again===b64&&other!==b64&&other.slice(0,200)===b64.slice(0,200),'backup: the same rolls make the same file; other rolls change only the nonce and ciphertext, not the decoys');
    $('msbRolls').value=R50; await w.b138MakeUi('msb'); w.b138ShowQr('msb'); ok(/<rect|<path/.test($('msbQrImg').innerHTML)&&$('msbQrBox').style.display==='','backup: SHOW QR draws the text as a QR code');
    // open it in CHECK A BACKUP
    const open=async(text,words,pass,pub)=>{ $('b138In').value=text; $('phrase').value=words||''; $('verifyPass').value=pass||''; $('b138Pub').value=pub||''; await w.b138OpenUi(); return [$('b138Status').textContent,$('b138Out').textContent]; };
    let [st,out]=await open(b64,M3[1]);
    ok(/^OPENED with the words typed above, without a passphrase: the key at m\/48'\/0'\/0'\/2' \(fingerprint /.test(st)&&/In the descriptor it is key \d of 3 \(fingerprint /.test(st),'reader: the words of one cosigner open it, and it says which key opened it');
    const desc=w.descriptorChecksum(w.eval('ms.descR').replace(/#[a-z0-9]{8}$/,'').split('/0/*').join('/<0;1>/*'));
    ok(out.includes(desc)&&out.includes('Checksum: #'+desc.slice(-8)+', correct.'),'reader: it shows the descriptor and says its checksum is correct');
    ok(w.eval('ms.addrs').every((a,i)=>out.includes('  '+i+': '+a))&&w.eval('ms.change').every((a,i)=>out.includes('  '+i+': '+a))&&/FIRST 10 RECEIVE ADDRESSES:/.test(out)&&/FIRST 10 CHANGE ADDRESSES:/.test(out),'reader: the first 10 receive and 10 change addresses equal the multisig card\'s');
    [st,out]=await open(b64,'',null,cos[2].x); ok(/^OPENED with the public key you pasted/.test(st),'reader: one cosigner\'s xpub alone opens it (BIP138 is keyed by the public keys)');
    [st,out]=await open(b64,'',null,'['+cos[0].fp+"/48'/0'/0'/2']"+cos[0].x+'/<0;1>/*'); ok(/^OPENED with the public key you pasted \(fingerprint /.test(st),'reader: the key may be pasted with its origin and derivation, as in a descriptor');
    [st]=await open(b64,'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'); ok(/^NOT OPENED: the words typed above .*do not open this backup\. Either this is not one of the wallet's keys, or the file was changed or damaged/.test(st)&&!$('b138Out').textContent,'reader: the words of another wallet are refused, and nothing is shown');
    [st]=await open(b64,M3[0],'TREZOR'); ok(/^OPENED with the words typed above, without a passphrase/.test(st),'reader: with a passphrase typed, the words are also tried without it');
    [st]=await open(b64,''); ok(/^Type the words of one of the wallet's keys/.test(st),'reader: with no key at all, it says what to type');
    { const bad=Uint8Array.from(file); bad[bad.length-5]^=1; [st]=await open(w.base64Encode(bad),M3[1]); ok(/^NOT OPENED: .*the file was changed or damaged/.test(st),'reader: a changed byte in the encrypted part is refused (the encryption check fails)');
      const cut=file.slice(0,60); [st]=await open(w.base64Encode(cut),M3[1]); ok(/^The file is cut short or damaged: it ends inside the list of keys\./.test(st),'reader: a cut-short file says where it ends');
      const v2=Uint8Array.from(file); v2[6]=2; [st]=await open(w.base64Encode(v2),M3[1]); ok(/uses BIP138 version 2, which VOIDFORGE cannot read/.test(st),'reader: another version is named, not guessed');
      const nm=Uint8Array.from(file); nm[0]=0x43; [st]=await open(w.base64Encode(nm),M3[1]); ok(/^This is not a BIP138 backup/.test(st),'reader: a file that does not start with BIP138 is refused');
      [st]=await open('QkVCAQ'+'A'.repeat(40),M3[1]); ok(/older Liana backup/.test(st),'reader: an old Liana .bed backup (BEB) is named');
      [st]=await open('not base64 !!',M3[1]); ok(/not Base64/.test(st),'reader: text that is not Base64 is refused');
      [st]=await open(w.base64Encode(Uint8Array.from([...file,1,2,3])),M3[1]); ok(/^OPENED/.test(st),'reader: bytes after the end of the backup are ignored, as BIP138 says'); }
    // stale results, the file picker, the gate, CLEAR ALL
    [st]=await open(b64,M3[1]); $('phrase').value+=' '; $('phrase').dispatchEvent(new w.Event('input')); ok(/^OPENED/.test(st)&&$('b138Status').textContent===''&&$('b138Out').style.display==='none','reader: editing the words clears the old result');
    await open(b64,M3[1]); $('b138In').value+='A'; $('b138In').dispatchEvent(new w.Event('input')); ok($('b138Status').textContent==='','reader: editing the backup text clears the old result');
    await open(b64,M3[1]); $('b138Pub').dispatchEvent(new w.Event('input')); ok($('b138Status').textContent==='','reader: editing the public key box clears the old result');
    { $('b138In').value=''; const fi=$('b138File'); Object.defineProperty(fi,'files',{configurable:true,value:[new w.File([file],'wallet.bip138')]}); fi.dispatchEvent(new w.Event('change')); for(let i=0;i<100&&!$('b138In').value;i++) await new Promise(z=>setTimeout(z,10));
      ok($('b138In').value===b64,'reader: choosing a .bip138 file puts its Base64 text in the box');
      Object.defineProperty(fi,'files',{configurable:true,value:[new w.File([b64+'\n'],'wallet.txt')]}); $('b138In').value=''; fi.dispatchEvent(new w.Event('change')); for(let i=0;i<100&&!$('b138In').value;i++) await new Promise(z=>setTimeout(z,10));
      ok($('b138In').value===b64,'reader: a .txt file with the Base64 text works too'); }
    $('msbRolls').value='x'; $('msbRolls').dispatchEvent(new w.Event('input')); ok($('msbStatus').textContent===''&&$('msbOut').style.display==='none','backup: editing the rolls clears the old result');
    w.setGate('fail','SELF-TEST FAILED','bad'); ok(['msbBtn','wpbBtn','mxbBtn','b138Btn'].every(id=>$(id).disabled),'gate: a failed self-test disables every BIP138 button'); w.setGate('pass','SELF-TEST PASSED','good'); ok(['msbBtn','wpbBtn','mxbBtn','b138Btn'].every(id=>!$(id).disabled),'gate: a passed self-test enables them');
    // the descriptor boxes: Or open a watch-only wallet, and Explain an inheritance or timelock wallet
    { const z=HDKey.fromMasterSeed(mnemonicToSeedSync(M3[0],'')), fp0=z.fingerprint.toString(16).padStart(8,'0'), sk=z.derive("m/84'/0'/0'");
      $('wpIn').value='wpkh(['+fp0+'/84h/0h/0h]'+sk.publicExtendedKey+'/0/*)'; $('wpbRolls').value=R50; await w.b138MakeUi('wpb');
      ok(/^SAVED: .*One key opens it \(fingerprint 73c5da0a\)/.test($('wpbStatus').textContent),'watch-only box: a pasted single-key descriptor is backed up');
      [st,out]=await open($('wpbText').textContent,M3[0]); ok(/^OPENED with the words typed above, without a passphrase: the key at m\/84'\/0'\/0'/.test(st)&&/bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/.test(out)&&/only a receive descriptor/.test(out),'watch-only box: its backup opens with the words (common path m/84\'/0\'/0\' tried), shows receive #0, and says it has no change descriptor');
      $('wpIn').value=sk.publicExtendedKey; $('wpIn').dispatchEvent(new w.Event('input')); ok($('wpbStatus').textContent===''&&$('wpbRolls').value===R50,'watch-only box: editing the box clears the old backup (the rolls stay)');
      await w.b138MakeUi('wpb'); ok(/This is not a descriptor/.test($('wpbStatus').textContent),'watch-only box: a plain xpub is not a descriptor');
      $('wpIn').value='wpkh('+z.derive("m/84'/0'/0'").privateExtendedKey+'/0/*)'; await w.b138MakeUi('wpb'); ok(/PRIVATE key/.test($('wpbStatus').textContent),'watch-only box: a descriptor with a private key is refused');
      $('wpIn').value='wpkh(['+fp0+'/84h/0h/0h]'+sk.publicExtendedKey+'/0/*)#aaaaaaaa'; await w.b138MakeUi('wpb'); ok(/checksum \(after #\) does not match/.test($('wpbStatus').textContent),'watch-only box: a wrong checksum is refused');
      $('wpIn').value='wpkh('+sk.publicExtendedKey+')'; await w.b138MakeUi('wpb'); ok(/No key of this descriptor can lock a BIP138 backup/.test($('wpbStatus').textContent)&&/no derivation step/.test($('wpbStatus').textContent),'watch-only box: a bare xpub (its key shows on the blockchain) cannot lock a backup, and says why');
      // an inheritance (Liana-style) wallet with a custom path for the heir's key: the path is written in the file, so the words find it
      const heir=HDKey.fromMasterSeed(mnemonicToSeedSync(M3[2],'')), hp="m/48'/0'/12'/2'", hk=heir.derive(hp), hfp=heir.fingerprint.toString(16).padStart(8,'0');
      const L='wsh(or_d(pk(['+cos[0].fp+'/48h/0h/0h/2h]'+cos[0].x+'/<0;1>/*),and_v(v:pkh(['+hfp+"/48'/0'/12'/2']"+hk.publicExtendedKey+'/<0;1>/*),older(52560))))';
      $('msxIn').value=L; $('msxIn').dispatchEvent(new w.Event('input')); $('mxbRolls').value=R50; await w.b138MakeUi('mxb');
      ok(/^SAVED: .*Any one of these 2 keys opens it/.test($('mxbStatus').textContent),'inheritance box: a miniscript descriptor is backed up for both keys');
      const mf=w.b138Parse(Uint8Array.from(Buffer.from($('mxbText').textContent,'base64'))); ok(mf.paths.length===1&&w.b138PathText(mf.paths[0])===hp,'inheritance box: the heir\'s custom path is written in the file (the common one is not)');
      [st,out]=await open($('mxbText').textContent,M3[2]); 
      ok(/^OPENED with the words typed above, without a passphrase: the key at m\/48'\/0'\/12'\/2'/.test(st)&&/key 2 of 2/.test(st)&&out.includes(await w.b138Address(L,0,0,'main'))&&out.includes(await w.b138Address(L,1,9,'main')),'inheritance box: the heir\'s words open it at the custom path and the miniscript addresses are listed'); }
    // CLEAR ALL
    $('b138Pub').value='x'; $('b138In').value='x'; for(const P of ['msb','wpb','mxb']) $(P+'Rolls').value=R50; w.clearAll();
    ok(['b138In','b138Pub','msbRolls','wpbRolls','mxbRolls'].every(id=>$(id).value==='')&&$('b138Status').textContent===''&&['wpbStatus','mxbStatus'].every(id=>$(id).textContent===''),'CLEAR ALL empties the BIP138 boxes, rolls and results');
    ok(/\["BIP138 \(encrypted descriptor backup\)"/.test(html)&&/\["ChaCha20-Poly1305"/.test(html)&&/Encryption also needs a new nonce/.test(html),'dictionary: BIP138, ChaCha20-Poly1305, and Nonce for encryption');
    ok(r.errors.length===0,'BIP138: no page errors '+JSON.stringify(r.errors));
    r.w.close(); })();
  // v2.10.0: Check a Coldcard seed mix (expected words: Coinkite's formula worked out here with Node's SHA-256, then @scure) and Was my seed made by a flawed device?
  sweep(t);
  await (async()=>{ const {entropyToMnemonic,mnemonicToSeedSync}=require('@scure/bip39'); const {wordlist}=require('@scure/bip39/wordlists/english'); const {HDKey}=require('@scure/bip32'); const btc=require('@scure/btc-signer');
    const r=load(); await r.ready(); const w=r.w, $=r.$, sleep=ms=>new Promise(res=>setTimeout(res,ms));
    const H=(...p)=>nc.createHash('sha256').update(Buffer.concat(p.map(x=>Buffer.from(x)))).digest();
    const mix=(trng,s,m,pur,n)=>H(H('CC\x01S'+pur+m,trng,H('CC\x01'+m,s))).subarray(0,n===12?16:32);
    const a0=(mn,net)=>btc.p2wpkh(HDKey.fromMasterSeed(mnemonicToSeedSync(mn,'')).derive(net==='test'?"m/84'/1'/0'/0/0":"m/84'/0'/0'/0/0").publicKey,net==='test'?btc.TEST_NETWORK:undefined).address;
    const Z24='abandon '.repeat(23)+'art', D50='123456'.repeat(8)+'12';
    const set=(trng,meth,len,pur,rolls)=>{ $('cmxTrng').value=trng; $('cmxMethod').value=meth; $('cmxLen').value=String(len); $('cmxPurpose').value=pur; $('cmxRolls').value=rolls; };
    const shown=()=>[...$('cmxOut').textContent.matchAll(/\d+\. ([a-z]+)/g)].map(m=>m[1]).join(' ');
    const hx=b=>Buffer.from(b).toString('hex');
    eq(hx(await w.coldcardMixEntropy(new Uint8Array(32),D50,'D','M',12)),'67c8b6d836d47f88dfb88a1bb5a534cf','Coldcard mix: Coinkite\'s dice vector, 12 words (firmware testing/test_rolls.py)');
    eq(hx(await w.coldcardMixEntropy(new Uint8Array(32),'01'.repeat(64),'C','M',24)),'8216d06056e31315bec14171d1f09345eef5cbba16fdd3498354951dd3356dab','Coldcard mix: Coinkite\'s coin vector, 24 words');
    ok(!$('cmxBtn').disabled&&$('cmxBox').querySelector('summary .tag-secret')&&!$('cmxBox').querySelector('button[onclick*="opy"]')&&/#cmxOut \{ -webkit-user-select: none; user-select: none; \}/.test(html),'Coldcard mix: on after the self-test, marked SECRET, no copy button, and its result cannot be selected');
    let s; do { s=rnd(61); } while(w.coldcardMixRefusal('D',s));
    const trng=nc.randomBytes(32), tw=entropyToMnemonic(trng,wordlist), want=entropyToMnemonic(mix(trng,s,'D','T',24),wordlist);
    set(tw,'D',24,'T',s.replace(/(.{5})/g,'$1 ')); await w.cmxCheck();
    ok(shown()===want&&/Temporary Seed/.test($('cmxOut').textContent)&&/^SECRET/.test($('cmxOut').textContent)&&/ok/.test($('cmxStatus').className),'Coldcard mix: random TRNG words + 61 rolls (with spaces), Temporary Seed, 24 words: the words of Coinkite\'s formula');
    ok($('cmxOut').textContent.includes(a0(want,'main'))&&$('cmxOut').textContent.includes('Master fingerprint: '+HDKey.fromMasterSeed(mnemonicToSeedSync(want,'')).fingerprint.toString(16).padStart(8,'0')),'Coldcard mix: the fingerprint and first receive address match @scure');
    $('cmxRolls').dispatchEvent(new w.Event('input')); ok(!$('cmxOut').textContent&&!$('cmxStatus').textContent,'Coldcard mix: typing in the rolls box clears the old result');
    await w.cmxCheck(); $('cmxPurpose').value='M'; $('cmxPurpose').dispatchEvent(new w.Event('change')); ok(!$('cmxOut').textContent,'Coldcard mix: changing the kind of seed clears the old result');
    await w.cmxCheck(); ok(shown()===entropyToMnemonic(mix(trng,s,'D','M',24),wordlist)&&shown()!==want,'Coldcard mix: New Seed Words (purpose M) gives other words than a Temporary Seed (T)');
    $('cmxTrng').value=tw.split(' ').map(x=>x.slice(0,4)).join(' '); $('cmxLen').value='12'; await w.cmxCheck(); ok(shown()===entropyToMnemonic(mix(trng,s,'D','M',12),wordlist),'Coldcard mix: 12 words are the first 16 bytes, and TRNG words typed as their first 4 letters work');
    let f; do { f=rnd(130,2); } while(w.coldcardMixRefusal('C',f));
    set(tw,'C',12,'M',f); await w.cmxCheck(); ok(shown()===entropyToMnemonic(mix(trng,f,'C','M',12),wordlist),'Coldcard mix: 130 coin flips, 12 words');
    const refuse=async(meth,rolls,re,m,trngW=Z24)=>{ set(trngW,meth,12,'M',rolls); await w.cmxCheck(); ok(re.test($('cmxStatus').textContent)&&/bad/.test($('cmxStatus').className)&&!$('cmxOut').textContent,m); };
    await refuse('D',D50.slice(0,49),/at least 50 dice rolls and does not finish with fewer \(49 typed\)/,'Coldcard mix: 49 rolls are refused, as the Coldcard does');
    await refuse('C','01'.repeat(63)+'1',/at least 128 coin flips/,'Coldcard mix: 127 flips are refused');
    await refuse('D','1'.repeat(16)+'23456'.repeat(6)+'23456'.slice(0,4),/refuses these dice rolls: 1 is 16 of the 50, more than 30%/,'Coldcard mix: 16 of 50 rolls on one face (32%) are refused, as the Coldcard does');
    set(Z24,'D',12,'M','1'.repeat(15)+'23456'.repeat(7)); await w.cmxCheck(); ok(!!$('cmxOut').textContent,'Coldcard mix: 15 of 50 on one face (30%) is still accepted (the limit is more than 30%)');
    await refuse('C','1'.repeat(84)+'0'.repeat(44),/more than 65%/,'Coldcard mix: 84 of 128 flips on one side (66%) are refused');
    set(Z24,'C',12,'M','1'.repeat(83)+'0'.repeat(45)); await w.cmxCheck(); ok(!!$('cmxOut').textContent,'Coldcard mix: 83 of 128 flips on one side (65%) are accepted');
    await refuse('D',D50.replace('3','7'),/“7” is not one of the dice rolls/,'Coldcard mix: a roll that is not 1 to 6 is named, not dropped');
    await refuse('D',D50,/shows 24 words, even for a 12-word seed/,'Coldcard mix: 12 TRNG words are refused (the device shows 24)','abandon '.repeat(11)+'about');
    await refuse('D',D50,/^TRNG words: Checksum failed/,'Coldcard mix: TRNG words with a bad checksum are refused','abandon '.repeat(24));
    set(Z24,'D',12,'M',D50); await w.cmxCheck(); w.practiceMode(true); await sleep(30); ok(!$('cmxOut').textContent,'Coldcard mix: practice mode clears a mainnet result');
    await w.cmxCheck(); ok($('cmxOut').textContent.includes(a0(entropyToMnemonic(mix(new Uint8Array(32),D50,'D','M',12),wordlist),'test'))&&/TESTNET/.test($('cmxOut').textContent),'Coldcard mix: in practice mode the address is on the test network'); w.practiceMode(false);
    ok(w.eval('AUTO_FIELDS').includes('cmxTrng')&&w.eval('AUTO_FIELDS').includes('cmxRolls'),'Coldcard mix: auto-clear wipes the TRNG words and the rolls');
    await w.cmxCheck(); w.clearAll(); ok(!$('cmxTrng').value&&!$('cmxRolls').value&&!$('cmxOut').textContent,'Coldcard mix: CLEAR ALL wipes the TRNG words, the rolls and the words');
    set(Z24,'D',12,'M',D50); w.eval('selfTestState = "fail"'); r.st.alerts.length=0; await w.cmxCheck(); ok(r.st.alerts.length===1&&!$('cmxOut').textContent,'Coldcard mix: with a failed self-test it refuses'); w.eval('selfTestState = "pass"'); w.cmxClear();
    // Was my seed made by a flawed device?
    const A=(d,v,dt,dice)=>w.flwAssess(d,v||'',dt||'',dice||'none'), L=(d,v,dt,dice)=>A(d,v,dt,dice).level;
    ok(L('ccq','1.4.1Q')==='weak'&&L('ccq','1.5.0Q')==='ok'&&L('ccq','1.5.3Q')==='ok'&&L('ccmk4','5.5.1')==='weak'&&L('ccmk4','5.6.0')==='ok'&&L('ccmk4','5.10.0')==='ok','flawed device: Coldcard Q before 1.5.0Q and Mk4 before 5.6.0 are weak; the fix versions and later are not (compared as numbers)');
    ok(L('ccmk3','4.1.9')==='weak'&&L('ccmk3','4.2.0')==='ok'&&/first notes named 4\.0\.1 or later/.test(A('ccmk3','3.9.0').text)&&!/first notes/.test(A('ccmk3','4.0.1').text),'flawed device: Coldcard Mk3 before 4.2.0 is weak, and below 4.0.1 the page says Coinkite\'s notes differ');
    ok(L('ccmk4','6.5.0X')==='weak'&&L('ccq','6.6.0QX')==='ok'&&L('ccedge','6.5.1X')==='weak'&&L('ccedge','6.6.0X')==='ok','flawed device: Edge versions (ending in X) use the Edge fix, 6.6.0');
    ok(L('ccmk4','1.4.1Q')==='input'&&/is not a version of the Coldcard Mk4 or Mk5/.test(A('ccmk4','1.4.1Q').text)&&L('ccq','abc')==='input'&&L('ccq','','May')==='input','flawed device: a version of another model, or text that is not a version or date, asks again');
    ok(L('ccq','','2026-07')==='weak'&&L('ccq','','2025')==='weak'&&L('ccq','','2026-07-30')==='weak'&&L('ccq','','2026-07-31')==='unknown'&&L('ccq','','2026-08')==='unknown'&&L('ccq','','2026')==='unknown'&&L('ccq')==='unknown','flawed device: without a version, a date before 31 July 2026 means weak; later or unclear dates ask for the version');
    ok(/may have helped/.test(A('ccq','1.4.1Q','','mixed').text)&&L('ccq','1.4.1Q','','mixed')==='weak','flawed device: dice added to a flawed Coldcard\'s words: still move, as Coinkite says');
    ok(L('ccq','1.4.1Q','','only')==='ok'&&/do not depend on the device's random number generator/.test(A('ccq','1.4.1Q','','only').text)&&/do not depend on any random number generator/.test(A('vf').text),'flawed device: a seed set by your dice alone (on the device or in VOIDFORGE) does not depend on its random numbers');
    ok(L('bx','3.0.0')==='weak'&&L('bx','3.6.0')==='weak'&&L('bx','3.6.1')==='ok'&&L('bx','2.9.9')==='ok'&&L('bx')==='unknown'&&/CVE-2023-39910/.test(A('bx','3.2.0').text),'flawed device: Libbitcoin Explorer bx seed 3.0.0 to 3.6.0 (Milk Sad, CVE-2023-39910)');
    ok(L('trust','0.0.172')==='weak'&&L('trust','0.0.182')==='weak'&&L('trust','0.0.183')==='ok'&&L('trust','0.0.171')==='ok'&&/CVE-2023-31290/.test(A('trust','0.0.180').text),'flawed device: Trust Wallet browser extension 0.0.172 to 0.0.182 (CVE-2023-31290)');
    ok(L('other')==='ok'&&/^No known flaw for this\. We only know these: Coldcard Mk4 and Mk5 before 5\.6\.0; .*Trust Wallet browser extension 0\.0\.172 to 0\.0\.182\./.test(A('other').text),'flawed device: another device: "No known flaw for this", with the list of the flaws known');
    $('flwDev').value='ccq'; $('flwVer').value='1.4.1Q'; w.flwUi();
    ok(/^Your seed may be weak: move the funds to a new seed\./.test($('flwStatus').textContent)&&/bad/.test($('flwStatus').className)&&/1\. On your offline computer, make a new seed from your own dice/.test($('flwOut').textContent)&&/Inspect a transaction \(PSBT\)/.test($('flwOut').textContent),'flawed device: a weak answer shows the calm move checklist with VOIDFORGE\'s tools');
    $('flwVer').value='1.5.0Q'; $('flwVer').dispatchEvent(new w.Event('input')); ok(!$('flwStatus').textContent&&!$('flwOut').textContent,'flawed device: editing an answer clears the old result');
    w.flwUi(); ok(/^No known flaw for this version/.test($('flwStatus').textContent)&&$('flwOut').style.display==='none','flawed device: a fixed version shows no checklist');
    w.clearAll(); ok(!$('flwVer').value&&!$('flwStatus').textContent,'flawed device: CLEAR ALL empties the answers');
    ok(/\["Seed mix \(dice plus device\)"/.test(html)&&/\["TRNG \(true random number generator\)"/.test(html)&&/\["Weak seed"/.test(html),'dictionary: Seed mix, TRNG and Weak seed');
    r.w.close(); })();
  // v2.10.0: public example phrases (official vectors: tests/fixtures/bip39-vectors-english.json, from trezor/python-mnemonic at a pinned
  // commit; other phrases worked out here with @scure and Node's SHA-256), look-alike letters, and rolls typed twice
  sweep(t);
  await (async()=>{ const {entropyToMnemonic}=require('@scure/bip39'); const {wordlist}=require('@scure/bip39/wordlists/english');
    const r=load(); await r.ready(); const w=r.w, $=r.$, sleep=ms=>new Promise(res=>setTimeout(res,ms)), until=async(f,ms=8000)=>{ for(let t0=0;t0<ms&&!f();t0+=20) await sleep(20); };
    const VX=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','bip39-vectors-english.json'),'utf8')).english, OFF='one of the official BIP39 test phrases';
    const E=(h)=>entropyToMnemonic(Buffer.from(h,'hex'),wordlist), H=(s,n)=>E(nc.createHash('sha256').update(s,'utf8').digest().subarray(0,n===24?32:16).toString('hex'));
    ok(VX.length===24&&VX.every(([e,m])=>E(e)===m&&w.phraseEntropyHex(m)===e&&w.knownPhrase(m)===OFF),'public phrase: all 24 official BIP39 vectors (English) are named, and their entropy agrees with @scure');
    const b85=['girl mad pet galaxy egg matter matrix prison refuse sense ordinary nose','near account window bike charge season chef number sketch tomorrow excuse sniff circle vital hockey outdoor supply token','puppy ocean match cereal symbol another shed magic wrap hammer bulb intact gadget divorce twin tonight reason outdoor destroy simple truth cigar social volcano'];
    ok(b85.every(m=>w.knownPhrase(m)==='a published BIP85 test phrase'),'public phrase: the three BIP85 test phrases are named');
    const R50='65515223131652132161133154444123616466443112153441', R99=R50+'5633526456254462245546236542364246312613322234612';
    ok([H(R50,12),H(R99,24)].every(m=>/published by SeedSigner/.test(w.knownPhrase(m))),'public phrase: SeedSigner\'s published 50- and 99-roll examples are named');
    const DC=w.eval('DC_CARD_ROLLS'); ok([H(DC.slice(0,50),12),H(DC.slice(0,99),24),H(DC.slice(0,50).replace(/6/g,'0'),12),H(DC.slice(0,100).replace(/6/g,'0'),24)].every(m=>/dice test card/.test(w.knownPhrase(m))),'public phrase: the four phrases of the page\'s dice test card are named');
    ok((await w.practicePhrases()).every(m=>!!w.knownPhrase(m)),'public phrase: every practice phrase is named');
    eq(w.knownPhrase('embody only exact pride episode winter estate perfect security often scout tiger'),'an example in this page\'s self-test','public phrase: the self-test\'s card example is named');
    eq([E('a5'.repeat(16)),E('00ff'.repeat(16)),E('deadbeef'.repeat(8)),E([...Array(16)].map((_,i)=>(250-i).toString(16).padStart(2,'0')).join('')),'test '.repeat(11)+'junk'].map(m=>String(w.knownPhrase(m)).replace(/, not from real randomness$/,'')).join('|'),
      'made from one number repeated|made from a short pattern repeated|made from a short pattern repeated|made from counting numbers|made from one word repeated','public phrase: patterned entropy and repeated words are named (one byte, a 2- and 4-byte block, counting down, test x11 junk)');
    { let seq=null; for(const last of wordlist){ const m=wordlist.slice(100,111).join(' ')+' '+last; if((await w.checkPhrase(m)).ok){ seq=m; break; } } ok(seq&&w.knownPhrase(seq)==='made from words in list order, not from real randomness','public phrase: 11 words in list order are named'); }
    { let n=0; for(let i=0;i<300;i++) if(w.knownPhrase(E(nc.randomBytes(i%2?32:16).toString('hex')))) n++; ok(n===0,'public phrase: 300 random seeds are never named'); }
    // the words box in CHECK A BACKUP
    w.showTab('check'); const typed=async(v,f)=>{ $('phrase').value=v; $('phrase').dispatchEvent(new w.Event('input')); await until(f||(()=>$('phrasePub').textContent)); return $('phrasePub'); };   // the check is async: wait for it
    let p=await typed('abandon '.repeat(11)+'about');
    ok(/^PUBLIC EXAMPLE PHRASE: This phrase is a public example\. Anyone can take money sent to it\. It is one of the official BIP39 test phrases\. Never use it for real money\.$/.test(p.textContent)&&p.className==='status bad','words box: a public phrase is named at once, in red');
    await typed('',()=>$('phrasePub').textContent===''); p=await typed('0000'.repeat(11)+'0003'); ok(/public example/.test(p.textContent),'words box: a SeedQR digit string of a public phrase is named too');
    p=await typed(E(nc.randomBytes(16).toString('hex')),()=>$('phrasePub').textContent===''); ok(p.textContent==='','words box: other words show nothing');
    w.practiceMode(true); p=await typed('zoo '.repeat(11)+'wrong',()=>/TESTNET/.test($('phrasePub').textContent));
    ok(/Practice mode is on, so it is fine for TESTNET \(practice coins only\), never for real funds\./.test(p.textContent)&&p.className==='status warn','words box: in practice mode the warning says TESTNET (practice coins only)');
    w.practiceMode(false); await until(()=>$('phrasePub').className==='status bad'); ok(/Never use it for real money\./.test($('phrasePub').textContent)&&$('phrasePub').className==='status bad','words box: turning practice mode off makes it red again');
    // VERIFY: the warning line, Open this wallet, and the look-alike letters (SECRET)
    $('verifyPass').value=''; await typed('abandon '.repeat(11)+'about'); await w.verify();
    ok(/PUBLIC EXAMPLE PHRASE: This phrase is a public example\./.test($('verifyStatus').textContent)&&!/PUBLIC PRACTICE PHRASE/.test($('verifyStatus').textContent),'VERIFY: a public phrase that is not a practice phrase gets the public example line');
    await until(()=>$('wvFp').textContent); ok(/This phrase is a public example/.test($('wvPub').textContent)&&$('wvFp').textContent==='Master fingerprint: 73c5da0a','Open this wallet: names a public phrase, with the fingerprint line unchanged');
    const SW='uncle tragic hole abandon'.split(' '); let sm=null; for(const last of wordlist){ const m=SW.concat(Array(7).fill('zoo'),[last]).join(' '); if((await w.checkPhrase(m)).ok){ sm=m; break; } }
    await typed(sm,()=>true); ok($('vSmudge').textContent==='','VERIFY: editing the words clears the old look-alike list'); await w.verify(); const vs=$('vSmudge');
    ok(vs.firstChild&&vs.firstChild.className==='tag tag-secret'&&vs.firstChild.textContent==='SECRET'&&/^SECRET Write these clearly: 1 \(uncle could look like under\), 2 \(tragic could look like tray\), 3 \(hole could look like hotel\)/.test(vs.textContent)&&!/abandon/.test(vs.textContent),'VERIFY: the look-alike list is marked SECRET and names the words by number');
    ok(/#smudgeNote, #vSmudge \{ -webkit-user-select: none; user-select: none; \}/.test(html)&&/body\.drill-on #smudgeNote \{ visibility: hidden; \}/.test(html),'look-alike list: cannot be selected, and the restore drill hides it');
    ok(!/vSmudge/.test([...w.document.querySelectorAll('button')].map(b=>b.getAttribute('onclick')||'').join(' ')),'look-alike list: no COPY button');
    { const all=w.eval('WORDLIST'); let bad=0; for(const x of all){ const v=w.smudgeOf(x); if(v&&(v===x||!all.includes(v))) bad++; } ok(bad===0,'look-alike letters: every suggestion is another BIP39 word'); }
    eq(w.smudgeText(['zoo','zoo']),'','look-alike letters: nothing is shown when no word has a look-alike');
    // Wallet Detective: the list names a public phrase first
    await typed('abandon '.repeat(11)+'about'); await w.detList(); ok(/^PUBLIC EXAMPLE PHRASE/.test($('detPub').textContent)&&!/PUBLIC EXAMPLE/.test($('detOut').textContent),'Wallet Detective: a public phrase is named above the list, which itself is unchanged');
    w.detClear(true); ok($('detPub').textContent==='','Wallet Detective: the warning is cleared with the result');
    // Seed XOR: parts that combine to a public phrase
    w.document.querySelector('input[name=xorMode][value=combine]').checked=true; w.xorModeChange(); $('xorIn').value=[E('0f'.repeat(16)),E('70'.repeat(16))].join('\n'); await w.seedXorUi('combine');
    ok(/^WARNING: the parts combine to a public example phrase\. PUBLIC EXAMPLE PHRASE: This phrase is a public example/.test($('xorStatus').textContent)&&/warn/.test($('xorStatus').className),'Seed XOR: parts that combine to a public phrase (7f x16) are warned about');
    // CLEAR ALL clears the warning and the look-alike list
    w.clearAll(); await sleep(30); ok($('phrasePub').textContent===''&&$('vSmudge').textContent===''&&$('wvPub').textContent==='','CLEAR ALL clears the public phrase warning and the look-alike list in CHECK A BACKUP');
    // FORGE: hex 00 x16 and SeedSigner's rolls are named under the words; the look-alike list sits under the grid
    w.showTab('make'); w.setMethod('cards'); $('cdHex').value='00'.repeat(16); w.cdUpdate(); await w.cdHexGenerate();
    ok(w.hasSeed()&&$('ssfBan').textContent==='PRACTICE: This seed is a public or predictable seed (it is one of the official BIP39 test phrases). Anyone can make it again: never put money on it.'&&$('ssfBan').style.display===''&&$('forgePub').textContent==='','FORGE: hex 00 x16 (abandon ... about) is named as a public seed by the red PRACTICE banner, once (v2.16.1 review: the line under the words does not say it again)');
    eq($('smudgeNote').textContent,w.smudgeText(w.eval('madeMnemonic').split(' '))?'SECRET '+w.smudgeText(w.eval('madeMnemonic').split(' ')):'','FORGE: the look-alike list follows the words');
    w.setMethod('dice'); r.set(R50); await w.generate(); ok(/^PRACTICE: This seed is a public or predictable seed \(it is .*published by SeedSigner/.test($('ssfBan').textContent)&&w.eval('seedPr()')===$('ssfBan').textContent,'FORGE: SeedSigner\'s example rolls are named as a public seed, marked PRACTICE (v2.16.1 review: every method)');
    const words=$('genResult').textContent.split('\n')[0].split(' '), st=w.smudgeText(words);
    ok(st&&$('smudgeNote').textContent==='SECRET '+st&&$('smudgeNote').firstChild.className==='tag tag-secret','FORGE: the look-alike list is shown under the words, marked SECRET');
    w.practiceMode(true); await sleep(30); ok($('forgePub').textContent==='Practice mode is on, so this public seed is fine for TESTNET (practice coins only), never for real funds.'&&$('forgePub').className==='status warn','FORGE: practice mode says it may be used on TESTNET'); w.practiceMode(false); await sleep(30); ok($('forgePub').textContent==='','FORGE: practice mode off: the banner alone names it');
    r.set(rnd(50,6)); await w.generate(); ok(w.hasSeed()&&$('forgePub').textContent==='','FORGE: rolled words show no public phrase warning');
    w.clearAll(); await sleep(20); ok($('forgePub').textContent===''&&$('smudgeNote').textContent==='','CLEAR ALL clears the notes under the words');
    // rolls typed twice (an independent plain search: the first pair of equal blocks that do not overlap)
    const naive=(s,L)=>{ for(let b=0;b+L<=s.length;b++) for(let a=0;a+L<=b;a++) if(s.substr(a,L)===s.substr(b,L)){ let n=L; while(b+n<s.length&&a+n<b&&s[a+n]===s[b+n]) n++; return [a+1,a+n,b+1,b+n,n]; } return null; };
    const R=R99.slice(0,60)+R99.slice(20,38)+R99.slice(60), x=naive(R,12); r.set(R);
    eq($('twiceNote').textContent,'The same '+x[4]+' rolls appear twice: rolls '+x[0]+' to '+x[1]+' and rolls '+x[2]+' to '+x[3]+'. By chance this almost never happens, so check that nothing was pasted or typed twice. Your rolls were not changed.','rolls typed twice: a repeated block of 18 rolls is found, as a plain search finds it');
    ok($('rolls').value===R,'rolls typed twice: the rolls are left as typed');
    { const R11=R99.slice(0,60)+R99.slice(20,31)+R99.slice(60); r.set(R11); ok(naive(R11,12)===null&&$('twiceNote').textContent==='','rolls typed twice: 11 repeated rolls are not enough'); }
    { let n=0; for(let i=0;i<300;i++){ r.set(rnd(99,6)); if($('twiceNote').textContent) n++; } ok(n===0,'rolls typed twice: 300 runs of 99 fair rolls give no warning'); }
    r.mode('coin'); const F=rnd(128,2), C=F.slice(0,40)+F.slice(0,40)+F.slice(40); r.set(C); const y=naive(C,32);
    ok(y&&$('twiceNote').textContent.startsWith('The same '+y[4]+' flips appear twice: flips '+y[0]+' to '+y[1]+' and flips '+y[2]+' to '+y[3]+'.'),'rolls typed twice: 40 coin flips pasted twice are found');
    { const F31=F.slice(0,31)+F.slice(0,31)+F.slice(31); r.set(F31); ok((naive(F31,32)===null)===($('twiceNote').textContent===''),'rolls typed twice: coin flips are compared in blocks of 32'); }
    r.set(''); ok($('twiceNote').textContent==='','rolls typed twice: an empty box shows nothing'); r.mode('dice');
    ok(/\["Public example phrase"/.test(html)&&/\["Look-alike letters"/.test(html),'dictionary: Public example phrase and Look-alike letters');
    r.w.close(); })();
  // v2.10.0 BEGIN
  // v2.10.0: punch plates (binary grid, Stackbit 1248, word numbers), reading them back, inheritance documents and the bag log.
  // Hand-computed example: legal = 1020 = 512+256+128+64+32+16+8+4 (binary 001111111100, hex 3FC, octal 1774, Stackbit 1|0|2|0);
  // winner = 2016 (7E0, 3740); zoo = 2048 (punched alone); abandon = 1. Krux's own code is compared in tests/krux.test.mjs.
  sweep(t);
  await (async()=>{ const r=load(); await r.ready(); const w=r.w, $=r.$, sleep=ms=>new Promise(x=>setTimeout(x,ms));
    const LW='legal winner thank year wave sausage worth useful legal winner thank yellow', nums=LW.split(' ').map(x=>w.pnNum(x));
    eq(nums.join(' '),'1020 2016 1791 2040 1984 1534 2032 1920 1020 2016 1791 2041','plates: word numbers count from 1, as Krux does (legal = 1020)');
    eq(w.pnBits(1020).join('')+' '+w.pnBits(2048).join('')+' '+w.pnBits(1).join(''),'001111111100 100000000000 000000000001','plates: binary grid columns run 2048 down to 1; zoo punches 2048 alone');
    eq(JSON.stringify(w.pnStack(1020))+JSON.stringify(w.pnStack(2016))+JSON.stringify(w.pnStack(2048)),'[[1],[],[2],[]][[2],[],[1],[2,4]][[2],[],[4],[8]]','plates: Stackbit 1248 punches each digit as a sum of 1, 2, 4 and 8');
    eq(JSON.stringify(w.pnBases(2016)),'{"dec":"2016","hex":"7E0","oct":"3740"}','plates: decimal, hex (capitals) and octal');
    // on screen after VERIFY
    $('phrase').value=LW; $('verifyPass').value=''; await w.verify(); for(let i=0;i<200&&!(w.eval('wvCtx')&&w.eval('wvCtx.shown'));i++) await sleep(20);
    $('pnFmt').value='grid'; w.pnShow();
    const g=[...$('pnView').querySelectorAll('tr')].map(tr=>[...tr.children].map(c=>c.textContent));
    ok($('pnView').classList.contains('on')&&$('pnShowBtn').textContent==='HIDE PLATE'&&g.length===13&&g[0].slice(1,13).join(' ')==='2048 1024 512 256 128 64 32 16 8 4 2 1'&&g[1].slice(1,13).map(x=>x?1:0).join('')==='001111111100'&&g[1][13]==='1020','plates: SHOW PLATE draws the binary grid of the checked words (row 1: legal)');
    $('pnFmt').value='stack'; w.pnRender(); { const s=[...$('pnView').querySelectorAll('tr')]; ok(s.length===14&&[...s[3].children].slice(1,15).map(c=>c.textContent?1:0).join('')==='01000010000110'&&s[3].lastChild.textContent==='2016','plates: the Stackbit layout follows the menu (row 2: winner, 2016)'); }
    $('pnFmt').value='num'; w.pnRender(); ok(/^2201[67]E03740$/.test([...$('pnView').querySelectorAll('tr')][2].textContent)||[...$('pnView').querySelectorAll('tr')][2].textContent==='220167E03740','plates: the word numbers table shows decimal, hex and octal');
    ok(/SECRET/.test($('pnView').textContent)&&/#pnView, #pnRdGrid \{ -webkit-user-select: none; user-select: none;/.test(html)&&!$('pnView').querySelector('button')&&![...$('pnBtns').querySelectorAll('button')].some(b=>/COPY/.test(b.textContent))&&/tag-secret">SECRET/.test($('pnRdBox').querySelector('summary').innerHTML),'plates: marked SECRET, cannot be highlighted, and no COPY button');
    // print: asks first, prints the plate, never the passphrase
    r.st.confirms=0; const p0=r.st.printed; $('pnFmt').value='grid'; w.printPlate();
    ok(r.st.confirms===1&&r.st.printed===p0+1&&/^VOIDFORGE BINARY GRID PLATE/.test(r.st.printHTML)&&/Passphrase used: NO/.test(r.st.printHTML)&&r.st.printClass.includes('print-seed'),'plates: PRINT PLATE asks for confirmation, then prints the grid');
    w.dispatchEvent(new w.Event('afterprint')); ok($('printOnly').textContent==='','plates: the printed plate is wiped after printing');
    { const oc=w.confirm, p1=r.st.printed; let n=0; w.confirm=()=>{ n++; return false; }; w.printPlate(); w.confirm=oc; ok(n===1&&r.st.printed===p1,'plates: answering no to the question prints nothing'); }
    w.printPlateBlank('check'); ok(/^VOIDFORGE BLANK BINARY GRID PLATE/.test(r.st.printHTML)&&!/legal|1020/.test(r.st.printHTML)&&r.st.printHTML.includes('Empty template for 12 words'),'plates: PRINT BLANK PLATE prints an empty grid of the right size, with no secret'); w.dispatchEvent(new w.Event('afterprint'));
    // a stale plate never stays: editing the words closes the wallet view and the plate
    w.pnShow(true); $('phrase').value=LW+' x'; $('phrase').dispatchEvent(new w.Event('input')); ok(!$('pnView').classList.contains('on')&&$('pnView').textContent===''&&$('pnShowBtn').textContent==='SHOW PLATE','plates: editing the words removes the plate from the screen');
    // reading back
    $('phrase').value=''; $('pnRdFmt').value='num'; w.pnRdLayout();
    for(const [b,txt] of [[10,'1020 2016 1791 2040 1984 1534 2032 1920 1020 2016 1791 2041'],[16,'3FC 7e0 6FF 7F8 7C0 5FE 7F0 780 3FC 7E0 6FF 7F9'],[8,'1774,3740,3377,3770,3700,2776,3760,3600,1774,3740,3377,3771']]){
      $('phrase').value=''; $('pnRdBase').value=String(b); $('pnRdNums').value=txt; w.pnReadUi(); ok($('phrase').value===LW&&/^Done: 12 words are in the words box/.test($('pnRdStatus').textContent),'read back: '+({10:'decimal',16:'hexadecimal',8:'octal'})[b]+' word numbers fill the words box'); }
    $('pnRdBase').value='10'; $('pnRdNums').value='0 5'; w.pnReadUi(); ok(/^Number 1 is outside 1 to 2048/.test($('pnRdStatus').textContent)&&/bad/.test($('pnRdStatus').className),'read back: 0 is refused (numbers count from 1), and the number is named by place, not shown');
    $('pnRdBase').value='16'; $('pnRdNums').value='801'; w.pnReadUi(); ok(/outside 1 to 800 \(hexadecimal\)/.test($('pnRdStatus').textContent),'read back: hex 801 (2049) is refused');
    $('pnRdBase').value='8'; $('pnRdNums').value='1778'; w.pnReadUi(); ok(/^Number 1 is not an octal number/.test($('pnRdStatus').textContent),'read back: an 8 is not an octal digit');
    $('pnRdNums').value='1'; $('pnRdNums').dispatchEvent(new w.Event('input')); ok($('pnRdStatus').textContent==='','read back: typing again clears the old result');
    r.st.confirms=0; $('phrase').value='abandon'; $('pnRdBase').value='10'; $('pnRdNums').value='2048'; w.pnReadUi(); ok(r.st.confirms===1&&$('phrase').value==='zoo','read back: asks before replacing words already in the box');
    $('pnRdFmt').value='grid'; $('pnRdLen').value='12'; w.pnRdLayout();
    ok($('pnRdNums').style.display==='none'&&$('pnRdBase').style.display==='none'&&$('pnRdGrid').querySelectorAll('input[type=checkbox]').length===144,'read back: a binary grid of 12 rows x 12 holes to tick');
    const tick=(rr,c)=>{ const x=[...$('pnRdGrid').querySelectorAll('input')].find(e=>e.pnRow===rr&&e.pnCol===c); x.checked=true; x.dispatchEvent(new w.Event('change',{bubbles:true})); };
    nums.forEach((n,rr)=>w.pnBits(n).forEach((b,c)=>{ if(b) tick(rr,c); })); ok($('pnRdTicks').value!==''&&w.autoHasSecrets(),'read back: ticked holes count as a secret for auto-clear');
    $('phrase').value=''; w.pnReadUi(); ok($('phrase').value===LW,'read back: the ticked binary grid fills the words box');
    tick(0,0); w.pnReadUi(); ok(/^Row 1 adds up to more than 2048\. On a binary grid 2048 is punched alone/.test($('pnRdStatus').textContent),'read back: a grid row over 2048 is refused');
    $('pnRdFmt').value='stack'; w.pnRdLayout(); ok($('pnRdGrid').querySelectorAll('input[type=checkbox]').length===168&&$('pnRdTicks').value==='','read back: the Stackbit plate has 14 boxes a word, and the grid ticks do not carry over');
    ok(w.watchSigns().length===0,'read back: the tick boxes leave nothing the watch check would count as an extension\'s sign');
    nums.forEach((n,rr)=>{ const s=w.pnStack(n); w.eval('PN_SCOLS').forEach(([d,b],c)=>{ if(s[d].includes(b)) tick(rr,c); }); }); $('phrase').value=''; w.pnReadUi(); ok($('phrase').value===LW,'read back: the ticked Stackbit plate fills the words box');
    tick(0,8); tick(0,9); w.pnReadUi(); ok(/^Row 1: a digit adds up to more than 9/.test($('pnRdStatus').textContent),'read back: a Stackbit digit over 9 is refused');
    w.printPlateBlank('read'); ok(/^VOIDFORGE BLANK STACKBIT 1248 PLATE/.test(r.st.printHTML)&&r.st.printHTML.includes('12 words'),'read back: PRINT BLANK PLATE prints the chosen blank plate'); w.dispatchEvent(new w.Event('afterprint'));
    $('pnRdFmt').value='num'; w.pnRdLayout(); $('pnRdNums').value='1020'; w.clearAll(); await sleep(20);
    ok($('pnRdNums').value===''&&$('pnRdTicks').value===''&&$('pnRdGrid').querySelectorAll('input:checked').length===0&&$('pnRdStatus').textContent==='','CLEAR ALL empties the plate read-back boxes and ticks');
    $('pnRdFmt').value='grid'; w.pnRdLayout(); tick(3,3); $('pnRdNums').value='7'; ok(w.autoWipe('test')&&$('pnRdNums').value===''&&$('pnRdGrid').querySelectorAll('input:checked').length===0,'auto-clear wipes the plate read-back boxes and ticks');
    ok(w.eval('AUTO_FIELDS').includes('pnRdNums')&&w.eval('AUTO_FIELDS').includes('pnRdTicks'),'auto-clear knows the read-back boxes');
    // inheritance documents and the bag log
    const pr=async k=>{ await w.printInherit(k); const t=r.st.printHTML; w.dispatchEvent(new w.Event('afterprint')); return t; };
    w.planClear(); $('plFp').value='73c5da0a'; $('plApp').value='Sparrow'; $('plBorn').value='2026-01-02'; $('plPass').value='away'; $('plW1').value='home safe'; $('plM2').value='metal'; $('plW2').value='bank box';
    $('plOwner').value='Ann Example'; $('plHeir').value='Ben Example'; $('plLawyer').value='C. Lawyer'; $('plWhere').value='with my will';
    let t=await pr('letter'); ok(/^VOIDFORGE LETTER FOR THE EXECUTOR/.test(t)&&/To:    C\. Lawyer/.test(t)&&/From:  Ann Example/.test(t)&&/self-custody wallet/.test(t)&&/Nobody needs the words to settle the estate/.test(t)&&/kept are at: with my will/.test(t)&&/Beware of scams/.test(t)&&/separate passphrase/.test(t),'inheritance: the letter for the executor says what exists, where the steps are, that the words are not needed, and warns of scams');
    t=await pr('heir'); ok(/^VOIDFORGE RECOVERY STEPS FOR THE HEIR/.test(t)&&/For: Ben Example/.test(t)&&/master fingerprint must be 73c5da0a/.test(t)&&/Use the wallet app or device: Sparrow, on a computer you trust/.test(t)&&/made on 2026-01-02 \(its birthday\)/.test(t)&&/with the passphrase \(kept on a separate note away from home\)/.test(t)&&/I FOUND A BITCOIN BACKUP/.test(t),'inheritance: the heir\'s steps use the plan\'s app, fingerprint, birthday and passphrase note');
    t=await pr('contacts'); ok(/^VOIDFORGE TRUSTED CONTACTS/.test(t)&&/What they must never be given/.test(t),'inheritance: the trusted contacts sheet has the four columns');
    t=await pr('bags'); ok(/^VOIDFORGE TAMPER-EVIDENT BAG LOG/.test(t)&&/1\. PaperAt home: home safe/.test(t)&&/2\. MetalAway from home: bank box/.test(t)&&/Bag serial number/.test(t)&&/Seal intact\?Serial matches\?/.test(t)&&t.includes('Next check-up due: '+w.plusYearISO(w.todayISO()))&&/assume someone has seen the words/.test(t),'bag log: one row for each copy, serials, check-ups with seal and serial columns, and the next check-up date');
    t=await pr('keys'); ok(/^VOIDFORGE KEY DETAILS \(PUBLIC\)/.test(t)&&/No wallet is open in CHECK A BACKUP/.test(t)&&/Master fingerprint:      73c5da0a/.test(t),'key details: with no wallet open, blank lines and a note');
    ok(/^VOIDFORGE (LETTER|RECOVERY|TRUSTED|TAMPER|KEY)/.test(t)&&!/legal|winner/.test(t),'inheritance: no seed words on the sheets');
    // with the wallet open: public data only, 10 + 10 addresses, and the decoy fingerprint without the passphrase
    const AB='abandon '.repeat(11)+'about'; $('phrase').value=AB; $('verifyPass').value='TREZOR'; await w.verify(); for(let i=0;i<300&&!(w.eval('wvCtx')&&w.eval('wvCtx.shown'));i++) await sleep(20);
    const fpT=(await w.mnemonicFingerprint(AB,'TREZOR')); $('plFp').value=fpT;
    t=await pr('keys'); const {HDKey}=require('@scure/bip32'), {mnemonicToSeedSync}=require('@scure/bip39'), root=HDKey.fromMasterSeed(mnemonicToSeedSync(AB,'TREZOR'));
    ok(t.includes('Master fingerprint:      '+fpT+' (with the passphrase)')&&/Without the passphrase:  73c5da0a/.test(t)&&/Address type:            Native SegWit/.test(t)&&/Account path:            m\/84'\/0'\/0'/.test(t)&&t.includes(w.eval('wvCtx.shown.sheet.recv[9].address'))&&t.includes(w.eval('wvCtx.shown.sheet.change[9].address'))&&/Descriptor, receive: wpkh\(\[/.test(t)&&!t.includes('TREZOR')&&!t.includes(root.derive("m/84'/0'/0'").privateExtendedKey),'key details: the open wallet\'s fingerprints, address type, path, 10 + 10 addresses and watch-only descriptors; never the passphrase or a private key');
    $('plFp').value='deadbeef'; t=await pr('keys'); ok(/another fingerprint than this plan/.test(t)&&!t.includes(fpT),'key details: a wallet with another fingerprint than the plan is left out');
    // the print guard: no secrets in any box, a well-formed fingerprint
    const p1=r.st.printed; $('plFp').value='73c5da0a'; $('plOwner').value=AB; await w.printInherit('letter'); ok(r.st.printed===p1&&/^Not printed: the boxes hold what looks like seed words/.test($('ihStatus').textContent),'inheritance: refuses to print while a box holds seed words');
    $('plOwner').value='Ann'; $('plWhere').value='passphrase: hunter2'; await w.printInherit('bags'); ok(r.st.printed===p1&&/a passphrase or password/.test($('ihStatus').textContent),'bag log: refuses to print a passphrase');
    $('plWhere').value='safe'; $('plFp').value='xyz'; await w.printInherit('contacts'); ok(r.st.printed===p1&&/^The master fingerprint is 8 letters/.test($('ihStatus').textContent),'inheritance: the fingerprint must be 8 hex digits');
    $('plFp').value='73c5da0a'; $('plFp').dispatchEvent(new w.Event('input')); ok($('ihStatus').textContent==='','inheritance: editing a box clears the old message');
    await w.printInherit('heir'); w.dispatchEvent(new w.Event('afterprint')); ok(/^Sent to the printer/.test($('ihStatus').textContent),'inheritance: says when it was sent');
    w.planClear(); ok(['plOwner','plHeir','plLawyer','plWhere'].every(id=>$(id).value==='')&&$('ihStatus').textContent==='','backup plan CLEAR also empties the inheritance boxes');
    ok(['Binary grid (TinySeed)','Stackbit 1248','Word number','Tamper-evident bag','Inheritance documents'].every(n=>html.includes('["'+n+'", ')),'dictionary: Binary grid (TinySeed), Stackbit 1248, Word number, Tamper-evident bag and Inheritance documents');
    ok(/A changed serial or a broken seal means: assume the backup was seen/.test($('planBox').textContent)&&/photograph the sealed bag, never the words/.test($('planBox').textContent),'bag note: on screen, how to use tamper-evident bags');
    r.w.close(); })();
  // v2.10.0 END
  // v2.10.0: old Electrum seeds (expected values from Electrum's own source and tests at commit 54ff65d, tests/fixtures/old-electrum.json
  // made by tests/fixtures/gen_old_electrum.py; also Node's SHA-256 and @noble/curves) and damaged words in Reforge
  sweep(t);
  await (async()=>{ const OE=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','old-electrum.json'),'utf8'));
    const {secp256k1}=require('@noble/curves/secp256k1'); const {ripemd160:rmd}=require('@noble/hashes/ripemd160');
    const {createBase58check}=require('@scure/base'), {sha256:nsha}=require('@noble/hashes/sha256'), b58c=createBase58check(nsha);
    const r=load(); await r.ready(); const w=r.w, $=r.$, sleep=ms=>new Promise(res=>setTimeout(res,ms));
    const OLD=OE.wallets[0].words, BOTH='like just love know never want time there make eye only eye';
    // the word list and the decoding, as in Electrum's old_mnemonic.py
    ok(JSON.stringify(w.eval('OLD_EL_WORDS'))===JSON.stringify(OE.words)&&OE.words_sha256==='c8da327d316f8ee758b790068e618077ac271a89fd77ec1250c59ae40e7b599e','old Electrum: the page has the 1626 words of Electrum\'s old_mnemonic.py, in order (its SHA-256 is checked by the self-test)');
    eq(w.oldElSeed(OE.mnemonic_vector.words).hex,OE.mnemonic_vector.hex,'old Electrum: words to hex seed (Electrum\'s test_mnemonic.py vector)');
    ok(OE.seed_types.every(([t,ty])=>!!w.oldElSeed(t)===(ty==='old')),'old Electrum: Electrum\'s own seed-type cases ('+OE.seed_types.length+': capitals and extra spaces ignored, 24 words accepted, a word not on the list refused)');
    ok(!w.oldElSeed(Array(18).fill('like').join(' '))&&!!w.oldElSeed(Array(24).fill('like').join(' '))&&!w.oldElSeed('not a seed'),'old Electrum: 12 or 24 words only, as is_old_seed');
    // Node's SHA-256 against the page's own (used for the 100,000-round stretch), on lengths around every block boundary
    { let bad=0; for(let n=0;n<=300;n++){ const m=nc.randomBytes(n); if(Buffer.from(w.oldElSha256(new Uint8Array(m))).toString('hex')!==nc.createHash('sha256').update(m).digest('hex')) bad++; } ok(bad===0,'old Electrum: the page\'s SHA-256 equals Node\'s on messages of 0 to 300 bytes'); }
    // Electrum's test wallets, then six more wallets worked out from Electrum's own functions (10 receive and 10 change each)
    for(const v of OE.wallets){ const K=w.oldElKeys(w.oldElSeed(v.words).hex); ok(w.oldElSeed(v.words).hex===v.hex&&w.hex(K.mpk)===v.mpk&&await w.oldElAddr(K,0,0,'main')===v.receive0&&await w.oldElAddr(K,1,0,'main')===v.change0,'old Electrum: '+v.test+' (Electrum\'s test wallet): hex seed, master public key, first receive and change address'); }
    { let bad=0; for(const c of OE.cases){ const oe=w.oldElSeed(c.words), K=w.oldElKeys(oe.hex); if(oe.hex!==c.hex||w.hex(K.mpk)!==c.mpk||JSON.stringify(await w.oldElAddresses(K,0,0,10,'main'))!==JSON.stringify(c.receive)||JSON.stringify(await w.oldElAddresses(K,1,0,10,'main'))!==JSON.stringify(c.change)) bad++; }
      ok(bad===0,'old Electrum: '+OE.cases.length+' more wallets (one of 24 words) give the same hex seed, master public key and 10+10 addresses as Electrum\'s own functions'); }
    { const K=w.oldElKeys(OE.testnet.hex); ok(JSON.stringify(await w.oldElAddresses(K,0,0,10,'test'))===JSON.stringify(OE.testnet.receive),'old Electrum: testnet addresses (m.../n...) for practice mode'); }
    { // independent: Node's SHA-256 for the stretch and @noble/curves for the points
      const hx=nc.randomBytes(16).toString('hex'), e=Buffer.from(hx,'ascii'); let x=e; for(let i=0;i<100000;i++) x=nc.createHash('sha256').update(Buffer.concat([x,e])).digest();
      const M=secp256k1.ProjectivePoint.BASE.multiply(BigInt('0x'+x.toString('hex'))), mpk=Buffer.from(M.toRawBytes(false)).subarray(1), K=w.oldElKeys(hx);
      const z=BigInt('0x'+nc.createHash('sha256').update(nc.createHash('sha256').update(Buffer.concat([Buffer.from('7:1:'),mpk])).digest()).digest('hex'))%secp256k1.CURVE.n;
      const a=b58c.encode(Uint8Array.from([0,...rmd(nsha(M.add(secp256k1.ProjectivePoint.BASE.multiply(z)).toRawBytes(false)))]));
      ok(w.hex(K.mpk)===mpk.toString('hex')&&await w.oldElAddr(K,1,7,'main')===a,'old Electrum: a random seed\'s master public key and change address #7 equal Node\'s SHA-256 with @noble/curves'); }
    // where a phrase is read
    { let c=await w.checkPhrase(OLD); ok(!c.ok&&/^Old Electrum seed: these 12 words/.test(c.msg)&&/Seed Type: old/.test(c.msg)&&c.oldElectrum.hex===OE.wallets[0].hex,'old Electrum: checkPhrase names an old Electrum seed and how to open it in Electrum');
      c=await w.checkPhrase(OE.seed_types[2][0]); ok(!c.ok&&/^Unknown word/.test(c.msg)&&!c.oldElectrum,'old Electrum: one word off the old list is not an old seed (Electrum\'s own case)');
      c=await w.checkPhrase(BOTH); ok(c.ok&&/also an old Electrum seed/.test(c.msg)&&!!c.oldElectrum&&c.mnemonic===BOTH,'old Electrum: words valid both ways are a BIP39 phrase and an old Electrum seed');
      c=await w.checkPhrase('them always world friend tell try hand thought over other need know'); ok(!c.ok&&!!c.oldElectrum,'old Electrum: words that are BIP39 only when "them" is read as "theme" are an old seed, as Electrum reads them');
      c=await w.checkPhrase('abandon '.repeat(11)+'about'); ok(c.ok&&!c.oldElectrum,'old Electrum: an ordinary BIP39 phrase is not called old'); }
    { $('phrase').value=OLD; $('verifyPass').value='pw'; await w.verify(); const s=$('verifyStatus'), rec=$('oeOut').textContent;
      ok(/^Old Electrum seed/.test(s.textContent)&&/ok/.test(s.className)&&$('oeBlock').style.display===''&&$('oeSeed').textContent==='Seed (hex): '+OE.wallets[0].hex,'VERIFY: an old Electrum seed shows its hex seed in the SECRET box');
      ok(rec.includes(OE.wallets[0].mpk)&&rec.includes(' 0:  '+OE.wallets[0].receive0)&&rec.includes(' 0:  '+OE.wallets[0].change0)&&(rec.match(/^ +\d+:  1/gm)||[]).length===20,'VERIFY: an old Electrum seed lists its master public key and 10 receive and 10 change addresses');
      ok(/no passphrase/.test($('oeNote').textContent)&&/Seed Type: old/.test($('oeNote').textContent),'VERIFY: a typed passphrase is said to be unused (old seeds have none), with how to open it in Electrum');
      ok(/#oeSeed \{ -webkit-user-select: none; user-select: none; \}/.test(html)&&!$('oeBlock').querySelector('button')&&/SECRET/.test($('oeBlock').querySelector('h3').textContent),'VERIFY: the old Electrum seed is marked SECRET, cannot be selected and has no COPY button');
      $('phrase').dispatchEvent(new w.Event('input')); ok($('oeBlock').style.display==='none'&&$('oeSeed').textContent===''&&$('oeOut').textContent==='','VERIFY: editing the words clears the old Electrum result');
      $('verifyPass').value=''; await w.verify(); w.wipeSeed(); ok($('oeSeed').textContent===''&&$('oeBlock').style.display==='none','CLEAR ALL and auto-clear (wipeSeed) clear the old Electrum seed');
      $('phrase').value=OLD; await w.verify(); w.practiceMode(true); await sleep(20); ok($('oeSeed').textContent==='','practice mode: turning it on clears the old Electrum result');
      await w.verify(); ok(/TESTNET \(practice coins only\)/.test($('oeOut').textContent)&&(($('oeOut').textContent.match(/^ +\d+:  [mn]/gm)||[]).length===20),'practice mode: old Electrum addresses are testnet ones (m... or n...)');
      w.practiceMode(false); $('phrase').value=BOTH; await w.verify();
      ok(/also an old Electrum seed/.test($('verifyStatus').textContent)&&/fingerprint/.test($('verifyStatus').textContent)&&/BOTH a valid BIP39 phrase and an old Electrum seed/.test($('oeNote').textContent)&&/BIP39 seed in its Options/.test($('oeNote').textContent)&&/^Seed \(hex\)/.test($('oeSeed').textContent),'VERIFY: words valid both ways show the BIP39 wallet and the old Electrum one, and say how Electrum decides');
      w.setGate('fail','SELF-TEST FAILED','bad'); r.st.alerts.length=0; $('phrase').value=OLD; $('phrase').dispatchEvent(new w.Event('input')); await w.verify(); ok(r.st.alerts.length===1&&$('oeSeed').textContent==='','gate: with a failed self-test, VERIFY shows no old Electrum wallet'); w.setGate('pass','SELF-TEST PASSED','good'); }
    { // Wallet Detective
      const D=async(a,pw)=>{ $('phrase').value=OLD; $('verifyPass').value=pw||''; $('detAddr').value=a; await w.detFind(); return [$('detStatus').textContent,$('detOut').textContent]; };
      const c=OE.cases[0]; $('phrase').value=c.words; $('verifyPass').value=''; $('detAddr').value=c.change[3]; await w.detFind();
      ok(/receive|change/.test($('detOut').textContent)&&/^FOUND: \S+ is change address #3 \(m\/1\/3\) of these words, without a passphrase\./.test($('detOut').textContent)&&/an old Electrum seed \(made before Electrum 2\.0, not BIP39\)/.test($('detOut').textContent)&&/Seed Type: old/.test($('detOut').textContent),'Wallet Detective: finds an old Electrum change address, names the seed type and how to open it in Electrum');
      let [st,out]=await D(OE.wallets[0].receive0,'pw'); ok(/receive address #0 \(m\/0\/0\) of these words, without a passphrase/.test(out)&&/no passphrase, so Electrum does not ask/.test(out),'Wallet Detective: with a passphrase typed, an old Electrum address is found without it');
      [st,out]=await D(OE.wallets[1].receive0); ok(/^NOT FOUND/.test(st)&&/the old Electrum wallet: the first 100 receive and change addresses/.test(st),'Wallet Detective: an address of another old wallet is NOT FOUND, and the old Electrum search is named');
      $('phrase').value=OLD; $('verifyPass').value=''; await w.detList(); ok($('detOut').textContent.includes('Old Electrum seed, legacy (1...), m/0/0 (uncompressed keys')&&$('detOut').textContent.includes(OE.wallets[0].receive0),'Wallet Detective: LIST FIRST ADDRESSES includes the old Electrum wallet');
      $('phrase').value=BOTH; $('detAddr').value=(await w.oldElAddresses(w.oldElKeys(w.oldElSeed(BOTH).hex),0,5,1,'main'))[0]; await w.detFind(); ok(/receive address #5 \(m\/0\/5\)/.test($('detOut').textContent)&&/old Electrum seed/.test($('detOut').textContent),'Wallet Detective: words valid both ways search the old Electrum wallet too');
      $('phrase').value=''; $('detAddr').value=''; w.detClear(); }
    { ok(/12 words from an Electrum wallet made before version 2\.0<\/b>: an old Electrum seed/.test(html),'Heir mode: says what an old Electrum seed is');
      const e=await w.explainAddress(OLD); ok(e&&/SEED WORDS/.test(e.text),'Explain an address: old Electrum words pasted by mistake are called seed words');
      ok(/\["Old Electrum seed"/.test(html)&&/\["Master public key \(old Electrum\)"/.test(html)&&/\["Damaged word"/.test(html),'dictionary: Old Electrum seed, Master public key (old Electrum), Damaged word'); }
    // ---- Reforge: damaged words ----
    { const W=require('@scure/bip39/wordlists/english').wordlist;
      const fits=(p,x)=>{ const go=(i,j)=>{ if(i===p.length) return j===x.length; if(p[i]==='*'){ for(let k=j;k<=x.length;k++) if(go(i+1,k)) return true; return false; } return j<x.length&&(p[i]==='?'||p[i]===x[j])&&go(i+1,j+1); }; return go(0,0); };   // a matcher without regular expressions
      const ref=p=>/^\?+$/.test(p)?W.slice():W.filter(x=>fits(p,x)||(!p.includes('*')&&p.length>=4&&x.length>p.length&&fits(p,x.slice(0,p.length))));   // only ? marks: any word (review fix)
      const P=['c?ar','ch?ir','ab*','a?t','*ount','s?','????','?r?d','c*ar*','*','z*','abando?','a*a*a','??','???','bri?k','*e'];
      ok(P.every(p=>JSON.stringify(w.reforgePatternWords(p))===JSON.stringify(ref(p))),'Reforge: ? is one letter and * any number (also none); 4 or more characters without * also fit longer words (checked against a second matcher on '+P.length+' patterns)');
      eq(w.reforgePatternWords('c?ar').join(' '),'charge clarify','Reforge: c?ar fits charge and clarify (the first 4 letters are enough)');
      const pw=w.reforgeParseWords('ch?ir ab* zz?x ? '+'abandon '.repeat(7)+'ab?ut');
      ok(pw.idx[0]===W.indexOf('chair')&&pw.sets[1].length===10&&!pw.sets[2]&&pw.idx[2]===-1&&!pw.sets[3]&&pw.idx[11]===W.indexOf('about')&&pw.notes.some(n=>/word 2 'ab\*' fits 10 words$/.test(n))&&pw.notes.some(n=>/word 3 'zz\?x' fits no BIP39 word, so it is treated as unknown/.test(n))&&pw.notes.some(n=>/'ch\?ir' as 'chair'/.test(n)),'Reforge: each damaged word says how many words fit it; one fit is read as that word, none counts as unknown');
      { const p=w.reforgeParseWords('abandon '.repeat(9)+'ab* c?ar a?t'), pl=w.reforgePlan(p.idx,p.sets), seen=new Set(); let n=0; for(const c of pl.gen()){ n++; seen.add(Array.from(c).join(',')); }
        ok(pl.total===40&&n===40&&seen.size===40&&[...seen].every(s=>{ const v=s.split(',').map(Number); return ['ab','c','a'].every((q,k)=>W[v[9+k]].startsWith(q)); }),'Reforge: the damaged-word plan tries every combination exactly once (10 x 2 x 2 = 40)'); }
      const RF=async(x,chk)=>{ $('reforgeWordsInput').value=x; $('reforgeWordsCheck').value=chk||''; $('reforgeWordsPass').value=''; await w.reforgeWords(); return [$('reforgeStatus').textContent,$('reforgeStatus').className,$('reforgeOut').textContent]; };
      let [st,cl,out]=await RF('abandon '.repeat(9)+'? ? ab*'); ok(/^That is 41,943,040 phrases to try \(word 10: 2048, word 11: 2048, word 12: 10\)\. Reforge tries at most 4,194,304/.test(st)&&/bad/.test(cl)&&out==='','Reforge: damaged words are counted first and a search over the limit is refused politely');
      [st,cl,out]=await RF('abandon '.repeat(11)+'ab*'); ok(/^1 word fits at position 12/.test(st)&&out==='about','Reforge: one damaged word and nothing to check against lists the words that fit');
      [st,cl,out]=await RF('abandon '.repeat(8)+'ab?ndon aban*on a?a* ab*'); ok(/^\d+ phrases? fits? the letters you read and pass the checksum \(of 110 combinations\)/.test(st)&&/Phrase 1:/.test(out)&&/ok/.test(cl),'Reforge: a few phrases that pass the checksum are listed when nothing is given to check against');
      [st,cl,out]=await RF('abandon '.repeat(9)+'ab* c?ar ?'); ok(/^2,560 of the 40,960 combinations .* pass the checksum: too many to list \(more than 20\)/.test(st)&&out==='','Reforge: too many phrases to list asks for something to check against');
      // a random wallet with three damaged words, found with its fingerprint and with one of its addresses. The wallet comes from a
      // seeded stream (VF_SEED; by default seeds 1 and 2): its entropy is the first 16 bytes of SHA-256 of 'reforge damaged <seed>',
      // so a failure names its seed and VF_SEED=<seed> replays it. Word 2 is damaged to its first 2 letters and *: for 34 words
      // (rhythm, oyster, ugly ...) no other word starts with those 2 letters, so Reforge reads it as that word ("read word 2 'rh*'
      // as 'rhythm'") and does not list it as changed. Seed 1 is such a wallet (rh*), seed 2 is not (fa*: 22 words). Word 11
      // keeps 3 letters and ends in ?, one letter: a 3-letter word (103 of them, such as van) keeps 2, as van? fits no 3-letter word.
      for(const seed of process.env.VF_SEED?[process.env.VF_SEED]:['1','2']){ const {entropyToMnemonic,mnemonicToSeedSync}=require('@scure/bip39'); const {HDKey}=require('@scure/bip32');
        const m=entropyToMnemonic(nc.createHash('sha256').update('reforge damaged '+seed).digest().subarray(0,16),W).split(' '), root=HDKey.fromMasterSeed(mnemonicToSeedSync(m.join(' '),'')), fpx=root.fingerprint.toString(16).padStart(8,'0');
        const dm=m.slice(); dm[1]=m[1].slice(0,2)+'*'; dm[5]='?'+m[5].slice(1); dm[10]=m[10].slice(0,Math.min(3,m[10].length-1))+'?';
        const one=ref(dm[1]).length===1, w2=(st,out)=>one?st.includes("word 2 '"+dm[1]+"' as '"+m[1]+"'")&&!/word 2 \(/.test(out):out.includes('word 2 ('+dm[1]+') is '+m[1]), tag=' (seed '+seed+': '+dm[1]+', '+dm[5]+', '+dm[10]+(one?'; '+dm[1]+' fits only '+m[1]:'')+'; replay with VF_SEED='+seed+')';
        [st,cl,out]=await RF(dm.join(' '),fpx); ok(/^FOUND/.test(st)&&out.includes(m.map((x,i)=>(i+1)+'. '+x).join('   '))&&w2(st,out),'Reforge: a random wallet with three damaged words is found by its fingerprint'+tag);
        const {bech32}=require('@scure/base'), ad=bech32.encode('bc',[0,...bech32.toWords(rmd(nsha(root.derive("m/84'/0'/0'/0/3").publicKey)))]);
        [st,cl,out]=await RF(dm.join(' '),ad); ok(/^FOUND and confirmed/.test(st)&&/receive address #3/.test(out)&&out.includes(m.map((x,i)=>(i+1)+'. '+x).join('   '))&&w2(st,out),'Reforge: ... and by one of its addresses'+tag); }
      { $('reforgeWordsInput').value='c??? ? '+'abandon '.repeat(10); $('reforgeWordsCheck').value='73c5da0a';
        const run=w.reforgeWords(); await sleep(300); const busy=$('reforgeWordsBtn').disabled&&!$('reforgeStopBtn').disabled; w.reforgeStop(); await run;
        ok(busy&&/^STOPPED in step 1 after checking [\d,]+ of 370,688 phrases; nothing was compared yet\. The search is NOT complete/.test($('reforgeStatus').textContent)&&!$('reforgeWordsBtn').disabled,'Reforge: a damaged-word search shows progress and STOP ends it'); }
      [st]=await RF('abandon '.repeat(10)+'ab*'); ok(/^A damaged word \(with \? or \* inside it\) can be searched only with all the words in place/.test(st),'Reforge: a damaged word with one word missing is refused with the reason');
      await RF('abandon '.repeat(11)+'ab*'); $('reforgeWordsInput').dispatchEvent(new w.Event('input')); ok($('reforgeOut').textContent===''&&$('reforgeStatus').textContent==='','Reforge: editing the words clears a damaged-word result');
      ok(/<b>Damaged backup:<\/b> inside a word, <code>\?<\/code> is one letter you cannot read and <code>\*<\/code> any number of them/.test(html),'Reforge: one help line explains ? and * inside a word'); }
    // fixes from the v2.10.0 review
    eq(await w.planSecret('Kept with the lawyer: '+OLD),'seed words','review fix: the plan print guard refuses an old Electrum seed in words');
    ok(/hex/.test(await w.planSecret('seed '+OE.wallets[0].hex))&&await w.planSecret('In the top drawer of the desk at home; ask my sister Ann for the key.')==='','review fix: and its 32 hex digits, but not ordinary text');
    { $('phrase').value=OLD; $('verifyPass').value=''; $('verifyRecorded').value=OE.wallets[0].receive0; await w.verify(); const m1=$('verifyMatch').textContent;
      $('verifyRecorded').value=OE.wallets[0].change0; await w.verify(); const m2=$('verifyMatch').textContent;
      $('verifyRecorded').value='1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'; await w.verify(); const m3=$('verifyMatch').textContent, c3=$('verifyMatch').className; $('verifyRecorded').value='';
      ok(/^MATCH: this is receive address 0 of the old Electrum wallet/.test(m1)&&/^MATCH: this is change address 0/.test(m2)&&/^NO MATCH/.test(m3)&&/bad/.test(c3),'review fix: VERIFY compares what the wallet app shows with an old Electrum wallet'); }
    ok(w.reforgePatternWords('???').length===2048&&w.reforgePatternWords('????').length===2048&&w.reforgePatternWords('wr???').includes('wrong')&&w.reforgePatternWords('wr???').length<10,'review fix: a word written only as ??? is any word, not a 3-letter word');
    r.w.close(); })();
  // v2.10.0: 15, 18 and 21 words for every method, and the Card method menu (Ian Coleman, hashed or raw entropy).
  // Expected words come from @scure/bip39 and Node's SHA-256; the raw-entropy answers come from Ian Coleman's own code at commit
  // de71c22 (tests/coleman.test.mjs runs that code on random decks).
  sweep(t);
  await (async()=>{ const {entropyToMnemonic,validateMnemonic}=require('@scure/bip39'); const {wordlist}=require('@scure/bip39/wordlists/english');
    const r=load(); await r.ready(); const w=r.w, $=r.$, first=()=>$('genResult').textContent.split('\n')[0];
    const len=n=>{ $('wordSel').value=String(n); $('wordSel').dispatchEvent(new w.Event('change')); };
    const sha=t=>nc.createHash('sha256').update(t,'utf8').digest(), SU={C:'♣',D:'♦',H:'♥',S:'♠'}, cs=t=>t.split(' ').map(x=>x[0]+SU[x[1]]).join(' ');
    const deck=()=>{ const d=[]; for(const su of 'CDHS') for(const k of 'A23456789TJQK') d.push(k+su); for(let i=d.length-1;i>0;i--){ const j=nc.randomInt(i+1); [d[i],d[j]]=[d[j],d[i]]; } return d; };
    eq([...$('wordSel').options].map(o=>o.value).join(' '),'12 15 18 21 24','lengths: the Seed length menu offers 12, 15, 18, 21 and 24 words');
    const RN={12:50,15:62,18:75,21:87,24:99};
    for(const n of [12,15,18,21,24]){
      w.setMethod('dice'); len(n); eq(w.getNeeded(n),RN[n],'lengths: '+n+' words need '+RN[n]+' dice rolls (fewest rolls reaching '+n*32/3+' bits; 99 for 24 words, as SeedSigner and Coldcard)');
      r.set(rnd(RN[n]-1)); eq($('rollCount').textContent,(RN[n]-1)+' / '+RN[n]+' rolls','lengths: the roll counter counts to '+RN[n]+' for '+n+' words');
      await w.generate(); ok(!w.hasSeed(),'lengths: '+(RN[n]-1)+' rolls are too few for '+n+' words');
      const R=rnd(RN[n]+3); r.set(R); await w.generate();
      eq(first(),entropyToMnemonic(sha(R).subarray(0,n*4/3),wordlist),'lengths: '+n+'-word dice seed = first '+n*32/3+' bits of SHA-256 of the rolls (from @scure)');
      ok($('wordGrid').children.length===n&&$('explainBox').style.display===''&&($('seedQrBox').style.display==='')===(n===12||n===24)&&($('sqNone').style.display==='')===(n%12!==0),'lengths: '+n+' words: the word grid, the steps box and '+(n%12?'"No SeedQR exists" instead of the SeedQR box':'the SeedQR box'));
      if(n%12){ ok(/No SeedQR exists for \d+ words/.test($('sqNone').textContent),'lengths: '+n+' words: the page says SeedQR covers only 12 and 24 words');
        await w.showExplain(); ok(/match the seed above/.test($('exOut').textContent)&&!/CompactSeedQR/.test($('exOut').textContent),'lengths: "How your seed was made" works for '+n+' words, with no CompactSeedQR claim');
        ok(/12 or 24 words only, so they will not make these words/.test($('countNote').textContent)&&/12 or 24 words only/.test($('rulesNote').textContent),'lengths: '+n+' words: the page says SeedSigner, Coldcard and Keystone dice seeds will not match');
        ok(/Some wallets take only 12 or 24 words/.test($('lenNote').textContent),'lengths: '+n+' words: the note says to check the wallet takes that length'); }
      w.drillStart(); $('drillWords').value=first(); await w.drillCheck(); ok(/^Drill passed/.test($('drillStatus').textContent),'lengths: the restore drill passes for '+n+' words'); w.drillEnd();
      r.st.printCells=[]; w.printSeed(); ok(r.st.printCells.length===n,'lengths: PRINT SEED prints '+n+' words'); w.dispatchEvent(new w.Event('afterprint'));
      w.printStamp(); ok(r.st.printCells.length===n&&r.st.printCells[n-1].endsWith(first().split(' ')[n-1].slice(0,4).toUpperCase()),'lengths: the stamp sheet prints '+n+' words'); w.dispatchEvent(new w.Event('afterprint'));
      $('phrase').value=first(); await w.verify(); ok(new RegExp('^Valid '+n+'-word BIP39 phrase').test($('verifyStatus').textContent),'lengths: VERIFY accepts the '+n+'-word seed'); $('phrase').value='';
      w.printRollSheet(); ok(r.st.printCells.filter(c=>/^\d+$/.test(c)).length>=RN[n],'lengths: the roll sheet has '+RN[n]+' boxes for '+n+' words'); w.dispatchEvent(new w.Event('afterprint'));
      r.mode('coin'); w.setMethod('coin'); eq(w.getNeeded(n),n*32/3,'lengths: '+n+' words need '+n*32/3+' coin flips');
      const F=rnd(n*32/3,2); r.set(F); await w.generate(); eq(first(),entropyToMnemonic(sha(F).subarray(0,n*4/3),wordlist),'lengths: '+n+'-word coin seed (from @scure)');
      if(n%12) ok(/SeedSigner's coin-flip code makes only 12 or 24 words/.test($('countNote').textContent),'lengths: '+n+' coin flips: the page says SeedSigner\'s coin code makes only 12 or 24 words');
      r.set(''); r.mode('dice');
      // Word draw: words - 1 drawn words and 11 - words/3 flips
      w.setMethod('words'); len(n); const need=w.wdNeeds(n); eq(need.words+'/'+need.flips,(n-1)+'/'+(11-n/3),'lengths: word draw for '+n+' words: '+(n-1)+' drawn words and '+(11-n/3)+' coin flips');
      const idx=Array.from({length:n-1},()=>nc.randomInt(2048)), fl=rnd(11-n/3,2); $('wdWords').value=idx.map(i=>wordlist[i]).join(' '); $('wdFlips').value=fl; w.wdUpdate(); await w.wdGenerate();
      const bits=idx.map(i=>i.toString(2).padStart(11,'0')).join('')+fl, ent=Buffer.from(bits.match(/.{8}/g).map(b=>parseInt(b,2)));
      eq(first(),entropyToMnemonic(ent,wordlist),'lengths: word draw '+n+' words: the drawn words and flips are the entropy (from @scure)');
      w.printWordSheet(); ok(r.st.printCells.length===n-1+11-n/3,'lengths: the word draw sheet has '+(n-1)+' word boxes and '+(11-n/3)+' flip boxes'); w.dispatchEvent(new w.Event('afterprint'));
      w.wdClear();
      // Cards, hashed: as many cards as cdBits needs, then SHA-256 of the card text, its first bits
      w.setMethod('cards'); $('cdMethod').value='hash'; $('cdMethod').dispatchEvent(new w.Event('change'));
      const CN={12:25,15:31,18:39,21:50,24:58}[n], D=deck().concat(deck()).slice(0,CN);
      ok(new RegExp('^'+(CN>52?'a whole shuffled deck, then '+(CN-52)+' more cards':CN+' cards from a shuffled deck')+'; or '+n*8/3+' hex digits').test($('lenNote').textContent),'lengths: cards hashed, '+n+' words: the note says '+CN+' cards or '+n*8/3+' hex digits');
      $('cdCards').value=D.slice(0,CN-1).join(' '); w.cdUpdate(); ok($('cdBtn').disabled,'lengths: '+(CN-1)+' cards are too few for '+n+' words (hashed)');
      $('cdCards').value=D.join(' '); w.cdUpdate(); ok(!$('cdBtn').disabled,'lengths: '+CN+' cards are enough for '+n+' words (hashed)');
      await w.cdGenerate(); eq(first(),entropyToMnemonic(sha(cs(D.join(' '))).subarray(0,n*4/3),wordlist),'lengths: cards hashed, '+n+' words = first '+n*32/3+' bits of SHA-256 of the card text, as Ian Coleman\'s tool with '+n+' words');
      w.printCardSheet(); ok(r.st.printCells.length===CN&&/Card method: Ian Coleman, hashed/.test(r.st.printHTML),'lengths: the card sheet has '+CN+' boxes for '+n+' words (hashed)'); w.dispatchEvent(new w.Event('afterprint'));
      // Hex: 8 hex digits per 3 words, no hashing
      const H=nc.randomBytes(n*4/3).toString('hex'); $('cdCards').value=''; $('cdHex').value=H; w.cdUpdate(); await w.cdHexGenerate();
      eq(first(),entropyToMnemonic(Buffer.from(H,'hex'),wordlist),'lengths: '+H.length+' hex digits are the entropy of a '+n+'-word seed (from @scure)');
      $('cdHex').value=H.slice(0,-1); w.cdUpdate(); ok($('cdHexBtn').disabled,'lengths: '+(H.length-1)+' hex digits are refused for '+n+' words'); $('cdHex').value='';
    }
    // Keystone dice rules only for 12 and 24 words
    w.setMethod('dice'); len(24); $('diceRules').value='keystone'; $('diceRules').dispatchEvent(new w.Event('change')); eq(w.getNeeded(24),100,'lengths: Keystone rules still ask 100 rolls for 24 words');
    len(18); ok($('diceRules').value==='std'&&$('diceRules').querySelector('option[value=keystone]').disabled&&!w.keystoneOn(),'lengths: 18 words turn the Keystone dice rules off (Keystone makes 12 or 24 words)');
    len(12); ok(!$('diceRules').querySelector('option[value=keystone]').disabled&&$('diceRules').value==='keystone','lengths: back at 12 words, the Keystone rules come back as they were chosen (review fix)');
    len(21); $('diceRules').value='std'; $('diceRules').dispatchEvent(new w.Event('change')); len(24); ok($('diceRules').value==='std','lengths: a rules choice made at 21 words is kept at 24');
    $('diceRules').value='std'; $('diceRules').dispatchEvent(new w.Event('change'));
    // Card method: raw entropy, known answers from Ian Coleman's own code
    const KS30='KS 3D 9H AC TC 5S JD 2H 8C QS 4D 7H 6C AH TS 9D 3C KH 5D JS 2S 8H QC 4H 7S AD 2D 3H 4C 5C';
    w.setMethod('cards'); len(12); ok($('cdRulesRow').style.display===''&&$('rulesRow').style.display==='none'&&$('cdMethod').value==='hash','card method: the menu shows on the Cards & hex tab, hashed by default');
    eq([...$('cdMethod').options].map(o=>o.textContent).join(' | '),'Ian Coleman, hashed (every card counts) | Ian Coleman, raw entropy','card method: the two choices');
    $('cdCards').value=KS30; w.cdUpdate(); await w.cdGenerate(); const hashed=first();
    $('cdMethod').value='raw'; $('cdMethod').dispatchEvent(new w.Event('change')); ok(!w.hasSeed()&&/card method/.test($('genResult').textContent),'card method: changing it after FORGE SEED clears the old words');
    ok(/26 to 32 cards from a shuffled deck, depending on the cards; or 32 hex digits/.test($('lenNote').textContent),'card method: raw, 12 words: 26 to 32 cards');
    ok(/^Enough cards: 30\. Press FORGE SEED\. Raw entropy keeps the last 128 of the 131 bits these cards give \(the first 3 are dropped\), so the words hold at most 128 bits/.test($('cdCount').textContent)&&!$('cdBtn').disabled,'card method: raw shows the bits kept and dropped, and the honest strength');
    await w.cdGenerate(); eq(first(),'velvet beach salute key actual earn charge fix quick stove swing silk','card method: raw, 30 cards, 12 words = Ian Coleman\'s tool with Use Raw Entropy');
    ok(first()!==hashed,'card method: raw and hashed give different words for the same cards');
    ok(/^Strength: the words hold at most 128 bits of randomness \(raw entropy keeps the last 128 of the 131 bits/.test(w.seedSummary().lines[2])&&/raw entropy: his card table, no hashing/.test(w.seedSummary().lines[1]),'card method: the summary sheet says raw entropy and at most 128 bits');
    r.st.blob=null; w.downloadSeed(); const dl=r.st.blob?await blobText(w,r.st.blob):''; ok(/Card method: Ian Coleman, raw entropy/.test(dl),'card method: DOWNLOAD names the raw card method');
    $('cdCards').value=KS30.split(' ').slice(0,29).join(' '); w.cdUpdate(); ok($('cdBtn').disabled&&/^29 cards so far: 126 of the 128 bits 12 words need/.test($('cdCount').textContent),'card method: raw, 29 cards (126 bits) are not enough for 12 words');
    const D2=deck(); $('cdCards').value=D2.join(' '); w.cdUpdate(); ok($('cdBtn').disabled&&/Too many cards for 12 words: with raw entropy, Ian Coleman's tool makes 21 words from these 52 cards \(232 bits\)\. .*choose 21 words above/.test($('cdMsg').textContent),'card method: raw, a whole deck for 12 words: too many cards, it says 21 words');
    len(21); ok(!$('cdBtn').disabled&&/keeps the last 224 of the 232 bits/.test($('cdCount').textContent)&&/at most 224 bits/.test($('cdCount').textContent)&&/hold about 225/.test($('cdCount').textContent),'card method: raw, a whole deck makes 21 words, at most 224 bits (225 dealt)');
    await w.cdGenerate(); ok(first().split(' ').length===21&&validateMnemonic(first(),wordlist),'card method: raw, 21 words from a whole deck');
    $('cdCards').value=D2.concat(D2,D2).join(' '); len(24); w.cdUpdate(); ok(/more than the 24 of any standard seed/.test($('cdMsg').textContent)&&$('cdBtn').disabled,'card method: raw refuses more than 24 words');
    $('cdCards').value=D2.concat(['AC','2C','3C','4C','5C']).join(' '); w.cdUpdate(); ok(!$('cdBtn').disabled&&/at most 25\d bits/.test($('cdCount').textContent),'card method: raw, a deck and 5 more make 24 words; the strength counts the cards actually dealt');
    w.printCardSheet(); ok(r.st.printCells.length===60&&/Ian Coleman, raw entropy/.test(r.st.printHTML),'card method: raw card sheet for 24 words: a deck and up to 8 more boxes'); w.dispatchEvent(new w.Event('afterprint'));
    len(21); w.printCardSheet(); ok(r.st.printCells.length===52,'card method: raw card sheet for 21 words: a whole deck'); w.dispatchEvent(new w.Event('afterprint'));
    $('cdCards').value='AS 2C TD'; len(12); w.cdUpdate(); ok(/Use Raw Entropy \(3 words per 32 bits\)/.test($('cdBox').textContent)&&/same number of words/.test($('cdBox').textContent),'card method: the help says which setting to choose in Ian Coleman\'s tool for each method');
    $('cdHex').value=nc.randomBytes(16).toString('hex'); w.cdUpdate(); await w.cdHexGenerate(); eq(first(),entropyToMnemonic(Buffer.from($('cdHex').value,'hex'),wordlist),'card method: hex is not affected by the card method');
    $('cdHex').value='ab'.repeat(24); w.cdUpdate(); ok(/48 hex digits make an 18-word seed: choose 18 words above/.test($('cdMsg').textContent),'hex: 48 digits with 12 words chosen ask for 18 words');
    w.clearAll(); $('cdMethod').value='hash'; w.cdUpdate();
    ok(/\["Raw entropy \(cards\)"/.test(html)&&/\["Seed length"/.test(html),'dictionary: Raw entropy (cards) and Seed length');
    ok(r.errors.length===0,'lengths and card method: no page errors '+JSON.stringify(r.errors));
    r.w.close(); })();
  // v2.11.0: codex32 (BIP93) shares: check, combine and make (expected wallet from @scure/bip32 and btc-signer; the math itself
  // is checked against the BIP's vectors and three outside implementations in tests/codex32.test.mjs)
  sweep(t);
  await (async()=>{ const {HDKey}=require('@scure/bip32'); const btc=require('@scure/btc-signer');
    const r=load(); await r.ready(); const w=r.w, $=r.$, d=r.d;
    const mode=m=>{ d.querySelector('input[name=c32Mode][value='+m+']').checked=true; w.c32ModeChange(); };
    const A='MS12NAMEA320ZYXWVUTSRQPNMLKJHGFEDCAXRPP870HKKQRM', C='MS12NAMECACDEFGHJKLMNPQRSTUVWXYZ023FTR2GDZMPY6PN', ms2=Buffer.from('d1808e096b35b209ca12132b264662a5','hex');
    const wallet=(seed,test)=>{ const root=HDKey.fromMasterSeed(seed), coin=test?1:0, net=test?btc.TEST_NETWORK:undefined, at=p=>btc.p2wpkh(root.derive(p).publicKey,net).address;
      const rows=ch=>Array.from({length:10},(_,i)=>(ch+'/'+i).padEnd(5)+at("m/84'/"+coin+"'/0'/"+ch+'/'+i)).join('\n');
      return {fp:root.fingerprint.toString(16).padStart(8,'0'), text:'Master fingerprint: '+root.fingerprint.toString(16).padStart(8,'0')+'\n\nFirst 10 receive addresses (native SegWit, m/84\'/'+coin+'\'/0\'/0/0 to 0/9):\n'+rows(0)+'\n\nFirst 10 change addresses (native SegWit, m/84\'/'+coin+'\'/0\'/1/0 to 1/9):\n'+rows(1)+'\n\nFirst Taproot address (m/86\'/'+coin+'\'/0\'/0/0): '+btc.p2tr(root.derive("m/86'/"+coin+"'/0'/0/0").publicKey.slice(1),undefined,net).address}; };
    const box=$('c32Box'); ok(box&&box.closest('#tp-tools')&&/^Codex32 shares \(BIP93\)SECRET/.test(box.querySelector('summary').textContent)&&box.previousElementSibling.id==='s39Box','codex32: a Codex32 shares (BIP93) box with the SECRET label in EXTRA TOOLS, after the SLIP39 box');
    const help=box.querySelector('p.hint').textContent;
    ok(/A codex32 seed is not the same wallet as BIP39 words: it is the BIP32 seed itself/.test(help)&&/paper wheels called volvelles/.test(help)&&/first 10 receive and 10 change addresses/.test(help)&&/never corrects a string for you/.test(help)&&!/booklet/i.test(html),'codex32: the help says it is not BIP39, names the volvelles, the 10+10 addresses and that nothing is corrected');
    ok($('c32MakePanel').style.display==='none'&&$('c32CombinePanel').style.display===''&&d.querySelector('input[name=c32Mode]:checked').value==='combine','codex32: the box opens on Check or combine strings');
    ok(!$('c32Btn').disabled&&!$('c32mBtn').disabled&&$('c32Btn').className===''&&$('c32mBtn').className==='','codex32: CHECK AND COMBINE and MAKE THE SHARES are gold main buttons, on once the self-test passes');
    w.setGate('fail','SELF-TEST FAILED','bad'); ok($('c32Btn').disabled&&$('c32mBtn').disabled,'codex32: a failed self-test turns both buttons off'); w.setGate('pass','SELF-TEST PASSED','good');
    $('c32In').value=A+'\n'+C; w.eval('selfTestState = "fail"'); await w.c32Ui(); w.eval('selfTestState = "pass"'); ok($('c32Status').textContent===''&&$('c32Out').textContent==='','codex32: nothing is combined while the self-test has not passed');
    await w.c32Ui(); const want=wallet(ms2,false);
    ok(/status ok/.test($('c32Status').className)&&$('c32Status').textContent==='String 1: checksum OK. Share A, identifier NAME, a 128-bit seed; this set needs 2 shares.\nString 2: checksum OK. Share C, identifier NAME, a 128-bit seed; this set needs 2 shares.\n\nCombined: these 2 shares of set NAME give its secret, a 128-bit master seed.','codex32: CHECK AND COMBINE says what each string is and that they combine (BIP93 test vector 2)');
    ok($('c32Out').textContent.startsWith(want.text+'\n\nThe master seed is the BIP32 seed itself')&&$('c32Out').style.display==='','codex32: the fingerprint, 10 receive and 10 change addresses and the first Taproot address equal @scure (the master seed as the BIP32 seed)');
    $('c32In').dispatchEvent(new w.Event('input')); ok($('c32Out').textContent===''&&$('c32Status').textContent==='','codex32: typing in the box clears the old result');
    $('c32In').value=A+'\nMS12NAMECACDEFGHJKLMNPQRSTUVWXYZ023FTR2GDZMPY6PQ'; await w.c32Ui(); ok(/status bad/.test($('c32Status').className)&&/String 2: The checksum does not match/.test($('c32Status').textContent)&&/\n\nNot combined: String 2: /.test($('c32Status').textContent)&&$('c32Out').textContent==='','codex32: a wrong character is named per string and nothing is combined');
    $('c32In').value='ms10testsxxxxxxxxxxxxxxxxxxxxxxxxxx4nzvca9cmczlw'; await w.c32Ui(); ok(/A secret \(share index S\), identifier TEST, a 128-bit seed: it opens the wallet on its own\.\n\nRead: this secret holds a 128-bit master seed\./.test($('c32Status').textContent)&&$('c32Out').textContent.startsWith(wallet(Buffer.from('318c6318c6318c6318c6318c6318c631','hex'),false).text),'codex32: a secret on its own is read (BIP93 test vector 1)');
    w.practiceMode(true); ok($('c32Out').textContent===''&&$('c32Status').textContent==='','codex32: turning practice mode on clears the result');
    await w.c32Ui(); ok($('c32Out').textContent.startsWith('TESTNET (practice coins only). Practice mode is on, so these addresses are on the test network.\n\n'+wallet(Buffer.from('318c6318c6318c6318c6318c6318c631','hex'),true).text),'codex32: in practice mode the addresses are TESTNET (m/84\'/1\'/0\', from @scure)');
    w.practiceMode(false); w.clearC32(); ok($('c32In').value===''&&$('c32Status').textContent==='','codex32: CLEAR empties the box');
    // make
    mode('make'); ok($('c32MakePanel').style.display===''&&$('c32CombinePanel').style.display==='none','codex32 make: choosing Make new codex32 shares from dice shows its panel');
    ok($('c32mBits').value==='128'&&$('c32mK').value==='2'&&$('c32mN').value==='3'&&$('c32mK').options.length===9&&$('c32mN').options.length===30,'codex32 make: defaults 2 of 3, 128 bits; 2 to 9 needed (or one secret), 2 to 31 shares');
    ok(/This cannot turn seed words you already have into codex32\./.test($('c32MakePanel').textContent)&&/not the same wallet as BIP39 words/.test($('c32MakePanel').textContent),'codex32 make: says it does not convert existing words');
    const R='123456'.repeat(9), ms=nc.createHash('sha256').update(R).digest().subarray(0,16);
    $('c32mRolls').value=R.slice(0,49); await w.c32mUi(); ok(/^Not made: Roll a die at least 50 times/.test($('c32mStatus').textContent)&&$('c32mOut').style.display==='none','codex32 make: 49 rolls are not enough');
    $('c32mRolls').value=R; await w.c32mUi(); const mw=wallet(ms,false);
    ok($('c32mOut').textContent==='SHARE A (1 OF 3)  (Any 2 of the 3 shares open the wallet; fewer reveal nothing.)\nMS12 MKZN ASZH 8XU3 QPV9 EJQS\nH7WX 790T AKX9 J23C 8Z42 FSG9\n\nSHARE C (2 OF 3)\nMS12 MKZN C42X 4K88 4T89 ZU64\nH6GS YJN7 FEVK WG28 W57M 4XTG\n\nSHARE D (3 OF 3)\nMS12 MKZN DQ34 JFHE LGG9 JXXQ\nHRFW CQW5 000A NS6W E23G GCLX','codex32 make: the 3 shares, in capitals in groups of 4 (the strings python-codex32 makes from the same stream)');
    ok(new RegExp('^3 shares made from your 54 rolls and checked: .* master fingerprint '+mw.fp+'\\. Any 2 of the 3 shares open the wallet; fewer reveal nothing\\. Every share of this set has the identifier MKZN').test($('c32mStatus').textContent)&&$('c32mInfo').textContent===mw.text,'codex32 make: the status and the wallet (fingerprint, 10+10 addresses, Taproot) equal @scure for SHA-256 of the rolls');
    ok(!d.querySelector('#c32Box button[onclick*="opy"]')&&/user-select:\s*none/.test($('c32mOut').getAttribute('style')),'codex32 make: the shares cannot be selected and have no COPY button');
    ok($('c32mPrintRow').style.display===''&&d.querySelector('#c32mPrintRow button').className==='secondary small'&&d.querySelector('#c32mPrintRow button').textContent==='PRINT THE SHARES','codex32 make: PRINT THE SHARES is gray');
    const c0=r.st.confirms, p0=r.st.printed; w.printC32Shares(); const ptxt=r.st.printHTML||'';
    ok(r.st.confirms===c0+1&&r.st.printed===p0+1&&/^VOIDFORGE CODEX32 SHARE A \(1 OF 3\)SECRET\. One share of a codex32 \(BIP93\) backup, identifier MKZN\. Any 2 of the 3 shares open the wallet/.test(ptxt)&&ptxt.includes('Master fingerprint of the wallet: '+mw.fp)&&d.querySelectorAll('#printOnly .ps-part').length===3&&r.st.printCells.length===36&&r.st.printCells[2]==='03ASZH','codex32 make: PRINT asks first, then prints one sheet per share, 12 boxes of 4 characters each'); w.dispatchEvent(new w.Event('afterprint'));
    { const t2=load({confirm:false}); await t2.ready(); t2.d.querySelector('input[name=c32Mode][value=make]').checked=true; t2.w.c32ModeChange(); t2.$('c32mRolls').value=R; await t2.w.c32mUi(); const n0=t2.st.printed; t2.w.printC32Shares(); ok(t2.st.printed===n0&&t2.st.confirms===1,'codex32 make: saying no to the question prints nothing'); t2.w.close(); }
    for(const [id,ev] of [['c32mRolls','input'],['c32mBits','change'],['c32mK','change'],['c32mN','change']]){
      await w.c32mUi(); $(id).dispatchEvent(new w.Event(ev)); ok($('c32mOut').textContent===''&&$('c32mInfo').textContent===''&&$('c32mPrintRow').style.display==='none'&&!w.eval('c32mCtx'),'codex32 make: changing '+id+' clears the shares on screen'); }
    $('c32mK').value='0'; $('c32mK').dispatchEvent(new w.Event('change')); ok($('c32mN').style.display==='none','codex32 make: one secret string hides the number of shares');
    $('c32mBits').value='256'; $('c32mRolls').value='5'.repeat(99); await w.c32mUi();
    ok(/^1 secret string made from your 99 rolls and checked: the page read it back and got the same wallet/.test($('c32mStatus').textContent)&&/^SECRET S  \(This one string opens the wallet on its own, like seed words\.\)\nMS10 /.test($('c32mOut').textContent)&&$('c32mOut').textContent.split('\n').length===5,'codex32 make: one 74-character secret (k = 0), in 4 lines');
    w.printC32Shares(); ok(d.querySelectorAll('#printOnly .ps-part').length===1&&r.st.printCells.length===19&&/Anyone who gets this string can take the coins/.test(r.st.printHTML),'codex32 make: the secret prints on one sheet (19 boxes)'); w.dispatchEvent(new w.Event('afterprint'));
    $('c32mK').value='9'; $('c32mK').dispatchEvent(new w.Event('change')); $('c32mN').value='31'; await w.c32mUi(); ok(/^31 shares made/.test($('c32mStatus').textContent)&&($('c32mOut').textContent.match(/^SHARE /gm)||[]).length===31&&/SHARE 9 \(31 OF 31\)/.test($('c32mOut').textContent),'codex32 make: 9 of 31 shares, the last named 9');
    $('c32mK').value='5'; $('c32mN').value='4'; await w.c32mUi(); ok(/^Not made: The number of shares must be from the number needed \(5\) to 31/.test($('c32mStatus').textContent),'codex32 make: 5 of 4 is refused');
    $('c32mK').value='2'; $('c32mN').value='3'; $('c32mBits').value='128'; $('c32mRolls').value=R; await w.c32mUi(); $('c32In').value=A;
    ok(w.eval('AUTO_FIELDS').includes('c32In')&&w.eval('AUTO_FIELDS').includes('c32mRolls')&&w.eval('autoHasSecrets()'),'codex32: auto-clear knows the strings box and the rolls box');
    w.clearAll(); ok($('c32mRolls').value===''&&$('c32In').value===''&&$('c32mOut').textContent===''&&!w.eval('c32mCtx'),'codex32: CLEAR ALL wipes the strings, the rolls and the shares');
    $('c32mRolls').value=R; await w.c32mUi(); w.c32mClear(); ok($('c32mRolls').value===''&&$('c32mOut').textContent===''&&$('c32mStatus').textContent==='','codex32 make: CLEAR empties the panel');
    $('c32mRolls').value=R; await w.c32mUi(); mode('combine'); ok($('c32mRolls').value===''&&!w.eval('c32mCtx')&&$('c32MakePanel').style.display==='none','codex32 make: switching back to Check or combine strings wipes the made shares');
    ok(/\["Codex32", "A way \(BIP93\)/.test(html)&&/\["Volvelle", /.test(html)&&/\["BIP93 \(Codex32\)", "The standard for codex32/.test(html)&&/SLIP39 shares \(Shamir backup\) and Codex32 shares \(BIP93\)\.", "Keys & seeds"\]/.test(html),'dictionary: Codex32, Volvelle, BIP93 (Codex32) and Shamir\'s Secret Sharing updated');
    ok(r.errors.length===0,'codex32: no page errors '+JSON.stringify(r.errors));
    r.w.close(); })();
  // v2.11.0: Taproot multisig, tr(unspendable xpub, sortedmulti_a(M, keys at m/48'/coin'/0'/3')). Expected values from embit
  // (tests/fixtures/gen_taproot_multisig.py), @scure/bip32 + @scure/btc-signer (p2tr with a p2tr_ms leaf), and BIP387's own vectors.
  sweep(t);
  await (async()=>{ const {mnemonicToSeedSync}=require('@scure/bip39'); const {HDKey}=require('@scure/bip32'); const btc=require('@scure/btc-signer'); const {bech32m}=require('@scure/base');
    const r=load(); await r.ready(); const $=r.$, w=r.w, HX=(b)=>Buffer.from(b).toString('hex');
    const F=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','taproot-multisig','wallets.json'),'utf8')), NUMS='50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';
    // 1. every fixture wallet (mainnet and testnet, 1-of-2, 2-of-3, 3-of-5): descriptors with checksums and 10+10 addresses equal embit's
    { let bad=0, n=0; for(const v of F.wallets){ const cos=[]; for(const k of v.keys) cos.push({fp:k.fp, path:k.path, key:await w.parseExtendedKey(k.xpub)});
        if(await w.multisigDescriptor('ms-tr',v.m,cos,0)!==v.receive_desc||await w.multisigDescriptor('ms-tr',v.m,cos,1)!==v.change_desc) bad++;
        for(let i=0;i<10;i++){ n+=2; if(await w.multisigAddress('ms-tr',v.m,cos,0,i,v.net)!==v.receive[i]) bad++; if(await w.multisigAddress('ms-tr',v.m,cos,1,i,v.net)!==v.change[i]) bad++; }
        if(await w.b138Address(v.multipath_desc,1,9,v.net)!==v.change[9]) bad++; }
      ok(bad===0&&F.wallets.length===5&&n===100,'Taproot multisig: '+F.wallets.length+' wallets, descriptors (with checksums) and '+n+' addresses equal embit\'s ('+F.source+')'); }
    // 2. @scure: random seeds; the internal key worked out apart from the page (H from btc-signer, chain code from Node's SHA-256)
    const trScure=(m,roots,net,b,i)=>{ const coin=net==='test'?1:0, acct=roots.map(rt=>rt.derive(`m/48'/${coin}'/0'/3'`)), cc=nc.createHash('sha256').update(Buffer.concat(acct.map(a=>Buffer.from(a.publicKey)).sort(Buffer.compare))).digest();
      const ik=new HDKey({publicKey:Uint8Array.from([2,...btc.TAPROOT_UNSPENDABLE_KEY]), chainCode:cc}).deriveChild(b).deriveChild(i).publicKey.slice(1);
      const xs=acct.map(a=>a.deriveChild(b).deriveChild(i).publicKey.slice(1)).sort((x,y)=>Buffer.compare(Buffer.from(x),Buffer.from(y)));
      return btc.p2tr(ik,{script:btc.p2tr_ms(m,xs).script},net==='test'?btc.TEST_NETWORK:btc.NETWORK).address; };
    ok(HX(btc.TAPROOT_UNSPENDABLE_KEY)===NUMS,'Taproot multisig: btc-signer\'s unspendable key is BIP341\'s H, the one the page uses');
    { let bad=0; for(const [m,n,net] of [[2,3,'main'],[3,4,'test'],[2,2,'main']]){ const roots=Array.from({length:n},()=>HDKey.fromMasterSeed(nc.randomBytes(32))), coin=net==='test'?1:0, cos=[];
        for(const rt of roots){ const a=rt.derive(`m/48'/${coin}'/0'/3'`); cos.push({fp:rt.fingerprint.toString(16).padStart(8,'0'), path:`48h/${coin}h/0h/3h`, key:await w.parseExtendedKey(a.publicExtendedKey)}); }
        if(net==='test') for(const c of cos){ const raw=await w.base58decode(c.key.str); c.key=await w.parseExtendedKey(await w.base58check(Uint8Array.from([0x04,0x35,0x87,0xcf,...raw.slice(4)]))); }
        for(const [b,i] of [[0,0],[0,7],[1,2]]) if(await w.multisigAddress('ms-tr',m,cos,b,i,net)!==trScure(m,roots,net,b,i)) bad++; }
      ok(bad===0,'Taproot multisig: random 2-of-3, 3-of-4 (testnet) and 2-of-2 wallets give the addresses @scure/btc-signer gives (p2tr with a sorted p2tr_ms leaf)'); }
    // 3. BIP387's official sortedmulti_a vector (bitcoin/bips a34f044): the leaf script and the address engine
    { const D='tr('+NUMS+',sortedmulti_a(2,xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/*,xpub68NZiKmJWnxxS6aaHmn81bvJeTESw724CRDs6HbuccFQN9Ku14VQrADWgqbhhTHBaohPX4CjNLf9fq9MYo6oDaPPLPxSb7gwQN3ih19Zm4Y/0/0/*))';
      const want=['abd47468515223f58a1a18edfde709a7a2aab2b696d59ecf8c34f0ba274ef772','fe62e7ed20705bd1d3678e072bc999acb014f07795fa02cb8f25a7aa787e8cbd','1311093750f459039adaa2a5ed23b0f7a8ae2c2ffb07c5390ea37e2fb1050b41'].map(h=>bech32m.encode('bc',[1,...bech32m.toWords(Buffer.from(h,'hex'))]));
      const k1=HDKey.fromExtendedKey('xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL'), k2=HDKey.fromExtendedKey('xpub68NZiKmJWnxxS6aaHmn81bvJeTESw724CRDs6HbuccFQN9Ku14VQrADWgqbhhTHBaohPX4CjNLf9fq9MYo6oDaPPLPxSb7gwQN3ih19Zm4Y');
      let bad=0; for(let i=0;i<3;i++){ const leaf=w.msTrLeaf(2,[k1.deriveChild(i).publicKey.slice(1),k2.deriveChild(0).deriveChild(0).deriveChild(i).publicKey.slice(1)]), lh=await w.taggedHash('TapLeaf',w.concatBytes(Uint8Array.of(0xc0),w.varintBytes(leaf.length),leaf));
        if(await w.b138TrAddress(Buffer.from(NUMS,'hex'),lh,'bc')!==want[i]||await w.b138Address(D,0,i,'main')!==want[i]) bad++; }
      ok(bad===0,'Taproot multisig: BIP387\'s sortedmulti_a test vector (scripts 0, 1 and 2) from the page\'s leaf script and its descriptor reader'); }
    // 4. the wizard: Taproot type, keys pasted from other devices (fixture wallet 0), the exports that fit it
    const v0=F.wallets[0]; w.msReset(); $('msN').value='3'; $('msM').value='2'; w.msUpdateM(); $('msAcct').value='0'; $('msNet').value='main';
    $('msType').value='ms-wsh'; $('msType').dispatchEvent(new w.Event('change')); ok($('msTrNote').style.display==='none','Taproot multisig: the note is hidden for native SegWit');
    $('msType').value='ms-tr'; $('msType').dispatchEvent(new w.Event('change')); const note=$('msTrNote').textContent;
    ok($('msTrNote').style.display===''&&/BIP48 defines only 1’ and 2’; there is no standard path for Taproot multisig/.test(note)&&/Bitcoin Core 24\.0\.1 or later/.test(note)&&/EDGE firmware \(checked with 6\.6\.1X and 6\.6\.1QX/.test(note)&&/Sparrow cannot use Taproot multisig yet/.test(note)&&/the key path is shut/.test(note)&&/MuSig2/.test(note),'Taproot multisig: choosing it shows the plain-language note (no standard path, the key path is shut, confirmed wallets only)');
    eq([...$('msType').options].map(o=>o.textContent).join(' | '),'Native SegWit (bc1q...), recommended | Nested SegWit (3...), older wallets | Taproot (bc1p...), script path, sortedmulti_a','Taproot multisig: the address type choice');
    w.msStart(); w.msUsePaste(); const paste=async(t)=>{ $('msPaste').value=t; $('msPasteFp').value=''; await w.msAddPasted(); return $('msRunErr').textContent; };
    const AB='abandon '.repeat(11)+'about', rtA=HDKey.fromMasterSeed(mnemonicToSeedSync(AB,'')), fpA='73c5da0a';
    { const zp=HDKey.fromMasterSeed(mnemonicToSeedSync(AB,''),{private:0x02aa7a99,public:0x02aa7ed3}).derive("m/48'/0'/0'/2'").publicExtendedKey;
      ok(/different multisig script type/.test(await paste('['+fpA+'/48h/0h/0h/2h]'+zp)),'Taproot multisig paste: a native SegWit cosigner key (Zpub) is refused');
      ok(/not at the expected place in the key tree \(m\/48'\/0'\/0'\/3'\)/.test(await paste('['+fpA+'/48h/0h/0h/2h]'+rtA.derive("m/48'/0'/0'/2'").publicExtendedKey)),'Taproot multisig paste: an xpub from the native SegWit path 2\' is refused');
      ok(/not the one this wallet uses \(48h\/0h\/0h\/3h\)/.test(await paste('['+fpA+'/48h/0h/0h/2h]'+rtA.derive("m/48'/0'/0'/3'").publicExtendedKey)),'Taproot multisig paste: a line whose path says 2\' is refused, even with the right key');
      ok(/single-signature/.test(await paste('['+fpA+"/84h/0h/0h]"+HDKey.fromMasterSeed(mnemonicToSeedSync(AB,''),{private:0x04b2430c,public:0x04b24746}).derive("m/84'/0'/0'").publicExtendedKey)),'Taproot multisig paste: a single-signature zpub is refused');
      ok(w.eval('ms.keys.length')===0,'Taproot multisig paste: nothing was added by the refused keys'); }
    for(const k of v0.keys) ok(await paste('['+k.fp+"/48'/0'/0'/3']"+k.xpub+'/<0;1>/*')==='','Taproot multisig paste: cosigner '+k.fp+' at m/48\'/0\'/0\'/3\' is accepted');
    ok(w.eval('ms.done')&&$('msDescR').textContent===v0.receive_desc&&$('msDescC').textContent===v0.change_desc,'Taproot multisig: the wallet\'s receive and change descriptors (with checksums) equal embit\'s');
    ok([...$('msAddrs').children].map(li=>li.textContent).join()===v0.receive.join()&&[...$('msChange').children].map(li=>li.textContent).join()===v0.change.join(),'Taproot multisig: the first 10 receive and 10 change addresses (bc1p...) equal embit\'s');
    ok(/^2-of-3 multisig, Taproot \(bc1p\.\.\.\), script path, account 0$/.test($('msRunTitle').textContent)&&/Bitcoin Core \(24\.0\.1 or later\) or a Coldcard with EDGE firmware/.test($('msDescLabel').textContent),'Taproot multisig: the title and the descriptor label name the type and the wallets that import it');
    ok($('msAnimUr').style.display==='none'&&$('msAnimCc').style.display==='none'&&$('msAnimTr').style.display==='','Taproot multisig: the UR (Sparrow, SeedSigner, Nunchuk) and Keystone/Passport QR buttons are hidden, and the reason is shown');
    w.animStop(); await w.msAnim('ur'); ok(!w.eval('animCtx'),'Taproot multisig: the UR export does nothing for this type');
    await w.msAnim('bbqr'); { const d=w.bbqrDecodeFrames(w.eval('animCtx.parts')), txt=new TextDecoder().decode(d.bytes); ok(txt===v0.multipath_desc&&/EDGE firmware \(checked with 6\.6\.1QX\)/.test($('msAnimCap').textContent),'Taproot multisig: the COLDCARD Q (BBQr) export is the receive-and-change descriptor embit reads, and it names the EDGE firmware'); }
    w.animHide('msAnim');
    { const c=$('msCoreCmd').textContent.split('\n'), im=c[1]&&c[1].match(/^bitcoin-cli -rpcwallet=voidforge-watch importdescriptors '(.*)'$/), req=im?JSON.parse(im[1]):[];
      ok(/^bitcoin-cli createwallet "voidforge-watch" true true "" false true$/.test(c[0])&&req.length===2&&req[0].desc===v0.receive_desc&&req[1].desc===v0.change_desc&&!req[0].internal&&req[1].internal&&req[0].timestamp==='now','Taproot multisig: Import into Bitcoin Core gives createwallet and importdescriptors with both descriptors');
      $('msCoreWhen').value='0'; $('msCoreWhen').dispatchEvent(new w.Event('change')); ok(JSON.parse($('msCoreCmd').textContent.split('\n')[1].match(/'(.*)'$/)[1])[0].timestamp===0,'Taproot multisig: the "used before" choice scans from the start'); $('msCoreWhen').value='now'; }
    w.msPrint(); { const pq=r.d.getElementById('printQr').textContent; ok(r.st.printed>=1&&pq.includes(v0.receive_desc)&&/Taproot \(bc1p\.\.\.\), script path/.test(pq)&&/path m\/48'\/0'\/0'\/3'/.test(pq)&&pq.includes(v0.receive[9])&&pq.includes(v0.change[9]),'Taproot multisig: the recovery sheet prints the tr() descriptor, the 3\' paths and 10+10 addresses'); r.w.dispatchEvent(new r.w.Event('afterprint')); }
    // 5. SAVE ENCRYPTED DESCRIPTOR BACKUP (BIP138) with the tr() descriptor; one cosigner's words open it
    { const R50='16354216535241263542163542165432163542165342165432'; $('msbRolls').value=R50; r.st.blob=null; await w.b138MakeUi('msb');
      const st=$('msbStatus').textContent, f=w.b138Parse(Uint8Array.from(Buffer.from($('msbText').textContent,'base64')));
      ok(/^SAVED: voidforge-descriptor-backup\.bip138 .*Any one of these 3 keys opens it/.test(st)&&/KEYS THAT CANNOT OPEN IT:\nThe key xpub661MyMwA… is the BIP341 unspendable key/.test(st)&&!!r.st.blob,'Taproot multisig backup: saved; the 3 cosigners open it, and the unspendable internal key is named as one that cannot');
      ok(f.paths.length===1&&w.b138PathText(f.paths[0])==="m/48'/0'/0'/3'",'Taproot multisig backup: the 3\' path, which is not a common BIP48 path, is written in the file so a reader knows where to look');
      $('b138In').value=$('msbText').textContent; $('phrase').value='letter advice cage absurd amount doctor acoustic avoid letter advice cage above'; $('verifyPass').value=''; $('b138Pub').value=''; await w.b138OpenUi();
      const out=$('b138Out').textContent; ok(/^OPENED with the words typed above, without a passphrase: the key at m\/48'\/0'\/0'\/3'/.test($('b138Status').textContent)&&out.includes(v0.multipath_desc)&&v0.receive.every((a,i)=>out.includes('  '+i+': '+a))&&v0.change.every((a,i)=>out.includes('  '+i+': '+a)),'Taproot multisig backup: one cosigner\'s words open it, and it shows the descriptor and the same 10+10 addresses');
      w.b138OpenClear(); $('phrase').value=''; }
    // 6. the other descriptor tools read the tr(...sortedmulti_a...) form
    { const x=await w.msExplain(v0.multipath_desc,null,'',''); ok(x.state==='ok'&&/^This Taproot \(bc1p\.\.\.\) wallet can be spent in 1 way:\n1\. 2 of Key 1 \(fingerprint 28645006\), Key 2 \(fingerprint 73c5da0a\), Key 3 \(fingerprint b8688df1\), at any time\./.test(x.text)&&/Nobody can spend with the Taproot internal key alone/.test(x.text)&&!/key path/.test(x.text),'Explain a wallet: a Taproot multisig is 2 of its 3 keys, and its xpub-on-H internal key is called shut, not a key'); }
    { const x=await w.msExplain('tr('+NUMS+',sortedmulti_a(2,'+v0.keys.map(k=>'['+k.fp+'/48h/0h/0h/3h]'+k.xpub+'/0/*').join(',')+'))',null,'',''); ok(x.state==='ok'&&/can be spent in 1 way/.test(x.text)&&/internal key alone/.test(x.text),'Explain a wallet: the plain H internal key is shut too'); }
    { const x=await w.kcCheck(v0.receive_desc,AB,''); ok(x.state==='ok'&&/^THIS SEED IS IN THIS WALLET: it is key 2 of 3\. Spending needs 1 more of the other keys\./.test(x.text)&&/Wallet file: descriptor, 2 of 3 multisig, P2TR\./.test(x.text)&&/The Taproot internal key \(key path\): made from BIP341's unspendable point H/.test(x.text)&&!/does not say which seed/.test(x.text),'Is this seed in my wallet file?: a Taproot multisig descriptor; the seed is key 2 of 3, and the internal key is named as unspendable');
      const y=await w.kcCheck(v0.receive_desc,'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',''); ok(y.state==='bad'&&/^NOT IN THIS WALLET/.test(y.text),'Is this seed in my wallet file?: another seed is not in the Taproot multisig wallet'); }
    { const d=v0.receive_desc, i=d.indexOf('sortedmulti_a')+3, bad=d.slice(0,i)+'x'+d.slice(i+1), x=await w.descTypoFind(bad); ok(x.state==='ok'&&/^FOUND: one change makes everything match: character \d+: “x” should be “t”/.test(x.text)&&x.text.includes(d.replace(/#.*$/,'')),'Find a typo: a typo in a Taproot multisig descriptor is found and fixed'); }
    // 7. Inspect a transaction: a Taproot multisig change output is said to hold this wallet's key among several, NOT checked
    { const H=0x80000000, kk=(p)=>rtA.derive(p).publicKey, mine=kk("m/48'/0'/0'/3'/1/0").slice(1), other=HDKey.fromMasterSeed(nc.randomBytes(32)).derive('m/0/0').publicKey.slice(1);
      const leaf=btc.p2tr_ms(2,[mine,other].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))), pay=btc.p2tr(btc.TAPROOT_UNSPENDABLE_KEY,{script:leaf.script});
      const lh=await w.taggedHash('TapLeaf',w.concatBytes(Uint8Array.of(0xc0),w.varintBytes(leaf.script.length),leaf.script));
      const t=new btc.Transaction(); t.addInput({txid:nc.randomBytes(32), index:0, witnessUtxo:{script:btc.p2wpkh(kk("m/84'/0'/0'/0/0")).script, amount:150000n}});
      t.addOutput({script:pay.script, amount:70000n, tapBip32Derivation:[[mine,{hashes:[lh], der:{fingerprint:rtA.fingerprint, path:[48+H,H,H,3+H,1,0]}}]]});
      $('phrase').value=AB; $('verifyPass').value=''; $('psbtInput').value=Buffer.from(t.toPSBT(0)).toString('base64'); $('psbtNet').value='main'; await w.runPsbt(); const o=$('psbtOut').textContent;
      ok(/said to hold this wallet's key at m\/48'\/0'\/0'\/3'\/1\/0 among several keys \(a multisig or script output\)\. NOT checked/.test(o)&&/NO CLEAN VERDICT/.test(o)&&!/CHANGE, CHECKED/.test(o),'Inspect a transaction: a Taproot multisig change output is said to be not checked (this page cannot check multisig change)'); $('phrase').value=''; $('psbtInput').value=''; }
    // 8. made here, in practice mode: TESTNET (practice coins only), tpub keys at m/48'/1'/0'/3', tb1p addresses (expected from @scure)
    { w.msReset(); w.practiceMode(true); ok($('msNet').value==='test'&&$('msNet').disabled,'Taproot multisig: practice mode puts the wizard on testnet');
      $('msN').value='2'; w.msUpdateM(); $('msType').value='ms-tr'; w.msStart(); ok($('msTestBan').style.display===''&&/TESTNET/.test($('msBanTitle').textContent),'Taproot multisig: the testnet banner shows');
      const S=[[AB.replace(/ about$/,''),'0000000'],['legal winner thank year wave sausage worth useful legal winner thank','1111111']];
      for(const [w0,f0] of S){ $('wdLen').value='12'; $('wdWords').value=w0; $('wdFlips').value=f0; w.wdUpdate(); await w.wdGenerate(); await new Promise(x=>setTimeout(x,1200)); await w.msAddMade(); }
      const roots=[AB,'legal winner thank year wave sausage worth useful legal winner thank yellow'].map(m=>HDKey.fromMasterSeed(mnemonicToSeedSync(m,'')));
      ok(w.eval('ms.done')&&/^tr\(tpub[1-9A-HJ-NP-Za-km-z]+\/0\/\*,sortedmulti_a\(2,\[[0-9a-f]{8}\/48h\/1h\/0h\/3h\]tpub/.test($('msDescR').textContent)&&$('msAddrs').children[0].textContent===trScure(2,roots,'test',0,0)&&$('msChange').children[9].textContent===trScure(2,roots,'test',1,9),'Taproot multisig: 2-of-2 made here in practice mode: tpub keys at m/48\'/1\'/0\'/3\', and tb1p addresses equal @scure\'s');
      ok(!w.hasSeed()&&$('msOneDev').style.display==='','Taproot multisig: each seed is wiped after its key is kept, and the one-device warning shows');
      w.msReset(); w.practiceMode(false); }
    // 9. the watch-only box offers the Taproot cosigner key (made here, to paste into another device's wizard)
    { $('phrase').value=''; const sd=await w.mnemonicToSeed(AB,''), wx=await w.watchOnlyFromSeed(sd,'ms-tr',0,'main');
      ok(wx.key===rtA.derive("m/48'/0'/0'/3'").publicExtendedKey&&wx.receive==='['+fpA+"/48h/0h/0h/3h]"+wx.key,'Taproot multisig: the cosigner key at m/48\'/0\'/0\'/3\' is a plain xpub (no SLIP132 prefix exists for it), equal to @scure\'s');
      ok([...$('wType').options].some(o=>o.value==='ms-tr'&&/Taproot \(m\/48'\/\.\.\.\/3', not in BIP48\)/.test(o.textContent)),'Taproot multisig: the watch-only box offers the Taproot cosigner key'); }
    ok(/\["Taproot multisig"/.test(html)&&/\["multi_a and sortedmulti_a"/.test(html)&&/\["NUMS point \(unspendable key\)"/.test(html),'dictionary: Taproot multisig, multi_a and sortedmulti_a, NUMS point');
    w.setGate('fail','SELF-TEST FAILED','bad'); ok($('msStartBtn').disabled,'Taproot multisig: START MULTISIG SETUP waits for the self-test'); w.setGate('pass','SELF-TEST PASSED','good');
    ok(r.errors.length===0,'Taproot multisig: no page errors '+JSON.stringify(r.errors));
    r.w.close(); })();
  // v2.17.0: the practice signer works for real (ss_own.js). The page text, the house style of the new box, the hooks into re-hide, the
  // wipes and the camera, and in jsdom what the box reads and the warnings it gives (the signing itself: tests/oracle.test.mjs, the
  // whole flow in Chromium: tests/simulator.test.mjs, the guards: tests/mutation.test.mjs section 83)
  sweep(t);
  await (async()=>{ const r=load(); await r.ready(); const $=r.$, w=r.w, d=w.document, names=w.eval('DICT').map(e=>e[0]), fs=require('fs');
    const {HDKey}=require('@scure/bip32'), {mnemonicToSeedSync}=require('@scure/bip39'), btc=require('@scure/btc-signer');
    ok(html.indexOf('<li><b>2.17.0</b>')>0&&html.indexOf('<li><b>2.17.0</b>')<html.indexOf('<li><b>2.16.1</b>'),'v2.17.0: the changelog lists 2.17.0 first');
    { const li=html.slice(html.indexOf('<li><b>2.17.0</b>'),html.indexOf('<li><b>2.16.1</b>')); ok(/works fully for real/.test(li)&&/A browser is not a hardware signer/.test(li)&&/PRACTICE/.test(li)&&/LOAD INTO THE PRACTICE SIGNER<\/b> now loads a public or practice seed while the computer is online too/.test(li)&&/lessons<\/b> work with whatever seed/.test(li),'v2.17.0: the changelog entry names real signing, the warnings, PRACTICE, the online load and the lessons'); }
    ok(['Partial signature','Change verification','BBQr','PSBT (partly signed Bitcoin transaction)'].every(n=>names.includes(n)),'dictionary: Partial signature, Change verification, BBQr and PSBT');
    const box=$('ssOwnBox'); ok(box&&box.closest('#ssBox')&&/A browser is not a hardware signer/.test(box.querySelector('.ms-test').textContent),'v2.17.0: Use it for real sits in the practice signer box, with the browser-is-not-a-hardware-signer warning');
    ok($('ssOwnGo').className===''&&['ssOwnFileBtn','ssOwnClear','ssMsgGo','ssOwnCopy','ssOwnSave'].every(id=>$(id).className==='secondary small')&&$('ssOwnGo').textContent==='HOLD UP TO THE DEVICE','v2.17.0: one gold main action (HOLD UP TO THE DEVICE); the file, clear, message, copy and save buttons are gray');
    ok(!!$('cam-ssOwnIn')&&$('cam-ssOwnIn').textContent==='SCAN QR','v2.17.0: the page\'s own camera reads a PSBT, address, descriptor or message request into the box (SCAN QR)');
    ok(w.eval('AUTO_FIELDS').includes('ssMsgIn')&&!w.eval('AUTO_FIELDS').includes('ssOwnIn')&&w.eval('rhIds()').includes('ssOwnOut'),'v2.17.0: the typed message is a secret box; the pasted PSBT is not; the signed output is a re-hide place');
    ok(/ssOwnWipe\(\)/.test(w.wipeSeed.toString())&&/ssOwnWipe\(\)/.test(w.ssPageStop.toString()),'v2.17.0: wipeSeed and the device\'s stop wipe your PSBT, the output and the message');
    // what the box reads
    const AB='abandon '.repeat(11)+'about', R=HDKey.fromMasterSeed(mnemonicToSeedSync(AB,'')), k=R.derive("m/84'/0'/0'/0/0"), tx=new btc.Transaction();
    tx.addInput({txid:new Uint8Array(32).fill(7),index:0,witnessUtxo:{script:btc.p2wpkh(k.publicKey).script,amount:50000n},bip32Derivation:[[k.publicKey,{fingerprint:R.fingerprint,path:[84+0x80000000,0x80000000,0x80000000,0,0]}]]}); tx.addOutput({script:btc.p2wpkh(k.publicKey).script,amount:49000n});
    const raw=tx.toPSBT(0), kinds=[Buffer.from(raw).toString('base64'),Buffer.from(raw).toString('hex'),btc.p2wpkh(k.publicKey).address,'bitcoin:'+btc.p2wpkh(k.publicKey).address+'?amount=1','signmessage m/84h/0h/0h/0/0 ascii:Hello',AB,'0000'.repeat(12),R.privateExtendedKey,'wpkh([73c5da0a/84h/0h/0h]'+R.derive("m/84'/0'/0'").publicExtendedKey+'/0/*)','hello'].map(x=>{ const g=w.ssOwnRead(x); return g.kind||'error'; });
    eq(kinds.join(),'psbt,psbt,address,address,msg,error,error,error,error,error','v2.17.0: the box reads a PSBT (base64, hex), an address, a signmessage request; it refuses seed words, a SeedQR, an xprv, a single-key descriptor and other text');
    // the transaction size the fee rate uses, against btc-signer's own after signing (P2WPKH)
    { const t2=btc.Transaction.fromPSBT(raw); t2.signIdx(k.privateKey,0); t2.finalize(); const real=t2.vsize, est=w.ssOwnVsize(w.eval('SSPSBT').parse(new (w.eval('Uint8Array'))(raw)));
      ok(est>=real&&est<=real+2,'v2.17.0: the size the fee rate uses is within 2 vB above the real signed size ('+est+' vB, btc-signer '+real+')'); }
    ok(/Real signing with the practice signer/.test(fs.readFileSync(path.join(__dirname,'..','README.md'),'utf8'))&&/Real signing \(v2\.17\.0\)/.test(fs.readFileSync(path.join(__dirname,'..','SECURITY.md'),'utf8'))&&/Real signing with the practice signer/.test(fs.readFileSync(path.join(__dirname,'..','THREAT_MODEL.md'),'utf8'))&&/ssOwnSignGate/.test(fs.readFileSync(path.join(__dirname,'..','REVIEW.md'),'utf8')),'v2.17.0: README, SECURITY.md, THREAT_MODEL.md and REVIEW.md describe real signing and its risks');
    r.w.close(); })();
  // v2.14.0: docs and page text for the Damascus method and the lessons (the method is tested in tests/vfmethod.test.mjs, the lessons in tests/simulator.test.mjs)
  sweep(t);
  await (async()=>{ const r=load(); await r.ready(); const w=r.w, names=w.eval('DICT').map(e=>e[0]), fs=require('fs');
    ok(html.indexOf('<li><b>2.16.1</b>')>0&&html.indexOf('<li><b>2.16.1</b>')<html.indexOf('<li><b>2.16.0</b>')&&html.indexOf('<li><b>2.16.0</b>')<html.indexOf('<li><b>2.15.0</b>')&&html.indexOf('<li><b>2.15.0</b>')<html.indexOf('<li><b>2.14.0</b>'),'v2.16.1: the changelog lists 2.16.1 first, then 2.16.0 and 2.15.0');
    ok(['Damascus method','Hammer sheet','Anvil sheet','Forge sheet','Hallmark','Assay','Practice transaction'].every(n=>names.includes(n)),'dictionary: Damascus method, Hammer, Anvil and Forge sheets, Hallmark, Assay and Practice transaction');
    ok(/voidforge-demo-2\.17\.0/.test(fs.readFileSync(path.join(__dirname,'..','demo','sw.js'),'utf8')),'v2.17.0: the demo cache name is bumped');
    ok(/damascus-quick-guide\.md/.test(fs.readFileSync(path.join(__dirname,'..','README.md'),'utf8'))&&/Damascus/.test(fs.readFileSync(path.join(__dirname,'..','THREAT_MODEL.md'),'utf8')),'v2.14.0: the README links the Damascus guide and the threat model covers the Damascus method');
    r.w.close(); })();
  // v2.13.0: docs and page text for the practice signer (the practice signer itself is tested in tests/simulator.test.mjs)
  sweep(t);
  await (async()=>{ const r=load(); await r.ready(); const w=r.w, names=w.eval('DICT').map(e=>e[0]);
    ok(html.indexOf('<li><b>2.13.0</b>')>0&&html.indexOf('<li><b>2.13.0</b>')<html.indexOf('<li><b>2.12.0</b>'),'v2.13.0: the changelog lists 2.13.0 first');
    ok(['Practice signer','SeedSigner+','PSBT (partly signed Bitcoin transaction)','Descriptor','SeedQR'].every(n=>names.includes(n)),'dictionary: Practice signer, SeedSigner+, PSBT, Descriptor and SeedQR');
    ok(/Practice signer/.test(html.match(/<summary>Hardware wallet: SeedSigner[\s\S]*?<\/details>/)[0]),'About: the SeedSigner recommendation points to the practice signer');
    r.w.close(); })();
  // v2.12.0: Open a signing device's backup (the full checks are in tests/devbackup.test.mjs and the mutation probe, section 71)
  sweep(t);
  await (async()=>{ const r=load(); await r.ready(); const $=r.$, w=r.w, {HDKey}=require('@scure/bip32'), btc=require('@scure/btc-signer');
    ok(html.indexOf('<li><b>2.12.0</b>')>0&&html.indexOf('<li><b>2.12.0</b>')<html.indexOf('<li><b>2.11.0</b>'),'v2.12.0: the changelog lists 2.12.0 first');
    ok(/SELF-TEST PASSED \(155\/155\)/.test($('selfTestBadge').textContent),'v2.14.0 to v2.16.0: the self-test has 155 checks (141, then 6 for the passphrase check, passphrase practice, Link as QR and re-hide, then 8 for Electrum wallet files and any path, and wallet.dat files)');
    { const names=w.eval('DICT').map(e=>e[0]); ok(['Coldcard backup (.7z)','Krux encrypted seed (KEF)','TAPSIGNER backup'].every(n=>names.includes(n)),'dictionary: Coldcard backup, Krux encrypted seed and TAPSIGNER backup'); }
    ok(!$('dbBtn').disabled&&$('dbKey').type==='password'&&/user-select:none/.test($('dbSecret').getAttribute('style'))&&$('dbSecretRow').style.display==='none','device backups: the button is on after the self-test, the key box hides what is typed, and the secret box cannot be selected');
    const k='00112233445566778899aabbccddeeff', root=HDKey.fromMasterSeed(Buffer.alloc(32,3)), c=nc.createCipheriv('aes-128-ctr',Buffer.from(k,'hex'),Buffer.alloc(16));
    const ct=Buffer.concat([c.update(root.privateExtendedKey+'\nm/84h/0h/0h\n'),c.final()]), shf='base64 -d <<END-OF-DATA | openssl aes-128-ctr -d -iv 0 -K $KEY\n'+ct.toString('base64')+'\nEND-OF-DATA\n';
    $('dbKind').value='ts'; $('dbIn').value=shf; $('dbKey').value=k; await w.dbOpenUi();
    ok($('dbOut').textContent.includes('Master fingerprint: '+root.fingerprint.toString(16).padStart(8,'0'))&&$('dbOut').textContent.includes(btc.p2wpkh(root.derive("m/84'/0'/0'/0/0").publicKey).address),'device backups: a TAPSIGNER backup made with node:crypto shows its fingerprint and first address (@scure)');
    ok($('dbSecret').textContent==='','device backups: the key is not shown until asked'); w.dbReveal(); ok($('dbSecret').textContent.includes(root.privateExtendedKey),'device backups: SHOW THE SECRET shows the xprv');
    w.dbClear(); ok($('dbSecret').textContent===''&&$('dbIn').value===''&&$('dbKey').value==='','device backups: CLEAR wipes the box');
    ok(r.errors.length===0,'device backups: no page errors '+JSON.stringify(r.errors));
    r.w.close(); })();
  // v2.16.1 review: a public seed is marked PRACTICE by every method, by its words (finding 4); every print from it says so (5);
  // a PRACTICE seed as a multisig key: a warning, its slot and the wallet's sheet (6); CLEAR in Practice making a backup wipes your
  // own words (7); regtest in the address checks, and practice mode named in the wallet file readers (9). Expected addresses from
  // @scure/bip32 and @scure/btc-signer.
  sweep(t);
  await (async()=>{ const r=load(); await r.ready(); const $=r.$, w=r.w, st=r.st, {HDKey}=require('@scure/bip32'), bip39=require('@scure/bip39'), btc=require('@scure/btc-signer');
    const AB='abandon '.repeat(11)+'about', RT={...btc.TEST_NETWORK,bech32:'bcrt'}, root=(m,pw='')=>HDKey.fromMasterSeed(bip39.mnemonicToSeedSync(m,pw)), after=()=>w.dispatchEvent(new w.Event('afterprint'));
    w.startGateClose(); w.showTab('make'); w.setMethod('cards'); $('cdHex').value='000102030405060708090a0b0c0d0e0f'; w.cdUpdate(); await w.cdHexGenerate();
    const ban=$('ssfBan').textContent, fp=root(w.eval('madeMnemonic')).fingerprint.toString(16).padStart(8,'0');
    ok(w.hasSeed()&&ban==='PRACTICE: This seed is a public or predictable seed (it is made from counting numbers, not from real randomness). Anyone can make it again: never put money on it.'&&$('ssfBan').style.display==='','v2.16.1 review: Hex 000102...0f (counting numbers) is marked PRACTICE, as the Damascus boxes and the practice signer mark a public seed');
    w.downloadSeed(); ok((await blobText(w,st.blob)).startsWith(ban+'\n\n'),'v2.16.1 review: DOWNLOAD of that seed starts with the PRACTICE line');
    for(const [id,name] of [['wZpub','ACCOUNT PUBLIC KEY'],['wDescR','RECEIVE DESCRIPTOR']]){ w.showQr(id,'x'); const p0=st.printed; w.printShownQr(); const t=st.printQrText||''; after();
      ok(st.printed===p0+1&&t.includes('VOIDFORGE '+name+': PRACTICE')&&t.includes(ban),'v2.16.1 review: PRINT THIS QR ('+name.toLowerCase()+') of a PRACTICE seed says PRACTICE in its title and carries the PRACTICE line'); }
    w.hideQr(); w.planOpen(); $('plM1').value='paper'; $('plW1').value='desk drawer'; $('plL1').value='home'; w.planRender();
    ok($('plFp').value===fp,'v2.16.1 review: the backup plan takes the fingerprint of the seed under YOUR SEED ('+fp+')');
    { const p0=st.printed; await w.printPlan(); const t=st.printHTML; after(); ok(st.printed===p0+1&&t.includes('VOIDFORGE BACKUP PLAN: PRACTICE')&&t.includes(ban),'v2.16.1 review: the backup plan of a PRACTICE seed says PRACTICE and carries the PRACTICE line'); }
    for(const k of ['heir','letter','keys','contacts','bags']){ const p0=st.printed; await w.printInherit(k); const t=st.printHTML; after(); ok(st.printed===p0+1&&/: PRACTICE/.test(t)&&t.includes(ban),'v2.16.1 review: the '+k+' sheet of the plan of a PRACTICE seed says PRACTICE and carries the PRACTICE line'); }
    $('plFp').value='0badf00d'; { const p0=st.printed; await w.printInherit('heir'); const t=st.printHTML; after(); ok(st.printed===p0+1&&!/PRACTICE/.test(t),'v2.16.1 review: a plan for another fingerprint does not say PRACTICE'); }
    w.planClear();
    // 6. multisig: a PRACTICE seed is a key only after a warning; its slot and the sheet say PRACTICE (public seed)
    w.msReset(); w.showTab('make'); w.setMethod('cards'); $('cdHex').value='000102030405060708090a0b0c0d0e0f'; w.cdUpdate(); await w.cdHexGenerate(); w.msStart();
    let asked=''; w.confirm=(m)=>{ asked=m; return false; }; await w.msAddMade();
    ok(/^PRACTICE: this seed is a public or predictable seed .*Use it as key 1 anyway\?$/s.test(asked)&&w.eval('ms.keys.length')===0&&w.hasSeed(),'v2.16.1 review: ADD THIS KEY & WIPE THE SEED with a PRACTICE seed asks first; Cancel adds nothing and keeps the seed');
    w.confirm=()=>true; await w.msAddMade();
    ok(w.eval('ms.keys.length')===1&&w.eval('ms.keys[0].pr')===true&&/^PRACTICE \(public seed\): anyone can make this key again\. Made here\./.test($('msSlots').querySelector('.ms-slot .ms-txt div').textContent)&&!w.hasSeed(),'v2.16.1 review: OK adds it, the slot is tagged PRACTICE (public seed) and the seed is wiped');
    $('phrase').value='legal winner thank year wave sausage worth useful legal winner thank yellow'; $('verifyPass').value=''; asked=''; w.confirm=(m)=>{ asked=m; return true; }; await w.msAddChecked();
    ok(/as key 2/.test(asked)&&w.eval('ms.keys.length')===2&&w.eval('ms.keys[1].pr')===true,'v2.16.1 review: USE THE SEED IN CHECK A BACKUP with a public seed asks first too, and tags it');
    $('phrase').value='screen truck market purse stumble turn across conduct exact armor neither guitar'; asked=''; await w.msAddChecked(); await new Promise(x=>setTimeout(x,50));
    ok(asked===''&&w.eval('ms.keys.length')===3&&!w.eval('ms.keys[2].pr')&&w.eval('ms.done'),'v2.16.1 review: a seed that is not public is added without a question');
    { const tx=w.msSheetText(); ok(/^PRACTICE: key 1 and key 2 come from a public seed that anyone can make again, so this wallet is weaker than it looks\. Never put money on it\.\n/.test(tx)&&/1\. fingerprint [0-9a-f]{8} {3}path \S+ {3}PRACTICE \(public seed\)\n2\. .*PRACTICE \(public seed\)\n3\. fingerprint [0-9a-f]{8} {3}path \S+\n/.test(tx),'v2.16.1 review: the multisig sheet text names the PRACTICE keys'); }
    { const p0=st.printed; w.msPrint(); const t=st.printQrText||''; after(); ok(st.printed===p0+1&&t.includes('VOIDFORGE MULTISIG RECOVERY SHEET: PRACTICE'),'v2.16.1 review: the multisig recovery sheet says PRACTICE in its title'); }
    w.msReset(); w.confirm=()=>true; w.clearAll();
    // 7. Practice making a backup: CLEAR wipes your own words in the box
    w.showTab('check'); $('prSrcOwn').checked=true; $('prSrcOwn').dispatchEvent(new w.Event('change')); $('prOwn').value=AB; await w.practiceStart();
    w.practiceClear(); ok($('prOwn').value===''&&w.eval('practice')===null&&$('prOwnRow').style.display==='','v2.16.1 review: CLEAR in Practice making a backup wipes My own words, as its hint says');
    $('prSrcTest').checked=true; $('prSrcTest').dispatchEvent(new w.Event('change'));
    // 9. regtest in CHECK ADDRESS and TRY ACCOUNTS (also typed in capitals), and the Wallet Detective's address in capitals
    const rt1=btc.p2wpkh(root(AB).derive("m/84'/1'/0'/0/1").publicKey,RT).address, rtc=btc.p2tr(root(AB).derive("m/86'/1'/0'/1/0").publicKey.slice(1),undefined,RT).address;
    $('phrase').value=AB; $('verifyPass').value=''; $('checkAcct').value='0';
    $('checkAddr').value=rt1.toUpperCase(); await w.checkAddress(4); ok(/^FOUND: this Regtest SegWit address is receive address #1 \(m\/84'\/1'\/0'\/0\/1\)/.test($('addrCheckStatus').textContent),'v2.16.1 review: CHECK ADDRESS finds a regtest (bcrt1q, in capitals) address and names the network: '+$('addrCheckStatus').textContent.slice(0,80));
    $('checkAddr').value=rtc; await w.checkAddress(4); ok(/^FOUND: this Regtest Taproot address is change address #0/.test($('addrCheckStatus').textContent),'v2.16.1 review: CHECK ADDRESS finds a regtest Taproot (bcrt1p) change address');
    $('checkAddr').value=rt1.toUpperCase(); await w.checkAllAccounts(1,2); ok(/^FOUND: this Regtest SegWit address is receive address #1 \(m\/84'\/1'\/0'\/0\/1\) of account 0/.test($('addrCheckStatus').textContent),'v2.16.1 review: TRY ACCOUNTS names a regtest address as Regtest');
    $('checkAddr').value='hello'; await w.checkAddress(4); ok(/regtest address \(bcrt1q\.\.\., bcrt1p\.\.\.\)/.test($('addrCheckStatus').textContent),'v2.16.1 review: the address checks say they take regtest addresses');
    { const T=await w.detTarget(rt1.toUpperCase()); ok(T&&T.kind==='addr'&&T.net==='regtest','v2.16.1 review: the Wallet Detective takes a regtest address typed in capitals'); }
    $('phrase').value=''; $('checkAddr').value=''; w.clearAll();
    // 9. practice mode sets the wallet file readers' Network menu: the report says so (not "set by hand")
    { const FX=path.join(__dirname,'fixtures','electrum'); w.practiceMode(true); $('ewIn').value=fs.readFileSync(path.join(FX,'zpub-watch.json'),'utf8'); await w.ewOpenUi();
      ok(/Network: set by practice mode to Testnet/.test($('ewOut').textContent)&&!/set by hand/.test($('ewOut').textContent),'v2.16.1 review: the Electrum file report says practice mode set the network');
      w.ewClear(); const b=new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures','walletdat','descriptor.sqlite'))); await w.wdatShow(b,'');
      ok(/Network: set by practice mode to Testnet/.test($('wdatOut').textContent),'v2.16.1 review: the wallet.dat report says practice mode set the network'); w.wdatClear(); w.practiceMode(false); }
    // tester T2: a public seed in CHECK A BACKUP: PRINT WORDS, the recovery sheet, the punch plate, Seed XOR's parts and a BIP85 child say PRACTICE
    { const P391=w.eval('DM_EXAMPLES')?null:null; w.showTab('check'); $('phrase').value=AB; $('verifyPass').value=''; await w.verify(); await new Promise(x=>setTimeout(x,300)); await w.wvRefresh();
      const pub='PRACTICE: This seed is a public or predictable seed (it is one of the official BIP39 test phrases). Anyone can make it again: never put money on it.';
      const pr=async(f)=>{ const p0=st.printed; await f(); const tx=(st.printHTML||'')+'|'+(st.printQrText||''); after(); return st.printed===p0+1?tx:''; };
      let t1=await pr(()=>w.printSeed('check')); ok(t1.includes('VOIDFORGE BACKUP SHEET: PRACTICE')&&t1.includes(pub),'tester T2: PRINT WORDS of a public seed in CHECK A BACKUP says PRACTICE');
      t1=await pr(()=>w.printRecoverySheet()); ok(t1.includes('VOIDFORGE RECOVERY SHEET: PRACTICE')&&t1.includes(pub),'tester T2: PRINT RECOVERY SHEET of a public seed says PRACTICE');
      t1=await pr(()=>w.printPlate()); ok(/: PRACTICE/.test(t1)&&t1.includes(pub),'tester T2: PRINT PLATE of a public seed says PRACTICE');
      w.document.querySelector('input[name=xorMode][value=split]').checked=true; w.xorModeChange(); $('phrase').value='legal winner thank year wave sausage worth useful legal winner thank yellow'; $('xorFrom').value='coldcard'; await w.seedXorUi('split');   // (abandon ... about, all zeros, is not split)
      t1=await pr(()=>w.printXorParts()); ok(t1.includes('VOIDFORGE SEED XOR PART A OF 3: PRACTICE')&&/PRACTICE: these parts make a public seed: .+\. Anyone can make it again: never put money on it\./.test(t1),'tester T2: Seed XOR PRINT THE PARTS of a public seed says PRACTICE on each part ('+t1.slice(0,90)+')');
      $('phrase').value=AB; $('childApp').value='words'; $('childIndex').value='0'; await w.deriveChild(); t1=await pr(()=>w.printChild()); ok(t1.includes('VOIDFORGE CHILD SEED (BIP85): PRACTICE')&&t1.includes('PRACTICE: this child comes from a public parent seed:'),'tester T2: PRINT CHILD SEED of a public parent says PRACTICE');
      $('verifyPass').value='a passphrase'; await w.deriveChild(); t1=await pr(()=>w.printChild()); ok(t1&&!/PRACTICE/.test(t1),'tester T2: a child of a public parent with a passphrase is not public: no PRACTICE');
      $('verifyPass').value=''; $('phrase').value='screen truck market purse stumble turn across conduct exact armor neither guitar'; await w.verify(); await new Promise(x=>setTimeout(x,300)); await w.wvRefresh();
      t1=await pr(()=>w.printRecoverySheet()); ok(t1&&!/PRACTICE/.test(t1),'tester T2: a seed that is not public prints no PRACTICE');
      w.clearAll(); }
    // tester T5: the Wallet Detective says before the search that a testnet address and the Network menu on Mainnet disagree, and offers the fix
    { w.showTab('check'); $('phrase').value=AB; $('detNet').value='main'; $('detAddr').value='tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';
      const p=w.detFind(); await new Promise(x=>setTimeout(x,200)); const n=$('detNetNote');
      ok(n.style.display===''&&/^This is a Testnet address, but the Network menu says Mainnet, so the search uses Mainnet paths \(coin type 0\)/.test(n.textContent)&&n.querySelector('button').textContent==='SEARCH ON TESTNET','tester T5: a testnet address with the menu on Mainnet is named before the search, with SEARCH ON TESTNET ('+n.textContent.slice(0,80)+')');
      w.detStop(); await p; n.querySelector('button').click(); await new Promise(x=>setTimeout(x,100)); ok($('detNet').value===''&&n.style.display==='none','tester T5: SEARCH ON TESTNET sets the menu to as guessed and searches again'); w.detStop(); await new Promise(x=>setTimeout(x,300));
      { const T=await w.detTarget('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl'); T.pathNet='test'; ok(w.detNetNote(T)===false&&n.style.display==='none','tester T5: no note when they agree'); }
      w.clearAll(); }
    // tester: labels and keys follow the network: Electrum on Testnet says tb1q and shows a vpub; the Detective says tb1q for a tb1 address
    { const FX=path.join(__dirname,'fixtures','electrum'); $('ewNet').value='test'; $('ewIn').value=fs.readFileSync(path.join(FX,'zpub-watch.json'),'utf8'); await w.ewOpenUi();
      const o=$('ewOut').textContent, zp=JSON.parse(fs.readFileSync(path.join(FX,'zpub-watch.json'),'utf8')).keystore.xpub;
      const vp=HDKey.fromExtendedKey(zp,{private:0x04b2430c,public:0x04b24746}); const vpub=new HDKey({versions:{private:0x045f18bc,public:0x045f1cf6},depth:vp.depth,index:vp.index,parentFingerprint:vp.parentFingerprint,chainCode:vp.chainCode,publicKey:vp.publicKey}).publicExtendedKey;
      ok(/Address type: native SegWit \(tb1q\.\.\.\)/.test(o)&&o.includes('Extended public key (vpub): '+vpub+' (the file has it as zpub: '+zp+')'),'tester: the Electrum report on Testnet says tb1q and shows the key as a vpub (@scure/bip32), with the file\'s zpub');
      $('ewNet').value='regtest'; await w.ewOpenUi(); ok(/native SegWit \(bcrt1q\.\.\.\)/.test($('ewOut').textContent),'tester: on Regtest it says bcrt1q');
      w.ewClear(); $('ewNet').value='';
      ok(w.netEx('native SegWit (bc1q...)','test')==='native SegWit (tb1q...)'&&w.netEx('legacy (1...)','regtest')==='legacy (m... or n...)'&&w.netEx('nested SegWit (3...)','main')==='nested SegWit (3...)','tester: the address type examples follow the network'); }
    // tester: plain messages for a wrong word count; the hints that changed
    { w.showTab('tools'); $('phrase').value='abandon abandon'; w.document.querySelector('input[name=xorMode][value=split]').checked=true; w.xorModeChange(); $('phrase').value='abandon abandon'; await w.seedXorUi('split');
      ok(/A seed phrase has 12, 15, 18, 21 or 24 words; this has 2\./.test($('xorStatus').textContent)&&!/Invalid length/.test($('xorStatus').textContent),'tester: Seed XOR says how many words a seed has, not "Invalid length"');
      $('phrase').value=''; await w.deriveChild(); ok(/No words are typed\./.test($('childStatus').textContent),'tester: the child seed says no words are typed ('+$('childStatus').textContent.slice(0,80)+')');
      ok(/The practice signer is covered while it holds a seed that is not public/.test(html)&&!/The practice signer is not covered: it holds practice seeds only/.test(html),'tester: the re-hide help under MAKE A SEED says when the practice signer is covered');
      w.clearAll(); w.showTab('make'); w.setMethod('cards'); $('cdHex').value='0f1e2d3c4b5a69788796a5b4c3d2e1f0'; w.cdUpdate(); await w.cdHexGenerate(); ok(/MENU > PRINT SEED prints them\./.test($('nextStep').textContent),'tester: the hint under YOUR SEED names MENU > PRINT SEED'); w.clearAll(); }
    // tester T3: OPEN A PRACTICE WALLET says where it opened and that practice mode is on for the whole page; turning it off clears that
    { w.showTab('check'); $('prSrcTest').checked=true; await w.practiceWallet(); await new Promise(x=>setTimeout(x,200));
      ok(/^Opened on the test network in CHECK A BACKUP, Open this wallet \(above\)\. Practice mode is now on for the whole page: see the note above\.$/.test($('prWalletStatus').textContent)&&/ok/.test($('prWalletStatus').className)&&$('prWalletPr')&&/Turn practice mode off/.test($('prWalletPr').textContent),'tester T3: OPEN A PRACTICE WALLET says where it opened and that practice mode is on for the whole page, with a way to turn it off');
      $('prWalletPr').querySelector('button').click(); ok(!w.eval('practiceOn')&&$('prWalletStatus').textContent==='','tester T3: Turn practice mode off turns it off and clears the line'); w.clearAll(); }
    ok(r.errors.length===0,'v2.16.1 review: no page errors '+JSON.stringify(r.errors));
    r.w.close(); })();
  // item 8: changelog
  ok(/Changelog/.test(html)&&/Breaking/.test(html),'changelog documents the H/T breaking change');

  sweep(t);
  // --- no network / external references ---
  const src=html.replace(/const WORDLIST = \[.*?\];/s,'');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|<script[^>]+src=|<link(?! rel="icon" type="image\/[a-z+]+"(?: sizes="\d+x\d+")? href="data:)|@import/.test(src),'no network APIs or external resources');
  const urls=[...src.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]); ok(urls.every(u=>u.startsWith('https://github.com/Random21m/VOIDFORGE')||u==='https://random21m.github.io/VOIDFORGE/'||u==='https://random21m.github.io'||u==='http://www.w3.org/2000/svg'),'the only URLs are the project\'s own GitHub addresses (and the SVG namespace name the card pictures use, which is never visited): '+urls.join(', '));
  ok(t.errors.length===0,'no uncaught page errors '+JSON.stringify(t.errors));
  console.log(failed?`\n${failed} CHECK(S) FAILED`:'\nALL CHECKS PASSED'); process.exit(failed?1:0);
})().catch(e=>{ console.log('FAIL the run stopped: '+(e&&e.stack||e)); console.log('\nTHE RUN STOPPED'); process.exit(1); });
