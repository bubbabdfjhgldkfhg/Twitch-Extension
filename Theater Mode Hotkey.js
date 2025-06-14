// ==UserScript==
// @name         Theater Mode Hotkey
// @version      0.5
// @description  Enable theater mode with 't' and modify 'f' fullscreen behavior
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Theater%20Mode%20Hotkey.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Theater%20Mode%20Hotkey.js
// @author       Me
// @match        *://*.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    let DEBUG_MODE = false;
    let cooldownActive = false;
    let keydownListenerRegistered = false;
    let keydownHandler;

    function debug(...args) {
        if (DEBUG_MODE) {
            const now = new Date();
            const timestamp = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                fractionalSecondDigits: 3
            });
            console.log(`[Twitch Controls Debug ${timestamp}]:`, ...args);
        }
    }

    function findReactNode(root, constraint) {
        if (root.stateNode && constraint(root.stateNode)) {
            debug('Found matching stateNode');
            return root.stateNode;
        }
        let node = root.child;
        while (node) {
            const result = findReactNode(node, constraint);
            if (result) return result;
            node = node.sibling;
        }
        return null;
    }

    function findReactRootNode() {
        debug('Attempting to find React root node');
        let reactRootNode = null;
        let rootNode = document.querySelector('#root');
        debug('Root DOM node found:', { rootNode });

        reactRootNode = rootNode?._reactRootContainer?._internalRoot?.current;
        if (!reactRootNode) {
            debug('Traditional React root not found, searching for container name');
            let containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
            if (containerName) {
                debug('Found container name:', containerName);
                reactRootNode = rootNode[containerName];
            }
        }
        debug('React root node result:', { found: !!reactRootNode });
        return reactRootNode;
    }

    function enableControls() {
        let reactRootNode = findReactRootNode();
        if (!reactRootNode) {
            debug('ERROR: React root node not found');
            return;
        }

        const theatreModeComponent = findReactNode(reactRootNode, node =>
                                                   node && typeof node.toggleTheatreMode === 'function'
                                                  );

        if (theatreModeComponent) {
            debug('Theatre mode component found, setting up event listener');
            if (keydownListenerRegistered) {
                document.removeEventListener("keydown", keydownHandler, true);
                keydownListenerRegistered = false;
            }
            keydownHandler = function(event) {
                debug('Keydown event:', { key: event.key, metaKey: event.metaKey, target: event.target.tagName });

                if (event.metaKey) {
                    debug('Command key held, ignoring event');
                    return;
                }

                if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
                    debug('Input element focused, ignoring event');
                    return;
                }

                switch (event.key.toLowerCase()) {
                    case 't':
                        if (cooldownActive) {
                            debug('Cooldown active, ignoring toggle');
                            return;
                        }
                        debug('Toggling theatre mode');
                        cooldownActive = true;
                        setTimeout(() => {
                            cooldownActive = false;
                            debug('Cooldown reset');
                        }, 200);
                        event.preventDefault();
                        theatreModeComponent.toggleTheatreMode();
                        break;
                }
            };
            document.addEventListener("keydown", keydownHandler, true);
            keydownListenerRegistered = true;
        } else {
            debug('ERROR: Theatre mode component not found');
        }
    }

    // Wait for the page to fully load
    window.addEventListener('load', () => {
        debug('Page loaded, initializing controls');
        setTimeout(enableControls, 0);
    });

    // Handle navigation events
    (function(history){
        debug('Setting up history state handlers');
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                debug(`History ${methodName} called`);
                const result = original.apply(this, arguments);
                enableControls();
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
    })(window.history);

    window.addEventListener('popstate', () => {
        debug('Popstate event triggered');
        enableControls();
    });
})();
