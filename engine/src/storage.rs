//! Thin S3 wrapper. Works with AWS S3 and S3-compatible endpoints (R2, B2, MinIO).

use std::path::Path;

use anyhow::{Context, Result, anyhow};
use aws_sdk_s3::Client;
use aws_sdk_s3::config::{
    BehaviorVersion, Credentials, Region, RequestChecksumCalculation, ResponseChecksumValidation,
};
use aws_sdk_s3::error::{ProvideErrorMetadata, SdkError};
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MULTIPART_THRESHOLD: u64 = 64 * 1024 * 1024;
const PART_SIZE: usize = 16 * 1024 * 1024;

pub struct S3Settings<'a> {
    pub bucket: &'a str,
    pub region: &'a str,
    pub endpoint: Option<&'a str>,
    pub access_key_id: &'a str,
    pub secret_access_key: &'a str,
}

#[derive(Clone)]
pub struct Storage {
    client: Client,
    bucket: String,
}

#[derive(Debug, thiserror::Error)]
pub enum PutIfAbsentError {
    #[error("object already exists")]
    Exists,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

fn status_of<E, R>(err: &SdkError<E, R>) -> Option<u16>
where
    R: HasStatus,
{
    err.raw_response().map(|r| r.status_u16())
}

trait HasStatus {
    fn status_u16(&self) -> u16;
}
impl HasStatus for aws_sdk_s3::config::http::HttpResponse {
    fn status_u16(&self) -> u16 {
        self.status().as_u16()
    }
}

fn describe<E: ProvideErrorMetadata + std::fmt::Debug, R: std::fmt::Debug>(err: &SdkError<E, R>) -> String {
    match err {
        SdkError::ServiceError(se) => {
            let e = se.err();
            format!("{}: {}", e.code().unwrap_or("S3Error"), e.message().unwrap_or("no message"))
        }
        other => format!("{other:?}"),
    }
}

impl Storage {
    pub fn new(s: &S3Settings<'_>) -> Self {
        let creds = Credentials::new(s.access_key_id, s.secret_access_key, None, None, "renegadebox");
        let mut b = aws_sdk_s3::config::Builder::new()
            .behavior_version(BehaviorVersion::latest())
            .region(Region::new(s.region.to_string()))
            .credentials_provider(creds)
            // R2/B2 reject some default flexible-checksum headers; only send them when required.
            .request_checksum_calculation(RequestChecksumCalculation::WhenRequired)
            .response_checksum_validation(ResponseChecksumValidation::WhenRequired);
        if let Some(ep) = s.endpoint {
            b = b.endpoint_url(ep).force_path_style(true);
        }
        Self { client: Client::from_conf(b.build()), bucket: s.bucket.to_string() }
    }

    pub async fn exists(&self, key: &str) -> Result<bool> {
        match self.client.head_object().bucket(&self.bucket).key(key).send().await {
            Ok(_) => Ok(true),
            Err(e) if status_of(&e) == Some(404) => Ok(false),
            Err(e) => Err(anyhow!("HEAD {key}: {}", describe(&e))),
        }
    }

    pub async fn get_bytes(&self, key: &str) -> Result<Option<Vec<u8>>> {
        match self.client.get_object().bucket(&self.bucket).key(key).send().await {
            Ok(out) => Ok(Some(out.body.collect().await.context("reading body")?.into_bytes().to_vec())),
            Err(e) if status_of(&e) == Some(404) => Ok(None),
            Err(e) => Err(anyhow!("GET {key}: {}", describe(&e))),
        }
    }

    /// Stream an object to a local file.
    pub async fn get_to_file(&self, key: &str, dst: &Path) -> Result<()> {
        let out = self
            .client
            .get_object()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| anyhow!("GET {key}: {}", describe(&e)))?;
        let mut body = out.body;
        let mut f = tokio::fs::File::create(dst).await?;
        while let Some(chunk) = body.try_next().await.context("download interrupted")? {
            f.write_all(&chunk).await?;
        }
        f.flush().await?;
        f.sync_all().await?;
        Ok(())
    }

    pub async fn put_bytes(&self, key: &str, data: Vec<u8>) -> Result<()> {
        self.client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .body(ByteStream::from(data))
            .send()
            .await
            .map_err(|e| anyhow!("PUT {key}: {}", describe(&e)))?;
        Ok(())
    }

    /// PUT with `If-None-Match: *` — never overwrites an existing object.
    pub async fn put_bytes_if_absent(&self, key: &str, data: Vec<u8>) -> Result<(), PutIfAbsentError> {
        match self
            .client
            .put_object()
            .bucket(&self.bucket)
            .key(key)
            .if_none_match("*")
            .body(ByteStream::from(data))
            .send()
            .await
        {
            Ok(_) => Ok(()),
            Err(e) if matches!(status_of(&e), Some(412) | Some(409)) => Err(PutIfAbsentError::Exists),
            Err(e) => Err(PutIfAbsentError::Other(anyhow!("PUT {key}: {}", describe(&e)))),
        }
    }

    /// Upload a local file, using multipart above the threshold.
    pub async fn put_file(&self, key: &str, src: &Path) -> Result<()> {
        let len = tokio::fs::metadata(src).await?.len();
        if len < MULTIPART_THRESHOLD {
            let body = ByteStream::from_path(src).await.context("open upload source")?;
            self.client
                .put_object()
                .bucket(&self.bucket)
                .key(key)
                .body(body)
                .send()
                .await
                .map_err(|e| anyhow!("PUT {key}: {}", describe(&e)))?;
            return Ok(());
        }
        let created = self
            .client
            .create_multipart_upload()
            .bucket(&self.bucket)
            .key(key)
            .send()
            .await
            .map_err(|e| anyhow!("create multipart {key}: {}", describe(&e)))?;
        let upload_id = created.upload_id().ok_or_else(|| anyhow!("no upload id"))?.to_string();
        let result = self.upload_parts(key, &upload_id, src).await;
        match result {
            Ok(parts) => {
                self.client
                    .complete_multipart_upload()
                    .bucket(&self.bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .multipart_upload(CompletedMultipartUpload::builder().set_parts(Some(parts)).build())
                    .send()
                    .await
                    .map_err(|e| anyhow!("complete multipart {key}: {}", describe(&e)))?;
                Ok(())
            }
            Err(e) => {
                let _ = self
                    .client
                    .abort_multipart_upload()
                    .bucket(&self.bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .send()
                    .await;
                Err(e)
            }
        }
    }

    async fn upload_parts(&self, key: &str, upload_id: &str, src: &Path) -> Result<Vec<CompletedPart>> {
        let mut f = tokio::fs::File::open(src).await?;
        let mut parts = Vec::new();
        let mut number = 1;
        loop {
            let mut buf = Vec::with_capacity(PART_SIZE);
            (&mut f).take(PART_SIZE as u64).read_to_end(&mut buf).await?;
            if buf.is_empty() {
                break;
            }
            let out = self
                .client
                .upload_part()
                .bucket(&self.bucket)
                .key(key)
                .upload_id(upload_id)
                .part_number(number)
                .body(ByteStream::from(buf))
                .send()
                .await
                .map_err(|e| anyhow!("upload part {number} of {key}: {}", describe(&e)))?;
            parts.push(
                CompletedPart::builder()
                    .part_number(number)
                    .set_e_tag(out.e_tag().map(str::to_string))
                    .build(),
            );
            number += 1;
        }
        Ok(parts)
    }

    /// All keys under `prefix` strictly after `start_after`, in lexicographic order.
    pub async fn list_keys(&self, prefix: &str, start_after: Option<&str>) -> Result<Vec<String>> {
        let mut keys = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut req = self.client.list_objects_v2().bucket(&self.bucket).prefix(prefix);
            if let Some(sa) = start_after {
                req = req.start_after(sa);
            }
            if let Some(t) = &token {
                req = req.continuation_token(t);
            }
            let out = req.send().await.map_err(|e| anyhow!("LIST {prefix}: {}", describe(&e)))?;
            keys.extend(out.contents().iter().filter_map(|o| o.key().map(str::to_string)));
            match out.next_continuation_token() {
                Some(t) if out.is_truncated() == Some(true) => token = Some(t.to_string()),
                _ => break,
            }
        }
        Ok(keys)
    }

    /// Immediate "sub-directories" under `prefix` (S3 common prefixes).
    pub async fn list_prefixes(&self, prefix: &str) -> Result<Vec<String>> {
        let mut out_prefixes = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let mut req = self.client.list_objects_v2().bucket(&self.bucket).prefix(prefix).delimiter("/");
            if let Some(t) = &token {
                req = req.continuation_token(t);
            }
            let out = req.send().await.map_err(|e| anyhow!("LIST {prefix}: {}", describe(&e)))?;
            out_prefixes.extend(out.common_prefixes().iter().filter_map(|p| p.prefix().map(str::to_string)));
            match out.next_continuation_token() {
                Some(t) if out.is_truncated() == Some(true) => token = Some(t.to_string()),
                _ => break,
            }
        }
        Ok(out_prefixes)
    }
}
