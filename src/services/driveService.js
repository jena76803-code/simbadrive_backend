const { google } = require('googleapis');
const path = require('path');

const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
const subject = process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT;

if (!keyFile) {
  throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY_FILE environment variable.');
}

const auth = new google.auth.GoogleAuth({
  keyFile: path.isAbsolute(keyFile) ? keyFile : path.resolve(process.cwd(), keyFile),
  scopes: ['https://www.googleapis.com/auth/drive'],
  subject: subject || undefined,
});

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
