const http = require("http");
const { ethers } = require("ethers");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;
const FORWARD_TO = process.env.FORWARD_TO;

// Defaults are for BSC USDT (BEP20)
const USDT_ADDRESS = process.env.USDT_ADDRESS || "0x55d398326f99059fF775485246999027B3197955";
const THRESHOLD_USDT = parseFloat(process.env.THRESHOLD_USDT || "1500");
const USDT_DECIMALS = parseInt(process.env.USDT_DECIMALS || "18", 10);
const PORT = process.env.PORT || 3000;

if (!PRIVATE_KEY || !RPC_URL || !FORWARD_TO) {
  console.error("Missing PRIVATE_KEY, RPC_URL, or FORWARD_TO in env");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const usdtAbi = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

const usdt = new ethers.Contract(USDT_ADDRESS, usdtAbi, wallet);
const threshold = ethers.parseUnits(String(THRESHOLD_USDT), USDT_DECIMALS);

const processed = new Set();
let queue = Promise.resolve();

async function forward(amount) {
  console.log(`[${new Date().toISOString()}] Forwarding ${ethers.formatUnits(amount, USDT_DECIMALS)} USDT -> ${FORWARD_TO}`);
  const tx = await usdt.transfer(FORWARD_TO, amount);
  console.log(`Sent transaction: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`Confirmed in block ${receipt.blockNumber}`);
}

usdt.on("Transfer", (from, to, value, event) => {
  try {
    // Only react to transfers sent TO your wallet
    if (to.toLowerCase() !== wallet.address.toLowerCase()) return;

    const id = `${event.transactionHash}-${event.index}`;
    if (processed.has(id)) return;

    if (value <= threshold) {
      console.log(`Ignored ${ethers.formatUnits(value, USDT_DECIMALS)} USDT (below threshold)`);
      return;
    }

    processed.add(id);
    console.log(`Detected incoming ${ethers.formatUnits(value, USDT_DECIMALS)} USDT`);

    // Queue transactions to avoid nonce issues if multiple deposits arrive quickly
    queue = queue
      .then(() => forward(value))
      .catch((err) => console.error("Forward failed:", err));
  } catch (err) {
    console.error("Event handler error:", err);
  }
});

// Simple HTTP server so Render can health-check and pingers can keep it awake
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Bot started. HTTP server listening on port ${PORT}`);
  console.log(`Watching ${wallet.address} for BEP20 USDT transfers > ${THRESHOLD_USDT} USDT`);
});