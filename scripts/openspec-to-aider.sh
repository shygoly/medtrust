#!/bin/bash
# OpenSpec to Aider Bridge
# 将 OpenSpec 规范转换为 Aider 提示词

SPEC_DIR="${1:-openspec/changes}"
OUTPUT_DIR="${2:-.aider-prompts}"

mkdir -p "$OUTPUT_DIR"

echo "🔍 Scanning OpenSpec changes in: $SPEC_DIR"
echo ""

# 查找所有 spec.md 文件
find "$SPEC_DIR" -name "spec.md" -type f | while read -r spec_file; do
    # 提取变更集名称
    change_set=$(basename "$(dirname "$(dirname "$spec_file")")")
    spec_name=$(basename "$(dirname "$spec_file")")
    
    # 生成输出文件名
    output_file="$OUTPUT_DIR/${change_set}-${spec_name}.md"
    
    echo "📄 Processing: $change_set/$spec_name"
    
    # 转换 spec 为 Aider 提示词
    cat > "$output_file" << EOFPROMPT
# Aider Prompt: $spec_name
# From OpenSpec Change Set: $change_set

## Implementation Task

$(grep -A 100 "^## ADDED Requirements" "$spec_file" | head -200)

## Instructions for Aider

Please implement the above requirements with:
- Clean, production-ready code
- Proper TypeScript types
- Error handling
- Unit tests where appropriate
- Follow existing code patterns in the project

EOFPROMPT

    echo "   ✅ Generated: $output_file"
done

echo ""
echo "🎯 Prompts generated in: $OUTPUT_DIR"
echo ""
echo "Usage examples:"
echo "  aider --yes --message \"\$(cat $OUTPUT_DIR/xxx.md)\" <files>"
echo ""
echo "Or use the batch executor:"
echo "  ./scripts/aider-batch.sh"
