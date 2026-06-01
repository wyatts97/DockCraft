/**
 * system.js — public, unauthenticated system metadata (used for the footer
 * "DockCraft v…" label). Stays deliberately tiny; no server state here.
 */

const express = require('express');

let pkg = null;
try {
  // eslint-disable-next-line global-require
  pkg = require('../package.json');
} catch { /* package.json missing in test envs */ }

const router = express.Router();

router.get('/version', (req, res) => {
  res.json({ success: true, data: { version: pkg ? pkg.version : '0.0.0' } });
});

module.exports = router;
