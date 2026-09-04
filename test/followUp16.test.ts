import assert from 'assert';
import { signSessionToken, verifySessionToken, getSession, requireSession } from '../src/auth/session.js';

console.log('--- Running Follow-Up 16 Auth Gate & Session Header Tests ---');

async function runTests() {
  // Test 1: Sign and verify session token
  console.log('1. Testing signSessionToken and verifySessionToken...');
  const testUserId = 'test-user-f16-' + Date.now();
  const testEmail = 'user16@northveil.xyz';
  const validToken = signSessionToken({ userId: testUserId, email: testEmail, passkeyOk: true });
  assert.ok(validToken && validToken.includes('.'), 'Token must be non-empty and signed');
  
  const payload = verifySessionToken(validToken);
  assert.ok(payload, 'Payload must be non-null');
  assert.strictEqual(payload?.userId, testUserId);
  assert.strictEqual(payload?.email, testEmail);
  assert.strictEqual(payload?.passkeyOk, true);
  console.log('   ✓ Token signing and verification verified');

  // Test 2: getSession extracts token from X-Session-Token
  console.log('2. Testing getSession with X-Session-Token...');
  const req1 = {
    headers: {
      'x-session-token': validToken,
    },
    query: {},
  } as any;
  const session1 = getSession(req1);
  assert.ok(session1, 'getSession must resolve from X-Session-Token');
  assert.strictEqual(session1?.userId, testUserId);
  console.log('   ✓ getSession resolved X-Session-Token header');

  // Test 3: getSession extracts token from Authorization: Bearer
  console.log('3. Testing getSession with Authorization: Bearer...');
  const req2 = {
    headers: {
      authorization: `Bearer ${validToken}`,
    },
    query: {},
  } as any;
  const session2 = getSession(req2);
  assert.ok(session2, 'getSession must resolve from Authorization Bearer');
  assert.strictEqual(session2?.userId, testUserId);
  console.log('   ✓ getSession resolved Authorization: Bearer header');

  // Test 4: getSession priority over stale cookie
  console.log('4. Testing getSession priority over stale cookie...');
  const req3 = {
    headers: {
      cookie: 'nv_session=stale_invalid_cookie_xyz',
      'x-session-token': validToken,
    },
    query: {},
  } as any;
  const session3 = getSession(req3);
  assert.ok(session3, 'Valid X-Session-Token must take priority over stale cookie');
  assert.strictEqual(session3?.userId, testUserId);
  console.log('   ✓ getSession prioritized valid header over stale cookie');

  // Test 5: requireSession accepts X-Session-Token
  console.log('5. Testing requireSession accepts X-Session-Token...');
  let nextCalled = false;
  const req4 = {
    headers: {
      'x-session-token': validToken,
    },
    session: undefined,
  } as any;
  const res4 = {
    status: (code: number) => ({
      json: (data: any) => {
        throw new Error(`Unexpected status ${code}: ${JSON.stringify(data)}`);
      },
    }),
  } as any;
  await requireSession(req4, res4, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true, 'requireSession must call next() with valid X-Session-Token');
  assert.strictEqual(req4.session?.userId, testUserId);
  console.log('   ✓ requireSession passed with X-Session-Token');

  // Test 6: requireSession accepts Authorization: Bearer
  console.log('6. Testing requireSession accepts Authorization: Bearer...');
  nextCalled = false;
  const req5 = {
    headers: {
      authorization: `Bearer ${validToken}`,
    },
    session: undefined,
  } as any;
  await requireSession(req5, res4, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true, 'requireSession must call next() with valid Bearer token');
  assert.strictEqual(req5.session?.userId, testUserId);
  console.log('   ✓ requireSession passed with Authorization: Bearer');

  // Test 7: requireSession with stale cookie and valid header
  console.log('7. Testing requireSession with stale cookie and valid Bearer header...');
  nextCalled = false;
  const req6 = {
    headers: {
      cookie: 'nv_session=stale_or_expired_cookie_value',
      authorization: `Bearer ${validToken}`,
    },
    session: undefined,
  } as any;
  await requireSession(req6, res4, () => {
    nextCalled = true;
  });
  assert.strictEqual(nextCalled, true, 'requireSession must not fail with 401 when valid header is present');
  assert.strictEqual(req6.session?.userId, testUserId);
  console.log('   ✓ Stale cookie did not block valid Authorization header');

  // Test 8: requireSession rejects when no session token is provided
  console.log('8. Testing requireSession rejects missing token...');
  let errorStatus = 0;
  let errorMessage = '';
  const req7 = {
    headers: {},
    session: undefined,
  } as any;
  const res7 = {
    status: (code: number) => {
      errorStatus = code;
      return {
        json: (data: any) => {
          errorMessage = data.error;
        },
      };
    },
  } as any;
  await requireSession(req7, res7, () => {
    assert.fail('next() should not be called without session token');
  });
  assert.strictEqual(errorStatus, 401);
  assert.ok(errorMessage.includes('Session token required'));
  console.log('   ✓ Unauthenticated request cleanly rejected with 401');

  console.log('\n✅ All Follow-Up 16 Auth Gate & Session Header Tests Passed Successfully!\n');
}

runTests().catch((err) => {
  console.error('Follow-Up 16 Test Failure:', err);
  process.exit(1);
});
