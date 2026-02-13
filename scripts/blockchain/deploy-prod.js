#!/usr/bin/env node

/**
 * Smart Contract Deployment Script - Production Environment
 * Deploys MedicalDataAttestation contract to production FISCO BCOS cluster
 */

const fs = require('fs');
const path = require('path');
const Web3 = require('web3');
const readline = require('readline');

const COMPILED_DIR = path.join(__dirname, '../apps/api/src/blockchain/contracts/compiled');
const CONFIG_PATH = path.join(__dirname, '../apps/api/src/blockchain/contracts/deployed-contracts.json');

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function deployContract() {
  console.log('🚀 Starting contract deployment (PRODUCTION)...');
  console.log('⚠️  WARNING: This will deploy to PRODUCTION blockchain!');

  // Confirmation prompt
  const confirm = await prompt('\n❓ Are you sure you want to deploy to PRODUCTION? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes') {
    console.log('❌ Deployment cancelled');
    process.exit(0);
  }

  // Load environment variables
  const node1Url = process.env.FISCO_BCOS_NODE1_URL;
  const node2Url = process.env.FISCO_BCOS_NODE2_URL;
  const node3Url = process.env.FISCO_BCOS_NODE3_URL;
  const chainId = parseInt(process.env.FISCO_BCOS_CHAIN_ID || '1');
  const groupId = parseInt(process.env.FISCO_BCOS_GROUP_ID || '1');

  if (!node1Url || !node2Url || !node3Url) {
    console.error('❌ Production node URLs not configured in environment');
    console.error('💡 Set FISCO_BCOS_NODE1_URL, FISCO_BCOS_NODE2_URL, FISCO_BCOS_NODE3_URL');
    process.exit(1);
  }

  // Try connecting to nodes
  const nodeUrls = [node1Url, node2Url, node3Url];
  let connectedNode = null;

  console.log('\n📡 Testing connections to production nodes...');
  for (const nodeUrl of nodeUrls) {
    try {
      const web3 = new Web3(nodeUrl);
      const blockNumber = await web3.eth.getBlockNumber();
      console.log(`✅ Connected to ${nodeUrl} (block: ${blockNumber})`);
      connectedNode = nodeUrl;
      break;
    } catch (error) {
      console.log(`❌ Failed to connect to ${nodeUrl}`);
    }
  }

  if (!connectedNode) {
    console.error('\n❌ Could not connect to any production nodes');
    process.exit(1);
  }

  console.log(`\n🔗 Using node: ${connectedNode}`);
  console.log(`🔗 Chain ID: ${chainId}, Group ID: ${groupId}`);

  // Initialize Web3
  const web3 = new Web3(connectedNode);

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
    console.error('💡 Ensure production attestation key is configured in Vault');
    process.exit(1);
  }

  const deployer = accounts[0];
  console.log(`👤 Deploying from account: ${deployer}`);

  // Final confirmation
  const finalConfirm = await prompt('\n❓ Proceed with deployment? (yes/no): ');
  if (finalConfirm.toLowerCase() !== 'yes') {
    console.log('❌ Deployment cancelled');
    process.exit(0);
  }

  // Create contract instance
  const contract = new web3.eth.Contract(abi);

  console.log('\n📦 Deploying contract to production...');

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
    console.log(`\n✅ Contract deployed successfully!`);
    console.log(`📍 Contract address: ${contractAddress}`);

    // Verify deployment
    const owner = await deployedContract.methods.owner().call();
    const paused = await deployedContract.methods.paused().call();
    const count = await deployedContract.methods.getAttestationCount().call();

    console.log(`\n📊 Contract Status:`);
    console.log(`   Owner: ${owner}`);
    console.log(`   Paused: ${paused}`);
    console.log(`   Attestation Count: ${count}`);

    // Verify on all nodes
    console.log(`\n🔍 Verifying deployment across all nodes...`);
    for (const nodeUrl of nodeUrls) {
      try {
        const testWeb3 = new Web3(nodeUrl);
        const testContract = new testWeb3.eth.Contract(abi, contractAddress);
        const testOwner = await testContract.methods.owner().call();
        console.log(`✅ ${nodeUrl}: Contract verified (owner: ${testOwner})`);
      } catch (error) {
        console.log(`⚠️  ${nodeUrl}: Verification failed - ${error.message}`);
      }
    }

    // Save deployment info
    const deploymentInfo = {
      environment: 'production',
      contractAddress: contractAddress,
      deployer: deployer,
      deployedAt: new Date().toISOString(),
      chainId: chainId,
      groupId: groupId,
      nodes: nodeUrls,
      blockNumber: await web3.eth.getBlockNumber(),
    };

    // Load existing config or create new
    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }

    config.production = deploymentInfo;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

    console.log(`\n💾 Deployment info saved to: ${CONFIG_PATH}`);
    console.log(`\n✨ Production deployment complete!`);
    console.log(`\n📝 Update your production .env file:`);
    console.log(`   FISCO_BCOS_CONTRACT_ADDRESS=${contractAddress}`);
    console.log(`\n⚠️  IMPORTANT: Backup the deployment info and contract address!`);

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
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
