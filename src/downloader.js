/**
 * downloader.js — Zero Data Retention Edition
 *
 * Downloads Excel from OneDrive/SharePoint/Google Drive share links.
 * ✅ ZDR: No files are ever written to disk.
 *        Returns the raw file as an in-memory Buffer.
 *        Change detection uses an in-memory MD5 hash comparison.
 */

const axios  = require('axios');
const crypto = require('crypto');

// Real browser headers — OneDrive checks these
const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

/**
 * Convert share link to best download URL.
 * For OneDrive: follows redirects to find the real download URL.
 * For Google Drive: converts to direct download.
 */
function toDirectDownloadUrl(shareLink) {
  const url = shareLink.trim();

  // ── Google Drive file (not Sheets) ─────────────────────────────────────────
  if (url.includes('drive.google.com/file')) {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://drive.google.com/uc?export=download&confirm=t&id=${match[1]}`;
  }
  if (url.includes('drive.google.com/uc?')) return url;

  // ── Google Sheets (exports as xlsx) ────────────────────────────────────────
  if (url.includes('docs.google.com/spreadsheets')) {
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return `https://docs.google.com/spreadsheets/d/${match[1]}/export?format=xlsx`;
  }

  // ── OneDrive & SharePoint — return as-is, handled by smartDownload() ───────
  return url;
}

/**
 * Smart download: for OneDrive links, follow the full redirect chain
 * like a browser does to get past the auth check.
 * ✅ ZDR: Returns { buffer, hash, changed, sizeKB } — no disk writes.
 */
async function smartDownload(companyId, shareLink, lastHash = null) {
  const url = shareLink.trim();

  // ── Strategy 1: Direct download URL (Google Drive, plain URLs) ─────────────
  const directUrl = toDirectDownloadUrl(url);
  if (directUrl !== url || url.includes('docs.google.com') || url.includes('drive.google.com')) {
    return await fetchToBuffer(companyId, directUrl, lastHash);
  }

  // ── Strategy 2: OneDrive — try appending ?download=1 with browser headers ──
  if (url.includes('1drv.ms') || url.includes('onedrive') || url.includes('sharepoint.com')) {
    const downloadUrl = url + (url.includes('?') ? '&' : '?') + 'download=1';
    console.log(`[${companyId}] ⬇️  Trying OneDrive direct: ${downloadUrl}`);
    try {
      return await fetchToBuffer(companyId, downloadUrl, lastHash, BROWSER_HEADERS);
    } catch (e1) {
      console.log(`[${companyId}] ⚠️  Direct failed (${e1.message}). Trying Microsoft Shares API...`);
    }

    // ── Strategy 3: Microsoft Shares API ─────────────────────────────────────
    try {
      const base64 = Buffer.from(url).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const apiUrl = `https://api.onedrive.com/v1.0/shares/u!${base64}/root/content`;
      console.log(`[${companyId}] ⬇️  Trying Shares API...`);
      return await fetchToBuffer(companyId, apiUrl, lastHash, BROWSER_HEADERS);
    } catch (e2) {
      console.log(`[${companyId}] ⚠️  Shares API failed (${e2.message}). Trying Graph API...`);
    }

    // ── Strategy 4: Graph API (newer endpoint) ────────────────────────────────
    try {
      const base64 = Buffer.from(url).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${base64}/root/content`;
      console.log(`[${companyId}] ⬇️  Trying Graph API...`);
      return await fetchToBuffer(companyId, graphUrl, lastHash, BROWSER_HEADERS);
    } catch (e3) {
      throw new Error(
        `Cannot download from OneDrive. All methods failed.\n` +
        `  Reason: OneDrive blocks programmatic downloads even for public links.\n` +
        `  Solution: Use Google Drive instead — upload the Excel file, share as "Anyone with the link", then use:\n` +
        `  https://drive.google.com/uc?export=download&confirm=t&id=YOUR_FILE_ID`
      );
    }
  }

  // ── Fallback: try as-is ────────────────────────────────────────────────────
  return await fetchToBuffer(companyId, url, lastHash);
}

/**
 * Fetches a URL and returns the raw response as an in-memory Buffer.
 * ✅ ZDR: No disk writes — all data stays in RAM.
 *
 * @param {string}  companyId    - Used only for logging
 * @param {string}  downloadUrl  - URL to download from
 * @param {string|null} lastHash - Previous MD5 hash for change detection (in-memory)
 * @param {object}  extraHeaders - Optional extra headers
 * @returns {{ buffer: Buffer, hash: string, changed: boolean, sizeKB: string }}
 */
async function fetchToBuffer(companyId, downloadUrl, lastHash = null, extraHeaders = {}) {
  const response = await axios.get(downloadUrl, {
    responseType:   'arraybuffer',
    timeout:        60000,
    maxRedirects:   15,
    headers:        { ...BROWSER_HEADERS, ...extraHeaders },
    validateStatus: (s) => s < 400,
  });

  const buffer = Buffer.from(response.data);

  // Detect if we got HTML instead of Excel (OneDrive viewer page)
  const magic = buffer.slice(0, 4).toString('hex');
  const isExcel = magic === '504b0304'; // ZIP/XLSX magic bytes
  if (!isExcel) {
    const preview = buffer.slice(0, 200).toString('utf-8');
    if (preview.includes('<html') || preview.includes('<!DOCTYPE')) {
      throw new Error(`Got HTML page instead of Excel file. OneDrive returned a login/viewer page.`);
    }
    throw new Error(`File doesn't look like an Excel file (magic: ${magic})`);
  }

  // ✅ ZDR: Change detection via in-memory hash comparison — no .hash file on disk
  const newHash = crypto.createHash('md5').update(buffer).digest('hex');
  const changed = newHash !== lastHash;

  if (changed) {
    console.log(`[${companyId}] ✅ Downloaded (${(buffer.length / 1024).toFixed(0)} KB). Hash: ${newHash.slice(0, 8)}... [held in RAM only]`);
  } else {
    console.log(`[${companyId}] ✔️  No changes detected (hash match). Skipping re-process.`);
  }

  // ✅ ZDR: Return buffer directly — no localPath, no disk write
  return { buffer, hash: newHash, changed, sizeKB: (buffer.length / 1024).toFixed(0) };
}

/**
 * Public entry point: download an Excel from a share link into memory.
 * @param {string}      companyId  - Used for logging
 * @param {string}      shareLink  - Remote share URL
 * @param {string|null} lastHash   - Previous in-memory hash for change detection
 * @returns {{ buffer: Buffer, hash: string, changed: boolean, sizeKB: string }}
 */
async function downloadExcel(companyId, shareLink, lastHash = null) {
  console.log(`[${companyId}] ⬇️  Starting download: ${shareLink}`);
  try {
    return await smartDownload(companyId, shareLink, lastHash);
  } catch (err) {
    throw new Error(err.message);
  }
}

module.exports = { downloadExcel, toDirectDownloadUrl };
