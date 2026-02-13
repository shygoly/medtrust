#!/usr/bin/env node

/**
 * Smart Contract Compilation Script
 * Compiles MedicalDataAttestation.sol using solc
 */

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const CONTRACT_PATH = path.join(__dirname, '../apps/api/src/blockchain/contracts/MedicalDataAttestation.sol');
const OUTPUT_DIR = path.join(__dirname, '../apps/api/src/blockchain/contracts/compiled');

function compileContract() {
  console.log('📝 Reading contract source...');

  if (!fs.existsSync(CONTRACT_PATH)) {
    console.error(`❌ Contract not found at: ${CONTRACT_PATH}`);
    process.exit(1);
  }

  const source = fs.readFileSync(CONTRACT_PATH, 'utf8');

  console.log('🔨 Compiling contract...');

  const input = {
    language: 'Solidity',
    sources: {
      'MedicalDataAttestation.sol': {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'],
        },
      },
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  // Check for errors
  if (output.errors) {
    const errors = output.errors.filter(error => error.severity === 'error');
    if (errors.length > 0) {
      console.error('❌ Compilation errors:');
      errors.forEach(error => console.error(error.formattedMessage));
      process.exit(1);
    }

    // Show warnings
    const warnings = output.errors.filter(error => error.severity === 'warning');
    if (warnings.length > 0) {
      console.warn('⚠️  Compilation warnings:');
      warnings.forEach(warning => console.warn(warning.formattedMessage));
    }
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Extract compiled contract
  const contract = output.contracts['MedicalDataAttestation.sol']['MedicalDataAttestation'];

  // Save ABI
  const abiPath = path.join(OUTPUT_DIR, 'MedicalDataAttestation.abi.json');
  fs.writeFileSync(abiPath, JSON.stringify(contract.abi, null, 2));
  console.log(`✅ ABI saved to: ${abiPath}`);

  // Save bytecode
  const bytecodePath = path.join(OUTPUT_DIR, 'MedicalDataAttestation.bin');
  fs.writeFileSync(bytecodePath, contract.evm.bytecode.object);
  console.log(`✅ Bytecode saved to: ${bytecodePath}`);

  // Save full compilation output
  const fullOutputPath = path.join(OUTPUT_DIR, 'MedicalDataAttestation.json');
  fs.writeFileSync(fullOutputPath, JSON.stringify({
    abi: contract.abi,
    bytecode: contract.evm.bytecode.object,
    deployedBytecode: contract.evm.deployedBytecode.object,
  }, null, 2));
  console.log(`✅ Full output saved to: ${fullOutputPath}`);

  console.log('✨ Compilation complete!');
}

// Run compilation
try {
  compileContract();
} catch (error) {
  console.error('❌ Compilation failed:', error.message);
  process.exit(1);
}
