import { describe, expect, it } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  buildAuthorization,
  authorizationMatchesQuote,
  buildPaymentHeader,
  checkRequirement,
  classifyPaidResponse,
  formatUsdc,
  isAllowedBuyUrl,
  parsePaymentChallenge,
  parseUsdcToAtomic,
  offeredTokens,
  selectRequirement,
  usdLabel,
  verifyAuthorizationSignature,
} from './x402';
import { PAY_TOKENS } from './tokens';

const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
const PAY_TO = '0x20faAca5F980E29639A0FCC6dcA6988E18ed333B';
const RESOURCE = 'https://gateway.usebuy.ai/v1/browser/sessions';

// The challenge Buy's gateway actually returned for a 1-minute browser rental (captured live, trimmed to 2 options).
const LIVE_CHALLENGE = {
  x402Version: 1,
  accepts: [
    {
      scheme: 'exact',
      network: 'celo',
      maxAmountRequired: '3606',
      resource: RESOURCE,
      description: 'Rent an isolated agent browser through buy-gateway',
      mimeType: 'application/json',
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      asset: USDC,
      extra: { name: 'USDC', version: '2', gateway: { capability: 'browser.sessions.create', durationMinutes: 1 } },
    },
    {
      scheme: 'exact',
      network: 'celo',
      maxAmountRequired: '3606',
      resource: RESOURCE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      asset: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
      extra: { name: 'Tether USD', version: '1' },
    },
    {
      scheme: 'exact',
      network: 'celo',
      maxAmountRequired: '3606',
      resource: RESOURCE,
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      asset: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
      extra: { name: 'Tether America USD', version: '1' },
    },
  ],
  error: '',
};

const expected = { payTo: PAY_TO, resource: RESOURCE, token: PAY_TOKENS.USDC, maxAtomic: 10_000n };

describe('isAllowedBuyUrl', () => {
  it('accepts only https on Buy’s own hosts', () => {
    expect(isAllowedBuyUrl('https://gateway.usebuy.ai/v1/catalog')).toBe(true);
    expect(isAllowedBuyUrl('https://usebuy.ai/google/vm')).toBe(true);
  });

  it('rejects look-alikes, other schemes, credentials and odd ports', () => {
    for (const bad of [
      'http://gateway.usebuy.ai/x',
      'https://gateway.usebuy.ai.evil.com/x',
      'https://evil.com/?https://gateway.usebuy.ai',
      'https://user:pw@gateway.usebuy.ai/x',
      'https://gateway.usebuy.ai:8443/x',
      'https://usebuy.ai@evil.com/x',
      'ftp://usebuy.ai/x',
      'not a url',
    ]) {
      expect(isAllowedBuyUrl(bad), bad).toBe(false);
    }
  });
});

describe('parsePaymentChallenge / selectRequirement', () => {
  it('parses the real gateway challenge and picks the USDC option', () => {
    const c = parsePaymentChallenge(LIVE_CHALLENGE);
    expect(c).not.toBeNull();
    const r = selectRequirement(c!, PAY_TOKENS.USDC);
    expect(r?.asset.toLowerCase()).toBe(USDC.toLowerCase());
    expect(r?.maxAmountRequired).toBe('3606');
  });

  it('matches the token address case-insensitively', () => {
    const r = selectRequirement(parsePaymentChallenge(LIVE_CHALLENGE)!, PAY_TOKENS.USDC);
    expect(r).not.toBeNull();
  });

  it('rejects malformed challenges', () => {
    expect(parsePaymentChallenge({})).toBeNull();
    expect(parsePaymentChallenge({ x402Version: 1, accepts: [] })).toBeNull();
    expect(parsePaymentChallenge({ x402Version: 1, accepts: [{ scheme: 'exact' }] })).toBeNull();
    expect(parsePaymentChallenge({ ...LIVE_CHALLENGE, accepts: [{ ...LIVE_CHALLENGE.accepts[0], maxAmountRequired: '-5' }] })).toBeNull();
    expect(parsePaymentChallenge('nope')).toBeNull();
  });

  it('returns null when USDC-on-Celo is not offered', () => {
    const noUsdc = { ...LIVE_CHALLENGE, accepts: [LIVE_CHALLENGE.accepts[1]] };
    expect(selectRequirement(parsePaymentChallenge(noUsdc)!, PAY_TOKENS.USDC)).toBeNull();
  });
});

describe('checkRequirement — what we refuse to pay', () => {
  const req = parsePaymentChallenge(LIVE_CHALLENGE)!.accepts[0];

  it('accepts the genuine requirement within the approved amount', () => {
    expect(checkRequirement(req, expected)).toBeNull();
  });

  it('refuses a different payee (the redirect attack)', () => {
    expect(checkRequirement({ ...req, payTo: '0x000000000000000000000000000000000000dEaD' }, expected)).toMatch(/payment address/i);
  });

  it('refuses a different resource', () => {
    expect(checkRequirement({ ...req, resource: 'https://gateway.usebuy.ai/v1/other' }, expected)).toMatch(/different resource/i);
  });

  it('refuses a different token', () => {
    expect(checkRequirement({ ...req, asset: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e' }, expected)).toMatch(/not USDC/i);
  });

  it('refuses a price above what was approved, but allows exactly the approved amount', () => {
    expect(checkRequirement({ ...req, maxAmountRequired: '10001' }, expected)).toMatch(/higher than the approved/i);
    expect(checkRequirement({ ...req, maxAmountRequired: '10000' }, expected)).toBeNull();
  });

  it('refuses a zero price and unexpected signing parameters', () => {
    expect(checkRequirement({ ...req, maxAmountRequired: '0' }, expected)).toMatch(/positive/i);
    expect(checkRequirement({ ...req, extra: { name: 'Tether USD', version: '1' } }, expected)).toMatch(/signing parameters/i);
  });
});

describe('payment authorization', () => {
  const req = parsePaymentChallenge(LIVE_CHALLENGE)!.accepts[0];
  const account = privateKeyToAccount(generatePrivateKey());
  const NOW = 1_800_000_000;

  it('pays exactly the quoted amount to exactly the quoted payee, inside a short window', () => {
    const td = buildAuthorization({ from: account.address, requirement: req, token: PAY_TOKENS.USDC, nowSec: NOW });
    expect(td.message.to).toBe(PAY_TO);
    expect(td.message.value).toBe('3606');
    expect(td.message.from).toBe(account.address);
    expect(Number(td.message.validAfter)).toBe(NOW - 600);
    expect(Number(td.message.validBefore)).toBe(NOW + 300); // the requirement's own 300s timeout
    expect(td.domain).toMatchObject({ name: 'USDC', version: '2', chainId: 42220 });
    expect(td.domain.verifyingContract).toBe(USDC);
  });

  it('never lets the signature stay valid longer than 10 minutes, whatever the server asks', () => {
    const greedy = { ...req, maxTimeoutSeconds: 3600 };
    const td = buildAuthorization({ from: account.address, requirement: greedy, token: PAY_TOKENS.USDC, nowSec: NOW });
    expect(Number(td.message.validBefore) - NOW).toBeLessThanOrEqual(600);
  });

  it('uses a fresh random 32-byte nonce each time', () => {
    const a = buildAuthorization({ from: account.address, requirement: req, token: PAY_TOKENS.USDC, nowSec: NOW }).message.nonce;
    const b = buildAuthorization({ from: account.address, requirement: req, token: PAY_TOKENS.USDC, nowSec: NOW }).message.nonce;
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('a real signature verifies; a tampered amount or a stranger’s signature does not', async () => {
    const td = buildAuthorization({ from: account.address, requirement: req, token: PAY_TOKENS.USDC, nowSec: NOW });
    const signature = await account.signTypedData({
      domain: { name: 'USDC', version: '2', chainId: 42220, verifyingContract: USDC },
      types: { TransferWithAuthorization: td.types.TransferWithAuthorization },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: td.message.from as `0x${string}`,
        to: td.message.to as `0x${string}`,
        value: BigInt(td.message.value),
        validAfter: BigInt(td.message.validAfter),
        validBefore: BigInt(td.message.validBefore),
        nonce: td.message.nonce as `0x${string}`,
      },
    });
    expect(await verifyAuthorizationSignature(td, signature)).toBe(true);

    const tampered = { ...td, message: { ...td.message, value: '9999999' } };
    expect(await verifyAuthorizationSignature(tampered, signature)).toBe(false);

    const stranger = privateKeyToAccount(generatePrivateKey());
    const wrongTd = { ...td, message: { ...td.message, from: stranger.address } };
    expect(await verifyAuthorizationSignature(wrongTd, signature)).toBe(false);
    expect(await verifyAuthorizationSignature(td, '0xdeadbeef')).toBe(false);
  });

  it('builds the v1 header (X-PAYMENT, base64 JSON, no "accepted") and the v2 header', () => {
    const td = buildAuthorization({ from: account.address, requirement: req, token: PAY_TOKENS.USDC, nowSec: NOW });
    const sig = '0x' + 'ab'.repeat(65);

    const v1 = buildPaymentHeader({ x402Version: 1, requirement: req, message: td.message, signature: sig });
    expect(v1.name).toBe('X-PAYMENT');
    const d1 = JSON.parse(Buffer.from(v1.value, 'base64').toString('utf8'));
    expect(d1).toMatchObject({ x402Version: 1, scheme: 'exact', network: 'celo' });
    expect(d1.payload.signature).toBe(sig);
    expect(d1.payload.authorization).toEqual(td.message);
    expect(d1.accepted).toBeUndefined();

    const v2 = buildPaymentHeader({ x402Version: 2, requirement: req, message: td.message, signature: sig });
    expect(v2.name).toBe('PAYMENT-SIGNATURE');
    const d2 = JSON.parse(Buffer.from(v2.value, 'base64').toString('utf8'));
    expect(d2.accepted.payTo).toBe(PAY_TO);
  });
});

describe('classifyPaidResponse — never mistake an ambiguous outcome for a safe retry', () => {
  it('a 200 is paid, carrying the transaction hash, correlation id and the provider output', () => {
    const o = classifyPaidResponse(200, { output: { posts: [1, 2] }, paymentSettled: true, transaction: '0xabc', correlationId: 'c-1' });
    expect(o).toEqual({ kind: 'paid', transaction: '0xabc', correlationId: 'c-1', output: { posts: [1, 2] } });
  });

  it('a 200 that does not confirm settlement is uncertain, not paid', () => {
    expect(classifyPaidResponse(200, { output: {}, paymentSettled: false, transaction: '0xabc' }).kind).toBe('uncertain');
  });

  it('pre-settlement refusals (4xx) are "not charged" and safe to correct and re-quote', () => {
    expect(classifyPaidResponse(400, { error: 'invalid_request', message: 'bad body' })).toMatchObject({ kind: 'not_charged', code: 'invalid_request' });
    expect(classifyPaidResponse(402, { error: 'verify_payment_failed' })).toMatchObject({ kind: 'not_charged', code: 'verify_payment_failed' });
    // header ignored → the gateway just repeats its challenge (this is what a v2 header gets from the v1 gateway)
    expect(classifyPaidResponse(402, { ...LIVE_CHALLENGE, error: '' })).toMatchObject({ kind: 'not_charged', code: 'payment_not_accepted' });
  });

  it('reads the gateway’s real verification errors (strings captured from the live gateway)', () => {
    const noFunds = classifyPaidResponse(402, { ...LIVE_CHALLENGE, error: 'verify_payment_failed: bad_signature (Onchain balance is not enough to cover the payment amount)' });
    expect(noFunds).toMatchObject({ kind: 'not_charged', code: 'insufficient_balance' });
    expect(noFunds.kind === 'not_charged' && noFunds.message).toMatch(/enough USDC/);

    const wrongShape = classifyPaidResponse(402, { ...LIVE_CHALLENGE, error: 'verify_payment_failed: no_matching_requirements' });
    expect(wrongShape).toMatchObject({ kind: 'not_charged', code: 'verify_payment_failed' });
    expect(wrongShape.kind === 'not_charged' && wrongShape.message).toContain('no_matching_requirements');
  });

  it('every 5xx is UNCERTAIN (the payment settles first) and keeps the ids needed to investigate', () => {
    for (const status of [500, 502, 503, 504]) {
      const o = classifyPaidResponse(status, { error: 'settle_uncertain', transaction: '0xdef', correlationId: 'c-9', output: { partial: true } });
      expect(o.kind).toBe('uncertain');
      if (o.kind === 'uncertain') {
        expect(o.transaction).toBe('0xdef');
        expect(o.correlationId).toBe('c-9');
      }
    }
  });

  it('reads nested error shapes and survives junk bodies', () => {
    expect(classifyPaidResponse(400, { error: { code: 'bad_input', message: 'nope' } })).toMatchObject({ code: 'bad_input', message: 'nope' });
    expect(classifyPaidResponse(500, 'gateway exploded').kind).toBe('uncertain');
    expect(classifyPaidResponse(500, null).kind).toBe('uncertain');
  });
});

describe('amounts', () => {
  it('formats atomic USDC readably', () => {
    expect(formatUsdc('3606')).toBe('0.003606');
    expect(formatUsdc('1000000')).toBe('1.00');
    expect(formatUsdc('16753')).toBe('0.016753');
    expect(formatUsdc(2_500_000n)).toBe('2.50');
    expect(usdLabel('3606')).toBe('$0.003606');
  });

  it('parses decimal USDC strictly', () => {
    expect(parseUsdcToAtomic('0.25')).toBe(250_000n);
    expect(parseUsdcToAtomic('5')).toBe(5_000_000n);
    expect(parseUsdcToAtomic('0.000001')).toBe(1n);
    for (const bad of ['', '-1', '1.2345678', 'abc', '1e3', '$5']) expect(parseUsdcToAtomic(bad), bad).toBeNull();
  });
});

describe('paying in USAT (Tether America USD) and USDT', () => {
  const challenge = parsePaymentChallenge(LIVE_CHALLENGE)!;
  const account = privateKeyToAccount(generatePrivateKey());
  const NOW = 1_800_000_000;

  it('sees which of our tokens the service offers', () => {
    expect(offeredTokens(challenge).sort()).toEqual(['USAT', 'USDC', 'USDT']);
  });

  it('selects the USAT requirement and accepts it under USAT’s own signing parameters', () => {
    const req = selectRequirement(challenge, PAY_TOKENS.USAT)!;
    expect(req.asset).toBe(PAY_TOKENS.USAT.address);
    expect(checkRequirement(req, { ...expected, token: PAY_TOKENS.USAT })).toBeNull();
  });

  it('refuses a USAT requirement checked as USDC, and a lookalike with the wrong domain', () => {
    const usat = selectRequirement(challenge, PAY_TOKENS.USAT)!;
    expect(checkRequirement(usat, { ...expected, token: PAY_TOKENS.USDC })).toMatch(/not USDC/i);
    const lookalike = { ...usat, extra: { name: 'USDC', version: '2' } };
    expect(checkRequirement(lookalike, { ...expected, token: PAY_TOKENS.USAT })).toMatch(/signing parameters/i);
  });

  it('builds the authorization under USAT’s EIP-712 domain, and a real signature verifies', async () => {
    const req = selectRequirement(challenge, PAY_TOKENS.USAT)!;
    const td = buildAuthorization({ from: account.address, requirement: req, token: PAY_TOKENS.USAT, nowSec: NOW });
    expect(td.domain).toEqual({ name: 'Tether America USD', version: '1', chainId: 42220, verifyingContract: PAY_TOKENS.USAT.address });
    const signature = await account.signTypedData({
      domain: { name: 'Tether America USD', version: '1', chainId: 42220, verifyingContract: PAY_TOKENS.USAT.address as `0x${string}` },
      types: { TransferWithAuthorization: td.types.TransferWithAuthorization },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: td.message.from as `0x${string}`,
        to: td.message.to as `0x${string}`,
        value: BigInt(td.message.value),
        validAfter: BigInt(td.message.validAfter),
        validBefore: BigInt(td.message.validBefore),
        nonce: td.message.nonce as `0x${string}`,
      },
    });
    expect(await verifyAuthorizationSignature(td, signature)).toBe(true);
    // The same authorization is NOT valid if someone claims it was for USDC's domain.
    expect(await verifyAuthorizationSignature({ ...td, domain: { ...td.domain, name: 'USDC', version: '2', verifyingContract: PAY_TOKENS.USDC.address } }, signature)).toBe(false);
  });

  it('names the token the wallet is short of', () => {
    const o = classifyPaidResponse(402, { ...LIVE_CHALLENGE, error: 'verify_payment_failed: bad_signature (Onchain balance is not enough to cover the payment amount)' }, 'USAT');
    expect(o.kind === 'not_charged' && o.message).toMatch(/enough USAT/);
  });
});

describe('authorizationMatchesQuote — the pre-claim guard', () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = parsePaymentChallenge(LIVE_CHALLENGE)!;
  const make = (sym: 'USDC' | 'USAT') => {
    const requirement = selectRequirement(challenge, PAY_TOKENS[sym])!;
    const typedData = buildAuthorization({ from: account.address, requirement, token: PAY_TOKENS[sym], nowSec: 1_800_000_000 });
    return { typedData, requirement, priceAtomic: '3606', walletAddress: account.address };
  };

  it('passes for an untouched quote in each token', () => {
    expect(authorizationMatchesQuote(make('USDC'))).toBe(true);
    expect(authorizationMatchesQuote(make('USAT'))).toBe(true);
  });

  it('fails if the payee, amount, payer, token or signing domain were altered', () => {
    const q = make('USAT');
    const other = '0x1111111111111111111111111111111111111111';
    expect(authorizationMatchesQuote({ ...q, typedData: { ...q.typedData, message: { ...q.typedData.message, to: other } } })).toBe(false);
    expect(authorizationMatchesQuote({ ...q, typedData: { ...q.typedData, message: { ...q.typedData.message, value: '9999' } } })).toBe(false);
    expect(authorizationMatchesQuote({ ...q, walletAddress: other })).toBe(false);
    expect(authorizationMatchesQuote({ ...q, typedData: { ...q.typedData, domain: { ...q.typedData.domain, verifyingContract: other } } })).toBe(false);
    expect(authorizationMatchesQuote({ ...q, typedData: { ...q.typedData, domain: { ...q.typedData.domain, name: 'USDC' } } })).toBe(false);
    expect(authorizationMatchesQuote({ ...q, priceAtomic: '1' })).toBe(false);
  });
});
