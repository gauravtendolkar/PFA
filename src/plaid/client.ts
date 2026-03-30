import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { config } from '../config/index.js';

let _client: PlaidApi | null = null;

export function getPlaidClient(): PlaidApi {
  if (_client) return _client;

  if (!config.plaid.enabled) {
    throw new Error('Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to your .env file.');
  }

  const envMap = {
    sandbox: PlaidEnvironments.sandbox,
    development: PlaidEnvironments.development,
    production: PlaidEnvironments.production,
  };

  const configuration = new Configuration({
    basePath: envMap[config.plaid.env],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': config.plaid.clientId,
        'PLAID-SECRET': config.plaid.secret,
      },
    },
  });

  _client = new PlaidApi(configuration);
  return _client;
}
