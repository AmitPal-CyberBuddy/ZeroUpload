import { sha512 } from '@noble/hashes/sha2.js';
import { createHash } from 'node:crypto';
const subtle = crypto.subtle;
const le32 = (v) => { const o=new Uint8Array(4); new DataView(o.buffer).setUint32(0,v,true); return o; };
const concat = (a,b) => { const o=new Uint8Array(a.length+b.length); o.set(a); o.set(b,a.length); return o; };
const N = 100000;
let h = new Uint8Array(64);
// subtle, one call per iteration (what the encryptor does now)
let t = performance.now();
h = new Uint8Array(await subtle.digest('SHA-512', new Uint8Array(68)));
for (let i=0;i<N;i++) h = new Uint8Array(await subtle.digest('SHA-512', concat(le32(i), h)));
console.log('subtle per-call   ', Math.round(performance.now()-t), 'ms');
// node crypto sync
t = performance.now();
h = new Uint8Array(64);
for (let i=0;i<N;i++) h = new Uint8Array(createHash('sha512').update(concat(le32(i), h)).digest());
console.log('node crypto sync  ', Math.round(performance.now()-t), 'ms');
// noble sync (pure JS, works in a worker)
t = performance.now();
h = new Uint8Array(64);
const big = new Uint8Array(68);
for (let i=0;i<N;i++) { big.set(le32(i)); big.set(h,4); h = sha512(big); }
console.log('noble sync (JS)   ', Math.round(performance.now()-t), 'ms');
