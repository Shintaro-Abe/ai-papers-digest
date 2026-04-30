// Callback page logic — extracted from inline script for CSP compliance.
(async function () {
  'use strict';
  var statusEl = document.getElementById('status');

  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var returnedState = params.get('state');
  var error = params.get('error');

  if (error) {
    // error comes from Cognito; render as text only
    statusEl.textContent = 'サインインに失敗しました: ' + String(error);
    return;
  }

  if (!code) {
    statusEl.textContent = '認証コードが見つかりません。再度サインインしてください。';
    return;
  }

  // Validate state to prevent CSRF
  var savedState = sessionStorage.getItem('oauth_state');
  if (!savedState || savedState !== returnedState) {
    statusEl.textContent = 'セキュリティチェックに失敗しました（state mismatch）。再度サインインしてください。';
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('post_login_dest');
    return;
  }

  var verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) {
    statusEl.textContent = 'PKCE 情報が見つかりません。再度サインインしてください。';
    return;
  }

  // Re-validate dest from sessionStorage to defend in depth.
  var dest = window.AuthHelpers.safeDest(sessionStorage.getItem('post_login_dest'));

  try {
    var tokens = await window.AuthHelpers.exchangeCodeForTokens(code, verifier);
    window.AuthHelpers.storeTokens(tokens);

    // Clean up
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
    sessionStorage.removeItem('post_login_dest');

    window.location.replace(dest);
  } catch (err) {
    statusEl.textContent = 'トークン交換に失敗しました: ' + err.message;
  }
})();
