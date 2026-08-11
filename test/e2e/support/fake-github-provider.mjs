import { createHash, randomUUID } from 'node:crypto';

import express from 'express';

function html(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Install a deterministic, local GitHub-compatible OAuth fixture on the
 * temporary RP server. It validates state-carrying authorization requests,
 * single-use codes, client credentials, redirect URIs, and PKCE so browser
 * tests exercise Parako's real provider adapter rather than mocking it.
 */
export function installFakeGitHubProvider(
  app,
  { clientId, clientSecret, redirectUri }
) {
  const requests = new Map();
  const codes = new Map();
  const accessTokens = new Map();
  const form = express.urlencoded({ extended: false, limit: '4kb' });

  app.get('/fake-github/authorize', (req, res) => {
    const {
      client_id: requestedClientId,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      redirect_uri: requestedRedirectUri,
      state,
    } = req.query;
    if (
      requestedClientId !== clientId ||
      requestedRedirectUri !== redirectUri ||
      typeof state !== 'string' ||
      typeof codeChallenge !== 'string' ||
      codeChallengeMethod !== 'S256'
    ) {
      res.status(400).send('Invalid authorization request');
      return;
    }

    const id = randomUUID();
    requests.set(id, {
      codeChallenge,
      redirectUri: requestedRedirectUri,
      state,
    });
    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Local GitHub fixture</title></head>
<body><main><h1>Authorize Parako test access</h1>
<form method="post" action="/fake-github/decision">
  <input type="hidden" name="request_id" value="${html(id)}">
  <label>Provider subject <input name="provider_subject" value="424242"></label>
  <label>Verified email <input name="verified_email" type="email"></label>
  <button type="submit" name="decision" value="approve">Approve</button>
  <button type="submit" name="decision" value="deny">Deny</button>
  <button type="submit" name="decision" value="invalid-state">Return invalid state</button>
  <button type="submit" name="decision" value="provider-failure">Return provider failure</button>
</form></main></body></html>`);
  });

  app.post('/fake-github/decision', form, (req, res) => {
    const pending = requests.get(req.body.request_id);
    requests.delete(req.body.request_id);
    if (
      !pending ||
      !['approve', 'deny', 'invalid-state', 'provider-failure'].includes(
        req.body.decision
      )
    ) {
      res.status(400).send('Invalid authorization decision');
      return;
    }

    const callback = new URL(pending.redirectUri);
    callback.searchParams.set('state', pending.state);
    if (req.body.decision === 'deny') {
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('error_description', 'The user denied access');
      res.redirect(303, callback.href);
      return;
    }

    if (req.body.decision === 'invalid-state') {
      callback.searchParams.set('state', `${pending.state}-tampered`);
      callback.searchParams.set('code', randomUUID());
      res.redirect(303, callback.href);
      return;
    }

    if (req.body.decision === 'provider-failure') {
      callback.searchParams.set('code', `invalid-${randomUUID()}`);
      res.redirect(303, callback.href);
      return;
    }

    const providerSubject =
      typeof req.body.provider_subject === 'string' &&
      req.body.provider_subject.length > 0 &&
      req.body.provider_subject.length <= 200
        ? req.body.provider_subject
        : '424242';
    const verifiedEmail =
      typeof req.body.verified_email === 'string' &&
      req.body.verified_email.length > 0 &&
      req.body.verified_email.length <= 320
        ? req.body.verified_email
        : undefined;
    pending.profile = { providerSubject, verifiedEmail };

    const code = randomUUID();
    codes.set(code, pending);
    callback.searchParams.set('code', code);
    res.redirect(303, callback.href);
  });

  app.post('/fake-github/token', form, (req, res) => {
    const pending = codes.get(req.body.code);
    codes.delete(req.body.code);
    if (
      !pending ||
      req.body.client_id !== clientId ||
      req.body.client_secret !== clientSecret ||
      req.body.redirect_uri !== redirectUri ||
      typeof req.body.code_verifier !== 'string' ||
      challengeFor(req.body.code_verifier) !== pending.codeChallenge
    ) {
      res.status(400).json({ error: 'bad_verification_code' });
      return;
    }

    const accessToken = `fake-github-${randomUUID()}`;
    accessTokens.set(accessToken, pending.profile);
    res.json({
      access_token: accessToken,
      scope: 'read:user user:email',
      token_type: 'bearer',
    });
  });

  const authorizeUser = (req, res, next) => {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    const profile = token ? accessTokens.get(token) : undefined;
    if (!profile) {
      res.status(401).json({ message: 'Bad credentials' });
      return;
    }
    res.locals.fakeGitHubProfile = profile;
    next();
  };

  app.get('/fake-github/user', authorizeUser, (_req, res) => {
    const profile = res.locals.fakeGitHubProfile;
    res.json({
      id: profile.providerSubject,
      email: profile.verifiedEmail,
      email_verified: Boolean(profile.verifiedEmail),
      location: 'BJ',
      login: 'parako-social-user',
      name: 'Parako Social User',
    });
  });
  app.get('/fake-github/user/emails', authorizeUser, (_req, res) => {
    const email = res.locals.fakeGitHubProfile.verifiedEmail;
    res.json(email ? [{ email, primary: true, verified: true }] : []);
  });
}
