/************************************************************************
 * Copyright (c) Crater Dog Technologies(TM).  All Rights Reserved.     *
 ************************************************************************
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.        *
 *                                                                      *
 * This code is free software; you can redistribute it and/or modify it *
 * under the terms of The MIT License (MIT), as published by the Open   *
 * Source Initiative. (See http://opensource.org/licenses/MIT)          *
 ************************************************************************/
'use strict';

/*
 * This module defines a library of constants and functions that are needed by the version
 * one (v1) security protocol implementation for the Bali Cloud Environment™.
 */
var codex = require('bali-document-notation/utilities/EncodingUtilities');
var crypto = require('crypto');


// ALGORITHMS AND PROTOCOLS

exports.PROTOCOL = 'v1';
exports.CURVE = 'secp521r1';
exports.DIGEST = 'sha512';
exports.SIGNATURE = 'ecdsa-with-SHA1';
exports.CIPHER = 'aes-256-gcm';


// FUNCTIONS

/**
 * This function returns a cryptographically secure base 32 encoded digital digest of
 * the specified message. The digest is a Bali binary string and will always be the same
 * for the same message.
 * 
 * @param {String} message The message to be digested.
 * @returns {String} A base 32 encoded digital digest of the message.
 */
function digest(message) {
    var hasher = crypto.createHash(exports.DIGEST);
    hasher.update(message);
    var digest = hasher.digest();
    var encodedDigest = "'" + codex.base32Encode(digest).replace(/\s+/g, '') + "'";
    return encodedDigest;
}
exports.digest = digest;


/**
 * This function returns a reference citation for the specified document. The citation is
 * a Bali reference containing an encoded Bali catalog that includes the protocol version,
 * document tag and version number, and a digital digest of the document. It can be used
 * to retrieve the document from the Bali Cloud Environment™ and verify that the retrieved
 * document has not be modified since it was cited.
 * 
 * @param {String} tag The unique tag for the document.
 * @param {String} version The current version of the document.
 * @param {String} document The document to be cited.
 * @returns {String} A Bali reference citation for the document.
 */
function cite(tag, version, document) {
    var encodedDigest = 'none';
    if (document) {
        encodedDigest = digest(document);
    }
    var citation = '<bali:[$protocol:%protocol,$tag:%tag,$version:%version,$digest:%digest]>';
    citation = citation.replace(/%protocol/, exports.PROTOCOL);
    citation = citation.replace(/%tag/, tag);
    citation = citation.replace(/%version/, version);
    citation = citation.replace(/%digest/, encodedDigest);
    return citation;
}
exports.cite = cite;


/**
 * This function converts a binary buffer into a base 32 encoded Bali binary string.
 * 
 * @param {Buffer} buffer A binary buffer.
 * @param {String} indentation A string of spaces to be used as additional indentation
 * for each line within an encoded string that is longer than 60 characters long.
 * @returns {String} A base 32 encoded Bali binary string representing the bytes from
 * the buffer.
 */
function bufferToEncoded(buffer, indentation) {
    if (!indentation) indentation = '';
    var base32 = codex.base32Encode(buffer, indentation);
    var encoded = "'" + base32 + indentation + "'";  // add in the "'"s
    return encoded;
}
exports.bufferToEncoded = bufferToEncoded;


/**
 * This function converts a base 32 encoded Bali binary string into a binary buffer.
 * 
 * @param {String} encoded The base 32 encoded Bali binary string.
 * @returns {Buffer} A binary buffer containing the bytes that were encoded in the string.
 */
function encodedToBuffer(encoded) {
    var base32 = encoded.slice(1, -1);  // remove the "'"s
    var buffer = codex.base32Decode(base32);
    return buffer;
}
exports.encodedToBuffer = encodedToBuffer;
