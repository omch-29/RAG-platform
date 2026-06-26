const express = require('express');
const { signupTenant, login, inviteMember } = require('../controllers/auth.controller');
const { authMiddleware, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', signupTenant);
router.post('/login', login);
router.post('/invite', authMiddleware, requireAdmin, inviteMember);

module.exports = router;