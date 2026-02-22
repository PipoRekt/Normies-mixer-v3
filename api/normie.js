const CONTRACT = '0x9eb6e2025b64f340691e424b7fe7022ffde12438';

const RPCS = [
  'https://cloudflare-eth.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
  'https://1rpc.io/eth',
];

function encodeTokenURI(tokenId) {
  const hex = tokenId.toString(16).padStart(64, '0');
  return '0xc87b56dd' + hex;
}

async function callRPC(method, params) {
  let lastErr;
  for (const rpc of RPCS) {
    try {
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All RPCs failed');
}

function decodeABIString(hex) {
  const data = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (data.length < 128) return null;
  const length = parseInt(data.slice(64, 128), 16);
  const strHex = data.slice(128, 128 + length * 2);
  const bytes = new Uint8Array(strHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  return new TextDecoder().decode(bytes);
}

async function fetchMetadata(tokenURI) {
  if (tokenURI.startsWith('data:application/json;base64,')) {
    return JSON.parse(Buffer.from(tokenURI.split(',')[1], 'base64').toString('utf-8'));
  }
  if (tokenURI.startsWith('data:application/json,')) {
    return JSON.parse(decodeURIComponent(tokenURI.split(',')[1]));
  }
  if (tokenURI.startsWith('ipfs://')) {
    const hash = tokenURI.replace('ipfs://', '');
    const res = await fetch(`https://cloudflare-ipfs.com/ipfs/${hash}`);
    return res.json();
  }
  const res = await fetch(tokenURI);
  return res.json();
}

export default async function handler(req, res) {
  // CORS — allow anyone
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tokenId = parseInt(req.query.id, 10);
  if (isNaN(tokenId) || tokenId < 0 || tokenId > 9999) {
    return res.status(400).json({ error: 'Invalid token ID (0–9999)' });
  }

  try {
    // 1. Get tokenURI from chain
    const hexResult = await callRPC('eth_call', [
      { to: CONTRACT, data: encodeTokenURI(tokenId) },
      'latest',
    ]);

    const tokenURI = decodeABIString(hexResult);
    if (!tokenURI) throw new Error('Empty tokenURI');

    // 2. Fetch metadata
    const metadata = await fetchMetadata(tokenURI);

    // 3. Extract Pixel Count trait
    const attrs = metadata.attributes || metadata.traits || [];
    const pixAttr = attrs.find(a => {
      const key = (a.trait_type || a.key || '').toLowerCase().replace(/[\s_]/g, '');
      return key === 'pixelcount';
    });
    const pixelCount = pixAttr ? parseInt(pixAttr.value, 10) : null;

    // 4. Image URL
    let imageUrl = metadata.image || metadata.image_url || '';
    if (imageUrl.startsWith('ipfs://')) {
      imageUrl = 'https://cloudflare-ipfs.com/ipfs/' + imageUrl.replace('ipfs://', '');
    }

    return res.status(200).json({
      id: tokenId,
      name: metadata.name || `Normie #${tokenId}`,
      pixelCount,
      imageUrl,
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
