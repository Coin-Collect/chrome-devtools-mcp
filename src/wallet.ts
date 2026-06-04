
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * EIP-1193 compliant Ethereum provider injection for browser automation.
 * Injects a window.ethereum object that handles Web3 login flows
 * using a wallet loaded from ~/rockstarx/wallet.json.
 * Currently configured for Polygon network (chainId: 0x89).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WalletConfig {
    address: string;
    privateKey: string;
}

interface WalletPage {
    evaluateOnNewDocument(
        fn: (address: string, chainId: string) => void,
        address: string,
        chainId: string,
    ): Promise<{ identifier: string }>;
    exposeFunction(
        name: string,
        fn: (msg: string) => Promise<string>,
    ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Window augmentation for exposed signing bridges
// ---------------------------------------------------------------------------

declare global {
    interface Window {
        __rockstar_personal_sign?: (msg: string) => Promise<string>;
        __rockstar_sign_typed_data?: (msg: string) => Promise<string>;
    }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLYGON_CHAIN_ID = '0x89';

// ---------------------------------------------------------------------------
// Wallet config loader
// ---------------------------------------------------------------------------

function loadWalletConfig(): WalletConfig {
    const walletPath = path.join(os.homedir(), 'rockstarx', 'wallet.json');

    if (!fs.existsSync(walletPath)) {
        throw new Error(
            `Wallet file not found at ${walletPath}. Run npm run build to generate one.`,
        );
    }

    const content = fs.readFileSync(walletPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('Invalid wallet.json: expected an object');
    }

    if (!('address' in parsed) || typeof parsed.address !== 'string') {
        throw new Error('Invalid wallet.json: missing or invalid address');
    }

    if (!('privateKey' in parsed) || typeof parsed.privateKey !== 'string') {
        throw new Error('Invalid wallet.json: missing or invalid privateKey');
    }

    return { address: parsed.address, privateKey: parsed.privateKey };
}

// ---------------------------------------------------------------------------
// Node-side signing helpers (called via exposeFunction bridge)
// ---------------------------------------------------------------------------

function createPersonalSigner(privateKey: string) {
    return async (message: string): Promise<string> => {
        const wallet = new ethers.Wallet(privateKey);
        const messageBytes = ethers.getBytes(message);
        return wallet.signMessage(messageBytes);
    };
}

function createTypedDataSigner(privateKey: string) {
    return async (typedDataJson: string): Promise<string> => {
        const wallet = new ethers.Wallet(privateKey);
        const parsed: unknown = JSON.parse(typedDataJson);

        if (typeof parsed !== 'object' || parsed === null) {
            throw new Error('Invalid typed data');
        }
        if (
            !('domain' in parsed) ||
            !('types' in parsed) ||
            !('message' in parsed)
        ) {
            throw new Error('Invalid typed data: missing domain, types, or message');
        }

        // Extract fields safely after narrowing via 'in'
        const rawDomain = parsed.domain;
        const rawTypes = parsed.types;
        const rawMsg = parsed.message;

        if (typeof rawTypes !== 'object' || rawTypes === null) {
            throw new Error('Invalid typed data: types must be an object');
        }

        if (typeof rawMsg !== 'object' || rawMsg === null) {
            throw new Error('Invalid typed data: message must be an object');
        }

        // Build a type-safe domain object
        const domain: ethers.TypedDataDomain = {};
        if (typeof rawDomain === 'object' && rawDomain !== null) {
            if ('name' in rawDomain && typeof rawDomain.name === 'string') domain.name = rawDomain.name;
            if ('version' in rawDomain && typeof rawDomain.version === 'string') domain.version = rawDomain.version;
            if ('chainId' in rawDomain && (typeof rawDomain.chainId === 'string' || typeof rawDomain.chainId === 'number' || typeof rawDomain.chainId === 'bigint')) domain.chainId = rawDomain.chainId;
            if ('verifyingContract' in rawDomain && typeof rawDomain.verifyingContract === 'string') domain.verifyingContract = rawDomain.verifyingContract;
            if ('salt' in rawDomain && typeof rawDomain.salt === 'string') domain.salt = rawDomain.salt;
        }

        // Build a type-safe message record
        const message: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawMsg)) {
            message[k] = v;
        }

        // Build a clean types map without EIP712Domain (ethers handles it)
        const signingTypes: Record<string, Array<{ name: string; type: string }>> = {};
        for (const [key, value] of Object.entries(rawTypes)) {
            if (key === 'EIP712Domain') continue;
            if (!Array.isArray(value)) continue;
            signingTypes[key] = value.map((field: unknown) => {
                if (typeof field !== 'object' || field === null) {
                    throw new Error('Invalid typed data field');
                }
                if (!('name' in field) || !('type' in field)) {
                    throw new Error('Invalid typed data field: missing name or type');
                }
                return {
                    name: String(field.name),
                    type: String(field.type),
                };
            });
        }

        return wallet.signTypedData(
            domain,
            signingTypes,
            message,
        );
    };
}

// ---------------------------------------------------------------------------
// Provider script — runs in the PAGE context via evaluateOnNewDocument
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-unused-vars */
function ethereumProviderScript(walletAddress: string, chainId: string): void {
    // Guard: don't override an existing provider
    if ('ethereum' in window) return;

    type Listener = (...args: unknown[]) => void;
    type JsonRpcPayload = {
        id?: number | string | null;
        jsonrpc?: string;
        method: string;
        params?: unknown[] | Record<string, unknown>;
    };
    type JsonRpcCallback = (err: unknown, result?: unknown) => void;
    const listeners: Record<string, Listener[]> = {};
    let connected = false;

    function emit(event: string, data: unknown): void {
        const fns = listeners[event];
        if (!fns) return;
        for (const fn of fns) {
            try {
                fn(data);
            } catch {
                // listener errors must not break the provider
            }
        }
    }

    const provider = {
        // ---------- EIP-1193 identification ----------
        isMetaMask: true,
        isRockstar: true,
        isBraveWallet: false,
        isCoinbaseWallet: false,
        isRabby: false,
        isTrust: false,

        // ---------- Legacy properties ----------
        chainId,
        networkVersion: String(parseInt(chainId, 16)),
        selectedAddress: null as string | null,
        autoRefreshOnNetworkChange: false,
        _state: {
            accounts: [] as string[],
            initialized: true,
            isConnected: false,
            isPermanentlyDisconnected: false,
            isUnlocked: true,
        },
        _metamask: {
            isUnlocked: async () => true,
        },

        // ---------- EIP-1193 connection ----------
        isConnected(): boolean {
            return connected;
        },

        // ---------- EIP-1193 events ----------
        on(event: string, listener: Listener) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(listener);
            return provider;
        },

        removeListener(event: string, listener: Listener) {
            const arr = listeners[event];
            if (arr) {
                listeners[event] = arr.filter((l) => l !== listener);
            }
            return provider;
        },

        addListener(event: string, listener: Listener) {
            return provider.on(event, listener);
        },

        once(event: string, listener: Listener) {
            const wrapper: Listener = (...args) => {
                provider.removeListener(event, wrapper);
                listener(...args);
            };
            return provider.on(event, wrapper);
        },

        removeAllListeners(event?: string) {
            if (event) {
                delete listeners[event];
            } else {
                for (const key of Object.keys(listeners)) {
                    delete listeners[key];
                }
            }
            return provider;
        },

        // ---------- EIP-1193 request ----------
        async request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown> {
            const { method, params } = args;
            const p: unknown[] = Array.isArray(params) ? params : [];

            switch (method) {
                // ---- Account access ----
                case 'eth_requestAccounts':
                case 'eth_accounts': {
                    if (!connected) {
                        connected = true;
                        provider.selectedAddress = walletAddress;
                        provider._state.accounts = [walletAddress];
                        provider._state.isConnected = true;
                        emit('connect', { chainId });
                        emit('accountsChanged', [walletAddress]);
                    }
                    return [walletAddress];
                }

                // ---- Chain info ----
                case 'eth_chainId':
                    return chainId;

                case 'net_version':
                    return String(parseInt(chainId, 16));

                // ---- Chain management ----
                case 'wallet_switchEthereumChain': {
                    const req = p[0];
                    if (
                        typeof req === 'object' &&
                        req !== null &&
                        'chainId' in req &&
                        req.chainId !== chainId
                    ) {
                        throw Object.assign(
                            new Error('Only Polygon network is supported'),
                            { code: 4902 },
                        );
                    }
                    return null;
                }

                case 'wallet_addEthereumChain':
                    return null;

                // ---- Permissions ----
                case 'wallet_requestPermissions':
                    return [{ parentCapability: 'eth_accounts' }];

                case 'wallet_getPermissions':
                    return [{ parentCapability: 'eth_accounts' }];

                case 'web3_clientVersion':
                    return 'MetaMask/v11.0.0';

                case 'eth_coinbase':
                    return walletAddress;

                // ---- Signing (bridged to Node.js) ----
                case 'personal_sign': {
                    const message = String(p[0]);
                    // __rockstar_personal_sign is exposed via Puppeteer exposeFunction
                    const sign = window.__rockstar_personal_sign;
                    if (!sign) throw new Error('Signing bridge not available');
                    return sign(message);
                }

                case 'eth_sign': {
                    const message = String(p[1]);
                    const sign = window.__rockstar_personal_sign;
                    if (!sign) throw new Error('Signing bridge not available');
                    return sign(message);
                }

                case 'eth_signTypedData':
                case 'eth_signTypedData_v3':
                case 'eth_signTypedData_v4': {
                    const raw = p[1];
                    const payload = typeof raw === 'string' ? raw : JSON.stringify(raw);
                    const signTyped = window.__rockstar_sign_typed_data;
                    if (!signTyped) throw new Error('Signing bridge not available');
                    return signTyped(payload);
                }

                // ---- Legacy enable ----
                case 'enable':
                    return provider.request({ method: 'eth_requestAccounts' });

                // ---- Unimplemented methods ----
                default: {
                    alert(`Rockstar Wallet: Method "${method}" is not yet implemented.`);
                    throw Object.assign(
                        new Error(`Method "${method}" is not supported`),
                        { code: 4200 },
                    );
                }
            }
        },

        // ---------- Legacy methods ----------
        enable() {
            return provider.request({ method: 'eth_requestAccounts' });
        },

        send(methodOrPayload: string | JsonRpcPayload, callbackOrParams?: unknown) {
            if (typeof methodOrPayload === 'string') {
                return provider.request({
                    method: methodOrPayload,
                    params: Array.isArray(callbackOrParams) ? callbackOrParams : [],
                });
            }
            const responsePromise = provider.request({
                method: methodOrPayload.method,
                params: methodOrPayload.params,
            });
            if (typeof callbackOrParams === 'function') {
                responsePromise
                    .then((result) =>
                        (callbackOrParams as JsonRpcCallback)(null, {
                            id: methodOrPayload.id,
                            jsonrpc: methodOrPayload.jsonrpc || '2.0',
                            result,
                        }),
                    )
                    .catch((error) => (callbackOrParams as JsonRpcCallback)(error));
                return;
            }
            return responsePromise;
        },

        sendAsync(
            payload: JsonRpcPayload,
            callback: JsonRpcCallback,
        ) {
            provider
                .request({ method: payload.method, params: payload.params })
                .then((result) =>
                    callback(null, {
                        id: payload.id,
                        jsonrpc: payload.jsonrpc || '2.0',
                        result,
                    }),
                )
                .catch((error) => callback(error));
        },
    };

    Object.defineProperties(provider, {
        providers: {
            value: [provider],
            configurable: true,
        },
        selectedProvider: {
            value: provider,
            configurable: true,
        },
    });

    // Install on window
    Object.defineProperty(window, 'ethereum', {
        value: provider,
        writable: false,
        configurable: true,
    });

    Object.defineProperty(window, 'web3', {
        value: {
            currentProvider: provider,
        },
        writable: false,
        configurable: true,
    });

    // Announce the provider (legacy initialization event + EIP-6963).
    window.dispatchEvent(new Event('ethereum#initialized'));
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
        detail: {
            info: {
                uuid: '350670db-19fa-4704-a166-e52e178b59d2',
                name: 'MetaMask',
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                rdns: 'io.metamask',
            },
            provider,
        },
    }));
    window.addEventListener('eip6963:requestProvider', () => {
        window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: {
                info: {
                    uuid: '350670db-19fa-4704-a166-e52e178b59d2',
                    name: 'MetaMask',
                    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                    rdns: 'io.metamask',
                },
                provider,
            },
        }));
    });
}
/* eslint-enable @typescript-eslint/no-unused-vars */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let walletConfig: WalletConfig | null = null;

function getWalletConfig(): WalletConfig {
    if (!walletConfig) {
        walletConfig = loadWalletConfig();
    }
    return walletConfig;
}

/**
 * Injects an EIP-1193 compliant window.ethereum provider into the page.
 * Must be called before navigation so the provider is available when
 * dApp scripts execute. The provider supports:
 *
 * - eth_requestAccounts / eth_accounts (login)
 * - personal_sign, eth_sign (message signing)
 * - eth_signTypedData_v3 / v4 (EIP-712 typed data signing)
 * - eth_chainId, net_version (Polygon network)
 * - wallet_switchEthereumChain, wallet_addEthereumChain
 * - wallet_requestPermissions, wallet_getPermissions
 *
 * All other methods show an alert and throw a 4200 error.
 */
export async function injectEthereumProvider(page: WalletPage): Promise<void> {
    const config = getWalletConfig();

    // 1. Expose signing bridges FIRST so they're available when the
    //    provider script runs on page load.
    try {
        await page.exposeFunction(
            '__rockstar_personal_sign',
            createPersonalSigner(config.privateKey),
        );
    } catch {
        // Already exposed (e.g. after navigation within same page)
    }

    try {
        await page.exposeFunction(
            '__rockstar_sign_typed_data',
            createTypedDataSigner(config.privateKey),
        );
    } catch {
        // Already exposed
    }

    // 2. Register the provider script to run before every document.
    await page.evaluateOnNewDocument(
        ethereumProviderScript,
        config.address,
        POLYGON_CHAIN_ID,
    );
}
