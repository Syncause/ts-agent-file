@echo off
setlocal

REM ================================================
REM scan-directories.bat (Windows)
REM Scans project structure and outputs webpack include paths.
REM Equivalent of scan-directories.sh
REM ================================================

REM Delegate to Node.js for cross-platform compatibility
node -e ^
"const fs = require('fs');" ^
"const path = require('path');" ^
"const SKIP_DIRS = ['node_modules', '.next', '.git', 'public', 'styles', 'assets', 'static', 'dist', 'build', 'out', 'coverage', 'tests', '__tests__', '.vscode', '.idea', 'instrumentation', 'probe-wrapper', 'loaders', 'scripts', 'src'];" ^
"const SOURCE_DIRS = ['app', 'pages', 'components', 'lib', 'utils', 'services', 'api', 'hooks', 'helpers', 'models', 'contexts', 'store', 'features', 'modules', 'views', 'controllers'];" ^
"function shouldSkip(d) { const l=d.toLowerCase(); if(d.startsWith('.')&&d!=='.')return true; if(l.includes('test')||l.includes('spec'))return true; if(l.includes('style')||l.includes('css')||l.includes('sass'))return true; return SKIP_DIRS.includes(l); }" ^
"function isSourceDir(d) { return SOURCE_DIRS.includes(d.toLowerCase()); }" ^
"function containsSourceFiles(p) { try { return fs.readdirSync(p).some(f=>['.ts','.tsx','.js','.jsx'].includes(path.extname(f))); } catch(e){ return false; } }" ^
"function scanDir(dir, maxD=3, curD=0, base='') { if(curD>=maxD)return []; let out=[]; try { const entries=fs.readdirSync(dir,{withFileTypes:true}); for(const e of entries) { if(!e.isDirectory())continue; const n=e.name; if(shouldSkip(n))continue; const fp=path.join(dir,n); const rel=base?path.join(base,n).replace(/\\\\/g,'/'):n; if(isSourceDir(n)||containsSourceFiles(fp))out.push(rel); out=out.concat(scanDir(fp,maxD,curD+1,rel)); } } catch(e){} return out; }" ^
"const root=process.cwd();" ^
"let dirs=scanDir(root,1);" ^
"if(fs.existsSync(path.join(root,'src')))dirs=dirs.concat(scanDir(path.join(root,'src'),3,0,'src'));" ^
"let sorted=Array.from(new Set(dirs)).sort();" ^
"if(sorted.length===0)sorted.push(fs.existsSync(path.join(root,'src'))?'src/app':'app');" ^
"process.stdout.write('include: [');" ^
"sorted.forEach((d,i)=>{const e=d.replace(/\//g,'\\\\/');;process.stdout.write((i===0?'':', ')+'/'+e+'/');});" ^
"process.stdout.write(']\\n');"

endlocal
