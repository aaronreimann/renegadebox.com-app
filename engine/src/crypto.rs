//! Key hierarchy and authenticated encryption.
//!
//! passphrase --Argon2id--> KEK --AES-GCM unwrap--> master key (32 random bytes)
//! master --HKDF-SHA256--> { content root, names key, journal key }
//!
//! * Blob id  = HMAC-SHA256(names key, sha256(plaintext))
//! * Blob key = HKDF(content root, "blob" || sha256(plaintext))  -- one key per content
//! * Blob     = header || chunk_0 || ... || chunk_n, each chunk AES-256-GCM with
//!   nonce = index(u64 BE) || 0 0 0 || final flag, AAD = header || blob id || index || final.
//!   Because the key is bound to the plaintext hash, a (key, nonce) pair can only ever
//!   encrypt identical bytes; `encrypt_file` re-hashes what it actually encrypted and
//!   refuses to produce output if the source changed underneath it.
//! * Journal entries are sealed under the journal key with a random nonce and the
//!   S3 object key (which encodes device id + seq) as AAD.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{Context, Result, anyhow, bail};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const CHUNK_SIZE: usize = 4 * 1024 * 1024;
const BLOB_MAGIC: &[u8; 4] = b"RBX1";
const BLOB_HEADER_LEN: usize = 16;
const TAG_LEN: usize = 16;
const SEAL_MAGIC: &[u8; 4] = b"RBJ1";
const HKDF_SALT: &[u8] = b"renegadebox-v1";
const VAULT_FORMAT: &str = "renegadebox-vault";

/// 32-byte secret that is wiped from memory on drop.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SecretKey([u8; 32]);

impl SecretKey {
    pub fn random() -> Self {
        let mut k = [0u8; 32];
        OsRng.fill_bytes(&mut k);
        Self(k)
    }
    pub fn from_bytes(b: &[u8]) -> Result<Self> {
        let arr: [u8; 32] = b.try_into().map_err(|_| anyhow!("key must be 32 bytes"))?;
        Ok(Self(arr))
    }
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
    pub fn to_b64(&self) -> String {
        B64.encode(self.0)
    }
    pub fn from_b64(s: &str) -> Result<Self> {
        Self::from_bytes(&B64.decode(s.trim()).context("invalid base64 key")?)
    }
    fn cipher(&self) -> Aes256Gcm {
        Aes256Gcm::new(&Key::<Aes256Gcm>::from(self.0))
    }
}

fn hkdf_expand(ikm: &[u8], info: &[u8]) -> SecretKey {
    let hk = Hkdf::<Sha256>::new(Some(HKDF_SALT), ikm);
    let mut okm = [0u8; 32];
    // 32 bytes is far below the HKDF-SHA256 output limit; expand cannot fail.
    hk.expand(info, &mut okm).expect("hkdf length");
    let k = SecretKey(okm);
    okm.zeroize();
    k
}

/// Subkeys derived from the master key. Never persisted.
#[derive(Clone)]
pub struct Keys {
    content_root: SecretKey,
    names: SecretKey,
    journal: SecretKey,
}

impl Keys {
    pub fn derive(master: &SecretKey) -> Self {
        Self {
            content_root: hkdf_expand(master.as_bytes(), b"rb/content-v1"),
            names: hkdf_expand(master.as_bytes(), b"rb/names-v1"),
            journal: hkdf_expand(master.as_bytes(), b"rb/journal-v1"),
        }
    }

    /// Opaque, deterministic object id for a plaintext hash.
    pub fn blob_id(&self, plain_hash: &[u8; 32]) -> String {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.names.as_bytes())
            .expect("hmac accepts any key length");
        mac.update(plain_hash);
        hex::encode(mac.finalize().into_bytes())
    }

    fn blob_key(&self, plain_hash: &[u8; 32]) -> SecretKey {
        let mut info = Vec::with_capacity(36);
        info.extend_from_slice(b"blob");
        info.extend_from_slice(plain_hash);
        hkdf_expand(self.content_root.as_bytes(), &info)
    }

    /// Seal a small message (journal entry) bound to `aad` (the S3 object key).
    pub fn seal(&self, plaintext: &[u8], aad: &str) -> Result<Vec<u8>> {
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let ct = self
            .journal
            .cipher()
            .encrypt(&Nonce::from(nonce), Payload { msg: plaintext, aad: aad.as_bytes() })
            .map_err(|_| anyhow!("seal failed"))?;
        let mut out = Vec::with_capacity(4 + 12 + ct.len());
        out.extend_from_slice(SEAL_MAGIC);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    pub fn open(&self, sealed: &[u8], aad: &str) -> Result<Vec<u8>> {
        if sealed.len() < 4 + 12 + TAG_LEN || &sealed[..4] != SEAL_MAGIC {
            bail!("not a sealed journal entry");
        }
        self.journal
            .cipher()
            .decrypt(
                &Nonce::from(<[u8; 12]>::try_from(&sealed[4..16]).expect("length checked above")),
                Payload { msg: &sealed[16..], aad: aad.as_bytes() },
            )
            .map_err(|_| anyhow!("journal entry failed authentication (wrong key or tampered)"))
    }
}

/// SHA-256 of a file, streamed.
pub fn hash_file(path: &Path) -> Result<[u8; 32]> {
    let mut r = BufReader::with_capacity(1 << 20, File::open(path)?);
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().into())
}

/// Fill `buf` as far as possible; returns bytes read (short only at EOF).
fn read_full(r: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < buf.len() {
        match r.read(&mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e),
        }
    }
    Ok(filled)
}

fn blob_header(chunk_size: usize) -> [u8; BLOB_HEADER_LEN] {
    let mut h = [0u8; BLOB_HEADER_LEN];
    h[..4].copy_from_slice(BLOB_MAGIC);
    h[4] = 1; // format version
    h[8..12].copy_from_slice(&(chunk_size as u32).to_be_bytes());
    h
}

fn chunk_nonce(index: u64, last: bool) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[..8].copy_from_slice(&index.to_be_bytes());
    n[11] = last as u8;
    n
}

fn chunk_aad(header: &[u8], blob_id: &str, index: u64, last: bool) -> Vec<u8> {
    let mut aad = Vec::with_capacity(header.len() + blob_id.len() + 9);
    aad.extend_from_slice(header);
    aad.extend_from_slice(blob_id.as_bytes());
    aad.extend_from_slice(&index.to_be_bytes());
    aad.push(last as u8);
    aad
}

/// Generic chunked encryption with one-chunk lookahead so the final chunk is flagged.
fn encrypt_stream(
    keys: &Keys,
    plain_hash: &[u8; 32],
    chunk_size: usize,
    mut src: impl Read,
    mut dst: impl Write,
) -> Result<[u8; 32]> {
    let blob_id = keys.blob_id(plain_hash);
    let cipher = keys.blob_key(plain_hash).cipher();
    let header = blob_header(chunk_size);
    dst.write_all(&header)?;

    let mut hasher = Sha256::new();
    let mut cur = vec![0u8; chunk_size];
    let mut next = vec![0u8; chunk_size];
    let mut cur_len = read_full(&mut src, &mut cur)?;
    let mut index: u64 = 0;
    loop {
        // An exactly-full chunk is only final if nothing follows it.
        let next_len = if cur_len == chunk_size { read_full(&mut src, &mut next)? } else { 0 };
        let last = next_len == 0;
        hasher.update(&cur[..cur_len]);
        let ct = cipher
            .encrypt(
                &Nonce::from(chunk_nonce(index, last)),
                Payload { msg: &cur[..cur_len], aad: &chunk_aad(&header, &blob_id, index, last) },
            )
            .map_err(|_| anyhow!("chunk encryption failed"))?;
        dst.write_all(&ct)?;
        if last {
            break;
        }
        std::mem::swap(&mut cur, &mut next);
        cur_len = next_len;
        index += 1;
    }
    dst.flush()?;
    Ok(hasher.finalize().into())
}

fn decrypt_stream(
    keys: &Keys,
    plain_hash: &[u8; 32],
    mut src: impl Read,
    mut dst: impl Write,
) -> Result<()> {
    let mut header = [0u8; BLOB_HEADER_LEN];
    if read_full(&mut src, &mut header)? != BLOB_HEADER_LEN || &header[..4] != BLOB_MAGIC || header[4] != 1 {
        bail!("not a RenegadeBox blob (bad header)");
    }
    let chunk_size = u32::from_be_bytes(header[8..12].try_into().expect("4 bytes")) as usize;
    if chunk_size == 0 || chunk_size > 64 * 1024 * 1024 {
        bail!("invalid blob chunk size");
    }
    let blob_id = keys.blob_id(plain_hash);
    let cipher = keys.blob_key(plain_hash).cipher();
    let frame = chunk_size + TAG_LEN;

    let mut hasher = Sha256::new();
    let mut cur = vec![0u8; frame];
    let mut next = vec![0u8; frame];
    let mut cur_len = read_full(&mut src, &mut cur)?;
    let mut index: u64 = 0;
    loop {
        if cur_len < TAG_LEN {
            bail!("blob truncated");
        }
        let next_len = if cur_len == frame { read_full(&mut src, &mut next)? } else { 0 };
        let last = next_len == 0;
        let pt = cipher
            .decrypt(
                &Nonce::from(chunk_nonce(index, last)),
                Payload { msg: &cur[..cur_len], aad: &chunk_aad(&header, &blob_id, index, last) },
            )
            .map_err(|_| anyhow!("blob chunk {index} failed authentication (tampered, truncated or reordered)"))?;
        hasher.update(&pt);
        dst.write_all(&pt)?;
        if last {
            break;
        }
        std::mem::swap(&mut cur, &mut next);
        cur_len = next_len;
        index += 1;
    }
    dst.flush()?;
    let got: [u8; 32] = hasher.finalize().into();
    if &got != plain_hash {
        bail!("decrypted content hash mismatch");
    }
    Ok(())
}

/// Result of encrypting a local file.
pub struct EncryptedBlob {
    pub plain_hash: [u8; 32],
    pub blob_id: String,
}

/// Hash `src`, then encrypt it into `dst`. Fails (writing nothing usable) if the file
/// changed between the hashing pass and the encryption pass.
pub fn encrypt_file(keys: &Keys, src: &Path, dst: &Path) -> Result<EncryptedBlob> {
    let plain_hash = hash_file(src)?;
    let out = BufWriter::new(File::create(dst)?);
    let input = BufReader::new(File::open(src)?);
    let encrypted_hash = encrypt_stream(keys, &plain_hash, CHUNK_SIZE, input, out)?;
    if encrypted_hash != plain_hash {
        let _ = std::fs::remove_file(dst);
        bail!("file changed while it was being encrypted; will retry");
    }
    Ok(EncryptedBlob { blob_id: keys.blob_id(&plain_hash), plain_hash })
}

/// Decrypt `src` into `dst`, verifying every chunk and the final plaintext hash.
pub fn decrypt_file(keys: &Keys, plain_hash: &[u8; 32], src: &Path, dst: &Path) -> Result<()> {
    let input = BufReader::new(File::open(src)?);
    let out = BufWriter::new(File::create(dst)?);
    decrypt_stream(keys, plain_hash, input, out)
}

// ---------------------------------------------------------------- vault

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KdfParams {
    pub alg: String,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    pub salt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Vault {
    pub format: String,
    pub version: u32,
    /// Bumped when the master key is rotated (future: device revocation).
    pub key_epoch: u32,
    pub kdf: KdfParams,
    pub nonce: String,
    pub wrapped_master: String,
}

impl Vault {
    pub const DEFAULT_M_KIB: u32 = 64 * 1024;
    pub const DEFAULT_T: u32 = 3;

    fn kek(passphrase: &str, kdf: &KdfParams) -> Result<SecretKey> {
        if kdf.alg != "argon2id" {
            bail!("unsupported kdf {}", kdf.alg);
        }
        let salt = B64.decode(&kdf.salt).context("bad salt")?;
        let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(32)).map_err(|e| anyhow!("argon2 params: {e}"))?;
        let mut out = [0u8; 32];
        Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
            .hash_password_into(passphrase.as_bytes(), &salt, &mut out)
            .map_err(|e| anyhow!("argon2: {e}"))?;
        let k = SecretKey(out);
        out.zeroize();
        Ok(k)
    }

    fn aad(&self) -> Vec<u8> {
        format!("{}|v{}|epoch{}", self.format, self.version, self.key_epoch).into_bytes()
    }

    /// Create a new vault wrapping `master` under `passphrase`.
    pub fn create(master: &SecretKey, passphrase: &str, m_kib: u32, t: u32) -> Result<Self> {
        let mut salt = [0u8; 16];
        OsRng.fill_bytes(&mut salt);
        let mut nonce = [0u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let mut v = Vault {
            format: VAULT_FORMAT.into(),
            version: 1,
            key_epoch: 1,
            kdf: KdfParams { alg: "argon2id".into(), m_kib, t, p: 1, salt: B64.encode(salt) },
            nonce: B64.encode(nonce),
            wrapped_master: String::new(),
        };
        let kek = Self::kek(passphrase, &v.kdf)?;
        let ct = kek
            .cipher()
            .encrypt(&Nonce::from(nonce), Payload { msg: master.as_bytes(), aad: &v.aad() })
            .map_err(|_| anyhow!("vault wrap failed"))?;
        v.wrapped_master = B64.encode(ct);
        Ok(v)
    }

    pub fn unlock(&self, passphrase: &str) -> Result<SecretKey> {
        if self.format != VAULT_FORMAT || self.version != 1 {
            bail!("unsupported vault format");
        }
        let kek = Self::kek(passphrase, &self.kdf)?;
        let nonce = B64.decode(&self.nonce).context("bad vault nonce")?;
        if nonce.len() != 12 {
            bail!("bad vault nonce length");
        }
        let ct = B64.decode(&self.wrapped_master).context("bad vault ciphertext")?;
        let pt = kek
            .cipher()
            .decrypt(&Nonce::from(<[u8; 12]>::try_from(nonce.as_slice()).expect("length checked above")), Payload { msg: &ct, aad: &self.aad() })
            .map_err(|_| anyhow!("wrong passphrase (or vault tampered)"))?;
        SecretKey::from_bytes(&pt)
    }
}

pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> Keys {
        Keys::derive(&SecretKey::random())
    }

    fn enc(keys: &Keys, data: &[u8], cs: usize) -> ([u8; 32], Vec<u8>) {
        let h: [u8; 32] = Sha256::digest(data).into();
        let mut out = Vec::new();
        encrypt_stream(keys, &h, cs, data, &mut out).unwrap();
        (h, out)
    }

    fn dec(keys: &Keys, h: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        decrypt_stream(keys, h, blob, &mut out)?;
        Ok(out)
    }

    #[test]
    fn roundtrip_boundary_sizes() {
        let k = keys();
        let cs = 64;
        for len in [0, 1, cs - 1, cs, cs + 1, 3 * cs + 17, 4 * cs] {
            let data: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
            let (h, blob) = enc(&k, &data, cs);
            assert_eq!(dec(&k, &h, &blob).unwrap(), data, "len {len}");
        }
    }

    #[test]
    fn truncation_detected() {
        let k = keys();
        let cs = 64;
        let data = vec![7u8; 3 * cs];
        let (h, blob) = enc(&k, &data, cs);
        let frame = cs + TAG_LEN;
        let truncated = &blob[..BLOB_HEADER_LEN + 2 * frame];
        assert!(dec(&k, &h, truncated).is_err());
    }

    #[test]
    fn reorder_detected() {
        let k = keys();
        let cs = 64;
        let data: Vec<u8> = (0..3 * cs).map(|i| i as u8).collect();
        let (h, mut blob) = enc(&k, &data, cs);
        let frame = cs + TAG_LEN;
        let a = BLOB_HEADER_LEN;
        let b = BLOB_HEADER_LEN + frame;
        let first: Vec<u8> = blob[a..a + frame].to_vec();
        let second: Vec<u8> = blob[b..b + frame].to_vec();
        blob[a..a + frame].copy_from_slice(&second);
        blob[b..b + frame].copy_from_slice(&first);
        assert!(dec(&k, &h, &blob).is_err());
    }

    #[test]
    fn bitflip_detected() {
        let k = keys();
        let (h, mut blob) = enc(&k, b"hello world", 64);
        let i = blob.len() - 20;
        blob[i] ^= 1;
        assert!(dec(&k, &h, &blob).is_err());
    }

    #[test]
    fn chunk_from_other_blob_rejected() {
        let k = keys();
        let cs = 64;
        let (h1, mut b1) = enc(&k, &[1u8; 128], cs);
        let (_h2, b2) = enc(&k, &[2u8; 128], cs);
        let frame = cs + TAG_LEN;
        b1[BLOB_HEADER_LEN..BLOB_HEADER_LEN + frame].copy_from_slice(&b2[BLOB_HEADER_LEN..BLOB_HEADER_LEN + frame]);
        assert!(dec(&k, &h1, &b1).is_err());
    }

    #[test]
    fn wrong_master_rejected() {
        let (h, blob) = enc(&keys(), b"secret", 64);
        assert!(dec(&keys(), &h, &blob).is_err());
    }

    #[test]
    fn blob_id_deterministic_and_keyed() {
        let k = keys();
        let h = [9u8; 32];
        assert_eq!(k.blob_id(&h), k.blob_id(&h));
        assert_ne!(k.blob_id(&h), keys().blob_id(&h));
        assert_ne!(k.blob_id(&h), hex::encode(h));
        assert_eq!(k.blob_id(&h).len(), 64);
    }

    #[test]
    fn subkeys_distinct() {
        let k = keys();
        assert_ne!(k.content_root.as_bytes(), k.names.as_bytes());
        assert_ne!(k.names.as_bytes(), k.journal.as_bytes());
        assert_ne!(k.content_root.as_bytes(), k.journal.as_bytes());
    }

    #[test]
    fn seal_bound_to_object_key() {
        let k = keys();
        let sealed = k.seal(b"{\"x\":1}", "rb/journal/a/00000000000000000001").unwrap();
        assert_eq!(k.open(&sealed, "rb/journal/a/00000000000000000001").unwrap(), b"{\"x\":1}");
        assert!(k.open(&sealed, "rb/journal/a/00000000000000000002").is_err());
        assert!(k.open(&sealed, "rb/journal/b/00000000000000000001").is_err());
    }

    #[test]
    fn vault_roundtrip_and_wrong_passphrase() {
        let master = SecretKey::random();
        let v = Vault::create(&master, "correct horse", 256, 1).unwrap();
        let json = serde_json::to_string(&v).unwrap();
        let v2: Vault = serde_json::from_str(&json).unwrap();
        assert_eq!(v2.unlock("correct horse").unwrap().as_bytes(), master.as_bytes());
        assert!(v2.unlock("wrong").is_err());
        assert_eq!(v2.kdf.alg, "argon2id");
    }

    #[test]
    fn encrypt_file_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.bin");
        std::fs::write(&src, vec![42u8; CHUNK_SIZE + 5]).unwrap();
        let k = keys();
        let b = encrypt_file(&k, &src, &dir.path().join("a.enc")).unwrap();
        decrypt_file(&k, &b.plain_hash, &dir.path().join("a.enc"), &dir.path().join("a.out")).unwrap();
        assert_eq!(std::fs::read(&src).unwrap(), std::fs::read(dir.path().join("a.out")).unwrap());
    }
}
