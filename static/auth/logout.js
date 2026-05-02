// Logout page logic — extracted from inline script for CSP compliance.
(function () {
  'use strict';
  var statusEl = document.getElementById('status');
  var loginLink = document.getElementById('login-link');

  // 1. Clear local cookies and any in-flight auth state
  window.AuthHelpers.clearTokens();
  sessionStorage.clear();
  localStorage.removeItem('pkce_verifier');
  localStorage.removeItem('oauth_state');
  localStorage.removeItem('post_login_dest');

  // 2. Detect entry mode: ?initiate=1 means we kicked off logout from the UI;
  //    otherwise we are returning from Cognito's redirect.
  var params = new URLSearchParams(window.location.search);
  if (params.get('initiate') === '1') {
    statusEl.textContent = 'Cognito ログアウトへ遷移します';
    window.location.replace(window.AuthHelpers.logoutUrl());
    return;
  }

  statusEl.textContent = 'サインアウトしました';
  loginLink.style.display = 'inline';
})();
