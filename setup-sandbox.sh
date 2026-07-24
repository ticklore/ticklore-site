#!/usr/bin/env bash
#
# setup-sandbox.sh — rebuild the Ticklore dev toolchain from scratch.
#
# WHY THIS EXISTS:
# The sandbox we develop in is wiped between sessions. The CODE always survives
# (it lives on GitHub), but the TOOLS do not — Foundry and the Solidity compiler
# have to be reinstalled every time. This script is that reinstall, automated.
#
# Think of it as the key to the workshop: the building and everything in it is
# safe, but you still need to unlock the door and turn the lights on each morning.
#
# USAGE (from the repo root, after cloning and checking out your branch):
#     bash setup-sandbox.sh
#
# Safe to run more than once — it skips anything already installed.

set -euo pipefail

SOLC_VERSION="0.8.28"
SOLC_DIR="/home/claude/.solc"
FOUNDRY_DIR="/home/claude/.foundry/bin"

echo "=================================================="
echo " Ticklore sandbox setup"
echo "=================================================="
echo

# --------------------------------------------------------------------------
# 1. Foundry (forge / cast / anvil / chisel)
# --------------------------------------------------------------------------
# Installed from the GitHub release tarball rather than the usual foundryup
# installer, because foundryup reaches for hosts this sandbox blocks.
if [ -x "${FOUNDRY_DIR}/forge" ]; then
  echo "[1/3] Foundry already present — skipping."
else
  echo "[1/3] Installing Foundry..."
  mkdir -p "${FOUNDRY_DIR}"
  curl -sSfL -o /tmp/foundry.tar.gz \
    "https://github.com/foundry-rs/foundry/releases/download/stable/foundry_stable_linux_amd64.tar.gz"
  tar -xzf /tmp/foundry.tar.gz -C "${FOUNDRY_DIR}/"
  chmod +x "${FOUNDRY_DIR}"/*
  rm -f /tmp/foundry.tar.gz
  echo "      done."
fi
echo "      $("${FOUNDRY_DIR}/forge" --version | head -1)"
echo

# --------------------------------------------------------------------------
# 2. Solidity compiler, pinned to 0.8.28
# --------------------------------------------------------------------------
# IMPORTANT: contracts/foundry.toml has this exact path hard-coded as `solc`.
# If you move it, update foundry.toml to match or the build breaks.
#
# NOTE: the official Solidity download host (binaries.soliditylang.org) is
# BLOCKED in this sandbox. GitHub's release mirror works and is used instead.
if [ -x "${SOLC_DIR}/solc" ]; then
  echo "[2/3] solc already present — skipping."
else
  echo "[2/3] Installing solc ${SOLC_VERSION}..."
  mkdir -p "${SOLC_DIR}"
  curl -sSfL -o "${SOLC_DIR}/solc" \
    "https://github.com/ethereum/solidity/releases/download/v${SOLC_VERSION}/solc-static-linux"
  chmod +x "${SOLC_DIR}/solc"
  echo "      done."
fi
echo "      $("${SOLC_DIR}/solc" --version | tail -1)"
echo

# --------------------------------------------------------------------------
# 3. Prove it works
# --------------------------------------------------------------------------
# If the test suite goes green, the environment is genuinely restored —
# not just "the files downloaded."
echo "[3/3] Running the test suite..."
echo
cd "$(dirname "$0")/contracts"
FOUNDRY_PROFILE=sandbox "${FOUNDRY_DIR}/forge" test

echo
echo "=================================================="
echo " Ready. Run forge with:"
echo "   FOUNDRY_PROFILE=sandbox ${FOUNDRY_DIR}/forge test"
echo "   FOUNDRY_PROFILE=sandbox ${FOUNDRY_DIR}/forge test -vv"
echo "=================================================="
