export function md5sum(str: string) {
  function add(x: number, y: number) {
    return (x + y) & 0xffffffff;
  }
  function rol(num: number, cnt: number) {
    return (num << cnt) | (num >>> (32 - cnt));
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    return add(rol(add(add(a, q), add(x, t)), s), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function toWordArray(str: string) {
    const n = (str.length + 8) >> 6;
    const wa = new Array(n * 16).fill(0);
    for (let i = 0; i < str.length; i++) wa[i >> 2] |= (str.charCodeAt(i) & 0xff) << ((i % 4) * 8);
    wa[str.length >> 2] |= 0x80 << ((str.length % 4) * 8);
    wa[n * 16 - 2] = str.length * 8;
    return wa;
  }
  function toHex(a: number) {
    let h = "";
    for (let i = 0; i < 4; i++) h += ("0" + ((a >> (i * 8)) & 0xff).toString(16)).slice(-2);
    return h;
  }
  let a = 1732584193,
    b = -271733879,
    c = -1732584194,
    d = 271733878;
  const wa = toWordArray(unescape(encodeURIComponent(str)));
  for (let i = 0; i < wa.length; i += 16) {
    const oa = a,
      ob = b,
      oc = c,
      od = d;
    a = ff(a, b, c, d, wa[i + 0], 7, -680876936);
    d = ff(d, a, b, c, wa[i + 1], 12, -389564586);
    c = ff(c, d, a, b, wa[i + 2], 17, 606105819);
    b = ff(b, c, d, a, wa[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, wa[i + 4], 7, -176418897);
    d = ff(d, a, b, c, wa[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, wa[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, wa[i + 7], 22, -45705983);
    a = ff(a, b, c, d, wa[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, wa[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, wa[i + 10], 17, -42063);
    b = ff(b, c, d, a, wa[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, wa[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, wa[i + 13], 12, -40341101);
    c = ff(c, d, a, b, wa[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, wa[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, wa[i + 1], 5, -165796510);
    d = gg(d, a, b, c, wa[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, wa[i + 11], 14, 643717713);
    b = gg(b, c, d, a, wa[i + 0], 20, -373897302);
    a = gg(a, b, c, d, wa[i + 5], 5, -701558691);
    d = gg(d, a, b, c, wa[i + 10], 9, 38016083);
    c = gg(c, d, a, b, wa[i + 15], 14, -660478335);
    b = gg(b, c, d, a, wa[i + 4], 20, -405537848);
    a = gg(a, b, c, d, wa[i + 9], 5, 568446438);
    d = gg(d, a, b, c, wa[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, wa[i + 3], 14, -187363961);
    b = gg(b, c, d, a, wa[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, wa[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, wa[i + 2], 9, -51403784);
    c = gg(c, d, a, b, wa[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, wa[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, wa[i + 5], 4, -378558);
    d = hh(d, a, b, c, wa[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, wa[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, wa[i + 14], 23, -35309556);
    a = hh(a, b, c, d, wa[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, wa[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, wa[i + 7], 16, -155497632);
    b = hh(b, c, d, a, wa[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, wa[i + 13], 4, 681279174);
    d = hh(d, a, b, c, wa[i + 0], 11, -358537222);
    c = hh(c, d, a, b, wa[i + 6], 16, -722521979);
    b = hh(b, c, d, a, wa[i + 9], 23, 76029189);
    a = ii(a, b, c, d, wa[i + 12], 6, -640364487);
    d = ii(d, a, b, c, wa[i + 15], 10, -421815835);
    c = ii(c, d, a, b, wa[i + 2], 15, 530742520);
    b = ii(b, c, d, a, wa[i + 7], 21, -995338651);
    a = add(a, oa);
    b = add(b, ob);
    c = add(c, oc);
    d = add(d, od);
  }
  return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toLowerCase();
}

export async function encryptPayload(plain: string, password: string) {
  if (!password) throw new Error("Password is required");
  const enc = new TextEncoder();
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const toB64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    salt: toB64(salt.buffer),
    iv: toB64(iv.buffer),
    ct: toB64(cipherBuf),
    md5: md5sum(plain),
    ts: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function decryptPayload(payload: any, password: string) {
  if (!password) throw new Error("Password is required");
  const fromB64 = (b: string) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(fromB64(payload.salt)),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["decrypt"],
  );
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(fromB64(payload.iv)) },
    key,
    fromB64(payload.ct),
  );
  const plain = new TextDecoder().decode(new Uint8Array(plainBuf));
  if (md5sum(plain) !== payload.md5) throw new Error("checksum_mismatch");
  return plain;
}
