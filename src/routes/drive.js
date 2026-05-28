const express = require('express');
const { grantDrivePermission } = require('../services/driveService');

const router = express.Router();

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

module.exports = router;
