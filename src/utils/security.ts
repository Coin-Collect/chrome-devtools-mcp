/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'node:child_process';
import {lookup} from 'node:dns/promises';
import {constants as fsConstants} from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import type {LookupFunction} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {domainToASCII} from 'node:url';
import {promisify} from 'node:util';

import {getDomain} from 'tldts-icann';

export class SecurityViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityViolationError';
  }
}

export const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024;
const REMOTE_IMAGE_REQUEST_TIMEOUT_MS = 15_000;
const MAX_REMOTE_IMAGE_REDIRECTS = 5;
const UNSAFE_WHITELIST_WRITE_BITS = 0o022;
const DOMAIN_LABEL_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;
const execFileAsync = promisify(execFile);

// tldts-icann intentionally excludes the public suffix list's private section.
// These common hosting suffixes must not become trust boundaries for tenants.
const PRIVATE_HOSTING_SUFFIXES = new Set([
  'appspot.com',
  'azurewebsites.net',
  'blogspot.com',
  'cloudfront.net',
  'firebaseapp.com',
  'github.io',
  'herokuapp.com',
  'netlify.app',
  'pages.dev',
  's3.amazonaws.com',
  'vercel.app',
  'web.app',
  'workers.dev',
]);

type SupportedImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif';

export interface DownloadedImage {
  data: Uint8Array;
  filename: string;
  mimeType: SupportedImageMimeType;
}

export interface WhitelistedImageDownloaderDependencies {
  checkNavigationSecurity(url: string): Promise<void>;
  requestRemoteImage(
    url: URL,
  ): Promise<{redirect?: string; image?: DownloadedImage}>;
}

interface ImageResponse {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
  on(event: 'data', listener: (chunk: Uint8Array) => void): ImageResponse;
  once(
    event: 'end' | 'error',
    listener: (error?: Error) => void,
  ): ImageResponse;
  resume(): void;
  destroy(error?: Error): void;
}

export function isSecurityViolation(error: unknown): boolean {
  return (
    error instanceof SecurityViolationError ||
    (error instanceof Error && error.message.startsWith('Security Violation:'))
  );
}

export function isPrivateOrReservedAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0];
  if (net.isIP(normalized) === 4) {
    const octets = normalized.split('.').map(Number);
    const [first, second] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168 || second === 2)) ||
      (first === 198 && (second === 18 || second === 19 || second === 51)) ||
      (first === 203 && second === 0)
    );
  }

  if (net.isIP(normalized) !== 6) {
    return true;
  }

  const value = parseIpv6Address(normalized);
  if (value === null) {
    return true;
  }

  const ipv4Mask = (1n << 32n) - 1n;
  const upper96Bits = value >> 32n;
  const mappedIpv4 = Number(value & ipv4Mask);
  const mappedIpv4Address = [
    (mappedIpv4 >>> 24) & 0xff,
    (mappedIpv4 >>> 16) & 0xff,
    (mappedIpv4 >>> 8) & 0xff,
    mappedIpv4 & 0xff,
  ].join('.');

  return (
    value === 0n ||
    value === 1n ||
    ipv6InCidr(value, 0xfc00n << 112n, 7) ||
    ipv6InCidr(value, 0xfe80n << 112n, 10) ||
    ipv6InCidr(value, 0xff00n << 112n, 8) ||
    ((upper96Bits === 0n || upper96Bits === 0xffffn) &&
      isPrivateOrReservedAddress(mappedIpv4Address))
  );
}

function parseIpv6Address(address: string): bigint | null {
  const halves = address.split('::');
  if (halves.length > 2) {
    return null;
  }

  const expand = (value: string): string[] =>
    value ? value.split(':').filter(Boolean) : [];
  const left = expand(halves[0]);
  const right = halves.length === 2 ? expand(halves[1]) : [];
  const segments = [...left, ...right];
  if (segments.length > 8 || (halves.length === 1 && segments.length !== 8)) {
    return null;
  }

  const expanded = [
    ...left,
    ...Array.from({length: 8 - segments.length}, () => '0'),
    ...right,
  ];
  let result = 0n;
  for (const segment of expanded) {
    if (!/^[0-9a-f]{1,4}$/i.test(segment)) {
      return null;
    }
    result = (result << 16n) + BigInt(`0x${segment}`);
  }
  return result;
}

function ipv6InCidr(
  value: bigint,
  network: bigint,
  prefixLength: number,
): boolean {
  const hostBits = 128n - BigInt(prefixLength);
  return value >> hostBits === network >> hostBits;
}

export function filterPublicDnsAddresses<
  Address extends {address: string; family: number},
>(hostname: string, addresses: readonly Address[]): Address[] {
  const publicAddresses = addresses.filter(
    address => !isPrivateOrReservedAddress(address.address),
  );
  if (publicAddresses.length === 0) {
    throw new SecurityViolationError(
      `Security Violation: ${hostname} resolved only to private or reserved IP addresses.`,
    );
  }
  return publicAddresses;
}

function createWhitelistedLookup(): LookupFunction {
  return (hostname, options, callback) => {
    void lookup(hostname, {all: true, verbatim: true})
      .then(addresses => {
        const publicAddresses = filterPublicDnsAddresses(hostname, addresses);

        if (options.all) {
          callback(null, publicAddresses);
          return;
        }

        const selected = publicAddresses[0];
        callback(null, selected.address, selected.family);
      })
      .catch(error => {
        callback(error as NodeJS.ErrnoException, '', 0);
      });
  };
}

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function parseImageMimeType(value: string | undefined): SupportedImageMimeType {
  const mimeType = value?.split(';', 1)[0].trim().toLowerCase();
  if (
    mimeType !== 'image/png' &&
    mimeType !== 'image/jpeg' &&
    mimeType !== 'image/webp' &&
    mimeType !== 'image/gif'
  ) {
    throw new Error(
      'Remote file must have a PNG, JPEG, WebP, or GIF content type.',
    );
  }
  return mimeType;
}

function getImageFilename(mimeType: SupportedImageMimeType): string {
  switch (mimeType) {
    case 'image/png':
      return 'workflow-upload.png';
    case 'image/jpeg':
      return 'workflow-upload.jpg';
    case 'image/webp':
      return 'workflow-upload.webp';
    case 'image/gif':
      return 'workflow-upload.gif';
  }
}

export function validateDownloadedImage(
  mimeType: string | undefined,
  data: Uint8Array,
): Pick<DownloadedImage, 'filename' | 'mimeType'> {
  if (data.byteLength > MAX_REMOTE_IMAGE_BYTES) {
    throw new Error(
      `Remote image exceeds the ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB limit.`,
    );
  }

  const normalizedMimeType = parseImageMimeType(mimeType);
  const isPng =
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a;
  const isJpeg =
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff;
  const isWebp =
    data.length >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP';
  const isGif =
    data.length >= 6 &&
    (Buffer.from(data.subarray(0, 6)).toString('ascii') === 'GIF87a' ||
      Buffer.from(data.subarray(0, 6)).toString('ascii') === 'GIF89a');
  const isExpectedImage =
    (normalizedMimeType === 'image/png' && isPng) ||
    (normalizedMimeType === 'image/jpeg' && isJpeg) ||
    (normalizedMimeType === 'image/webp' && isWebp) ||
    (normalizedMimeType === 'image/gif' && isGif);

  if (!isExpectedImage) {
    throw new Error(
      'Remote file content does not match its declared image type.',
    );
  }

  return {
    filename: getImageFilename(normalizedMimeType),
    mimeType: normalizedMimeType,
  };
}

function requestRemoteImage(
  url: URL,
): Promise<{redirect?: string; image?: DownloadedImage}> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'image/png, image/jpeg, image/webp, image/gif',
          'Accept-Encoding': 'identity',
        },
        lookup: createWhitelistedLookup(),
        timeout: REMOTE_IMAGE_REQUEST_TIMEOUT_MS,
      },
      response => {
        const imageResponse = response as unknown as ImageResponse;
        const statusCode = imageResponse.statusCode ?? 0;
        if (statusCode >= 300 && statusCode < 400) {
          const redirect = getHeader(imageResponse.headers, 'location');
          imageResponse.resume();
          if (!redirect) {
            reject(
              new Error('Remote image redirect is missing a Location header.'),
            );
            return;
          }
          resolve({redirect});
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          imageResponse.resume();
          reject(
            new Error(`Remote image request failed with status ${statusCode}.`),
          );
          return;
        }

        const contentEncoding = getHeader(
          imageResponse.headers,
          'content-encoding',
        );
        if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
          imageResponse.resume();
          reject(
            new Error('Remote images with content encoding are not supported.'),
          );
          return;
        }

        const contentLength = getHeader(
          imageResponse.headers,
          'content-length',
        );
        if (contentLength !== undefined) {
          if (
            !/^\d+$/.test(contentLength) ||
            Number(contentLength) > MAX_REMOTE_IMAGE_BYTES
          ) {
            imageResponse.resume();
            reject(
              new Error(
                `Remote image exceeds the ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB limit.`,
              ),
            );
            return;
          }
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;
        imageResponse.on('data', chunk => {
          const buffer = Buffer.from(chunk);
          totalBytes += buffer.length;
          if (totalBytes > MAX_REMOTE_IMAGE_BYTES) {
            imageResponse.destroy(
              new Error(
                `Remote image exceeds the ${MAX_REMOTE_IMAGE_BYTES / 1024 / 1024} MB limit.`,
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        imageResponse.once('error', error => {
          reject(error ?? new Error('Failed to read remote image response.'));
        });
        imageResponse.once('end', () => {
          try {
            const data = new Uint8Array(Buffer.concat(chunks));
            const imageMetadata = validateDownloadedImage(
              getHeader(imageResponse.headers, 'content-type'),
              data,
            );
            resolve({image: {...imageMetadata, data}});
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.once('error', reject);
    request.once('timeout', () => {
      request.destroy(
        new Error(
          `Remote image request timed out after ${REMOTE_IMAGE_REQUEST_TIMEOUT_MS}ms.`,
        ),
      );
    });
    request.end();
  });
}

export function createWhitelistedImageDownloader(
  dependencies: WhitelistedImageDownloaderDependencies,
): (urlString: string) => Promise<DownloadedImage> {
  return async (urlString: string): Promise<DownloadedImage> => {
    let currentUrl: URL;
    try {
      currentUrl = new URL(urlString);
    } catch {
      throw new SecurityViolationError(
        `Security Violation: Invalid remote image URL (${urlString}).`,
      );
    }

    for (
      let redirectCount = 0;
      redirectCount <= MAX_REMOTE_IMAGE_REDIRECTS;
      redirectCount++
    ) {
      await dependencies.checkNavigationSecurity(currentUrl.toString());
      const result = await dependencies.requestRemoteImage(currentUrl);
      if (result.image) {
        return result.image;
      }
      if (!result.redirect) {
        throw new Error(
          'Remote image request returned neither an image nor a redirect.',
        );
      }
      if (redirectCount === MAX_REMOTE_IMAGE_REDIRECTS) {
        break;
      }
      try {
        currentUrl = new URL(result.redirect, currentUrl);
      } catch {
        throw new SecurityViolationError(
          `Security Violation: Invalid remote image redirect (${result.redirect}).`,
        );
      }
    }

    throw new SecurityViolationError(
      `Security Violation: Remote image exceeded the ${MAX_REMOTE_IMAGE_REDIRECTS} redirect limit.`,
    );
  };
}

export const downloadWhitelistedImage = createWhitelistedImageDownloader({
  checkNavigationSecurity,
  requestRemoteImage,
});

export async function resolveWhitelistPath(): Promise<string> {
  return path.join(os.homedir(), 'rockstarx', 'whitelist.json');
}

export function normalizeWhitelistDomain(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecurityViolationError(
      'Security Violation: Whitelist entries must be non-empty domain names.',
    );
  }

  if (value !== value.trim()) {
    throw new SecurityViolationError(
      'Security Violation: Whitelist entries cannot contain leading or trailing whitespace.',
    );
  }

  if ([...value].some(character => character.charCodeAt(0) > 0x7f)) {
    throw new SecurityViolationError(
      'Security Violation: Whitelist entries must use lowercase ASCII or explicit punycode domains; Unicode domains are not allowed.',
    );
  }

  if (!/^[a-zA-Z0-9.-]+$/.test(value) || value.endsWith('.')) {
    throw new SecurityViolationError(
      'Security Violation: Whitelist entries must be domain names without a scheme, port, path, wildcard, or trailing dot.',
    );
  }

  const domain = domainToASCII(value).toLowerCase();
  if (!domain || domain.length > 253 || net.isIP(domain)) {
    throw new SecurityViolationError(
      `Security Violation: Invalid whitelist domain (${value}).`,
    );
  }

  const labels = domain.split('.');
  if (
    labels.length < 2 ||
    labels.some(label => !DOMAIN_LABEL_PATTERN.test(label))
  ) {
    throw new SecurityViolationError(
      `Security Violation: Invalid whitelist domain (${value}).`,
    );
  }

  if (domain === 'localhost' || getDomain(domain) === null) {
    throw new SecurityViolationError(
      `Security Violation: Whitelist entries must be registrable domains, not public suffixes (${domain}).`,
    );
  }

  if (PRIVATE_HOSTING_SUFFIXES.has(domain)) {
    throw new SecurityViolationError(
      `Security Violation: Private hosting suffixes cannot be whitelisted directly (${domain}).`,
    );
  }

  return domain;
}

function assertSecureWhitelistPermissions(
  mode: number,
  fileType: 'directory' | 'file',
): void {
  if (
    process.platform !== 'win32' &&
    (mode & UNSAFE_WHITELIST_WRITE_BITS) !== 0
  ) {
    throw new SecurityViolationError(
      `Security Violation: The whitelist ${fileType} must not be writable by group or other users.`,
    );
  }
}

async function assertSecureWindowsAcl(filePath: string): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }

  let stdout: string;
  try {
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const icaclsPath = path.join(systemRoot, 'System32', 'icacls.exe');
    ({stdout} = await execFileAsync(icaclsPath, [filePath], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024,
      windowsHide: true,
    }));
  } catch {
    throw new SecurityViolationError(
      'Security Violation: Unable to verify whitelist permissions on Windows.',
    );
  }

  const broadPrincipal =
    /^\s*(?:Everyone|BUILTIN\\Users|Users|Authenticated Users|NT AUTHORITY\\Authenticated Users)\s*:/im;
  const writePermission =
    /\((?:F|M|W|WD|AD|DC|WA|WEA|WDAC|WO|GW)\)/i;
  if (
    stdout
      .split(/\r?\n/)
      .some(line => broadPrincipal.test(line) && writePermission.test(line))
  ) {
    throw new SecurityViolationError(
      'Security Violation: The whitelist must not be writable by broad Windows user groups.',
    );
  }
}

async function readSecureWhitelistFile(whitelistPath: string): Promise<string> {
  let fileHandle: fs.FileHandle | undefined;
  try {
    const directoryStats = await fs.lstat(path.dirname(whitelistPath));
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new SecurityViolationError(
        'Security Violation: The whitelist directory must be a regular directory.',
      );
    }
    assertSecureWhitelistPermissions(directoryStats.mode, 'directory');
    await assertSecureWindowsAcl(path.dirname(whitelistPath));

    const fileStats = await fs.lstat(whitelistPath);
    if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
      throw new SecurityViolationError(
        'Security Violation: whitelist.json must be a regular file, not a symbolic link.',
      );
    }
    assertSecureWhitelistPermissions(fileStats.mode, 'file');
    await assertSecureWindowsAcl(whitelistPath);

    const flags =
      process.platform === 'win32'
        ? fsConstants.O_RDONLY
        : fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
    fileHandle = await fs.open(whitelistPath, flags);
    const openedStats = await fileHandle.stat();
    if (!openedStats.isFile()) {
      throw new SecurityViolationError(
        'Security Violation: whitelist.json must be a regular file.',
      );
    }
    assertSecureWhitelistPermissions(openedStats.mode, 'file');
    return await fileHandle.readFile({encoding: 'utf8'});
  } catch (error) {
    if (isSecurityViolation(error)) {
      throw error;
    }
    throw new SecurityViolationError(
      'Security Violation: Unable to securely read whitelist.json.',
    );
  } finally {
    await fileHandle?.close();
  }
}

export async function loadWhitelistDomains(
  whitelistPath?: string,
): Promise<string[]> {
  const resolvedWhitelistPath = whitelistPath ?? (await resolveWhitelistPath());
  const data = await readSecureWhitelistFile(resolvedWhitelistPath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new SecurityViolationError(
      'Security Violation: whitelist.json must contain valid JSON.',
    );
  }

  if (!Array.isArray(parsed)) {
    throw new SecurityViolationError(
      'Security Violation: whitelist.json must contain an array of domain names.',
    );
  }

  return [...new Set(parsed.map(normalizeWhitelistDomain))];
}

export async function checkNavigationSecurity(
  urlString: string,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new SecurityViolationError(
      `Security Violation: Invalid URL format (${urlString}).`,
    );
  }

  const forbiddenProtocols = ['file:', 'javascript:', 'data:', 'chrome:'];
  if (forbiddenProtocols.includes(url.protocol)) {
    throw new SecurityViolationError(
      `Security Violation: Navigation to '${url.protocol}' protocols is strictly forbidden.`,
    );
  }

  if (url.protocol !== 'https:') {
    throw new SecurityViolationError(
      `Security Violation: Only 'https:' protocol is allowed (${url.protocol}).`,
    );
  }

  if (net.isIP(url.hostname)) {
    throw new SecurityViolationError(
      `Security Violation: IP addresses are not allowed (${url.hostname}).`,
    );
  }

  if (url.hostname === 'localhost' || url.hostname === '[::1]') {
    throw new SecurityViolationError(
      `Security Violation: Navigating to localhost is not allowed (${url.hostname}).`,
    );
  }

  const whitelist = await loadWhitelistDomains();

  const isAllowed = whitelist.some(
    domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
  );

  if (!isAllowed) {
    throw new SecurityViolationError(
      `Security Violation: The address was not found in whitelist.json (${url.hostname}).`,
    );
  }
}

export function validateWhitelistAddition(urlString: string): string {
  return normalizeWhitelistDomain(urlString);
}
