#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$repo_dir/.t3/desktop.pid" ]]; then
  previous_pid="$(cat "$repo_dir/.t3/desktop.pid")"
  if [[ "$previous_pid" =~ ^[0-9]+$ && "$previous_pid" != "$$" ]] && kill -0 "$previous_pid" 2>/dev/null; then
    previous_command="$(ps -p "$previous_pid" -o command=)"
    if [[ "$previous_command" == *start-desktop.sh* ]]; then
      echo "T3 Code desktop is already running."
      open -a "$repo_dir/apps/desktop/.electron-runtime/T3 Code (Dev).app"
      exit 0
    fi
  fi
fi
printf '%s\n' "$$" > "$repo_dir/.t3/desktop.pid"
export PATH="/Users/wenjia/.local/node/bin:/Users/wenjia/.local/bin:$PATH"
export COREPACK_ENABLE_NETWORK=0 pnpm_config_pm_on_fail=ignore VP_NO_UPDATE_CHECK=1
export T3CODE_HOME="$repo_dir/.t3/desktop"
export T3CODE_PORT=13774 PORT=5734 HOST=127.0.0.1
export VITE_DEV_SERVER_URL="http://127.0.0.1:$PORT"
export T3CODE_SINGLE_ORIGIN_DEV=1 T3CODE_TELEMETRY_ENABLED=false
unset VITE_HTTP_URL VITE_WS_URL T3CODE_MODE T3CODE_NO_BROWSER T3CODE_DEV_AUTH_TOKEN T3CODE_DESKTOP_WS_URL T3CODE_DESKTOP_DEV ELECTRON_RUN_AS_NODE T3_SERVICE_LAUNCHER_CONTEXT T3_BOOT_SERVICE_UNIT
cd "$repo_dir"
node .t3/build-desktop.mjs
web_pid=""
app_pid=""
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null || true; fi
  if [[ -n "$web_pid" ]]; then kill "$web_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$repo_dir/apps/web"
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer(); await server.listen(); server.printUrls();' &
web_pid=$!
ready=0
for attempt in {1..100}; do
  if curl --max-time 1 -fsS "$VITE_DEV_SERVER_URL" -o /dev/null 2>/dev/null; then ready=1; break; fi
  if ! kill -0 "$web_pid" 2>/dev/null; then echo "Web development server exited." >&2; exit 1; fi
  sleep 0.2
done
if [[ "$ready" != 1 ]]; then echo "Web development server did not become ready." >&2; exit 1; fi
cd "$repo_dir/apps/desktop"
node --input-type=module -e 'import {spawn} from "node:child_process"; import {resolveElectronLaunchCommand,resolveDevProtocolClient} from "./scripts/electron-launcher.mjs"; const client=resolveDevProtocolClient(); const cmd=resolveElectronLaunchCommand(client?[]:["dist-electron/main.cjs"]); const env={...process.env,...(client?{T3CODE_DESKTOP_APP_USER_MODEL_ID:client.appBundleId,T3CODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED:"1"}:{})}; const app=spawn(cmd.electronPath,cmd.args,{stdio:"inherit",env}); for(const signal of ["SIGINT","SIGTERM","SIGHUP"])process.on(signal,()=>app.kill(signal)); app.once("error",error=>{console.error(error);process.exit(1)}); app.once("exit",code=>process.exit(code??1));' &
app_pid=$!
wait "$app_pid"
