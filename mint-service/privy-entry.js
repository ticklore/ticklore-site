/**
 * privy-entry.js — the bundle entry for Privy in the browser.
 *
 * Our pages are server-rendered vanilla HTML with no build step, and Privy's
 * vanilla SDK (@privy-io/js-sdk-core) is an npm module — so we bundle it ONCE
 * with esbuild into public/privy.js (committed, served statically) and expose
 * just what the pages need on window.TickPrivy. Rebuild only when upgrading
 * the SDK:
 *
 *   npx esbuild privy-entry.js --bundle --format=iife --minify --outfile=public/privy.js
 */

import Privy, { LocalStorage, getUserEmbeddedEthereumWallet, getEntropyDetailsFromUser } from "@privy-io/js-sdk-core";

window.TickPrivy = { Privy, LocalStorage, getUserEmbeddedEthereumWallet, getEntropyDetailsFromUser };
