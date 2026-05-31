# SimbaDrive Backend — API Reference

Base URL: `http://localhost:4000/api/drive`

**Environment** (required in `.env`)
- **GOOGLE_OAUTH_CLIENT_ID**: OAuth client ID
- **GOOGLE_OAUTH_CLIENT_SECRET**: OAuth client secret
- **GOOGLE_OAUTH_REDIRECT_URI**: OAuth redirect URI
- **GOOGLE_OAUTH_REFRESH_TOKEN**: Refresh token for personal Gmail (used for uploads)
- **GOOGLE_SERVICE_ACCOUNT_JSON**: Service account JSON string for permissions and listing

**Files**
- Service: [src/services/driveService.js](src/services/driveService.js)
- Routes: [src/routes/drive.js](src/routes/drive.js)

---

**API: Check User Access**
- **Endpoint:** `POST /check-access`
- **Purpose:** Verify if `userEmail` has access to a folder and return access level
- **Request (JSON):**
  - `folderId` (string) — required
  - `userEmail` (string) — required

- **cURL:**

```bash
curl -X POST http://localhost:4000/api/drive/check-access \
  -H "Content-Type: application/json" \
  -d '{"folderId":"<FOLDER_ID>","userEmail":"user@example.com"}'
```

- **Response (success):**

```json
{
  "success": true,
  "hasAccess": true,
  "accessLevel": "editor"
}
```

- **Notes:** `accessLevel` is one of `owner`, `editor`, `commenter`, `reader`, or `null` when no access.

---

**API: List Files Recursively**
- **Endpoint:** `GET /list-files`
- **Purpose:** Return all files and folders inside `folderId`, recursively
- **Query params:**
  - `folderId` (string) — required

- **cURL:**

```bash
curl -X GET "http://localhost:4000/api/drive/list-files?folderId=<FOLDER_ID>"
```

- **Response (success):**
```json
{
  "success": true,
  "fileCount": 5,
  "files": [
    { "id": "file_id_1", "name": "Document.pdf", "mimeType": "application/pdf", "size": "2048576", "modifiedTime": "2026-05-31T10:30:00Z" },
    { "id": "folder_id_1", "name": "Subfolder", "mimeType": "application/vnd.google-apps.folder", "modifiedTime": "2026-05-30T09:15:00Z" }
  ]
}
```

- **Notes:** The response returns a flat array including folder entries (`mimeType: application/vnd.google-apps.folder`). Use `id` to download or reference files.

---

**API: Upload File**
- **Endpoint:** `POST /upload-file`
- **Purpose:** Upload a file to a specified folder. The request must include `folderId` and a file.
- **Form-data:**
  - `folderId` (string) — required
  - `file` — required (file field)

- **cURL:**

```bash
curl -X POST http://localhost:4000/api/drive/upload-file \
  -F "folderId=<FOLDER_ID>" \
  -F "file=@/path/to/your/file.pdf"
```

- **Response (success):**
```json
{
  "success": true,
  "uploadedBy": "personal Gmail account via refresh token",
  "file": {
    "id": "new_file_id",
    "name": "file.pdf",
    "mimeType": "application/pdf",
    "webViewLink": "https://drive.google.com/file/d/new_file_id/view",
    "createdTime": "2026-05-31T11:45:00Z"
  }
}
```

- **Notes:**
  - The upload uses the refresh token stored in `.env` (`GOOGLE_OAUTH_REFRESH_TOKEN`) to authenticate as the personal Gmail account. Do NOT commit or expose the refresh token.
  - `folderId` must be a folder in the target Drive (personal or Shared Drive depending on token scope).

---

**API: Create Folder**
- **Endpoint:** `POST /create-folder`
- **Purpose:** Create a new folder inside the specified Drive folder.
- **Body (JSON):**
  - `folderName` (string) — required
  - `parentFolderId` (string) — optional; if omitted, the folder is created in the Drive root or default service account drive context.

- **cURL:**

```bash
curl -X POST http://localhost:4000/api/drive/create-folder \
  -H "Content-Type: application/json" \
  -d '{"folderName":"New Folder","parentFolderId":"<PARENT_FOLDER_ID>"}'
```

- **Response (success):**
```json
{
  "success": true,
  "folder": {
    "id": "new_folder_id",
    "name": "New Folder",
    "mimeType": "application/vnd.google-apps.folder",
    "parents": ["<PARENT_FOLDER_ID>"],
    "createdTime": "2026-05-31T12:00:00Z"
  }
}
```

---

**API: Download File**
- **Endpoint:** `GET /download-file`
- **Purpose:** Stream a file download to the client
- **Query params:**
  - `fileId` (string) — required

- **cURL (save to file):**

```bash
curl -X GET "http://localhost:4000/api/drive/download-file?fileId=<FILE_ID>" -o downloaded_file
```

- **Response:** Binary stream with headers:
  - `Content-Disposition: attachment; filename="originalname.ext"`
  - `Content-Type: <mime-type>`

---

**Troubleshooting & Notes**
- Service accounts have no personal storage quota; prefer Shared Drives or use OAuth refresh tokens for uploads into personal Drives.
- Ensure `.env` contains the required OAuth fields and the refresh token.
- See implementation in [src/routes/drive.js](src/routes/drive.js) and [src/services/driveService.js](src/services/driveService.js).

---

If you want, I can also add example Postman collections or automated tests for these endpoints.
