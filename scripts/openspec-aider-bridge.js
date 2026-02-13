#!/usr/bin/env node
/**
 * OpenSpec to Aider Bridge
 * 将 OpenSpec 规范转换为结构化的 Aider 提示词
 */

const fs = require('fs');
const path = require('path');

class OpenSpecToAider {
  constructor(specDir) {
    this.specDir = specDir;
    this.prompts = [];
  }

  async generatePrompts() {
    const changeSets = this.findChangeSets();
    
    for (const changeSet of changeSets) {
      const specs = this.findSpecs(changeSet);
      
      for (const spec of specs) {
        const prompt = this.convertSpecToPrompt(changeSet, spec);
        this.prompts.push(prompt);
      }
    }
    
    return this.prompts;
  }

  findChangeSets() {
    const changesDir = path.join(this.specDir, 'changes');
    if (!fs.existsSync(changesDir)) return [];
    
    return fs.readdirSync(changesDir)
      .filter(dir => fs.statSync(path.join(changesDir, dir)).isDirectory());
  }

  findSpecs(changeSet) {
    const specsDir = path.join(this.specDir, 'changes', changeSet, 'specs');
    if (!fs.existsSync(specsDir)) return [];
    
    return fs.readdirSync(specsDir)
      .filter(dir => fs.statSync(path.join(specsDir, dir)).isDirectory());
  }

  convertSpecToPrompt(changeSet, specName) {
    const specPath = path.join(this.specDir, 'changes', changeSet, 'specs', specName, 'spec.md');
    
    if (!fs.existsSync(specPath)) {
      return null;
    }

    const content = fs.readFileSync(specPath, 'utf-8');
    const requirements = this.extractRequirements(content);
    const targetFiles = this.inferTargetFiles(specName);
    
    return {
      id: `${changeSet}-${specName}`,
      changeSet,
      specName,
      title: this.formatTitle(specName),
      requirements,
      targetFiles,
      prompt: this.buildAiderPrompt(requirements, targetFiles),
    };
  }

  extractRequirements(content) {
    const requirements = [];
    const regex = /### Requirement: (.*?)(?=### Requirement:|## [A-Z]|$)/gs;
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      const [fullMatch, title] = match;
      const scenarios = this.extractScenarios(fullMatch);
      
      requirements.push({
        title: title.trim(),
        scenarios,
        raw: fullMatch.trim(),
      });
    }
    
    return requirements;
  }

  extractScenarios(content) {
    const scenarios = [];
    const regex = /#### Scenario: (.*?)(?=#### Scenario:|### Requirement:|## [A-Z]|$)/gs;
    
    let match;
    while ((match = regex.exec(content)) !== null) {
      scenarios.push({
        title: match[1].trim(),
        content: match[0].trim(),
      });
    }
    
    return scenarios;
  }

  inferTargetFiles(specName) {
    const mappings = {
      'database-schema': 'packages/database/src/entities/',
      'nestjs-backend': 'apps/api/src/',
      'nextjs-frontend': 'apps/web/',
      'project-structure': 'apps/ packages/',
      'sqlite-database': 'packages/database/',
    };
    
    return mappings[specName] || `apps/${specName}/`;
  }

  formatTitle(specName) {
    return specName
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  buildAiderPrompt(requirements, targetFiles) {
    const requirementsText = requirements
      .map((req, i) => `${i + 1}. ${req.title}
${req.scenarios.map(s => `   - ${s.title}`).join('\n')}`)
      .join('\n\n');

    return `## Implementation Task

You are implementing the following requirements:

${requirementsText}

## Target Files

Target directory: ${targetFiles}

## Implementation Guidelines

1. Follow the project's existing code patterns and conventions
2. Use TypeScript with proper type definitions
3. Include comprehensive error handling
4. Add appropriate comments and documentation
5. Write clean, maintainable code
6. Consider edge cases and validation
7. Use dependency injection where applicable (NestJS)

## Acceptance Criteria

- All requirements are implemented
- Code compiles without errors
- Basic functionality works as described
- Follows project architecture patterns

Please implement these requirements step by step.`;
  }

  savePrompts(outputDir) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const prompt of this.prompts) {
      if (!prompt) continue;
      
      const filePath = path.join(outputDir, `${prompt.id}.md`);
      const content = `# ${prompt.title}

**Change Set:** ${prompt.changeSet}  
**Spec:** ${prompt.specName}

---

${prompt.prompt}

---

## Requirements Detail

${prompt.requirements.map(r => `### ${r.title}\n\n${r.raw}`).join('\n\n')}
`;

      fs.writeFileSync(filePath, content);
      console.log(`✅ Generated: ${filePath}`);
    }
  }

  generateBatchScript(outputPath) {
    const commands = this.prompts
      .filter(p => p)
      .map(p => {
        const promptFile = `.aider-prompts/${p.id}.md`;
        const targetDir = p.targetFiles;
        return `# ${p.title}
aider --yes --message "\$(cat ${promptFile})" ${targetDir}`;
      });

    const script = `#!/bin/bash
# Auto-generated Aider batch script
# Generated from OpenSpec

set -e

echo "🚀 Running Aider with OpenSpec prompts..."
echo ""

${commands.join('\n\n')}

echo ""
echo "✅ All implementations completed!"
`;

    fs.writeFileSync(outputPath, script);
    fs.chmodSync(outputPath, '755');
    console.log(`✅ Generated batch script: ${outputPath}`);
  }
}

// CLI
async function main() {
  const specDir = process.argv[2] || 'openspec';
  const outputDir = process.argv[3] || '.aider-prompts';
  
  console.log('🔍 OpenSpec to Aider Bridge');
  console.log(`   Spec directory: ${specDir}`);
  console.log(`   Output directory: ${outputDir}`);
  console.log('');
  
  const bridge = new OpenSpecToAider(specDir);
  await bridge.generatePrompts();
  
  bridge.savePrompts(outputDir);
  bridge.generateBatchScript('scripts/aider-batch.sh');
  
  console.log('');
  console.log('🎯 Next steps:');
  console.log('   1. Review prompts in:', outputDir);
  console.log('   2. Run: ./scripts/aider-batch.sh');
  console.log('   3. Or run individually:');
  
  bridge.prompts.filter(p => p).forEach(p => {
    console.log(`      aider --yes --message "\$(cat .aider-prompts/${p.id}.md)" ${p.targetFiles}`);
  });
}

main().catch(console.error);
