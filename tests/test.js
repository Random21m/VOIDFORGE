// Automated checks for voidforge.html. Run: npm i jsdom && node tests/test.js [path/to/voidforge.html]
const {JSDOM}=require('jsdom'); const fs=require('fs'); const path=require('path'); const nc=require('crypto');
const file=process.argv[2]||path.join(__dirname,'..','voidforge.html');
const html=fs.readFileSync(file,'utf8');
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
      // through the real file box
      const F=new t.w.File([bytes],'voidforge.html'); Object.defineProperty(t.$('dlFile'),'files',{value:[F],configurable:true}); t.$('dlPaste').value=sha; await t.w.dlPick();
      ok(/^MATCH/.test(t.$('dlStatus').textContent)&&t.$('dlStatus').classList.contains('ok')&&t.$('dlOut').textContent.includes(sha)&&t.$('dlOut').textContent.includes(r0.cid),'download check: choosing a file shows MATCH, the hash and the CID');
      t.$('dlPaste').value=bad; await t.w.dlPick(); ok(/^NO MATCH/.test(t.$('dlStatus').textContent)&&t.$('dlStatus').classList.contains('bad'),'download check: a wrong published hash shows NO MATCH in red');
      Object.defineProperty(t.$('dlFile'),'files',{value:[{name:'big.bin',size:64*1024*1024+1}],configurable:true}); await t.w.dlPick(); ok(/larger than 64 MB/.test(t.$('dlStatus').textContent)&&t.$('dlOut').style.display==='none','download check: a file over 64 MB is refused');
      t.w.dlClear(); ok(t.$('dlPaste').value===''&&t.$('dlStatus').textContent===''&&t.$('dlOut').textContent==='','download check: CLEAR empties the box, status and output');
      ok(/id="dlBox"/.test(html)&&!/localStorage|sessionStorage|indexedDB|XMLHttpRequest|fetch\(/.test((html.match(/function dlCheck[\s\S]*?function clearChild/)||[''])[0]),'download check: the tool stores nothing and uses no network'); }
    { // Support this project (v1.27.3): optional, text plus a QR drawn by the page, no links, nothing sent
      const box=t.$('supportBox'), addr=t.$('supportAddr').textContent, code=t.$('supportLnurl').textContent.trim();
      ok(box&&!box.open&&/Support this project/.test(box.querySelector('summary').textContent)&&/Optional/.test(box.querySelector('summary').textContent),'support: a closed, optional "Support this project" box in ABOUT & HELP');
      ok(addr==='dev@breez.tips'&&code==='LNURL1DP68GURN8GHJ7CNJV4JH5TN5D9C8XTMVDE6HYMRS9AJX2ASZ5RD0C','support: the Lightning address and payment code are exactly the maintainer\'s');
      const svg=t.$('supportQr').querySelector('svg'); ok(svg&&svg.querySelector('path')&&t.w.qrMatrix(code).rows.length>=21,'support: the QR is drawn by the page from the payment code');
      ok(box.querySelectorAll('a, [href], img, iframe, script').length===0&&/never goes online/.test(box.textContent)&&/never send seed words/i.test(box.textContent),'support: no link, image or script in the box, and it says nothing is sent and never to send seed words');
      t.st.clip.length=0; const b=box.querySelectorAll('button'); b[0].click(); await new Promise(r=>setTimeout(r,20)); b[1].click(); await new Promise(r=>setTimeout(r,20)); const c1=t.st.clip[0], copied=t.st.clip[1];
      ok(b.length===2&&c1==='dev@breez.tips'&&copied===code,'support: COPY copies the address and the payment code exactly'); }
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
  ok(/do not match/.test(t.$('genResult').textContent)&&t.$('fingerprint').textContent===''&&t.$('address').textContent==='','mismatched passphrase boxes block FORGE and show no fingerprint or address');
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
    typePass('abc'); ok(!seedOn()&&!fpOn()&&!adOn()&&g.d.querySelectorAll('#wordGrid .wcell:not(.empty)').length===0&&g.$('watchBox').style.display==='none'&&/changed the rolls, the word count or the passphrase/.test(g.$('genResult').textContent)&&!g.$('wZpub').textContent,'stale guard: typing a passphrase after FORGE clears the words, fingerprint, address and watch-only keys');
    g.st.alerts.length=0; g.w.downloadSeed(); ok(g.st.alerts.some(m=>/Generate a seed first/.test(m)),'stale guard: DOWNLOAD refuses after the inputs changed');
    typePass(''); await g.w.generate(); ok(seedOn()&&first()===W1,'stale guard: pressing FORGE again with the same rolls gives the same words');
    g.set(R1.slice(0,49)+(R1[49]==='1'?'2':'1')); ok(!seedOn()&&!fpOn()&&!adOn(),'stale guard: changing a roll after FORGE clears the result');
    await forge(R1); g.set(R1.slice(0,-1)); ok(!seedOn()&&!fpOn()&&!adOn(),'stale guard: removing a roll after FORGE clears the result');
    await forge(R1); g.w.undoRoll(); ok(!seedOn(),'stale guard: UNDO after FORGE clears the result');
    await forge(R1); g.words(24); ok(!seedOn()&&!fpOn()&&g.d.querySelectorAll('#wordGrid .wcell').length===24&&g.d.querySelectorAll('#wordGrid .wcell:not(.empty)').length===0,'stale guard: changing the word count after FORGE clears the result');
    await forge(R1); g.mode('coin'); ok(!seedOn()&&!fpOn(),'stale guard: switching dice/coin after FORGE clears the result'); g.mode('dice');
    await forge(R1,'p1'); g.$('passphrase2').value='p2'; g.$('passphrase2').dispatchEvent(new g.w.Event('input',{bubbles:true})); ok(!seedOn(),'stale guard: editing the confirm-passphrase box also clears the result');
    { const sp=R1.replace(/(.)/g,'$1 '); await forge(sp); g.w.downloadSeed(); const txt=await blobText(g.w,g.st.blob); ok(txt.endsWith('Input: '+R1)||txt.includes('Input: '+R1+'\n'),'stale guard: the saved file records the rolls that made the words (cleaned), not what is typed now'); }
    { const A11='abandon '.repeat(11); g.$('wdLen').value='12'; g.$('wdWords').value=A11; g.$('wdFlips').value='0000000'; g.$('passphrase').value=''; g.$('passphrase2').value=''; g.w.wdUpdate(); await g.w.wdGenerate();
      ok(seedOn()&&/abandon/.test(first()),'stale guard: a seed from the Word draw box exists');
      g.set(rnd(10,6)); g.words(24); g.words(12); g.mode('coin'); g.mode('dice'); ok(seedOn(),'stale guard: rolls, word count and mode do not matter to a Word draw seed');
      typePass('zzz'); ok(!seedOn()&&!fpOn(),'stale guard: a passphrase edit does clear a Word draw seed'); }
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
    { const LW=async(x)=>{ t.$('lwInput').value=x; await t.w.findLastWords(); return [t.$('lwStatus').textContent,t.$('lwStatus').className,t.$('lwOut').textContent,t.$('lwOut').style.display]; };
      let [a,c,o,d]=await LW('abandon '.repeat(11)); ok(/^128 words complete this 12-word phrase/.test(a)&&/ok/.test(c)&&d==='block'&&o.split(/\s+/).length===128&&/(^|\s)about(\s|$)/.test(o),'last word helper lists the 128 words for 11 x abandon');
      [a,c,o,d]=await LW('abandon '.repeat(23)); ok(/^8 words complete this 24-word phrase/.test(a)&&/(^|\s)art(\s|$)/.test(o),'last word helper lists 8 words for 23 words');
      [a,c,o,d]=await LW('abandon '.repeat(10)); ok(/Type 11, 14, 17, 20 or 23/.test(a)&&/bad/.test(c)&&d==='none','last word helper rejects a wrong word count');
      [a,c,o,d]=await LW('abandon '.repeat(10)+'xyzzy'); ok(/Unknown word: xyzzy/.test(a)&&d==='none','last word helper reports an unknown word');
      await LW('abandon '.repeat(11)); t.$('lwInput').dispatchEvent(new t.w.Event('input')); ok(t.$('lwOut').textContent===''&&t.$('lwStatus').textContent==='','editing the words clears the last word list');
      await LW('abandon '.repeat(11)); t.w.clearLastWords(true); ok(t.$('lwInput').value===''&&t.$('lwOut').textContent==='','CLEAR empties the last word box and list'); }
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
    taps[0].onclick(); taps[5].onclick(); taps[2].onclick(); eq(t.$('rolls').value,'163','tap buttons append rolls and update the counter'); ok(/3 \/ 50/.test(t.$('rollCount').textContent),'counter updates after taps');
    const coin=t.d.querySelector('input[name="mode"][value="coin"]'); t.$('rolls').value=''; coin.checked=true; t.w.onModeChange();
    const ct=[...t.d.querySelectorAll('#tapRow button')]; ok(ct.length===2&&ct[0].dataset.v==='1'&&ct[1].dataset.v==='0'&&/HEADS/.test(ct[0].textContent)&&/TAILS/.test(ct[1].textContent),'coin mode shows 1 and 0 tap buttons');
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
    ok(t.$('advanced').open===true&&[...t.$('wordGrid').children].every(c=>c.classList.contains('empty'))&&!t.$('genResult').dataset.seed&&/PASSPHRASE SET/.test(t.$('advSummary').textContent),'mismatch opens Advanced options, hides the grid and flags the passphrase');
    t.st.alerts.length=0; await t.w.sendToVerify(); t.w.printSeed(); t.w.downloadSeed();
    ok(t.st.alerts.length===3&&t.$('phrase').value!==t.$('genResult').textContent.split('\n')[0].trim(),'after a mismatch SEND TO VERIFY, PRINT and DOWNLOAD refuse (error text is never used as a seed)');
    t.$('passphrase').value=''; t.$('passphrase2').value=''; t.w.updateAdvSummary(); ok(!/PASSPHRASE SET/.test(t.$('advSummary').textContent),'advanced summary flag clears');
    t.$('rolls').value='123'; t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent,'Enter 47 more rolls (3 of 50).','too few rolls: plain message');
    t.$('rolls').value='1'.repeat(53); t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent,'Remove 3 rolls (53 of 50).','too many rolls: plain message');
    t.$('rolls').value='1'.repeat(49); t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent,'Enter 1 more roll (49 of 50).','one roll short: singular');
    t.$('rolls').value='1'.repeat(51); t.w.updateCount(); await t.w.generate(); eq(t.$('genResult').textContent,'Remove 1 roll (51 of 50).','one roll over: singular');
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
  ok(/DICE \/ COIN ENTROPY/.test(t.d.querySelector('.subtitle').textContent),'header says dice / coin');
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
  ok(!/<a\s/i.test(html.replace(/const WORDLIST = \[.*?\];/s,'')),'page contains no links');
  // v1.2: only 12/24 words, no copy-seed button
  eq([...t.d.querySelectorAll('input[name=words]')].map(e=>e.value).join(','),'12,24','only 12 and 24 word options are offered');
  ok(![...t.d.querySelectorAll('button')].some(b=>/COPY SEED/.test(b.textContent))&&typeof t.w.copyResult==='undefined','no copy-seed button or function');
  { const pb=t.$('privacyBox'); ok(!!pb&&/Privacy/.test(pb.querySelector('summary').textContent)&&pb.querySelectorAll('ul li').length===6&&!pb.querySelector('a,script,img,form,input'),'privacy box has six points and no links or inputs');
    const keys=[...html.matchAll(/localStorage\.setItem\("([^"]+)"/g)].map(m=>m[1]).sort().join(',');
    ok(keys==='voidforge-big,voidforge-theme'&&/Only two things are remembered/.test(pb.textContent),'privacy box: the page stores exactly the theme and text size, as the box says');
    ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(html.replace(/const WORDLIST = \[.*?\];/s,'')),'privacy box: no network calls in the page'); }
  { const sb=t.$('safetyBox'); ok(!!sb&&/Browser safety checklist/.test(sb.querySelector('summary').textContent)&&sb.querySelectorAll('ol li').length===8&&!sb.querySelector('a,script,img,form,input'),'browser safety checklist has eight items and no links or inputs');
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
  { const cubes=[...t.$('logo').querySelectorAll('.cube')], num=(c,k)=>+c.querySelector('.f.'+k).dataset.n, grid={1:'000010000',2:'100000001',3:'100010001',4:'101000101',5:'101010101',6:'101101101'};
    ok(cubes.length===3&&t.$('logo').tabIndex===0&&cubes.map(c=>num(c,'fr')).join()==='3,5,6','logo is three dice (3, 5, 6) and can be reached by keyboard');
    ok(cubes.every(c=>c.querySelectorAll('.f').length===6&&['fr:bk','rt:lf','tp:bt'].every(q=>num(c,q.split(':')[0])+num(c,q.split(':')[1])===7)&&[...c.querySelectorAll('.f')].every(f=>[...f.children].map(x=>x.tagName==='I'?'1':'0').join('')===grid[f.dataset.n])&&c.querySelectorAll('i.m').length===5),'logo: each die is a real cube, six faces, opposite faces add to 7, pips laid out like a real die');
    ok(cubes.map(c=>c.parentNode.parentNode.getAttribute('style')).join('|')==='--dl:0.14s; --fx:-46px; --ry:-34deg|--dl:0s; --fx:0px; --ry:-30deg|--dl:0.28s; --fx:46px; --ry:-26deg','logo: the dice fall from spread-out spots and land at slightly different angles');
    { const rule=n=>(html.match(new RegExp('\\.logo \\.'+n+' \\{[^}]*\\}'))||[''])[0], roll=(html.match(/@keyframes dieRoll \{[\s\S]*?\n  \}/)||[''])[0];
      ok(/preserve-3d/.test(rule('cube'))&&/preserve-3d/.test(rule('fl'))&&!/opacity|filter/.test(rule('cube')+rule('fl')+roll)&&roll.length>200,'logo: the cube keeps its 3D (no opacity or filter on the cube itself, they flatten it)'); }
    { const css=html.match(/<style>[\s\S]*?<\/style>/)[0], hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
      const lum=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);};
      const cr=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const tags=[...t.w.document.querySelectorAll('.tag-rec')], opts=[...t.w.document.querySelectorAll('option.opt-rec')];
      // every "recommended" label on a screen (not the changelog or help text) is a badge or a coloured option
      const labels=[...t.w.document.querySelectorAll('summary, option')].filter(e=>/recommended/i.test(e.textContent));
      ok(tags.length===2&&opts.length===1&&labels.length===3&&labels.every(e=>e.querySelector('.tag-rec')||e.classList.contains('opt-rec')),'recommended: every RECOMMENDED label is an amber badge (or an amber option in the menu)');
      ok(t.w.document.querySelectorAll('.tag-note').length===4&&![...t.w.document.querySelectorAll('summary')].some(e=>/\((demo only|advanced)/i.test(e.textContent)),'tags: DEMO ONLY, ADVANCED and NEW are grey badges, no longer plain (brackets) in the headings');
      const warn={d:/:root \{[^}]*--warn-text: (#[0-9a-f]{6})/.exec(css)[1],l:/body\.light \{[^}]*--warn-text: (#[0-9a-f]{6})/.exec(css)[1]};
      const surf={d:/--surface2: (#[0-9a-f]{6})/.exec(css)[1],l:/body\.light \{[^}]*--surface2: (#[0-9a-f]{6})/.exec(css)[1]};
      ok(/\.strip b \{ color: var\(--warn-text\); \}/.test(css)&&/\.tag-rec \{[^}]*color: var\(--warn-text\)[^}]*border-color: var\(--warn-text\)/.test(css)&&/\.opt-rec \{[^}]*color: var\(--warn-text\)/.test(css),'recommended: uses the same amber as the "not independently audited" banner');
      const mixc=(fg,al,bg)=>fg.map((v,i)=>v*al+bg[i]*(1-al)), lt=/body\.light \.tag-rec \{ color: (#[0-9a-f]{6});/.exec(css)[1];
      ok(cr(hex(warn.d),mixc(hex(warn.d),.12,hex(surf.d)))>=4.5&&cr(hex(lt),mixc(hex(lt),.08,hex(surf.l)))>=4.5&&cr(hex(warn.l),hex(lt))<1.6,'recommended: the amber badge text keeps contrast >= 4.5:1 in both themes (light theme uses a slightly deeper shade of the same amber)'); }
    ok(/\.logo \{[^}]*position: relative; z-index: 0;/.test(html)&&/#statusLine \{ position: relative; z-index: 1;/.test(html),'logo: the falling dice pass behind the status line text, not over it');
    ok(/\n  h1 \{[^}]*font-size: 37px;[^}]*filter: drop-shadow\([^}]*\}/.test(html)&&/\.logo \{ --S: 40px;/.test(html),'header: VOIDFORGE is 37px with a soft neon glow, and the dice are 40px so the name leads');
 t.w.rollLogo(); ok(t.$('logo').classList.contains('again'),'tapping the logo rolls the dice again'); t.w.rollLogo();
    t.$('demoOn').checked=true; t.$('rolls').value='3141'; await t.w.demoRefresh(); ok(t.d.querySelectorAll('#demoGrid .dm-w').length===12&&/NOT your seed/.test(t.$('demoOut').textContent),'demo shows 12 labelled demo words');
    t.w.demoOff(); ok(!t.d.querySelector('#demoGrid .dm-w')&&t.$('demoOut').style.display==='none','demo wipes when switched off'); t.$('rolls').value=''; }
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
    tp.w.practiceHide(); ok($('prWords').textContent===''&&$('prShow').style.display==='none'&&$('prCheck').style.display==='block'&&!tp.d.body.textContent.includes(words.join(' ')),'practice: HIDE removes the words from the page');
    $('prInput').value=words.join(' '); tp.w.practiceCheck(); ok(/ok/.test($('prStatus').className)&&/matches, word for word/.test($('prStatus').textContent),'practice: the correct paper copy is confirmed');
    $('prInput').value=words.map((w,i)=>i===4?'zoo':w).join(' '); tp.w.practiceCheck(); ok(/bad/.test($('prStatus').className)&&/Word 5 does not match/.test($('prStatus').textContent),'practice: a wrong word is flagged');
    $('prInput').dispatchEvent(new tp.w.Event('input')); eq($('prStatus').textContent,'','practice: typing clears the result');
    tp.w.practicePeek(); ok($('prWords').children.length===12&&$('prShow').style.display==='block','practice: SHOW THE WORDS AGAIN brings them back');
    tp.w.practiceHide(); tp.w.practiceClear(); ok(tp.w.eval('practice')===null&&$('prWords').textContent===''&&$('prInput').value===''&&$('prShow').style.display==='none'&&$('prCheck').style.display==='none','practice: CLEAR forgets the phrase and empties the page');
    tp.w.practiceCheck(); tp.w.practiceHide(); tp.w.practicePeek(); ok($('prShow').style.display==='none'&&$('prCheck').style.display==='none','practice: buttons do nothing before a practice starts');
    const a=[],b=[]; for(let i=0;i<5;i++){ await tp.w.practiceStart(); a.push(tp.w.eval('practice.words.join(" ")')); } ok(new Set(a).size===5,'practice: each practice phrase is different');
    ok(!/^abandon abandon/.test(a[0])&&a.every(x=>x.split(' ').length===12),'practice: phrases are random, not the well-known test phrase'); }
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
    { const ids=['rolls','forgeBtn','genResult','wordGrid','fingerprint','address','passphrase','passphrase2','note','phrase','verifyPass','verifyRecorded','checkAddr','psbtInput','cmpA','cmpB','msN','msM','msBox','wdBox','demoBox','advanced','addrBox','explainBox','seedQrBox','watchBox','about','beforeCard','disclaimer','safetyBox','privacyBox','multiHelp','practiceBox','psbtBox','fpIcon','guidePanel','tapRow','testResults','printOnly','printQr','netTag','selfTestBadge','logo'];
      const missing=ids.filter(id=>!tl.$(id)); ok(missing.length===0,'feature inventory: every earlier control and section is still on the page'+(missing.length?' (missing '+missing.join(', ')+')':''));
      const homeless=['rolls','forgeBtn','phrase','psbtInput','cmpA','msN','about','beforeCard','disclaimer'].filter(id=>!tl.$(id).closest('.tabpanel')); ok(homeless.length===0,'feature inventory: every tool lives inside a tab'+(homeless.length?' ('+homeless.join(', ')+')':''));
      ok(['printOnly','printQr'].every(id=>!tl.$(id).closest('.tabpanel')),'printing works from any tab: the print sheets sit outside the tabs');
      const btns=[...tl.d.querySelectorAll('button')].filter(b=>!b.closest('.tabpanel')&&!b.closest('#startGate')&&!b.closest('#tabs')).map(b=>b.textContent.trim().replace(/\s+/g,' ')).sort().join('|');
      eq(btns,['DARK','DOWNLOAD FOR USB','GUIDE ME','GUIDE ME','PRINT SEED','TEXT A+','Read before real keys \u2192'].sort().join('|'),'page frame holds exactly the top buttons and the notice link'); }
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
    tc.set(rnd(50,6)); ok(cur()==='done,done,done,cur,-','step bar: Forge is current once there are enough rolls');
    tc.$('forgeBtn').disabled=false; await tc.w.generate(); ok(cur()==='done,done,done,done,cur'&&/Seed made/.test(sub().textContent),'step bar: Check is current after forging');
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
    ok(['9 0 0','0 0 0','3 G 7','abc','3 A','3 A 7 7','-'].every(x=>F(x).word===undefined&&F(x).idx===undefined&&F(x).msg==='Type a number from 1 to 2048, or a D8 roll (1-8) then two hex digits (0-F), like 3 A 7.'),'word finder: bad entries give a hint and no word');
    ok(['0','2049','99999'].every(x=>F(x).msg==='A word number is between 1 and 2048.'&&F(x).idx===undefined),'word finder: out-of-range numbers are explained');
    ok(F('').msg===''&&F('   ').msg==='','word finder: empty entry says nothing');
    tw.w.document.getElementById('wdFind').value='3 A 7'; tw.w.wdFind(); ok(tw.$('wdFound').textContent==='Word 680: female','word finder: shows the word on the page');
    ok(tw.$('wdFind').closest('#tp-make')!==null,'word finder: lives in the Make a seed tab'); }
  ok(/#cardGen \.gen-right \{ grid-column: 2; grid-row: 1 \/ span 2;[^}]*position: sticky/.test(html)&&/#cardGen \.gen-bottom \{ grid-column: 1; grid-row: 2;/.test(html),'layout: the sticky Your seed panel sits beside all the content and never slides over it (QR codes were hidden behind it)');
  { const tg=load(); await tg.ready(); const g=tg.$('startGate'), body=g.querySelector('.sg-body'), go=tg.$('sgGo');
    ok(!!body&&!body.contains(go)&&go.parentNode.classList.contains('sg-box')&&body.parentNode.classList.contains('sg-box'),'start notice: the I understand button sits outside the scrolling text, so it is always on screen (phones could not reach it)');
    ok(/#startGate \.sg-box \{[^}]*max-height: 100%; overflow: hidden; display: flex; flex-direction: column;/.test(html)&&/#startGate \.sg-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/.test(html)&&/#startGate \.sg-go, #startGate \.sg-foot \{ flex: none; \}/.test(html),'start notice: the box fits the screen, only the text scrolls, the button and footer never shrink or scroll away');
    ok(/#startGate \{ position: fixed; top: 0; right: 0; bottom: 0; left: 0;/.test(html)&&!/inset:/.test(html),'start notice: covers the screen with top/right/bottom/left (the inset shorthand fails on iOS before 14.1)');
    ok(tg.d.body.classList.contains('js-ok')&&/#startGate \{[^}]*display: none;/.test(html)&&/body\.js-ok #startGate \{ display: flex; \}/.test(html),'start notice: only shown once the script has run, so a phone that blocks scripts shows the red warning instead of a dead button');
    ok((html.match(/\n  #startGate \{/g)||[]).length===1&&!/#startGate[^{]*\{[^}]*display:[^;}]*!important/.test(html),'start notice: nothing forces the notice to show when the script has not run');
    ok(body.getAttribute('tabindex')==='0'&&/things to know/.test(body.getAttribute('aria-label')||''),'start notice: the scrolling text is reachable by keyboard and named'); }
  ok(/\.tabpanel \[id\] \{ scroll-margin-top: 84px; \}/.test(html),'layout: every section keeps clear of the sticky tab bar when the page jumps to it');
  ok(/@media \(min-width: 861px\) \{ #cardGen \.gen-right \{ max-height: calc\(100vh - 92px\); overflow-y: auto;/.test(html),'layout: a tall Your seed panel scrolls inside itself so its bottom buttons (COPY, DOWNLOAD) stay reachable');
  ok(/#qrBox, #sqBox, #msQrBox \{ scroll-margin: 80px 0 20px; \}/.test(html),'layout: QR boxes keep clear of the sticky tab bar when scrolled to');
  { const tq=load(); await tq.ready(); const seen=[]; const spy=(id)=>{const el=tq.$(id); el.scrollIntoView=(o)=>seen.push([id,o&&o.block]);};
    ['qrBox','sqBox'].forEach(spy); tq.w.document.getElementById('wDescR').textContent='wpkh(x)'; tq.w.showQr('wDescR','receive descriptor');
    ok(seen.length===1&&seen[0][0]==='qrBox'&&seen[0][1]==='nearest','QR: showing the watch-only QR scrolls it fully into view');
    tq.set(rnd(50)); await tq.w.generate(); tq.w.showSeedQr('seedqr'); ok(seen.length===2&&seen[1][0]==='sqBox'&&seen[1][1]==='nearest','QR: showing the SeedQR scrolls it fully into view'); }
  ok(/body\.light \.tabs button \{ color: #fff; background: #0066cc/.test(html),'tabs: light mode shows white tab names on blue');
  { const td=load(); await td.ready(); ok(td.d.body.classList.contains('dice-wait')&&!!td.$('startGate'),'dice: held back while the notice is open');
    ok(/body\.dice-wait \.logo \.die, body\.dice-wait \.logo \.cube[^{]*\{\s*animation:\s*none !important/.test(html),'dice: the stylesheet pauses the falling dice while waiting');
    td.w.startGateClose(); ok(!td.d.body.classList.contains('dice-wait'),'dice: released when the notice is closed with the button');
    const te=load(); await te.ready(); te.d.dispatchEvent(new te.w.KeyboardEvent('keydown',{key:'Escape'})); ok(!te.d.body.classList.contains('dice-wait'),'dice: released when the notice is closed with Escape');
    const tn=load(); await tn.ready(); tn.$('startGate').remove(); tn.d.dispatchEvent(new tn.w.Event('DOMContentLoaded')); ok(!tn.d.body.classList.contains('dice-wait'),'dice: not held back if there is no notice'); }
{ const tf=load({focusSpy:true}); await tf.ready(); await new Promise(r=>setTimeout(r,100));
    ok(tf.st.focus.some(x=>x[0]==='sgGo'&&x[1]&&x[1].preventScroll===true)&&!tf.st.focus.some(x=>x[0]==='rolls'),'opening the page focuses the notice button (not the rolls box) without scrolling');
    tf.st.focus.length=0; tf.w.startGateClose(); const f=tf.st.focus.find(x=>x[0]==='rolls'); ok(!!f&&f[1]&&f[1].preventScroll===true&&!tf.$('startGate'),'closing the notice removes it and focuses the rolls box without scrolling the page down to it');
    { const tg=load(); await tg.ready(); const g=tg.$('startGate'); ok(!!g&&g.getAttribute('role')==='dialog'&&g.getAttribute('aria-modal')==='true'&&/educational tool/.test(g.textContent)&&/not been independently audited/.test(g.textContent)&&g.querySelectorAll('.sg-item').length===3&&/swap files, hibernation/.test(g.textContent)&&/Clipboard history/.test(g.textContent)&&/restart the computer/.test(g.textContent),'notice: educational, not audited, and the three warnings with what to do');
      ok(g.querySelectorAll('.sg-fix').length===3&&/I understand, let's go/.test(tg.$('sgGo').textContent),'notice: each warning has a fix and one button closes it');
      tg.d.dispatchEvent(new tg.w.KeyboardEvent('keydown',{key:'Escape'})); ok(!tg.$('startGate'),'notice: Escape closes it');
      const t5=load(); await t5.ready(); ok(!!t5.$('startGate'),'notice: shows again each time the file is opened');
      ok(/BEFORE YOU MAKE REAL KEYS/.test(tg.$('beforeCard').textContent)&&tg.$('beforeCard').querySelectorAll('.sg-item').length===3&&tg.$('beforeCard').closest('#tp-about')!==null&&/Read before real keys/.test(tg.$('strip').textContent),'the three warnings live in the About tab, reached from the one-line notice');
      ok(/offline computer, keep clipboard history off, and restart/.test(tg.d.querySelector('.forge-note').textContent),'one-line note next to FORGE SEED'); } }
  { const tc=load(); await tc.ready(); const h=await tc.w.sha256bytes(new TextEncoder().encode('123456'));
    const m24=await tc.w.entropyToMnemonic(h), m12=await tc.w.entropyToMnemonic(h.slice(0,16));
    ok(m24==='mirror reject rookie talk pudding throw happy era myth already payment own sentence push head sting video explain letter bomb casual hotel rather garment'&&m12==='mirror reject rookie talk pudding throw happy era myth already payment owner','Coldcard compatibility: its documented example (rolls 123456) gives the same 24 and 12 words'); }
  // item 8: changelog
  ok(/Changelog/.test(html)&&/Breaking/.test(html),'changelog documents the H/T breaking change');

  // --- no network / external references ---
  const src=html.replace(/const WORDLIST = \[.*?\];/s,'');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|<script[^>]+src=|<link|@import/.test(src),'no network APIs or external resources');
  const urls=[...src.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]); ok(urls.every(u=>u.startsWith('https://github.com/Random21m/voidforge')),'only URL is the GitHub link: '+urls.join(', '));
  ok(t.errors.length===0,'no uncaught page errors '+JSON.stringify(t.errors));
  console.log(failed?`\n${failed} CHECK(S) FAILED`:'\nALL CHECKS PASSED'); process.exit(failed?1:0);
})();
