# 探针单元测试 - 提示词

一键运行附带探针的单元测试，自动生成函数调用 trace 日志。适用于任意 Node.js/TypeScript 项目。

---

## 快速开始

### 1. 下载探针文件

```bash
mkdir -p .syncause/scripts

curl -o .syncause/probe-wrapper-test.ts https://raw.githubusercontent.com/Syncause/ts-agent-file/v1.0.0/probe-wrapper-test.ts
curl -o .syncause/scripts/wrap-test-files.js https://raw.githubusercontent.com/Syncause/ts-agent-file/v1.0.0/wrap-test-files.js
```

### 2. 安装依赖

```bash
npm install -D @babel/parser @babel/traverse @babel/generator @babel/types
```

### 3. 检测测试文件

```bash
# 查找所有测试文件
find . -type f \( -name "*.test.ts" -o -name "*.spec.ts" \) -not -path "*/node_modules/*"

# 检查常见测试目录
ls -d __tests__/ test/ tests/ 2>/dev/null
```

### 4. 转换测试文件

```bash
# 自动 wrap 业务函数（自动检测 tsconfig 别名）
node .syncause/scripts/wrap-test-files.js <源目录> <输出目录>

# 示例
node .syncause/scripts/wrap-test-files.js __tests__ __tests_traced__
node .syncause/scripts/wrap-test-files.js test test_traced
```

### 5. 运行测试

**Jest:**
```bash
npx jest __tests_traced__ --forceExit
```

**Vitest:**
```bash
npx vitest run __tests_traced__
```

**Mocha:**
```bash
npm install -D tsx
npx mocha --require tsx/cjs "__tests_traced__/**/*.test.ts"
```

### 6. 查看 span 日志

```bash
cat .syncause/span.log | jq .
```

**输出格式：**
```json
{
  "traceId": "a204bbe59de603148045497f5089f49a",
  "spanId": "e5304750b5d862e2",
  "name": "myFunction",
  "duration": 4,
  "attributes": {
    "function.name": "myFunction",
    "function.args.0": "value1",
    "function.return.value": "result"
  }
}
```

---

## 一键脚本

```bash
#!/bin/bash
set -e

GITHUB_BASE="https://raw.githubusercontent.com/Syncause/ts-agent-file/v1.0.0"
SOURCE_DIR="${1:-__tests__}"
OUTPUT_DIR="${2:-__tests_traced__}"

mkdir -p .syncause/scripts
curl -sL -o .syncause/probe-wrapper-test.ts "$GITHUB_BASE/probe-wrapper-test.ts"
curl -sL -o .syncause/scripts/wrap-test-files.js "$GITHUB_BASE/wrap-test-files.js"

npm install -D @babel/parser @babel/traverse @babel/generator @babel/types 2>/dev/null || true

node .syncause/scripts/wrap-test-files.js "$SOURCE_DIR" "$OUTPUT_DIR"

rm -f .syncause/span.log
npx jest "$OUTPUT_DIR" --forceExit || npx vitest run "$OUTPUT_DIR" || npx mocha "$OUTPUT_DIR/**/*.test.ts"

echo "Span records: $(wc -l < .syncause/span.log)"
```

---

## 文件说明

| 文件 | 用途 |
|------|------|
| `.syncause/probe-wrapper-test.ts` | 测试版 wrapper，生成 span.log |
| `.syncause/scripts/wrap-test-files.js` | 自动转换测试文件，wrap 业务函数 |
| `.syncause/span.log` | span 日志输出（CachedSpanRec 格式）|

## 特性

- ✅ 自动检测 tsconfig.json 路径别名
- ✅ wrap 所有相对导入 `./`、`../`
- ✅ 使用相对路径导入 probe-wrapper-test
- ✅ 支持 Jest、Vitest、Mocha 等所有测试框架
