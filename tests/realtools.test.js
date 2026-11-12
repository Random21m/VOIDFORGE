// v2.16.1 "Tools that work as in real life": your own words in the practice tools, regtest as its own network, the Network
// menus of the wallet finders, and a multisig key from CHECK A BACKUP. In a file of its own (the page loader and helpers are
// those of tests/test.js), so tests/test.js stays within its memory. Run: node tests/realtools.test.js [path/to/voidforge.html]
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
const t9StepCur=(t)=>{ const c=t.d.querySelector('#stepBar li.cur'); return c?c.getAttribute('data-s'):''; };
const blobText=(w,b)=>b.text?b.text():new Promise((res,rej)=>{const r=new w.FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsText(b);});
const rnd=(n,k)=>Array.from({length:n},()=>String(k===2?nc.randomInt(2):1+nc.randomInt(6))).join('');

(async()=>{
  // v2.16.1 "Tools that work as in real life" (owner's words): your own words in the practice tools, regtest as its own network,
  // Network menus in the wallet finders, a multisig key from CHECK A BACKUP. Expected values from @scure/bip32, @scure/bip39
  // and @scure/btc-signer (independent code); regtest is testnet with bech32 "bcrt" (Bitcoin Core chainparams.cpp, CRegTestParams).
  { const r=load(); await r.ready(); const $=r.$, w=r.w, d=r.d, {HDKey}=require('@scure/bip32'), {mnemonicToSeedSync}=require('@scure/bip39'), btc=require('@scure/btc-signer');
    const sleep=ms=>new Promise(x=>setTimeout(x,ms)), until=async(f,n=400)=>{ for(let k=0;k<n&&!f();k++) await sleep(25); return f(); };
    const RT={...btc.TEST_NETWORK, bech32:'bcrt'}, AB='abandon '.repeat(11)+'about', M24='zoo '.repeat(23)+'vote', M12='screen truck market purse stumble turn across conduct exact armor neither guitar';
    const root=(m,pw='')=>HDKey.fromMasterSeed(mnemonicToSeedSync(m,pw)), fp=(m,pw='')=>root(m,pw).fingerprint.toString(16).padStart(8,'0');
    const wpkh=(m,path,net)=>btc.p2wpkh(root(m).derive(path).publicKey,net).address;
    const radio=(id)=>{ $(id).checked=true; $(id).dispatchEvent(new w.Event('change')); };
    // ---- A1: Practice making a backup, with your own words
    const ps=$('practiceBox').querySelector('summary');
    ok(ps.querySelector('.tag').textContent==='SECRET'&&/your own words/.test(ps.querySelector('small').textContent),'v2.16.1 backup practice: the box is tagged SECRET and its hint names your own words');
    ok($('prSrcTest').checked&&$('prSrcTest').parentElement.querySelector('.tag').textContent==='NO REAL KEYS'&&$('prSrcOwn').parentElement.querySelector('.tag').textContent==='SECRET','v2.16.1 backup practice: the built-in test seeds are the default (NO REAL KEYS); My own words is marked SECRET');
    ok(/offline computer/.test($('prOwnRow').textContent)&&$('prOwnRow').style.display==='none','v2.16.1 backup practice: the own-words box warns to do it on an offline computer, and is hidden until chosen');
    radio('prSrcOwn'); ok($('prOwnRow').style.display==='','v2.16.1 backup practice: choosing My own words shows its box');
    $('prOwn').value='abandon abandon'; await w.practiceStart(); ok(/bad/.test($('prStatus').className)&&/not a valid seed/.test($('prStatus').textContent)&&w.eval('practice')===null,'v2.16.1 backup practice: words that are not a valid seed are refused');
    $('prOwn').value=M24; await w.practiceStart();
    ok([...$('prWords').children].map(li=>li.textContent).join(' ')===M24&&$('prBan').style.display==='none'&&/Write the 24 words/.test($('prOwnTip').textContent)&&$('prOwnRow').style.display==='none','v2.16.1 backup practice: your 24 words are shown to write down, without the PRACTICE notice, and the box with them is out of sight');
    ok(w.eval('rhAny()')===true,'v2.16.1 backup practice: re-hide sees your own words on screen as a secret');
    w.rhHide('tab'); ok($('prShow').classList.contains('rh-cov')&&$('prOwn').classList.contains('rh-cov'),'v2.16.1 backup practice: re-hide covers your words on screen and the box'); w.rhShow();
    w.practiceHide(); $('prInput').value=M24; w.practiceCheck(); ok(/ok/.test($('prStatus').className)&&/matches your words, word for word/.test($('prStatus').textContent),'v2.16.1 backup practice: a right paper copy of your own words is confirmed');
    $('prInput').value=M24.replace(/zoo$|zoo (?=vote)/,'zero '); w.practiceCheck(); ok(/bad/.test($('prStatus').className)&&/Word 23 does not match\. Fix your paper/.test($('prStatus').textContent),'v2.16.1 backup practice: a wrong word of your own is named by its place');
    $('prInput').value='zoo zoo'; w.practiceCheck(); ok(/your seed has 24/.test($('prStatus').textContent),'v2.16.1 backup practice: a missing word is counted against your seed');
    w.rhHide('tab'); ok($('prCheck').classList.contains('rh-cov'),'v2.16.1 backup practice: re-hide covers the copy typed back while it is your own words'); w.rhShow();
    ok(w.eval('AUTO_FIELDS').includes('prOwn')&&w.eval('autoHasSecrets()'),'v2.16.1 backup practice: auto-clear knows your own words are there');
    w.autoWipe('test'); ok(w.eval('practice')===null&&$('prOwn').value===''&&$('prWords').textContent===''&&$('prInput').value==='','v2.16.1 backup practice: auto-clear wipes your own words, the list and the copy');
    $('prOwn').value=M12; await w.practiceStart(); w.clearAll(); ok(w.eval('practice')===null&&$('prOwn').value==='','v2.16.1 backup practice: CLEAR ALL wipes your own words');
    radio('prSrcTest'); w.eval('practiceNext=0'); await w.practiceStart(); ok(w.eval('practice.own')===undefined&&$('prBan').style.display===''&&w.eval('rhAny()')===false,'v2.16.1 backup practice: the public test seeds work as before (PRACTICE notice, not a secret)');
    w.practiceClear();
    // ---- A2: OPEN A PRACTICE WALLET with your own words; the practice note under every network menu
    radio('prSrcOwn'); $('prOwn').value=M12; await w.practiceWallet(); await until(()=>/tb1q/.test($('wvList').textContent));
    ok(w.eval('practiceOn')&&$('phrase').value===M12&&$('wvNet').value==='test'&&$('wvList').textContent.startsWith(wpkh(M12,"m/84'/1'/0'/0/0",btc.TEST_NETWORK)),'v2.16.1 practice wallet: your own words open on the test network ('+wpkh(M12,"m/84'/1'/0'/0/0",btc.TEST_NETWORK)+')');
    const notes=w.eval('PRACTICE_NETS').map(id=>[id,$(id+'Pr')]);
    ok(notes.length===8&&notes.every(([id,n])=>n&&n.className==='pr-net'&&/PRACTICE MODE: this menu stays on Testnet/.test(n.textContent)&&n.previousElementSibling.contains($(id))),'v2.16.1 practice mode: a PRACTICE MODE note sits right under each of the 8 network menus');
    ok(d.body.classList.contains('practice')&&notes.every(([id])=>$(id).value==='test'&&$(id).disabled),'v2.16.1 practice mode: every network menu (and the three wallet-finder menus) is on Testnet and locked');
    $('detNetPr').querySelector('button').click(); ok(!w.eval('practiceOn')&&$('detNet').value===''&&$('ewNet').value===''&&$('wNet').value==='main','v2.16.1 practice mode: the link in the note turns it off, and the menus go back (as guessed, Mainnet)');
    w.clearAll(); radio('prSrcTest'); await w.practiceWallet(); await until(()=>/tb1q/.test($('wvList').textContent)); ok($('phrase').value!==M12&&w.eval('isPracticePhrase(document.getElementById("phrase").value)'),'v2.16.1 practice wallet: the public test seed stays the default'); w.practiceMode(false); w.clearAll();
    // ---- A3: Practice your passphrase with your own seed or the seed made on the page
    const pp=async(src,pass)=>{ radio(src); $('ppA').value=pass; $('ppB').value=pass; await w.ppCheck(); return [$('ppStatus').className,$('ppStatus').textContent,$('ppFp').textContent]; };
    let q=await pp('ppSrcTest','TREZOR'); ok(q[2].includes('b4e3f5ed')&&/public test seed/.test(q[2]),'v2.16.1 passphrase practice: the public test seed is the default (b4e3f5ed with TREZOR)');
    q=await pp('ppSrcOwn','my pass'); ok(/bad/.test(q[0])&&/Type or paste your own seed words/.test(q[1])&&q[2]==='','v2.16.1 passphrase practice: own seed chosen but empty: said, no fingerprint');
    $('ppSeed').value=M12; q=await pp('ppSrcOwn','my pass'); ok(q[2].includes(fp(M12,'my pass'))&&/real fingerprint/.test(q[2]),'v2.16.1 passphrase practice: your own seed gives its real fingerprint with the passphrase ('+fp(M12,'my pass')+', from @scure/bip32)');
    ok(w.eval('AUTO_FIELDS').includes('ppSeed')&&w.eval('rhAny()'),'v2.16.1 passphrase practice: your seed words are a secret for re-hide and auto-clear');
    q=await pp('ppSrcMade','my pass'); ok(/bad/.test(q[0])&&/No seed is made on this page yet/.test(q[1]),'v2.16.1 passphrase practice: no seed made yet: said');
    r.set('16253'.repeat(10)); await w.generate(); const made=w.eval('madeMnemonic');
    q=await pp('ppSrcMade','my pass'); ok(made&&q[2].includes(fp(made,'my pass')),'v2.16.1 passphrase practice: the seed made on this page gives its fingerprint with the passphrase');
    w.ppClear(); ok($('ppSeed').value===''&&$('ppA').value==='','v2.16.1 passphrase practice: CLEAR wipes your seed words too'); radio('ppSrcTest'); w.clearAll();
    // ---- B: regtest, its own network
    ok(['wNet','wvNet','psbtNet','cmpNet','msNet'].every(id=>[...$(id).options].map(o=>o.value).join()==='main,test,regtest'),'v2.16.1 regtest: Mainnet, Testnet and Regtest in all five network menus');
    ok(w.eval('NETS.regtest.hrp')==='bcrt'&&w.eval('NETS.regtest.coin')===1&&w.eval('NETS.regtest.pkh')===0x6f&&w.eval('NETS.regtest.sh')===0xc4&&w.eval('hex(Uint8Array.from(NETS.regtest.ver.wpkh))')==='045f1cf6','v2.16.1 regtest: bech32 bcrt, coin type 1, base58 111 and 196, vpub as testnet (chainparams.cpp CRegTestParams, SLIP-0044, SLIP-0132)');
    r.set('16253'.repeat(10)); await w.generate(); const mm=w.eval('madeMnemonic');
    $('wNet').value='regtest'; await w.refreshWatch();
    ok($('wFirst').textContent.split('\n')[0]===wpkh(mm,"m/84'/1'/0'/0/0",RT)&&/^vpub/.test($('wZpub').textContent)&&/REGTEST/.test($('wTestBan').textContent)&&$('wTestBan').style.display===''&&$('spBox').style.display==='none','v2.16.1 regtest: the watch-only box shows bcrt1 addresses (m/84\'/1\'), a vpub and a REGTEST bar, and no Silent Payment address (BIP352 names no regtest prefix)');
    ok(/Network: REGTEST/.test(w.watchFileText()),'v2.16.1 regtest: the watch-only file says REGTEST');
    $('wNet').value='main'; await w.refreshWatch(); w.clearAll();
    $('phrase').value=AB; $('verifyPass').value=''; await w.verify(); $('wvNet').value='regtest'; $('wvNet').dispatchEvent(new w.Event('change')); await until(()=>/bcrt1q/.test($('wvList').textContent));
    ok($('wvList').textContent.startsWith('bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk')&&wpkh(AB,"m/84'/1'/0'/0/0",RT)==='bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk'&&/^REGTEST/.test($('wvPath').textContent),'v2.16.1 regtest: Open this wallet shows bcrt1q6rz28... first (abandon ... about, m/84\'/1\'/0\'/0/0)');
    w.clearAll(); const tpub=HDKey.fromMasterSeed(mnemonicToSeedSync(AB),{private:0x04358394,public:0x043587cf}).derive("m/84'/1'/0'").publicExtendedKey;
    $('wvNet').value='main'; $('wpIn').value=tpub; await w.openWatchOnly(); await until(()=>/tb1/.test($('wvList').textContent));
    const mainOpt=[...$('wvNet').options].find(o=>o.value==='main');
    ok(!$('wvNet').disabled&&mainOpt.disabled&&$('wvNet').value==='test','v2.16.1 regtest: a tpub opens on Testnet, and the menu offers Testnet or Regtest only');
    $('wvNet').value='regtest'; $('wvNet').dispatchEvent(new w.Event('change')); await until(()=>/bcrt1/.test($('wvList').textContent));
    ok(/^bcrt1/.test($('wvList').textContent),'v2.16.1 regtest: the same tpub on Regtest shows bcrt1 addresses'); w.clearAll(); ok(!mainOpt.disabled,'v2.16.1 regtest: closing the wallet gives the menu back all three networks');
    { const e1=await w.explainAddress('bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk'), e2=await w.explainAddress(btc.p2pkh(root(AB).derive("m/44'/1'/0'/0/0").publicKey,RT).address);
      ok(e1.level==='ok'&&/on regtest/.test(e1.text)&&e2.level==='ok'&&/testnet, signet or regtest/.test(e2.text),'v2.16.1 regtest: Explain an address knows bcrt1, and says an m... address may be regtest too'); }
    { const s=Uint8Array.from([0,20,...root(AB).derive("m/84'/1'/0'/0/0").identifier]); ok(await w.psbtAddress(s,'regtest')==='bcrt1q6rz28mcfaxtmd6v789l9rrlrusdprr9pz3cppk','v2.16.1 regtest: the transaction checkers write outputs as bcrt1 on Regtest'); }
    // multisig on regtest: two keys from CHECK A BACKUP (item D), addresses as btc-signer's p2wsh(p2ms) with bcrt
    w.msReset(); $('msNet').value='regtest'; $('msN').value='2'; $('msM').value='2'; w.msUpdateM(); w.msStart();
    ok(/REGTEST/.test($('msRunTitle').textContent)&&/REGTEST/.test($('msTestBan').textContent),'v2.16.1 regtest: the multisig setup says REGTEST');
    await w.msAddChecked(); ok(/No seed is open in CHECK A BACKUP/.test($('msBanErr').textContent),'v2.16.1 multisig: with nothing in CHECK A BACKUP, USE THE SEED IN CHECK A BACKUP says so');
    $('phrase').value='abandon abandon'; await w.msAddChecked(); ok(/not a valid BIP39 seed/.test($('msBanErr').textContent),'v2.16.1 multisig: words that are not a seed are refused');
    $('phrase').value=AB; $('verifyPass').value='x'; await w.verify(); await w.msAddChecked();
    ok(w.eval('ms.keys.length')===1&&w.eval('ms.keys[0].src')==='checked'&&w.eval('ms.keys[0].fp')===fp(AB,'x')&&$('phrase').value===''&&$('verifyPass').value===''&&$('walletView').style.display==='none'&&/From the seed in CHECK A BACKUP/.test($('msSlots').textContent),'v2.16.1 multisig: the seed in CHECK A BACKUP (with its passphrase) is key 1; its words, passphrase and wallet view are wiped there');
    $('phrase').value=AB; $('verifyPass').value='x'; await w.msAddChecked(); ok(/same key as key 1/.test($('msBanErr').textContent)&&w.eval('ms.keys.length')===1,'v2.16.1 multisig: the same seed twice is refused');
    $('msPaste').value=HDKey.fromMasterSeed(mnemonicToSeedSync(M12)).derive("m/48'/0'/0'/2'").publicExtendedKey; $('msPasteFp').value=fp(M12); await w.msAddPasted(); ok(/is for Mainnet, but this wallet is on Regtest/.test($('msRunErr').textContent),'v2.16.1 regtest: a mainnet key is refused in a regtest multisig');
    $('phrase').value=M12; $('verifyPass').value=''; await w.msAddChecked(); await until(()=>w.eval('ms.done'));
    { const k=[root(AB,'x'),root(M12)].map(x=>x.derive("m/48'/1'/0'/2'/0/0").publicKey), want=btc.p2wsh(btc.p2ms(2,k.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)))),RT).address;
      ok($('msAddrs').firstElementChild.textContent===want&&$('msOneDev').style.display===''&&/REGTEST/.test(w.msSheetText()),'v2.16.1 regtest multisig: 2-of-2 from two seeds in CHECK A BACKUP gives btc-signer\'s bcrt1 address ('+want.slice(0,16)+'...), the one-device warning, and REGTEST on the sheet'); }
    w.msReset(); $('msNet').value='main';
    // ---- B: Network menus in the wallet finders
    { const ew=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','electrum','zpub-watch.json'),'utf8'));
      $('ewIn').value=JSON.stringify(ew); await w.ewOpenUi(); const o1=$('ewOut').textContent;
      $('ewNet').value='regtest'; w.ewNetSet(); await until(()=>/set by hand to Regtest/.test($('ewOut').textContent));
      const o2=$('ewOut').textContent, want=wpkh(AB,"m/84'/0'/0'/0/0",RT);
      ok(/bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu/.test(o1)&&o2.includes('0/0  '+want)&&/REGTEST/.test(o2)&&!/NOT the addresses/.test(o2),'v2.16.1 Electrum file: the Network menu set to Regtest works the addresses out again ('+want.slice(0,18)+'...) and says it was set by hand');
      $('ewNet').value=''; w.ewClear(); ok($('ewNet').value===''&&$('ewOut').textContent==='','v2.16.1 Electrum file: CLEAR puts the Network menu back to as guessed'); }
    { const b=new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures','walletdat','descriptor.sqlite'))); $('wdatNet').value=''; await w.wdatShow(b,''); const l1=$('wdatList').textContent, o1=$('wdatOut').textContent;
      $('wdatNet').value='regtest'; await w.wdatNetSet(); const l2=$('wdatList').textContent, want=btc.p2pkh(root(AB).derive("m/44'/0'/0'/0/0").publicKey,RT).address;
      ok(/Network: mainnet/.test(o1)&&l1.includes(btc.p2pkh(root(AB).derive("m/44'/0'/0'/0/0").publicKey).address)&&l2.includes(want)&&/set by hand to Regtest \(the file says mainnet\)/.test($('wdatOut').textContent),'v2.16.1 wallet.dat: the Network menu rewrites the addresses for Regtest without reading the file again ('+want+')');
      w.wdatClear(); ok($('wdatNet').value==='','v2.16.1 wallet.dat: CLEAR puts the Network menu back'); }
    { $('phrase').value=AB; $('verifyPass').value=''; $('detNet').value='regtest'; await w.detList(); await until(()=>/bcrt1/.test($('detOut').textContent));
      ok($('detOut').textContent.includes(wpkh(AB,"m/84'/1'/0'/0/0",RT))&&/on Regtest/.test($('detStatus').textContent),'v2.16.1 Wallet Detective: LIST FIRST ADDRESSES on Regtest shows bcrt1 addresses');
      $('detNet').value=''; $('detAddr').value=wpkh(AB,"m/84'/1'/0'/0/3",RT); await w.detFind(); await until(()=>/FOUND/.test($('detStatus').textContent));
      ok(/^FOUND/.test($('detStatus').textContent)&&/m\/84'\/1'\/0'\/0\/3/.test($('detOut').textContent),'v2.16.1 Wallet Detective: a bcrt1 address is found (as guessed: regtest, coin type 1)');
      $('detNet').value='main'; $('detAddr').value=btc.p2wpkh(root(AB).derive("m/84'/0'/0'/0/2").publicKey,btc.TEST_NETWORK).address; await w.detFind(); await until(()=>/FOUND|NOT FOUND/.test($('detStatus').textContent));
      ok(/m\/84'\/0'\/0'\/0\/2/.test($('detOut').textContent)&&/coin type 0 \(Mainnet, set in the Network menu\)/.test($('detOut').textContent),'v2.16.1 Wallet Detective: Network set to Mainnet finds a testnet address made on coin type 0, and says so');
      $('detNet').value=''; w.clearAll(); }
    ok(html.indexOf('Tools that work as in real life.</b>')>html.indexOf('<li><b>2.16.1</b>')&&html.indexOf('Tools that work as in real life.</b>')<html.indexOf('<li><b>2.16.0</b>'),'v2.16.1: the changelog has the real-tools lines in the 2.16.1 entry');
    ok(/Tools that work as in real life \(v2\.16\.1\)/.test(fs.readFileSync(path.join(__dirname,'..','README.md'),'utf8')),'v2.16.1: the README lists the real-tools changes');
    ok(r.errors.length===0,'v2.16.1 real tools: no page errors '+JSON.stringify(r.errors));
    r.w.close(); }
  console.log(failed?`\n${failed} CHECK(S) FAILED`:'\nALL CHECKS PASSED'); process.exit(failed?1:0);
})();
