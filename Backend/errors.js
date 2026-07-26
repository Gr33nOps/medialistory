const IS_PROD = process.env.NODE_ENV === 'production';

function clientError(res, status, publicMessage, err) {
  if (err) {
    console.error(publicMessage, err.message || err);
  }
  const body = { error: publicMessage };
  if (!IS_PROD && err) {
    body.message = err.message || String(err);
  }
  return res.status(status).json(body);
}

function sanitizeUpstreamError(res, status, publicMessage) {
  return res.status(status).json({ error: publicMessage });
}

module.exports = { clientError, sanitizeUpstreamError, IS_PROD };
