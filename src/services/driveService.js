const { google } = require('googleapis');
const path = require('path');
const { Readable } = require('stream');

const jsonEnv = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const subject = process.env.GOOGLE_SERVICE_ACCOUNT_SUBJECT;
const oauthClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const oauthClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const oauthRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'urn:ietf:wg:oauth:2.0:oob';
const oauthRefreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

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

function getDriveClientWithRefreshToken(refreshToken) {
  if (!oauthClientId || !oauthClientSecret) {
    throw new Error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET environment variable.');
  }

  const oauth2Client = new google.auth.OAuth2(
    oauthClientId,
    oauthClientSecret,
    oauthRedirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  return google.drive({ version: 'v3', auth: oauth2Client });
}

async function getDriveClientAsUser(userEmail) {
  // Create a new auth object that impersonates the user via domain-wide delegation
  const delegatedAuthOptions = {
    scopes: ['https://www.googleapis.com/auth/drive'],
    subject: userEmail, // This is the key - impersonate this user
  };

  delegatedAuthOptions.credentials = {
    client_email: creds.client_email,
    private_key: creds.private_key,
  };

  if (creds.project_id) delegatedAuthOptions.projectId = creds.project_id;

  const delegatedAuth = new google.auth.GoogleAuth(delegatedAuthOptions);
  const client = await delegatedAuth.getClient();
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

async function checkUserAccess({ folderId, userEmail }) {
  const drive = await getDriveClient();

  try {
    const response = await drive.permissions.list({
      fileId: folderId,
      fields: 'permissions(emailAddress, role)',
      supportsAllDrives: true,
    });

    const userPermission = response.data.permissions?.find(
      (permission) => permission.emailAddress === userEmail
    );

    return {
      hasAccess: !!userPermission,
      accessLevel: userPermission?.role || null,
    };
  } catch (error) {
    if (error.code === 403) {
      return {
        hasAccess: false,
        accessLevel: null,
      };
    }
    throw error;
  }
}

async function listFilesRecursively({ folderId, pageToken = null, allItems = [] }) {
  const drive = await getDriveClient();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    spaces: 'drive',
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
    orderBy: 'folder,name',
    pageSize: 1000,
    pageToken,
    supportsAllDrives: true,
  });

  const items = response.data.files || [];
  allItems.push(...items);

  // If there are more pages, fetch them
  if (response.data.nextPageToken) {
    return listFilesRecursively({
      folderId,
      pageToken: response.data.nextPageToken,
      allItems,
    });
  }

  return allItems;
}

async function buildHierarchicalStructure(folderId) {
  const folderMimeType = 'application/vnd.google-apps.folder';

  // Fetch all items in this folder
  const items = await listFilesRecursively({ folderId });

  const result = [];

  for (const item of items) {
    if (item.mimeType === folderMimeType) {
      const folderEntry = { ...item, children: await buildHierarchicalStructure(item.id) };
      result.push(folderEntry);
    } else {
      result.push(item);
    }
  }

  return result;
}

async function createFolder({ folderName, parentFolderId }) {
  if (!folderName) {
    throw new Error('Missing folderName. Provide folderName in the request body.');
  }

  const drive = await getDriveClient();

  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentFolderId ? [parentFolderId] : [],
  };

  const response = await drive.files.create({
    requestBody: folderMetadata,
    fields: 'id, name, mimeType, parents, createdTime',
    supportsAllDrives: true,
  });

  return response.data;
}

async function uploadFile({ folderId, fileName, fileBuffer, mimeType }) {
  if (!folderId) {
    throw new Error('Missing folderId. Provide folderId in the request body.');
  }
  if (!oauthRefreshToken) {
    throw new Error('Missing refresh token. Set GOOGLE_OAUTH_REFRESH_TOKEN in .env.');
  }

  const drive = getDriveClientWithRefreshToken(oauthRefreshToken);

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  // Convert buffer to readable stream
  const bufferStream = Readable.from(fileBuffer);

  const media = {
    mimeType: mimeType || 'application/octet-stream',
    body: bufferStream,
  };

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id, name, mimeType, webViewLink, createdTime',
    supportsAllDrives: true,
  });

  return response.data;
}

async function downloadFile({ fileId }) {
  const drive = await getDriveClient();

  const fileMetadata = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size',
    supportsAllDrives: true,
  });

  const response = await drive.files.get(
    {
      fileId,
      alt: 'media',
      supportsAllDrives: true,
    },
    { responseType: 'stream' }
  );

  return {
    fileName: fileMetadata.data.name,
    mimeType: fileMetadata.data.mimeType,
    size: fileMetadata.data.size,
    stream: response.data,
  };
}

module.exports = {
  grantDrivePermission,
  checkUserAccess,
  listFilesRecursively,
  buildHierarchicalStructure,
  uploadFile,
  downloadFile,
  createFolder,
  getDriveClientAsUser,
};
