const logger = require('./logger');

/**
 * ROT13 cipher implementation
 * Used for decrypting HentaiHaven stream URLs
 * Ported from hentai-api/src/helpers/crypto.ts
 */

/**
 * Perform ROT13 substitution cipher
 * Rotates each letter by 13 positions in the alphabet
 * @param {string} str - String to encode/decode
 * @returns {string} ROT13 encoded/decoded string
 */
function rot13(str) {
  if (!str) return '';
  
  return str.replace(/[a-zA-Z]/g, (char) => {
    const code = char.charCodeAt(0);
    const isUpperCase = code >= 65 && code <= 90;
    const base = isUpperCase ? 65 : 97;
    
    // Rotate by 13 positions, wrapping around the alphabet
    return String.fromCharCode(((code - base + 13) % 26) + base);
  });
}

/**
 * Decode string with multiple ROT13 passes
 * HentaiHaven uses 3-layer ROT13 encryption
 * @param {string} encoded - Encoded string
 * @param {number} passes - Number of ROT13 passes (default: 3)
 * @returns {string} Decoded string
 */
function decodeMultipleRot13(encoded, passes = 3) {
  if (!encoded) {
    logger.warn('Empty string provided to decodeMultipleRot13');
    return '';
  }
  
  let decoded = encoded;
  
  for (let i = 0; i < passes; i++) {
    decoded = rot13(decoded);
    logger.debug(`ROT13 pass ${i + 1}/${passes} complete`);
  }
  
  return decoded;
}

/**
 * Extract and decode embedded data from HTML/JS
 * HentaiHaven embeds encrypted stream URLs in script tags
 * @param {string} html - HTML content containing encrypted data
 * @param {string} pattern - Regex pattern to extract encrypted data
 * @returns {string|null} Decoded data or null if not found
 */
function extractAndDecode(html, pattern = /data\s*=\s*["']([^"']+)["']/) {
  if (!html) {
    logger.warn('Empty HTML provided to extractAndDecode');
    return null;
  }
  
  try {
    const match = html.match(pattern);
    
    if (!match || !match[1]) {
      logger.debug('No encrypted data found in HTML');
      return null;
    }
    
    const encrypted = match[1];
    logger.debug(`Found encrypted data: ${encrypted.substring(0, 50)}...`);
    
    const decoded = decodeMultipleRot13(encrypted, 3);
    logger.debug(`Decoded data: ${decoded.substring(0, 50)}...`);
    
    return decoded;
  } catch (error) {
    logger.error('Error extracting and decoding data:', error);
    return null;
  }
}

/**
 * Base64 decode utility
 * @param {string} str - Base64 encoded string
 * @returns {string} Decoded string
 */
function base64Decode(str) {
  if (!str) return '';
  
  try {
    return Buffer.from(str, 'base64').toString('utf-8');
  } catch (error) {
    logger.error('Base64 decode error:', error);
    return '';
  }
}

/**
 * Base64 encode utility
 * @param {string} str - String to encode
 * @returns {string} Base64 encoded string
 */
function base64Encode(str) {
  if (!str) return '';
  
  try {
    return Buffer.from(str, 'utf-8').toString('base64');
  } catch (error) {
    logger.error('Base64 encode error:', error);
    return '';
  }
}

module.exports = {
  rot13,
  decodeMultipleRot13,
  extractAndDecode,
  base64Decode,
  base64Encode,
};
