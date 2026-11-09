# Threat model

What VOIDFORGE protects, who it protects against, what it does about each threat, and what it cannot do. SECURITY.md says how VOIDFORGE is checked and how to report a problem. VOIDFORGE has not been independently audited.

## What is being protected

1. **The seed words and passphrase** (and the rolls, flips, cards or draws they came from). Anyone who has them can take the funds.
2. **The right seed.** The words, fingerprint and addresses on screen must be the ones the standards (BIP39, BIP32 and the rest) give for your inputs, so a backup made today still opens the wallet years from now.
3. **Your privacy.** Which addresses and keys are yours.

## How it is meant to be used

- The downloaded `voidforge.html`, checked with a tool that is not the page (the signature and SHA-256, see SECURITY.md), copied to a USB stick and opened on a computer that is **offline** for the whole session, ideally one used for nothing else.
- Randomness that **you** make with dice, a coin, cards or a word draw. VOIDFORGE never makes the randomness for a seed itself.
- The words written on paper or stamped in metal, and checked with a second independent tool or device before real funds go to them.
- Phones and the online copy at https://random21m.gitlab.io/voidforge/ are for learning and practice only, never for real funds.

## Who might attack, and what VOIDFORGE does

| Threat | What VOIDFORGE does | What is left to you |
|---|---|---|
| **A changed copy of the file** (a fake download site, a changed release, a changed USB stick) that makes predictable seeds or sends them out | Releases are signed (from v2.8.1) and list their SHA-256 and content ID. The page's own self-test cannot prove the file is genuine, and the page says so. | Check the signature and the SHA-256 with tools that are not the page, every time you copy the file. |
| **The network:** the page sending your seed somewhere | The page has no code that talks to the network, and a Content-Security-Policy built into the file tells the browser to block all network access. The NETWORK tag shows whether the computer is online. | Keep the computer offline; the policy is a second line of defense, not the first. |
| **Weak randomness:** a browser or library random number generator that is broken or backdoored | Seeds come only from your physical rolls, flips, cards or draws, hashed with SHA-256 the way SeedSigner and Coldcard do. A fairness test warns about lopsided dice. | Use real dice (casino dice are best), roll them yourself, enter every roll. The fairness test cannot prove dice are fair. |
| **Wrong math:** a bug that gives the wrong words, fingerprint or addresses | 127 known-answer checks run each time the page opens and turn the key tools off if one fails. Every release is tested against independent libraries, Bitcoin Core, the device makers' own dice code, three browser engines, and about 1,800 deliberate bugs that must all be caught. | Compare the words and fingerprint with a second independent tool or device. |
| **Other software on the computer:** browser extensions, page translators, screen recorders, malware, a hidden camera | *Is anything watching this page?* looks for the signs extensions and translators leave. Secrets cannot be selected or copied by accident, and CLEAR ALL, auto-clear and END SESSION wipe them from the page. | The page can never show that nothing is watching. Use a clean offline computer with no extensions, and close the browser when done. |
| **The camera** (v2.9.0) turned on without you knowing, or a seed QR scanned on an online computer | The camera turns on only when you press a SCAN button, shows a red CAMERA ON bar, and stops as soon as a code is read, when you press STOP CAMERA, change tabs or leave the page, and after 2 minutes. Pictures are read inside the page and never saved or sent. A SeedQR is scanned only while the page sees no network. | Never scan a real seed QR with a phone or an online device. Cover or unplug the camera when you are not scanning. |
| **A seed that is weak or public without you knowing** (v2.10.0): a test phrase, a phrase typed from an example, a seed made by a device with a known randomness flaw | A public example phrase is named after FORGE SEED, in the CHECK A BACKUP words box, VERIFY, Open this wallet, the Wallet Detective and Seed XOR (a warning, never a block). *Was my seed made by a flawed device?* lists only confirmed flaws, each with its source, and never calls a seed safe. *Check a Coldcard seed mix* shows whether a Coldcard mixed your dice in as its code says. | "No known flaw" is not a guarantee. The TRNG words and rolls typed into the seed-mix check are the seed: use it offline only. |
| **Backups that show more than you meant** (v2.10.0) | Punch plates, word numbers, old Electrum hex seeds and SLIP39 shares are as secret as the words: marked SECRET, not selectable, printed only after a question, cleared with the words. Inheritance papers print no words or passphrase. A .bip138 backup holds no private keys. | A .bip138 file opens with any one of the wallet's xpubs, so anyone who has seen one (a coordinator, a server) can read the descriptor. The key details sheet lets its reader see every address and the balance. Someone with your SLIP39 dice rolls can make the shares again: keep the roll sheet as secret as the shares. |
| **What stays behind:** browser memory, the clipboard, print spoolers, swap files | Wiping is tested: after CLEAR ALL a memory snapshot holds no words, rolls or passphrases. The page stores nothing on disk except the theme, text size and a once-per-tab notice flag. The seed words have no copy button, and the page warns that clipboard history can keep what you paste. | A browser cannot erase everything it ever held. Restart the computer after a session; prefer writing words by hand over printing or copying them. |
| **Someone who sees the backup:** a burglar, a visitor, a family member | Explains passphrases, multisig, decoy wallets, Seed XOR and how to store backups; a backup plan and stress test help you think it through. | Where the backups live is up to you. |
| **A forged transaction or message** shown to you for checking | The transaction inspector and the signed-message check are read-only; they never sign. A change mark in a transaction is checked against the wallet's own keys when you type the words, and called unchecked otherwise. | Check the receiving address on your signing device's own screen. |
| **Scams aimed at heirs and beginners** | Heir mode explains backups calmly and lists common scams. VOIDFORGE never asks for words online and has no support chat. | Nobody genuine will ever ask for your words. |

## Not protected against

- A computer that is compromised at the hardware or firmware level, or a browser that is itself malicious.
- Someone who gets your written words or passphrase.
- Timing attacks on the key math: the secp256k1 code is not constant-time, which is acceptable only because the computer is offline and not shared.
- Mistakes the page cannot see: a word written down wrongly, a roll left out, a passphrase forgotten. The restore drill and VERIFY help catch these before funds are sent.

## Trust you still place

- In the browser and the operating system of the offline computer.
- In the person who signs releases (one maintainer key; see SECURITY.md for its fingerprint).
- In the standards themselves (BIP39, BIP32 and the rest) and in the independent libraries the tests compare against.
