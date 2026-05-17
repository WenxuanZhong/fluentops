# Node 版本契约放宽 + 本机一次性环境修复

> 时间：2026-05-01。本文档面向「希望在 Node 22 上直接跑这个仓库」的用户。

## 1. 已经放宽的契约

`engines.node` 从严格的 `"20"` 改为 `">=20"`，CI 与本地工具链都跟着放开：

| 改动文件 | 之前 | 现在 |
| --- | --- | --- |
| `package.json` | `"node": "20"` | `"node": ">=20"` |
| `.nvmrc` / `.node-version` | `20` | `lts/*`（让 nvm/fnm/asdf 选最新 LTS） |
| `.github/workflows/ci.yml` | `node-version: 20`（两处） | `node-version: lts/*` |
| `scripts/toolchain-lib.mjs` | 多了 `expectedNodeIsRange` 标志 + Windows `spawnSync` 走 `shell:true` |
| `scripts/check-toolchain.mjs` | 严格相等 (`===`) | 区间放开后改为 `>=` 比较 |
| `scripts/doctor.mjs` | 同上 |

文档同步：`README.md`、`README.zh-CN.md`、`docs/web-acceptance-checklist.md`、`docs/enterprise-roadmap.zh-CN.md`、`docs/fix-plan.zh-CN.md` 已经把「必须 Node 20.x」改成「Node 20 或任意更新 LTS（Node 22 / 24 也支持）」。

## 2. 验证结果

在本机 Node 22.19.0、pnpm 9.15.4、Windows 11 + Git-bash 下：

```text
[ok]    Node.js 22.19.0 satisfies the workspace contract (>=20).
[ok]    pnpm 9.15.4 matches the workspace contract.
[ok]    Corepack is available (0.34.0).
[ok]    Runtime platform win32 x64 is within the documented support matrix.
Summary: 4 ok, 0 warn, 0 fail
```

`pnpm toolchain:check`（严格模式）已经通过，`pnpm doctor:env` 除了一项独立问题（见下一节）也都是 ok。这说明 **「Node 版本契约放宽」这件事本身已经成立**。

## 3. 跑 lint/typecheck/test/build 之前的一次性修复

我尝试 `pnpm typecheck` 时报「'turbo' 不是内部命令」。原因不在 Node 版本，而是 **当前 `node_modules` 是从 WSL 装的**：

- `node_modules/.modules.yaml` 里 `storeDir: /mnt/c/Users/zhong/.pnpm-store/v3`
- 所以 `node_modules/.bin/` 里只有 unix shell 脚本（`turbo`），没有 `turbo.cmd`，cmd.exe 找不到
- 同时所有 `node_modules/<pkg>` 是 WSL 风格的符号链接，Windows 上的 pnpm 在 lstat 这些链接时会 EACCES，所以 `pnpm install` / `pnpm rebuild` 都没法原地修

修复办法只有一条干净的：**在 Windows shell 里清掉 node_modules，再让 pnpm 在 Windows 上重新生成 link。**

```powershell
# PowerShell（推荐，权限干净）
Remove-Item -Recurse -Force node_modules
corepack pnpm install
```

```bash
# 或者 Git-bash
rm -rf node_modules
corepack pnpm install
```

`pnpm-store` 已经在 `C:\Users\zhong\.pnpm-store` 里，所以这一步不会重新下载，只是把符号链接重新摆到 Windows 视角里，并补出 `turbo.cmd` / `vitest.cmd` 等 shim。完成后：

```bash
pnpm doctor:env       # 应当全 ok
pnpm verify:local     # lint / typecheck / test / build / api e2e 全跑
```

## 4. 推荐的日常使用方式

避免再次掉进 WSL ↔ Windows 互相污染 `node_modules` 的坑，建议二选一并固定下来：

- **A. 全部走 PowerShell（推荐）**：`engines.pnpm`、CI 的 setup-node、Docker Desktop 都最匹配 PowerShell。
  - `pnpm install` / `pnpm dev` / `pnpm verify:local` 都在 PowerShell 里跑
  - 不要再切到 WSL 装依赖
- **B. 全部走 WSL**：`pnpm install` 在 WSL 里执行；之后所有 `pnpm` 命令也都在 WSL。
  - 注意 `pnpm dev` 起的 web/api 端口需要从 Windows 浏览器访问，Vite 默认绑定 `localhost` 已可访问
  - 切换 Node 时仍用 WSL 内的 nvm

不要在两边交替执行 `pnpm install`，否则就会再次出现「Linux 风格符号链接 + Windows pnpm」这种冲突。

## 5. 之后再遇到 Node 22 警告怎么办

如果 `pnpm doctor:env` 又报「Node.js 22.x is unsupported」：

1. 检查 `package.json` 里 `engines.node` 是不是被回滚到 `"20"`
2. 检查 `scripts/toolchain-lib.mjs` 里是不是还导出 `expectedNodeIsRange`
3. CI 仍然用 `lts/*`；如果有人改回 `20`，请保持「区间」语义

新加的「区间」逻辑是：如果 `engines.node` 以 `>=` 开头就走 `>=` 比较，否则保留旧的严格相等。这样下次想再锁死某个 major（比如 LTS 切换期临时锁 22.x）只要把 `engines.node` 改成 `"22"` 即可，无需再改脚本。

