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

async function listFolderChildren({ folderId, pageSize = 100, pageToken = null }) {
  const drive = await getDriveClient();

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    spaces: 'drive',
    fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)',
    orderBy: 'folder,name',
    pageSize,
    pageToken,
    supportsAllDrives: true,
  });

  return {
    files: response.data.files || [],
    nextPageToken: response.data.nextPageToken || null,
  };
}

function encodeSearchToken(state) {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function decodeSearchToken(token) {
  if (!token) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
  } catch (err) {
    return null;
  }
}

async function searchFilesInFolder({ folderId, searchTerm, pageSize = 50, pageToken = null }) {
  if (!folderId) {
    throw new Error('Missing folderId.');
  }
  if (!searchTerm || !searchTerm.trim()) {
    throw new Error('Missing searchTerm.');
  }

  const drive = await getDriveClient();
  const folderMimeType = 'application/vnd.google-apps.folder';
  const cleanSearchTerm = String(searchTerm).trim().replace(/'/g, "\\'")
  const MAX_CONCURRENT_REQUESTS = 5;
  const MAX_DEPTH = 8;
  const REQUEST_TIMEOUT = 8000;

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Search timeout')), REQUEST_TIMEOUT)
  );

  const results = [];
  let nextPageToken = null;

  try {
    // Build folder hierarchy using parallel requests
    const folderHierarchy = new Set([folderId]);
    const visitedFolders = new Set([folderId]);
    let queue = [{ id: folderId, depth: 0 }];

    while (queue.length > 0) {
      const batch = queue.splice(0, MAX_CONCURRENT_REQUESTS);
      const batchPromises = batch.map(async (item) => {
        try {
          const { files } = await Promise.race([
            listFolderChildren({ folderId: item.id, pageSize: 500 }),
            timeoutPromise,
          ]);

          const subfolders = [];
          for (const file of files) {
            if (file.mimeType === folderMimeType && !visitedFolders.has(file.id) && item.depth < MAX_DEPTH) {
              folderHierarchy.add(file.id);
              visitedFolders.add(file.id);
              subfolders.push({ id: file.id, depth: item.depth + 1 });
            }
          }
          return subfolders;
        } catch (err) {
          console.warn('Folder traversal error:', err.message);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      queue = queue.concat(batchResults.flat());
    }

    // Search using fullText across the folder hierarchy
    const folderIds = Array.from(folderHierarchy);
    const folderQuery = folderIds.map((id) => `'${id}' in parents`).join(' or ');
    const searchQuery = `(name contains '${cleanSearchTerm}' or fullText contains '${cleanSearchTerm}') and (${folderQuery}) and trashed=false`;

    const searchResponse = await Promise.race([
      drive.files.list({
        q: searchQuery,
        spaces: 'drive',
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size)',
        pageSize: pageSize * 2,
        supportsAllDrives: true,
      }),
      timeoutPromise,
    ]);

    const searchResults = searchResponse.data.files || [];
    results.push(...searchResults.slice(0, pageSize));

    if (searchResponse.data.nextPageToken) {
      nextPageToken = encodeSearchToken({ folderHierarchy: folderIds, nextPageToken: searchResponse.data.nextPageToken });
    }
  } catch (err) {
    if (err.message !== 'Search timeout') {
      throw err;
    }
    console.warn('Search timeout - returning partial results');
  }

  return {
    results,
    nextPageToken,
  };
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

async function buildHierarchicalStructure(folderId, maxItems = 5000, itemCounter = { count: 0 }) {
  const folderMimeType = 'application/vnd.google-apps.folder';

  const items = await listFilesRecursively({ folderId });
  const result = [];

  for (const item of items) {
    if (itemCounter.count >= maxItems) {
      break;
    }

    if (item.mimeType === folderMimeType) {
      const folderEntry = {
        ...item,
        children: await buildHierarchicalStructure(item.id, maxItems, itemCounter),
      };
      result.push(folderEntry);
    } else {
      result.push(item);
      itemCounter.count += 1;
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
  listFolderChildren,
  searchFilesInFolder,
  listFilesRecursively,
  buildHierarchicalStructure,
  uploadFile,
  downloadFile,
  createFolder,
  getDriveClientAsUser,
};
