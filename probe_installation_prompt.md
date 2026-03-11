# AI Probe Installation Prompt (Full Edition)

When tasked with installing the TS/JS Probe into a project, follow this prioritized execution flow:

## 1. Automated Installation

> [!IMPORTANT]
> You **MUST** run the installer script to download probe files from GitHub. Do not handcraft probe files.

Identify the project type (Next.js, TypeScript, or JavaScript) and run the installer directly from GitHub:
```bash
curl -sL https://raw.githubusercontent.com/Syncause/ts-agent-file/v1.6.0/install_probe.sh | bash
```
*Note: For Next.js projects, the script downloads `instrumentation.node.next.ts` from GitHub and renames it to `instrumentation.node.ts`.*

## 2. Next.js Specific Configuration (CRITICAL)
If the project is **Next.js**, the script downloads the files but you **MUST** manually update `next.config.ts` (or `.js`) and `src/instrumentation.ts`.

### Step 2.1: Update `next.config.ts`
Keep Next.js on SWC. Do **NOT** add a project-level `.babelrc` for probe installation, or `next/font` will fail to compile. Add external packages only:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    '@opentelemetry/sdk-node',
    '@opentelemetry/auto-instrumentations-node',
    '@opentelemetry/api',
    'express',
    'ws',
    'bufferutil',
    'utf-8-validate',
  ],
};

export default nextConfig;
```

### Step 2.2: Update `src/instrumentation.ts`
For Next.js 15+, use the official `register` function and include a runtime check to ensure instrumentation only runs in the Node.js environment.

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('./instrumentation.node');
    init();
  }
}
```

### Step 2.3: WebSocket compatibility fix
If startup logs show `TypeError: bufferUtil.mask is not a function`, ensure `instrumentation.node.ts` uses this pattern before loading `ws`:

```typescript
process.env.WS_NO_BUFFER_UTIL ??= '1';
const WsModule = require('ws') as typeof import('ws');
const WebSocket = (WsModule.WebSocket ?? WsModule) as typeof import('ws').WebSocket;
```

### Step 2.4: Generate Installation Patch
After completing the installation and configuration, you must generate a clean patch of all changes made to the project and save it in the `.syncause/installation.patch` file. 

**IMPORTANT**: 
1. Use your internal knowledge of the specific edits you made to generate this patch. 
2. **DO NOT** use `git diff` as it might include unrelated changes.
3. **DO NOT** include any log files or temporary files in the patch.
4. Ensure the patch is in the standard unified diff format.

## 3. Verification
Verify the installation was successful:
- **Environment**: Try running `npm run dev`.
- **Logs**: Look for:
    - No `next/font requires SWC although Babel is being used` errors
    - `[DEBUG] OpenTelemetry SDK started`
    - `[DEBUG] Connected to proxy server` (if logs are enabled)
- **API Check**: Run `curl http://localhost:43210/remote-debug/spans/stats`. It should return JSON data with `totalSpans > 0` after visiting the app.

## 4. Manual Fallback & Troubleshooting
If the script fails or the app doesn't start:
1.  **Dependencies**: Manually install `@opentelemetry/sdk-node @opentelemetry/api @opentelemetry/auto-instrumentations-node @opentelemetry/sdk-metrics @opentelemetry/sdk-trace-node @opentelemetry/core express ws`.
2.  **TS Project**: Ensure `tsx --import ./src/instrumentation.node.ts` is in the `dev` script.
3.  **Conflict**: If "Ready in XXXms" shows but no data, ensure `instrumentation.ts` exists in the `src` folder for Next.js and has the `register()` function.

**Goal**: Confirm the probe is active by verifying the HTTP stats endpoint.
