const express = require('express');
const { signupTenant, login } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/signup', signupTenant);
router.post('/login', login);

module.exports = router;