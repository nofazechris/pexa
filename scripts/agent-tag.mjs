#!/usr/bin/env node
/**
 * The Celo hackathon agent wallet: its tag, its ERC-8004 identity, and proof that its transactions carry the tag.
 *
 *   npm run agent:tag -- status            the relayer (agent) wallet, its CELO, the tag, and whether it holds an identity
 *   npm run agent:tag -- verify 0xTXHASH   decode the ERC-8021 tag on any transaction
 *   npm run agent:tag -- register          dry run: simulate registering the identity (sends nothing)
 *   npm run agent:tag -- register --send   register for real (tagged; costs a little CELO gas from the relayer)
 *
 * Reads RELAYER_PRIVATE_KEY, CELO_ATTRIBUTION_TAG and optionally CELO_RPC_URL from .env. Nothing secret is printed.
 */
import { readFileSync } from 'node:fs';
import { verifyTx, withAttribution } from '@celo/attribution-tags';
import { createPublicClient, createWalletClient, decodeEventLog, formatEther, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { celo } from 'viem/chains';

const env = {};
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=([^#\r\n]*)/);
  if (m) env[m[1]] = m[2].trim() || undefined;
}

const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const AGENT_URI = 'https://pexaapp.xyz/agent-registration.json';
const abi = parseAbi([
  'function register(string agentURI) returns (uint256 agentId)',
  'function balanceOf(address owner) view returns (uint256)',
  'event Registered(uint256 indexed agentId, string agentURI, address indexed owner)',
]);

const rpc = env.CELO_RPC_URL && /^https?:/.test(env.CELO_RPC_URL) ? env.CELO_RPC_URL : 'https://forno.celo.org';
const client = createPublicClient({ chain: celo, transport: http(rpc) });
const [cmd = 'status', arg] = process.argv.slice(2);

function relayer() {
  const key = env.RELAYER_PRIVATE_KEY;
  if (!key) {
    console.error('RELAYER_PRIVATE_KEY is not set in .env');
    process.exit(2);
  }
  return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
}
const tagOk = (t) => typeof t === 'string' && /^celo_[a-z0-9]{6,16}$/.test(t);

if (cmd === 'status') {
  const account = relayer();
  const [celoWei, identities] = await Promise.all([client.getBalance({ address: account.address }), client.readContract({ address: REGISTRY, abi, functionName: 'balanceOf', args: [account.address] })]);
  console.log('Agent (relayer) wallet :', account.address);
  console.log('CELO balance           :', formatEther(celoWei));
  console.log('Attribution tag        :', tagOk(env.CELO_ATTRIBUTION_TAG) ? env.CELO_ATTRIBUTION_TAG : 'NOT SET (add CELO_ATTRIBUTION_TAG to .env and Vercel)');
  console.log('ERC-8004 identities    :', identities.toString(), identities > 0n ? '(registered)' : '(not registered yet)');
} else if (cmd === 'verify') {
  if (!/^0x[0-9a-fA-F]{64}$/.test(arg ?? '')) {
    console.error('Usage: npm run agent:tag -- verify 0xTRANSACTIONHASH');
    process.exit(2);
  }
  const r = await verifyTx({ client, hash: arg });
  console.log(r ? `Tagged: ${r.codes.join(', ')} (schema ${r.schemaId})` : 'No attribution tag found on that transaction.');
  process.exit(r ? 0 : 1);
} else if (cmd === 'register') {
  const account = relayer();
  if (!tagOk(env.CELO_ATTRIBUTION_TAG)) {
    console.error('Set CELO_ATTRIBUTION_TAG in .env first, so the registration itself carries your tag.');
    process.exit(2);
  }
  const res = await fetch(AGENT_URI).catch(() => null);
  if (!res?.ok) {
    console.error(`${AGENT_URI} is not live yet (deploy first), so there is nothing to register.`);
    process.exit(2);
  }
  const sim = await client.simulateContract({ account, address: REGISTRY, abi, functionName: 'register', args: [AGENT_URI] });
  console.log('Simulation ok. It would register', AGENT_URI, 'from', account.address);
  if (!process.argv.includes('--send')) {
    console.log('Dry run only. Add --send to broadcast.');
  } else {
    const wallet = createWalletClient({ account, chain: celo, transport: http(rpc) }).extend(withAttribution(env.CELO_ATTRIBUTION_TAG));
    const hash = await wallet.writeContract(sim.request);
    console.log('Sent:', hash);
    const receipt = await client.waitForTransactionReceipt({ hash });
    let agentId = null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
        if (ev.eventName === 'Registered') agentId = ev.args.agentId;
      } catch {
        /* another event */
      }
    }
    console.log('Status:', receipt.status, '| agentId (from the Registered event):', agentId?.toString() ?? 'not found');
    const t = await verifyTx({ client, hash });
    console.log('Tag on this transaction:', t ? t.codes.join(', ') : 'NONE');
  }
} else {
  console.error('Commands: status | verify 0xTX | register [--send]');
  process.exit(2);
}
