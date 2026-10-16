# RenegadeBox: Architecture & Development Plan

## 1. Executive Summary
**RenegadeBox** is an open-source, cross-platform (Linux, Windows, macOS) file synchronization application designed as a "Bring Your Own Storage" (BYOS) alternative to Dropbox. Instead of paying for SaaS storage tiers, users plug in their own Amazon S3 (or S3-compatible like Cloudflare R2 / Backblaze B2) API credentials. 

The system relies on a heavy, performant client (written in Rust) that transfers files *directly* to the user's S3 bucket, and a lightweight central control plane (`app.renegadebox.com`) that handles WebSocket-based event broadcasting to keep a user's multiple devices in sync without polling.

**Key Constraint:** This relies entirely on S3 Standard/Infrequent Access. AWS Glacier is strictly excluded due to its asynchronous, hours-long retrieval times.

---

## 2. High-Level Architecture

The system is divided into three distinct zones:

### A. The Client (Rust + Tauri)
The desktop application installed on the user's local machine.
*   **Core Engine (Rust):** Handles local file system watching (via OS-specific APIs like `inotify`, `FSEvents`), calculating SHA-256 file hashes, tracking local state, and interfacing directly with the S3 API.
*   **Local State Database (SQLite):** Embedded DB tracking local file paths, hashes, and timestamps to determine what needs to be uploaded/downloaded.
*   **GUI (Tauri):** A lightweight frontend wrapping the Rust binary. Built with HTML/JS/Tailwind CSS. Communicates with the Rust backend via Tauri IPC.
*   **Credential Storage:** AWS credentials and encryption keys are stored securely in the native OS credential manager (macOS Keychain, Windows Credential Manager, Linux Secret Service), *never* sent to the central server.

### B. The Control Plane (`app.renegadebox.com`)
The central nervous system. It never touches the user's files or their AWS keys.
*   **Dashboard (Astro):** A server-side rendered application where users register, log in, and manage their connected devices.
*   **WebSocket Hub (Node.js or Axum/Rust):** Maintains persistent, low-overhead WebSocket connections with all online clients.
*   **Database (PostgreSQL):** Stores user accounts, API tokens, and connected device IDs.
*   **Role:** Acts purely as a message router. When Client A uploads a file to S3, it pings the server; the server broadcasts a "file changed" event to Client B, prompting Client B to download it from S3.

### C. The Marketing Site (`renegadebox.com`)
*   **Stack:** Astro (Static Site Generation), Tailwind CSS.
*   **Hosting:** Standard CDN (e.g., Vercel, Netlify, Cloudflare Pages).
*   **Role:** Landing page, documentation, and open-source contribution guidelines.

---

## 3. Core Workflows

### 3.1 Real-Time Synchronization (Event-Driven)
To prevent expensive S3 polling, synchronization is event-driven.
1.  **Modify:** User edits a file on Device A.
2.  **Upload:** Device A's Rust daemon detects the change, hashes the file, updates its SQLite DB, and uploads the file directly to S3.
3.  **Notify:** Device A sends a JSON payload to `app.renegadebox.com` via WebSocket indicating a change.
4.  **Broadcast:** The server routes this payload to all other active devices registered to that user.
5.  **Download:** Device B receives the broadcast, checks its local SQLite DB, realizes it needs the update, and pulls the file directly from S3.

### 3.2 Offline / Boot-up Reconciliation
If Device B is offline when Device A modifies a file, it misses the WebSocket broadcast.
1.  Device B boots up and starts the RenegadeBox daemon.
2.  Before accepting WebSocket streams, Device B performs a **State Sync**.
3.  It fetches the latest object list and metadata from the S3 bucket.
4.  It diffs the S3 state against its local SQLite database.
5.  It queues downloads for missed files and uploads for local changes made while offline.

---

## 4. WebSocket Payload Contracts

Communication between the Rust client and the Control Plane uses lightweight JSON payloads.

**1. Authentication Init (Client -> Server)**
```json
{
  "type": "auth_init",
  "payload": {
    "account_token": "<user_api_token>",
    "device_id": "<uuid-v4-generated-on-client-install>",
    "device_name": "Linux Thinkpad"
  }
}
```

**2. File Event (Client -> Server)**
Sent after a successful direct-to-S3 upload/deletion.
```json
{
  "type": "file_event",
  "payload": {
    "action": "modified", // "added", "modified", "deleted", "renamed"
    "path": "/Documents/finances.pdf",
    "old_path": null, 
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "timestamp": 1729035000
  }
}
```

**3. Sync Required Broadcast (Server -> Other Clients)**
```json
{
  "type": "sync_required",
  "payload": {
    "origin_device": "Linux Thinkpad",
    "action": "modified",
    "path": "/Documents/finances.pdf",
    "old_path": null,
    "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "timestamp": 1729035000
  }
}
```

---

## 5. Security Architecture
*   **Zero-Knowledge Keys:** S3 credentials are kept strictly on the local machine.
*   **End-to-End Encryption (E2EE) (Optional but recommended feature):** Because the Rust client intercepts the file before uploading, files can be encrypted locally using AES-256 before being pushed to S3. This ensures that even if the user's S3 bucket policy is accidentally made public, the data remains secure.
*   **Bucket Scoping:** Documentation will strongly advise users to create specific IAM users with policies restricted to read/write only the specific `renegadebox-data` bucket.

---

## 6. Phased Development Plan

**Phase 1: The Rust Sync Engine (CLI / Headless)**
*   Initialize Rust project.
*   Integrate `notify` crate to recursively watch a test folder for changes.
*   Implement hashing and local SQLite database (`rusqlite` or `sqlx`) to track state.
*   Implement AWS SDK for Rust to handle S3 uploads, downloads, and deletions.

**Phase 2: The Control Plane**
*   Initialize Node.js (or Axum) WebSocket server.
*   Set up Postgres database.
*   Implement user authentication and device token management.
*   Implement the routing logic to bounce `file_event` messages to connected clients.

**Phase 3: Engine-to-Server Integration**
*   Connect the Rust daemon to the WebSocket server using `tokio-tungstenite`.
*   Test real-time sync between two headless Rust instances on different machines or folders.

**Phase 4: Client GUI (Tauri)**
*   Wrap the working Rust engine in a Tauri project.
*   Build the frontend interface (settings, sync status, S3 credential input) using Astro/Tailwind or standard React/Vue.
*   Implement OS-level credential storage.

**Phase 5: Refinement & Launch**
*   Build the `renegadebox.com` static marketing site.
*   Implement conflict resolution (e.g., creating a "conflicted copy" when two offline devices edit the same file and reconnect simultaneously).
*   Create detailed IAM / setup documentation for S3.