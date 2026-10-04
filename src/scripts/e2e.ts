export function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string) {
  const binary_string = window.atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
      bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function getOrGenerateKeyPair(): Promise<CryptoKeyPair | null> {
  if (!window.crypto || !window.crypto.subtle) return null;

  const storedStr = localStorage.getItem('e2e_keypair');
  if (storedStr) {
    try {
       const jwks = JSON.parse(storedStr);
       const privateKey = await window.crypto.subtle.importKey(
         "jwk", jwks.privateJwk, 
         { name: "ECDH", namedCurve: "P-256" }, 
         true, 
         ["deriveKey", "deriveBits"]
       );
       const publicKey = await window.crypto.subtle.importKey(
         "jwk", jwks.publicJwk, 
         { name: "ECDH", namedCurve: "P-256" }, 
         true, 
         []
       );
       return { publicKey, privateKey };
    } catch(e) {
      console.warn("Failed to load existing key pair, regenerating...", e);
    }
  }

  try {
    const keyPair = await window.crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" }, 
      true, 
      ["deriveKey", "deriveBits"]
    );
    
    const privateJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
    const publicJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
    localStorage.setItem('e2e_keypair', JSON.stringify({ privateJwk, publicJwk }));
    
    const exportedPub = await window.crypto.subtle.exportKey("spki", keyPair.publicKey);
    const pubBase64 = arrayBufferToBase64(exportedPub);
    
    // Check if Clerk is available
    if (window.Clerk && window.Clerk.session) {
      const token = await window.Clerk.session.getToken();
      if (token) {
        await fetch(`${window.API_BASE_URL || ''}/api/keys`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: pubBase64 })
        });
      }
    }

    return keyPair;
  } catch (err) {
    console.error("Key generation failed:", err);
    return null;
  }
}
