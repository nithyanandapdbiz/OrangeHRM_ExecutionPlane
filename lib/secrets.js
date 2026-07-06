'use strict';
/**
 * Secrets provider abstraction (TD-08).
 *
 * Today the Execution Plane reads secrets directly from `process.env` (populated
 * from `.env` in dev, from a Kubernetes Secret in cluster). That is a procurement
 * and breach-blast-radius concern. This module is the seam that lets us source
 * secrets from Azure Key Vault WITHOUT rewriting every `process.env.X` read:
 *
 *   - The `env` provider (default) is a no-op pass-through — behaviour unchanged.
 *   - The `keyvault` provider hydrates named secrets from Key Vault into the
 *     process environment at boot, so all existing `process.env` reads keep working.
 *
 * Boot integration (one line, when ready — not wired yet to keep boot unchanged):
 *     await require('./lib/secrets').hydrate();   // before startupGuard.validate()
 *
 * Selection: SECRETS_PROVIDER = 'env' (default) | 'keyvault'
 * Key Vault config: AZURE_KEY_VAULT_URL, plus DefaultAzureCredential (Managed Identity).
 */
const logger = require('./logger');

// Secrets the platform expects to be present at runtime (used by the keyvault
// provider to know what to fetch, and by tooling to document the contract).
const SECRET_NAMES = [
  'CLIENT_SECRET',
  'JIRA_API_TOKEN',
  'ZEPHYR_API_TOKEN',
  'APP_USERNAME',
  'APP_PASSWORD',
  'API_SECRET',
];

function providerName() {
  return (process.env.SECRETS_PROVIDER || 'env').toLowerCase();
}

// ── env provider ──────────────────────────────────────────────────────────────
// Secrets are already in the environment; nothing to do.
const envProvider = {
  name: 'env',
  async hydrate() {
    return { provider: 'env', hydrated: [], note: 'secrets read directly from process.env' };
  },
  get(name) {
    return process.env[name];
  },
};

// ── keyvault provider (scaffold) ──────────────────────────────────────────────
// Pulls SECRET_NAMES from Azure Key Vault and injects them into process.env so
// downstream `process.env.X` reads are unchanged. Requires @azure/keyvault-secrets
// and @azure/identity — installed only in environments that opt into this provider.
const keyvaultProvider = {
  name: 'keyvault',
  async hydrate() {
    const url = process.env.AZURE_KEY_VAULT_URL;
    if (!url) throw new Error('SECRETS_PROVIDER=keyvault requires AZURE_KEY_VAULT_URL');

    let SecretClient, DefaultAzureCredential;
    try {
      ({ SecretClient } = require('@azure/keyvault-secrets'));
      ({ DefaultAzureCredential } = require('@azure/identity'));
    } catch {
      throw new Error(
        'SECRETS_PROVIDER=keyvault requires @azure/keyvault-secrets and @azure/identity to be installed'
      );
    }

    const client = new SecretClient(url, new DefaultAzureCredential());
    const hydrated = [];
    for (const name of SECRET_NAMES) {
      // Key Vault secret names use hyphens, not underscores.
      const kvName = name.replace(/_/g, '-');
      try {
        const secret = await client.getSecret(kvName);
        if (secret?.value != null) {
          process.env[name] = secret.value;
          hydrated.push(name);
        }
      } catch (e) {
        logger.warn(`[secrets] Key Vault: could not load ${kvName}: ${e.message}`);
      }
    }
    logger.info(`[secrets] Key Vault hydrated ${hydrated.length}/${SECRET_NAMES.length} secrets`);
    return { provider: 'keyvault', hydrated, vault: url };
  },
  get(name) {
    return process.env[name];
  },
};

function provider() {
  switch (providerName()) {
    case 'keyvault':
      return keyvaultProvider;
    case 'env':
      return envProvider;
    default:
      logger.warn(`[secrets] Unknown SECRETS_PROVIDER="${providerName()}", falling back to env`);
      return envProvider;
  }
}

/** Load secrets into the environment per the selected provider. Safe to call at boot. */
async function hydrate() {
  return provider().hydrate();
}

/** Read a single secret by name through the active provider. */
function get(name) {
  return provider().get(name);
}

module.exports = { SECRET_NAMES, providerName, provider, hydrate, get };
