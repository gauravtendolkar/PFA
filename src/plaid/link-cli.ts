/**
 * CLI tool to link a Plaid account.
 *
 * In sandbox mode, you can use the sandbox public token flow:
 *   npm run plaid:link
 *
 * In development/production, this generates a link token that you'd
 * use with the Plaid Link frontend component. For now, we support
 * sandbox auto-linking for testing.
 */
import { getPlaidClient } from './client.js';
import { createLinkToken, exchangePublicToken } from './link.js';
import { migrate } from '../db/index.js';
import { config } from '../config/index.js';
import { Products, CountryCode } from 'plaid';

async function main() {
  migrate();

  if (config.plaid.env === 'sandbox') {
    console.log('Sandbox mode: creating test institution link...');
    await linkSandbox();
  } else {
    const token = await createLinkToken();
    console.log('\nLink token created. Use this in Plaid Link UI:');
    console.log(token);
    console.log('\nAfter the user completes Link, exchange the public_token by calling:');
    console.log('  exchangePublicToken(publicToken)');
  }
}

async function linkSandbox() {
  const client = getPlaidClient();

  // Create a sandbox public token for a test institution
  const res = await client.sandboxPublicTokenCreate({
    institution_id: 'ins_109508', // First Platypus Bank (sandbox)
    initial_products: [Products.Transactions],
    options: {
      override_username: 'user_good',
      override_password: 'pass_good',
    },
  });

  const publicToken = res.data.public_token;
  console.log('Got sandbox public token, exchanging...');

  const itemId = await exchangePublicToken(publicToken);
  console.log('Done! Item ID:', itemId);
  console.log('\nNow sync transactions with: npm run plaid:sync');
}

main().catch(err => {
  console.error('Error:', err.response?.data || err.message);
  process.exit(1);
});
