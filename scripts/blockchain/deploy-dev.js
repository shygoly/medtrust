#!/usr/bin/env node

/**
 * Smart Contract Deployment Script - Development Environment
 * Deploys MedicalDataAttestation contract to local FISCO BCOS dev node
 */

const fs = require('fs');
const path = require('path');
const Web3 = require('web3');

const COMPILED_DIR = path.join(__dirname, '../apps/api/src/blockchain/contracts/compiled');
const CONFIG_PATH = path.join(__dirname, '../apps/api/src/blockchain/contracts/deployed-contracts.json');

async function deployContract() {
  console.log('🚀 Starting contract deployment (DEV)...');

  // Load environment variables
  const nodeUrl = process.env.FISCO_BCOS_DEV_NODE_URL || 'http://localhost:8545';
  const chainId = parseInt(process.env.FISCO_BCOS_CHAIN_ID || '1');
  const groupId = parseInt(process.env.FISCO_BCOS_GROUP_ID || '1');

  console.log(`📡 Connecting to FISCO BCOS node: ${nodeUrl}`);
  console.log(`🔗 Chain ID: ${chainId}, Group ID: ${groupId}`);

  // Initialize Web3
  const web3 = new Web3(nodeUrl);

  // Check connection
  try {
    const blockNumber = await web3.eth.getBlockNumber();
    console.log(`✅ Connected to node. Current block: ${blockNumber}`);
  } catch (error) {
    console.error('❌ Failed to connect to FISCO BCOS node:', error.message);
    console.error('💡 Make sure the dev node is running: docker-compose up -d');
    process.exit(1);
  }

  // Load compiled contract
  const abiPath = path.join(COMPILED_DIR, 'MedicalDataAttestation.abi.json');
  const bytecodePath = path.join(COMPILED_DIR, 'MedicalDataAttestation.bin');

  if (!fs.existsSync(abiPath) || !fs.existsSync(bytecodePath)) {
    console.error('❌ Compiled contract not found. Run: node scripts/blockchain/compile-contract.js');
    process.exit(1);
  }

  const abi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
  const bytecode = fs.readFileSync(bytecodePath, 'utf8');

  console.log('📄 Contract loaded from compiled artifacts');

  // Get deployer account
  const accounts = await web3.eth.getAccounts();
  if (accounts.length === 0) {
    console.error('❌ No accounts available for deployment');
    process.exit(1);
  }

  const deployer = accounts[0];
  console.log(`👤 Deploying from account: ${deployer}`);

  // Create contract instance
  const contract = new web3.eth.Contract(abi);

  console.log('📦 Deploying contract...');

  try {
    const deployedContract = await contract
      .deploy({
        data: '0x' + bytecode,
      })
      .send({
        from: deployer,
        gas: 3000000,
      });

    const contractAddress = deployedContract.options.address;
    console.log(`✅ Contract deployed successfully!`);
    console.log(`📍 Contract address: ${contractAddress}`);

    // Verify deployment
    const owner = await deployedContract.methods.owner().call();
    const paused = await deployedContract.methods.paused().call();
    const count = await deployedContract.methods.getAttestationCount().call();

    console.log(`\n📊 Contract Status:`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Paused: ${paused}`);
    console.log(`   Attestation Count: ${count}`);

    // Save deployment info
    const deploymentInfo = {
      environment: 'development',
      contractAddress: contractAddress,
      deployer: deployer,
      deployedAt: new Date().toISOString(),
      chainId: chainId,
      groupId: groupId,
      nodeUrl: nodeUrl,
      blockNumber: await web3.eth.getBlockNumber(),
    };

    // Load existing config or create new
    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }

    config.development = deploymentInfo;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log(`\n💾 Deployment info saved to: ${CONFIG_PATH}`);
    console.log(`\n✨ Deployment complete!`);
    console.log(`\n📝 Update your .env file:`);
    console.log(`   FISCO_BCOS_CONTRACT_ADDRESS=${contractAddress}`);

  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    if (error.receipt) {
      console.error('Transaction receipt:', error.receipt);
    }
    process.exit(1);
  }
}

// Run deployment
deployContract().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
