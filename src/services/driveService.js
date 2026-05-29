const { google } = require('googleapis');
const path = require('path');

const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const subject = process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT;

const authOptions = {
  scopes: ['https://www.googleapis.com/auth/drive'],
  subject: subject || undefined,
};

if (!jsonEnv) {
  throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON environment variable.');
}

let creds;
try {
  creds = typeof jsonEnv === 'string' ? JSON.parse(jsonEnv) : jsonEnv;
} catch (err) {
  throw new Error('Invalid JSON in GOOGLE_SERVICE_ACCOUNT_JSON environment variable.');
}

if (!creds.client_email || !creds.private_key) {
  throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key.');
}

authOptions.credentials = {
  client_email: creds.client_email,
  private_key: creds.private_key,
};

if (creds.project_id) authOptions.projectId = creds.project_id;

const auth = new google.auth.GoogleAuth(authOptions);

async function getDriveClient() {
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}

async function grantDrivePermission({ fileId, userEmail, role, type, sendNotificationEmail }) {
  const drive = await getDriveClient();

  const permissionBody = {
    type,
    role,
    emailAddress: userEmail,
  };

  const response = await drive.permissions.create({
    fileId,
    requestBody: permissionBody,
    sendNotificationEmail,
    supportsAllDrives: true,
  });

  return response.data;
}

module.exports = {
  grantDrivePermission,
};
