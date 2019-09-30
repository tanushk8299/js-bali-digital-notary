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

/**
 * This class implements a digital notary object that is capable of performing the following
 * functions:
 * <pre>
 *   * generateKey - generate a new notary key and return the (unsigned) notary certificate
 *   * activateKey - activate the notary key and return a citation to the notary certificate
 *   * getCitation - retrieve the document citation for the notary certificate
 *   * notarizeComponent - digitally notarize a component using the current notary key
 *   * validDocument - check whether or not the notary seal on a notarized document is valid
 *   * citeDocument - create a document citation for a notarized document
 *   * citationMatches - check whether or not a citation matches its cited document
 *   * refreshKey - replace the existing notary key with new one
 *   * forgetKey - forget any knowledge of the notary key
 * </pre>
 * All cryptographic operations are delegated to a security module.
 */
const bali = require('bali-component-framework').api();
const SSMv1 = require('./v1/SSM').SSM;
//const SSMv2 = require('./v2/SSM').SSM;
//const SSMv3 = require('./v3/SSM').SSM;


// PRIVATE CONSTANTS

// the POSIX end of line character
const EOL = '\n';

// import the supported validation only protocols (in preferred order)
const PROTOCOLS = {
//  ...
//  v3: new SSMv3(),
//  v2: new SSMv2(),
    v1: new SSMv1()
};
const PROTOCOL = Object.keys(PROTOCOLS)[0];  // the latest protocol

// define the finite state machine
const REQUESTS = [  //                        possible request types
              '$generateKey', '$activateKey', '$getCitation', '$notarizeComponent', '$refreshKey'
];
const STATES = {
//   current                                   allowed next states
    $limited: [ '$pending',     undefined,      undefined,         undefined,         undefined ],
    $pending: [  undefined,    '$enabled',      undefined,        '$pending',         undefined ],
    $enabled: [  undefined,     undefined,     '$enabled',        '$enabled',        '$enabled' ]
};


// PUBLIC FUNCTIONS

/**
 * This function creates a new digital notary object.
 *
 * @param {Object} securityModule An object that implements the security module interface.
 * @param {Tag} account A unique account tag for the owner of the digital notary.
 * @param {String} directory An optional directory to be used for local configuration storage. If
 * no directory is specified, a directory called '.bali/' is created in the home directory.
 * @param {Boolean|Number} debug An optional number in the range [0..3] that controls
 * the level of debugging that occurs:
 * <pre>
 *   0 (or false): debugging turned off
 *   1 (or true): log exceptions to console.error
 *   2: perform argument validation and log exceptions to console.error
 *   3: perform argument validation and log exceptions to console.error and debug info to console.log
 * </pre>
 * @returns {Object} An object that implements the API for a digital notary.
 */
const DigitalNotary = function(securityModule, account, directory, debug) {
    // validate the arguments
    if (debug === null || debug === undefined) debug = 0;  // default is off
    if (debug > 1) {
        const validator = bali.validator(debug);
        validator.validateType('/bali/notary/DigitalNotary', '$DigitalNotary', '$securityModule', securityModule, [
            '/javascript/Object'
        ]);
        validator.validateType('/bali/notary/DigitalNotary', '$DigitalNotary', '$account', account, [
            '/bali/elements/Tag'
        ]);
        validator.validateType('/bali/notary/DigitalNotary', '$DigitalNotary', '$directory', directory, [
            '/javascript/Undefined',
            '/javascript/String'
        ]);
    }

    // define the private configuration
    const filename = account.getValue() + '.bali';
    const configurator = bali.configurator(filename, directory, debug);
    var configuration, controller;

    /**
     * This method returns a string describing the attributes of the digital notary. It must
     * not be an asynchronous function since it is part of the JavaScript language.
     *
     * @returns {String} A string describing the attributes of the digital notary.
     */
    this.toString = function() {
        const catalog = bali.catalog({
            $module: '/bali/notary/DigitalNotary',
            $protocol: PROTOCOL,
            $account: account
        });
        return catalog.toString();
    };

    /**
     * This method returns a list of the protocol versions supported by this digital notary
     * API.
     *
     * @returns {List} A list of the protocol versions supported by this digital notary API.
     */
    this.getProtocols = function() {
        try {
            return bali.list(Object.keys(PROTOCOLS));
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$getProtocols',
                $exception: '$unexpected',
                $text: 'An unexpected error occurred while attempting to retrieve the supported security protocols.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method returns the unique tag for the account that is associated with this
     * digital notary.
     *
     * @returns {Tag} The unique tag for the account that is associated with this digital
     * notary.
     */
    this.getAccount = function() {
        return account;
    };

    /**
     * This method returns a document citation referencing the notary certificate associated
     * with the current notary key.
     *
     * @returns {Catalog} A document citation referencing the notary certificate associated
     * with the current notary key.
     */
    this.getCitation = async function() {
        try {
            // check current state
            if (!configuration) {
                configuration = await loadConfiguration(configurator, debug);
                controller = bali.controller(REQUESTS, STATES, configuration.getValue('$state').toString(), debug);
            }
            const state = controller.transitionState('$getCitation');  // NOTE: straight to transition...
            configuration.setValue('$state', state);
            await storeConfiguration(configurator, configuration, debug);
            return configuration.getValue('$citation');
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$getCitation',
                $exception: '$unexpected',
                $text: 'An unexpected error occurred while attempting to retrieve the certificate citation.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method generates a new notary key and returns the new (unsigned) notary certificate.
     *
     * @returns {Catalog} The new (unsigned) notary certificate.
     */
    this.generateKey = async function() {
        try {
            // check current state
            if (!configuration) {
                configuration = await loadConfiguration(configurator, debug);
                controller = bali.controller(REQUESTS, STATES, configuration.getValue('$state').toString(), debug);
            }
            controller.validateEvent('$generateKey');

            // generate a new public-private key pair
            const publicKey = await securityModule.generateKeys();

            // create the new notary certificate
            const certificate = bali.catalog({
                $protocol: PROTOCOL,
                $timestamp: bali.moment(),  // now
                $account: account,
                $publicKey: publicKey
            }, {
                $type: '/bali/notary/Certificate/v1',
                $tag: bali.tag(),  // generate a new random tag
                $version: bali.version(),  // initial version
                $permissions: '/bali/permissions/public/v1',
                $previous: bali.pattern.NONE
            });
            configuration.setValue('$certificate', certificate);

            // update current state
            const state = controller.transitionState('$generateKey');
            configuration.setValue('$state', state);
            await storeConfiguration(configurator, configuration, debug);

            return certificate;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$generateKey',
                $exception: '$unexpected',
                $text: 'An unexpected error occurred while attempting to generate the notary key.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method activates a new notary key by generating and returning a document citation
     * for the specified notary certificate associated with the notary key. This function is
     * needed since a new notary certificate may or may not be self-signed depending on
     * whether it was generated locally by the end user or on their behalf in the Bali Nebula™.
     * The notary certificate in either case must be signed using the notary key that is local
     * to the user.
     *
     * @param {Catalog} certificate The (signed) notary certificate for the new notary key.
     * @returns {Catalog} A document citation for the notarized certificate.
     */
    this.activateKey = async function(certificate) {
        try {
            // validate the argument
            if (debug > 1) {
                const validator = bali.validator(debug);
                validator.validateType('/bali/notary/DigitalNotary', '$activateKey', '$certificate', certificate, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$activateKey', 'document', certificate);
                validateStructure('$activateKey', 'certificate', certificate.getValue('$component'));
            }

            // check current state
            if (!configuration) {
                configuration = await loadConfiguration(configurator, debug);
                controller = bali.controller(REQUESTS, STATES, configuration.getValue('$state').toString(), debug);
            }
            controller.validateEvent('$activateKey');

            // make sure its the same certificate
            const component = certificate.getValue('$component');
            if (!configuration.getValue('$certificate').isEqualTo(component)) {
                const exception = bali.exception({
                    $module: '/bali/notary/DigitalNotary',
                    $procedure: '$activateKey',
                    $exception: '$invalidCertificate',
                    $certificate: certificate,
                    $text: 'The certificate did not match the original notary certificate.'
                });
                if (debug > 0) console.error(exception.toString());
                throw exception;
            }

            // extract the required attributes
            const timestamp = bali.moment();  // now
            const tag = component.getParameter('$tag');
            const version = component.getParameter('$version');

            // generate a digest of the certificate
            const bytes = Buffer.from(certificate.toString(), 'utf8');
            const digest = await securityModule.digestBytes(bytes);

            // save the state of the certificate citation
            const citation = bali.catalog({
                $protocol: PROTOCOL,
                $timestamp: timestamp,
                $tag: tag,
                $version: version,
                $digest: digest
            }, {
                $type: bali.component('/bali/notary/Citation/v1')
            });
            if (debug > 2) console.log('citation: ' + citation + EOL);
            configuration.setValue('$citation', citation);
            configuration.setValue('$certificate', certificate);

            // update current state
            const state = controller.transitionState('$activateKey');
            configuration.setValue('$state', state);
            await storeConfiguration(configurator, configuration, debug);

            return citation;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$activateKey',
                $exception: '$unexpected',
                $certificate: certificate,
                $text: 'An unexpected error occurred while attempting to activate the notary key.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method digitally signs the specified component using the notary key maintained by
     * the security module. The component must be parameterized with the following parameters:
     * <pre>
     *  * $tag - a unique identifier for the component
     *  * $version - the version of the component
     *  * $permissions - the name of a notarized document containing the permissions defining
     *                   who can access the component
     *  * $previous - a citation to the previous version of the component (or bali.pattern.NONE)
     * </pre>
     *
     * The newly notarized document is returned.
     *
     * @param {Component} component The component to be notarized.
     * @returns {Catalog} A newly notarized document containing the component.
     */
    this.notarizeComponent = async function(component) {
        try {
            // validate the argument
            if (debug > 1) {
                const validator = bali.validator(debug);
                validator.validateType('/bali/notary/DigitalNotary', '$notarizeComponent', '$component', component, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$notarizeComponent', 'component', component);
            }

            // check current state
            if (!configuration) {
                configuration = await loadConfiguration(configurator, debug);
                controller = bali.controller(REQUESTS, STATES, configuration.getValue('$state').toString(), debug);
            }
            controller.validateEvent('$notarizeComponent');

            // create the document
            const citation = configuration.getValue('$citation');
            const document = bali.catalog({
                $component: component,
                $protocol: PROTOCOL,
                $timestamp: bali.moment(),  // now
                $certificate: citation || bali.pattern.NONE  // 'none' for self-signed certificate
            }, {
                $type: bali.component('/bali/notary/Document/v1')
            });

            // notarize the document
            const bytes = Buffer.from(document.toString(), 'utf8');
            const signature = await securityModule.signBytes(bytes);
            document.setValue('$signature', signature);

            // update current state
            const state = controller.transitionState('$notarizeComponent');
            configuration.setValue('$state', state);
            await storeConfiguration(configurator, configuration, debug);

            return document;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$notarizeComponent',
                $exception: '$unexpected',
                $component: component,
                $text: 'An unexpected error occurred while attempting to notarize a component.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method determines whether or not the notary seal on the specified notarized
     * document is valid.
     *
     * @param {Catalog} document The notarized document to be tested.
     * @param {Catalog} certificate A document containing the notary certificate for the
     * notary key that allegedly notarized the specified document.
     * @returns {Boolean} Whether or not the notary seal on the document is valid.
     */
    this.validDocument = async function(document, certificate) {
        try {
            // validate the arguments
            if (debug > 1) {
                const validator = bali.validator(debug);
                validator.validateType('/bali/notary/DigitalNotary', '$validDocument', '$document', document, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$validDocument', 'document', document);
                validator.validateType('/bali/notary/DigitalNotary', '$validDocument', '$certificate', certificate, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$validDocument', 'certificate', certificate);
            }

            // separate the signature from the document
            const catalog = bali.catalog.extraction(document, bali.list([
                '$component',
                '$protocol',
                '$timestamp',
                '$certificate'
            ]));
            const signature = document.getValue('$signature');

            // extract the public key from the certificate
            const publicKey = certificate.getValue('$publicKey');

            // find a security module that is compatible with the protocol
            var requiredModule;
            const requiredProtocol = certificate.getValue('$protocol').toString();
            if (requiredProtocol === PROTOCOL) {
                requiredModule = securityModule;  // use the current one
            } else {
                requiredModule = PROTOCOLS[requiredProtocol];
                if (!requiredModule) {
                    const exception = bali.exception({
                        $module: '/bali/notary/DigitalNotary',
                        $procedure: '$validDocument',
                        $exception: '$unsupportedProtocol',
                        $expected: Object.keys(PROTOCOLS),
                        $actual: requiredProtocol,
                        $text: 'Attempted to use an unsupported version of the notary protocol.'
                    });
                    throw exception;
                }
            }

            // validate the signature against the document
            const bytes = Buffer.from(catalog.toString(), 'utf8');
            const result = await requiredModule.validSignature(publicKey, signature, bytes);

            return result;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$validDocument',
                $exception: '$unexpected',
                $document: document,
                $certificate: certificate,
                $text: 'An unexpected error occurred while attempting to validate a notarized document.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method generates a document citation for the specified notarized document.
     *
     * @param {Catalog} document The document to be cited.
     * @returns {Catalog} A document citation for the notarized document.
     */
    this.citeDocument = async function(document) {
        try {
            // validate the argument
            if (debug > 1) {
                const validator = bali.validator(debug);
                validator.validateType('/bali/notary/DigitalNotary', '$citeDocument', '$document', document, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$citeDocument', 'document', document);
            }

            // extract the required attributes
            const timestamp = bali.moment();  // now
            const component = document.getValue('$component');
            const tag = component.getParameter('$tag');
            const version = component.getParameter('$version');

            // generate a digest of the document
            const bytes = Buffer.from(document.toString(), 'utf8');
            const digest = await securityModule.digestBytes(bytes);

            // create the citation
            const citation = bali.catalog({
                $protocol: PROTOCOL,
                $timestamp: timestamp,
                $tag: tag,
                $version: version,
                $digest: digest
            }, {
                $type: '/bali/notary/Citation/v1'
            });

            return citation;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$citeDocument',
                $exception: '$unexpected',
                $document: document,
                $text: 'An unexpected error occurred while attempting to cite a notarized document.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method determines whether or not the specified document citation matches
     * the specified notarized document. The citation only matches if its digest matches
     * the digest of the notarized document exactly.
     *
     * @param {Catalog} citation A document citation allegedly referring to the
     * specified notarized document.
     * @param {Catalog} document The notarized document to be tested.
     * @returns {Boolean} Whether or not the citation matches the specified notarized document.
     */
    this.citationMatches = async function(citation, document) {
        try {
            // validate the arguments
            if (debug > 1) {
                const validator = bali.validator(debug);
                validator.validateType('/bali/notary/DigitalNotary', '$citationMatches', '$citation', citation, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$citationMatches', 'citation', citation);
                validator.validateType('/bali/notary/DigitalNotary', '$citationMatches', '$document', document, [
                    '/bali/collections/Catalog'
                ]);
                validateStructure('$citationMatches', 'document', document);
            }
            const requiredProtocol = citation.getValue('$protocol').toString();
            var requiredModule;
            if (requiredProtocol === PROTOCOL) {
                requiredModule = securityModule;  // use the current one
            } else {
                requiredModule = PROTOCOLS[requiredProtocol];
                if (!requiredModule) {
                    const exception = bali.exception({
                        $module: '/bali/notary/DigitalNotary',
                        $procedure: '$citationMatches',
                        $exception: '$unsupportedProtocol',
                        $expected: Object.keys(PROTOCOLS),
                        $actual: requiredProtocol,
                        $text: 'Attempted to use an unsupported version of the notary protocol.'
                    });
                    throw exception;
                }
            }
            const bytes = Buffer.from(document.toString(), 'utf8');
            var digest = await requiredModule.digestBytes(bytes);

            const result = digest.isEqualTo(citation.getValue('$digest'));

            return result;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$citationMatches',
                $exception: '$unexpected',
                $citation: citation,
                $document: document,
                $text: 'An unexpected error occurred while attempting to match a citation to a notarized document.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method replaces an existing public-private key pair with a new one. It returns
     * a new public notary certificate.  Note, while refreshing the key the old private key
     * is used to sign the new certificate before it is destroyed.
     *
     * @returns {Catalog} The new notary certificate.
     */
    this.refreshKey = async function() {
        try {
            // check current state
            if (!configuration) {
                configuration = await loadConfiguration(configurator, debug);
                controller = bali.controller(REQUESTS, STATES, configuration.getValue('$state').toString(), debug);
            }
            controller.validateEvent('$refreshKey');

            // generate a new public-private key pair
            const publicKey = await securityModule.rotateKeys();
            const timestamp = bali.moment();  // now
            var citation = configuration.getValue('$citation');
            const tag = citation.getValue('$tag');
            const version = citation.getValue('$version').nextVersion();

            // create the new notary certificate body
            const component = bali.catalog({
                $protocol: PROTOCOL,
                $timestamp: timestamp,
                $account: account,
                $publicKey: publicKey
            }, {
                $type: '/bali/notary/Certificate/v1',
                $tag: tag,
                $version: version,
                $permissions: '/bali/permissions/public/v1',
                $previous: citation
            });

            // create a notarized certificate
            const certificate = bali.catalog({
                $component: component,
                $protocol: PROTOCOL,
                $timestamp: timestamp,
                $certificate: citation
            }, {
                $type: bali.component('/bali/notary/Document/v1')
            });
            var bytes = Buffer.from(certificate.toString(), 'utf8');
            const signature = await securityModule.signBytes(bytes);
            certificate.setValue('$signature', signature);
            if (debug > 2) console.log('certificate: ' + certificate + EOL);
            configuration.setValue('$certificate', certificate);

            // generate a digest of the certificate
            bytes = Buffer.from(certificate.toString(), 'utf8');
            const digest = await securityModule.digestBytes(bytes);

            // save the state of the certificate citation
            citation = bali.catalog({
                $protocol: PROTOCOL,
                $timestamp: timestamp,
                $tag: tag,
                $version: version,
                $digest: digest
            }, {
                $type: bali.component('/bali/notary/Citation/v1')
            });
            if (debug > 2) console.log('citation: ' + citation + EOL);
            configuration.setValue('$citation', citation);

            // update current state
            const state = controller.transitionState('$refreshKey');
            configuration.setValue('$state', state);
            await storeConfiguration(configurator, configuration, debug);

            return certificate;
        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$refreshKey',
                $exception: '$unexpected',
                $text: 'An unexpected error occurred while attempting to refresh the notary key.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    /**
     * This method causes the digital notary to forget all information
     * it knows about the current public-private key pair.
     */
    this.forgetKey = async function() {
        try {
            // erase the state of the digital notary
            await securityModule.eraseKeys();
            await deleteConfiguration(configurator, debug);
            configuration = undefined;

        } catch (cause) {
            const exception = bali.exception({
                $module: '/bali/notary/DigitalNotary',
                $procedure: '$forgetKey',
                $exception: '$unexpected',
                $text: 'An unexpected error occurred while attempting to forget the notary key.'
            }, cause);
            if (debug > 0) console.error(exception.toString());
            throw exception;
        }
    };

    return this;
};
DigitalNotary.prototype.constructor = DigitalNotary;
exports.DigitalNotary = DigitalNotary;


// PRIVATE FUNCTIONS

/**
 * This function validates the specified parameter type and value for a parameter that was
 * passed into the specified function. If either the type or value is not valid an exception
 * is thrown. This function is called recursively for any parameters that contain attributes.
 *
 * @param {String} functionName The name of the function to which the parameter was passed.
 * @param {String} parameterName The name of the parameter that was passed.
 * @param {Object} parameterValue The value of the parameter that was passed.
 * @param {String} parameterType The expected type of the parameter that was passed.
 */
const validateStructure = function(functionName, parameterName, parameterValue, parameterType) {
    parameterType = parameterType || parameterName;
    if (parameterValue) {
        switch (parameterType) {
            case 'binary':
                if (parameterValue.isComponent && parameterValue.isType('/bali/elements/Binary')) return;
                break;
            case 'moment':
                if (parameterValue.isComponent && parameterValue.isType('/bali/elements/Moment')) return;
                break;
            case 'name':
                if (parameterValue.isComponent && parameterValue.isType('/bali/elements/Name')) return;
                break;
            case 'tag':
                if (parameterValue.isComponent && parameterValue.isType('/bali/elements/Tag')) return;
                break;
            case 'version':
                if (parameterValue.isComponent && parameterValue.isType('/bali/elements/Version')) return;
                break;
            case 'component':
                if (parameterValue.isComponent) return;
                break;
            case 'citation':
                // A citation must have the following:
                //  * a parameterized type of /bali/notary/Citation/v...
                //  * exactly five specific attributes
                if (parameterValue.isComponent && parameterValue.isEqualTo(bali.pattern.NONE)) return;
                if (parameterValue.isComponent && parameterValue.isType('/bali/collections/Catalog') && parameterValue.getSize() === 5) {
                    validateStructure(functionName, parameterName + '.protocol', parameterValue.getValue('$protocol'), 'version');
                    validateStructure(functionName, parameterName + '.timestamp', parameterValue.getValue('$timestamp'), 'moment');
                    validateStructure(functionName, parameterName + '.tag', parameterValue.getValue('$tag'), 'tag');
                    validateStructure(functionName, parameterName + '.version', parameterValue.getValue('$version'), 'version');
                    validateStructure(functionName, parameterName + '.digest', parameterValue.getValue('$digest'), 'binary');
                    const parameters = parameterValue.getParameters();
                    if (parameters && Object.keys(parameters).length === 1) {
                        validateStructure(functionName, parameterName + '.parameters.type', parameters['$type'], 'name');
                        if (parameters['$type'].toString().startsWith('/bali/notary/Citation/v')) return;
                    }
                }
                break;
            case 'certificate':
                // A certificate must have the following:
                //  * a parameterized type of /bali/notary/Certificate/v...
                //  * exactly four specific attributes
                //  * and be parameterized with exactly 5 specific parameters
                if (parameterValue.isComponent && parameterValue.isType('/bali/collections/Catalog') && parameterValue.getSize() === 4) {
                    validateStructure(functionName, parameterName + '.protocol', parameterValue.getValue('$protocol'), 'version');
                    validateStructure(functionName, parameterName + '.timestamp', parameterValue.getValue('$timestamp'), 'moment');
                    validateStructure(functionName, parameterName + '.account', parameterValue.getValue('$account'), 'tag');
                    validateStructure(functionName, parameterName + '.publicKey', parameterValue.getValue('$publicKey'), 'binary');
                    const parameters = parameterValue.getParameters();
                    if (parameters && Object.keys(parameters).length === 5) {
                        validateStructure(functionName, parameterName + '.parameters.type', parameters['$type'], 'name');
                        validateStructure(functionName, parameterName + '.parameters.tag', parameters['$tag'], 'tag');
                        validateStructure(functionName, parameterName + '.parameters.version', parameters['$version'], 'version');
                        validateStructure(functionName, parameterName + '.parameters.permissions', parameters['$permissions'], 'name');
                        validateStructure(functionName, parameterName + '.parameters.previous', parameters['$previous'], 'citation');
                        if (parameters['$type'].toString().startsWith('/bali/notary/Certificate/v') &&
                            parameters['$permissions'].toString().startsWith('/bali/permissions/public/v')) return;
                    }
                }
                break;
            case 'document':
                // A document must have the following:
                //  * a parameterized type of /bali/notary/Document/v...
                //  * exactly five specific attributes including a $component attribute
                //  * the $component attribute must be parameterized with at least four parameters
                //  * the $component attribute may have a parameterized type as well
                if (parameterValue.isComponent && parameterValue.isType('/bali/collections/Catalog') && parameterValue.getSize() === 5) {
                    validateStructure(functionName, parameterName + '.component', parameterValue.getValue('$component'), 'component');
                    validateStructure(functionName, parameterName + '.protocol', parameterValue.getValue('$protocol'), 'version');
                    validateStructure(functionName, parameterName + '.timestamp', parameterValue.getValue('$timestamp'), 'moment');
                    validateStructure(functionName, parameterName + '.certificate', parameterValue.getValue('$certificate'), 'citation');
                    validateStructure(functionName, parameterName + '.signature', parameterValue.getValue('$signature'), 'binary');
                    var parameters = parameterValue.getValue('$component').getParameters();
                    if (parameters) {
                        if (parameters['$type']) validateStructure(functionName, parameterName + '.parameters.type', parameters['$type'], 'name');
                        validateStructure(functionName, parameterName + '.parameters.tag', parameters['$tag'], 'tag');
                        validateStructure(functionName, parameterName + '.parameters.version', parameters['$version'], 'version');
                        validateStructure(functionName, parameterName + '.parameters.permissions', parameters['$permissions'], 'name');
                        validateStructure(functionName, parameterName + '.parameters.previous', parameters['$previous'], 'citation');
                        parameters = parameterValue.getParameters();
                        if (parameters && Object.keys(parameters).length === 1) {
                            if (parameters['$type'].toString().startsWith('/bali/notary/Document/v')) return;
                        }
                    }
                }
                break;
        }
    }
    const exception = bali.exception({
        $module: '/bali/notary/DigitalNotary',
        $procedure: functionName,
        $exception: '$invalidParameter',
        $parameter: parameterName,
        $value: parameterValue ? bali.text(parameterValue.toString()) : bali.pattern.NONE,
        $text: 'An invalid parameter value was passed to the function.'
    });
    console.error(exception.toString());  // debug > 0 if this function was called so log it
    throw exception;
};


// PRIVATE FUNCTIONS

/**
 * This function uses a configurator to store out the specified configuration catalog to
 * the local filesystem.
 * 
 * @param {Configurator} configurator A filesystem backed configurator.
 * @param {Catalog} configuration A catalog containing the current configuration to be stored.
 * @param {Boolean|Number} debug An optional number in the range [0..3] that controls
 * the level of debugging that occurs:
 */
const storeConfiguration = async function(configurator, configuration, debug) {
    try {
        await configurator.store(configuration.toString() + EOL);
    } catch (cause) {
        const exception = bali.exception({
            $module: '/bali/notary/DigitalNotary',
            $procedure: '$storeConfiguration',
            $exception: '$storageException',
            $text: 'The attempt to store the current configuration failed.'
        }, cause);
        if (debug > 0) console.error(exception.toString());
        throw exception;
    }
};


/**
 * This function uses a configurator to load the current configuration catalog from
 * the local filesystem.
 * 
 * @param {Configurator} configurator A filesystem backed configurator.
 * @param {Boolean|Number} debug An optional number in the range [0..3] that controls
 * the level of debugging that occurs:
 * @returns {Catalog} A catalog containing the current configuration.
 */
const loadConfiguration = async function(configurator, debug) {
    try {
        var configuration;
        const source = await configurator.load();
        if (source) {
            configuration = bali.component(source);
        } else {
            configuration = bali.catalog({
                $state: '$limited'
            });
            await configurator.store(configuration.toString() + EOL);
        }
        return configuration;
    } catch (cause) {
        const exception = bali.exception({
            $module: '/bali/notary/DigitalNotary',
            $procedure: '$loadConfiguration',
            $exception: '$storageException',
            $text: 'The attempt to load the current configuration failed.'
        }, cause);
        if (debug > 0) console.error(exception.toString());
        throw exception;
    }
};


/**
 * This function uses a configurator to delete the current configuration catalog from
 * the local filesystem.
 * 
 * @param {Configurator} configurator A filesystem backed configurator.
 * @param {Boolean|Number} debug An optional number in the range [0..3] that controls
 * the level of debugging that occurs:
 */
const deleteConfiguration = async function(configurator, debug) {
    try {
        await configurator.delete();
    } catch (cause) {
        const exception = bali.exception({
            $module: '/bali/notary/DigitalNotary',
            $procedure: '$deleteConfiguration',
            $exception: '$storageException',
            $text: 'The attempt to delete the current configuration failed.'
        }, cause);
        if (debug > 0) console.error(exception.toString());
        throw exception;
    }
};
