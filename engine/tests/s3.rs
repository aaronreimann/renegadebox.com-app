//! Storage integration tests. Run with a local S3 (`docker compose up -d s3`):
//!   RBOX_TEST_S3=1 cargo test --test s3
//! Optional: RBOX_TEST_ENDPOINT (default http://localhost:8333), RBOX_TEST_BUCKET (default rbox-test).

use renegadebox_engine::storage::{PutIfAbsentError, S3Settings, Storage};

fn storage() -> Option<Storage> {
    if std::env::var("RBOX_TEST_S3").ok().as_deref() != Some("1") {
        eprintln!("skipping: set RBOX_TEST_S3=1");
        return None;
    }
    let endpoint = std::env::var("RBOX_TEST_ENDPOINT").unwrap_or_else(|_| "http://localhost:8333".into());
    let bucket = std::env::var("RBOX_TEST_BUCKET").unwrap_or_else(|_| "rbox-test".into());
    Some(Storage::new(&S3Settings {
        bucket: Box::leak(bucket.into_boxed_str()),
        region: "us-east-1",
        endpoint: Some(Box::leak(endpoint.into_boxed_str())),
        access_key_id: "dev",
        secret_access_key: "dev",
    }))
}

fn unique(prefix: &str) -> String {
    format!("test/{prefix}-{}", uuid::Uuid::new_v4())
}

#[tokio::test]
async fn put_if_absent_never_overwrites() {
    let Some(s) = storage() else { return };
    let key = unique("ifnonematch");
    s.put_bytes_if_absent(&key, b"first".to_vec()).await.unwrap();
    let second = s.put_bytes_if_absent(&key, b"second".to_vec()).await;
    assert!(matches!(second, Err(PutIfAbsentError::Exists)), "backend must honor If-None-Match: *");
    assert_eq!(s.get_bytes(&key).await.unwrap().unwrap(), b"first");
}

#[tokio::test]
async fn exists_and_missing() {
    let Some(s) = storage() else { return };
    let key = unique("exists");
    assert!(!s.exists(&key).await.unwrap());
    assert!(s.get_bytes(&key).await.unwrap().is_none());
    s.put_bytes(&key, b"x".to_vec()).await.unwrap();
    assert!(s.exists(&key).await.unwrap());
}

#[tokio::test]
async fn list_start_after_and_prefixes() {
    let Some(s) = storage() else { return };
    let base = unique("list");
    for dev in ["a", "b"] {
        for seq in 1..=3u64 {
            s.put_bytes(&format!("{base}/{dev}/{seq:020}"), vec![]).await.unwrap();
        }
    }
    let prefixes = s.list_prefixes(&format!("{base}/")).await.unwrap();
    assert_eq!(prefixes, vec![format!("{base}/a/"), format!("{base}/b/")]);
    let after = s.list_keys(&format!("{base}/a/"), Some(&format!("{base}/a/{:020}", 1))).await.unwrap();
    assert_eq!(after, vec![format!("{base}/a/{:020}", 2), format!("{base}/a/{:020}", 3)]);
}

#[tokio::test]
async fn multipart_roundtrip() {
    let Some(s) = storage() else { return };
    let dir = tempfile::tempdir().unwrap();
    let src = dir.path().join("big");
    let data: Vec<u8> = (0..(70 * 1024 * 1024u32)).map(|i| (i % 253) as u8).collect();
    std::fs::write(&src, &data).unwrap();
    let key = unique("multipart");
    s.put_file(&key, &src).await.unwrap();
    let dst = dir.path().join("back");
    s.get_to_file(&key, &dst).await.unwrap();
    assert!(std::fs::read(&dst).unwrap() == data);
}
