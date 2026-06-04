const express = require('express');
const multer = require('multer');
const { grantDrivePermission, checkUserAccess, listFolderChildren, searchFilesInFolder, buildHierarchicalStructure, uploadFile, downloadFile, createFolder } = require('../services/driveService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/grant-access', async (req, res) => {
  const { fileId, userEmail, role = 'reader', type = 'user', sendNotificationEmail = false } = req.body;

  console.info('grant-access request received:', {
    fileId,
    userEmail,
    role,
    type,
    sendNotificationEmail,
  });

  if (!fileId || !userEmail) {
    console.warn('grant-access missing fields:', { fileId, userEmail });
    return res.status(400).json({ error: 'Missing required fields: fileId and userEmail.' });
  }

  try {
    const permission = await grantDrivePermission({
      fileId,
      userEmail,
      role,
      type,
      sendNotificationEmail,
    });

    console.info('grant-access succeeded:', { fileId, userEmail, permissionId: permission.id });
    res.status(200).json({ success: true, permission });
  } catch (error) {
    console.error('grant-access error:', error.message || error);
    const status = error.code === 403 ? 403 : 500;
    res.status(status).json({ success: false, error: error.message || 'Unable to grant access.' });
  }
});

router.post('/check-access', async (req, res) => {
  const { folderId, userEmail } = req.body;

  console.info('check-access request received:', { folderId, userEmail });

  if (!folderId || !userEmail) {
    console.warn('check-access missing fields:', { folderId, userEmail });
    return res.status(400).json({ error: 'Missing required fields: folderId and userEmail.' });
  }

  try {
    const result = await checkUserAccess({ folderId, userEmail });

    console.info('check-access succeeded:', { folderId, userEmail, hasAccess: result.hasAccess, accessLevel: result.accessLevel });
    res.status(200).json({ success: true, hasAccess: result.hasAccess, accessLevel: result.accessLevel });
  } catch (error) {
    console.error('check-access error:', error.message || error);
    res.status(500).json({ success: false, error: error.message || 'Unable to check access.' });
  }
});

router.post('/create-folder', async (req, res) => {
  const { folderName, parentFolderId } = req.body;

  console.info('create-folder request received:', { folderName, parentFolderId });

  if (!folderName) {
    console.warn('create-folder missing fields:', { folderName });
    return res.status(400).json({ error: 'Missing required field: folderName.' });
  }

  try {
    const folder = await createFolder({ folderName, parentFolderId });

    console.info('create-folder succeeded:', { folderId: folder.id, folderName: folder.name, parentFolderId });
    res.status(200).json({ success: true, folder });
  } catch (error) {
    console.error('create-folder error:', error.message || error);
    const status = error.code === 403 ? 403 : 500;
    res.status(status).json({ success: false, error: error.message || 'Unable to create folder.' });
  }
});

router.get('/list-files', async (req, res) => {
  const { folderId, recursive = 'false', pageSize, pageToken, maxItems } = req.query;

  console.info('list-files request received:', { folderId });

  if (!folderId) {
    console.warn('list-files missing folderId');
    return res.status(400).json({ error: 'Missing required field: folderId.' });
  }

  const recursiveListing = String(recursive).toLowerCase() === 'true';
  const parsedPageSize = Math.min(Math.max(parseInt(pageSize, 10) || 100, 10), 1000);
  const parsedMaxItems = Math.min(Math.max(parseInt(maxItems, 10) || 5000, 1), 10000);

  try {
    if (recursiveListing) {
      const files = await buildHierarchicalStructure(folderId, parsedMaxItems);

      console.info('list-files succeeded (recursive):', { folderId, fileCount: files.length, maxItems: parsedMaxItems });
      return res.status(200).json({ success: true, fileCount: files.length, maxItems: parsedMaxItems, files });
    }

    const { files, nextPageToken } = await listFolderChildren({ folderId, pageSize: parsedPageSize, pageToken });

    console.info('list-files succeeded:', { folderId, fileCount: files.length, nextPageToken: !!nextPageToken });
    return res.status(200).json({ success: true, fileCount: files.length, nextPageToken, files });
  } catch (error) {
    console.error('list-files error:', error.message || error);
    const status = error.code === 403 ? 403 : 500;
    res.status(status).json({ success: false, error: error.message || 'Unable to list files.' });
  }
});

router.get('/search-files', async (req, res) => {
  const { folderId, searchTerm, pageSize, pageToken } = req.query;

  console.info('search-files request received:', { folderId, searchTerm });

  if (!folderId || !searchTerm) {
    console.warn('search-files missing folderId or searchTerm');
    return res.status(400).json({ error: 'Missing required fields: folderId and searchTerm.' });
  }

  const parsedPageSize = Math.min(Math.max(parseInt(pageSize, 10) || 50, 10), 500);

  try {
    const { results, nextPageToken } = await searchFilesInFolder({
      folderId,
      searchTerm,
      pageSize: parsedPageSize,
      pageToken,
    });

    console.info('search-files succeeded:', { folderId, searchTerm, itemCount: results.length, nextPageToken: !!nextPageToken });
    return res.status(200).json({ success: true, itemCount: results.length, nextPageToken, results });
  } catch (error) {
    console.error('search-files error:', error.message || error);
    const status = error.code === 403 ? 403 : 500;
    res.status(status).json({ success: false, error: error.message || 'Unable to search files.' });
  }
});

router.post('/upload-file', upload.single('file'), async (req, res) => {
  const folderId = req.body.folderId;

  console.info('upload-file request received:', {
    folderId,
    fileName: req.file?.originalname,
    fileSize: req.file?.size,
  });

  if (!folderId || !req.file) {
    console.warn('upload-file missing fields:', { folderId, hasFile: !!req.file });
    return res.status(400).json({ error: 'Missing required fields: folderId and file.' });
  }

  try {
    const fileData = await uploadFile({
      folderId,
      fileName: req.file.originalname,
      fileBuffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    const uploadedBy = 'personal Gmail account via refresh token';
    console.info('upload-file succeeded:', { folderId, fileId: fileData.id, uploadedBy });
    res.status(200).json({ success: true, file: fileData, uploadedBy });
  } catch (error) {
    console.error('upload-file error:', error.message || error);
    const status = error.code === 403 ? 403 : 500;
    res.status(status).json({ success: false, error: error.message || 'Unable to upload file.' });
  }
});

router.get('/download-file', async (req, res) => {
  const { fileId } = req.query;

  console.info('download-file request received:', { fileId });

  if (!fileId) {
    console.warn('download-file missing fileId');
    return res.status(400).json({ error: 'Missing required field: fileId.' });
  }

  try {
    const { fileName, mimeType, size, stream } = await downloadFile({ fileId });

    const safeFileName = (fileName || 'download').replace(/["\\]/g, '_');

    console.info('download-file succeeded:', { fileId, fileName: safeFileName });

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`
    );
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Transfer-Encoding', 'binary');
    res.setHeader('Cache-Control', 'no-cache');
    if (size) {
      res.setHeader('Content-Length', size);
    }

    stream.on('error', (error) => {
      console.error('download-file stream error:', error.message || error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: 'Error downloading file.' });
      } else {
        res.destroy(error);
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error('download-file error:', error.message || error);
    const status = error.code === 403 ? 403 : 404;
    res.status(status).json({ success: false, error: error.message || 'Unable to download file.' });
  }
});

module.exports = router;
