import assert from 'node:assert';
import { assertProductionSecurity } from '../src/server.js';

console.log('--- Running Boot Security Invariant Tests ---');

// 1. Rejects PRIVATE_KEY
{
  process.env.PRIVATE_KEY = '0x1111111111111111111111111111111111111111111111111111111111111111';
  assert.throws(
    () => {
      assertProductionSecurity();
    },
    /CRITICAL SECURITY VIOLATION: Environment variable PRIVATE_KEY is set/,
    'Should throw error when PRIVATE_KEY is present'
  );
  delete process.env.PRIVATE_KEY;
  console.log('✓ production refuses PRIVATE_KEY env');
}

// 2. Rejects SEPOLIA_PRIVATE_KEY
{
  process.env.SEPOLIA_PRIVATE_KEY = '0x2222222222222222222222222222222222222222222222222222222222222222';
  assert.throws(
    () => {
      assertProductionSecurity();
    },
    /CRITICAL SECURITY VIOLATION: Environment variable SEPOLIA_PRIVATE_KEY is set/,
    'Should throw error when SEPOLIA_PRIVATE_KEY is present'
  );
  delete process.env.SEPOLIA_PRIVATE_KEY;
  console.log('✓ production refuses SEPOLIA_PRIVATE_KEY env');
}

// 3. Rejects ETH_PRIVATE_KEY
{
  process.env.ETH_PRIVATE_KEY = '0x3333333333333333333333333333333333333333333333333333333333333333';
  assert.throws(
    () => {
      assertProductionSecurity();
    },
    /CRITICAL SECURITY VIOLATION: Environment variable ETH_PRIVATE_KEY is set/,
    'Should throw error when ETH_PRIVATE_KEY is present'
  );
  delete process.env.ETH_PRIVATE_KEY;
  console.log('✓ production refuses ETH_PRIVATE_KEY env');
}

// 4. Passes clean environment
{
  delete process.env.PRIVATE_KEY;
  delete process.env.SEPOLIA_PRIVATE_KEY;
  delete process.env.ETH_PRIVATE_KEY;
  assert.doesNotThrow(() => {
    assertProductionSecurity();
  });
  console.log('✓ clean environment boots successfully');
}

console.log('All boot security tests passed!\n');
