// ==UserScript==
// @name         Theater Mode Hotkey
// @version      0.1
// @description  Enable theater mode with 't'
// @updateURL    https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Theater%20Mode%20Hotkey.js
// @downloadURL  https://raw.githubusercontent.com/bubbabdfjhgldkfhg/Twitch-Extension/refs/heads/main/Theater%20Mode%20Hotkey.js
// @author       Me
// @match        *://*.twitch.tv/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let cooldownActive = false;

    function findReactNode(root, constraint) {
        if (root.stateNode && constraint(root.stateNode)) return root.stateNode;
        let node = root.child;
        while (node) {
            const result = findReactNode(node, constraint);
            if (result) return result;
            node = node.sibling;
        }
        return null;
    }

    function findReactRootNode() {
        let reactRootNode = null;
        let rootNode = document.querySelector('#root'); // Adjust the selector if needed
        reactRootNode = rootNode?._reactRootContainer?._internalRoot?.current;
        if (!reactRootNode) {
            let containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
            if (containerName) reactRootNode = rootNode[containerName];
        }
        return reactRootNode;
    }

    function enableTheatreMode() {
        // let reactRootNode = null;
        let reactRootNode = findReactRootNode();
        if (!reactRootNode) {
            console.log('React root node not found');
            return;
        }
        const theatreModeComponent = findReactNode(reactRootNode, node =>
                                                   node && typeof node.toggleTheatreMode === 'function'
                                                  );
        if (theatreModeComponent) {
            // Listener for adjusting stream speed
            document.addEventListener("keydown", async function(event) {
                // Do nothing if the command key is held down
                if (event.metaKey) return;
                // Do nothing if the target is an input, textarea, or contenteditable element
                if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.isContentEditable) return;
                switch (event.key) {
                    case 't':
                        if (cooldownActive) return;
                        cooldownActive = true;
                        setTimeout(() => {
                            cooldownActive = false;
                        }, 200);

                        event.preventDefault();
                        theatreModeComponent.toggleTheatreMode();
                        break;

                }
            });
        } else {
            console.log('Theatre mode component not found');
        }
    }

    // Wait for the page to fully load
    window.addEventListener('load', () => {
        setTimeout(enableTheatreMode, 0); // Adjust the timeout as necessary
    });

    (function(history){
        const overrideHistoryMethod = (methodName) => {
            const original = history[methodName];
            history[methodName] = function(state) {
                const result = original.apply(this, arguments);
                enableTheatreMode();
                return result;
            };
        };
        overrideHistoryMethod('pushState');
        overrideHistoryMethod('replaceState');
    })(window.history);
    window.addEventListener('popstate', enableTheatreMode);
})();
