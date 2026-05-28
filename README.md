# Simba Drives Backend

A Node.js Express backend that exposes a Google Drive permission API for granting access to a file or folder.

## Setup

1. Copy `.env.example` to `.env`.
2. Create a Google service account and download its JSON key file.
3. Set `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` to the path of that key file.
4. If you need to impersonate a G Suite user, set `GOOGLE_SERVICE_ACCOUNT_SUBJECT`.
5. Install dependencies:

   npm install

6. Start the server:

   npm start

## API

### POST /api/grant-access

Request body:

```json
{
  "fileId": "<drive-file-or-folder-id>",
  "userEmail": "user@example.com",
  "role": "reader",
  "type": "user",
  "sendNotificationEmail": false
}
```

Response:

```json
{
  "success": true,
  "permission": {
    "id": "..."
  }
}
```

## Notes

- The service account must have permission to manage the target file or folder.
- For files owned by a user in a Google Workspace domain, use `GOOGLE_SERVICE_ACCOUNT_SUBJECT` with domain-wide delegation enabled.
- To share a file owned by another account, either impersonate that user or share the file with the service account first.
