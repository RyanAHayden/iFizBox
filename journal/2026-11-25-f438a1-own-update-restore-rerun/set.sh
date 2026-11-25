#!/bin/bash
# Restore My VPN on|off
timeout 30 node $(dirname $0)/ev.mjs 'const s=await ifizboxNative.call("vpn.setRestore",{on:'$1'});return "setting "+s.restore+" remembered "+s.remembered'
