// ==UserScript==
// @name         Chat Toggle Hotkey
// @version      0.2
// @description  Toggle Twitch chat with 'c' key
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Chat%20Toggle%20Hotkey.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Chat%20Toggle%20Hotkey.js
// @match        *://*.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    let DEBUG_MODE = false;
    let cooldownActive = false;

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
            console.log(`[Twitch Chat Toggle Debug ${timestamp}]:`, ...args);
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

        // Look for component with right column toggle functionality
        const rightColumnComponent = findReactNode(reactRootNode, node => {
            return node &&
                (node.props?.globalIsExpanded !== undefined) &&
                (typeof node.props.collapseRightColumn === 'function' ||
                 typeof node.props.expandRightColumn === 'function');
        });

        if (rightColumnComponent) {
            debug('Right column component found, setting up event listener');
            document.addEventListener("keydown", function(event) {
                debug('Keydown event:', { key: event.key, metaKey: event.metaKey, target: event.target.tagName });

                // Don't trigger if user is typing in an input field
                if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) {
                    debug('Input field focused, ignoring toggle');
                    return;
                }

                // Don't trigger if any modifier key is held down
                if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
                    debug('Modifier key held, ignoring toggle');
                    return;
                }

                if (event.key.toLowerCase() === 'c') {
                    if (cooldownActive) {
                        debug('Cooldown active, ignoring toggle');
                        return;
                    }
                    debug('Toggling chat visibility');
                    cooldownActive = true;
                    setTimeout(() => {
                        cooldownActive = false;
                        debug('Cooldown reset');
                    }, 200);
                    event.preventDefault();

                    // Toggle based on current expanded state
                    if (rightColumnComponent.props.globalIsExpanded) {
                        debug('Chat is expanded, collapsing');
                        rightColumnComponent.props.collapseRightColumn();
                    } else {
                        debug('Chat is collapsed, expanding');
                        rightColumnComponent.props.expandRightColumn();
                    }
                }
            }, true);
        } else {
            debug('ERROR: Right column component not found');
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
