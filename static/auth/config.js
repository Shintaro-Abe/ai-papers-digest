// Auth config — placeholders are replaced at deploy time by .github/workflows/deploy.yml
// using terraform outputs. Do NOT edit values manually here; this file is regenerated.
window.AUTH_CONFIG = {
  cognitoDomain: "__COGNITO_DOMAIN__",
  clientId: "__COGNITO_CLIENT_ID__",
  cloudfrontDomain: "__CLOUDFRONT_DOMAIN__",
  scope: "openid email",
};
